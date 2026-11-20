// Passport detection from OCR text: passport number, MRZ lines, date of birth and the all-caps name
// printed under its label. Test case: a form PDF (text layer) with an embedded Indonesian passport photo.
const test = require('node:test');
const assert = require('node:assert/strict');
require('../promptshield/src/shared/constants.js');
require('../promptshield/src/shared/masker.js');
const { psDetectAll, psMrzCheckDigit } = require('../promptshield/src/shared/detectors.js');
const { psDocScan } = require('../promptshield/src/shared/doc-scan.js');
const { psPdfScan } = require('../promptshield/src/shared/pdf-scan.js');

const TEXT_LAYER = `Formulir Data Nasabah
Nama: Rina Sari
NIK: 3171016408980002
No. HP: 081298765432
Email: rina.sari98@example.com
Rekening BCA: 1234567890`;

// Tesseract output for the passport bio page: bilingual labels above values, '<' read as 'C' once.
const PASSPORT_OCR = `REPUBLIK INDONESIA
PASPOR / PASSPORT
Jenis/Type Kode Negara/Country Code No. Paspor/Passport No.
P IDN X1989435
Nama Lengkap/Full Name
STEFANUS ADITYA PUTRA SIHOTANG
Tanggal Lahir/Date of Birth Jenis Kelamin/Sex
19 DEC 2008 M
Tempat Lahir/Place of Birth
SURABAYA
Tanggal Pengeluaran/Date of Issue
01 FEB 2023
Tanggal Habis Berlaku/Date of Expiry
01 FEB 2028
P<IDNSIHOTANG<<STEFANUSCADITYA<PUTRA<<<<<<<<
X1989435<6IDN0812191M2802013<<<<<<<<<<<<<<04`;

const confident = (findings) => findings.filter((f) => f.confidence >= 0.7);
const typesOf = (findings) => new Set(findings.map((f) => f.type));

test('MRZ check digits follow ICAO 9303 (7-3-1)', () => {
  assert.equal(psMrzCheckDigit('X1989435<'), 6);
  assert.equal(psMrzCheckDigit('081219'), 1);
  assert.equal(psMrzCheckDigit('280201'), 3);
});

test('text layer: name, NIK, phone, email and bank account', () => {
  const t = typesOf(confident(psDetectAll(TEXT_LAYER)));
  for (const type of ['NAME', 'NIK', 'PHONE', 'EMAIL', 'BANK_ACCOUNT']) assert.ok(t.has(type), type);
});

test('passport OCR: name, passport number, both MRZ lines and date of birth', () => {
  const f = confident(psDetectAll(PASSPORT_OCR));
  const value = (type) => f.filter((x) => x.type === type).map((x) => x.value);
  assert.deepEqual(value('NAME'), ['STEFANUS ADITYA PUTRA SIHOTANG']);
  assert.deepEqual(value('PASSPORT'), ['X1989435']);
  assert.deepEqual(value('DATE_OF_BIRTH'), ['19 DEC 2008']);   // issue / expiry dates are not birth dates
  const mrz = value('PASSPORT_MRZ');
  assert.equal(mrz.length, 2);
  assert.match(mrz[0], /^P<IDNSIHOTANG<<STEFANUS/);
  assert.match(mrz[1], /^X1989435<6IDN0812191M/);
});

test('the OCR analysis used for photos and PDF images reports the same findings', () => {
  const a = psDocScan.analyze(PASSPORT_OCR, psDetectAll);
  assert.equal(a.docType, 'PASSPORT');
  const t = typesOf(a.findings);
  for (const type of ['NAME', 'PASSPORT', 'PASSPORT_MRZ', 'DATE_OF_BIRTH']) assert.ok(t.has(type), type);
});

test('MRZ birth date with a valid check digit is caught when OCR splits the line', () => {
  const f = psDetectAll('X1989435 <6IDN 0812191M2802013');
  assert.ok(f.some((x) => x.type === 'DATE_OF_BIRTH' && x.value === '0812191'));
  // wrong check digit: not a birth date
  assert.ok(!psDetectAll('X1989435 <6IDN 0812197M2802013').some((x) => x.type === 'DATE_OF_BIRTH'));
});

test('dates without a birth label are not flagged; labelled ones in prompts are', () => {
  assert.ok(!psDetectAll('Rapat tanggal 19/12/2025 jam 10.').some((x) => x.type === 'DATE_OF_BIRTH'));
  assert.ok(!psDetectAll('Invoice 01 FEB 2023, jatuh tempo 01 MAR 2023').some((x) => x.type === 'DATE_OF_BIRTH'));
  const f = psDetectAll('Tempat/Tgl Lahir: Surabaya, 19-12-2008');
  assert.ok(f.some((x) => x.type === 'DATE_OF_BIRTH' && x.value === '19-12-2008'));
  assert.ok(psDetectAll('tanggal lahir saya 19 Desember 2008').some((x) => x.type === 'DATE_OF_BIRTH'));
});

test('PDF merge: text-layer and passport-image findings together, nothing lost', () => {
  const text = psDetectAll(TEXT_LAYER);
  const image = psDocScan.analyze(PASSPORT_OCR, psDetectAll).findings;
  const merged = psPdfScan.mergeFindings(text, [], image);
  const t = typesOf(merged.filter((f) => f.confidence >= 0.7));
  for (const type of ['NAME', 'NIK', 'PHONE', 'EMAIL', 'BANK_ACCOUNT', 'PASSPORT', 'PASSPORT_MRZ', 'DATE_OF_BIRTH']) {
    assert.ok(t.has(type), type);
  }
  const names = merged.filter((f) => f.type === 'NAME').map((f) => f.value);
  assert.ok(names.includes('Rina Sari') && names.includes('STEFANUS ADITYA PUTRA SIHOTANG'));
});
