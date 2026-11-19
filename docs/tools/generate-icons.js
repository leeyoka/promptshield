// Generates the PWA icons (assets/icon-192.png, assets/icon-512.png) from the navbar shield SVG.
// Renders with headless Chrome (no npm packages needed). Run once from the website folder:
//   node tools/generate-icons.js            (or set CHROME=<path to chrome/edge>)
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const BG = '#1a3fcc';
// Same shield + check as the navbar logo (24×24 viewBox). Drawn at ~56% of the icon so it stays
// inside the maskable safe zone (centre circle, 80% diameter) on Android adaptive icons.
const SVG = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BG}"/>
  <g transform="translate(${size * 0.22} ${size * 0.22}) scale(${(size * 0.56) / 24})"
     fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 2.5l7.5 2.8v6.2c0 4.9-3.2 8.3-7.5 10-4.3-1.7-7.5-5.1-7.5-10V5.3L12 2.5z"/>
    <path d="M8.6 11.8l2.4 2.4 4.4-4.6"/>
  </g>
</svg>`;

function findChrome() {
  const candidates = [
    process.env.CHROME,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error('Chrome/Edge not found. Set CHROME=<path to browser executable>.');
  return found;
}

const chrome = findChrome();
const outDir = path.join(__dirname, '..', 'assets');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-icons-'));

for (const size of [192, 512]) {
  const html = path.join(tmp, `icon-${size}.html`);
  fs.writeFileSync(html, `<!doctype html><html><head><style>html,body{margin:0;padding:0;overflow:hidden;background:${BG}}svg{display:block}</style></head><body>${SVG(size)}</body></html>`);
  const out = path.join(outDir, `icon-${size}.png`);
  execFileSync(chrome, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    `--user-data-dir=${path.join(tmp, 'profile')}`,
    `--window-size=${size},${size}`, `--screenshot=${out}`, 'file:///' + html.replace(/\\/g, '/')
  ], { stdio: 'ignore' });
  console.log('wrote', path.relative(process.cwd(), out));
}
fs.rmSync(tmp, { recursive: true, force: true });
