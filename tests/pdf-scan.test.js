// Unit tests for the PDF scan merge: text-layer findings + OCR findings, de-duplicated by type + value,
// the document text used for the safe version, and masking every occurrence of the findings kept ON.
const test = require('node:test');
const assert = require('node:assert/strict');
require('../promptshield/src/shared/constants.js');
require('../promptshield/src/shared/masker.js');           // sets globalThis.psMasker
const { psDetectAll } = require('../promptshield/src/shared/detectors.js');
const { psPdfScan: P } = require('../promptshield/src/shared/pdf-scan.js');

const NIK = '3273055102990004';

test('mergeFindings keeps one entry per type + canonical value and records both sources', () => {
  const text = [{ type: 'NIK', value: NIK, confidence: 0.9 }];
  const ocr = [
    { type: 'NIK', value: '3273 0551 0299 0004', confidence: 0.95 },   // same NIK, other spacing
    { type: 'EMAIL', value: 'budi@mail.com', confidence: 0.9 }
  ];
  const m = P.mergeFindings(text, ocr);
  assert.equal(m.length, 2);
  const nik = m.find((f) => f.type === 'NIK');
  assert.equal(nik.value, NIK);                       // text layer value wins (exact)
  assert.equal(nik.confidence, 0.95);                 // highest confidence kept
  assert.deepEqual(nik.sources, ['text', 'ocr']);
  assert.deepEqual(m.find((f) => f.type === 'EMAIL').sources, ['ocr']);
});

test('mergeFindings de-duplicates within one pass too', () => {
  const m = P.mergeFindings([], [{ type: 'NIK', value: NIK, confidence: 0.9 }, { type: 'NIK', value: NIK, confidence: 0.8 }]);
  assert.equal(m.length, 1);
  assert.deepEqual(m[0].sources, ['ocr']);
});

test('buildDocText uses embedded text, and OCR text only for scanned pages', () => {
  const pages = [
    { text: 'Formulir pendaftaran nama Budi Santoso alamat Bandung', ocrText: 'OCR copy of page one' },
    { text: '', ocrText: `NIK ${NIK}` },                       // scanned KTP page
    { text: '', ocrText: null }                                 // beyond the OCR limit
  ];
  const t = P.buildDocText(pages);
  assert.match(t, /Formulir pendaftaran/);
  assert.doesNotMatch(t, /OCR copy/);
  assert.match(t, new RegExp(NIK));
});

test('findRanges finds every occurrence', () => {
  assert.deepEqual(P.findRanges('a NIK b NIK', 'NIK'), [{ start: 2, end: 5 }, { start: 8, end: 11 }]);
  assert.deepEqual(P.findRanges('nothing', 'NIK'), []);
});

test('maskText masks every occurrence of the findings switched ON only', () => {
  const text = `NIK ${NIK}, email budi@mail.com, lagi ${NIK}`;
  const findings = [
    { id: 0, type: 'NIK', value: NIK, ranges: P.findRanges(text, NIK), approved: true },
    { id: 1, type: 'EMAIL', value: 'budi@mail.com', ranges: P.findRanges(text, 'budi@mail.com'), approved: false }
  ];
  const out = P.maskText(text, findings, (f) => f.approved);
  assert.equal(out, 'NIK [NIK_MASKED], email budi@mail.com, lagi [NIK_MASKED]');
  assert.equal(P.maskText(text, findings, () => false), text);
});

test('a scanned page: an OCR-only finding is merged, located and masked in the safe text', () => {
  const pages = [
    { text: 'Lampiran dokumen pendukung untuk pengajuan pinjaman', ocrText: null },
    { text: '', ocrText: `PROVINSI JAWA BARAT\nNIK : ${NIK}\nNama : BUDI` }
  ];
  const extracted = pages.map((p) => p.text).join('\n\n');
  const ocrFindings = psDetectAll(pages[1].ocrText);
  const merged = P.mergeFindings(psDetectAll(extracted), ocrFindings);
  const nik = merged.find((f) => f.type === 'NIK');
  assert.ok(nik, 'NIK found by OCR');
  assert.deepEqual(nik.sources, ['ocr']);
  const text = P.buildDocText(pages);
  const findings = merged.map((f, id) => ({ ...f, id, ranges: P.findRanges(text, f.value) }));
  const safe = P.maskText(text, findings, () => true);
  assert.doesNotMatch(safe, new RegExp(NIK));
  assert.match(safe, /\[NIK_MASKED\]/);
});
