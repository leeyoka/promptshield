// PromptShield OCR engine: Tesseract.js on the device (no API, no network), shared by the offscreen
// document (automatic upload scans on ChatGPT / Gemini / WhatsApp Web) and the side panel scanner.
// Needs a DOM page with Web Workers: an extension page, never the service worker.
//
//   psOcr.loadBitmap(blob)                       decode a photo (EXIF orientation applied)
//   psOcr.ocrImage(drawable, {onStep, isCancelled})
//       multi-pass OCR (upscale, pattern removal, rotations, threshold) with early exit
//       -> {analysis, allText, bestText, passes, cancelled}
//   psOcr.scanImage(blob, {lang})                one photo -> the result the upload popup expects
//   psOcr.describe(analysis, lang)               -> {docLabel, labels}
//
// Depends on (loaded before this file): lib/tesseract.min.js, constants.js, detectors.js,
// doc-scan.js, image-redact.js.
'use strict';

var psOcr = (() => {
  // workerBlobURL:false: MV3 CSP forbids blob: scripts, so the worker loads straight from the
  // extension package. corePath/langPath point at bundled files so nothing is fetched from a CDN.
  const extUrl = (p) => (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL)
    ? chrome.runtime.getURL(p)
    : '../../' + p;

  let _worker = null;
  async function getWorker() {
    if (_worker) return _worker;
    _worker = Tesseract.createWorker(['ind', 'eng'], 1, {
      workerPath: extUrl('lib/worker.min.js'),
      corePath: extUrl('lib/core'),
      langPath: extUrl('lib/lang'),
      workerBlobURL: false,
      logger: () => {}
    });
    try {
      return await _worker;
    } catch (err) {
      _worker = null; // allow a retry on the next scan
      throw err;
    }
  }

  // Phone photos of ID cards are hard for OCR: small text, coloured security patterns, glare,
  // and sideways shots. Each pass upscales the image, removes the background pattern
  // (psDocScan.enhance), optionally applies an adaptive threshold, and can rotate it.
  const TARGET_PX = 2400;            // longest side after scaling
  const PASSES = [
    { rot: 0, mode: 'gray' },
    { rot: 90, mode: 'gray' },       // portrait shot of a landscape card
    { rot: 270, mode: 'gray' },
    { rot: 0, mode: 'bin' },         // heavy glare / low contrast
    { rot: 180, mode: 'gray' }
  ];
  const CONFIDENT = 75;              // a pass this confident that finds nothing ends the scan

  async function loadBitmap(blob) {
    if (typeof createImageBitmap === 'function') {
      try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch (_) { /* fall back */ }
    }
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  const variantScale = (src) => Math.min(3, Math.max(0.5, TARGET_PX / Math.max(src.width, src.height)));

  function makeVariant(src, rot, mode) {
    const scale = variantScale(src);
    const w = Math.round(src.width * scale), h = Math.round(src.height * scale);
    const swap = rot === 90 || rot === 270;
    const canvas = document.createElement('canvas');
    canvas.width = swap ? h : w;
    canvas.height = swap ? w : h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.drawImage(src, -w / 2, -h / 2, w, h);
    if (mode === 'raw') return canvas;   // clean digital render (PDF page): no pre-processing
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    psDocScan.enhance(img);
    if (mode === 'bin') psDocScan.binarize(img);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  const alnumCount = (s) => (String(s).match(/[A-Za-z0-9]/g) || []).length;

  /**
   * OCR an image (ImageBitmap, <img> or <canvas>) with up to five passes, stopping as soon as
   * something sensitive is found or the text reads cleanly.
   * @returns {Promise<{analysis, allText:string, bestText:string, passes:Array, cancelled:boolean}>}
   *   bestText is the single pass that read best (for a text version); allText joins every pass.
   */
  async function ocrImage(src, { onStep, isCancelled, page = false } = {}) {
    const worker = await getWorker();
    const detect = typeof psDetectAll === 'function' ? psDetectAll : null;
    // A rendered PDF page is mostly white paper: the photo contrast stretch can wash its text out,
    // so read the clean render first and keep the photo passes for scanned pages that need them.
    const plan = page ? [{ rot: 0, mode: 'raw' }, ...PASSES] : PASSES;
    const passes = [];
    let analysis = null, allText = '', bestText = '', bestScore = -1, empty = 0;
    for (let i = 0; i < plan.length; i++) {
      if (isCancelled && isCancelled()) return { analysis, allText, bestText, passes, cancelled: true };
      const { rot, mode } = plan[i];
      if (i > 0 && onStep) onStep(i + 1, plan.length);
      const { data } = await worker.recognize(makeVariant(src, rot, mode), {}, { text: true, blocks: true });
      const text = (data && data.text) || '';
      const scale = variantScale(src);
      passes.push({ rot, scale, w: Math.round(src.width * scale), h: Math.round(src.height * scale), words: psImageRedact.wordsFromTesseract(data) });
      const score = alnumCount(text) * ((data && data.confidence) || 0);
      if (score > bestScore) { bestScore = score; bestText = text; }
      allText += '\n' + text;
      analysis = psDocScan.analyze(allText, detect);
      if (analysis.sensitive || analysis.findings.some((f) => f.type !== 'NAME')) break;
      if (alnumCount(text) < 4) { if (++empty >= 2) break; continue; }
      // Read cleanly and found nothing sensitive: the image is upright and simply not a document.
      if (((data && data.confidence) || 0) >= CONFIDENT && alnumCount(text) >= 20) break;
    }
    return { analysis, allText, bestText, passes, cancelled: false };
  }

  /** Document label + human labels of every detected field / finding, in the UI language. */
  function describe(analysis, lang) {
    const en = lang === 'en';
    let docLabel = '';
    if (analysis && analysis.docType) {
      const info = typeof PS_DOC_TYPES !== 'undefined' && PS_DOC_TYPES[analysis.docType];
      docLabel = info ? (en ? (info.en || info.id) : info.id) : analysis.docType;
    }
    const labels = [];
    for (const key of (analysis && analysis.fields) || []) {
      const l = psDocScan.FIELD_LABELS[key];
      if (l) labels.push(l[en ? 'en' : 'id'] || l.id);
    }
    for (const f of (analysis && analysis.findings) || []) {
      const info = typeof PS_TYPE_LABELS !== 'undefined' && PS_TYPE_LABELS[f.type];
      labels.push(info ? (en ? info.en : info.id) : f.type);
    }
    return { docLabel, labels: [...new Set(labels)] };
  }

  /**
   * Scan one photo for an upload. ANY detected PII counts (NIK, NPWP, phone, email, name, …) plus a
   * recognised ID document even when its number could not be read cleanly.
   * @returns {Promise<{hasPII:boolean, types?:string[], docType?, docLabel?, findings?:Array<{type,value,confidence,boxes}>, width?, height?}>}
   */
  async function scanImage(blob, { lang } = {}) {
    const bitmap = await loadBitmap(blob);
    try {
      const r = await ocrImage(bitmap);
      if (!r.analysis || alnumCount(r.allText) < 4) return { hasPII: false, types: [] };
      const a = r.analysis;
      if (!(a.sensitive || a.findings.length > 0)) return { hasPII: false, types: [] };
      let boxes = [];
      try { boxes = psImageRedact.locateFindings(r.passes, a.findings, bitmap.width, bitmap.height); } catch (_) { boxes = []; }
      const { docLabel, labels } = describe(a, lang);
      return {
        hasPII: true,
        types: labels,
        docType: a.docType || null,
        docLabel,
        findings: a.findings.map((f, i) => ({ type: f.type, value: f.value, confidence: f.confidence, boxes: boxes[i] || [] })),
        width: bitmap.width,
        height: bitmap.height
      };
    } finally {
      if (bitmap && typeof bitmap.close === 'function') bitmap.close();
    }
  }

  return { getWorker, loadBitmap, ocrImage, scanImage, describe, alnumCount };
})();

if (typeof globalThis !== 'undefined') globalThis.psOcr = psOcr;
