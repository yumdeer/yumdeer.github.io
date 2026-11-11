/*
 * 负片校正工具
 * 处理思路参考 QingSi Lab 的「直观胶片」（闭源），此处为独立实现：
 * 密度域负片转正 + 片基色归一 + 自动色阶 + 灰场白平衡 + 常规调整。
 * 全部在浏览器本地完成，图片不上传。
 */
(function () {
  "use strict";

  // ---------- 基础工具 ----------
  var DEFAULT_BASE = [211, 122, 78]; // 常见 C-41 负片片基的保守默认色

  var ADJUSTMENTS = {
    exposure:    { default: 0,  min: -2,   max: 2,   step: 0.01, label: "曝光",   fmt: function (v) { return v.toFixed(2) + " EV"; } },
    contrast:    { default: 0,  min: -100, max: 100, step: 1,    label: "对比度", fmt: function (v) { return String(Math.round(v)); } },
    temperature: { default: 0,  min: -100, max: 100, step: 1,    label: "色温",   fmt: function (v) { return String(Math.round(v)); } },
    tint:        { default: 0,  min: -100, max: 100, step: 1,    label: "色调",   fmt: function (v) { return String(Math.round(v)); } },
    saturation:  { default: 0,  min: -100, max: 100, step: 1,    label: "饱和度", fmt: function (v) { return String(Math.round(v)); } },
    blackPoint:  { default: 1,  min: 0,    max: 20,  step: 0.1,  label: "黑场",   fmt: function (v) { return v.toFixed(1) + "%"; } },
    whitePoint:  { default: 99, min: 80,   max: 100, step: 0.1,  label: "白场",   fmt: function (v) { return v.toFixed(1) + "%"; } },
    gamma:       { default: 1,  min: 0.4,  max: 2.4, step: 0.01, label: "Gamma",  fmt: function (v) { return v.toFixed(2); } },
  };

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function roundClamp(v) { return Math.round(clamp(v, 0, 255)); }
  function lum8(r, g, b) { return r * 0.2126 + g * 0.7152 + b * 0.0722; }
  function lum01(r, g, b) { return r * 0.2126 + g * 0.7152 + b * 0.0722; }
  function lerp(a, b, t) { return a + (b - a) * clamp(t, 0, 1); }
  function smoothstep(a, b, x) {
    var t = clamp((x - a) / Math.max(1e-4, b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }
  // sRGB(0-255) -> 线性(0-1)
  function srgbToLinear(v) {
    var t = clamp(v, 0, 255) / 255;
    return t <= 0.04045 ? t / 12.92 : Math.pow((t + 0.055) / 1.055, 2.4);
  }
  // 线性(0-1) -> sRGB(0-255)
  function linearToSrgb(v) {
    var t = clamp(v, 0, 1);
    return roundClamp((t <= 0.0031308 ? t * 12.92 : 1.055 * Math.pow(t, 1 / 2.4) - 0.055) * 255);
  }
  // 截尾均值：排序后去掉两端 trim 比例的样本再求平均，抗噪点
  function trimmedMean(arr, trim) {
    if (!arr.length) return 0;
    var a = arr.slice().sort(function (x, y) { return x - y; });
    var lo = Math.floor(a.length * trim);
    var hi = Math.max(lo + 1, Math.ceil(a.length * (1 - trim)));
    var sum = 0;
    for (var i = lo; i < hi; i++) sum += a[i];
    return sum / (hi - lo);
  }
  // 直方图分位点
  function percentile(hist, t) {
    var total = 0;
    for (var i = 0; i < hist.length; i++) total += hist[i];
    if (!total) return 0;
    var target = total * clamp(t, 0, 1);
    var acc = 0;
    for (var j = 0; j < hist.length; j++) {
      acc += hist[j];
      if (acc >= target) return j;
    }
    return 255;
  }

  // ---------- 核心算法 ----------

  // 片基归一 + 密度域反转：负片越黑(密度高)透光越少，归一后取 -log 得到正片亮度
  function baseCorrect(px, base) {
    var a = srgbToLinear(px) + 0.0005;
    var b = Math.max(0.018, srgbToLinear(base));
    var r = clamp(a / b, 0.002, 1.6);
    return clamp(-Math.log(Math.min(1, r)) / 2.6, 0, 1);
  }

  // 自动色阶：片基归一后的逐通道直方图，取 0.5% / 99.5% 分位（跳过极端像素）
  function autoLevels(data, base) {
    var hists = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    for (var i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      var l = lum8(data[i], data[i + 1], data[i + 2]);
      if (l < 10 || l > 248) continue;
      for (var c = 0; c < 3; c++) {
        hists[c][roundClamp(baseCorrect(data[i + c], base[c]) * 255)] += 1;
      }
    }
    return hists.map(function (h) {
      var black = percentile(h, 0.005);
      var white = Math.max(black + 8, percentile(h, 0.995));
      return { black: black, white: white };
    });
  }

  function applyLevels(v, stat) {
    return clamp((v * 255 - stat.black) / Math.max(1, stat.white - stat.black), 0, 1);
  }

  // 灰场白平衡：取中等亮度、中等彩度的像素求各通道均值，算出增益
  function whiteBalanceGains(data, base, levels) {
    var sum = [0, 0, 0];
    var count = 0;
    var px = data.length / 4;
    var stride = Math.max(1, Math.floor(px / 650000));
    var rgb = [0, 0, 0];
    for (var p = 0; p < px; p += stride) {
      var o = p * 4;
      if (data[o + 3] === 0) continue;
      for (var c = 0; c < 3; c++) {
        rgb[c] = applyLevels(baseCorrect(data[o + c], base[c]), levels[c]);
      }
      var l = lum01(rgb[0], rgb[1], rgb[2]);
      var max = Math.max(rgb[0], rgb[1], rgb[2]);
      var min = Math.min(rgb[0], rgb[1], rgb[2]);
      var spread = max - min;
      if (l < 0.15 || l > 0.85 || spread < 0.015 || spread > 0.58) continue;
      sum[0] += rgb[0]; sum[1] += rgb[1]; sum[2] += rgb[2];
      count += 1;
    }
    if (count < 120) return [1, 1, 1];
    var mean = [sum[0] / count, sum[1] / count, sum[2] / count];
    var overall = (mean[0] + mean[1] + mean[2]) / 3;
    return mean.map(function (m) {
      return clamp(1 + (overall / Math.max(0.001, m) - 1) * 0.46, 0.78, 1.24);
    });
  }

  function analyze(data, base) {
    var levels = autoLevels(data, base);
    return { levels: levels, gains: whiteBalanceGains(data, base, levels) };
  }

  // 自动识别片基（双策略自动择优）：
  // A. 边缘采样：适用于画面四周露出未曝光片基的常规扫描。
  // B. 内容高光分位：适用于边缘被遮罩/裁剪掉的扫描（如黑边整卷扫描条），
  //    负片中场景阴影≈接近片基的最亮区域，取内容像素逐通道 99.5% 分位估计。
  function autoDetectBase(data, w, h) {
    var edge = detectBaseFromEdges(data, w, h);
    var content = detectBaseFromContent(data, w, h);
    // 内容法明显亮于边缘法时，说明边缘采到的是遮罩黑边或画面内容，改用内容法
    if (edge && (!content || Math.max(edge.rgb[0], edge.rgb[1], edge.rgb[2]) * 1.15 >= Math.max(content.rgb[0], content.rgb[1], content.rgb[2]))) {
      return edge;
    }
    if (content) return content;
    return { rgb: DEFAULT_BASE.slice(), source: "fallback", confidence: 0, message: "边缘与内容样本均不足，使用默认片基，建议手动取样。" };
  }

  // 策略A：沿画面边缘采样，过滤高细节与极端亮度，按"平滑度"评分后取截尾均值
  function detectBaseFromEdges(data, w, h) {
    var step = Math.max(3, Math.round(Math.min(w, h) / 240));
    var margin = Math.max(18, Math.round(Math.min(w, h) * 0.16));
    var samples = [];
    var px = function (x, y) {
      var o = (y * w + x) * 4;
      return [data[o], data[o + 1], data[o + 2]];
    };
    for (var y = 0; y < h; y += step) {
      for (var x = 0; x < w; x += step) {
        var onEdgeH = x < margin || x >= w - margin;
        var onEdgeV = y < margin || y >= h - margin;
        if (!(onEdgeH || onEdgeV)) continue;
        var o = (y * w + x) * 4;
        if (data[o + 3] === 0) continue;
        var r = data[o], g = data[o + 1], b = data[o + 2];
        var l = lum8(r, g, b);
        var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if (l < 28 || l > 236 || mn < 6 || mx > 250) continue;
        // 局部细节：与右/下邻居的亮度差
        var right = px(Math.min(w - 1, x + step), y);
        var down = px(x, Math.min(h - 1, y + step));
        var detail = Math.abs(l - lum8(right[0], right[1], right[2])) +
                     Math.abs(l - lum8(down[0], down[1], down[2]));
        if (detail > 38) continue;
        var isCorner = onEdgeH && onEdgeV;
        // 越平滑越好；负片片基通常 R>=G>=B（橙红），略微加分
        var warmOrder = r >= g && g >= b ? 4 : 0;
        var score = detail - l * 0.08 - warmOrder - (isCorner ? 3 : 0);
        samples.push({ r: r, g: g, b: b, score: score });
      }
    }
    if (samples.length < 24) return null;
    samples.sort(function (a, b) { return a.score - b.score; });
    var kept = samples.slice(0, Math.max(24, Math.round(samples.length * 0.72)));
    var chans = [[], [], []];
    kept.forEach(function (s) { chans[0].push(s.r); chans[1].push(s.g); chans[2].push(s.b); });
    var rgb = chans.map(function (c, i) {
      return roundClamp(trimmedMean(c, 0.12) || DEFAULT_BASE[i]);
    });
    var confidence = clamp(kept.length / 220, 0.18, 0.96);
    return { rgb: rgb, source: "auto", confidence: confidence, message: "已从 " + kept.length + " 个边缘样本自动识别片基。" };
  }

  // 策略B：画面内容逐通道 99.5% 分位估计片基（跳过遮罩黑边等极端像素）
  function detectBaseFromContent(data, w, h) {
    var hists = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    var count = 0;
    var total = w * h;
    var stride = Math.max(1, Math.floor(total / 400000));
    for (var p = 0; p < total; p += stride) {
      var o = p * 4;
      if (data[o + 3] === 0) continue;
      var l = lum8(data[o], data[o + 1], data[o + 2]);
      if (l < 30 || l > 248) continue;
      count += 1;
      hists[0][data[o]] += 1;
      hists[1][data[o + 1]] += 1;
      hists[2][data[o + 2]] += 1;
    }
    if (count < 1000) return null;
    var rgb = [
      roundClamp(percentile(hists[0], 0.995)),
      roundClamp(percentile(hists[1], 0.995)),
      roundClamp(percentile(hists[2], 0.995)),
    ];
    var confidence = clamp(count / 200000, 0.2, 0.9);
    return { rgb: rgb, source: "auto", confidence: confidence, message: "边缘无法取样（遮罩式扫描或已裁边），已从画面内容估计片基。" };
  }

  // 手动取样：以点击点为圆心取圆盘内像素的截尾均值
  function manualSample(data, w, h, cx, cy, radius) {
    var r = Math.round(clamp(radius || 12, 4, 32));
    cx = Math.round(clamp(cx, 0, w - 1));
    cy = Math.round(clamp(cy, 0, h - 1));
    var chans = [[], [], []];
    for (var y = Math.max(0, cy - r); y <= Math.min(h - 1, cy + r); y++) {
      for (var x = Math.max(0, cx - r); x <= Math.min(w - 1, cx + r); x++) {
        if (Math.hypot(x - cx, y - cy) > r) continue;
        var o = (y * w + x) * 4;
        if (data[o + 3] === 0) continue;
        for (var c = 0; c < 3; c++) {
          var v = data[o + c];
          if (v >= 4 && v <= 251) chans[c].push(v);
        }
      }
    }
    var rgb = chans.map(function (ch, i) {
      return ch.length < 8 ? DEFAULT_BASE[i] : roundClamp(trimmedMean(ch, 0.14));
    });
    var n = Math.min(chans[0].length, chans[1].length, chans[2].length);
    return { rgb: rgb, source: "manual", message: "已手动取样片基（" + n + " 个有效像素）。" };
  }

  // 亮度自适应饱和
  function applySaturation(r, g, b, sat, out) {
    var l = lum01(r, g, b);
    var s = lerp(0.34, 1, smoothstep(0.1, 0.32, l));
    var c = 1 - smoothstep(0.82, 0.98, l) * 0.12;
    var base = s * c;
    var d = 1 - (1 - smoothstep(0.035, 0.11, l)) * 0.055;
    var p = sat >= 1 ? 1 + (sat - 1) * base : 1 - (1 - sat) * lerp(0.82, 1, base);
    var k = clamp(p * d, 0, 1.8);
    out[0] = clamp(l + (r - l) * k, 0, 1);
    out[1] = clamp(l + (g - l) * k, 0, 1);
    out[2] = clamp(l + (b - l) * k, 0, 1);
  }

  // 以亮度缩放方式做颜色变换（保持色相）
  function scaleByLum(r, g, b, target, out) {
    var l = lum01(r, g, b);
    if (l <= 1e-4) { out[0] = out[1] = out[2] = target; return; }
    var k = target / l;
    out[0] = clamp(r * k, 0, 1);
    out[1] = clamp(g * k, 0, 1);
    out[2] = clamp(b * k, 0, 1);
  }

  // 对比度：0.45 支点 + 高光/暗部保护
  function applyContrast(r, g, b, amount, out) {
    if (Math.abs(amount) < 0.001) { out[0] = r; out[1] = g; out[2] = b; return; }
    var l = lum01(r, g, b);
    var slope = 1 + amount * 0.0075;
    var pivot = clamp((l - 0.45) * slope + 0.45, 0, 1);
    var blend = amount > 0 ? smoothstep(0.08, 0.35, l) : 0.9;
    scaleByLum(r, g, b, lerp(l, pivot, blend), out);
  }

  // 用户黑白场（带暗部 toe 平滑）
  function applyUserLevels(v, black, white) {
    var span = Math.max(0.02, white - black);
    var leveled = clamp((v - black) / span, 0, 1);
    var toe = clamp(black / 0.2, 0, 1);
    var raised = v * (1 - toe * 0.22);
    var blend = smoothstep(black * 0.5, Math.min(0.5, black + 0.22), v);
    return clamp(lerp(raised, leveled, blend), 0, 1);
  }

  // 主渲染：src -> dst（均为 ImageData.data）
  function render(src, dst, base, adj, analysis) {
    var levels = analysis.levels;
    var gains = analysis.gains;
    var exposure = Math.pow(2, adj.exposure);
    var sat = 1 + adj.saturation * 0.01;
    var gamma = Math.max(0.1, adj.gamma);
    // 色温偏暖/冷、色调偏绿/品红，逐通道增益
    var kR = 1 + adj.temperature * 0.0028 + Math.max(0, adj.tint) * 0.001;
    var kG = 1 - adj.tint * 0.002;
    var kB = 1 - adj.temperature * 0.0028 + Math.max(0, -adj.tint) * 0.001;
    var black = clamp(adj.blackPoint / 100, 0, 0.95);
    var white = Math.max(clamp(adj.whitePoint / 100, 0.05, 1), black + 0.02);
    var tmp = [0, 0, 0];
    for (var i = 0; i < src.length; i += 4) {
      if (src[i + 3] === 0) {
        dst[i] = dst[i + 1] = dst[i + 2] = dst[i + 3] = 0;
        continue;
      }
      var rgb = [0, 0, 0];
      for (var c = 0; c < 3; c++) {
        var v = applyLevels(baseCorrect(src[i + c], base[c]), levels[c]);
        v = clamp(v * gains[c], 0, 1);
        v = applyUserLevels(v, black, white);
        rgb[c] = Math.pow(v, 1 / gamma) * exposure * (c === 0 ? kR : c === 1 ? kG : kB);
        rgb[c] = clamp(rgb[c], 0, 1);
      }
      applySaturation(rgb[0], rgb[1], rgb[2], sat, tmp);
      applyContrast(tmp[0], tmp[1], tmp[2], adj.contrast, tmp);
      dst[i] = linearToSrgb(tmp[0]);
      dst[i + 1] = linearToSrgb(tmp[1]);
      dst[i + 2] = linearToSrgb(tmp[2]);
      dst[i + 3] = src[i + 3];
    }
  }

  // ---------- 图片解码（含 TIFF 兜底） ----------
  function decodeFile(file) {
    return createImageBitmap(file).catch(function (err) {
      return file.arrayBuffer().then(function (buffer) {
        var bytes = new Uint8Array(buffer);
        var isTiff = (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a) ||
                     (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a);
        if (!isTiff || typeof UTIF === "undefined") throw err;
        var ifds = UTIF.decode(buffer);
        if (!ifds.length) throw err;
        UTIF.decodeImage(buffer, ifds[0], ifds);
        var rgba = UTIF.toRGBA8(ifds[0]);
        var w = ifds[0].width, h = ifds[0].height;
        var cnv = document.createElement("canvas");
        cnv.width = w; cnv.height = h;
        var ctx = cnv.getContext("2d");
        var imgData = ctx.createImageData(w, h);
        imgData.data.set(rgba);
        ctx.putImageData(imgData, 0, 0);
        return createImageBitmap(cnv);
      });
    });
  }

  // ---------- UI ----------
  var state = {
    bitmap: null,        // 原始全尺寸 ImageBitmap
    previewData: null,   // 预览尺寸 ImageData（原始负片）
    previewW: 0,
    previewH: 0,
    fullW: 0,
    fullH: 0,
    base: DEFAULT_BASE.slice(),
    baseSource: "default",
    adj: null,
    analysis: null,
    isSampling: false,
    rendering: false,
    pendingRender: false,
    showingOriginal: false,
    renderTimer: 0,
  };

  var el = {
    dropZone: document.getElementById("drop-zone"),
    fileInput: document.getElementById("file-input"),
    canvasWrap: document.getElementById("canvas-wrap"),
    canvas: document.getElementById("canvas"),
    sampleBadge: document.getElementById("sample-badge"),
    status: document.getElementById("status"),
    btnCompare: document.getElementById("btn-compare"),
    btnReset: document.getElementById("btn-reset"),
    btnExport: document.getElementById("btn-export"),
    btnAutoBase: document.getElementById("btn-auto-base"),
    btnManualBase: document.getElementById("btn-manual-base"),
    baseSwatch: document.getElementById("base-swatch"),
    baseRgb: document.getElementById("base-rgb"),
    baseSource: document.getElementById("base-source"),
    baseMessage: document.getElementById("base-message"),
    sliders: document.getElementById("sliders"),
  };

  var canvasCtx = el.canvas.getContext("2d");

  function defaultAdjustments() {
    var o = {};
    for (var k in ADJUSTMENTS) o[k] = ADJUSTMENTS[k].default;
    return o;
  }
  state.adj = defaultAdjustments();

  function setStatus(text) { el.status.textContent = text; }

  function updateBaseUI() {
    var r = state.base[0], g = state.base[1], b = state.base[2];
    el.baseSwatch.style.background = "rgb(" + r + ", " + g + ", " + b + ")";
    el.baseRgb.textContent = "RGB " + r + ", " + g + ", " + b;
    el.baseSource.textContent = state.baseSource === "manual" ? "手动" :
      state.baseSource === "auto" ? "自动" : "默认值";
  }

  function updateBaseMessage(msg) {
    if (msg) el.baseMessage.textContent = msg;
  }

  // ---- 调整滑块 ----
  var sliderEls = {};
  function buildSliders() {
    Object.keys(ADJUSTMENTS).forEach(function (key) {
      var spec = ADJUSTMENTS[key];
      var row = document.createElement("div");
      row.className = "slider-row";
      var label = document.createElement("label");
      label.textContent = spec.label;
      var input = document.createElement("input");
      input.type = "range";
      input.min = spec.min;
      input.max = spec.max;
      input.step = spec.step;
      input.value = String(spec.default);
      var value = document.createElement("span");
      value.className = "value";
      value.textContent = spec.fmt(spec.default);
      input.addEventListener("input", function () {
        state.adj[key] = Number(input.value);
        value.textContent = spec.fmt(state.adj[key]);
        scheduleRender();
      });
      input.addEventListener("dblclick", function () {
        state.adj[key] = spec.default;
        input.value = String(spec.default);
        value.textContent = spec.fmt(spec.default);
        scheduleRender();
      });
      row.appendChild(label);
      row.appendChild(input);
      row.appendChild(value);
      el.sliders.appendChild(row);
      sliderEls[key] = { input: input, value: value, spec: spec };
    });
  }

  function resetAdjustments() {
    Object.keys(sliderEls).forEach(function (key) {
      var s = sliderEls[key];
      state.adj[key] = s.spec.default;
      s.input.value = String(s.spec.default);
      s.value.textContent = s.spec.fmt(s.spec.default);
    });
    scheduleRender();
  }

  // ---- 渲染 ----
  function scheduleRender() {
    if (state.showingOriginal) return;
    if (state.rendering) { state.pendingRender = true; return; }
    clearTimeout(state.renderTimer);
    state.renderTimer = setTimeout(doRender, 30);
  }

  function doRender() {
    if (!state.previewData || state.showingOriginal) return;
    state.rendering = true;
    var src = state.previewData.data;
    var out = canvasCtx.createImageData(state.previewW, state.previewH);
    render(src, out.data, state.base, state.adj, state.analysis);
    canvasCtx.putImageData(out, 0, 0);
    state.rendering = false;
    if (state.pendingRender) {
      state.pendingRender = false;
      scheduleRender();
    }
  }

  function drawOriginalPreview() {
    canvasCtx.putImageData(state.previewData, 0, 0);
  }

  // ---- 载入图片 ----
  function loadFile(file) {
    if (!file || !/^image\//.test(file.type) && !/\.(tif|tiff)$/i.test(file.name)) return;
    setStatus("正在解码图片…");
    decodeFile(file).then(function (bitmap) {
      state.bitmap = bitmap;
      state.fullW = bitmap.width;
      state.fullH = bitmap.height;
      // 预览尺寸：限制最长边 1600px
      var scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      var w = Math.max(1, Math.round(bitmap.width * scale));
      var h = Math.max(1, Math.round(bitmap.height * scale));
      var cnv = document.createElement("canvas");
      cnv.width = w; cnv.height = h;
      var ctx = cnv.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, 0, w, h);
      state.previewData = ctx.getImageData(0, 0, w, h);
      state.previewW = w;
      state.previewH = h;
      el.canvas.width = w;
      el.canvas.height = h;
      el.dropZone.hidden = true;
      el.canvasWrap.hidden = false;
      [el.btnCompare, el.btnReset, el.btnExport, el.btnAutoBase, el.btnManualBase].forEach(function (b) { b.disabled = false; });
      state.adj = defaultAdjustments();
      Object.keys(sliderEls).forEach(function (key) {
        var s = sliderEls[key];
        s.input.value = String(s.spec.default);
        s.value.textContent = s.spec.fmt(s.spec.default);
      });
      setSampling(false);
      // 自动识别片基并分析
      var detected = autoDetectBase(state.previewData.data, w, h);
      state.base = detected.rgb;
      state.baseSource = detected.source;
      state.analysis = analyze(state.previewData.data, state.base);
      updateBaseUI();
      updateBaseMessage(detected.message);
      doRender();
      setStatus(file.name + " · " + bitmap.width + " × " + bitmap.height);
    }).catch(function (err) {
      console.error(err);
      setStatus("图片解码失败：" + (err && err.message ? err.message : "不支持的格式"));
    });
  }

  // ---- 手动取样 ----
  function setSampling(on) {
    state.isSampling = on;
    el.btnManualBase.classList.toggle("is-active", on);
    el.btnManualBase.textContent = on ? "取样中…点击画布" : "手动取样";
    el.canvas.classList.toggle("is-sampling", on);
    el.sampleBadge.hidden = !on;
  }

  el.btnManualBase.addEventListener("click", function () {
    if (!state.previewData) return;
    setSampling(!state.isSampling);
  });

  el.canvas.addEventListener("click", function (e) {
    if (!state.isSampling || !state.previewData) return;
    var rect = el.canvas.getBoundingClientRect();
    var x = Math.round((e.clientX - rect.left) / rect.width * state.previewW);
    var y = Math.round((e.clientY - rect.top) / rect.height * state.previewH);
    var sampled = manualSample(state.previewData.data, state.previewW, state.previewH, x, y, 12);
    state.base = sampled.rgb;
    state.baseSource = "manual";
    state.analysis = analyze(state.previewData.data, state.base);
    updateBaseUI();
    updateBaseMessage(sampled.message);
    setSampling(false);
    scheduleRender();
  });

  el.btnAutoBase.addEventListener("click", function () {
    if (!state.previewData) return;
    var detected = autoDetectBase(state.previewData.data, state.previewW, state.previewH);
    state.base = detected.rgb;
    state.baseSource = detected.source;
    state.analysis = analyze(state.previewData.data, state.base);
    updateBaseUI();
    updateBaseMessage(detected.message);
    setSampling(false);
    scheduleRender();
  });

  // ---- 对比原片 ----
  function showOriginal(on) {
    if (!state.previewData) return;
    state.showingOriginal = on;
    if (on) drawOriginalPreview();
    else doRender();
  }
  ["pointerdown"].forEach(function (ev) {
    el.btnCompare.addEventListener(ev, function (e) { e.preventDefault(); showOriginal(true); });
  });
  ["pointerup", "pointerleave", "pointercancel"].forEach(function (ev) {
    el.btnCompare.addEventListener(ev, function () { showOriginal(false); });
  });

  el.btnReset.addEventListener("click", resetAdjustments);

  // ---- 导出：按原始分辨率渲染 ----
  el.btnExport.addEventListener("click", function () {
    if (!state.bitmap) return;
    el.btnExport.disabled = true;
    setStatus("正在按原始分辨率导出…");
    setTimeout(function () {
      try {
        var w = state.fullW, h = state.fullH;
        var cnv = document.createElement("canvas");
        cnv.width = w; cnv.height = h;
        var ctx = cnv.getContext("2d");
        ctx.drawImage(state.bitmap, 0, 0, w, h);
        var src = ctx.getImageData(0, 0, w, h);
        var out = ctx.createImageData(w, h);
        render(src.data, out.data, state.base, state.adj, state.analysis);
        ctx.putImageData(out, 0, 0);
        cnv.toBlob(function (blob) {
          var url = URL.createObjectURL(blob);
          var a = document.createElement("a");
          var stem = "negative";
          a.href = url;
          a.download = stem + "-converted.jpg";
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
          setStatus("已导出 JPEG（" + w + " × " + h + "）");
          el.btnExport.disabled = false;
        }, "image/jpeg", 0.92);
      } catch (err) {
        console.error(err);
        setStatus("导出失败：" + err.message);
        el.btnExport.disabled = false;
      }
    }, 20);
  });

  // ---- 拖放与选择 ----
  el.dropZone.addEventListener("click", function () { el.fileInput.click(); });
  el.dropZone.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.fileInput.click(); }
  });
  el.fileInput.addEventListener("change", function () {
    if (el.fileInput.files && el.fileInput.files[0]) loadFile(el.fileInput.files[0]);
    el.fileInput.value = "";
  });
  ["dragover", "dragenter"].forEach(function (ev) {
    el.dropZone.addEventListener(ev, function (e) {
      e.preventDefault();
      el.dropZone.classList.add("is-dragover");
    });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    el.dropZone.addEventListener(ev, function (e) {
      e.preventDefault();
      el.dropZone.classList.remove("is-dragover");
    });
  });
  el.dropZone.addEventListener("drop", function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadFile(f);
  });

  buildSliders();
  updateBaseUI();
})();
