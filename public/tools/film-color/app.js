/* 胶片滤镜 - DigitalFilm / SpektraLab 胶片冲印 + 双重曝光 */
import { parseFilm, parsePaper, bakeLut, applyLut, centerWeightedEv } from "./engine.js";

const MAX_PREVIEW = 1200;
const MAX_EXPORT = 4096;
const MAX_QUEUE = 12;
const DEFAULT_FILM = "kodak_portra_400";
const LUT_SIDE = 33;

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

const el = {
  segs: Array.from(document.querySelectorAll(".seg")),
  paneSingle: document.getElementById("pane-single"),
  paneDouble: document.getElementById("pane-double"),
  batchList: document.getElementById("batch-list"),
  batchCount: document.getElementById("batch-count"),
  batchClear: document.getElementById("batch-clear"),
  exportAll: document.getElementById("export-all"),
  singleName: document.getElementById("single-name"),
  lowerName: document.getElementById("lower-name"),
  upperName: document.getElementById("upper-name"),
  swap: document.getElementById("swap"),
  film: document.getElementById("film"),
  paper: document.getElementById("paper"),
  filmType: document.getElementById("film-type"),
  auto: document.getElementById("auto"),
  ev: document.getElementById("ev"),
  evVal: document.getElementById("ev-val"),
  evTag: document.getElementById("ev-tag"),
  strength: document.getElementById("strength"),
  strengthVal: document.getElementById("strength-val"),
  doubleControls: document.getElementById("double-controls"),
  lookCard: document.getElementById("look-card"),
  frame: document.getElementById("frame"),
  exposureCard: document.getElementById("exposure-card"),
  balance: document.getElementById("balance"),
  balanceTag: document.getElementById("balance-tag"),
  scale: document.getElementById("scale"),
  scaleVal: document.getElementById("scale-val"),
  rotate: document.getElementById("rotate"),
  flip: document.getElementById("flip"),
  reset: document.getElementById("reset"),
  format: document.getElementById("format"),
  exportBtn: document.getElementById("export"),
  exportNote: document.getElementById("export-note"),
  viewport: document.getElementById("viewport"),
  empty: document.getElementById("empty"),
  canvasWrap: document.getElementById("canvas-wrap"),
  canvas: document.getElementById("view-canvas"),
  status: document.getElementById("status"),
  stageNote: document.getElementById("stage-note"),
  compare: document.getElementById("compare"),
  splitBtn: document.getElementById("split"),
  resetAll: document.getElementById("reset-all"),
  splitLine: document.getElementById("split-line"),
  fileInput: document.getElementById("file-input"),
  thumbs: {
    single: document.querySelector('.thumb[data-pick="single"]'),
    lower: document.querySelector('.thumb[data-pick="lower"]'),
    upper: document.querySelector('.thumb[data-pick="upper"]'),
  },
};

const state = {
  mode: "single",
  images: { single: null, lower: null, upper: null },
  batch: [],
  batchIndex: 0,
  filmId: "kodak_portra_400",
  paperId: "kodak_portra_endura",
  auto: true,
  autoEv: 0,
  ev: 0,
  strength: 1,
  balance: 0.5,
  transform: { x: 0, y: 0, scale: 1, rot: 0, flip: false },
  frame: { w: 0, h: 0 },
  preview: { w: 0, h: 0 },
  manifest: null,
  lut: null,
  lutKey: "",
  autoDirty: true,
  renderSeq: 0,
  pick: null,
  frame: "none",
  split: false,
  splitRatio: 0.5,
  compareHold: false,
  busy: false,
  lastFrame: null,
};

const filmCache = new Map();
const paperCache = new Map();
const lutCache = new Map();
const workLower = document.createElement("canvas");
const workUpper = document.createElement("canvas");
const workSingle = document.createElement("canvas");

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const tick = () => new Promise((resolve) => setTimeout(resolve, 16));
const dataUrl = (rel) => new URL(rel, import.meta.url).href;

function setStatus(text) {
  if (!text) {
    el.status.hidden = true;
    el.status.textContent = "";
  } else {
    el.status.textContent = text;
    el.status.hidden = false;
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片解码失败"));
    img.src = src;
  });
}

function releaseImage(slot) {
  const prev = state.images[slot];
  if (prev && prev.url.startsWith("blob:")) URL.revokeObjectURL(prev.url);
}

async function setImage(slot, url, name, file) {
  const img = await loadImage(url);
  releaseImage(slot);
  state.images[slot] = { img, url, name: name || "未命名", file: file || null };
  if (slot === "lower") {
    state.frame = { w: img.naturalWidth || img.width, h: img.naturalHeight || img.height };
    state.transform = { x: 0, y: 0, scale: 1, rot: 0, flip: false };
  } else if (slot === "single") {
    state.frame = { w: img.naturalWidth || img.width, h: img.naturalHeight || img.height };
  }
  state.autoDirty = true;
  syncImages();
  syncLook();
}

const TIFF_EXT = /\.tiff?$/i;
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|avif|tiff?)$/i;

function looksLikeTiff(file) {
  return file.type === "image/tiff" || TIFF_EXT.test(file.name || "");
}

/* ---------- TIFF 目录与内嵌 ICC（与 film-autoclip 的处理保持一致） ---------- */

let adobeDecodeLut = null;
let srgbEncodeLut = null;

function getAdobeSrgbLuts() {
  if (!adobeDecodeLut) {
    adobeDecodeLut = new Float32Array(256);
    for (let value = 0; value < 256; value += 1) {
      adobeDecodeLut[value] = Math.pow(value / 255, 2.19921875);
    }
    srgbEncodeLut = new Uint8ClampedArray(4097);
    for (let index = 0; index <= 4096; index += 1) {
      const linear = index / 4096;
      const encoded = linear <= 0.0031308 ? 12.92 * linear : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;
      srgbEncodeLut[index] = Math.round(encoded * 255);
    }
  }
  return { decode: adobeDecodeLut, encode: srgbEncodeLut };
}

/** Adobe RGB (1998) -> sRGB：与浏览器对 JPEG 内嵌 ICC 的色彩管理保持一致。 */
function applyAdobeRgbToSrgb(rgba) {
  const { decode, encode } = getAdobeSrgbLuts();
  for (let offset = 0; offset < rgba.length; offset += 4) {
    const red = decode[rgba[offset]];
    const green = decode[rgba[offset + 1]];
    const blue = decode[rgba[offset + 2]];
    let convertedRed = 1.3982831 * red - 0.398283 * green;
    let convertedBlue = -0.0429383 * green + 1.0429383 * blue;
    convertedRed = convertedRed <= 0 ? 0 : convertedRed >= 1 ? 1 : convertedRed;
    convertedBlue = convertedBlue <= 0 ? 0 : convertedBlue >= 1 ? 1 : convertedBlue;
    rgba[offset] = encode[(convertedRed * 4096 + 0.5) | 0];
    rgba[offset + 1] = encode[(green * 4096 + 0.5) | 0];
    rgba[offset + 2] = encode[(convertedBlue * 4096 + 0.5) | 0];
  }
}

function readIccDescription(profile) {
  if (!profile || profile.length < 132) return "";
  const view = new DataView(profile.buffer, profile.byteOffset, profile.byteLength);
  const tableCount = view.getUint32(128);
  for (let index = 0; index < tableCount; index += 1) {
    const base = 132 + index * 12;
    if (base + 12 > profile.length) break;
    const signature = String.fromCharCode(profile[base], profile[base + 1], profile[base + 2], profile[base + 3]);
    if (signature !== "desc") continue;
    const offset = view.getUint32(base + 4);
    if (offset + 12 > profile.length) continue;
    const type = String.fromCharCode(profile[offset], profile[offset + 1], profile[offset + 2], profile[offset + 3]);
    if (type === "desc") {
      const length = view.getUint32(offset + 8);
      const end = Math.min(profile.length, offset + 12 + Math.max(0, length - 1));
      return String.fromCharCode(...profile.subarray(offset + 12, end));
    }
    if (type === "mluc") {
      const recordCount = view.getUint32(offset + 8);
      if (!recordCount) continue;
      const recordLength = view.getUint32(offset + 20);
      const recordOffset = view.getUint32(offset + 24);
      const end = Math.min(profile.length, offset + recordOffset + recordLength);
      try {
        return new TextDecoder("utf-16be").decode(profile.subarray(offset + recordOffset, end));
      } catch {
        return "";
      }
    }
  }
  return "";
}

