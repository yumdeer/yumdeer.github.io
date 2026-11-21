(function () {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const els = {
    intro: $("#intro"),
    workspace: $("#workspace"),
    dropZone: $("#dropZone"),
    fileInput: $("#fileInput"),
    changeFileButton: $("#changeFileButton"),
    jobList: $("#jobList"),
    jobQueueSummary: $("#jobQueueSummary"),
    sourceName: $("#sourceName"),
    imageMeta: $("#imageMeta"),
    sourceRotateLeft: $("#sourceRotateLeft"),
    sourceRotateRight: $("#sourceRotateRight"),
    sourceRotationLabel: $("#sourceRotationLabel"),
    canvasShell: $("#canvasShell"),
    sourceCanvas: $("#sourceCanvas"),
    canvasMessage: $("#canvasMessage"),
    undoFrameButton: $("#undoFrameButton"),
    redoFrameButton: $("#redoFrameButton"),
    addFrameButton: $("#addFrameButton"),
    sourceMode: $("#sourceMode"),
    filmFormat: $("#filmFormat"),
    cropScope: $("#cropScope"),
    filmBaseControl: $("#filmBaseControl"),
    filmBaseSwatch: $("#filmBaseSwatch"),
    filmBaseStatus: $("#filmBaseStatus"),
    filmBaseSampleButton: $("#filmBaseSampleButton"),
    filmBaseClearButton: $("#filmBaseClearButton"),
    thresholdLabel: $("#thresholdLabel"),
    thresholdRangeLabels: $("#thresholdRangeLabels"),
    blackThreshold: $("#blackThreshold"),
    blackThresholdValue: $("#blackThresholdValue"),
    borderCoverage: $("#borderCoverage"),
    borderCoverageValue: $("#borderCoverageValue"),
    edgeInset: $("#edgeInset"),
    edgeInsetValue: $("#edgeInsetValue"),
    detectButton: $("#detectButton"),
    resultCount: $("#resultCount"),
    detectedStatus: $("#detectedStatus"),
    frameEditor: $("#frameEditor"),
    frameEditorPlaceholder: $("#frameEditorPlaceholder"),
    frameEditorContent: $("#frameEditorContent"),
    selectedFrameNumber: $("#selectedFrameNumber"),
    duplicateFrameButton: $("#duplicateFrameButton"),
    removeFrameButton: $("#removeFrameButton"),
    cropX: $("#cropX"),
    cropY: $("#cropY"),
    cropW: $("#cropW"),
    cropH: $("#cropH"),
    cropAngle: $("#cropAngle"),
    frameEditorHelp: $("#frameEditorHelp"),
    framesGrid: $("#framesGrid"),
    noFrames: $("#noFrames"),
    selectionActions: $(".selection-actions"),
    selectAllButton: $("#selectAllButton"),
    clearSelectionButton: $("#clearSelectionButton"),
    selectedCount: $("#selectedCount"),
    formatSummary: $("#formatSummary"),
    qualityControl: $("#qualityControl"),
    exportFormat: $("#exportFormat"),
    exportQuality: $("#exportQuality"),
    exportButton: $("#exportButton"),
    exportButtonLabel: $("#exportButtonLabel"),
    exportButtonHint: $("#exportButtonHint"),
    toast: $("#toast")
  };

  const state = {
    jobs: [],
    activeJobId: null,
    jobSequence: 0,
    file: null,
    image: null,
    objectUrl: null,
    frames: [],
    selectedIndex: -1,
    analysis: null,
    scaleX: 1,
    scaleY: 1,
    format: null,
    tiffPageCount: 0,
    tiffSource: null,
    exportDirectoryHandle: null,
    sourceViewRotation: 0,
    baseSamplingActive: false,
    frameAddMode: false,
    cropInteraction: null,
    draftFrame: null,
    busy: false
  };

  const formatMap = {
    "image/jpeg": { ext: "jpg", label: "JPG", mime: "image/jpeg" },
    "image/png": { ext: "png", label: "PNG", mime: "image/png" },
    "image/webp": { ext: "webp", label: "WEBP", mime: "image/webp" },
    "image/bmp": { ext: "bmp", label: "BMP", mime: "image/bmp", isBmp: true },
    "image/tiff": { ext: "tif", label: "TIFF", mime: "image/tiff", isTiff: true }
  };

  const settingsDatabaseName = "film-frame-settings";
  const settingsStoreName = "file-handles";
  const exportDirectoryKey = "last-export-directory";
  const frameHistoryLimit = 50;

  function bindEvents() {
    els.exportFormat?.addEventListener("change", () => {
      const job = getActiveJob();
      if (job?.meta) updateSourceMeta(job);
      updateExportState();
    });

    els.fileInput.addEventListener("change", (event) => {
      const files = Array.from(event.target.files || []);
      if (files.length) void addFiles(files);
    });

    ["dragenter", "dragover"].forEach((eventName) => {
      els.dropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        els.dropZone.classList.add("is-dragging");
      });
    });

    ["dragleave", "drop"].forEach((eventName) => {
      els.dropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        els.dropZone.classList.remove("is-dragging");
      });
    });

    els.dropZone.addEventListener("drop", (event) => {
      const files = Array.from(event.dataTransfer.files || []);
      if (files.length) void addFiles(files);
    });

    els.changeFileButton.addEventListener("click", () => {
      els.fileInput.value = "";
      els.fileInput.click();
    });
    els.detectButton.addEventListener("click", detectFrames);
    els.sourceMode.addEventListener("change", handleSourceModeChange);
    els.filmFormat.addEventListener("change", handleFilmFormatChange);
    els.cropScope.addEventListener("change", handleCropScopeChange);
    els.filmBaseSampleButton.addEventListener("click", toggleFilmBaseSampling);
    els.filmBaseClearButton.addEventListener("click", clearFilmBaseSamples);
    els.sourceRotateLeft.addEventListener("click", () => rotateSourceView(-90));
    els.sourceRotateRight.addEventListener("click", () => rotateSourceView(90));
    els.undoFrameButton.addEventListener("click", undoFrameEdit);
    els.redoFrameButton.addEventListener("click", redoFrameEdit);
    els.addFrameButton.addEventListener("click", () => setFrameAddMode(!state.frameAddMode));
    els.sourceCanvas.addEventListener("pointerdown", beginCropInteraction);
    els.sourceCanvas.addEventListener("pointermove", updateCropInteraction);
    els.sourceCanvas.addEventListener("pointerup", finishCropInteraction);
    els.sourceCanvas.addEventListener("pointercancel", cancelCropInteraction);
    els.sourceCanvas.addEventListener("pointerleave", updateCanvasCursor);
    els.selectAllButton.addEventListener("click", () => setAllFrames(true));
    els.clearSelectionButton.addEventListener("click", () => setAllFrames(false));
    els.duplicateFrameButton.addEventListener("click", duplicateSelectedFrame);
    els.removeFrameButton.addEventListener("click", removeSelectedFrame);
    els.exportButton.addEventListener("click", exportSelected);

    [els.blackThreshold, els.borderCoverage, els.edgeInset].forEach((input) => {
      input.addEventListener("input", updateRangeLabels);
    });

    [els.cropX, els.cropY, els.cropW, els.cropH].forEach((input) => {
      input.addEventListener("change", updateSelectedCrop);
    });
    els.cropAngle.addEventListener("change", updateSelectedFineRotation);

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && (state.baseSamplingActive || state.frameAddMode || state.cropInteraction)) {
        event.preventDefault();
        if (state.baseSamplingActive) stopFilmBaseSampling();
        if (state.frameAddMode) setFrameAddMode(false);
        if (state.cropInteraction) cancelCropInteraction();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && !isFormControl(event.target)) {
        if (event.key.toLowerCase() === "z") {
          event.preventDefault();
          if (event.shiftKey) redoFrameEdit();
          else undoFrameEdit();
          return;
        }
        if (event.key.toLowerCase() === "y") {
          event.preventDefault();
          redoFrameEdit();
          return;
        }
      }
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) && state.selectedIndex >= 0 && !isFormControl(event.target)) {
        event.preventDefault();
        nudgeSelectedFrame(event.key, event.shiftKey ? 10 : 1);
        return;
      }
      if (event.key.toLowerCase() === "r" && state.image && !isFormControl(event.target)) {
        event.preventDefault();
        detectFrames();
      }
    });

    window.addEventListener("resize", drawSourceOverlay);
    updateRangeLabels();
    updateFrameHistoryButtons();
    if (supportsDirectoryExport()) void restoreExportDirectoryHandle();
  }

  function isFormControl(target) {
    return ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName);
  }

  function createJob(file, format) {
    return {
      id: `film-${Date.now()}-${state.jobSequence += 1}`,
      file,
      format,
      frames: [],
      selectedIndex: -1,
      sourceViewRotation: 0,
      options: {
        threshold: 20,
        coverage: Number(els.borderCoverage.value) / 100,
        inset: Number(els.edgeInset.value),
        orientation: "auto",
        sourceMode: "auto",
        filmFormat: "auto"
      },
      baseSamples: [],
      filmBase: null,
      detectionMode: null,
      undoStack: [],
      redoStack: [],
      status: "pending",
      error: null,
      meta: null,
      detection: null,
      thumb: null
    };
  }

  function getActiveJob() {
    return state.jobs.find((job) => job.id === state.activeJobId) || null;
  }

  function readDetectionOptions() {
    return {
      threshold: Number(els.blackThreshold.value),
      coverage: Number(els.borderCoverage.value) / 100,
      inset: Number(els.edgeInset.value),
      orientation: "auto",
      sourceMode: els.sourceMode.value,
      filmFormat: els.filmFormat.value,
      cropScope: els.cropScope.value
    };
  }

  function applyJobOptions(job) {
    els.blackThreshold.value = String(job.options.threshold);
    els.borderCoverage.value = String(Math.round(job.options.coverage * 100));
    els.edgeInset.value = String(job.options.inset);
    els.sourceMode.value = job.options.sourceMode || "auto";
    els.filmFormat.value = job.options.filmFormat || "auto";
    els.cropScope.value = job.options.cropScope || "frame";
    updateRangeLabels();
    updateFilmBaseUi(job);
  }

  function syncActiveJobState() {
    const job = getActiveJob();
    if (!job || !state.image) return;
    job.frames = state.frames;
    job.selectedIndex = state.selectedIndex;
    job.sourceViewRotation = state.sourceViewRotation;
    job.options = readDetectionOptions();
  }

  function releaseRuntime() {
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    state.file = null;
    state.image = null;
    state.objectUrl = null;
    state.frames = [];
    state.selectedIndex = -1;
    state.analysis = null;
    state.scaleX = 1;
    state.scaleY = 1;
    state.format = null;
    state.tiffPageCount = 0;
    state.tiffSource = null;
    state.sourceViewRotation = 0;
    state.baseSamplingActive = false;
    state.frameAddMode = false;
    state.cropInteraction = null;
    state.draftFrame = null;
    els.canvasShell?.classList.remove("is-base-sampling");
    els.canvasShell?.classList.remove("is-adding-frame", "is-editing-frame");
    els.addFrameButton?.classList.remove("is-active");
    els.addFrameButton?.setAttribute("aria-pressed", "false");
    if (els.addFrameButton) els.addFrameButton.textContent = "手动添加画格";
    if (els.framesGrid) els.framesGrid.replaceChildren();
    if (els.sourceCanvas) {
      els.sourceCanvas.width = 1;
      els.sourceCanvas.height = 1;
    }
  }

  async function addFiles(files) {
    if (state.busy) return;
    const accepted = [];
    let rejected = 0;
    files.forEach((file) => {
      const format = getFileFormat(file);
      if (!format) {
        rejected += 1;
        return;
      }
      const job = createJob(file, format);
      state.jobs.push(job);
      accepted.push(job);
    });

    if (!accepted.length) {
      showToast("请选择 JPG、PNG、WEBP、BMP、TIF 或 TIFF 图片");
      return;
    }

    els.intro.hidden = true;
    els.workspace.hidden = false;
    renderJobQueue();
    setBusy(true, `正在处理 1/${accepted.length} 张底片…`);
    await nextPaint();

    for (let index = 0; index < accepted.length; index += 1) {
      const job = accepted[index];
      job.status = "processing";
      renderJobQueue();
      els.canvasMessage.textContent = `正在处理 ${index + 1}/${accepted.length} · ${job.file.name}`;
      try {
        await loadJobRuntime(job, { render: true });
        await nextPaint();
        performActiveDetection({ recordHistory: false });
      } catch (error) {
        console.error(error);
        job.status = "error";
        job.error = "图片读取或识别失败";
        job.frames = [];
      }
      renderJobQueue();
      await nextPaint();
    }

    const firstJob = accepted[0];
    if (getActiveJob()?.id !== firstJob.id) {
      try {
        await loadJobRuntime(firstJob, { render: true });
      } catch (error) {
        console.error(error);
      }
    } else {
      renderAll();
      renderJobDetectionStatus(firstJob);
    }
    setBusy(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
    const suffix = rejected ? `，另有 ${rejected} 个文件格式不支持` : "";
    showToast(`已加入 ${accepted.length} 张底片${suffix}`);
  }

  async function loadJobRuntime(job, { render = true } = {}) {
    syncActiveJobState();
    releaseRuntime();
    state.activeJobId = job.id;
    state.file = job.file;
    state.format = job.format;
    applyJobOptions(job);

    if (job.format.isTiff) {
      state.image = await decodeTiffFile(job.file);
    } else {
      state.objectUrl = URL.createObjectURL(job.file);
      state.image = await decodeImage(state.objectUrl);
    }

    state.frames = job.frames;
    state.selectedIndex = job.selectedIndex;
    state.sourceViewRotation = job.sourceViewRotation;
    job.meta = {
      width: state.image.naturalWidth,
      height: state.image.naturalHeight,
      pageCount: state.tiffPageCount,
      bitDepth: state.tiffSource?.bitsPerSample?.[0] || null
    };
    els.sourceName.textContent = job.file.name;
    els.sourceRotationLabel.value = `${state.sourceViewRotation}°`;
    captureJobThumbnail(job);
    updateSourceMeta(job);
    prepareAnalysisCanvas();
    if (render) {
      renderAll();
      renderJobDetectionStatus(job);
    }
    updateFrameHistoryButtons();
    renderJobQueue();
  }

  async function activateJob(jobId) {
    if (state.busy || jobId === state.activeJobId) return;
    const job = state.jobs.find((candidate) => candidate.id === jobId);
    if (!job) return;
    setBusy(true, `正在打开 ${job.file.name}…`);
    try {
      await loadJobRuntime(job, { render: true });
    } catch (error) {
      console.error(error);
      job.status = "error";
      job.error = "图片读取失败";
      showToast(`${job.file.name} 读取失败`);
    } finally {
      setBusy(false);
      renderJobQueue();
    }
  }

  function resolveExportFormat() {
    const value = els.exportFormat?.value || "original";
    if (value === "original") return null;
    const format = formatMap[value];
    return format ? { ...format } : null;
  }

  function updateSourceMeta(job) {
    const pageNote = job.meta.pageCount > 1 ? ` · ${job.meta.pageCount} 页（处理首帧）` : "";
    const bitDepthNote = job.format.isTiff && job.meta.bitDepth ? ` · ${job.meta.bitDepth}-bit` : "";
    els.imageMeta.innerHTML = `${job.meta.width} × ${job.meta.height} PX<br>${job.format.label}${bitDepthNote}${pageNote} · ${formatBytes(job.file.size)}`;
    const formats = new Set(state.jobs.map((item) => item.format.label));
    const target = resolveExportFormat();
    if (target) {
      els.formatSummary.textContent = `统一导出为 ${target.label}`;
      els.formatSummary.title = "";
    } else {
      els.formatSummary.textContent = state.jobs.length > 1
        ? `${state.jobs.length} 张底片 · 保持各自原格式与裁切精度`
        : (job.format.isTiff && job.meta.bitDepth
          ? `保持 TIFF ${job.meta.bitDepth}-bit 样本 · 应用预览旋转`
          : `保持 ${job.format.label} 格式 · 应用预览旋转`);
      els.formatSummary.title = formats.size > 1 ? `包含 ${Array.from(formats).join(" / ")}` : "";
    }
    els.qualityControl.hidden = !(target
      ? ["image/jpeg", "image/webp"].includes(target.mime)
      : state.jobs.some((item) => ["image/jpeg", "image/webp"].includes(item.format.mime)));
  }

  function decodeImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = url;
    });
  }

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

  // Adobe RGB (1998) -> sRGB：与浏览器对 JPEG 内嵌 ICC 的色彩管理保持一致
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
    const iccEntry = entries?.find((entry) => entry.tag === 34675);
    if (!iccEntry?.data?.length) return;
    const description = readIccDescription(iccEntry.data).toLowerCase();
    if (!description.includes("adobe rgb")) return;
    applyAdobeRgbToSrgb(rgba);
  }

  async function decodeTiffFile(file) {
    if (typeof UTIF === "undefined") throw new Error("TIFF codec is unavailable");
    const buffer = await file.arrayBuffer();
    const directory = parseClassicTiffDirectory(buffer);
    const ifds = UTIF.decode(buffer);
    if (!ifds.length) throw new Error("TIFF contains no image directory");
    state.tiffPageCount = ifds.length;
    UTIF.decodeImage(buffer, ifds[0], ifds);
    const width = ifds[0].width;
    const height = ifds[0].height;
    if (!width || !height) throw new Error("TIFF dimensions are invalid");
    state.tiffSource = createTiffSource(ifds[0], directory);
    const rgba = UTIF.toRGBA8(ifds[0]);
    applyTiffIccProfile(rgba, directory.entries);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const pixels = new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength);
    canvas.getContext("2d").putImageData(new ImageData(pixels, width, height), 0, 0);
    Object.defineProperties(canvas, {
      naturalWidth: { value: width },
      naturalHeight: { value: height }
    });
    return canvas;
  }

  function getFileFormat(file) {
    const extension = (file.name.split(".").pop() || "").toLowerCase();
    const mime = (file.type || "").toLowerCase();
    if (["tif", "tiff"].includes(extension) || ["image/tiff", "image/x-tiff"].includes(mime)) {
      return { ...formatMap["image/tiff"], ext: ["tif", "tiff"].includes(extension) ? extension : "tif" };
    }
    if (["jpg", "jpeg", "jpe"].includes(extension) || mime === "image/jpeg") {
      return { ...formatMap["image/jpeg"], ext: ["jpg", "jpeg", "jpe"].includes(extension) ? extension : "jpg" };
    }
    if (extension === "png" || mime === "image/png") return { ...formatMap["image/png"] };
    if (extension === "webp" || mime === "image/webp") return { ...formatMap["image/webp"] };
    if (extension === "bmp" || ["image/bmp", "image/x-bmp", "image/x-ms-bmp"].includes(mime)) {
      return { ...formatMap["image/bmp"] };
    }
    return null;
  }

  function prepareAnalysisCanvas() {
    const image = state.image;
    const maxSide = 1500;
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, width, height);
    state.analysis = {
      canvas,
      ctx,
      imageData: ctx.getImageData(0, 0, width, height),
      width,
      height
    };
    state.scaleX = image.naturalWidth / width;
    state.scaleY = image.naturalHeight / height;
    els.sourceCanvas.width = width;
    els.sourceCanvas.height = height;
    drawSourceOverlay();
  }

  async function detectFrames() {
    if (!state.analysis || state.busy) return;
    if (state.baseSamplingActive) stopFilmBaseSampling();
    if (state.frameAddMode) setFrameAddMode(false);
    setBusy(true, "正在分析边界与片基颜色…");
    await nextPaint();

    try {
      performActiveDetection();
    } catch (error) {
      console.error(error);
      state.frames = [];
      state.selectedIndex = -1;
      const job = getActiveJob();
      if (job) {
        job.status = "error";
        job.error = "检测未完成";
        job.detection = { type: "warning", title: "检测未完成", detail: "请尝试降低图片尺寸后重试" };
      }
      renderAll();
      setDetectionStatus("warning", "检测未完成", "请尝试降低图片尺寸后重试");
    } finally {
      setBusy(false);
      renderJobQueue();
    }
  }

  function performActiveDetection({ recordHistory = true } = {}) {
    const job = getActiveJob();
    if (!job || !state.analysis) return null;
    const previousSnapshot = recordHistory ? createFrameSnapshot() : null;
    const options = readDetectionOptions();
    const manualFilmBase = getManualFilmBase(state.analysis, job.baseSamples);
    const result = runDetection(state.analysis, manualFilmBase ? { ...options, filmBase: manualFilmBase } : options);
    state.frames = result.frames.map((frame, index) => {
      const rect = toOriginalRect(frame);
      return {
        ...rect,
        id: `${job.id}-${Date.now()}-${index}`,
        checked: true,
        previewRotation: defaultPreviewRotation(rect),
        fineRotation: 0
      };
    });
    state.selectedIndex = state.frames.length ? 0 : -1;
    job.options = options;
    job.frames = state.frames;
    job.selectedIndex = state.selectedIndex;
    job.status = "ready";
    job.error = null;
    job.filmBase = result.filmBase
      ? {
        ...result.filmBase,
        confidence: result.filmBaseConfidence,
        source: result.filmBaseSource
      }
      : null;
    job.detectionMode = result.detectionMode;
    if (previousSnapshot) commitFrameHistory(previousSnapshot);

    if (state.frames.length) {
      const perTrack = result.stripFrameCounts.length > 1
        ? ` · 每轨 ${result.stripFrameCounts.join(" / ")} 格`
        : "";
      const recovered = result.recoveredStripCount
        ? ` · 恢复 ${result.recoveredStripCount} 条缺轨片条`
        : "";
      const edgeFrames = result.edgeFrameCount
        ? ` · 补全 ${result.edgeFrameCount} 个边缘画格`
        : "";
      const modeNote = result.detectionMode === "negative"
        ? ` · 负像片基${result.filmBaseSource === "manual" ? "手动校正" : "自动采样"}`
        : " · 正像黑边";
      job.detection = {
        type: "success",
        title: `找到 ${state.frames.length} 个完整画格`,
        detail: `${result.stripCount} 条片轨${perTrack}${recovered}${edgeFrames} · ${result.orientation === "vertical" ? "纵向排列" : "横向排列"}${modeNote}`
      };
    } else {
      job.detection = { type: "warning", title: "未识别到完整画格", detail: "请调整边界阈值，或使用片基吸管校正" };
    }
    renderAll();
    updateFilmBaseUi(job);
    renderJobDetectionStatus(job);
    return result;
  }

  function renderJobDetectionStatus(job) {
    if (job?.detection) {
      setDetectionStatus(job.detection.type, job.detection.title, job.detection.detail);
    } else if (job?.status === "error") {
      setDetectionStatus("warning", "底片读取失败", job.error || "请重新添加此文件");
    } else {
      setDetectionStatus("warning", "等待识别", "正在准备底片图像");
    }
  }

  // 35mm 片边齿孔在翻拍图中是稳定、等距的高亮小块：先用齿孔带定位片轨两侧，
  // 再在片轨内部按“横贯整条片轨的暗色分隔线”切分画格。这样可以避免把画格
  // 内部的暗部（夜空、树影、深浅渐变）误判成片基黑边，也能处理只有单帧的翻拍图。
  // 标准画幅物理尺寸（长边/短边）。带齿孔的画幅附齿距换算：35mm 齿距约 4.75mm，
  // 画格高约 5 个齿距，135 画格长约 7.6 齿距，半幅约 3.8 齿距。
  const FILM_FORMATS = {
    half: { aspect: 24 / 18, sprockets: true, framePitches: 18 / 4.75 },
    "135": { aspect: 36 / 24, sprockets: true, framePitches: 36 / 4.75 },
    "645": { aspect: 56 / 41.5 },
    "66": { aspect: 1 },
    "67": { aspect: 68 / 56 },
    "69": { aspect: 84 / 56 }
  };

  function formatAspectDeviation(rect, format) {
    if (!format) return 0;
    const oriented = Math.max(rect.w / rect.h, rect.h / rect.w);
    return Math.abs(oriented / format.aspect - 1);
  }

  function detectSprocketFrames(analysis, options, format) {
    const { imageData, width, height } = analysis;
    const data = imageData.data;
    const total = width * height;
    const luma = new Float32Array(total);
    for (let i = 0, offset = 0; i < total; i += 1, offset += 4) {
      luma[i] = data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722;
    }
    const histogram = new Uint32Array(256);
    for (let i = 0; i < total; i += 1) histogram[Math.min(255, luma[i] | 0)] += 1;
    const percentile = (percent) => {
      let acc = 0;
      for (let i = 0; i < 256; i += 1) {
        acc += histogram[i];
        if (acc / total >= percent / 100) return i;
      }
      return 255;
    };
    const brightThreshold = Math.max(110, Math.min(215, percentile(99.5) * 0.72));

    const scanProfile = (axis) => {
      const length = axis === "row" ? height : width;
      const span = axis === "row" ? width : height;
      const scores = new Array(length);
      for (let i = 0; i < length; i += 1) {
        let run = 0;
        let shortRuns = 0;
        let longRun = 0;
        let brightPixels = 0;
        for (let j = 0; j <= span; j += 1) {
          const on = j < span && luma[axis === "row" ? i * width + j : j * width + i] >= brightThreshold;
          if (on) {
            run += 1;
            brightPixels += 1;
            continue;
          }
          if (run > 0) {
            if (run >= 3 && run <= Math.max(8, span * 0.05)) shortRuns += 1;
            if (run > span * 0.12) longRun += run;
            run = 0;
          }
        }
        scores[i] = { shortRuns, longFrac: longRun / span, brightFrac: brightPixels / span };
      }
      return scores;
    };
    const rowScores = scanProfile("row");
    const colScores = scanProfile("col");

    const holeSequence = (fixed, axis) => {
      const length = axis === "row" ? width : height;
      const centers = [];
      let run = 0;
      for (let i = 0; i <= length; i += 1) {
        const value = i < length
          ? luma[axis === "row" ? fixed * width + i : i * width + fixed]
          : 0;
        if (value >= brightThreshold) {
          run += 1;
          continue;
        }
        if (run > 0) {
          if (run >= 3 && run <= Math.max(8, length * 0.05)) centers.push(i - run / 2);
          run = 0;
        }
      }
      const gaps = [];
      for (let i = 1; i < centers.length; i += 1) gaps.push(centers[i] - centers[i - 1]);
      gaps.sort((a, b) => a - b);
      const pitch = gaps.length ? gaps[gaps.length >> 1] : 0;
      const deviation = gaps.length > 2 && pitch > 0
        ? Math.sqrt(gaps.reduce((sum, gap) => sum + (gap - pitch) ** 2, 0) / gaps.length) / pitch
        : 1;
      return { centers, pitch, deviation };
    };

    const findBands = (scores, axis) => {
      const length = scores.length;
      const minHoles = Math.max(5, Math.round((axis === "row" ? width : height) / 400));
      const bands = [];
      let start = -1;
      for (let i = 0; i <= length; i += 1) {
        const score = i < length ? scores[i] : null;
        const isBand = score
          && score.shortRuns >= minHoles
          && score.longFrac < 0.2
          && score.brightFrac > 0.04
          && score.brightFrac < 0.58;
        if (isBand && start < 0) start = i;
        if (!isBand && start >= 0) {
          if (i - start >= 4) {
            const info = holeSequence(Math.round((start + i) / 2), axis);
            if (info.centers.length >= 4 && info.deviation < 0.4) {
              bands.push({ start, end: i, pitch: info.pitch, holes: info.centers.length });
            }
          }
          start = -1;
        }
      }
      return bands;
    };
    const rowBands = findBands(rowScores, "row");
    const colBands = findBands(colScores, "col");
    if (!rowBands.length && !colBands.length) return null;

    const pickPair = (bands, length) => {
      let best = null;
      for (let i = 0; i < bands.length; i += 1) {
        for (let j = i + 1; j < bands.length; j += 1) {
          const first = bands[i];
          const second = bands[j];
          const separation = second.start - first.end;
          if (separation < length * 0.12) continue;
          const edgeScore = 1 - Math.abs(first.start / length - 0.05)
            - Math.abs((length - second.end) / length - 0.05);
          const score = separation / length + edgeScore;
          if (!best || score > best.score) best = { first, second, separation, score };
        }
      }
      return best;
    };
    // 35mm 画格高度约等于 5 个齿孔间距（24mm / 4.75mm），用它排除把画面纹理
    // 误识别成齿孔带的情况。
    const pitchRatioValid = (pair, alongLength) => {
      if (!pair) return false;
      const firstPitch = pair.first.pitch;
      const secondPitch = pair.second.pitch;
      const pitch = (firstPitch + secondPitch) / 2;
      if (!pitch) return false;
      if (pitch < alongLength * 0.035 || pitch > alongLength * 0.12) return false;
      if (Math.abs(firstPitch - secondPitch) / pitch > 0.2) return false;
      const ratio = (pair.second.start - pair.first.end) / pitch;
      return ratio >= 3.6 && ratio <= 6.6;
    };
    const rowPair = pitchRatioValid(pickPair(rowBands, height), width) ? pickPair(rowBands, height) : null;
    const colPair = pitchRatioValid(pickPair(colBands, width), height) ? pickPair(colBands, width) : null;
    let horizontal = null;
    if (rowPair && colPair) horizontal = rowPair.separation / height >= colPair.separation / width;
    else if (rowPair) horizontal = true;
    else if (colPair) horizontal = false;
    if (horizontal === null) return null;
    const edgeBands = horizontal ? rowBands : colBands;
    const chosenPair = horizontal ? rowPair : colPair;
    if (!chosenPair) {
      const band = edgeBands[0];
      const crossLimit = horizontal ? height : width;
      const alongSpan = horizontal ? width : height;
      const atEdge = band.start <= crossLimit * 0.22 || band.end >= crossLimit * 0.78;
      const pitchValid = band.pitch >= alongSpan * 0.035 && band.pitch <= alongSpan * 0.12;
      if (!atEdge || !pitchValid) return null;
    }

    const crossLength = horizontal ? height : width;
    const alongLength = horizontal ? width : height;
    const bands = horizontal ? rowBands : colBands;
    const pair = horizontal ? rowPair : colPair;
    let crossStart;
    let crossEnd;
    if (pair) {
      crossStart = pair.first.end;
      crossEnd = pair.second.start;
    } else {
      const band = bands[0];
      if (band.end < crossLength / 2) {
        crossStart = band.end;
        crossEnd = crossLength;
      } else {
        crossStart = 0;
        crossEnd = band.start;
      }
    }
    if (crossEnd - crossStart < crossLength * 0.15) return null;
    // 135/半幅的画格高固定约 5 个齿距；偏差过大说明这对"齿孔带"本身可疑，
    // 宁可放弃齿孔路径，交给后面的检测兜底。
    const pitch = pair ? (pair.first.pitch + pair.second.pitch) / 2 : bands[0].pitch;
    if (format && format.sprockets && pitch > 0) {
      const heightPitches = (crossEnd - crossStart) / pitch;
      if (heightPitches < 4 || heightPitches > 6.4) return null;
    }

    const darkThreshold = Math.max(16, Math.min(36, percentile(6) + 14));
    const coverage = new Float32Array(alongLength);
    for (let i = 0; i < alongLength; i += 1) {
      let dark = 0;
      for (let j = crossStart; j < crossEnd; j += 1) {
        const value = horizontal ? luma[j * width + i] : luma[i * width + j];
        if (value <= darkThreshold) dark += 1;
      }
      coverage[i] = dark / (crossEnd - crossStart);
    }
    const radius = Math.max(1, Math.round(alongLength * 0.002));
    const smoothed = new Float32Array(alongLength);
    for (let i = 0; i < alongLength; i += 1) {
      let sum = 0;
      let count = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const index = i + k;
        if (index < 0 || index >= alongLength) continue;
        sum += coverage[index];
        count += 1;
      }
      smoothed[i] = sum / count;
    }
    const maxDividerWidth = Math.max(6, Math.round(alongLength * 0.09));
    const dividers = [];
    let dividerStart = -1;
    for (let i = 0; i <= alongLength; i += 1) {
      const on = i < alongLength && smoothed[i] >= 0.9;
      if (on && dividerStart < 0) dividerStart = i;
      if (!on && dividerStart >= 0) {
        if (i - dividerStart <= maxDividerWidth) dividers.push({ start: dividerStart, end: i });
        dividerStart = -1;
      }
    }
    const crossSize = crossEnd - crossStart;

    // 贴边的纯黑片基（均值接近 0、几乎没有噪点）直接裁掉；画面内部的暗部带有
    // 噪点和层次，不会被误裁。
    const regionStats = (from, to) => {
      let sum = 0;
      let count = 0;
      let bright = 0;
      for (let i = from; i < to; i += 2) {
        for (let j = crossStart; j < crossEnd; j += 2) {
          const value = horizontal ? luma[j * width + i] : luma[i * width + j];
          sum += value;
          if (value > 12) bright += 1;
          count += 1;
        }
      }
      if (!count) return { mean: 255, brightFraction: 1 };
      return { mean: sum / count, brightFraction: bright / count };
    };
    const pureBlackEdge = (fromStart) => {
      let index = fromStart ? 0 : alongLength - 1;
      while (index >= 0 && index < alongLength) {
        if (smoothed[index] < 0.9) break;
        index += fromStart ? 1 : -1;
      }
      const edgeIndex = clamp(index, 0, alongLength);
      const length = fromStart ? edgeIndex : alongLength - edgeIndex;
      if (length < crossSize * 0.06) return 0;
      const stats = fromStart ? regionStats(0, edgeIndex) : regionStats(edgeIndex, alongLength);
      // 片基是近乎全黑的低噪点区域；画面内的暗部会有少量亮部细节，不会被误裁。
      return stats.mean < 4.5 && stats.brightFraction < 0.06 ? length : 0;
    };
    const leadingTrim = pureBlackEdge(true);
    const trailingTrim = pureBlackEdge(false);

    // 画格内部的横向暗带（例如夜空与地面之间的暗部）会把一帧切成两段：当分隔线
    // 两侧都是接近整帧宽度的画格时，取消这条分隔线，把它们合并回同一画格。
    let activeDividers = dividers.slice();
    for (let guard = 0; guard < 6; guard += 1) {
      const list = [{ end: leadingTrim }, ...activeDividers, { start: alongLength - trailingTrim }];
      let removed = false;
      for (let i = 0; i < activeDividers.length; i += 1) {
        const left = list[i + 1].start - list[i].end;
        const right = list[i + 2].start - list[i + 1].end;
        const mergedCap = format && format.sprockets
          ? crossSize * (format.framePitches / 5.05) * 1.25
          : crossSize * 2.4;
        const sameFrame = left >= crossSize * 0.55
          && right >= crossSize * 0.55
          && left + right <= mergedCap;
        if (sameFrame) {
          activeDividers = activeDividers.filter((_, index) => index !== i);
          removed = true;
          break;
        }
      }
      if (!removed) break;
    }

    const boundaries = [{ end: leadingTrim }, ...activeDividers, { start: alongLength - trailingTrim }];
    // 检测到齿孔即说明是 35mm 片基：未指定画幅时按 135 标准画格推算边界。
    const sprocketPitches = format && format.sprockets ? format.framePitches : format ? 0 : 36 / 4.75;
    // 在分隔线里挑"最接近标准画格长度"的一段：片轨首尾是人工截断位置，
    // 加惩罚后优先用画格之间的暗缝确定边界。
    const bestFrameSpan = (standardLength) => {
      let best = null;
      for (let i = 0; i < boundaries.length - 1; i += 1) {
        const from = boundaries[i].end;
        for (let j = i + 1; j < boundaries.length; j += 1) {
          const to = boundaries[j].start;
          const length = to - from;
          if (length < standardLength * 0.85 || length > standardLength * 1.15) continue;
          const penalty = (i === 0 ? 0.05 : 0) + (j === boundaries.length - 1 ? 0.05 : 0);
          const score = Math.abs(length / standardLength - 1) + penalty;
          if (!best || score < best.score) best = { from, to, score };
        }
      }
      return best;
    };
    let cells = [];
    for (let i = 0; i < boundaries.length - 1; i += 1) {
      const start = boundaries[i].end;
      const end = boundaries[i + 1].start;
      const size = end - start;
      if (size < crossSize * 0.28) continue;
      let content = 0;
      let sampled = 0;
      for (let y = crossStart; y < crossEnd; y += 3) {
        for (let along = start; along < end; along += 3) {
          sampled += 1;
          const value = horizontal ? luma[y * width + along] : luma[along * width + y];
          if (value > darkThreshold + 14) content += 1;
        }
      }
      const ratio = content / Math.max(1, sampled);
      if (ratio < 0.16) continue;
      const rect = horizontal
        ? { x: start, y: crossStart, w: size, h: crossSize }
        : { x: crossStart, y: start, w: crossSize, h: size };
      cells.push({ rect, ratio, fromGap: i > 0, toGap: i + 1 < boundaries.length - 1 });
    }
    if (!cells.length) {
      // 夜景等极暗画面亮部占比很低，会被内容过滤全部剔除；此时齿孔几何已经
      // 确认片轨范围。优先在分隔线里挑"最接近标准画格长度"的一段，避免把
      // 整条片轨（含相邻画格的边缘、扫描底板）一并框进来。
      let start = leadingTrim;
      let end = alongLength - trailingTrim;
      if (sprocketPitches > 0 && pitch > 0) {
        const best = bestFrameSpan(sprocketPitches * pitch);
        if (best) {
          start = best.from;
          end = best.to;
        }
      }
      const size = end - start;
      if (size < crossSize * 0.4) return null;
      cells.push({
        rect: horizontal
          ? { x: start, y: crossStart, w: size, h: crossSize }
          : { x: crossStart, y: start, w: crossSize, h: size },
        ratio: 0.16
      });
    }
    if (sprocketPitches > 0 && pitch > 0 && cells.length === 1) {
      const standardLength = sprocketPitches * pitch;
      const length = horizontal ? cells[0].rect.w : cells[0].rect.h;
      if (Math.abs(length / standardLength - 1) > 0.12) {
        const best = bestFrameSpan(standardLength);
        if (best) {
          const rect = { ...cells[0].rect };
          if (horizontal) {
            rect.x = best.from;
            rect.w = best.to - best.from;
          } else {
            rect.y = best.from;
            rect.h = best.to - best.from;
          }
          cells = [{ ...cells[0], rect }];
        }
      }
    }
    if (format && format.sprockets && pitch > 0 && cells.length > 1) {
      // 画幅已知时，画格长度应约等于 N 个齿距；不满足的按碎片剔除。
      const matched = cells.filter((cell) => {
        const length = horizontal ? cell.rect.w : cell.rect.h;
        return Math.abs(length / pitch / format.framePitches - 1) <= 0.32;
      });
      if (matched.length) cells = matched;
    }
    // 齿孔几何能给出每帧的标准尺寸：35mm 画格高固定 24mm（约 5.05 齿距），
    // 画格长由画幅决定（135 约 7.58 齿距，半幅约 3.79 齿距）。翻拍画面在暗部
    // 截止时内容边界会短于真实画格，按齿距还原后暗部不再被当成片基裁掉，
    // 宽高比也回到标准值。未指定画幅时按最常见的 135 处理。
    if (pitch > 0) {
      const standardPitches = format && format.sprockets ? format.framePitches : 36 / 4.75;
      const standardLength = Math.round(standardPitches * pitch);
      const standardHeight = Math.round((24 / 4.75) * pitch);
      cells = cells.map((cell) => {
        const rect = { ...cell.rect };
        const length = horizontal ? rect.w : rect.h;
        if (standardLength > 0 && Math.abs(length / standardLength - 1) > 0.06) {
          let anchor;
          if (cell.fromGap && cell.toGap) anchor = horizontal ? rect.x : rect.y;
          else if (cell.fromGap) anchor = horizontal ? rect.x : rect.y;
          else if (cell.toGap) anchor = (horizontal ? rect.x + rect.w : rect.y + rect.h) - standardLength;
          else anchor = (horizontal ? rect.x : rect.y) + (length - standardLength) / 2;
          // 起点优先：靠近片轨右端时保留锚点、缩短长度，避免整段被左移出画框。
          anchor = Math.max(0, Math.round(anchor));
          if (horizontal) {
            rect.x = anchor;
            rect.w = Math.min(standardLength, alongLength - anchor);
          } else {
            rect.y = anchor;
            rect.h = Math.min(standardLength, alongLength - anchor);
          }
        }
        const crossNow = horizontal ? rect.h : rect.w;
        // 两侧齿孔带都识别到时，片轨中心可靠，画格高直接取标准 24mm；
        // 只有单侧齿孔带时才在偏差过大时校正，避免中心偏移。
        if (standardHeight > 0 && (pair || Math.abs(crossNow / standardHeight - 1) > 0.08)) {
          const center = horizontal ? rect.y + rect.h / 2 : rect.x + rect.w / 2;
          const crossAt = clamp(Math.round(center - standardHeight / 2), 0, Math.max(0, crossLength - standardHeight));
          if (horizontal) {
            rect.y = crossAt;
            rect.h = Math.min(standardHeight, crossLength - crossAt);
          } else {
            rect.x = crossAt;
            rect.w = Math.min(standardHeight, crossLength - crossAt);
          }
        }
        return { ...cell, rect };
      });
    }
    cells.sort((a, b) => b.rect.w * b.rect.h * b.ratio - a.rect.w * a.rect.h * a.ratio);
    // 画格尺寸已按齿距标准化，不能再按亮度裁剪，否则画面暗部会被二次误裁。
    // 假分隔线会让同一帧生成两个重叠画格，这里按重叠度去重。
    const frames = dedupeAndSort(cells.slice(0, 4).map((cell) => ({ ...cell.rect })));
    return {
      frames,
      stripCount: 1,
      stripFrameCounts: [frames.length],
      orientation: horizontal ? "horizontal" : "vertical",
      layoutStrength: 0.65,
      detectionMode: "positive",
      detector: "sprocket",
      filmBase: null,
      filmBaseConfidence: null,
      filmBaseSource: null
    };
  }

  // 扫描仪底板、纸张留白常是纯白边条，会把检测框撑到画面之外；先裁掉纯白边，
  // 再做检测，最后把坐标偏移补回去。
  function cropWhiteMargins(analysis) {
    const { width, height } = analysis;
    const data = analysis.imageData.data;
    const lineMean = (axis, pos) => {
      let sum = 0;
      let count = 0;
      if (axis === "row") {
        for (let x = 0; x < width; x += 4) {
          const offset = (pos * width + x) * 4;
          sum += data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722;
          count += 1;
        }
      } else {
        for (let y = 0; y < height; y += 4) {
          const offset = (y * width + pos) * 4;
          sum += data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722;
          count += 1;
        }
      }
      return count ? sum / count : 0;
    };
    const maxTrimY = Math.round(height * 0.25);
    const maxTrimX = Math.round(width * 0.25);
    // 扫描白边不一定纯白（翻拍时底板会带阴影），只要边条明显比片基亮、
    // 且紧邻内侧是暗色片基，就视为白边；画面本身很亮时内侧也亮，不会误裁。
    const edgeTrim = (axis, maxTrim, maxPos) => {
      let count = 0;
      let pos = 0;
      while (count < maxTrim && lineMean(axis, pos) > 180) {
        count += 1;
        pos += 1;
      }
      if (count < 6) return 0;
      const inner = Math.min(maxPos - 1, pos + 30);
      return lineMean(axis, inner) < 80 ? count : 0;
    };
    let top = edgeTrim("row", maxTrimY, height);
    let bottom = height - 1 - edgeTrim("row", maxTrimY, height);
    let left = edgeTrim("col", maxTrimX, width);
    let right = width - 1 - edgeTrim("col", maxTrimX, width);
    // 反方向（底部/右侧）单独计算
    const edgeTrimReverse = (axis, maxTrim, maxPos) => {
      let count = 0;
      let pos = maxPos - 1;
      while (count < maxTrim && lineMean(axis, pos) > 180) {
        count += 1;
        pos -= 1;
      }
      if (count < 6) return 0;
      const inner = Math.max(0, pos - 30);
      return lineMean(axis, inner) < 80 ? count : 0;
    };
    top = edgeTrim("row", maxTrimY, height);
    bottom = height - 1 - edgeTrimReverse("row", maxTrimY, height);
    left = edgeTrim("col", maxTrimX, width);
    right = width - 1 - edgeTrimReverse("col", maxTrimX, width);
    const w = right - left + 1;
    const h = bottom - top + 1;
    if (w < width * 0.5 || h < height * 0.5 || (!left && !top && w === width && h === height)) {
      return { analysis, offsetX: 0, offsetY: 0 };
    }
    const cropped = new Uint8ClampedArray(w * h * 4);
    const source = data;
    for (let y = 0; y < h; y += 1) {
      const from = ((y + top) * width + left) * 4;
      cropped.set(source.subarray(from, from + w * 4), y * w * 4);
    }
    return {
      analysis: { imageData: { data: cropped, width: w, height: h }, width: w, height: h },
      offsetX: left,
      offsetY: top
    };
  }

  // 120 画幅没有齿孔，画面边缘若落在暗部（树影、夜景），内容检测会少框；
  // 这里按用户选定的固定画幅比例，把缺的一边朝"有内容（亮度或纹理）"的方向补齐，
  // 遇到纯片基（又黑又平）立即停止，避免把黑色片基框进画面。
  function extendRectToFormat(analysis, rect, format, backgroundLuma) {
    if (!format || !(format.aspect > 0)) return rect;
    const { width, height } = analysis;
    const data = analysis.imageData.data;
    const stride = Math.max(1, Math.round(Math.max(width, height) / 400));
    const lumaAt = (x, y) => {
      const offset = (y * width + x) * 4;
      return data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722;
    };
    const next = { ...rect };
    const bandStats = (axis, pos) => {
      let sum = 0;
      let sumSq = 0;
      let count = 0;
      if (axis === "row") {
        if (pos < 0 || pos >= height) return null;
        const x0 = next.x + Math.round(next.w * 0.08);
        const x1 = next.x + Math.round(next.w * 0.92);
        for (let x = x0; x < x1; x += stride) {
          const value = lumaAt(x, pos);
          sum += value;
          sumSq += value * value;
          count += 1;
        }
      } else {
        if (pos < 0 || pos >= width) return null;
        const y0 = next.y + Math.round(next.h * 0.08);
        const y1 = next.y + Math.round(next.h * 0.92);
        for (let y = y0; y < y1; y += stride) {
          const value = lumaAt(pos, y);
          sum += value;
          sumSq += value * value;
          count += 1;
        }
      }
      if (!count) return null;
      const mean = sum / count;
      return { mean, std: Math.sqrt(Math.max(0, sumSq / count - mean * mean)) };
    };
    const hasContent = (axis, pos) => {
      const s = bandStats(axis, pos);
      return s ? s.mean > backgroundLuma + 12 || s.std > 10 : false;
    };
    const ratio = next.w / next.h;
    const targetAspect = format.aspect;
    if (Math.abs(ratio / targetAspect - 1) <= 0.08) return next;
    const growY = ratio > targetAspect;
    const axis = growY ? "row" : "col";
    const maxPos = growY ? height : width;
    const edgeStart = growY ? next.y : next.x;
    const edgeSize = growY ? next.h : next.w;
    const crossSize = growY ? next.w : next.h;
    const target = Math.round(growY ? next.w / targetAspect : next.h * targetAspect);
    const need = target - edgeSize;
    if (need <= 0) return next;
    // 两侧各探一段，看哪一侧更像画面，优先朝那一侧扩。
    const sideScore = (dir) => {
      const from = dir < 0 ? edgeStart - need : edgeStart + edgeSize;
      let hit = 0;
      let total = 0;
      for (let d = 0; d < need; d += stride) {
        const pos = dir < 0 ? from + d : from + d;
        if (pos < 0 || pos >= maxPos) continue;
        total += 1;
        if (hasContent(axis, pos)) hit += 1;
      }
      return total ? hit / total : 0;
    };
    const up = sideScore(-1);
    const down = sideScore(1);
    if (Math.max(up, down) < 0.25) {
      // 暗夜画面顶部常是极暗天空（亮度接近片基、纹理很弱），内容判据会当成空白。
      // 用户已指定画幅时按画幅补足高度，优先朝空间更大的一侧扩展；遇到明显亮于
      // 片基的边条（扫描底板/白边）立即停止，避免把底板框进来。
      const upRoom = edgeStart;
      const downRoom = maxPos - (edgeStart + edgeSize);
      const room = Math.max(upRoom, downRoom);
      if (room <= 0) return next;
      const dir = upRoom >= downRoom ? -1 : 1;
      const span = Math.min(need, room);
      const edge = dir < 0 ? edgeStart : edgeStart + edgeSize;
      let cursor = edge;
      while (Math.abs(cursor - edge) < span) {
        const s = bandStats(axis, dir < 0 ? cursor - 1 : cursor);
        if (!s || s.mean > backgroundLuma + 40) break;
        cursor += dir;
      }
      if (cursor === edge) return next;
      if (growY) {
        if (dir < 0) {
          next.y = cursor;
          next.h = edgeStart + edgeSize - cursor;
        } else {
          next.h = cursor - edgeStart;
        }
      } else if (dir < 0) {
        next.x = cursor;
        next.w = edgeStart + edgeSize - cursor;
      } else {
        next.w = cursor - edgeStart;
      }
      return next;
    }
    const dir = up >= down ? -1 : 1;
    const edge = dir < 0 ? edgeStart : edgeStart + edgeSize;
    const limit = clamp(edge + dir * need, 0, maxPos);
    const maxFlat = Math.max(6, Math.round(crossSize * 0.02));
    let cursor = edge;
    let flat = 0;
    while (dir < 0 ? cursor > limit : cursor < limit) {
      const pos = dir < 0 ? cursor - 1 : cursor;
      if (hasContent(axis, pos)) flat = 0;
      else flat += 1;
      if (flat > maxFlat) break;
      cursor += dir;
    }
    if (cursor === edge) return next;
    if (growY) {
      if (dir < 0) {
        next.y = cursor;
        next.h = edgeStart + edgeSize - cursor;
      } else {
        next.h = cursor - edgeStart;
      }
    } else if (dir < 0) {
      next.x = cursor;
      next.w = edgeStart + edgeSize - cursor;
    } else {
      next.w = cursor - edgeStart;
    }
    return next;
  }

  // 检测框常把贴边的纯黑片基、扫描背景一并框进来。这里从四边向内剥离"几乎没有
  // 内容"的边条，并允许跨过窄的孤立亮条（扫描仪边缘伪影），让画框落在真实画面上。
  function trimNoContentEdges(analysis, rect, backgroundLuma, strict) {
    const { width, height } = analysis;
    const data = analysis.imageData.data;
    const stride = Math.max(1, Math.round(Math.max(width, height) / 600));
    const lumaAt = (x, y) => {
      const offset = (y * width + x) * 4;
      return data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722;
    };
    const threshold = backgroundLuma + 12;
    // 片基是"又黑又平"的，画面暗部通常带纹理或渐变；两者都满足才判为无内容。
    const stats = (from, count, axis) => {
      let sum = 0;
      let sumSq = 0;
      let bright = 0;
      let total = 0;
      for (let i = 0; i < count; i += stride) {
        const value = axis === "y" ? lumaAt(from, rect.y + i) : lumaAt(rect.x + i, from);
        sum += value;
        sumSq += value * value;
        if (value > threshold) bright += 1;
        total += 1;
      }
      if (!total) return { bright: 0, flat: true, mean: 0 };
      const mean = sum / total;
      const variance = Math.max(0, sumSq / total - mean * mean);
      return { bright: bright / total, mean, flat: mean < threshold + 8 && variance < 16 };
    };
    // 已知画幅时只用亮度判定：扫描条纹、片边反光的方差很大，用方差判据会把
    // 暗色片基误当成内容，导致贴边的噪声带被保留、宽度被撑大。
    const colContent = (x) => {
      const s = stats(x, rect.h, "y");
      return strict ? s.mean > backgroundLuma + 30 : s.bright >= minContent || !s.flat;
    };
    // 行方向不按亮度裁：暗夜画面顶部与片基亮度接近，裁掉会丢失真实画面，
    // 高度缺口由上层的画幅补足逻辑处理。
    const rowContent = (y) => {
      if (strict) return true;
      const s = stats(y, rect.w, "x");
      return s.bright >= minContent || !s.flat;
    };
    const minContent = 0.05;
    const maxIsland = Math.max(8, Math.round(Math.max(width, height) * 0.055));
    // 从 from 开始按 dir 推进到 limit，返回第一处"连续有内容"的坐标；窄亮条视为伪影跳过。
    // span 用矩形自然边界统计，避免被剥离上限截断。
    const scan = (fractionAt, from, limit, dir, bound) => {
      let cursor = from;
      const inBounds = (i) => (dir > 0 ? i <= bound : i >= bound);
      while (dir > 0 ? cursor < limit : cursor > limit) {
        if (!fractionAt(cursor)) {
          cursor += dir;
          continue;
        }
        let probe = cursor;
        let span = 0;
        while (inBounds(probe) && fractionAt(probe)) {
          probe += dir;
          span += 1;
        }
        if (span >= maxIsland) return cursor;
        cursor = probe;
      }
      return null;
    };
    const reachX = Math.max(1, Math.round(rect.w * 0.4));
    const reachY = Math.max(1, Math.round(rect.h * 0.4));
    const left = scan(colContent, rect.x, rect.x + reachX, 1, rect.x + rect.w - 1);
    const right = scan(colContent, rect.x + rect.w - 1, rect.x + rect.w - reachX, -1, rect.x);
    const top = scan(rowContent, rect.y, rect.y + reachY, 1, rect.y + rect.h - 1);
    const bottom = scan(rowContent, rect.y + rect.h - 1, rect.y + rect.h - reachY, -1, rect.y);
    const nextLeft = left ?? rect.x;
    const nextRight = right ?? rect.x + rect.w - 1;
    const nextTop = top ?? rect.y;
    const nextBottom = bottom ?? rect.y + rect.h - 1;
    const trimmed = {
      x: nextLeft,
      y: nextTop,
      w: nextRight - nextLeft + 1,
      h: nextBottom - nextTop + 1
    };
    if (trimmed.w < rect.w * 0.35 || trimmed.h < rect.h * 0.35) return rect;
    return trimmed;
  }

  // 没有齿孔（裁切到单帧、或纸张留白扫描）时，用四周背景色把画面主体框出来。
  function detectContentFrame(analysis, options, format) {
    const { imageData, width, height } = analysis;
    const data = imageData.data;
    const samples = [];
    const ringX = Math.max(2, Math.round(width * 0.012));
    const ringY = Math.max(2, Math.round(height * 0.012));
    const stepX = Math.max(1, Math.floor(width / 240));
    const stepY = Math.max(1, Math.floor(height / 160));
    const push = (x, y) => {
      const offset = (y * width + x) * 4;
      samples.push({
        r: data[offset],
        g: data[offset + 1],
        b: data[offset + 2],
        l: data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722
      });
    };
    for (let x = 0; x < width; x += stepX) {
      for (let depth = 0; depth < ringY; depth += 1) {
        push(x, depth);
        push(x, height - 1 - depth);
      }
    }
    for (let y = 0; y < height; y += stepY) {
      for (let depth = 0; depth < ringX; depth += 1) {
        push(depth, y);
        push(width - 1 - depth, y);
      }
    }
    // 取偏暗的 30 分位作背景色：翻拍图两侧常有贯穿整高的亮条纹（背纸标记、
    // 扫描仪边缘），中位数会被拉高，把深色画面误判成背景。
    samples.sort((a, b) => a.l - b.l);
    const pick = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.3))] || { r: 0, g: 0, b: 0 };
    const background = { r: pick.r, g: pick.g, b: pick.b };
    const tolerance = Math.max(30, Math.min(70, Number(options.threshold || 20) + 16));
    const luma = new Float32Array(width * height);
    for (let i = 0, offset = 0; i < luma.length; i += 1, offset += 4) {
      luma[i] = data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722;
    }
    const mask = new Uint8Array(width * height);
    for (let i = 0, offset = 0; i < mask.length; i += 1, offset += 4) {
      const diff = Math.max(
        Math.abs(data[offset] - background.r),
        Math.abs(data[offset + 1] - background.g),
        Math.abs(data[offset + 2] - background.b)
      );
      // 深色画面（夜空、暗调背景）与纯黑片基颜色接近，但前者带纹理和渐变；
      // 用垂直梯度补一条判据，避免暗部画面被整体判成背景。
      const texture = i >= width ? Math.abs(luma[i] - luma[i - width]) : 0;
      mask[i] = diff > tolerance || texture > 7 ? 1 : 0;
    }
    const backgroundLuma = (background.r + background.g + background.b) / 3;
    // 行/列判据取"非背景像素占比"和"相对背景的亮度抬升"中的较大者：暗调画面
    // （夜空、阴影）整行都接近背景色，单看占比会漏掉，但亮度抬升仍可识别。
    const rowFraction = new Float32Array(height);
    for (let y = 0; y < height; y += 1) {
      let count = 0;
      let sum = 0;
      for (let x = 0; x < width; x += 1) {
        count += mask[y * width + x];
        sum += luma[y * width + x];
      }
      rowFraction[y] = Math.max(count / width, (sum / width - backgroundLuma) / 60);
    }
    const colFraction = new Float32Array(width);
    for (let x = 0; x < width; x += 1) {
      let count = 0;
      let sum = 0;
      for (let y = 0; y < height; y += 1) {
        count += mask[y * width + x];
        sum += luma[y * width + x];
      }
      colFraction[x] = Math.max(count / height, (sum / height - backgroundLuma) / 60);
    }
    // 画面内部的深阴影会让个别行/列短暂跌到阈值以下；容忍不超过 3% 的断点，
    // 避免同一画面被切成两段后只取到较长的一半。
    const longestRun = (fraction, minFraction, maxGap) => {
      let best = null;
      let start = -1;
      let gap = 0;
      for (let i = 0; i <= fraction.length; i += 1) {
        const on = i < fraction.length && fraction[i] >= minFraction;
        if (on) {
          if (start < 0) start = i;
          gap = 0;
          continue;
        }
        if (start < 0) continue;
        gap += 1;
        if (gap > maxGap || i === fraction.length) {
          const end = i - gap;
          if (end > start && (!best || end - start > best.end - best.start)) best = { start, end };
          start = -1;
          gap = 0;
        }
      }
      return best;
    };
    const rows = longestRun(rowFraction, 0.15, Math.round(height * 0.03));
    const cols = longestRun(colFraction, 0.15, Math.round(width * 0.03));
    if (!rows || !cols) return null;
    let rect = { x: cols.start, y: rows.start, w: cols.end - cols.start, h: rows.end - rows.start };
    if (rect.w < width * 0.2 || rect.h < height * 0.2) return null;
    const aspect = rect.w / rect.h;
    if (aspect < 0.5 || aspect > 2.8) return null;
    rect = extendRectToFormat(analysis, rect, format, backgroundLuma);
    let inside = 0;
    let sampled = 0;
    for (let y = rect.y; y < rect.y + rect.h; y += 3) {
      for (let x = rect.x; x < rect.x + rect.w; x += 3) {
        sampled += 1;
        inside += mask[y * width + x];
      }
    }
    if (inside / Math.max(1, sampled) < 0.25) return null;
    rect = trimNoContentEdges(
      analysis,
      rect,
      Math.round((background.r + background.g + background.b) / 3),
      Boolean(format)
    );
    return {
      rect,
      area: (rect.w * rect.h) / (width * height)
    };
  }

  // 判断多框结果是否构成一条连贯的胶片条。若各框尺寸、横跨位置明显不一致，
  // 多半是画面暗部被误判成画框，不足以压过整幅内容框。
  function isCoherentStrip(frames, orientation, imageArea, format) {
    if (!Array.isArray(frames) || frames.length < 2) return false;
    const horizontal = orientation !== "vertical";
    const alongSizes = frames.map((frame) => (horizontal ? frame.w : frame.h));
    const crossSizes = frames.map((frame) => (horizontal ? frame.h : frame.w));
    const crossCenters = frames.map((frame) => (horizontal ? frame.y + frame.h / 2 : frame.x + frame.w / 2));
    const stat = (values) => {
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      if (!mean) return { mean: 0, cv: 1 };
      const variance = values.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / values.length;
      return { mean, cv: Math.sqrt(variance) / mean };
    };
    const along = stat(alongSizes);
    const cross = stat(crossSizes);
    const centerSpread = Math.max(...crossCenters) - Math.min(...crossCenters);
    const aspectOk = format
      ? frames.every((frame) => formatAspectDeviation(frame, format) <= 0.35)
      : frames.every((frame) => {
        const ratio = Math.max(frame.w, frame.h) / Math.max(1, Math.min(frame.w, frame.h));
        return ratio >= 1.05 && ratio <= 1.95;
      });
    const coverage = frames.reduce((sum, frame) => sum + frame.w * frame.h, 0) / imageArea;
    return (
      aspectOk &&
      along.cv < 0.16 &&
      cross.cv < 0.16 &&
      centerSpread <= cross.mean * 0.3 &&
      coverage >= 0.35
    );
  }

  // 片边预留比例：135 片基宽 35mm、画格横向 24mm；120 片基宽 61.5mm、画格横向 56mm。
  const FILM_BORDER_MODELS = {
    sprocket: { crossMm: 24, filmMm: 35, alongRatio: 0.03 },
    "120": { crossMm: 56, filmMm: 61.5, alongRatio: 0.05 }
  };

  // 向外扩出的一条带子是否仍属于胶片：片基偏暗（允许齿孔亮块），
  // 而不是扫描白底或纸张，避免紧裁切图被扩出一圈白边。
  function isFilmBorderBand(analysis, axis, from, to, alongStart, alongEnd) {
    const { imageData, width } = analysis;
    const data = imageData.data;
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    if (hi - lo < 1) return false;
    const alongSpan = Math.max(1, alongEnd - alongStart);
    const step = Math.max(1, Math.round(alongSpan / 80));
    let total = 0;
    let bright = 0;
    let dark = 0;
    for (let pos = Math.round(lo); pos < hi; pos += 1) {
      for (let along = Math.round(alongStart); along < alongEnd; along += step) {
        const x = axis === "x" ? pos : along;
        const y = axis === "x" ? along : pos;
        const offset = (y * width + x) * 4;
        const luma = data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722;
        total += 1;
        if (luma >= 200) bright += 1;
        else if (luma <= 90) dark += 1;
      }
    }
    if (!total) return false;
    return bright / total <= 0.55 && dark / total >= 0.12;
  }

  // 沿单一方向逐段试探，直到超出片基或达到该方向的预留上限。
  function probeFilmPad(analysis, axis, edge, direction, maxPad, alongStart, alongEnd) {
    if (maxPad <= 0) return 0;
    const size = axis === "x" ? analysis.width : analysis.height;
    const step = Math.max(2, Math.round(Math.abs(alongEnd - alongStart) * 0.04));
    let pos = edge;
    while (Math.abs(pos - edge) + step <= maxPad) {
      const next = pos + direction * step;
      if (next < 0 || next > size) break;
      if (!isFilmBorderBand(analysis, axis, pos, next, alongStart, alongEnd)) break;
      pos = next;
      if (direction < 0 ? pos <= 0 : pos >= size) break;
    }
    return Math.abs(pos - edge);
  }

  const medianPad = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] || 0;
  };

  // 保留片边模式：把每个画格沿片条宽度方向扩到整条胶片，露出齿孔与片边，
  // 同时统一各画格输出尺寸，避免成片大小不一。
  function getFramesLayoutAxis(frames) {
    let spreadX = 0;
    let spreadY = 0;
    for (let i = 0; i < frames.length; i += 1) {
      for (let j = i + 1; j < frames.length; j += 1) {
        const first = frames[i];
        const second = frames[j];
        spreadX = Math.max(spreadX, Math.abs((first.x + first.w / 2) - (second.x + second.w / 2)));
        spreadY = Math.max(spreadY, Math.abs((first.y + first.h / 2) - (second.y + second.h / 2)));
      }
    }
    return spreadX >= spreadY ? "horizontal" : "vertical";
  }

  function getMinFrameStep(frames, axis) {
    if (frames.length < 2) return 0;
    const centers = frames
      .map((frame) => (axis === "horizontal" ? frame.x + frame.w / 2 : frame.y + frame.h / 2))
      .sort((a, b) => a - b);
    let step = Infinity;
    for (let index = 1; index < centers.length; index += 1) {
      const delta = centers[index] - centers[index - 1];
      if (delta > 1) step = Math.min(step, delta);
    }
    return Number.isFinite(step) ? Math.floor(step) : 0;
  }

  function expandFramesToFilmBorder(frames, analysis, options, result) {
    if (!frames.length) return frames;
    const format = FILM_FORMATS[options.filmFormat] || null;
    const model = !format || format.sprockets ? FILM_BORDER_MODELS.sprocket : FILM_BORDER_MODELS["120"];
    const crossRatio = model.filmMm / model.crossMm - 1;
    const boundsW = analysis.width;
    const boundsH = analysis.height;
    // 片宽（齿孔）方向由画格的实际排布决定：画格沿 x 展开说明片条横向走，
    // 齿孔在上下（片宽方向是 y），反之亦然。检测结果里的 orientation 语义
    // 在不同检测器间不一致，直接用几何排布更可靠。
    const layoutAxis = frames.length > 1 ? getFramesLayoutAxis(frames) : null;
    const pads = frames.map((frame) => {
      const crossIsX = layoutAxis
        ? layoutAxis === "vertical"
        : result && result.orientation
          ? result.orientation === "vertical"
          : frame.w <= frame.h;
      const crossSize = crossIsX ? frame.w : frame.h;
      const alongSize = crossIsX ? frame.h : frame.w;
      const crossPad = (crossSize * crossRatio) / 2;
      const alongPad = (alongSize * model.alongRatio) / 2;
      const padX = crossIsX ? crossPad : alongPad;
      const padY = crossIsX ? alongPad : crossPad;
      return {
        left: probeFilmPad(analysis, "x", frame.x, -1, padX, frame.y, frame.y + frame.h),
        right: probeFilmPad(analysis, "x", frame.x + frame.w, 1, padX, frame.y, frame.y + frame.h),
        top: probeFilmPad(analysis, "y", frame.y, -1, padY, frame.x, frame.x + frame.w),
        bottom: probeFilmPad(analysis, "y", frame.y + frame.h, 1, padY, frame.x, frame.x + frame.w)
      };
    });
    // 同一条片上的画格共用片边位置，取中位数统一扩边，避免个别画格多扩出白边。
    const shared = {
      left: medianPad(pads.map((pad) => pad.left)),
      right: medianPad(pads.map((pad) => pad.right)),
      top: medianPad(pads.map((pad) => pad.top)),
      bottom: medianPad(pads.map((pad) => pad.bottom))
    };
    const expanded = frames.map((frame) => {
      const left = Math.max(0, frame.x - shared.left);
      const top = Math.max(0, frame.y - shared.top);
      const right = Math.min(boundsW, frame.x + frame.w + shared.right);
      const bottom = Math.min(boundsH, frame.y + frame.h + shared.bottom);
      return { x: left, y: top, w: right - left, h: bottom - top };
    });
    let outW = Math.max(1, Math.min(boundsW, Math.round(Math.max(...expanded.map((frame) => frame.w)))));
    let outH = Math.max(1, Math.min(boundsH, Math.round(Math.max(...expanded.map((frame) => frame.h)))));
    // 统一尺寸后不能超过相邻画格的中心距，否则沿片条方向会互相覆盖。
    if (layoutAxis) {
      const step = getMinFrameStep(frames, layoutAxis);
      if (step > 0) {
        if (layoutAxis === "horizontal") outW = Math.min(outW, step);
        else outH = Math.min(outH, step);
      }
    }
    return expanded.map((frame, index) => {
      const centerX = frame.x + frame.w / 2;
      const centerY = frame.y + frame.h / 2;
      const x = clamp(Math.round(centerX - outW / 2), 0, Math.max(0, boundsW - outW));
      const y = clamp(Math.round(centerY - outH / 2), 0, Math.max(0, boundsH - outH));
      return { ...frames[index], x, y, w: outW, h: outH };
    });
  }

  // 用户明确选择画幅时，画格比例与格数是强约束：暗部画格容易在掩膜检测中
  // 漏检或只框住局部，导致整卷少一格、个别画格尺寸异常。扫描件的像素尺寸
  // 与 36×24 毫米并不等价（可能是 2700×1800 等），因此画格像素尺寸以已识别
  // 画格的中位宽高为准，画幅比例只用于校验扫描件比例与推算格数。
  function refineFramesWithExplicitFormat(result, analysis, options) {
    const format = FILM_FORMATS[options.filmFormat];
    if (!format || options.cropScope !== "frame" || !result || !result.frames.length) return result;
    const frames = result.frames;
    const union = frames.reduce((box, frame) => ({
      x0: Math.min(box.x0, frame.x),
      y0: Math.min(box.y0, frame.y),
      x1: Math.max(box.x1, frame.x + frame.w),
      y1: Math.max(box.y1, frame.y + frame.h)
    }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
    const horizontal = union.x1 - union.x0 >= union.y1 - union.y0;
    const alongStart = horizontal ? union.x0 : union.y0;
    const alongEnd = horizontal ? union.x1 : union.y1;
    const span = alongEnd - alongStart;
    if (span < 24) return result;

    const middle = (values) => values.slice().sort((a, b) => a - b)[Math.floor((values.length - 1) / 2)];
    const median = middle(frames.map((frame) => (horizontal ? frame.w : frame.h)));
    const medianCross = middle(frames.map((frame) => (horizontal ? frame.h : frame.w)));
    if (!median || !medianCross) return result;

    // 扫描件的画格比例应接近所选画幅，偏差过大说明画幅与画面不符，不做强约束。
    if (Math.abs(median / medianCross / format.aspect - 1) > 0.2) return result;
    const count = Math.round(span / median);
    if (count < 2 || count > 12 || span < median) return result;
    const step = span / count;
    if (Math.abs(step / median - 1) > 0.25) return result;

    // 首尾画格可能被扫描截断而天然偏窄，保持原框，避免强行拉齐时吞进相邻画面。
    const edgeFrame = (first) => {
      const target = first ? alongStart : alongEnd;
      return frames
        .filter((frame) => {
          const start = horizontal ? frame.x : frame.y;
          const end = start + (horizontal ? frame.w : frame.h);
          return Math.abs((first ? start : end) - target) <= step * 0.25;
        })
        .sort((a, b) => (horizontal ? a.w : a.h) - (horizontal ? b.w : b.h))[0] || null;
    };
    const truncated = (frame) => frame && (horizontal ? frame.w : frame.h) < median * 0.9;
    const firstEdge = truncated(edgeFrame(true)) ? edgeFrame(true) : null;
    const lastEdge = truncated(edgeFrame(false)) ? edgeFrame(false) : null;

    const deviated = frames.length !== count || frames.some((frame) => (
      Math.abs((horizontal ? frame.w : frame.h) / median - 1) > 0.08
      || Math.abs((horizontal ? frame.h : frame.w) / medianCross - 1) > 0.08
    ));
    if (!deviated) return result;

    const crossStart = middle(frames.map((frame) => (horizontal ? frame.y : frame.x)));
    const inset = Math.round(options.inset / Math.max(state.scaleX, 0.001));
    const rebuilt = [];
    for (let index = 0; index < count; index += 1) {
      const preserved = (index === 0 && firstEdge) || (index === count - 1 && lastEdge) || null;
      let adjusted;
      if (preserved) {
        adjusted = { x: preserved.x, y: preserved.y, w: preserved.w, h: preserved.h };
      } else {
        let start = alongStart + step * index + (step - median) / 2;
        if (index === 0) start = alongStart;
        if (index === count - 1) start = alongEnd - median;
        start = clamp(start, alongStart, alongEnd - median);
        const rect = horizontal
          ? { x: start, y: crossStart, w: median, h: medianCross }
          : { x: crossStart, y: start, w: medianCross, h: median };
        adjusted = insetRect(rect, inset, analysis.width, analysis.height);
      }
      if (!isUsableFrame(adjusted, analysis)) continue;
      rebuilt.push({ ...adjusted, stripIndex: 0 });
    }
    if (!rebuilt.length) return result;
    return {
      ...result,
      frames: rebuilt,
      stripCount: 1,
      stripFrameCounts: [rebuilt.length],
      edgeFrameCount: 0
    };
  }

  function runDetection(analysis, options) {
    const cropped = cropWhiteMargins(analysis);
    let result = detectOnAnalysis(cropped.analysis, options);
    result = refineFramesWithExplicitFormat(result, cropped.analysis, options);
    if (result && options && options.cropScope === "sprocket") {
      result.frames = expandFramesToFilmBorder(result.frames, cropped.analysis, options, result);
    }
    if (result && (cropped.offsetX || cropped.offsetY)) {
      result.frames = result.frames.map((frame) => ({
        ...frame,
        x: frame.x + cropped.offsetX,
        y: frame.y + cropped.offsetY
      }));
    }
    return result;
  }

  function detectOnAnalysis(analysis, options) {
    const requestedMode = options.sourceMode || "auto";
    const format = FILM_FORMATS[options.filmFormat] || null;
    // 120 系画幅没有齿孔，直接跳过齿孔检测，避免画面内容被误认成齿孔带。
    if (requestedMode === "auto" && (!format || format.sprockets)) {
      const sprocketResult = detectSprocketFrames(analysis, options, format);
      if (sprocketResult) return sprocketResult;
    }
    let positiveResult = null;
    if (requestedMode !== "negative") {
      const blackMask = createBlackMask(analysis.imageData.data, analysis.width, analysis.height, options.threshold);
      const foregroundMask = createForegroundMask(analysis.imageData.data, analysis.width, analysis.height);
      positiveResult = runDetectionWithMasks(analysis, options, blackMask, foregroundMask);
      Object.assign(positiveResult, {
        detectionMode: "positive",
        filmBase: null,
        filmBaseConfidence: null,
        filmBaseSource: null
      });
      if (requestedMode === "positive") return positiveResult;
    }

    const candidates = options.filmBase
      ? [{ ...options.filmBase, source: "manual", weight: Number.MAX_SAFE_INTEGER }]
      : findFilmBaseCandidates(analysis.imageData.data, analysis.width, analysis.height);
    const adaptiveForeground = createAdaptiveForegroundMask(
      analysis.imageData.data,
      analysis.width,
      analysis.height
    );
    const negativeResults = candidates.map((candidate) => {
      const baseMask = createFilmBaseMask(
        analysis.imageData.data,
        analysis.width,
        analysis.height,
        candidate,
        options.threshold
      );
      const result = runDetectionWithMasks(analysis, options, baseMask, adaptiveForeground);
      return { candidate, result, score: scoreResult(result, analysis) };
    }).sort((a, b) => b.score - a.score);
    const bestNegative = negativeResults[0];
    if (!bestNegative) return positiveResult;
    const nextScore = negativeResults[1]?.score || 0;
    const confidence = bestNegative.candidate.source === "manual"
      ? 100
      : Math.round(clamp(48 + (bestNegative.score - nextScore) * 3, 48, 96));
    Object.assign(bestNegative.result, {
      detectionMode: "negative",
      filmBase: {
        r: Math.round(bestNegative.candidate.r),
        g: Math.round(bestNegative.candidate.g),
        b: Math.round(bestNegative.candidate.b)
      },
      filmBaseConfidence: confidence,
      filmBaseSource: bestNegative.candidate.source || "auto"
    });

    if (requestedMode === "negative") return bestNegative.result;
    const positiveScore = positiveResult ? scoreResult(positiveResult, analysis) : 0;
    const legacyResult = bestNegative.score > positiveScore * 1.08 + 2 ? bestNegative.result : positiveResult;
    if (requestedMode !== "auto" || !legacyResult) return legacyResult;
    const contentFrame = detectContentFrame(analysis, options, format);
    if (!contentFrame) return legacyResult;
    const imageArea = analysis.width * analysis.height;
    const legacyArea = legacyResult.frames.reduce((best, frame) => Math.max(best, frame.w * frame.h), 0) / imageArea;
    // 远小于主画格的碎框（多为片边/齿孔/画面暗部误检）剔除，避免多框结果被误认为胶片条。
    if (legacyResult.frames.length > 1) {
      const kept = legacyResult.frames.filter((frame) => frame.w * frame.h >= legacyArea * imageArea * 0.1);
      if (kept.length && kept.length !== legacyResult.frames.length) {
        const groups = [];
        for (const frame of kept) {
          const key = frame.stripIndex ?? 0;
          let group = groups.find((entry) => entry.key === key);
          if (!group) {
            group = { key, frames: [] };
            groups.push(group);
          }
          group.frames.push(frame);
        }
        const counts = [];
        for (const group of groups) {
          const index = counts.length;
          counts.push(group.frames.length);
          for (const frame of group.frames) frame.stripIndex = index;
        }
        legacyResult.frames = kept;
        legacyResult.stripCount = counts.length;
        legacyResult.stripFrameCounts = counts;
      }
    }
    const coherentStrip = isCoherentStrip(legacyResult.frames, legacyResult.orientation, imageArea, format);
    if (coherentStrip || contentFrame.area <= Math.max(0.14, legacyArea * 1.15)) return legacyResult;
    return {
      frames: [contentFrame.rect],
      stripCount: 1,
      stripFrameCounts: [1],
      orientation: contentFrame.rect.w >= contentFrame.rect.h ? "horizontal" : "vertical",
      layoutStrength: 0.5,
      detectionMode: "positive",
      detector: "content",
      filmBase: null,
      filmBaseConfidence: null,
      filmBaseSource: null
    };
  }

  function runDetectionWithMasks(analysis, options, mask, foregroundMask) {
    const shared = { ...analysis, mask, foregroundMask, options };

    if (options.orientation === "vertical") return detectByOrientation(shared, "vertical");
    if (options.orientation === "horizontal") return detectByOrientation(shared, "horizontal");

    const vertical = detectByOrientation(shared, "vertical");
    const horizontal = detectByOrientation(shared, "horizontal");
    return scoreResult(vertical, analysis) >= scoreResult(horizontal, analysis) ? vertical : horizontal;
  }

  function findFilmBaseCandidates(data, width, height, maximumCandidates = 10) {
    const bins = new Map();
    const step = Math.max(1, Math.ceil(Math.sqrt((width * height) / 70000)));
    const neighbor = Math.max(1, step * 2);

    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const offset = (y * width + x) * 4;
        if (data[offset + 3] < 240) continue;
        const nextX = Math.min(width - 1, x + neighbor);
        const nextY = Math.min(height - 1, y + neighbor);
        const rightOffset = (y * width + nextX) * 4;
        const downOffset = (nextY * width + x) * 4;
        const variation = (
          Math.abs(data[offset] - data[rightOffset])
          + Math.abs(data[offset + 1] - data[rightOffset + 1])
          + Math.abs(data[offset + 2] - data[rightOffset + 2])
          + Math.abs(data[offset] - data[downOffset])
          + Math.abs(data[offset + 1] - data[downOffset + 1])
          + Math.abs(data[offset + 2] - data[downOffset + 2])
        ) / 6;
        if (variation > 24) continue;
        const key = `${data[offset] >> 5}-${data[offset + 1] >> 5}-${data[offset + 2] >> 5}`;
        const bin = bins.get(key) || { count: 0, r: 0, g: 0, b: 0 };
        bin.count += 1;
        bin.r += data[offset];
        bin.g += data[offset + 1];
        bin.b += data[offset + 2];
        bins.set(key, bin);
      }
    }

    const all = Array.from(bins.values(), (bin) => ({
      r: bin.r / bin.count,
      g: bin.g / bin.count,
      b: bin.b / bin.count,
      weight: bin.count,
      source: "auto"
    }));
    if (!all.length) return [{ r: 245, g: 245, b: 245, weight: 1, source: "auto" }];
    const byWeight = [...all].sort((a, b) => b.weight - a.weight);
    const byLuminance = [...all].sort((a, b) => colorLuminance(a) - colorLuminance(b));
    const pool = [
      ...byWeight.slice(0, Math.max(maximumCandidates, 14)),
      ...byLuminance.slice(0, 2),
      ...byLuminance.slice(-2)
    ];
    const candidates = [];
    for (const candidate of pool) {
      const duplicate = candidates.some((other) => colorDistance(candidate, other) < 24);
      if (!duplicate) candidates.push(candidate);
      if (candidates.length >= maximumCandidates) break;
    }
    return candidates;
  }

  function createFilmBaseMask(data, width, height, base, threshold) {
    const mask = new Uint8Array(width * height);
    const tolerance = 0.76 + clamp((Number(threshold) - 18) / 92, 0, 1) * 1.2;
    const redScale = Math.max(18, base.r * 0.12);
    const greenScale = Math.max(18, base.g * 0.12);
    const blueScale = Math.max(18, base.b * 0.12);
    for (let pixel = 0, offset = 0; pixel < mask.length; pixel += 1, offset += 4) {
      const red = (data[offset] - base.r) / redScale;
      const green = (data[offset + 1] - base.g) / greenScale;
      const blue = (data[offset + 2] - base.b) / blueScale;
      const distance = Math.sqrt((red * red + green * green + blue * blue) / 3);
      mask[pixel] = data[offset + 3] >= 24 && distance <= tolerance ? 1 : 0;
    }
    return mask;
  }

  function createAdaptiveForegroundMask(data, width, height) {
    const background = sampleBoundaryBackground(data, width, height);
    const mask = new Uint8Array(width * height);
    const tolerance = Math.max(30, Math.min(58, background.spread * 2.6));
    for (let pixel = 0, offset = 0; pixel < mask.length; pixel += 1, offset += 4) {
      if (data[offset + 3] < 24) continue;
      const distance = colorDistance(
        { r: data[offset], g: data[offset + 1], b: data[offset + 2] },
        background
      );
      mask[pixel] = distance > tolerance ? 1 : 0;
    }
    return mask;
  }

  function sampleBoundaryBackground(data, width, height) {
    const samples = [];
    const inset = Math.max(0, Math.round(Math.min(width, height) * 0.008));
    const step = Math.max(1, Math.round(Math.max(width, height) / 500));
    for (let x = 0; x < width; x += step) {
      samples.push(readRgb(data, width, x, inset), readRgb(data, width, x, height - 1 - inset));
    }
    for (let y = 0; y < height; y += step) {
      samples.push(readRgb(data, width, inset, y), readRgb(data, width, width - 1 - inset, y));
    }
    const bins = new Map();
    samples.forEach((color) => {
      const key = `${color.r >> 5}-${color.g >> 5}-${color.b >> 5}`;
      const bin = bins.get(key) || { count: 0, colors: [] };
      bin.count += 1;
      bin.colors.push(color);
      bins.set(key, bin);
    });
    const dominant = Array.from(bins.values()).sort((a, b) => b.count - a.count)[0];
    const r = median(dominant.colors.map((color) => color.r));
    const g = median(dominant.colors.map((color) => color.g));
    const b = median(dominant.colors.map((color) => color.b));
    const distances = dominant.colors.map((color) => colorDistance(color, { r, g, b }));
    return { r, g, b, spread: median(distances) || 12 };
  }

  function readRgb(data, width, x, y) {
    const offset = (y * width + x) * 4;
    return { r: data[offset], g: data[offset + 1], b: data[offset + 2] };
  }

  function colorLuminance(color) {
    return color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
  }

  function colorDistance(first, second) {
    const red = first.r - second.r;
    const green = first.g - second.g;
    const blue = first.b - second.b;
    return Math.sqrt(red * red + green * green + blue * blue);
  }

  function median(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function createBlackMask(data, width, height, threshold) {
    const mask = new Uint8Array(width * height);
    for (let pixel = 0, offset = 0; pixel < mask.length; pixel += 1, offset += 4) {
      const luminance = data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722;
      mask[pixel] = luminance <= threshold ? 1 : 0;
    }
    return mask;
  }

  function createForegroundMask(data, width, height) {
    const mask = new Uint8Array(width * height);
    for (let pixel = 0, offset = 0; pixel < mask.length; pixel += 1, offset += 4) {
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      const alpha = data[offset + 3];
      const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
      const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
      const isPaper = alpha < 24 || (luminance >= 238 && chroma <= 20);
      mask[pixel] = isPaper ? 0 : 1;
    }
    return mask;
  }

  function detectByOrientation(context, orientation) {
    const vertical = orientation === "vertical";
    const crossLength = vertical ? context.width : context.height;
    const alongLength = vertical ? context.height : context.width;
    const railProfile = getProfile(context.mask, context.width, context.height, vertical ? "x" : "y");
    const smoothedRails = smoothProfile(railProfile, Math.max(1, Math.round(crossLength * 0.0015)));
    const railRuns = findRuns(smoothedRails, Math.max(0.36, context.options.coverage - 0.16), Math.max(2, Math.round(crossLength * 0.002)));
    const pairedStrips = pairRailRuns(railRuns, crossLength, alongLength, context, orientation);
    const foregroundProfile = getProfile(context.foregroundMask, context.width, context.height, vertical ? "x" : "y");
    const smoothedForegroundProfile = smoothProfile(
      foregroundProfile,
      Math.max(1, Math.round(crossLength * 0.004))
    );
    const foregroundRuns = findRuns(
      smoothedForegroundProfile,
      0.14,
      Math.max(8, Math.round(crossLength * 0.025))
    );
    const recoveredStrips = recoverStripsFromForeground(
      foregroundRuns,
      railRuns,
      crossLength,
      alongLength,
      context,
      orientation
    );
    const inferredStrips = recoverMissingOuterStrips(
      pairedStrips,
      railRuns,
      smoothedForegroundProfile,
      crossLength,
      alongLength,
      context,
      orientation
    );
    const strips = mergeStripCandidates([...pairedStrips, ...inferredStrips, ...recoveredStrips]);
    const frames = [];
    const stripFrameCounts = [];
    let edgeFrameCount = 0;

    for (const strip of strips) {
      const dividerProfile = getStripDividerProfile(context.mask, context.width, context.height, strip, orientation);
      const edgeProfile = getStripDividerProfile(context.foregroundMask, context.width, context.height, strip, orientation);
      const smoothSize = Math.max(1, Math.round(alongLength * 0.001));
      const coarseDividerRuns = findRuns(
        smoothProfile(dividerProfile, smoothSize),
        Math.max(0.54, context.options.coverage - (strip.source !== "rails" ? 0.06 : 0)),
        Math.max(2, Math.round(alongLength * 0.002))
      );
      const dividerRuns = mergeDividerRuns(
        coarseDividerRuns,
        findThinDividerRuns(dividerProfile, alongLength)
      );
      const detectedIntervals = gapsBetweenRuns(dividerRuns, alongLength, strip.end - strip.start);
      // 扫描件的分隔线常与画面暗部粘连，或被平滑抹掉，造成漏格与画格偏窄。
      // 同一卷胶片上的画格是等距排列的，用画幅长宽比拟合等距网格校正这类结果。
      const gridIntervals = fitUniformFrameGrid(dividerRuns, detectedIntervals, strip, alongLength, context);
      const intervals = gridIntervals || detectedIntervals;
      let stripFrameCount = 0;

      for (const interval of intervals) {
        const edgeAwareInterval = trimUnboundedInterval(interval, edgeProfile, strip.end - strip.start);
        const rect = vertical
          ? { x: strip.start, y: edgeAwareInterval.start, w: strip.end - strip.start, h: edgeAwareInterval.end - edgeAwareInterval.start }
          : { x: edgeAwareInterval.start, y: strip.start, w: edgeAwareInterval.end - edgeAwareInterval.start, h: strip.end - strip.start };
        const inset = Math.round(context.options.inset / Math.max(state.scaleX, 0.001));
        const adjusted = insetRect(rect, inset, context.width, context.height);
        if (isUsableFrame(adjusted, context)) {
          frames.push({ ...adjusted, stripIndex: stripFrameCounts.length });
          stripFrameCount += 1;
          if (!interval.startBounded || !interval.endBounded) edgeFrameCount += 1;
        }
      }
      stripFrameCounts.push(stripFrameCount);
    }

    const cleanFrames = normalizeFrameGrid(dedupeAndSort(frames), orientation, context);
    const activeStrips = strips.filter((strip, index) => stripFrameCounts[index] > 0);
    const activeStripFrameCounts = stripFrameCounts.filter((count) => count > 0);
    const averageStripWidth = activeStrips.length
      ? activeStrips.reduce((sum, strip) => sum + strip.end - strip.start, 0) / activeStrips.length
      : crossLength;
    return {
      frames: cleanFrames,
      stripCount: activeStrips.length,
      stripFrameCounts: activeStripFrameCounts,
      recoveredStripCount: activeStrips.filter((strip) => strip.source !== "rails").length,
      edgeFrameCount,
      layoutStrength: alongLength / Math.max(1, averageStripWidth),
      orientation
    };
  }

  function getProfile(mask, width, height, axis) {
    if (axis === "x") {
      const profile = new Float32Array(width);
      const step = Math.max(1, Math.floor(height / 900));
      const sampleCount = Math.ceil(height / step);
      for (let x = 0; x < width; x += 1) {
        let black = 0;
        for (let y = 0; y < height; y += step) black += mask[y * width + x];
        profile[x] = black / sampleCount;
      }
      return profile;
    }

    const profile = new Float32Array(height);
    const step = Math.max(1, Math.floor(width / 900));
    const sampleCount = Math.ceil(width / step);
    for (let y = 0; y < height; y += 1) {
      let black = 0;
      const row = y * width;
      for (let x = 0; x < width; x += step) black += mask[row + x];
      profile[y] = black / sampleCount;
    }
    return profile;
  }

  function getStripDividerProfile(mask, width, height, strip, orientation) {
    const vertical = orientation === "vertical";
    const length = vertical ? height : width;
    const crossStart = Math.max(0, Math.floor(strip.start));
    const crossEnd = Math.min(vertical ? width : height, Math.ceil(strip.end));
    const crossStep = Math.max(1, Math.floor((crossEnd - crossStart) / 500));
    const samples = Math.max(1, Math.ceil((crossEnd - crossStart) / crossStep));
    const profile = new Float32Array(length);

    for (let along = 0; along < length; along += 1) {
      let black = 0;
      for (let cross = crossStart; cross < crossEnd; cross += crossStep) {
        const x = vertical ? cross : along;
        const y = vertical ? along : cross;
        black += mask[y * width + x];
      }
      profile[along] = black / samples;
    }
    return profile;
  }

  function smoothProfile(profile, radius) {
    if (radius <= 0) return profile;
    const result = new Float32Array(profile.length);
    let sum = 0;
    let left = 0;
    let right = 0;
    while (right < profile.length && right <= radius) sum += profile[right++];
    for (let i = 0; i < profile.length; i += 1) {
      result[i] = sum / Math.max(1, right - left);
      const nextRight = i + radius + 1;
      const nextLeft = i - radius;
      if (nextRight < profile.length) { sum += profile[nextRight]; right = nextRight + 1; }
      if (nextLeft >= 0) { sum -= profile[nextLeft]; left = nextLeft + 1; }
    }
    return result;
  }

  function findRuns(profile, threshold, minLength) {
    const runs = [];
    let start = -1;
    let peak = 0;
    let total = 0;

    for (let i = 0; i <= profile.length; i += 1) {
      const value = i < profile.length ? profile[i] : 0;
      if (value >= threshold) {
        if (start < 0) { start = i; peak = value; total = value; }
        else { peak = Math.max(peak, value); total += value; }
      } else if (start >= 0) {
        const length = i - start;
        if (length >= minLength) runs.push({ start, end: i, peak, mean: total / length });
        start = -1;
      }
    }
    return mergeNearbyRuns(runs, Math.max(2, minLength));
  }

  // 高分辨率扫描图里画格之间的分隔常常只有 1–3 个分析像素宽。常规检测的
  // 平滑半径和最小长度会把这类窄分隔抹掉，造成漏帧、画格尺寸不一致。
  // 这里用弱平滑 + 高黑边覆盖率 + 窄宽度限制再找一次，作为常规检测的补充。
  function findThinDividerRuns(profile, alongLength) {
    const smoothed = smoothProfile(profile, 1);
    const threshold = 0.8;
    const maxLength = Math.max(3, Math.round(alongLength * 0.006));
    const sideWidth = Math.max(2, Math.round(alongLength * 0.002));
    const runs = [];
    let start = -1;
    let peak = 0;

    for (let i = 0; i <= smoothed.length; i += 1) {
      const value = i < smoothed.length ? smoothed[i] : 0;
      if (value >= threshold) {
        if (start < 0) { start = i; peak = value; }
        else peak = Math.max(peak, value);
      } else if (start >= 0) {
        const length = i - start;
        if (length <= maxLength && isIsolatedDivider(smoothed, start, i, sideWidth)) {
          runs.push({ start, end: i, peak, mean: peak });
        }
        start = -1;
      }
    }
    return runs;
  }

  // 分隔两侧应当是明显更亮的画面内容，避免把照片内部的暗部当成分隔线。
  function isIsolatedDivider(profile, start, end, sideWidth) {
    if (start < sideWidth || end + sideWidth > profile.length) return false;
    const left = profileWindowMean(profile, start - sideWidth, sideWidth, 1);
    const right = profileWindowMean(profile, end, sideWidth, 1);
    return Math.max(left, right) < 0.6;
  }

  function mergeDividerRuns(primary, extra) {
    const merged = primary.map((run) => ({ ...run }));
    for (const run of extra) {
      const overlaps = merged.some((other) => run.start <= other.end + 2 && run.end >= other.start - 2);
      if (!overlaps) merged.push({ ...run });
    }
    return merged.sort((a, b) => a.start - b.start);
  }

  function mergeNearbyRuns(runs, maxGap) {
    const merged = [];
    for (const run of runs) {
      const previous = merged[merged.length - 1];
      if (previous && run.start - previous.end <= maxGap) {
        previous.end = run.end;
        previous.peak = Math.max(previous.peak, run.peak);
        previous.mean = (previous.mean + run.mean) / 2;
      } else {
        merged.push({ ...run });
      }
    }
    return merged;
  }

  function pairRailRuns(runs, crossLength, alongLength, context, orientation) {
    const strips = [];
    const minimumGap = Math.max(36, crossLength * 0.13);
    const maximumGap = crossLength * 0.72;
    for (let i = 0; i < runs.length - 1; i += 1) {
      const start = runs[i].end;
      const end = runs[i + 1].start;
      const gap = end - start;
      if (gap < minimumGap || gap > maximumGap) continue;

      const rect = orientation === "vertical"
        ? { x: start, y: 0, w: gap, h: alongLength }
        : { x: 0, y: start, w: alongLength, h: gap };
      const stats = sampleRectStats(rect, context);
      if (stats.stdDev > 11 && stats.whiteRatio < 0.91 && stats.blackRatio < 0.78) {
        strips.push({ start, end, strength: (runs[i].mean + runs[i + 1].mean) / 2, source: "rails" });
      }
    }
    return strips;
  }

  function recoverStripsFromForeground(runs, railRuns, crossLength, alongLength, context, orientation) {
    const strips = [];
    const minimumWidth = Math.max(34, crossLength * 0.1);
    const maximumWidth = crossLength * 0.72;

    for (const run of runs) {
      const bandWidth = run.end - run.start;
      if (bandWidth < minimumWidth || bandWidth > maximumWidth) continue;
      const edgeZone = Math.max(5, bandWidth * 0.22);
      const leftRail = nearestEdgeRail(railRuns, run.start, run.start + edgeZone, "left", bandWidth);
      const rightRail = nearestEdgeRail(railRuns, run.end - edgeZone, run.end, "right", bandWidth);
      const start = leftRail ? leftRail.end : run.start;
      const end = rightRail ? rightRail.start : run.end;
      if (end - start < minimumWidth * 0.72) continue;

      const rect = orientation === "vertical"
        ? { x: start, y: 0, w: end - start, h: alongLength }
        : { x: 0, y: start, w: alongLength, h: end - start };
      const stats = sampleRectStats(rect, context);
      if (stats.stdDev > 9 && stats.whiteRatio < 0.92 && stats.blackRatio < 0.8) {
        strips.push({ start, end, strength: run.mean * 0.8, source: "foreground" });
      }
    }
    return strips;
  }

  function recoverMissingOuterStrips(
    pairedStrips,
    railRuns,
    foregroundProfile,
    crossLength,
    alongLength,
    context,
    orientation
  ) {
    if (!pairedStrips.length) return [];
    const referenceWidths = pairedStrips
      .map((strip) => strip.end - strip.start)
      .sort((a, b) => a - b);
    const referenceWidth = referenceWidths[Math.floor(referenceWidths.length / 2)];
    const minimumWidth = Math.max(34, referenceWidth * 0.52, crossLength * 0.1);
    const maximumWidth = Math.min(crossLength * 0.72, referenceWidth * 1.38);
    const searchTolerance = Math.max(crossLength * 0.06, referenceWidth * 0.45);
    const inferred = [];

    for (const strip of pairedStrips) {
      const leftSharedRail = railRuns.find((rail) => Math.abs(rail.end - strip.start) <= 3);
      if (leftSharedRail) {
        const end = leftSharedRail.start;
        const expectedStart = end - referenceWidth;
        const start = findPhotoPaperBoundary(
          foregroundProfile,
          clamp(expectedStart - searchTolerance, 0, end),
          clamp(expectedStart + searchTolerance, 0, end),
          "rising"
        );
        if (start !== null) {
          addInferredStrip(inferred, start, end, minimumWidth, maximumWidth, alongLength, context, orientation);
        }
      }

      const rightSharedRail = railRuns.find((rail) => Math.abs(rail.start - strip.end) <= 3);
      if (rightSharedRail) {
        const start = rightSharedRail.end;
        const expectedEnd = start + referenceWidth;
        const end = findPhotoPaperBoundary(
          foregroundProfile,
          clamp(expectedEnd - searchTolerance, start, crossLength),
          clamp(expectedEnd + searchTolerance, start, crossLength),
          "falling"
        );
        if (end !== null) {
          addInferredStrip(inferred, start, end, minimumWidth, maximumWidth, alongLength, context, orientation);
        }
      }
    }
    return inferred;
  }

  function findPhotoPaperBoundary(profile, rawStart, rawEnd, direction) {
    const start = Math.max(0, Math.floor(Math.min(rawStart, rawEnd)));
    const end = Math.min(profile.length, Math.ceil(Math.max(rawStart, rawEnd)));
    if (end - start < 3) return null;
    const windowSize = Math.max(2, Math.round(profile.length * 0.004));
    let bestBoundary = null;
    let bestScore = 0;

    for (let position = start; position <= end; position += 1) {
      const before = profileWindowMean(profile, position - 1, windowSize, -1);
      const after = profileWindowMean(profile, position, windowSize, 1);
      const contrast = direction === "rising" ? after - before : before - after;
      const paperSide = direction === "rising" ? before : after;
      const photoSide = direction === "rising" ? after : before;
      if (paperSide <= 0.1 && photoSide >= 0.14 && contrast > bestScore) {
        bestBoundary = position;
        bestScore = contrast;
      }
    }

    if (bestBoundary !== null) return bestBoundary;
    if (direction === "rising" && start === 0 && profileWindowMean(profile, 0, windowSize, 1) >= 0.14) return 0;
    if (direction === "falling" && end === profile.length && profileWindowMean(profile, profile.length - 1, windowSize, -1) >= 0.14) {
      return profile.length;
    }
    return null;
  }

  function addInferredStrip(strips, start, end, minimumWidth, maximumWidth, alongLength, context, orientation) {
    const width = end - start;
    if (width < minimumWidth || width > maximumWidth) return;
    const rect = orientation === "vertical"
      ? { x: start, y: 0, w: width, h: alongLength }
      : { x: 0, y: start, w: alongLength, h: width };
    const stats = sampleRectStats(rect, context);
    if (stats.stdDev > 9 && stats.whiteRatio < 0.92 && stats.blackRatio < 0.8) {
      strips.push({ start, end, strength: stats.stdDev / 100, source: "inferred" });
    }
  }

  function nearestEdgeRail(railRuns, zoneStart, zoneEnd, side, bandWidth) {
    const candidates = railRuns.filter((rail) => {
      const midpoint = (rail.start + rail.end) / 2;
      const width = rail.end - rail.start;
      return midpoint >= zoneStart && midpoint <= zoneEnd && width <= Math.max(8, bandWidth * 0.18);
    });
    if (!candidates.length) return null;
    return candidates.sort((a, b) => {
      const distanceA = side === "left" ? Math.abs(a.start - zoneStart) : Math.abs(zoneEnd - a.end);
      const distanceB = side === "left" ? Math.abs(b.start - zoneStart) : Math.abs(zoneEnd - b.end);
      return distanceA - distanceB;
    })[0];
  }

  function mergeStripCandidates(strips) {
    const sourcePriority = { rails: 3, inferred: 2, foreground: 1 };
    const ordered = [...strips].sort((a, b) => {
      if (a.source !== b.source) return (sourcePriority[b.source] || 0) - (sourcePriority[a.source] || 0);
      return b.strength - a.strength;
    });
    const kept = [];
    for (const strip of ordered) {
      const duplicate = kept.some((other) => {
        const overlap = Math.max(0, Math.min(strip.end, other.end) - Math.max(strip.start, other.start));
        return overlap / Math.max(1, Math.min(strip.end - strip.start, other.end - other.start)) > 0.68;
      });
      if (!duplicate) kept.push(strip);
    }
    return kept.sort((a, b) => a.start - b.start);
  }

  function gapsBetweenRuns(runs, alongLength, crossSize) {
    const boundaries = [{ start: 0, end: 0 }, ...runs, { start: alongLength, end: alongLength }];
    const intervals = [];
    const minimumFrame = Math.max(34, crossSize * 0.34);
    const maximumFrame = Math.max(minimumFrame * 1.2, crossSize * 2.45);
    for (let i = 0; i < boundaries.length - 1; i += 1) {
      const start = boundaries[i].end;
      const end = boundaries[i + 1].start;
      const length = end - start;
      if (length >= minimumFrame && length <= maximumFrame) {
        intervals.push({
          start,
          end,
          startBounded: i > 0,
          endBounded: i < boundaries.length - 2
        });
      }
    }
    return intervals;
  }

  // 扫描件的分隔线常与画面暗部粘连，或被平滑抹掉，造成漏格与画格偏窄。
  // 同一卷胶片的画格是等距排列的，这里以图像首尾分隔线定出画面区域，
  // 枚举可能的画格数，选出与已检测分隔线吻合度最高的等距网格来校正边界。
  // 仅在原始结果明显不可靠（漏格或尺寸离散）时启用，避免破坏本已准确的结果。
  function fitUniformFrameGrid(dividerRuns, intervals, strip, alongLength, context) {
    if (intervals.length < 2) return null;
    const crossSize = strip.end - strip.start;
    if (crossSize <= 0) return null;

    const edgeTolerance = alongLength * 0.06;
    const firstDivider = dividerRuns[0];
    const lastDivider = dividerRuns[dividerRuns.length - 1];
    const areaStart = firstDivider && firstDivider.start <= edgeTolerance
      ? firstDivider.end
      : intervals[0].start;
    const areaEnd = lastDivider && lastDivider.end >= alongLength - edgeTolerance
      ? lastDivider.start
      : intervals[intervals.length - 1].end;
    const span = areaEnd - areaStart;
    if (span < crossSize * 0.8) return null;

    // 画格步长的参考值：画幅长宽比换算值 + 已检测区间尺寸的上四分位数
    // （剔除被粘连分隔线合并出的超长区间）。两者都存在时必须同时吻合，
    // 避免用户选错画幅时把一格画面强行切成多格。
    const format = FILM_FORMATS[context.options.filmFormat];
    const references = [];
    if (format) references.push(crossSize * format.aspect);
    const sizes = intervals
      .map((interval) => interval.end - interval.start)
      .filter((size) => size >= crossSize * 0.5 && size <= crossSize * 1.9)
      .sort((a, b) => a - b);
    if (sizes.length) references.push(sizes[Math.floor((sizes.length - 1) * 0.75)]);
    if (!references.length) references.push(crossSize * 1.5);

    let best = null;
    for (let count = 2; count <= 12; count += 1) {
      const step = span / count;
      if (step < 24) continue;
      if (references.some((reference) => Math.abs(step / reference - 1) > 0.22)) continue;
      const tolerance = step * 0.18;
      let matched = 0;
      let totalError = 0;
      for (let index = 1; index < count; index += 1) {
        const boundary = areaStart + step * index;
        const distance = nearestDividerDistance(dividerRuns, boundary);
        if (distance <= tolerance) {
          matched += 1;
          totalError += distance;
        }
      }
      if (matched < Math.min(2, count - 1)) continue;
      if (count - 1 - matched > (count <= 7 ? 1 : 2)) continue;
      const error = totalError / matched;
      if (!best || matched > best.matched || (matched === best.matched && error < best.error - 1e-6)) {
        best = { count, step, matched, error };
      }
    }
    if (!best) return null;

    // 原始结果格数正确时，只检查内部画格尺寸是否整齐。首尾画格可能因扫描
    // 截断而天然偏窄（如片尾的残缺画格），不能据此判定检测失败，否则会
    // 强行等分，反而把真实画面切坏。
    if (intervals.length === best.count) {
      const interior = intervals.slice(1, -1);
      if (!interior.length) return null;
      const sizes = interior.map((interval) => interval.end - interval.start);
      const minimum = Math.min(...sizes);
      const maximum = Math.max(...sizes);
      const jitter = (maximum - minimum) / Math.max(1, minimum);
      const drift = Math.max(...sizes.map((size) => Math.abs(size - best.step) / best.step));
      if (jitter <= 0.12 && drift <= 0.12) return null;
    }

    const fitted = [];
    for (let index = 0; index < best.count; index += 1) {
      const start = index === 0 ? areaStart : areaStart + best.step * index;
      const end = index === best.count - 1 ? areaEnd : areaStart + best.step * (index + 1);
      fitted.push({ start, end, startBounded: true, endBounded: true });
    }
    return fitted;
  }

  function nearestDividerDistance(runs, position) {
    let nearest = Infinity;
    for (const run of runs) {
      if (position >= run.start && position <= run.end) return 0;
      nearest = Math.min(nearest, Math.abs(position - run.start), Math.abs(position - run.end));
    }
    return nearest;
  }

  function trimUnboundedInterval(interval, foregroundProfile, crossSize) {
    let { start, end } = interval;
    const threshold = 0.12;
    const confirmation = Math.max(2, Math.round(crossSize * 0.012));
    const searchLimit = Math.max(
      confirmation,
      Math.min(48, Math.floor((end - start) * 0.18), Math.floor(crossSize * 0.18))
    );

    if (!interval.startBounded) {
      const limit = Math.min(end, start + searchLimit);
      for (let position = start; position < limit; position += 1) {
        if (profileWindowMean(foregroundProfile, position, confirmation, 1) >= threshold) {
          start = position;
          break;
        }
      }
    }

    if (!interval.endBounded) {
      const limit = Math.max(start, end - searchLimit);
      for (let position = end - 1; position >= limit; position -= 1) {
        if (profileWindowMean(foregroundProfile, position, confirmation, -1) >= threshold) {
          end = position + 1;
          break;
        }
      }
    }
    return { ...interval, start, end };
  }

  function profileWindowMean(profile, start, length, direction) {
    let total = 0;
    let count = 0;
    for (let offset = 0; offset < length; offset += 1) {
      const index = start + offset * direction;
      if (index < 0 || index >= profile.length) break;
      total += profile[index];
      count += 1;
    }
    return total / Math.max(1, count);
  }

  function sampleRectStats(rect, context) {
    const data = context.imageData.data;
    const stepX = Math.max(1, Math.floor(rect.w / 70));
    const stepY = Math.max(1, Math.floor(rect.h / 70));
    let count = 0;
    let total = 0;
    let totalSquared = 0;
    let white = 0;
    let black = 0;
    const xEnd = Math.min(context.width, Math.ceil(rect.x + rect.w));
    const yEnd = Math.min(context.height, Math.ceil(rect.y + rect.h));

    for (let y = Math.max(0, Math.floor(rect.y)); y < yEnd; y += stepY) {
      for (let x = Math.max(0, Math.floor(rect.x)); x < xEnd; x += stepX) {
        const offset = (y * context.width + x) * 4;
        const value = data[offset] * .2126 + data[offset + 1] * .7152 + data[offset + 2] * .0722;
        count += 1;
        total += value;
        totalSquared += value * value;
        if (value > 244) white += 1;
        if (value < 24) black += 1;
      }
    }
    const mean = total / Math.max(1, count);
    return {
      mean,
      stdDev: Math.sqrt(Math.max(0, totalSquared / Math.max(1, count) - mean * mean)),
      whiteRatio: white / Math.max(1, count),
      blackRatio: black / Math.max(1, count)
    };
  }

  function isUsableFrame(rect, context) {
    if (rect.w < 24 || rect.h < 24) return false;
    const stats = sampleRectStats(rect, context);
    return stats.stdDev > 7 && stats.blackRatio < .82 && stats.whiteRatio < .94;
  }

  function insetRect(rect, amount, maxWidth, maxHeight) {
    const inset = Math.max(0, amount);
    const x = clamp(Math.round(rect.x + inset), 0, maxWidth - 1);
    const y = clamp(Math.round(rect.y + inset), 0, maxHeight - 1);
    const right = clamp(Math.round(rect.x + rect.w - inset), x + 1, maxWidth);
    const bottom = clamp(Math.round(rect.y + rect.h - inset), y + 1, maxHeight);
    return { x, y, w: right - x, h: bottom - y };
  }

  function scoreResult(result, analysis) {
    if (!result.frames.length) return 0;
    const coveredArea = result.frames.reduce((sum, frame) => sum + frame.w * frame.h, 0);
    const areaScore = coveredArea / (analysis.width * analysis.height);
    const nonEmptyCounts = result.stripFrameCounts.filter((count) => count > 0);
    const balance = nonEmptyCounts.length > 1
      ? Math.min(...nonEmptyCounts) / Math.max(...nonEmptyCounts)
      : 0;
    // 一条片轨通常承载多个画格。若把同一条底片竖切成大量单格"片轨"，
    // 多半是方向判错，用单轨多格的效率项抑制这种结果。
    const stripEfficiency = result.frames.length >= 3
      ? Math.max(0, 1 - result.stripCount / result.frames.length)
      : 0;
    return result.frames.length * 8
      + Math.min(result.stripCount, 2) * 3
      + Math.min(9, result.layoutStrength * 1.6)
      + balance * 4
      + stripEfficiency * 4
      + areaScore;
  }

  // 同一条片轨上的画格在物理上尺寸相同。检测边界会受缩略图分辨率和收边设置
  // 影响产生 1–2% 抖动，这里按片轨把画格尺寸统一到中位数，使同一条底片导出
  // 的画格尺寸完全一致；贴住图像边缘的画格只有紧邻暗区时才向外补齐标准尺寸，
  // 紧邻白色留白时保持原样，避免把纸张边缘裁进画格。
  function normalizeFrameGrid(frames, orientation, context) {
    if (frames.length < 3) return frames;
    const vertical = orientation === "vertical";
    const crossKey = vertical ? "x" : "y";
    const crossSizeKey = vertical ? "w" : "h";
    const alongKey = vertical ? "y" : "x";
    const alongSizeKey = vertical ? "h" : "w";
    const alongLimit = vertical ? context.height : context.width;
    const crossLimit = vertical ? context.width : context.height;

    const groups = [];
    for (const frame of [...frames].sort((a, b) => a[crossKey] - b[crossKey])) {
      const start = frame[crossKey];
      const end = start + frame[crossSizeKey];
      const group = groups.find((item) => {
        const overlap = Math.max(0, Math.min(end, item.end) - Math.max(start, item.start));
        return overlap / Math.max(1, Math.min(end - start, item.end - item.start)) > 0.6;
      });
      if (group) {
        group.frames.push(frame);
        group.start = Math.min(group.start, start);
        group.end = Math.max(group.end, end);
      } else {
        groups.push({ start, end, frames: [frame] });
      }
    }

    const result = [];
    for (const group of groups) {
      const interior = group.frames
        .filter((frame) => frame[alongKey] > 0 && frame[alongKey] + frame[alongSizeKey] < alongLimit)
        .sort((a, b) => a[alongKey] - b[alongKey]);
      if (group.frames.length < 3 || interior.length < 2) {
        result.push(...group.frames);
        continue;
      }

      const sizes = interior.map((frame) => frame[alongSizeKey]);
      const medianSize = medianValue(sizes);
      const stable = sizes.filter((size) => Math.abs(size - medianSize) <= medianSize * 0.06);
      if (stable.length < 2) {
        result.push(...group.frames);
        continue;
      }

      const targetSize = Math.round(medianValue(stable));
      const crossStart = Math.round(medianValue(group.frames.map((frame) => frame[crossKey])));
      const crossEnd = Math.round(
        medianValue(group.frames.map((frame) => frame[crossKey] + frame[crossSizeKey]))
      );
      const crossDeviation = Math.max(
        ...group.frames.map((frame) =>
          Math.abs(frame[crossSizeKey] - (crossEnd - crossStart)) / Math.max(1, crossEnd - crossStart)
        )
      );
      const targetCrossSize = crossDeviation <= 0.03
        ? Math.max(1, Math.min(crossEnd - crossStart, crossLimit - crossStart))
        : null;

      const adjustedFrames = new Map();
      for (let index = 0; index < interior.length; index += 1) {
        const frame = interior[index];
        let end = frame[alongKey] + targetSize;
        const next = interior[index + 1];
        if (next) end = Math.min(end, next[alongKey]);
        end = Math.min(end, alongLimit);
        const start = Math.round(frame[alongKey]);
        const adjusted = { ...frame, [alongKey]: start, [alongSizeKey]: Math.max(1, Math.round(end) - start) };
        if (targetCrossSize) {
          adjusted[crossKey] = crossStart;
          adjusted[crossSizeKey] = targetCrossSize;
        }
        adjustedFrames.set(frame, adjusted);
      }

      // 片头/片尾画格缺少一侧分隔线时会被裁窄（例如首格 2412 而非 2648）。
      // 若缺失方向紧邻的是片基暗区，则扩展到标准尺寸；若紧邻白色留白则保持原样。
      const ordered = [...group.frames].sort((a, b) => a[alongKey] - b[alongKey]);
      expandEdgeFrame(ordered[0], "start");
      expandEdgeFrame(ordered[ordered.length - 1], "end");

      function expandEdgeFrame(frame, side) {
        const current = adjustedFrames.get(frame) || { ...frame };
        const size = current[alongSizeKey];
        if (size >= targetSize) return;
        if (side === "start") {
          const end = Math.round(current[alongKey] + size);
          const start = end - targetSize;
          if (start < 0 || start >= current[alongKey]) return;
          if (!isExpandableRegion(context, orientation, start, current[alongKey], crossStart, crossEnd)) return;
          current[alongKey] = start;
          current[alongSizeKey] = Math.max(1, end - start);
        } else {
          const start = Math.round(current[alongKey]);
          const end = start + targetSize;
          if (end > alongLimit || end <= start + size) return;
          if (!isExpandableRegion(context, orientation, start + size, end, crossStart, crossEnd)) return;
          current[alongKey] = start;
          current[alongSizeKey] = Math.max(1, end - start);
        }
        if (targetCrossSize) {
          current[crossKey] = crossStart;
          current[crossSizeKey] = targetCrossSize;
        }
        adjustedFrames.set(frame, current);
      }

      for (const frame of group.frames) {
        result.push(adjustedFrames.get(frame) || frame);
      }
    }
    return dedupeAndSort(result);
  }

  // 判断贴边画格向外扩展的区域能否安全纳入：必须足够暗（暗部画面或片基），
  // 而不是白色留白/纸边，避免把纸张边缘当成画面裁进画格。
  function isExpandableRegion(context, orientation, alongStart, alongEnd, crossStart, crossEnd) {
    const vertical = orientation === "vertical";
    const xStart = Math.max(0, Math.round(vertical ? crossStart : alongStart));
    const xEnd = Math.min(context.width, Math.round(vertical ? crossEnd : alongEnd));
    const yStart = Math.max(0, Math.round(vertical ? alongStart : crossStart));
    const yEnd = Math.min(context.height, Math.round(vertical ? alongEnd : crossEnd));
    if (xEnd <= xStart || yEnd <= yStart) return false;
    const data = context.imageData.data;
    const stepX = Math.max(1, Math.floor((xEnd - xStart) / 120));
    const stepY = Math.max(1, Math.floor((yEnd - yStart) / 120));
    let total = 0;
    let sum = 0;
    let white = 0;
    for (let y = yStart; y < yEnd; y += stepY) {
      const row = y * context.width;
      for (let x = xStart; x < xEnd; x += stepX) {
        const offset = (row + x) * 4;
        const luminance = data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722;
        total += 1;
        sum += luminance;
        if (luminance > 200) white += 1;
      }
    }
    if (!total) return false;
    return sum / total <= 70 && white / total <= 0.15;
  }

  function medianValue(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function dedupeAndSort(frames) {
    // 按面积从大到小比较：假分隔线会切出"大半帧 + 贴边碎片"，碎片的 IoU 可能
    // 不到 0.82，但基本被大框完全包含；用包含度再拦一层，避免同一帧出两个框。
    const sorted = frames.slice().sort((a, b) => b.w * b.h - a.w * a.h);
    const unique = [];
    for (let i = 0; i < sorted.length; i += 1) {
      const frame = sorted[i];
      let duplicate = false;
      for (let j = 0; j < i; j += 1) {
        const other = sorted[j];
        const left = Math.max(frame.x, other.x);
        const top = Math.max(frame.y, other.y);
        const right = Math.min(frame.x + frame.w, other.x + other.w);
        const bottom = Math.min(frame.y + frame.h, other.y + other.h);
        const overlap = Math.max(0, right - left) * Math.max(0, bottom - top);
        const smaller = Math.min(frame.w * frame.h, other.w * other.h);
        if (intersectionOverUnion(frame, other) > 0.82 || overlap / Math.max(1, smaller) > 0.75) {
          duplicate = true;
          break;
        }
      }
      if (!duplicate) unique.push(frame);
    }
    return unique.sort((a, b) => (a.x - b.x) || (a.y - b.y));
  }

  function intersectionOverUnion(a, b) {
    const left = Math.max(a.x, b.x);
    const top = Math.max(a.y, b.y);
    const right = Math.min(a.x + a.w, b.x + b.w);
    const bottom = Math.min(a.y + a.h, b.y + b.h);
    const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
    const union = a.w * a.h + b.w * b.h - intersection;
    return union ? intersection / union : 0;
  }

  function getSelectedExportJobs() {
    syncActiveJobState();
    return state.jobs.filter((job) => job.frames.some((frame) => frame.checked));
  }

  function renderJobQueue() {
    if (!els.jobList) return;
    const selectedTotal = state.jobs.reduce(
      (sum, job) => sum + job.frames.filter((frame) => frame.checked).length,
      0
    );
    els.jobQueueSummary.textContent = `${state.jobs.length} 张底片 · ${selectedTotal} 个画格待导出`;
    els.jobList.replaceChildren();

    state.jobs.forEach((job, index) => {
      const card = document.createElement("article");
      card.className = `job-card is-${job.status}${job.id === state.activeJobId ? " is-active" : ""}`;
      card.tabIndex = state.busy ? -1 : 0;
      card.setAttribute("role", "button");
      card.setAttribute("aria-current", job.id === state.activeJobId ? "true" : "false");
      card.setAttribute("aria-label", `打开底片 ${job.file.name}`);

      const selected = job.frames.filter((frame) => frame.checked).length;
      const statusText = job.status === "processing"
        ? "识别中"
        : job.status === "error"
          ? (job.error || "处理失败")
          : job.status === "pending"
            ? "等待识别"
            : `${job.frames.length} 个画格 · ${selected} 个待导出`;
      card.innerHTML = `<span class="job-card-name" title="${escapeHtml(job.file.name)}">${String(index + 1).padStart(2, "0")} · ${escapeHtml(job.file.name)}</span><small class="job-card-meta">${job.format.label} · ${formatBytes(job.file.size)}</small><small class="job-card-status">${statusText}</small><button class="job-remove" type="button" aria-label="移除 ${escapeHtml(job.file.name)}">×</button>`;
      card.addEventListener("click", (event) => {
        if (!event.target.closest(".job-remove")) void activateJob(job.id);
      });
      card.addEventListener("keydown", (event) => {
        if ((event.key === "Enter" || event.key === " ") && !state.busy) {
          event.preventDefault();
          void activateJob(job.id);
        }
      });
      card.querySelector(".job-remove").addEventListener("click", (event) => {
        event.stopPropagation();
        void removeJob(job.id);
      });
      els.jobList.append(card);
    });
  }

  async function removeJob(jobId) {
    if (state.busy) return;
    const index = state.jobs.findIndex((job) => job.id === jobId);
    if (index < 0) return;
    const wasActive = state.activeJobId === jobId;
    state.jobs.splice(index, 1);
    if (!state.jobs.length) {
      releaseRuntime();
      state.activeJobId = null;
      els.workspace.hidden = true;
      els.intro.hidden = false;
      renderJobQueue();
      updateExportState();
      return;
    }
    if (wasActive) {
      state.activeJobId = null;
      const replacement = state.jobs[Math.min(index, state.jobs.length - 1)];
      setBusy(true, `正在打开 ${replacement.file.name}…`);
      try {
        await loadJobRuntime(replacement, { render: true });
      } catch (error) {
        console.error(error);
        replacement.status = "error";
        replacement.error = "图片读取失败";
      } finally {
        setBusy(false);
      }
    }
    const activeJob = getActiveJob();
    if (activeJob?.meta) updateSourceMeta(activeJob);
    renderJobQueue();
    updateExportState();
  }

  // 批量导出完成后一次性清理已导出底的底片，避免用户逐张点删除。
  async function clearExportedJobs(jobIds) {
    const ids = new Set(jobIds);
    if (!ids.size) return;
    const activeRemoved = ids.has(state.activeJobId);
    for (let index = state.jobs.length - 1; index >= 0; index -= 1) {
      if (ids.has(state.jobs[index].id)) state.jobs.splice(index, 1);
    }
    if (!state.jobs.length) {
      releaseRuntime();
      state.activeJobId = null;
      els.workspace.hidden = true;
      els.intro.hidden = false;
      renderJobQueue();
      updateExportState();
      return;
    }
    if (activeRemoved) {
      state.activeJobId = null;
      const replacement = state.jobs[0];
      try {
        await loadJobRuntime(replacement, { render: true });
      } catch (error) {
        console.error(error);
        replacement.status = "error";
        replacement.error = "图片读取失败";
      }
    } else {
      const activeJob = getActiveJob();
      if (activeJob?.meta) updateSourceMeta(activeJob);
    }
    renderJobQueue();
    updateExportState();
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function toOriginalRect(rect) {
    const image = state.image;
    const x = clamp(Math.round(rect.x * state.scaleX), 0, image.naturalWidth - 1);
    const y = clamp(Math.round(rect.y * state.scaleY), 0, image.naturalHeight - 1);
    const right = clamp(Math.round((rect.x + rect.w) * state.scaleX), x + 1, image.naturalWidth);
    const bottom = clamp(Math.round((rect.y + rect.h) * state.scaleY), y + 1, image.naturalHeight);
    return { x, y, w: right - x, h: bottom - y };
  }

  function cloneFrame(frame) {
    return { ...frame };
  }

  function createFrameSnapshot() {
    return {
      frames: state.frames.map(cloneFrame),
      selectedIndex: state.selectedIndex
    };
  }

  function restoreFrameSnapshot(snapshot) {
    if (!snapshot) return;
    state.frames = snapshot.frames.map(cloneFrame);
    state.selectedIndex = state.frames.length
      ? clamp(snapshot.selectedIndex, 0, state.frames.length - 1)
      : -1;
    const job = getActiveJob();
    if (job) {
      job.frames = state.frames;
      job.selectedIndex = state.selectedIndex;
    }
    renderAll();
  }

  function commitFrameHistory(previousSnapshot) {
    const job = getActiveJob();
    if (!job || !previousSnapshot) return;
    job.undoStack ||= [];
    job.redoStack ||= [];
    job.undoStack.push(previousSnapshot);
    if (job.undoStack.length > frameHistoryLimit) job.undoStack.shift();
    job.redoStack.length = 0;
    syncActiveJobState();
    updateFrameHistoryButtons();
  }

  function deleteFrameFromJob(job, index) {
    if (state.busy || index < 0 || index >= job.frames.length) return;
    job.frames.splice(index, 1);
    if (job.selectedIndex > index) job.selectedIndex -= 1;
    job.selectedIndex = job.frames.length
      ? clamp(job.selectedIndex, 0, job.frames.length - 1)
      : -1;
    if (!job.frames.length) {
      state.jobs = state.jobs.filter((item) => item.id !== job.id);
    }
    renderAll();
    showToast(`已从 ${job.file.name} 删除画格 ${String(index + 1).padStart(2, "0")}`);
  }

  function deleteFrameAtIndex(index) {
    if (state.busy || index < 0 || index >= state.frames.length) return;
    const previousSnapshot = createFrameSnapshot();
    state.frames.splice(index, 1);
    if (state.selectedIndex > index) state.selectedIndex -= 1;
    state.selectedIndex = state.frames.length
      ? clamp(state.selectedIndex, 0, state.frames.length - 1)
      : -1;
    commitFrameHistory(previousSnapshot);
    renderAll();
    showToast(`已删除画格 ${String(index + 1).padStart(2, "0")}`);
  }

  function undoFrameEdit() {
    const job = getActiveJob();
    if (!job?.undoStack?.length || state.busy) return;
    job.redoStack ||= [];
    job.redoStack.push(createFrameSnapshot());
    restoreFrameSnapshot(job.undoStack.pop());
    showToast("已撤销上一步裁框修改");
  }

  function redoFrameEdit() {
    const job = getActiveJob();
    if (!job?.redoStack?.length || state.busy) return;
    job.undoStack ||= [];
    job.undoStack.push(createFrameSnapshot());
    restoreFrameSnapshot(job.redoStack.pop());
    showToast("已重做裁框修改");
  }

  function updateFrameHistoryButtons() {
    const job = getActiveJob();
    els.undoFrameButton.disabled = state.busy || !job?.undoStack?.length;
    els.redoFrameButton.disabled = state.busy || !job?.redoStack?.length;
    els.addFrameButton.disabled = state.busy || !state.image;
  }

  function renderAll() {
    syncActiveJobState();
    drawSourceOverlay();
    renderFrames();
    renderFrameEditor();
    updateExportState();
    const totalFrames = state.jobs.reduce((sum, job) => sum + job.frames.length, 0);
    els.resultCount.textContent = totalFrames ? String(totalFrames).padStart(2, "0") : "00";
    const hasFrames = totalFrames > 0;
    els.noFrames.hidden = hasFrames;
    els.selectionActions.hidden = !hasFrames;
    renderJobQueue();
    updateFrameHistoryButtons();
  }

  function drawSourceOverlay() {
    if (!state.analysis) return;
    const canvas = els.sourceCanvas;
    const sourceWidth = state.analysis.width;
    const sourceHeight = state.analysis.height;
    const outputSize = getRotatedSize(sourceWidth, sourceHeight, state.sourceViewRotation);
    if (canvas.width !== outputSize.width || canvas.height !== outputSize.height) {
      canvas.width = outputSize.width;
      canvas.height = outputSize.height;
    }
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    applyRotationTransform(ctx, state.sourceViewRotation, sourceWidth, sourceHeight);
    ctx.drawImage(state.analysis.canvas, 0, 0);
    ctx.lineWidth = Math.max(2, Math.min(sourceWidth, sourceHeight) / 700);
    ctx.font = `700 ${Math.max(11, sourceWidth / 85)}px Syne, sans-serif`;

    state.frames.forEach((frame, index) => {
      const x = frame.x / state.scaleX;
      const y = frame.y / state.scaleY;
      const w = frame.w / state.scaleX;
      const h = frame.h / state.scaleY;
      const active = index === state.selectedIndex;
      ctx.fillStyle = active ? "rgba(241, 91, 53, .12)" : "rgba(230, 255, 63, .08)";
      ctx.strokeStyle = active ? "#f15b35" : (frame.checked ? "#e6ff3f" : "rgba(240,238,231,.45)");
      ctx.setLineDash(frame.checked ? [] : [7, 5]);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x + 1, y + 1, Math.max(0, w - 2), Math.max(0, h - 2));
      const label = String(index + 1).padStart(2, "0");
      const labelW = ctx.measureText(label).width + 14;
      const labelH = Math.max(20, sourceWidth / 55);
      ctx.fillStyle = active ? "#f15b35" : "#e6ff3f";
      ctx.fillRect(x + 1, y + 1, labelW, labelH);
      ctx.fillStyle = "#171714";
      ctx.fillText(label, x + 8, y + labelH - 6);
      if (active) {
        const handleSize = Math.max(7, Math.min(sourceWidth, sourceHeight) / 105);
        ctx.setLineDash([]);
        ctx.fillStyle = "#f7f3e9";
        ctx.strokeStyle = "#f15b35";
        getFrameHandlePoints({ x, y, w, h }).forEach(({ x: handleX, y: handleY }) => {
          ctx.fillRect(handleX - handleSize / 2, handleY - handleSize / 2, handleSize, handleSize);
          ctx.strokeRect(handleX - handleSize / 2, handleY - handleSize / 2, handleSize, handleSize);
        });
      }
    });

    if (state.draftFrame) {
      const draft = {
        x: state.draftFrame.x / state.scaleX,
        y: state.draftFrame.y / state.scaleY,
        w: state.draftFrame.w / state.scaleX,
        h: state.draftFrame.h / state.scaleY
      };
      ctx.setLineDash([10, 7]);
      ctx.lineWidth = Math.max(2, Math.min(sourceWidth, sourceHeight) / 560);
      ctx.fillStyle = "rgba(241, 91, 53, .16)";
      ctx.strokeStyle = "#f15b35";
      ctx.fillRect(draft.x, draft.y, draft.w, draft.h);
      ctx.strokeRect(draft.x, draft.y, draft.w, draft.h);
    }

    const samples = getActiveJob()?.baseSamples || [];
    samples.forEach((sample, index) => {
      const x = sample.x * sourceWidth;
      const y = sample.y * sourceHeight;
      const radius = Math.max(7, Math.min(sourceWidth, sourceHeight) / 85);
      ctx.setLineDash([]);
      ctx.lineWidth = Math.max(2, radius / 4);
      ctx.fillStyle = "rgba(23, 23, 20, .72)";
      ctx.strokeStyle = "#e6ff3f";
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#e6ff3f";
      ctx.font = `700 ${Math.max(9, radius)}px Syne, sans-serif`;
      ctx.fillText(String(index + 1), x - radius * .28, y + radius * .34);
    });
    ctx.restore();
    els.canvasMessage.hidden = !state.busy;
  }

  function renderFrames() {
    els.framesGrid.replaceChildren();
    const jobs = state.jobs.filter((job) => job.frames.length);
    const grouped = jobs.length > 1;
    jobs.forEach((job) => {
      const isActive = job.id === state.activeJobId;
      if (grouped) {
        const head = document.createElement("div");
        head.className = `frames-group-head${isActive ? " is-active" : ""}`;
        head.innerHTML = `<b>${escapeHtml(job.file.name)}</b><small>${job.frames.length} 个画格 · ${job.format.label}${isActive ? " · 当前编辑" : " · 点击画格切换"}</small>`;
        els.framesGrid.append(head);
      }
      job.frames.forEach((frame, index) => {
        els.framesGrid.append(createFrameCard(job, frame, index, isActive));
      });
    });
  }

  function createFrameCard(job, frame, index, isActive) {
    const card = document.createElement("article");
    card.className = `frame-card${isActive && index === state.selectedIndex ? " is-active" : ""}${frame.checked ? "" : " is-unchecked"}${isActive ? "" : " is-inactive"}`;
    card.style.animationDelay = `${Math.min(index * 45, 360)}ms`;
    card.dataset.index = String(index);
    card.dataset.jobId = job.id;
    card.tabIndex = 0;
    card.setAttribute("role", "checkbox");
    card.setAttribute("aria-checked", String(frame.checked));
    const outputSize = getFrameOutputSize(frame);
    const sourceNote = state.jobs.length > 1 ? `（${job.file.name}）` : "";
    card.setAttribute("aria-label", `画格 ${index + 1}${sourceNote}，输出 ${outputSize.width} × ${outputSize.height} 像素`);

    const preview = document.createElement("div");
    preview.className = "frame-preview";
    preview.append(createPreviewCanvas(frame, job));

    const info = document.createElement("div");
    info.className = "frame-info";
    const fineRotationNote = normalizeFineRotation(frame.fineRotation)
      ? ` · 微调 ${formatSignedAngle(frame.fineRotation)}`
      : "";
    const rotationTools = isActive
      ? `<div class="frame-rotation" aria-label="画格 ${index + 1} 预览与导出角度"><button class="frame-rotate-button" data-rotate="-90" type="button" aria-label="向左旋转预览与导出" title="向左旋转预览与导出">↶</button><output>${normalizeRotation(frame.previewRotation)}°</output><button class="frame-rotate-button" data-rotate="90" type="button" aria-label="向右旋转预览与导出" title="向右旋转预览与导出">↷</button></div>`
      : "";
    const editTools = `${rotationTools}<button class="frame-delete-button" type="button" aria-label="删除画格 ${index + 1}" title="删除画格">✕</button>`;
    info.innerHTML = `<p><b>FRAME ${String(index + 1).padStart(2, "0")}</b><small>输出 ${outputSize.width} × ${outputSize.height} PX${fineRotationNote}</small></p><div class="frame-tools">${editTools}<button class="frame-check" type="button" aria-label="${frame.checked ? "取消选择" : "选择"}画格 ${index + 1}"></button></div>`;
    card.append(preview, info);

    info.querySelectorAll(".frame-rotate-button").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        state.selectedIndex = index;
        const previousSnapshot = createFrameSnapshot();
        frame.previewRotation = normalizeRotation(frame.previewRotation + Number(button.dataset.rotate));
        commitFrameHistory(previousSnapshot);
        updateFramePreviewCard(card, frame, index);
      });
    });

    card.addEventListener("click", (event) => {
      if (event.target.closest(".frame-check")) {
        event.stopPropagation();
        frame.checked = !frame.checked;
        if (isActive) {
          renderAll();
        } else {
          renderFrames();
          renderJobQueue();
          updateExportState();
        }
        return;
      }
      if (event.target.closest(".frame-delete-button")) {
        event.stopPropagation();
        if (isActive) {
          deleteFrameAtIndex(index);
        } else {
          deleteFrameFromJob(job, index);
        }
        return;
      }
      if (!isActive) {
        void focusJobFrame(job, index);
        return;
      }
      state.selectedIndex = index;
      renderAll();
    });
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        card.click();
      } else if (event.key === " ") {
        event.preventDefault();
        if (isActive) {
          state.selectedIndex = index;
          frame.checked = !frame.checked;
          renderAll();
        } else {
          frame.checked = !frame.checked;
          renderFrames();
          renderJobQueue();
          updateExportState();
        }
      } else if (event.key === "Delete") {
        event.preventDefault();
        if (isActive) {
          deleteFrameAtIndex(index);
        } else {
          deleteFrameFromJob(job, index);
        }
      }
    });
    return card;
  }

  async function focusJobFrame(job, index) {
    if (state.busy) return;
    job.selectedIndex = index;
    await activateJob(job.id);
  }

  function createPreviewCanvas(frame, job = getActiveJob()) {
    const maxWidth = 330;
    const maxHeight = 240;
    const rotation = normalizeRotation(frame.previewRotation);
    const outputSize = getRotatedSize(frame.w, frame.h, rotation);
    const scale = Math.min(maxWidth / outputSize.width, maxHeight / outputSize.height, 1);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(outputSize.width * scale));
    canvas.height = Math.max(1, Math.round(outputSize.height * scale));
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.scale(scale, scale);
    const source = getFramePreviewSource(job);
    if (source) {
      if (source.scale === 1) {
        drawFrameImage(ctx, source.image, frame, rotation);
      } else {
        const thumbScale = source.scale;
        ctx.scale(1 / thumbScale, 1 / thumbScale);
        drawFrameImage(ctx, source.image, {
          ...frame,
          x: frame.x * thumbScale,
          y: frame.y * thumbScale,
          w: frame.w * thumbScale,
          h: frame.h * thumbScale
        }, rotation);
      }
    }
    return canvas;
  }

  function getFramePreviewSource(job) {
    if (job && job.id === state.activeJobId && state.image) return { image: state.image, scale: 1 };
    if (job?.thumb) return { image: job.thumb.canvas, scale: job.thumb.scale };
    return null;
  }

  function captureJobThumbnail(job) {
    const source = state.image;
    if (!source) return;
    const width = source.naturalWidth || source.width;
    const height = source.naturalHeight || source.height;
    if (!width || !height) return;
    const scale = Math.min(1, 900 / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "medium";
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    job.thumb = { canvas, scale: canvas.width / width };
  }

  function updateFramePreviewCard(card, frame, index) {
    const nextCanvas = createPreviewCanvas(frame, getActiveJob());
    const outputSize = getFrameOutputSize(frame);
    card.querySelector(".frame-preview").replaceChildren(nextCanvas);
    card.querySelector(".frame-rotation output").value = `${normalizeRotation(frame.previewRotation)}°`;
    const fineRotationNote = normalizeFineRotation(frame.fineRotation)
      ? ` · 微调 ${formatSignedAngle(frame.fineRotation)}`
      : "";
    card.querySelector(".frame-info p small").textContent = `输出 ${outputSize.width} × ${outputSize.height} PX${fineRotationNote}`;
    card.setAttribute("aria-label", `画格 ${index + 1}，输出 ${outputSize.width} × ${outputSize.height} 像素`);
    const activeJobId = state.activeJobId;
    els.framesGrid.querySelectorAll(".frame-card").forEach((item) => {
      item.classList.toggle("is-active", item.dataset.jobId === activeJobId && Number(item.dataset.index) === index);
    });
    drawSourceOverlay();
    renderFrameEditor();
    syncActiveJobState();
    renderJobQueue();
  }

  function renderFrameEditor() {
    const frame = state.frames[state.selectedIndex];
    els.frameEditorPlaceholder.hidden = Boolean(frame);
    els.frameEditorContent.hidden = !frame;
    if (!frame) return;
    els.selectedFrameNumber.textContent = String(state.selectedIndex + 1).padStart(2, "0");
    els.cropX.value = frame.x;
    els.cropY.value = frame.y;
    els.cropW.value = frame.w;
    els.cropH.value = frame.h;
    els.cropAngle.value = normalizeFineRotation(frame.fineRotation);
    els.cropAngle.disabled = Boolean(state.format?.isTiff);
    els.cropAngle.title = state.format?.isTiff ? "TIFF 为保留原始 8/16-bit 样本，仅支持 90° 旋转" : "顺时针为正，逆时针为负";
    els.frameEditorHelp.textContent = state.format?.isTiff
      ? "可直接拖动裁框；TIFF 为保留原始样本，仅支持 90° 旋转。"
      : "可直接拖动裁框；数值对应原图像素，微调角度会应用到预览与导出。";
  }

  function getFrameHandlePoints(frame) {
    const centerX = frame.x + frame.w / 2;
    const centerY = frame.y + frame.h / 2;
    const right = frame.x + frame.w;
    const bottom = frame.y + frame.h;
    return [
      { name: "nw", x: frame.x, y: frame.y },
      { name: "n", x: centerX, y: frame.y },
      { name: "ne", x: right, y: frame.y },
      { name: "e", x: right, y: centerY },
      { name: "se", x: right, y: bottom },
      { name: "s", x: centerX, y: bottom },
      { name: "sw", x: frame.x, y: bottom },
      { name: "w", x: frame.x, y: centerY }
    ];
  }

  function getOriginalCanvasPoint(event) {
    const point = getSourceCanvasPoint(event);
    return {
      x: clamp(Math.round(point.x * state.scaleX), 0, state.image.naturalWidth),
      y: clamp(Math.round(point.y * state.scaleY), 0, state.image.naturalHeight)
    };
  }

  function getCanvasHandleTolerance() {
    const bounds = els.sourceCanvas.getBoundingClientRect();
    const analysisUnitsPerCssPixel = Math.max(
      els.sourceCanvas.width / Math.max(1, bounds.width),
      els.sourceCanvas.height / Math.max(1, bounds.height)
    );
    return Math.max(8, analysisUnitsPerCssPixel * Math.max(state.scaleX, state.scaleY) * 10);
  }

  function hitTestFrameHandle(frame, point, tolerance) {
    return getFrameHandlePoints(frame).find((handle) => (
      Math.abs(handle.x - point.x) <= tolerance
      && Math.abs(handle.y - point.y) <= tolerance
    ))?.name || "";
  }

  function hitTestFrame(point) {
    for (let index = state.frames.length - 1; index >= 0; index -= 1) {
      const frame = state.frames[index];
      if (point.x >= frame.x && point.x <= frame.x + frame.w && point.y >= frame.y && point.y <= frame.y + frame.h) {
        return index;
      }
    }
    return -1;
  }

  function frameFromPoints(start, end) {
    const left = Math.min(start.x, end.x);
    const top = Math.min(start.y, end.y);
    return {
      x: Math.round(left),
      y: Math.round(top),
      w: Math.round(Math.abs(end.x - start.x)),
      h: Math.round(Math.abs(end.y - start.y))
    };
  }

  function resizeFrameFromPointer(frame, handle, point, imageWidth, imageHeight) {
    let left = frame.x;
    let top = frame.y;
    let right = frame.x + frame.w;
    let bottom = frame.y + frame.h;
    if (handle.includes("w")) left = clamp(point.x, 0, right - 8);
    if (handle.includes("e")) right = clamp(point.x, left + 8, imageWidth);
    if (handle.includes("n")) top = clamp(point.y, 0, bottom - 8);
    if (handle.includes("s")) bottom = clamp(point.y, top + 8, imageHeight);
    return {
      ...frame,
      x: Math.round(left),
      y: Math.round(top),
      w: Math.round(right - left),
      h: Math.round(bottom - top)
    };
  }

  function beginCropInteraction(event) {
    if (!state.analysis || !state.image || state.busy || event.button > 0) return;
    event.preventDefault();
    els.sourceCanvas.focus({ preventScroll: true });
    if (state.baseSamplingActive) {
      addFilmBaseSample(getSourceCanvasPoint(event));
      return;
    }

    const point = getOriginalCanvasPoint(event);
    if (state.frameAddMode) {
      els.sourceCanvas.setPointerCapture?.(event.pointerId);
      state.cropInteraction = {
        type: "add",
        pointerId: event.pointerId,
        start: point,
        previousSnapshot: createFrameSnapshot()
      };
      state.draftFrame = { x: point.x, y: point.y, w: 0, h: 0 };
      els.canvasShell.classList.add("is-editing-frame");
      drawSourceOverlay();
      return;
    }

    const tolerance = getCanvasHandleTolerance();
    const activeFrame = state.frames[state.selectedIndex];
    let handle = activeFrame ? hitTestFrameHandle(activeFrame, point, tolerance) : "";
    let index = handle ? state.selectedIndex : hitTestFrame(point);
    if (index < 0) {
      els.sourceCanvas.style.cursor = "crosshair";
      return;
    }
    if (index !== state.selectedIndex) {
      state.selectedIndex = index;
      handle = "";
      renderAll();
      els.framesGrid.querySelector(`[data-job-id="${state.activeJobId}"][data-index="${index}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    const frame = state.frames[index];
    els.sourceCanvas.setPointerCapture?.(event.pointerId);
    state.cropInteraction = {
      type: handle ? "resize" : "move",
      handle,
      index,
      pointerId: event.pointerId,
      start: point,
      original: cloneFrame(frame),
      previousSnapshot: createFrameSnapshot(),
      changed: false
    };
    els.canvasShell.classList.add("is-editing-frame");
    updateCanvasCursor(event);
  }

  function updateCropInteraction(event) {
    const interaction = state.cropInteraction;
    if (!interaction) {
      updateCanvasCursor(event);
      return;
    }
    if (interaction.pointerId !== undefined && event.pointerId !== interaction.pointerId) return;
    event.preventDefault();
    const point = getOriginalCanvasPoint(event);
    if (interaction.type === "add") {
      state.draftFrame = frameFromPoints(interaction.start, point);
      drawSourceOverlay();
      return;
    }

    const frame = state.frames[interaction.index];
    if (!frame) return;
    let nextFrame;
    if (interaction.type === "move") {
      const deltaX = point.x - interaction.start.x;
      const deltaY = point.y - interaction.start.y;
      nextFrame = {
        ...interaction.original,
        x: clamp(Math.round(interaction.original.x + deltaX), 0, state.image.naturalWidth - interaction.original.w),
        y: clamp(Math.round(interaction.original.y + deltaY), 0, state.image.naturalHeight - interaction.original.h)
      };
    } else {
      nextFrame = resizeFrameFromPointer(
        interaction.original,
        interaction.handle,
        point,
        state.image.naturalWidth,
        state.image.naturalHeight
      );
    }
    Object.assign(frame, nextFrame);
    interaction.changed = ["x", "y", "w", "h"].some((key) => frame[key] !== interaction.original[key]);
    renderFrameEditor();
    drawSourceOverlay();
  }

  function finishCropInteraction(event) {
    const interaction = state.cropInteraction;
    if (!interaction) return;
    if (interaction.pointerId !== undefined && event?.pointerId !== undefined && event.pointerId !== interaction.pointerId) return;
    els.sourceCanvas.releasePointerCapture?.(interaction.pointerId);
    state.cropInteraction = null;
    els.canvasShell.classList.remove("is-editing-frame");

    if (interaction.type === "add") {
      const draft = state.draftFrame;
      state.draftFrame = null;
      if (!draft || draft.w < 8 || draft.h < 8) {
        drawSourceOverlay();
        showToast("画格太小，请拖出更大的裁切范围");
        return;
      }
      const job = getActiveJob();
      const frame = {
        ...draft,
        id: `${job.id}-manual-${Date.now()}`,
        checked: true,
        previewRotation: defaultPreviewRotation(draft),
        fineRotation: 0
      };
      state.frames.push(frame);
      state.frames.sort((left, right) => (left.x - right.x) || (left.y - right.y));
      state.selectedIndex = state.frames.findIndex((candidate) => candidate.id === frame.id);
      commitFrameHistory(interaction.previousSnapshot);
      setFrameAddMode(false);
      renderAll();
      showToast("已补充画格，可继续拖动或缩放校正");
      return;
    }

    if (interaction.changed) commitFrameHistory(interaction.previousSnapshot);
    renderAll();
  }

  function cancelCropInteraction() {
    const interaction = state.cropInteraction;
    if (!interaction) return;
    if (interaction.type !== "add" && state.frames[interaction.index]) {
      Object.assign(state.frames[interaction.index], interaction.original);
    }
    els.sourceCanvas.releasePointerCapture?.(interaction.pointerId);
    state.cropInteraction = null;
    state.draftFrame = null;
    els.canvasShell.classList.remove("is-editing-frame");
    renderAll();
  }

  function updateCanvasCursor(event) {
    if (!state.analysis || state.busy) return;
    if (state.frameAddMode || state.baseSamplingActive) {
      els.sourceCanvas.style.cursor = "crosshair";
      return;
    }
    const interaction = state.cropInteraction;
    const point = event?.clientX === undefined ? null : getOriginalCanvasPoint(event);
    const handle = interaction?.handle
      || (point && state.frames[state.selectedIndex]
        ? hitTestFrameHandle(state.frames[state.selectedIndex], point, getCanvasHandleTolerance())
        : "");
    const cursors = {
      n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize",
      ne: "nesw-resize", sw: "nesw-resize", nw: "nwse-resize", se: "nwse-resize"
    };
    els.sourceCanvas.style.cursor = cursors[handle]
      || (interaction?.type === "move" || (point && hitTestFrame(point) >= 0) ? "move" : "crosshair");
  }

  function setFrameAddMode(enabled) {
    state.frameAddMode = Boolean(enabled && state.image && !state.busy);
    if (state.frameAddMode && state.baseSamplingActive) stopFilmBaseSampling();
    state.draftFrame = null;
    els.canvasShell.classList.toggle("is-adding-frame", state.frameAddMode);
    els.addFrameButton.classList.toggle("is-active", state.frameAddMode);
    els.addFrameButton.setAttribute("aria-pressed", String(state.frameAddMode));
    els.addFrameButton.textContent = state.frameAddMode ? "取消手动添加" : "手动添加画格";
    updateCanvasCursor();
    drawSourceOverlay();
  }

  function duplicateSelectedFrame() {
    const frame = state.frames[state.selectedIndex];
    const job = getActiveJob();
    if (!frame || !job || state.busy) return;
    const previousSnapshot = createFrameSnapshot();
    const offset = Math.max(8, Math.round(Math.min(frame.w, frame.h) * .05));
    let x = clamp(frame.x + offset, 0, state.image.naturalWidth - frame.w);
    let y = clamp(frame.y + offset, 0, state.image.naturalHeight - frame.h);
    if (x === frame.x) x = clamp(frame.x - offset, 0, state.image.naturalWidth - frame.w);
    if (y === frame.y) y = clamp(frame.y - offset, 0, state.image.naturalHeight - frame.h);
    const duplicate = {
      ...cloneFrame(frame),
      id: `${job.id}-copy-${Date.now()}`,
      x,
      y,
      checked: true
    };
    state.frames.push(duplicate);
    state.frames.sort((left, right) => (left.x - right.x) || (left.y - right.y));
    state.selectedIndex = state.frames.findIndex((candidate) => candidate.id === duplicate.id);
    commitFrameHistory(previousSnapshot);
    renderAll();
    showToast("已复制裁框，请拖动到漏检画格");
  }

  function nudgeSelectedFrame(key, amount) {
    const frame = state.frames[state.selectedIndex];
    if (!frame || !state.image || state.busy) return;
    const previousSnapshot = createFrameSnapshot();
    const deltaX = key === "ArrowLeft" ? -amount : (key === "ArrowRight" ? amount : 0);
    const deltaY = key === "ArrowUp" ? -amount : (key === "ArrowDown" ? amount : 0);
    const nextX = clamp(frame.x + deltaX, 0, state.image.naturalWidth - frame.w);
    const nextY = clamp(frame.y + deltaY, 0, state.image.naturalHeight - frame.h);
    if (nextX === frame.x && nextY === frame.y) return;
    frame.x = nextX;
    frame.y = nextY;
    commitFrameHistory(previousSnapshot);
    renderAll();
  }

  function getSourceCanvasPoint(event) {
    const bounds = els.sourceCanvas.getBoundingClientRect();
    const canvasX = (event.clientX - bounds.left) * (els.sourceCanvas.width / bounds.width);
    const canvasY = (event.clientY - bounds.top) * (els.sourceCanvas.height / bounds.height);
    return mapRotatedPointToSource(
      canvasX,
      canvasY,
      state.sourceViewRotation,
      state.analysis.width,
      state.analysis.height
    );
  }

  function addFilmBaseSample(point) {
    const job = getActiveJob();
    if (!job || !state.analysis) return;
    const sample = {
      x: clamp(point.x / state.analysis.width, 0, 1),
      y: clamp(point.y / state.analysis.height, 0, 1)
    };
    if (job.baseSamples.length >= 5) job.baseSamples.shift();
    job.baseSamples.push(sample);
    job.filmBase = {
      ...getManualFilmBase(state.analysis, job.baseSamples),
      confidence: 100,
      source: "manual"
    };
    drawSourceOverlay();
    updateFilmBaseUi(job);
    showToast(`已记录 ${job.baseSamples.length} 个片基样本，完成后点击“识别”`);
  }

  function getManualFilmBase(analysis, samples) {
    if (!analysis || !samples?.length) return null;
    const colors = samples.map((sample) => sampleFilmBasePatch(
      analysis.imageData,
      analysis.width,
      analysis.height,
      Math.round(sample.x * analysis.width),
      Math.round(sample.y * analysis.height)
    ));
    return {
      r: median(colors.map((color) => color.r)),
      g: median(colors.map((color) => color.g)),
      b: median(colors.map((color) => color.b))
    };
  }

  function sampleFilmBasePatch(imageData, width, height, centerX, centerY) {
    const radius = Math.max(3, Math.round(Math.min(width, height) / 160));
    const red = [];
    const green = [];
    const blue = [];
    for (let y = Math.max(0, centerY - radius); y <= Math.min(height - 1, centerY + radius); y += 1) {
      for (let x = Math.max(0, centerX - radius); x <= Math.min(width - 1, centerX + radius); x += 1) {
        const offset = (y * width + x) * 4;
        if (imageData.data[offset + 3] < 240) continue;
        red.push(imageData.data[offset]);
        green.push(imageData.data[offset + 1]);
        blue.push(imageData.data[offset + 2]);
      }
    }
    return { r: median(red), g: median(green), b: median(blue) };
  }

  function handleFilmFormatChange() {
    const job = getActiveJob();
    if (!job || state.busy) return;
    job.options.filmFormat = els.filmFormat.value;
    void detectFrames();
  }

  function handleCropScopeChange() {
    if (state.busy) return;
    const job = getActiveJob();
    if (!job) return;
    const scope = els.cropScope.value;
    state.jobs.forEach((item) => { item.options.cropScope = scope; });
    if (state.jobs.length <= 1) {
      void detectFrames();
      return;
    }
    void redetectAllJobs();
  }

  async function redetectAllJobs() {
    const activeJobId = state.activeJobId;
    const jobs = state.jobs.slice();
    const ordered = jobs
      .filter((job) => job.id !== activeJobId)
      .concat(jobs.filter((job) => job.id === activeJobId));
    const failed = [];
    setBusy(true, "正在按新的裁切范围重新匹配所有底片…");
    await nextPaint();
    try {
      for (let index = 0; index < ordered.length; index += 1) {
        const job = ordered[index];
        els.canvasMessage.textContent = `正在匹配 ${index + 1}/${ordered.length} · ${job.file.name}`;
        try {
          await loadJobRuntime(job, { render: false });
          performActiveDetection({ recordHistory: false });
        } catch (error) {
          console.error(error);
          failed.push(job.file.name);
        }
        renderJobQueue();
        await nextPaint();
      }
    } finally {
      const activeJob = getActiveJob();
      if (activeJob) {
        renderAll();
        renderJobDetectionStatus(activeJob);
      }
      setBusy(false);
      renderJobQueue();
    }
    const scopeLabel = els.cropScope.selectedOptions?.[0]?.textContent || els.cropScope.value;
    showToast(failed.length
      ? `已按「${scopeLabel}」重新匹配 ${ordered.length - failed.length} 张底片，${failed.length} 张失败`
      : `已按「${scopeLabel}」重新匹配 ${ordered.length} 张底片`);
  }

  function handleSourceModeChange() {
    const job = getActiveJob();
    if (!job || state.busy) return;
    job.options.sourceMode = els.sourceMode.value;
    if (els.sourceMode.value === "positive") stopFilmBaseSampling();
    updateFilmBaseUi(job);
    void detectFrames();
  }

  function toggleFilmBaseSampling() {
    const job = getActiveJob();
    if (!job || !state.analysis || state.busy) return;
    if (state.baseSamplingActive) {
      const shouldDetect = job.baseSamples.length > 0;
      stopFilmBaseSampling();
      if (shouldDetect) void detectFrames();
      return;
    }
    if (els.sourceMode.value !== "negative") {
      els.sourceMode.value = "negative";
      job.options.sourceMode = "negative";
    }
    if (state.frameAddMode) setFrameAddMode(false);
    state.baseSamplingActive = true;
    els.canvasShell.classList.add("is-base-sampling");
    updateFilmBaseUi(job);
    showToast("请点击画格之间的空白片基；不要点击外部扫描背景");
  }

  function stopFilmBaseSampling() {
    state.baseSamplingActive = false;
    els.canvasShell.classList.remove("is-base-sampling");
    updateFilmBaseUi(getActiveJob());
  }

  function clearFilmBaseSamples() {
    const job = getActiveJob();
    if (!job || state.busy) return;
    job.baseSamples = [];
    job.filmBase = null;
    stopFilmBaseSampling();
    drawSourceOverlay();
    void detectFrames();
  }

  function updateFilmBaseUi(job) {
    if (!job) return;
    const mode = els.sourceMode.value || job.options.sourceMode || "auto";
    els.filmBaseControl.hidden = mode === "positive";
    els.thresholdLabel.textContent = mode === "positive" ? "黑色阈值" : (mode === "negative" ? "片基容差" : "边界阈值");
    els.thresholdRangeLabels.innerHTML = mode === "positive"
      ? "<span>仅纯黑</span><span>包含深灰</span>"
      : "<span>更接近片基</span><span>扩大容差</span>";
    els.filmBaseSampleButton.classList.toggle("is-active", state.baseSamplingActive);
    els.filmBaseSampleButton.setAttribute("aria-pressed", String(state.baseSamplingActive));
    els.filmBaseSampleButton.textContent = state.baseSamplingActive ? "完成采样并识别" : "吸管校正";
    els.sourceCanvas.setAttribute(
      "aria-label",
      state.baseSamplingActive ? "点击原图中的空白片基区域进行采样" : "胶片原图与检测框"
    );
    els.filmBaseClearButton.hidden = !job.baseSamples.length;

    const color = job.baseSamples.length && state.analysis
      ? getManualFilmBase(state.analysis, job.baseSamples)
      : job.filmBase;
    if (color) {
      const rounded = { r: Math.round(color.r), g: Math.round(color.g), b: Math.round(color.b) };
      els.filmBaseSwatch.style.background = `rgb(${rounded.r} ${rounded.g} ${rounded.b})`;
      const source = job.baseSamples.length ? `${job.baseSamples.length} 个手动样本` : "自动采样";
      const confidence = !job.baseSamples.length && color.confidence ? ` · ${color.confidence}%` : "";
      els.filmBaseStatus.textContent = `${source}${confidence} · RGB ${rounded.r}/${rounded.g}/${rounded.b}`;
    } else {
      els.filmBaseSwatch.style.removeProperty("background");
      els.filmBaseStatus.textContent = job.detectionMode === "positive"
        ? "自动判断为正像 · 无需片基"
        : (mode === "auto" ? "等待自动判断" : "等待自动采样");
    }
  }

  function updateSelectedCrop() {
    const frame = state.frames[state.selectedIndex];
    if (!frame || !state.image) return;
    const previousSnapshot = createFrameSnapshot();
    const x = clamp(Math.round(Number(els.cropX.value) || 0), 0, state.image.naturalWidth - 8);
    const y = clamp(Math.round(Number(els.cropY.value) || 0), 0, state.image.naturalHeight - 8);
    const w = clamp(Math.round(Number(els.cropW.value) || 8), 8, state.image.naturalWidth - x);
    const h = clamp(Math.round(Number(els.cropH.value) || 8), 8, state.image.naturalHeight - y);
    if (frame.x === x && frame.y === y && frame.w === w && frame.h === h) return;
    Object.assign(frame, { x, y, w, h });
    commitFrameHistory(previousSnapshot);
    renderAll();
  }

  function updateSelectedFineRotation() {
    const frame = state.frames[state.selectedIndex];
    if (!frame) return;
    if (state.format?.isTiff) {
      els.cropAngle.value = "0";
      showToast("TIFF 为保留原始位深，仅支持 90° 旋转");
      return;
    }
    const fineRotation = normalizeFineRotation(els.cropAngle.value);
    if (normalizeFineRotation(frame.fineRotation) === fineRotation) return;
    const previousSnapshot = createFrameSnapshot();
    frame.fineRotation = fineRotation;
    commitFrameHistory(previousSnapshot);
    renderAll();
  }

  function rotateSourceView(delta) {
    if (!state.analysis) return;
    state.sourceViewRotation = normalizeRotation(state.sourceViewRotation + delta);
    els.sourceRotationLabel.value = `${state.sourceViewRotation}°`;
    drawSourceOverlay();
    syncActiveJobState();
  }

  function normalizeRotation(rotation) {
    return ((Number(rotation) % 360) + 360) % 360;
  }

  function normalizeFineRotation(rotation) {
    return Math.round(clamp(Number(rotation) || 0, -5, 5) * 10) / 10;
  }

  function formatSignedAngle(rotation) {
    const normalized = normalizeFineRotation(rotation);
    return `${normalized > 0 ? "+" : ""}${normalized.toFixed(1)}°`;
  }

  function defaultPreviewRotation(frame) {
    return frame.h > frame.w ? 90 : 0;
  }

  function getRotatedSize(width, height, rotation) {
    const normalized = normalizeRotation(rotation);
    return normalized === 90 || normalized === 270
      ? { width: height, height: width }
      : { width, height };
  }

  function getFrameOutputSize(frame) {
    return getRotatedSize(frame.w, frame.h, frame.previewRotation);
  }

  function applyRotationTransform(ctx, rotation, width, height) {
    switch (normalizeRotation(rotation)) {
      case 90:
        ctx.translate(height, 0);
        ctx.rotate(Math.PI / 2);
        break;
      case 180:
        ctx.translate(width, height);
        ctx.rotate(Math.PI);
        break;
      case 270:
        ctx.translate(0, width);
        ctx.rotate(-Math.PI / 2);
        break;
      default:
        break;
    }
  }

  function drawFrameImage(ctx, image, frame, rotation = frame.previewRotation) {
    applyRotationTransform(ctx, rotation, frame.w, frame.h);
    const fineRotation = normalizeFineRotation(frame.fineRotation);
    if (fineRotation) {
      ctx.translate(frame.w / 2, frame.h / 2);
      ctx.rotate(fineRotation * Math.PI / 180);
      ctx.drawImage(
        image,
        frame.x, frame.y, frame.w, frame.h,
        -frame.w / 2, -frame.h / 2, frame.w, frame.h
      );
      return;
    }
    ctx.drawImage(
      image,
      frame.x, frame.y, frame.w, frame.h,
      0, 0, frame.w, frame.h
    );
  }

  function mapRotatedPointToSource(x, y, rotation, width, height) {
    let sourceX = x;
    let sourceY = y;
    switch (normalizeRotation(rotation)) {
      case 90:
        sourceX = y;
        sourceY = height - x;
        break;
      case 180:
        sourceX = width - x;
        sourceY = height - y;
        break;
      case 270:
        sourceX = width - y;
        sourceY = x;
        break;
      default:
        break;
    }
    return {
      x: clamp(sourceX, 0, width),
      y: clamp(sourceY, 0, height)
    };
  }

  function removeSelectedFrame() {
    if (state.selectedIndex < 0) return;
    const previousSnapshot = createFrameSnapshot();
    state.frames.splice(state.selectedIndex, 1);
    state.selectedIndex = Math.min(state.selectedIndex, state.frames.length - 1);
    commitFrameHistory(previousSnapshot);
    renderAll();
    showToast("已从导出列表排除此画格");
  }

  function setAllFrames(checked) {
    state.jobs.forEach((job) => {
      job.frames.forEach((frame) => { frame.checked = checked; });
    });
    renderAll();
  }

  function updateExportState() {
    const selectedJobs = state.jobs.filter((job) => job.frames.some((frame) => frame.checked));
    const count = selectedJobs.reduce(
      (sum, job) => sum + job.frames.filter((frame) => frame.checked).length,
      0
    );
    els.selectedCount.textContent = selectedJobs.length > 1
      ? `${count} 张待导出 · ${selectedJobs.length} 份底片`
      : `${count} 张待导出`;
    els.exportButton.disabled = count === 0 || state.busy;
    els.exportButton.title = state.exportDirectoryHandle ? `选择窗口将从 ${state.exportDirectoryHandle.name} 打开` : "";
    if (count > 0 && supportsDirectoryExport()) {
      els.exportButtonLabel.textContent = "选择位置并导出";
      els.exportButtonHint.textContent = state.exportDirectoryHandle ? "上次位置" : "每次确认";
    } else if (count > 1) {
      els.exportButtonLabel.textContent = "批量直接下载";
      els.exportButtonHint.textContent = "浏览器";
    } else {
      els.exportButtonLabel.textContent = "导出所选画格";
      const target = resolveExportFormat();
      els.exportButtonHint.textContent = target?.label || (count === 1 ? (selectedJobs[0]?.format.label || "IMG") : "逐张");
    }
  }

  function supportsDirectoryExport() {
    return typeof window.showDirectoryPicker === "function";
  }

  function openSettingsDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(settingsDatabaseName, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(settingsStoreName)) {
          database.createObjectStore(settingsStoreName);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Unable to open settings database"));
      request.onblocked = () => reject(new Error("Settings database is blocked"));
    });
  }

  async function readRememberedExportDirectory() {
    if (typeof indexedDB === "undefined") return null;
    const database = await openSettingsDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(settingsStoreName, "readonly");
        const request = transaction.objectStore(settingsStoreName).get(exportDirectoryKey);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error("Unable to read export directory"));
        transaction.onabort = () => reject(transaction.error || new Error("Export directory read was aborted"));
      });
    } finally {
      database.close();
    }
  }

  async function rememberExportDirectoryHandle(directoryHandle) {
    if (!directoryHandle || typeof indexedDB === "undefined") return;
    try {
      const database = await openSettingsDatabase();
      try {
        await new Promise((resolve, reject) => {
          const transaction = database.transaction(settingsStoreName, "readwrite");
          transaction.objectStore(settingsStoreName).put(directoryHandle, exportDirectoryKey);
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error || new Error("Unable to remember export directory"));
          transaction.onabort = () => reject(transaction.error || new Error("Export directory save was aborted"));
        });
      } finally {
        database.close();
      }
    } catch (error) {
      console.warn("Unable to persist the export directory handle", error);
    }
  }

  async function restoreExportDirectoryHandle() {
    try {
      const directoryHandle = await readRememberedExportDirectory();
      if (directoryHandle?.kind === "directory") state.exportDirectoryHandle = directoryHandle;
    } catch (error) {
      console.warn("Unable to restore the export directory handle", error);
    } finally {
      updateExportState();
    }
  }

  async function getWritableExportDirectory() {
    if (!supportsDirectoryExport()) return null;
    const directoryHandle = await window.showDirectoryPicker({
      id: "film-frame-export",
      mode: "readwrite",
      startIn: state.exportDirectoryHandle || "pictures"
    });
    state.exportDirectoryHandle = directoryHandle;
    await rememberExportDirectoryHandle(directoryHandle);
    updateExportState();
    return directoryHandle;
  }

  async function exportSelected() {
    const selectedJobs = getSelectedExportJobs();
    if (!selectedJobs.length || state.busy) return;

    let directoryHandle = null;
    if (supportsDirectoryExport()) {
      setBusy(true, state.exportDirectoryHandle ? "正在打开上次保存位置…" : "请选择保存位置…");
      try {
        directoryHandle = await getWritableExportDirectory();
      } catch (error) {
        setBusy(false);
        if (error?.name === "AbortError") return;
        if (error?.name === "SecurityError") {
          showToast("当前打开方式无法选择文件夹，请通过 localhost 本地服务打开工具");
          return;
        }
        console.error(error);
        showToast("无法访问所选文件夹，请重新选择");
        return;
      }
    }

    setBusy(true, "正在生成原尺寸画格…");
    await nextPaint();

    const originalJobId = state.activeJobId;
    let exportedCount = 0;
    const failedJobs = [];
    const exportedJobIds = [];
    try {
      const quality = Number(els.exportQuality.value);
      const targetFormat = resolveExportFormat();
      for (let jobIndex = 0; jobIndex < selectedJobs.length; jobIndex += 1) {
        const job = selectedJobs[jobIndex];
        const selectedFrames = job.frames.filter((frame) => frame.checked);
        try {
          els.canvasMessage.textContent = `正在导出 ${jobIndex + 1}/${selectedJobs.length} · ${job.file.name}`;
          await loadJobRuntime(job, { render: false });
          const baseName = job.file.name.replace(/\.[^.]+$/, "") || "film";
          const digits = Math.max(2, String(selectedFrames.length).length);
          for (let frameIndex = 0; frameIndex < selectedFrames.length; frameIndex += 1) {
            const outputFormat = targetFormat || job.format;
            const blob = await cropToBlob(selectedFrames[frameIndex], outputFormat, quality, { explicit: Boolean(targetFormat) });
            const name = `${baseName}_${String(frameIndex + 1).padStart(digits, "0")}.${outputFormat.ext}`;
            if (directoryHandle) {
              await saveBlobToDirectory(blob, name, directoryHandle);
            } else {
              downloadBlob(blob, name);
            }
            exportedCount += 1;
          }
          // 整份底片的画格都导出成功才清理；有未勾选画格的底片保留在目录里。
          if (selectedFrames.length === job.frames.length) exportedJobIds.push(job.id);
        } catch (error) {
          console.error(error);
          failedJobs.push(job.file.name);
        }
        renderJobQueue();
      }

      const suffix = failedJobs.length ? `，${failedJobs.length} 份底片失败` : "";
      const cleared = exportedJobIds.length ? `，已清理 ${exportedJobIds.length} 份底片` : "";
      showToast(directoryHandle
        ? `已将 ${exportedCount} 张画格保存至 ${directoryHandle.name}${suffix}${cleared}`
        : `已发送 ${exportedCount} 个独立下载${suffix}${cleared}`);
    } catch (error) {
      console.error(error);
      showToast(error?.userMessage || "导出失败。图片过大时，可减少所选画格后重试。");
    } finally {
      if (exportedCount > 0) void window.filmFrameStats?.recordExport(exportedCount);
      const originalExported = exportedJobIds.includes(originalJobId);
      const originalJob = originalExported
        ? null
        : state.jobs.find((job) => job.id === originalJobId) || state.jobs[0];
      if (originalJob && state.activeJobId !== originalJob.id) {
        try {
          await loadJobRuntime(originalJob, { render: true });
        } catch (error) {
          console.error(error);
        }
      } else if (originalJob) {
        renderAll();
        renderJobDetectionStatus(originalJob);
      }
      setBusy(false);
      if (exportedJobIds.length) await clearExportedJobs(exportedJobIds);
    }
  }

  async function saveBlobToDirectory(blob, name, directoryHandle) {
    const target = await createUniqueFileHandle(directoryHandle, name);
    const writable = await target.handle.createWritable();
    try {
      await writable.write(blob);
      await writable.close();
    } catch (error) {
      if (typeof writable.abort === "function") {
        try { await writable.abort(); } catch (_) { /* Ignore cleanup errors. */ }
      }
      throw error;
    }
    return target.name;
  }

  async function saveFilesToDirectory(files, directoryHandle) {
    const savedFiles = [];
    for (const file of files) {
      savedFiles.push(await saveBlobToDirectory(file.blob, file.name, directoryHandle));
    }
    return savedFiles;
  }

  async function createUniqueFileHandle(directoryHandle, originalName) {
    let suffix = 0;
    while (true) {
      const candidate = suffix === 0 ? originalName : addFileNameSuffix(originalName, suffix);
      try {
        await directoryHandle.getFileHandle(candidate);
        suffix += 1;
      } catch (error) {
        if (error?.name === "TypeMismatchError") {
          suffix += 1;
          continue;
        }
        if (error?.name !== "NotFoundError") throw error;
        const handle = await directoryHandle.getFileHandle(candidate, { create: true });
        return { name: candidate, handle };
      }
    }
  }

  function addFileNameSuffix(fileName, suffix) {
    const dotIndex = fileName.lastIndexOf(".");
    if (dotIndex <= 0) return `${fileName} (${suffix})`;
    return `${fileName.slice(0, dotIndex)} (${suffix})${fileName.slice(dotIndex)}`;
  }

  function parseClassicTiffDirectory(buffer) {
    const bytes = new Uint8Array(buffer);
    if (bytes.length < 8) throw new Error("TIFF header is incomplete");
    const byteOrder = String.fromCharCode(bytes[0], bytes[1]);
    if (byteOrder !== "II" && byteOrder !== "MM") throw new Error("TIFF byte order is invalid");
    const littleEndian = byteOrder === "II";
    const view = new DataView(buffer);
    if (view.getUint16(2, littleEndian) !== 42) {
      throw new Error("BigTIFF is not supported by the current TIFF decoder");
    }

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
      const valueOffset = valueLength <= 4
        ? entryOffset + 8
        : view.getUint32(entryOffset + 8, littleEndian);
      if (valueOffset + valueLength > bytes.length) continue;
      entries.push({
        tag,
        type,
        count,
        data: bytes.slice(valueOffset, valueOffset + valueLength)
      });
    }
    return { littleEndian, entries };
  }

  function createTiffSource(ifd, directory) {
    return {
      width: ifd.width,
      height: ifd.height,
      data: ifd.data,
      littleEndian: directory.littleEndian,
      entries: directory.entries,
      bitsPerSample: Array.from(ifd.t258 || [1]),
      samplesPerPixel: ifd.t277?.[0] || ifd.t258?.length || 1,
      planarConfiguration: ifd.t284?.[0] || 1,
      photometricInterpretation: ifd.t262?.[0] ?? 1,
      compression: ifd.t259?.[0] || 1,
      predictor: ifd.t317?.[0] || 1,
      hasCfaPattern: Boolean(ifd.t33422)
    };
  }

  function createUnsupportedTiffError(reason) {
    const error = new Error(`Lossless TIFF crop is unavailable: ${reason}`);
    error.userMessage = `该 TIFF 使用${reason}。为避免降为 8-bit，已停止导出；当前无损裁切支持常见的交错式 8/16-bit TIFF。`;
    return error;
  }

  function getTiffRasterInfo(source) {
    const bits = source.bitsPerSample;
    const samples = source.samplesPerPixel;
    if (source.planarConfiguration !== 1) throw createUnsupportedTiffError("分平面通道布局");
    if (source.hasCfaPattern) throw createUnsupportedTiffError("相机 RAW/CFA 像素布局");
    if (source.photometricInterpretation === 6) throw createUnsupportedTiffError("YCbCr 子采样布局");
    if (source.predictor !== 1 && source.predictor !== 2) throw createUnsupportedTiffError("不支持的像素预测器");
    if (bits.length !== samples || !bits.length) throw createUnsupportedTiffError("不规则的通道位深定义");
    if (bits.some((value) => value !== bits[0])) throw createUnsupportedTiffError("各通道位深不一致的布局");
    if (bits[0] !== 8 && bits[0] !== 16) throw createUnsupportedTiffError(`${bits[0]}-bit 打包像素布局`);

    const bytesPerPixel = samples * (bits[0] / 8);
    const expectedBytes = source.width * source.height * bytesPerPixel;
    if (!source.data || source.data.length < expectedBytes) {
      throw createUnsupportedTiffError("无法完整解压的像素数据");
    }
    return { bitDepth: bits[0], samples, bytesPerPixel, expectedBytes };
  }

  function cropTiffRaster(source, frame, rasterInfo) {
    const x = Math.round(frame.x);
    const y = Math.round(frame.y);
    const width = Math.round(frame.w);
    const height = Math.round(frame.h);
    if (x < 0 || y < 0 || width < 1 || height < 1 || x + width > source.width || y + height > source.height) {
      throw new Error("TIFF crop rectangle is outside the source image");
    }

    const rotation = normalizeRotation(frame.previewRotation);
    const outputSize = getRotatedSize(width, height, rotation);
    const bytesPerPixel = rasterInfo.bytesPerPixel;
    const output = new Uint8Array(outputSize.width * outputSize.height * bytesPerPixel);

    if (rotation === 0) {
      const rowBytes = width * bytesPerPixel;
      for (let row = 0; row < height; row += 1) {
        const sourceOffset = ((y + row) * source.width + x) * bytesPerPixel;
        output.set(source.data.subarray(sourceOffset, sourceOffset + rowBytes), row * rowBytes);
      }
      return { data: output, width, height };
    }

    for (let outputY = 0; outputY < outputSize.height; outputY += 1) {
      for (let outputX = 0; outputX < outputSize.width; outputX += 1) {
        let sourceX;
        let sourceY;
        if (rotation === 90) {
          sourceX = outputY;
          sourceY = height - 1 - outputX;
        } else if (rotation === 180) {
          sourceX = width - 1 - outputX;
          sourceY = height - 1 - outputY;
        } else {
          sourceX = width - 1 - outputY;
          sourceY = outputX;
        }
        const sourceOffset = ((y + sourceY) * source.width + x + sourceX) * bytesPerPixel;
        const outputOffset = (outputY * outputSize.width + outputX) * bytesPerPixel;
        for (let byte = 0; byte < bytesPerPixel; byte += 1) {
          output[outputOffset + byte] = source.data[sourceOffset + byte];
        }
      }
    }
    return { data: output, width: outputSize.width, height: outputSize.height };
  }

  function createTiffNumberEntry(tag, type, values, littleEndian) {
    const bytesPerValue = type === 3 ? 2 : 4;
    const data = new Uint8Array(values.length * bytesPerValue);
    const view = new DataView(data.buffer);
    values.forEach((value, index) => {
      if (type === 3) view.setUint16(index * 2, value, littleEndian);
      else view.setUint32(index * 4, value, littleEndian);
    });
    return { tag, type, count: values.length, data };
  }

  function makeTiffOutputEntries(source, width, height, pixelByteLength) {
    const rewrittenTags = new Set([
      256, 257, 258, 259, 262, 266, 273, 274, 277, 278, 279, 284, 288, 289,
      317, 322, 323, 324, 325, 330, 347, 513, 514, 515, 516, 517, 518, 519,
      520, 521, 34665, 34853, 40965, 50740
    ]);
    const entries = source.entries
      .filter((entry) => !rewrittenTags.has(entry.tag))
      .map((entry) => ({ ...entry, data: entry.data.slice() }));
    const setEntry = (entry) => {
      const previousIndex = entries.findIndex((candidate) => candidate.tag === entry.tag);
      if (previousIndex >= 0) entries.splice(previousIndex, 1);
      entries.push(entry);
    };
    const numberEntry = (tag, type, values) => createTiffNumberEntry(tag, type, values, source.littleEndian);

    setEntry(numberEntry(256, 4, [width]));
    setEntry(numberEntry(257, 4, [height]));
    setEntry(numberEntry(258, 3, source.bitsPerSample));
    setEntry(numberEntry(259, 3, [1]));
    setEntry(numberEntry(262, 3, [source.photometricInterpretation]));
    setEntry(numberEntry(273, 4, [0]));
    setEntry(numberEntry(274, 3, [1]));
    setEntry(numberEntry(277, 3, [source.samplesPerPixel]));
    setEntry(numberEntry(278, 4, [height]));
    setEntry(numberEntry(279, 4, [pixelByteLength]));
    setEntry(numberEntry(284, 3, [1]));
    return entries.sort((a, b) => a.tag - b.tag);
  }

  function alignTiffOffset(offset) {
    return offset + (offset % 2);
  }

  function writeClassicTiff(entries, pixelData, littleEndian) {
    if (entries.length > 65535) throw new Error("TIFF contains too many metadata entries");
    const ifdOffset = 8;
    const directoryEnd = ifdOffset + 2 + entries.length * 12 + 4;
    let externalOffset = alignTiffOffset(directoryEnd);
    const valueOffsets = new Array(entries.length).fill(0);

    entries.forEach((entry, index) => {
      if (entry.data.length > 4) {
        valueOffsets[index] = externalOffset;
        externalOffset = alignTiffOffset(externalOffset + entry.data.length);
      }
    });
    const pixelOffset = alignTiffOffset(externalOffset);
    const totalLength = pixelOffset + pixelData.length;
    if (pixelOffset > 0xffffffff || pixelData.length > 0xffffffff || totalLength > 0xffffffff) {
      throw new Error("Classic TIFF output would exceed 4 GiB");
    }

    const output = new Uint8Array(totalLength);
    const view = new DataView(output.buffer);
    output[0] = littleEndian ? 0x49 : 0x4d;
    output[1] = littleEndian ? 0x49 : 0x4d;
    view.setUint16(2, 42, littleEndian);
    view.setUint32(4, ifdOffset, littleEndian);
    view.setUint16(ifdOffset, entries.length, littleEndian);

    entries.forEach((entry, index) => {
      const entryOffset = ifdOffset + 2 + index * 12;
      view.setUint16(entryOffset, entry.tag, littleEndian);
      view.setUint16(entryOffset + 2, entry.type, littleEndian);
      view.setUint32(entryOffset + 4, entry.count, littleEndian);
      if (entry.tag === 273) {
        view.setUint32(entryOffset + 8, pixelOffset, littleEndian);
      } else if (entry.data.length <= 4) {
        output.set(entry.data, entryOffset + 8);
      } else {
        view.setUint32(entryOffset + 8, valueOffsets[index], littleEndian);
        output.set(entry.data, valueOffsets[index]);
      }
    });
    view.setUint32(ifdOffset + 2 + entries.length * 12, 0, littleEndian);
    output.set(pixelData, pixelOffset);
    return output.buffer;
  }

  function swap16BitSamples(bytes) {
    for (let offset = 0; offset + 1 < bytes.length; offset += 2) {
      const first = bytes[offset];
      bytes[offset] = bytes[offset + 1];
      bytes[offset + 1] = first;
    }
  }

  function encodePreservedTiffCrop(source, frame) {
    const rasterInfo = getTiffRasterInfo(source);
    const crop = cropTiffRaster(source, frame, rasterInfo);
    if (rasterInfo.bitDepth === 16 && !source.littleEndian) swap16BitSamples(crop.data);
    const entries = makeTiffOutputEntries(source, crop.width, crop.height, crop.data.length);
    return writeClassicTiff(entries, crop.data, source.littleEndian);
  }

  function encodeBmpCanvas(canvas) {
    const width = canvas.width;
    const height = canvas.height;
    const rowStride = Math.ceil((width * 3) / 4) * 4;
    const pixelBytes = rowStride * height;
    const headerBytes = 54;
    const fileSize = headerBytes + pixelBytes;
    if (!width || !height || !Number.isSafeInteger(fileSize) || fileSize > 0xffffffff) {
      throw new Error("BMP output dimensions are too large");
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

  function encodeTiffCanvas(canvas) {
    if (typeof UTIF === "undefined") throw new Error("TIFF codec is unavailable");
    const rgba = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    return new Blob([UTIF.encodeImage(rgba, canvas.width, canvas.height)], { type: "image/tiff" });
  }

  function cropToBlob(frame, format, quality, { explicit = false } = {}) {
    if (format.isTiff) {
      const canPreserve = !normalizeFineRotation(frame.fineRotation) && Boolean(state.tiffSource);
      if (canPreserve) {
        const tiff = encodePreservedTiffCrop(state.tiffSource, frame);
        return Promise.resolve(new Blob([tiff], { type: "image/tiff" }));
      }
      if (!explicit) {
        const error = new Error("Arbitrary TIFF rotation would require resampling");
        error.userMessage = "TIFF 小角度校正需要重采样，会破坏当前 8/16-bit 无损路径；请将微调角度恢复为 0°，或把导出格式改为 TIFF 以外的选项。";
        return Promise.reject(error);
      }
    }

    const rotation = normalizeRotation(frame.previewRotation);
    const outputSize = getFrameOutputSize(frame);
    const canvas = document.createElement("canvas");
    canvas.width = outputSize.width;
    canvas.height = outputSize.height;
    const ctx = canvas.getContext("2d", { alpha: format.mime !== "image/jpeg" && !format.isBmp });
    if (format.mime === "image/jpeg" || format.isBmp) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, outputSize.width, outputSize.height);
    }
    ctx.save();
    drawFrameImage(ctx, state.image, frame, rotation);
    ctx.restore();

    if (format.isBmp) return Promise.resolve(encodeBmpCanvas(canvas));
    if (format.isTiff) {
      try {
        return Promise.resolve(encodeTiffCanvas(canvas));
      } catch (error) {
        return Promise.reject(error);
      }
    }

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Canvas export failed")), format.mime, quality);
    });
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function setBusy(busy, message = "") {
    state.busy = busy;
    els.canvasShell.classList.toggle("is-scanning", busy);
    els.detectButton.disabled = busy;
    els.sourceMode.disabled = busy;
    els.filmFormat.disabled = busy;
    els.cropScope.disabled = busy;
    els.filmBaseSampleButton.disabled = busy;
    els.filmBaseClearButton.disabled = busy;
    els.canvasMessage.hidden = !busy && Boolean(state.analysis);
    if (busy && message) els.canvasMessage.textContent = message;
    updateExportState();
    updateFrameHistoryButtons();
  }

  function setDetectionStatus(type, title, detail) {
    els.detectedStatus.className = `detected-status is-${type}`;
    els.detectedStatus.querySelector("p").innerHTML = `<b>${title}</b><small>${detail}</small>`;
  }

  function updateRangeLabels() {
    els.blackThresholdValue.value = els.blackThreshold.value;
    els.borderCoverageValue.value = `${els.borderCoverage.value}%`;
    els.edgeInsetValue.value = `${els.edgeInset.value} px`;
  }

  let toastTimer = 0;
  function showToast(message) {
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add("is-visible");
    toastTimer = setTimeout(() => els.toast.classList.remove("is-visible"), 2600);
  }

  function formatBytes(bytes) {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function nextPaint() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  bindEvents();
})();
