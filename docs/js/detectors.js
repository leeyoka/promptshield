// PromptShield structured + rule-based detectors (Indonesia-aware).
// Single source of truth: used by the content script, popup, web demo and Node tests.
// Pure functions only — no DOM, no chrome APIs, no network.
//
// Each finding: { type, start, end, value, confidence, reason }
// Confidence is a heuristic score in [0,1], not a calibrated probability.

var PS_TYPES = (typeof globalThis !== 'undefined' && globalThis.PS_TYPES) ? globalThis.PS_TYPES
  : (typeof require !== 'undefined' ? require('./constants.js').PS_TYPES : {});

(function () {
// Indonesian province codes (first two NIK digits).
const PS_PROVINCES = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21,
  31, 32, 33, 34, 35, 36,
  51, 52, 53,
  61, 62, 63, 64, 65,
  71, 72, 73, 74, 75, 76,
  81, 82,
  91, 92, 93, 94, 95, 96
]);

/** Luhn checksum. @param {string} digits @returns {boolean} */
function psLuhn(digits) {
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}

/**
 * NIK structure: 16 digits, valid province, valid birth date (day + 40 for women),
 * serial != 0000. @param {string} s digits only @returns {boolean}
 */
function psValidNik(s) {
  if (!/^\d{16}$/.test(s)) return false;
  if (!PS_PROVINCES.has(+s.slice(0, 2))) return false;
  let dd = +s.slice(6, 8);
  const mm = +s.slice(8, 10);
  if (dd > 40) dd -= 40;
  if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return false;
  if (s.slice(12) === '0000') return false;
  return true;
}

/** Card network prefix (Visa, Mastercard, Amex, JCB, Discover/UnionPay-like). */
function psCardIin(d) {
  const p2 = +d.slice(0, 2), p4 = +d.slice(0, 4);
  return d[0] === '4' || (p2 >= 51 && p2 <= 55) || (p4 >= 2221 && p4 <= 2720)
    || p2 === 34 || p2 === 37 || p2 === 35 || d[0] === '6';
}

/** Shannon entropy in bits per character. */
function psEntropy(str) {
  const f = {};
  for (const c of str) f[c] = (f[c] || 0) + 1;
  let h = 0;
  for (const k in f) { const p = f[k] / str.length; h -= p * Math.log2(p); }
  return h;
}

// ---------------------------------------------------------------------------
// Context cues (lower-cased text around a candidate)
// ---------------------------------------------------------------------------
const CTX = {
  nik: /\b(nik|ktp|e-?ktp|nomor induk|no\.?\s*induk|kependudukan|identitas)\b/,
  npwp: /\bnpwp\b/,
  passport: /\b(paspor|passport|no\.?\s*paspor|nomor\s+paspor)\b/,
  card: /\b(kartu|card|cc|kredit|credit|debit|visa|mastercard|jcb|amex)\b/,
  bank: /\b(rekening|rek|norek|no\.?\s*rek|account|acc|a\/c|virtual account|va|bri|brimo|bca|bni|mandiri|bsi|btn|cimb|permata|danamon|ocbc|jago|seabank|transfer ke|tf ke)\b/,
  // Non-personal identifiers: lower confidence instead of auto-flagging.
  booking: /\b(booking|pnr|kode|reservasi|konfirmasi|confirmation)\b/,
  boarding: /\b(boarding|gate|seat|flight|penerbangan|pesawat|depart(?:ure)?|berangkat|keberangkatan|bandara|airport|maskapai|tiket|ticket)\b/,
  nonPersonal: /\b(order|pesanan|invoice|inv|resi|awb|tracking|lacak|transaksi|trx|txn|ref|referensi|booking|tiket|ticket|timestamp|serial|imei|sku|kode produk|nomor seri)\b/
};

function before(text, start, n = 40) {
  // Context cues only count on the same line as the candidate.
  const win = text.slice(Math.max(0, start - n), start);
  return win.slice(win.lastIndexOf('\n') + 1).toLowerCase();
}

function digitsOf(s) {
  return s.replace(/\D/g, '');
}

