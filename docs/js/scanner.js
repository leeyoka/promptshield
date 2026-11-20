// PromptShield website: language toggle, tabs, and the on-page scanner (text, image, PDF).
// Detection uses the same engine as the extension (copied from promptshield/src/shared):
//   js/constants.js, js/detectors.js (psDetectAll), js/doc-scan.js (psDocScan).
// Re-copy those three files whenever the extension's detectors change.
//
// Nothing the user scans leaves the browser. Tesseract.js (OCR engine + Indonesian/English data)
// and PDF.js are self-hosted under vendor/ and cached by the service worker (sw.js), so photo and
// PDF scans also work offline. Opened as a local file (file://) the page falls back to the CDN,
// because browsers do not allow workers to load from file:// URLs.
'use strict';

(() => {
  // DEBUG-gated log for OCR skipped on one image/page (error message only, never content).
  const DEBUG = false;
  const ocrSkipped = (err) => { if (DEBUG) console.debug('[PromptShield] OCR skipped:', (err && err.message) || err); };
  // Set this to the Chrome Web Store listing once published. Until then the install buttons
  // scroll to the "load unpacked" instructions on this page.
  const INSTALL_URL = '';

  const IS_FILE = location.protocol === 'file:';
  const local = (p) => new URL(p, location.href).href;
  const CDN = IS_FILE ? {
    tesseract: 'https://unpkg.com/tesseract.js@5.0.4/dist/tesseract.min.js',
    pdfjs: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    pdfWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
  } : {
    tesseract: local('vendor/tesseract/tesseract.min.js'),
    pdfjs: local('vendor/pdfjs/pdf.min.js'),
    pdfWorker: local('vendor/pdfjs/pdf.worker.min.js')
  };
  // Self-hosted OCR engine + language data (same files the extension ships), so no CDN is needed.
  const TESSERACT_LOCAL = IS_FILE ? {} : {
    workerPath: local('vendor/tesseract/worker.min.js'),
    corePath: local('vendor/tesseract/core'),
    langPath: local('vendor/tesseract/lang'),
    workerBlobURL: false
  };

  const STRINGS = {
    id: {
      skip: 'Langsung ke scanner',
      nav_product: 'PromptShield',
      nav_cta: 'Pasang di Chrome',
      nav_energy: 'Energi',
      hero_tag: 'Privasi · AI · Indonesia',
      hero_title: 'Jaga datamu.<br><em>Sebelum masuk ke AI.</em>',
      hero_sub: 'PromptShield mendeteksi NIK, NPWP, nomor rekening, dan data sensitif lainnya sebelum kamu kirim ke ChatGPT, Gemini, atau AI mana pun.',
      hero_cta1: 'Pasang di Chrome →',
      card_nik_label: 'NIK terdeteksi',
      card_nik_note: 'Disembunyikan otomatis',
      card_ok_title: 'Teks aman',
      card_ok_sub: 'Tidak ada data sensitif',
      card_ok_badge: '✓ Siap dikirim ke AI',
      hero_cta2: 'Coba Scanner',
      trust_local: '100% Lokal',
      trust_realtime: 'Real-time',
      trust_id: 'Khusus Indonesia',
      scanner_title: 'Cek dokumenmu sekarang',
      scanner_sub: 'Tanpa dikirim ke server. Semua diproses di browsermu.',
      tab_text: 'Tempel Teks',
      tab_image: 'Foto/Gambar',
      tab_pdf: 'PDF',
      text_placeholder: 'Tempel teks yang ingin kamu cek di sini…',
      text_cta: 'Scan Teks',
      text_sample: 'Pakai contoh',
      drop_label: 'Jatuhkan foto atau klik untuk pilih',
      drop_sub: 'JPG, PNG, WEBP — diproses lokal dengan OCR',
      pdf_label: 'Jatuhkan PDF atau klik untuk pilih',
      pdf_sub: 'Teks diekstrak lokal, tidak ada yang dikirim',
      scanning: 'Memindai…',
      loading_ocr: 'Menyiapkan OCR… (sekali saja)',
      loading_lang: (p) => `Mengunduh model bahasa… ${p}%`,
      loading_pdf: 'Menyiapkan pembaca PDF…',
      ocr_step: (i, n) => `Mencoba sudut/pengolahan lain… (${i}/${n})`,
      pdf_reading: (i, n) => `Membaca halaman ${i} dari ${n}…`,
      pdf_ocr: (i, n) => `Halaman ${i} berupa gambar, membaca dengan OCR… (${i}/${n})`,
      result_clean: 'Tidak ada data sensitif terdeteksi.',
      result_clean_body: 'Teks ini aman untuk dikirim ke AI.',
      result_clean_body_file: 'Tidak ada pola data sensitif Indonesia yang dikenali di file ini.',
      result_found: (n) => `${n} data sensitif ditemukan`,
      result_found_body: 'Pertimbangkan untuk menghapus atau menyamarkan data berikut sebelum mengirim ke AI.',
      result_doc: (d) => `${d} terdeteksi`,
      result_generic: 'Data sensitif terdeteksi',
      result_toggle_body: 'Semua data disamarkan. Matikan sakelar untuk data yang boleh tetap terlihat.',
      allowed_hint: 'Diizinkan', mask_this: 'Disamarkan', allow_this: 'Diizinkan (tidak disamarkan)',
      copy_safe: 'Salin teks aman',
      copy_done: (m, a) => `Tersalin. ${m} data dilindungi · ${a} diizinkan`,
      copy_failed: 'Gagal menyalin. Tidak ada yang disalin; coba lagi.',
      redact_covers: 'Versi aman sudah mencakup semua data di atas',
      visible_field: 'terlihat',
      redact_title: 'Versi dokumen yang aman:',
      redact_download: '⬇ Download versi aman',
      redact_none: 'Lokasi data sensitif di foto tidak dapat ditentukan, jadi versi aman otomatis tidak tersedia. Tutupi data secara manual sebelum membagikan foto ini.',
      redact_safe: '✓ Dokumen aman, tidak ada PII ditemukan',
      err_title: 'Tidak bisa memindai file ini.',
      err_notext: 'Teks tidak terbaca. Coba foto yang lebih jelas dan terang.',
      err_pdf: 'PDF tidak bisa dibuka. Mungkin rusak atau dilindungi kata sandi.',
      err_network: 'Gagal memuat OCR/pembaca PDF. Muat ulang halaman lalu coba lagi. Jika sedang offline, buka halaman ini sekali saat online agar bisa dipakai tanpa internet.',
      pwa_install: 'Pasang di HP',
      pwa_install_desktop: 'Pasang aplikasi',
      err_type: 'Jenis file tidak didukung.',
      ondevice: '100% di perangkatmu · tanpa server · tanpa API',
      how_title: 'Cara kerja',
      how_1_title: 'Ekstensi berjalan di browser',
      how_1_body: 'PromptShield aktif saat kamu membuka ChatGPT atau Gemini. Deteksi berjalan sepenuhnya di perangkatmu, tanpa server.',
      how_2_title: 'Deteksi sebelum kirim',
      how_2_body: 'Saat kamu mengetik atau menempel teks, ekstensi mendeteksi NIK, NPWP, nama, nomor HP, dan pola sensitif Indonesia lainnya.',
      how_3_title: 'Sensor otomatis',
      how_3_body: 'Data sensitif diganti token seperti [NIK_1]. AI tetap bisa menjawab pertanyaanmu tanpa melihat data aslinya.',
      install_title: 'Pasang ekstensi',
      install_sub: 'PromptShield belum ada di Chrome Web Store. Pasang langsung dari folder proyek:',
      install_1: 'Buka <code>chrome://extensions</code> dan nyalakan <strong>Developer mode</strong>.',
      install_2: 'Klik <strong>Load unpacked</strong>, lalu pilih folder <code>promptshield/</code> (yang berisi <code>manifest.json</code>).',
      install_3: 'Buka chatgpt.com, atau tekan <code>Alt+Shift+P</code> untuk panel samping di situs lain.',
      footer_copy: '© 2025 PromptShield · Team Open Minded · Techtonic 3.0'
    },
    en: {
      skip: 'Skip to scanner',
      nav_product: 'PromptShield',
      nav_cta: 'Add to Chrome',
      nav_energy: 'Energy',
      hero_tag: 'Privacy · AI · Indonesia',
      hero_title: 'Protect your data.<br><em>Before it reaches AI.</em>',
      hero_sub: 'PromptShield detects Indonesian ID numbers, tax IDs, bank accounts, and other sensitive data before you send them to ChatGPT, Gemini, or any AI.',
      hero_cta1: 'Add to Chrome →',
      card_nik_label: 'NIK detected',
      card_nik_note: 'Hidden automatically',
      card_ok_title: 'Text is safe',
      card_ok_sub: 'No sensitive data',
      card_ok_badge: '✓ Ready to send to AI',
      hero_cta2: 'Try Scanner',
      trust_local: '100% Local',
      trust_realtime: 'Real-time',
      trust_id: 'Built for Indonesia',
      scanner_title: 'Check your document now',
      scanner_sub: 'Nothing is sent to a server. Everything is processed in your browser.',
      tab_text: 'Paste Text',
      tab_image: 'Photo/Image',
      tab_pdf: 'PDF',
      text_placeholder: 'Paste the text you want to check here…',
      text_cta: 'Scan Text',
      text_sample: 'Use sample',
      drop_label: 'Drop a photo or click to choose',
      drop_sub: 'JPG, PNG, WEBP — processed locally with OCR',
      pdf_label: 'Drop a PDF or click to choose',
      pdf_sub: 'Text is extracted locally, nothing is sent anywhere',
      scanning: 'Scanning…',
      loading_ocr: 'Preparing OCR… (one time only)',
      loading_lang: (p) => `Downloading language model… ${p}%`,
      loading_pdf: 'Preparing PDF reader…',
      ocr_step: (i, n) => `Trying another angle/enhancement… (${i}/${n})`,
      pdf_reading: (i, n) => `Reading page ${i} of ${n}…`,
      pdf_ocr: (i, n) => `Page ${i} is an image, reading it with OCR… (${i}/${n})`,
      result_clean: 'No sensitive data detected.',
      result_clean_body: 'This text looks safe to send to an AI.',
      result_clean_body_file: 'No sensitive Indonesian data patterns were recognised in this file.',
      result_found: (n) => `${n} sensitive item${n > 1 ? 's' : ''} found`,
      result_found_body: 'Consider removing or masking the following before sending to an AI.',
      result_doc: (d) => `${d} detected`,
      result_generic: 'Sensitive data detected',
      result_toggle_body: 'Everything is masked. Switch off any item that may stay visible.',
      allowed_hint: 'Allowed', mask_this: 'Masked', allow_this: 'Allowed (not masked)',
      copy_safe: 'Copy safe text',
      copy_done: (m, a) => `Copied. ${m} protected · ${a} allowed`,
      copy_failed: 'Copy failed. Nothing was copied; try again.',
      redact_covers: 'The safe version already covers all the data above',
      visible_field: 'visible',
      redact_title: 'Safe document version:',
      redact_download: '⬇ Download safe version',
      redact_none: 'Could not locate the sensitive data in the photo, so no automatic safe version is available. Cover it manually before sharing this photo.',
      redact_safe: '✓ Document is safe, no PII found',
      err_title: 'Could not scan this file.',
      err_notext: 'No readable text. Try a sharper, brighter photo.',
      err_pdf: 'The PDF could not be opened. It may be damaged or password-protected.',
      err_network: 'Could not load the OCR/PDF reader. Reload the page and try again. If you are offline, open this page once while online so it works without internet.',
      pwa_install: 'Install on phone',
      pwa_install_desktop: 'Install app',
      err_type: 'This file type is not supported.',
      ondevice: '100% on-device · no server · no API',
      how_title: 'How it works',
      how_1_title: 'Extension runs in your browser',
      how_1_body: 'PromptShield is active when you open ChatGPT or Gemini. Detection runs entirely on your device, with no server.',
      how_2_title: 'Detects before you send',
      how_2_body: 'As you type or paste, the extension flags NIK, NPWP, names, phone numbers, and other Indonesian sensitive patterns.',
      how_3_title: 'Automatic masking',
      how_3_body: 'Sensitive data is replaced with tokens like [NIK_1]. The AI still answers your question without seeing the real data.',
      install_title: 'Install the extension',
      install_sub: 'PromptShield is not on the Chrome Web Store yet. Install it from the project folder:',
      install_1: 'Open <code>chrome://extensions</code> and turn on <strong>Developer mode</strong>.',
      install_2: 'Click <strong>Load unpacked</strong> and choose the <code>promptshield/</code> folder (the one with <code>manifest.json</code>).',
      install_3: 'Open chatgpt.com, or press <code>Alt+Shift+P</code> for the side panel on any other site.',
      footer_copy: '© 2025 PromptShield · Team Open Minded · Techtonic 3.0'
    }
  };

  const SAMPLE = `Halo, tolong rapikan email ini.
Nama: Rina Sari
NIK: 3171016408980002
No. HP: 081298765432
Email: rina.sari98@example.com
Rekening BCA: 1234567890`;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const alnumCount = (s) => (String(s).match(/[A-Za-z0-9]/g) || []).length;

  // ── Language ─────────────────────────────────────────────────────────────
  let lang = 'id';
  try { const saved = localStorage.getItem('ps_site_lang'); if (saved === 'en' || saved === 'id') lang = saved; } catch (_) { /* storage blocked */ }
  const S = () => STRINGS[lang];

  function applyLang() {
    const s = S();
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach((el) => { const v = s[el.dataset.i18n]; if (typeof v === 'string') el.textContent = v; });
    document.querySelectorAll('[data-i18n-html]').forEach((el) => { const v = s[el.dataset.i18nHtml]; if (typeof v === 'string') el.innerHTML = v; });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = s[el.dataset.i18nPlaceholder] || ''; });
    document.querySelectorAll('#lang-toggle [data-lang]').forEach((el) => el.classList.toggle('on', el.dataset.lang === lang));
    document.title = lang === 'id' ? 'PromptShield · Jaga datamu sebelum masuk ke AI' : 'PromptShield · Protect your data before it reaches AI';
    if (lastResult) renderResult(lastResult);
  }

  $('lang-toggle').addEventListener('click', () => {
    lang = lang === 'id' ? 'en' : 'id';
    try { localStorage.setItem('ps_site_lang', lang); } catch (_) { /* storage blocked */ }
    applyLang();
  });

  if (INSTALL_URL) {
    document.querySelectorAll('.js-install').forEach((a) => { a.href = INSTALL_URL; a.target = '_blank'; a.rel = 'noopener'; });
  }

  // ── Tabs ─────────────────────────────────────────────────────────────────
  const tabs = [...document.querySelectorAll('.tab')];
  function selectTab(tab, focus) {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute('aria-controls')).hidden = !on;
    }
    if (focus) tab.focus();
    clearResult();
  }
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => selectTab(t));
    t.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (d) { e.preventDefault(); selectTab(tabs[(i + d + tabs.length) % tabs.length], true); }
    });
  });

  // ── Result card ──────────────────────────────────────────────────────────
  let lastResult = null;
  const resultEl = $('result');

  const ICONS = {
    ok: '<svg class="result-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/></svg>',
    warn: '<svg class="result-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l9.5 17h-19L12 3z"/><path d="M12 10v4M12 17.5v.01"/></svg>',
    err: '<svg class="result-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/></svg>'
  };
  const SHIELD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>';

  /** Show a little of the value so the user recognises it, never the whole thing. */
  function maskValue(v) {
    const s = String(v);
    if (s.length <= 8) return '•'.repeat(8);
    const keep = Math.min(4, Math.floor(s.length / 4));
    return s.slice(0, keep) + '•'.repeat(s.length - keep * 2) + s.slice(-keep);
  }
  const typeLabel = (t) => ((typeof PS_TYPE_LABELS !== 'undefined' && PS_TYPE_LABELS[t]) || {})[lang] || t;
  const docLabel = (t) => ((typeof PS_DOC_TYPES !== 'undefined' && PS_DOC_TYPES[t]) || {})[lang] || t;

  function clearResult() {
    lastResult = null;
    resultEl.innerHTML = '';
  }

  function showResult(r) {
    lastResult = r;
    renderResult(r);
  }

  /**
   * r = {kind:'scan', source:'text'|'image'|'pdf', findings:[], docType, fields:[]}
   *   | {kind:'error', message:key}
   */
  function renderResult(r) {
    const s = S();
    const foot = `<div class="result-foot"><span class="badge">${SHIELD}<span>${esc(s.ondevice)}</span></span></div>`;
    if (r.kind === 'error') {
      resultEl.innerHTML = `<div class="result err"><div class="result-head">${ICONS.err}<div>
        <p class="result-title">${esc(s.err_title)}</p><p class="result-body">${esc(s[r.message] || '')}</p></div></div>${foot}</div>`;
      return;
    }
    const n = r.findings.length;
    if (!n && !r.docType && !(r.fields && r.fields.length)) {
      const body = r.source === 'text' ? s.result_clean_body : s.result_clean_body_file;
      resultEl.innerHTML = `<div class="result ok"><div class="result-head">${ICONS.ok}<div>
        <p class="result-title">${esc(s.result_clean)}</p><p class="result-body">${esc(body)}</p>
        ${r.source === 'image' ? `<p class="redact-safe">${esc(s.redact_safe)}</p>` : ''}</div></div>${foot}</div>`;
      return;
    }
    const title = r.docType ? s.result_doc(docLabel(r.docType)) : n ? s.result_found(n) : s.result_generic;
    // Fields recognised from the document's printed labels (e.g. "Tempat/Tgl Lahir" on a KTP),
    // for types the detectors did not already list.
    const chips = [];
    const shown = new Set(r.findings.map((f) => typeLabel(f.type)));
    for (const key of r.fields || []) {
      const l = psDocScan.FIELD_LABELS[key];
      const label = l ? (l[lang] || l.id) : key;
      if (shown.has(label) || (key === 'nik' && r.findings.some((f) => f.type === 'NIK'))) continue;
      shown.add(label);
      chips.push(`<li class="chip"><span class="chip-type">${esc(label)}</span><span class="chip-val">${esc(s.visible_field)}</span></li>`);
    }
    renderFindings(r, title, foot, chips);
  }

  // ── Results: one mask/allow switch per finding ───────────────────────────
  // Every finding starts masked (switch ON). Switching one OFF lets that value through as-is;
  // the same value elsewhere follows the same choice (never half-masked).
  //   text, pdf: "Salin teks aman" copies the text with only the switched-ON findings replaced.
  //   image: the downloadable photo is pixelated as a whole, so the switches only mark which
  //          findings the user accepts; they do not change the safe photo.
  const findingKey = (f) => f.type + '\u0000' + f.value;

  function renderFindings(r, title, foot, chips) {
    const s = S();
    const isImage = r.source === 'image';
    const canCopy = !isImage && typeof r.text === 'string' && r.findings.length > 0;
    const rows = r.findings.map((f, i) => `
      <li class="finding-row" data-index="${i}" data-type="${esc(f.type)}">
        <div class="finding-left">
          <span class="finding-head"><span class="finding-type">${esc(typeLabel(f.type))}</span><span class="finding-hint"></span></span>
          <span class="finding-val"></span>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" class="finding-toggle" role="switch" data-index="${i}">
          <span class="toggle-track"></span>
        </label>
      </li>`).join('');
    const body = isImage ? s.result_found_body : s.result_toggle_body;
    const covers = isImage && rows && r.redaction && r.redaction.boxes;
    resultEl.innerHTML = `<div class="result warn"><div class="result-head">${ICONS.warn}<div>
      <p class="result-title">${esc(title)}</p><p class="result-body">${esc(body)}</p></div></div>
      ${isImage ? '<div class="redact-slot"></div>' : ''}
      ${rows ? `<ul class="findings">${rows}</ul>` : ''}
      ${chips.length ? `<ul class="chips">${chips.join('')}</ul>` : ''}
      ${covers ? `<p class="redact-covers">${esc(s.redact_covers)}</p>` : ''}
      ${canCopy ? `<div class="copy-safe">
        <button type="button" class="btn btn-dark btn-sm" id="copy-safe">${esc(s.copy_safe)}</button>
        <p class="copy-status" id="copy-safe-status" aria-live="polite"></p>
      </div>` : ''}${foot}</div>`;
    if (isImage && r.redaction !== undefined) renderRedaction(resultEl.querySelector('.redact-slot'), r);
    const paintAll = () => resultEl.querySelectorAll('.finding-row').forEach((row) => paintFinding(r, row));
    paintAll();
    resultEl.querySelectorAll('.finding-toggle').forEach((sw) => sw.addEventListener('change', () => {
      const it = r.findings[Number(sw.dataset.index)];
      for (const f of r.findings) if (findingKey(f) === findingKey(it)) f.mask = sw.checked;
      paintAll(); // in place, so keyboard focus stays on the switch
      if (canCopy) $('copy-safe-status').textContent = '';
    }));
    if (canCopy) $('copy-safe').addEventListener('click', () => copySafeText(r));
  }

  function paintFinding(r, row) {
    const s = S();
    const f = r.findings[Number(row.dataset.index)];
    const sw = row.querySelector('.finding-toggle');
    sw.checked = f.mask;
    row.classList.toggle('allowed', !f.mask);
    row.querySelector('.finding-val').textContent = f.mask ? maskValue(f.value) : f.value;
    row.querySelector('.finding-hint').textContent = f.mask ? '' : s.allowed_hint;
    const tip = f.mask ? s.mask_this : s.allow_this;
    row.querySelector('.toggle-switch').title = tip;
    sw.setAttribute('aria-label', `${typeLabel(f.type)} ${maskValue(f.value)}: ${tip}`);
  }

  /** Text with only the switched-ON findings replaced by [TYPE_n] placeholders. */
  function buildSafeText(r) {
    const tokens = new Map();
    const counters = {};
    let out = '', cursor = 0;
    for (const f of [...r.findings].sort((a, b) => a.start - b.start)) {
      if (!f.mask || f.start < cursor) continue;
      let t = tokens.get(findingKey(f));
      if (!t) { counters[f.type] = (counters[f.type] || 0) + 1; t = `[${f.type}_${counters[f.type]}]`; tokens.set(findingKey(f), t); }
      out += r.text.slice(cursor, f.start) + t;
      cursor = f.end;
    }
    return out + r.text.slice(cursor);
  }

  async function copySafeText(r) {
    const s = S();
    const status = $('copy-safe-status');
    const masked = r.findings.filter((f) => f.mask);
    const safe = buildSafeText(r);
    // Safety check: no value the user chose to mask may survive in what we copy.
    // Also checks the original spelling: PDF/OCR findings can come from the digit-corrected text
    // (O→0, I→1, one character for one), so the same span may read differently in r.text.
    if (masked.some((f) => safe.includes(f.value) || safe.includes(r.text.slice(f.start, f.end)))) { status.textContent = s.copy_failed; status.dataset.kind = 'error'; return; }
    try {
      await navigator.clipboard.writeText(safe);
      status.textContent = s.copy_done(masked.length, r.findings.length - masked.length);
      status.dataset.kind = 'ok';
    } catch (_) {
      status.textContent = s.copy_failed;
      status.dataset.kind = 'error';
    }
  }

  // ── Photo redaction ──────────────────────────────────────────────────────
  // Photo redaction (local, Canvas API only): when any PII is detected, the WHOLE photo is
  // pixelated (mosaic). Simple and complete: no OCR box can be missed. Nothing leaves the browser.
  // Classic "censor mosaic": square blocks, one solid colour each (the block's average).
  // Canvas-based (no CSS blur): shrink so each block becomes one pixel, then scale back up
  // with smoothing off. Blocks are at least 22 px and grow with the photo (~40 blocks across the
  // long side): a fixed 22 px block on a 4000 px phone photo is ~2 px once shown in a chat or in
  // the popup preview, i.e. the face and text stay fully readable.
  const MOSAIC_BLOCK = 22;
  const MOSAIC_MIN_BLOCK = 18;
  const MOSAIC_BLOCKS_ACROSS = 40;

  function mosaicBlockSize(w, h) {
    return Math.max(MOSAIC_BLOCK, Math.round(Math.max(w, h) / MOSAIC_BLOCKS_ACROSS));
  }

  /** Pixelate the WHOLE canvas in place. blockSize is clamped to >= MOSAIC_MIN_BLOCK. */
  function pixelateCanvas(canvas, blockSize = MOSAIC_BLOCK) {
    const w = canvas.width, h = canvas.height;
    if (!w || !h) return canvas;
    const bs = Math.max(MOSAIC_MIN_BLOCK, Math.round(blockSize) || MOSAIC_BLOCK);
    const ctx = canvas.getContext('2d');
    const smallW = Math.ceil(w / bs), smallH = Math.ceil(h / bs);

    // Step 1: shrunken copy, one pixel per block (the downscale averages the block's pixels).
    const off = document.createElement('canvas');
    off.width = smallW;
    off.height = smallH;
    const offCtx = off.getContext('2d');
    offCtx.imageSmoothingEnabled = true;
    offCtx.imageSmoothingQuality = 'high';
    offCtx.drawImage(canvas, 0, 0, smallW, smallH);

    // Step 2: back at full size, no smoothing = solid square blocks. Clear first so a
    // semi-transparent block (PNG with alpha) can never show the original through it.
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, smallW, smallH, 0, 0, w, h);
    ctx.restore();
    off.width = off.height = 0;
    return canvas;
  }

  /**
   * Draw the original photo; if any PII was detected (a value, or a recognised ID document),
   * pixelate the entire image.
   * @returns {{canvas:HTMLCanvasElement, boxes:number}}  boxes = 0 when nothing was pixelated
   */
  function redactImage(source, findings, docType) {
    const canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0);
    if (!((findings && findings.length > 0) || docType)) return { canvas, boxes: 0 };
    pixelateCanvas(canvas, mosaicBlockSize(canvas.width, canvas.height));
    return { canvas, boxes: 1 };
  }

  /** Output type + file name (keeps JPEG/WEBP, everything else becomes PNG). */
  function redactedOutput(type, fileName) {
    const keep = type === 'image/jpeg' || type === 'image/webp';
    const mime = keep ? type : 'image/png';
    let name = fileName || 'image.png';
    if (!keep) name = /\.[^.]+$/.test(name) ? name.replace(/\.[^.]+$/, '.png') : name + '.png';
    return { mime, name: 'redacted_' + name };
  }

  function downloadCanvas(canvas, mime, name) {
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }, mime, 0.92);
  }

  /** Fill the result card's redaction slot (re-run on language toggle, so it builds from r). */
  function renderRedaction(slot, r) {
    if (!slot) return;
    const s = S();
    const red = r.redaction;
    if (!red || !red.boxes) {
      slot.innerHTML = `<p class="redact-note">${esc(s.redact_none)}</p>`;
      return;
    }
    slot.innerHTML = `<p class="redact-title">${esc(s.redact_title)}</p>`;
    red.canvas.id = 'redactedPreview';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'downloadRedacted';
    btn.textContent = s.redact_download;
    const out = redactedOutput(red.mime, red.fileName);
    btn.addEventListener('click', () => downloadCanvas(red.canvas, out.mime, out.name));
    slot.append(red.canvas, btn);
  }

  // ── Text ─────────────────────────────────────────────────────────────────
  const textInput = $('text-input');
  function scanText() {
    const text = textInput.value;
    if (!text.trim()) { clearResult(); textInput.focus(); return; }
    // Text: detector findings only. Document-type guessing is for photos/PDFs of whole documents;
    // on chat text a single "NIK ..." line would wrongly read as "KTP detected".
    const findings = psDetectAll(text).map((f) => ({ ...f, mask: true }));
    showResult({ kind: 'scan', source: 'text', text, findings, docType: null, fields: [] });
  }
  $('text-scan').addEventListener('click', scanText);
  textInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); scanText(); } });
  $('text-sample').addEventListener('click', () => { textInput.value = SAMPLE; scanText(); });

  // ── Lazy script loading ──────────────────────────────────────────────────
  const loaded = {};
  function loadScript(src) {
    if (!loaded[src]) {
      loaded[src] = new Promise((resolve, reject) => {
        const el = document.createElement('script');
        el.src = src;
        el.async = true;
        el.crossOrigin = 'anonymous';
        el.onload = resolve;
        el.onerror = () => { delete loaded[src]; el.remove(); reject(new Error('network')); };
        document.head.appendChild(el);
      });
    }
    return loaded[src];
  }

  // ── OCR (same multi-pass pipeline as the extension's side panel) ────────
  const OCR_TARGET_PX = 2400;
  const MIN_OCR_PX = 50;                 // smaller images are skipped: Tesseract cannot read them
  const OCR_PASSES = [
    { rot: 0, mode: 'gray' },
    { rot: 90, mode: 'gray' },
    { rot: 270, mode: 'gray' },
    { rot: 0, mode: 'bin' },
    { rot: 180, mode: 'gray' }
  ];
  const OCR_CONFIDENT = 75;
  let workerPromise = null;
  let onOcrProgress = null;

  function getWorker() {
    if (!workerPromise) {
      workerPromise = loadScript(CDN.tesseract).then(() => Tesseract.createWorker(['ind', 'eng'], 1, {
        ...TESSERACT_LOCAL,
        // file:// pages may not have IndexedDB; skip the language-data cache there.
        cacheMethod: IS_FILE ? 'none' : 'write',
        logger: (m) => { if (onOcrProgress) onOcrProgress(m); }
      })).catch((err) => { workerPromise = null; throw err; });
    }
    return workerPromise;
  }

  function makeVariant(source, rot, mode) {
    const w0 = source.width, h0 = source.height;
    const scale = Math.min(3, Math.max(0.5, OCR_TARGET_PX / Math.max(w0, h0)));
    const w = Math.round(w0 * scale), h = Math.round(h0 * scale);
    const swap = rot === 90 || rot === 270;
    const canvas = document.createElement('canvas');
    canvas.width = swap ? h : w;
    canvas.height = swap ? w : h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.drawImage(source, -w / 2, -h / 2, w, h);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    psDocScan.enhance(img);
    if (mode === 'bin') psDocScan.binarize(img);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  /** Run OCR passes on a bitmap/canvas until something sensitive is found or the text reads cleanly. */
  async function ocrAnalyze(source, setStatus, passes) {
    const list = passes || OCR_PASSES;
    let text = '';
    let analysis = psDocScan.analyze('', psDetectAll);
    let empty = 0;
    // Skip images too small for Tesseract (it aborts with "Image too small to scale").
    if (!source || (source.width || 0) < MIN_OCR_PX || (source.height || 0) < MIN_OCR_PX) return { text, analysis };
    const worker = await getWorker();
    for (let i = 0; i < list.length; i++) {
      if (i > 0 && setStatus) setStatus(S().ocr_step(i + 1, list.length));
      const variant = makeVariant(source, list[i].rot, list[i].mode);
      if (variant.width < MIN_OCR_PX || variant.height < MIN_OCR_PX) break;
      let data;
      try {
        ({ data } = await worker.recognize(variant, { debug_file: '/dev/null' }))   // silence Tesseract's internal "Image too small to scale" diagnostics;
      } catch (err) {
        ocrSkipped(err);
        workerPromise = null;                       // a crashed worker is unusable: start fresh next time
        try { worker.terminate(); } catch (_) { /* already gone */ }
        break;
      }
      const t = (data && data.text) || '';
      text += '\n' + t;
      analysis = psDocScan.analyze(text, psDetectAll);
      if (analysis.sensitive) break;
      if (alnumCount(t) < 4) { if (++empty >= 2) break; continue; }
      if ((data.confidence || 0) >= OCR_CONFIDENT && alnumCount(t) >= 20) break;
    }
    return { text, analysis };
  }

  async function loadBitmap(file) {
    if (typeof createImageBitmap === 'function') {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (_) { /* fall back */ }
    }
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // ── Drop zones ───────────────────────────────────────────────────────────
  function wireDrop(zoneId, inputId, onFile) {
    const zone = $(zoneId), input = $(inputId);
    zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag');
      const f = e.dataTransfer && e.dataTransfer.files[0];
      if (f) onFile(f);
    });
    input.addEventListener('change', () => { const f = input.files[0]; if (f) onFile(f); input.value = ''; });
  }

  let jobSeq = 0;          // a newer file cancels the display of an older scan

  function statusSetter(el) {
    return (msg) => { el.textContent = msg; el.hidden = false; };
  }

  // ── Image ────────────────────────────────────────────────────────────────
  wireDrop('drop-image', 'file-image', async (file) => {
    const seq = ++jobSeq;
    const status = $('image-status'), preview = $('image-preview');
    const setStatus = statusSetter(status);
    clearResult();
    if (!/^image\//.test(file.type)) { showResult({ kind: 'error', message: 'err_type' }); return; }
    const url = URL.createObjectURL(file);
    preview.src = url;
    preview.hidden = false;
    preview.onload = () => URL.revokeObjectURL(url);


    setStatus(workerPromise ? S().scanning : S().loading_ocr);
    onOcrProgress = (m) => {
      if (seq !== jobSeq) return;
      if (m.status === 'loading language traineddata' && typeof m.progress === 'number' && m.progress < 1) setStatus(S().loading_lang(Math.round(m.progress * 100)));
      else if (m.status === 'recognizing text' && status.textContent !== S().scanning && !/\(\d\/\d\)/.test(status.textContent)) setStatus(S().scanning);
    };
    const originalFileName = file.name;
    let bitmap = null;
    try {
      bitmap = await loadBitmap(file);
      const { text, analysis } = await ocrAnalyze(bitmap, (msg) => seq === jobSeq && setStatus(msg));
      if (seq !== jobSeq) return;
      if (alnumCount(text) < 4) { showResult({ kind: 'error', message: 'err_notext' }); return; }
      const result = fileResult('image', analysis);
      // Add-on: pixelate the PII on a copy of the photo so the user can download a safe version.
      if (analysis.sensitive) {
        let red = null;
        try { red = redactImage(bitmap, analysis.findings, analysis.docType); } catch (_) { red = null; }
        result.redaction = red ? { canvas: red.canvas, boxes: red.boxes, mime: file.type, fileName: originalFileName } : null;
      }
      showResult(result);
    } catch (err) {
      if (seq !== jobSeq) return;
      showResult({ kind: 'error', message: err && err.message === 'network' ? 'err_network' : 'err_notext' });
    } finally {
      if (bitmap && bitmap.close) bitmap.close();
      if (seq === jobSeq) { status.hidden = true; }
    }
  });

  function fileResult(source, analysis) {
    return {
      kind: 'scan',
      source,
      findings: analysis.sensitive ? analysis.findings.map((f) => ({ ...f, mask: true })) : [],
      docType: analysis.docType,
      fields: analysis.sensitive ? analysis.fields : []
    };
  }

  // ── PDF ──────────────────────────────────────────────────────────────────
  const PDF_MAX_PAGES = 50;
  const PDF_MAX_OCR_PAGES = 5;

  async function getPdfjs() {
    await loadScript(CDN.pdfjs);
    if (!window.pdfjsLib) throw new Error('network');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = CDN.pdfWorker;
    return window.pdfjsLib;
  }

  wireDrop('drop-pdf', 'file-pdf', async (file) => {
    const seq = ++jobSeq;
    const status = $('pdf-status'), name = $('pdf-name');
    const setStatus = statusSetter(status);
    clearResult();
    if (!(file.type === 'application/pdf' || /\.pdf$/i.test(file.name))) { showResult({ kind: 'error', message: 'err_type' }); return; }
    name.textContent = file.name;
    name.hidden = false;


    setStatus(window.pdfjsLib ? S().scanning : S().loading_pdf);
    try {
      let pdfjs;
      try { pdfjs = await getPdfjs(); } catch (_) { throw new Error('network'); }
      let doc;
      try { doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise; } catch (_) { throw new Error('pdf'); }
      const total = Math.min(doc.numPages, PDF_MAX_PAGES);
      let text = '';
      const imagePages = [];
      for (let p = 1; p <= total; p++) {
        if (seq !== jobSeq) return;
        setStatus(S().pdf_reading(p, total));
        const page = await doc.getPage(p);
        const content = await page.getTextContent();
        const pageText = content.items.map((it) => it.str + (it.hasEOL ? '\n' : ' ')).join('');
        text += pageText + '\n';
        if (alnumCount(pageText) < 20 && imagePages.length < PDF_MAX_OCR_PAGES) imagePages.push(page);
      }
      let analysis = psDocScan.analyze(text, psDetectAll);
      // Scanned PDFs (a photo of a KTP saved as PDF) have no text layer: render those pages and OCR them.
      for (let i = 0; i < imagePages.length && !analysis.sensitive; i++) {
        if (seq !== jobSeq) return;
        setStatus(S().pdf_ocr(imagePages[i].pageNumber, total));
        const page = imagePages[i];
        const vp1 = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: Math.min(3, 2000 / Math.max(vp1.width, vp1.height)) });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(vp.width);
        canvas.height = Math.round(vp.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        const r = await ocrAnalyze(canvas, null, OCR_PASSES.slice(0, 4));
        text += '\n' + r.text;
        analysis = psDocScan.analyze(text, psDetectAll);
      }
      if (seq !== jobSeq) return;
      if (alnumCount(text) < 4) showResult({ kind: 'error', message: 'err_notext' });
      else showResult({ ...fileResult('pdf', analysis), text }); // text kept for "copy safe text"
    } catch (err) {
      if (seq !== jobSeq) return;
      const m = err && err.message;
      showResult({ kind: 'error', message: m === 'network' ? 'err_network' : m === 'pdf' ? 'err_pdf' : 'err_notext' });
    } finally {
      if (seq === jobSeq) { status.hidden = true; }
    }
  });

  // ── PWA: install button + offline OCR ───────────────────────────────────
  // Chromium browsers fire beforeinstallprompt when the site is installable; we show our own
  // button instead of the mini-infobar. iOS Safari never fires it (users use Share > Add to Home).
  const installBtn = $('pwa-install');
  const isPhone = window.matchMedia('(pointer: coarse)').matches;
  let deferredPrompt = null;
  if (installBtn) {
    // On a laptop "Pasang di HP" would be wrong; the label follows the device.
    if (!isPhone) installBtn.querySelector('[data-i18n]').dataset.i18n = 'pwa_install_desktop';
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      installBtn.hidden = false;
    });
    installBtn.addEventListener('click', async () => {
      installBtn.hidden = true;
      if (!deferredPrompt) return;
      const p = deferredPrompt;
      deferredPrompt = null;
      try { await p.prompt(); } catch (_) { /* dismissed */ }
    });
  }

  // The OCR engine + language data (~12 MB) is fetched on first scan. An installed app should work
  // offline from the start, so ask the service worker to fetch it all once installed / when opened
  // as an app.
  function warmOfflineOcr() {
    if (!('serviceWorker' in navigator) || IS_FILE) return;
    navigator.serviceWorker.ready.then((reg) => { if (reg.active) reg.active.postMessage({ type: 'warm-ocr' }); }).catch(() => {});
  }
  window.addEventListener('appinstalled', () => { if (installBtn) installBtn.hidden = true; warmOfflineOcr(); });
  if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) warmOfflineOcr();

  applyLang();
})();
