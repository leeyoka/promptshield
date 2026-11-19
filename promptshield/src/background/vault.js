// PromptShield token vault (service worker only).
//
// - Real values are encrypted with AES-GCM-256 (fresh 96-bit IV per value).
// - The AES key and an HMAC key are generated as NON-EXTRACTABLE CryptoKeys and persisted in
//   IndexedDB (extension origin), so the vault survives service-worker restarts and page reloads.
// - "Same value => same token" uses an HMAC of (type, value), so no plaintext index is stored.
// - Entries expire after a TTL (default 24 h) and can be cleared at any time.
// Pseudonymization support, not end-to-end encryption: the masked prompt still goes to the AI site.

var psVault = (function () {
  const DB_NAME = 'promptshield-vault';
  const DB_VERSION = 1;
  let dbPromise = null;
  let keysPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('keys')) db.createObjectStore('keys');
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
        if (!db.objectStoreNames.contains('entries')) {
          const s = db.createObjectStore('entries', { keyPath: 'token' });
          s.createIndex('mac', 'mac', { unique: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { dbPromise = null; reject(req.error); };
    });
    return dbPromise;
  }

  function tx(db, stores, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = db.transaction(stores, mode);
      let result;
      Promise.resolve(fn(t)).then((r) => { result = r; }, reject);
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  function reqP(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getKeys() {
    if (keysPromise) return keysPromise;
    keysPromise = (async () => {
      const db = await openDb();
      let stored = await tx(db, ['keys'], 'readonly', (t) => reqP(t.objectStore('keys').get('main')));
      if (!stored) {
        const aes = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
        const hmac = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        stored = { aes, hmac, createdAt: Date.now() };
        await tx(db, ['keys'], 'readwrite', (t) => reqP(t.objectStore('keys').put(stored, 'main')));
      }
      return stored;
    })().catch((e) => { keysPromise = null; throw e; });
    return keysPromise;
  }

  async function macOf(type, value) {
    const { hmac } = await getKeys();
    // Canonical form: the same NIK with or without spaces/dashes gets the same token.
    const key = (typeof psMasker !== 'undefined' && psMasker.canonical) ? psMasker.canonical(type, value) : value;
    const sig = await crypto.subtle.sign('HMAC', hmac, new TextEncoder().encode(type + '\u0000' + key));
    return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function encrypt(value) {
    const { aes } = await getKeys();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, new TextEncoder().encode(value));
    return { iv, ct: new Uint8Array(ct) };
  }

  async function decrypt(iv, ct) {
    const { aes } = await getKeys();
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aes, ct);
    return new TextDecoder().decode(pt);
  }

  async function purgeExpired(ttlMs) {
    const db = await openDb();
    const cutoff = Date.now() - ttlMs;
    await tx(db, ['entries'], 'readwrite', (t) => new Promise((resolve, reject) => {
      const req = t.objectStore('entries').openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve();
        if (cur.value.lastUsedAt < cutoff) cur.delete();
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    }));
  }

  /**
   * Assign tokens for values. Same (type, value) => same token; counters never reuse numbers.
   * @param {Array<{type:string,value:string}>} items
   * @param {{format?:string, ttlMs?:number}} [opts]
   * @returns {Promise<string[]>} tokens in the same order as items
   */
  async function assign(items, opts = {}) {
    const ttlMs = opts.ttlMs || 24 * 3600 * 1000;
    await purgeExpired(ttlMs);
    const db = await openDb();
    // Do the crypto first (async work is not allowed inside an IDB transaction).
    const prepared = [];
    for (const it of items) {
      prepared.push({ ...it, mac: await macOf(it.type, it.value), enc: await encrypt(it.value) });
    }
    return tx(db, ['entries', 'meta'], 'readwrite', async (t) => {
      const entries = t.objectStore('entries');
      const meta = t.objectStore('meta');
      const counters = (await reqP(meta.get('counters'))) || {};
      const tokens = [];
      const now = Date.now();
      for (const p of prepared) {
        const existing = await reqP(entries.index('mac').get(p.mac));
        if (existing) {
          existing.lastUsedAt = now;
          entries.put(existing);
          tokens.push(existing.token);
          continue;
        }
        counters[p.type] = (counters[p.type] || 0) + 1;
        const token = `[${p.type}_${counters[p.type]}]`;
        entries.put({ token, type: p.type, mac: p.mac, iv: p.enc.iv, ct: p.enc.ct, createdAt: now, lastUsedAt: now });
        tokens.push(token);
      }
      meta.put(counters, 'counters');
      return tokens;
    });
  }

  /** @returns {Promise<Object<string,string>>} token -> plaintext, for on-screen restore only */
  async function getMap(ttlMs) {
    await purgeExpired(ttlMs || 24 * 3600 * 1000);
    const db = await openDb();
    const all = await tx(db, ['entries'], 'readonly', (t) => reqP(t.objectStore('entries').getAll()));
    const map = {};
    for (const e of all) {
      try { map[e.token] = await decrypt(e.iv, e.ct); } catch (_) { /* key mismatch: skip */ }
    }
    return map;
  }

  async function count() {
    const db = await openDb();
    return tx(db, ['entries'], 'readonly', (t) => reqP(t.objectStore('entries').count()));
  }

  /** Delete all entries and counters, and rotate the keys. */
  async function clearAll() {
    const db = await openDb();
    await tx(db, ['entries', 'meta', 'keys'], 'readwrite', (t) => {
      t.objectStore('entries').clear();
      t.objectStore('meta').clear();
      t.objectStore('keys').clear();
    });
    keysPromise = null;
  }

  return { assign, getMap, count, clearAll };
})();

if (typeof globalThis !== 'undefined') globalThis.psVault = psVault;
