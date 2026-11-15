/**
 * service-worker.js
 * Background service worker for PromptShield.
 * Handles: badge updates, session logging, storage write.
 */

'use strict';

// ── Badge helpers ─────────────────────────────────────────────────────────────

async function setBadge(tabId, count) {
  await chrome.action.setBadgeBackgroundColor({ color: '#d9534f' });
  await chrome.action.setBadgeText({
    tabId,
    text: count > 0 ? String(count) : '',
  });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
  }
});

// ── Session log ───────────────────────────────────────────────────────────────

async function logEvent(entry) {
  const { sessionLog = [] } = await chrome.storage.session.get('sessionLog');
  sessionLog.push({ ...entry, ts: Date.now() });
  if (sessionLog.length > 200) sessionLog.splice(0, sessionLog.length - 200);
  await chrome.storage.session.set({ sessionLog });
}

// ── Message handler ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SENSITIVE_DETECTED') {
    const tabId = sender.tab?.id;
    const { findings, url } = message.payload ?? {};

    (async () => {
      if (tabId !== undefined) {
        const key = `badgeCount_${tabId}`;
        const stored = await chrome.storage.session.get(key);
        const next = (stored[key] ?? 0) + 1;
        await chrome.storage.session.set({ [key]: next });
        await setBadge(tabId, next);
      }
      await logEvent({ findings, url, tabId });
      sendResponse({ ok: true });
    })();

    return true;
  }
});
