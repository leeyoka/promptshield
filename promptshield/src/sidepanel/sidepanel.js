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
      foot: 'Teks di panel ini tidak disimpan dan tidak dikirim ke mana pun. Nilai asli untuk placeholder dienkripsi di perangkatmu (AES-GCM) dan dihapus otomatis.'
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
      foot: 'Text in this panel is not stored and not sent anywhere. Real values behind placeholders are encrypted on your device (AES-GCM) and deleted automatically.'
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

  async function copySafe() {
    if (!input.value.trim()) return;
    btnCopy.disabled = true;
    try {
      if (!items.length) {
        await writeClipboard(input.value);
        setStatus(copyStatus, S.copiedNone, 'ok');
        return;
      }
      const r = await getSafe();
      if (!r) throw new Error('stale');
      // Safety check: no approved value may survive in the text we copy.
      const approvedValues = new Set(items.filter((i) => i.approved).map((i) => i.value));
      for (const v of approvedValues) if (r.masked.includes(v)) throw new Error('verify');
      await writeClipboard(r.masked);
      setStatus(copyStatus, r.count ? S.copiedN(r.count) : S.copiedNone, 'ok');
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
    if (acc) acc.addEventListener('click', () => {
      if (adviceAccepted) return;
      adviceAccepted = true;
      send({ action: PS_ACTIONS.RECORD, update: { adviceAccepted: { whMin: s.min, whMax: s.max } } });
      acc.textContent = S.accepted;
      acc.disabled = true;
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

  // ---------------- Settings ----------------
  function loadSettings(s) {
    settings = mergeSettings(s);
    applyI18n();
    scan();
  }
  if (hasChrome) {
    chrome.storage.local.get('ps_settings', (r) => loadSettings(r && r.ps_settings));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.ps_settings) loadSettings(changes.ps_settings.newValue);
    });
  } else {
    loadSettings(null);
  }
})();
