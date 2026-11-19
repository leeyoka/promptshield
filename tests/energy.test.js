// Energy counters and the rotating fact card, run against the real service worker in a VM with a
// minimal chrome.* stub (no browser needed).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const EXT = path.join(__dirname, '..', 'promptshield');

function loadServiceWorker() {
  const local = {}, session = {};
  let listener = null;
  const area = (o) => ({ get: async (k) => ({ [k]: o[k] }), set: async (v) => { Object.assign(o, v); }, remove: async (k) => { delete o[k]; } });
  const ctx = {
    console, setTimeout, clearTimeout, crypto: globalThis.crypto, TextEncoder, TextDecoder,
    chrome: {
      storage: { local: area(local), session: area(session) },
      runtime: { onMessage: { addListener: (f) => { listener = f; } }, onInstalled: { addListener() {} } },
      commands: { onCommand: { addListener() {} } }
    }
  };
  ctx.globalThis = ctx;
  ctx.importScripts = (...files) => files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(EXT, f), 'utf8'), ctx, { filename: f }));
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(EXT, 'src/background/service-worker.js'), 'utf8'), ctx);
  const send = (msg) => new Promise((resolve) => listener(msg, {}, resolve));
  return { send, local };
}

test('energy: accepted suggestions and potential savings are counted separately', async () => {
  const { send } = loadServiceWorker();
  await send({ action: 'PS_RECORD', update: { adviceAccepted: { whMin: 0.16, whMax: 0.98 } } });
  await send({ action: 'PS_RECORD', update: { potential: { whMin: 0.16, whMax: 0.98 } } });
  await send({ action: 'PS_RECORD', update: { potential: { whMin: 0, whMax: 0.92 } } });
  const { stats } = await send({ action: 'PS_STATS' });
  assert.equal(stats.promptsRightSized, 1);
  assert.equal(stats.energySavedWhMin, 0.16);
  assert.equal(stats.energySavedWhMax, 0.98);
  assert.equal(stats.potentialPrompts, 2);
  assert.ok(Math.abs(stats.potentialWhMax - 1.9) < 1e-9);
});

test('energy: masking data alone never adds to energy saved', async () => {
  const { send } = loadServiceWorker();
  await send({ action: 'PS_RECORD', update: { items: { NIK: 1, PHONE: 1 } } });
  const { stats } = await send({ action: 'PS_STATS' });
  assert.equal(stats.totalItemsProtected, 2);
  assert.equal(stats.energySavedWhMax, 0);
  assert.equal(stats.potentialWhMax, 0);
});

test('energy facts: one per panel opening, rotating through all of them', async () => {
  const { send, local } = loadServiceWorker();
  const seen = [];
  for (let i = 0; i < 8; i++) seen.push((await send({ action: 'PS_NEXT_FACT', count: 6 })).index);
  assert.deepEqual(seen, [0, 1, 2, 3, 4, 5, 0, 1]);
  assert.equal(local.eduFactIndex, 2);
});

test('energy facts: every fact has id, en and a source', () => {
  const src = fs.readFileSync(path.join(EXT, 'src/sidepanel/sidepanel.js'), 'utf8');
  const start = src.indexOf('[', src.indexOf('const EDU_FACTS = ['));
  const end = src.indexOf('];', start) + 1;
  const facts = vm.runInNewContext('(' + src.slice(start, end) + ')');
  assert.ok(facts.length >= 5);
  for (const f of facts) assert.ok(f.id && f.en && f.source, JSON.stringify(f));
});
