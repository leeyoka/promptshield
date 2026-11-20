// Text PDF with an embedded picture, through the real bundled PDF.js: the picture is pulled out and
// OCR'd on its own (no page render needed), the slow full-page OCR is skipped on a text page, and
// text-layer + picture findings are merged with their sources. OCR itself is stubbed (needs a browser).
const test = require('node:test');
const assert = require('node:assert/strict');
const root = require('path').resolve(__dirname, '..');
globalThis.pdfjsWorker = require(root + '/promptshield/lib/pdfjs/pdf.worker.min.js');
globalThis.pdfjsLib = require(root + '/promptshield/lib/pdfjs/pdf.min.js');
require(root + '/promptshield/src/shared/constants.js');
require(root + '/promptshield/src/shared/detectors.js');
require(root + '/promptshield/src/shared/masker.js');
require(root + '/promptshield/src/shared/doc-scan.js');

// Minimal DOM stand-ins for imageToCanvas / renderPage (no real drawing needed for this probe).
class FakeCtx { fillRect() {} putImageData() {} drawImage() {} getImageData() { return { data: new Uint8ClampedArray(4) }; } }
globalThis.ImageData = class { constructor(d, w, h) { this.data = d; this.width = w; this.height = h; } };
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => new FakeCtx() }) };
const calls = [];
globalThis.psOcr = {
  ocrImage: async (src, opts) => { calls.push({ w: src.width, h: src.height, page: !!(opts && opts.page) }); return { allText: 'Passport No. X1989435', bestText: '', analysis: { findings: [] } }; }
};
const { psPdfScan } = require(root + '/promptshield/src/shared/pdf-scan.js');
function buildPdf() {
  const W = 200, H = 120;
  const pix = Buffer.alloc(W * H * 3, 200);
  const content = 'BT /F1 14 Tf 40 760 Td (Nama: Rina Sari NIK: 3171016408980002 No. HP: 081298765432) Tj ET q 200 0 0 120 40 600 cm /Im1 Do Q';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> /XObject << /Im1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    null,   // image stream, written as binary below
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
  ];
  const parts = [Buffer.from('%PDF-1.4\n')];
  const offsets = [];
  let pos = parts[0].length;
  objs.forEach((o, i) => {
    offsets.push(pos);
    let buf;
    if (o === null) {
      buf = Buffer.concat([
        Buffer.from(`${i + 1} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${pix.length} >>\nstream\n`),
        pix, Buffer.from('\nendstream\nendobj\n')]);
    } else buf = Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`);
    parts.push(buf); pos += buf.length;
  });
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('') +
    `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF`;
  parts.push(Buffer.from(xref));
  return new Uint8Array(Buffer.concat(parts));
}

test('text page + embedded picture: picture OCR only, findings merged with sources', async () => {
  calls.length = 0;
  const r = await psPdfScan.scan(buildPdf(), { lang: 'en' });
  assert.deepEqual(calls, [{ w: 200, h: 120, page: false }]);   // the 200x120 picture; no full-page OCR
  const got = r.findings.map((f) => `${f.type}:${f.sources.join('+')}`).sort();
  assert.deepEqual(got, ['NAME:text', 'NIK:text', 'PASSPORT:image', 'PHONE:text']);
  assert.equal(r.hasPII, true);
  assert.equal(r.imagesScanned, 1);
  assert.equal(r.ocrPages, 0);
});
