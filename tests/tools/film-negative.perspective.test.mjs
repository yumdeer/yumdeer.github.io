import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { readFile, stat, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { chromium } from "playwright";

// film-negative 透视矫正在线用例（手动模式，参考 Photoshop 手动变换）：
// 1) 真实翻拍截图（fn-persp1.png）：默认不矫正，开关开启后拉正且导出一致；
// 2) 合成旋转/梯形图的角度反推精度（默认关闭）；
// 3) 轴对齐图判定“基本平直”不自动启用；
// 4) 无背景图不误报、不崩溃；
// 5) 波浪边：局部抚直模式默认关闭，开启后画面中心锚定不动；
// 6) 手动锚点矫正：进入编辑态 → 拖四角 → 完成 → 应用；取消可恢复；
// 7) 橙黄负片条带（带白色齿孔）：不得误判为正片。

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
  tmpDir = await mkdtemp(path.join(tmpdir(), "fn-persp-"));

  // 合成测试图：在浏览器里画好后落盘，供 setInputFiles 使用
  const page = await browser.newPage();
  await page.goto("about:blank");
  const files = await page.evaluate(() => {
    function exportCanvas(w, h, draw) {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      draw(ctx, w, h);
      return c.toDataURL("image/png").split(",")[1];
    }
    // 旋转 ~2°（上下边同向倾斜）+ 轻微梯形的“底片”
    const rotated = exportCanvas(900, 300, (ctx, w, h) => {
      ctx.fillStyle = "#ececec";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#4a4a4a";
      ctx.beginPath();
      ctx.moveTo(80, 70);
      ctx.lineTo(830, 40);
      ctx.lineTo(815, 230);
      ctx.lineTo(95, 255);
      ctx.closePath();
      ctx.fill();
    });
    // 轴对齐矩形：不应自动启用矫正
    const straight = exportCanvas(900, 300, (ctx, w, h) => {
      ctx.fillStyle = "#ececec";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#4a4a4a";
      ctx.fillRect(70, 45, 760, 210);
    });
    // 无背景（整幅都是“底片”）：应返回未检测到
    const noBg = exportCanvas(600, 300, (ctx, w, h) => {
      ctx.fillStyle = "#3c3c3c";
      ctx.fillRect(0, 0, w, h);
    });
    // 整体轻微倾斜(~1.1°) + 波浪边：边缘局部畸变不应触发全局拉正
    const wavy = exportCanvas(900, 300, (ctx, w, h) => {
      ctx.fillStyle = "#ececec";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#4a4a4a";
      const amp = 6;
      ctx.beginPath();
      ctx.moveTo(70, 50);
      for (let x = 70; x <= 830; x += 3) {
        const t = (x - 70) / 760;
        ctx.lineTo(x, 50 + t * 15 + Math.sin(t * Math.PI * 6) * amp);
      }
      for (let y = 50; y <= 265; y += 3) {
        const t = (y - 50) / 215;
        ctx.lineTo(830 + Math.sin(t * Math.PI * 4) * amp, y);
      }
      for (let x = 830; x >= 70; x -= 3) {
        const t = (x - 70) / 760;
        ctx.lineTo(x, 250 + t * 15 + Math.sin(t * Math.PI * 6) * amp);
      }
      for (let y = 265; y >= 50; y -= 3) {
        const t = (y - 50) / 215;
        ctx.lineTo(70 + Math.sin(t * Math.PI * 4) * amp, y);
      }
      ctx.closePath();
      ctx.fill();
    });
    return { rotated, straight, noBg, wavy };
  });
  await page.close();
  await writeFile(path.join(tmpDir, "rotated.png"), Buffer.from(files.rotated, "base64"));
  await writeFile(path.join(tmpDir, "straight.png"), Buffer.from(files.straight, "base64"));
  await writeFile(path.join(tmpDir, "no-bg.png"), Buffer.from(files.noBg, "base64"));
  await writeFile(path.join(tmpDir, "wavy.png"), Buffer.from(files.wavy, "base64"));
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

test("真实翻拍截图：默认不矫正，开启后拉正且导出一致", async () => {
  const page = await openTool();
  try {
    await importImage(page, path.join(FIXTURES, "fn-persp1.png"));
    const persp = await page.evaluate(() => window.__fnSelftest.perspective());
    assert.ok(persp && persp.quad, "应检测到四边形");
    assert.equal(persp.on, false, "默认不自动矫正");
    assert.ok(Math.abs(persp.angle) > 0.4 && Math.abs(persp.angle) < 3, `旋转角应落在 0.4°~3°，实际 ${persp.angle}`);
    const raw = await page.evaluate(() => window.__fnSelftest.previewSize());
    assert.equal(raw.w, raw.full.w, "默认关闭时预览应保持原始尺寸");
    const info = await page.textContent("#persp-info");
    assert.match(info, /默认关闭/);
    // 开启开关：按检测建议拉正
    await page.click("#persp-enabled + .switch-track");
    await page.waitForFunction(() => {
      const s = window.__fnSelftest.previewSize();
      return s.w > 0 && s.w !== s.full.w;
    }, null, { timeout: 30000 });
    const warped = await page.evaluate(() => window.__fnSelftest.previewSize());
    assert.notEqual(warped.w, warped.full.w, "开启后预览尺寸应与原图不同");
    // 关闭开关：回到原始几何
    await page.click("#persp-enabled + .switch-track");
    await page.waitForTimeout(1200);
    const off = await page.evaluate(() => ({
      persp: window.__fnSelftest.perspective(),
      size: window.__fnSelftest.previewSize()
    }));
    assert.equal(off.persp.on, false);
    assert.equal(off.size.w, off.size.full.w, "关闭后预览应回到原图尺寸");
    // 重新开启：恢复拉正
    await page.click("#persp-enabled + .switch-track");
    await page.waitForTimeout(1200);
    const on = await page.evaluate(() => window.__fnSelftest.previewSize());
    assert.equal(on.w, warped.w, "再次开启应恢复拉正尺寸");
    // 单张导出走全分辨率链路：导出尺寸应与拉正几何一致（本图 scale=1）
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 60000 }),
      page.click("#btn-export")
    ]);
    const file = await download.path();
    const buf = await readFile(file);
    let ew = 0, eh = 0, i = 2;
    while (i < buf.length - 1) {
      if (buf[i] !== 0xFF) { i += 1; continue; }
      const m = buf[i + 1];
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
        eh = buf.readUInt16BE(i + 5); ew = buf.readUInt16BE(i + 7); break;
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
    assert.equal(ew, warped.w, `导出宽度应与拉正预览一致（${ew} vs ${warped.w}）`);
    assert.equal(eh, warped.h, `导出高度应与拉正预览一致（${eh} vs ${warped.h}）`);
  } finally {
    await page.close();
  }
});

