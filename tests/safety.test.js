// Static guards on the code that ships: fail closed, no raw logs, no network, minimal permissions,
// single source of truth for detection.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const EXT = path.join(__dirname, '..', 'promptshield');
const read = (p) => fs.readFileSync(path.join(EXT, p), 'utf8');
const listJs = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
  const p = path.join(dir, d.name);
  return d.isDirectory() ? listJs(p) : p.endsWith('.js') ? [p] : [];
});
const files = listJs(path.join(EXT, 'src')).map((p) => ({ p, src: fs.readFileSync(p, 'utf8') }));
const manifest = JSON.parse(read('manifest.json'));
const content = read('src/content/content-script.js');
const sw = read('src/background/service-worker.js');

test('no network APIs anywhere in the extension source', () => {
  for (const { p, src } of files) {
    assert.ok(!/\bfetch\(|XMLHttpRequest|sendBeacon|new WebSocket|EventSource\(/.test(src), p);
  }
});

test('no console.log/info/warn/error in shipped code (DEBUG-gated console.debug only)', () => {
  for (const { p, src } of files) {
    assert.ok(!/console\.(log|info|warn|error)\(/.test(src), p);
  }
  assert.match(content, /const PS_DEBUG = false;/);
  assert.match(sw, /const DEBUG = false;/);
});

test('manifest: storage + sidePanel + offscreen only, no host permissions, no remote code', () => {
  // offscreen: a hidden extension page that runs the on-device OCR / PDF scan for uploads
  // (the service worker cannot start Web Workers). It grants no access to pages or data.
  assert.deepEqual(manifest.permissions, ['storage', 'sidePanel', 'offscreen']);
  assert.ok(fs.existsSync(path.join(EXT, 'src/offscreen/offscreen.html')), 'offscreen page exists');
  assert.ok(fs.existsSync(path.join(EXT, manifest.side_panel.default_path)), 'side panel page exists');
  assert.ok(manifest.commands['open-side-panel'], 'shortcut declared');
  assert.equal(manifest.host_permissions, undefined);
  // 'wasm-unsafe-eval' lets the bundled Tesseract OCR core (lib/core) run; no remote or blob: scripts.
  assert.equal(manifest.content_security_policy.extension_pages, "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';");
  for (const cs of manifest.content_scripts) for (const f of cs.js) assert.ok(fs.existsSync(path.join(EXT, f)), f);
});

test('single source of truth: no detector copies outside src/shared', () => {
  for (const { p, src } of files) {
    if (p.includes(`${path.sep}shared${path.sep}`)) continue;
    assert.ok(!/function psValidNik|function psLuhn|PS_PROVINCES\s*=|function psDetectAll/.test(src), p);
  }
});

test('fail closed: no path sends the original text on error', () => {
  const catchBlock = content.slice(content.indexOf('} catch (err) {', content.indexOf('async function maskedSend')));
  const body = catchBlock.slice(0, catchBlock.indexOf('} finally'));
  assert.ok(!/clickSendOurselves|\.click\(\)|sendRaw\(/.test(body), 'catch block must not send');
  assert.match(body, /failClosed\(/);
  assert.ok(!/deliverPrompt/.test(content));
  // Raw text only via the explicit "Send unmasked" button.
  assert.equal((content.match(/(?<!function )sendRaw\(\)/g) || []).length, 1);
});

test('fail closed: send only after read-back verification and an enabled button', () => {
  const fn = content.slice(content.indexOf('async function maskedSend'), content.indexOf('// Interception'));
  const iVerify = fn.indexOf('writeAndVerify(masked)');
  const iEnabled = fn.indexOf('isSendEnabled');
  const iFinal = fn.indexOf('composer changed before send');
  const iClick = fn.indexOf('clickSendOurselves(');
  assert.ok(iVerify > 0 && iEnabled > iVerify && iFinal > iEnabled && iClick > iFinal);
});

test('restorer never writes attributes other than a tooltip, and never into the composer', () => {
  assert.ok(!/innerHTML\s*=\s*[^;]*restore/.test(content));
  assert.match(content, /'#promptshield-root, textarea, input, \[data-ps-norestore\]/);
  assert.match(content, /composer && composer\.contains\(el\)\) return 'skip'/);
});

test("restorer leaves the user's own message bubbles masked (so the user sees what was sent)", () => {
  assert.match(content, /\[data-message-author-role="user"\]/);
});

test('side panel: same shared code as the content script, verified copy, no page access', () => {
  const sp = read('src/sidepanel/sidepanel.js');
  const html = read('src/sidepanel/sidepanel.html');
  for (const f of ['constants.js', 'detectors.js', 'masker.js', 'restorer.js']) assert.ok(html.includes(`../shared/${f}`), f);
  assert.match(sp, /psMasker\.build\(/);
  assert.match(sp, /throw new Error\('verify'\)/, 'copy refuses if an approved value survived');
  assert.ok(!/chrome\.scripting|chrome\.tabs\.query|executeScript/.test(sp), 'side panel never reads pages');
  assert.ok(!/localStorage|sessionStorage|chrome\.storage\.local\.set/.test(sp), 'panel text is never stored');
});

test('send guard is registered at document_start, before the site scripts', () => {
  const [early, main] = manifest.content_scripts;
  assert.equal(early.run_at, 'document_start');
  assert.equal(early.js[early.js.length - 1], 'src/content/early-guard.js');
  for (const f of ['src/shared/constants.js', 'src/shared/detectors.js', 'src/shared/masker.js']) assert.ok(early.js.includes(f), f);
  assert.deepEqual(main.js, ['src/content/content-script.js']);
  assert.deepEqual(early.matches, main.matches);
  const eg = read('src/content/early-guard.js');
  for (const ev of ['keydown', 'pointerdown', 'mousedown', 'click', 'submit']) assert.ok(eg.includes(`'${ev}'`), ev);
  assert.match(content, /window\.__psGuard = guard/);
});

test('composer lookup ignores editors inside replies (ChatGPT "Writing" blocks)', () => {
  assert.match(content, /isInsideReply\(el\)/);
  assert.match(content, /\[data-message-author-role\], article, \[data-testid\^="conversation-turn"\], \[data-turn\]/);
  assert.match(content, /getBoundingClientRect\(\)\.bottom/, 'falls back to the bottom-most candidate');
  assert.match(read('src/content/early-guard.js'), /\[data-message-author-role\], article/);
});

test('editable blocks inside replies are never modified (edits there may be saved by the site)', () => {
  const fn = content.slice(content.indexOf('function restoreNode'), content.indexOf('// Dotted underline'));
  const editableBranch = fn.slice(fn.indexOf("zone === 'editable'"), fn.indexOf('return;', fn.indexOf("zone === 'editable'")));
  assert.ok(!/textContent\s*=/.test(editableBranch));
});
