// 胶片滤镜引擎：逐点渲染链移植自 DigitalFilm / SpektraLab (HarmonyOS)
// 原实现：spektralab-harmony/_src/SpectralEngine.ets（GPL-3.0 引擎，数据 CC BY-SA 4.0）
//
// 流程：sRGB 解码 → tcB 转 XYZ → 色度 → 胶片色度表 → 密度曲线 → DIR 耦合
//       → 相纸 33³ LUT → sRGB。整条链路是逐点函数，因此可以烘焙成 33³ LUT，
//       对图片做三线性采样，既有参考观感又能实时预览。
//       反转片（正片）没有橙 mask，也不经过相纸：密度曲线之后直接按
//       透射率 10^(-d) 输出，见 renderInto 中的 film.positive 分支。

const PRINT_SIDE = 33;
const PRINT_SCALE = 32;
const CURVE_N = 256;
const LOG_E_MIN = -3;
const LOG_E_STEP = 7 / 255;
const COUPLER = new Float32Array([
  0.341, 0.355, 0.305,
  0.154, 0.324, 0.358,
  0.171, 0.225, 0.273,
]);

const srgbToLin = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const v = i / 255;
  srgbToLin[i] = v <= 0.040449936 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
const LIN_STEPS = 4096;
const linToSrgb = new Uint8Array(LIN_STEPS + 1);
for (let i = 0; i <= LIN_STEPS; i++) {
  const v = i / LIN_STEPS;
  const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  linToSrgb[i] = Math.round(Math.min(1, Math.max(0, s)) * 255);
}
const encode = (v) => linToSrgb[v <= 0 ? 0 : v >= 1 ? LIN_STEPS : (v * LIN_STEPS) | 0];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function mitchell(t) {
  const B = 1 / 3;
  const C = 1 / 3;
  const x = t < 0 ? -t : t;
  if (x < 1) {
    return (1 / 6) * ((12 - 9 * B - 6 * C) * x * x * x +
      (-18 + 12 * B + 6 * C) * x * x + (6 - 2 * B));
  }
  if (x < 2) {
    return (1 / 6) * ((-B - 6 * C) * x * x * x + (6 * B + 30 * C) * x * x +
      (-12 * B - 48 * C) * x + (8 * B + 24 * C));
  }
  return 0;
}

function safeIndex(idx, len) {
  if (idx < 0) return -idx;
  if (idx >= len) return 2 * (len - 1) - idx;
  return idx;
}

function curveAt(v, curves, ch) {
  if (v <= LOG_E_MIN) return curves[ch];
  const last = CURVE_N - 1;
  const maxV = LOG_E_MIN + LOG_E_STEP * last;
  if (v >= maxV) return curves[last * 3 + ch];
  const f = (v - LOG_E_MIN) / LOG_E_STEP;
  const i = Math.floor(f);
  const t = f - i;
  const y0 = curves[i * 3 + ch];
  const y1 = curves[(i + 1) * 3 + ch];
  return y0 + t * (y1 - y0);
}

export function parseFilm(buffer) {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== "FLM1") throw new Error("胶片数据格式不正确");
  const tcSide = view.getUint16(4, true);
  const curveN = view.getUint16(6, true);
  const tcMax = view.getFloat32(8, true);
  const tcScale = tcSide - 1;
  let o = 12;
  const src = new Uint16Array(buffer, o, tcSide * tcSide * 3);
  const tc = new Float32Array(src.length);
  const k = tcMax / 65535;
  for (let i = 0; i < src.length; i++) tc[i] = src[i] * k;
  o += tcSide * tcSide * 3 * 2;
  const curves = new Float32Array(buffer.slice(o, o + curveN * 3 * 4));
  o += curveN * 3 * 4;
  const coupler = new Float32Array(buffer.slice(o, o + curveN * 3 * 4));
  o += curveN * 3 * 4;
  const tcB = new Float32Array(buffer.slice(o, o + 36));
  return { tcSide, tcScale, curveN, tc, curves, coupler, tcB };
}

