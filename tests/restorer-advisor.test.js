// Unit tests for src/shared/restorer.js and src/shared/complexity.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const { PS_TIERS, ENERGY_ASSUMPTIONS, PS_ENERGY } = require('../promptshield/src/shared/constants.js');
const { psRestorer } = require('../promptshield/src/shared/restorer.js');
const { psComplexity } = require('../promptshield/src/shared/complexity.js');
const { PS_I18N } = require('../promptshield/src/shared/i18n.js');

const MAP = { '[NIK_1]': '3171016408980002', '[EMAIL_1]': 'rina@example.com', '[BANK_ACCOUNT_2]': '0123-01-012345-50-1' };

test('restore: exact, tolerant and Markdown-escaped forms', () => {
  const r = (s) => psRestorer.restore(s, MAP).text;
  assert.equal(r('NIK [NIK_1].'), 'NIK 3171016408980002.');
  assert.equal(r('[ nik_1 ]'), '3171016408980002');
  assert.equal(r('\\[NIK\\_1\\]'), '3171016408980002');
  assert.equal(r('[NIK\\_1]'), '3171016408980002');
  assert.equal(r('rek [BANK_ACCOUNT_2]'), 'rek 0123-01-012345-50-1');
  assert.equal(r('\\[BANK\\_ACCOUNT\\_2\\]'), '0123-01-012345-50-1');
  assert.equal(r('tanpa kurung NIK_1 saja'), 'tanpa kurung 3171016408980002 saja');
});

test('restore: unknown tokens untouched, idempotent, Map or object', () => {
  assert.equal(psRestorer.restore('[NIK_9] dan [FOO_1]', MAP).text, '[NIK_9] dan [FOO_1]');
  const once = psRestorer.restore('a [NIK_1] b', MAP).text;
  assert.equal(psRestorer.restore(once, MAP).text, once);
  assert.equal(psRestorer.restore('[EMAIL_1]', new Map(Object.entries(MAP))).text, 'rina@example.com');
});

test('stream restore: tokens split across chunks (seeded random chunking)', () => {
  let seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const reply = 'Data: [NIK_1], email \\[EMAIL\\_1\\], rekening [BANK_ACCOUNT_2]. Selesai.';
  const expected = psRestorer.restore(reply, MAP).text;
  for (let run = 0; run < 200; run++) {
    const s = psRestorer.createStream(MAP);
    let out = '';
    for (let i = 0; i < reply.length;) {
      const n = 1 + Math.floor(rand() * 9);
      out += s.push(reply.slice(i, i + n));
      i += n;
    }
    out += s.end();
    assert.equal(out, expected);
  }
});

test('advisor: simple tasks are Small with a saving range', () => {
  for (const p of ['Perbaiki tata bahasa paragraf ini agar lebih formal.', 'Terjemahkan ke bahasa Inggris: saya sudah transfer kemarin.', 'Tolong rapikan email komplain ini. NIK 3171016408980002, kartu 4111-2222-3333-4448.']) {
    const a = psComplexity.score(p);
    assert.equal(a.tier, PS_TIERS.SMALL, p);
    assert.ok(a.potentialSaving && a.potentialSaving.max > a.potentialSaving.min);
    assert.ok(a.reasons.includes('simple'));
  }
});

test('advisor: short but hard reasoning is not Small (length is not the main signal)', () => {
  const a = psComplexity.score('Buktikan bahwa akar 2 irasional, lalu bandingkan dengan pembuktian lain secara mendalam.');
  assert.notEqual(a.tier, PS_TIERS.SMALL);
  assert.equal(a.reasons[0], 'reasoning');
});

test('advisor: deep multi-part analysis / code + reasoning is Large', () => {
  assert.equal(psComplexity.score('Tolong analisis kelebihan dan kekurangan arsitektur microservices vs monolith untuk startup fintech, langkah demi langkah, dengan strategi migrasi.').tier, PS_TIERS.LARGE);
  assert.equal(psComplexity.score('Debug this and explain why it crashes, step by step:\nfunction f(x){ return x.map(y => y*2) }\nconst r = f(null);').tier, PS_TIERS.LARGE);
});

test('advisor: card dashes are not counted as math', () => {
  assert.ok(!psComplexity.score('kartu 4111-2222-3333-4448').reasons.includes('math'));
});

test('energy assumptions: every entry has value, unit and a source or TODO(source)', () => {
  for (const [k, a] of Object.entries(ENERGY_ASSUMPTIONS)) {
    assert.ok(a.value !== undefined && a.unit && a.source, k);
  }
  assert.equal(PS_ENERGY.Small.min, ENERGY_ASSUMPTIONS.smallRangeWh.value[0]);
  assert.equal(PS_ENERGY.Large.min, ENERGY_ASSUMPTIONS.anchorMedianWh.value);
});

test('i18n: Indonesian and English have the same keys', () => {
  assert.deepEqual(Object.keys(PS_I18N.id).sort(), Object.keys(PS_I18N.en).sort());
});
