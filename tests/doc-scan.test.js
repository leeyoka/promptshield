// Image scanner: OCR-text analysis and pixel preprocessing (src/shared/doc-scan.js).
// The OCR fixtures below are real Tesseract.js 5 output from synthetic KTP phone photos
// (blurred, tilted, glare, JPEG-compressed) that the previous exact-regex classifier missed.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('../promptshield/src/shared/constants.js');
const { psDetectAll } = require('../promptshield/src/shared/detectors.js');
const { psDocScan } = require('../promptshield/src/shared/doc-scan.js');

const OCR = {
  // Labels readable, NIK truncated to 12 digits by OCR.
  ktpLabels: 'PROVINSI DKI JAKARTA\nJAKART A SE LATAN\nNIK - 317405450895\nNama RINA SAK\nTempati Tgi Lahir JAKARTA\njenis Kelamin PEREMPUAN\nAlama! JL. MELAT\nRTRW 005/003\nKelDesa KEBAYA YRAN LAMA\nKec amalan KEBAYI RAN AMA\nAgama SLAM 3\nStatus Perkawinan BELUM KAWIN pop pos\nPekerjaan KARYAWAN SWASTA\nKewarganegaraan WN\nBerlaku Hingga SEUMUR HIDUP',
  // Heavily garbled: "NIK" read as "MK.", most labels broken.
  ktpGarbled: 'PROVINSI DKI JAKARTA\nJAKARTA SELATAN\nMK. 3174054508950003 .\nhs RINA SARI \\\nTempah Lahir JAKARTS A 05-08-1995 |\nin, AMAN 00 BO\npe 2X SL MELATINO. 12 |\n—— : 005003 |\nKerDosa . KEBAYORAN LAMA\nKecamatan KEBAYORAN LAMA 4\na p JAKARTA SELATAN\nSos Porkowean 3 BELUM KAWIN Ya\n| KARYAWAN SWASTA\nWy\n| paetutingge|  :SEMURNOE',
  note: 'Catatan rapat tim produk\nRapat besok jam 10 di ruang meeting lantai 3.\nAgenda: evaluasi fitur baru dan rencana rilis.\nBawa laptop dan data penjualan bulan lalu.\nAlamat kantor cabang baru akan diumumkan.'
};

test('doc-scan: KTP recognised from field labels even when the NIK is misread', () => {
  const r = psDocScan.analyze(OCR.ktpLabels, psDetectAll);
  assert.equal(r.docType, 'KTP');
  assert.equal(r.sensitive, true);
  assert.ok(r.fields.includes('nik'));
  assert.ok(r.fields.includes('marital'));
});

test('doc-scan: heavily garbled KTP OCR still flagged (NIK digits + PROVINSI/KECAMATAN)', () => {
  const r = psDocScan.analyze(OCR.ktpGarbled, psDetectAll);
  assert.equal(r.docType, 'KTP');
  assert.ok(r.findings.some((f) => f.type === 'NIK' && f.value === '3174054508950003'));
});

test('doc-scan: ordinary note with "Alamat" is not a document', () => {
  const r = psDocScan.analyze(OCR.note, psDetectAll);
  assert.equal(r.docType, null);
  assert.equal(r.sensitive, false);
});

test('doc-scan: other document types', () => {
  assert.equal(psDocScan.classify('KARTU KELUARGA\nNo. 3174012345678901\nNama Kepala Keluarga : BUDI').type, 'KK');
  assert.equal(psDocScan.classify('REPUBLIK INDONESIA PASPOR\nP<IDNSARI<<RINA<<<<<<<<<<<<<<<<<<<<<<').type, 'PASSPORT');
  assert.equal(psDocScan.classify('SURAT IZIN MENGEMUDI\nINDONESIA DRIVING LICENSE').type, 'SIM');
  assert.equal(psDocScan.classify('BPJS KESEHATAN\nKARTU INDONESIA SEHAT').type, 'BPJS');
  assert.equal(psDocScan.classify('KEMENTERIAN KEUANGAN\nDIREKTORAT JENDERAL PAJAK\nNPWP : 09.254.294.3-407.000').type, 'NPWP_CARD');
  assert.equal(psDocScan.classify('BUKU TABUNGAN\nNomor Rekening 0123-01-012345-50-1').type, 'BUKU_REKENING');
});

test('doc-scan: OCR digit look-alikes fixed only inside number-like tokens', () => {
  assert.equal(psDocScan.fixDigits('NIK 3174O545O895OOO3'), 'NIK 3174054508950003');
  assert.equal(psDocScan.fixDigits('KEBAYORAN LAMA'), 'KEBAYORAN LAMA');
  const r = psDocScan.analyze('NIK : 3174O54SO8950OO3', psDetectAll);
  assert.ok(r.findings.some((f) => f.type === 'NIK'));
});

test('doc-scan: enhance removes a blue security pattern but keeps black text', () => {
  // 2 px: light-blue background variants and one black text pixel.
  const img = { width: 3, height: 1, data: new Uint8ClampedArray([140, 190, 232, 255, 160, 205, 236, 255, 10, 10, 10, 255]) };
  psDocScan.enhance(img);
  const [a, b, t] = [img.data[0], img.data[4], img.data[8]];
  assert.ok(Math.abs(a - b) < 25, `pattern flattened (${a} vs ${b})`);
  assert.ok(t < 30 && a > 200, `text dark (${t}), background light (${a})`);
});

test('doc-scan: binarize produces pure black/white', () => {
  const w = 40, h = 40, data = new Uint8ClampedArray(w * h * 4).fill(220);
  for (let y = 15; y < 25; y++) for (let x = 15; x < 25; x++) { const p = (y * w + x) * 4; data[p] = data[p + 1] = data[p + 2] = 20; }
  const img = { width: w, height: h, data };
  psDocScan.binarize(img, { window: 31 });
  assert.equal(data[(20 * w + 20) * 4], 0);
  assert.equal(data[(2 * w + 2) * 4], 255);
});
