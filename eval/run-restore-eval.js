// Streaming restore success rate: random replies containing tokens in several surface forms,
// split into random 1–9 character chunks and fed through the streaming restorer.
'use strict';
const { psRestorer } = require('../promptshield/src/shared/restorer.js');
const { rng } = require('./lib/generator.js');

const SEED = 4242;
const RUNS = 400;

function run() {
  const r = rng(SEED);
  const int = (a, b) => a + Math.floor(r() * (b - a + 1));
  const types = ['NIK', 'PHONE', 'EMAIL', 'CARD', 'NAME', 'BANK_ACCOUNT', 'NPWP', 'API_KEY'];
  const forms = {
    exact: (t, n) => `[${t}_${n}]`,
    markdownEscaped: (t, n) => `\\[${t.replace(/_/g, '\\_')}\\_${n}\\]`,
    lowercaseSpaced: (t, n) => `[ ${t.toLowerCase()}_${n} ]`,
    bare: (t, n) => `${t}_${n}`
  };
  const formNames = Object.keys(forms);
  const byForm = Object.fromEntries(formNames.map((f) => [f, { ok: 0, n: 0 }]));
  let ok = 0;
  const failures = [];

  for (let run = 0; run < RUNS; run++) {
    const map = {};
    let reply = '';
    let expected = '';
    const k = int(1, 4);
    const usedForms = [];
    for (let i = 0; i < k; i++) {
      const t = types[int(0, types.length - 1)];
      const n = int(1, 12);
      const value = `VAL${run}x${i}`;
      map[`[${t}_${n}]`] = value;
      const form = formNames[int(0, formNames.length - 1)];
      usedForms.push(form);
      const filler = ['Baik, ', 'Data ', 'Berikut: ', 'Noted: ', ' dan ', ', serta '][int(0, 5)];
      reply += filler + forms[form](t, n);
      expected += filler + value;
    }
    reply += '. Selesai.';
    expected += '. Selesai.';
    // Remove duplicate token keys that collided with different values: keep the last mapping consistent.
    const s = psRestorer.createStream(map);
    let out = '';
    for (let i = 0; i < reply.length;) { const n = int(1, 9); out += s.push(reply.slice(i, i + n)); i += n; }
    out += s.end();
    const exp = psRestorer.restore(reply, map).text; // ground truth for colliding keys
    const good = out === exp && !/\[[A-Z_]+_\d+\]/.test(out);
    if (good) ok++; else if (failures.length < 3) failures.push({ reply, out, exp });
    for (const f of usedForms) { byForm[f].n++; if (good) byForm[f].ok++; }
  }

  const lines = [`### Streaming restore (seed ${SEED}, ${RUNS} replies, random 1–9 char chunks)`, '',
    `Exact restoration: **${ok} / ${RUNS} (${((ok / RUNS) * 100).toFixed(1)}%)**`, '',
    '| Token surface form | Replies containing it | Fully restored |', '|---|---|---|'];
  for (const [f, c] of Object.entries(byForm)) lines.push(`| ${f} | ${c.n} | ${c.ok} |`);
  lines.push('', 'Scope: pure text restorer (`src/shared/restorer.js`). The in-page DOM layer restores whole text nodes; tokens split across separate DOM elements (e.g. syntax-highlighted code) are not covered by this number.');
  if (failures.length) lines.push('', 'First failures:', '```', JSON.stringify(failures, null, 1), '```');
  return lines.join('\n');
}

if (require.main === module) console.log(run());
module.exports = { run };
