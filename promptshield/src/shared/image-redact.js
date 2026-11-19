// PromptShield photo redaction helpers: locate detected values in OCR word boxes, and pixelate
// selected regions of a canvas. Used by the side panel (locating) and the content script
// (per-finding pixelation after the user picks what to mask). Pure, apart from the canvas
// drawing in psPixelateRegion. No network, no chrome APIs.
'use strict';

var psImageRedact = (() => {
  // Characters OCR mixes up with digits. Applied to BOTH sides of a comparison, so it only makes
  // matching more tolerant (fixDigits in doc-scan.js may have turned "O" into "0" in a value).
  const LOOKALIKE = { O: '0', Q: '0', D: '0', I: '1', L: '1', '|': '1', '!': '1', Z: '2', S: '5', B: '8', G: '6' };

  /** Matching key: upper-case alphanumerics only, lookalikes folded to digits. */
  function matchKey(s) {
    return String(s || '').toUpperCase().replace(/[|!]/g, '1').replace(/[^0-9A-Z]/g, '')
      .replace(/[OQDILZSBG]/g, (c) => LOOKALIKE[c] || c);
  }

  /** Flatten Tesseract.js (v5) result blocks into words in reading order: [{text, bbox:{x0,y0,x1,y1}}]. */
  function wordsFromTesseract(data) {
    const out = [];
    if (!data) return out;
    if (Array.isArray(data.words) && data.words.length) {
      for (const w of data.words) if (w && w.bbox) out.push({ text: String(w.text || ''), bbox: w.bbox });
      return out;
    }
    for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) {
      for (const w of l.words || []) if (w && w.bbox) out.push({ text: String(w.text || ''), bbox: w.bbox });
    }
    return out;
  }

  /**
   * Boxes (in the OCR image's pixel space) of every place `value` occurs in the word list.
   * Values may span several words ("0812 3456 7890") or be part of one word ("NIK:3201...").
   * @returns {Array<{x0,y0,x1,y1}>}
   */
  function locateValue(words, value) {
    const key = matchKey(value);
    if (key.length < 2 || !words || !words.length) return [];
    let joined = '';
    const owner = [];                      // owner[i] = index of the word that produced joined[i]
    words.forEach((w, wi) => {
      const k = matchKey(w.text);
      joined += k;
      for (let i = 0; i < k.length; i++) owner.push(wi);
    });
    const hit = new Set();
    for (let at = joined.indexOf(key); at !== -1; at = joined.indexOf(key, at + 1)) {
      for (let i = at; i < at + key.length; i++) hit.add(owner[i]);
    }
    return [...hit].sort((a, b) => a - b).map((wi) => ({ ...words[wi].bbox }));
  }

  /**
   * Map a box from an OCR pass image back to the original photo.
   * The pass image was made by scaling the photo by `scale` (to w×h) and rotating it by `rot`
   * degrees about its centre into a W×H canvas (W×H = h×w for 90/270).
   */
  function mapBoxToSource(box, pass) {
    const { scale, rot, w, h } = pass;
    const swap = rot === 90 || rot === 270;
    const W = swap ? h : w, H = swap ? w : h;
    const t = (-rot * Math.PI) / 180;
    const cos = Math.round(Math.cos(t)), sin = Math.round(Math.sin(t));   // multiples of 90°: exact
    const pts = [[box.x0, box.y0], [box.x1, box.y0], [box.x0, box.y1], [box.x1, box.y1]].map(([u, v]) => {
      const dx = u - W / 2, dy = v - H / 2;
      const x = dx * cos - dy * sin + w / 2;
      const y = dx * sin + dy * cos + h / 2;
      return [x / scale, y / scale];
    });
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }

  /** Grow a box a little (OCR boxes hug the glyphs) and clamp it to the image. */
  function padBox(b, imgW, imgH) {
    const p = Math.max(4, Math.min(b.w, b.h) * 0.3);
    const x = Math.max(0, b.x - p), y = Math.max(0, b.y - p);
    return { x, y, w: Math.min(imgW, b.x + b.w + p) - x, h: Math.min(imgH, b.y + b.h + p) - y };
  }

  /**
   * Find where each finding sits in the photo.
   * @param {Array<{rot,scale,w,h,words}>} passes  OCR passes in the order they ran
   * @param {Array<{value:string}>} findings
   * @param {number} imgW  original photo width
   * @param {number} imgH  original photo height
   * @returns {Array<Array<{x,y,w,h}>>}  boxes per finding (empty when it could not be located)
   */
  function locateFindings(passes, findings, imgW, imgH) {
    return findings.map((f) => {
      for (const pass of passes || []) {
        const boxes = locateValue(pass.words, f.value);
        if (boxes.length) return boxes.map((b) => padBox(mapBoxToSource(b, pass), imgW, imgH)).filter((b) => b.w > 0 && b.h > 0);
      }
      return [];
    });
  }

  /** Mosaic: fill each blockSize×blockSize cell with its average colour (one getImageData per region). */
  function pixelateRegion(ctx, x, y, w, h, blockSize = 12) {
    x = Math.max(0, Math.floor(x)); y = Math.max(0, Math.floor(y));
    w = Math.min(ctx.canvas.width - x, Math.ceil(w)); h = Math.min(ctx.canvas.height - y, Math.ceil(h));
    if (w <= 0 || h <= 0) return;
    const bs = Math.max(2, Math.round(blockSize));
    const img = ctx.getImageData(x, y, w, h);
    const d = img.data;
    for (let by = 0; by < h; by += bs) {
      const bh = Math.min(bs, h - by);
      for (let bx = 0; bx < w; bx += bs) {
        const bw = Math.min(bs, w - bx);
        let r = 0, g = 0, b = 0;
        for (let yy = by; yy < by + bh; yy++) {
          for (let xx = bx, i = (yy * w + bx) * 4; xx < bx + bw; xx++, i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
        }
        const n = bw * bh;
        ctx.fillStyle = `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`;
        ctx.fillRect(x + bx, y + by, bw, bh);
      }
    }
  }

  /** Block size that stays unreadable on any resolution. */
  function blockSizeFor(imgW, imgH) {
    return Math.max(14, Math.round(Math.max(imgW, imgH) / 70));
  }

  /** Mask block for a single box: at least ~2 blocks tall so a line of text is never readable. */
  function blockSizeForBox(box, imgW, imgH) {
    return Math.max(6, Math.min(blockSizeFor(imgW, imgH), Math.round(box.h / 2)));
  }

  return { matchKey, wordsFromTesseract, locateValue, mapBoxToSource, padBox, locateFindings, pixelateRegion, blockSizeFor, blockSizeForBox };
})();

if (typeof globalThis !== 'undefined') globalThis.psImageRedact = psImageRedact;
if (typeof module !== 'undefined' && module.exports) module.exports = psImageRedact;
