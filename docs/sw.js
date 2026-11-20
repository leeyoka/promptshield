// PromptShield website service worker: makes the site (and its scanner) work offline.
// All paths are relative to this file, so the site works at a domain root or under a
// GitHub Pages project path (https://user.github.io/<repo>/).
//
// Caches:
//   SHELL  - the page itself, precached on install; served from cache, refreshed in the background
//   OCR    - Tesseract (engine + Indonesian/English language data) and PDF.js, self-hosted under
//            vendor/ (~12 MB). Cached on first use, or all at once when the app is installed.
//   RUNTIME- Google Fonts: network first, cached copy when offline.
'use strict';

const VERSION = 'v2';
// Bump SHELL_REV when a precached page changes (e.g. energy.html), so installed copies refetch it;
// the OCR cache keeps its name and its large model files.
const SHELL_REV = '3';
const SHELL = 'promptshield-shell-' + VERSION + '.' + SHELL_REV;
const OCR = 'promptshield-ocr-' + VERSION;
const RUNTIME = 'promptshield-runtime-' + VERSION;
const KEEP = [SHELL, OCR, RUNTIME];

const PRECACHE = [
  './',
  'index.html',
  'energy.html',
  'manifest.json',
  'js/constants.js',
  'js/detectors.js',
  'js/doc-scan.js',
  'js/scanner.js',
  'assets/logo.png'
];

// Everything the photo/PDF scanner needs offline. Fetched in the background on request
// ("warm-ocr" message, sent when the app is installed or opened as an installed app).
const OCR_FILES = [
  'vendor/tesseract/tesseract.min.js',
  'vendor/tesseract/worker.min.js',
  'vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js',
  'vendor/tesseract/core/tesseract-core-lstm.wasm.js',
  'vendor/tesseract/lang/ind.traineddata.gz',
  'vendor/tesseract/lang/eng.traineddata.gz',
  'vendor/pdfjs/pdf.min.js',
  'vendor/pdfjs/pdf.worker.min.js'
];

const scopeUrl = (p) => new URL(p, self.registration.scope).href;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('promptshield-') && !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'warm-ocr') {
    e.waitUntil(caches.open(OCR).then(async (c) => {
      for (const p of OCR_FILES) {
        const url = scopeUrl(p);
        if (await c.match(url)) continue;
        try { const res = await fetch(url); if (res.ok) await c.put(url, res); } catch (_) { /* offline: try next time */ }
      }
    }));
  }
});

const cacheable = (res) => res && (res.ok || res.type === 'opaque');

/** Cache first, then network (and store). For big files that never change. */
async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

/** Serve from cache immediately, refresh the cache in the background (next load gets updates). */
async function staleWhileRevalidate(req, cacheName, event) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
  const update = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; });
  if (hit) {
    event.waitUntil(update.catch(() => {}));
    return hit;
  }
  try {
    return await update;
  } catch (err) {
    // Offline and never cached: for page loads fall back to the cached home page.
    if (req.mode === 'navigate') {
      const home = await cache.match(scopeUrl('index.html')) || await cache.match(scopeUrl('./'));
      if (home) return home;
    }
    throw err;
  }
}

/** Network first, cached copy when offline. */
async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (cacheable(res)) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (!url.href.startsWith(self.registration.scope)) return;
    if (url.pathname.includes('/vendor/')) { e.respondWith(cacheFirst(req, OCR)); return; }
    e.respondWith(staleWhileRevalidate(req, SHELL, e));
    return;
  }

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(networkFirst(req, RUNTIME));
  }
});
