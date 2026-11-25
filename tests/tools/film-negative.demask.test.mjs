import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { readFile, stat, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { chromium } from "playwright";

// film-negative 整卷去色罩用例（dmin+dmax / 特性曲线）：
// 1) 默认使用整卷 dmin+dmax，模型含 3 个通道锚点；
// 2) 加入第二帧更密的底片后，整卷高密度锚点抬高（证明跨帧聚合而非逐帧）；
// 3) 切换特性曲线：模型 method 与中间调拐点合法；
// 4) 切回逐张：不再使用整卷模型，回到逐帧色阶；
// 5) 橙色负片条带在整卷模型下仍判为负片，不误判正片。

const ROOT = path.resolve(import.meta.dirname, "../../public");
const FIXTURES = path.resolve(import.meta.dirname, "fixtures");
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
  tmpDir = await mkdtemp(path.join(tmpdir(), "fn-demask-"));

  // 合成两帧：浅密度（画面较亮）与深密度（画面很暗），用于验证整卷聚合
  const page = await browser.newPage();
  await page.goto("about:blank");
  const files = await page.evaluate(() => {
    function negative(w, h, body) {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      // 橙色片基（dmin 参考）
      ctx.fillStyle = "rgb(214,128,86)";
      ctx.fillRect(0, 0, w, h);
      // 画面：不同透光率，模拟浅密度 / 深密度两帧（保持高于纯黑，避免被判为扫描边框）
      ctx.fillStyle = body;
      ctx.fillRect(40, 30, w - 80, h - 60);
      return c.toDataURL("image/png").split(",")[1];
    }
    return {
      light: negative(640, 420, "rgb(175,138,112)"),
      dense: negative(640, 420, "rgb(45,28,20)")
    };
  });
  await page.close();
  await writeFile(path.join(tmpDir, "light.png"), Buffer.from(files.light, "base64"));
  await writeFile(path.join(tmpDir, "dense.png"), Buffer.from(files.dense, "base64"));
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
  return page.evaluate(() => window.__fnSelftest.demask());
}

test("默认使用整卷 dmin+dmax，模型含三通道锚点", async () => {
  const page = await openTool();
  try {
    assert.equal(await page.inputValue("#demask-method"), "dual", "默认方法应为整卷 dmin+dmax");
    await page.setInputFiles("#file-input", path.join(tmpDir, "light.png"));
    const d = await waitDemask(page);
    assert.equal(d.method, "dual");
    assert.ok(d.model, "应建立整卷模型");
    assert.equal(d.model.channels.length, 3);
    for (const ch of d.model.channels) {
      assert.ok(ch.dmax > 0.2 && ch.dmax < 2.5, `dmax 应落在合理密度区间，实际 ${ch.dmax}`);
      assert.ok(ch.dmax >= ch.dmid, "中间调密度不得高于高密度锚点");
    }
    assert.equal(d.analysisDemask, true, "分析结果应走整卷转换");
    assert.equal(d.analysisLevels, false, "整卷模式不再使用逐帧色阶");
    assert.match(await page.textContent("#roll-tag"), /整卷/);
  } finally {
    await page.close();
  }
});

test("加入更密的第二帧后，整卷高密度锚点被抬高（跨帧聚合）", async () => {
  const page = await openTool();
  try {
    await page.setInputFiles("#file-input", path.join(tmpDir, "light.png"));
    const one = await waitDemask(page);
    await page.setInputFiles("#file-input", path.join(tmpDir, "dense.png"));
    const two = await waitDemask(page);
    assert.equal(two.frames, 2);
    assert.equal(two.model.channels.length, 3);
    const before = one.model.channels.reduce((s, ch) => s + ch.dmax, 0);
    const after = two.model.channels.reduce((s, ch) => s + ch.dmax, 0);
    assert.ok(after > before + 0.02, `两帧整卷 dmax 之和应增大，实际 ${before.toFixed(3)} → ${after.toFixed(3)}`);
    assert.match(await page.textContent("#roll-note"), /2 帧/);
  } finally {
    await page.close();
  }
});

