// PromptShield PDF scan (service worker): extract a PDF's text with the bundled PDF.js, then run the
// shared detectors on it. Everything stays on the device; no network.
//
// A service worker has no DOM and cannot start Web Workers, so PDF.js runs its "fake worker" on the
// same thread: lib/pdfjs/pdf.worker.min.js is imported up front (it sets globalThis.pdfjsWorker,
// which PDF.js uses instead of spawning a Worker). Eval and font loading are switched off (MV3 CSP,
// no document.fonts in a worker); text extraction needs neither.
//
// Depends on (imported before this file): constants.js, detectors.js, masker.js, lib/pdfjs/*.
'use strict';

var psPdfScan = (() => {
  const MAX_BYTES = 30 * 1024 * 1024;   // larger PDFs are refused (fail closed in the page)
  const MAX_PAGES = 300;

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

  /** Text of every page, pages separated by a blank line, lines kept where PDF.js marks an end of line. */
  async function extractText(bytes) {
    if (!bytes || !bytes.length) throw new Error('bad_pdf');
    if (bytes.length > MAX_BYTES) throw new Error('pdf_too_large');
    const pdfjs = lib();
    const task = pdfjs.getDocument({
      data: bytes,
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      disableAutoFetch: true,
      disableStream: true,
      verbosity: 0
    });
    const doc = await task.promise;
    try {
      const pages = [];
      const n = Math.min(doc.numPages, MAX_PAGES);
      for (let p = 1; p <= n; p++) {
        const page = await doc.getPage(p);
        const content = await page.getTextContent();
        let s = '';
        for (const item of content.items) {
          if (typeof item.str !== 'string') continue;
          s += item.str;
          if (item.hasEOL) s += '\n';
          else if (item.str && !/\s$/.test(item.str)) s += ' ';
        }
        pages.push(s.replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim());
        page.cleanup();
      }
      return { text: pages.join('\n\n'), pages: doc.numPages, truncated: doc.numPages > MAX_PAGES };
    } finally {
      doc.destroy().catch(() => {});
    }
  }

  /**
   * Scan a PDF given as a data: URL.
   * @returns {Promise<{hasPII:boolean, findings:Array<{id,type,value,label,start,end,confidence}>, text:string, safeText:string, pages:number}>}
   *   safeText masks every finding ([TYPE_MASKED]); the page rebuilds it from the user's choices.
   */
  async function scan(dataUrl, opts = {}) {
    const { text, pages, truncated } = await extractText(bytesFromDataUrl(dataUrl));
    const threshold = typeof opts.confidenceThreshold === 'number' ? opts.confidenceThreshold : 0.7;
    const found = psDetectAll(text, { enabledTypes: opts.enabledTypes });
    const findings = found.map((f, id) => ({
      id,
      type: f.type,
      value: f.value,
      label: ((PS_TYPE_LABELS[f.type] || {})[opts.lang === 'en' ? 'en' : 'id']) || f.type,
      start: f.start,
      end: f.end,
      confidence: f.confidence
    }));
    // Same rule as typed prompts: only confident findings stop the upload; weaker ones are listed too.
    const hasPII = findings.some((f) => f.confidence >= threshold);
    const safeText = findings.length ? psMasker.maskTyped(text, findings.map((f) => ({ ...f, approved: true }))) : text;
    return { hasPII, findings, text, safeText, pages, truncated };
  }

  return { scan, extractText, bytesFromDataUrl };
})();

if (typeof globalThis !== 'undefined') globalThis.psPdfScan = psPdfScan;
