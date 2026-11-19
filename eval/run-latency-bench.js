// Detection + advisor latency in Node (not in the browser). Reports p50 / p95 per prompt size.
'use strict';
const os = require('os');
const { psDetectAll } = require('../promptshield/src/shared/detectors.js');
const { psComplexity } = require('../promptshield/src/shared/complexity.js');
const { buildDataset } = require('./lib/generator.js');

function percentile(arr, p) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

function run() {
  const items = buildDataset(7, 200, 0).map((x) => x.text);
  const lines = [`### Latency (Node ${process.version}, ${os.cpus()[0].model.trim()}, ${process.platform})`, '',
    '| Prompt size | Runs | detect p50 | detect p95 | detect + advise p95 |', '|---|---|---|---|---|'];
  for (const target of [200, 1500, 5000]) {
    let base = '';
    for (let i = 0; base.length < target; i++) base += items[i % items.length] + '\n';
    const text = base.slice(0, target);
    for (let i = 0; i < 50; i++) psDetectAll(text); // warm-up
    const d = [], da = [];
    for (let i = 0; i < 300; i++) {
      let t0 = process.hrtime.bigint();
      psDetectAll(text);
      d.push(Number(process.hrtime.bigint() - t0) / 1e6);
      t0 = process.hrtime.bigint();
      psDetectAll(text); psComplexity.score(text);
      da.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    lines.push(`| ${target} chars | 300 | ${percentile(d, 50).toFixed(3)} ms | ${percentile(d, 95).toFixed(3)} ms | ${percentile(da, 95).toFixed(3)} ms |`);
  }
  lines.push('', 'Browser timings on a real laptop are not measured by this script (TODO: measure in Chrome with PS_DEBUG timings).');
  return lines.join('\n');
}

if (require.main === module) console.log(run());
module.exports = { run };