/** True if all separators in a digit run are the same character (or there are none). */
function consistentSeparators(s) {
  const seps = s.replace(/\d/g, '');
  return seps.length === 0 || new Set(seps).size === 1;
}

// Digit run of exactly N digits with optional single separators, not part of a longer run.
function digitRunRegex(minDigits, maxDigits, seps = ' .\\-') {
  const sep = `[${seps}]?`;
  return new RegExp(`(?<!\\d[${seps}]?)\\d(?:${sep}\\d){${minDigits - 1},${maxDigits - 1}}(?!${sep}\\d)`, 'g');
}

// ---------------------------------------------------------------------------
// Individual detectors (return candidates; overlaps resolved later)
// ---------------------------------------------------------------------------
/**
 * Which cue appears closest before the candidate (same line). The nearest label wins, so
 * "NPWP 01.234..., rekening BRI 1234-..." treats the second number as a bank account.
 * @returns {string|null} one of the CTX keys
 */
function nearestCue(ctx, keys) {
  let best = null, pos = -1;
  for (const k of keys) {
    const re = new RegExp(CTX[k].source, 'g');
    let m;
    while ((m = re.exec(ctx)) !== null) {
      if (m.index >= pos) { pos = m.index; best = k; }
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  return best;
}
const ALL_CUES = ['nik', 'npwp', 'passport', 'card', 'bank', 'nonPersonal'];

function detectNik(text, out) {
  const re = digitRunRegex(16, 16);
  let m;
  while ((m = re.exec(text)) !== null) {
    if (!consistentSeparators(m[0])) continue;
    const d = digitsOf(m[0]);
    const cue = nearestCue(before(text, m.index), ALL_CUES);
    if (cue === 'npwp') { out.push(mk(PS_TYPES.NPWP, m, 0.92, 'npwp-16-context')); continue; }
    if (!psValidNik(d)) continue;
    let conf = 0.9, reason = 'nik-structure';
    if (cue === 'nonPersonal') { conf = 0.45; reason = 'nik-structure-but-order-context'; }
    else if (cue === 'nik') { conf = 0.98; reason = 'nik-structure+context'; }
    else if (cue === 'card') { conf = 0.6; reason = 'nik-structure-but-card-context'; }
    else if (cue === 'bank') { conf = 0.6; reason = 'nik-structure-but-bank-context'; }
    out.push(mk(PS_TYPES.NIK, m, conf, reason));
  }
}

function detectNpwp(text, out) {
  // Classic formatted NPWP: 09.254.294.3-407.000
  const fmt = /(?<!\d)\d{2}\.\d{3}\.\d{3}\.\d[.\-]\d{3}\.\d{3}(?!\d)/g;
  let m;
  while ((m = fmt.exec(text)) !== null) out.push(mk(PS_TYPES.NPWP, m, 0.97, 'npwp-format'));
  // 15 digits (plain or separated) when the nearest cue is NPWP.
  const re = digitRunRegex(15, 15);
  while ((m = re.exec(text)) !== null) {
    if (nearestCue(before(text, m.index), ALL_CUES) === 'npwp') out.push(mk(PS_TYPES.NPWP, m, 0.92, 'npwp-15-context'));
  }
}

/**
 * Indonesian passport numbers:
 *   - New format: 1 uppercase letter + 7 digits  (e.g. A1234567)
 *   - Old format: 2 uppercase letters + 6 digits (e.g. AB123456)
 * Not matched when surrounded by other alphanumeric characters.
 * Confidence 0.95 when preceded by a passport cue on the same line; 0.65 otherwise.
 */
function detectPassport(text, out) {
  // (?<![A-Za-z0-9]) prevents matching inside longer alphanumeric strings on the left.
  // (?![A-Za-z0-9]) prevents matching on the right.
  const re = /(?<![A-Za-z0-9])[A-Z]{1,2}\d{6,7}(?![A-Za-z0-9])/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const v = m[0];
    // Enforce exact length rules: 1 letter + 7 digits OR 2 letters + 6 digits.
    const letters = v.replace(/\d/g, '').length;
    const digits  = v.replace(/\D/g, '').length;
    if (!((letters === 1 && digits === 7) || (letters === 2 && digits === 6))) continue;
    const cue = nearestCue(before(text, m.index), ALL_CUES);
    const conf = cue === 'passport' ? 0.95 : 0.65;
    const reason = cue === 'passport' ? 'passport-format+context' : 'passport-format';
    out.push(mk(PS_TYPES.PASSPORT, m, conf, reason));
  }
}

function detectPhone(text, out) {
  const re = /(?<![\d+])(\+62|62|0)[ .\-]?\(?8\d{1,2}\)?(?:[ .\-]?\d){6,9}(?![ .\-]?\d)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const d = digitsOf(m[0]);
    const local = m[1] === '0' ? d.length : d.length - 1; // compare as 0-prefixed length
    if (local < 10 || local > 13) continue;
    let conf = m[1] === '62' ? 0.8 : 0.92;
    if (CTX.nonPersonal.test(before(text, m.index, 20))) conf = 0.5;
    out.push(mk(PS_TYPES.PHONE, m, conf, 'id-mobile'));
  }
}

