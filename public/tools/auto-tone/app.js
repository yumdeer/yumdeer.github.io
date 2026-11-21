(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  /* sRGB <-> 线性光查找表 */
  const SRGB_TO_LIN = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    SRGB_TO_LIN[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }
  const LIN_TO_SRGB_LUT = new Float32Array(2049);
  for (let i = 0; i <= 2048; i++) {
    const v = i / 2048;
    LIN_TO_SRGB_LUT[i] = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  }
  function linToSrgb(v) {
    if (v <= 0) return 0;
    if (v >= 1) return 1;
    return LIN_TO_SRGB_LUT[(v * 2048) | 0];
  }

  const DEFAULTS = {
    wbEnabled: true,
    /* 默认使用自适应白点检测：只统计高亮低饱和像素，对大面积单色/偏色场景更稳 */
    wbMethod: 'adaptive',
    wbStrength: 1,
    expEnabled: true,
    target: 0.18,
    autoLevels: true,
    lowPct: 0.5,
    highPct: 0.5,
    low: 0,
    high: 1,
    ev: 0,
    gamma: 1,
    saturation: 1,
    cbEnabled: false,
    cbTone: 'midtones',
    cbShadows: [0, 0, 0],
    cbMidtones: [0, 0, 0],
    cbHighlights: [0, 0, 0],
    cbPreserve: true,
    hsEnabled: false,
    hsTarget: -1,
    hsHue: 0,
    hsSat: 0,
    hsLight: 0,
    hsRanges: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]],
    scEnabled: false,
    scRelative: true,
    scTarget: 0,
    scAdjust: [
      [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0],
      [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0],
    ],
  };

  function freshSettings() {
    return JSON.parse(JSON.stringify(DEFAULTS));
  }

  const WB_NOTES = {
    grayworld: '灰度世界假设整幅画面的平均反射是中性灰，适合色彩分布均匀的照片。',
    whitepatch: '白点算法把画面中最亮的高光当作白色参考，适合有明确白色物体的场景；纯色或夕阳场景容易失准。',
    shades: 'Shades of Gray 用 Minkowski p=6 范数估计光源，介于灰度世界和白点之间，通常更稳。',
    adaptive: '自适应算法只统计高亮且低饱和的像素来估计白点，对大面积单色场景更稳。',
  };

  const state = {
    source: null,
    sourceW: 0,
    sourceH: 0,
    name: '',
    analysis: null,
    histBefore: null,
    beforeMedian: 0,
    preview: null,
    processedCanvas: document.createElement('canvas'),
    originalCanvas: document.createElement('canvas'),
    coarseCanvas: document.createElement('canvas'),
    coarse: false,
    settings: freshSettings(),
    auto: { gains: [1, 1, 1], expGain: 1, low: 0, high: 1, median: 0.46 },
    outData: null,
    lastStats: null,
    autoTimer: 0,
    raf: 0,
    split: false,
    splitRatio: 0.5,
    compareHold: false,
    crop: null,
    cropEditing: false,
    cropRect: null,
    cropRatio: 0,
    busy: false,
    queue: [],
    queueIndex: 0,
  };

  /* ---------- 数学工具 ---------- */

  function sampleStep(w, h, budget) {
    return Math.max(1, Math.round(Math.sqrt((w * h) / budget)));
  }

  function percentileFromHist(hist, total, pct) {
    if (!total) return 0;
    const target = (total * pct) / 100;
    let acc = 0;
    for (let i = 0; i < 256; i++) {
      acc += hist[i];
      if (acc >= target) return i;
    }
    return 255;
  }

  function lumaHistogram(data, w, h, step) {
    const hist = new Uint32Array(256);
    let total = 0;
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const i = (y * w + x) * 4;
        const L = (data[i] * 54 + data[i + 1] * 183 + data[i + 2] * 19) >> 8;
        hist[L]++;
        total++;
      }
    }
    return { hist, total };
  }

  /* ---------- 白平衡估计 ---------- */

  function grayWorldGains(data, w, h, step) {
    let sr = 0, sg = 0, sb = 0, n = 0;
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const i = (y * w + x) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        if (r > 249 || g > 249 || b > 249) continue;
        if (r + g + b < 18) continue;
        sr += SRGB_TO_LIN[r];
        sg += SRGB_TO_LIN[g];
        sb += SRGB_TO_LIN[b];
        n++;
      }
    }
    if (!n) return [1, 1, 1];
    const mr = sr / n, mg = sg / n, mb = sb / n;
    return [mg / mr, 1, mg / mb];
  }

  function estimateWhiteBalance(a, st) {
    const s = st || state.settings;
    if (!s.wbEnabled) return [1, 1, 1];

    const { data, w, h } = a;
    const step = sampleStep(w, h, 220000);
    let gains = [1, 1, 1];

    if (s.wbMethod === 'grayworld') {
      gains = grayWorldGains(data, w, h, step);
    } else if (s.wbMethod === 'whitepatch') {
      const hr = new Uint32Array(256);
      const hg = new Uint32Array(256);
      const hb = new Uint32Array(256);
      let total = 0;
      for (let y = 0; y < h; y += step) {
        for (let x = 0; x < w; x += step) {
          const i = (y * w + x) * 4;
          const r = data[i], g = data[i + 1], b = data[i + 2];
          if (r > 249 || g > 249 || b > 249) continue;
          hr[r]++; hg[g]++; hb[b]++;
          total++;
        }
      }
      if (total > 0) {
        const pr = SRGB_TO_LIN[percentileFromHist(hr, total, 99.5)];
        const pg = SRGB_TO_LIN[percentileFromHist(hg, total, 99.5)];
        const pb = SRGB_TO_LIN[percentileFromHist(hb, total, 99.5)];
        if (pr > 1e-4 && pb > 1e-4) gains = [pg / pr, 1, pg / pb];
      }
    } else if (s.wbMethod === 'shades') {
      let sr = 0, sg = 0, sb = 0;
      for (let y = 0; y < h; y += step) {
        for (let x = 0; x < w; x += step) {
          const i = (y * w + x) * 4;
          const r = data[i], g = data[i + 1], b = data[i + 2];
          if (r > 249 || g > 249 || b > 249) continue;
          const lr = SRGB_TO_LIN[r], lg = SRGB_TO_LIN[g], lb = SRGB_TO_LIN[b];
          sr += lr * lr * lr * lr * lr * lr;
          sg += lg * lg * lg * lg * lg * lg;
          sb += lb * lb * lb * lb * lb * lb;
        }
      }
      if (sr > 0 && sb > 0) {
        gains = [Math.pow(sg / sr, 1 / 6), 1, Math.pow(sg / sb, 1 / 6)];
      }
    } else if (s.wbMethod === 'adaptive') {
      const { hist, total } = lumaHistogram(data, w, h, step);
      const threshold = percentileFromHist(hist, total, 60);
      let sr = 0, sg = 0, sb = 0, n = 0;
      for (let y = 0; y < h; y += step) {
        for (let x = 0; x < w; x += step) {
          const i = (y * w + x) * 4;
          const r = data[i], g = data[i + 1], b = data[i + 2];
          const L = (r * 54 + g * 183 + b * 19) >> 8;
          if (L < threshold) continue;
          const mx = Math.max(r, g, b);
          const mn = Math.min(r, g, b);
          if (mx - mn > 42) continue;
          if (mx > 249) continue;
          sr += SRGB_TO_LIN[r];
          sg += SRGB_TO_LIN[g];
          sb += SRGB_TO_LIN[b];
          n++;
        }
      }
      if (n >= total * 0.002) {
        const mr = sr / n, mg = sg / n, mb = sb / n;
        gains = [mg / mr, 1, mg / mb];
      } else {
        gains = grayWorldGains(data, w, h, step);
      }
    }

    const strength = s.wbStrength;
    return gains.map((g) => {
      const cg = clamp(g, 0.34, 3);
      return clamp(1 + (cg - 1) * strength, 0.34, 3);
    });
  }

  /* ---------- 自动曝光 / 色阶估计 ---------- */

  function estimateExposure(a, gains, st) {
    const s = st || state.settings;
    if (!s.expEnabled) return 1;
    const { data, w, h } = a;
    const step = sampleStep(w, h, 220000);
    const hist = new Uint32Array(256);
    let total = 0;
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const i = (y * w + x) * 4;
        const lr = SRGB_TO_LIN[data[i]] * gains[0];
        const lg = SRGB_TO_LIN[data[i + 1]] * gains[1];
        const lb = SRGB_TO_LIN[data[i + 2]] * gains[2];
        const L = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
        hist[(linToSrgb(L) * 255) | 0]++;
        total++;
      }
    }
    const medLin = SRGB_TO_LIN[percentileFromHist(hist, total, 50)];
    const medGain = clamp(s.target / Math.max(medLin, 0.0008), 0.25, 4);
    /* 高光保护：增益后 P99.9 亮度不得超过 0.98，防止大增益把大片高光推成死白 */
    const hiLin = SRGB_TO_LIN[percentileFromHist(hist, total, 99.9)];
    const capGain = hiLin > 1e-3 ? clamp(0.98 / hiLin, 0.25, 4) : 4;
    return Math.min(medGain, capGain);
  }

  function estimateLevels(a, gains, expGain, st) {
    const s = st || state.settings;
    const { data, w, h } = a;
    const step = sampleStep(w, h, 220000);
    const hist = new Uint32Array(256);
    let total = 0;
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const i = (y * w + x) * 4;
        const lr = clamp(SRGB_TO_LIN[data[i]] * gains[0] * expGain, 0, 1);
        const lg = clamp(SRGB_TO_LIN[data[i + 1]] * gains[1] * expGain, 0, 1);
        const lb = clamp(SRGB_TO_LIN[data[i + 2]] * gains[2] * expGain, 0, 1);
        const L = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
        hist[(linToSrgb(L) * 255) | 0]++;
        total++;
      }
    }
    let low = percentileFromHist(hist, total, s.lowPct) / 255;
    let high = percentileFromHist(hist, total, 100 - s.highPct) / 255;
    if (high - low < 0.08) high = Math.min(1, low + 0.08);
    const median = percentileFromHist(hist, total, 50) / 255;
    return { low, high, median };
  }

  /* ---------- 色彩平衡 / 色相饱和度 / 可选颜色 ----------
     三个算法均移植自开源项目 PhotoCraft（MIT OR Apache-2.0），
     crate 路径 crates/compose/src/adjust/color.rs，按 Photoshop 实测对齐。 */

  function anyNonZero(arr) {
    for (let i = 0; i < arr.length; i++) if (arr[i] !== 0) return true;
    return false;
  }

  /* 色彩平衡：阴影 / 中间调 / 高光各自给 RGB 通道偏移，逐通道生成 256 级曲线 */
  function balanceCurve(tones, preserve, ch) {
    const t = tones.map((row) => row.map((v) => clamp(v, -100, 100)));
    const maxOf = (row) => Math.max(row[0], row[1], row[2]);
    const minOf = (row) => Math.min(row[0], row[1], row[2]);
    const [shadows, midtones, highlights] = t;
    let black;
    let white;
    let m;
    if (preserve) {
      black = maxOf(shadows) - shadows[ch];
      white = highlights[ch] - minOf(highlights);
      m = midtones[ch] - (maxOf(midtones) + minOf(midtones)) / 2;
    } else {
      black = Math.max(-shadows[ch], 0);
      white = Math.max(highlights[ch], 0);
      m = midtones[ch] + (shadows[ch] + highlights[ch]) / 2;
    }
    const gamma = Math.pow(2, m / 100);
    const e = 1 / Math.max(gamma, 0.01);
    let knee = null;
    if (gamma > 1) {
      const s0 = Math.pow(2, gamma);
      const u0 = Math.min(2 * Math.pow(s0, 1 / (e - 1)), 1);
      if (isFinite(u0) && u0 > 0) {
        knee = { u0, s0, p: Math.pow(u0, e), d: e * Math.pow(u0, e - 1) };
      }
    }
    const b = black / 255;
    const w = 1 - white / 255;
    return (v) => {
      if (v >= w) return 1;
      if (v <= b) return 0;
      const u = (v - b) / (w - b);
      if (knee && u < knee.u0) {
        const tt = u / knee.u0;
        const t2 = tt * tt;
        const t3 = t2 * tt;
        return clamp(
          (t3 - 2 * t2 + tt) * knee.u0 * knee.s0 +
            (3 * t2 - 2 * t3) * knee.p +
            (t3 - t2) * knee.u0 * knee.d,
          0,
          1
        );
      }
      return Math.pow(u, e);
    };
  }

  function buildBalanceLuts(s) {
    const tones = [s.cbShadows, s.cbMidtones, s.cbHighlights];
    return [0, 1, 2].map((ch) => {
      const curve = balanceCurve(tones, s.cbPreserve, ch);
      const lut = new Float32Array(256);
      for (let v = 0; v < 256; v++) lut[v] = curve(v / 255);
      return lut;
    });
  }

  /* 色相 / 饱和度：Photoshop 的 6 段色相范围（全开 30°，两侧各淡出 30°） */
  const HUE_TABLE_SIZE = 512;

  function hueRangeWeight(bounds, deg) {
    const rel = (x) => (((x - bounds[0]) % 360) + 360) % 360;
    const b = rel(bounds[1]);
    const c = Math.max(rel(bounds[2]), b);
    const d = Math.max(rel(bounds[3]), c);
    const h = rel(deg);
    if (h <= b) return b <= 0 ? 1 : h / b;
    if (h <= c) return 1;
    if (h <= d) return d <= c ? 1 : (d - h) / (d - c);
    return 0;
  }

  function buildHueTables(ranges) {
    const tables = [new Float32Array(HUE_TABLE_SIZE), new Float32Array(HUE_TABLE_SIZE), new Float32Array(HUE_TABLE_SIZE)];
    let any = false;
    for (let i = 0; i < 6; i++) {
      const r = ranges[i];
      if (!anyNonZero(r)) continue;
      any = true;
      const centre = 60 * i;
      const bounds = [centre - 45, centre - 15, centre + 15, centre + 45];
      for (let k = 0; k < HUE_TABLE_SIZE; k++) {
        const deg = (k / (HUE_TABLE_SIZE - 1)) * 360;
        const wgt = hueRangeWeight(bounds, deg);
        if (!wgt) continue;
        tables[0][k] += wgt * r[0];
        tables[1][k] += wgt * (r[1] / 100);
        tables[2][k] += wgt * (r[2] / 100);
      }
    }
    return any ? tables : null;
  }

  const HSL_OUT = new Float32Array(3);

  function hueSatPixel(r, g, b, tables, hueDeg, satPct, lightPct, out) {
    const light = clamp(lightPct / 100, -1, 1);
    let dh = 0;
    let ds = 0;
    let dl = 0;
    if (tables) {
      /* 色相范围权重按「明度调整前」的原始色相查表 */
      const mx = r > g ? (r > b ? r : b) : g > b ? g : b;
      const mn = r < g ? (r < b ? r : b) : g < b ? g : b;
      const d0 = mx - mn;
      let h0 = 0;
      if (d0 > 1e-7) {
        if (mx === r) h0 = ((((g - b) / d0) % 6) + 6) % 6 / 6;
        else if (mx === g) h0 = ((b - r) / d0 + 2) / 6;
        else h0 = ((r - g) / d0 + 4) / 6;
      }
      const k = Math.min(HUE_TABLE_SIZE - 1, (h0 * (HUE_TABLE_SIZE - 1) + 0.5) | 0);
      dh = tables[0][k];
      ds = tables[1][k];
      dl = tables[2][k];
    }
    let r1 = r;
    let g1 = g;
    let b1 = b;
    if (light > 0) {
      r1 = r + (1 - r) * light;
      g1 = g + (1 - g) * light;
      b1 = b + (1 - b) * light;
    } else if (light < 0) {
      r1 = r * (1 + light);
      g1 = g * (1 + light);
      b1 = b * (1 + light);
    }

    /* RGB → HSL（内联，避免逐像素函数调用开销） */
    const mx = r1 > g1 ? (r1 > b1 ? r1 : b1) : g1 > b1 ? g1 : b1;
    const mn = r1 < g1 ? (r1 < b1 ? r1 : b1) : g1 < b1 ? g1 : b1;
    const l = (mx + mn) / 2;
    const d = mx - mn;
    let hh = 0;
    let ss = 0;
    if (d > 1e-7) {
      ss = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r1) hh = ((((g1 - b1) / d) % 6) + 6) % 6 / 6;
      else if (mx === g1) hh = ((b1 - r1) / d + 2) / 6;
      else hh = ((r1 - g1) / d + 4) / 6;
    }
    hh = (hh + (hueDeg + dh) / 360) % 1;
    if (hh < 0) hh += 1;
    const sum = clamp(satPct / 100 + ds, -1, 1);
    ss = clamp(sum > 0 ? ss / Math.max(1 - sum, 1 / 512) : ss * (1 + sum), 0, 1);

    /* HSL → RGB（内联） */
    if (ss <= 0) {
      out[0] = l;
      out[1] = l;
      out[2] = l;
    } else {
      const q = l < 0.5 ? l * (1 + ss) : l + ss - l * ss;
      const p = 2 * l - q;
      for (let c = 0; c < 3; c++) {
        let t = c === 0 ? hh + 1 / 3 : c === 1 ? hh : hh - 1 / 3;
        t -= Math.floor(t);
        out[c] = t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
      }
    }
    if (dl) {
      const amt = clamp(dl, -1, 1);
      const target = amt > 0 ? Math.max(out[0], out[1], out[2]) : Math.min(out[0], out[1], out[2]);
      const f = Math.abs(amt);
      out[0] += (target - out[0]) * f;
      out[1] += (target - out[1]) * f;
      out[2] += (target - out[2]) * f;
    }
  }

  /* 可选颜色：9 个色系 × CMYK 油墨偏移，按色度 / 亮度权重混合 */
  function buildSelectiveConfig(adj, relative) {
    const ranges = [];
    for (let i = 0; i < 9; i++) {
      const a = adj[i];
      const dR = (a[0] + a[3]) / 100;
      const dG = (a[1] + a[3]) / 100;
      const dB = (a[2] + a[3]) / 100;
      if (dR || dG || dB) ranges.push([i, dR, dG, dB]);
    }
    return ranges.length ? { ranges, relative } : null;
  }

  function selectiveColorPixel(r, g, b, conf, out) {
    const ranges = conf.ranges;
    const relative = conf.relative;
    const max = r > g ? (r > b ? r : b) : g > b ? g : b;
    const min = r < g ? (r < b ? r : b) : g < b ? g : b;
    const mid = r + g + b - max - min;
    const inkR = 1 - r;
    const inkG = 1 - g;
    const inkB = 1 - b;
    let dr = 0;
    let dg = 0;
    let db = 0;
    for (let k = 0; k < ranges.length; k++) {
      const item = ranges[k];
      let wgt;
      switch (item[0]) {
        case 0: wgt = r >= max ? max - mid : 0; break;
        case 1: wgt = b <= min ? mid - min : 0; break;
        case 2: wgt = g >= max ? max - mid : 0; break;
        case 3: wgt = r <= min ? mid - min : 0; break;
        case 4: wgt = b >= max ? max - mid : 0; break;
        case 5: wgt = g <= min ? mid - min : 0; break;
        case 6: wgt = Math.max((min - 0.5) * 2, 0); break;
        case 7: wgt = clamp(1 - Math.abs(max - 0.5) - Math.abs(min - 0.5), 0, 1); break;
        default: wgt = Math.max((0.5 - max) * 2, 0);
      }
      if (wgt <= 0) continue;
      const dR = item[1];
      const dG = item[2];
      const dB = item[3];
      dr +=
        (relative ? dR * inkR : dR > 0 ? dR * Math.min(2 * (1 - inkR), 1) : dR * Math.min(2 * inkR, 1)) * wgt;
      dg +=
        (relative ? dG * inkG : dG > 0 ? dG * Math.min(2 * (1 - inkG), 1) : dG * Math.min(2 * inkG, 1)) * wgt;
      db +=
        (relative ? dB * inkB : dB > 0 ? dB * Math.min(2 * (1 - inkB), 1) : dB * Math.min(2 * inkB, 1)) * wgt;
    }
    out[0] = clamp(r - dr, 0, 1);
    out[1] = clamp(g - dg, 0, 1);
    out[2] = clamp(b - db, 0, 1);
  }

  /* ---------- 像素处理 ---------- */


  function processPixels(src, dst, w, h, s, auto) {
    const wb = auto.gains;
    const exp = auto.expGain * Math.pow(2, s.ev);
    const lutR = new Float32Array(256);
    const lutG = new Float32Array(256);
    const lutB = new Float32Array(256);
    const luts = [lutR, lutG, lutB];
    for (let c = 0; c < 3; c++) {
      const lut = luts[c];
      const peak = wb[c] * exp;
      const over = peak - 1;
      const w = over > 0 ? Math.min(1, over / 0.15) : 0;
      const knee = 0.75;
      const iknee = 1 - knee;
      for (let v = 0; v < 256; v++) {
        let lin = SRGB_TO_LIN[v] * peak;
        /* 高光软肩：增益超出白点时渐进压缩高光，保留白色区层次而非硬裁剪 */
        if (w > 0 && lin > knee) {
          const sh = knee + iknee * (1 - Math.exp(-(lin - knee) / iknee));
          lin = lin * (1 - w) + sh * w;
          if (lin > 0.98) lin = 0.98 + 0.02 * (1 - Math.exp(-(lin - 0.98) / 0.02));
        }
        lut[v] = linToSrgb(lin);
      }
    }

    const low = s.low;
    const high = s.high;
    const invRange = 1 / Math.max(0.02, high - low);
    const invGamma = 1 / Math.max(0.2, s.gamma);
    const gammaLut = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) gammaLut[i] = Math.pow(i / 1023, invGamma);
    const sat = s.saturation;
    const useGamma = Math.abs(invGamma - 1) > 1e-4;
    const useSat = Math.abs(sat - 1) > 1e-4;

    /* 三个色彩调整按 色彩平衡 → 色相/饱和度 → 可选颜色 的顺序叠加 */
    const cbLuts =
      s.cbEnabled && [s.cbShadows, s.cbMidtones, s.cbHighlights].some(anyNonZero)
        ? buildBalanceLuts(s)
        : null;
    const hsTables = s.hsEnabled ? buildHueTables(s.hsRanges) : null;
    const hsOn = s.hsEnabled && (hsTables !== null || s.hsHue !== 0 || s.hsSat !== 0 || s.hsLight !== 0);
    const scConf = s.scEnabled ? buildSelectiveConfig(s.scAdjust, s.scRelative) : null;
    const scOn = scConf !== null;

    const histR = new Uint32Array(256);
    const histG = new Uint32Array(256);
    const histB = new Uint32Array(256);
    const histL = new Uint32Array(256);
    let clipLo = 0;
    let clipHi = 0;

    const total = w * h;
    for (let p = 0, i = 0; p < total; p++, i += 4) {
      let r = lutR[src[i]];
      let g = lutG[src[i + 1]];
      let b = lutB[src[i + 2]];
      const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;

      let t = (L - low) * invRange;
      if (t <= 0) t = 0;
      else if (t >= 1) t = 1;
      if (useGamma && t > 0) t = gammaLut[(t * 1023) | 0];

      let ratio;
      if (L > 1e-4) ratio = t / L;
      else ratio = t > 0 ? 16 : 0;
      if (ratio > 16) ratio = 16;

      r *= ratio;
      g *= ratio;
      b *= ratio;

      if (useSat) {
        const L2 = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        r = L2 + (r - L2) * sat;
        g = L2 + (g - L2) * sat;
        b = L2 + (b - L2) * sat;
      }

      if (cbLuts || hsOn || scOn) {
        let fr = clamp(r, 0, 1);
        let fg = clamp(g, 0, 1);
        let fb = clamp(b, 0, 1);
        if (cbLuts) {
          fr = cbLuts[0][(fr * 255 + 0.5) | 0];
          fg = cbLuts[1][(fg * 255 + 0.5) | 0];
          fb = cbLuts[2][(fb * 255 + 0.5) | 0];
        }
        if (hsOn) {
          hueSatPixel(fr, fg, fb, hsTables, s.hsHue, s.hsSat, s.hsLight, HSL_OUT);
          fr = HSL_OUT[0];
          fg = HSL_OUT[1];
          fb = HSL_OUT[2];
        }
        if (scOn) {
          selectiveColorPixel(fr, fg, fb, scConf, HSL_OUT);
          fr = HSL_OUT[0];
          fg = HSL_OUT[1];
          fb = HSL_OUT[2];
        }
        r = fr;
        g = fg;
        b = fb;
      }

      const ri = clamp((r * 255 + 0.5) | 0, 0, 255);
      const gi = clamp((g * 255 + 0.5) | 0, 0, 255);
      const bi = clamp((b * 255 + 0.5) | 0, 0, 255);

      dst[i] = ri;
      dst[i + 1] = gi;
      dst[i + 2] = bi;
      dst[i + 3] = src[i + 3];

      histR[ri]++;
      histG[gi]++;
      histB[bi]++;
      const L8 = (ri * 54 + gi * 183 + bi * 19) >> 8;
      const L8c = L8 > 255 ? 255 : L8;
      histL[L8c]++;
      if (ri >= 254 || gi >= 254 || bi >= 254) clipHi++;
      if (ri <= 1 && gi <= 1 && bi <= 1) clipLo++;
    }

    const median = percentileFromHist(histL, total, 50) / 255;
    return {
      histR,
      histG,
      histB,
      histL,
      total,
      median,
      clipLo: (clipLo / total) * 100,
      clipHi: (clipHi / total) * 100,
    };
  }

  /* ---------- 图片加载与分析 ---------- */

  async function decodeNative(file) {
    if (window.createImageBitmap) {
      try {
        return await createImageBitmap(file, { imageOrientation: 'from-image' });
      } catch (e) {
        try {
          return await createImageBitmap(file);
        } catch (e2) {
          /* 回退到 img */
        }
      }
    }
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('decode failed'));
      };
      img.src = url;
    });
  }

  /* 浏览器原生不支持 TIFF，用 UTIF 解码成位图 */
  async function decodeTiff(file) {
    if (typeof UTIF === 'undefined') throw new Error('TIFF codec is unavailable');
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const isTiff =
      (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a) ||
      (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a);
    if (!isTiff) throw new Error('decode failed');
    const ifds = UTIF.decode(buffer);
    if (!ifds.length) throw new Error('decode failed');
    UTIF.decodeImage(buffer, ifds[0], ifds);
    const rgba = UTIF.toRGBA8(ifds[0]);
    const w = ifds[0].width;
    const h = ifds[0].height;
    const cnv = document.createElement('canvas');
    cnv.width = w;
    cnv.height = h;
    const ctx = cnv.getContext('2d');
    const imgData = ctx.createImageData(w, h);
    imgData.data.set(rgba);
    ctx.putImageData(imgData, 0, 0);
    return createImageBitmap(cnv);
  }

  async function decodeFile(file) {
    try {
      return await decodeNative(file);
    } catch (err) {
      /* 原生解码失败时再走 TIFF 兜底，其他格式仍然报错 */
      return decodeTiff(file).catch(() => {
        throw err;
      });
    }
  }

  /* 当前裁剪区域（原图像素，编辑裁剪时视为未裁剪） */
  function cropPx() {
    if (!state.crop || state.cropEditing || !state.sourceW || !state.sourceH) return null;
    const x = Math.round(state.crop.x * state.sourceW);
    const y = Math.round(state.crop.y * state.sourceH);
    const w = Math.max(1, Math.min(state.sourceW - x, Math.round(state.crop.w * state.sourceW)));
    const h = Math.max(1, Math.min(state.sourceH - y, Math.round(state.crop.h * state.sourceH)));
    return { x, y, w, h };
  }

  function buildAnalysis() {
    const rect = cropPx();
    const w = rect ? rect.w : state.sourceW;
    const h = rect ? rect.h : state.sourceH;
    const scale = Math.min(1, 720 / Math.max(w, h));
    const aw = Math.max(1, Math.round(w * scale));
    const ah = Math.max(1, Math.round(h * scale));
    const c = document.createElement('canvas');
    c.width = aw;
    c.height = ah;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(state.source, rect ? rect.x : 0, rect ? rect.y : 0, w, h, 0, 0, aw, ah);
    const img = ctx.getImageData(0, 0, aw, ah);
    state.analysis = { w: aw, h: ah, data: img.data };
    const luma = lumaHistogram(img.data, aw, ah, 1);
    state.histBefore = luma.hist;
    state.beforeMedian = percentileFromHist(luma.hist, luma.total, 50) / 255;
  }

  /* 为任意图片生成分析数据，不修改当前编辑状态 */
  function analyzeSource(src, w, h) {
    const scale = Math.min(1, 720 / Math.max(w, h));
    const aw = Math.max(1, Math.round(w * scale));
    const ah = Math.max(1, Math.round(h * scale));
    const c = document.createElement('canvas');
    c.width = aw;
    c.height = ah;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(src, 0, 0, aw, ah);
    const img = ctx.getImageData(0, 0, aw, ah);
    return { w: aw, h: ah, data: img.data };
  }

  function buildPreview() {
    const rect = cropPx();
    const w = rect ? rect.w : state.sourceW;
    const h = rect ? rect.h : state.sourceH;
    const scale = Math.min(1, 1500 / Math.max(w, h));
    const pw = Math.max(1, Math.round(w * scale));
    const ph = Math.max(1, Math.round(h * scale));
    const c = document.createElement('canvas');
    c.width = pw;
    c.height = ph;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(state.source, rect ? rect.x : 0, rect ? rect.y : 0, w, h, 0, 0, pw, ph);
    const img = ctx.getImageData(0, 0, pw, ph);
    state.preview = { w: pw, h: ph, data: img.data };

    state.originalCanvas.width = pw;
    state.originalCanvas.height = ph;
    state.originalCanvas.getContext('2d').putImageData(img, 0, 0);

    state.processedCanvas.width = pw;
    state.processedCanvas.height = ph;
    state.outData = null;

    const view = $('view-canvas');
    view.width = pw;
    view.height = ph;
    $('canvas-wrap').style.aspectRatio = pw + ' / ' + ph;

    $('info-size').textContent = state.sourceW + ' × ' + state.sourceH;
    $('info-preview').textContent = pw + ' × ' + ph;
    $('file-tag').textContent = '已载入';
    $('file-name').textContent =
      state.name + ' · ' + (state.sourceW * state.sourceH / 1e6).toFixed(1) + ' MP' + (state.crop ? ' · 已裁剪' : '');
  }

  /* ---------- 自动分析 ---------- */

  function runAuto() {
    if (!state.analysis) return;
    const s = state.settings;
    const gains = estimateWhiteBalance(state.analysis);
    const expGain = estimateExposure(state.analysis, gains);
    const levels = estimateLevels(state.analysis, gains, expGain);

    state.auto.gains = gains;
    state.auto.expGain = expGain;
    state.auto.low = levels.low;
    state.auto.high = levels.high;
    state.auto.median = levels.median;

    if (s.autoLevels) {
      s.low = levels.low;
      s.high = levels.high;
    }

    syncAutoUi();
    scheduleRender();
  }

  function scheduleAuto() {
    clearTimeout(state.autoTimer);
    state.autoTimer = setTimeout(runAuto, 70);
  }

  function formatEv(v) {
    if (!isFinite(v)) return '—';
    return (v >= 0 ? '+' : '') + v.toFixed(2) + ' EV';
  }

  function syncAutoUi() {
    const s = state.settings;
    const g = state.auto.gains;
    $('gain-r').textContent = g[0].toFixed(2);
    $('gain-g').textContent = g[1].toFixed(2);
    $('gain-b').textContent = g[2].toFixed(2);
    $('auto-exp').textContent = s.expEnabled
      ? formatEv(Math.log2(state.auto.expGain))
      : '已关闭';
    $('wb-note').textContent = WB_NOTES[s.wbMethod] || '';
    syncLevelInputs();
  }

  function syncLevelInputs() {
    const s = state.settings;
    const lowEl = $('low-point');
    const highEl = $('high-point');
    lowEl.value = Math.round(s.low * 255);
    highEl.value = Math.round(s.high * 255);
    lowEl.disabled = s.autoLevels;
    highEl.disabled = s.autoLevels;
    $('low-val').textContent = lowEl.value;
    $('high-val').textContent = highEl.value;
    $('auto-levels').checked = s.autoLevels;
    $('level-info').textContent =
      '黑场 ' + lowEl.value + ' · 白场 ' + highEl.value;
  }

  /* ---------- 渲染 ---------- */

  function scheduleRender() {
    if (state.raf) return;
    state.raf = requestAnimationFrame(() => {
      state.raf = 0;
      render();
    });
  }

  function render() {
    if (!state.preview) return;
    const t0 = performance.now();
    const { w, h, data } = state.preview;
    const pc = state.processedCanvas;
    const ctx = pc.getContext('2d', { willReadFrequently: true });
    let stats;
    if (state.coarse && w * h > 300000) {
      /* 拖动色彩滑块时先按低分辨率出图，松手后再跑全分辨率 */
      const scale = Math.min(1, 840 / Math.max(w, h));
      const cw = Math.max(1, Math.round(w * scale));
      const ch = Math.max(1, Math.round(h * scale));
      const cc = state.coarseCanvas;
      if (cc.width !== cw || cc.height !== ch) {
        cc.width = cw;
        cc.height = ch;
      }
      const cctx = cc.getContext('2d', { willReadFrequently: true });
      cctx.clearRect(0, 0, cw, ch);
      cctx.drawImage(state.originalCanvas, 0, 0, cw, ch);
      const img = cctx.getImageData(0, 0, cw, ch);
      stats = processPixels(img.data, img.data, cw, ch, state.settings, state.auto);
      cctx.putImageData(img, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(cc, 0, 0, w, h);
    } else {
      if (!state.outData || state.outData.width !== w || state.outData.height !== h) {
        state.outData = ctx.createImageData(w, h);
      }
      const out = state.outData;
      stats = processPixels(data, out.data, w, h, state.settings, state.auto);
      ctx.putImageData(out, 0, 0);
    }
    state.lastStats = stats;

    drawFrame();
    drawHistogram(stats);

    const ms = performance.now() - t0;
    $('info-duration').textContent = ms.toFixed(0) + ' ms';
    $('hist-stats').textContent =
      '原图中位 ' + Math.round(state.beforeMedian * 100) + '% → 处理后 ' +
      Math.round(stats.median * 100) + '% · 暗部裁切 ' + stats.clipLo.toFixed(2) +
      '% · 高光裁切 ' + stats.clipHi.toFixed(2) + '%';
  }

  function drawFrame() {
    if (!state.preview) return;
    const view = $('view-canvas');
    const ctx = view.getContext('2d');
    const w = view.width;
    const h = view.height;
    ctx.clearRect(0, 0, w, h);

    if (state.compareHold || !state.split) {
      const layer = state.compareHold ? state.originalCanvas : state.processedCanvas;
      ctx.drawImage(layer, 0, 0);
      return;
    }

    ctx.drawImage(state.originalCanvas, 0, 0);
    const sx = Math.round(w * state.splitRatio);
    if (sx < w) {
      ctx.drawImage(state.processedCanvas, sx, 0, w - sx, h, sx, 0, w - sx, h);
    }
  }

  function updateView() {
    drawFrame();
    const line = $('split-line');
    line.hidden = !state.split;
    if (state.split) {
      line.style.left = (state.splitRatio * 100).toFixed(2) + '%';
    }
  }

  function drawHistogram(stats) {
    const canvas = $('hist');
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.max(240, Math.round(rect.width || 480));
    const ch = 132;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    const styles = getComputedStyle(document.documentElement);
    const colR = styles.getPropertyValue('--r').trim() || '#d9534f';
    const colG = styles.getPropertyValue('--g').trim() || '#4f9d69';
    const colB = styles.getPropertyValue('--b').trim() || '#4d7fd0';
    const colInk = styles.getPropertyValue('--ink-soft').trim() || '#6f6d66';
    const colLine = styles.getPropertyValue('--line').trim() || '#e2e0d8';
    const colAccent = styles.getPropertyValue('--accent').trim() || '#b3552e';

    const padTop = 8;
    const padBottom = 6;
    const plotH = ch - padTop - padBottom;

    ctx.strokeStyle = colLine;
    ctx.lineWidth = 1;
    for (let g = 1; g < 4; g++) {
      const x = (cw * g) / 4;
      ctx.beginPath();
      ctx.moveTo(x, padTop);
      ctx.lineTo(x, ch - padBottom);
      ctx.stroke();
    }

    let max = 1;
    const series = [stats.histR, stats.histG, stats.histB, stats.histL];
    for (const hist of series) {
      for (let i = 0; i < 256; i++) if (hist[i] > max) max = hist[i];
    }
    if (state.histBefore) {
      for (let i = 0; i < 256; i++) if (state.histBefore[i] > max) max = state.histBefore[i];
    }

    function plot(hist, color, alpha, fill) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(0, ch - padBottom);
      for (let i = 0; i < 256; i++) {
        const v = hist[i] / max;
        const hgt = Math.sqrt(v) * plotH;
        const x = (i / 255) * cw;
        ctx.lineTo(x, ch - padBottom - hgt);
      }
      ctx.lineTo(cw, ch - padBottom);
      ctx.closePath();
      if (fill) {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        ctx.fill();
      } else {
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      ctx.restore();
    }

    ctx.globalCompositeOperation = 'lighter';
    plot(stats.histR, colR, 0.42, true);
    plot(stats.histG, colG, 0.42, true);
    plot(stats.histB, colB, 0.42, true);
    ctx.globalCompositeOperation = 'source-over';

    plot(stats.histL, colInk, 0.85, false);

    if (state.histBefore) {
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      for (let i = 0; i < 256; i++) {
        const v = state.histBefore[i] / max;
        const hgt = Math.sqrt(v) * plotH;
        const x = (i / 255) * cw;
        if (i === 0) ctx.moveTo(x, ch - padBottom - hgt);
        else ctx.lineTo(x, ch - padBottom - hgt);
      }
      ctx.strokeStyle = colInk;
      ctx.globalAlpha = 0.38;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }

    const lowX = state.settings.low * cw;
    const highX = state.settings.high * cw;
    ctx.save();
    ctx.strokeStyle = colAccent;
    ctx.globalAlpha = 0.65;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(lowX, padTop);
    ctx.lineTo(lowX, ch - padBottom);
    ctx.moveTo(highX, padTop);
    ctx.lineTo(highX, ch - padBottom);
    ctx.stroke();
    ctx.restore();
  }

  /* ---------- 导出 ---------- */

  function baseName(name) {
    return (name || 'image').replace(/\.[^.]+$/, '');
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  /* 导出格式与 film-autoclip 保持一致：跟随原图 / JPEG / PNG / WEBP / BMP / TIFF */
  const EXPORT_FORMATS = {
    'image/jpeg': { ext: 'jpg', mime: 'image/jpeg' },
    'image/png': { ext: 'png', mime: 'image/png' },
    'image/webp': { ext: 'webp', mime: 'image/webp' },
    'image/bmp': { ext: 'bmp', mime: 'image/bmp', isBmp: true },
    'image/tiff': { ext: 'tif', mime: 'image/tiff', isTiff: true },
  };

  function sourceFormatFrom(file) {
    const name = ((file && file.name) || state.name || '').toLowerCase();
    const type = ((file && file.type) || '').toLowerCase();
    const ext = name.includes('.') ? name.split('.').pop() : '';
    if (type === 'image/png' || ext === 'png') return EXPORT_FORMATS['image/png'];
    if (type === 'image/webp' || ext === 'webp') return EXPORT_FORMATS['image/webp'];
    if (['image/bmp', 'image/x-bmp', 'image/x-ms-bmp'].includes(type) || ext === 'bmp') {
      return EXPORT_FORMATS['image/bmp'];
    }
    if (type === 'image/tiff' || ext === 'tif' || ext === 'tiff') return EXPORT_FORMATS['image/tiff'];
    return EXPORT_FORMATS['image/jpeg'];
  }

  function resolveExportFormat(choice, file) {
    return choice === 'original' ? sourceFormatFrom(file) : (EXPORT_FORMATS[choice] || EXPORT_FORMATS['image/jpeg']);
  }

  function encodeBmpCanvas(canvas) {
    const width = canvas.width;
    const height = canvas.height;
    const rowStride = Math.ceil((width * 3) / 4) * 4;
    const pixelBytes = rowStride * height;
    const headerBytes = 54;
    const fileSize = headerBytes + pixelBytes;
    if (!width || !height || !Number.isSafeInteger(fileSize) || fileSize > 0xffffffff) {
      throw new Error('BMP 输出尺寸过大');
    }
    const rgba = canvas.getContext('2d').getImageData(0, 0, width, height).data;
    const output = new Uint8Array(fileSize);
    const view = new DataView(output.buffer);
    output[0] = 0x42;
    output[1] = 0x4d;
    view.setUint32(2, fileSize, true);
    view.setUint32(10, headerBytes, true);
    view.setUint32(14, 40, true);
    view.setInt32(18, width, true);
    view.setInt32(22, height, true);
    view.setUint16(26, 1, true);
    view.setUint16(28, 24, true);
    view.setUint32(34, pixelBytes, true);
    view.setInt32(38, 2835, true);
    view.setInt32(42, 2835, true);
    for (let outputY = 0; outputY < height; outputY += 1) {
      const sourceY = height - outputY - 1;
      const rowOffset = headerBytes + outputY * rowStride;
      for (let x = 0; x < width; x += 1) {
        const sourceOffset = (sourceY * width + x) * 4;
        const targetOffset = rowOffset + x * 3;
        output[targetOffset] = rgba[sourceOffset + 2];
        output[targetOffset + 1] = rgba[sourceOffset + 1];
        output[targetOffset + 2] = rgba[sourceOffset];
      }
    }
    return new Blob([output], { type: 'image/bmp' });
  }

  function encodeCanvas(canvas, format) {
    if (format.isBmp) return Promise.resolve(encodeBmpCanvas(canvas));
    if (format.isTiff) {
      try {
        if (typeof UTIF === 'undefined') throw new Error('TIFF 编码器不可用');
        const rgba = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        return Promise.resolve(new Blob([UTIF.encodeImage(rgba, canvas.width, canvas.height)], { type: 'image/tiff' }));
      } catch (error) {
        return Promise.reject(error);
      }
    }
    return new Promise((resolve) => canvas.toBlob(resolve, format.mime, 0.92));
  }

  function syncBatchButton() {
    const btn = $('btn-batch');
    if (!btn) return;
    const n = state.queue.length;
    btn.textContent = n >= 2 ? '批量导出 ' + n + ' 张' : '批量导出';
    btn.disabled = state.busy || n < 2 || !state.source;
  }

  /* 优先让用户选择目标文件夹（File System Access API），
     不支持时回退为逐张下载。 */
  async function pickBatchDir() {
    if (typeof window.showDirectoryPicker !== 'function') {
      return { supported: false, dir: null };
    }
    try {
      const dir = await window.showDirectoryPicker({ id: 'auto-tone-batch', mode: 'readwrite' });
      return { supported: true, dir };
    } catch (e) {
      return { supported: true, dir: null };
    }
  }

  async function writeToDir(dir, name, blob) {
    const fh = await dir.getFileHandle(name, { create: true });
    const ws = await fh.createWritable();
    await ws.write(blob);
    await ws.close();
  }

  /* 批量导出：当前白平衡算法 / 曝光 / 调色参数作为模板，
     每张图各自重新分析白平衡与色阶后处理，写入所选文件夹。 */
  async function exportBatch() {
    if (state.busy || state.queue.length < 2) return;
    const picked = await pickBatchDir();
    if (picked.supported && !picked.dir) return;
    const dir = picked.dir;
    state.busy = true;
    const btn = $('btn-batch');
    btn.disabled = true;
    const choice = $('export-format').value;
    const template = JSON.parse(JSON.stringify(state.settings));
    let done = 0;
    try {
      for (const item of state.queue) {
        btn.textContent = '处理中 ' + (done + 1) + '/' + state.queue.length;
        await new Promise((r) => setTimeout(r, 20));
        let src = await decodeFile(item.file);
        if (state.crop) {
          const rx = Math.round(state.crop.x * src.width);
          const ry = Math.round(state.crop.y * src.height);
          const rw = Math.max(1, Math.min(src.width - rx, Math.round(state.crop.w * src.width)));
          const rh = Math.max(1, Math.min(src.height - ry, Math.round(state.crop.h * src.height)));
          const cc = document.createElement('canvas');
          cc.width = rw;
          cc.height = rh;
          cc.getContext('2d').drawImage(src, rx, ry, rw, rh, 0, 0, rw, rh);
          src = cc;
        }
        const w = src.width;
        const h = src.height;
        const analysis = analyzeSource(src, w, h);
        const s = JSON.parse(JSON.stringify(template));
        const gains = estimateWhiteBalance(analysis, s);
        const expGain = estimateExposure(analysis, gains, s);
        const levels = estimateLevels(analysis, gains, expGain, s);
        if (s.autoLevels) {
          s.low = levels.low;
          s.high = levels.high;
        }
        const auto = {
          gains,
          expGain,
          low: levels.low,
          high: levels.high,
          median: levels.median,
        };

        const format = resolveExportFormat(choice, item.file);
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        if (format.mime === 'image/jpeg' || format.isBmp) {
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, w, h);
        }
        ctx.drawImage(src, 0, 0, w, h);
        const img = ctx.getImageData(0, 0, w, h);
        processPixels(img.data, img.data, w, h, s, auto);
        ctx.putImageData(img, 0, 0);

        const blob = await encodeCanvas(c, format);
        if (!blob) throw new Error(item.file.name + ' 编码失败');
        const outName = baseName(item.file.name) + '-auto.' + format.ext;
        if (dir) await writeToDir(dir, outName, blob);
        else downloadBlob(blob, outName);
        done++;
        await new Promise((r) => setTimeout(r, 160));
      }
    } catch (e) {
      window.alert('批量导出中断（已完成 ' + done + ' 张）：' + (e && e.message ? e.message : e));
    } finally {
      state.busy = false;
      syncBatchButton();
    }
  }

  async function exportImage() {
    if (!state.source || state.busy) return;
    state.busy = true;
    const btn = $('btn-export');
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = '导出中…';

    await new Promise((r) => setTimeout(r, 30));

    try {
      const rect = cropPx();
      const w = rect ? rect.w : state.sourceW;
      const h = rect ? rect.h : state.sourceH;
      const format = resolveExportFormat($('export-format').value, state.file);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (format.mime === 'image/jpeg' || format.isBmp) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
      }
      ctx.drawImage(state.source, rect ? rect.x : 0, rect ? rect.y : 0, w, h, 0, 0, w, h);
      const img = ctx.getImageData(0, 0, w, h);
      processPixels(img.data, img.data, w, h, state.settings, state.auto);
      ctx.putImageData(img, 0, 0);

      const blob = await encodeCanvas(c, format);
      if (!blob) throw new Error('编码失败');
      downloadBlob(blob, baseName(state.name) + '-auto.' + format.ext);
    } catch (e) {
      window.alert('导出失败：' + (e && e.message ? e.message : e));
    } finally {
      state.busy = false;
      btn.disabled = !state.source;
      btn.textContent = label;
      syncBatchButton();
    }
  }

  /* ---------- 加载与界面 ---------- */

  function setControlsEnabled(on) {
    [
      'btn-compare', 'btn-split', 'btn-reset', 'btn-reset-top',
      'btn-crop', 'btn-zoom', 'btn-reset-all',
      'btn-export', 'export-format',
    ].forEach((id) => {
      $(id).disabled = !on;
    });
    syncBatchButton();
  }

  function updateControls() {
    const s = state.settings;
    $('wb-enabled').checked = s.wbEnabled;
    $('wb-method').value = s.wbMethod;
    $('wb-strength').value = Math.round(s.wbStrength * 100);
    $('wb-strength-val').textContent = Math.round(s.wbStrength * 100) + '%';
    $('exp-enabled').checked = s.expEnabled;
    $('target-luma').value = Math.round(s.target * 100);
    $('target-val').textContent = Math.round(s.target * 100) + '%';
    $('ev').value = s.ev;
    $('ev-val').textContent = s.ev.toFixed(2) + ' EV';
    $('gamma').value = s.gamma;
    $('gamma-val').textContent = s.gamma.toFixed(2);
    $('saturation').value = Math.round(s.saturation * 100);
    $('saturation-val').textContent = Math.round(s.saturation * 100) + '%';
    syncLevelInputs();
    syncColorControls();
    $('wb-note').textContent = WB_NOTES[s.wbMethod] || '';
  }

  /* ---------- 三项色彩调整的界面同步 ---------- */

  function fmtSigned(v, unit) {
    return (v > 0 ? '+' : '') + v + (unit || '');
  }

  function cbToneKey(tone) {
    return tone === 'shadows' ? 'cbShadows' : tone === 'highlights' ? 'cbHighlights' : 'cbMidtones';
  }

  function syncColorControls() {
    const s = state.settings;

    $('cb-enabled').checked = s.cbEnabled;
    $('cb-tone').value = s.cbTone;
    const cb = s[cbToneKey(s.cbTone)];
    $('cb-cr').value = cb[0];
    $('cb-mg').value = cb[1];
    $('cb-yb').value = cb[2];
    $('cb-cr-val').textContent = fmtSigned(cb[0]);
    $('cb-mg-val').textContent = fmtSigned(cb[1]);
    $('cb-yb-val').textContent = fmtSigned(cb[2]);
    $('cb-preserve').checked = s.cbPreserve;

    $('hs-enabled').checked = s.hsEnabled;
    $('hs-target').value = s.hsTarget < 0 ? 'master' : String(s.hsTarget);
    const hs = s.hsTarget < 0 ? [s.hsHue, s.hsSat, s.hsLight] : s.hsRanges[s.hsTarget];
    $('hs-hue').value = hs[0];
    $('hs-sat').value = hs[1];
    $('hs-light').value = hs[2];
    $('hs-hue-val').textContent = fmtSigned(hs[0], '°');
    $('hs-sat-val').textContent = fmtSigned(hs[1]);
    $('hs-light-val').textContent = fmtSigned(hs[2]);

    $('sc-enabled').checked = s.scEnabled;
    $('sc-target').value = String(s.scTarget);
    const sc = s.scAdjust[s.scTarget];
    $('sc-c').value = sc[0];
    $('sc-m').value = sc[1];
    $('sc-y').value = sc[2];
    $('sc-k').value = sc[3];
    $('sc-c-val').textContent = fmtSigned(sc[0]);
    $('sc-m-val').textContent = fmtSigned(sc[1]);
    $('sc-y-val').textContent = fmtSigned(sc[2]);
    $('sc-k-val').textContent = fmtSigned(sc[3]);
    $('sc-relative').checked = s.scRelative;
  }

  function resetSettings() {
    state.settings = freshSettings();
    state.coarse = false;
    state.split = false;
    state.splitRatio = 0.5;
    state.compareHold = false;
    $('btn-split').classList.remove('is-active');
    updateControls();
  }

  /* ---------- 多图队列 ---------- */

  function setQueue(files) {
    const list = Array.from(files || []).filter((f) => f && (!f.type || /^image\//.test(f.type)));
    if (!list.length) return;
    state.queue.forEach((item) => {
      if (item.url && item.url.startsWith('blob:')) URL.revokeObjectURL(item.url);
    });
    state.queue = list.map((file) => ({ file, url: URL.createObjectURL(file) }));
    state.queueIndex = 0;
    renderQueue();
    loadFile(state.queue[0].file).then(() => buildQueueThumbnails(state.queue));
  }

  /* 浏览器原生无法显示 TIFF，队列缩略图需要走统一解码器。
     串行生成，避免批量导入大图时同时解码造成内存飙升。 */
  function needsDecodedThumbnail(file) {
    const name = ((file && file.name) || '').toLowerCase();
    const type = ((file && file.type) || '').toLowerCase();
    return type === 'image/tiff' || name.endsWith('.tif') || name.endsWith('.tiff');
  }

  async function buildQueueThumbnails(items) {
    for (const item of items) {
      if (!needsDecodedThumbnail(item.file)) continue;
      if (!state.queue.includes(item)) return;
      try {
        /* 当前正在预览的图片直接复用已解码位图，避免重复解码大文件 */
        const reused = item.file === state.file && state.source;
        const src = reused ? state.source : await decodeFile(item.file);
        const sw = src.width || 1;
        const sh = src.height || 1;
        const scale = Math.min(1, 160 / Math.max(sw, sh));
        const w = Math.max(1, Math.round(sw * scale));
        const h = Math.max(1, Math.round(sh * scale));
        const cnv = document.createElement('canvas');
        cnv.width = w;
        cnv.height = h;
        cnv.getContext('2d').drawImage(src, 0, 0, w, h);
        if (!reused && typeof src.close === 'function') src.close();
        if (!state.queue.includes(item)) return;
        if (item.url && item.url.startsWith('blob:')) URL.revokeObjectURL(item.url);
        item.url = cnv.toDataURL('image/jpeg', 0.82);
        const box = $('file-queue');
        const index = state.queue.indexOf(item);
        const img = index >= 0 && box && box.children[index]
          ? box.children[index].querySelector('img')
          : null;
        if (img) img.src = item.url;
      } catch (e) {
        /* 解码失败时保留原占位，不影响其他图片 */
      }
    }
  }

  function renderQueue() {
    const box = $('file-queue');
    if (!box) return;
    box.textContent = '';
    box.hidden = state.queue.length < 2;
    syncBatchButton();
    state.queue.forEach((item, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'queue-item' + (i === state.queueIndex ? ' is-active' : '');
      btn.title = item.file.name;
      const img = document.createElement('img');
      img.src = item.url;
      img.alt = '';
      const name = document.createElement('span');
      name.className = 'queue-name';
      name.textContent = item.file.name;
      btn.appendChild(img);
      btn.appendChild(name);
      btn.addEventListener('click', () => {
        if (i === state.queueIndex) return;
        state.queueIndex = i;
        renderQueue();
        loadFile(item.file);
      });
      box.appendChild(btn);
    });
  }

  async function loadFile(file) {
    state.coarse = false;
    if (!file || (file.type && !/^image\//.test(file.type))) return;
    $('file-tag').textContent = '读取中…';
    try {
      const src = await decodeFile(file);
      const w = src.width || src.naturalWidth;
      const h = src.height || src.naturalHeight;
      if (!w || !h) throw new Error('无法读取尺寸');
      state.source = src;
      state.sourceW = w;
      state.sourceH = h;
      state.name = file.name || 'image';
      state.file = file;

      /* 切换图片时保留白平衡算法、曝光目标与调色参数，
         让同一套设置统一作用于队列内的每张图片 */
      state.settings.low = 0;
      state.settings.high = 1;
      state.coarse = false;
      state.split = false;
      state.splitRatio = 0.5;
      state.compareHold = false;
      state.crop = null;
      state.cropEditing = false;
      state.cropRect = null;
      $('btn-split').classList.remove('is-active');
      $('crop-bar').hidden = true;
      $('crop-overlay').hidden = true;
      $('btn-crop').classList.remove('is-active');
      updateControls();
      buildAnalysis();
      buildPreview();
      $('drop-empty').hidden = true;
      $('canvas-wrap').hidden = false;
      $('file-info').hidden = false;
      setControlsEnabled(true);
      runAuto();
      updateView();
      renderQueue();
    } catch (e) {
      $('file-tag').textContent = '读取失败';
      window.alert('无法读取这张图片，请换一张试试。');
    }
  }

  /* ---------- 裁剪 ---------- */

  function clampCropRect(r) {
    const w = Math.min(1, Math.max(0.1, r.w));
    const h = Math.min(1, Math.max(0.1, r.h));
    return {
      x: Math.min(Math.max(0, r.x), 1 - w),
      y: Math.min(Math.max(0, r.y), 1 - h),
      w,
      h,
    };
  }

  function cropRatioNorm() {
    if (!state.cropRatio || !state.preview) return 0;
    return state.preview.w / (state.cropRatio * state.preview.h);
  }

  function fitCropRect(r) {
    const ratio = cropRatioNorm();
    if (!ratio) return clampCropRect(r);
    let w = r.w;
    let h = w / ratio;
    if (h > 1) {
      h = 1;
      w = h * ratio;
    }
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    return clampCropRect({ x: cx - w / 2, y: cy - h / 2, w, h });
  }

  function paintCropBox() {
    const box = $('crop-box');
    const r = state.cropRect;
    if (!box || !r) return;
    box.style.left = (r.x * 100).toFixed(2) + '%';
    box.style.top = (r.y * 100).toFixed(2) + '%';
    box.style.width = (r.w * 100).toFixed(2) + '%';
    box.style.height = (r.h * 100).toFixed(2) + '%';
  }

  function beginCrop() {
    if (!state.source || state.cropEditing) return;
    state.cropEditing = true;
    state.cropRect = state.crop ? { ...state.crop } : { x: 0.05, y: 0.05, w: 0.9, h: 0.9 };
    state.cropRatio = Number($('crop-ratio').value) || 0;
    if (state.cropRatio) state.cropRect = fitCropRect(state.cropRect);
    if (state.split) {
      state.split = false;
      $('btn-split').classList.remove('is-active');
      $('split-line').hidden = true;
    }
    $('crop-bar').hidden = false;
    $('crop-overlay').hidden = false;
    $('btn-crop').classList.add('is-active');
    /* 进入裁剪先还原整图，便于重新框选 */
    buildPreview();
    render();
    updateView();
    paintCropBox();
  }

  function endCrop(apply) {
    if (!state.cropEditing) return;
    if (apply && state.cropRect) {
      const r = state.cropRect;
      const full = r.x < 0.002 && r.y < 0.002 && r.w > 0.996 && r.h > 0.996;
      state.crop = full ? null : { x: r.x, y: r.y, w: r.w, h: r.h };
    }
    state.cropEditing = false;
    state.cropRect = null;
    $('crop-bar').hidden = true;
    $('crop-overlay').hidden = true;
    $('btn-crop').classList.remove('is-active');
    if (!state.source) return;
    /* 裁剪改变了画面分布，重新分析并刷新自动参数 */
    state.settings.low = 0;
    state.settings.high = 1;
    buildAnalysis();
    buildPreview();
    runAuto();
    updateView();
  }

  function resetCrop() {
    state.crop = null;
    state.cropEditing = false;
    state.cropRect = null;
    $('crop-bar').hidden = true;
    $('crop-overlay').hidden = true;
    $('btn-crop').classList.remove('is-active');
    if (!state.source) return;
    state.settings.low = 0;
    state.settings.high = 1;
    buildAnalysis();
    buildPreview();
    runAuto();
    updateView();
  }

  function bindCropDrag() {
    const overlay = $('crop-overlay');
    let drag = null;
    overlay.addEventListener('pointerdown', (e) => {
      if (!state.cropEditing) return;
      e.preventDefault();
      const hit = e.target.closest('[data-handle]');
      drag = {
        handle: hit ? hit.dataset.handle : 'move',
        start: { ...state.cropRect },
        px: e.clientX,
        py: e.clientY,
        rw: overlay.clientWidth || 1,
        rh: overlay.clientHeight || 1,
      };
      overlay.setPointerCapture(e.pointerId);
    });
    overlay.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = (e.clientX - drag.px) / drag.rw;
      const dy = (e.clientY - drag.py) / drag.rh;
      const st = drag.start;
      let r;
      if (drag.handle === 'move') {
        r = { x: st.x + dx, y: st.y + dy, w: st.w, h: st.h };
      } else {
        let x = st.x;
        let y = st.y;
        let w = st.w;
        let h = st.h;
        if (drag.handle.indexOf('w') >= 0) {
          const nx = Math.min(st.x + st.w - 0.05, Math.max(0, st.x + dx));
          w = st.x + st.w - nx;
          x = nx;
        }
        if (drag.handle.indexOf('e') >= 0) w = Math.min(1 - st.x, Math.max(0.05, st.w + dx));
        if (drag.handle.indexOf('n') >= 0) {
          const ny = Math.min(st.y + st.h - 0.05, Math.max(0, st.y + dy));
          h = st.y + st.h - ny;
          y = ny;
        }
        if (drag.handle.indexOf('s') >= 0) h = Math.min(1 - st.y, Math.max(0.05, st.h + dy));
        r = { x, y, w, h };
      }
      state.cropRect = cropRatioNorm() ? fitCropRect(r) : clampCropRect(r);
      paintCropBox();
    });
    ['pointerup', 'pointercancel'].forEach((ev) => {
      overlay.addEventListener(ev, () => {
        drag = null;
      });
    });
  }

  /* ---------- 大图查看 ---------- */

  function openLightbox() {
    if (!state.source) return;
    const box = $('lightbox');
    box.hidden = false;
    $('lightbox-title').textContent = state.name + ' · 生成中…';
    window.setTimeout(() => {
      const rect = cropPx();
      const w = rect ? rect.w : state.sourceW;
      const h = rect ? rect.h : state.sourceH;
      const c = $('lightbox-canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(state.source, rect ? rect.x : 0, rect ? rect.y : 0, w, h, 0, 0, w, h);
      const img = ctx.getImageData(0, 0, w, h);
      processPixels(img.data, img.data, w, h, state.settings, state.auto);
      ctx.putImageData(img, 0, 0);
      $('lightbox-title').textContent = state.name + ' · ' + w + ' × ' + h;
    }, 30);
  }

  function closeLightbox() {
    $('lightbox').hidden = true;
  }

  /* ---------- 一键重置（参数 + 裁剪） ---------- */

  function resetAll() {
    resetSettings();
    resetCrop();
  }

  /* ---------- 事件绑定 ---------- */

  function initEvents() {
    const fileInput = $('file-input');
    const drop = $('drop');

    drop.addEventListener('click', () => fileInput.click());
    drop.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fileInput.click();
      }
    });
    fileInput.addEventListener('change', () => {
      if (fileInput.files && fileInput.files.length) setQueue(fileInput.files);
      fileInput.value = '';
    });

    ['dragenter', 'dragover'].forEach((ev) => {
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        drop.classList.add('is-dragover');
      });
    });
    ['dragleave', 'drop'].forEach((ev) => {
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        drop.classList.remove('is-dragover');
      });
    });
    drop.addEventListener('drop', (e) => {
      const files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) setQueue(files);
    });
    const viewport = $('viewport');
    ['dragenter', 'dragover'].forEach((ev) => {
      viewport.addEventListener(ev, (e) => e.preventDefault());
    });
    viewport.addEventListener('drop', (e) => {
      e.preventDefault();
      const files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) setQueue(files);
    });

    $('btn-crop').addEventListener('click', () => {
      if (state.cropEditing) endCrop(false);
      else beginCrop();
    });
    $('btn-crop-apply').addEventListener('click', () => endCrop(true));
    $('btn-crop-cancel').addEventListener('click', () => endCrop(false));
    $('btn-crop-reset').addEventListener('click', resetCrop);
    $('crop-ratio').addEventListener('change', (e) => {
      state.cropRatio = Number(e.target.value) || 0;
      if (state.cropEditing && state.cropRatio) {
        state.cropRect = fitCropRect(state.cropRect);
        paintCropBox();
      }
    });
    $('btn-zoom').addEventListener('click', openLightbox);
    $('btn-reset-all').addEventListener('click', resetAll);
    $('btn-lightbox-close').addEventListener('click', closeLightbox);
    $('lightbox').addEventListener('click', (e) => {
      if (e.target === $('lightbox')) closeLightbox();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!$('lightbox').hidden) {
        closeLightbox();
      } else if (state.cropEditing) {
        endCrop(false);
      }
    });
    bindCropDrag();

    $('wb-enabled').addEventListener('change', (e) => {
      state.settings.wbEnabled = e.target.checked;
      scheduleAuto();
    });
    $('wb-method').addEventListener('change', (e) => {
      state.settings.wbMethod = e.target.value;
      $('wb-note').textContent = WB_NOTES[state.settings.wbMethod] || '';
      scheduleAuto();
    });
    $('wb-strength').addEventListener('input', (e) => {
      state.settings.wbStrength = Number(e.target.value) / 100;
      $('wb-strength-val').textContent = e.target.value + '%';
      scheduleAuto();
    });
    $('exp-enabled').addEventListener('change', (e) => {
      state.settings.expEnabled = e.target.checked;
      scheduleAuto();
    });
    $('target-luma').addEventListener('input', (e) => {
      state.settings.target = Number(e.target.value) / 100;
      $('target-val').textContent = e.target.value + '%';
      scheduleAuto();
    });
    $('auto-levels').addEventListener('change', (e) => {
      state.settings.autoLevels = e.target.checked;
      if (e.target.checked) {
        scheduleAuto();
      } else {
        state.settings.low = state.auto.low;
        state.settings.high = state.auto.high;
        syncLevelInputs();
        scheduleRender();
      }
    });
    $('low-point').addEventListener('input', (e) => {
      state.settings.autoLevels = false;
      state.settings.low = Number(e.target.value) / 255;
      if (state.settings.high - state.settings.low < 0.02) {
        state.settings.high = Math.min(1, state.settings.low + 0.02);
      }
      syncLevelInputs();
      scheduleRender();
    });
    $('high-point').addEventListener('input', (e) => {
      state.settings.autoLevels = false;
      state.settings.high = Number(e.target.value) / 255;
      if (state.settings.high - state.settings.low < 0.02) {
        state.settings.low = Math.max(0, state.settings.high - 0.02);
      }
      syncLevelInputs();
      scheduleRender();
    });
    $('ev').addEventListener('input', (e) => {
      state.settings.ev = Number(e.target.value);
      $('ev-val').textContent = state.settings.ev.toFixed(2) + ' EV';
      scheduleRender();
    });
    $('gamma').addEventListener('input', (e) => {
      state.settings.gamma = Number(e.target.value);
      $('gamma-val').textContent = state.settings.gamma.toFixed(2);
      scheduleRender();
    });
    $('saturation').addEventListener('input', (e) => {
      state.settings.saturation = Number(e.target.value) / 100;
      $('saturation-val').textContent = e.target.value + '%';
      scheduleRender();
    });

    /* 色彩平衡 */
    $('cb-enabled').addEventListener('change', (e) => {
      state.settings.cbEnabled = e.target.checked;
      scheduleRender();
    });
    $('cb-tone').addEventListener('change', (e) => {
      state.settings.cbTone = e.target.value;
      syncColorControls();
    });
    const bindCbSlider = (id, idx) => {
      $(id).addEventListener('input', (e) => {
        state.coarse = true;
        state.settings[cbToneKey(state.settings.cbTone)][idx] = Number(e.target.value);
        syncColorControls();
        scheduleRender();
      });
      $(id).addEventListener('change', () => {
        state.coarse = false;
        scheduleRender();
      });
    };
    bindCbSlider('cb-cr', 0);
    bindCbSlider('cb-mg', 1);
    bindCbSlider('cb-yb', 2);
    $('cb-preserve').addEventListener('change', (e) => {
      state.settings.cbPreserve = e.target.checked;
      scheduleRender();
    });

    /* 色相 / 饱和度 */
    $('hs-enabled').addEventListener('change', (e) => {
      state.settings.hsEnabled = e.target.checked;
      scheduleRender();
    });
    $('hs-target').addEventListener('change', (e) => {
      state.settings.hsTarget = e.target.value === 'master' ? -1 : Number(e.target.value);
      syncColorControls();
    });
    const HS_KEYS = ['hsHue', 'hsSat', 'hsLight'];
    const bindHsSlider = (id, idx) => {
      $(id).addEventListener('input', (e) => {
        const s = state.settings;
        state.coarse = true;
        const v = Number(e.target.value);
        if (s.hsTarget < 0) s[HS_KEYS[idx]] = v;
        else s.hsRanges[s.hsTarget][idx] = v;
        syncColorControls();
        scheduleRender();
      });
      $(id).addEventListener('change', () => {
        state.coarse = false;
        scheduleRender();
      });
    };
    bindHsSlider('hs-hue', 0);
    bindHsSlider('hs-sat', 1);
    bindHsSlider('hs-light', 2);

    /* 可选颜色 */
    $('sc-enabled').addEventListener('change', (e) => {
      state.settings.scEnabled = e.target.checked;
      scheduleRender();
    });
    $('sc-target').addEventListener('change', (e) => {
      state.settings.scTarget = Number(e.target.value);
      syncColorControls();
    });
    const bindScSlider = (id, idx) => {
      $(id).addEventListener('input', (e) => {
        state.coarse = true;
        state.settings.scAdjust[state.settings.scTarget][idx] = Number(e.target.value);
        syncColorControls();
        scheduleRender();
      });
      $(id).addEventListener('change', () => {
        state.coarse = false;
        scheduleRender();
      });
    };
    bindScSlider('sc-c', 0);
    bindScSlider('sc-m', 1);
    bindScSlider('sc-y', 2);
    bindScSlider('sc-k', 3);
    $('sc-relative').addEventListener('change', (e) => {
      state.settings.scRelative = e.target.checked;
      scheduleRender();
    });

    $('btn-reset').addEventListener('click', () => {
      resetSettings();
      runAuto();
      updateView();
    });
    $('btn-reset-top').addEventListener('click', () => {
      resetSettings();
      runAuto();
      updateView();
    });

    const compareBtn = $('btn-compare');
    const setHold = (on) => {
      if (!state.source) return;
      state.compareHold = on;
      updateView();
    };
    compareBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      setHold(true);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => {
      compareBtn.addEventListener(ev, () => setHold(false));
    });
    window.addEventListener('pointerup', () => setHold(false));

    $('btn-split').addEventListener('click', () => {
      state.split = !state.split;
      $('btn-split').classList.toggle('is-active', state.split);
      updateView();
    });

    const wrap = $('canvas-wrap');
    let dragging = false;
    const setSplitFromEvent = (e) => {
      const rect = wrap.getBoundingClientRect();
      if (!rect.width) return;
      state.splitRatio = clamp((e.clientX - rect.left) / rect.width, 0.02, 0.98);
      updateView();
    };
    wrap.addEventListener('pointerdown', (e) => {
      if (!state.split) return;
      dragging = true;
      wrap.setPointerCapture(e.pointerId);
      setSplitFromEvent(e);
    });
    wrap.addEventListener('pointermove', (e) => {
      if (dragging) setSplitFromEvent(e);
    });
    ['pointerup', 'pointercancel'].forEach((ev) => {
      wrap.addEventListener(ev, () => {
        dragging = false;
      });
    });

    $('btn-export').addEventListener('click', exportImage);
    $('btn-batch').addEventListener('click', exportBatch);

    window.addEventListener('resize', () => {
      syncCanvasMax();
      if (state.lastStats) drawHistogram(state.lastStats);
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.split) {
        state.split = false;
        $('btn-split').classList.remove('is-active');
        updateView();
      }
    });
  }

  /* ---------- 画布高度 ---------- */

  /* 三栏布局下舞台撑满一屏，画布最大高度取中间列剩余空间，保证图片可放大
     且直方图底部与左右面板底部对齐；堆叠布局回退到 CSS 默认值。 */
  function syncCanvasMax() {
    const vp = $('viewport');
    if (!vp) return;
    const root = document.documentElement;
    if (!window.matchMedia('(min-width: 1041px)').matches) {
      root.style.removeProperty('--canvas-max-h');
      return;
    }
    const h = vp.clientHeight;
    if (h > 0) root.style.setProperty('--canvas-max-h', Math.max(160, h - 12) + 'px');
  }

  /* ---------- 卡片折叠 ---------- */

  const COLLAPSE_KEY = 'auto-tone:collapsed';

  function loadCollapsed() {
    try {
      const raw = localStorage.getItem(COLLAPSE_KEY);
      const obj = raw ? JSON.parse(raw) : {};
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
      return obj;
    } catch (err) {
      return {};
    }
  }

  function saveCollapsed(flags) {
    try {
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify(flags));
    } catch (err) {
      /* 隐私模式下写入失败可忽略 */
    }
  }

  function setupCollapsibleCards() {
    const cards = Array.from(document.querySelectorAll('.card'));
    const saved = loadCollapsed();

    cards.forEach((card) => {
      const head = card.querySelector('.card-head');
      if (!head) return;
      /* 以卡片标题作为折叠状态的键，调整卡片顺序后状态不会串位 */
      const titleEl = head.querySelector('h2');
      const key = titleEl ? titleEl.textContent.trim() : '';

      const body = document.createElement('div');
      body.className = 'card-body';
      while (head.nextSibling) body.appendChild(head.nextSibling);
      card.appendChild(body);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'card-toggle';
      btn.setAttribute('aria-label', '折叠或展开面板');
      btn.innerHTML =
        '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ' +
        'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M6 9l6 6 6-6"></path></svg>';
      btn.addEventListener('click', () => {
        const next = !card.classList.contains('is-collapsed');
        card.classList.toggle('is-collapsed', next);
        btn.setAttribute('aria-expanded', String(!next));
        saved[key] = next;
        saveCollapsed(saved);
        syncCanvasMax();
        if (!next && state.lastStats) drawHistogram(state.lastStats);
      });
      head.appendChild(btn);

      const collapsed = saved[key] === true;
      card.classList.toggle('is-collapsed', collapsed);
      btn.setAttribute('aria-expanded', String(!collapsed));
    });
  }

  setupCollapsibleCards();
  syncCanvasMax();
  setControlsEnabled(false);
  updateControls();
  initEvents();
})();
