// PromptShield PDF scan: three passes, all of them always run, merged.
//   1. Text extraction with the bundled PDF.js (getTextContent): PDFs with embedded text, e.g. forms.
//   2. OCR: each page is rendered to a canvas and read with Tesseract (psOcr): scanned PDFs, e.g. a
//      photographed KTP saved as PDF.
//   3. Image OCR: on pages with a text layer, every embedded picture (e.g. a passport photo inside a
//      form) is OCR'd on its own with the photo passes, so page text cannot mask it.
// Findings from all passes are merged and de-duplicated by type + value (same canonical form the
// masker uses, so "3273 0551 0299 0004" and "3273055102990004" are one finding).
// Everything stays on the device; no network.
//
// Runs in an extension page with a DOM (offscreen document, side panel). PDF.js uses its "fake
// worker" on the same thread: lib/pdfjs/pdf.worker.min.js is loaded up front (it sets
// globalThis.pdfjsWorker). Eval and font-face loading are off (MV3 CSP); glyphs are drawn as paths.
//
// The merge helpers at the bottom are pure and covered by tests/pdf-scan.test.js.
// Depends on: constants.js, detectors.js, masker.js, doc-scan.js, lib/pdfjs/*, and ocr-engine.js for OCR.
'use strict';

var psPdfScan = (() => {
  const MAX_BYTES = 30 * 1024 * 1024;   // larger PDFs are refused (fail closed in the page)
  const MAX_PAGES = 300;                // text extraction
  const MAX_OCR_PAGES = 20;             // OCR is slow (seconds per page); later pages: text only
  const OCR_PAGE_PX = 2000;             // longest side of a rendered page
  const MIN_TEXT_CHARS = 20;            // fewer letters/digits than this: treat the page as scanned
  const MAX_OCR_IMAGES = 12;            // embedded images OCR'd on their own, per document
  const MIN_IMAGE_SIDE = 80;            // smaller embedded images (icons, logos, lines) are skipped
  const MIN_IMAGE_LONG = 160;

  const alnum = (s) => (String(s).match(/[A-Za-z0-9]/g) || []).length;

  function lib() {
    const p = globalThis.pdfjsLib;
    if (!p || typeof p.getDocument !== 'function') throw new Error('pdfjs_missing');
    return p;
  }

  function bytesFromDataUrl(dataUrl) {
    const m = /^data:([^;,]*)(?:;[^,]*)?;base64,(.*)$/i.exec(String(dataUrl || ''));
    if (!m) throw new Error('bad_pdf');
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function pageText(content) {
    let s = '';
    for (const item of content.items) {
      if (typeof item.str !== 'string') continue;
      s += item.str;
      if (item.hasEOL) s += '\n';
      else if (item.str && !/\s$/.test(item.str)) s += ' ';
    }
    return s.replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
  }

  async function renderPage(page) {
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(3, Math.max(0.5, OCR_PAGE_PX / Math.max(base.width, base.height)));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';                       // transparent pages would OCR as black
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas;
  }

  /**
   * The embedded raster images a page draws (decoded by PDF.js), big enough to hold readable text.
   * Call after page.render(): the image objects are resolved by then.
   */
  async function embeddedImages(page) {
    const OPS = lib().OPS;
    const ops = await page.getOperatorList();
    const out = [];
    const seen = new Set();
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i];
      const args = ops.argsArray[i] || [];
      let img = null;
      if (fn === OPS.paintImageXObject || fn === OPS.paintImageXObjectRepeat) {
        const id = args[0];
        if (typeof id !== 'string' || seen.has(id)) continue;
        seen.add(id);
        try { img = (id.startsWith('g_') ? page.commonObjs : page.objs).get(id); } catch (_) { img = null; }
      } else if (fn === OPS.paintInlineImageXObject) {
        img = args[0];
      }
      if (!img || !img.width || !img.height) continue;
      if (Math.min(img.width, img.height) < MIN_IMAGE_SIDE || Math.max(img.width, img.height) < MIN_IMAGE_LONG) continue;
      out.push(img);
    }
    return out;
  }

  /** Draw a PDF.js image object onto a white canvas (null when its pixel format is unknown). */
  function imageToCanvas(img) {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (img.bitmap) { ctx.drawImage(img.bitmap, 0, 0); return canvas; }
    const rgba = imageObjectToRgba(img);
    if (!rgba) return null;
    ctx.putImageData(new ImageData(rgba, img.width, img.height), 0, 0);
    return canvas;
  }

  /**
   * Read every page: embedded text, and (for the first MAX_OCR_PAGES pages, when ocr is on) OCR of
   * the rendered page. On pages that also have a text layer, each embedded image is OCR'd on its own
   * with the full photo passes (rotations, pattern removal): page OCR there mostly re-reads the text
   * layer and stops at its first finding, so a small ID photo inside the page would be missed.
   * @returns {Promise<{pages:Array<{text, ocrText:string|null, ocrFindings, imageTexts, imageFindings}>, numPages, truncated, ocrPages, imagesScanned}>}
   */
  async function readPages(bytes, { ocr = true, onPage } = {}) {
    if (!bytes || !bytes.length) throw new Error('bad_pdf');
    if (bytes.length > MAX_BYTES) throw new Error('pdf_too_large');
    const doc = await lib().getDocument({
      data: bytes,
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      disableAutoFetch: true,
      disableStream: true,
      verbosity: 0
    }).promise;
    const canOcr = ocr && typeof psOcr !== 'undefined' && typeof document !== 'undefined';
    try {
      const pages = [];
      const n = Math.min(doc.numPages, MAX_PAGES);
      let ocrPages = 0, imagesScanned = 0;
      for (let p = 1; p <= n; p++) {
        if (onPage) onPage(p, n);
        const page = await doc.getPage(p);
        const text = pageText(await page.getTextContent());
        let ocrText = null, ocrFindings = [];
        const imageTexts = [], imageFindings = [];
        if (canOcr && p <= MAX_OCR_PAGES) {
          const canvas = await renderPage(page);
          const r = await psOcr.ocrImage(canvas, { page: true });
          // fixDigits undoes O->0, I->1, … inside number-like tokens, as for photos.
          ocrText = psDocScan.fixDigits(r.bestText || '').trim();
          ocrFindings = (r.analysis && r.analysis.findings) || [];
          canvas.width = canvas.height = 0;          // free the bitmap now, not at GC time
          ocrPages++;

          // Text page with pictures in it: OCR each picture as a photo, whatever the text pass found.
          if (alnum(text) >= MIN_TEXT_CHARS && imagesScanned < MAX_OCR_IMAGES) {
            for (const img of await embeddedImages(page)) {
              if (imagesScanned >= MAX_OCR_IMAGES) break;
              const ic = imageToCanvas(img);
              if (!ic) continue;
              const ir = await psOcr.ocrImage(ic);
              imageTexts.push(psDocScan.fixDigits(ir.allText || '').trim());
              for (const f of (ir.analysis && ir.analysis.findings) || []) imageFindings.push(f);
              ic.width = ic.height = 0;
              imagesScanned++;
            }
          }
        }
        pages.push({ text, ocrText, ocrFindings, imageTexts, imageFindings });
        page.cleanup();
      }
      return { pages, numPages: doc.numPages, truncated: doc.numPages > MAX_PAGES, ocrPages, imagesScanned };
    } finally {
      doc.destroy().catch(() => {});
    }
  }

  /**
   * Scan a PDF (data: URL or bytes): text extraction + OCR, findings merged.
   * @returns {Promise<{hasPII, findings:Array<{id,type,value,label,confidence,sources,ranges}>, text, safeText, pages, ocrPages, truncated}>}
   *   text is the document text used for the safe version (embedded text, or OCR text on scanned pages);
   *   ranges are each finding's occurrences in it; safeText masks every finding ([TYPE_MASKED]).
   */
  async function scan(input, opts = {}) {
    const bytes = typeof input === 'string' ? bytesFromDataUrl(input) : input;
    const { pages, numPages, truncated, ocrPages, imagesScanned } = await readPages(bytes, { ocr: opts.ocr !== false, onPage: opts.onPage });
    const detect = (t) => psDetectAll(t, { enabledTypes: opts.enabledTypes });
    const enabled = (t) => !opts.enabledTypes || opts.enabledTypes[t] !== false;

    const extracted = pages.map((p) => p.text).join('\n\n');
    const textFindings = detect(extracted);
    const ocrFindings = [];
    for (const p of pages) {
      if (p.ocrText === null) continue;
      for (const f of detect(p.ocrText)) ocrFindings.push(f);
      for (const f of p.ocrFindings) if (enabled(f.type)) ocrFindings.push(f);   // incl. raw-text hits
    }
    const imageFindings = [];
    for (const p of pages) {
      for (const t of p.imageTexts || []) for (const f of detect(t)) imageFindings.push(f);
      for (const f of p.imageFindings || []) if (enabled(f.type)) imageFindings.push(f);
    }

    const merged = mergeFindings(textFindings, ocrFindings, imageFindings);
    const text = buildDocText(pages);
    const lang = opts.lang === 'en' ? 'en' : 'id';
    const findings = merged.map((f, id) => ({
      id,
      type: f.type,
      value: f.value,
      label: ((PS_TYPE_LABELS[f.type] || {})[lang]) || f.type,
      confidence: f.confidence,
      sources: f.sources,
      ranges: findRanges(text, f.value)
    }));
    const threshold = typeof opts.confidenceThreshold === 'number' ? opts.confidenceThreshold : 0.7;
    // Same rule as typed prompts: only confident findings stop the upload; weaker ones are listed too.
    const hasPII = findings.some((f) => f.confidence >= threshold);
    const safeText = maskText(text, findings, () => true);
    const types = [...new Set(findings.map((f) => f.type))];
    // allFindings: same list as findings (every finding from all three passes, de-duplicated).
    return { hasPII, types, findings, allFindings: findings, text, safeText, pages: numPages, ocrPages, imagesScanned, truncated };
  }

  // ── Pure helpers (no DOM, no PDF.js) ─────────────────────────────────────────

  const keyOf = (f) => f.type + '\u0000' + (typeof psMasker !== 'undefined'
    ? psMasker.canonical(f.type, f.value)
    : String(f.value).replace(/\s+/g, '').toLowerCase());

  /**
   * Combine text-layer and OCR findings; one entry per type + canonical value. Keeps the first value
   * seen (text layer wins: it is exact), the highest confidence, and where it was found.
   */
  function mergeFindings(textFindings, ocrFindings, imageFindings) {
    const byKey = new Map();
    const add = (f, source) => {
      if (!f || !f.type || typeof f.value !== 'string' || !f.value) return;
      const k = keyOf(f);
      const prev = byKey.get(k);
      if (!prev) {
        byKey.set(k, { type: f.type, value: f.value, confidence: f.confidence || 0, sources: [source] });
        return;
      }
      prev.confidence = Math.max(prev.confidence, f.confidence || 0);
      if (!prev.sources.includes(source)) prev.sources.push(source);
    };
    for (const f of textFindings || []) add(f, 'text');
    for (const f of ocrFindings || []) add(f, 'ocr');
    for (const f of imageFindings || []) add(f, 'image');
    return [...byKey.values()];
  }

  /**
   * RGBA pixels of a decoded PDF.js image object ({width, height, kind, data}); null if unknown.
   * kind: 1 = 1 bit per pixel (bit set = white, rows padded to whole bytes), 2 = RGB, 3 = RGBA.
   */
  function imageObjectToRgba(img) {
    const { width: w, height: h, kind, data } = img || {};
    if (!w || !h || !data) return null;
    const n = w * h;
    const out = new Uint8ClampedArray(n * 4);
    if (kind === 3) {
      if (data.length < n * 4) return null;
      out.set(data.subarray(0, n * 4));
    } else if (kind === 2) {
      if (data.length < n * 3) return null;
      for (let i = 0, j = 0; i < n; i++, j += 3) {
        out[i * 4] = data[j]; out[i * 4 + 1] = data[j + 1]; out[i * 4 + 2] = data[j + 2]; out[i * 4 + 3] = 255;
      }
    } else if (kind === 1) {
      const rowBytes = (w + 7) >> 3;
      if (data.length < rowBytes * h) return null;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const v = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0;
          const o = (y * w + x) * 4;
          out[o] = out[o + 1] = out[o + 2] = v; out[o + 3] = 255;
        }
      }
    } else {
      return null;
    }
    return out;
  }

  /** Text for the safe version: each page's embedded text, or its OCR text when the page is scanned. */
  function buildDocText(pages) {
    return pages.map((p) => {
      const t = p.text || '';
      if (alnum(t) >= MIN_TEXT_CHARS || !p.ocrText) return t;
      return p.ocrText;
    }).filter((t) => t).join('\n\n');
  }

  /** Every occurrence of value in text, as [{start, end}]. */
  function findRanges(text, value) {
    const out = [];
    if (!value) return out;
    for (let i = text.indexOf(value); i !== -1; i = text.indexOf(value, i + value.length)) {
      out.push({ start: i, end: i + value.length });
    }
    return out;
  }

  /** Replace every occurrence of the findings picked by isOn(finding) with [TYPE_MASKED]. */
  function maskText(text, findings, isOn) {
    const items = [];
    for (const f of findings) {
      if (!isOn(f)) continue;
      for (const r of f.ranges || []) items.push({ id: f.id, type: f.type, value: f.value, start: r.start, end: r.end, approved: true });
    }
    // Longer matches first at the same start, so "…@mail.com" wins over a nested shorter value.
    items.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
    return items.length ? psMasker.maskTyped(text, items) : text;
  }

  return { scan, readPages, bytesFromDataUrl, mergeFindings, imageObjectToRgba, buildDocText, findRanges, maskText, MAX_OCR_PAGES };
})();

if (typeof globalThis !== 'undefined') globalThis.psPdfScan = psPdfScan;
if (typeof module !== 'undefined' && module.exports) module.exports = { psPdfScan };
