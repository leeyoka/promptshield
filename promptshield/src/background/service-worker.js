// PromptShield service worker: message router for the vault, counters, settings and proof panel.
// No detection code lives here (single source of truth is src/shared). No network calls.
'use strict';

importScripts('/src/shared/constants.js', '/src/shared/masker.js', '/src/background/vault.js');

const DEBUG = false;
function dlog(...a) { if (DEBUG) console.debug('[PromptShield SW]', ...a); }

// PDF text extraction (SCAN_PDF_FOR_PII). MV3 only allows importScripts while the worker starts, so
// PDF.js is loaded here. If it fails to load, PDF scans answer with an error and the page fails closed.
try {
  importScripts('/src/shared/detectors.js', '/lib/pdfjs/pdf.min.js', '/lib/pdfjs/pdf.worker.min.js', '/src/background/pdf-scan.js');
} catch (e) {
  dlog('PDF scanner unavailable:', e && e.message);
}

const EMPTY_STATS = () => ({
  totalItemsProtected: 0,
  byType: {},
  adviceShown: 0,
  promptsRightSized: 0,      // advice accepted
  energySavedWhMin: 0,       // estimate, sum of accepted suggestion ranges
  energySavedWhMax: 0,
  potentialPrompts: 0,       // prompts sent where a smaller model was likely enough
  potentialWhMin: 0,         // estimate, sum of the advisor's saving range for those prompts
  potentialWhMax: 0,
  daily: [],                 // [{date, items, rightSized, whMin, whMax}] last 30 days
  since: Date.now()
});

async function getSettings() {
  const { ps_settings } = await chrome.storage.local.get('ps_settings');
  return {
    ...PS_DEFAULTS,
    ...(ps_settings || {}),
    enabledTypes: { ...PS_DEFAULTS.enabledTypes, ...((ps_settings && ps_settings.enabledTypes) || {}) }
  };
}