function detectEmail(text, out) {
  const re = /(?<![\w.%+\-])[A-Za-z0-9._%+\-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9\-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9\-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,24}(?![\w])/g;
  let m;
  while ((m = re.exec(text)) !== null) out.push(mk(PS_TYPES.EMAIL, m, 0.95, 'email'));
}

function detectCard(text, out) {
  const re = digitRunRegex(13, 19, ' \\-');
  let m;
  while ((m = re.exec(text)) !== null) {
    if (!consistentSeparators(m[0])) continue;
    const d = digitsOf(m[0]);
    if (!psLuhn(d) || !psCardIin(d)) continue;
    const cue = nearestCue(before(text, m.index), ALL_CUES);
    let conf = 0.9, reason = 'luhn+iin';
    if (cue === 'card') { conf = 0.97; reason = 'luhn+iin+context'; }
    else if (cue === 'nonPersonal') { conf = 0.5; reason = 'luhn-but-order-context'; }
    else if (cue === 'nik') { conf = 0.55; reason = 'luhn-but-nik-context'; }
    else if (cue === 'bank') { conf = 0.6; reason = 'luhn-but-bank-context'; }
    out.push(mk(PS_TYPES.CARD, m, conf, reason));
  }
}

function detectBankAccount(text, out) {
  const re = digitRunRegex(10, 18);
  let m;
  while ((m = re.exec(text)) !== null) {
    if (nearestCue(before(text, m.index, 45), ALL_CUES) !== 'bank') continue;
    out.push(mk(PS_TYPES.BANK_ACCOUNT, m, 0.85, 'digits+bank-context'));
  }
}

const API_KEY_PATTERNS = [
  [/sk-[A-Za-z0-9_\-]{20,}/g, 'openai/anthropic-style'],
  [/AKIA[A-Z0-9]{16}/g, 'aws-access-key'],
  [/gh[pousr]_[A-Za-z0-9]{36,}/g, 'github-token'],
  [/glpat-[A-Za-z0-9\-_]{20,}/g, 'gitlab-token'],
  [/xox[bpars]-[A-Za-z0-9\-]{20,}/g, 'slack-token'],
  [/AIza[A-Za-z0-9\-_]{35}/g, 'google-api-key'],
  [/ya29\.[A-Za-z0-9\-_]{20,}/g, 'google-oauth'],
  [/\beyJ[A-Za-z0-9_\-]{8,}\.eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}/g, 'jwt']
];

