import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { readFile, stat, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { chromium } from "playwright";

// film-negative 自动片基检测（去色罩）用例：
// 1) 真实翻拍负片条（fn-strip1.png）：片基必须来自画格间隔带（非画面边缘的亮背景），
//    暖色序（橙罩），转换后间隔带应接近纯黑；
// 2) 合成双画幅负片条：同样命中间隔带策略；
// 3) 单画幅图（非条带）：不崩溃，回退边缘/内容策略。

const ROOT = path.resolve(import.meta.dirname, "../../public");
const FIXTURES = path.resolve(import.meta.dirname, "fixtures");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png"
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
  tmpDir = await mkdtemp(path.join(tmpdir(), "fn-base-"));

  // 合成双画幅负片条：橙罩间隔带 + 深色画面内容（负片里密集=暗）
  const page = await browser.newPage();
  await page.goto("about:blank");
  const strip = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 900;
    c.height = 220;
    const ctx = c.getContext("2d");
    // 亮背景（翻拍台面）
    ctx.fillStyle = "#e8e8e8";
    ctx.fillRect(0, 0, 900, 220);
    // 胶片条（整幅高度）
    ctx.fillStyle = "#e0825f"; // 橙罩片基
    ctx.fillRect(20, 10, 860, 200);
    // 两个画格的负片内容（比片基暗）
    ctx.fillStyle = "#5a3a2e";
    ctx.fillRect(50, 30, 350, 160);
    ctx.fillStyle = "#4a3040";
    ctx.fillRect(500, 30, 350, 160);
    return c.toDataURL("image/png").split(",")[1];
  });
  // 单画幅负片（非条带，宽高比 4:3）：应回退常规策略
  const single = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 400;
    c.height = 300;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#e0825f";
    ctx.fillRect(0, 0, 400, 300);
    ctx.fillStyle = "#5a3a2e";
    ctx.fillRect(80, 60, 240, 180);
    return c.toDataURL("image/png").split(",")[1];
  });
  await page.close();
  await writeFile(path.join(tmpDir, "strip2.png"), Buffer.from(strip, "base64"));
  await writeFile(path.join(tmpDir, "single.png"), Buffer.from(single, "base64"));
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

async function importImage(page, filePath) {
  await page.setInputFiles("#file-input", filePath);
  await page.waitForFunction(() => {
    const s = window.__fnSelftest && window.__fnSelftest.previewSize();
    return s && s.w > 0;
  }, null, { timeout: 60000 });
  await page.waitForTimeout(600);
}

function parseBaseRgb(text) {
  const m = /(\d+),\s*(\d+),\s*(\d+)/.exec(text || "");
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

test("翻拍负片条：片基取自画格间隔带，间隔带转换后接近纯黑", async () => {
  const page = await openTool();
  try {
    await importImage(page, path.join(FIXTURES, "fn-strip1.png"));
    const msg = await page.textContent("#base-message");
    assert.match(msg, /间隔带/, "片基应来自画格间隔带策略");
    const base = parseBaseRgb(await page.textContent("#base-rgb"));
    assert.ok(base, "应显示片基 RGB");
    assert.ok(base[0] > base[1] && base[1] > base[2], `片基应为暖色序（橙罩），实际 ${base}`);
    assert.ok(base[0] - base[2] >= 60, `橙罩特征应显著（R-B≥60），实际 ${base}`);
    // 转换后：间隔带（x≈302/588/877）接近纯黑，画面内容明显更亮
    const samples = await page.evaluate(() => {
      const cv = document.getElementById("canvas");
      const ctx = cv.getContext("2d");
      const h = cv.height;
      function colAvg(x) {
        const d = ctx.getImageData(x - 3, Math.round(h * 0.3), 7, Math.round(h * 0.4)).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
        return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
      }
      return {
        gaps: [colAvg(302), colAvg(588), colAvg(877)],
        content: [colAvg(150), colAvg(450), colAvg(750)]
      };
    });
    for (const g of samples.gaps) {
      const l = Math.round(g[0] * 0.3 + g[1] * 0.6 + g[2] * 0.1);
      assert.ok(l <= 48, `间隔带转换后应接近纯黑（亮度 ${l}），实际 RGB ${g}`);
    }
    for (const c of samples.content) {
      const l = Math.round(c[0] * 0.3 + c[1] * 0.6 + c[2] * 0.1);
      assert.ok(l >= 60, `画面内容不应被压黑（亮度 ${l}），实际 RGB ${c}`);
    }
  } finally {
    await page.close();
  }
});

test("合成双画幅负片条：命中间隔带策略且片基为橙罩色", async () => {
  const page = await openTool();
  try {
    await importImage(page, path.join(tmpDir, "strip2.png"));
    const msg = await page.textContent("#base-message");
    assert.match(msg, /间隔带/, "合成条带也应命中间隔带策略");
    const base = parseBaseRgb(await page.textContent("#base-rgb"));
    assert.ok(base, "应显示片基 RGB");
    assert.ok(base[0] > base[1] && base[1] > base[2], `片基应为暖色序，实际 ${base}`);
  } finally {
    await page.close();
  }
});

test("单画幅图：非条带回退常规策略，不崩溃", async () => {
  const page = await openTool();
  try {
    await importImage(page, path.join(tmpDir, "single.png"));
    const msg = await page.textContent("#base-message");
    assert.doesNotMatch(msg, /间隔带/, "单画幅不应命中条带策略");
    const base = parseBaseRgb(await page.textContent("#base-rgb"));
    assert.ok(base, "回退策略也应给出片基 RGB");
    const size = await page.evaluate(() => window.__fnSelftest.previewSize());
    assert.ok(size.w > 0, "渲染不崩溃");
  } finally {
    await page.close();
  }
});
