// Unit tests for src/shared/masker.js (used by the ChatGPT content script and the side panel).
const test = require('node:test');
const assert = require('node:assert/strict');
const { psMasker } = require('../promptshield/src/shared/masker.js');
const { psDetectAll } = require('../promptshield/src/shared/detectors.js');
const { psRestorer } = require('../promptshield/src/shared/restorer.js');

const prompt = 'Nama: Rina Sari\nNIK 3171016408980002, email rina@example.com, NIK lagi 3171016408980002.';

function itemsAndTokens(text) {
  const tok = psMasker.createLocalTokenizer();
  const items = psDetectAll(text).map((f, i) => ({ ...f, id: i, approved: true }));
  const tokens = items.map((f) => tok(f.type, f.value));
  return { items, tokens };
}

test('build: replaces approved values, same value => same token, no raw value left', () => {
  const { items, tokens } = itemsAndTokens(prompt);
  const out = psMasker.build(prompt, items, tokens);
  assert.equal(out, 'Nama: [NAME_1]\nNIK [NIK_1], email [EMAIL_1], NIK lagi [NIK_1].');
  for (const f of items) assert.ok(!out.includes(f.value));
});

test('build: unticked items stay as typed', () => {
  const { items, tokens } = itemsAndTokens(prompt);
  items.find((i) => i.type === 'EMAIL').approved = false;
  assert.match(psMasker.build(prompt, items, tokens), /rina@example\.com/);
});

test('build: throws on stale offsets or missing tokens (callers must not send/copy)', () => {
  const { items, tokens } = itemsAndTokens(prompt);
  assert.throws(() => psMasker.build(prompt.replace('Rina', 'Rena'), items, tokens), /offset mismatch/);
  assert.throws(() => psMasker.build(prompt, items, []), /missing token/);
});

test('mask -> restore round trip gives back the original text', () => {
  const { items, tokens } = itemsAndTokens(prompt);
  const masked = psMasker.build(prompt, items, tokens);
  const map = {};
  items.forEach((f) => { map[tokens[f.id]] = f.value; });
  assert.equal(psRestorer.restore(masked, map).text, prompt);
});

test('partialValue hides the middle', () => {
  assert.equal(psMasker.partialValue('3171016408980002'), '3171••••••••0002');
  assert.equal(psMasker.partialValue('abc'), '•••');
});

test('highlightTokensHtml escapes HTML', () => {
  assert.equal(psMasker.highlightTokensHtml('<b>[NIK_1]</b>'), '&lt;b&gt;<mark class="tok">[NIK_1]</mark>&lt;/b&gt;');
});

test('canonical: same NIK/phone/email in different formats gets the same key', () => {
  const c = psMasker.canonical;
  assert.equal(c('NIK', '3273 0551 0299 0004'), c('NIK', '3273055102990004'));
  assert.equal(c('NIK', '3273-0551-0299-0004'), '3273055102990004');
  assert.equal(c('PHONE', '+62 812-7788-4455'), c('PHONE', '081277884455'));
  assert.equal(c('EMAIL', 'Dimas@Contoh.co.id '), 'dimas@contoh.co.id');
  assert.equal(c('NAME', 'Dimas  Prasetyo'), c('NAME', 'dimas prasetyo'));
  const tok = psMasker.createLocalTokenizer();
  assert.equal(tok('NIK', '3273 0551 0299 0004'), tok('NIK', '3273055102990004'));
  assert.notEqual(tok('NIK', '3273055102990004'), tok('NPWP', '3273055102990004'));
});
