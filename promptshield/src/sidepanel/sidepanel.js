// PromptShield side panel: works next to ANY site (Google Docs, Gmail, Gemini, WhatsApp Web, ...)
// without extra permissions. The page itself is never read; the user pastes text here.
//   1. Paste text -> detect locally -> choose items -> "Copy safe text" (placeholders, tokens from the vault)
//   2. Paste the AI's reply -> placeholders are restored locally -> "Copy restored reply"
// Nothing typed here is stored. Real values for the placeholders live in the encrypted vault (24 h TTL).
'use strict';

(() => {
  const style = document.createElement('style');
  style.textContent = PS_TOKENS_CSS;
  document.head.prepend(style);

  const STR = {
    id: {
      sub: 'Pakai di situs mana pun: tempel teks di sini sebelum dikirim ke AI.',
      inputTitle: 'Samarkan sebelum dibagikan',
      inputPh: 'Tempel teks yang mau kamu kirim ke AI (email, kontrak, data pelanggan, kode)…',
      sample: 'Contoh', clear: 'Hapus',
      detected: 'Terdeteksi', possible: 'mungkin',
      noneFound: 'Tidak ada data sensitif terdeteksi.',
      viewOriginal: 'Asli', viewSafe: 'Versi aman',
      copySafe: 'Salin teks aman',
      copiedN: (n) => `Tersalin. ${n} data diganti placeholder. Tempel ke AI pilihanmu.`,
      copiedNone: 'Tersalin. Tidak ada data sensitif terdeteksi.',
      copyFailed: 'Gagal menyalin. Tidak ada yang disalin; coba lagi.',
      chars: (n) => `${n.toLocaleString('id-ID')} karakter`,
      replyTitle: 'Pulihkan balasan AI',
      replyHint: 'Tempel balasan AI yang berisi placeholder seperti [NIK_1]. Nilai asli dikembalikan di sini saja.',
      replyPh: 'Tempel balasan AI di sini…',
      restoredTitle: 'Balasan dengan nilai asli',
      restoredN: (n) => `· ${n} dipulihkan`,
      noneRestored: 'Tidak ada placeholder yang dikenali. Mungkin sudah lewat 24 jam atau brankas dihapus.',
      copyRestored: 'Salin balasan asli',
      restoredCopied: 'Tersalin.',
      adviceLarge: 'Prompt ini kemungkinan butuh model besar.',
      accepted: 'Tercatat. Pilih model yang lebih kecil di situs AI-mu.',
      foot: 'Teks di panel ini tidak disimpan dan tidak dikirim ke mana pun. Nilai asli untuk placeholder dienkripsi di perangkatmu (AES-GCM) dan dihapus otomatis.',
      energyTitle: 'Energi',
      energySaved: 'Energi dihemat',
      estimate: 'estimasi',
      energyPotential: 'Potensi hemat',
      potentialN: (n) => `${n} prompt cukup dengan model lebih kecil`,
      energyNote: '"Dihemat" bertambah saat kamu menerima saran model lebih kecil. "Potensi" menjumlahkan estimasi untuk prompt terkirim yang sebenarnya cukup dengan model lebih kecil.',
      eduLabel: '💡 Tahukah kamu?'
    },
    en: {
      sub: 'Works next to any site: paste text here before you send it to an AI.',
      inputTitle: 'Mask before sharing',
      inputPh: 'Paste the text you want to send to an AI (email, contract, customer data, code)…',
      sample: 'Sample', clear: 'Clear',
      detected: 'Detected', possible: 'possible',
      noneFound: 'No sensitive data found.',
      viewOriginal: 'Original', viewSafe: 'Safe version',
      copySafe: 'Copy safe text',
      copiedN: (n) => `Copied. ${n} item(s) replaced with placeholders. Paste it into any AI.`,
      copiedNone: 'Copied. No sensitive data found.',
      copyFailed: 'Copy failed. Nothing was copied; try again.',
      chars: (n) => `${n.toLocaleString('en-US')} characters`,
      replyTitle: "Restore the AI's reply",
      replyHint: 'Paste an AI reply that contains placeholders like [NIK_1]. Real values are put back here only.',
      replyPh: 'Paste the AI reply here…',
      restoredTitle: 'Reply with real values',
      restoredN: (n) => `· ${n} restored`,
      noneRestored: 'No known placeholders found. They may be older than 24 h or the vault was cleared.',
      copyRestored: 'Copy restored reply',
      restoredCopied: 'Copied.',
      adviceLarge: 'This prompt likely needs a large model.',
      accepted: 'Noted. Pick a smaller model on your AI site.',
      foot: 'Text in this panel is not stored and not sent anywhere. Real values behind placeholders are encrypted on your device (AES-GCM) and deleted automatically.',
      energyTitle: 'Energy',
      energySaved: 'Energy saved',
      estimate: 'estimate',
      energyPotential: 'Potential saving',
      potentialN: (n) => `${n} prompt${n === 1 ? '' : 's'} a smaller model could handle`,
      energyNote: '"Saved" goes up when you accept a smaller-model suggestion. "Potential" adds up the estimate for sent prompts a smaller model could likely have handled.',
      eduLabel: '💡 Did you know?'
    }
  };

  // ---------------- Extension plumbing (works without chrome.* for previews) ----------------
  const hasChrome = typeof chrome !== 'undefined' && !!(chrome.runtime && chrome.runtime.id && chrome.runtime.sendMessage);
  function send(msg, timeoutMs = 4000) {
    return new Promise((resolve) => {
      if (!hasChrome) return resolve(null);
      let done = false;
      const t = setTimeout(() => { if (!done) { done = true; resolve(null); } }, timeoutMs);
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          if (done) return;
          done = true;
          clearTimeout(t);
          resolve(chrome.runtime.lastError ? null : res);
        });
      } catch (_) { done = true; clearTimeout(t); resolve(null); }
    });
  }

  const mergeSettings = (s) => ({ ...PS_DEFAULTS, ...(s || {}), enabledTypes: { ...PS_DEFAULTS.enabledTypes, ...((s && s.enabledTypes) || {}) } });
  let settings = mergeSettings(null);
  let lang = psResolveLang(settings.lang);
  let S = STR[lang];
  let T = PS_I18N[lang];

  const $ = (id) => document.getElementById(id);
  const input = $('input'), reply = $('reply'), list = $('list'), preview = $('preview');
  const btnCopy = $('btn-copy'), copyStatus = $('copy-status');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const typeLabel = (t) => (PS_TYPE_LABELS[t] || {})[lang] || t;

  $('brand-icon').innerHTML = PS_ICONS.shield;
  try { if (hasChrome) $('version').textContent = 'v' + chrome.runtime.getManifest().version; } catch (_) { /* preview */ }

  function applyI18n() {
    lang = psResolveLang(settings.lang);
    S = STR[lang];
    T = PS_I18N[lang];
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach((el) => { const v = S[el.dataset.i18n]; if (typeof v === 'string') el.textContent = v; });
    input.placeholder = S.inputPh;
    reply.placeholder = S.replyPh;
  }

  // ---------------- State ----------------
  let items = [];                       // current findings with {id, approved}
  const overrides = new Map();          // `${type}\0${value}` -> approved (user's switch choices)
  let view = 'safe';
  let safeCache = { sig: null };
  let renderSeq = 0;
  let lastRecordedSig = null;
  let lastAdviceKey = '';
  let adviceAccepted = false;
  const localTok = psMasker.createLocalTokenizer();
  const localMap = {};                  // tokens assigned locally when the vault is unavailable

  const keyOf = (f) => f.type + '\u0000' + psMasker.canonical(f.type, f.value);
  const signature = () => input.value + '\u0001' + items.filter((i) => i.approved).map((i) => `${i.start}:${i.end}:${i.type}`).join(',');

  function setStatus(el, msg, kind) {
    el.textContent = msg || '';
    if (kind) el.dataset.kind = kind; else delete el.dataset.kind;
  }

  // ---------------- Scan ----------------
  function scan() {
    const text = input.value;
    $('char-count').textContent = text ? S.chars(text.length) : '';
    const findings = text.trim() ? psDetectAll(text, { enabledTypes: settings.enabledTypes }) : [];
    items = findings.map((f, i) => ({
      ...f,
      id: i,
      approved: overrides.has(keyOf(f)) ? overrides.get(keyOf(f)) : f.confidence >= settings.confidenceThreshold
    }));
    // The same value is masked everywhere or nowhere (never half-masked).
    const approvedKeys = new Set(items.filter((i) => i.approved).map(keyOf));
    for (const i of items) if (!overrides.has(keyOf(i)) && approvedKeys.has(keyOf(i))) i.approved = true;
    renderList();
    renderPreview();
    renderAdvice(text);
    btnCopy.disabled = !text.trim();
    setStatus(copyStatus, '');
  }

  function renderList() {
    const text = input.value;
    $('detect').hidden = items.length === 0;
    $('empty').hidden = !(items.length === 0 && text.trim().length >= 3);
    $('det-count').textContent = String(items.length);
    list.innerHTML = items.map((f) => `
      <li class="row">
        <label class="row-label" for="sw-${f.id}">
          <span class="type">${esc(typeLabel(f.type))}</span>
          <span class="val mono">${esc(psMasker.partialValue(f.value))}</span>
          ${f.confidence < settings.confidenceThreshold ? `<span class="badge">${esc(S.possible)}</span>` : ''}
        </label>
        <input id="sw-${f.id}" class="switch" type="checkbox" role="switch" data-id="${f.id}" ${f.approved ? 'checked' : ''}
          aria-label="${esc(typeLabel(f.type))} ${esc(psMasker.partialValue(f.value))}">
      </li>`).join('');
    list.querySelectorAll('.switch').forEach((sw) => sw.addEventListener('change', () => {
      const it = items.find((i) => i.id === Number(sw.dataset.id));
      if (!it) return;
      overrides.set(keyOf(it), sw.checked);
      // The same value elsewhere in the text follows the same choice.
      for (const other of items) if (keyOf(other) === keyOf(it)) other.approved = sw.checked;
      renderList();
      renderPreview();
      setStatus(copyStatus, '');
    }));
  }

  /** Tokens come from the encrypted vault (same token as in ChatGPT); page-local if unavailable. */
  async function getSafe() {
    const text = input.value;
    const sig = signature();
    if (safeCache.sig === sig) return safeCache;
    const approved = items.filter((i) => i.approved);
    const tokensById = {};
    const byType = {};
    if (approved.length) {
      const res = await send({ action: PS_ACTIONS.MASK, items: approved.map((f) => ({ type: f.type, value: f.value })) });
      const ok = res && res.success && Array.isArray(res.tokens) && res.tokens.length === approved.length;
      const toks = ok ? res.tokens : approved.map((f) => localTok(f.type, f.value));
      approved.forEach((f, i) => {
        tokensById[f.id] = toks[i];
        if (!ok) localMap[toks[i]] = f.value;
        byType[f.type] = (byType[f.type] || 0) + 1;
      });
    }
    if (input.value !== text || signature() !== sig) return null; // text changed meanwhile
    const masked = psMasker.build(text, items, tokensById); // throws on stale offsets
    safeCache = { sig, masked, count: approved.length, byType };
    return safeCache;
  }

  async function renderPreview() {
    const wrap = $('preview-wrap');
    wrap.hidden = items.length === 0;
    document.querySelectorAll('.seg [role="tab"]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === view)));
    if (!items.length) return;
    const seq = ++renderSeq;
    const text = input.value;
    if (view === 'original') {
      let html = '', cur = 0;
      for (const f of items) {
        if (f.start < cur) continue;
        html += esc(text.slice(cur, f.start)) + `<mark class="hl ${f.approved ? 'on' : 'off'}" title="${esc(typeLabel(f.type))}">${esc(f.value)}</mark>`;
        cur = f.end;
      }
      preview.innerHTML = html + esc(text.slice(cur));
      return;
    }
    preview.innerHTML = `<span class="muted">${esc(T.preparing)}</span>`;
    try {
      const r = await getSafe();
      if (seq !== renderSeq || !r) return;
      preview.innerHTML = psMasker.highlightTokensHtml(r.masked);
    } catch (_) {
      if (seq === renderSeq) preview.innerHTML = `<span class="muted">${esc(T.preparing)}</span>`;
    }
  }

  document.querySelectorAll('.seg [role="tab"]').forEach((b) => b.addEventListener('click', () => { view = b.dataset.view; renderPreview(); }));

  // ---------------- Copy safe text (verified) ----------------
  async function writeClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (_) { /* fall back below */ }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (!ok) throw new Error('copy failed');
  }

  // Potential saving (see content-script.js): once per prompt taken to an AI, when a smaller model was likely enough.
  let lastPotentialText = '';
  function recordPotential(text) {
    if (!settings.rightSize || text.trim().length < 20 || text === lastPotentialText) return;
    lastPotentialText = text;
    const s = psComplexity.score(text).potentialSaving;
    if (s) send({ action: PS_ACTIONS.RECORD, update: { potential: { whMin: s.min, whMax: s.max } } });
  }

  async function copySafe() {
    if (!input.value.trim()) return;
    btnCopy.disabled = true;
    try {
      if (!items.length) {
        await writeClipboard(input.value);
        setStatus(copyStatus, S.copiedNone, 'ok');
        recordPotential(input.value);
        return;
      }
      const r = await getSafe();
      if (!r) throw new Error('stale');
      // Safety check: no approved value may survive in the text we copy.
      const approvedValues = new Set(items.filter((i) => i.approved).map((i) => i.value));
      for (const v of approvedValues) if (r.masked.includes(v)) throw new Error('verify');
      await writeClipboard(r.masked);
      setStatus(copyStatus, r.count ? S.copiedN(r.count) : S.copiedNone, 'ok');
      recordPotential(input.value);
      if (r.count && lastRecordedSig !== r.sig) {
        lastRecordedSig = r.sig;
        send({ action: PS_ACTIONS.RECORD, update: { items: r.byType } });
        send({ action: PS_ACTIONS.SET_LAST_SENT, text: r.masked, site: 'side panel' });
      }
    } catch (_) {
      setStatus(copyStatus, S.copyFailed, 'error');
    } finally {
      btnCopy.disabled = !input.value.trim();
    }
  }
  btnCopy.addEventListener('click', copySafe);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); copySafe(); } });

  // ---------------- Right-size advice ----------------
  function renderAdvice(text) {
    const box = $('advice');
    if (!settings.rightSize || text.trim().length < 20) { box.hidden = true; lastAdviceKey = ''; adviceAccepted = false; return; }
    const a = psComplexity.score(text);
    const key = a.tier + ':' + a.reasons.join(',');
    if (key === lastAdviceKey && !box.hidden) return;
    if (key !== lastAdviceKey) { adviceAccepted = false; if (a.potentialSaving) send({ action: PS_ACTIONS.RECORD, update: { adviceShown: true } }); }
    lastAdviceKey = key;
    const reasons = a.reasons.map((r) => `<li>${esc((psComplexity.REASON_TEXT[r] || {})[lang] || r)}</li>`).join('');
    const assumptions = Object.values(ENERGY_ASSUMPTIONS).map((x) =>
      `<li><span class="mono">${esc(Array.isArray(x.value) ? x.value.join('–') : x.value)} ${esc(x.unit)}</span><br>${esc(x.source)}</li>`).join('');
    const s = a.potentialSaving;
    box.innerHTML = `
      <div class="advice-main">
        <span class="advice-icon">${PS_ICONS.leaf}</span>
        <span class="advice-text">
          <strong>${esc(s ? T.rsSuggest(a.tier) : S.adviceLarge)}</strong>
          ${s ? `<span class="saving tnum">${esc(T.rsSaving(s.min, s.max))}<span class="est">${esc(T.estimate)}</span></span>` : ''}
        </span>
        <button type="button" class="link" id="why" aria-expanded="false">${esc(T.why)}</button>
      </div>
      ${s ? `<div style="margin-top:8px"><button type="button" class="btn-small" id="accept" ${adviceAccepted ? 'disabled' : ''}>${esc(adviceAccepted ? S.accepted : T.rsAccept)}</button></div>` : ''}
      <div class="advice-more" id="why-more" hidden>
        <ul>${reasons}</ul>
        <div class="assume-title">${esc(T.assumptions)}</div>
        <ul>${assumptions}</ul>
        <p>${esc(T.rsNote)}</p>
      </div>`;
    box.hidden = false;
    $('why').addEventListener('click', () => {
      const more = $('why-more');
      more.hidden = !more.hidden;
      $('why').setAttribute('aria-expanded', String(!more.hidden));
    });
    const acc = $('accept');
    if (acc) acc.addEventListener('click', async () => {
      if (adviceAccepted) return;
      adviceAccepted = true;
      acc.disabled = true;
      const res = await send({ action: PS_ACTIONS.RECORD, update: { adviceAccepted: { whMin: s.min, whMax: s.max } } });
      if (res && res.success) {
        acc.textContent = S.accepted;
      } else {
        adviceAccepted = false;          // not saved: let the user try again
        acc.disabled = false;
      }
    });
  }

  // ---------------- Restore an AI reply ----------------
  let restoreTimer = null;
  let restoredPlain = '';
  async function restoreReply() {
    const text = reply.value;
    const wrap = $('restored-wrap');
    if (!text.trim()) { wrap.hidden = true; restoredPlain = ''; return; }
    const res = await send({ action: PS_ACTIONS.GET_MAP });
    const map = { ...((res && res.map) || {}), ...localMap };
    if (reply.value !== text) return;
    const marked = {};
    for (const [k, v] of Object.entries(map)) marked[k] = '\u0001' + v + '\u0002';
    const { text: withMarks, count } = psRestorer.restore(text, marked);
    restoredPlain = psRestorer.restore(text, map).text;
    $('restored').innerHTML = esc(withMarks).replace(/\u0001([\s\S]*?)\u0002/g, '<mark class="rest">$1</mark>');
    $('restored-count').textContent = count ? S.restoredN(count) : '';
    setStatus($('restore-status'), count ? '' : S.noneRestored, count ? null : 'error');
    wrap.hidden = false;
  }
  reply.addEventListener('input', () => { clearTimeout(restoreTimer); restoreTimer = setTimeout(restoreReply, 200); });
  $('btn-copy-restored').addEventListener('click', async () => {
    try {
      await writeClipboard(restoredPlain);
      setStatus($('restore-status'), S.restoredCopied, 'ok');
    } catch (_) {
      setStatus($('restore-status'), S.copyFailed, 'error');
    }
  });

  // ---------------- Inputs ----------------
  const SAMPLE = `Yth. Customer Care,

Saya ingin menyampaikan keluhan: saldo saya terpotong dua kali.
Nama: Rina Sari
NIK: 3171016408980002
No. HP: 081298765432
Email: rina.sari98@example.com
Rekening BRI: 0123-01-012345-50-1

Tolong rapikan email komplain ini supaya sopan tapi tegas.`;

  let scanTimer = null;
  input.addEventListener('input', () => { clearTimeout(scanTimer); scanTimer = setTimeout(scan, 200); });
  $('btn-sample').addEventListener('click', () => { input.value = SAMPLE; overrides.clear(); scan(); input.focus(); });
  $('btn-clear').addEventListener('click', () => {
    input.value = '';
    reply.value = '';
    overrides.clear();
    restoreReply();
    scan();
    input.focus();
  });

  // ---------------- Energy: saved counter + rotating fact ----------------
  // Every fact is checked against its source; numbers are the source's own (see the source line).
  const EDU_FACTS = [
    {
      id: 'Untuk tugas yang sama, model AI generatif serbaguna bisa memakai energi hingga beberapa orde besaran lebih banyak dibanding model khusus tugas itu.',
      en: 'For the same task, general-purpose generative AI models can use orders of magnitude more energy than task-specific models.',
      source: 'Luccioni, Jernite & Strubell, ACM FAccT 2024'
    },
    {
      id: 'Satu permintaan ChatGPT pernah diperkirakan memakai ~2,9 Wh, hampir 10× pencarian Google (~0,3 Wh).',
      en: 'A ChatGPT request was estimated at ~2.9 Wh, nearly 10× a Google search (~0.3 Wh).',
      source: 'IEA, Electricity 2024'
    },
    {
      id: 'Pengukuran Google: median satu prompt teks Gemini ~0,24 Wh, lebih kecil dari energi menonton TV selama 9 detik.',
      en: "Google's measurement: the median Gemini text prompt uses ~0.24 Wh, less than watching TV for 9 seconds.",
      source: 'Google, Agustus/August 2025'
    },
    {
      id: 'Energi per prompt Gemini turun 33× dalam setahun (Mei 2024 → Mei 2025). Efisiensi model sangat menentukan.',
      en: 'Energy per Gemini prompt fell 33× in one year (May 2024 → May 2025). Model efficiency matters a lot.',
      source: 'Google, Agustus/August 2025'
    },
    {
      id: 'Melatih GPT-3 diperkirakan menghasilkan ~552 ton CO₂e.',
      en: 'Training GPT-3 was estimated to emit ~552 tonnes of CO₂e.',
      source: 'Patterson et al., 2021'
    },
    {
      id: 'Pemakaian listrik AI bisa bertambah 85–134 TWh per tahun pada 2027, sebanding dengan konsumsi listrik Belanda.',
      en: "AI could add 85–134 TWh of electricity use per year by 2027, comparable to the Netherlands' annual consumption.",
      source: 'de Vries, Joule 2023'
    }
  ];
  let eduIndex = -1;
  let energyStats = null;

  $('energy-icon').innerHTML = PS_ICONS.leaf;

  function renderEnergy() {
    const min = (energyStats && energyStats.energySavedWhMin) || 0;
    const max = (energyStats && energyStats.energySavedWhMax) || 0;
    // Same format as the popup's "Energy saved" row.
    const fmtRange = (a, b) => (b > 0 ? `≈ ${psFmtNumber(a, lang)}–${psFmtNumber(b, lang)} Wh` : '0 Wh');
    $('energy-value').textContent = fmtRange(min, max);
    const pn = (energyStats && energyStats.potentialPrompts) || 0;
    $('energy-potential').textContent = fmtRange((energyStats && energyStats.potentialWhMin) || 0, (energyStats && energyStats.potentialWhMax) || 0);
    $('energy-potential-n').textContent = pn ? S.potentialN(pn) : '';
    if (eduIndex >= 0) {
      const f = EDU_FACTS[eduIndex];
      $('edu-fact').textContent = f[lang] || f.id;
      $('edu-source').textContent = f.source;
      $('edu-card').hidden = false;
    }
  }

  async function loadEnergy() {
    const res = await send({ action: PS_ACTIONS.STATS });
    energyStats = (res && res.stats) || null;
    renderEnergy();
  }

  // One fact per opening of the panel. The service worker keeps the counter (chrome.storage.local
  // "eduFactIndex") so this panel never writes to storage itself.
  if (hasChrome) {
    send({ action: PS_ACTIONS.NEXT_FACT, count: EDU_FACTS.length }).then((res) => {
      eduIndex = res && Number.isInteger(res.index) ? res.index : 0;
      renderEnergy();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.ps_stats) { energyStats = changes.ps_stats.newValue || null; renderEnergy(); }
    });
    loadEnergy();
  } else {
    eduIndex = 0;
  }

  // ---------------- Settings ----------------
  function loadSettings(s) {
    settings = mergeSettings(s);
    applyI18n();
    scan();
    renderEnergy();
  }
  if (hasChrome) {
    chrome.storage.local.get('ps_settings', (r) => loadSettings(r && r.ps_settings));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.ps_settings) loadSettings(changes.ps_settings.newValue);
    });
  } else {
    loadSettings(null);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Section 3: Image / Document Scanner — local OCR with Tesseract.js (no API, no network).
  // The OCR core (lib/core) and language data (lib/lang) ship inside the extension.
  // ─────────────────────────────────────────────────────────────────────────────

  const SCAN_STR = {
    id: {
      scanTitle: 'Pindai dokumen foto',
      scanHint: 'Jatuhkan atau pilih foto dokumen (KTP, Paspor, KK, SIM, BPJS, Buku Rekening, dll.) untuk memeriksa data sensitif di dalamnya.',
      scanDrop: 'Jatuhkan foto di sini atau klik untuk memilih',
      scanDropSub: 'JPG / PNG / WEBP',
      scanScanning: 'Membaca teks dari foto… (proses lokal, tidak ada data dikirim)',
      onDevice: 'Diproses 100% di perangkat kamu · tanpa API · tanpa internet',
      warnBody: 'Jangan unggah foto ini ke AI. Data sensitif di dalamnya bisa terbaca oleh model.',
      warnFields: (fields) => `Terdeteksi: ${fields}`,
      warnNoText: 'Teks tidak terbaca dari foto ini. Pastikan foto cukup jelas.',
      okBody: 'Tidak ada pola dokumen sensitif Indonesia yang terdeteksi dari foto ini.',
      scanStep: (i, n) => `Mencoba sudut/pengolahan lain… (${i}/${n})`,
      redactTitle: 'Versi dokumen yang aman:',
      redactDownload: '⬇ Download versi aman',
      redactNoBoxes: 'Lokasi data sensitif di foto tidak dapat ditentukan, jadi versi aman otomatis tidak tersedia. Tutupi data secara manual sebelum membagikan foto ini.',
      redactSafe: '✓ Dokumen aman, tidak ada PII ditemukan',
    },
    en: {
      scanTitle: 'Scan document photo',
      scanHint: 'Drop or choose a document photo (KTP, Passport, KK, SIM, BPJS, Bank Passbook, etc.) to check for sensitive data.',
      scanDrop: 'Drop a photo here or click to choose',
      scanDropSub: 'JPG / PNG / WEBP',
      scanScanning: 'Reading text from photo… (local processing, nothing is sent anywhere)',
      onDevice: '100% on-device · no API · no internet needed',
      warnBody: 'Do not upload this photo to an AI. The sensitive data inside can be read by the model.',
      warnFields: (fields) => `Detected fields: ${fields}`,
      warnNoText: 'Could not read text from this photo. Make sure the image is clear enough.',
      okBody: 'No sensitive Indonesian document patterns detected in this photo.',
      scanStep: (i, n) => `Trying another angle/enhancement… (${i}/${n})`,
      redactTitle: 'Safe document version:',
      redactDownload: '⬇ Download safe version',
      redactNoBoxes: 'Could not locate the sensitive data in the photo, so no automatic safe version is available. Cover it manually before sharing this photo.',
      redactSafe: '✓ Document is safe, no PII found',
    }
  };

  // Apply scanner i18n strings to data-i18n elements inside the scan section.
  function applyScanI18n() {
    const ss = SCAN_STR[lang] || SCAN_STR.id;
    document.querySelectorAll('#scan-section [data-i18n]').forEach((el) => {
      const v = ss[el.dataset.i18n];
      if (typeof v === 'string') el.textContent = v;
    });
  }

  // Scanner DOM refs.
  const imgDrop     = $('ps-image-drop');
  const imgInput    = $('ps-img-input');
  const imgPreview  = $('ps-img-preview');
  const imgResult   = $('ps-img-result');
  const imgScanning = $('ps-img-scanning');

  // ── Tesseract worker (created once, reused) ────────────────────────────────
  // workerBlobURL:false — MV3 CSP forbids blob: scripts, so the worker loads straight
  // from the extension package. corePath/langPath point at bundled files so nothing
  // is fetched from a CDN.
  const extUrl = (p) => (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL)
    ? chrome.runtime.getURL(p)
    : '../../' + p;

  let _tWorker = null;

  async function getTesseractWorker() {
    if (_tWorker) return _tWorker;
    _tWorker = Tesseract.createWorker(['ind', 'eng'], 1, {
      workerPath: extUrl('lib/worker.min.js'),
      corePath: extUrl('lib/core'),
      langPath: extUrl('lib/lang'),
      workerBlobURL: false,
      logger: () => {}
    });
    try {
      return await _tWorker;
    } catch (err) {
      _tWorker = null; // allow a retry on the next scan
      throw err;
    }
  }

  // ── Image preparation (all on-device, via canvas) ──────────────────────────
  // Phone photos of ID cards are hard for OCR: small text, coloured security patterns, glare,
  // and sideways shots. Each pass upscales the photo, removes the background pattern
  // (psDocScan.enhance), optionally applies an adaptive threshold, and can rotate it.
  const OCR_TARGET_PX = 2400;            // longest side after scaling
  const OCR_PASSES = [
    { rot: 0, mode: 'gray' },
    { rot: 90, mode: 'gray' },           // portrait shot of a landscape card
    { rot: 270, mode: 'gray' },
    { rot: 0, mode: 'bin' },             // heavy glare / low contrast
    { rot: 180, mode: 'gray' }
  ];
  const OCR_CONFIDENT = 75;              // a pass this confident that finds nothing ends the scan

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

  function makeVariant(bitmap, rot, mode) {
    const w0 = bitmap.width, h0 = bitmap.height;
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
    ctx.drawImage(bitmap, -w / 2, -h / 2, w, h);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    psDocScan.enhance(img);
    if (mode === 'bin') psDocScan.binarize(img);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  const alnumCount = (s) => (String(s).match(/[A-Za-z0-9]/g) || []).length;

  // ── Drag & drop ────────────────────────────────────────────────────────────
  imgDrop.addEventListener('click', () => imgInput.click());
  imgDrop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); imgInput.click(); } });

  imgDrop.addEventListener('dragover', (e) => { e.preventDefault(); imgDrop.classList.add('drag-over'); });
  imgDrop.addEventListener('dragleave', () => imgDrop.classList.remove('drag-over'));
  imgDrop.addEventListener('drop', (e) => {
    e.preventDefault();
    imgDrop.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleImageFile(file);
  });

  imgInput.addEventListener('change', () => {
    const file = imgInput.files[0];
    if (file) handleImageFile(file);
    imgInput.value = ''; // reset so the same file can be re-selected
  });

  // ── Photo redaction ─────────────────────────────────────────────────────────
  // Photo redaction (local, Canvas API only): when any PII is detected, the WHOLE photo is
  // pixelated (mosaic). Simple and complete: no OCR box can be missed. Nothing leaves the browser.
  const PIXEL_BLOCK = 14;               // block size for a ~1000px photo
  const PIXEL_BLOCKS_ACROSS = 70;       // keep the same chunkiness on high-resolution photos

  /**
   * Mosaic: fill each blockSize×blockSize cell with the cell's average colour.
   * Reads the region once (one getImageData) instead of once per cell, so big photos stay fast.
   */
  function pixelateRegion(ctx, x, y, w, h, blockSize = 12) {
    x = Math.max(0, Math.floor(x)); y = Math.max(0, Math.floor(y));
    w = Math.min(ctx.canvas.width - x, Math.ceil(w)); h = Math.min(ctx.canvas.height - y, Math.ceil(h));
    if (w <= 0 || h <= 0) return;
    const bs = Math.max(2, Math.round(blockSize));
    const img = ctx.getImageData(x, y, w, h);
    const d = img.data;
    for (let by = 0; by < h; by += bs) {
      const bh = Math.min(bs, h - by);
      for (let bx = 0; bx < w; bx += bs) {
        const bw = Math.min(bs, w - bx);
        let r = 0, g = 0, b = 0;
        for (let yy = by; yy < by + bh; yy++) {
          for (let xx = bx, i = (yy * w + bx) * 4; xx < bx + bw; xx++, i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
        }
        const n = bw * bh;
        ctx.fillStyle = `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`;
        ctx.fillRect(x + bx, y + by, bw, bh);
      }
    }
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
    const block = Math.max(PIXEL_BLOCK, Math.round(Math.max(canvas.width, canvas.height) / PIXEL_BLOCKS_ACROSS));
    pixelateRegion(ctx, 0, 0, canvas.width, canvas.height, block);
    return { canvas, boxes: 1 };
  }

  /** Output type + file name for the download (keeps JPEG/WEBP, everything else becomes PNG). */
  function redactedOutput(file) {
    const keep = file.type === 'image/jpeg' || file.type === 'image/webp';
    const mime = keep ? file.type : 'image/png';
    let name = file.name || 'image.png';
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

  /** Append the redacted preview + download button (or a note when nothing could be located). */
  function showRedaction(redaction, originalFileName, file) {
    const ss = SCAN_STR[lang] || SCAN_STR.id;
    const wrap = document.createElement('div');
    wrap.className = 'img-redact';
    if (!redaction || !redaction.boxes) {
      const p = document.createElement('p');
      p.className = 'muted small';
      p.textContent = ss.redactNoBoxes;
      wrap.appendChild(p);
      imgResult.appendChild(wrap);
      return;
    }
    const title = document.createElement('div');
    title.className = 'img-redact-title';
    title.textContent = ss.redactTitle;
    const preview = redaction.canvas;
    preview.id = 'redactedPreview';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'downloadRedacted';
    btn.textContent = ss.redactDownload;
    const out = redactedOutput({ type: file.type, name: originalFileName });
    btn.addEventListener('click', () => downloadCanvas(preview, out.mime, out.name));
    wrap.append(title, preview, btn);
    imgResult.appendChild(wrap);
  }

  // ── Core: handle an image file ─────────────────────────────────────────────
  function showResult(kind, title, body, fields) {
    const fieldsHtml = fields && fields.length
      ? `<div class="img-result-fields">${esc((SCAN_STR[lang] || SCAN_STR.id).warnFields(fields.join(', ')))}</div>` : '';
    imgResult.innerHTML = `
      <div class="img-result-card ${kind}">
        <div class="img-result-title">${esc(title)}</div>
        ${body ? `<div class="img-result-body">${esc(body)}</div>` : ''}
        ${fieldsHtml}
      </div>`;
    imgResult.hidden = false;
  }

  let scanSeq = 0;

  async function handleImageFile(file) {
    const ss = SCAN_STR[lang] || SCAN_STR.id;
    const seq = ++scanSeq;               // a newer drop cancels the display of an older scan
    imgResult.hidden = true;
    imgResult.innerHTML = '';
    imgScanning.hidden = true;

    if (!file.type.startsWith('image/')) return { status: 'error' };
    const originalFileName = file.name;

    const previewUrl = URL.createObjectURL(file);
    imgPreview.src = previewUrl;
    imgPreview.hidden = false;
    imgPreview.onload = () => URL.revokeObjectURL(previewUrl);

    imgScanning.textContent = ss.scanScanning;
    imgScanning.hidden = false;

    let analysis = null;
    let allText = '';
    let bitmap = null;
    try {
      let worker;
      [worker, bitmap] = await Promise.all([getTesseractWorker(), loadBitmap(file)]);
      let emptyPasses = 0;
      for (let i = 0; i < OCR_PASSES.length; i++) {
        if (seq !== scanSeq) { if (bitmap.close) bitmap.close(); return { status: 'cancelled' }; }
        const { rot, mode } = OCR_PASSES[i];
        if (i > 0) imgScanning.textContent = ss.scanStep(i + 1, OCR_PASSES.length);
        const { data } = await worker.recognize(makeVariant(bitmap, rot, mode));
        const text = (data && data.text) || '';
        allText += '\n' + text;
        analysis = psDocScan.analyze(allText, (typeof psDetectAll === 'function') ? psDetectAll : null);
        if (analysis.sensitive || analysis.findings.some((f) => f.type !== 'NAME')) break;
        if (alnumCount(text) < 4) { if (++emptyPasses >= 2) break; continue; }
        // Read cleanly and found nothing sensitive: the photo is upright and simply not a document.
        if ((data.confidence || 0) >= OCR_CONFIDENT && alnumCount(text) >= 20) break;
      }
    } catch (err) {
      if (bitmap && typeof bitmap.close === 'function') bitmap.close();
      if (seq !== scanSeq) return { status: 'cancelled' };
      imgScanning.hidden = true;
      showResult('err', ss.warnNoText || 'OCR failed. Try again.', '');
      return { status: 'error' };
    }

    const closeBitmap = () => { if (bitmap && typeof bitmap.close === 'function') bitmap.close(); };
    if (seq !== scanSeq) { closeBitmap(); return { status: 'cancelled' }; }
    imgScanning.hidden = true;

    if (!analysis || alnumCount(allText) < 4) {
      closeBitmap();
      showResult('err', ss.warnNoText, '');
      return { status: 'notext' };
    }

    // ANY detected PII counts (any document type, or none): NIK, NPWP, passport, phone, email,
    // name, … plus a recognised ID document even when OCR could not read its number cleanly.
    const hasPII = analysis.sensitive || analysis.findings.length > 0;
    if (hasPII) {
      let docLabel = '';
      if (analysis.docType) {
        const docInfo = (typeof PS_DOC_TYPES !== 'undefined' && PS_DOC_TYPES[analysis.docType]);
        docLabel = docInfo ? (lang === 'id' ? docInfo.id : (docInfo.en || docInfo.id)) : analysis.docType;
      }
      const labels = [];
      for (const key of analysis.fields) {
        const l = psDocScan.FIELD_LABELS[key];
        if (l) labels.push(l[lang] || l.id);
      }
      for (const f of analysis.findings) {
        const info = (typeof PS_TYPE_LABELS !== 'undefined' && PS_TYPE_LABELS[f.type]);
        labels.push(info ? (lang === 'id' ? info.id : info.en) : f.type);
      }
      const fieldLabels = [...new Set(labels)];
      const title = docLabel
        ? (lang === 'id' ? `⚠️ ${docLabel} terdeteksi` : `⚠️ ${docLabel} detected`)
        : (lang === 'id' ? '⚠️ Data sensitif terdeteksi' : '⚠️ Sensitive data detected');
      showResult('warn', title, ss.warnBody, fieldLabels);

      // Add-on: pixelate the PII on a copy of the photo for a safe download.
      let redaction = null;
      try {
        redaction = redactImage(bitmap, analysis.findings, analysis.docType);
      } catch (_) { redaction = null; }
      closeBitmap();
      showRedaction(redaction, originalFileName, file);
      return { status: 'pii', labels: fieldLabels, docType: analysis.docType, redaction };
    } else {
      closeBitmap();
      const okTitle = lang === 'id' ? '✅ Tidak ada data sensitif' : '✅ No sensitive data found';
      showResult('ok', okTitle, ss.okBody, []);
      const safe = document.createElement('p');
      safe.className = 'img-redact-safe';
      safe.textContent = ss.redactSafe;
      imgResult.appendChild(safe);
      return { status: 'clean' };
    }
  }


  // ── Scan requests from ChatGPT / Gemini (relayed by the service worker) ────
  // The content script holds an upload back while the photo is scanned here with the same OCR +
  // pixelation pipeline; the result (and the pixelated copy) goes back the same way.
  function canvasToDataUrl(canvas, mime) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) { reject(new Error('encode_failed')); return; }
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || ''));
        r.onerror = () => reject(new Error('encode_failed'));
        r.readAsDataURL(blob);
      }, mime, 0.92);
    });
  }

  async function scanForPage(msg) {
    const m = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/i.exec(String(msg.dataUrl || ''));
    if (!m) return { success: false, error: 'bad_image' };
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const file = new File([bytes], String(msg.fileName || 'image'), { type: m[1] });
    const r = await handleImageFile(file);
    if (!r || r.status === 'cancelled') return { success: false, error: 'cancelled' };
    if (r.status === 'error') return { success: false, error: 'ocr_failed' };
    // No readable text (a landscape, a meme, …) or nothing sensitive: let it through.
    if (r.status !== 'pii') return { success: true, hasPII: false, types: [] };
    const out = { success: true, hasPII: true, types: r.labels || [], docType: r.docType || null };
    if (r.redaction && r.redaction.boxes) {
      const o = redactedOutput(file);
      out.pixelatedMime = o.mime;
      out.pixelatedDataUrl = await canvasToDataUrl(r.redaction.canvas, o.mime);
    }
    return out;
  }

  if (hasChrome && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      // Only from our own service worker (never directly from a web page's content script).
      if (!msg || msg.type !== 'PS_PANEL_SCAN_IMAGE' || sender.tab || sender.id !== chrome.runtime.id) return false;
      scanForPage(msg).then(sendResponse, () => sendResponse({ success: false, error: 'scan_failed' }));
      return true;
    });
  }

  // Apply scanner i18n once languages are loaded.
  applyScanI18n();
})();
