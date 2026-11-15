// Unit tests for src/shared/detectors.js (the same file the extension loads). Synthetic data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { PS_TYPES } = require('../promptshield/src/shared/constants.js');
const { psValidNik, psLuhn, psEntropy, psDetectAll, psResolveOverlaps } = require('../promptshield/src/shared/detectors.js');

const types = (text, minConf = 0.7) => psDetectAll(text).filter((f) => f.confidence >= minConf).map((f) => f.type);
const one = (text) => {
  const f = psDetectAll(text);
  assert.equal(f.length, 1, `expected 1 finding in ${JSON.stringify(text)}, got ${JSON.stringify(f)}`);
  return f[0];
};

test('NIK validator: structure rules', () => {
  assert.ok(psValidNik('3171012304950001'), 'valid Jakarta male');
  assert.ok(psValidNik('3204015507000003'), 'female +40 day offset');
  assert.ok(psValidNik('9101011212880002'), 'province 91');
  assert.ok(!psValidNik('9901011212880002'), 'province 99 does not exist');
  assert.ok(!psValidNik('3171012313950001'), 'month 13');
  assert.ok(!psValidNik('3171017504950001'), 'day 75 impossible');
  assert.ok(!psValidNik('3171012304950000'), 'serial 0000');
  assert.ok(!psValidNik('317101230495000'), '15 digits');
});

test('Luhn and entropy helpers', () => {
  assert.ok(psLuhn('4111222233334448'));
  assert.ok(!psLuhn('4111222233334449'));
  assert.ok(psEntropy('aB3$kL9!xQ') > psEntropy('aaaaaaaaaa'));
});

test('NIK: plain, spaced, dashed; context raises or lowers confidence', () => {
  assert.equal(one('NIK 3171016408980002').type, PS_TYPES.NIK);
  assert.equal(one('NIK: 3171 0164 0898 0002').value, '3171 0164 0898 0002');
  assert.equal(one('KTP 3171-0164-0898-0002').type, PS_TYPES.NIK);
  assert.ok(one('NIK 3171016408980002').confidence >= 0.95);
  const order = one('Order ID 3171012304950001 sudah dikirim');
  assert.equal(order.type, PS_TYPES.NIK);
  assert.ok(order.confidence < 0.7, 'order context must not auto-flag');
  assert.ok(one('Nomor resi 3171012304950001').confidence < 0.7);
});

test('NIK: context on another line does not count', () => {
  const f = psDetectAll('NIK 3171 0164 0898 0002\nOrder ID 3171012304950001');
  assert.equal(f.length, 2);
  assert.ok(f[0].confidence >= 0.95);
  assert.ok(f[1].confidence < 0.7);
});

test('NIK: mixed separators and longer digit runs are rejected', () => {
  assert.deepEqual(types('3171 0164-0898.0002'), []);
  assert.deepEqual(types('31710164089800021234 is a long id'), []);
});

test('NPWP: classic format, 15 digits with cue, 16 digits with cue', () => {
  assert.equal(one('NPWP 09.254.294.3-407.000').type, PS_TYPES.NPWP);
  assert.equal(one('NPWP saya 092542943407000').type, PS_TYPES.NPWP);
  assert.equal(one('NPWP: 3171016408980002').type, PS_TYPES.NPWP);
  assert.deepEqual(types('angka acak 092542943407000'), []);
});

test('Phone: +62, 62, 08 with separators; not inside other numbers', () => {
  assert.equal(one('HP 081298765432').type, PS_TYPES.PHONE);
  assert.equal(one('WA +62 812-3456-7890').value, '+62 812-3456-7890');
  assert.equal(one('hubungi 6281234567890').type, PS_TYPES.PHONE);
  assert.deepEqual(types('kode 0812'), []);
});

test('Email', () => {
  assert.equal(one('kirim ke rina.sari98@example.com ya').value, 'rina.sari98@example.com');
  assert.deepEqual(types('versi @latest dan user@localhost'), []);
});

