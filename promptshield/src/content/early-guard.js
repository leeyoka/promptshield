// PromptShield early send guard. Runs at document_start, BEFORE the chat site's own scripts, so these
// capture-phase listeners are registered first and see Enter / send clicks before the site can act.
// The main content script (document_idle) plugs its handlers in via window.__psGuard.
// Until it is ready, any send attempt while the message box holds confident sensitive data is blocked
// (fail closed); the user can simply press send again a moment later.
'use strict';

(() => {
  if (window.__psEarlyGuard) return;
  window.__psEarlyGuard = true;

  const EVENTS = ['keydown', 'pointerdown', 'mousedown', 'click', 'submit'];

  // The message box: skip editors inside replies, take the bottom-most visible candidate.
  function composerText() {
    let el = null, bottom = -Infinity;
    const selector = /(^|\.)web\.whatsapp\.com$/.test(location.hostname)
      ? 'footer div[contenteditable="true"]'
      : '#prompt-textarea, div.ProseMirror[contenteditable="true"], form [contenteditable="true"], form textarea';
    for (const c of document.querySelectorAll(selector)) {
      if (c.closest('[data-message-author-role], article, [data-testid^="conversation-turn"], [data-turn]')) continue;
      const r = c.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.bottom > bottom) { bottom = r.bottom; el = c; }
    }
    if (!el) return '';
    return el.tagName === 'TEXTAREA' ? el.value || '' : el.innerText || el.textContent || '';
  }

  function looksLikeSend(e) {
    if (e.type === 'keydown') return e.key === 'Enter' && !e.shiftKey && !e.isComposing;
    if (e.type === 'submit') return true;
    const btn = e.target && e.target.closest ? e.target.closest('button') : null;
    if (!btn) return false;
    const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
    return btn.id === 'composer-submit-button' || /send/.test(btn.getAttribute('data-testid') || '') || /^(send|kirim)/.test(aria);
  }

  function preReady(e) {
    if (!looksLikeSend(e) || typeof psDetectAll !== 'function') return;
    const threshold = (typeof PS_DEFAULTS !== 'undefined' && PS_DEFAULTS.confidenceThreshold) || 0.7;
    if (psDetectAll(composerText()).some((f) => f.confidence >= threshold)) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }
  }

  for (const type of EVENTS) {
    window.addEventListener(type, (e) => {
      // After an extension reload this copy is orphaned: stand down and let the new instance guard.
      try { if (!chrome.runtime || !chrome.runtime.id) return; } catch (_) { return; }
      const guard = window.__psGuard;
      if (guard && typeof guard[type] === 'function') guard[type](e);
      else if (!guard) preReady(e);
    }, true);
  }
})();
