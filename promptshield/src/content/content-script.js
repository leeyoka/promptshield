/**
 * content-script.js
 * Intercepts form submissions and textarea sends on AI chat sites.
 * Coordinates with the background service worker via chrome.runtime.sendMessage.
 */

'use strict';

import { detectSensitiveData } from '../shared/detectors.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function showWarningBanner(textarea, findings) {
  const existing = document.getElementById('ps-warning-banner');
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.id = 'ps-warning-banner';
  banner.setAttribute('role', 'alert');
  banner.style.cssText = `
    position: sticky; top: 0; z-index: 999999;
    background: #fff3cd; border: 1px solid #ffc107;
    color: #856404; padding: 8px 12px; font-size: 13px;
    border-radius: 6px; margin-bottom: 6px;
    font-family: system-ui, sans-serif;
  `;
  banner.textContent =
    '\u26A0 PromptShield: data sensitif terdeteksi \u2013 ' + findings.join(', ') + '. Periksa sebelum mengirim.';
  textarea.insertAdjacentElement('beforebegin', banner);
  setTimeout(() => banner.remove(), 8000);
}

// ── Core intercept logic ──────────────────────────────────────────────────────

function handleBeforeSend(text, textarea) {
  const findings = detectSensitiveData(text);
  if (findings.length === 0) return true;

  showWarningBanner(textarea, findings);

  chrome.runtime.sendMessage({
    type: 'SENSITIVE_DETECTED',
    payload: { findings, url: location.href },
  });

  return false;
}

// ── Event listeners ───────────────────────────────────────────────────────────

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.shiftKey) return;
  const el = event.target;
  if (el.tagName !== 'TEXTAREA' && el.getAttribute('role') !== 'textbox') return;
  const text = el.value || el.textContent || '';
  if (!text.trim()) return;
  const safe = handleBeforeSend(text, el);
  if (!safe) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}, true);

document.addEventListener('click', (event) => {
  const btn = event.target.closest('button');
  if (!btn) return;
  const label = (btn.getAttribute('aria-label') || btn.textContent || '').toLowerCase();
  if (!label.includes('send') && btn.type !== 'submit') return;
  const form = btn.closest('form');
  const textarea = form
    ? form.querySelector('textarea, [role="textbox"]')
    : document.querySelector('textarea:focus, [role="textbox"]:focus');
  if (!textarea) return;
  const text = textarea.value || textarea.textContent || '';
  if (!text.trim()) return;
  const safe = handleBeforeSend(text, textarea);
  if (!safe) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}, true);