function applyTiffIccProfile(rgba, entries) {
  const iccEntry = entries && entries.find((entry) => entry.tag === 34675);
  if (!iccEntry || !iccEntry.data || !iccEntry.data.length) return;
  const description = readIccDescription(iccEntry.data).toLowerCase();
  if (!description.includes("adobe rgb")) return;
  applyAdobeRgbToSrgb(rgba);
}

function parseClassicTiffDirectory(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 8) throw new Error("TIFF header is incomplete");
  const byteOrder = String.fromCharCode(bytes[0], bytes[1]);
  if (byteOrder !== "II" && byteOrder !== "MM") throw new Error("TIFF byte order is invalid");
  const littleEndian = byteOrder === "II";
  const view = new DataView(buffer);
  if (view.getUint16(2, littleEndian) !== 42) throw new Error("BigTIFF is not supported");
  const ifdOffset = view.getUint32(4, littleEndian);
  if (ifdOffset + 2 > bytes.length) throw new Error("TIFF directory offset is invalid");
  const entryCount = view.getUint16(ifdOffset, littleEndian);
  const directoryEnd = ifdOffset + 2 + entryCount * 12 + 4;
  if (directoryEnd > bytes.length) throw new Error("TIFF directory is incomplete");
  const typeSizes = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8, 4, 0, 0, 8, 8, 8];
  const entries = [];
  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = ifdOffset + 2 + index * 12;
    const tag = view.getUint16(entryOffset, littleEndian);
    const type = view.getUint16(entryOffset + 2, littleEndian);
    const count = view.getUint32(entryOffset + 4, littleEndian);
    const typeSize = typeSizes[type] || 0;
    const valueLength = typeSize * count;
    if (!typeSize || !Number.isSafeInteger(valueLength)) continue;
    const valueOffset = valueLength <= 4 ? entryOffset + 8 : view.getUint32(entryOffset + 8, littleEndian);
    if (valueOffset + valueLength > bytes.length) continue;
    entries.push({ tag, type, count, data: bytes.slice(valueOffset, valueOffset + valueLength) });
  }
  return { littleEndian, entries };
}

