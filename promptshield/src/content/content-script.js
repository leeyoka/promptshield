// PromptShield content script for ChatGPT.
// Flow: intercept send -> detect locally -> review sheet -> mask (tokens from the encrypted vault)
//       -> write into composer -> read back and verify -> send. On ANY failure nothing is sent.
// Plus: right-size advice banner, on-screen restore of real values in replies, proof of what was sent.
//
// Depends on (loaded before this file by the manifest): constants.js, i18n.js, ui-tokens.js,
// detectors.js, complexity.js, restorer.js. This file holds no detection logic of its own.
'use strict';

(() => {
  if (window.__promptShieldLoaded) return;
  window.__promptShieldLoaded = true;

  // DEBUG logging: types, counts, selectors and timings only. Never prompt text or detected values.
  // Build default is off. Users can turn logs on in the popup (Settings > Debug logs); no file editing needed.
  const PS_DEBUG = false;
  let debugOn = PS_DEBUG;
  function dlog(...args) {
    if (debugOn) console.debug('[PromptShield]', ...args);
  }
  dlog('content script loaded');

  // ==========================================================================
  // Messaging
  // ==========================================================================
  /** chrome.runtime.sendMessage as a promise, with timeout and typed failure. */
  function sendBG(msg, timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => {
        if (!done) { done = true; reject(new Error('sendBG timeout')); }
      }, timeoutMs);
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          const err = chrome.runtime.lastError;
          if (err) reject(new Error(err.message));
          else if (!res || !res.success) reject(new Error((res && res.error) || 'no response'));
          else resolve(res);
        });
      } catch (e) {
        done = true;
        clearTimeout(timer);
        reject(e);
      }
    });
  }

  // ==========================================================================
  // Settings (read from chrome.storage.local; popup writes them)
  // ==========================================================================
  function mergeSettings(s) {
    s = s || {};
    return { ...PS_DEFAULTS, ...s, enabledTypes: { ...PS_DEFAULTS.enabledTypes, ...(s.enabledTypes || {}) } };
  }
  let settings = mergeSettings(null);
  let lang = psResolveLang(settings.lang);
  let T = PS_I18N[lang];
  function applySettings(s) {
    settings = mergeSettings(s);
    debugOn = PS_DEBUG || settings.debug === true;
    lang = psResolveLang(settings.lang);
    T = PS_I18N[lang];
    if (!settings.rightSize) hideBanner();
  }
  try {
    chrome.storage.local.get('ps_settings', (r) => applySettings(r && r.ps_settings));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.ps_settings) applySettings(changes.ps_settings.newValue);
    });
  } catch (_) { /* defaults */ }

  const typeLabel = (t) => (PS_TYPE_LABELS[t] || {})[lang] || t;

  // ==========================================================================
  // ChatGPT adapter: the ONLY place that knows ChatGPT's DOM.
  // Ordered selector fallbacks; DEBUG self-check logs which selector matched.
  // ==========================================================================
  const matchedOnce = {};
  function selfCheck(kind, selector) {
    if (matchedOnce[kind] === selector) return;
    matchedOnce[kind] = selector;
    dlog('adapter', kind, 'matched', selector);
  }
  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  const adapter = {
    composerSelectors: [
      'div#prompt-textarea[contenteditable="true"]',
      '#prompt-textarea',
      'div.ProseMirror[contenteditable="true"]',
      'form [contenteditable="true"]',
      'form textarea'
    ],
    sendSelectors: [
      '#composer-submit-button',
      'button[data-testid="send-button"]',
      'button[data-testid="fruitjuice-send-button"]',
      'form button[aria-label*="Send" i]',
      'form button[aria-label*="Kirim" i]',
      'button[aria-label^="Send" i]',
      'button[aria-label^="Kirim" i]'
    ],
    /**
     * The message box. ChatGPT can also render editable editors INSIDE replies (e.g. "Writing" blocks),
     * possibly with the same id/classes, so: ignore anything inside a conversation turn, prefer the
     * candidate that has focus, otherwise take the bottom-most visible one (the composer sits at the bottom).
     */
    findComposer() {
      const seen = new Set();
      const candidates = [];
      for (const sel of this.composerSelectors) {
        for (const el of document.querySelectorAll(sel)) {
          if (seen.has(el)) continue;
          seen.add(el);
          if (!isVisible(el) || this.isInsideReply(el)) continue;
          candidates.push({ el, sel });
        }
      }
      if (!candidates.length) return null;
      const active = document.activeElement;
      let pick = candidates.find((c) => active && (c.el === active || c.el.contains(active)));
      if (!pick) pick = candidates.reduce((a, b) => (b.el.getBoundingClientRect().bottom > a.el.getBoundingClientRect().bottom ? b : a));
      selfCheck('composer', pick.sel + (candidates.length > 1 ? ` (1 of ${candidates.length})` : ''));
      return pick.el;
    },
    /** True for elements inside a chat message (user or assistant turn), never the composer. */
    isInsideReply(el) {
      return !!el.closest('[data-message-author-role], article, [data-testid^="conversation-turn"], [data-turn]');
    },
    getText(el) {
      if (!el) return '';
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return el.value || '';
      return el.innerText || el.textContent || '';
    },
    findSendButton() {
      for (const sel of this.sendSelectors) {
        const btn = document.querySelector(sel);
        if (btn && isVisible(btn)) { selfCheck('send', sel); return btn; }
      }
      return null;
    },
    isSendEnabled(btn) {
      return !!btn && btn.isConnected && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true';
    },
    isSendButton(btn) {
      if (!btn) return false;
      if (btn.id === 'composer-submit-button') return true;
      const testId = (btn.getAttribute('data-testid') || '').toLowerCase();
      if (/(^|-)send-button$/.test(testId)) return true;
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      if (/voice|mic|attach|dictat|unggah|suara|stop|search|upload/.test(aria)) return false;
      if (/^(send|kirim)/.test(aria)) return true; // no <form> needed (the site may not use one)
      // Fallback: a submit button in the same container as the message box.
      const c = this.findComposer();
      const box = c && (c.closest('form') || (c.parentElement && c.parentElement.parentElement && c.parentElement.parentElement.parentElement));
      return !!box && box.contains(btn) && (btn.getAttribute('type') || '').toLowerCase() === 'submit';
    },
    isInComposer(target) {
      const c = this.findComposer();
      return !!c && !!target && (c === target || c.contains(target));
    },
    /** Elements that hold chat messages (restore runs only inside these). */
    messageArea() {
      return document.querySelector('main') || document.body;
    },
    isDarkTheme() {
      const html = document.documentElement;
      if (html.classList.contains('dark')) return true;
      if (html.classList.contains('light')) return false;
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
  };

  // ==========================================================================
  // Composer writing with read-back verification
  // ==========================================================================
  const normText = (s) => String(s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

  function selectAllIn(el) {
    el.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function applyWriteStrategy(strategy, el, text) {
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    selectAllIn(el);
    if (strategy === 'paste') {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    } else if (strategy === 'insertText') {
      document.execCommand('insertText', false, text);
    } else if (strategy === 'deleteThenInsert') {
      document.execCommand('delete', false, null);
      selectAllIn(el);
      document.execCommand('insertText', false, text);
    }
  }

  function waitFor(pred, timeoutMs, intervalMs = 50) {
    return new Promise((resolve) => {
      const t0 = performance.now();
      const tick = () => {
        let ok = false;
        try { ok = pred(); } catch (_) { ok = false; }
        if (ok) return resolve(true);
        if (performance.now() - t0 >= timeoutMs) return resolve(false);
        setTimeout(tick, intervalMs);
      };
      tick();
    });
  }

  /** @returns {Promise<HTMLElement|null>} the verified composer, or null */
  async function writeAndVerify(text) {
    const first = adapter.findComposer();
    if (!first) { dlog('write: composer not found'); return null; }
    const strategies = (first.tagName === 'TEXTAREA') ? ['native'] : ['paste', 'insertText', 'deleteThenInsert'];
    for (const strategy of strategies) {
      const target = adapter.findComposer();
      if (!target) return null;
      const t0 = performance.now();
      try { applyWriteStrategy(strategy, target, text); } catch (_) { dlog('write: strategy threw', strategy); }
      const ok = await waitFor(() => normText(adapter.getText(adapter.findComposer())) === normText(text), 500);
      dlog('write strategy', strategy, ok ? 'verified' : 'mismatch', Math.round(performance.now() - t0) + 'ms');
      if (ok) return adapter.findComposer();
    }
    return null;
  }

  // ==========================================================================
  // Tokens: vault in the service worker (encrypted, survives reload); local fallback
  // ==========================================================================
  const valueByToken = new Map();   // token -> original, for on-screen restore in this tab
  const localToken = psMasker.createLocalTokenizer();

  /** Get tokens for findings (same order). Vault first; page-local tokens if the vault is unavailable. */
  async function getTokens(findings) {
    try {
      const res = await sendBG({ action: PS_ACTIONS.MASK, items: findings.map((f) => ({ type: f.type, value: f.value })) });
      if (!Array.isArray(res.tokens) || res.tokens.length !== findings.length) throw new Error('bad tokens');
      return { tokens: res.tokens, source: 'vault' };
    } catch (e) {
      dlog('vault unavailable, using page-local tokens:', e.message);
      return { tokens: findings.map((f) => localToken(f.type, f.value)), source: 'local' };
    }
  }

  /** Replace approved findings with their tokens (shared core: src/shared/masker.js). */
  const buildMasked = psMasker.build;

  // ==========================================================================
  // UI host (Shadow DOM, isolated from the page)
  // ==========================================================================
  const host = document.createElement('div');
  host.id = 'promptshield-root';
  host.setAttribute('style', 'all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483646;');
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${PS_TOKENS_CSS}${UI_CSS()}</style>
    <div class="toasts" aria-live="polite"></div>
    <div class="banner-slot"></div>
    <div class="layer"></div>
    <button class="status" type="button" data-state="idle"></button>`;
  const toastsEl = root.querySelector('.toasts');
  const bannerSlot = root.querySelector('.banner-slot');
  const layer = root.querySelector('.layer');
  const statusBtn = root.querySelector('.status');

  function mountHost() {
    if (!host.isConnected) document.documentElement.appendChild(host);
  }
  mountHost();
  setInterval(mountHost, 3000);

  function syncTheme() {
    host.setAttribute('data-theme', adapter.isDarkTheme() ? 'dark' : 'light');
  }
  syncTheme();
  new MutationObserver(syncTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const partialValue = psMasker.partialValue;

  // ---------- Status indicator (idle / protected / blocked) ----------
  function setStatus(state) {
    statusBtn.dataset.state = state;
    statusBtn.innerHTML = state === 'blocked' ? PS_ICONS.alert : state === 'protected' ? PS_ICONS.shieldCheck : PS_ICONS.shield;
    const label = state === 'blocked' ? T.statusBlocked : state === 'protected' ? T.statusProtected : T.statusIdle;
    statusBtn.setAttribute('aria-label', label);
    statusBtn.title = state === 'idle' ? T.statusIdle : label;
    if (state !== 'idle') {
      clearTimeout(setStatus.t);
      setStatus.t = setTimeout(() => setStatus('idle'), 4000);
    }
  }
  setStatus('idle');
  statusBtn.addEventListener('click', () => {
    if (busy || sheet) return;
    const el = adapter.findComposer();
    const text = adapter.getText(el);
    if (!text || text.trim().length < 3) { toast(T.typeFirst, 'info'); return; }
    const findings = psDetectAll(text, { enabledTypes: settings.enabledTypes });
    if (!findings.length) { toast(T.noneFound, 'success'); return; }
    openSheet(text, findings);
  });

  // ---------- Toasts ----------
  function toast(message, kind = 'info', opts = {}) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.dataset.kind = kind;
    el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    const icon = kind === 'error' ? PS_ICONS.alert : kind === 'success' ? PS_ICONS.shieldCheck : PS_ICONS.info;
    el.innerHTML = `<span class="toast-icon">${icon}</span><span class="toast-msg">${esc(message)}</span>`;
    if (opts.actionLabel && opts.onAction) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'toast-action';
      b.textContent = opts.actionLabel;
      b.addEventListener('click', () => opts.onAction(b));
      el.appendChild(b);
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast-close';
    close.setAttribute('aria-label', T.close);
    close.innerHTML = PS_ICONS.close;
    close.addEventListener('click', () => dismiss());
    el.appendChild(close);
    toastsEl.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    const dismiss = () => {
      el.classList.remove('in');
      setTimeout(() => el.remove(), 220);
    };
    setTimeout(dismiss, opts.duration || 4000);
    return el;
  }

  function failClosed(safeText) {
    setStatus('blocked');
    toast(T.failClosed, 'error', {
      duration: 10000,
      actionLabel: safeText ? T.copySafe : null,
      onAction: async (b) => {
        try { await navigator.clipboard.writeText(safeText); b.textContent = T.copied; } catch (_) { b.textContent = T.copyFailed; }
      }
    });
  }

  // ---------- Proof sheet ----------
  function openProof(maskedText) {
    closeLayer();
    const wrap = document.createElement('div');
    wrap.className = 'scrim-wrap';
    wrap.innerHTML = `<div class="scrim"></div>
      <div class="sheet sheet-sm" role="dialog" aria-modal="true" aria-labelledby="ps-proof-title" tabindex="-1">
        <div class="sheet-head"><span class="head-icon">${PS_ICONS.shieldCheck}</span>
          <div><h2 id="ps-proof-title">${esc(T.proofTitle)}</h2></div></div>
        <pre class="proof mono">${highlightTokens(maskedText)}</pre>
        <p class="proof-line">${PS_ICONS.check}<span>${esc(T.proofLine)}</span></p>
        <div class="sheet-foot"><span></span><div class="actions"><button type="button" class="btn btn-secondary" data-act="close">${esc(T.close)}</button></div></div>
      </div>`;
    layer.appendChild(wrap);
    const sheetEl = wrap.querySelector('.sheet');
    const close = () => { wrap.remove(); };
    wrap.querySelector('[data-act="close"]').addEventListener('click', close);
    wrap.querySelector('.scrim').addEventListener('click', close);
    sheetEl.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    requestAnimationFrame(() => { wrap.classList.add('in'); wrap.querySelector('[data-act="close"]').focus(); });
  }

  function highlightTokens(text) {
    return esc(text).replace(/\[([A-Z]+(?:_[A-Z]+)*_\d+)\]/g, '<mark class="tok">[$1]</mark>');
  }

  function closeLayer() {
    layer.innerHTML = '';
  }

  // ==========================================================================
  // Review sheet
  // ==========================================================================
  let sheet = null;          // current sheet state
  let busy = false;          // masking/writing/verifying in progress
  let bypassNextSend = false;

  function openSheet(text, findings) {
    closeLayer();
    hideBanner();
    const threshold = settings.confidenceThreshold;
    const items = findings.map((f, i) => ({ ...f, id: i, approved: f.confidence >= threshold }));
    const advice = settings.rightSize ? psComplexity.score(text) : null;
    const state = { text, items, tokens: null, tokenSource: null, view: 'original', advice };
    sheet = state;
    state.tokenPromise = getTokens(items).then((r) => {
      state.tokens = r.tokens;
      state.tokenSource = r.source;
      if (sheet === state) renderPreview();
      return r;
    });

    const wrap = document.createElement('div');
    wrap.className = 'scrim-wrap';
    const rows = items.map((f) => `
      <li class="row">
        <label class="row-label" for="ps-sw-${f.id}">
          <span class="type">${esc(typeLabel(f.type))}</span>
          <span class="val mono">${esc(partialValue(f.value))}</span>
          ${f.confidence < threshold ? `<span class="badge">${esc(T.possible)}</span>` : ''}
        </label>
        <input id="ps-sw-${f.id}" class="switch" type="checkbox" role="switch" data-id="${f.id}" ${f.approved ? 'checked' : ''}
          aria-label="${esc(typeLabel(f.type))} ${esc(partialValue(f.value))}">
      </li>`).join('');

    wrap.innerHTML = `<div class="scrim"></div>
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="ps-sheet-title" aria-describedby="ps-sheet-sub" tabindex="-1">
        <div class="sheet-head">
          <span class="head-icon">${PS_ICONS.shield}</span>
          <div><h2 id="ps-sheet-title">${esc(T.sheetTitle)}</h2><p id="ps-sheet-sub">${esc(T.sheetSub)}</p></div>
        </div>
        <div class="seg" role="tablist">
          <button type="button" role="tab" data-view="original" aria-selected="true">${esc(T.viewOriginal)}</button>
          <button type="button" role="tab" data-view="masked" aria-selected="false">${esc(T.viewMasked)}</button>
        </div>
        <div class="preview" tabindex="0" aria-live="polite"></div>
        <div class="list-head">${esc(T.detected)} <span class="num">${items.length}</span></div>
        <ul class="list">${rows}</ul>
        ${advice && advice.potentialSaving ? adviceBlock(advice, 'sheet') : ''}
        <div class="sheet-foot">
          <span class="count" aria-live="polite"></span>
          <div class="actions">
            <button type="button" class="btn btn-quiet-danger" data-act="raw">${esc(T.sendRaw)}</button>
            <button type="button" class="btn btn-secondary" data-act="cancel">${esc(T.cancel)}</button>
            <button type="button" class="btn btn-primary" data-act="mask">${esc(T.maskSend)}</button>
          </div>
        </div>
      </div>`;
    layer.appendChild(wrap);
    state.wrap = wrap;

    const sheetEl = wrap.querySelector('.sheet');
    const maskBtn = wrap.querySelector('[data-act="mask"]');

    function updateCount() {
      const n = items.filter((i) => i.approved).length;
      wrap.querySelector('.count').textContent = T.nOfM(n, items.length);
      maskBtn.disabled = n === 0;
    }
    function renderPreview() {
      const pv = wrap.querySelector('.preview');
      if (state.view === 'original') {
        let html = '', cur = 0;
        for (const f of [...items].sort((a, b) => a.start - b.start)) {
          if (f.start < cur) continue;
          html += esc(text.slice(cur, f.start));
          html += `<mark class="hl ${f.approved ? 'on' : 'off'}" title="${esc(typeLabel(f.type))}">${esc(f.value)}</mark>`;
          cur = f.end;
        }
        pv.innerHTML = html + esc(text.slice(cur));
      } else if (!state.tokens) {
        pv.innerHTML = `<span class="muted">${esc(T.preparing)}</span>`;
      } else {
        try { pv.innerHTML = highlightTokens(buildMasked(text, items, state.tokens)); }
        catch (_) { pv.innerHTML = `<span class="muted">${esc(T.preparing)}</span>`; }
      }
    }
    state.renderPreview = renderPreview;

    wrap.querySelectorAll('.seg [role="tab"]').forEach((b) => b.addEventListener('click', () => {
      state.view = b.dataset.view;
      wrap.querySelectorAll('.seg [role="tab"]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      renderPreview();
    }));
    wrap.querySelectorAll('.switch').forEach((sw) => sw.addEventListener('change', () => {
      const it = items.find((i) => i.id === Number(sw.dataset.id));
      if (it) it.approved = sw.checked;
      updateCount();
      renderPreview();
    }));
    wrap.querySelector('[data-act="cancel"]').addEventListener('click', () => closeSheet(true));
    wrap.querySelector('.scrim').addEventListener('click', () => closeSheet(true));
    wrap.querySelector('[data-act="raw"]').addEventListener('click', () => sendRaw());
    maskBtn.addEventListener('click', () => maskedSend(state));
    wireAdvice(wrap, advice);

    sheetEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSheet(true); return; }
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        const tag = (e.target.tagName || '').toLowerCase();
        if (tag !== 'button' && tag !== 'input') { e.preventDefault(); e.stopPropagation(); if (!maskBtn.disabled) maskedSend(state); }
        return;
      }
      if (e.key === 'Tab') {
        const f = [...sheetEl.querySelectorAll('button:not([disabled]), input, [tabindex="0"]')];
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        const active = root.activeElement;
        if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
      }
    });

    updateCount();
    renderPreview();
    requestAnimationFrame(() => { wrap.classList.add('in'); maskBtn.focus(); });
  }

  function closeSheet(refocus) {
    if (sheet && sheet.wrap) {
      const w = sheet.wrap;
      w.classList.remove('in');
      setTimeout(() => w.remove(), 180);
    }
    sheet = null;
    if (refocus) { const c = adapter.findComposer(); if (c) c.focus(); }
  }

  // ==========================================================================
  // Send paths
  // ==========================================================================
  function clickSendOurselves(btn) {
    bypassNextSend = true;
    try { btn.click(); } finally { bypassNextSend = false; }
  }

  function sendRaw() {
    const text = sheet && sheet.text;
    closeSheet(false);
    const btn = adapter.findSendButton();
    if (!adapter.isSendEnabled(btn)) { toast(T.noSendButton, 'error'); return; }
    clickSendOurselves(btn);
    recordPotential(text);
    dlog('unmasked send released by user');
  }

  async function maskedSend(state) {
    if (busy) return;
    const approved = state.items.filter((i) => i.approved);
    if (!approved.length) { toast(T.nothingToMask, 'error'); return; }
    const original = state.text;
    busy = true;
    closeSheet(false);
    let masked = null;
    try {
      const { tokens, source } = state.tokens ? { tokens: state.tokens, source: state.tokenSource } : await state.tokenPromise;
      masked = buildMasked(original, state.items, tokens);
      dlog('masking', { items: approved.length, tokenSource: source });

      if (!(await writeAndVerify(masked))) throw new Error('write not verified');
      if (!(await waitFor(() => adapter.isSendEnabled(adapter.findSendButton()), 1500))) throw new Error('send button not enabled');
      if (normText(adapter.getText(adapter.findComposer())) !== normText(masked)) throw new Error('composer changed before send');

      if (aiView) setAiView(false); // new reply should show real values again
      for (const f of approved) valueByToken.set(tokens[f.id], f.value);
      rememberSent(masked);
      clickSendOurselves(adapter.findSendButton());
      dlog('masked send released', { items: approved.length });

      const accepted = await waitFor(() => normText(adapter.getText(adapter.findComposer())) === '', 4000);
      dlog('send accepted by site:', accepted);
      if (!accepted) { toast(T.readyInBox, 'info', { duration: 7000 }); return; }

      setStatus('protected');
      const byType = {};
      for (const f of approved) byType[f.type] = (byType[f.type] || 0) + 1;
      sendBG({ action: PS_ACTIONS.RECORD, update: { items: byType } }).catch((e) => dlog('record failed', e.message));
      sendBG({ action: PS_ACTIONS.SET_LAST_SENT, text: masked, site: location.hostname }).catch(() => {});
      recordPotential(original);
      toast(T.sentOk(approved.length), 'success', { duration: 6000, actionLabel: T.viewSent, onAction: () => openProof(masked) });
      resetBannerForNextPrompt();
    } catch (err) {
      dlog('masked send aborted:', err && err.message);
      try { await writeAndVerify(original); } catch (_) { /* best effort: put the draft back */ }
      failClosed(masked);
    } finally {
      busy = false;
    }
  }

  // ==========================================================================
  // Interception (capture phase, before the site's own handlers)
  // ==========================================================================
  function block(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  function onSendIntent(e) {
    if (bypassNextSend) { bypassNextSend = false; dlog('releasing our own send'); return; }
    if (busy || sheet) { block(e); return; }
    const el = adapter.findComposer();
    const text = adapter.getText(el);
    if (!text || text.trim().length < 3) return;
    const findings = psDetectAll(text, { enabledTypes: settings.enabledTypes });
    const actionable = findings.filter((f) => f.confidence >= settings.confidenceThreshold);
    dlog('scan', { chars: text.length, findings: findings.length, actionable: actionable.length, types: findings.map((f) => f.type) });
    if (!actionable.length) { recordPotential(text); resetBannerForNextPrompt(); return; } // silent when nothing (confident) is found
    block(e);
    openSheet(text, findings);
  }

  /** True while the message box holds data that would open the review sheet. */
  function hasActionableFindings() {
    const text = adapter.getText(adapter.findComposer());
    if (!text || text.trim().length < 3) return false;
    return psDetectAll(text, { enabledTypes: settings.enabledTypes }).some((f) => f.confidence >= settings.confidenceThreshold);
  }

  const sendButtonOf = (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('button') : null;
    return btn && adapter.isSendButton(btn) ? btn : null;
  };

  const guard = {
    keydown(e) {
      if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229) return;
      if (e.composedPath().includes(host)) return;
      const active = document.activeElement;
      if (!adapter.isInComposer(e.target) && !adapter.isInComposer(active)) return;
      onSendIntent(e);
    },
    // Some sites send on pointer/mouse down. Block those early; the following click opens the sheet.
    pointerdown(e) {
      if (e.composedPath().includes(host) || bypassNextSend || !sendButtonOf(e)) return;
      if (busy || sheet || hasActionableFindings()) block(e);
    },
    mousedown(e) { guard.pointerdown(e); },
    click(e) {
      if (e.composedPath().includes(host)) return;
      if (sendButtonOf(e)) onSendIntent(e);
    },
    submit(e) {
      const c = adapter.findComposer();
      if (c && e.target && e.target.contains && e.target.contains(c)) onSendIntent(e);
    }
  };

  if (window.__psEarlyGuard) {
    // Listeners were registered at document_start (before the site's scripts); plug in the handlers.
    window.__psGuard = guard;
    dlog('send guard attached to early listeners');
  } else {
    for (const type of Object.keys(guard)) window.addEventListener(type, guard[type], true);
    dlog('send guard registered late (early guard missing)');
  }

  // ==========================================================================
  // Image upload guard: OCR a photo (on-device, in the side panel) BEFORE the site receives it.
  // A capture-phase listener on window sees the file input's input/change events before the
  // site's own handlers (React listens at its root, Angular on the element), holds them back,
  // scans the photo, and then re-dispatches them with the original, the pixelated version, or
  // nothing. Covers every <input type="file"> in the page, including ones added later.
  // The service worker cannot run Tesseract (no DOM, no Web Workers), so it relays the photo to
  // the side panel, which already ships the OCR engine and language data.
  // ==========================================================================
  const IMG_STR = {
    id: {
      scanning: 'PromptShield sedang memindai gambar…',
      title: 'Data sensitif terdeteksi di foto',
      contains: 'Foto ini mengandung:',
      body: 'Jika dikirim, AI dapat membaca semua data sensitif ini.',
      safe: 'Kirim versi aman (pixelated)',
      cancel: 'Batalkan upload',
      anyway: 'Kirim tanpa proteksi (berisiko)',
      safeReady: 'Versi aman siap dikirim',
      clean: 'Foto aman, tidak ada data sensitif terdeteksi',
      noSafe: 'Versi aman tidak tersedia untuk foto ini.',
      panelTitle: 'Pindai foto sebelum dikirim?',
      panelBody: 'Pemindaian foto berjalan di panel samping PromptShield (OCR di perangkatmu, tanpa internet). Buka panel untuk memindai foto ini.',
      panelScan: 'Buka panel & pindai',
      scanBody: 'PromptShield sedang memeriksa foto ini di perangkatmu. Foto belum dikirim ke AI.',
      skip: 'Kirim tanpa pemindaian',
      panelFail: 'Panel tidak bisa dibuka otomatis. Tekan Alt+Shift+P, lalu pilih fotonya lagi.',
      errTitle: 'Foto tidak bisa dipindai',
      errBody: 'PromptShield tidak bisa memeriksa foto ini. Pastikan tidak ada data sensitif di dalamnya sebelum mengirim.'
    },
    en: {
      scanning: 'PromptShield is scanning the image…',
      title: 'Sensitive data found in this photo',
      contains: 'This photo contains:',
      body: 'If you send it, the AI can read all of this sensitive data.',
      safe: 'Send safe version (pixelated)',
      cancel: 'Cancel upload',
      anyway: 'Send without protection (risky)',
      safeReady: 'Safe version ready to send',
      clean: 'Photo is safe, no sensitive data found',
      noSafe: 'A safe version is not available for this photo.',
      panelTitle: 'Scan this photo before sending?',
      panelBody: 'Photo scanning runs in the PromptShield side panel (OCR on your device, no internet). Open the panel to scan this photo.',
      panelScan: 'Open panel & scan',
      scanBody: 'PromptShield is checking this photo on your device. It has not been sent to the AI yet.',
      skip: 'Send without scanning',
      panelFail: 'The panel could not be opened automatically. Press Alt+Shift+P, then choose the photo again.',
      errTitle: 'Could not scan this photo',
      errBody: 'PromptShield could not check this photo. Make sure it holds no sensitive data before sending.'
    }
  };
  const IS = () => IMG_STR[lang] || IMG_STR.id;

  const releasedEvents = new WeakSet();   // events we re-dispatch ourselves
  const pendingInputs = new WeakSet();    // inputs whose files are being scanned
  const isImageFile = (f) => !!f && /^image\//.test(f.type || '');

  // Three ways a photo reaches the chat: the file picker (<input type="file">), Ctrl+V paste, and
  // drag & drop. Each is held back the same way and handed to guardImageUpload() as a "source":
  // {files, release(files?), cancel()}.

  function onFileInputEvent(e) {
    const input = e.composedPath ? e.composedPath()[0] : e.target;   // real target, even inside an open shadow root
    if (!(input instanceof HTMLInputElement) || input.type !== 'file' || releasedEvents.has(e)) return;
    if (![...(input.files || [])].some(isImageFile)) return;
    // Hold the event back: the site must not see the photo until the user has decided.
    e.stopImmediatePropagation();
    e.stopPropagation();
    if (e.type !== 'change' || pendingInputs.has(input)) return;
    pendingInputs.add(input);
    console.info('[PromptShield] image upload intercepted (file picker):', [...input.files].filter(isImageFile).length, 'image(s)');
    guardImageUpload(inputSource(input))
      .catch((err) => { dlog('image guard error', err && err.message); })
      .finally(() => pendingInputs.delete(input));
  }
  window.addEventListener('input', onFileInputEvent, true);
  window.addEventListener('change', onFileInputEvent, true);

  // Belt and braces: also hook each file input directly. 'change' is not a composed event, so an
  // input inside an (open) shadow root never reaches the window listener above.
  function attachFileHook(input) {
    if (input._psHooked) return;
    input._psHooked = true;
    input.addEventListener('input', onFileInputEvent, true);
    input.addEventListener('change', onFileInputEvent, true);
  }
  function findFileInputs(rootNode, out = []) {
    rootNode.querySelectorAll('input[type="file"]').forEach((i) => out.push(i));
    rootNode.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) findFileInputs(el.shadowRoot, out); });
    return out;
  }
  function hookFileInputs() {
    const inputs = findFileInputs(document);
    inputs.forEach(attachFileHook);
    return inputs.length;
  }
  console.info('[PromptShield] image guard active (file picker, paste, drag & drop). File inputs on page:', hookFileInputs());
  // ChatGPT may (re)create its file input when the upload menu opens: re-scan shortly after clicks.
  document.addEventListener('click', () => { setTimeout(hookFileInputs, 100); }, true);
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue;
      if (n.matches && n.matches('input[type="file"]')) attachFileHook(n);
      if (n.querySelectorAll) n.querySelectorAll('input[type="file"]').forEach(attachFileHook);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  /** Source for a file input: release = swap files (optional) and re-fire input + change. */
  function inputSource(input) {
    return {
      files: [...input.files],
      release(files) {
        if (files) {
          const dt = new DataTransfer();
          for (const f of files) dt.items.add(f);
          input.files = dt.files;
        }
        for (const type of ['input', 'change']) {
          const ev = new Event(type, { bubbles: true });
          releasedEvents.add(ev);
          input.dispatchEvent(ev);
        }
      },
      cancel() { try { input.value = ''; } catch (_) { /* ignore */ } }
    };
  }

  /**
   * Source for a paste / drop event. The original DataTransfer is only readable during the event,
   * so files and text are copied now; release re-dispatches a fresh event on the same target.
   */
  function transferSource(e, files) {
    const target = e.composedPath ? e.composedPath()[0] : e.target;
    const dtIn = e.type === 'paste' ? e.clipboardData : e.dataTransfer;
    let text = '';
    try { text = dtIn.getData('text/plain') || ''; } catch (_) { /* ignore */ }
    const coords = { clientX: e.clientX || 0, clientY: e.clientY || 0, screenX: e.screenX || 0, screenY: e.screenY || 0 };
    const fire = (list) => {
      const dt = new DataTransfer();
      for (const f of list) dt.items.add(f);
      if (text) dt.setData('text/plain', text);
      const init = { bubbles: true, cancelable: true, composed: true };
      const ev = e.type === 'paste'
        ? new ClipboardEvent('paste', { ...init, clipboardData: dt })
        : new DragEvent('drop', { ...init, ...coords, dataTransfer: dt });
      releasedEvents.add(ev);
      const to = target && target.isConnected ? target : document.body;
      // Our dialog took focus; give it back so the editor pastes at the caret.
      if (e.type === 'paste' && to.focus) { try { to.focus(); } catch (_) { /* ignore */ } }
      to.dispatchEvent(ev);
    };
    return {
      files,
      release(list) { fire(list || files); },
      // Keep any pasted text; for a drop this also clears the site's "drop here" overlay.
      cancel() { if (text || e.type === 'drop') fire([]); }
    };
  }

  let transferBusy = false;
  function onTransferEvent(e) {
    if (releasedEvents.has(e) || e.composedPath().includes(host)) return;
    const dtIn = e.type === 'paste' ? e.clipboardData : e.dataTransfer;
    const files = dtIn ? [...(dtIn.files || [])] : [];
    if (!files.some(isImageFile)) return;
    e.preventDefault();               // stop the browser default (e.g. opening the dropped image)
    e.stopImmediatePropagation();
    e.stopPropagation();
    if (transferBusy) return;
    transferBusy = true;
    console.info('[PromptShield] image upload intercepted (' + e.type + '):', files.filter(isImageFile).length, 'image(s)');
    guardImageUpload(transferSource(e, files))
      .catch((err) => { dlog('image guard error', err && err.message); })
      .finally(() => { transferBusy = false; });
  }
  window.addEventListener('paste', onTransferEvent, true);
  window.addEventListener('drop', onTransferEvent, true);

  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ''));
      r.onerror = () => reject(new Error('read_failed'));
      r.readAsDataURL(file);   // chunk-free: no String.fromCharCode(...bytes) stack overflow on big photos
    });
  }

  function dataUrlToFile(dataUrl, name, mime) {
    const b64 = String(dataUrl).split(',')[1] || '';
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], name, { type: mime });
  }

  function safeFileName(name, mime) {
    const ext = mime === 'image/jpeg' ? '.jpg' : mime === 'image/webp' ? '.webp' : '.png';
    const base = String(name || 'image').replace(/\.[^.]+$/, '');
    return 'safe_' + base + ext;
  }

  /** Ask the service worker to open the side panel. Must run synchronously inside a click (user gesture). */
  function openPanelNow() {
    try { chrome.runtime.sendMessage({ type: 'PS_OPEN_SIDE_PANEL' }, () => void chrome.runtime.lastError); } catch (_) { /* ignore */ }
  }

  /** OCR one photo via service worker -> side panel. Resolves {hasPII, types, pixelatedDataUrl, pixelatedMime}. */
  async function scanImageViaPanel(file, waitForPanel) {
    const dataUrl = await readAsDataUrl(file);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), 180000);   // first OCR loads the model
      try {
        chrome.runtime.sendMessage({ type: 'SCAN_IMAGE_FOR_PII', dataUrl, mimeType: file.type, fileName: file.name, waitForPanel }, (res) => {
          clearTimeout(timer);
          const err = chrome.runtime.lastError;
          if (err) reject(new Error(err.message));
          else if (!res || !res.success) reject(new Error((res && res.error) || 'no response'));
          else resolve(res);
        });
      } catch (e) { clearTimeout(timer); reject(e); }
    });
  }

  async function scanAll(images, waitForPanel) {
    const out = [];
    for (const file of images) out.push({ file, res: await scanImageViaPanel(file, waitForPanel) });
    return out;
  }

  /**
   * Modal choice dialog in the shadow root. Returns {promise, close}: the promise resolves with the
   * chosen button's `act` ('cancel' for Escape / scrim click, the safe default); close() removes the
   * dialog without resolving (used when a scan finishes and the dialog is replaced or dismissed).
   */
  function imageDialog({ danger, title, sub, types, previewUrl, note, spinner, buttons }) {
    let wrapRef = null;
    const promise = new Promise((resolve) => {
      closeLayer();
      const wrap = document.createElement('div');
      wrap.className = 'scrim-wrap';
      wrap.innerHTML = `<div class="scrim"></div>
        <div class="sheet sheet-sm img-sheet" role="dialog" aria-modal="true" aria-labelledby="ps-img-title" tabindex="-1">
          <div class="sheet-head"><span class="head-icon${danger ? ' danger' : ''}">${danger ? PS_ICONS.alert : PS_ICONS.shield}</span>
            <div><h2 id="ps-img-title">${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</div></div>
          ${spinner ? `<p class="img-scanning" role="status"><span class="ps-spin" aria-hidden="true"></span><span>${esc(IS().scanning)}</span></p>` : ''}
          ${types && types.length ? `<p class="img-types">${esc(IS().contains)} <strong>${esc(types.join(', '))}</strong></p>` : ''}
          ${previewUrl ? `<img class="img-safe-preview" alt="" src="${esc(previewUrl)}">` : ''}
          ${note ? `<p class="muted small img-note">${esc(note)}</p>` : ''}
          <div class="img-actions">${buttons.map((b) =>
            `<button type="button" class="btn ${b.cls}" data-act="${esc(b.act)}">${esc(b.label)}</button>`).join('')}</div>
        </div>`;
      layer.appendChild(wrap);
      wrapRef = wrap;
      const img = wrap.querySelector('.img-safe-preview');
      if (img) img.addEventListener('error', () => img.remove());   // page CSP may block data: images
      const finish = (act) => { wrap.remove(); resolve(act); };
      for (const b of buttons) {
        wrap.querySelector(`[data-act="${b.act}"]`).addEventListener('click', () => {
          if (b.onClickSync) b.onClickSync();          // e.g. open the side panel while the gesture is live
          finish(b.act);
        });
      }
      wrap.querySelector('.scrim').addEventListener('click', () => finish('cancel'));
      wrap.querySelector('.sheet').addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish('cancel'); }
      });
      requestAnimationFrame(() => { wrap.classList.add('in'); const f = wrap.querySelector('.img-actions .btn'); if (f) f.focus(); });
    });
    return { promise, close: () => { if (wrapRef) wrapRef.remove(); } };
  }

  /**
   * Show the "Scan this photo before sending?" dialog while OCR runs in the background.
   * Resolves {user: act} if the user decides first, else {results} or {error}.
   */
  async function scanWithPrompt(images, waitForPanel) {
    const s = IS();
    const dlg = imageDialog({
      title: s.panelTitle, sub: s.scanBody, spinner: true,
      buttons: [
        { act: 'cancel', label: s.cancel, cls: 'btn-secondary' },
        { act: 'skip', label: s.skip, cls: 'btn-quiet-danger' }
      ]
    });
    const scan = scanAll(images, waitForPanel).then((results) => ({ results }), (error) => ({ error }));
    const first = await Promise.race([dlg.promise.then((act) => ({ user: act })), scan]);
    dlg.close();
    return first;
  }

  async function guardImageUpload(src) {
    const all = src.files;
    const images = all.filter(isImageFile);   // every image is scanned: no filename / doc-type filter
    const s = IS();

    let outcome = await scanWithPrompt(images, false);

    if (outcome.error && /panel_closed/.test(outcome.error.message)) {
      // OCR lives in the side panel; ask before opening it (opening needs this click as a user gesture).
      const act = await imageDialog({
        title: s.panelTitle, sub: s.panelBody,
        buttons: [
          { act: 'scan', label: s.panelScan, cls: 'btn-primary', onClickSync: openPanelNow },
          { act: 'cancel', label: s.cancel, cls: 'btn-secondary' },
          { act: 'skip', label: s.skip, cls: 'btn-quiet-danger' }
        ]
      }).promise;
      if (act === 'cancel') { src.cancel(); return; }
      if (act === 'skip') { src.release(); return; }
      outcome = await scanWithPrompt(images, true);
      if (outcome.error && /panel_closed/.test(outcome.error.message)) {
        src.cancel();
        toast(s.panelFail, 'error', { duration: 9000 });
        return;
      }
    }

    // The user decided while the scan was still running.
    if (outcome.user) {
      if (outcome.user === 'skip') src.release(); else src.cancel();
      return;
    }

    if (outcome.error) {
      // Fail closed: nothing reaches the site until the user decides.
      const act = await imageDialog({
        danger: true, title: s.errTitle, sub: s.errBody,
        buttons: [
          { act: 'cancel', label: s.cancel, cls: 'btn-secondary' },
          { act: 'skip', label: s.skip, cls: 'btn-quiet-danger' }
        ]
      }).promise;
      if (act === 'skip') src.release(); else src.cancel();
      return;
    }

    const results = outcome.results;
    const flagged = results.filter((r) => r.res.hasPII);
    if (!flagged.length) {
      src.release();          // clean: the prompt is already gone, upload proceeds silently
      return;
    }

    const types = [...new Set(flagged.flatMap((r) => r.res.types || []))];
    const canSafe = flagged.every((r) => r.res.pixelatedDataUrl);
    const buttons = [];
    if (canSafe) buttons.push({ act: 'safe', label: s.safe, cls: 'btn-primary' });
    buttons.push({ act: 'cancel', label: s.cancel, cls: 'btn-secondary' });
    buttons.push({ act: 'anyway', label: s.anyway, cls: 'btn-quiet-danger' });
    setStatus('blocked');
    const act = await imageDialog({
      danger: true, title: s.title, sub: s.body, types,
      previewUrl: canSafe ? flagged[0].res.pixelatedDataUrl : '',
      note: canSafe ? '' : s.noSafe,
      buttons
    }).promise;

    if (act === 'safe') {
      const files = all.map((f) => {
        const r = flagged.find((x) => x.file === f);
        return r ? dataUrlToFile(r.res.pixelatedDataUrl, safeFileName(f.name, r.res.pixelatedMime), r.res.pixelatedMime) : f;
      });
      src.release(files);
      setStatus('protected');
      toast(s.safeReady, 'success');
    } else if (act === 'anyway') {
      src.release();
    } else {
      src.cancel();
    }
  }

  // ==========================================================================
  // Right-size banner (never blocks sending)
  // ==========================================================================
  let bannerEl = null;
  let bannerKey = '';
  let bannerDismissed = false;
  let bannerAccepted = false;
  let bannerTimer = null;

  function adviceBlock(advice, where) {
    const s = advice.potentialSaving;
    const reasons = advice.reasons.map((r) => `<li>${esc((psComplexity.REASON_TEXT[r] || {})[lang] || r)}</li>`).join('');
    const assumptions = Object.values(ENERGY_ASSUMPTIONS).map((a) =>
      `<li><span class="mono">${esc(Array.isArray(a.value) ? a.value.join('–') : a.value)} ${esc(a.unit)}</span><br><span class="muted">${esc(a.source)}</span></li>`).join('');
    return `<div class="advice in-${where}">
      <div class="advice-main">
        <span class="advice-icon">${PS_ICONS.leaf}</span>
        <span class="advice-text"><strong>${esc(T.rsSuggest(advice.tier))}</strong>
          <span class="saving tnum">${esc(T.rsSaving(s.min, s.max))}</span>
          <span class="est">${esc(T.estimate)}</span></span>
        <button type="button" class="link" data-act="why" aria-expanded="false">${esc(T.why)}</button>
        <button type="button" class="btn btn-small" data-act="accept">${esc(T.rsAccept)}</button>
        ${where === 'banner' ? `<button type="button" class="icon-btn" data-act="dismiss" aria-label="${esc(T.dismiss)}">${PS_ICONS.close}</button>` : ''}
      </div>
      <div class="advice-more" hidden>
        <ul class="reasons">${reasons}</ul>
        <div class="assume-title">${esc(T.assumptions)}</div>
        <ul class="assume">${assumptions}</ul>
        <p class="muted small">${esc(T.rsNote)}</p>
      </div>
    </div>`;
  }

  function wireAdvice(container, advice) {
    const why = container.querySelector('[data-act="why"]');
    if (!why) return;
    why.addEventListener('click', () => {
      const more = container.querySelector('.advice-more');
      const open = more.hidden;
      more.hidden = !open;
      why.setAttribute('aria-expanded', String(open));
    });
    const showAccepted = () => {
      container.querySelector('.advice-main').innerHTML = `<span class="advice-icon">${PS_ICONS.check}</span><span class="advice-text">${esc(T.rsAccepted)}</span>`;
      container.querySelector('.advice-more').hidden = true;
    };
    // Already accepted for this prompt (e.g. on the banner before the review sheet opened): count once only.
    if (bannerAccepted) { showAccepted(); return; }
    const accept = container.querySelector('[data-act="accept"]');
    if (accept) accept.addEventListener('click', () => {
      if (bannerAccepted) return;
      bannerAccepted = true;
      const s = advice.potentialSaving;
      sendBG({ action: PS_ACTIONS.RECORD, update: { adviceAccepted: { whMin: s.min, whMax: s.max } } }).catch(() => {});
      showAccepted();
      if (container === bannerEl) setTimeout(hideBanner, 3500);
    });
    const dismiss = container.querySelector('[data-act="dismiss"]');
    if (dismiss) dismiss.addEventListener('click', () => { bannerDismissed = true; hideBanner(); });
  }

  // "Potential saving": once per prompt actually sent, add the advisor's own estimate when a smaller
  // model would likely have been enough. It is shown separately from "energy saved" (which only counts
  // suggestions the user accepted), so neither number claims a saving that did not happen.
  let lastPotential = { text: '', at: 0 };
  function recordPotential(text) {
    if (!settings.rightSize || !text || text.trim().length < 20) return;
    const now = Date.now();
    if (text === lastPotential.text && now - lastPotential.at < 5000) return; // keydown + submit = one send
    lastPotential = { text, at: now };
    const s = psComplexity.score(text).potentialSaving;
    if (s) sendBG({ action: PS_ACTIONS.RECORD, update: { potential: { whMin: s.min, whMax: s.max } } }).catch(() => {});
  }

  function hideBanner() {
    if (bannerEl) { bannerEl.remove(); bannerEl = null; }
  }

  function resetBannerForNextPrompt() {
    hideBanner();
    bannerKey = '';
    bannerDismissed = false;
    bannerAccepted = false;
  }

  function positionBanner() {
    if (!bannerEl) return;
    const c = adapter.findComposer();
    const anchor = (c && (c.closest('form') || c)) || null;
    if (!anchor) { hideBanner(); return; }
    const r = anchor.getBoundingClientRect();
    bannerEl.style.left = Math.max(8, r.left) + 'px';
    bannerEl.style.bottom = Math.max(8, window.innerHeight - r.top + 8) + 'px';
    bannerEl.style.maxWidth = Math.max(280, r.width) + 'px';
  }

  function updateBanner() {
    if (!settings.rightSize || sheet || busy) { hideBanner(); return; }
    const c = adapter.findComposer();
    const text = adapter.getText(c);
    if (!text || text.trim().length < 20) { resetBannerForNextPrompt(); return; }
    if (bannerDismissed || bannerAccepted) return;
    const advice = psComplexity.score(text);
    if (!advice.potentialSaving) { hideBanner(); return; }
    const key = advice.tier + ':' + advice.reasons.join(',');
    if (bannerEl && key === bannerKey) { positionBanner(); return; }
    hideBanner();
    bannerEl = document.createElement('div');
    bannerEl.className = 'banner';
    bannerEl.setAttribute('role', 'status');
    bannerEl.innerHTML = adviceBlock(advice, 'banner');
    bannerSlot.appendChild(bannerEl);
    wireAdvice(bannerEl, advice);
    positionBanner();
    requestAnimationFrame(() => bannerEl && bannerEl.classList.add('in'));
    if (key !== bannerKey) {
      sendBG({ action: PS_ACTIONS.RECORD, update: { adviceShown: true } }).catch(() => {});
      dlog('advice shown', { tier: advice.tier, reasons: advice.reasons });
    }
    bannerKey = key;
  }

  document.addEventListener('input', (e) => {
    if (!adapter.isInComposer(e.target)) return;
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(updateBanner, 700);
  }, true);
  window.addEventListener('resize', positionBanner);

  // ==========================================================================
  // Restorer: real values back on screen (text nodes only; never attributes/links)
  // ==========================================================================
  // The user's own bubbles keep showing what was actually sent (placeholders).
  // Two independent checks: ChatGPT's user-turn markers, and "this text is part of a prompt we sent".
  const SENT_KEY = 'promptshield_sent_v1';
  let sentMasked = [];
  try { sentMasked = JSON.parse(sessionStorage.getItem(SENT_KEY) || '[]'); } catch (_) { sentMasked = []; }
  function rememberSent(masked) {
    sentMasked = [...sentMasked, normText(masked)].slice(-50); // placeholders only, never real values
    try { sessionStorage.setItem(SENT_KEY, JSON.stringify(sentMasked)); } catch (_) { /* ignore */ }
  }
  const TOKEN_RE = /\[[A-Z]+(?:_[A-Z]+)*_\d+\]/g;
  function isEchoOfSentPrompt(text) {
    const n = normText(text);
    if (n.replace(TOKEN_RE, '').trim().length < 6) return false; // a bare token in a reply must still restore
    return sentMasked.some((s) => s.includes(n));
  }

  // The composer lookup is cached briefly: restore runs on every streamed text change.
  let composerCache = { el: null, at: 0 };
  function composerCached() {
    const now = performance.now();
    if (!composerCache.el || !composerCache.el.isConnected || now - composerCache.at > 500) composerCache = { el: adapter.findComposer(), at: now };
    return composerCache.el;
  }

  /**
   * Where a text node lives: 'skip' (our UI, the composer, inputs, the user's own bubbles),
   * 'editable' (an editor inside a reply, e.g. ChatGPT "Writing" blocks: never modified, because edits
   * there may be saved back to the site), or 'ok' (plain reply text: restore on screen).
   */
  function restoreZone(node) {
    const el = node.parentElement;
    if (!el) return 'skip';
    if (el.closest('#promptshield-root, textarea, input, [data-ps-norestore], [data-message-author-role="user"], [data-turn="user"]')) return 'skip';
    const composer = composerCached();
    if (composer && composer.contains(el)) return 'skip';
    if (isEchoOfSentPrompt(node.textContent)) return 'skip';
    if (el.closest('[contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]')) return 'editable';
    return 'ok';
  }

  // Text nodes we restored (for highlights and the "AI view" toggle).
  const restoredNodes = new Set();
  let aiView = false;
  let editableHasTokens = false;

  function restoreNode(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE || valueByToken.size === 0 || aiView) return;
    const t = node.textContent;
    if (!t || t.indexOf('_') === -1) return;
    const zone = restoreZone(node);
    if (zone === 'skip') return;
    if (zone === 'editable') {
      if (!editableHasTokens && psRestorer.restore(t, valueByToken).count > 0) {
        editableHasTokens = true;
        showRestoreChip();
        renderChip();
      }
      return;
    }
    const { text, count } = psRestorer.restore(t, valueByToken);
    if (count > 0) {
      restoredNodes.add(node);
      node.textContent = text;
      const p = node.parentElement;
      if (p && !p.hasAttribute('title')) p.setAttribute('title', T.restoredTip);
      scheduleHighlights();
      showRestoreChip();
    }
  }

  // Dotted underline on restored values via the CSS Custom Highlight API: no elements are inserted
  // into the site's DOM, so the site's own rendering is not disturbed.
  const pageStyle = document.createElement('style');
  pageStyle.id = 'promptshield-highlight';
  pageStyle.textContent = '::highlight(promptshield-restored){background-color:rgba(20,150,140,.16);text-decoration:underline dotted rgba(15,118,110,.9);text-decoration-thickness:1.5px;text-underline-offset:3px;}';
  (document.head || document.documentElement).appendChild(pageStyle);
  let hlTimer = null;
  function scheduleHighlights() {
    clearTimeout(hlTimer);
    hlTimer = setTimeout(updateHighlights, 120);
  }
  function updateHighlights() {
    if (!(window.CSS && CSS.highlights && typeof Highlight === 'function')) return;
    if (aiView) { CSS.highlights.delete('promptshield-restored'); return; }
    const values = [...new Set(valueByToken.values())].filter((v) => v && v.length >= 2);
    const ranges = [];
    for (const node of [...restoredNodes]) {
      if (!node.isConnected) { restoredNodes.delete(node); continue; }
      const s = node.textContent;
      for (const v of values) {
        for (let i = s.indexOf(v); i !== -1; i = s.indexOf(v, i + v.length)) {
          const r = new Range();
          r.setStart(node, i);
          r.setEnd(node, i + v.length);
          ranges.push(r);
        }
      }
    }
    CSS.highlights.set('promptshield-restored', new Highlight(...ranges));
  }

  // "AI view" toggle: show the reply exactly as the AI wrote it (placeholders), then switch back.
  let chipEl = null;
  function showRestoreChip() {
    if (chipEl) return;
    chipEl = document.createElement('div');
    chipEl.className = 'chip';
    chipEl.setAttribute('role', 'status');
    root.appendChild(chipEl);
    renderChip();
    requestAnimationFrame(() => chipEl.classList.add('in'));
  }
  function renderChip() {
    if (!chipEl) return;
    const note = !aiView && editableHasTokens ? ` ${T.chipEditable}` : '';
    chipEl.innerHTML = `<span class="chip-icon">${aiView ? PS_ICONS.shield : PS_ICONS.shieldCheck}</span>
      <span class="chip-text">${esc((aiView ? T.chipAiShown : T.chipRestored) + note)}</span>
      <span class="chip-actions">
        <button type="button" class="link" data-act="toggle">${esc(aiView ? T.chipShowReal : T.chipShowAi)}</button>
        <button type="button" class="link" data-act="copy">${esc(T.chipCopy)}</button>
      </span>`;
    chipEl.querySelector('[data-act="toggle"]').addEventListener('click', () => setAiView(!aiView));
    chipEl.querySelector('[data-act="copy"]').addEventListener('click', copyLastReplyWithRealValues);
  }

  /** Copies the latest AI reply with real values put back (also covers editable blocks). Local only. */
  async function copyLastReplyWithRealValues() {
    const replies = document.querySelectorAll('[data-message-author-role="assistant"]');
    const last = replies[replies.length - 1];
    if (!last) { toast(T.chipCopyNone, 'error'); return; }
    const text = psRestorer.restore(last.innerText || last.textContent || '', valueByToken).text;
    try {
      await navigator.clipboard.writeText(text);
      toast(T.chipCopied, 'success');
    } catch (_) {
      toast(T.copyFailed, 'error');
    }
  }
  function setAiView(on) {
    aiView = on;
    if (on) {
      // Put the placeholders back: value -> its token (longest values first).
      const byValue = new Map();
      for (const [tok, val] of valueByToken) if (val && !byValue.has(val)) byValue.set(val, tok);
      const vals = [...byValue.keys()].sort((a, b) => b.length - a.length);
      for (const node of restoredNodes) {
        if (!node.isConnected) continue;
        let txt = node.textContent;
        for (const v of vals) txt = txt.split(v).join(byValue.get(v));
        node.textContent = txt;
      }
    } else {
      for (const node of [...restoredNodes]) if (node.isConnected) restoreNode(node);
    }
    updateHighlights();
    renderChip();
  }

  function restoreTree(rootNode) {
    if (valueByToken.size === 0) return;
    const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) restoreNode(n);
  }

  new MutationObserver((mutations) => {
    if (valueByToken.size === 0) return;
    for (const m of mutations) {
      if (m.type === 'characterData') restoreNode(m.target);
      else for (const a of m.addedNodes) {
        if (a.nodeType === Node.TEXT_NODE) restoreNode(a);
        else if (a.nodeType === Node.ELEMENT_NODE) restoreTree(a);
      }
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });

  // Load tokens from the vault so replies restore after a page reload too.
  sendBG({ action: PS_ACTIONS.GET_MAP }).then((res) => {
    for (const [tok, val] of Object.entries(res.map || {})) valueByToken.set(tok, val);
    dlog('vault map loaded', { tokens: valueByToken.size });
    restoreTree(adapter.messageArea());
  }).catch((e) => dlog('vault map unavailable:', e.message));

  // ==========================================================================
  // Styles (component layer on top of ui-tokens.js)
  // ==========================================================================
  function UI_CSS() {
    return `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; }
.layer, .toasts, .banner-slot, .status { font-family: var(--ps-font); color: var(--ps-fg); -webkit-font-smoothing: antialiased; }
.mono { font-family: var(--ps-mono); }
.tnum { font-variant-numeric: tabular-nums; }
.muted { color: var(--ps-fg-3); }
.small { font-size: var(--ps-fs-12); }
button { font: inherit; color: inherit; }
:focus-visible { outline: 2px solid var(--ps-accent); outline-offset: 2px; }
svg { display: block; flex: none; }

/* Status indicator */
.status { position: fixed; right: 16px; top: 64px; z-index: 2; width: 32px; height: 32px; border-radius: 50%;
  display: grid; place-items: center; cursor: pointer; border: 1px solid var(--ps-line-2);
  background: var(--ps-bg); color: var(--ps-fg-2); box-shadow: 0 1px 2px rgba(0,0,0,.08);
  transition: color var(--ps-dur) var(--ps-ease), background var(--ps-dur) var(--ps-ease), border-color var(--ps-dur) var(--ps-ease); }
.status:hover { color: var(--ps-accent); border-color: var(--ps-accent); }
.status[data-state="protected"] { color: var(--ps-on-accent); background: var(--ps-accent); border-color: var(--ps-accent); }
.status[data-state="blocked"] { color: var(--ps-danger); border-color: var(--ps-danger); background: var(--ps-danger-soft); }

/* Sheet */
.scrim-wrap { position: fixed; inset: 0; display: grid; place-items: center; padding: var(--ps-sp-4); z-index: 10; }
.scrim { position: absolute; inset: 0; background: var(--ps-scrim); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  opacity: 0; transition: opacity var(--ps-dur) var(--ps-ease); }
.sheet { position: relative; width: min(560px, 100%); max-height: min(88vh, 760px); overflow: auto;
  background: var(--ps-bg); border: 1px solid var(--ps-line); border-radius: var(--ps-r-lg); box-shadow: var(--ps-shadow);
  padding: var(--ps-sp-5); display: flex; flex-direction: column; gap: var(--ps-sp-4);
  opacity: 0; transform: translateY(8px) scale(.985); transition: opacity var(--ps-dur) var(--ps-ease), transform var(--ps-dur) var(--ps-ease); outline: none; }
.sheet-sm { width: min(520px, 100%); }
.sheet > * { flex: none; }
.scrim-wrap.in .scrim { opacity: 1; }
.scrim-wrap.in .sheet { opacity: 1; transform: none; }
.sheet-head { display: flex; gap: var(--ps-sp-3); align-items: flex-start; }
.head-icon { width: 32px; height: 32px; border-radius: var(--ps-r-sm); display: grid; place-items: center;
  background: var(--ps-accent-soft); color: var(--ps-accent); flex: none; }
.head-icon svg { width: 18px; height: 18px; }
h2 { margin: 0; font-size: var(--ps-fs-17); font-weight: 600; letter-spacing: -.01em; line-height: 1.3; }
.sheet-head p { margin: 2px 0 0; font-size: var(--ps-fs-13); color: var(--ps-fg-2); line-height: 1.45; }

.seg { display: inline-flex; align-self: flex-start; padding: 2px; border-radius: var(--ps-r-sm); background: var(--ps-bg-3); gap: 2px; }
.seg button { border: 0; background: transparent; padding: 6px 12px; border-radius: 6px; font-size: var(--ps-fs-13); font-weight: 500;
  color: var(--ps-fg-2); cursor: pointer; min-height: 30px; }
.seg button[aria-selected="true"] { background: var(--ps-bg); color: var(--ps-fg); box-shadow: 0 1px 2px rgba(0,0,0,.08); }

.preview { font-size: var(--ps-fs-13); line-height: 1.6; white-space: pre-wrap; word-break: break-word;
  background: var(--ps-bg-2); border-radius: var(--ps-r-md); padding: var(--ps-sp-3) var(--ps-sp-4); max-height: 180px; overflow: auto; }
mark { color: inherit; background: none; }
mark.hl.on { background: var(--ps-mark); border-bottom: 1.5px solid var(--ps-accent); border-radius: 3px; padding: 0 2px; }
mark.hl.off { border-bottom: 1.5px dashed var(--ps-fg-3); }
mark.tok { font-family: var(--ps-mono); font-size: .92em; background: var(--ps-accent-soft); color: var(--ps-accent); border-radius: 4px; padding: 0 3px; }

.list-head { font-size: var(--ps-fs-12); font-weight: 600; color: var(--ps-fg-3); text-transform: uppercase; letter-spacing: .04em; margin-bottom: calc(-1 * var(--ps-sp-2)); }
.list-head .num { font-variant-numeric: tabular-nums; }
.list { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--ps-line); }
.row { display: flex; align-items: center; gap: var(--ps-sp-3); min-height: 44px; border-bottom: 1px solid var(--ps-line); }
.row-label { flex: 1; display: flex; align-items: baseline; gap: var(--ps-sp-3); min-width: 0; cursor: pointer; }
.type { font-size: var(--ps-fs-13); font-weight: 500; min-width: 88px; }
.val { font-size: var(--ps-fs-13); color: var(--ps-fg-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.badge { font-size: 11px; color: var(--ps-warn); background: var(--ps-warn-soft); border-radius: 4px; padding: 1px 6px; }

.switch { appearance: none; -webkit-appearance: none; width: 36px; height: 22px; border-radius: 11px; background: var(--ps-bg-3);
  position: relative; cursor: pointer; flex: none; margin: 0; border: 1px solid var(--ps-line-2); transition: background var(--ps-dur) var(--ps-ease); }
.switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff;
  box-shadow: 0 1px 2px rgba(0,0,0,.25); transition: transform var(--ps-dur) var(--ps-ease); }
.switch:checked { background: var(--ps-accent); border-color: var(--ps-accent); }
.switch:checked::after { transform: translateX(14px); }

.sheet-foot { display: flex; align-items: center; justify-content: space-between; gap: var(--ps-sp-3); flex-wrap: wrap; padding-top: var(--ps-sp-1); }
.count { font-size: var(--ps-fs-13); color: var(--ps-fg-2); font-variant-numeric: tabular-nums; }
.actions { display: flex; gap: var(--ps-sp-2); align-items: center; flex-wrap: wrap; margin-left: auto; }
.btn { border: 1px solid transparent; border-radius: var(--ps-r-sm); padding: 0 14px; min-height: 36px; font-size: var(--ps-fs-13); font-weight: 500; cursor: pointer;
  transition: background var(--ps-dur) var(--ps-ease), color var(--ps-dur) var(--ps-ease); }
.btn-primary { background: var(--ps-accent); color: var(--ps-on-accent); }
.btn-primary:hover { background: var(--ps-accent-hover); }
.btn-primary:disabled { opacity: .4; cursor: not-allowed; }
.btn-secondary { background: var(--ps-bg-2); border-color: var(--ps-line); }
.btn-secondary:hover { background: var(--ps-bg-3); }
.btn-quiet-danger { background: transparent; color: var(--ps-danger); padding: 0 8px; }
.btn-quiet-danger:hover { background: var(--ps-danger-soft); }
.btn-small { min-height: 28px; padding: 0 10px; font-size: var(--ps-fs-12); background: var(--ps-accent-soft); color: var(--ps-accent); }
.link { border: 0; background: none; padding: 0; color: var(--ps-accent); font-size: var(--ps-fs-12); font-weight: 500; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
.icon-btn { border: 0; background: none; width: 28px; height: 28px; border-radius: 6px; display: grid; place-items: center; color: var(--ps-fg-3); cursor: pointer; }
.icon-btn:hover { background: var(--ps-bg-3); color: var(--ps-fg); }

/* Advice (in sheet and banner) */
.advice { font-size: var(--ps-fs-13); }
.advice.in-sheet { background: var(--ps-bg-2); border-radius: var(--ps-r-md); padding: var(--ps-sp-3) var(--ps-sp-4); }
.advice-main { display: flex; align-items: center; gap: var(--ps-sp-2); flex-wrap: wrap; }
.advice-icon { color: var(--ps-accent); }
.advice-text { display: inline-flex; gap: 6px; align-items: baseline; flex-wrap: wrap; flex: 1; min-width: 0; }
.advice-text strong { font-weight: 600; }
.saving { color: var(--ps-fg-2); }
.est { font-size: 11px; color: var(--ps-fg-3); border: 1px solid var(--ps-line-2); border-radius: 4px; padding: 0 5px; text-transform: lowercase; }
.advice-more { margin-top: var(--ps-sp-2); padding-top: var(--ps-sp-2); border-top: 1px solid var(--ps-line); }
.advice-more ul { margin: 0 0 var(--ps-sp-2); padding-left: 18px; color: var(--ps-fg-2); }
.advice-more li { margin: 2px 0; line-height: 1.45; }
.assume { font-size: var(--ps-fs-12); }
.assume-title { font-size: var(--ps-fs-12); font-weight: 600; color: var(--ps-fg-3); margin-bottom: 4px; }
.advice-more p { margin: 0; }

/* Banner */
.banner { position: fixed; z-index: 1; width: max-content; background: var(--ps-bg); border: 1px solid var(--ps-line-2); border-radius: var(--ps-r-md);
  box-shadow: 0 1px 2px rgba(0,0,0,.06), 0 8px 24px rgba(0,0,0,.08); padding: 8px 8px 8px 12px; max-height: 50vh; overflow: auto;
  backdrop-filter: saturate(1.2) blur(8px); -webkit-backdrop-filter: saturate(1.2) blur(8px);
  opacity: 0; transform: translateY(4px); transition: opacity var(--ps-dur) var(--ps-ease), transform var(--ps-dur) var(--ps-ease); }
.banner.in { opacity: 1; transform: none; }

/* Toasts */
.toasts { position: fixed; z-index: 20; left: 50%; bottom: 96px; transform: translateX(-50%); display: flex; flex-direction: column; gap: 8px; align-items: center; width: max-content; max-width: calc(100vw - 32px); }
.toast { display: flex; align-items: center; gap: 10px; background: var(--ps-bg); border: 1px solid var(--ps-line-2); border-radius: var(--ps-r-md);
  box-shadow: var(--ps-shadow); padding: 8px 8px 8px 12px; font-size: var(--ps-fs-13); max-width: 560px;
  opacity: 0; transform: translateY(6px); transition: opacity var(--ps-dur) var(--ps-ease), transform var(--ps-dur) var(--ps-ease); }
.toast.in { opacity: 1; transform: none; }
.toast-icon { color: var(--ps-fg-3); }
.toast[data-kind="success"] .toast-icon { color: var(--ps-accent); }
.toast[data-kind="error"] { border-color: var(--ps-danger); }
.toast[data-kind="error"] .toast-icon { color: var(--ps-danger); }
.toast-msg { line-height: 1.4; }
.toast-action { border: 1px solid var(--ps-line-2); background: var(--ps-bg-2); border-radius: 6px; min-height: 28px; padding: 0 10px; font-size: var(--ps-fs-12); font-weight: 500; cursor: pointer; white-space: nowrap; }
.toast-close { border: 0; background: none; width: 24px; height: 24px; border-radius: 6px; display: grid; place-items: center; color: var(--ps-fg-3); cursor: pointer; }

/* Restore chip (AI view toggle) */
.chip { position: fixed; right: 56px; top: 64px; z-index: 1; display: flex; align-items: center; gap: 8px; max-width: min(520px, calc(100vw - 80px));
  background: var(--ps-bg); border: 1px solid var(--ps-line-2); border-radius: var(--ps-r-md); box-shadow: 0 1px 2px rgba(0,0,0,.06), 0 8px 24px rgba(0,0,0,.08);
  padding: 6px 12px; font-family: var(--ps-font); font-size: var(--ps-fs-12); color: var(--ps-fg-2);
  opacity: 0; transform: translateY(4px); transition: opacity var(--ps-dur) var(--ps-ease), transform var(--ps-dur) var(--ps-ease); }
.chip.in { opacity: 1; transform: none; }
.chip-icon { color: var(--ps-accent); }
.chip-text { line-height: 1.4; }
.chip .link { white-space: nowrap; }
.chip-actions { display: flex; gap: 10px; flex-wrap: wrap; }

/* Proof */
.proof { margin: 0; white-space: pre-wrap; word-break: break-word; font-size: var(--ps-fs-12); line-height: 1.6; background: var(--ps-bg-2);
  border-radius: var(--ps-r-md); padding: var(--ps-sp-3) var(--ps-sp-4); max-height: 300px; overflow: auto; }
.proof-line { display: flex; gap: 8px; align-items: flex-start; margin: 0; font-size: var(--ps-fs-13); color: var(--ps-fg-2); }
.proof-line svg { color: var(--ps-accent); margin-top: 1px; }

/* Image upload guard */
@keyframes ps-spin { to { transform: rotate(360deg); } }
.ps-spin { width: 14px; height: 14px; flex: none; border-radius: 50%; border: 2px solid var(--ps-accent-soft); border-top-color: var(--ps-accent); animation: ps-spin .8s linear infinite; }
@media (prefers-reduced-motion: reduce) { .ps-spin { animation-duration: 2.4s; } }
.head-icon.danger { background: var(--ps-danger-soft); color: var(--ps-danger); }
.img-types { margin: 0; font-size: var(--ps-fs-13); color: var(--ps-fg-2); line-height: 1.5; }
.img-types strong { color: var(--ps-fg); font-weight: 600; }
.img-safe-preview { display: block; max-width: 100%; max-height: 200px; margin: 0 auto; border-radius: var(--ps-r-sm); border: 1px solid var(--ps-line); }
.img-note { margin: 0; }
.img-scanning { display: flex; align-items: center; gap: var(--ps-sp-2); margin: 0; font-size: var(--ps-fs-13); color: var(--ps-accent); }
.img-actions { display: flex; flex-direction: column; gap: var(--ps-sp-2); }
.img-actions .btn { width: 100%; min-height: 40px; }
.img-actions .btn-quiet-danger { min-height: 32px; font-size: var(--ps-fs-12); text-decoration: underline; text-underline-offset: 2px; }

@media (max-width: 520px) {
  .sheet { padding: var(--ps-sp-4); }
  .type { min-width: 72px; }
  .actions { width: 100%; justify-content: flex-end; }
}
`;
  }
})();