test("切换特性曲线：使用两段斜率且中间调拐点合法", async () => {
  const page = await openTool();
  try {
    await page.setInputFiles("#file-input", path.join(tmpDir, "light.png"));
    await waitDemask(page);
    await page.selectOption("#demask-method", "curve");
    const d = await waitDemask(page);
    assert.equal(d.method, "curve");
    assert.equal(d.model.method, "curve");
    for (const ch of d.model.channels) {
      assert.ok(ch.nmid >= 0.12 && ch.nmid <= 0.9, `nmid 应在 0.12~0.9，实际 ${ch.nmid}`);
    }
    assert.equal(d.analysisDemask, true);
    assert.match(await page.textContent("#roll-tag"), /整卷/);
  } finally {
    await page.close();
  }
});

test("切回逐张：不再使用整卷模型，恢复逐帧色阶", async () => {
  const page = await openTool();
  try {
    await page.setInputFiles("#file-input", path.join(tmpDir, "light.png"));
    await waitDemask(page);
    await page.selectOption("#demask-method", "frame");
    const d = await waitDemask(page);
    assert.equal(d.method, "frame");
    assert.equal(d.model, null, "逐张模式不应保留整卷模型");
    assert.equal(d.analysisDemask, false);
    assert.equal(d.analysisLevels, true);
    assert.match(await page.textContent("#roll-tag"), /逐张/);
  } finally {
    await page.close();
  }
});

test("橙色负片条带在整卷模型下仍判为负片", async () => {
  const page = await openTool();
  try {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.setInputFiles("#file-input", path.join(FIXTURES, "fn-strip-orange.png"));
    const d = await waitDemask(page);
    assert.ok(d.model, "条带图也应建立整卷模型");
    const hint = await page.locator("#tone-hint").isVisible().catch(() => false);
    assert.equal(hint, false, "暖橙片基的负片不得弹出正片提示");
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("排除某帧后不再参与整卷统计", async () => {
  const page = await openTool();
  try {
    await page.setInputFiles("#file-input", [path.join(tmpDir, "light.png"), path.join(tmpDir, "dense.png")]);
    const both = await waitDemask(page);
    const sumBoth = both.model.channels.reduce((s, ch) => s + ch.dmax, 0);
    assert.equal(both.frames, 2);

    await page.locator(".qcard").nth(1).locator(".qskip").click();
    const one = await waitDemask(page);
    const sumOne = one.model.channels.reduce((s, ch) => s + ch.dmax, 0);
    assert.ok(sumOne < sumBoth - 0.02, `排除深密度帧后锚点应回落，实际 ${sumBoth.toFixed(3)} → ${sumOne.toFixed(3)}`);
    assert.match(await page.textContent("#roll-tag"), /排除 1/);
    assert.match(await page.textContent("#roll-note"), /已排除 1 帧/);

    await page.locator(".qcard").nth(1).locator(".qskip").click();
    const back = await waitDemask(page);
    assert.ok(back.model.channels.reduce((s, ch) => s + ch.dmax, 0) > sumOne + 0.02, "恢复纳入后锚点应回到两帧水平");
  } finally {
    await page.close();
  }
});

test("中性平衡强度控制灰轴正则增益", async () => {
  const page = await openTool();
  try {
    await page.setInputFiles("#file-input", [path.join(tmpDir, "light.png"), path.join(tmpDir, "dense.png")]);
    await waitDemask(page);

    await page.locator("#gray-strength").fill("0");
    const off = await waitDemask(page);
    assert.equal(off.model.gray, 0);
    for (const ch of off.model.channels) assert.equal(ch.gain, 1, "关闭时不应有通道增益");

    await page.locator("#gray-strength").fill("100");
    const full = await waitDemask(page);
    assert.equal(full.model.gray, 1);
    const gains = full.model.channels.map((ch) => ch.gain);
    assert.ok(gains.some((g) => Math.abs(g - 1) > 0.001), "满强度时通道增益应对齐中间调");
  } finally {
    await page.close();
  }
});