test('Card: Luhn + network prefix, spaced or dashed; invalid Luhn ignored', () => {
  assert.equal(one('kartu 4111 2222 3333 4448').type, PS_TYPES.CARD);
  assert.equal(one('card 4111-2222-3333-4448').type, PS_TYPES.CARD);
  assert.deepEqual(types('kartu 4111 2222 3333 4444'), []);
});

test('Bank account needs a bank/rekening cue', () => {
  assert.equal(one('No. rek BRI 0123-01-012345-50-1').type, PS_TYPES.BANK_ACCOUNT);
  assert.equal(one('transfer ke rekening 1234567890 ya').type, PS_TYPES.BANK_ACCOUNT);
  assert.deepEqual(types('nomor 1234567890 di katalog'), []);
});

test('API keys and secrets', () => {
  assert.equal(one('key sk-proj-a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6').type, PS_TYPES.API_KEY);
  assert.equal(one('aws AKIAIOSFODNN7EXAMPLE').type, PS_TYPES.API_KEY);
  assert.equal(one('Authorization: Bearer abcDEF123ghiJKL456mnoPQR789stu').type, PS_TYPES.API_KEY);
  assert.equal(one('jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U').type, PS_TYPES.API_KEY);
  assert.deepEqual(types('password = aaaaaaaaaaaaaaaaaaaa'), []);
});

test('Names: Indonesian and English cues', () => {
  assert.equal(one('Nama: Rina Sari').value, 'Rina Sari');
  assert.equal(one('Nama Lengkap: RINA SARI').value, 'RINA SARI');
  assert.equal(one('a.n. Budi Santoso').value, 'Budi Santoso');
  assert.equal(one('Yth. Bapak Ahmad Fauzi,').value, 'Ahmad Fauzi');
  assert.equal(one('nama saya Rina, terima kasih').value, 'Rina');
  assert.equal(one('My name is John Carter.').value, 'John Carter');
  assert.equal(one('Hormat saya,\nRina Sari').value, 'Rina Sari');
});

test('Names: false-positive guards', () => {
  assert.deepEqual(types('Ibu Kota Jakarta pindah ke Nusantara'), []);
  assert.deepEqual(types('Halo Customer Care, saya mau tanya'), []);
  assert.deepEqual(types('Yth. Direksi PT Contoh'), []);
  assert.deepEqual(types('Dear Sir or Madam'), []);
});

test('Clean text produces no findings', () => {
  for (const t of [
    'Versi 1.2.3 harga Rp 1.250.000 tanggal 2024-11-15 pukul 10:30',
    'Jelaskan fotosintesis secara singkat untuk anak SD',
    'Tolong buat ringkasan rapat hari ini dalam 5 poin'
  ]) assert.deepEqual(types(t), [], t);
});

test('Multi-entity prompt: every type found once, no overlaps', () => {
  const p = 'Customer care, nama saya Rina, NIK 3171016408980002, hubungi 081298765432 atau rina.sari98@example.com, kartu 4111-2222-3333-4448. Token sk-proj-1234567890abcdef1234567890.';
  const f = psDetectAll(p);
  assert.deepEqual(f.map((x) => x.type).sort(), ['API_KEY', 'CARD', 'EMAIL', 'NAME', 'NIK', 'PHONE'].sort());
  for (let i = 1; i < f.length; i++) assert.ok(f[i].start >= f[i - 1].end, 'no overlaps');
  for (const x of f) assert.equal(p.slice(x.start, x.end), x.value, 'offsets match values');
});

test('Overlap resolution is deterministic: higher confidence, then longer span wins', () => {
  const r = psResolveOverlaps([
    { type: 'A', start: 0, end: 10, confidence: 0.8 },
    { type: 'B', start: 5, end: 12, confidence: 0.9 },
    { type: 'C', start: 20, end: 25, confidence: 0.5 },
    { type: 'D', start: 20, end: 30, confidence: 0.5 }
  ]);
  assert.deepEqual(r.map((x) => x.type), ['B', 'D']);
});

test('enabledTypes filter switches types off', () => {
  const f = psDetectAll('NIK 3171016408980002 email a@example.com', { enabledTypes: { NIK: false } });
  assert.deepEqual(f.map((x) => x.type), ['EMAIL']);
});
