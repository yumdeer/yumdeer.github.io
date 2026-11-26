import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { readFile, stat, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
import {
  parseFilm,
  parsePaper,
  bakeLut,
  renderPixel,
  applyLut,
  centerWeightedEv,
} from "../../public/tools/film-color/engine.js";

// 胶片滤镜（film-color）用例：
// 引擎：数据解析、LUT 烘焙与单点渲染一致、灰阶单调、自动曝光。
// 页面：24 胶卷 / 9 相纸、单张滤镜、强度混合、双重曝光、导出。

const ROOT = path.resolve(import.meta.dirname, "../../public");
const DATA = path.join(ROOT, "tools/film-color/data");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".bin": "application/octet-stream",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const readBuf = async (rel) => {
  const buf = await readFile(path.join(DATA, rel));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
};

let server;
let browser;
let origin;

before(async () => {
  server = http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
      const filePath = path.join(ROOT, pathname);
      if (!filePath.startsWith(ROOT)) {
        res.writeHead(403).end();
        return;
      }
      const info = await stat(filePath).catch(() => null);
      const resolved = info && info.isDirectory() ? path.join(filePath, "index.html") : filePath;
      const body = await readFile(resolved);
      res.writeHead(200, { "content-type": MIME[path.extname(resolved)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});

after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

async function solidUrl(page, color, size = 64) {
  return page.evaluate(
    ([c, s]) => {
      const canvas = document.createElement("canvas");
      canvas.width = s;
      canvas.height = s;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, s, s);
      return canvas.toDataURL("image/png");
    },
    [color, size]
  );
}

async function openTool() {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${origin}/tools/film-color/?selftest=1`);
  await page.waitForFunction(() => window.__flSelftest && window.__flSelftest.ready);
  return { page, errors };
}

async function neutral(page, film = "kodak_portra_400", paper = "kodak_portra_endura") {
  const url = await solidUrl(page, "#808080");
  await page.evaluate((u) => window.__flSelftest.loadSingle(u), url);
  await page.evaluate(() => window.__flSelftest.setAuto(false));
  await page.evaluate(() => window.__flSelftest.setEv(0));
  await page.evaluate(([f, p]) => window.__flSelftest.selectPaper(p).then(() => window.__flSelftest.selectFilm(f)), [film, paper]);
  await page.evaluate(() => window.__flSelftest.refresh());
  return url;
}

test("引擎：24 胶卷与 9 相纸数据可解析", async () => {
  const manifest = JSON.parse(await readFile(path.join(DATA, "manifest.json"), "utf8"));
  assert.equal(manifest.films.length, 24);
  assert.equal(manifest.papers.length, 9);
  for (const film of manifest.films) {
    const data = parseFilm(await readBuf(`films/${film.id}.bin`));
    assert.equal(data.tcSide, 96);
    assert.equal(data.tc.length, 96 * 96 * 3);
    assert.equal(data.curves.length, 768);
    assert.ok(data.tcB.length === 9);
  }
  for (const paper of manifest.papers) {
    const data = parsePaper(await readBuf(`papers/${paper.id}.bin`));
    assert.equal(data.side, 33);
    assert.equal(data.lut.length, 33 ** 3 * 3);
  }
});

test("引擎：LUT 采样与单点渲染一致", async () => {
  const film = parseFilm(await readBuf("films/kodak_portra_400.bin"));
  const paper = parsePaper(await readBuf("papers/kodak_portra_endura.bin"));
  const side = 33;
  const lut = bakeLut(film, paper, 0, side);
  const step = 255 / (side - 1);
  for (const i of [0, 8, 16, 24, 32]) {
    for (const j of [0, 16, 32]) {
      for (const k of [0, 16, 32]) {
        const r = Math.round(i * step);
        const g = Math.round(j * step);
        const b = Math.round(k * step);
        const direct = renderPixel(r, g, b, film, paper, 0);
        const sampled = applyLut(new Uint8ClampedArray([r, g, b, 255]), 1, 1, lut, side, 1);
        for (let c = 0; c < 3; c++) {
          assert.ok(Math.abs(direct[c] - sampled[c]) <= 3, `节点 ${r},${g},${b} 通道 ${c}`);
        }
      }
    }
  }
});

test("引擎：中性灰保持单调", async () => {
  const film = parseFilm(await readBuf("films/kodak_portra_400.bin"));
  const paper = parsePaper(await readBuf("papers/kodak_portra_endura.bin"));
  const lut = bakeLut(film, paper, 0);
  const side = 33;
  let prev = -1;
  for (let i = 0; i < side; i++) {
    const idx = ((i * side + i) * side + i) * 3;
    const v = lut[idx];
    assert.ok(v >= prev - 1, `灰阶在 ${i} 处回退: ${prev} -> ${v}`);
    prev = v;
  }
  assert.ok(prev > 120, "白端应明显高于黑端");
});

test("引擎：自动曝光对 18% 灰接近 0 EV", async () => {
  const n = 64;
  const data = new Uint8ClampedArray(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    data[i * 4] = 119;
    data[i * 4 + 1] = 119;
    data[i * 4 + 2] = 119;
    data[i * 4 + 3] = 255;
  }
  const ev = centerWeightedEv(data, n, n);
  assert.ok(Math.abs(ev) < 0.05, `期望接近 0，实际 ${ev}`);
});

test("页面：胶片与相纸下拉共 24 / 9 项", async () => {
  const { page, errors } = await openTool();
  try {
    const counts = await page.evaluate(() => ({
      films: document.querySelectorAll("#film option").length,
      papers: document.querySelectorAll("#paper option").length,
      stats: window.__flSelftest.stats(),
    }));
    assert.equal(counts.films, 24);
    assert.equal(counts.papers, 9);
    assert.equal(counts.stats.filmCount, 24);
    assert.equal(counts.stats.paperCount, 9);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("页面：单张滤镜生效，强度 0 还原原图", async () => {
  const { page, errors } = await openTool();
  try {
    await neutral(page);
    const look = await page.evaluate(() => window.__flSelftest.sample(32, 32));
    assert.ok(Math.abs(look[0] - 128) > 1 || Math.abs(look[1] - 128) > 1, `胶片效果未生效: ${look}`);
    await page.evaluate(() => window.__flSelftest.setStrength(0));
    await page.evaluate(() => window.__flSelftest.refresh());
    const plain = await page.evaluate(() => window.__flSelftest.sample(32, 32));
    assert.ok(Math.abs(plain[0] - 128) <= 1 && Math.abs(plain[1] - 128) <= 1, `强度 0 未还原: ${plain}`);
    assert.equal(plain[3], 255);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("页面：切换胶卷改变冲印结果", async () => {
  const { page } = await openTool();
  try {
    await neutral(page, "kodak_portra_400");
    const portra = await page.evaluate(() => window.__flSelftest.sample(32, 32));
    await page.evaluate(() => window.__flSelftest.selectFilm("fujifilm_velvia_100"));
    const velvia = await page.evaluate(() => window.__flSelftest.sample(32, 32));
    assert.notDeepEqual(portra.slice(0, 3), velvia.slice(0, 3));
  } finally {
    await page.close();
  }
});

test("页面：双重曝光平衡与未覆盖区域", async () => {
  const { page } = await openTool();
  try {
    await page.evaluate(() => window.__flSelftest.setMode("double"));
    const lower = await solidUrl(page, "#808080");
    const upper = await solidUrl(page, "#ffffff");
    await page.evaluate(([l, u]) => window.__flSelftest.loadPair(l, u), [lower, upper]);
    await page.evaluate(() => window.__flSelftest.setAuto(false));
    await page.evaluate(() => window.__flSelftest.setEv(0));
    await page.evaluate(() => window.__flSelftest.setStrength(0));

    await page.evaluate(() => window.__flSelftest.setBalance(0.5));
    await page.evaluate(() => window.__flSelftest.refresh());
    const mid = await page.evaluate(() => window.__flSelftest.sample(32, 32));
    assert.ok(Math.abs(mid[0] - 205) <= 2, `50% 平衡期望 205，实际 ${mid[0]}`);

    await page.evaluate(() => window.__flSelftest.setBalance(0.9));
    await page.evaluate(() => window.__flSelftest.refresh());
    const high = await page.evaluate(() => window.__flSelftest.sample(32, 32));
    assert.ok(Math.abs(high[0] - 246) <= 2, `90% 平衡期望 246，实际 ${high[0]}`);

    await page.evaluate(() => {
      window.__flSelftest.setTransform({ x: 0.75, y: 0, scale: 1, rot: 0, flip: false });
    });
    await page.evaluate(() => window.__flSelftest.refresh());
    const uncovered = await page.evaluate(() => window.__flSelftest.sample(2, 32));
    assert.ok(Math.abs(uncovered[0] - 128) <= 1, `未覆盖区域期望 128，实际 ${uncovered[0]}`);
  } finally {
    await page.close();
  }
});

test("页面：导出 PNG 尺寸正确并可下载", async () => {
  const { page } = await openTool();
  try {
    const url = await solidUrl(page, "#808080");
    await page.evaluate((u) => window.__flSelftest.loadSingle(u), url);
    await page.evaluate(() => window.__flSelftest.setAuto(false));
    const dataUrl = await page.evaluate(() => window.__flSelftest.exportDataUrl("image/png"));
    assert.ok(dataUrl.startsWith("data:image/png;base64,"));
    const buf = Buffer.from(dataUrl.split(",")[1], "base64");
    assert.equal(buf.readUInt32BE(16), 64);
    assert.equal(buf.readUInt32BE(20), 64);

    await page.selectOption("#format", "image/png");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.click("#export"),
    ]);
    assert.match(download.suggestedFilename(), /^film-color-\d{14}\.png$/);
    const saved = path.join(await mkdtemp(path.join(tmpdir(), "film-color-")), "out.png");
    await download.saveAs(saved);
    const file = await readFile(saved);
    assert.equal(file.readUInt32BE(16), 64);
  } finally {
    await page.close();
  }
});

test("页面：TIFF 文件（MIME 为空）可载入并出图", async () => {
  const { page, errors } = await openTool();
  try {
    await page.evaluate(() => window.__flSelftest.setAuto(false));
    const made = await page.evaluate(async () => {
      const w = 48;
      const h = 32;
      const rgba = new Uint8Array(w * h * 4);
      for (let i = 0; i < rgba.length; i += 4) {
        rgba[i] = 200;
        rgba[i + 1] = 120;
        rgba[i + 2] = 60;
        rgba[i + 3] = 255;
      }
      const buffer = UTIF.encodeImage(rgba, w, h);
      const file = new File([buffer], "scan.tif", { type: "" });
      await window.__flSelftest.loadSingleFile(file);
      return {
        name: document.querySelector("#single-name").textContent,
        w: document.querySelector("#view-canvas").width,
        h: document.querySelector("#view-canvas").height,
        note: document.querySelector("#export-note").textContent,
        statusHidden: document.querySelector("#status").hidden,
      };
    });
    assert.equal(made.name, "scan.tif");
    assert.deepEqual([made.w, made.h], [48, 32]);
    assert.match(made.note, /48 × 32/);
    assert.equal(made.statusHidden, true);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("页面：WebP / BMP 文件（MIME 为空）可载入并出图", async () => {
  const { page, errors } = await openTool();
  try {
    await page.evaluate(() => window.__flSelftest.setAuto(false));
    const results = await page.evaluate(async () => {
      const out = [];
      const read = () => [
        document.querySelector("#single-name").textContent,
        document.querySelector("#view-canvas").width,
        document.querySelector("#view-canvas").height,
      ];

      const canvas = document.createElement("canvas");
      canvas.width = 40;
      canvas.height = 24;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#3c78c8";
      ctx.fillRect(0, 0, 40, 24);
      const webpBlob = await (await fetch(canvas.toDataURL("image/webp"))).blob();
      await window.__flSelftest.loadSingleFile(new File([webpBlob], "shot.webp", { type: "" }));
      out.push(read());

      const w = 20;
      const h = 12;
      const rowSize = Math.ceil((w * 3) / 4) * 4;
      const size = 54 + rowSize * h;
      const buf = new Uint8Array(size);
      const dv = new DataView(buf.buffer);
      buf[0] = 0x42;
      buf[1] = 0x4d;
      dv.setUint32(2, size, true);
      dv.setUint32(10, 54, true);
      dv.setUint32(14, 40, true);
      dv.setInt32(18, w, true);
      dv.setInt32(22, h, true);
      dv.setUint16(26, 1, true);
      dv.setUint16(28, 24, true);
      dv.setUint32(34, rowSize * h, true);
      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          const o = 54 + y * rowSize + x * 3;
          buf[o] = 120;
          buf[o + 1] = 60;
          buf[o + 2] = 20;
        }
      }
      await window.__flSelftest.loadSingleFile(new File([buf], "scan.bmp", { type: "" }));
      out.push(read());
      return out;
    });
    assert.deepEqual(results[0], ["shot.webp", 40, 24]);
    assert.deepEqual(results[1], ["scan.bmp", 20, 12]);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("页面：双重曝光不套胶片与相纸", async () => {
  const { page, errors } = await openTool();
  try {
    const singlePanels = await page.evaluate(() => ({
      look: document.querySelector("#look-card").hidden,
      exposure: document.querySelector("#exposure-card").hidden,
    }));
    assert.deepEqual(singlePanels, { look: false, exposure: false });

    await page.evaluate(() => window.__flSelftest.setMode("double"));
    const doubleView = await page.evaluate(() => ({
      look: document.querySelector("#look-card").hidden,
      exposure: document.querySelector("#exposure-card").hidden,
      note: document.querySelector("#stage-note").textContent,
    }));
    assert.equal(doubleView.look, true);
    assert.equal(doubleView.exposure, true);
    assert.equal(doubleView.note, "双重曝光：两层按光量叠加，不套胶片与相纸。");

    const lower = await solidUrl(page, "#808080");
    const upper = await solidUrl(page, "#ffffff");
    await page.evaluate(([l, u]) => window.__flSelftest.loadPair(l, u), [lower, upper]);
    await page.evaluate(() => window.__flSelftest.setBalance(0.5));
    await page.evaluate(() => window.__flSelftest.refresh());
    // 强度保持默认 100%，若还套冲印链，结果会被改写而不是原始线性叠加值
    const mid = await page.evaluate(() => window.__flSelftest.sample(32, 32));
    assert.ok(Math.abs(mid[0] - 205) <= 2, `预览期望 205，实际 ${mid[0]}`);

    const exported = await page.evaluate(async () => {
      const url = await window.__flSelftest.exportDataUrl("image/png");
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      return Array.from(ctx.getImageData(Math.floor(img.width / 2), Math.floor(img.height / 2), 1, 1).data);
    });
    assert.ok(Math.abs(exported[0] - 205) <= 2, `导出期望 205，实际 ${exported[0]}`);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("页面：单张流程内批量处理多张并批量导出", async () => {
  const { page, errors } = await openTool();
  try {
    // 批量不再是独立模式，多选后直接进入单张流程的队列
    const urls = [];
    for (const color of ["#808080", "#c05030", "#3050c0"]) urls.push(await solidUrl(page, color));
    const items = urls.map((url, index) => ({ url, name: `${String.fromCharCode(97 + index)}.png` }));
    await page.evaluate((list) => window.__flSelftest.loadBatch(list), items);
    const info = await page.evaluate(() => ({
      mode: window.__flSelftest.stats().mode,
      names: window.__flSelftest.batchInfo(),
      count: document.querySelector("#batch-count").textContent,
      rows: document.querySelectorAll(".batch-item").length,
      listHidden: document.querySelector("#batch-list").hidden,
      lookHidden: document.querySelector("#look-card").hidden,
      exposureHidden: document.querySelector("#exposure-card").hidden,
      exportAllHidden: document.querySelector("#export-all").hidden,
      multiple: document.querySelector("#file-input").multiple,
    }));
    assert.equal(info.mode, "single");
    assert.deepEqual(info.names, ["a.png", "b.png", "c.png"]);
    assert.equal(info.count, "已选择 3 张，点选可预览");
    assert.equal(info.rows, 3);
    assert.equal(info.listHidden, false);
    assert.equal(info.lookHidden, false);
    assert.equal(info.exposureHidden, false);
    assert.equal(info.exportAllHidden, false);
    assert.equal(info.multiple, true);

    // 切换队列选中项，预览应随之变化
    const first = await page.evaluate(() => window.__flSelftest.sample(32, 32));
    await page.evaluate(() => window.__flSelftest.selectBatch(1));
    const second = await page.evaluate(() => window.__flSelftest.sample(32, 32));
    assert.notDeepEqual(first, second);

    // 切到双重曝光时不显示批量导出，回到单张后恢复
    await page.evaluate(() => window.__flSelftest.setMode("double"));
    assert.equal(await page.evaluate(() => document.querySelector("#export-all").hidden), true);
    await page.evaluate(() => window.__flSelftest.setMode("single"));
    assert.equal(await page.evaluate(() => document.querySelector("#export-all").hidden), false);

    // 批量导出与 auto-tone 一致：不支持目录选择时逐张下载
    await page.evaluate(() => {
      window.showDirectoryPicker = undefined;
    });
    await page.selectOption("#format", "image/png");
    const downloadNames = [];
    page.on("download", (item) => downloadNames.push(item.suggestedFilename()));
    await page.click("#export-all");
    for (let i = 0; i < 80 && downloadNames.length < 3; i += 1) {
      await page.waitForTimeout(100);
    }
    assert.deepEqual(downloadNames.sort(), ["a-film-color.png", "b-film-color.png", "c-film-color.png"]);

    // 每张单独自动测光：导出后都不再有未测光项，且不同亮度照片 EV 不同
    const evs = await page.evaluate(() => window.__flSelftest.batchEvs());
    assert.deepEqual(evs.map((item) => item.dirty), [false, false, false]);
    assert.notEqual(evs[0].ev, evs[1].ev);

    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("页面：多选文件直接进入单张队列，可移除单项", async () => {
  const { page, errors } = await openTool();
  try {
    // 走真实文件输入：多选后队列出现在单张面板内，不需要切换模式
    await page.evaluate(async () => {
      const make = (color, name) => new Promise((resolve) => {
        const canvas = document.createElement("canvas");
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 32, 32);
        canvas.toBlob((blob) => resolve(new File([blob], name, { type: "image/png" })), "image/png");
      });
      const files = await Promise.all([make("#707070", "multi-a.png"), make("#a04040", "multi-b.png")]);
      const dt = new DataTransfer();
      files.forEach((file) => dt.items.add(file));
      const input = document.querySelector("#file-input");
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(() => document.querySelectorAll(".batch-item").length === 2
      && !document.querySelector("#canvas-wrap").hidden);
    const view = await page.evaluate(() => ({
      mode: window.__flSelftest.stats().mode,
      names: window.__flSelftest.batchInfo(),
      count: document.querySelector("#batch-count").textContent,
      selectedName: document.querySelector("#single-name").textContent,
      exportAllHidden: document.querySelector("#export-all").hidden,
      canvasHidden: document.querySelector("#canvas-wrap").hidden,
    }));
    assert.equal(view.mode, "single");
    assert.deepEqual(view.names, ["multi-a.png", "multi-b.png"]);
    assert.equal(view.count, "已选择 2 张，点选可预览");
    assert.equal(view.selectedName, "multi-a.png");
    assert.equal(view.exportAllHidden, false);
    assert.equal(view.canvasHidden, false);

    // 移除第一项后，选中项自动落到剩下的照片上
    await page.click(".batch-item .batch-remove");
    await page.waitForFunction(() => document.querySelectorAll(".batch-item").length === 1);
    const after = await page.evaluate(() => ({
      names: window.__flSelftest.batchInfo(),
      selectedName: document.querySelector("#single-name").textContent,
      exportAllHidden: document.querySelector("#export-all").hidden,
    }));
    assert.deepEqual(after.names, ["multi-b.png"]);
    assert.equal(after.selectedName, "multi-b.png");
    assert.equal(after.exportAllHidden, true);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("页面：分屏对比左侧原图、右侧冲印结果", async () => {
  const { page } = await openTool();
  try {
    const url = await solidUrl(page, "#c05030");
    await page.evaluate((u) => window.__flSelftest.loadSingle(u), url);
    await page.evaluate(() => window.__flSelftest.setAuto(false));
    const full = await page.evaluate(() => [window.__flSelftest.sample(4, 32), window.__flSelftest.sample(60, 32)]);
    assert.deepEqual(full[0], full[1]);

    await page.evaluate(() => window.__flSelftest.setSplit(true, 0.5));
    const left = await page.evaluate(() => window.__flSelftest.sample(4, 32));
    const right = await page.evaluate(() => window.__flSelftest.sample(60, 32));
    assert.deepEqual([left[0], left[1], left[2]], [192, 80, 48]);
    assert.notDeepEqual(left, right);
    assert.equal(await page.evaluate(() => document.querySelector("#split-line").hidden), false);
    assert.equal(await page.evaluate(() => window.__flSelftest.stats().split), true);

    await page.evaluate(() => window.__flSelftest.setSplit(false));
    const restored = await page.evaluate(() => [window.__flSelftest.sample(4, 32), window.__flSelftest.sample(60, 32)]);
    assert.deepEqual(restored[0], restored[1]);
    assert.equal(await page.evaluate(() => document.querySelector("#split-line").hidden), true);
  } finally {
    await page.close();
  }
});

test("页面：按住看原图显示未冲印像素", async () => {
  const { page } = await openTool();
  try {
    const url = await solidUrl(page, "#c05030");
    await page.evaluate((u) => window.__flSelftest.loadSingle(u), url);
    await page.evaluate(() => window.__flSelftest.setAuto(false));
    const processed = await page.evaluate(() => window.__flSelftest.sample(4, 32));
    assert.notDeepEqual([processed[0], processed[1], processed[2]], [192, 80, 48]);

    await page.evaluate(() => window.__flSelftest.setCompare(true));
    const held = await page.evaluate(() => window.__flSelftest.sample(4, 32));
    assert.deepEqual([held[0], held[1], held[2]], [192, 80, 48]);
    assert.equal(await page.evaluate(() => window.__flSelftest.stats().compareHold), true);

    // 分屏开启时按住，整幅都临时切回原图
    await page.evaluate(() => window.__flSelftest.setSplit(true, 0.5));
    await page.evaluate(() => window.__flSelftest.setCompare(true));
    const heldRight = await page.evaluate(() => window.__flSelftest.sample(60, 32));
    assert.deepEqual([heldRight[0], heldRight[1], heldRight[2]], [192, 80, 48]);

    // 松开后恢复分屏：左半原图、右半仍是冲印结果
    await page.evaluate(() => window.__flSelftest.setCompare(false));
    const restoredLeft = await page.evaluate(() => window.__flSelftest.sample(4, 32));
    const restoredRight = await page.evaluate(() => window.__flSelftest.sample(60, 32));
    assert.deepEqual([restoredLeft[0], restoredLeft[1], restoredLeft[2]], [192, 80, 48]);
    assert.deepEqual(restoredRight, processed);
  } finally {
    await page.close();
  }
});

test("页面：重置恢复默认胶卷、自动曝光与强度", async () => {
  const { page } = await openTool();
  try {
    const url = await solidUrl(page, "#808080");
    await page.evaluate((u) => window.__flSelftest.loadSingle(u), url);
    await page.evaluate(() => window.__flSelftest.setAuto(false));
    await page.selectOption("#film", { index: 1 });
    await page.evaluate(() => window.__flSelftest.setEv(1.5));
    await page.evaluate(() => window.__flSelftest.setStrength(0.3));
    await page.evaluate(() => window.__flSelftest.refresh());
    const before = await page.evaluate(() => window.__flSelftest.stats());
    assert.notEqual(before.filmId, "kodak_portra_400");
    assert.equal(before.strength, 0.3);
    assert.equal(before.auto, false);

    await page.click("#reset-all");
    await page.waitForFunction(() => window.__flSelftest.stats().strength === 1);
    const after = await page.evaluate(() => window.__flSelftest.stats());
    assert.equal(after.filmId, "kodak_portra_400");
    assert.equal(after.auto, true);
    assert.equal(after.strength, 1);
    assert.equal(after.split, false);
    assert.equal(await page.evaluate(() => document.querySelector("#split-line").hidden), true);
  } finally {
    await page.close();
  }
});

test("页面：导出格式支持跟随原图与 BMP", async () => {
  const { page } = await openTool();
  try {
    await page.evaluate(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 32;
      canvas.height = 32;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#808080";
      ctx.fillRect(0, 0, 32, 32);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      const file = new File([blob], "fmt.png", { type: "image/png" });
      const dt = new DataTransfer();
      dt.items.add(file);
      const input = document.querySelector("#file-input");
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(() => !document.querySelector("#canvas-wrap").hidden);

    // 默认「跟随原图」：载入 PNG 就导出 PNG
    const [original] = await Promise.all([
      page.waitForEvent("download"),
      page.click("#export"),
    ]);
    assert.equal(original.suggestedFilename(), "fmt-film-color.png");

    // 选择 BMP：扩展名与文件头都要正确
    await page.selectOption("#format", "image/bmp");
    const [bmp] = await Promise.all([
      page.waitForEvent("download"),
      page.click("#export"),
    ]);
    assert.equal(bmp.suggestedFilename(), "fmt-film-color.bmp");
    const saved = path.join(await mkdtemp(path.join(tmpdir(), "film-color-")), "out.bmp");
    await bmp.saveAs(saved);
    const bytes = await readFile(saved);
    assert.equal(bytes.toString("ascii", 0, 2), "BM");
    assert.equal(bytes.length, 54 + 32 * 32 * 3);
  } finally {
    await page.close();
  }
});