function detectApiKeys(text, out) {
  let m;
  for (const [pat, reason] of API_KEY_PATTERNS) {
    const re = new RegExp(pat.source, 'g');
    while ((m = re.exec(text)) !== null) {
      if (m[0].length >= 16 && psEntropy(m[0]) >= 3.2) out.push(mk(PS_TYPES.API_KEY, m, 0.93, reason));
    }
  }
  const bearer = /\bBearer\s+([A-Za-z0-9\-._~+\/]{20,}=*)/g;
  while ((m = bearer.exec(text)) !== null) {
    const v = m[1];
    if (psEntropy(v) >= 3.5) out.push(mkSub(PS_TYPES.API_KEY, text, m.index + m[0].indexOf(v), v, 0.9, 'bearer'));
  }
  const generic = /(?:key|token|secret|password|passwd|pwd|apikey|api_key|access_token|auth)\s*[=:]\s*(['"]?)([A-Za-z0-9\-_.\/+]{16,})\1/gi;
  while ((m = generic.exec(text)) !== null) {
    const v = m[2];
    if (psEntropy(v) >= 3.5) out.push(mkSub(PS_TYPES.API_KEY, text, m.index + m[0].lastIndexOf(v), v, 0.8, 'assignment+entropy'));
  }
}

// ---------------------------------------------------------------------------
// Boarding pass data (flight number, booking code / PNR, airport code, DDMMM date).
// ---------------------------------------------------------------------------
/** Same-line text on both sides of a candidate, lower-cased. */
function around(text, start, end, n = 60) {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  let lineEnd = text.indexOf('\n', end);
  if (lineEnd === -1) lineEnd = text.length;
  return text.slice(Math.max(lineStart, start - n), Math.min(lineEnd, end + n)).toLowerCase();
}

const IATA_CODES = 'CGK|SUB|DPS|UPG|KNO|BPN|PLM|PDG|PKU|MDC|SOC|JOG|SRG|BDO|MLG|PNK|TIM|AMQ|GTO|MES|HLP|BTH|TKG|DJJ|MKQ|LOP|SIN|KUL|BKK|HKG';

/**
 * Indonesian airline flight numbers: QG 123, GA 456, JT-888, ID7788.
 * The airline code must be upper-case so ordinary words ("in 2024", "id 12") are not flagged.
 */
function detectFlightNumber(text, out) {
  const re = /\b(?:QG|GA|ID|JT|IW|IN|SJ|KD|XN|XT|IL)[ \-]?\d{1,4}\b/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const hit = CTX.boarding.test(around(text, m.index, m.index + m[0].length));
    out.push(mk(PS_TYPES.FLIGHT_NUMBER, m, hit ? 0.92 : 0.75, hit ? 'flight-number+context' : 'flight-number'));
  }
}

/**
 * Booking code / PNR: 6 upper-case letters+digits, or 2-3 letters + 3-4 digits.
 * High confidence only after "booking / PNR / kode / reservasi / konfirmasi" on the same line;
 * a bare all-caps 6-char token is reported below the default threshold (listed unticked).
 */
function detectBookingCode(text, out) {
  const re = /(?<![A-Za-z0-9])(?:[A-Z]{2,3}\d{3,4}|[A-Z0-9]{6})(?![A-Za-z0-9])/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const v = m[0];
    if (!/[A-Z]/.test(v)) continue; // digit-only runs belong to the other detectors
    if (CTX.booking.test(before(text, m.index, 40))) {
      out.push(mk(PS_TYPES.BOOKING_CODE, m, 0.9, 'booking-code+context'));
    } else if (v.length === 6) {
      const mixed = /\d/.test(v);
      out.push(mk(PS_TYPES.BOOKING_CODE, m, mixed ? 0.65 : 0.5, mixed ? 'booking-code-shape' : 'all-caps-6'));
    }
  }
}

/**
 * Airport codes from a fixed list (upper-case only, so "sin"/"tim" in prose are ignored).
 * Higher confidence inside a route ("CGK - DPS", "SUB→UPG") or near flight words.
 */
function detectIataAirport(text, out) {
  const re = new RegExp(`\\b(?:${IATA_CODES})\\b`, 'g');
  const route = new RegExp(`\\b(?:${IATA_CODES})\\s*(?:-|–|—|>|→|\\/|to|ke)\\s*(?:${IATA_CODES})\\b`, 'g');
  const routes = [];
  let r;
  while ((r = route.exec(text)) !== null) {
    routes.push([r.index, r.index + r[0].length]);
    route.lastIndex = r.index + 3; // allow chained routes: CGK-DPS-LOP
  }
  let m;
  while ((m = re.exec(text)) !== null) {
    const inRoute = routes.some(([s, e]) => m.index >= s && m.index < e);
    const hit = inRoute || CTX.boarding.test(around(text, m.index, m.index + m[0].length));
    out.push(mk(PS_TYPES.IATA_AIRPORT, m, hit ? 0.85 : 0.6, hit ? 'iata+context' : 'iata'));
  }
}

