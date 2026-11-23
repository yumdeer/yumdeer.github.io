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
  { fixture: "x22.jpg", label: "正常曝光 · 含暗部画格", auto: 6 },
  { fixture: "p2.jpg", label: "正常曝光", auto: 6 },
  { fixture: "p3.jpg", label: "正常曝光 · 片尾残缺", auto: 6 },
  { fixture: "p4.jpg", label: "正常曝光", auto: 6 },
  { fixture: "u3.jpg", label: "正常曝光", auto: 6 },
  // y2/y3 下半幅画面被暗部片基吞掉，自动模式需按等距网格补齐漏检画格。
  { fixture: "y2.jpg", label: "极暗夜景", auto: 6 },
  { fixture: "y3.jpg", label: "暗光风景", auto: 6 }
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

test("自动画幅：暗部底片补齐全格并覆盖整幅画面高度", async (t) => {
  for (const fixture of ["y2.jpg", "x22.jpg"]) {
    await t.test(fixture, async () => {
      const page = await openTool();
      try {
        const frames = await importFixture(page, fixture);
        assertUniformFrames(frames, 6);
        // 用户反馈“画面识别太小、下半幅没识别到”：画格必须覆盖整幅画面高度。
        const analysisHeight = await page.evaluate(() => window.__analysis.height);
        const top = Math.min(...frames.map((frame) => frame.y));
        const bottom = Math.max(...frames.map((frame) => frame.y + frame.h));
        assert.ok(top <= analysisHeight * 0.05, `画格应从画面顶端开始：${top}/${analysisHeight}`);
        assert.ok(bottom - top >= analysisHeight * 0.93, `画格应覆盖整幅画面高度：${bottom - top}/${analysisHeight}`);
      } finally {
        await page.close();
      }
    });
  }
});

test("自动画幅：两张暗部扫描件都补齐全格且与 135 画幅布局一致", { concurrency: true }, async (t) => {
  // 分别对应 未标题 (2).tif（y2）与 未标题 (2) (2).tif（x22）两张真实扫描件，
  // 两者的暗部画格位置不同，需保证自动与显式 135 画幅得到同样的 6 格布局。
  for (const fixture of ["y2.jpg", "x22.jpg"]) {
    await t.test(fixture, async () => {
      const page = await openTool();
      try {
        const autoFrames = await importFixture(page, fixture);
        assertUniformFrames(autoFrames, 6);
        const explicitFrames = await detect(page, () => page.selectOption("#filmFormat", "135"));
        assertUniformFrames(explicitFrames, 6);
        const center = (frame) => (frame.x + frame.w / 2);
        const autoCenters = autoFrames.map(center).sort((a, b) => a - b);
        const explicitCenters = explicitFrames.map(center).sort((a, b) => a - b);
        for (let index = 0; index < 6; index += 1) {
          assert.ok(Math.abs(autoCenters[index] - explicitCenters[index]) <= 6, `${fixture} 第 ${index + 1} 格中心与 135 结果偏差过大`);
        }
      } finally {
        await page.close();
      }
    });
  }
});

test("自动画幅：只识别到 2 个亮画格时仍按格距补齐为 6 格", { concurrency: true }, async (t) => {
  // 复现用户浏览器上的实际结果：未标题 (2).tif 自动检测只框住中间两个亮画格。
  for (const fixture of ["y2.jpg", "x22.jpg"]) {
    await t.test(fixture, async () => {
      const page = await openTool();
      try {
        const frames = await importFixture(page, fixture);
        assertUniformFrames(frames, 6);
        const normalized = await page.evaluate(() => {
          const source = window.__selftest.frames;
          const middle = source.slice(3, 5).map((frame) => ({ ...frame }));
          return window.__selftestApi.normalize(middle);
        });
        assertUniformFrames(normalized, 6);
      } finally {
        await page.close();
      }
    });
  }
});

test("自动画幅：多检出 7 个均匀窄框时按分隔线校正为 6 格", { concurrency: true }, async (t) => {
  // 用户浏览器上的另一类结果：自动检测把整条胶片均分成 7 个窄框，而 135 画幅是正确的 6 格。
  for (const fixture of ["y2.jpg", "x22.jpg"]) {
    await t.test(fixture, async () => {
      const page = await openTool();
      try {
        const frames = await importFixture(page, fixture);
        assertUniformFrames(frames, 6);
        // 注入两类噪声候选：均匀 7 窄框、整体偏移 9px 的 7 窄框。
        // 校正后都应收敛回与导入结果（即物理分隔线位置）一致的 6 格网格。
        const outputs = await page.evaluate(() => {
          const { width, height } = window.__analysis;
          const step = width / 7;
          const build = (shift) => Array.from({ length: 7 }, (_, index) => ({
            x: Math.round(index * step) + shift,
            y: 0,
            w: Math.round(step) - 1,
            h: height
          }));
          return {
            shifted: window.__selftestApi.normalize(build(9)),
            plain: window.__selftestApi.normalize(build(0))
          };
        });
        for (const [label, corrected] of Object.entries(outputs)) {
          assertUniformFrames(corrected, 6);
          for (let index = 0; index < 6; index += 1) {
            const drift = Math.abs(corrected[index].x - frames[index].x) + Math.abs(corrected[index].w - frames[index].w);
            assert.ok(drift <= 5, `${fixture} ${label} 第 ${index + 1} 格与物理分隔线位置偏差 ${drift}px`);
          }
        }
      } finally {
        await page.close();
      }
    });
  }
});

