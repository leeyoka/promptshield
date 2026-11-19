// Unit tests for the upload guard helpers: locating findings in OCR word boxes (per-finding photo
// pixelation) and the [TYPE_MASKED] text used for the safe version of a PDF.
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../promptshield/src/shared/image-redact.js');
const { psMasker } = require('../promptshield/src/shared/masker.js');
const { psDetectAll } = require('../promptshield/src/shared/detectors.js');

const word = (text, x0, y0, x1, y1) => ({ text, bbox: { x0, y0, x1, y1 } });

test('matchKey folds punctuation, case and OCR lookalikes', () => {
  assert.equal(R.matchKey('0812-3456-7890'), '081234567890');
  assert.equal(R.matchKey('O812 3456 789O'), '081234567890');
  assert.equal(R.matchKey('Budi.Santoso@gmail.com'), R.matchKey('budisantosogmailcom'));
});

test('locateValue finds a value split over several words', () => {
  const words = [word('HP:', 0, 0, 30, 20), word('0812', 40, 0, 80, 20), word('3456', 90, 0, 130, 20), word('7890', 140, 0, 180, 20), word('Alamat', 0, 40, 60, 60)];
  const boxes = R.locateValue(words, '0812-3456-7890');
  assert.deepEqual(boxes.map((b) => b.x0), [40, 90, 140]);
});

test('locateValue covers a value glued to its label and every occurrence', () => {
  const words = [word('NIK:3273055102990004', 0, 0, 200, 20), word('lagi', 0, 30, 40, 50), word('3273055102990004', 50, 30, 210, 50)];
  const boxes = R.locateValue(words, '3273055102990004');
  assert.equal(boxes.length, 2);
});

test('locateValue returns nothing when the value is absent', () => {
  assert.deepEqual(R.locateValue([word('hello', 0, 0, 10, 10)], '3273055102990004'), []);
});

test('mapBoxToSource undoes scaling', () => {
  const b = R.mapBoxToSource({ x0: 20, y0: 40, x1: 60, y1: 80 }, { rot: 0, scale: 2, w: 200, h: 100 });
  assert.deepEqual(b, { x: 10, y: 20, w: 20, h: 20 });
});

test('mapBoxToSource undoes 90/180/270 degree rotations', () => {
  // Photo 100x50 (scale 1). A box at photo (10,5)-(30,15).
  const src = { x0: 10, y0: 5, x1: 30, y1: 15 };
  const w = 100, h = 50;
  // Forward transform used by makeVariant: rotate about the centre into a W×H canvas.
  const forward = (rot) => {
    const swap = rot === 90 || rot === 270;
    const W = swap ? h : w, H = swap ? w : h;
    const t = (rot * Math.PI) / 180, c = Math.round(Math.cos(t)), s = Math.round(Math.sin(t));
    const pts = [[src.x0, src.y0], [src.x1, src.y1]].map(([x, y]) => {
      const dx = x - w / 2, dy = y - h / 2;
      return [dx * c - dy * s + W / 2, dx * s + dy * c + H / 2];
    });
    return { x0: Math.min(pts[0][0], pts[1][0]), y0: Math.min(pts[0][1], pts[1][1]), x1: Math.max(pts[0][0], pts[1][0]), y1: Math.max(pts[0][1], pts[1][1]) };
  };
  for (const rot of [0, 90, 180, 270]) {
    const back = R.mapBoxToSource(forward(rot), { rot, scale: 1, w, h });
    assert.deepEqual(back, { x: 10, y: 5, w: 20, h: 10 }, `rot ${rot}`);
  }
});

test('locateFindings uses the first pass that contains the value and pads/clamps boxes', () => {
  const passes = [
    { rot: 0, scale: 1, w: 300, h: 100, words: [word('garbage', 0, 0, 10, 10)] },
    { rot: 0, scale: 1, w: 300, h: 100, words: [word('NIK', 0, 0, 30, 20), word('3273055102990004', 40, 0, 200, 20)] }
  ];
  const [boxes, none] = R.locateFindings(passes, [{ value: '3273055102990004' }, { value: 'rina@example.com' }], 300, 100);
  assert.equal(boxes.length, 1);
  assert.ok(boxes[0].x < 40 && boxes[0].x + boxes[0].w > 200, 'padded around the value');
  assert.equal(boxes[0].y, 0, 'clamped to the image');
  assert.deepEqual(none, []);
});

test('wordsFromTesseract flattens v5 blocks', () => {
  const data = { blocks: [{ paragraphs: [{ lines: [{ words: [word('a', 0, 0, 1, 1), word('b', 2, 0, 3, 1)] }] }] }] };
  assert.deepEqual(R.wordsFromTesseract(data).map((w) => w.text), ['a', 'b']);
});

test('maskTyped replaces only approved findings with [TYPE_MASKED]', () => {
  const text = 'Nama: Budi Santoso\nNIK: 3273055102990004\nEmail: budi.santoso@gmail.com';
  const items = psDetectAll(text).map((f, i) => ({ ...f, id: i, approved: f.type !== 'EMAIL' }));
  const out = psMasker.maskTyped(text, items);
  assert.match(out, /NIK: \[NIK_MASKED\]/);
  assert.match(out, /budi\.santoso@gmail\.com/);
  assert.doesNotMatch(out, /3273055102990004/);
});