test("合成旋转梯形图：反推出的旋转角接近真实值", async () => {
  const page = await openTool();
  try {
    await importImage(page, path.join(tmpDir, "rotated.png"));
    const persp = await page.evaluate(() => window.__fnSelftest.perspective());
    assert.ok(persp && persp.quad, "应检测到四边形");
    assert.equal(persp.on, false, "默认不自动矫正");
    // 注入上下边斜率约 -0.04/-0.035 → 平均约 -2.1°，取绝对值比较
    assert.ok(Math.abs(Math.abs(persp.angle) - 2.1) < 1.0, `角度应接近 2.1°，实际 ${persp.angle}`);
  } finally {
    await page.close();
  }
});

test("轴对齐图：判定基本平直，不自动启用", async () => {
  const page = await openTool();
  try {
    await importImage(page, path.join(tmpDir, "straight.png"));
    const persp = await page.evaluate(() => window.__fnSelftest.perspective());
    assert.ok(persp && persp.quad, "应能检测到四边形");
    assert.equal(persp.on, false, "轴对齐时不应自动启用");
    const info = await page.textContent("#persp-info");
    assert.match(info, /基本平直/);
  } finally {
    await page.close();
  }
});

test("波浪边图：局部抚直默认关闭，开启后画面中心锚定不动", async () => {
  const page = await openTool();
  try {
    await importImage(page, path.join(tmpDir, "wavy.png"));
    const persp = await page.evaluate(() => window.__fnSelftest.perspective());
    assert.ok(persp && persp.quad, "应能检测到四边形");
    assert.equal(persp.mode, "local", "边缘弯曲应进入局部抚直模式而非全局拉正");
    assert.equal(persp.on, false, "局部抚直同样默认关闭");
    const info = await page.textContent("#persp-info");
    assert.match(info, /边缘弯曲.*默认关闭/);
    // 开启后画面中心必须锚定不动——锚定验证
    await page.click("#persp-enabled + .switch-track");
    await page.waitForTimeout(600);
    const centerOn = await page.evaluate(() => window.__fnSelftest.centerPixel());
    await page.click("#persp-enabled + .switch-track");
    await page.waitForTimeout(400);
    const centerOff = await page.evaluate(() => window.__fnSelftest.centerPixel());
    const sizeOff = await page.evaluate(() => window.__fnSelftest.previewSize());
    assert.equal(sizeOff.w, sizeOff.full.w, "关闭后预览应回到原始尺寸");
    assert.ok(centerOn && centerOff, "中心像素应可读取");
    const drift = Math.max(
      Math.abs(centerOn[0] - centerOff[0]),
      Math.abs(centerOn[1] - centerOff[1]),
      Math.abs(centerOn[2] - centerOff[2])
    );
    assert.ok(drift <= 2, `画面中心必须锚定不动（漂移 ${drift} > 2）`);
  } finally {
    await page.close();
  }
});

