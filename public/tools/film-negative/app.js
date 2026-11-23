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

  // 正片直通：不做密度反相与色阶重映射，仅保留调色
  function analyzePositive() {
    var id = { black: 0, white: 255 };
    return { positive: true, levels: [id, id, id], gains: [1, 1, 1] };
  }

  // 正负片判断：负片片基呈橙褐色、画面整体偏暗；已反相的正片通常有中性高光或白边
  function detectPositive(data, w, h) {
    var neutralBright = 0;
    var total = 0;
    var step = Math.max(1, Math.floor((w * h) / 120000));
    for (var p = 0; p < w * h; p += step) {
      var o = p * 4;
      if (data[o + 3] === 0) continue;
      total += 1;
      var mx = Math.max(data[o], data[o + 1], data[o + 2]);
      var mn = Math.min(data[o], data[o + 1], data[o + 2]);
      if (mx > 232 && mx - mn < 18) neutralBright += 1;
    }
    var edge = detectBaseFromEdges(data, w, h);
    var edgeLum = edge ? lum8(edge.rgb[0], edge.rgb[1], edge.rgb[2]) : 0;
    var edgeSat = edge ? Math.max(edge.rgb[0], edge.rgb[1], edge.rgb[2]) - Math.min(edge.rgb[0], edge.rgb[1], edge.rgb[2]) : 0;
    var ratio = total ? neutralBright / total : 0;
    var score = 0;
    if (edgeLum > 170 && edgeSat < 34) score += 2;
    if (ratio > 0.004) score += 2;
    if (ratio > 0.02) score += 1;
    return { positive: score >= 2, score: score, ratio: ratio, edgeLum: edgeLum, edgeSat: edgeSat };
  }

  // 自动识别片基（双策略自动择优）：
  // A. 边缘采样：适用于画面四周露出未曝光片基的常规扫描。
  // B. 内容高光分位：适用于边缘被遮罩/裁剪掉的扫描（如黑边整卷扫描条），
  //    负片中场景阴影≈接近片基的最亮区域，取内容像素逐通道 99.5% 分位估计。
  function autoDetectBase(data, w, h) {
    // 策略A0：多画幅条带优先——翻拍/整卷扫描的片基在画格间隔带里，
    // 画面边缘只会采到亮背景或黑色夹具，必须先看内部间隔带
    var gaps = detectBaseFromStripGaps(data, w, h);
    if (gaps) return gaps;
    var edge = detectBaseFromEdges(data, w, h);
    var content = detectBaseFromContent(data, w, h);
    // 内容法明显亮于边缘法时，说明边缘采到的是遮罩黑边或画面内容，改用内容法
    if (edge && (!content || Math.max(edge.rgb[0], edge.rgb[1], edge.rgb[2]) * 1.15 >= Math.max(content.rgb[0], content.rgb[1], content.rgb[2]))) {
      return edge;
    }
    if (content) return content;
    return { rgb: DEFAULT_BASE.slice(), source: "fallback", confidence: 0, samples: 0, message: "边缘与内容样本均不足，使用默认片基，建议手动取样。" };
  }

  // 策略A0：多画幅条带（翻拍底片/整卷扫描）——片基在画格间隔带里。
  // 间隔带是未曝光胶片：暖色序（橙罩 R≥G≥B）、较亮（负片中最亮的均匀区域）、
  // 高度均匀（无画面纹理）。逐列（横条）/逐行（竖条）统计中央截面，
  // 找出满足判据的连续条带，取其中位数为片基。单画幅或黑白片自动回退。
  function detectBaseFromStripGaps(data, w, h) {
    var horizontal = w >= h * 2.2;
    var vertical = h >= w * 2.2;
    if (!horizontal && !vertical) return null;
    var n = horizontal ? w : h;      // 沿条带方向的位置数
    var span = horizontal ? h : w;   // 条带横截面尺寸
    var lo = Math.round(span * 0.22);
    var hi = Math.round(span * 0.78);
    if (hi - lo < 10 || n < 60) return null;
    var step = Math.max(1, Math.floor((hi - lo) / 80));
    var cols = [];
    for (var i = 0; i < n; i++) {
      var r = 0, g = 0, b = 0, cnt = 0;
      var ls = [];
      for (var j = lo; j < hi; j += step) {
        var o = horizontal ? (j * w + i) * 4 : (i * w + j) * 4;
        var rr = data[o], gg = data[o + 1], bb = data[o + 2];
        r += rr; g += gg; b += bb; cnt++;
        ls.push(lum8(rr, gg, bb));
      }
      if (cnt < 6) continue;
      r /= cnt; g /= cnt; b /= cnt;
      var lmean = 0, dev = 0;
      for (var k = 0; k < ls.length; k++) lmean += ls[k];
      lmean /= ls.length;
      for (var k2 = 0; k2 < ls.length; k2++) dev += Math.abs(ls[k2] - lmean);
      dev /= ls.length;
      cols.push({ i: i, r: r, g: g, b: b, l: lmean, dev: dev });
    }
    if (cols.length < n * 0.5) return null;
    // 间隔带判据：暖色序 + 较亮 + 均匀（无画面纹理）
    var cand = cols.filter(function (c) {
      return c.l >= 80 && c.dev <= 8 && c.r >= c.g - 3 && c.g >= c.b - 3 && c.r - c.b >= 12;
    });
    if (!cand.length) return null;
    // 只保留与最亮候选同一亮度级的条带：片基是负片中最亮的均匀区域，
    // 暗红内容（如暗部场景）虽满足暖色序但明显更暗，需剔除
    var maxL = 0;
    cand.forEach(function (c) { if (c.l > maxL) maxL = c.l; });
    var kept = cand.filter(function (c) { return c.l >= maxL * 0.86; });
    // 连续段宽度校验：排除零星误检列
    var runs = [];
    var run = [];
    kept.forEach(function (c) {
      if (run.length && c.i - run[run.length - 1].i <= 2) run.push(c);
      else { if (run.length) runs.push(run); run = [c]; }
    });
    if (run.length) runs.push(run);
    var minRun = Math.max(3, Math.round(n * 0.004));
    runs = runs.filter(function (rr) { return rr.length >= minRun; });
    if (!runs.length) return null;
    var all = [];
    runs.forEach(function (rr) { rr.forEach(function (c) { all.push(c); }); });
    if (all.length < n * 0.004 || all.length > n * 0.45) return null;
    function medOf(key) {
      var arr = all.map(function (c) { return c[key]; }).sort(function (a, b) { return a - b; });
      return arr[Math.floor(arr.length / 2)];
    }
    return {
      rgb: [Math.round(medOf("r")), Math.round(medOf("g")), Math.round(medOf("b"))],
      source: "gaps",
      confidence: clamp(all.length / (n * 0.03), 0.55, 1),
      samples: all.length,
      message: "从画格间隔带检测片基（" + runs.length + " 段 / " + all.length + " 列采样）。"
    };
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
    return { rgb: rgb, source: "auto", confidence: confidence, samples: kept.length, message: "已从 " + kept.length + " 个边缘样本自动识别片基。" };
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
    return { rgb: rgb, source: "auto", confidence: confidence, samples: count, message: "边缘无法取样（遮罩式扫描或已裁边），已从画面内容估计片基（基于 " + count + " 个采样像素）。" };
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
    return { rgb: rgb, source: "manual", confidence: clamp(n / (Math.PI * r * r), 0, 1), samples: n, message: "已手动取样片基（" + n + " 个有效像素）。" };
  }

  // ---------- 透视矫正（翻拍底片自动拉正） ----------

  function medianOf(arr) {
    if (!arr.length) return 0;
    var a = arr.slice().sort(function (x, y) { return x - y; });
    return a[Math.floor((a.length - 1) / 2)];
  }

  // 稳健直线拟合：isVertical 时拟合 x = a*y + b（竖直边），否则 y = a*x + b（水平边）。
  // 两轮残差剔除（> 2.5×MAD 视为离群），要求有效点占比达标。
  function fitRobustLine(pts, isVertical, needCount) {
    if (!pts || pts.length < Math.max(8, needCount * 0.3)) return null;
    var usable = pts.slice();
    var fit = null;
    for (var round = 0; round < 3; round++) {
      if (usable.length < 8) break;
      var n = usable.length;
      var sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (var i = 0; i < n; i++) {
        var px = usable[i].x, py = usable[i].y;
        if (isVertical) { sx += py; sy += px; sxx += py * py; sxy += py * px; }
        else { sx += px; sy += py; sxx += px * px; sxy += px * py; }
      }
      // 拟合 v = a*u + b
      var denom = n * sxx - sx * sx;
      if (Math.abs(denom) < 1e-6) return null;
      var a = (n * sxy - sx * sy) / denom;
      var b = (sy - a * sx) / n;
      fit = { a: a, b: b };
      var residuals = usable.map(function (pt) {
        var u = isVertical ? pt.y : pt.x;
        var v = isVertical ? pt.x : pt.y;
        return Math.abs(v - (a * u + b));
      });
      var mad = medianOf(residuals) || 0.5;
      var limit = Math.max(2.5, mad * 2.5);
      var kept = usable.filter(function (_, k) { return residuals[k] <= limit; });
      if (kept.length < 8 || kept.length === usable.length) { usable = kept.length >= 8 ? kept : usable; break; }
      usable = kept;
    }
    if (!fit || usable.length < needCount * 0.3) return null;
    fit.count = usable.length;
    // 内点 RMS 残差：反映边缘本身的直线度（波浪边/软边残差大）
    var sq = 0;
    for (var r = 0; r < usable.length; r++) {
      var ru = isVertical ? usable[r].y : usable[r].x;
      var rv = isVertical ? usable[r].x : usable[r].y;
      var rd = rv - (fit.a * ru + fit.b);
      sq += rd * rd;
    }
    fit.rms = Math.sqrt(sq / usable.length);
    return fit;
  }

  // 直线交点：hLine 为 y = a*x + b，vLine 为 x = c*y + d
  function intersectLines(hLine, vLine) {
    var denom = 1 - hLine.a * vLine.a;
    if (Math.abs(denom) < 1e-9) return null;
    var y = (hLine.a * vLine.b + hLine.b) / denom;
    var x = vLine.a * y + vLine.b;
    if (!isFinite(x) || !isFinite(y)) return null;
    return { x: x, y: y };
  }

  // 3×3 单应矩阵（行主序）：把 from 四点映射到 to 四点
  function computeHomography(from, to) {
    var A = [], b = [];
    for (var i = 0; i < 4; i++) {
      var x = from[i].x, y = from[i].y, u = to[i].x, v = to[i].y;
      A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -x * v, -y * v]); b.push(v);
    }
    // 高斯消元解 8 元线性方程组
    var n = 8;
    for (var col = 0; col < n; col++) {
      var piv = col;
      for (var r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
      if (Math.abs(A[piv][col]) < 1e-10) return null;
      var tmp = A[col]; A[col] = A[piv]; A[piv] = tmp;
      var tb = b[col]; b[col] = b[piv]; b[piv] = tb;
      for (var r2 = col + 1; r2 < n; r2++) {
        var f = A[r2][col] / A[col][col];
        if (!f) continue;
        for (var c = col; c < n; c++) A[r2][c] -= f * A[col][c];
        b[r2] -= f * b[col];
      }
    }
    var h = new Array(9).fill(0);
    for (var r3 = n - 1; r3 >= 0; r3--) {
      var sum = b[r3];
      for (var c2 = r3 + 1; c2 < n; c2++) sum -= A[r3][c2] * h[c2];
      h[r3] = sum / A[r3][r3];
    }
    h[8] = 1;
    return h;
  }

  function applyHomography(h, x, y) {
    var u = h[0] * x + h[1] * y + h[2];
    var v = h[3] * x + h[4] * y + h[5];
    var t = h[6] * x + h[7] * y + h[8];
    if (Math.abs(t) < 1e-9) return null;
    return { x: u / t, y: v / t };
  }

  // 仿射变换：源三角形 → 目标三角形（供 canvas transform 使用）
  function affineFromTriangles(sp, dp) {
    var x1 = sp[0].x, y1 = sp[0].y, x2 = sp[1].x, y2 = sp[1].y, x3 = sp[2].x, y3 = sp[2].y;
    var u1 = dp[0].x, v1 = dp[0].y, u2 = dp[1].x, v2 = dp[1].y, u3 = dp[2].x, v3 = dp[2].y;
    var den = (x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1);
    if (Math.abs(den) < 1e-9) return null;
    var a = ((u2 - u1) * (y3 - y1) - (u3 - u1) * (y2 - y1)) / den;
    var c = ((u3 - u1) * (x2 - x1) - (u2 - u1) * (x3 - x1)) / den;
    var e = u1 - a * x1 - c * y1;
    var b = ((v2 - v1) * (y3 - y1) - (v3 - v1) * (y2 - y1)) / den;
    var d = ((v3 - v1) * (x2 - x1) - (v2 - v1) * (x3 - x1)) / den;
    var f = v1 - b * x1 - d * y1;
    return { a: a, b: b, c: c, d: d, e: e, f: f };
  }

  // 把 source 中 quad（TL,TR,BR,BL，源像素坐标）透视拉正为矩形画布。
  // 输出尺寸取对边平均长度；用三角网格近似单应，细分粒度随尺寸自适应。
  function warpQuadToCanvas(source, quad) {
    var topW = Math.hypot(quad[1].x - quad[0].x, quad[1].y - quad[0].y);
    var botW = Math.hypot(quad[3].x - quad[2].x, quad[3].y - quad[2].y);
    var leftH = Math.hypot(quad[3].x - quad[0].x, quad[3].y - quad[0].y);
    var rightH = Math.hypot(quad[2].x - quad[1].x, quad[2].y - quad[1].y);
    var outW = clamp(Math.round((topW + botW) / 2), 8, 16384);
    var outH = clamp(Math.round((leftH + rightH) / 2), 8, 16384);
    var dstCorners = [{ x: 0, y: 0 }, { x: outW, y: 0 }, { x: outW, y: outH }, { x: 0, y: outH }];
    var H = computeHomography(dstCorners, quad);
    if (!H) return null;
    var cnv = document.createElement("canvas");
    cnv.width = outW;
    cnv.height = outH;
    var ctx = cnv.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    var nx = clamp(Math.round(outW / 70), 6, 22);
    var ny = clamp(Math.round(outH / 70), 6, 22);
    var dilate = 0.6; // 三角形外扩，避免接缝
    function drawTri(sp, dp) {
      var t = affineFromTriangles(sp, dp);
      if (!t) return;
      var cx = (dp[0].x + dp[1].x + dp[2].x) / 3;
      var cy = (dp[0].y + dp[1].y + dp[2].y) / 3;
      ctx.save();
      ctx.beginPath();
      for (var k = 0; k < 3; k++) {
        var vx = dp[k].x + Math.sign(dp[k].x - cx || 1) * dilate;
        var vy = dp[k].y + Math.sign(dp[k].y - cy || 1) * dilate;
        if (k === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
      }
      ctx.closePath();
      ctx.clip();
      ctx.transform(t.a, t.b, t.c, t.d, t.e, t.f);
      ctx.drawImage(source, 0, 0);
      ctx.restore();
    }
    for (var j = 0; j < ny; j++) {
      for (var i = 0; i < nx; i++) {
        var dPts = [
          { x: outW * i / nx, y: outH * j / ny },
          { x: outW * (i + 1) / nx, y: outH * j / ny },
          { x: outW * (i + 1) / nx, y: outH * (j + 1) / ny },
          { x: outW * i / nx, y: outH * (j + 1) / ny }
        ];
        var sPts = dPts.map(function (pt) { return applyHomography(H, pt.x, pt.y); });
        if (sPts.some(function (pt) { return !pt; })) continue;
        drawTri([sPts[0], sPts[1], sPts[2]], [dPts[0], dPts[1], dPts[2]]);
        drawTri([sPts[0], sPts[2], sPts[3]], [dPts[0], dPts[2], dPts[3]]);
      }
    }
    return cnv;
  }

  // 局部边缘抚直（PS 自适应思路）：锚定画面中心带（中心 25% 半幅零位移），
  // 仅把弯曲的边缘拉回各自的拟合直线。弯曲量从中心到边缘平滑衰减施加，
  // 即使边缘检测带噪声也绝不会把画面中心扭歪。
  function straightenEdgesLocally(source, persp) {
    var W = source.width, H = source.height;
    var q = persp.quad;
    var TL = { x: q[0].x * W, y: q[0].y * H };
    var TR = { x: q[1].x * W, y: q[1].y * H };
    var BR = { x: q[2].x * W, y: q[2].y * H };
    var BL = { x: q[3].x * W, y: q[3].y * H };
    var outW = clamp(Math.round((Math.hypot(TR.x - TL.x, TR.y - TL.y) + Math.hypot(BR.x - BL.x, BR.y - BL.y)) / 2), 8, 16384);
    var outH = clamp(Math.round((Math.hypot(BL.x - TL.x, BL.y - TL.y) + Math.hypot(BR.x - TR.x, BR.y - TR.y)) / 2), 8, 16384);
    var sctx = source.getContext("2d");
    var sd = sctx.getImageData(0, 0, W, H).data;
    var cnv = document.createElement("canvas");
    cnv.width = outW; cnv.height = outH;
    var octx = cnv.getContext("2d");
    var od = octx.createImageData(outW, outH);
    var dd = od.data;
    var ed = persp.edgeData || {};
    var TN = 256;
    function samp(tab, t) {
      if (!tab) return 0;
      var f = clamp(t, 0, 1) * (TN - 1);
      var i = Math.floor(f), j = i + 1 < TN ? i + 1 : i, r = f - i;
      return tab[i] * (1 - r) + tab[j] * r;
    }
    function sm(a, b, x) { x = clamp((x - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); }
    // 预计算：每行左右偏差（px）、每列上下偏差（px）与锚定权重
    var dL = new Float32Array(outH), dR = new Float32Array(outH);
    var wT = new Float32Array(outH), wB = new Float32Array(outH);
    for (var yo = 0; yo < outH; yo++) {
      var fy = yo / outH;
      dL[yo] = samp(ed.left, fy) * W;
      dR[yo] = samp(ed.right, fy) * W;
      wT[yo] = sm(0.25, 1, clamp((0.5 - fy) / 0.5, 0, 1));
      wB[yo] = sm(0.25, 1, clamp((fy - 0.5) / 0.5, 0, 1));
    }
    var dT = new Float32Array(outW), dB = new Float32Array(outW);
    var wL = new Float32Array(outW), wR = new Float32Array(outW);
    for (var xo = 0; xo < outW; xo++) {
      var fx = xo / outW;
      dT[xo] = samp(ed.top, fx) * H;
      dB[xo] = samp(ed.bottom, fx) * H;
      wL[xo] = sm(0.25, 1, clamp((0.5 - fx) / 0.5, 0, 1));
      wR[xo] = sm(0.25, 1, clamp((fx - 0.5) / 0.5, 0, 1));
    }
    // 逐像素反向采样：输出(直线边界) → 源(弯曲边界)，位移 = 边缘偏差 × 锚定权重
    for (var y2 = 0; y2 < outH; y2++) {
      var ay = 1 - y2 / outH, by = y2 / outH;
      for (var x2 = 0; x2 < outW; x2++) {
        var fx2 = x2 / outW;
        var xs = (TL.x * (1 - fx2) + TR.x * fx2) * ay + (BL.x * (1 - fx2) + BR.x * fx2) * by;
        var ys = (TL.y * (1 - fx2) + TR.y * fx2) * ay + (BL.y * (1 - fx2) + BR.y * fx2) * by;
        var u = dL[y2] * wL[x2] + dR[y2] * wR[x2];
        var v = dT[x2] * wT[y2] + dB[x2] * wB[y2];
        var xi = xs + u, yi = ys + v;
        var x0 = Math.floor(xi), y0 = Math.floor(yi);
        var rx = xi - x0, ry = yi - y0;
        var x0c = clamp(x0, 0, W - 1), x1c = clamp(x0 + 1, 0, W - 1);
        var y0c = clamp(y0, 0, H - 1), y1c = clamp(y0 + 1, 0, H - 1);
        var i00 = (y0c * W + x0c) * 4, i10 = (y0c * W + x1c) * 4;
        var i01 = (y1c * W + x0c) * 4, i11 = (y1c * W + x1c) * 4;
        var o2 = (y2 * outW + x2) * 4;
        var w00 = (1 - rx) * (1 - ry), w10 = rx * (1 - ry), w01 = (1 - rx) * ry, w11 = rx * ry;
        dd[o2] = sd[i00] * w00 + sd[i10] * w10 + sd[i01] * w01 + sd[i11] * w11;
        dd[o2 + 1] = sd[i00 + 1] * w00 + sd[i10 + 1] * w10 + sd[i01 + 1] * w01 + sd[i11 + 1] * w11;
        dd[o2 + 2] = sd[i00 + 2] * w00 + sd[i10 + 2] * w10 + sd[i01 + 2] * w01 + sd[i11 + 2] * w11;
        dd[o2 + 3] = sd[i00 + 3] * w00 + sd[i10 + 3] * w10 + sd[i01 + 3] * w01 + sd[i11 + 3] * w11;
      }
    }
    octx.putImageData(od, 0, 0);
    return cnv;
  }

  // 透视矫正统一入口：local 走锚定中心的边缘抚直，global 走单应拉正
  function warpPerspectiveCanvas(cnv, persp) {
    if (!persp || !persp.quad || !persp.on) return null;
    if (persp.mode === "local" && persp.edgeData) {
      return straightenEdgesLocally(cnv, persp);
    }
    var W = cnv.width, H = cnv.height;
    var quadPx = persp.quad.map(function (pt) { return { x: pt.x * W, y: pt.y * H }; });
    return warpQuadToCanvas(cnv, quadPx);
  }

  // 翻拍底片四边形检测：以画面边缘的亮背景为参照定位底片四条边。
  // 返回 null 表示无法可靠检测；quad 为归一化坐标（TL,TR,BR,BL）。
  function detectPerspectiveQuad(data, w, h) {
    if (w < 80 || h < 60) return null;
    var luma = new Uint8Array(w * h);
    for (var p = 0; p < w * h; p++) {
      var o = p * 4;
      luma[p] = data[o + 3] === 0 ? 255 : lum8(data[o], data[o + 1], data[o + 2]);
    }
    var bw = Math.max(3, Math.round(w * 0.05));
    var bh = Math.max(3, Math.round(h * 0.05));
    var borderL = [], centerL = [];
    var cx0 = Math.round(w * 0.3), cx1 = Math.round(w * 0.7);
    var cy0 = Math.round(h * 0.3), cy1 = Math.round(h * 0.7);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var v = luma[y * w + x];
        var isBorder = x < bw || x >= w - bw || y < bh || y >= h - bh;
        if (isBorder) borderL.push(v);
        else if (x >= cx0 && x < cx1 && y >= cy0 && y < cy1) centerL.push(v);
      }
    }
    if (borderL.length < 40 || centerL.length < 40) return null;
    var borderMed = medianOf(borderL);
    var centerMed = medianOf(centerL);
    if (Math.abs(borderMed - centerMed) < 16) return null;
    var filmDark = centerMed < borderMed;
    var th = filmDark ? lerp(centerMed, borderMed, 0.55) : lerp(borderMed, centerMed, 0.55);
    var isFilm = function (v) { return filmDark ? v < th : v > th; };
    // 校验：中心过半是底片、边框过半是背景，否则视为无法区分
    var centerFilm = 0, centerN = 0, borderBg = 0, borderN = 0;
    for (var yy = 0; yy < h; yy += 2) {
      for (var xx = 0; xx < w; xx += 2) {
        var vv = luma[yy * w + xx];
        var inC = xx >= cx0 && xx < cx1 && yy >= cy0 && yy < cy1;
        var inB = xx < bw || xx >= w - bw || yy < bh || yy >= h - bh;
        if (inC) { centerN++; if (isFilm(vv)) centerFilm++; }
        else if (inB) { borderN++; if (!isFilm(vv)) borderBg++; }
      }
    }
    if (centerN < 50 || borderN < 50) return null;
    if (centerFilm / centerN < 0.5 || borderBg / borderN < 0.55) return null;

    // 逐行找左右边缘、逐列找上下边缘（连续 3px 命中才算，抑制噪点）
    var run = 3;
    var leftPts = [], rightPts = [], topPts = [], botPts = [];
    for (var ry = 0; ry < h; ry++) {
      var lx = -1;
      for (var xi = 0; xi <= w - run; xi++) {
        var ok = true;
        for (var k = 0; k < run; k++) if (!isFilm(luma[ry * w + xi + k])) { ok = false; break; }
        if (ok) { lx = xi; break; }
      }
      if (lx >= 0) leftPts.push({ x: lx, y: ry });
      var rx = -1;
      for (var xi2 = w - run; xi2 >= 0; xi2--) {
        var ok2 = true;
        for (var k2 = 0; k2 < run; k2++) if (!isFilm(luma[ry * w + xi2 + k2])) { ok2 = false; break; }
        if (ok2) { rx = xi2 + run - 1; break; }
      }
      if (rx >= 0) rightPts.push({ x: rx, y: ry });
    }
    for (var cx = 0; cx < w; cx++) {
      var ty = -1;
      for (var yi = 0; yi <= h - run; yi++) {
        var ok3 = true;
        for (var k3 = 0; k3 < run; k3++) if (!isFilm(luma[(yi + k3) * w + cx])) { ok3 = false; break; }
        if (ok3) { ty = yi; break; }
      }
      if (ty >= 0) topPts.push({ x: cx, y: ty });
      var by = -1;
      for (var yi2 = h - run; yi2 >= 0; yi2--) {
        var ok4 = true;
        for (var k4 = 0; k4 < run; k4++) if (!isFilm(luma[(yi2 + k4) * w + cx])) { ok4 = false; break; }
        if (ok4) { by = yi2; break; }
      }
      if (by >= 0) botPts.push({ x: cx, y: by });
    }

    var topLine = fitRobustLine(topPts, false, Math.round(w * 0.25));
    var botLine = fitRobustLine(botPts, false, Math.round(w * 0.25));
    if (!topLine || !botLine) return null; // 上下边必须存在
    var leftLine = fitRobustLine(leftPts, true, Math.round(h * 0.2));
    var rightLine = fitRobustLine(rightPts, true, Math.round(h * 0.2));
    var leftBorder = { a: 0, b: 0 };   // x = 0
    var rightBorder = { a: 0, b: w };  // x = w
    var lLine = leftLine || leftBorder;
    var rLine = rightLine || rightBorder;

    var TL = intersectLines(topLine, lLine);
    var TR = intersectLines(topLine, rLine);
    var BR = intersectLines(botLine, rLine);
    var BL = intersectLines(botLine, lLine);
    if (!TL || !TR || !BR || !BL) return null;

    // 四边形合法性：凸四边形、面积足够、位置合理（允许略越界）
    var quad = [TL, TR, BR, BL];
    var area = 0;
    for (var q = 0; q < 4; q++) {
      var p1 = quad[q], p2 = quad[(q + 1) % 4];
      area += p1.x * p2.y - p2.x * p1.y;
    }
    area = Math.abs(area) / 2;
    if (area < w * h * 0.25) return null;
    for (var q2 = 0; q2 < 4; q2++) {
      var pt = quad[q2];
      if (pt.x < -w * 0.06 || pt.x > w * 1.06 || pt.y < -h * 0.06 || pt.y > h * 1.06) return null;
    }
    if (BL.y <= TL.y + h * 0.05 || BR.y <= TR.y + h * 0.05) return null;

    // 量化指标：旋转角（度）、上下边/左右边的高度差与宽度差
    var angleDeg = Math.atan((topLine.a + botLine.a) / 2) * 180 / Math.PI;
    var lH = Math.hypot(BL.x - TL.x, BL.y - TL.y);
    var rH = Math.hypot(BR.x - TR.x, BR.y - TR.y);
    var tW = Math.hypot(TR.x - TL.x, TR.y - TL.y);
    var bW = Math.hypot(BR.x - BL.x, BR.y - BL.y);
    var keystone = Math.abs(rH - lH) / Math.max(1, (lH + rH) / 2);
    var trapezoid = Math.abs(tW - bW) / Math.max(1, (tW + bW) / 2);
    // —— 模式判定（PS 自适应思路）——
    // global：四边直且存在真实透视（大畸变需信噪比达标，小畸变需合成级完美直线）
    // local ：边缘弯曲（扫描波浪边）——锚定画面中心，仅把弯曲边缘拉回自己的拟合直线
    // none  ：无可信畸变，不动
    var rmsLimit = Math.max(2, w * 0.004);
    var strictLimit = Math.max(1.5, w * 0.002); // 合成图级完美直线才允许小角度自动拉正
    var topRms = topLine.rms, botRms = botLine.rms;
    var leftRms = leftLine ? leftLine.rms : 0, rightRms = rightLine ? rightLine.rms : 0;
    var bentTop = topRms > rmsLimit, bentBot = botRms > rmsLimit;
    var bentLeft = !!leftLine && leftRms > rmsLimit, bentRight = !!rightLine && rightRms > rmsLimit;
    var anyBent = bentTop || bentBot || bentLeft || bentRight;
    var allStraight = !anyBent;

    // 大畸变 + 信噪比：畸变幅度必须远超（6 倍）对应边缘的拟合噪声，
    // 否则弯曲边/软边拟合出的虚假大畸变不可信
    var keyAmp = Math.abs(rH - lH);
    var trapAmp = Math.abs(tW - bW);
    var angAmp = Math.tan(Math.abs(angleDeg) * Math.PI / 180) * w;
    var bigDistortion = leftLine && rightLine && (
      (keystone > 0.08 && keyAmp > 6 * Math.max(leftRms, rightRms, 1)) ||
      (trapezoid > 0.08 && trapAmp > 6 * Math.max(topRms, botRms, 1)) ||
      (Math.abs(angleDeg) > 3 && angAmp > 6 * Math.max(topRms, botRms, 1))
    );

    // 弯边逐点偏差表（归一化：位置 0..1 沿边 → 偏差/边长方向尺寸），供局部抚直用
    var TABLE_N = 256;
    function buildEdgeTable(pts, line, isV) {
      var acc = new Float32Array(TABLE_N), cnt = new Uint16Array(TABLE_N);
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i], t, d;
        if (isV) { t = p.y / h; d = (p.x - (line.a * p.y + line.b)) / w; }
        else { t = p.x / w; d = (p.y - (line.a * p.x + line.b)) / h; }
        // 剔除离群点：与拟合线偏差过大（>3 倍限差）的坏点不进偏差表
        if (Math.abs(d) * (isV ? w : h) > rmsLimit * 3) continue;
        var idx = clamp(Math.round(t * (TABLE_N - 1)), 0, TABLE_N - 1);
        acc[idx] += d; cnt[idx]++;
      }
      var v = new Float32Array(TABLE_N);
      for (var k = 0; k < TABLE_N; k++) if (cnt[k]) v[k] = acc[k] / cnt[k];
      // 空槽线性插值；两端无样本保持 0（边缘缺失段不动）
      var last = -1;
      for (var k2 = 0; k2 < TABLE_N; k2++) {
        if (cnt[k2]) {
          if (last >= 0 && k2 - last > 1) {
            for (var m = last + 1; m < k2; m++) v[m] = v[last] + (v[k2] - v[last]) * (m - last) / (k2 - last);
          }
          last = k2;
        }
      }
      return v;
    }
    var edgeData = null, ampPx = 0;
    if (anyBent) {
      edgeData = {
        left: bentLeft ? buildEdgeTable(leftPts, leftLine, true) : null,
        right: bentRight ? buildEdgeTable(rightPts, rightLine, true) : null,
        top: bentTop ? buildEdgeTable(topPts, topLine, false) : null,
        bottom: bentBot ? buildEdgeTable(botPts, botLine, false) : null
      };
      for (var side in edgeData) {
        if (!edgeData[side]) continue;
        var scale = (side === 'left' || side === 'right') ? w : h;
        for (var ti = 0; ti < TABLE_N; ti++) {
          ampPx = Math.max(ampPx, Math.abs(edgeData[side][ti]) * scale);
        }
      }
    }

    var mode = 'none', significant = false;
    if (bigDistortion) {
      mode = 'global'; significant = true;   // 大畸变且信噪比达标：全局拉正
    } else if (anyBent && ampPx >= 2) {
      mode = 'local'; significant = true;    // 边缘弯曲：锚定中心，仅抚直边缘
    } else if (allStraight && Math.max(topRms, botRms) <= strictLimit &&
      (Math.abs(angleDeg) > 0.8 || trapezoid > 0.015)) {
      mode = 'global'; significant = true;   // 完美直线上的小畸变（合成/数码图）
    } else if (allStraight && leftLine && rightLine && Math.max(leftRms, rightRms) <= strictLimit &&
      keystone > 0.015) {
      mode = 'global'; significant = true;
    }
    var edgeStable = allStraight;
    var edgeRms = Math.max(topRms, botRms, leftRms, rightRms);
    var confidence = clamp((topLine.count / w + botLine.count / w) / 2, 0, 1);
    return {
      quad: quad.map(function (pt) { return { x: pt.x / w, y: pt.y / h }; }),
      angleDeg: angleDeg,
      keystone: keystone,
      trapezoid: trapezoid,
      confidence: confidence,
      edgeStable: edgeStable,
      edgeRms: edgeRms,
      topRms: topRms,
      botRms: botRms,
      leftRms: leftRms,
      rightRms: rightRms,
      rmsLimit: rmsLimit,
      mode: mode,
      edgeData: edgeData,
      ampPx: ampPx,
      significant: significant
    };
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
  // ---------- 曲线（Photoshop 风格）----------
  var CURVE_SIZE = 240;
  var CURVE_CHANNELS = ["rgb", "r", "g", "b"];
  var curveCtx = null;
  var curveDragIndex = -1;

  function defaultCurvePoints() { return [{ x: 0, y: 0 }, { x: 1, y: 1 }]; }

  function defaultCurve() {
    return {
      rgb: defaultCurvePoints(),
      r: defaultCurvePoints(),
      g: defaultCurvePoints(),
      b: defaultCurvePoints(),
    };
  }

  function copyCurve(c) {
    var src = c || {};
    var out = {};
    CURVE_CHANNELS.forEach(function (ch) {
      var pts = Array.isArray(src[ch]) ? src[ch] : null;
      if (pts && pts.length >= 2) {
        out[ch] = pts.map(function (p) {
          return { x: clamp(Number(p.x) || 0, 0, 1), y: clamp(Number(p.y) || 0, 0, 1) };
        }).sort(function (a, b) { return a.x - b.x; });
      } else {
        out[ch] = defaultCurvePoints();
      }
    });
    return out;
  }

  function curveIsDefault(c) {
    if (!c) return true;
    for (var i = 0; i < CURVE_CHANNELS.length; i++) {
      var pts = c[CURVE_CHANNELS[i]];
      if (!pts || pts.length !== 2) return false;
      if (Math.abs(pts[0].x) > 0.001 || Math.abs(pts[0].y) > 0.001) return false;
      if (Math.abs(pts[1].x - 1) > 0.001 || Math.abs(pts[1].y - 1) > 0.001) return false;
    }
    return true;
  }

  // 单调三次插值（Fritsch–Carlson），保证曲线不过冲、不抖动
  function buildCurveLut(points) {
    var lut = new Uint8Array(256);
    var pts = (points || []).slice().sort(function (a, b) { return a.x - b.x; });
    var n = pts.length;
    if (n < 2) {
      for (var q = 0; q < 256; q++) lut[q] = q;
      return lut;
    }
    var xs = [], ys = [], i;
    for (i = 0; i < n; i++) { xs.push(pts[i].x); ys.push(pts[i].y); }
    var d = [], m = [];
    for (i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]));
    m[0] = d[0];
    m[n - 1] = d[n - 2];
    for (i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (i = 0; i < n - 1; i++) {
      if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
      var a = m[i] / d[i], b = m[i + 1] / d[i];
      var s2 = a * a + b * b;
      if (s2 > 9) {
        var t = 3 / Math.sqrt(s2);
        m[i] = t * a * d[i];
        m[i + 1] = t * b * d[i];
      }
    }
    var seg = 0;
    for (var k = 0; k < 256; k++) {
      var x = k / 255;
      if (x <= xs[0]) { lut[k] = roundClamp(clamp(ys[0], 0, 1) * 255); continue; }
      if (x >= xs[n - 1]) { lut[k] = roundClamp(clamp(ys[n - 1], 0, 1) * 255); continue; }
      while (seg < n - 2 && x > xs[seg + 1]) seg++;
      var h = Math.max(1e-6, xs[seg + 1] - xs[seg]);
      var tt = (x - xs[seg]) / h;
      var t2 = tt * tt, t3 = t2 * tt;
      var y = (2 * t3 - 3 * t2 + 1) * ys[seg]
        + (t3 - 2 * t2 + tt) * h * m[seg]
        + (-2 * t3 + 3 * t2) * ys[seg + 1]
        + (t3 - t2) * h * m[seg + 1];
      lut[k] = roundClamp(clamp(y, 0, 1) * 255);
    }
    return lut;
  }

  function buildCurveLuts(c) {
    var curve = copyCurve(c);
    return {
      rgb: buildCurveLut(curve.rgb),
      r: buildCurveLut(curve.r),
      g: buildCurveLut(curve.g),
      b: buildCurveLut(curve.b),
    };
  }

  // 图形区 240×240，底部 12px 输入渐变条（对齐 Photoshop 曲线面板）
  var CURVE_STRIP = 12;
  var CURVE_TOTAL = CURVE_SIZE + CURVE_STRIP;
  var curveSelected = -1;

  function curveChannelColor(ch) {
    if (ch === "r") return "#ff5f5f";
    if (ch === "g") return "#4ddc7a";
    if (ch === "b") return "#5a9bff";
    return "#f2f2f2";
  }

  function curveChannelFill(ch) {
    if (ch === "r") return "rgba(255,95,95,0.72)";
    if (ch === "g") return "rgba(77,220,122,0.72)";
    if (ch === "b") return "rgba(90,155,255,0.72)";
    return "rgba(228,228,228,0.72)";
  }

  function curveChannelBg(ch) {
    if (ch === "r") return "#4a3a3a";
    if (ch === "g") return "#38483a";
    if (ch === "b") return "#383d4a";
    return "#4b4b4b";
  }

  function curveHistFor(state, ch) {
    var h = state.curveHist;
    if (!h) return null;
    if (ch === "r") return h.r;
    if (ch === "g") return h.g;
    if (ch === "b") return h.b;
    return h.luma;
  }

  // ---- 直方图面板：校正后的 RGB 与亮度分布 ----
  var histCtx = null;
  function drawHistogram(hist) {
    var cnv = el.hist;
    if (!cnv || !hist) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var rect = cnv.getBoundingClientRect();
    if (!rect.width) return;
    var cw = Math.max(200, Math.round(rect.width));
    var ch = Math.max(80, Math.round(rect.height || 132));
    var pxW = Math.round(cw * dpr);
    var pxH = Math.round(ch * dpr);
    if (cnv.width !== pxW || cnv.height !== pxH) {
      cnv.width = pxW;
      cnv.height = pxH;
    }
    if (!histCtx) histCtx = cnv.getContext("2d");
    var ctx = histCtx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    var padTop = 8;
    var padBottom = 8;
    var plotH = ch - padTop - padBottom;
    var plotW = cw;

    // 参考高度用 98% 分位，避免大面积片基/白边形成的高峰把其余分布压扁
    var ref = 0;
    var vals = [];
    var series = [hist.r, hist.g, hist.b, hist.luma];
    for (var k = 0; k < series.length; k++) {
      for (var i = 0; i < 256; i++) if (series[k][i] > 0) vals.push(series[k][i]);
    }
    if (vals.length) {
      vals.sort(function (a, b) { return a - b; });
      ref = vals[Math.floor((vals.length - 1) * 0.98)] || vals[vals.length - 1];
    }
    if (!ref) ref = 1;

    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;
    for (var g = 1; g < 4; g++) {
      var gx = (plotW * g) / 4;
      ctx.beginPath();
      ctx.moveTo(gx, padTop);
      ctx.lineTo(gx, ch - padBottom);
      ctx.stroke();
    }

    function plot(data, color, alpha, fill) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(0, ch - padBottom);
      for (var i = 0; i < 256; i++) {
        var v = Math.min(1, data[i] / ref);
        var hgt = Math.sqrt(v) * plotH;
        var x = (i / 255) * plotW;
        ctx.lineTo(x, ch - padBottom - hgt);
      }
      ctx.lineTo(plotW, ch - padBottom);
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

    ctx.globalCompositeOperation = "lighter";
    plot(hist.r, "#d9534f", 0.42, true);
    plot(hist.g, "#4f9d69", 0.42, true);
    plot(hist.b, "#4d7fd0", 0.42, true);
    ctx.globalCompositeOperation = "source-over";
    plot(hist.luma, "#e8e6e1", 0.8, false);
  }

  function drawCurve() {
    if (!el.curveCanvas || !state.curve) return;
    var cnv = el.curveCanvas;
    if (!curveCtx) curveCtx = cnv.getContext("2d");
    var dpr = window.devicePixelRatio || 1;
    var pxW = Math.round(CURVE_SIZE * dpr);
    var pxH = Math.round(CURVE_TOTAL * dpr);
    if (cnv.width !== pxW || cnv.height !== pxH) {
      cnv.width = pxW;
      cnv.height = pxH;
    }
    var ctx = curveCtx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, CURVE_SIZE, CURVE_TOTAL);

    // 背景：Photoshop 曲线面板深灰，单通道带轻微同色倾向
    ctx.fillStyle = curveChannelBg(state.curveChannel);
    ctx.fillRect(0, 0, CURVE_SIZE, CURVE_SIZE);

    // 直方图（位于曲线下方）
    var hist = curveHistFor(state, state.curveChannel);
    if (hist) {
      // 用 97% 分位作为参考高度，避免片基/边框的巨大单一峰值把其余柱压扁
      var vals = [], i0;
      for (i0 = 0; i0 < 256; i0++) if (hist[i0] > 0) vals.push(hist[i0]);
      vals.sort(function (a, b) { return a - b; });
      var ref = vals.length ? vals[Math.floor((vals.length - 1) * 0.97)] : 0;
      if (ref > 0) {
        var heights = new Array(256);
        for (i0 = 0; i0 < 256; i0++) {
          var ratio = Math.min(1, hist[i0] / ref);
          heights[i0] = Math.pow(ratio, 0.85) * (CURVE_SIZE - 2);
        }
        ctx.beginPath();
        ctx.moveTo(0, CURVE_SIZE);
        for (i0 = 0; i0 < 256; i0++) {
          ctx.lineTo((i0 / 255) * CURVE_SIZE, CURVE_SIZE - heights[i0]);
        }
        ctx.lineTo(CURVE_SIZE, CURVE_SIZE);
        ctx.closePath();
        ctx.fillStyle = curveChannelFill(state.curveChannel);
        ctx.fill();
        // 顶边描线，让柱形轮廓更清晰
        ctx.beginPath();
        for (i0 = 0; i0 < 256; i0++) {
          var lx = (i0 / 255) * CURVE_SIZE;
          var ly = CURVE_SIZE - heights[i0];
          if (i0 === 0) ctx.moveTo(lx, ly); else ctx.lineTo(lx, ly);
        }
        ctx.strokeStyle = curveChannelColor(state.curveChannel);
        ctx.globalAlpha = 0.9;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // 网格
    ctx.strokeStyle = "#5f5f5f";
    ctx.lineWidth = 1;
    for (var g = 1; g < 4; g++) {
      var gp = Math.round((CURVE_SIZE * g) / 4) + 0.5;
      ctx.beginPath(); ctx.moveTo(gp, 0); ctx.lineTo(gp, CURVE_SIZE); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, gp); ctx.lineTo(CURVE_SIZE, gp); ctx.stroke();
    }

    // 对角参考线
    ctx.strokeStyle = "rgba(190,190,190,0.42)";
    ctx.beginPath();
    ctx.moveTo(0, CURVE_SIZE);
    ctx.lineTo(CURVE_SIZE, 0);
    ctx.stroke();

    // 外框
    ctx.strokeStyle = "#2b2b2b";
    ctx.strokeRect(0.5, 0.5, CURVE_SIZE - 1, CURVE_SIZE - 1);

    // 曲线：RGB 复合为白色，单通道用对应通道色
    var pts = state.curve[state.curveChannel] || defaultCurvePoints();
    var lut = buildCurveLut(pts);
    ctx.strokeStyle = curveChannelColor(state.curveChannel);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (var k = 0; k < 256; k++) {
      var cx = (k / 255) * CURVE_SIZE;
      var cy = (1 - lut[k] / 255) * CURVE_SIZE;
      if (k === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
    }
    ctx.stroke();

    // 控制点：白色小方块
    for (var i = 0; i < pts.length; i++) {
      var sx = pts[i].x * CURVE_SIZE;
      var sy = (1 - pts[i].y) * CURVE_SIZE;
      var half = (i === curveDragIndex || i === curveSelected) ? 4.5 : 3.5;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(sx - half, sy - half, half * 2, half * 2);
      ctx.strokeStyle = curveChannelColor(state.curveChannel);
      ctx.lineWidth = 1;
      ctx.strokeRect(sx - half + 0.5, sy - half + 0.5, half * 2 - 1, half * 2 - 1);
    }

    // 底部输入渐变条
    var grad = ctx.createLinearGradient(0, 0, CURVE_SIZE, 0);
    grad.addColorStop(0, "#000000");
    grad.addColorStop(1, "#ffffff");
    ctx.fillStyle = grad;
    ctx.fillRect(0, CURVE_SIZE, CURVE_SIZE, CURVE_STRIP);
    ctx.strokeStyle = "#2b2b2b";
    ctx.strokeRect(0.5, CURVE_SIZE + 0.5, CURVE_SIZE - 1, CURVE_STRIP - 1);

    updateCurveIO();
  }

  function updateCurveIO() {
    if (!el.curveIn || !el.curveOut) return;
    var pts = state.curve[state.curveChannel] || [];
    var p = (curveSelected >= 0 && curveSelected < pts.length) ? pts[curveSelected] : null;
    el.curveIn.textContent = p ? String(Math.round(p.x * 255)) : "—";
    el.curveOut.textContent = p ? String(Math.round(p.y * 255)) : "—";
  }

  function syncCurveChannelUI() {
    if (el.curveChannel) el.curveChannel.value = state.curveChannel;
    curveSelected = -1;
    drawCurve();
  }

  function curvePosOf(e) {
    var r = el.curveCanvas.getBoundingClientRect();
    var px = ((e.clientX - r.left) / Math.max(1, r.width)) * CURVE_SIZE;
    var py = ((e.clientY - r.top) / Math.max(1, r.height)) * CURVE_TOTAL;
    return {
      x: clamp(px / CURVE_SIZE, 0, 1),
      y: clamp(1 - py / CURVE_SIZE, 0, 1),
    };
  }

  function findCurvePoint(pts, x, y) {
    var best = -1, bestD = 12 / CURVE_SIZE;
    for (var i = 0; i < pts.length; i++) {
      var d = Math.sqrt(Math.pow(pts[i].x - x, 2) + Math.pow(pts[i].y - y, 2));
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  function commitCurveChange() {
    markEdited();
    scheduleRender();
  }

  function initCurveEditor() {
    if (!el.curveCanvas) return;
    var cnv = el.curveCanvas;
    cnv.addEventListener("pointerdown", function (e) {
      if (!state.previewData) return;
      e.preventDefault();
      var pts = state.curve[state.curveChannel];
      var p = curvePosOf(e);
      var idx = findCurvePoint(pts, p.x, p.y);
      if (idx < 0) {
        var np = { x: p.x, y: p.y };
        pts.push(np);
        pts.sort(function (a, b) { return a.x - b.x; });
        idx = pts.indexOf(np);
      }
      curveDragIndex = idx;
      curveSelected = idx;
      try { cnv.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
      drawCurve();
    });
    cnv.addEventListener("pointermove", function (e) {
      if (curveDragIndex < 0 || !state.previewData) return;
      e.preventDefault();
      var pts = state.curve[state.curveChannel];
      if (!pts || pts.length < 2) return;
      var p = curvePosOf(e);
      var i = curveDragIndex;
      if (i === 0 || i === pts.length - 1) {
        pts[i].y = p.y; // 端点只允许上下移动
      } else {
        pts[i].x = clamp(p.x, pts[i - 1].x + 0.02, pts[i + 1].x - 0.02);
        pts[i].y = p.y;
      }
      drawCurve();
      commitCurveChange();
    });
    ["pointerup", "pointercancel"].forEach(function (ev) {
      cnv.addEventListener(ev, function (e) {
        if (curveDragIndex < 0) return;
        curveDragIndex = -1;
        try { cnv.releasePointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
        drawCurve();
        commitCurveChange();
      });
    });
    cnv.addEventListener("dblclick", function (e) {
      if (!state.previewData) return;
      var pts = state.curve[state.curveChannel];
      var p = curvePosOf(e);
      var idx = findCurvePoint(pts, p.x, p.y);
      if (idx > 0 && idx < pts.length - 1) {
        pts.splice(idx, 1);
        curveSelected = -1;
        drawCurve();
        commitCurveChange();
        setStatus("已删除曲线控制点。");
      }
    });
    if (el.curveChannel) {
      el.curveChannel.addEventListener("change", function () {
        var ch = this.value;
        if (!ch || ch === state.curveChannel) return;
        state.curveChannel = ch;
        curveSelected = -1;
        drawCurve();
      });
    }
    if (el.btnCurveReset) {
      el.btnCurveReset.addEventListener("click", function () {
        if (!state.previewData) return;
        state.curve[state.curveChannel] = defaultCurvePoints();
        curveSelected = -1;
        drawCurve();
        commitCurveChange();
        setStatus("已把 " + (state.curveChannel === "rgb" ? "RGB 复合" : state.curveChannel.toUpperCase() + " 通道") + "曲线复位。");
      });
    }
    drawCurve();
  }

  function render(src, dst, base, adj, analysis, curveLuts, hist) {
    var levels = analysis.levels;
    var gains = analysis.gains;
    var positive = !!analysis.positive;
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
        var v = positive
          ? clamp(src[i + c] / 255, 0, 1)
          : applyLevels(baseCorrect(src[i + c], base[c]), levels[c]);
        v = clamp(v * gains[c], 0, 1);
        v = applyUserLevels(v, black, white);
        rgb[c] = Math.pow(v, 1 / gamma) * exposure * (c === 0 ? kR : c === 1 ? kG : kB);
        rgb[c] = clamp(rgb[c], 0, 1);
      }
      applySaturation(rgb[0], rgb[1], rgb[2], sat, tmp);
      applyContrast(tmp[0], tmp[1], tmp[2], adj.contrast, tmp);
      var r8 = linearToSrgb(tmp[0]);
      var g8 = linearToSrgb(tmp[1]);
      var b8 = linearToSrgb(tmp[2]);
      if (hist) {
        // 统计曲线之前的分布，作为曲线面板背景直方图
        hist.r[r8]++; hist.g[g8]++; hist.b[b8]++;
        hist.luma[(r8 * 54 + g8 * 183 + b8 * 19) >> 8]++;
      }
      if (curveLuts) {
        // 先逐通道曲线，再叠加 RGB 复合曲线（与 Photoshop 一致）
        r8 = curveLuts.rgb[curveLuts.r[r8]];
        g8 = curveLuts.rgb[curveLuts.g[g8]];
        b8 = curveLuts.rgb[curveLuts.b[b8]];
      }
      dst[i] = r8;
      dst[i + 1] = g8;
      dst[i + 2] = b8;
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
    srcName: "",
    srcExt: "",
    queue: [],           // 多图队列（上限见 MAX_QUEUE）
    curId: null,         // 当前编辑中的队列项 id
    baseConfidence: 0,   // 片基自动识别置信度（0-1）
    baseSamples: 0,      // 片基识别使用的有效样本数
    splitOn: false,      // 滑块对比模式
    splitX: 0.5,         // 对比分割线位置（0-1）
    crop: null,          // 已应用裁剪 {x,y,w,h}（归一化 0-1）
    cropRect: null,      // 裁剪编辑中的框
    cropEditing: false,  // 是否处于裁剪编辑模式
    cropRatio: 0,        // 裁剪比例（0=自由）
    positive: false,     // 按正片直通处理（不做反相）
    detectedPositive: false, // 自动判断疑似正片
    toneIgnored: false,  // 用户忽略了正片提示
    renderBuf: null,     // 预览渲染缓存（完整预览尺寸）
    curve: defaultCurve(),   // 曲线控制点 {rgb,r,g,b}
    curveChannel: "rgb",     // 当前编辑的曲线通道
    curveHist: null,         // 曲线面板背景直方图 {r,g,b,luma}
    perspective: null,
    perspEditing: false,
    perspEditBackup: null,
    plainData: null,
    plainW: 0,
    plainH: 0,       // 透视矫正 {quad(归一化), on, off, angle, keystone, trapezoid, confidence}
  };

  var el = {
    dropZone: document.getElementById("drop-zone"),
    perspEnabled: document.getElementById("persp-enabled"),
    perspInfo: document.getElementById("persp-info"),
    perspActions: document.getElementById("persp-actions"),
    perspEditActions: document.getElementById("persp-edit-actions"),
    btnPerspAdjust: document.getElementById("btn-persp-adjust"),
    btnPerspDone: document.getElementById("btn-persp-done"),
    btnPerspCancel: document.getElementById("btn-persp-cancel"),
    btnPerspRedetect: document.getElementById("btn-persp-redetect"),
    perspOverlay: document.getElementById("persp-overlay"),
    fileInput: document.getElementById("file-input"),
    canvasWrap: document.getElementById("canvas-wrap"),
    canvas: document.getElementById("canvas"),
    sampleBadge: document.getElementById("sample-badge"),
    status: document.getElementById("status"),
    btnCompare: document.getElementById("btn-compare"),
    btnReset: document.getElementById("btn-reset"),
    btnExport: document.getElementById("btn-export"),
    exportFormat: document.getElementById("export-format"),
    btnAutoBase: document.getElementById("btn-auto-base"),
    btnManualBase: document.getElementById("btn-manual-base"),
    baseSwatch: document.getElementById("base-swatch"),
    baseRgb: document.getElementById("base-rgb"),
    baseSource: document.getElementById("base-source"),
    baseMessage: document.getElementById("base-message"),
    sliders: document.getElementById("sliders"),
    queueBar: document.getElementById("queue-bar"),
    queueCount: document.getElementById("queue-count"),
    btnCompareSplit: document.getElementById("btn-compare-split"),
    btnExportZip: document.getElementById("btn-export-zip"),
    btnBatch: document.getElementById("btn-batch"),
    btnApplyAdjAll: document.getElementById("btn-apply-adj-all"),
    btnApplyBaseAll: document.getElementById("btn-apply-base-all"),
    btnResetAll: document.getElementById("btn-reset-all"),
    btnExportParams: document.getElementById("btn-export-params"),
    btnImportParams: document.getElementById("btn-import-params"),
    btnResetAdj: document.getElementById("btn-reset-adj"),
    curveCanvas: document.getElementById("curve-canvas"),
    hist: document.getElementById("hist"),
    curveChannel: document.getElementById("curve-channel"),
    curveIn: document.getElementById("curve-in"),
    curveOut: document.getElementById("curve-out"),
    btnCurveReset: document.getElementById("btn-curve-reset"),
    paramsInput: document.getElementById("params-input"),
    compareOverlay: document.getElementById("compare-overlay"),
    compareBefore: document.getElementById("compare-before"),
    compareDivider: document.getElementById("compare-divider"),
    btnCrop: document.getElementById("btn-crop"),
    cropBar: document.getElementById("crop-bar"),
    cropOverlay: document.getElementById("crop-overlay"),
    cropBox: document.getElementById("crop-box"),
    cropRatio: document.getElementById("crop-ratio"),
    btnCropApply: document.getElementById("btn-crop-apply"),
    btnCropCancel: document.getElementById("btn-crop-cancel"),
    btnCropReset: document.getElementById("btn-crop-reset"),
    toneHint: document.getElementById("tone-hint"),
    toneText: document.getElementById("tone-text"),
    btnToneToggle: document.getElementById("btn-tone-toggle"),
    btnToneIgnore: document.getElementById("btn-tone-ignore"),
    btnExportDir: document.getElementById("btn-export-dir"),
    zipSplit: document.getElementById("zip-split"),
    btnZoom: document.getElementById("btn-zoom"),
    lightbox: document.getElementById("lightbox"),
    lightboxTitle: document.getElementById("lightbox-title"),
    lightboxCanvas: document.getElementById("lightbox-canvas"),
    btnLightboxClose: document.getElementById("btn-lightbox-close"),
    inputTag: document.getElementById("input-tag"),
    negPreview: document.getElementById("neg-preview"),
    negThumb: document.getElementById("neg-thumb"),
    negFile: document.getElementById("neg-file"),
    negSize: document.getElementById("neg-size"),
    negInfo: document.getElementById("neg-info"),
    negPrevSize: document.getElementById("neg-prev-size"),
    negOutSize: document.getElementById("neg-out-size"),
    negCropLabel: document.getElementById("neg-crop-label"),
    btnEditComp: document.getElementById("btn-edit-comp"),
    sampleRadius: document.getElementById("sample-radius"),
    sampleRadiusValue: document.getElementById("sample-radius-value"),
    baseStats: document.getElementById("base-stats"),
    baseConfidence: document.getElementById("base-confidence"),
    baseRange: document.getElementById("base-range"),
    btnApplyAdjUnproc: document.getElementById("btn-apply-adj-unproc"),
    btnApplyBaseUnproc: document.getElementById("btn-apply-base-unproc"),
    btnImportParamsQueue: document.getElementById("btn-import-params-queue"),
    queueEdited: document.getElementById("queue-edited"),
    zipSplitRow: document.getElementById("zip-split-row"),
    miniDrop: document.getElementById("mini-drop"),
  };

  var canvasCtx = el.canvas.getContext("2d");

  function defaultAdjustments() {
    var o = {};
    for (var k in ADJUSTMENTS) o[k] = ADJUSTMENTS[k].default;
    return o;
  }
  state.adj = defaultAdjustments();

  function setStatus(text) { el.status.textContent = text; }

  // ---------- 透视矫正 UI ----------

  function updatePerspectiveUI() {
    if (!el.perspEnabled) return;
    var p = state.perspective;
    var hasImg = !!state.previewData;
    var editing = state.perspEditing;
    if (el.perspActions) el.perspActions.hidden = editing;
    if (el.perspEditActions) el.perspEditActions.hidden = !editing;
    if (el.btnPerspAdjust) el.btnPerspAdjust.disabled = !hasImg || editing;
    if (el.btnPerspRedetect) el.btnPerspRedetect.disabled = !hasImg || editing;
    el.perspEnabled.disabled = editing || !hasImg || !p || !p.quad;
    el.perspEnabled.checked = !!(p && p.quad && p.on);
    if (!el.perspInfo) return;
    if (editing) {
      el.perspInfo.textContent = "拖动四角锚点框住底片画面";
    } else if (!hasImg) {
      el.perspInfo.textContent = "—";
    } else if (!p || (!p.quad && !p.off)) {
      el.perspInfo.textContent = "未检测到清晰边缘";
    } else if (p.off) {
      el.perspInfo.textContent = "已关闭（可重新检测）";
    } else if (p.mode === "local") {
      el.perspInfo.textContent = "边缘弯曲 " + (Math.round((p.ampPx || 0) * 10) / 10).toFixed(1) + " px"
        + (p.on ? " · 已抚直" : " · 默认关闭");
    } else {
      var msg = "旋转 " + (Math.round(p.angle * 10) / 10).toFixed(1) + "° · 梯形 "
        + (Math.round(Math.max(p.keystone, p.trapezoid) * 1000) / 10).toFixed(1) + "%";
      el.perspInfo.textContent = p.on ? msg + " · 已拉正"
        : (p.straight ? "基本平直" : msg + " · 默认关闭");
    }
  }

  // 重建编辑器（透视开关/重新检测/关闭共用）：自动片基在新几何上重算
  function applyPerspectiveChange(item, mutate) {
    if (!item || !state.bitmap) return;
    mutate(item);
    if (!item.baseSource || item.baseSource === "auto") item.base = null;
    setupEditorFromBitmap(state.bitmap, item);
  }

  function bindPerspectiveEvents() {
    if (el.perspEnabled) el.perspEnabled.addEventListener("change", function () {
      if (state.perspEditing) return;
      var cur = currentItem();
      if (!cur || !cur.perspective || !cur.perspective.quad) return;
      var on = el.perspEnabled.checked;
      applyPerspectiveChange(cur, function (it) { it.perspective.on = on; });
    });
    if (el.btnPerspRedetect) el.btnPerspRedetect.addEventListener("click", function () {
      if (state.perspEditing) return;
      var cur = currentItem();
      if (!cur) return;
      applyPerspectiveChange(cur, function (it) { it.perspective = null; });
    });
    if (el.btnPerspAdjust) el.btnPerspAdjust.addEventListener("click", enterPerspEdit);
    if (el.btnPerspDone) el.btnPerspDone.addEventListener("click", function () { exitPerspEdit(true); });
    if (el.btnPerspCancel) el.btnPerspCancel.addEventListener("click", function () { exitPerspEdit(false); });
    // 四角锚点拖拽（PS 手动变换式）
    if (el.perspOverlay) {
      var dragIdx = -1;
      el.perspOverlay.addEventListener("pointerdown", function (e) {
        var a = e.target && e.target.closest ? e.target.closest(".persp-anchor") : null;
        if (!a) return;
        dragIdx = parseInt(a.getAttribute("data-anchor"), 10);
        try { el.perspOverlay.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
        e.preventDefault();
      });
      el.perspOverlay.addEventListener("pointermove", function (e) {
        if (dragIdx < 0) return;
        var r = el.canvas.getBoundingClientRect();
        if (!r.width || !r.height) return;
        var x = clamp((e.clientX - r.left) / r.width, 0, 1);
        var y = clamp((e.clientY - r.top) / r.height, 0, 1);
        var it = currentItem();
        if (!it || !it.perspective || !it.perspective.quad) return;
        it.perspective.quad[dragIdx] = { x: x, y: y };
        updatePerspOverlay();
      });
      function endDrag() { dragIdx = -1; }
      el.perspOverlay.addEventListener("pointerup", endDrag);
      el.perspOverlay.addEventListener("pointercancel", endDrag);
    }
  }
  bindPerspectiveEvents();

  // ---- 透视手动编辑态（PS 式锚点矫正） ----

  // 叠加层几何与锚点位置同步（四边形 + 3×3 透视网格参考线）
  function updatePerspOverlay() {
    if (!el.perspOverlay) return;
    if (!state.perspEditing) { el.perspOverlay.hidden = true; return; }
    var it = currentItem();
    var p = it && it.perspective;
    if (!p || !p.quad) { el.perspOverlay.hidden = true; return; }
    var cv = el.canvas;
    el.perspOverlay.hidden = false;
    el.perspOverlay.style.left = cv.offsetLeft + "px";
    el.perspOverlay.style.top = cv.offsetTop + "px";
    el.perspOverlay.style.width = cv.offsetWidth + "px";
    el.perspOverlay.style.height = cv.offsetHeight + "px";
    var W = cv.offsetWidth, H = cv.offsetHeight;
    var pts = p.quad.map(function (q) { return { x: q.x * W, y: q.y * H }; });
    el.perspOverlay.querySelectorAll(".persp-anchor").forEach(function (a) {
      var i = parseInt(a.getAttribute("data-anchor"), 10);
      a.style.left = pts[i].x + "px";
      a.style.top = pts[i].y + "px";
    });
    function blerp(u, v) {
      var tl = pts[0], tr = pts[1], br = pts[2], bl = pts[3];
      return {
        x: tl.x * (1 - u) * (1 - v) + tr.x * u * (1 - v) + br.x * u * v + bl.x * (1 - u) * v,
        y: tl.y * (1 - u) * (1 - v) + tr.y * u * (1 - v) + br.y * u * v + bl.y * (1 - u) * v
      };
    }
    function polyStr(list) {
      return list.map(function (pt) { return pt.x.toFixed(1) + "," + pt.y.toFixed(1); }).join(" ");
    }
    var svg = "";
    var outer = [blerp(0, 0), blerp(1, 0), blerp(1, 1), blerp(0, 1)];
    svg += '<polygon points="' + polyStr(outer) + '" fill="rgba(255,255,255,0.04)" stroke="#fff" stroke-width="1.5"/>';
    for (var g = 1; g <= 2; g++) {
      var t = g / 3;
      var col = [], row = [];
      for (var k = 0; k <= 12; k++) {
        var u = k / 12;
        col.push(blerp(u, t));
        row.push(blerp(t, u));
      }
      svg += '<polyline points="' + polyStr(col) + '" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="1"/>';
      svg += '<polyline points="' + polyStr(row) + '" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="1"/>';
    }
    var grid = el.perspOverlay.querySelector("svg");
    if (grid) grid.innerHTML = svg;
  }

  // 进入手动矫正：画布切回未矫正原图，显示锚点叠加层
  function enterPerspEdit() {
    var it = currentItem();
    if (!it || !state.bitmap || !state.plainData || state.perspEditing) return;
    state.perspEditing = true;
    state.perspEditBackup = it.perspective ? JSON.parse(JSON.stringify(it.perspective)) : null;
    if (!it.perspective || !it.perspective.quad) {
      it.perspective = { quad: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], on: false, off: false, mode: "manual" };
    }
    // 画布显示未矫正原图
    el.canvas.width = state.plainW;
    el.canvas.height = state.plainH;
    canvasCtx.putImageData(state.plainData, 0, 0);
    state.previewW = state.plainW;
    state.previewH = state.plainH;
    // 退出裁剪编辑，避免叠加层冲突
    state.cropEditing = false;
    if (el.cropBar) el.cropBar.hidden = true;
    if (el.cropOverlay) el.cropOverlay.hidden = true;
    updatePerspOverlay();
    updatePerspectiveUI();
    setStatus("手动矫正：拖动四角锚点框住底片画面，完成后点「完成」应用");
  }

  // 退出手动矫正：commit 应用当前锚点并开启矫正，cancel 恢复进入前状态
  function exitPerspEdit(commit) {
    var it = currentItem();
    if (!it || !state.perspEditing) return;
    var backup = state.perspEditBackup;
    state.perspEditing = false;
    state.perspEditBackup = null;
    if (el.perspOverlay) el.perspOverlay.hidden = true;
    if (commit) {
      applyPerspectiveChange(it, function (t) {
        t.perspective.on = true;
        t.perspective.mode = "manual";
      });
      setStatus("已按手动锚点矫正");
    } else {
      applyPerspectiveChange(it, function (t) { t.perspective = backup; });
      setStatus("");
    }
    updatePerspectiveUI();
  }

  // 自测钩子（?selftest=1）：暴露透视检测结果与预览尺寸
  if (location.search.indexOf("selftest=1") >= 0) {
    window.__fnSelftest = {
      perspective: function () { return state.perspective ? JSON.parse(JSON.stringify(state.perspective)) : null; },
      previewSize: function () { return { w: state.previewW, h: state.previewH, full: { w: state.fullW, h: state.fullH } }; },
      status: function () { return el.status ? el.status.textContent : ""; },
      editing: function () { return !!state.perspEditing; },
      centerPixel: function () {
        var w = state.previewW, h = state.previewH;
        if (!state.previewData || !w || !h) return null;
        var d = state.previewData.data, x = Math.floor(w / 2), y = Math.floor(h / 2), i = (y * w + x) * 4;
        return [d[i], d[i + 1], d[i + 2]];
      }
    };
  }

  function updateBaseUI() {
    var r = state.base[0], g = state.base[1], b = state.base[2];
    el.baseSwatch.style.background = "rgb(" + r + ", " + g + ", " + b + ")";
    el.baseRgb.textContent = "RGB " + r + ", " + g + ", " + b;
    el.baseSource.textContent = state.positive ? "正片直通" :
      state.baseSource === "manual" ? "手动" :
      state.baseSource === "auto" ? "自动" :
      state.baseSource === "sync" ? "同步" : "默认值";
    if (el.baseStats) {
      var showStats = !state.positive && !!state.previewData;
      el.baseStats.hidden = !showStats;
      if (showStats) {
        el.baseConfidence.textContent = state.baseConfidence > 0 ? Math.round(state.baseConfidence * 100) + "%" : "—";
        el.baseRange.textContent = state.baseSamples > 0 ? "约 " + state.baseSamples + " 个样本" : "—";
      }
    }
    if (el.sampleRadius) el.sampleRadius.disabled = !state.previewData;
  }

  function updateBaseMessage(msg) {
    if (msg) el.baseMessage.textContent = msg;
  }

  // 左侧「原始负片」面板：缩略预览 + 文件信息 + 正负片标签
  function updateInputPanel() {
    if (!el.negThumb) return;
    if (!state.previewData) {
      el.negPreview.hidden = true;
      el.negFile.textContent = "尚未载入图片";
      if (el.negInfo) el.negInfo.hidden = true;
      if (el.btnEditComp) el.btnEditComp.disabled = true;
      el.inputTag.textContent = "未载入";
      return;
    }
    el.inputTag.textContent = state.positive ? "正片" : "负片";
    var maxW = 180, maxH = 126;
    var s = Math.min(maxW / state.previewW, maxH / state.previewH);
    var tw = Math.max(1, Math.round(state.previewW * s));
    var th = Math.max(1, Math.round(state.previewH * s));
    el.negThumb.width = tw;
    el.negThumb.height = th;
    var tmp = document.createElement("canvas");
    tmp.width = state.previewW;
    tmp.height = state.previewH;
    tmp.getContext("2d").putImageData(state.previewData, 0, 0);
    var tc = el.negThumb.getContext("2d");
    tc.imageSmoothingQuality = "high";
    tc.clearRect(0, 0, tw, th);
    tc.drawImage(tmp, 0, 0, tw, th);
    el.negPreview.hidden = false;
    el.negFile.textContent = state.srcName || "未命名";
    updateNegInfo();
  }

  // 文件信息行：尺寸 / 预览 / 输出（裁剪后） / 构图
  function updateNegInfo() {
    if (!el.negInfo) return;
    if (!state.previewData) { el.negInfo.hidden = true; return; }
    el.negInfo.hidden = false;
    el.negSize.textContent = state.fullW + " × " + state.fullH;
    el.negPrevSize.textContent = state.previewW + " × " + state.previewH;
    var rect = state.crop ? cropRectPx(state.crop, state.fullW, state.fullH) : null;
    el.negOutSize.textContent = rect ? (rect.w + " × " + rect.h) : (state.fullW + " × " + state.fullH);
    if (!state.crop) {
      el.negCropLabel.textContent = "原图";
    } else {
      var ar = (state.crop.w * state.fullW) / (state.crop.h * state.fullH);
      var near = "";
      [[1, "1:1"], [4 / 3, "4:3"], [1.5, "3:2"], [16 / 9, "16:9"]].forEach(function (p) {
        if (!near && Math.abs(ar - p[0]) / p[0] < 0.02) near = p[1];
      });
      el.negCropLabel.textContent = near || "自定义 " + (Math.round(ar * 100) / 100).toFixed(2) + ":1";
    }
    if (el.btnEditComp) el.btnEditComp.disabled = false;
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
        markEdited();
        scheduleRender();
      });
      input.addEventListener("dblclick", function () {
        state.adj[key] = spec.default;
        input.value = String(spec.default);
        value.textContent = spec.fmt(spec.default);
        markEdited();
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

  // ---- 裁剪与预览绘制 ----
  // 归一化裁剪框 → 指定尺寸下的像素矩形
  function cropRectPx(c, w, h) {
    if (!c) return null;
    var x = Math.round(w * c.x);
    var y = Math.round(h * c.y);
    var cw = Math.max(1, Math.round(w * c.w));
    var ch = Math.max(1, Math.round(h * c.h));
    if (x + cw > w) cw = w - x;
    if (y + ch > h) ch = h - y;
    return { x: x, y: y, w: cw, h: ch };
  }

  // 预览用裁剪矩形（裁剪编辑时显示完整画面）
  function cropPxOf(w, h) {
    return cropRectPx(state.cropEditing ? null : state.crop, w, h);
  }

  function ensureRenderBuf() {
    if (!state.renderBuf || state.renderBuf.width !== state.previewW || state.renderBuf.height !== state.previewH) {
      state.renderBuf = new ImageData(state.previewW, state.previewH);
    }
  }

  // 把完整预览图按当前裁剪框绘制到画布（负偏移自动裁切）
  // 画布显示尺寸：contain 适配舞台可用区域——小图放大填充，大图等比缩小
  function fitCanvasDisplay() {
    if (!state.previewData || !el.canvas) return;
    var stageEl = document.querySelector(".stage-inner");
    if (!stageEl) return;
    var availW = Math.max(160, stageEl.clientWidth);
    var availH = stageEl.clientHeight > 60 ? stageEl.clientHeight : Math.max(240, window.innerHeight * 0.78);
    var cw = el.canvas.width || 1, ch = el.canvas.height || 1;
    var ar = cw / ch;
    var w = Math.min(availW, availH * ar);
    var h = w / ar;
    el.canvas.style.width = Math.round(w) + "px";
    el.canvas.style.height = Math.round(h) + "px";
  }

  function blitPreview(imgData) {
    var rect = cropPxOf(state.previewW, state.previewH);
    var w = rect ? rect.w : state.previewW;
    var h = rect ? rect.h : state.previewH;
    if (el.canvas.width !== w) el.canvas.width = w;
    if (el.canvas.height !== h) el.canvas.height = h;
    canvasCtx.clearRect(0, 0, w, h);
    if (rect) canvasCtx.putImageData(imgData, -rect.x, -rect.y);
    else canvasCtx.putImageData(imgData, 0, 0);
    fitCanvasDisplay();
    syncCompareBox();
    if (state.splitOn && el.compareDivider) applySplit();
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
    ensureRenderBuf();
    var hist = {
      r: new Uint32Array(256), g: new Uint32Array(256),
      b: new Uint32Array(256), luma: new Uint32Array(256),
    };
    render(state.previewData.data, state.renderBuf.data, state.base, state.adj, state.analysis, buildCurveLuts(state.curve), hist);
    state.curveHist = hist;
    blitPreview(state.renderBuf);
    drawCurve();
    drawHistogram(hist);
    state.rendering = false;
    if (state.pendingRender) {
      state.pendingRender = false;
      scheduleRender();
    }
  }

  function drawOriginalPreview() {
    blitPreview(state.previewData);
  }

  // ---- 多图队列与载入 ----
  var MAX_QUEUE = 12;
  var uidSeed = 1;

  var RAW_EXT_RE = /\.(dng|cr2|cr3|nef|arw|raf|orf|rw2|pef|srw|3fr|iiq|mos|erf|kdc|dcr|x3f)$/i;

  function srcExtOf(name) {
    var m = /\.([a-z0-9]+)$/i.exec(String(name || ""));
    return m ? m[1].toLowerCase() : "";
  }

  function baseName(name) {
    var str = String(name || "negative");
    var i = str.lastIndexOf(".");
    return i > 0 ? str.slice(0, i) : str;
  }

  function copyAdj(a) {
    var o = {};
    for (var k in ADJUSTMENTS) o[k] = a && typeof a[k] === "number" ? a[k] : ADJUSTMENTS[k].default;
    return o;
  }

  function adjIsDefault(a) {
    for (var k in ADJUSTMENTS) if (a[k] !== ADJUSTMENTS[k].default) return false;
    return true;
  }

  function queueIndexOf(id) {
    for (var i = 0; i < state.queue.length; i++) if (state.queue[i].id === id) return i;
    return -1;
  }

  function currentItem() {
    var i = queueIndexOf(state.curId);
    return i >= 0 ? state.queue[i] : null;
  }

  // 标记当前图是否已被编辑（调色非默认，或手动取样过片基）
  function markEdited() {
    var cur = currentItem();
    if (!cur) return;
    var v = !adjIsDefault(state.adj) || !curveIsDefault(state.curve) || state.baseSource === "manual" || !!state.crop || state.positive;
    if (cur.edited !== v) {
      cur.edited = v;
      renderQueue();
    }
  }

  // 把编辑器当前参数写回队列项（切图 / 批量导出前调用）
  function saveCurrentToQueue() {
    var cur = currentItem();
    if (!cur || !state.previewData) return;
    cur.adj = copyAdj(state.adj);
    cur.curve = copyCurve(state.curve);
    cur.base = state.base.slice();
    cur.baseSource = state.baseSource;
    cur.baseConfidence = state.baseConfidence;
    cur.baseSamples = state.baseSamples;
    cur.opened = true;
    cur.crop = state.crop ? { x: state.crop.x, y: state.crop.y, w: state.crop.w, h: state.crop.h } : null;
    cur.positive = state.positive;
    cur.edited = !adjIsDefault(state.adj) || !curveIsDefault(state.curve) || state.baseSource === "manual" || !!state.crop || state.positive;
  }

  function addFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    var accepted = [];
    var rawNames = [];
    var badCount = 0;
    files.forEach(function (f) {
      if (RAW_EXT_RE.test(f.name)) { rawNames.push(f.name); return; }
      if (!/^image\//.test(f.type) && !/\.(tif|tiff|bmp|avif|webp|png|jpe?g)$/i.test(f.name)) { badCount += 1; return; }
      accepted.push(f);
    });
    var room = MAX_QUEUE - state.queue.length;
    var overflow = Math.max(0, accepted.length - room);
    if (overflow > 0) accepted = accepted.slice(0, room);
    var firstAdded = null;
    accepted.forEach(function (f) {
      var item = {
        id: uidSeed++,
        file: f,
        name: f.name || ("negative-" + uidSeed),
        ext: srcExtOf(f.name),
        thumbURL: null,
        thumbFailed: false,
        base: null,
        baseSource: null,
        adj: null,
        curve: null,
        opened: false,
        edited: false,
      };
      state.queue.push(item);
      if (!firstAdded) firstAdded = item;
      queueThumb(item);
    });
    var msgs = [];
    if (rawNames.length) {
      msgs.push("RAW（" + rawNames.map(function (n) { return srcExtOf(n).toUpperCase(); }).join("、") + "）暂不支持：浏览器无法直接解码，请先转存 TIFF / JPEG");
    }
    if (badCount) msgs.push("已忽略 " + badCount + " 个不支持类型的文件");
    if (overflow > 0) msgs.push("队列最多 " + MAX_QUEUE + " 张，超出的 " + overflow + " 张已忽略");
    renderQueue();
    if (msgs.length) setStatus(msgs.join("；"));
    else if (accepted.length && state.curId) setStatus("已添加 " + accepted.length + " 张，队列 " + state.queue.length + "/" + MAX_QUEUE + "。");
    if (!accepted.length) return;
    if (!state.curId) {
      state.curId = firstAdded.id;
      loadItemIntoEditor(firstAdded);
      renderQueue();
    }
  }

  // 缩略图：后台串行生成，避免同时解码多张大图
  var thumbChain = Promise.resolve();
  function queueThumb(item) {
    thumbChain = thumbChain.then(function () {
      return genThumb(item);
    }).catch(function () { /* 单张失败不影响后续 */ });
  }

  function genThumb(item) {
    if (item.thumbURL) return Promise.resolve();
    return decodeFile(item.file).then(function (bmp) {
      item.fullW = bmp.width;
      item.fullH = bmp.height;
      var s = Math.min(1, 128 / Math.max(bmp.width, bmp.height));
      var w = Math.max(1, Math.round(bmp.width * s));
      var h = Math.max(1, Math.round(bmp.height * s));
      var c = document.createElement("canvas");
      c.width = w; c.height = h;
      var cx = c.getContext("2d");
      cx.imageSmoothingQuality = "high";
      cx.drawImage(bmp, 0, 0, w, h);
      if (bmp.close) bmp.close();
      item.thumbURL = c.toDataURL("image/jpeg", 0.75);
      renderQueue();
    }).catch(function (err) {
      console.error("缩略图生成失败：", err);
      item.thumbFailed = true;
      renderQueue();
    });
  }

  function switchTo(id) {
    if (state.curId === id || queueIndexOf(id) < 0) return;
    saveCurrentToQueue();
    state.curId = id;
    setSampling(false);
    state.showingOriginal = false;
    loadItemIntoEditor(state.queue[queueIndexOf(id)]);
    renderQueue();
  }

  function removeFromQueue(id) {
    var i = queueIndexOf(id);
    if (i < 0) return;
    var wasCur = state.queue[i].id === state.curId;
    state.queue.splice(i, 1);
    if (!state.queue.length) {
      state.curId = null;
      resetToEmptyState();
      return;
    }
    if (wasCur) {
      state.curId = null;
      var nextId = state.queue[Math.min(i, state.queue.length - 1)].id;
      switchTo(nextId);
    } else {
      renderQueue();
      setStatus("已移除 1 张，队列剩余 " + state.queue.length + " 张。");
    }
  }

  function resetToEmptyState() {
    state.bitmap = null;
    state.previewData = null;
    state.previewW = 0;
    state.previewH = 0;
    state.fullW = 0;
    state.fullH = 0;
    state.analysis = null;
    state.adj = defaultAdjustments();
    state.curve = defaultCurve();
    state.curveChannel = "rgb";
    state.curveHist = null;
    state.base = DEFAULT_BASE.slice();
    state.baseSource = "default";
    state.showingOriginal = false;
    state.splitOn = false;
    state.crop = null;
    state.cropRect = null;
    state.cropEditing = false;
    state.positive = false;
    state.detectedPositive = false;
    state.toneIgnored = false;
    state.renderBuf = null;
    state.perspective = null;
    state.perspEditing = false;
    state.perspEditBackup = null;
    state.plainData = null;
    state.plainW = 0;
    state.plainH = 0;
    if (el.cropBar) el.cropBar.hidden = true;
    if (el.cropOverlay) el.cropOverlay.hidden = true;
    if (el.perspOverlay) el.perspOverlay.hidden = true;
    if (el.toneHint) el.toneHint.hidden = true;
    state.srcName = "";
    state.srcExt = "";
    setSampling(false);
    if (el.btnCompareSplit) {
      el.btnCompareSplit.classList.remove("is-active");
      el.btnCompareSplit.textContent = "对比模式";
    }
    if (el.compareOverlay) el.compareOverlay.hidden = true;
    if (el.lightbox) el.lightbox.hidden = true;
    updateInputPanel();
    Object.keys(sliderEls).forEach(function (key) {
      var s = sliderEls[key];
      s.input.value = String(s.spec.default);
      s.value.textContent = s.spec.fmt(s.spec.default);
    });
    el.canvasWrap.hidden = true;
    el.dropZone.hidden = false;
    [el.btnCompare, el.btnCompareSplit, el.btnZoom, el.btnReset, el.btnExport, el.btnAutoBase,
     el.btnManualBase, el.btnExportParams, el.btnImportParams, el.btnResetAdj, el.btnCurveReset, el.btnApplyAdjAll,
     el.btnApplyAdjUnproc, el.btnApplyBaseUnproc, el.btnImportParamsQueue, el.btnApplyBaseAll,
     el.btnEditComp, el.btnResetAll, el.btnExportZip, el.btnBatch, el.btnCrop, el.btnExportDir].forEach(function (b) {
      if (b) b.disabled = true;
    });
    if (el.exportFormat) el.exportFormat.disabled = true;
    updateBaseUI();
    updateBaseMessage("载入图片后自动识别画面边缘的未曝光片基。");
    updatePerspectiveUI();
    renderQueue();
    setStatus("等待载入图片");
  }

  // 载入指定队列项到编辑器（解码全图 + 生成预览 + 恢复缓存参数）
  function loadItemIntoEditor(item) {
    if (!item) return;
    setStatus("正在解码 " + item.name + "…");
    decodeFile(item.file).then(function (bitmap) {
      if (state.curId !== item.id) { // 等待期间用户已切到别的图
        if (bitmap.close) bitmap.close();
        return;
      }
      setupEditorFromBitmap(bitmap, item);
    }).catch(function (err) {
      console.error(err);
      setStatus("图片解码失败：" + (err && err.message ? err.message : "不支持的格式"));
    });
  }

  // 从已解码的 bitmap 重建编辑器（首次载入 / 透视开关切换共用）
  function setupEditorFromBitmap(bitmap, item) {
    {
      // 切图时退出手动矫正编辑态（锚点叠加层不再适用新图）
      if (state.perspEditing) {
        state.perspEditing = false;
        state.perspEditBackup = null;
        if (el.perspOverlay) el.perspOverlay.hidden = true;
      }
      state.bitmap = bitmap;
      state.fullW = bitmap.width;
      state.fullH = bitmap.height;
      var scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      var w = Math.max(1, Math.round(bitmap.width * scale));
      var h = Math.max(1, Math.round(bitmap.height * scale));
      var cnv = document.createElement("canvas");
      cnv.width = w; cnv.height = h;
      var ctx = cnv.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, 0, w, h);
      var plain = ctx.getImageData(0, 0, w, h);
      // 未矫正原图缓存：手动矫正编辑态显示用
      state.plainData = plain;
      state.plainW = w;
      state.plainH = h;
      // 透视：off 表示用户明确关闭；quad 已有则沿用，否则在未矫正图上自动检测
      // 默认不自动矫正（on=false），检测值仅作为「手动调整」的初始建议
      if (!item.perspective || (!item.perspective.quad && !item.perspective.off)) {
        var det = detectPerspectiveQuad(plain.data, w, h);
        item.perspective = det ? {
          quad: det.quad, on: false, off: false,
          angle: det.angleDeg, keystone: det.keystone, trapezoid: det.trapezoid,
          confidence: det.confidence, straight: !det.significant, stable: det.edgeStable, edgeRms: det.edgeRms, topRms: det.topRms, botRms: det.botRms, leftRms: det.leftRms, rightRms: det.rightRms, rmsLimit: det.rmsLimit,
          mode: det.mode, edgeData: det.edgeData, ampPx: det.ampPx
        } : (item.perspective && item.perspective.off ? item.perspective : null);
      }
      var persp = item.perspective;
      if (persp && persp.quad && persp.on) {
        var warpedCnv = warpPerspectiveCanvas(cnv, persp);
        if (warpedCnv) {
          state.previewData = warpedCnv.getContext("2d").getImageData(0, 0, warpedCnv.width, warpedCnv.height);
          state.previewW = warpedCnv.width;
          state.previewH = warpedCnv.height;
        } else {
          state.previewData = plain;
          state.previewW = w;
          state.previewH = h;
        }
      } else {
        state.previewData = plain;
        state.previewW = w;
        state.previewH = h;
      }
      state.perspective = persp;
      el.canvas.width = state.previewW;
      el.canvas.height = state.previewH;
      state.srcName = item.name;
      state.srcExt = item.ext;
      el.dropZone.hidden = true;
      el.canvasWrap.hidden = false;
      [el.btnCompare, el.btnCompareSplit, el.btnZoom, el.btnReset, el.btnExport, el.btnAutoBase,
       el.btnManualBase, el.btnExportParams, el.btnImportParams, el.btnResetAdj, el.btnCurveReset, el.btnCrop].forEach(function (b) {
        if (b) b.disabled = false;
      });
      if (el.btnExportDir) el.btnExportDir.disabled = !window.showDirectoryPicker;
      if (el.exportFormat) el.exportFormat.disabled = false;
      if (el.exportFormat) {
        var origOpt = el.exportFormat.querySelector('option[value="original"]');
        if (origOpt) origOpt.textContent = "原图格式（" + (item.ext ? item.ext.toUpperCase() : "未知") + "）";
      }
      // 恢复缓存的调色参数，否则用默认值
      state.adj = item.adj ? copyAdj(item.adj) : defaultAdjustments();
      state.curve = item.curve ? copyCurve(item.curve) : defaultCurve();
      state.curveChannel = "rgb";
      syncCurveChannelUI();
      Object.keys(sliderEls).forEach(function (key) {
        var s = sliderEls[key];
        s.input.value = String(state.adj[key]);
        s.value.textContent = s.spec.fmt(state.adj[key]);
      });
      setSampling(false);
      state.showingOriginal = false;
      state.crop = item.crop ? { x: item.crop.x, y: item.crop.y, w: item.crop.w, h: item.crop.h } : null;
      state.cropEditing = false;
      if (el.cropBar) el.cropBar.hidden = true;
      if (el.cropOverlay) el.cropOverlay.hidden = true;
      // 片基：同步 / 手动设定的值直接沿用，否则自动识别
      var detected;
      if (item.base && item.baseSource) {
        state.base = item.base.slice();
        state.baseSource = item.baseSource;
        state.baseConfidence = typeof item.baseConfidence === "number" ? item.baseConfidence : 0.9;
        state.baseSamples = item.baseSamples || 0;
        detected = { message: item.baseSource === "sync" ? "已沿用同步到这一张的片基色。" : "已沿用这张图之前设定的片基色。" };
      } else {
        detected = autoDetectBase(state.previewData.data, w, h);
        state.base = detected.rgb;
        state.baseSource = detected.source;
        state.baseConfidence = detected.confidence || 0;
        state.baseSamples = detected.samples || 0;
        item.base = state.base.slice();
        item.baseSource = state.baseSource;
        item.baseConfidence = state.baseConfidence;
        item.baseSamples = state.baseSamples;
      }
      state.positive = !!item.positive;
      state.toneIgnored = false;
      state.detectedPositive = !state.positive && detectPositive(state.previewData.data, w, h).positive;
      state.analysis = state.positive ? analyzePositive() : analyze(state.previewData.data, state.base);
      item.opened = true;
      updateBaseUI();
      updateBaseMessage(detected.message);
      updateInputPanel();
      renderToneHint();
      doRender();
      // 默认开启对比模式：左边校正结果、右边原片负片；正片直通没有反转意义，保持关闭
      state.splitOn = !state.positive;
      el.btnCompareSplit.classList.toggle("is-active", state.splitOn);
      el.btnCompareSplit.textContent = state.splitOn ? "关闭对比" : "对比模式";
      el.compareOverlay.hidden = !state.splitOn;
      if (state.splitOn) rebuildCompareBefore();
      renderQueue();
      updatePerspectiveUI();
      setStatus("");
    }
  }

  // 渲染队列条（缩略图卡片 + 状态角标 + 删除 + 添加）
  function renderQueue() {
    var bar = el.queueBar;
    if (!bar) return;
    var keepScroll = bar.scrollTop;
    bar.hidden = state.queue.length === 0;
    bar.innerHTML = "";
    state.queue.forEach(function (item, i) {
      var card = document.createElement("div");
      card.className = "qcard" + (item.id === state.curId ? " is-active" : "") + (item.opened ? "" : " is-unloaded");
      card.title = item.name;
      card.setAttribute("role", "button");
      card.tabIndex = 0;
      var thumb = document.createElement("div");
      thumb.className = "qthumb" + (item.thumbURL ? "" : " is-pending");
      if (item.thumbURL) thumb.style.backgroundImage = "url(" + item.thumbURL + ")";
      card.appendChild(thumb);
      var idx = document.createElement("span");
      idx.className = "qindex";
      idx.textContent = String(i + 1);
      card.appendChild(idx);
      var badge;
      if (item.id === state.curId) badge = { text: "编辑中", cls: "is-active" };
      else if (item.edited) badge = { text: "已编辑", cls: "is-edited" };
      else if (!item.opened) badge = { text: "未加载", cls: "" };
      if (badge) {
        var b = document.createElement("span");
        b.className = "qbadge " + badge.cls;
        b.textContent = badge.text;
        card.appendChild(b);
      }
      var srcLabel = item.baseSource === "auto" ? "自动" :
        item.baseSource === "manual" ? "手动" :
        item.baseSource === "sync" ? "同步" : "";
      var dimsLabel = item.fullW ? item.fullW + "×" + item.fullH : "";
      var metaLabel = [srcLabel, dimsLabel].filter(Boolean).join(" · ");
      if (metaLabel) {
        var meta = document.createElement("span");
        meta.className = "qmeta";
        meta.textContent = metaLabel;
        card.appendChild(meta);
      }
      var del = document.createElement("button");
      del.type = "button";
      del.className = "qdel";
      del.textContent = "×";
      del.title = "移除";
      del.setAttribute("aria-label", "移除 " + item.name);
      del.addEventListener("click", function (e) {
        e.stopPropagation();
        removeFromQueue(item.id);
      });
      card.appendChild(del);
      card.addEventListener("click", function () {
        if (item.id !== state.curId) switchTo(item.id);
      });
      card.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (item.id !== state.curId) switchTo(item.id);
        }
      });
      bar.appendChild(card);
    });
    if (state.queue.length < MAX_QUEUE) {
      var add = document.createElement("button");
      add.type = "button";
      add.className = "qadd";
      add.title = "添加更多图片（还可加 " + (MAX_QUEUE - state.queue.length) + " 张）";
      add.textContent = "＋";
      add.addEventListener("click", function () { el.fileInput.click(); });
      bar.appendChild(add);
    }
    bar.scrollTop = keepScroll;
    if (el.queueCount) el.queueCount.textContent = String(state.queue.length);
    var editedCount = 0;
    state.queue.forEach(function (q) { if (q.edited) editedCount += 1; });
    if (el.queueEdited) el.queueEdited.textContent = String(editedCount);
    var multi = state.queue.length >= 2;
    if (el.btnExportZip) el.btnExportZip.disabled = !multi;
    if (el.btnBatch) el.btnBatch.disabled = !multi;
    if (el.btnApplyAdjAll) el.btnApplyAdjAll.disabled = !multi || !state.previewData;
    if (el.btnApplyAdjUnproc) el.btnApplyAdjUnproc.disabled = !multi || !state.previewData;
    if (el.btnApplyBaseAll) el.btnApplyBaseAll.disabled = !multi || !state.previewData;
    if (el.btnApplyBaseUnproc) el.btnApplyBaseUnproc.disabled = !multi || !state.previewData;
    if (el.btnImportParamsQueue) el.btnImportParamsQueue.disabled = !state.previewData;
    if (el.btnResetAll) el.btnResetAll.disabled = state.queue.length < 1 || !state.previewData;
    if (el.btnExportDir) el.btnExportDir.disabled = !state.previewData || !window.showDirectoryPicker;
    if (el.btnCrop) el.btnCrop.disabled = !state.previewData;
    if (state.cropEditing && !state.previewData) exitCropMode(false);
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
    var radius = el.sampleRadius ? (Number(el.sampleRadius.value) || 12) : 12;
    var sampled = manualSample(state.previewData.data, state.previewW, state.previewH, x, y, radius);
    state.base = sampled.rgb;
    state.baseSource = "manual";
    state.baseConfidence = sampled.confidence || 0;
    state.baseSamples = sampled.samples || 0;
    state.analysis = analyze(state.previewData.data, state.base);
    updateBaseUI();
    updateBaseMessage(sampled.message);
    setSampling(false);
    markEdited();
    scheduleRender();
  });

  el.btnAutoBase.addEventListener("click", function () {
    if (!state.previewData) return;
    var detected = autoDetectBase(state.previewData.data, state.previewW, state.previewH);
    state.base = detected.rgb;
    state.baseSource = detected.source;
    state.baseConfidence = detected.confidence || 0;
    state.baseSamples = detected.samples || 0;
    state.analysis = analyze(state.previewData.data, state.base);
    updateBaseUI();
    updateBaseMessage(detected.message);
    setSampling(false);
    markEdited();
    scheduleRender();
  });

  // ---- 对比原片 ----
  function showOriginal(on) {
    if (!state.previewData) return;
    state.showingOriginal = on;
    if (on) {
      drawOriginalPreview();
      if (el.compareOverlay) el.compareOverlay.hidden = true;
    } else {
      doRender();
      if (el.compareOverlay) el.compareOverlay.hidden = !state.splitOn;
    }
  }
  ["pointerdown"].forEach(function (ev) {
    el.btnCompare.addEventListener(ev, function (e) { e.preventDefault(); showOriginal(true); });
  });
  ["pointerup", "pointerleave", "pointercancel"].forEach(function (ev) {
    el.btnCompare.addEventListener(ev, function () { showOriginal(false); });
  });

  function resetAllAdjustments() {
    resetAdjustments();
    state.curve = defaultCurve();
    state.curveChannel = "rgb";
    syncCurveChannelUI();
    markEdited();
    setStatus("已把 8 项调色参数与曲线恢复为默认值。");
  }
  el.btnReset.addEventListener("click", resetAllAdjustments);
  if (el.btnResetAdj) el.btnResetAdj.addEventListener("click", resetAllAdjustments);

  // ---- 正负片提示 ----
  function renderToneHint() {
    if (!el.toneHint) return;
    if (!state.previewData) { el.toneHint.hidden = true; return; }
    if (state.positive) {
      el.toneHint.hidden = false;
      el.toneHint.classList.add("is-positive");
      el.toneText.textContent = "已按正片直通处理：不做反相，仅应用调色参数。";
      el.btnToneToggle.textContent = "改回负片";
      el.btnToneIgnore.hidden = true;
    } else if (state.detectedPositive && !state.toneIgnored) {
      el.toneHint.hidden = false;
      el.toneHint.classList.remove("is-positive");
      el.toneText.textContent = "检测到这张可能已是正片（存在中性高光/白边），直接反相会偏色。";
      el.btnToneToggle.textContent = "按正片处理";
      el.btnToneIgnore.hidden = false;
    } else {
      el.toneHint.hidden = true;
    }
  }

  el.btnToneToggle.addEventListener("click", function () {
    if (!state.previewData) return;
    state.positive = !state.positive;
    state.analysis = state.positive ? analyzePositive() : analyze(state.previewData.data, state.base);
    var item = currentItem();
    if (item) item.positive = state.positive;
    // 正片直通没有「简单反转」对比意义，切换为正片时关闭对比模式
    if (state.positive && state.splitOn) {
      state.splitOn = false;
      el.btnCompareSplit.classList.remove("is-active");
      el.btnCompareSplit.textContent = "对比模式";
      el.compareOverlay.hidden = true;
    }
    updateBaseUI();
    updateInputPanel();
    renderToneHint();
    markEdited();
    doRender();
    setStatus(state.positive ? "已切换为正片直通处理。" : "已恢复负片反相处理。");
  });

  el.btnToneIgnore.addEventListener("click", function () {
    state.toneIgnored = true;
    renderToneHint();
  });

  // ---- 裁剪 ----
  function syncCropBox() {
    if (!el.cropOverlay || el.cropOverlay.hidden) return;
    var cv = el.canvas;
    el.cropOverlay.style.left = cv.offsetLeft + "px";
    el.cropOverlay.style.top = cv.offsetTop + "px";
    el.cropOverlay.style.width = cv.offsetWidth + "px";
    el.cropOverlay.style.height = cv.offsetHeight + "px";
  }

  function paintCropBox() {
    if (!el.cropBox || !state.cropRect) return;
    var r = state.cropRect;
    el.cropBox.style.left = (r.x * 100).toFixed(3) + "%";
    el.cropBox.style.top = (r.y * 100).toFixed(3) + "%";
    el.cropBox.style.width = (r.w * 100).toFixed(3) + "%";
    el.cropBox.style.height = (r.h * 100).toFixed(3) + "%";
    syncCropBox();
  }

  function clampCropRect(r) {
    var w = clamp(r.w, 0.04, 1);
    var h = clamp(r.h, 0.04, 1);
    return { x: clamp(r.x, 0, 1 - w), y: clamp(r.y, 0, 1 - h), w: w, h: h };
  }

  // 归一化坐标下 h/w 的换算系数，用于让像素宽高比等于所选比例
  function ratioNorm() {
    if (!state.cropRatio || !state.previewW || !state.previewH) return 0;
    return state.previewW / (state.cropRatio * state.previewH);
  }

  function fitRatio(r) {
    var k = ratioNorm();
    if (!k) return clampCropRect(r);
    var cx = r.x + r.w / 2;
    var cy = r.y + r.h / 2;
    var w = r.w;
    var h = w * k;
    if (h > 1) { h = 1; w = h / k; }
    if (w > 1) { w = 1; h = w * k; }
    return clampCropRect({ x: cx - w / 2, y: cy - h / 2, w: w, h: h });
  }

  function enterCropMode() {
    if (!state.previewData || state.cropEditing) return;
    state.cropEditing = true;
    state.cropRect = state.crop
      ? { x: state.crop.x, y: state.crop.y, w: state.crop.w, h: state.crop.h }
      : { x: 0, y: 0, w: 1, h: 1 };
    el.cropBar.hidden = false;
    el.cropOverlay.hidden = false;
    el.btnCrop.classList.add("is-active");
    state.showingOriginal = false;
    if (el.compareOverlay) el.compareOverlay.hidden = true;
    state.showingOriginal = false;
    doRender();
    paintCropBox();
    setStatus("拖动四角调整裁剪范围，确认后点「应用」。");
  }

  function exitCropMode(apply) {
    if (!state.cropEditing) return;
    if (apply && state.cropRect) {
      var r = state.cropRect;
      var isFull = r.x < 0.002 && r.y < 0.002 && r.w > 0.996 && r.h > 0.996;
      state.crop = isFull ? null : { x: r.x, y: r.y, w: r.w, h: r.h };
    }
    state.cropEditing = false;
    state.cropRect = null;
    el.cropBar.hidden = true;
    el.cropOverlay.hidden = true;
    el.btnCrop.classList.remove("is-active");
    var item = currentItem();
    if (item) item.crop = state.crop ? { x: state.crop.x, y: state.crop.y, w: state.crop.w, h: state.crop.h } : null;
    doRender();
    if (state.splitOn) {
      el.compareOverlay.hidden = false;
      rebuildCompareBefore();
    }
    updateNegInfo();
    markEdited();
    setStatus(apply && state.crop
      ? "已应用裁剪：" + Math.round(state.crop.w * state.fullW) + " × " + Math.round(state.crop.h * state.fullH)
      : "已取消裁剪。");
  }

  el.btnCrop.addEventListener("click", function () {
    if (state.cropEditing) exitCropMode(true);
    else enterCropMode();
  });
  el.btnCropApply.addEventListener("click", function () { exitCropMode(true); });
  el.btnCropCancel.addEventListener("click", function () { exitCropMode(false); });
  el.btnCropReset.addEventListener("click", function () {
    state.crop = null;
    var item = currentItem();
    if (item) item.crop = null;
    state.cropRect = { x: 0, y: 0, w: 1, h: 1 };
    if (state.cropEditing) {
      paintCropBox();
    } else {
      doRender();
      if (state.splitOn) {
        el.compareOverlay.hidden = false;
        rebuildCompareBefore();
      }
      updateNegInfo();
      markEdited();
    }
    setStatus("已取消裁剪，恢复整幅画面。");
  });
  el.cropRatio.addEventListener("change", function () {
    state.cropRatio = Number(el.cropRatio.value) || 0;
    if (state.cropRect) {
      state.cropRect = state.cropRatio ? fitRatio(state.cropRect) : state.cropRect;
      paintCropBox();
    }
  });

  var cropDrag = null;
  el.cropOverlay.addEventListener("pointerdown", function (e) {
    var target = e.target && e.target.closest ? e.target.closest("[data-handle]") : null;
    if (!target || !state.cropRect) return;
    e.preventDefault();
    cropDrag = {
      handle: target.getAttribute("data-handle"),
      startX: e.clientX,
      startY: e.clientY,
      rect: { x: state.cropRect.x, y: state.cropRect.y, w: state.cropRect.w, h: state.cropRect.h },
      box: el.cropOverlay.getBoundingClientRect(),
    };
    try { el.cropOverlay.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
  });

  el.cropOverlay.addEventListener("pointermove", function (e) {
    if (!cropDrag || !state.cropRect) return;
    var dx = (e.clientX - cropDrag.startX) / Math.max(1, cropDrag.box.width);
    var dy = (e.clientY - cropDrag.startY) / Math.max(1, cropDrag.box.height);
    var s = cropDrag.rect;
    var next;
    if (cropDrag.handle === "move") {
      next = { x: s.x + dx, y: s.y + dy, w: s.w, h: s.h };
    } else {
      var hd = cropDrag.handle;
      var x1 = s.x, y1 = s.y, x2 = s.x + s.w, y2 = s.y + s.h;
      if (hd.indexOf("w") >= 0) x1 = clamp(s.x + dx, 0, x2 - 0.04);
      if (hd.indexOf("e") >= 0) x2 = clamp(s.x + s.w + dx, x1 + 0.04, 1);
      if (hd.indexOf("n") >= 0) y1 = clamp(s.y + dy, 0, y2 - 0.04);
      if (hd.indexOf("s") >= 0) y2 = clamp(s.y + s.h + dy, y1 + 0.04, 1);
      next = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
      var k = ratioNorm();
      if (k) {
        next.h = next.w * k;
        if (hd.indexOf("n") >= 0 && hd.indexOf("s") < 0) next.y = y2 - next.h;
        if (next.y < 0) {
          next.y = 0;
          next.h = y2;
          next.w = next.h / k;
          if (hd.indexOf("w") >= 0) next.x = x2 - next.w;
        }
        if (next.x < 0) {
          next.x = 0;
          next.w = x2;
          next.h = next.w * k;
          if (hd.indexOf("n") >= 0) next.y = y2 - next.h;
        }
        if (next.x + next.w > 1) {
          next.w = 1 - next.x;
          next.h = next.w * k;
          if (hd.indexOf("n") >= 0) next.y = y2 - next.h;
        }
        if (next.y + next.h > 1) {
          next.h = 1 - next.y;
          next.w = next.h / k;
          if (hd.indexOf("w") >= 0) next.x = x2 - next.w;
        }
      }
    }
    state.cropRect = clampCropRect(next);
    paintCropBox();
  });

  ["pointerup", "pointercancel"].forEach(function (ev) {
    el.cropOverlay.addEventListener(ev, function () { cropDrag = null; });
  });

  // ---- 导出：按原始分辨率渲染，可选 JPEG / PNG / WebP / TIFF / 原图格式 ----
  var EXPORT_SPECS = {
    jpeg: { mime: "image/jpeg", ext: "jpg", quality: 0.92, label: "JPEG" },
    png: { mime: "image/png", ext: "png", quality: undefined, label: "PNG" },
    webp: { mime: "image/webp", ext: "webp", quality: 0.92, label: "WebP" }
  };

  function resolveExportChoice(choice) {
    if (choice !== "original") return { kind: choice, note: "" };
    var ext = state.srcExt;
    if (ext === "tif" || ext === "tiff") return { kind: "tiff", note: "" };
    if (ext === "png") return { kind: "png", note: "" };
    if (ext === "webp") return { kind: "webp", note: "" };
    if (ext === "jpg" || ext === "jpeg") return { kind: "jpeg", note: "" };
    return { kind: "png", note: ext ? "（原图 " + ext.toUpperCase() + " 无法在本机编码，已改导出 PNG）" : "" };
  }

  function canvasToBlob(cnv, mime, quality) {
    return new Promise(function (resolve, reject) {
      cnv.toBlob(function (blob) {
        if (blob) resolve(blob);
        else reject(new Error("浏览器不支持导出 " + mime));
      }, mime, quality);
    });
  }

  // 基线 TIFF 编码（RGB 8bit、多 strip），产出可被 Photoshop / Lightroom 等直接读取的标准 TIFF
  function encodeTiffRgb(rgba, w, h) {
    var rowsPerStrip = Math.max(1, Math.min(h, 128));
    var strips = Math.ceil(h / rowsPerStrip);
    var entries = 14;
    var valuesStart = 8 + 2 + entries * 12 + 4;
    var bpOff = valuesStart;
    var soOff = bpOff + 6;
    var sbOff = soOff + strips * 4;
    var xrOff = sbOff + strips * 4;
    var yrOff = xrOff + 8;
    var software = "flowerdeer film-negative";
    var swOff = yrOff + 8;
    var swLen = software.length + 1;
    var dataStart = swOff + swLen;
    if (dataStart % 2) dataStart += 1;

    var stripBytes = [];
    for (var s = 0; s < strips; s++) {
      var rows0 = Math.min(rowsPerStrip, h - s * rowsPerStrip);
      stripBytes.push(rows0 * w * 3);
    }

    var head = new Uint8Array(dataStart);
    var dv = new DataView(head.buffer);
    head[0] = 0x49; head[1] = 0x49; head[2] = 0x2a; head[3] = 0x00; // II* 
    dv.setUint32(4, 8, true);
    dv.setUint16(8, entries, true);

    var p = 10;
    function entry(tag, type, count, value, useOffset) {
      dv.setUint16(p, tag, true);
      dv.setUint16(p + 2, type, true);
      dv.setUint32(p + 4, count, true);
      if (useOffset) dv.setUint32(p + 8, value, true);
      else if (type === 3) dv.setUint16(p + 8, value, true);
      else dv.setUint32(p + 8, value, true);
      p += 12;
    }

    entry(256, 4, 1, w, false);                 // ImageWidth
    entry(257, 4, 1, h, false);                 // ImageLength
    entry(258, 3, 3, bpOff, true);              // BitsPerSample
    entry(259, 3, 1, 1, false);                 // Compression = none
    entry(262, 3, 1, 2, false);                 // Photometric = RGB
    entry(273, 4, strips, soOff, true);         // StripOffsets
    entry(277, 3, 1, 3, false);                 // SamplesPerPixel
    entry(278, 4, 1, rowsPerStrip, false);      // RowsPerStrip
    entry(279, 4, strips, sbOff, true);         // StripByteCounts
    entry(282, 5, 1, xrOff, true);              // XResolution
    entry(283, 5, 1, yrOff, true);              // YResolution
    entry(284, 3, 1, 1, false);                 // PlanarConfiguration
    entry(296, 3, 1, 2, false);                 // ResolutionUnit = inch
    entry(305, 2, swLen, swOff, true);          // Software
    dv.setUint32(p, 0, true);                   // 无下一个 IFD

    dv.setUint16(bpOff, 8, true);
    dv.setUint16(bpOff + 2, 8, true);
    dv.setUint16(bpOff + 4, 8, true);
    dv.setUint32(xrOff, 72, true); dv.setUint32(xrOff + 4, 1, true);
    dv.setUint32(yrOff, 72, true); dv.setUint32(yrOff + 4, 1, true);
    for (var k = 0; k < swLen; k++) {
      head[swOff + k] = k < software.length ? software.charCodeAt(k) : 0;
    }

    var off = dataStart;
    for (var t = 0; t < strips; t++) {
      dv.setUint32(soOff + t * 4, off, true);
      dv.setUint32(sbOff + t * 4, stripBytes[t], true);
      off += stripBytes[t];
    }

    var parts = [head];
    for (var st = 0; st < strips; st++) {
      var y0 = st * rowsPerStrip;
      var rows = Math.min(rowsPerStrip, h - y0);
      var buf = new Uint8Array(rows * w * 3);
      var o = 0;
      for (var y = 0; y < rows; y++) {
        var rowStart = (y0 + y) * w * 4;
        for (var x = 0; x < w; x++) {
          var si = rowStart + x * 4;
          buf[o++] = rgba[si];
          buf[o++] = rgba[si + 1];
          buf[o++] = rgba[si + 2];
        }
      }
      parts.push(buf);
    }
    return new Blob(parts, { type: "image/tiff" });
  }

  // 导出目录：记住本次会话的选择；权限仍在则复用，否则重新弹出选择器。
  // 取消选择或不支持文件夹直写时回退浏览器下载，保证产物不丢。
  var exportDirHandle = null;
  function pickExportDir() {
    if (!window.showDirectoryPicker) return Promise.resolve(null);
    var pick = function () {
      return window.showDirectoryPicker({ mode: "readwrite", id: "fn-export" })
        .then(function (h) { exportDirHandle = h; return h; });
    };
    if (exportDirHandle && exportDirHandle.queryPermission) {
      return exportDirHandle.queryPermission({ mode: "readwrite" }).then(function (p) {
        if (p === "granted") return exportDirHandle;
        return pick();
      });
    }
    return pick();
  }

  // 单张导出统一入口：优先写入用户所选目录，失败/取消回退下载
  function deliverExport(blob, ext, label, note, w, h) {
    return pickExportDir().then(function (dir) {
      if (!dir) { saveBlob(blob, ext, label, note, w, h); return; }
      var name = baseName(state.srcName || "negative") + "-converted." + ext;
      return dir.getFileHandle(name, { create: true })
        .then(function (fh) { return fh.createWritable(); })
        .then(function (wr) { return wr.write(blob).then(function () { return wr.close(); }); })
        .then(function () {
          setStatus("已写入目录：" + name + "（" + label + " " + w + " × " + h + "）" + (note || ""));
          el.btnExport.disabled = false;
        });
    }).catch(function (err) {
      if (err && err.name === "AbortError") { saveBlob(blob, ext, label, note, w, h); return; }
      console.error(err);
      saveBlob(blob, ext, label, note, w, h);
    });
  }

  function saveBlob(blob, ext, label, note, w, h) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = baseName(state.srcName || "negative") + "-converted." + ext;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
    setStatus("已导出 " + label + "（" + w + " × " + h + "）" + (note || ""));
    el.btnExport.disabled = false;
  }

  el.btnExport.addEventListener("click", function () {
    if (!state.bitmap) return;
    var resolved = resolveExportChoice(el.exportFormat ? el.exportFormat.value : "jpeg");
    el.btnExport.disabled = true;
    setStatus("正在按原始分辨率导出…");
    setTimeout(function () {
      try {
        var w = state.fullW, h = state.fullH;
        var cnv = document.createElement("canvas");
        cnv.width = w; cnv.height = h;
        var ctx = cnv.getContext("2d");
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(state.bitmap, 0, 0, w, h);
        // 透视拉正（与预览共用同一 quad，裁剪在矫正之后进行）
        var persp = state.perspective;
        if (persp && persp.quad && persp.on) {
          var warped = warpPerspectiveCanvas(cnv, persp);
          if (warped) { cnv = warped; w = warped.width; h = warped.height; }
        }
        var ectx = cnv.getContext("2d");
        var src = ectx.getImageData(0, 0, w, h);
        var out = ectx.createImageData(w, h);
        render(src.data, out.data, state.base, state.adj, state.analysis, buildCurveLuts(state.curve));
        ectx.putImageData(out, 0, 0);

        var outCanvas = cnv;
        var rect = cropPxOf(w, h);
        if (rect) {
          outCanvas = document.createElement("canvas");
          outCanvas.width = rect.w;
          outCanvas.height = rect.h;
          outCanvas.getContext("2d").drawImage(cnv, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
        }
        var ow = outCanvas.width, oh = outCanvas.height;

        if (resolved.kind === "tiff") {
          var od = outCanvas.getContext("2d").getImageData(0, 0, ow, oh);
          deliverExport(new Blob([encodeTiffRgb(od.data, ow, oh)], { type: "image/tiff" }), "tiff", "TIFF", resolved.note, ow, oh);
          return;
        }
        var spec = EXPORT_SPECS[resolved.kind] || EXPORT_SPECS.png;
        canvasToBlob(outCanvas, spec.mime, spec.quality).then(function (blob) {
          return deliverExport(blob, spec.ext, spec.label, resolved.note, ow, oh);
        }).catch(function (err) {
          console.error(err);
          setStatus("导出失败：" + err.message);
          el.btnExport.disabled = false;
        });
      } catch (err) {
        console.error(err);
        setStatus("导出失败：" + (err && err.message ? err.message : "未知错误"));
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
    if (el.fileInput.files && el.fileInput.files.length) addFiles(el.fileInput.files);
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
    var fs = e.dataTransfer && e.dataTransfer.files;
    if (fs && fs.length) addFiles(fs);
  });

  // ---- 滑块对比：左「校正后」右「原片（负片）」 ----
  function syncCompareBox() {
    if (!el.compareOverlay || el.compareOverlay.hidden || !state.previewData) return;
    var cv = el.canvas;
    el.compareOverlay.style.left = cv.offsetLeft + "px";
    el.compareOverlay.style.top = cv.offsetTop + "px";
    el.compareOverlay.style.width = cv.offsetWidth + "px";
    el.compareOverlay.style.height = cv.offsetHeight + "px";
  }

  function applySplit() {
    if (!el.compareDivider) return;
    var x = state.splitX * 100;
    // 原片图层保留分割线右侧，左侧露出校正后的主画布
    el.compareBefore.style.clipPath = "inset(0 0 0 " + x.toFixed(3) + "%)";
    el.compareDivider.style.left = x.toFixed(3) + "%";
  }

  // 对比右半边显示载入的原始文件（真实负片），左半边为校正结果
  function rebuildCompareBefore() {
    if (!state.previewData || !el.compareBefore) return;
    var c = el.compareBefore;
    var rect = cropPxOf(state.previewW, state.previewH);
    var w = rect ? rect.w : state.previewW;
    var h = rect ? rect.h : state.previewH;
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    var ctx = c.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    if (rect) ctx.putImageData(state.previewData, -rect.x, -rect.y);
    else ctx.putImageData(state.previewData, 0, 0);
    syncCompareBox();
    applySplit();
  }

  el.btnCompareSplit.addEventListener("click", function () {
    if (!state.previewData) return;
    state.splitOn = !state.splitOn;
    el.btnCompareSplit.classList.toggle("is-active", state.splitOn);
    el.btnCompareSplit.textContent = state.splitOn ? "关闭对比" : "对比模式";
    if (state.splitOn) {
      el.compareOverlay.hidden = false;
      rebuildCompareBefore();
    } else {
      el.compareOverlay.hidden = true;
    }
  });

  // ---- 查看大图 ----
  function openLightbox() {
    if (!state.previewData || !state.bitmap) return;
    var w = state.bitmap.width, h = state.bitmap.height;
    setStatus("正在生成大图…");
    setTimeout(function () {
      try {
        var cnv = document.createElement("canvas");
        cnv.width = w; cnv.height = h;
        var ctx = cnv.getContext("2d");
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(state.bitmap, 0, 0, w, h);
        // 透视拉正（与预览/导出共用同一 quad）
        var persp = state.perspective;
        if (persp && persp.quad && persp.on) {
          var warped = warpPerspectiveCanvas(cnv, persp);
          if (warped) { cnv = warped; w = warped.width; h = warped.height; }
        }
        var lctx = cnv.getContext("2d");
        var src = lctx.getImageData(0, 0, w, h);
        var analysis = state.positive ? analyzePositive() : analyze(src.data, state.base);
        var out = lctx.createImageData(w, h);
        render(src.data, out.data, state.base, state.adj, analysis, buildCurveLuts(state.curve));
        lctx.putImageData(out, 0, 0);
        var shown = cnv;
        var rect = cropRectPx(state.crop, w, h);
        if (rect) {
          shown = document.createElement("canvas");
          shown.width = rect.w;
          shown.height = rect.h;
          shown.getContext("2d").drawImage(cnv, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
        }
        el.lightboxCanvas.width = shown.width;
        el.lightboxCanvas.height = shown.height;
        el.lightboxCanvas.getContext("2d").drawImage(shown, 0, 0);
        el.lightboxTitle.textContent = state.srcName + " · " + shown.width + " × " + shown.height;
        el.lightbox.hidden = false;
        setStatus("大图已打开：" + shown.width + " × " + shown.height + "（Esc 或点击空白处关闭）");
      } catch (err) {
        console.error(err);
        setStatus("生成大图失败：" + (err && err.message ? err.message : err));
      }
    }, 30);
  }
  function closeLightbox() {
    el.lightbox.hidden = true;
    setStatus(state.srcName ? state.srcName + " · 大图已关闭。" : "等待载入图片");
  }
  el.btnZoom.addEventListener("click", openLightbox);
  el.btnLightboxClose.addEventListener("click", closeLightbox);
  el.lightbox.addEventListener("click", function (e) {
    if (e.target === el.lightbox) closeLightbox();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !el.lightbox.hidden) closeLightbox();
  });

  // ---- 窗口缩放时重新适配画布显示尺寸 ----
  var canvasResizeTimer = null;
  window.addEventListener("resize", function () {
    if (state.perspEditing) updatePerspOverlay();
    if (!state.previewData) return;
    clearTimeout(canvasResizeTimer);
    canvasResizeTimer = setTimeout(function () {
      fitCanvasDisplay();
      syncCompareBox();
      if (state.splitOn && el.compareDivider) applySplit();
    }, 120);
  });

  // ---- 采样半径 / 编辑构图 / 迷你添加框 ----
  var queueImportNext = false;
  if (el.sampleRadius) {
    el.sampleRadius.addEventListener("input", function () {
      if (el.sampleRadiusValue) el.sampleRadiusValue.textContent = el.sampleRadius.value + " px";
    });
  }
  if (el.btnEditComp) {
    el.btnEditComp.addEventListener("click", function () {
      if (!state.previewData || el.btnCrop.disabled) return;
      el.btnCrop.click();
    });
  }
  if (el.miniDrop) {
    el.miniDrop.addEventListener("click", function () { el.fileInput.click(); });
    ["dragover", "dragenter"].forEach(function (ev) {
      el.miniDrop.addEventListener(ev, function (e) {
        e.preventDefault();
        el.miniDrop.classList.add("is-dragover");
      });
    });
    el.miniDrop.addEventListener("dragleave", function () { el.miniDrop.classList.remove("is-dragover"); });
    el.miniDrop.addEventListener("drop", function (e) {
      e.preventDefault();
      el.miniDrop.classList.remove("is-dragover");
      var fs = e.dataTransfer && e.dataTransfer.files;
      if (fs && fs.length) addFiles(fs);
    });
  }
  if (el.btnImportParamsQueue) {
    el.btnImportParamsQueue.addEventListener("click", function () {
      if (!state.queue.length) return;
      queueImportNext = true;
      el.paramsInput.click();
    });
  }

  // ---- 输出方式（文件夹 / 分卷 ZIP / 单一 ZIP） ----
  function outputMode() {
    var r = document.querySelector('input[name="output-mode"]:checked');
    return r ? r.value : "folder";
  }
  function syncOutputModeUI(silent) {
    var mode = outputMode();
    if (mode === "folder" && !window.showDirectoryPicker) {
      var splitRadio = document.querySelector('input[name="output-mode"][value="split"]');
      if (splitRadio) {
        splitRadio.checked = true;
        mode = "split";
        if (!silent) setStatus("当前浏览器不支持文件夹直写，已切换为自动分卷 ZIP。");
      }
    }
    if (el.btnExportDir) el.btnExportDir.hidden = mode !== "folder";
    if (el.btnExportZip) {
      el.btnExportZip.hidden = mode === "folder";
      el.btnExportZip.textContent = mode === "single" ? "导出单一 ZIP" : "导出全部 ZIP";
    }
    if (el.zipSplitRow) el.zipSplitRow.hidden = mode !== "split";
  }
  document.querySelectorAll('input[name="output-mode"]').forEach(function (r) {
    r.addEventListener("change", function () { syncOutputModeUI(false); });
  });
  syncOutputModeUI(true);

  var splitDrag = false;
  function updateSplitFromEvent(e) {
    var rect = el.compareOverlay.getBoundingClientRect();
    if (!rect.width) return;
    state.splitX = clamp((e.clientX - rect.left) / rect.width, 0.02, 0.98);
    applySplit();
  }
  el.compareDivider.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    splitDrag = true;
    try { el.compareDivider.setPointerCapture(e.pointerId); } catch (err) { /* 老浏览器忽略 */ }
    updateSplitFromEvent(e);
  });
  el.compareDivider.addEventListener("pointermove", function (e) {
    if (splitDrag) updateSplitFromEvent(e);
  });
  ["pointerup", "pointercancel"].forEach(function (ev) {
    el.compareDivider.addEventListener(ev, function () { splitDrag = false; });
  });
  window.addEventListener("resize", function () {
    if (state.perspEditing) updatePerspOverlay();
    syncCompareBox();
    syncCropBox();
    if (state.curveHist) drawHistogram(state.curveHist);
  });

  // ---- 单图参数 JSON 导入 / 导出 ----
  el.btnExportParams.addEventListener("click", function () {
    if (!state.previewData) return;
    var payload = {
      app: "flowerdeer-film-negative",
      version: 1,
      name: state.srcName,
      width: state.fullW,
      height: state.fullH,
      base: [state.base[0], state.base[1], state.base[2]],
      baseSource: state.baseSource,
      adjustments: copyAdj(state.adj),
      curve: copyCurve(state.curve),
      positive: state.positive,
      crop: state.crop ? { x: state.crop.x, y: state.crop.y, w: state.crop.w, h: state.crop.h } : null,
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = (baseName(state.srcName || "negative") || "negative") + "-params.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
    setStatus("已导出参数文件（片基色 + 8 项调色参数 + 曲线）。");
  });

  el.btnImportParams.addEventListener("click", function () { el.paramsInput.click(); });
  el.paramsInput.addEventListener("change", function () {
    var f = el.paramsInput.files && el.paramsInput.files[0];
    el.paramsInput.value = "";
    if (!f) return;
    f.text().then(function (txt) {
      var obj;
      try { obj = JSON.parse(txt); } catch (e) { setStatus("参数文件解析失败：不是合法 JSON。"); return; }
      if (!obj || !obj.adjustments || !Array.isArray(obj.base) || obj.base.length < 3) {
        setStatus("参数文件不匹配：缺少必需字段，请使用本工具导出的参数文件。");
        return;
      }
      if (queueImportNext) {
        queueImportNext = false;
        var adjSrc = {};
        Object.keys(ADJUSTMENTS).forEach(function (k) {
          var v = obj.adjustments[k];
          var spec2 = ADJUSTMENTS[k];
          adjSrc[k] = (typeof v === "number" && isFinite(v)) ? clamp(v, spec2.min, spec2.max) : spec2.default;
        });
        var baseSrc = Array.isArray(obj.base) && obj.base.length >= 3
          ? [roundClamp(obj.base[0]), roundClamp(obj.base[1]), roundClamp(obj.base[2])]
          : null;
        var m = 0;
        var curveSrc = obj.curve ? copyCurve(obj.curve) : null;
        state.queue.forEach(function (q) {
          q.adj = copyAdj(adjSrc);
          if (curveSrc) q.curve = copyCurve(curveSrc);
          if (!adjIsDefault(q.adj) || !curveIsDefault(q.curve)) q.edited = true;
          if (baseSrc) {
            q.base = baseSrc.slice();
            q.baseSource = "sync";
            q.edited = true;
          }
          m += 1;
        });
        renderQueue();
        setStatus("已把参数文件应用到队列全部 " + m + " 张图片。");
        return;
      }
      if (!state.previewData) { setStatus("请先载入图片再导入参数。"); return; }
      var note = "";
      if (obj.width && obj.height && (obj.width !== state.fullW || obj.height !== state.fullH)) {
        note = "注意：参数来自 " + obj.width + "×" + obj.height + "，与当前图片 " + state.fullW + "×" + state.fullH + " 尺寸不一致，效果可能有偏差。";
      }
      Object.keys(ADJUSTMENTS).forEach(function (k) {
        var v = obj.adjustments[k];
        var spec = ADJUSTMENTS[k];
        state.adj[k] = (typeof v === "number" && isFinite(v)) ? clamp(v, spec.min, spec.max) : spec.default;
        var s = sliderEls[k];
        s.input.value = String(state.adj[k]);
        s.value.textContent = s.spec.fmt(state.adj[k]);
      });
      state.curve = obj.curve ? copyCurve(obj.curve) : defaultCurve();
      state.curveChannel = "rgb";
      syncCurveChannelUI();
      state.base = [roundClamp(obj.base[0]), roundClamp(obj.base[1]), roundClamp(obj.base[2])];
      state.baseSource = obj.baseSource === "manual" ? "manual" : "sync";
      state.positive = !!obj.positive;
      state.detectedPositive = false;
      state.toneIgnored = true;
      state.crop = (obj.crop && typeof obj.crop.w === "number" && typeof obj.crop.h === "number")
        ? clampCropRect(obj.crop) : null;
      state.analysis = state.positive ? analyzePositive() : analyze(state.previewData.data, state.base);
      var pItem = currentItem();
      if (pItem) {
        pItem.positive = state.positive;
        pItem.curve = copyCurve(state.curve);
        pItem.crop = state.crop ? { x: state.crop.x, y: state.crop.y, w: state.crop.w, h: state.crop.h } : null;
      }
      state.baseConfidence = 0;
      state.baseSamples = 0;
      updateBaseUI();
      updateNegInfo();
      renderToneHint();
      updateBaseMessage("已导入参数文件" + (obj.name ? "（来自 " + obj.name + "）" : "") + "。");
      markEdited();
      doRender();
      if (state.splitOn) rebuildCompareBefore();
      setStatus("已应用导入的参数。" + note);
    }).catch(function (err) {
      console.error(err);
      setStatus("读取参数文件失败：" + (err && err.message ? err.message : "未知错误"));
    });
  });

  // ---- 批量应用 ----
  function applyAdjTo(unprocOnly) {
    if (!state.previewData || state.queue.length < 2) return;
    var src = copyAdj(state.adj);
    var srcCurve = copyCurve(state.curve);
    var n = 0;
    state.queue.forEach(function (q) {
      if (q.id === state.curId) return;
      if (unprocOnly && q.edited) return;
      q.adj = copyAdj(src);
      q.curve = copyCurve(srcCurve);
      if (!adjIsDefault(q.adj) || !curveIsDefault(q.curve)) q.edited = true;
      n += 1;
    });
    renderQueue();
    setStatus("已把当前 8 项调色参数与曲线应用到" + (unprocOnly ? "未处理的 " : "其余 ") + n + " 张。");
  }
  function applyBaseTo(unprocOnly) {
    if (!state.previewData || state.queue.length < 2) return;
    var b = [state.base[0], state.base[1], state.base[2]];
    var n = 0;
    state.queue.forEach(function (q) {
      if (q.id === state.curId) return;
      if (unprocOnly && q.edited) return;
      q.base = b.slice();
      q.baseSource = "sync";
      q.baseConfidence = state.baseConfidence;
      q.baseSamples = state.baseSamples;
      n += 1;
    });
    renderQueue();
    setStatus("已把当前片基同步到" + (unprocOnly ? "未处理的 " : "其余 ") + n + " 张（适合同一卷胶片）。");
  }
  el.btnApplyAdjAll.addEventListener("click", function () { applyAdjTo(false); });
  el.btnApplyBaseAll.addEventListener("click", function () { applyBaseTo(false); });
  el.btnApplyAdjUnproc.addEventListener("click", function () { applyAdjTo(true); });
  el.btnApplyBaseUnproc.addEventListener("click", function () { applyBaseTo(true); });

  el.btnResetAll.addEventListener("click", function () {
    if (!state.queue.length || !state.previewData) return;
    state.queue.forEach(function (q) {
      q.adj = null;
      q.curve = null;
      q.edited = false;
    });
    resetAdjustments();
    var cur = currentItem();
    if (cur) cur.edited = false;
    renderQueue();
    setStatus("已重置全部 " + state.queue.length + " 张的调色参数（片基保持各自识别结果）。");
  });

  // ---- 批量 ZIP 导出 ----
  function uniqueZipName(name, used) {
    if (!used[name]) { used[name] = 1; return name; }
    var i = name.lastIndexOf(".");
    var stem = i > 0 ? name.slice(0, i) : name;
    var ext = i > 0 ? name.slice(i) : "";
    var n = 2;
    while (used[stem + "-" + n + ext]) n += 1;
    var fn = stem + "-" + n + ext;
    used[fn] = 1;
    return fn;
  }

  // 单张队列项 → 全分辨率 Blob（批量导出用）
  function exportItemToBlob(item, fmtChoice) {
    var choice = fmtChoice;
    if (choice === "original") {
      var e = item.ext;
      choice = (e === "tif" || e === "tiff") ? "tiff" :
        e === "png" ? "png" :
        e === "webp" ? "webp" :
        (e === "jpg" || e === "jpeg") ? "jpeg" : "png";
    }
    return decodeFile(item.file).then(function (bmp) {
      var w = bmp.width, h = bmp.height;
      var scale = Math.min(1, 1600 / Math.max(w, h));
      var pw = Math.max(1, Math.round(w * scale));
      var ph = Math.max(1, Math.round(h * scale));
      var pc = document.createElement("canvas");
      pc.width = pw; pc.height = ph;
      var pctx = pc.getContext("2d");
      pctx.imageSmoothingQuality = "high";
      pctx.drawImage(bmp, 0, 0, pw, ph);
      var pdata = pctx.getImageData(0, 0, pw, ph);
      var base = (item.base && item.base.length === 3) ? item.base.slice() : autoDetectBase(pdata.data, pw, ph).rgb;
      var analysis = item.positive ? analyzePositive() : analyze(pdata.data, base);
      var adj = item.adj ? copyAdj(item.adj) : defaultAdjustments();
      var cnv = document.createElement("canvas");
      cnv.width = w; cnv.height = h;
      var ctx = cnv.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bmp, 0, 0, w, h);
      // 透视拉正（与预览共用同一 quad，裁剪在矫正之后进行）
      var persp = item.perspective;
      if (persp && persp.quad && persp.on) {
        var warped = warpPerspectiveCanvas(cnv, persp);
        if (warped) { cnv = warped; w = warped.width; h = warped.height; }
      }
      var ectx = cnv.getContext("2d");
      var src = ectx.getImageData(0, 0, w, h);
      var out = ectx.createImageData(w, h);
      render(src.data, out.data, base, adj, analysis, buildCurveLuts(item.curve));
      ectx.putImageData(out, 0, 0);
      if (bmp.close) bmp.close();
      var outCanvas = cnv;
      var rect = cropRectPx(item.crop, w, h);
      if (rect) {
        outCanvas = document.createElement("canvas");
        outCanvas.width = rect.w;
        outCanvas.height = rect.h;
        outCanvas.getContext("2d").drawImage(cnv, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
      }
      if (choice === "tiff") {
        var od = outCanvas.getContext("2d").getImageData(0, 0, outCanvas.width, outCanvas.height);
        return { blob: encodeTiffRgb(od.data, outCanvas.width, outCanvas.height), filename: baseName(item.name) + "-converted.tiff" };
      }
      var spec = EXPORT_SPECS[choice] || EXPORT_SPECS.png;
      return canvasToBlob(outCanvas, spec.mime, spec.quality).then(function (blob) {
        return { blob: blob, filename: baseName(item.name) + "-converted." + spec.ext };
      });
    });
  }

  // ---- 批量导出：内存预检 / 分卷 ZIP / 文件夹直写 ----
  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 20000);
  }

  function batchFormatLabel(fmt) {
    if (fmt === "original") return "原图格式";
    if (fmt === "tiff") return "TIFF";
    return EXPORT_SPECS[fmt] ? EXPORT_SPECS[fmt].label : "JPEG";
  }

  // 峰值内存估算：解码位图 + 输入/输出 ImageData + 编码画布 ≈ 12 字节/像素
  function estimateQueuePeak() {
    var px = 0;
    state.queue.forEach(function (q) {
      px += (q.fullW || state.fullW || 0) * (q.fullH || state.fullH || 0);
    });
    return px * 12;
  }

  function confirmBatch(fmt) {
    if (!state.queue.length) return false;
    var peak = estimateQueuePeak();
    var dev = navigator.deviceMemory || 8;
    var risk = peak > dev * 1024 * 1024 * 1024 * 0.30;
    var msg = "将按「" + batchFormatLabel(fmt) + "」逐张全分辨率处理 " + state.queue.length + " 张。\n" +
      "预计峰值内存约 " + (peak / 1048576).toFixed(0) + " MB（设备内存约 " + dev + " GB）。";
    if (risk) {
      msg += "\n\n检测到高内存风险，建议改用「导出到文件夹」或分卷 ZIP。仍要继续吗？";
    }
    return window.confirm(msg);
  }

  function batchBusy(on) {
    [el.btnExportZip, el.btnExport, el.btnExportDir, el.btnApplyAdjAll,
     el.btnApplyAdjUnproc, el.btnApplyBaseAll, el.btnApplyBaseUnproc,
     el.btnImportParamsQueue, el.btnResetAll].forEach(function (b) { if (b) b.disabled = on; });
    if (!on) renderQueue();
  }

  function runZipExport(fmt, limitBytes) {
    var zip = new JSZip();
    var used = {};
    var part = 1;
    var partBytes = 0;
    var partFiles = 0;
    var totalFiles = 0;
    var fail = 0;
    var parts = [];
    var idx = 0;
    var baseFileName = baseName(state.srcName || "negatives") || "negatives";

    function flush() {
      if (!partFiles) return Promise.resolve();
      setStatus("正在压缩" + (limitBytes ? "第 " + part + " 卷" : " ZIP") + "（" + partFiles + " 张）…");
      return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 1 } })
        .then(function (blob) {
          parts.push({ blob: blob, name: baseFileName + (limitBytes ? "-part" + part : "-batch") + ".zip" });
          part += 1;
          zip = new JSZip();
          used = {};
          partBytes = 0;
          partFiles = 0;
        });
    }

    function finish() {
      if (!parts.length) {
        setStatus("打包失败：没有图片被成功处理。");
        batchBusy(false);
        return;
      }
      parts.forEach(function (item, k) {
        if (k === 0) downloadBlob(item.blob, item.name);
        else setTimeout(function () { downloadBlob(item.blob, item.name); }, k * 700);
      });
      var mb = parts.reduce(function (sum, x) { return sum + x.blob.size; }, 0) / 1048576;
      setStatus("已导出 " + (parts.length > 1 ? parts.length + " 卷 ZIP" : "ZIP") + "：" +
        totalFiles + " 张" + (fail ? "（" + fail + " 张失败跳过）" : "") + "，" + mb.toFixed(1) + " MB。");
      batchBusy(false);
    }

    function next(i) {
      if (i >= state.queue.length) return flush().then(finish);
      var item = state.queue[i];
      setStatus("批量处理 " + (i + 1) + "/" + state.queue.length + "：" + item.name + "…");
      return delay(20)
        .then(function () { return exportItemToBlob(item, fmt); })
        .then(function (entry) {
          zip.file(uniqueZipName(entry.filename, used), entry.blob);
          partBytes += entry.blob.size;
          partFiles += 1;
          totalFiles += 1;
          if (limitBytes && partBytes >= limitBytes * 0.9) {
            return flush().then(function () { return next(i + 1); });
          }
          return next(i + 1);
        })
        .catch(function (err) {
          console.error(err);
          fail += 1;
          return next(i + 1);
        });
    }

    next(0);
  }

  function runFolderExport(dirHandle, fmt) {
    var idx = 0;
    var done = 0;
    var fail = 0;

    function next() {
      if (idx >= state.queue.length) {
        setStatus("已写入文件夹：" + done + " 张" + (fail ? "（" + fail + " 张失败）" : "") + "。");
        batchBusy(false);
        return;
      }
      var item = state.queue[idx];
      setStatus("写入文件夹 " + (idx + 1) + "/" + state.queue.length + "：" + item.name + "…");
      delay(20)
        .then(function () { return exportItemToBlob(item, fmt); })
        .then(function (entry) {
          return dirHandle.getFileHandle(entry.filename, { create: true })
            .then(function (fh) { return fh.createWritable(); })
            .then(function (w) {
              return w.write(entry.blob).then(function () { return w.close(); });
            })
            .then(function () { done += 1; });
        })
        .catch(function (err) {
          console.error(err);
          fail += 1;
        })
        .then(function () {
          idx += 1;
          next();
        });
    }

    next();
  }

  // 顶栏「批量导出」按当前输出方式分流，和 auto-tone 的批量按钮保持一致
  if (el.btnBatch) {
    el.btnBatch.addEventListener("click", function () {
      var modeEl = document.querySelector('input[name="output-mode"]:checked');
      var mode = modeEl ? modeEl.value : "folder";
      if (mode === "folder" && el.btnExportDir) el.btnExportDir.click();
      else if (el.btnExportZip) el.btnExportZip.click();
    });
  }

  el.btnExportZip.addEventListener("click", function () {
    if (state.queue.length < 2) return;
    if (typeof JSZip === "undefined") {
      setStatus("打包组件未加载（JSZip 缺失），请刷新页面重试。");
      return;
    }
    saveCurrentToQueue();
    var fmt = el.exportFormat ? el.exportFormat.value : "jpeg";
    if (!confirmBatch(fmt)) return;
    var mode = outputMode();
    var limitMB = mode === "single" ? 0 : (el.zipSplit ? Number(el.zipSplit.value) : 0);
    if (mode === "split" && limitMB <= 0) limitMB = 500; // 自动分卷默认 500MB/卷
    batchBusy(true);
    runZipExport(fmt, limitMB > 0 ? limitMB * 1048576 : 0);
  });

  el.btnExportDir.addEventListener("click", function () {
    if (!window.showDirectoryPicker) {
      setStatus("当前浏览器不支持文件夹直写，请改用 ZIP 导出。");
      return;
    }
    saveCurrentToQueue();
    var fmt = el.exportFormat ? el.exportFormat.value : "jpeg";
    var peak = estimateQueuePeak();
    var dev = navigator.deviceMemory || 8;
    var msg = "将按「" + batchFormatLabel(fmt) + "」把 " + state.queue.length + " 张图片直接写入所选文件夹。\n" +
      "逐张写入，内存占用最低（预计峰值约 " + (peak / 1048576).toFixed(0) + " MB）。";
    if (!window.confirm(msg)) return;
    window.showDirectoryPicker({ mode: "readwrite" }).then(function (dirHandle) {
      batchBusy(true);
      runFolderExport(dirHandle, fmt);
    }).catch(function (err) {
      if (err && err.name === "AbortError") {
        setStatus("已取消导出。");
        return;
      }
      console.error(err);
      setStatus("文件夹写入失败：" + (err && err.message ? err.message : "未知错误"));
    });
  });

  // 画布区也支持拖放新图（队列已有图时 drop-zone 是隐藏的）
  ["dragover", "dragenter"].forEach(function (ev) {
    el.canvasWrap.addEventListener(ev, function (e) { e.preventDefault(); });
  });
  el.canvasWrap.addEventListener("drop", function (e) {
    e.preventDefault();
    var fs = e.dataTransfer && e.dataTransfer.files;
    if (fs && fs.length) addFiles(fs);
  });

  buildSliders();
  initCurveEditor();
  updateBaseUI();
})();