/** Boarding-pass date in DDMMM form: 19NOV, 25DEC, 01JAN. */
function detectBoardingDate(text, out) {
  const re = /\b(?:0[1-9]|[12]\d|3[01])(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const hit = CTX.boarding.test(around(text, m.index, m.index + m[0].length));
    out.push(mk(PS_TYPES.BOARDING_DATE, m, hit ? 0.88 : 0.75, hit ? 'ddmmm+context' : 'ddmmm'));
  }
}

// ---------------------------------------------------------------------------
// Names (rule-based, Indonesian + English cues). Not NER — see docs/LIMITATIONS.md.
// ---------------------------------------------------------------------------
const NAME_W = "[A-Z][a-z'’]+(?:-[A-Za-z][a-z'’]+)?";
const NAME = `${NAME_W}(?:[ \\t]+${NAME_W}){0,3}`;
const NAME_UPPER = '[A-Z]{2,}(?:[ \\t]+[A-Z]{2,}){0,3}';

const NAME_STOP = new Set([
  'Customer', 'Care', 'Service', 'Bank', 'Tim', 'Team', 'Admin', 'Direksi', 'Direktur', 'Manager', 'Manajer',
  'Bapak', 'Ibu', 'Pak', 'Bu', 'Kota', 'Presiden', 'Menteri', 'Sir', 'Madam', 'Semua', 'All', 'Kami', 'Saya',
  'Anda', 'Kamu', 'Terima', 'Kasih', 'Tolong', 'Mohon', 'Halo', 'Hai', 'Hi', 'Dear', 'Yth', 'Kepada', 'PT', 'CV',
  'Tbk', 'Persero', 'Indonesia', 'Jakarta', 'Rakyat', 'Negara', 'BRI', 'BCA', 'BNI', 'Mandiri', 'Support',
  'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu', 'The', 'This', 'There', 'Hello', 'Everyone',
  'Teman', 'Rekan', 'Guru', 'Dosen', 'Pembimbing', 'Nasabah', 'Pelanggan', 'Pengguna', 'User', 'Sales', 'Hormat',
  'Dengan', 'Untuk', 'Dari', 'Yang', 'Dan', 'Atau', 'Nama', 'Name', 'Lengkap', 'Assistant', 'Chat', 'Gpt'
]);

const NAME_RULES = [
  [new RegExp(`\\b(?:[Nn]ama(?:[ \\t]+[Ll]engkap)?|[Ff]ull[ \\t]+[Nn]ame|[Nn]ame)[ \\t]*[:=][ \\t]*(${NAME}|${NAME_UPPER})`, 'g'), 0.9, 'label-nama'],
  [new RegExp(`\\b(?:[Aa]\\.[ \\t]?[Nn]\\.?|[Aa]tas[ \\t]+[Nn]ama)[ \\t]*(${NAME}|${NAME_UPPER})`, 'g'), 0.88, 'atas-nama'],
  [new RegExp(`\\b(?:[Nn]ama[ \\t]+saya(?:[ \\t]+adalah)?|[Ss]aya[ \\t]+bernama|[Mm]y[ \\t]+name[ \\t]+is)[ \\t]+(${NAME})`, 'g'), 0.85, 'self-intro'],
  // "saya Rina Sari, ..." / "saya Rina Sari dengan NIK ..." (capitalised words right after "saya")
  [new RegExp(`\\b[Ss]aya[ \\t]+(${NAME})(?=[ \\t]*(?:,|dengan\\b|selaku\\b|dari\\b|yang\\b|\\(|$))`, 'gm'), 0.75, 'saya-name'],
  [new RegExp(`\\b(?:Bapak|Bpk\\.?|Bp\\.|Ibu|Bu|Pak|Sdr\\.?|Sdri\\.?|Saudara|Saudari|Mr\\.?|Mrs\\.?|Ms\\.?|Mbak|Mas|Kak|Dr\\.|dr\\.)[ \\t]+(${NAME})`, 'g'), 0.8, 'honorific'],
  [new RegExp(`\\b(?:Yth\\.?|Kepada(?:[ \\t]+Yth\\.?)?|Dear)[ \\t]+(?:(?:Bapak|Ibu|Bpk\\.?|Mr\\.?|Mrs\\.?|Ms\\.?)[ \\t]+)?(${NAME})`, 'g'), 0.75, 'salutation'],
  [new RegExp(`(?:Hormat[ \\t]+saya|Salam|Regards|Best[ \\t]+regards|Sincerely|Terima[ \\t]+kasih|Thanks|Wassalam)[,.!]?[ \\t]*\\r?\\n+[ \\t]*(${NAME})[ \\t]*(?=\\r?\\n|$)`, 'g'), 0.8, 'signature']
];