test("手动锚点矫正：拖四角 → 完成 → 应用，取消可恢复", async () => {
  const page = await openTool();
  try {
    await importImage(page, path.join(tmpDir, "rotated.png"));
    let persp = await page.evaluate(() => window.__fnSelftest.perspective());
    assert.equal(persp.on, false, "默认关闭");
    const q0 = JSON.parse(JSON.stringify(persp.quad));
    // 进入手动编辑态
    await page.click("#btn-persp-adjust");
    await page.waitForTimeout(300);
    assert.equal(await page.isVisible("#persp-overlay"), true, "锚点叠加层应显示");
    assert.equal(await page.evaluate(() => window.__fnSelftest.editing()), true, "应处于编辑态");
    const editSize = await page.evaluate(() => window.__fnSelftest.previewSize());
    assert.equal(editSize.w, editSize.full.w, "编辑态应显示未矫正原图");
    // 拖动左上角锚点向内
    const ab = await page.locator('.persp-anchor[data-anchor="0"]').boundingBox();
    assert.ok(ab, "锚点应有位置");
    await page.mouse.move(ab.x + ab.width / 2, ab.y + ab.height / 2);
    await page.mouse.down();
    await page.mouse.move(ab.x + ab.width / 2 + 60, ab.y + ab.height / 2 + 40, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    persp = await page.evaluate(() => window.__fnSelftest.perspective());
    assert.ok(persp.quad[0].x > q0[0].x + 0.02 && persp.quad[0].y > q0[0].y + 0.02,
      `TL 锚点应被拖动（${q0[0].x.toFixed(3)},${q0[0].y.toFixed(3)} → ${persp.quad[0].x.toFixed(3)},${persp.quad[0].y.toFixed(3)}）`);
    // 完成：应用手动锚点
    await page.click("#btn-persp-done");
    await page.waitForTimeout(800);
    persp = await page.evaluate(() => window.__fnSelftest.perspective());
    assert.equal(persp.on, true, "完成后应启用矫正");
    assert.equal(persp.mode, "manual", "应为手动模式");
    assert.equal(await page.evaluate(() => window.__fnSelftest.editing()), false, "应退出编辑态");
    assert.equal(await page.isVisible("#persp-overlay"), false, "叠加层应隐藏");
    const size = await page.evaluate(() => window.__fnSelftest.previewSize());
    assert.notEqual(size.w, size.full.w, "手动 quad 拉正后尺寸应变化");
    const doneQuad = JSON.parse(JSON.stringify(persp.quad));
    // 再次进入后取消：应恢复完成时的状态
    await page.click("#btn-persp-adjust");
    await page.waitForTimeout(300);
    await page.click("#btn-persp-cancel");
    await page.waitForTimeout(800);
    persp = await page.evaluate(() => window.__fnSelftest.perspective());
    assert.equal(persp.on, true, "取消应恢复进入前状态（保持开启）");
    assert.deepEqual(persp.quad, doneQuad, "取消应恢复进入前的锚点位置");
  } finally {
    await page.close();
  }
});

test("无背景图：不误报、界面不崩溃", async () => {
  const page = await openTool();
  try {
    await importImage(page, path.join(tmpDir, "no-bg.png"));
    const persp = await page.evaluate(() => window.__fnSelftest.perspective());
    assert.equal(persp, null, "无背景时应返回 null");
    const info = await page.textContent("#persp-info");
    assert.match(info, /未检测到清晰边缘/);
    const checked = await page.evaluate(() => document.getElementById("persp-enabled").disabled);
    assert.equal(checked, true, "无检测结果时开关应禁用");
  } finally {
    await page.close();
  }
});

test("橙色负片条带（含白色齿孔）：不误判为正片", async () => {
  const page = await openTool();
  try {
    await importImage(page, path.join(FIXTURES, "fn-strip-orange.png"));
    const info = await page.evaluate(() => ({
      hintHidden: document.getElementById("tone-hint").hidden,
      hintText: document.getElementById("tone-text").textContent,
      base: document.getElementById("base-rgb").textContent,
      source: document.getElementById("base-source").textContent,
      tag: document.getElementById("input-tag").textContent
    }));
    assert.equal(info.tag, "负片", "橙黄条带应判定为负片");
    assert.equal(info.hintHidden, true, `负片不应显示正片提示，实际文案：${info.hintText}`);
    assert.doesNotMatch(info.hintText, /正片/);
    // 片基必须是暖橙（R 明显高于 B），这是否决正片判定的依据
    const m = info.base.match(/RGB (\d+), (\d+), (\d+)/);
    assert.ok(m, `片基应为 RGB 三元组，实际：${info.base}`);
    assert.ok(Number(m[1]) - Number(m[3]) >= 25, `片基应为暖橙色，实际 ${info.base}`);
    assert.equal(info.source, "自动 · 间隔带", "片基应来自画格间隔带而非回退默认值");
  } finally {
    await page.close();
  }
});