export function parsePaper(buffer) {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== "PPR1") throw new Error("相纸数据格式不正确");
  const side = view.getUint16(4, true);
  const axes = new Float32Array(buffer.slice(8, 8 + 99 * 4));
  const lut = new Uint8Array(buffer.slice(404, 404 + side * side * side * 3));
  const ax0 = axes[0];
  const ax1 = axes[side];
  const ax2 = axes[side * 2];
  return {
    side,
    lut,
    ax: [ax0, ax1, ax2],
    inv: [
      PRINT_SCALE / (axes[side - 1] - ax0),
      PRINT_SCALE / (axes[side * 2 - 1] - ax1),
      PRINT_SCALE / (axes[side * 3 - 1] - ax2),
    ],
  };
}

function renderInto(r8, g8, b8, film, paper, evGain, out) {
  const rl = srgbToLin[r8];
  const gl = srgbToLin[g8];
  const bl = srgbToLin[b8];
  const m = film.tcB;
  const X = rl * m[0] + gl * m[1] + bl * m[2];
  const Y = rl * m[3] + gl * m[4] + bl * m[5];
  const Z = rl * m[6] + gl * m[7] + bl * m[8];

  const bsum = X + Y + Z;
  const dn = bsum > 1e-10 ? bsum : 1e-10;
  const cx = X / dn;
  const cy = Y / dn;
  const omx = 1 - cx;
  const t0 = clamp01(omx * omx);
  const t1 = clamp01(cy / (omx > 1e-10 ? omx : 1e-10));

  const side = film.tcSide;
  const scale = film.tcScale;
  const lut = film.tc;
  const gx = t0 * scale;
  const gy = t1 * scale;
  let xb = 0;
  let xf = 0;
  if (gx >= scale) {
    xb = side - 2;
    xf = 1;
  } else if (gx > 0) {
    xb = Math.floor(gx);
    xf = gx - xb;
  }
  let yb = 0;
  let yf = 0;
  if (gy >= scale) {
    yb = side - 2;
    yf = 1;
  } else if (gy > 0) {
    yb = Math.floor(gy);
    yf = gy - yb;
  }

  const wx0 = mitchell(xf + 1);
  const wx1 = mitchell(xf);
  const wx2 = mitchell(xf - 1);
  const wx3 = mitchell(xf - 2);
  const wy0 = mitchell(yf + 1);
  const wy1 = mitchell(yf);
  const wy2 = mitchell(yf - 1);
  const wy3 = mitchell(yf - 2);

  const xi0 = safeIndex(xb - 1, side);
  const xi1 = safeIndex(xb, side);
  const xi2 = safeIndex(xb + 1, side);
  const xi3 = safeIndex(xb + 2, side);
  const yj0 = safeIndex(yb - 1, side);
  const yj1 = safeIndex(yb, side);
  const yj2 = safeIndex(yb + 1, side);
  const yj3 = safeIndex(yb + 2, side);

  const w00 = wx0 * wy0, w01 = wx0 * wy1, w02 = wx0 * wy2, w03 = wx0 * wy3;
  const w10 = wx1 * wy0, w11 = wx1 * wy1, w12 = wx1 * wy2, w13 = wx1 * wy3;
  const w20 = wx2 * wy0, w21 = wx2 * wy1, w22 = wx2 * wy2, w23 = wx2 * wy3;
  const w30 = wx3 * wy0, w31 = wx3 * wy1, w32 = wx3 * wy2, w33 = wx3 * wy3;
  const wsum = w00 + w01 + w02 + w03 + w10 + w11 + w12 + w13 +
    w20 + w21 + w22 + w23 + w30 + w31 + w32 + w33;

  const o00 = ((xi0 * side) + yj0) * 3, o01 = ((xi0 * side) + yj1) * 3;
  const o02 = ((xi0 * side) + yj2) * 3, o03 = ((xi0 * side) + yj3) * 3;
  const o10 = ((xi1 * side) + yj0) * 3, o11 = ((xi1 * side) + yj1) * 3;
  const o12 = ((xi1 * side) + yj2) * 3, o13 = ((xi1 * side) + yj3) * 3;
  const o20 = ((xi2 * side) + yj0) * 3, o21 = ((xi2 * side) + yj1) * 3;
  const o22 = ((xi2 * side) + yj2) * 3, o23 = ((xi2 * side) + yj3) * 3;
  const o30 = ((xi3 * side) + yj0) * 3, o31 = ((xi3 * side) + yj1) * 3;
  const o32 = ((xi3 * side) + yj2) * 3, o33 = ((xi3 * side) + yj3) * 3;

  const a0 = w00 * lut[o00] + w01 * lut[o01] + w02 * lut[o02] + w03 * lut[o03] +
    w10 * lut[o10] + w11 * lut[o11] + w12 * lut[o12] + w13 * lut[o13] +
    w20 * lut[o20] + w21 * lut[o21] + w22 * lut[o22] + w23 * lut[o23] +
    w30 * lut[o30] + w31 * lut[o31] + w32 * lut[o32] + w33 * lut[o33];
  const a1 = w00 * lut[o00 + 1] + w01 * lut[o01 + 1] + w02 * lut[o02 + 1] + w03 * lut[o03 + 1] +
    w10 * lut[o10 + 1] + w11 * lut[o11 + 1] + w12 * lut[o12 + 1] + w13 * lut[o13 + 1] +
    w20 * lut[o20 + 1] + w21 * lut[o21 + 1] + w22 * lut[o22 + 1] + w23 * lut[o23 + 1] +
    w30 * lut[o30 + 1] + w31 * lut[o31 + 1] + w32 * lut[o32 + 1] + w33 * lut[o33 + 1];
  const a2 = w00 * lut[o00 + 2] + w01 * lut[o01 + 2] + w02 * lut[o02 + 2] + w03 * lut[o03 + 2] +
    w10 * lut[o10 + 2] + w11 * lut[o11 + 2] + w12 * lut[o12 + 2] + w13 * lut[o13 + 2] +
    w20 * lut[o20 + 2] + w21 * lut[o21 + 2] + w22 * lut[o22 + 2] + w23 * lut[o23 + 2] +
    w30 * lut[o30 + 2] + w31 * lut[o31 + 2] + w32 * lut[o32 + 2] + w33 * lut[o33 + 2];

  const inv = wsum !== 0 ? 1 / wsum : 1;
  const bsafe = bsum > 1e-10 ? bsum : 0;
  const raw0 = a0 * inv * bsafe * evGain;
  const raw1 = a1 * inv * bsafe * evGain;
  const raw2 = a2 * inv * bsafe * evGain;
  const lr0 = Math.log10((raw0 > 0 ? raw0 : 0) + 1e-10);
  const lr1 = Math.log10((raw1 > 0 ? raw1 : 0) + 1e-10);
  const lr2 = Math.log10((raw2 > 0 ? raw2 : 0) + 1e-10);

  let d0 = curveAt(lr0, film.curves, 0);
  let d1 = curveAt(lr1, film.curves, 1);
  let d2 = curveAt(lr2, film.curves, 2);

  const c0 = d0 * COUPLER[0] + d1 * COUPLER[3] + d2 * COUPLER[6];
  const c1 = d0 * COUPLER[1] + d1 * COUPLER[4] + d2 * COUPLER[7];
  const c2 = d0 * COUPLER[2] + d1 * COUPLER[5] + d2 * COUPLER[8];
  d0 = curveAt(lr0 - c0, film.coupler, 0);
  d1 = curveAt(lr1 - c1, film.coupler, 1);
  d2 = curveAt(lr2 - c2, film.coupler, 2);

  if (film.positive) {
    // 反转片（正片）走直接扫描：没有橙 mask，也没有相纸冲印环节。
    // 密度 d 经 10^(-d) 得到透射率（线性光），再编码回 sRGB。
    out[0] = encode(Math.pow(10, -d0));
    out[1] = encode(Math.pow(10, -d1));
    out[2] = encode(Math.pow(10, -d2));
    return;
  }

  const ps = paper.side;
  const plight = paper.lut;
  const x = Math.min(PRINT_SCALE, Math.max(0, (d0 - paper.ax[0]) * paper.inv[0]));
  const y = Math.min(PRINT_SCALE, Math.max(0, (d1 - paper.ax[1]) * paper.inv[1]));
  const z = Math.min(PRINT_SCALE, Math.max(0, (d2 - paper.ax[2]) * paper.inv[2]));
  const i0 = Math.floor(x);
  const j0 = Math.floor(y);
  const k0 = Math.floor(z);
  const fx = x - i0;
  const fy = y - j0;
  const fz = z - k0;
  const i1 = i0 + 1 < ps ? i0 + 1 : ps - 1;
  const j1 = j0 + 1 < ps ? j0 + 1 : ps - 1;
  const k1 = k0 + 1 < ps ? k0 + 1 : ps - 1;

  const w000 = (1 - fx) * (1 - fy) * (1 - fz);
  const w001 = (1 - fx) * (1 - fy) * fz;
  const w010 = (1 - fx) * fy * (1 - fz);
  const w011 = (1 - fx) * fy * fz;
  const w100 = fx * (1 - fy) * (1 - fz);
  const w101 = fx * (1 - fy) * fz;
  const w110 = fx * fy * (1 - fz);
  const w111 = fx * fy * fz;

  const p000 = (((i0 * ps + j0) * ps) + k0) * 3;
  const p001 = (((i0 * ps + j0) * ps) + k1) * 3;
  const p010 = (((i0 * ps + j1) * ps) + k0) * 3;
  const p011 = (((i0 * ps + j1) * ps) + k1) * 3;
  const p100 = (((i1 * ps + j0) * ps) + k0) * 3;
  const p101 = (((i1 * ps + j0) * ps) + k1) * 3;
  const p110 = (((i1 * ps + j1) * ps) + k0) * 3;
  const p111 = (((i1 * ps + j1) * ps) + k1) * 3;

  const k255 = 1 / 255;
  const orr = (w000 * plight[p000] + w001 * plight[p001] + w010 * plight[p010] + w011 * plight[p011] +
    w100 * plight[p100] + w101 * plight[p101] + w110 * plight[p110] + w111 * plight[p111]) * k255;
  const ogg = (w000 * plight[p000 + 1] + w001 * plight[p001 + 1] + w010 * plight[p010 + 1] +
    w011 * plight[p011 + 1] + w100 * plight[p100 + 1] + w101 * plight[p101 + 1] +
    w110 * plight[p110 + 1] + w111 * plight[p111 + 1]) * k255;
  const obb = (w000 * plight[p000 + 2] + w001 * plight[p001 + 2] + w010 * plight[p010 + 2] +
    w011 * plight[p011 + 2] + w100 * plight[p100 + 2] + w101 * plight[p101 + 2] +
    w110 * plight[p110 + 2] + w111 * plight[p111 + 2]) * k255;

  out[0] = Math.round(clamp01(orr) * 255);
  out[1] = Math.round(clamp01(ogg) * 255);
  out[2] = Math.round(clamp01(obb) * 255);
}

