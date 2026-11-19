// PromptShield popup: dashboard (counts only), proof of the last masked prompt, settings, sandbox.
'use strict';

(() => {
  // Design tokens shared with the in-page UI.
  const style = document.createElement('style');
  style.textContent = PS_TOKENS_CSS;
  document.head.prepend(style);

  const STR = {
    id: {
      sub: 'Otomatis di chatgpt.com · foto & PDF juga di web.whatsapp.com · situs lain lewat panel samping',
      openPanel: 'Buka panel samping (semua situs)', panelFail: 'Panel samping tidak bisa dibuka di jendela ini. Coba pintasan Alt+Shift+P.',
      tabOverview: 'Ringkasan', tabTry: 'Coba', tabSettings: 'Pengaturan',
      protected: 'data sensitif disamarkan', last7: '7 hari terakhir',
      rightSized: 'Saran model diterima', energy: 'Energi dihemat', potential: 'Potensi hemat', estimate: 'estimasi',
      byType: 'Per jenis data', lastSent: 'Terakhir dikirim ke AI',
      noneSent: 'Belum ada prompt yang disamarkan di sesi browser ini.',
      proofLine: 'Hanya teks bertanda ini yang meninggalkan browser. Nilai asli tetap terenkripsi di perangkatmu.',
      privacyFoot: 'Statistik hanya berupa hitungan, tanpa isi prompt. PromptShield tidak melakukan koneksi jaringan. Energi adalah perkiraan dari asumsi, bukan pengukuran.',
      tryLabel: 'Tempel teks untuk dicoba', sample: 'Contoh', scan: 'Pindai',
      detected: 'Terdeteksi', aiSees: 'Yang dilihat AI', advice: 'Saran model',
      none: 'Tidak ada data sensitif terdeteksi.',
      typesTitle: 'Jenis data yang dideteksi', behaviour: 'Perilaku',
      rsToggle: 'Tampilkan saran model (right-size)', debugToggle: 'Log debug di Console (hanya jenis & jumlah)', threshold: 'Ambang keyakinan', language: 'Bahasa',
      vault: 'Brankas lokal', vaultCount: 'Nilai tersimpan (terenkripsi)', ttl: 'Hapus otomatis setelah',
      clearNow: 'Hapus brankas sekarang', cleared: 'Terhapus.',
      vaultFoot: 'Nilai asli dienkripsi AES-GCM-256 dengan kunci yang tidak bisa diekspor, disimpan di IndexedDB ekstensi, dan dipakai hanya untuk memulihkan balasan di layar.',
      bigLarge: 'Prompt ini kemungkinan butuh model besar.'
    },
    en: {
      sub: 'Automatic on chatgpt.com · photos & PDFs also on web.whatsapp.com · any other site via the side panel',
      openPanel: 'Open side panel (any site)', panelFail: 'Could not open the side panel in this window. Try the Alt+Shift+P shortcut.',
      tabOverview: 'Overview', tabTry: 'Try', tabSettings: 'Settings',
      protected: 'sensitive items masked', last7: 'last 7 days',
      rightSized: 'Model suggestions accepted', energy: 'Energy saved', potential: 'Potential saving', estimate: 'estimate',
      byType: 'By data type', lastSent: 'Last sent to the AI',
      noneSent: 'No masked prompt yet in this browser session.',
      proofLine: 'Only the highlighted text left your browser. The real values stay encrypted on your device.',
      privacyFoot: 'Statistics are counts only, never prompt content. PromptShield makes no network connections. Energy is estimated from stated assumptions, not measured.',
      tryLabel: 'Paste text to try', sample: 'Sample', scan: 'Scan',
      detected: 'Detected', aiSees: 'What the AI sees', advice: 'Model suggestion',
      none: 'No sensitive data found.',
      typesTitle: 'Data types to detect', behaviour: 'Behaviour',
      rsToggle: 'Show model suggestions (right-size)', debugToggle: 'Debug logs in Console (types & counts only)', threshold: 'Confidence threshold', language: 'Language',
      vault: 'Local vault', vaultCount: 'Stored values (encrypted)', ttl: 'Auto-delete after',
      clearNow: 'Clear vault now', cleared: 'Cleared.',
      vaultFoot: 'Real values are encrypted with AES-GCM-256 using a non-extractable key, stored in the extension\'s IndexedDB, and used only to restore replies on screen.',
      bigLarge: 'This prompt likely needs a large model.'
    }
  };

  const hasChrome = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage;
  const send = (msg) => new Promise((resolve) => {
    if (!hasChrome) return resolve(null);
    try {
      chrome.runtime.sendMessage(msg, (res) => resolve(chrome.runtime.lastError ? null : res));
    } catch (_) { resolve(null); }
  });
  const getSettings = () => new Promise((resolve) => {
    if (!hasChrome) return resolve({ ...PS_DEFAULTS });
    chrome.storage.local.get('ps_settings', (r) => {
      const s = (r && r.ps_settings) || {};
      resolve({ ...PS_DEFAULTS, ...s, enabledTypes: { ...PS_DEFAULTS.enabledTypes, ...(s.enabledTypes || {}) } });
    });
  });
  const saveSettings = (s) => hasChrome && chrome.storage.local.set({ ps_settings: s });

  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let settings = { ...PS_DEFAULTS };
  let lang = 'en';
  let S = STR.en;

  function applyI18n() {
    lang = psResolveLang(settings.lang);
    S = STR[lang];
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = S[el.dataset.i18n] || ''; });
  }

  $('#brand-icon').innerHTML = PS_ICONS.shield;
  $('#panel-icon').innerHTML = PS_ICONS.shield;

  // Side panel: get the window id up front so open() runs synchronously inside the click (user gesture).
  let currentWindowId = null;
  try { if (hasChrome && chrome.windows) chrome.windows.getCurrent((w) => { currentWindowId = w && w.id; }); } catch (_) { /* preview */ }
  $('#btn-panel').addEventListener('click', () => {
    if (!hasChrome || !chrome.sidePanel || currentWindowId == null) { $('#panel-msg').textContent = S.panelFail; return; }
    chrome.sidePanel.open({ windowId: currentWindowId })
      .then(() => window.close())
      .catch(() => { $('#panel-msg').textContent = S.panelFail; });
  });
  $('#proof-icon').innerHTML = PS_ICONS.check;

  // Tabs
  document.querySelectorAll('.seg [role="tab"]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.seg [role="tab"]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    document.querySelectorAll('.tab').forEach((t) => { t.hidden = t.id !== `tab-${b.dataset.tab}`; });
    if (b.dataset.tab === 'overview') loadOverview();
    if (b.dataset.tab === 'settings') loadVaultCount();
  }));

  const typeLabel = (t) => (PS_TYPE_LABELS[t] || {})[lang] || t;
  const fmtWh = (n) => psFmtNumber(n, lang);

  // ---------------- Overview ----------------
  async function loadOverview() {
    const res = await send({ action: PS_ACTIONS.STATS });
    const st = (res && res.stats) || { totalItemsProtected: 0, byType: {}, promptsRightSized: 0, energySavedWhMin: 0, energySavedWhMax: 0, daily: [] };
    $('#stat-protected').textContent = (st.totalItemsProtected || 0).toLocaleString(lang === 'id' ? 'id-ID' : 'en-US');
    $('#stat-rightsized').textContent = String(st.promptsRightSized || 0);
    const min = st.energySavedWhMin || 0, max = st.energySavedWhMax || 0;
    $('#stat-energy').textContent = max > 0 ? `≈ ${fmtWh(min)}–${fmtWh(max)} Wh` : '0 Wh';
    const pmin = st.potentialWhMin || 0, pmax = st.potentialWhMax || 0;
    $('#stat-potential').textContent = pmax > 0 ? `≈ ${fmtWh(pmin)}–${fmtWh(pmax)} Wh` : '0 Wh';

    const list = $('#by-type');
    list.innerHTML = Object.values(PS_TYPES).map((t) =>
      `<li class="cell"><span>${esc(typeLabel(t))}</span><span class="value tnum">${(st.byType && st.byType[t]) || 0}</span></li>`).join('');

    drawSpark(st.daily || []);

    const last = await send({ action: PS_ACTIONS.GET_LAST_SENT });
    const pre = $('#last-sent');
    if (last && last.lastSent && last.lastSent.text) {
      pre.innerHTML = esc(last.lastSent.text).replace(/\[([A-Z]+(?:_[A-Z]+)*_\d+)\]/g, '<mark class="tok">[$1]</mark>');
    } else {
      pre.textContent = S.noneSent;
    }
  }

  function drawSpark(daily) {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const e = daily.find((x) => x.date === key);
      days.push(e ? e.items : 0);
    }
    const max = Math.max(1, ...days);
    const W = 140, H = 32, pad = 3;
    const pts = days.map((v, i) => [pad + i * ((W - 2 * pad) / 6), H - pad - (v / max) * (H - 2 * pad)]);
    const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    const last = pts[pts.length - 1];
    const svg = $('#spark');
    svg.setAttribute('aria-label', `${S.last7}: ${days.join(', ')}`);
    svg.innerHTML = `<path d="${path}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${last[0]}" cy="${last[1]}" r="2.5" fill="currentColor"/>`;
  }

  // ---------------- Try (sandbox) ----------------
  const SAMPLE = `Yth. Customer Care Bank,

Saya ingin melaporkan kendala transfer saldo.
Nama: Rina Sari
NIK: 3171016408980002
No. HP: 081298765432
Email: rina.sari98@example.com
No. rekening BRI: 0123-01-012345-50-1
No. Kartu Debit: 4111 2222 3333 4448

Mohon dibantu rapikan kalimat komplain resmi ini. Terima kasih.`;

  $('#sim-sample').addEventListener('click', () => { $('#sim-input').value = SAMPLE; });
  $('#sim-scan').addEventListener('click', () => {
    const text = $('#sim-input').value;
    if (!text.trim()) return;
    const findings = psDetectAll(text, { enabledTypes: settings.enabledTypes });
    $('#sim-count').textContent = String(findings.length);
    $('#sim-list').innerHTML = findings.length
      ? findings.map((f) => `<li class="cell sim-row"><span>${esc(typeLabel(f.type))}${f.confidence < settings.confidenceThreshold ? ' <span class="est">?</span>' : ''}</span><span class="mono">${esc(f.value)}</span></li>`).join('')
      : `<li class="cell"><span class="muted">${esc(S.none)}</span></li>`;
    // Preview numbering only (the extension uses the vault for real tokens).
    const counters = {}, seen = new Map();
    let out = '', cur = 0;
    for (const f of findings.filter((x) => x.confidence >= settings.confidenceThreshold)) {
      const key = f.type + '\u0000' + f.value;
      if (!seen.has(key)) { counters[f.type] = (counters[f.type] || 0) + 1; seen.set(key, `[${f.type}_${counters[f.type]}]`); }
      out += text.slice(cur, f.start) + seen.get(key);
      cur = f.end;
    }
    out += text.slice(cur);
    $('#sim-masked').innerHTML = esc(out).replace(/\[([A-Z]+(?:_[A-Z]+)*_\d+)\]/g, '<mark class="tok">[$1]</mark>');

    const a = psComplexity.score(text);
    const T = PS_I18N[lang];
    const reasons = a.reasons.map((r) => `<li>${esc((psComplexity.REASON_TEXT[r] || {})[lang] || r)}</li>`).join('');
    $('#sim-advice').innerHTML = a.potentialSaving
      ? `<strong>${esc(T.rsSuggest(a.tier))}</strong><div class="muted">${esc(T.rsSaving(a.potentialSaving.min, a.potentialSaving.max))} <span class="est">${esc(T.estimate)}</span></div><ul class="reasons">${reasons}</ul>`
      : `<strong>${esc(S.bigLarge)}</strong><ul class="reasons">${reasons}</ul>`;
    $('#sim-results').hidden = false;
  });

  // ---------------- Settings ----------------
  function renderSettings() {
    $('#type-toggles').innerHTML = Object.values(PS_TYPES).map((t) => `
      <li class="cell"><label for="tt-${t}">${esc(typeLabel(t))}</label>
      <input type="checkbox" class="switch" role="switch" id="tt-${t}" data-type="${t}" ${settings.enabledTypes[t] !== false ? 'checked' : ''}></li>`).join('');
    document.querySelectorAll('#type-toggles .switch').forEach((sw) => sw.addEventListener('change', () => {
      settings.enabledTypes = { ...settings.enabledTypes, [sw.dataset.type]: sw.checked };
      saveSettings(settings);
    }));
    $('#set-rightsize').checked = !!settings.rightSize;
    $('#set-debug').checked = !!settings.debug;
    $('#set-threshold').value = String(settings.confidenceThreshold);
    $('#threshold-val').textContent = Number(settings.confidenceThreshold).toFixed(2);
    $('#set-lang').value = settings.lang || 'auto';
    $('#set-ttl').value = String(settings.vaultTtlHours || 24);
  }

  $('#set-rightsize').addEventListener('change', (e) => { settings.rightSize = e.target.checked; saveSettings(settings); });
  $('#set-debug').addEventListener('change', (e) => { settings.debug = e.target.checked; saveSettings(settings); });
  try { $('#version').textContent = hasChrome && chrome.runtime.getManifest ? '· v' + chrome.runtime.getManifest().version : ''; } catch (_) { /* preview */ }
  $('#set-threshold').addEventListener('input', (e) => {
    settings.confidenceThreshold = Number(e.target.value);
    $('#threshold-val').textContent = settings.confidenceThreshold.toFixed(2);
    saveSettings(settings);
  });
  $('#set-lang').addEventListener('change', (e) => {
    settings.lang = e.target.value;
    saveSettings(settings);
    applyI18n();
    renderSettings();
    loadOverview();
  });
  $('#set-ttl').addEventListener('change', (e) => { settings.vaultTtlHours = Number(e.target.value); saveSettings(settings); });
  $('#btn-clear').addEventListener('click', async () => {
    const res = await send({ action: PS_ACTIONS.CLEAR_VAULT });
    $('#clear-msg').textContent = res && res.success ? S.cleared : '';
    loadVaultCount();
  });

  async function loadVaultCount() {
    const res = await send({ action: PS_ACTIONS.VAULT_INFO });
    $('#vault-count').textContent = res && res.success ? String(res.count) : '–';
  }

  getSettings().then((s) => {
    settings = s;
    applyI18n();
    renderSettings();
    loadOverview();
  });

  // Counters change while the popup is open (e.g. a suggestion accepted in the side panel): refresh live.
  if (hasChrome && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.ps_stats && !$('#tab-overview').hidden) loadOverview();
    });
  }
})();