/** 浏览器原生无法解码 TIFF，用 UTIF 兜底解析成 PNG blob URL 再走正常流程。 */
async function decodeTiff(file) {
  if (typeof UTIF === "undefined") throw new Error("TIFF 解码库未加载");
  const buffer = await file.arrayBuffer();
  const head = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
  const isTiff = (head[0] === 0x49 && head[1] === 0x49 && head[2] === 0x2a) ||
    (head[0] === 0x4d && head[1] === 0x4d && head[2] === 0x00 && head[3] === 0x2a);
  if (!isTiff) throw new Error("这张图片无法解码");
  const ifds = UTIF.decode(buffer);
  if (!ifds.length) throw new Error("TIFF 解析失败");
  UTIF.decodeImage(buffer, ifds[0], ifds);
  const width = ifds[0].width;
  const height = ifds[0].height;
  if (!width || !height) throw new Error("TIFF 解析失败");
  const rgba = UTIF.toRGBA8(ifds[0]);
  // 部分扫描 TIFF 内嵌 Adobe RGB，直接当 sRGB 用会明显偏灰偏淡
  try {
    applyTiffIccProfile(rgba, parseClassicTiffDirectory(buffer).entries);
  } catch {
    /* 目录解析失败不影响取图，按 sRGB 处理 */
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(width, height);
  image.data.set(rgba);
  ctx.putImageData(image, 0, 0);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("TIFF 转换失败");
  return URL.createObjectURL(blob);
}

function isImageFile(file) {
  const named = file.name || "";
  return (file.type && file.type.startsWith("image/")) ||
    (!file.type && IMAGE_EXT.test(named));
}

async function fileToUrl(file) {
  return looksLikeTiff(file) ? await decodeTiff(file) : URL.createObjectURL(file);
}

async function handleFile(file, slot) {
  if (!file) return;
  if (!isImageFile(file)) {
    setStatus("请选择图片文件");
    return;
  }
  const named = file.name || "";
  let url = "";
  try {
    url = await fileToUrl(file);
    await setImage(slot, url, named, file);
    await render();
  } catch (err) {
    if (url && url.startsWith("blob:")) URL.revokeObjectURL(url);
    url = "";
    if (looksLikeTiff(file)) {
      setStatus(err && err.message ? err.message : "这张图片无法解码");
      return;
    }
    // 没有扩展名 / MIME 为空的 TIFF 先走原生解码，失败后按文件头兜底
    try {
      url = await decodeTiff(file);
      await setImage(slot, url, named, file);
      await render();
    } catch (err2) {
      if (url && url.startsWith("blob:")) URL.revokeObjectURL(url);
      setStatus(err2 && err2.message ? err2.message : "这张图片无法解码");
    }
  }
}

function pickInto(slot) {
  state.pick = slot;
  el.fileInput.value = "";
  el.fileInput.click();
}

/* ---------- 渲染 ---------- */

function drawCover(ctx, img, w, h) {
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s;
  const dh = img.height * s;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

function drawUpper(ctx, img, w, h, t) {
  const swap = t.rot % 180 !== 0;
  const bw = swap ? img.height : img.width;
  const bh = swap ? img.width : img.height;
  const s = Math.max(w / bw, h / bh) * t.scale;
  ctx.save();
  ctx.translate(w / 2 + t.x * w, h / 2 + t.y * h);
  ctx.rotate((t.rot * Math.PI) / 180);
  ctx.scale(t.flip ? -1 : 1, 1);
  ctx.drawImage(img, (-img.width * s) / 2, (-img.height * s) / 2, img.width * s, img.height * s);
  ctx.restore();
}

function singleSource(item, maxEdge) {
  if (!item) return null;
  const iw = item.img.naturalWidth || item.img.width;
  const ih = item.img.naturalHeight || item.img.height;
  const s = Math.min(1, maxEdge / Math.max(iw, ih));
  const w = Math.max(1, Math.round(iw * s));
  const h = Math.max(1, Math.round(ih * s));
  workSingle.width = w;
  workSingle.height = h;
  const ctx = workSingle.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(item.img, 0, 0, w, h);
  return { w, h, data: ctx.getImageData(0, 0, w, h).data, frame: { w: iw, h: ih } };
}

function buildSource(maxEdge, item) {
  if (state.mode === "single") return singleSource(item || batchItem() || state.images.single, maxEdge);

  const lower = state.images.lower;
  const upper = state.images.upper;
  if (!lower) return null;
  const fw = state.frame.w;
  const fh = state.frame.h;
  const s = Math.min(1, maxEdge / Math.max(fw, fh));
  const w = Math.max(1, Math.round(fw * s));
  const h = Math.max(1, Math.round(fh * s));

  workLower.width = w;
  workLower.height = h;
  const lctx = workLower.getContext("2d", { willReadFrequently: true });
  lctx.imageSmoothingEnabled = true;
  lctx.imageSmoothingQuality = "high";
  drawCover(lctx, lower.img, w, h);
  const lo = lctx.getImageData(0, 0, w, h).data;

  if (!upper) return { w, h, data: lo, frame: { w: fw, h: fh } };

  workUpper.width = w;
  workUpper.height = h;
  const uctx = workUpper.getContext("2d", { willReadFrequently: true });
  uctx.imageSmoothingEnabled = true;
  uctx.imageSmoothingQuality = "high";
  drawUpper(uctx, upper.img, w, h, state.transform);
  const up = uctx.getImageData(0, 0, w, h).data;

  const out = new Uint8ClampedArray(lo.length);
  const b = state.balance;
  for (let i = 0; i < lo.length; i += 4) {
    const a = up[i + 3] / 255;
    const wgt = b * a;
    if (wgt === 0) {
      out[i] = lo[i];
      out[i + 1] = lo[i + 1];
      out[i + 2] = lo[i + 2];
    } else {
      out[i] = encode(srgbToLin[lo[i]] + wgt * (srgbToLin[up[i]] - srgbToLin[lo[i]]));
      out[i + 1] = encode(srgbToLin[lo[i + 1]] + wgt * (srgbToLin[up[i + 1]] - srgbToLin[lo[i + 1]]));
      out[i + 2] = encode(srgbToLin[lo[i + 2]] + wgt * (srgbToLin[up[i + 2]] - srgbToLin[lo[i + 2]]));
    }
    out[i + 3] = 255;
  }
  return { w, h, data: out, frame: { w: fw, h: fh } };
}

async function loadFilm(id) {
  if (filmCache.has(id)) return filmCache.get(id);
  const res = await fetch(dataUrl(`./data/films/${id}.bin`));
  if (!res.ok) throw new Error(`胶卷数据加载失败: ${id}`);
  const film = parseFilm(await res.arrayBuffer());
  const meta = state.manifest && state.manifest.films.find((f) => f.id === id);
  film.positive = !!meta && meta.type === "positive";
  film.id = id;
  filmCache.set(id, film);
  return film;
}

async function loadPaper(id) {
  if (paperCache.has(id)) return paperCache.get(id);
  const res = await fetch(dataUrl(`./data/papers/${id}.bin`));
  if (!res.ok) throw new Error(`相纸数据加载失败: ${id}`);
  const paper = parsePaper(await res.arrayBuffer());
  paper.id = id;
  paperCache.set(id, paper);
  return paper;
}

async function ensureLut(ev) {
  const filmMeta = state.manifest.films.find((f) => f.id === state.filmId);
  const positive = !!filmMeta && filmMeta.type === "positive";
  // 反转片直接扫描，不使用相纸；LUT 缓存键也不带相纸，避免换相纸时误命中。
  const key = positive
    ? `${state.filmId}|direct|${ev.toFixed(2)}`
    : `${state.filmId}|${state.paperId}|${ev.toFixed(2)}`;
  if (state.lut && state.lutKey === key) return state.lut;
  if (lutCache.has(key)) {
    state.lut = lutCache.get(key);
    state.lutKey = key;
    return state.lut;
  }
  setStatus("烘焙胶片…");
  const [film, paper] = positive
    ? [await loadFilm(state.filmId), null]
    : await Promise.all([loadFilm(state.filmId), loadPaper(state.paperId)]);
  await tick();
  const lut = bakeLut(film, paper, ev, LUT_SIDE);
  if (lutCache.size > 10) lutCache.delete(lutCache.keys().next().value);
  lutCache.set(key, lut);
  state.lut = lut;
  state.lutKey = key;
  return lut;
}

function batchItem() {
  return state.mode === "single" ? state.batch[state.batchIndex] || null : null;
}

function currentEv(item) {
  const target = state.mode === "single" ? item || batchItem() : null;
  if (target) return clamp(state.auto ? target.autoEv : state.ev, -3, 3);
  return clamp(state.auto ? state.autoEv : state.ev, -3, 3);
}

async function render() {
  const seq = ++state.renderSeq;
  const src = buildSource(MAX_PREVIEW);
  if (!src) {
    state.preview = { w: 0, h: 0 };
    state.lastFrame = null;
    el.empty.hidden = false;
    el.canvasWrap.hidden = true;
    el.splitLine.hidden = true;
    setStatus(null);
    return;
  }
  if (state.mode === "double") {
    present(src.data, src);
    return;
  }
  const item = batchItem();
  if (state.auto) {
    if (item) {
      if (item.autoDirty) {
        item.autoEv = clamp(centerWeightedEv(src.data, src.w, src.h), -3, 3);
        item.autoDirty = false;
        syncExposure();
      }
    } else if (state.autoDirty) {
      state.autoEv = clamp(centerWeightedEv(src.data, src.w, src.h), -3, 3);
      state.autoDirty = false;
      syncExposure();
    }
  }
  const ev = currentEv(item);
  let lut;
  try {
    lut = await ensureLut(ev);
  } catch (err) {
    setStatus(String(err.message || err));
    return;
  }
  if (seq !== state.renderSeq) return;
  const out = applyLut(src.data, src.w, src.h, lut, LUT_SIDE, state.strength);
  if (seq !== state.renderSeq) return;
  present(out, src);
}

/** 把像素结果放到预览画布上，并更新输出尺寸提示。 */
function present(out, src) {
  state.preview = { w: src.w, h: src.h };
  state.lastFrame = { out, src };
  el.canvas.width = src.w;
  el.canvas.height = src.h;
  paintView();
  el.empty.hidden = true;
  el.canvasWrap.hidden = false;
  setStatus(null);
  const spec = frameSpec(src.w, src.h, state.frame);
  el.exportNote.textContent = `输出 ${spec.w} × ${spec.h}`;
}

const procLayer = document.createElement("canvas");
const photoLayer = document.createElement("canvas");

// 135 胶片实测几何（mm）：胶片宽 35，片门 36.25 × 24.3，齿距 4.75，
// 齿孔 2.79 × 1.98，孔外缘距片边 2.0，片边字在孔的外侧，片门四角 0.5 圆角。
const FRAME_MM = {
  rebate: 5.35,
  side: 0.875,
  pitch: 4.75,
  perfW: 2.79,
  perfH: 1.98,
  perfInset: 2,
  gateRadius: 0.5,
};

/** 边框尺寸：白边按短边 5.5% 留白；胶片框按 135 片基比例留出上下片边。 */
function frameSpec(w, h, style) {
  if (style === "white") {
    const pad = Math.max(6, Math.round(Math.min(w, h) * 0.055));
    return { style, w: w + pad * 2, h: h + pad * 2, padX: pad, padY: pad, strip: 0, scale: 0 };
  }
  if (style === "film") {
    const scale = h / 24.3;
    const padX = Math.max(5, Math.round(FRAME_MM.side * scale));
    const strip = Math.max(16, Math.round(FRAME_MM.rebate * scale));
    return { style, w: w + padX * 2, h: h + strip * 2, padX, padY: strip, strip, scale };
  }
  return { style: "none", w, h, padX: 0, padY: 0, strip: 0, scale: 0 };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 齿孔：8 齿一格，齿孔在片边字与片门之间。 */
function drawSprockets(ctx, spec) {
  const scale = spec.scale;
  const holeW = Math.max(6, Math.round(FRAME_MM.perfW * scale));
  const holeH = Math.max(5, Math.round(FRAME_MM.perfH * scale));
  const pitch = Math.max(holeW + 4, Math.round(FRAME_MM.pitch * scale));
  const radius = Math.max(1, Math.round(0.4 * scale));
  const count = Math.max(1, Math.round(spec.w / pitch));
  const pattern = (count - 1) * pitch + holeW;
  const offset = Math.round((spec.w - pattern) / 2);
  const top = Math.max(2, Math.round(FRAME_MM.perfInset * scale));
  const bottom = spec.h - top - holeH;
  ctx.fillStyle = "#f1eee6";
  for (let i = 0; i < count; i += 1) {
    const x = offset + i * pitch;
    roundRect(ctx, x, top, holeW, holeH, radius);
    ctx.fill();
    roundRect(ctx, x, bottom, holeW, holeH, radius);
    ctx.fill();
  }
}

// 片边字取自 app 的实测值（Session+FilmEdge.swift → edgeText(for:gauge:)）。
// 本工具只画 135 片条，因此用 135 的写法；120 的边字不同（如 Gold 200 是
// "KODAK 200"、Velvia 是 "FUJI RVP100"、Portra 800 是 "KODAK PORTRA 800"），不能混用。
const EDGE_TEXT = {
  kodak_gold_200: "KODAK GB 200-7",
  kodak_portra_800: "KODAK PORTRA 800-3",
  kodak_portra_800_push1: "KODAK PORTRA 800-3",
  kodak_portra_800_push2: "KODAK PORTRA 800-3",
  kodak_ultramax_400: "KODAK GC 400",
  kodak_ektachrome_100: "KODAK E100",
  fujifilm_c200: "FUJI 200",
  fujifilm_xtra_400: "S-400",
  fujifilm_pro_400h: "PRO400H",
  fujifilm_provia_100f: "FUJI RDPIII",
  fujifilm_velvia_100: "RVP100",
  kodak_vision3_50d: "EASTMAN 5203",
  kodak_vision3_250d: "EASTMAN 5207",
  kodak_vision3_200t: "EASTMAN 5213",
  kodak_vision3_500t: "EASTMAN 5219",
  cinestill_800t: "CINESTILL 800T",
  kodak_tri_x_400: "KODAK 400TX",
  kodak_tmax_100: "KODAK 100TMX",
  fujifilm_neopan_acros_100_ii: "FUJI 100 ACROS II",
  ilford_hp5_plus_400: "ILFORD HP5 PLUS",
};

// DX 编码：Kodak 版式（含 E100）有 DX 条码；富士反转片点阵版式没有
const DX_CODE = {
  kodak_gold_200: 1207,
  kodak_portra_160: 1221,
  kodak_portra_400: 1277,
  kodak_portra_800: 1273,
  kodak_portra_800_push1: 1273,
  kodak_portra_800_push2: 1273,
  kodak_ultramax_400: 1263,
  kodak_ektar_100: 1241,
  kodak_ektachrome_100: 382,
  fujifilm_c200: 1847,
  fujifilm_xtra_400: 1807,
  fujifilm_pro_400h: 1877,
  cinestill_800t: 2783,
  kodak_tri_x_400: 1107,
  kodak_tmax_100: 1101,
  ilford_hp5_plus_400: 1707,
  fujifilm_neopan_acros_100_ii: 1907,
};

function currentFilm() {
  return state.manifest && state.manifest.films.find((f) => f.id === state.filmId);
}

/** 反转片（正片）：中性黑片基，片边墨色随胶卷不同。 */
function isPositiveFilm() {
  const film = currentFilm();
  return !!film && film.type === "positive";
}

/**
 * 135 片边版式。app 的 overscan.cpp 按胶卷分版式：
 * 富士反转片（RVP/RDPIII）是自家点阵版式，格号在片门左端、上下两条边各一个；
 * 柯达系（含 E100、Kodachrome）用 Kodak 版式。
 */
function filmEdgeLayout() {
  return state.filmId === "fujifilm_velvia_100" || state.filmId === "fujifilm_provia_100f"
    ? "fujiSlide"
    : "kodak";
}

// 片边墨色：取自 app 对真实底片的实测值（RVP (1,.89,.41)、RDPIII (1,.80,.32)、
// E100 (1,.95,.92)）；其余沿用 Kodak 负片的棕橙色。
const EDGE_INK = {
  fujifilm_velvia_100: "#ffe369",
  fujifilm_provia_100f: "#ffcc52",
  kodak_ektachrome_100: "#fff2eb",
};
function edgeInkColor() {
  return EDGE_INK[state.filmId] || "#e2a24a";
}

/** 当前胶卷的片边字：优先用实测边码，其余按胶卷名去掉括号后缀。 */
function currentEdgeText() {
  const film = currentFilm();
  if (!film) return "DIGITAL FILM";
  if (EDGE_TEXT[film.id]) return EDGE_TEXT[film.id];
  return film.name.replace(/\s*\(.*$/, "").trim().toUpperCase();
}

/** 31 模块 DX 码：时钟轨 + 数据轨，数据位编码胶卷号与格号。 */
function dxBits(dx, frame, half) {
  const bits = new Array(23).fill(0);
  const part1 = (dx >> 4) & 0x7f;
  const part2 = dx & 0xf;
  for (let i = 1; i <= 7; i += 1) bits[i] = (part1 >> (7 - i)) & 1;
  for (let i = 0; i < 4; i += 1) bits[9 + i] = (part2 >> (3 - i)) & 1;
  const num = (frame + (half ? 1 : 0)) & 0x3f;
  for (let i = 0; i < 6; i += 1) bits[13 + i] = (num >> (5 - i)) & 1;
  return bits;
}

/** 按像素画一段 DX 条码，sMm 为起始位置（相对片门左缘）。 */
function drawDxCode(ctx, spec, sMm, frame, half) {
  if (filmEdgeLayout() === "fujiSlide") return;
  const dx = DX_CODE[state.filmId];
  if (dx === undefined) return;
  const scale = spec.scale;
  const mod = (12.7 / 31) * scale;
  const x0 = spec.padX + sMm * scale;
  const bits = dxBits(dx, frame, half);
  const clock = [];
  const data = [];
  for (let i = 0; i < 31; i += 1) {
    clock.push(i < 5 || i >= 28 ? 1 : (i - 5) % 2);
    if (i < 5) data.push(i % 2 === 0 ? 1 : 0);
    else if (i >= 28) data.push((i - 28) % 2 === 0 ? 1 : 0);
    else data.push(bits[i - 5]);
  }
  const track = (pattern, y0, y1) => {
    for (let i = 0; i < 31; i += 1) {
      if (!pattern[i]) continue;
      let j = i;
      while (j + 1 < 31 && pattern[j + 1]) j += 1;
      ctx.fillRect(x0 + i * mod, y0, (j - i + 1) * mod, y1 - y0);
      i = j;
    }
  };
  ctx.fillStyle = edgeInkColor();
  // 真实 135 片边：条码总高约 2.17mm，比齿孔（1.98mm）更高，
  // 顶端伸到齿孔下缘之上，齿孔之间的间隙里能看到条码上沿。
  // 时钟轨在上、数据轨在下，齿孔最后绘制会裁掉压进孔位的部分。
  track(clock, spec.h - 2.17 * scale, spec.h - 0.87 * scale);
  track(data, spec.h - 0.87 * scale, spec.h);
}

/** 片边数字：app 用横向拉伸 1.25 的粗体。 */
function drawEdgeNumber(ctx, text, x, y, size, align, color, wide = true) {
  ctx.save();
  ctx.translate(x, y);
  if (wide) ctx.scale(1.25, 1);
  ctx.font = `700 ${Math.max(5, Math.round(size))}px Helvetica, Arial, sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/** 把片边字横向压到给定宽度内（app 的 fit_edge_text），避免长片名压到格号上。 */
function fillFittedText(ctx, text, x, y, maxW) {
  const w = ctx.measureText(text).width;
  ctx.save();
  ctx.translate(x, y);
  if (w > maxW) ctx.scale(maxW / w, 1);
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/** 过卷箭头：一段横杆 + 三角箭头，tip 指向走片方向（app 的 wind_arrow）。 */
function drawWindArrow(ctx, tail, tip, cy, halfH, shaftH) {
  const head = Math.min((tip - tail) * 0.4, halfH * 2.4);
  ctx.fillRect(tail, cy - shaftH / 2, Math.max(0, tip - tail - head), shaftH);
  ctx.beginPath();
  ctx.moveTo(tip, cy);
  ctx.lineTo(tip - head, cy - halfH);
  ctx.lineTo(tip - head, cy + halfH);
  ctx.closePath();
  ctx.fill();
}

/** 135 片边字：Kodak 版式与富士反转片点阵版式的位置不同。 */
function drawFilmEdgeText(ctx, spec) {
  const scale = spec.scale;
  const gw = (spec.w - spec.padX * 2) / scale;
  const X = (mm) => spec.padX + clamp(mm, 0, gw) * scale;
  const color = edgeInkColor();
  const number = 13;
  const bottomMm = spec.h / scale;

  if (filmEdgeLayout() === "fujiSlide") {
    // 富士反转片（RVP100 / FUJI RDPIII），135：格号在片门左端、上下两条片边各一个
    // （基线上边 1.80mm、下边 0.27mm）；胶卷名在顶边靠右（基线 1.77mm）；
    // 半格是「36 ▸ 12A」（基线离片边 0.40mm）；没有 DX 条码。
    const numSize = (1.55 / 0.714) * scale;
    const nameSize = (1.04 / 0.714) * scale;
    drawEdgeNumber(ctx, String(number), X(3.4), 1.8 * scale, numSize, "left", color, false);
    drawEdgeNumber(ctx, String(number), X(3.4), (bottomMm - 0.27) * scale, numSize, "left", color, false);

    const name = currentEdgeText();
    ctx.fillStyle = color;
    ctx.font = `700 ${Math.max(5, Math.round(nameSize))}px Helvetica, Arial, sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    const nameX = Math.max(X(0.5), Math.min(X(19.4), X(gw - 0.4) - ctx.measureText(name).width));
    ctx.fillText(name, nameX, 1.77 * scale);

    const aSize = (0.9 / 0.714) * scale;
    ctx.font = `700 ${Math.max(5, Math.round(aSize))}px Helvetica, Arial, sans-serif`;
    const foot = bottomMm - 0.4;
    ctx.fillText("36", X(14.75), foot * scale);
    drawWindArrow(ctx, X(16.05), X(18.55), (foot - 0.59) * scale, 0.59 * scale, Math.max(1, 0.18 * scale));
    ctx.fillText(`${number - 1}A`, X(18.88), foot * scale);
    return;
  }

  if (isPositiveFilm()) {
    // 柯达反转片（E100 / Kodachrome）用 Kodak 版式的半格帧：
    // 顶边是胶卷名（起点 6.4mm，按 app 的槽宽收缩），底边是「12A」和
    // 3.6mm 长的过卷箭头（中线离片边 0.28mm）；E100 保留 DX 条码。
    const pSize = (1.22 / 0.714) * scale;
    ctx.fillStyle = color;
    ctx.font = `700 ${Math.max(6, Math.round(pSize))}px Helvetica, Arial, sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    fillFittedText(ctx, currentEdgeText(), X(6.4), 1.53 * scale, X(gw - 0.6) - X(6.4));

    // 半格帧「12A」的 DX 数据也按 12 编码
    drawDxCode(ctx, spec, 1, number - 1, false);
    // 第二段 DX 码在 19mm 处，只有画幅够宽（约 3:2 的 135 全幅）才放得下
    if (gw > 32.5) drawDxCode(ctx, spec, 19, number + 1, true);

    const paSize = (0.9 / 0.714) * scale;
    ctx.fillStyle = color;
    ctx.font = `700 ${Math.max(5, Math.round(paSize))}px Helvetica, Arial, sans-serif`;
    ctx.fillText(`${number - 1}A`, X(15.3), (bottomMm - 0.84) * scale);
    drawWindArrow(ctx, X(14.47), X(18.07), (bottomMm - 0.28) * scale, 0.26 * scale, Math.max(1, 0.18 * scale));
    return;
  }

  // Kodak 版式：上边胶卷名与格号，下边 DX 码、半格号、过卷箭头与格号。
  const nameSize = (1.22 / 0.714) * scale;
  ctx.fillStyle = color;
  ctx.font = `700 ${Math.max(6, Math.round(nameSize))}px Helvetica, Arial, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  // 给右上角格号留出位置，长片名横向收缩，避免压字
  const numW = ctx.measureText(String(number)).width * 1.25;
  fillFittedText(ctx, currentEdgeText(), X(6.4), 1.53 * scale, X(gw - 0.35) - numW - X(6.4) - 0.6 * scale);

  drawEdgeNumber(ctx, String(number), X(gw - 0.35), 1.53 * scale, nameSize, "right", color);

  drawDxCode(ctx, spec, 1, number, false);
  if (gw > 32.5) drawDxCode(ctx, spec, 19, number + 1, true);

  const aSize = (0.9 / 0.714) * scale;
  ctx.font = `700 ${Math.max(5, Math.round(aSize))}px Helvetica, Arial, sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.fillText(`${number - 1}A`, X(15.3), (bottomMm - 0.84) * scale);

  // 过卷方向箭头：紧贴半格号左侧、与文字同一中线（参考真实底片为实心小箭头）
  const arrowTip = X(15.15);
  const arrowTail = X(13.95);
  const arrowY = (bottomMm - 1.29) * scale;
  const halfH = Math.max(1.5, 0.24 * scale);
  if (arrowTip - arrowTail > 0.6 * scale) {
    ctx.beginPath();
    ctx.moveTo(arrowTip, arrowY);
    ctx.lineTo(arrowTail, arrowY - halfH);
    ctx.lineTo(arrowTail, arrowY + halfH);
    ctx.closePath();
    ctx.fill();
  }

  drawEdgeNumber(ctx, String(number), X(gw - 0.3), (bottomMm - 0.14) * scale, (1.4 / 0.714) * scale, "right", color);
}

function drawFramed(ctx, photo, spec) {
  if (spec.style === "white") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, spec.w, spec.h);
    ctx.drawImage(photo, spec.padX, spec.padY);
    return;
  }
  if (spec.style === "film") {
    // 片基：负片是棕褐色，反转片是中性黑片基、白色片边字
    const positive = isPositiveFilm();
    const fog = ctx.createLinearGradient(0, 0, 0, spec.h);
    fog.addColorStop(0, positive ? "#2b2a26" : "#38291d");
    fog.addColorStop(0.1, positive ? "#111110" : "#181310");
    fog.addColorStop(0.9, positive ? "#111110" : "#181310");
    fog.addColorStop(1, positive ? "#2b2a26" : "#38291d");
    ctx.fillStyle = fog;
    ctx.fillRect(0, 0, spec.w, spec.h);

    const radius = Math.max(1, Math.round(FRAME_MM.gateRadius * spec.scale));
    ctx.save();
    roundRect(ctx, spec.padX, spec.padY, spec.w - spec.padX * 2, spec.h - spec.padY * 2, radius);
    ctx.clip();
    ctx.drawImage(photo, spec.padX, spec.padY, spec.w - spec.padX * 2, spec.h - spec.padY * 2);
    ctx.restore();
    // 片门边缘的一线反光
    ctx.strokeStyle = "rgba(255, 238, 210, 0.16)";
    ctx.lineWidth = Math.max(1, Math.round(spec.scale * 0.12));
    roundRect(ctx, spec.padX, spec.padY, spec.w - spec.padX * 2, spec.h - spec.padY * 2, radius);
    ctx.stroke();

    drawFilmEdgeText(ctx, spec);
    // 齿孔是冲孔，最后绘制以遮挡压到孔位的片边字
    drawSprockets(ctx, spec);
    return;
  }
  ctx.drawImage(photo, 0, 0);
}

/** 给已渲染好的画布套上当前边框，导出与预览共用。 */
function applyFrame(source) {
  const spec = frameSpec(source.width, source.height, state.frame);
  if (spec.style === "none") return source;
  const canvas = document.createElement("canvas");
  canvas.width = spec.w;
  canvas.height = spec.h;
  drawFramed(canvas.getContext("2d"), source, spec);
  return canvas;
}

/** 重绘预览；分屏/按住看原图在照片区合成，最后套边框。 */
function paintView() {
  const frame = state.lastFrame;
  if (!frame) return;
  const { out, src } = frame;
  const w = src.w;
  const h = src.h;

  photoLayer.width = w;
  photoLayer.height = h;
  const pctx = photoLayer.getContext("2d");
  if (state.compareHold && state.mode === "single") {
    pctx.putImageData(new ImageData(src.data, w, h), 0, 0);
  } else if (state.split && state.mode === "single") {
    const sx = clamp(Math.round(w * state.splitRatio), 0, w);
    pctx.putImageData(new ImageData(src.data, w, h), 0, 0);
    if (sx < w) {
      procLayer.width = w;
      procLayer.height = h;
      procLayer.getContext("2d").putImageData(new ImageData(out, w, h), 0, 0);
      pctx.drawImage(procLayer, sx, 0, w - sx, h, sx, 0, w - sx, h);
    }
  } else {
    pctx.putImageData(new ImageData(out, w, h), 0, 0);
  }

  const spec = frameSpec(w, h, state.frame);
  if (el.canvas.width !== spec.w || el.canvas.height !== spec.h) {
    el.canvas.width = spec.w;
    el.canvas.height = spec.h;
  }
  const ctx = el.canvas.getContext("2d");
  ctx.clearRect(0, 0, spec.w, spec.h);
  drawFramed(ctx, photoLayer, spec);
}

function syncSplitLine() {
  const on = state.split && state.mode === "single" && state.lastFrame;
  el.splitLine.hidden = !on;
  if (on) {
    const { src } = state.lastFrame;
    const spec = frameSpec(src.w, src.h, state.frame);
    el.splitLine.style.left = `${(((spec.padX + src.w * state.splitRatio) / spec.w) * 100).toFixed(2)}%`;
  }
  el.splitBtn.classList.toggle("is-active", on);
}

let renderTimer = 0;
function schedule(delay = 0) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    render();
  }, delay);
}

/* ---------- UI 同步 ---------- */

function hasSource() {
  if (state.mode === "single") return state.batch.length > 0 || !!state.images.single;
  return !!(state.images.lower && state.images.upper);
}

function syncImages() {
  for (const slot of ["single", "lower", "upper"]) {
    // 单张模式优先显示队列里选中的照片
    const item = slot === "single" ? batchItem() || state.images.single : state.images[slot];
    const thumb = el.thumbs[slot];
    const img = thumb.querySelector("img");
    const plus = thumb.querySelector(".thumb-plus");
    const nameEl = slot === "single" ? el.singleName : slot === "lower" ? el.lowerName : el.upperName;
    if (item) {
      img.src = item.url;
      img.hidden = false;
      plus.hidden = true;
      nameEl.textContent = item.name;
      nameEl.title = item.name;
    } else {
      img.removeAttribute("src");
      img.hidden = true;
      plus.hidden = false;
      nameEl.textContent = "未选择";
      nameEl.removeAttribute("title");
    }
  }
  el.swap.disabled = !(state.images.lower && state.images.upper);
  el.scale.disabled = !state.images.upper;
  el.rotate.disabled = !state.images.upper;
  el.flip.disabled = !state.images.upper;
  el.reset.disabled = !state.images.upper;
  el.exportBtn.disabled = !hasSource();
  el.splitBtn.disabled = state.mode !== "single" || !hasSource();
  el.compare.disabled = state.mode !== "single" || !hasSource();
  el.resetAll.disabled = !hasSource();
  if (!hasSource()) el.exportNote.textContent = "载入照片后可导出。";
}

function syncExposure() {
  const ev = currentEv();
  el.auto.checked = state.auto;
  el.ev.disabled = state.auto;
  el.ev.value = String(ev);
  el.evVal.textContent = `${ev > 0 ? "+" : ""}${ev.toFixed(1)} EV`;
  el.evTag.textContent = state.auto ? "自动" : "手动";
  el.strength.value = String(Math.round(state.strength * 100));
  el.strengthVal.textContent = `${Math.round(state.strength * 100)}%`;
}

function syncLook() {
  el.film.value = state.filmId;
  el.paper.value = state.paperId;
  const film = state.manifest.films.find((f) => f.id === state.filmId);
  const positive = !!film && film.type === "positive";
  el.filmType.textContent = positive ? "反转片" : "负片";
  // 反转片直接扫描，没有相纸环节
  el.paper.disabled = positive;
  el.paper.title = positive ? "反转片直接扫描，不使用相纸" : "";
  const t = state.transform;
  el.scale.value = String(t.scale);
  el.scaleVal.textContent = `${t.scale.toFixed(2)}×`;
  el.flip.classList.toggle("is-active", !!t.flip);
  el.balanceTag.textContent = `${Math.round(state.balance * 100)}% 上层`;
}

function syncMode() {
  for (const seg of el.segs) {
    const active = seg.dataset.mode === state.mode;
    seg.classList.toggle("is-active", active);
    seg.setAttribute("aria-selected", active ? "true" : "false");
  }
  el.paneSingle.hidden = state.mode !== "single";
  el.paneDouble.hidden = state.mode !== "double";
  el.doubleControls.hidden = state.mode !== "double";
  // 双重曝光只做两底叠加，不套胶片与相纸
  el.lookCard.hidden = state.mode === "double";
  el.exposureCard.hidden = state.mode === "double";
  el.fileInput.multiple = state.mode === "single";
  el.splitBtn.disabled = state.mode !== "single" || !hasSource();
  el.compare.disabled = state.mode !== "single" || !hasSource();
  syncSplitLine();
  el.stageNote.textContent = state.mode === "single"
    ? "胶片冲印：可一次多选，队列按同一组胶片与曝光批量导出。"
    : "双重曝光：两层按光量叠加，不套胶片与相纸。";
  el.exportBtn.disabled = !hasSource();
  syncBatch();
}

function setMode(mode) {
  if (mode === state.mode) return;
  state.mode = mode;
  if (mode !== "single") {
    state.split = false;
    state.compareHold = false;
  }
  state.autoDirty = true;
  syncMode();
  syncImages();
  render();
}

function applyFilmChange(id) {
  state.filmId = id;
  const film = state.manifest.films.find((f) => f.id === id);
  const target = film && film.targetPrint;
  if (target && state.manifest.papers.some((p) => p.id === target)) {
    state.paperId = target;
  }
  syncLook();
}

/* ---------- 事件 ---------- */

document.querySelectorAll("[data-pick]").forEach((btn) => {
  btn.addEventListener("click", () => pickInto(btn.dataset.pick));
});

el.segs.forEach((seg) => {
  seg.addEventListener("click", () => setMode(seg.dataset.mode));
});

el.fileInput.addEventListener("change", () => {
  const files = el.fileInput.files;
  if (!files || !files.length) return;
  if (state.mode === "single") {
    addBatchFiles(files);
    return;
  }
  const file = files[0];
  if (file && state.pick) handleFile(file, state.pick);
});

["pointerdown"].forEach((name) => {
  el.compare.addEventListener(name, (e) => {
    if (el.compare.disabled) return;
    e.preventDefault();
    state.compareHold = true;
    paintView();
  });
});
["pointerup", "pointercancel", "pointerleave"].forEach((name) => {
  el.compare.addEventListener(name, () => {
    if (!state.compareHold) return;
    state.compareHold = false;
    paintView();
  });
});

el.frame.addEventListener("change", () => {
  state.frame = el.frame.value;
  paintView();
  syncSplitLine();
  if (state.lastFrame) {
    const spec = frameSpec(state.lastFrame.src.w, state.lastFrame.src.h, state.frame);
    el.exportNote.textContent = `输出 ${spec.w} × ${spec.h}`;
  }
});

el.splitBtn.addEventListener("click", () => {
  if (state.mode !== "single" || !hasSource()) return;
  state.split = !state.split;
  paintView();
  syncSplitLine();
});

/** 重置参数：回到默认胶卷、自动曝光、强度 100%、双重曝光构图复位。 */
function resetParams() {
  const films = state.manifest ? state.manifest.films : [];
  const target = films.some((f) => f.id === DEFAULT_FILM)
    ? DEFAULT_FILM
    : (films[0] && films[0].id) || state.filmId;
  applyFilmChange(target);
  state.auto = true;
  state.autoDirty = true;
  state.ev = 0;
  state.strength = 1;
  state.balance = 0.5;
  state.transform = { x: 0, y: 0, scale: 1, rot: 0, flip: false };
  state.split = false;
  state.compareHold = false;
  state.frame = "none";
  el.frame.value = "none";
  state.batch.forEach((item) => {
    item.autoEv = 0;
    item.autoDirty = true;
  });
  syncLook();
  syncExposure();
  syncImages();
  syncSplitLine();
  schedule(0);
}

el.resetAll.addEventListener("click", resetParams);

let splitDrag = false;
const setSplitFromEvent = (e) => {
  const rect = el.canvas.getBoundingClientRect();
  if (!rect.width || !state.lastFrame) return;
  const { src } = state.lastFrame;
  const spec = frameSpec(src.w, src.h, state.frame);
  const x = ((e.clientX - rect.left) / rect.width) * spec.w;
  state.splitRatio = clamp((x - spec.padX) / src.w, 0.02, 0.98);
  paintView();
  syncSplitLine();
};
el.canvasWrap.addEventListener("pointerdown", (e) => {
  if (!(state.split && state.mode === "single")) return;
  splitDrag = true;
  el.canvasWrap.setPointerCapture(e.pointerId);
  setSplitFromEvent(e);
});
el.canvasWrap.addEventListener("pointermove", (e) => {
  if (splitDrag) setSplitFromEvent(e);
});
["pointerup", "pointercancel"].forEach((name) => {
  el.canvasWrap.addEventListener(name, () => {
    splitDrag = false;
  });
});

el.film.addEventListener("change", () => {
  applyFilmChange(el.film.value);
  schedule(0);
});

el.paper.addEventListener("change", () => {
  state.paperId = el.paper.value;
  schedule(0);
});

el.auto.addEventListener("change", () => {
  state.auto = el.auto.checked;
  state.autoDirty = state.auto;
  syncExposure();
  schedule(0);
});

el.ev.addEventListener("input", () => {
  state.auto = false;
  state.autoDirty = false;
  state.ev = parseFloat(el.ev.value);
  syncExposure();
  schedule(180);
});

el.strength.addEventListener("input", () => {
  state.strength = parseInt(el.strength.value, 10) / 100;
  el.strengthVal.textContent = `${Math.round(state.strength * 100)}%`;
  schedule(40);
});

el.balance.addEventListener("input", () => {
  state.balance = clamp(parseInt(el.balance.value, 10) / 100, 0.1, 0.9);
  el.balanceTag.textContent = `${Math.round(state.balance * 100)}% 上层`;
  schedule(30);
});

el.scale.addEventListener("input", () => {
  state.transform.scale = parseFloat(el.scale.value);
  el.scaleVal.textContent = `${state.transform.scale.toFixed(2)}×`;
  schedule(30);
});

el.rotate.addEventListener("click", () => {
  state.transform.rot = (state.transform.rot + 90) % 360;
  schedule(0);
});

el.flip.addEventListener("click", () => {
  state.transform.flip = !state.transform.flip;
  el.flip.classList.toggle("is-active", state.transform.flip);
  schedule(0);
});

el.reset.addEventListener("click", () => {
  state.transform = { x: 0, y: 0, scale: 1, rot: 0, flip: false };
  syncLook();
  schedule(0);
});

el.swap.addEventListener("click", () => {
  if (!(state.images.lower && state.images.upper)) return;
  const lower = state.images.lower;
  state.images.lower = state.images.upper;
  state.images.upper = lower;
  const img = state.images.lower.img;
  state.frame = { w: img.naturalWidth || img.width, h: img.naturalHeight || img.height };
  state.transform = { x: 0, y: 0, scale: 1, rot: 0, flip: false };
  state.autoDirty = true;
  syncImages();
  syncLook();
  schedule(0);
});

/* 画布拖动上层 */
let drag = null;
el.canvas.addEventListener("pointerdown", (e) => {
  if (state.mode !== "double" || !(state.images.lower && state.images.upper)) return;
  el.canvas.setPointerCapture(e.pointerId);
  drag = { x: e.clientX, y: e.clientY, tx: state.transform.x, ty: state.transform.y };
  el.canvas.classList.add("is-dragging");
});
el.canvas.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const rect = el.canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  state.transform.x = clamp(drag.tx + (e.clientX - drag.x) / rect.width, -2, 2);
  state.transform.y = clamp(drag.ty + (e.clientY - drag.y) / rect.height, -2, 2);
  schedule(16);
});
const endDrag = () => {
  drag = null;
  el.canvas.classList.remove("is-dragging");
};
el.canvas.addEventListener("pointerup", endDrag);
el.canvas.addEventListener("pointercancel", endDrag);

/* 视口拖放 */
const stop = (e) => {
  e.preventDefault();
  e.stopPropagation();
};
el.viewport.addEventListener("dragenter", (e) => {
  stop(e);
  el.viewport.classList.add("is-dragover");
});
el.viewport.addEventListener("dragover", (e) => {
  stop(e);
  el.viewport.classList.add("is-dragover");
});
el.viewport.addEventListener("dragleave", (e) => {
  if (e.target === el.viewport) el.viewport.classList.remove("is-dragover");
});
el.viewport.addEventListener("drop", (e) => {
  stop(e);
  el.viewport.classList.remove("is-dragover");
  const files = e.dataTransfer && e.dataTransfer.files;
  if (!files || !files.length) return;
  if (state.mode === "single") {
    addBatchFiles(files);
    return;
  }
  handleFile(files[0], state.images.lower ? "upper" : "lower");
});

/* 导出格式与 auto-tone / film-autoclip 保持一致：跟随原图 / JPEG / PNG / WEBP / BMP / TIFF */
const EXPORT_FORMATS = {
  "image/jpeg": { ext: "jpg", mime: "image/jpeg" },
  "image/png": { ext: "png", mime: "image/png" },
  "image/webp": { ext: "webp", mime: "image/webp" },
  "image/bmp": { ext: "bmp", mime: "image/bmp", isBmp: true },
  "image/tiff": { ext: "tif", mime: "image/tiff", isTiff: true },
};

function sourceFormatFrom(file) {
  const name = ((file && file.name) || "").toLowerCase();
  const type = ((file && file.type) || "").toLowerCase();
  const ext = name.includes(".") ? name.split(".").pop() : "";
  if (type === "image/png" || ext === "png") return EXPORT_FORMATS["image/png"];
  if (type === "image/webp" || ext === "webp") return EXPORT_FORMATS["image/webp"];
  if (["image/bmp", "image/x-bmp", "image/x-ms-bmp"].includes(type) || ext === "bmp") {
    return EXPORT_FORMATS["image/bmp"];
  }
  if (type === "image/tiff" || ext === "tif" || ext === "tiff") return EXPORT_FORMATS["image/tiff"];
  return EXPORT_FORMATS["image/jpeg"];
}

function resolveExportFormat(choice, file) {
  return choice === "original" ? sourceFormatFrom(file) : (EXPORT_FORMATS[choice] || EXPORT_FORMATS["image/jpeg"]);
}

/** 当前照片的原始文件，用于「跟随原图」判断格式。 */
function currentFile() {
  const item = batchItem();
  return (item && item.file) || (state.images.single && state.images.single.file) || null;
}

function encodeBmpCanvas(canvas) {
  const width = canvas.width;
  const height = canvas.height;
  const rowStride = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowStride * height;
  const headerBytes = 54;
  const fileSize = headerBytes + pixelBytes;
  if (!width || !height || !Number.isSafeInteger(fileSize) || fileSize > 0xffffffff) {
    throw new Error("BMP 输出尺寸过大");
  }
  const rgba = canvas.getContext("2d").getImageData(0, 0, width, height).data;
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
  return new Blob([output], { type: "image/bmp" });
}

function encodeCanvas(canvas, format) {
  if (format.isBmp) return Promise.resolve(encodeBmpCanvas(canvas));
  if (format.isTiff) {
    try {
      if (typeof UTIF === "undefined") throw new Error("TIFF 编码器不可用");
      const rgba = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      return Promise.resolve(new Blob([UTIF.encodeImage(rgba, canvas.width, canvas.height)], { type: "image/tiff" }));
    } catch (error) {
      return Promise.reject(error);
    }
  }
  return new Promise((resolve) => canvas.toBlob(resolve, format.mime, 0.95));
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function safeBase(name) {
  return (name || "image").replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 80) || "image";
}

/* 导出 */
async function exportCanvas() {
  const src = buildSource(MAX_EXPORT);
  if (!src) return null;
  const canvas = document.createElement("canvas");
  canvas.width = src.w;
  canvas.height = src.h;
  const ctx = canvas.getContext("2d");
  if (state.mode === "double") {
    // 双重曝光不套胶片与相纸，直接导出叠加结果
    ctx.putImageData(new ImageData(src.data, src.w, src.h), 0, 0);
    return applyFrame(canvas);
  }
  const ev = currentEv(batchItem());
  setStatus("渲染导出…");
  await tick();
  let lut;
  try {
    lut = await ensureLut(ev);
  } catch (err) {
    setStatus(String(err.message || err));
    return null;
  }
  const out = applyLut(src.data, src.w, src.h, lut, LUT_SIDE, state.strength);
  ctx.putImageData(new ImageData(out, src.w, src.h), 0, 0);
  setStatus(null);
  return applyFrame(canvas);
}

el.exportBtn.addEventListener("click", async () => {
  if (!hasSource() || state.busy) return;
  const item = batchItem();
  const format = resolveExportFormat(el.format.value, currentFile());
  const canvas = await exportCanvas();
  if (!canvas) return;
  try {
    const blob = await encodeCanvas(canvas, format);
    if (!blob) {
      setStatus("编码失败");
      return;
    }
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
    const base = item ? safeBase(item.name) : "";
    downloadBlob(blob, base ? `${base}-film-color.${format.ext}` : `film-color-${stamp}.${format.ext}`);
  } catch (err) {
    setStatus(String(err.message || err));
  }
});

/* ---------- 批量 ---------- */

async function addBatchFiles(files) {
  const list = Array.from(files || []).filter(isImageFile);
  if (!list.length) {
    setStatus("请选择图片文件");
    return;
  }
  const room = MAX_QUEUE - state.batch.length;
  if (room <= 0) {
    setStatus(`队列最多 ${MAX_QUEUE} 张，请先移除部分照片`);
    return;
  }
  const queue = list.slice(0, room);
  const startIndex = state.batch.length;
  let added = 0;
  for (let index = 0; index < queue.length; index += 1) {
    const file = queue[index];
    setStatus(`读取 ${index + 1}/${queue.length}：${file.name || "图片"}…`);
    await tick();
    let url = "";
    try {
      url = await fileToUrl(file);
      const img = await loadImage(url);
      state.batch.push({
        img,
        url,
        name: file.name || "未命名",
        file,
        type: file.type || "",
        frame: { w: img.naturalWidth || img.width, h: img.naturalHeight || img.height },
        autoEv: 0,
        autoDirty: true,
      });
      added += 1;
    } catch {
      if (url.startsWith("blob:")) URL.revokeObjectURL(url);
    }
  }
  if (!added) {
    setStatus("这些图片都无法解码");
    syncBatch();
    return;
  }
  // 选中本次新加入的第一张，便于直接预览
  state.batchIndex = startIndex;
  state.autoDirty = true;
  syncBatch();
  await render();
  setStatus(list.length > room ? `队列最多 ${MAX_QUEUE} 张，已忽略 ${list.length - room} 张` : null);
}

function removeBatchItem(index) {
  const removed = state.batch.splice(index, 1)[0];
  if (removed && removed.url.startsWith("blob:")) URL.revokeObjectURL(removed.url);
  if (state.batchIndex >= state.batch.length) state.batchIndex = Math.max(0, state.batch.length - 1);
  syncBatch();
  render();
}

function syncBatch() {
  const count = state.batch.length;
  el.batchCount.textContent = count ? `已选择 ${count} 张，点选可预览` : "未选择";
  el.batchList.hidden = count === 0;
  el.batchClear.disabled = count === 0;
  el.batchClear.hidden = count === 0;
  // 「批量导出」导出整个队列，至少两张时才出现
  el.exportAll.hidden = state.mode !== "single" || count < 2;
  el.exportAll.disabled = count < 2 || state.busy;
  el.exportAll.textContent = count >= 2 ? `批量导出 ${count} 张` : "批量导出";
  el.batchList.textContent = "";
  state.batch.forEach((item, index) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = index === state.batchIndex ? "batch-item is-active" : "batch-item";
    const thumb = document.createElement("img");
    thumb.src = item.url;
    thumb.alt = "";
    const name = document.createElement("span");
    name.className = "batch-name";
    name.textContent = item.name;
    name.title = item.name;
    const remove = document.createElement("span");
    remove.className = "batch-remove";
    remove.textContent = "×";
    remove.title = "移除";
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      removeBatchItem(index);
    });
    row.append(thumb, name, remove);
    row.addEventListener("click", () => {
      if (state.batchIndex === index) return;
      state.batchIndex = index;
      syncBatch();
      render();
    });
    el.batchList.append(row);
  });
  syncImages();
}

async function pickBatchDir() {
  if (typeof window.showDirectoryPicker !== "function") return { supported: false, dir: null };
  try {
    const dir = await window.showDirectoryPicker({ id: "film-color-batch", mode: "readwrite" });
    return { supported: true, dir };
  } catch {
    return { supported: true, dir: null };
  }
}

async function writeToDir(dir, name, blob) {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

/** 批量导出与 auto-tone 一致：优先写入所选文件夹，浏览器不支持时逐张下载。 */
async function exportBatch() {
  if (state.busy || state.batch.length < 2) return;
  const picked = await pickBatchDir();
  if (picked.supported && !picked.dir) return;
  const total = state.batch.length;
  state.busy = true;
  syncBatch();
  let done = 0;
  try {
    for (let index = 0; index < total; index += 1) {
      const item = state.batch[index];
      el.exportAll.textContent = `处理中 ${index + 1}/${total}`;
      setStatus(`批量冲印 ${index + 1}/${total}：${item.name}…`);
      await tick();
      // 自动曝光按每张单独测光（与单张模式一致），导出前补齐未预览过的项
      if (state.auto && item.autoDirty) {
        const sample = singleSource(item, MAX_PREVIEW);
        if (sample) item.autoEv = clamp(centerWeightedEv(sample.data, sample.w, sample.h), -3, 3);
        item.autoDirty = false;
      }
      const src = singleSource(item, MAX_EXPORT);
      if (!src) continue;
      const lut = await ensureLut(currentEv(item));
      const out = applyLut(src.data, src.w, src.h, lut, LUT_SIDE, state.strength);
      const canvas = document.createElement("canvas");
      canvas.width = src.w;
      canvas.height = src.h;
      canvas.getContext("2d").putImageData(new ImageData(out, src.w, src.h), 0, 0);
      const format = resolveExportFormat(el.format.value, item.file);
      const blob = await encodeCanvas(applyFrame(canvas), format);
      if (!blob) throw new Error(`${item.name} 编码失败`);
      const name = `${safeBase(item.name)}-film-color.${format.ext}`;
      if (picked.dir) await writeToDir(picked.dir, name, blob);
      else downloadBlob(blob, name);
      done += 1;
      await tick();
    }
    setStatus(picked.dir ? `已导出 ${done} 张到所选文件夹` : `已导出 ${done} 张`);
  } catch (err) {
    setStatus(`批量导出中断：${err.message || err}`);
  } finally {
    state.busy = false;
    syncBatch();
  }
}

el.exportAll.addEventListener("click", exportBatch);

el.batchClear.addEventListener("click", () => {
  state.batch.forEach((item) => {
    if (item.url.startsWith("blob:")) URL.revokeObjectURL(item.url);
  });
  state.batch = [];
  state.batchIndex = 0;
  syncBatch();
  render();
});

/* ---------- 初始化 ---------- */

async function init() {
  state.manifest = await fetch(dataUrl("./data/manifest.json")).then((r) => r.json());
  const filmOptions = state.manifest.films.map((f) => `<option value="${f.id}">${f.name}</option>`);
  const paperOptions = state.manifest.papers.map((p) => `<option value="${p.id}">${p.name}</option>`);
  el.film.innerHTML = filmOptions.join("");
  el.paper.innerHTML = paperOptions.join("");

  if (!state.manifest.films.some((f) => f.id === state.filmId)) {
    state.filmId = state.manifest.films[0].id;
  }
  applyFilmChange(state.filmId);
  state.paperId = state.manifest.papers.some((p) => p.id === state.paperId)
    ? state.paperId
    : state.manifest.papers[0].id;

  syncMode();
  syncExposure();
  syncLook();
  syncImages();
  syncBatch();
  if (window.__flSelftest) window.__flSelftest.ready = true;
}

init().catch((err) => {
  setStatus(`初始化失败：${err.message || err}`);
});

/* ---------- 自动化测试入口 ---------- */

if (new URLSearchParams(location.search).has("selftest")) {
  window.__flSelftest = {
    ready: false,
    async loadSingle(url, name) {
      await setImage("single", url, name || "single-test");
      await render();
    },
    async loadPair(lowerUrl, upperUrl) {
      await setImage("lower", lowerUrl, "lower-test");
      await setImage("upper", upperUrl, "upper-test");
      await render();
    },
    async loadSingleFile(file) {
      await handleFile(file, "single");
    },
    async loadBatch(items) {
      state.batch.forEach((item) => {
        if (item.url.startsWith("blob:")) URL.revokeObjectURL(item.url);
      });
      state.batch = [];
      for (const entry of items) {
        const img = await loadImage(entry.url);
        state.batch.push({
          img,
          url: entry.url,
          name: entry.name || "batch-test",
          file: entry.file || null,
          type: entry.type || "",
          frame: { w: img.naturalWidth || img.width, h: img.naturalHeight || img.height },
          autoEv: 0,
          autoDirty: true,
        });
      }
      state.batchIndex = 0;
      syncBatch();
      await render();
    },
    async selectBatch(index) {
      state.batchIndex = clamp(index, 0, Math.max(0, state.batch.length - 1));
      syncBatch();
      await render();
    },
    batchInfo() {
      return state.batch.map((item) => item.name);
    },
    batchEvs() {
      return state.batch.map((item) => ({ name: item.name, ev: item.autoEv, dirty: item.autoDirty }));
    },
    edgeText() {
      return currentEdgeText();
    },
    setFrame(style) {
      state.frame = style || "none";
      el.frame.value = state.frame;
      paintView();
      syncSplitLine();
      if (state.lastFrame) {
        const spec = frameSpec(state.lastFrame.src.w, state.lastFrame.src.h, state.frame);
        el.exportNote.textContent = `输出 ${spec.w} × ${spec.h}`;
      }
    },
    setCompare(on) {
      state.compareHold = !!on;
      paintView();
    },
    async setSplit(on, ratio) {
      state.split = !!on;
      if (typeof ratio === "number") state.splitRatio = clamp(ratio, 0.02, 0.98);
      paintView();
      syncSplitLine();
    },
    async setMode(mode) {
      setMode(mode);
      await render();
    },
    async selectFilm(id) {
      applyFilmChange(id);
      await render();
    },
    async selectPaper(id) {
      state.paperId = id;
      syncLook();
      await render();
    },
    setAuto(value) {
      state.auto = !!value;
      state.autoDirty = state.auto;
      syncExposure();
    },
    setEv(value) {
      state.ev = value;
      syncExposure();
    },
    setStrength(value) {
      state.strength = value;
      syncExposure();
    },
    setBalance(value) {
      state.balance = clamp(value, 0.1, 0.9);
      syncLook();
    },
    setTransform(t) {
      state.transform = Object.assign({ x: 0, y: 0, scale: 1, rot: 0, flip: false }, t);
      syncLook();
    },
    async refresh() {
      await render();
    },
    stats() {
      return {
        mode: state.mode,
        filmId: state.filmId,
        paperId: state.paperId,
        ev: currentEv(),
        auto: state.auto,
        strength: state.strength,
        balance: state.balance,
        transform: { ...state.transform },
        preview: { ...state.preview },
        hasSingle: !!(batchItem() || state.images.single),
        split: state.split,
        compareHold: state.compareHold,
        frame: state.frame,
        splitRatio: state.splitRatio,
        format: el.format.value,
        hasLower: !!state.images.lower,
        hasUpper: !!state.images.upper,
        filmCount: state.manifest ? state.manifest.films.length : 0,
        paperCount: state.manifest ? state.manifest.papers.length : 0,
        lutKey: state.lutKey,
      };
    },
    sample(x, y) {
      const d = el.canvas.getContext("2d").getImageData(x, y, 1, 1).data;
      return [d[0], d[1], d[2], d[3]];
    },
    async exportDataUrl(type) {
      const canvas = await exportCanvas();
      return canvas ? canvas.toDataURL(type || "image/png") : null;
    },
  };
}
