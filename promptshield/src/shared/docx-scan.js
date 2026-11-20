// PromptShield Word (.docx) scan: two passes, both always run, merged.
//   1. Text: the .docx is a ZIP; word/document.xml (plus headers, footers, footnotes, endnotes and
//      comments, where personal data often sits) is turned into plain text and run through the detectors.
//   2. Image OCR: every picture under word/media/ (PNG, JPEG, GIF, BMP, WEBP) is OCR'd with the same
//      photo passes as an uploaded photo (psOcr), e.g. a scanned KTP or passport pasted into a letter.
// Findings are merged and de-duplicated by type + value (psPdfScan.mergeFindings). The safe version
// is the document text with every finding masked; images are never part of it.
// Everything stays on the device; no network.
//
// Runs in an extension page with a DOM (offscreen document, side panel). The text helpers are pure
// and covered by tests/docx-scan.test.js.
// Depends on: lib/jszip/jszip.min.js, constants.js, detectors.js, masker.js, doc-scan.js, pdf-scan.js
// (merge / mask helpers), and ocr-engine.js for OCR.
'use strict';

var psDocxScan = (() => {
  // DEBUG-gated log for OCR skipped on one image/page (error message only, never content).
  const DEBUG = false;
  const ocrSkipped = (err) => { if (DEBUG) console.debug('[PromptShield] OCR skipped:', (err && err.message) || err); };
  const MAX_BYTES = 30 * 1024 * 1024;   // larger files are refused (fail closed in the page)
  const MAX_IMAGES = 20;                // OCR is slow (seconds per image)
  const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
  const MIN_IMAGE_SIDE = 80;            // icons, bullets and lines are skipped
  const MIN_IMAGE_LONG = 160;

  const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp' };
  // Parts that hold document text, in reading order: body first, then the rest.
  const TEXT_PARTS = [/^word\/document\.xml$/, /^word\/header\d*\.xml$/, /^word\/footer\d*\.xml$/,
    /^word\/footnotes\.xml$/, /^word\/endnotes\.xml$/, /^word\/comments\.xml$/];

  function zipLib() {
    const Z = globalThis.JSZip;
    if (!Z || typeof Z.loadAsync !== 'function') throw new Error('jszip_missing');
    return Z;
  }

  function bytesFromDataUrl(dataUrl) {
    const m = /^data:([^;,]*)(?:;[^,]*)?;base64,(.*)$/i.exec(String(dataUrl || ''));
    if (!m) throw new Error('bad_docx');
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  function decodeEntities(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => {
      if (e[0] === '#') {
        const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : all;
      }
      return Object.prototype.hasOwnProperty.call(ENTITIES, e.toLowerCase()) ? ENTITIES[e.toLowerCase()] : all;
    });
  }

  /**
   * WordprocessingML -> plain text. Only text runs (w:t, and w:delText: deleted tracked changes are
   * still in the file) are kept, so whitespace between tags and field codes (w:instrText) never leak in.
   * Paragraphs and line breaks become new lines and w:tab a tab. A table row stays on one line, cells
   * separated by tabs, so a label and its value ("Rekening BCA" | "1234567890") stay together.
   */
  function xmlToText(xml) {
    let out = '';
    let inText = 0;      // inside <w:t> / <w:delText>
    let cellDepth = 0;   // inside <w:tc> (tables can nest)
    const re = /<(\/?)([A-Za-z][\w.-]*:)?([\w.-]+)\b[^>]*?(\/?)>|([^<]+)/g;
    let m;
    while ((m = re.exec(String(xml || ''))) !== null) {
      if (m[5] !== undefined) { if (inText) out += decodeEntities(m[5]); continue; }
      const closing = m[1] === '/', selfClosing = m[4] === '/';
      const ns = m[2] || '', name = m[3];
      if (ns !== 'w:') continue;
      if (name === 't' || name === 'delText') {
        if (selfClosing) continue;
        inText += closing ? -1 : 1;
        if (inText < 0) inText = 0;
      } else if (name === 'tab' || name === 'ptab') {
        if (!closing) out += '\t';
      } else if (name === 'br' || name === 'cr') {
        if (!closing) out += cellDepth ? ' ' : '\n';
      } else if (name === 'tc') {
        if (closing) { cellDepth = Math.max(0, cellDepth - 1); out = out.replace(/[ \t]+$/, '') + '\t'; } else if (!selfClosing) cellDepth++;
      } else if (name === 'tr') {
        if (closing) out = out.replace(/[ \t]+$/, '') + '\n';
      } else if (name === 'p' && (closing || selfClosing)) {   // <w:p/> is an empty paragraph
        out += cellDepth ? ' ' : '\n';
      }
    }
    return out
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /** Text-bearing parts present in the archive, body first. */
  function textPartNames(names) {
    const out = [];
    for (const re of TEXT_PARTS) for (const n of names.filter((x) => re.test(x)).sort()) out.push(n);
    return out;
  }

  /** Embedded pictures we can decode: word/media/*.{png,jpg,jpeg,gif,bmp,webp}. Others (EMF, WMF, TIFF) are listed apart. */
  function mediaNames(names) {
    const images = [], skipped = [];
    for (const n of names) {
      if (!/^word\/media\/[^/]+$/.test(n)) continue;
      const ext = (n.split('.').pop() || '').toLowerCase();
      (IMAGE_TYPES[ext] ? images : skipped).push(n);
    }
    return { images: images.sort(), skipped: skipped.sort() };
  }

  /**
   * Open a .docx and read its text and images.
   * @returns {Promise<{text:string, images:Array<{name,type,bytes:Uint8Array}>, skippedImages:string[]}>}
   */
  async function readDocx(bytes) {
    if (!bytes || !bytes.length) throw new Error('bad_docx');
    if (bytes.length > MAX_BYTES) throw new Error('docx_too_large');
    let zip;
    try { zip = await zipLib().loadAsync(bytes); } catch (_) { throw new Error('bad_docx'); }
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    if (!names.includes('word/document.xml')) throw new Error('bad_docx');   // not a Word document

    const texts = [];
    for (const n of textPartNames(names)) {
      const t = xmlToText(await zip.file(n).async('string'));
      if (t) texts.push(t);
    }
    const { images: imageNames, skipped } = mediaNames(names);
    const images = [];
    for (const n of imageNames) {
      const data = await zip.file(n).async('uint8array');
      if (data.length > MAX_IMAGE_BYTES) { skipped.push(n); continue; }
      images.push({ name: n, type: IMAGE_TYPES[(n.split('.').pop() || '').toLowerCase()], bytes: data });
    }
    return { text: texts.join('\n\n'), images, skippedImages: skipped };
  }

  /** OCR one embedded picture; null when it cannot be decoded or is too small to hold text. */
  async function ocrPicture(img) {
    let bitmap;
    try { bitmap = await psOcr.loadBitmap(new Blob([img.bytes], { type: img.type })); } catch (_) { return null; }
    try {
      if (Math.min(bitmap.width, bitmap.height) < MIN_IMAGE_SIDE || Math.max(bitmap.width, bitmap.height) < MIN_IMAGE_LONG) return null;
      const r = await psOcr.ocrImage(bitmap);
      return { text: psDocScan.fixDigits(r.allText || '').trim(), findings: (r.analysis && r.analysis.findings) || [] };
    } catch (err) {
      ocrSkipped(err);
      return null;                                   // treated like an unreadable picture
    } finally {
      if (bitmap && typeof bitmap.close === 'function') bitmap.close();
    }
  }

  /**
   * Scan a .docx (data: URL or bytes): text extraction + OCR of every embedded picture, merged.
   * @returns {Promise<{hasPII, types:string[], findings, allFindings, text, safeText, images, imagesScanned, imagesSkipped}>}
   *   findings: [{id,type,value,label,confidence,sources,ranges}]; allFindings is the same list.
   */
  async function scan(input, opts = {}) {
    const bytes = typeof input === 'string' ? bytesFromDataUrl(input) : input;
    const doc = await readDocx(bytes);
    const detect = (t) => psDetectAll(t, { enabledTypes: opts.enabledTypes });
    const enabled = (t) => !opts.enabledTypes || opts.enabledTypes[t] !== false;

    // Step A: text.
    const textFindings = detect(doc.text);

    // Step B: pictures (always, whatever the text contained).
    const imageFindings = [];
    let imagesScanned = 0;
    const canOcr = opts.ocr !== false && typeof psOcr !== 'undefined' && typeof document !== 'undefined';
    if (canOcr) {
      for (const img of doc.images) {
        if (imagesScanned >= MAX_IMAGES) break;
        if (opts.onImage) opts.onImage(imagesScanned + 1, Math.min(doc.images.length, MAX_IMAGES));
        const r = await ocrPicture(img);
        if (!r) continue;
        imagesScanned++;
        for (const f of detect(r.text)) imageFindings.push(f);
        for (const f of r.findings) if (enabled(f.type)) imageFindings.push(f);
      }
    }

    // Step C: merge + de-duplicate by type + canonical value.
    const merged = psPdfScan.mergeFindings(textFindings, [], imageFindings);
    const lang = opts.lang === 'en' ? 'en' : 'id';
    const text = doc.text;
    const findings = merged.map((f, id) => ({
      id,
      type: f.type,
      value: f.value,
      label: ((PS_TYPE_LABELS[f.type] || {})[lang]) || f.type,
      confidence: f.confidence,
      sources: f.sources,
      ranges: psPdfScan.findRanges(text, f.value)
    }));
    const threshold = typeof opts.confidenceThreshold === 'number' ? opts.confidenceThreshold : 0.7;
    const hasPII = findings.some((f) => f.confidence >= threshold);
    const types = [...new Set(findings.map((f) => f.type))];
    const safeText = psPdfScan.maskText(text, findings, () => true);
    return {
      hasPII, types, findings, allFindings: findings, text, safeText,
      images: doc.images.length,
      imagesScanned,
      imagesSkipped: doc.skippedImages.length + Math.max(0, doc.images.length - MAX_IMAGES)
    };
  }

  return { scan, readDocx, xmlToText, textPartNames, mediaNames, bytesFromDataUrl, DOCX_MIME, MAX_IMAGES };
})();

if (typeof globalThis !== 'undefined') globalThis.psDocxScan = psDocxScan;
if (typeof module !== 'undefined' && module.exports) module.exports = { psDocxScan };