test("自动画幅：首格左缘漏检的偏移 6 框仍对齐到分隔线网格", { concurrency: true }, async (t) => {
  // 用户浏览器实测的另一类偏差：检出 6 个框但整体右移约半格的 1/3（首格左侧暗部画面被切掉），
  // 或格距推错为整条均分。数量恰好一致时旧逻辑直接采信，导致自动与 135 不一致。
  for (const fixture of ["y2.jpg", "x22.jpg"]) {
    await t.test(fixture, async () => {
      const page = await openTool();
      try {
        const frames = await importFixture(page, fixture);
        assertUniformFrames(frames, 6);
        const outputs = await page.evaluate(() => {
          const { width, height } = window.__analysis;
          const step = width / 6;
          const build = (start, pitch, boxWidth) => Array.from({ length: 6 }, (_, index) => ({
            x: start + Math.round(pitch * index),
            y: 0,
            w: boxWidth,
            h: height
          }));
          return {
            shifted: window.__selftestApi.normalize(build(Math.round(step * 0.27), step, Math.round(step) - 7)),
            wrongPitch: window.__selftestApi.normalize(build(Math.round(step * 0.27), Math.round(width / 7.1), Math.round(width / 7.1) - 9))
          };
        });
        for (const [label, corrected] of Object.entries(outputs)) {
          assertUniformFrames(corrected, 6);
          for (let index = 0; index < 6; index += 1) {
            const drift = Math.abs(corrected[index].x - frames[index].x) + Math.abs(corrected[index].w - frames[index].w);
            assert.ok(drift <= 5, `${fixture} ${label} 第 ${index + 1} 格未收敛到分隔线网格（偏差 ${drift}px）`);
          }
        }
      } finally {
        await page.close();
      }
    });
  }
});

test("自动画幅与 135：碎片框污染统计后仍收敛到正确网格", { concurrency: true }, async (t) => {
  // 用户浏览器诊断实锤：检出 [752+247x153, 1003+207x132]，第二个碎片框把宽度
  // 中位数从 247 拖到 207，导致每格变成 5+241（正确为 2+247）。
  // 碎片剔除后两条路径都应收敛到与导入结果一致的网格。
  for (const fixture of ["y2.jpg", "x22.jpg"]) {
    await t.test(fixture, async () => {
      const page = await openTool();
      try {
        const frames = await importFixture(page, fixture);
        assertUniformFrames(frames, 6);
        const outputs = await page.evaluate(() => {
          const { height } = window.__analysis;
          const userDetected = [
            { x: 752, y: 0, w: 247, h: height },
            { x: 1003, y: 0, w: 207, h: Math.round(height * 0.86) }
          ];
          return {
            refine: window.__selftestApi.refine(userDetected),
            normalize: window.__selftestApi.normalize(userDetected)
          };
        });
        for (const [label, corrected] of Object.entries(outputs)) {
          assertUniformFrames(corrected, 6);
          for (let index = 0; index < 6; index += 1) {
            const xDrift = Math.abs(corrected[index].x - frames[index].x);
            const wDrift = Math.abs(corrected[index].w - frames[index].w);
            // 注入的是人造噪声框，允许几像素的落点差异；能抓住“整体偏移 + 偏窄”的症状即可。
            assert.ok(xDrift <= 5, `${fixture} ${label} 第 ${index + 1} 格相位未收敛（x 偏差 ${xDrift}px）`);
            assert.ok(wDrift <= 6, `${fixture} ${label} 第 ${index + 1} 格宽度未收敛（偏差 ${wDrift}px）`);
          }
        }
      } finally {
        await page.close();
      }
    });
  }
});

test("自动画幅与 135：暗部首格偏矮时两条路径落点一致", async () => {
  // 未标题.tif 的降采样分析画布：首格暗部只被检出 225x115 的局部框，其余格宽在 230~247 浮动。
  // 自动模式曾因“数量一致即采信”保留这些不齐的框，与 135 画幅差十几像素。
  const page = await openTool();
  try {
    const auto = await importFixture(page, "w1.png");
    assertUniformFrames(auto, 6);
    const f135 = await detect(page, () => page.selectOption("#filmFormat", "135"));
    assertUniformFrames(f135, 6);
    for (let index = 0; index < 6; index += 1) {
      const drift = Math.max(
        Math.abs(auto[index].x - f135[index].x),
        Math.abs(auto[index].w - f135[index].w),
        Math.abs(auto[index].h - f135[index].h)
      );
      assert.ok(drift <= 2, `第 ${index + 1} 格自动与 135 落点偏差 ${drift}px`);
    }
  } finally {
    await page.close();
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

test("分割张数：暗部底片强制指定 6 张后切出 6 个等宽画格", async () => {
  const page = await openTool();
  try {
    await importFixture(page, "y2.jpg");
    const frames = await detect(page, () => page.selectOption("#frameCount", "6"));
    assertUniformFrames(frames, 6);
  } finally {
    await page.close();
  }
});

test("全选后修改画幅：所有底片一起重新匹配", async () => {
  const page = await openTool();
  try {
    await detect(page, () => page.setInputFiles("#fileInput", [
      path.join(FIXTURES, "p2.jpg"),
      path.join(FIXTURES, "p4.jpg")
    ]));
    await page.click("#jobSelectAll");
    assert.equal(await page.getAttribute("#jobSelectAll", "aria-pressed"), "true", "全选后按钮应处于选中态");
    await page.selectOption("#filmFormat", "135");
    await page.waitForFunction(() => {
      const cards = Array.from(document.querySelectorAll(".job-card-status"));
      return cards.length === 2 && cards.every((node) => node.textContent.includes("6 个画格"));
    }, null, { timeout: 120000 });
  } finally {
    await page.close();
  }
});
