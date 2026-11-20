// Word (.docx) scan: text extraction from WordprocessingML (body, headers, tables, split runs),
// media listing, and the merged result on a real .docx built in memory. OCR needs a browser, so the
// image pass is switched off here (opts.ocr = false); its merge is covered by the PDF tests.
const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.JSZip = require('../promptshield/lib/jszip/jszip.min.js');
require('../promptshield/src/shared/constants.js');
require('../promptshield/src/shared/masker.js');
require('../promptshield/src/shared/detectors.js');
require('../promptshield/src/shared/pdf-scan.js');
const { psDocxScan: D } = require('../promptshield/src/shared/docx-scan.js');

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const p = (...runs) => `<w:p>${runs.map((r) => `<w:r><w:t xml:space="preserve">${r}</w:t></w:r>`).join('')}</w:p>`;

const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W}><w:body>
${p('Formulir Data Nasabah')}
${p('Nama: ', 'Rina ', 'Sari')}
${p('NIK: 3171', '0164', '08980002')}
<w:p><w:r><w:t>No. HP:</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>081298765432</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc>${p('Email')}</w:tc><w:tc>${p('rina.sari98@example.com')}</w:tc></w:tr>
<w:tr><w:tc>${p('Rekening BCA')}</w:tc><w:tc>${p('1234567890')}</w:tc></w:tr></w:tbl>
<w:p><w:r><w:instrText> HYPERLINK "https://example.com" </w:instrText></w:r><w:r><w:t>Tom &amp; Jerry &lt;tag&gt;</w:t></w:r></w:p>
</w:body></w:document>`;

const HEADER_XML = `<?xml version="1.0"?><w:hdr ${W}>${p('Kontak darurat: 081311112222')}</w:hdr>`;

async function buildDocx() {
  const zip = new globalThis.JSZip();
  zip.file('[Content_Types].xml', '<Types/>');
  zip.file('word/document.xml', DOCUMENT_XML);
  zip.file('word/header1.xml', HEADER_XML);
  zip.file('word/media/image1.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  zip.file('word/media/image2.emf', new Uint8Array([1, 2, 3]));
  return zip.generateAsync({ type: 'uint8array' });
}

test('xmlToText keeps paragraphs, tabs and table cells, joins split runs, drops field codes', () => {
  const t = D.xmlToText(DOCUMENT_XML);
  assert.match(t, /^Formulir Data Nasabah\nNama: Rina Sari\nNIK: 3171016408980002\nNo\. HP:\t081298765432\n/);
  assert.match(t, /\nEmail\trina\.sari98@example\.com\nRekening BCA\t1234567890\n/);   // one line per table row
  assert.match(t, /Tom & Jerry <tag>/);          // entities decoded
  assert.doesNotMatch(t, /HYPERLINK/);           // field code dropped
  assert.doesNotMatch(t, /<w:/);
});

test('textPartNames reads the body first, then headers / footers; mediaNames splits decodable images', () => {
  const names = ['word/footer1.xml', 'word/header1.xml', 'word/document.xml', 'word/styles.xml', 'word/media/a.png',
    'word/media/b.JPG', 'word/media/c.emf', 'word/media/d.wmf', 'docProps/thumbnail.jpeg'];
  assert.deepEqual(D.textPartNames(names), ['word/document.xml', 'word/header1.xml', 'word/footer1.xml']);
  assert.deepEqual(D.mediaNames(names), { images: ['word/media/a.png', 'word/media/b.JPG'], skipped: ['word/media/c.emf', 'word/media/d.wmf'] });
});

test('scan a real .docx: text-layer findings merged and de-duplicated, safe text masks them all', async () => {
  const bytes = await buildDocx();
  const r = await D.scan(bytes, { ocr: false, lang: 'en' });
  assert.equal(r.hasPII, true);
  for (const type of ['NAME', 'NIK', 'PHONE', 'EMAIL', 'BANK_ACCOUNT']) assert.ok(r.types.includes(type), type);
  assert.equal(r.allFindings, r.findings);
  // header phone number is found too
  assert.ok(r.findings.some((f) => f.type === 'PHONE' && f.value === '081311112222'));
  assert.equal(r.images, 1);                        // the PNG; the EMF cannot be decoded
  assert.equal(r.imagesSkipped, 1);
  for (const v of ['3171016408980002', '081298765432', 'rina.sari98@example.com', '1234567890', '081311112222']) {
    assert.ok(!r.safeText.includes(v), v);
  }
  assert.match(r.safeText, /\[NIK_MASKED\]/);
  assert.ok(r.findings.every((f) => f.sources.includes('text') && f.ranges.length > 0));
});

test('a data: URL works the same as bytes; a non-Word ZIP or garbage is rejected', async () => {
  const bytes = await buildDocx();
  const dataUrl = 'data:' + D.DOCX_MIME + ';base64,' + Buffer.from(bytes).toString('base64');
  const r = await D.scan(dataUrl, { ocr: false });
  assert.equal(r.hasPII, true);
  const notWord = new globalThis.JSZip();
  notWord.file('hello.txt', 'hi');
  await assert.rejects(D.scan(await notWord.generateAsync({ type: 'uint8array' }), { ocr: false }), /bad_docx/);
  await assert.rejects(D.scan(new Uint8Array([1, 2, 3]), { ocr: false }), /bad_docx/);
});
