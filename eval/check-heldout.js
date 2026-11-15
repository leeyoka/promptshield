// Validates held-out files: JSON shape, known types, and that every span's offsets are inside the text.
// Prints each entity's text so the author can confirm the offsets are right. Does not run the detector.
'use strict';
const fs = require('fs');
const path = require('path');
const { PS_TYPES } = require('../promptshield/src/shared/constants.js');

const dir = path.join(__dirname, 'dataset', 'heldout');
const types = new Set(Object.values(PS_TYPES));
let errors = 0, items = 0;
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json') && !x.startsWith('_') && x !== 'advisor.json')) {
  const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  for (const [i, it] of (Array.isArray(data) ? data : [data]).entries()) {
    items++;
    if (typeof it.text !== 'string') { console.log(`${f}[${i}]: missing text`); errors++; continue; }
    for (const e of it.entities || []) {
      const ok = types.has(e.type) && Number.isInteger(e.start) && Number.isInteger(e.end) && e.start >= 0 && e.end <= it.text.length && e.start < e.end;
      console.log(`${ok ? 'ok ' : 'ERR'} ${f}[${i}] ${e.type}: ${JSON.stringify(it.text.slice(e.start, e.end))}`);
      if (!ok) errors++;
    }
  }
}
console.log(`\n${items} items, ${errors} errors`);
process.exitCode = errors ? 1 : 0;
