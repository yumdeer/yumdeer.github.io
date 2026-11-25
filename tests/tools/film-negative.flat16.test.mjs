import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { readFile, stat, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { chromium } from "playwright";

// film-negative 平场校正 + 16bit 导出用例：
// 1) 未载入平场参考时，均匀负片渲染后四角与中心一致；
// 2) 载入带暗角的平场参考后，四角逐像素被压暗（平场生效）；
// 3) 强度归零后恢复均匀（强度可关闭）；
// 4) PNG 16bit 导出：IHDR 位深 16、truecolor、尺寸与成片一致。

const ROOT = path.resolve(import.meta.dirname, "../../public");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".jpg": "image/jpeg",
  ".png": "image/png",
};

let server;
let browser;
let origin;
let tmpDir;

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
  tmpDir = await mkdtemp(path.join(tmpdir(), "fn-flat16-"));

  const page = await browser.newPage();
  await page.goto("about:blank");
  const files = await page.evaluate(() => {
    function png(c) {
      return c.toDataURL("image/png").split(",")[1];
    }
    // 均匀负片：片基铺底 + 同一透光率的画面区域（渲染后应整体均匀）
    const neg = document.createElement("canvas");
    neg.width = 640;
    neg.height = 420;
    const nctx = neg.getContext("2d");
    nctx.fillStyle = "rgb(214,128,86)";
    nctx.fillRect(0, 0, 640, 420);
    nctx.fillStyle = "rgb(168,132,106)";
    nctx.fillRect(30, 24, 580, 372);

    // 平场参考：中心亮、四角暗的强暗角
    const flat = document.createElement("canvas");
    flat.width = 480;
    flat.height = 320;
    const fctx = flat.getContext("2d");
    const g = fctx.createRadialGradient(240, 160, 20, 240, 160, 300);
    g.addColorStop(0, "rgb(225,225,225)");
    g.addColorStop(1, "rgb(80,80,80)");
    fctx.fillStyle = g;
    fctx.fillRect(0, 0, 480, 320);

    // 角部亮点负片：用于验证镜头校正会改变几何采样
    const dot = document.createElement("canvas");
    dot.width = 640;
    dot.height = 420;
    const dctx = dot.getContext("2d");
    dctx.fillStyle = "rgb(214,128,86)";
    dctx.fillRect(0, 0, 640, 420);
    dctx.fillStyle = "rgb(168,132,106)";
    dctx.fillRect(30, 24, 580, 372);
    dctx.fillStyle = "rgb(90,200,120)";
    dctx.beginPath();
    dctx.arc(70, 64, 11, 0, Math.PI * 2);
    dctx.fill();

    return { neg: png(neg), flat: png(flat), dot: png(dot) };
  });
  await page.close();
  await writeFile(path.join(tmpDir, "uniform.png"), Buffer.from(files.neg, "base64"));
  await writeFile(path.join(tmpDir, "flat.png"), Buffer.from(files.flat, "base64"));
  await writeFile(path.join(tmpDir, "dot.png"), Buffer.from(files.dot, "base64"));
});

after(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
});