/** 对外的单点渲染（输入输出均为 0..255 sRGB）。 */
export function renderPixel(r, g, b, film, paper, ev) {
  const out = [0, 0, 0];
  renderInto(r, g, b, film, paper, Math.pow(2, ev), out);
  return out;
}

/** 把整条链路烘焙成 side³ 的三维 LUT（域/值均为 sRGB 0..255）。 */
export function bakeLut(film, paper, ev, side = PRINT_SIDE) {
  const lut = new Uint8Array(side * side * side * 3);
  const evGain = Math.pow(2, ev);
  const tmp = [0, 0, 0];
  const step = 255 / (side - 1);
  let o = 0;
  for (let i = 0; i < side; i++) {
    const r = Math.round(i * step);
    for (let j = 0; j < side; j++) {
      const g = Math.round(j * step);
      for (let k = 0; k < side; k++) {
        renderInto(r, g, Math.round(k * step), film, paper, evGain, tmp);
        lut[o++] = tmp[0];
        lut[o++] = tmp[1];
        lut[o++] = tmp[2];
      }
    }
  }
  return lut;
}

/**
 * 用三线性采样应用 3D LUT。
 * strength=1 时直接输出 LUT 值；<1 时在线性光里与原图混合。
 */
export function applyLut(rgba, width, height, lut, side, strength = 1) {
  if (strength <= 0) return rgba;
  const out = new Uint8ClampedArray(rgba.length);
  const max = side - 1;
  const step = 1 / 255;
  const blend = strength < 1;
  const n = width * height;
  let o = 0;
  for (let p = 0; p < n; p++, o += 4) {
    const fr = rgba[o] * step * max;
    const fg = rgba[o + 1] * step * max;
    const fb = rgba[o + 2] * step * max;
    const i0 = Math.floor(fr);
    const j0 = Math.floor(fg);
    const k0 = Math.floor(fb);
    const fx = fr - i0;
    const fy = fg - j0;
    const fz = fb - k0;
    const i1 = i0 < max ? i0 + 1 : max;
    const j1 = j0 < max ? j0 + 1 : max;
    const k1 = k0 < max ? k0 + 1 : max;

    const a000 = ((i0 * side + j0) * side + k0) * 3;
    const a001 = ((i0 * side + j0) * side + k1) * 3;
    const a010 = ((i0 * side + j1) * side + k0) * 3;
    const a011 = ((i0 * side + j1) * side + k1) * 3;
    const a100 = ((i1 * side + j0) * side + k0) * 3;
    const a101 = ((i1 * side + j0) * side + k1) * 3;
    const a110 = ((i1 * side + j1) * side + k0) * 3;
    const a111 = ((i1 * side + j1) * side + k1) * 3;

    const w000 = (1 - fx) * (1 - fy) * (1 - fz);
    const w001 = (1 - fx) * (1 - fy) * fz;
    const w010 = (1 - fx) * fy * (1 - fz);
    const w011 = (1 - fx) * fy * fz;
    const w100 = fx * (1 - fy) * (1 - fz);
    const w101 = fx * (1 - fy) * fz;
    const w110 = fx * fy * (1 - fz);
    const w111 = fx * fy * fz;

    for (let c = 0; c < 3; c++) {
      const v = w000 * lut[a000 + c] + w001 * lut[a001 + c] + w010 * lut[a010 + c] +
        w011 * lut[a011 + c] + w100 * lut[a100 + c] + w101 * lut[a101 + c] +
        w110 * lut[a110 + c] + w111 * lut[a111 + c];
      if (blend) {
        const sl = srgbToLin[rgba[o + c]];
        const ll = srgbToLin[Math.round(v)];
        out[o + c] = encode(sl + strength * (ll - sl));
      } else {
        out[o + c] = Math.round(v);
      }
    }
    out[o + 3] = 255;
  }
  return out;
}

/** camera.auto_exposure = center_weighted, sigma 0.2 of the long edge. */
export function centerWeightedEv(rgba, width, height) {
  const mEdge = width > height ? width : height;
  const sigma = 0.2;
  let mass = 0;
  let weighted = 0;
  for (let row = 0; row < height; row++) {
    const yn = (row / height - 0.5) * (height / mEdge);
    for (let col = 0; col < width; col++) {
      const xn = (col / width - 0.5) * (width / mEdge);
      const o = (row * width + col) * 4;
      const lum = 0.21310869420584375 * srgbToLin[rgba[o]] +
        0.7136608672857466 * srgbToLin[rgba[o + 1]] +
        0.07323053485149408 * srgbToLin[rgba[o + 2]];
      const wgt = Math.exp(-(xn * xn + yn * yn) / (2 * sigma * sigma));
      mass += wgt;
      weighted += lum * wgt;
    }
  }
  if (mass <= 0) return 0;
  const mean = weighted / mass;
  if (mean <= 0) return 0;
  const ev = -Math.log2(mean / 0.184);
  return isFinite(ev) ? ev : 0;
}
