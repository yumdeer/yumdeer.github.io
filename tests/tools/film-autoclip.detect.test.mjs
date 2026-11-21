import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { chromium } from "playwright";

// 胶片自动裁切识别回归用例：用降采样后的真实底片扫描件跑一遍浏览器端检测，
// 固定“135 画幅必须切出 6 个等宽画格”等关键行为，避免改动检测逻辑后识别退化。
// 素材为原扫描件按 1500px 宽降采样（与分析尺寸一致），放在 fixtures 目录。

const ROOT = path.resolve(import.meta.dirname, "../../public");
const FIXTURES = path.resolve(import.meta.dirname, "fixtures");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".json": "application/json"
};

const CASES = [
  // auto 为当前“自动画幅”下的基线格数，用于捕捉未选定画幅时的行为变化。
  { fixture: "x22.jpg", label: "正常曝光 · 含暗部画格", auto: 5 },
  { fixture: "p2.jpg", label: "正常曝光", auto: 6 },
  { fixture: "p3.jpg", label: "正常曝光 · 片尾残缺", auto: 6 },
  { fixture: "p4.jpg", label: "正常曝光", auto: 6 },
  { fixture: "u3.jpg", label: "正常曝光", auto: 6 },
  { fixture: "y2.jpg", label: "极暗夜景", auto: 1 },
  { fixture: "y3.jpg", label: "暗光风景", auto: 4 }
];

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
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
});

async function openTool() {
  const page = await browser.newPage();
  // 统计上报与用例无关，直接拦截，避免测试依赖外网。
  await page.route("https://film-frame-stats.far-plain.workers.dev/**", (route) => route.abort());
  await page.goto(`${origin}/tools/film-autoclip/?selftest=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof window.UTIF !== "undefined");
  return page;
}

// 清空上一次检测结果后执行动作，等待新的检测结果，避免读到旧数据。
async function detect(page, action) {
  await page.evaluate(() => { window.__selftest = null; });
  await action();
  await page.waitForFunction(() => window.__selftest, null, { timeout: 60000 });
  return page.evaluate(() => window.__selftest.frames);
}

async function importFixture(page, fixture) {
  return detect(page, () => page.setInputFiles("#fileInput", path.join(FIXTURES, fixture)));
}

const spread = (values) => Math.max(...values) - Math.min(...values);

function assertUniformFrames(frames, expectedCount) {
  assert.equal(frames.length, expectedCount, "画格数量应与预期一致");
  assert.ok(spread(frames.map((frame) => Math.round(frame.w))) <= 2, `画格宽度应一致：${frames.map((frame) => Math.round(frame.w))}`);
  assert.ok(spread(frames.map((frame) => Math.round(frame.h))) <= 2, `画格高度应一致：${frames.map((frame) => Math.round(frame.h))}`);
  const sorted = [...frames].sort((a, b) => a.x + a.w / 2 - (b.x + b.w / 2));
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    assert.ok(sorted[index].x >= previous.x + previous.w - 1, `画格 ${index} 与前一格重叠`);
  }
  for (const frame of frames) {
    assert.ok(frame.x >= 0 && frame.y >= 0 && frame.w > 0 && frame.h > 0, "画格应落在画面内");
  }
}

test("135 画幅：仅画面模式下切出 6 个等宽画格", { concurrency: true }, async (t) => {
  for (const item of CASES) {
    await t.test(item.label, async () => {
      const page = await openTool();
      try {
        await importFixture(page, item.fixture);
        const frames = await detect(page, () => page.selectOption("#filmFormat", "135"));
        assertUniformFrames(frames, 6);
      } finally {
        await page.close();
      }
    });
  }
});

test("135 画幅：保留片边模式下同样切出 6 个等宽画格", { concurrency: true }, async (t) => {
  for (const item of CASES) {
    await t.test(item.label, async () => {
      const page = await openTool();
      try {
        await importFixture(page, item.fixture);
        await detect(page, () => page.selectOption("#filmFormat", "135"));
        const frames = await detect(page, () => page.selectOption("#cropScope", "sprocket"));
        assertUniformFrames(frames, 6);
      } finally {
        await page.close();
      }
    });
  }
});

test("自动画幅：反馈基线格数，防止改动检测逻辑后行为漂移", { concurrency: true }, async (t) => {
  for (const item of CASES) {
    await t.test(item.label, async () => {
      const page = await openTool();
      try {
        const frames = await importFixture(page, item.fixture);
        assert.equal(frames.length, item.auto, `${item.fixture} 自动识别格数变化`);
        assert.ok(frames.every((frame) => frame.w > 0 && frame.h > 0), "画格尺寸应有效");
      } finally {
        await page.close();
      }
    });
  }
});

test("画幅与画面比例不符时不强行切分", async () => {
  const page = await openTool();
  try {
    await importFixture(page, "x22.jpg");
    const frames = await detect(page, () => page.selectOption("#filmFormat", "66"));
    // 135 底片选 6×6 时应识别为“比例不符”，保持自动结果而不是按 1:1 重新均分。
    assert.ok(frames.length <= 6, `不应因画幅不符切出更多画格：${frames.length}`);
    assert.ok(frames.every((frame) => frame.w > 150), "不应把画格切成细条");
  } finally {
    await page.close();
  }
});
