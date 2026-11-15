// Seeded synthetic dataset generator. All values are random but structurally valid; none are real.
// Schema per item: { text, entities: [{type, start, end}], lang, source }
'use strict';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PROVINCES = [11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 31, 32, 33, 34, 35, 36, 51, 52, 53, 61, 62, 63, 64, 65, 71, 72, 73, 74, 75, 76, 81, 82, 91, 92, 94];
const FIRST = ['Rina', 'Budi', 'Siti', 'Agus', 'Dewi', 'Andi', 'Putri', 'Rizky', 'Nur', 'Fajar', 'Ayu', 'Hendra', 'Wulan', 'Yusuf', 'Intan', 'Bayu'];
const LAST = ['Sari', 'Santoso', 'Rahmawati', 'Pratama', 'Lestari', 'Wijaya', 'Hidayat', 'Kusuma', 'Saputra', 'Permata', 'Nugroho', 'Halim'];

function make(seed) {
  const r = rng(seed);
  const int = (a, b) => a + Math.floor(r() * (b - a + 1));
  const pick = (arr) => arr[int(0, arr.length - 1)];
  const digits = (n) => Array.from({ length: n }, () => int(0, 9)).join('');
  const pad = (n, w) => String(n).padStart(w, '0');

  const luhnComplete = (partial) => {
    for (let c = 0; c <= 9; c++) {
      const d = partial + c;
      let sum = 0, alt = false;
      for (let i = d.length - 1; i >= 0; i--) { let n = +d[i]; if (alt) { n *= 2; if (n > 9) n -= 9; } sum += n; alt = !alt; }
      if (sum % 10 === 0) return d;
    }
    return null;
  };

  const gen = {
    NIK() {
      const female = r() < 0.5;
      const dd = int(1, 28) + (female ? 40 : 0);
      const s = `${pick(PROVINCES)}${pad(int(1, 79), 2)}${pad(int(1, 40), 2)}${pad(dd, 2)}${pad(int(1, 12), 2)}${pad(int(60, 99), 2)}${pad(int(1, 9999), 4)}`;
      const style = int(0, 3);
      if (style === 1) return s.replace(/(\d{4})(?=\d)/g, '$1 ');
      if (style === 2) return s.replace(/(\d{4})(?=\d)/g, '$1-');
      return s;
    },
    PHONE() {
      const body = `8${int(1, 9)}${digits(int(7, 9))}`;
      const style = int(0, 3);
      if (style === 0) return `0${body}`;
      if (style === 1) return `+62${body}`;
      if (style === 2) return `+62 ${body.slice(0, 3)}-${body.slice(3, 7)}-${body.slice(7)}`;
      return `0${body.slice(0, 3)} ${body.slice(3, 7)} ${body.slice(7)}`;
    },
    EMAIL() {
      return `${pick(FIRST).toLowerCase()}.${pick(LAST).toLowerCase()}${int(1, 99)}@${pick(['example.com', 'mail.example.org', 'contoh.co.id', 'test.example.net'])}`;
    },
    CARD() {
      const prefix = pick(['4', '51', '52', '53', '54', '55']);
      const d = luhnComplete(prefix + digits(15 - prefix.length));
      const style = int(0, 2);
      if (style === 1) return d.replace(/(\d{4})(?=\d)/g, '$1 ');
      if (style === 2) return d.replace(/(\d{4})(?=\d)/g, '$1-');
      return d;
    },
    NPWP() {
      const d = digits(15);
      return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}.${d[8]}-${d.slice(9, 12)}.${d.slice(12)}`;
    },
    BANK_ACCOUNT() {
      const style = int(0, 2);
      if (style === 0) return `${digits(4)}-${digits(2)}-${digits(6)}-${digits(2)}-${digits(1)}`;
      if (style === 1) return digits(10);
      return digits(int(12, 15));
    },
    API_KEY() {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      const rand = (n) => Array.from({ length: n }, () => chars[int(0, chars.length - 1)]).join('');
      const style = int(0, 2);
      if (style === 0) return `sk-proj-${rand(32)}`;
      if (style === 1) return `AKIA${rand(16).toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`;
      return `ghp_${rand(36)}`;
    },
    NAME() {
      return r() < 0.6 ? `${pick(FIRST)} ${pick(LAST)}` : pick(FIRST);
    }
  };

  // Templates: {X} = entity slot. Each slot carries its own context cue, as people write them.
  const TEMPLATES = [
    { lang: 'id', t: 'Yth. Customer Care,\nNama: {NAME}\nNIK: {NIK}\nNo. HP: {PHONE}\nMohon bantu rapikan email komplain ini.' },
    { lang: 'id', t: 'Tolong ringkas kontrak ini. Pihak kedua a.n. {NAME}, NPWP {NPWP}, rekening BRI {BANK_ACCOUNT}.' },
    { lang: 'id', t: 'Saya mau komplain, kartu {CARD} terpotong dua kali. Hubungi saya di {PHONE} atau {EMAIL}.' },
    { lang: 'id', t: 'Perbaiki tata bahasa: Dengan hormat, saya {NAME} dengan NIK {NIK} mengajukan permohonan.' },
    { lang: 'id', t: 'Bapak {NAME} minta transfer ke rekening {BANK_ACCOUNT}, konfirmasi lewat email {EMAIL}.' },
    { lang: 'en', t: 'Debug this config, it fails on start:\nAPI_KEY = "{API_KEY}"\nadmin = {EMAIL}' },
    { lang: 'en', t: 'Improve my English: My name is {NAME}, my phone is {PHONE} and my card {CARD} was charged twice.' },
    { lang: 'en', t: 'Summarise this customer row: name: {NAME}, KTP {NIK}, email {EMAIL}, account at BCA {BANK_ACCOUNT}.' },
    { lang: 'id', t: 'Buat surat kuasa untuk Ibu {NAME}, NIK {NIK}, NPWP {NPWP}.\n\nHormat saya,\n{NAME}' }
  ];

  const NEGATIVES = [
    () => `Order ID ${gen.NIK().replace(/\D/g, '')} belum sampai, tolong buat pesan ke kurir.`,
    () => `Nomor resi ${digits(16)} statusnya tertahan, bagaimana cara komplain?`,
    () => `Versi aplikasi ${int(1, 9)}.${int(0, 20)}.${int(0, 99)} rilis tanggal 2026-${pad(int(1, 12), 2)}-${pad(int(1, 28), 2)}.`,
    () => `Harga paket Rp ${int(100, 999)}.${digits(3)}.000 untuk ${int(2, 9)} orang, hitung per orang.`,
    () => `Timestamp ${digits(13)} tolong ubah ke format tanggal.`,
    () => `Invoice ${digits(16)} sudah dibayar, tolong buat ucapan terima kasih.`,
    () => `Jelaskan perbedaan Ibu Kota Jakarta dan Nusantara secara singkat.`,
    () => `Halo Customer Care, jam operasional kantor cabang hari Sabtu sampai jam berapa?`,
    () => `Hash commit ${digits(7)}a${digits(6)} gagal build, kenapa ya?`,
    () => `Tolong terjemahkan: The quarterly report shows ${int(10, 99)}% growth.`
  ];

  function positive() {
    const tpl = pick(TEMPLATES);
    let text = '';
    const entities = [];
    let last = 0;
    const re = /\{([A-Z_]+)\}/g;
    let m;
    const sameName = gen.NAME();
    while ((m = re.exec(tpl.t)) !== null) {
      text += tpl.t.slice(last, m.index);
      const value = m[1] === 'NAME' ? sameName : gen[m[1]]();
      entities.push({ type: m[1], start: text.length, end: text.length + value.length });
      text += value;
      last = m.index + m[0].length;
    }
    text += tpl.t.slice(last);
    return { text, entities, lang: tpl.lang, source: 'synthetic' };
  }

  function negative() {
    return { text: pick(NEGATIVES)(), entities: [], lang: 'id', source: 'synthetic-negative' };
  }

  return { positive, negative, int, pick };
}

/** Build a dataset of nPos positive + nNeg negative items from a fixed seed. */
function buildDataset(seed, nPos, nNeg) {
  const g = make(seed);
  const out = [];
  for (let i = 0; i < nPos; i++) out.push(g.positive());
  for (let i = 0; i < nNeg; i++) out.push(g.negative());
  return out;
}

module.exports = { rng, make, buildDataset };
