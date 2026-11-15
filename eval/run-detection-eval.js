// Detection precision / recall / F1 per type.
// Synthetic set (seeded, same authors as the rules => optimistic) and the held-out set
// (eval/dataset/heldout/*.json, written by someone who has not seen the rules) are reported SEPARATELY.
'use strict';
const fs = require('fs');
const path = require('path');
const { PS_TYPES, PS_DEFAULTS } = require('../promptshield/src/shared/constants.js');
const { psDetectAll } = require('../promptshield/src/shared/detectors.js');
const { buildDataset } = require('./lib/generator.js');

const SEED = 20261115;
const THRESHOLD = PS_DEFAULTS.confidenceThreshold;

function loadHeldout(dir) {
  if (!fs.existsSync(dir)) return [];
  const items = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json') && !x.startsWith('_'))) {
    const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const it of (Array.isArray(data) ? data : [data])) {
      if (typeof it.text !== 'string' || !Array.isArray(it.entities)) throw new Error(`${f}: bad item`);
      items.push({ ...it, source: it.source || `heldout:${f}` });
    }
  }
  return items;
}

/** Exact span match (start and end equal) and type equal. */
function evaluate(items) {
  const per = {};
  for (const t of Object.values(PS_TYPES)) per[t] = { tp: 0, fp: 0, fn: 0 };
  let cleanWithFlag = 0, clean = 0;
  for (const it of items) {
    const pred = psDetectAll(it.text).filter((f) => f.confidence >= THRESHOLD);
    const gold = it.entities.map((e) => ({ ...e, used: false }));
    if (gold.length === 0) { clean++; if (pred.length) cleanWithFlag++; }
    for (const p of pred) {
      const g = gold.find((x) => !x.used && x.type === p.type && x.start === p.start && x.end === p.end);
      if (g) { g.used = true; per[p.type].tp++; } else { per[p.type].fp++; }
    }
    for (const g of gold) if (!g.used) per[g.type].fn++;
  }
  const rows = [];
  const tot = { tp: 0, fp: 0, fn: 0 };
  for (const [t, c] of Object.entries(per)) {
    if (c.tp + c.fp + c.fn === 0) continue;
    tot.tp += c.tp; tot.fp += c.fp; tot.fn += c.fn;
    rows.push([t, c]);
  }
  rows.push(['**Overall**', tot]);
  return { rows, clean, cleanWithFlag, n: items.length };
}

const pct = (x) => (Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : 'n/a');
function table(res) {
  const lines = ['| Type | Precision | Recall | F1 | TP / FP / FN |', '|---|---|---|---|---|'];
  for (const [t, c] of res.rows) {
    const p = c.tp / (c.tp + c.fp), r = c.tp / (c.tp + c.fn), f = (2 * p * r) / (p + r);
    lines.push(`| ${t} | ${pct(p)} | ${pct(r)} | ${pct(f)} | ${c.tp} / ${c.fp} / ${c.fn} |`);
  }
  lines.push('', `Clean prompts with at least one pre-ticked finding: ${res.cleanWithFlag} / ${res.clean}`);
  return lines.join('\n');
}

function run() {
  const synthetic = buildDataset(SEED, 500, 200);
  const heldout = loadHeldout(path.join(__dirname, 'dataset', 'heldout'));
  const out = [];
  out.push(`### Detection — synthetic set (seed ${SEED}, ${synthetic.length} prompts; generator and rules share authors, so this is optimistic)`);
  out.push('', `Counted: findings with confidence ≥ ${THRESHOLD} (pre-ticked in the review sheet). Match = same type and exact span.`, '');
  out.push(table(evaluate(synthetic)));
  out.push('', `### Detection — held-out set (${heldout.length} prompts)`, '');
  if (heldout.length) out.push(table(evaluate(heldout)));
  else out.push('_No held-out data yet. A teammate who has not seen the rules should add files to `eval/dataset/heldout/` (see its README). Until then there is **no independent accuracy number**._');
  return out.join('\n');
}

if (require.main === module) console.log(run());
module.exports = { run, evaluate };
