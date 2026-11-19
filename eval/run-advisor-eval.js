// Right-size advisor: agreement with human tier labels (dev set and, separately, held-out set).
'use strict';
const fs = require('fs');
const path = require('path');
const { psComplexity } = require('../promptshield/src/shared/complexity.js');

const TIERS = ['Small', 'Medium', 'Large'];

function evaluate(items) {
  const cm = Object.fromEntries(TIERS.map((a) => [a, Object.fromEntries(TIERS.map((b) => [b, 0]))]));
  let agree = 0, offByTwo = 0;
  for (const it of items) {
    const pred = psComplexity.score(it.text).tier;
    cm[it.label][pred]++;
    if (pred === it.label) agree++;
    if (Math.abs(TIERS.indexOf(pred) - TIERS.indexOf(it.label)) === 2) offByTwo++;
  }
  return { n: items.length, agree, offByTwo, cm };
}

function table(name, res) {
  const lines = [`**${name}** — agreement ${res.agree} / ${res.n} (${((res.agree / res.n) * 100).toFixed(1)}%), off by two tiers: ${res.offByTwo}`, '',
    '| Label ↓ / Predicted → | Small | Medium | Large |', '|---|---|---|---|'];
  for (const a of TIERS) lines.push(`| ${a} | ${TIERS.map((b) => res.cm[a][b]).join(' | ')} |`);
  return lines.join('\n');
}

function run() {
  const dev = JSON.parse(fs.readFileSync(path.join(__dirname, 'advisor', 'dev-set.json'), 'utf8')).items;
  const heldPath = path.join(__dirname, 'dataset', 'heldout', 'advisor.json');
  const out = ['### Right-size advisor agreement with human labels', ''];
  out.push(table(`Development set (${dev.length} prompts, labelled by the rule author — not independent; weights were tuned on it)`, evaluate(dev)));
  out.push('');
  if (fs.existsSync(heldPath)) {
    const held = JSON.parse(fs.readFileSync(heldPath, 'utf8')).items || [];
    out.push(table(`Held-out set (${held.length} prompts)`, evaluate(held)));
  } else {
    out.push('_No independent advisor labels yet (`eval/dataset/heldout/advisor.json`). The proposal target (≥80% on 100 blind-labelled prompts) is **not yet measured**._');
  }
  return out.join('\n');
}

if (require.main === module) console.log(run());
module.exports = { run };