function cleanName(raw) {
  const words = raw.split(/[ \t]+/);
  while (words.length && NAME_STOP.has(capitalize(words[words.length - 1]))) words.pop();
  if (!words.length || NAME_STOP.has(capitalize(words[0]))) return null;
  const name = words.join(' ');
  return name.length >= 3 ? name : null;
}

function capitalize(w) {
  return w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w;
}

function detectNames(text, out) {
  for (const [re, conf, reason] of NAME_RULES) {
    const r = new RegExp(re.source, re.flags);
    let m;
    while ((m = r.exec(text)) !== null) {
      const raw = m[1];
      const name = cleanName(raw);
      if (!name) continue;
      const start = m.index + m[0].lastIndexOf(raw);
      out.push(mkSub(PS_TYPES.NAME, text, start, name, conf, reason));
    }
  }
}

// ---------------------------------------------------------------------------
function mk(type, m, confidence, reason) {
  return { type, start: m.index, end: m.index + m[0].length, value: m[0], confidence, reason };
}

function mkSub(type, text, start, value, confidence, reason) {
  return { type, start, end: start + value.length, value, confidence, reason };
}

/**
 * Deterministic overlap resolution: highest confidence wins, then longer span, then earlier start.
 * Never returns two findings that overlap.
 */
function psResolveOverlaps(cands) {
  const sorted = [...cands].sort((a, b) =>
    (b.confidence - a.confidence) || ((b.end - b.start) - (a.end - a.start)) || (a.start - b.start));
  const kept = [];
  for (const c of sorted) {
    if (!kept.some((k) => c.start < k.end && c.end > k.start)) kept.push(c);
  }
  return kept.sort((a, b) => a.start - b.start);
}

/**
 * Scan text for sensitive data.
 * @param {string} text
 * @param {{enabledTypes?: Object<string, boolean>}} [opts]
 * @returns {Array<{type:string,start:number,end:number,value:string,confidence:number,reason:string}>}
 */
function psDetectAll(text, opts) {
  if (!text || typeof text !== 'string') return [];
  const cands = [];
  detectNik(text, cands);
  detectNpwp(text, cands);
  detectPassport(text, cands);
  detectPhone(text, cands);
  detectEmail(text, cands);
  detectCard(text, cands);
  detectBankAccount(text, cands);
  detectApiKeys(text, cands);
  detectNames(text, cands);
  detectFlightNumber(text, cands);
  detectBookingCode(text, cands);
  detectIataAirport(text, cands);
  detectBoardingDate(text, cands);
  const enabled = opts && opts.enabledTypes;
  const filtered = enabled ? cands.filter((c) => enabled[c.type] !== false) : cands;
  return psResolveOverlaps(filtered);
}

if (typeof globalThis !== 'undefined') {
  globalThis.PS_PROVINCES = PS_PROVINCES;
  globalThis.psLuhn = psLuhn;
  globalThis.psValidNik = psValidNik;
  globalThis.psCardIin = psCardIin;
  globalThis.psEntropy = psEntropy;
  globalThis.psResolveOverlaps = psResolveOverlaps;
  globalThis.psDetectAll = psDetectAll;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PS_PROVINCES, psLuhn, psValidNik, psCardIin, psEntropy, psResolveOverlaps, psDetectAll };
}
})();
