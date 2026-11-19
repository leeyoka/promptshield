// PromptShield document-photo analysis (used by the side panel's image scanner).
// Pure functions, no DOM and no network: they work on OCR text and on raw RGBA pixel buffers,
// so the same code runs in the extension and in Node tests.
//
//   psDocScan.enhance(img)            grayscale + contrast stretch (in place)
//   psDocScan.binarize(img)           adaptive (Bradley) threshold, robust to glare and patterned backgrounds
//   psDocScan.fixDigits(text)         undo OCR look-alikes inside number-like tokens (O->0, I->1, S->5, ...)
//   psDocScan.classify(text)          fuzzy document-type scoring from printed field labels
//   psDocScan.analyze(text, detect)   classify + PII findings -> {docType, fields, findings, sensitive}
//
// OCR on phone photos is noisy ("Kecamatan" -> "Kec amalan", "NIK" -> "MK."), so labels are matched
// approximately on each line with spaces/punctuation removed, and a real KTP is recognised by its
// field labels even when the NIK digits are misread. Real e-KTPs do not print "KARTU TANDA PENDUDUK".
'use strict';

var psDocScan = (function () {
  // ---------------------------------------------------------------------------
  // Pixel helpers. img = {data: Uint8ClampedArray RGBA, width, height}
  // ---------------------------------------------------------------------------
  function enhance(img) {
    const { data, width, height } = img;
    const n = width * height;
    const gray = new Uint8ClampedArray(n);
    const hist = new Uint32Array(256);
    // Brightest channel, not luminance: Indonesian cards print black text on coloured security patterns
    // (blue KTP waves, green passport, etc.). In the max channel that pattern is almost flat while
    // black ink stays dark, so the text survives and the pattern disappears.
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      gray[i] = Math.max(data[p], data[p + 1], data[p + 2]);
      hist[gray[i]]++;
    }
    // Stretch the 1st..99th percentile to the full range.
    let lo = 0, hi = 255, acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.01) { lo = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= n * 0.01) { hi = v; break; } }
    const span = Math.max(1, hi - lo);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const v = Math.max(0, Math.min(255, ((gray[i] - lo) * 255) / span));
      data[p] = data[p + 1] = data[p + 2] = v;
      data[p + 3] = 255;
    }
    return img;
  }

  /** Bradley adaptive threshold on an (already grayscale) image, in place. */
  function binarize(img, opts) {
    const { data, width: w, height: h } = img;
    const t = (opts && opts.t) || 0.15;
    const s = Math.max(15, Math.round(((opts && opts.window) || Math.max(w, h) / 36)) | 1);
    const half = s >> 1;
    const integ = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        row += data[(y * w + x) * 4];
        integ[(y + 1) * (w + 1) + x + 1] = integ[y * (w + 1) + x + 1] + row;
      }
    }
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - half), y1 = Math.min(h - 1, y + half);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - half), x1 = Math.min(w - 1, x + half);
        const count = (x1 - x0 + 1) * (y1 - y0 + 1);
        const sum = integ[(y1 + 1) * (w + 1) + x1 + 1] - integ[y0 * (w + 1) + x1 + 1]
          - integ[(y1 + 1) * (w + 1) + x0] + integ[y0 * (w + 1) + x0];
        const p = (y * w + x) * 4;
        const v = data[p] * count < sum * (1 - t) ? 0 : 255;
        data[p] = data[p + 1] = data[p + 2] = v;
      }
    }
    return img;
  }

  // ---------------------------------------------------------------------------
  // Text helpers
  // ---------------------------------------------------------------------------
  const LOOKALIKE = { O: '0', o: '0', D: '0', Q: '0', U: '0', I: '1', l: '1', '|': '1', '!': '1', i: '1', L: '1', J: '1',
    Z: '2', z: '2', S: '5', s: '5', B: '8', G: '6', b: '6', T: '7', g: '9', q: '9', A: '4' };

  /** In tokens that are mostly digits (>= 8 chars, >= 60% digits), replace letter look-alikes with digits. */
  function fixDigits(text) {
    return String(text || '').replace(/[0-9A-Za-z|!]{8,}/g, (tok) => {
      const digits = (tok.match(/\d/g) || []).length;
      if (digits / tok.length < 0.6) return tok;
      return tok.replace(/[^0-9]/g, (c) => LOOKALIKE[c] || c);
    });
  }

  /** Smallest edit distance between `pat` and any substring of `txt` (Sellers' algorithm). */
  function fuzzyFind(pat, txt) {
    const m = pat.length;
    let prev = new Array(m + 1), cur = new Array(m + 1);
    for (let i = 0; i <= m; i++) prev[i] = i;
    let best = m;
    for (let j = 1; j <= txt.length; j++) {
      cur[0] = 0;
      const c = txt.charCodeAt(j - 1);
      for (let i = 1; i <= m; i++) {
        const cost = pat.charCodeAt(i - 1) === c ? 0 : 1;
        cur[i] = Math.min(prev[i - 1] + cost, prev[i] + 1, cur[i - 1] + 1);
      }
      if (cur[m] < best) best = cur[m];
      const tmp = prev; prev = cur; cur = tmp;
    }
    return best;
  }

  /** Allowed OCR errors for a marker of this length. */
  const tolerance = (len) => (len <= 5 ? 0 : len <= 8 ? 1 : len <= 12 ? 2 : 3);

  // ---------------------------------------------------------------------------
  // Document types. Markers are written as they appear on the card, uppercase, letters only.
  // weight 3 = decisive on its own; 1 = supporting. A type needs score >= 3.
  // field = a personal-data field this label reveals (shown to the user).
  // ---------------------------------------------------------------------------
  const DOCS = [
    { type: 'KK', markers: [
      ['KARTUKELUARGA', 3], ['KEPALAKELUARGA', 3], ['HUBUNGANDALAMKELUARGA', 3], ['STATUSHUBUNGAN', 2],
      ['NAMAAYAH', 1, 'nameParents'], ['NAMAIBU', 1, 'nameParents'], ['DOKUMENIMIGRASI', 2], ['PENDIDIKAN', 1]] },
    { type: 'PASSPORT', markers: [
      ['PASPOR', 3], ['PASSPORT', 3], ['KODENEGARA', 1], ['COUNTRYCODE', 1], ['DATEOFEXPIRY', 2],
      ['TANGGALHABISBERLAKU', 2], ['TEMPATDIKELUARKAN', 2], ['PLACEOFISSUE', 2], ['NATIONALITY', 1, 'nationality']] },
    { type: 'SIM', markers: [
      ['SURATIZINMENGEMUDI', 3], ['DRIVINGLICENSE', 3], ['DRIVINGLICENCE', 3], ['KORLANTAS', 2]] },
    { type: 'BPJS', markers: [
      ['BPJSKESEHATAN', 3], ['BPJSKETENAGAKERJAAN', 3], ['KARTUINDONESIASEHAT', 3], ['JAMINANKESEHATAN', 2],
      ['JAMINANSOSIAL', 2], ['FASKES', 1]] },
    { type: 'NPWP_CARD', markers: [
      ['NOMORPOKOKWAJIBPAJAK', 3], ['DIREKTORATJENDERALPAJAK', 3], ['KEMENTERIANKEUANGAN', 1], ['NPWP', 3]] },
    { type: 'BUKU_REKENING', markers: [
      ['BUKUTABUNGAN', 3], ['BUKUREKENING', 3], ['NOMORREKENING', 2, 'account'], ['NOREKENING', 2, 'account'],
      ['TABUNGAN', 1], ['SALDO', 1], ['MUTASI', 1], ['BANKRAKYATINDONESIA', 1], ['BANKCENTRALASIA', 1],
      ['BANKNEGARAINDONESIA', 1], ['BANKMANDIRI', 1], ['BANKSYARIAH', 1]] },
    { type: 'STR', markers: [
      ['SURATTANDAREGISTRASI', 3], ['KONSILKEDOKTERAN', 2], ['KONSILTENAGAKESEHATAN', 2]] },
    { type: 'KTP', markers: [
      ['KARTUTANDAPENDUDUK', 3], ['PROVINSI', 1], ['KABUPATEN', 1], ['TEMPATTGLLAHIR', 1, 'birth'],
      ['JENISKELAMIN', 1, 'sex'], ['GOLDARAH', 1, 'blood'], ['ALAMAT', 1, 'address'], ['KELDESA', 1, 'address'],
      ['KECAMATAN', 1, 'address'], ['STATUSPERKAWINAN', 1, 'marital'], ['PEKERJAAN', 1, 'job'],
      ['KEWARGANEGARAAN', 1, 'nationality'], ['BERLAKUHINGGA', 1], ['SEUMURHIDUP', 1], ['PEREMPUAN', 1, 'sex'],
      ['LAKILAKI', 1, 'sex'], ['BELUMKAWIN', 1, 'marital'], ['AGAMA', 1, 'religion']] }
  ];

  const FIELD_LABELS = {
    nik: { id: 'NIK', en: 'NIK (ID number)' },
    name: { id: 'Nama', en: 'Name' },
    birth: { id: 'Tempat/Tgl Lahir', en: 'Place/date of birth' },
    sex: { id: 'Jenis Kelamin', en: 'Sex' },
    blood: { id: 'Golongan Darah', en: 'Blood type' },
    address: { id: 'Alamat', en: 'Address' },
    marital: { id: 'Status Perkawinan', en: 'Marital status' },
    job: { id: 'Pekerjaan', en: 'Occupation' },
    religion: { id: 'Agama', en: 'Religion' },
    nationality: { id: 'Kewarganegaraan', en: 'Nationality' },
    nameParents: { id: 'Nama Orang Tua', en: "Parents' names" },
    account: { id: 'No. Rekening', en: 'Account number' },
    mrz: { id: 'Kode MRZ paspor', en: 'Passport MRZ' }
  };

  function lineKeys(text) {
    return String(text || '').toUpperCase().split(/\r?\n/).map((l) => l.replace(/[^A-Z]/g, '')).filter((l) => l.length >= 3);
  }

  /**
   * @param {string} text OCR output
   * @returns {{type:(string|null), score:number, scores:Object<string,number>, fields:string[]}}
   */
  function classify(text) {
    const raw = String(text || '');
    const lines = lineKeys(raw);
    const upper = raw.toUpperCase();
    const scores = {};
    const fieldsByType = {};
    for (const doc of DOCS) {
      let score = 0;
      const fields = new Set();
      for (const [marker, weight, field] of doc.markers) {
        const tol = tolerance(marker.length);
        const hit = tol === 0
          ? lines.some((l) => l.includes(marker))
          : lines.some((l) => l.length >= marker.length - tol && fuzzyFind(marker, l) <= tol);
        if (hit) { score += weight; if (field) fields.add(field); }
      }
      scores[doc.type] = score;
      fieldsByType[doc.type] = fields;
    }

    // Strong structural signals.
    if (/P[<«K]IDN/.test(upper.replace(/\s/g, ''))) { scores.PASSPORT += 3; fieldsByType.PASSPORT.add('mrz'); }
    const nikLabel = /(^|\n)\s*[NM][I1lL|!]?[KX]\b/i.test(raw) || /\bNIK\b/i.test(raw);
    const longDigits = /\d{12,}/.test(fixDigits(raw).replace(/[ .\-]/g, ''));
    // "NIK: <number>" alone is any form or letter; it only counts as a card when a printed KTP
    // label is also present (PROVINSI, Kecamatan, ...).
    const cardLabels = scores.KTP > 0;
    if (nikLabel && longDigits && cardLabels) { scores.KTP += 3; fieldsByType.KTP.add('nik'); }
    else if ((nikLabel || longDigits) && cardLabels) scores.KTP += 1;
    if (/\bNAMA\b|\bNAME\b/.test(upper)) { for (const d of DOCS) fieldsByType[d.type].add('name'); }

    // KK and KTP share many labels; a decisive KK marker wins over KTP.
    let best = null, bestScore = 0;
    for (const doc of DOCS) {
      const sc = scores[doc.type];
      if (sc >= 3 && sc > bestScore) { best = doc.type; bestScore = sc; }
    }
    if (best === 'KTP' && scores.KK >= 3) best = 'KK';
    const fields = best ? [...fieldsByType[best]] : [];
    if (best === 'KTP' || best === 'KK') fields.unshift('nik');
    // A "NIK" label next to a long number is sensitive even when the document type is unclear
    // (e.g. a small, blurry card where only that line is readable).
    const nikVisible = nikLabel && longDigits;
    if (!best && nikVisible) fields.push('nik');
    return { type: best, score: bestScore, scores, fields: [...new Set(fields)], nikVisible };
  }

  /**
   * Full analysis of OCR text.
   * @param {string} text
   * @param {(t:string)=>Array} [detectAll] usually psDetectAll
   */
  function analyze(text, detectAll) {
    const raw = String(text || '');
    const fixed = fixDigits(raw);
    const cls = classify(raw);
    let findings = [];
    if (typeof detectAll === 'function') {
      const seen = new Set();
      for (const t of [raw, fixed]) {
        for (const f of detectAll(t)) {
          const k = f.type + '\u0000' + (f.value.replace(/\D/g, '') || f.value);
          if (!seen.has(k)) { seen.add(k); findings.push(f); }
        }
      }
    }
    // A lone low-confidence "name" guess on a random photo is not enough to warn.
    const strong = findings.filter((f) => f.confidence >= 0.7 && f.type !== 'NAME');
    return {
      docType: cls.type,
      fields: cls.fields,
      scores: cls.scores,
      findings,
      sensitive: !!cls.type || cls.nikVisible || strong.length > 0
    };
  }

  return { enhance, binarize, fixDigits, fuzzyFind, classify, analyze, FIELD_LABELS };
})();

if (typeof globalThis !== 'undefined') globalThis.psDocScan = psDocScan;
if (typeof module !== 'undefined' && module.exports) module.exports = { psDocScan };