async function getStats() {
  const { ps_stats } = await chrome.storage.local.get('ps_stats');
  const s = { ...EMPTY_STATS(), ...(ps_stats || {}) };
  if (!Array.isArray(s.daily)) s.daily = [];
  return s;
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Serialise counter updates so concurrent messages don't overwrite each other.
let statsQueue = Promise.resolve();
function record(update) {
  statsQueue = statsQueue.then(async () => {
    const s = await getStats();
    let day = s.daily.find((d) => d.date === today());
    if (!day) {
      day = { date: today(), items: 0, rightSized: 0, whMin: 0, whMax: 0 };
      s.daily.push(day);
      s.daily = s.daily.slice(-30);
    }
    for (const [type, n] of Object.entries(update.items || {})) {
      const c = Math.max(0, Math.floor(Number(n) || 0));
      s.byType[type] = (s.byType[type] || 0) + c;
      s.totalItemsProtected += c;
      day.items += c;
    }
    if (update.adviceShown) s.adviceShown += 1;
    if (update.adviceAccepted) {
      const min = Number(update.adviceAccepted.whMin) || 0;
      const max = Number(update.adviceAccepted.whMax) || 0;
      s.promptsRightSized += 1;
      s.energySavedWhMin += min;
      s.energySavedWhMax += max;
      day.rightSized += 1;
      day.whMin += min;
      day.whMax += max;
    }
    if (update.potential) {
      s.potentialPrompts = (s.potentialPrompts || 0) + 1;
      s.potentialWhMin = (s.potentialWhMin || 0) + (Number(update.potential.whMin) || 0);
      s.potentialWhMax = (s.potentialWhMax || 0) + (Number(update.potential.whMax) || 0);
    }
    await chrome.storage.local.set({ ps_stats: s });
  }).catch((e) => dlog('record failed', e && e.message));
  return statsQueue;
}

// ── Photo scan relay ────────────────────────────────────────────────────────
// A service worker has no DOM and cannot start Web Workers, so Tesseract.js cannot run here.
// The side panel already ships the OCR engine + language data and the pixelation code, so the
// photo is relayed to it (extension-internal messaging only, nothing leaves the device).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function relayImageScan(message, waitForPanel) {
  const dataUrl = String(message.dataUrl || '');
  if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(dataUrl)) return { success: false, error: 'bad_image' };
  const payload = {
    type: 'PS_PANEL_SCAN_IMAGE',
    dataUrl,
    mimeType: String(message.mimeType || ''),
    fileName: String(message.fileName || 'image')
  };
  // Right after sidePanel.open() the panel needs a moment to load and register its listener.
  const deadline = Date.now() + (waitForPanel ? 15000 : 0);
  for (;;) {
    try {
      const res = await chrome.runtime.sendMessage(payload);
      if (res && typeof res === 'object') return res;
      throw new Error('no receiver');            // another extension page answered with nothing
    } catch (e) {
      if (Date.now() >= deadline) return { success: false, error: 'panel_closed' };
      await sleep(400);
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'PS_OPEN_SIDE_PANEL') {
    // Called synchronously from a click in the page, so Chrome treats it as a user gesture.
    if (!chrome.sidePanel || !sender.tab) { sendResponse({ success: false, error: 'no_tab' }); return false; }
    chrome.sidePanel.open({ windowId: sender.tab.windowId })
      .then(() => sendResponse({ success: true }))
      .catch((e) => { dlog('side panel open failed', e && e.message); sendResponse({ success: false, error: 'panel_open_failed' }); });
    return true;
  }
  if (message && message.type === 'SCAN_IMAGE_FOR_PII') {
    if (!sender.tab) { sendResponse({ success: false, error: 'no_tab' }); return false; }
    relayImageScan(message, !!message.waitForPanel)
      .then(sendResponse)
      .catch(() => sendResponse({ success: false, error: 'scan_failed' }));
    return true;
  }
  if (message && message.type === 'SCAN_PDF_FOR_PII') {
    if (!sender.tab) { sendResponse({ success: false, error: 'no_tab' }); return false; }
    (async () => {
      if (typeof psPdfScan === 'undefined') throw new Error('pdf_scanner_unavailable');
      const settings = await getSettings();
      const r = await psPdfScan.scan(message.dataUrl, {
        enabledTypes: settings.enabledTypes,
        confidenceThreshold: settings.confidenceThreshold,
        lang: settings.lang
      });
      dlog('pdf scan', { pages: r.pages, findings: r.findings.length, hasPII: r.hasPII });
      return { success: true, ...r };
    })()
      .then(sendResponse)
      .catch((e) => sendResponse({ success: false, error: (e && e.message) || 'pdf_scan_failed' }));
    return true;
  }
  if (message && message.type === 'PS_PANEL_SCAN_IMAGE') return false;   // meant for the side panel
  (async () => {
    try {
      const settings = await getSettings();
      const ttlMs = (settings.vaultTtlHours || 24) * 3600 * 1000;
      switch (message && message.action) {
        case PS_ACTIONS.MASK: {
          // items: [{type, value}] -> tokens (values encrypted in the vault)
          const items = Array.isArray(message.items) ? message.items.filter((i) => i && i.type && typeof i.value === 'string') : [];
          const tokens = await psVault.assign(items, { ttlMs });
          dlog('mask', { items: items.length });
          sendResponse({ success: true, tokens });
          break;
        }
        case PS_ACTIONS.GET_MAP: {
          sendResponse({ success: true, map: await psVault.getMap(ttlMs) });
          break;
        }
        case PS_ACTIONS.RECORD: {
          await record(message.update || {});
          sendResponse({ success: true });
          break;
        }
        case PS_ACTIONS.INCREMENT_STATS: {
          await record({ items: { [message.type]: message.count } });
          sendResponse({ success: true });
          break;
        }
        case PS_ACTIONS.STATS: {
          sendResponse({ success: true, stats: await getStats(), vaultCount: await psVault.count().catch(() => null) });
          break;
        }
        case PS_ACTIONS.SET_LAST_SENT: {
          // Masked text only; kept in memory-backed session storage (not written to disk).
          await chrome.storage.session.set({ ps_last_sent: { text: String(message.text || ''), at: Date.now(), site: String(message.site || '') } });
          sendResponse({ success: true });
          break;
        }
        case PS_ACTIONS.GET_LAST_SENT: {
          const { ps_last_sent } = await chrome.storage.session.get('ps_last_sent');
          sendResponse({ success: true, lastSent: ps_last_sent || null });
          break;
        }
        case PS_ACTIONS.CLEAR_VAULT: {
          await psVault.clearAll();
          await chrome.storage.session.remove('ps_last_sent');
          sendResponse({ success: true });
          break;
        }
        case PS_ACTIONS.NEXT_FACT: {
          // Rotating "did you know" card: return the stored index and advance it (only a number is stored).
          const count = Math.max(1, Math.floor(Number(message.count) || 1));
          const { eduFactIndex } = await chrome.storage.local.get('eduFactIndex');
          const index = Number.isInteger(eduFactIndex) && eduFactIndex >= 0 ? eduFactIndex % count : 0;
          await chrome.storage.local.set({ eduFactIndex: (index + 1) % count });
          sendResponse({ success: true, index });
          break;
        }
        case PS_ACTIONS.VAULT_INFO: {
          sendResponse({ success: true, count: await psVault.count() });
          break;
        }
        default:
          sendResponse({ success: false, error: 'unknown action' });
      }
    } catch (error) {
      dlog('error', error && error.name);
      sendResponse({ success: false, error: (error && error.name) || 'error' });
    }
  })();
  return true;
});

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await chrome.storage.local.set({ ps_settings: PS_DEFAULTS, ps_stats: EMPTY_STATS() });
  } else if (details.reason === 'update') {
    // Migrate v1.0.0 stats shape (energySavedWh, weeklyData) to the new one.
    const s = await getStats();
    if (typeof s.energySavedWh === 'number') { delete s.energySavedWh; }
    if (s.weeklyData) delete s.weeklyData;
    await chrome.storage.local.set({ ps_stats: s });
  }
});

// Keyboard shortcut (default Alt+Shift+P) opens the side panel in the current window.
// Called directly in the command handler so Chrome treats it as a user gesture.
chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'open-side-panel' || !chrome.sidePanel || !tab) return;
  chrome.sidePanel.open({ windowId: tab.windowId }).catch((e) => dlog('side panel open failed', e && e.message));
});
