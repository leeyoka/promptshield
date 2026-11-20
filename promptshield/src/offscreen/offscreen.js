// PromptShield offscreen scanner. The service worker cannot run Tesseract (no DOM, no Web Workers),
// so it opens this hidden extension page (chrome.offscreen) and forwards upload scans to it. This is
// what lets the upload guard scan photos and PDFs automatically on every supported site, without the
// side panel being open. Only answers messages from this extension's service worker.
'use strict';

function dataUrlToBlob(dataUrl, re) {
  const m = re.exec(String(dataUrl || ''));
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { type: m[1], bytes };
}

// One scan at a time: Tesseract has a single worker and PDFs are heavy.
let queue = Promise.resolve();
const serial = (fn) => { const p = queue.then(fn, fn); queue = p.catch(() => {}); return p; };

async function scanImage(msg) {
  const d = dataUrlToBlob(msg.dataUrl, /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/i);
  if (!d) return { success: false, error: 'bad_image' };
  const r = await psOcr.scanImage(new Blob([d.bytes], { type: d.type }), { lang: msg.lang });
  return { success: true, ...r };
}

async function scanPdf(msg) {
  const s = msg.settings || {};
  const r = await psPdfScan.scan(String(msg.dataUrl || ''), {
    enabledTypes: s.enabledTypes,
    confidenceThreshold: s.confidenceThreshold,
    lang: s.lang
  });
  return { success: true, ...r };
}

async function scanDocx(msg) {
  const s = msg.settings || {};
  const r = await psDocxScan.scan(String(msg.dataUrl || ''), {
    enabledTypes: s.enabledTypes,
    confidenceThreshold: s.confidenceThreshold,
    lang: s.lang
  });
  return { success: true, ...r };
}

const HANDLERS = { PS_OFFSCREEN_SCAN_IMAGE: scanImage, PS_OFFSCREEN_SCAN_PDF: scanPdf, PS_OFFSCREEN_SCAN_DOCX: scanDocx };

// Watchdog: scans run one at a time, so one that hangs (e.g. a stuck OCR worker) would block every
// scan after it and leave the page's "scanning…" dialog up forever. Past the limit the scan fails,
// the OCR worker is replaced, and the queue moves on.
const LIMIT_MS = { PS_OFFSCREEN_SCAN_IMAGE: 55000, PS_OFFSCREEN_SCAN_PDF: 540000, PS_OFFSCREEN_SCAN_DOCX: 540000 };
function withWatchdog(type, run) {
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => {
      psOcr.reset().catch(() => {});
      reject(new Error('scan_timeout'));
    }, LIMIT_MS[type] || 120000);
  });
  return Promise.race([run(), limit]).finally(() => clearTimeout(timer));
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || sender.tab || sender.id !== chrome.runtime.id) return false;
  const fn = Object.prototype.hasOwnProperty.call(HANDLERS, msg.type) ? HANDLERS[msg.type] : null;
  if (!fn) return false;
  serial(() => withWatchdog(msg.type, () => fn(msg)))
    .then(sendResponse, (e) => sendResponse({ success: false, error: (e && e.message) || 'scan_failed' }));
  return true;
});

// Load the OCR model now, so the first upload does not wait for it.
psOcr.getWorker().catch(() => {});