async function openTool() {
  const page = await browser.newPage();
  await page.route("https://film-frame-stats.far-plain.workers.dev/**", (route) => route.abort());
  await page.goto(`${origin}/tools/film-negative/?selftest=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof window.__fnSelftest === "object");
  return page;
}

async function waitDemask(page) {
  await page.waitForFunction(() => {
    const d = window.__fnSelftest.demask();
    return d.frames > 0 && !d.pending;
  }, null, { timeout: 60000 });
}

// 读出画布中心与左上角像素的亮度差
async function cornerGap(page) {
  await page.waitForTimeout(260);
  return page.evaluate(() => {
    const cv = document.getElementById("canvas");
    const ctx = cv.getContext("2d");
    const w = cv.width, h = cv.height;
    const at = (x, y) => {
      const d = ctx.getImageData(x, y, 1, 1).data;
      return d[0] * 0.2126 + d[1] * 0.7152 + d[2] * 0.0722;
    };
    // 取样点落在画面内容区（避开片基边框）：四角附近 vs 中心
    return { center: at(Math.floor(w / 2), Math.floor(h / 2)), corner: at(34, 34), w, h };
  });
}

test("平场参考可载入并压暗暗角，强度归零后恢复", async () => {
  const page = await openTool();
  try {
    await page.setInputFiles("#file-input", path.join(tmpDir, "uniform.png"));
    await waitDemask(page);

    const before = await cornerGap(page);
    assert.ok(Math.abs(before.center - before.corner) < 4, `未载入平场时应均匀，中心 ${before.center} 角落 ${before.corner}`);

    await page.setInputFiles("#flat-input", path.join(tmpDir, "flat.png"));
    await page.waitForFunction(() => window.__fnSelftest.flat() !== null);
    const flat = await page.evaluate(() => window.__fnSelftest.flat());
    assert.equal(flat.strength, 1, "载入后默认强度应为 100%");
    assert.match(await page.textContent("#flat-tag"), /参考/);

    const on = await cornerGap(page);
    assert.ok(on.corner < on.center - 12, `平场开启后暗角应明显更暗，中心 ${on.center} 角落 ${on.corner}`);

    await page.locator("#flat-strength").fill("0");
    const off = await cornerGap(page);
    assert.ok(Math.abs(off.center - off.corner) < 5, `强度归零后应恢复均匀，中心 ${off.center} 角落 ${off.corner}`);

    await page.click("#btn-flat-clear");
    assert.equal(await page.evaluate(() => window.__fnSelftest.flat()), null, "清除后不再有平场模型");
    assert.equal(await page.textContent("#flat-tag"), "未载入");
  } finally {
    await page.close();
  }
});

test("PNG 16bit 导出：IHDR 位深 16 且为 RGB", async () => {
  const page = await openTool();
  try {
    await page.setInputFiles("#file-input", path.join(tmpDir, "uniform.png"));
    await waitDemask(page);
    await page.selectOption("#export-format", "png16");

    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 30000 }),
      page.click("#btn-export"),
    ]);
    const file = await download.path();
    const buf = await readFile(file);
    assert.equal(buf.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "应为 PNG 签名");
    assert.equal(buf.subarray(12, 16).toString("ascii"), "IHDR");
    assert.equal(buf.readUInt32BE(16), 640, "宽度应为成片宽度");
    assert.equal(buf.readUInt32BE(20), 420, "高度应为成片高度");
    assert.equal(buf[24], 16, "位深应为 16");
    assert.equal(buf[25], 2, "颜色类型应为 truecolor RGB");
  } finally {
    await page.close();
  }
});


test("CCM 解算：能从已知 3×3 矩阵还原且保持白点", async () => {
  const page = await openTool();
  try {
    const out = await page.evaluate(() => {
      const M0 = [[0.92, 0.07, 0.01], [0.04, 0.93, 0.03], [0.02, 0.05, 0.93]];
      // 用 ColorChecker 线性参考当作测量值，目标 = M0 × 测量值
      const ref = [
        [0.17, 0.09, 0.06], [0.54, 0.30, 0.23], [0.12, 0.20, 0.34], [0.09, 0.15, 0.05],
        [0.24, 0.22, 0.44], [0.13, 0.51, 0.41], [0.68, 0.20, 0.02], [0.08, 0.11, 0.39],
        [0.53, 0.10, 0.12], [0.11, 0.04, 0.14], [0.33, 0.50, 0.05], [0.75, 0.36, 0.03],
        [0.04, 0.05, 0.30], [0.06, 0.29, 0.07], [0.43, 0.03, 0.04], [0.79, 0.57, 0.01],
        [0.49, 0.09, 0.29], [0.00, 0.23, 0.35], [0.89, 0.89, 0.89], [0.58, 0.58, 0.58],
        [0.35, 0.35, 0.35], [0.19, 0.19, 0.19], [0.09, 0.09, 0.09], [0.03, 0.03, 0.03]
      ];
      const targets = ref.map((s) => M0.map((row) => row[0] * s[0] + row[1] * s[1] + row[2] * s[2]));
      const M = window.__fnSelftest.solveCcm(ref, targets);
      let worst = 0;
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(M[r][c] - M0[r][c]));
      return { M, worst };
    });
    assert.ok(out.worst < 0.03, `还原矩阵误差应很小，实际 ${out.worst}`);
  } finally {
    await page.close();
  }
});

test("CCM 接入渲染：设置矩阵后画面变化，清除后恢复", async () => {
  const page = await openTool();
  try {
    await page.setInputFiles("#file-input", path.join(tmpDir, "uniform.png"));
    await waitDemask(page);
    await page.waitForTimeout(260);
    const read = () => page.evaluate(() => {
      const cv = document.getElementById("canvas");
      const d = cv.getContext("2d").getImageData(cv.width >> 1, cv.height >> 1, 1, 1).data;
      return [d[0], d[1], d[2]];
    });
    const before = await read();
    await page.evaluate(() => window.__fnSelftest.setCcm([[0, 1, 0], [0, 0, 1], [1, 0, 0]]));
    await page.waitForTimeout(320);
    const after = await read();
    assert.notDeepEqual(after, before, `通道旋转后中心像素应变化，前 ${before} 后 ${after}`);
    await page.evaluate(() => window.__fnSelftest.setCcm(null));
    await page.waitForTimeout(320);
    const restored = await read();
    assert.deepEqual(restored, before, "清除 CCM 后应恢复原样");
  } finally {
    await page.close();
  }
});


test("镜头校正：径像系数改变几何采样，标签同步", async () => {
  const page = await openTool();
  try {
    await page.setInputFiles("#file-input", path.join(tmpDir, "dot.png"));
    await waitDemask(page);
    await page.waitForTimeout(300);
    const read = (x, y) => page.evaluate(([px, py]) => {
      const cv = document.getElementById("canvas");
      const d = cv.getContext("2d").getImageData(px, py, 1, 1).data;
      return [d[0], d[1], d[2]];
    }, [x, y]);
    const before = await read(70, 64);
    await page.locator("#lens-k").fill("-100");
    await page.waitForTimeout(700);
    assert.ok(await page.evaluate(() => window.__fnSelftest.lens()) < 0, "径像系数应为负（桶形校正）");
    assert.match(await page.textContent("#lens-tag"), /桶形/);
    const after = await read(70, 64);
    assert.notDeepEqual(after, before, `校正后角部采样应改变，前 ${before} 后 ${after}`);
  } finally {
    await page.close();
  }
});

test("密度目标：启用后通道锚点使用给定 Dmin/Dmax", async () => {
  const page = await openTool();
  try {
    await page.setInputFiles("#file-input", path.join(tmpDir, "uniform.png"));
    await waitDemask(page);
    assert.equal(await page.evaluate(() => window.__fnSelftest.density().on), false);

    await page.check("#density-on");
    await page.waitForTimeout(400);
    await page.locator("#density-min").fill("30");
    await page.waitForTimeout(400);
    const model = await page.evaluate(() => window.__fnSelftest.demask().model);
    assert.ok(model, "整卷模型应存在");
    assert.ok(Math.abs(model.channels[0].dmin - 0.30) < 0.005, `Dmin 应为 0.30，实际 ${model.channels[0].dmin}`);
    assert.ok(model.channels.every((c) => Math.abs(c.dmax - 2.0) < 0.005), "Dmax 应使用 2.00 目标");
    assert.match(await page.textContent("#density-label"), /0\.30/);

    await page.uncheck("#density-on");
    await page.waitForTimeout(400);
    const off = await page.evaluate(() => window.__fnSelftest.demask().model);
    assert.equal(off.channels[0].dmin, 0, "关闭后恢复统计锚点（Dmin=0）");
  } finally {
    await page.close();
  }
});
