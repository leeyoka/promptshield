// The OCR entry point never hands images smaller than 50 x 50 px to Tesseract (it rejects images
// under 3 px with "Image too small to scale!!"). Tesseract is stubbed: the real one needs a browser.
const test = require('node:test');
const assert = require('node:assert/strict');
require('../promptshield/src/shared/constants.js');
require('../promptshield/src/shared/detectors.js');
require('../promptshield/src/shared/doc-scan.js');
require('../promptshield/src/shared/image-redact.js');

let workersCreated = 0, recognizeCalls = 0;
globalThis.Tesseract = {
  createWorker: async () => {
    workersCreated++;
    return { recognize: async () => { recognizeCalls++; return { data: { text: '' } }; }, setParameters: async () => {} };
  }
};
require('../promptshield/src/shared/ocr-engine.js');
const { psOcr } = globalThis;

test('images or rendered pages under 50 x 50 px are skipped before Tesseract', async () => {
  for (const src of [{ width: 2, height: 36 }, { width: 36, height: 2 }, { width: 49, height: 400 }, { naturalWidth: 10, naturalHeight: 10 }, {}]) {
    const r = await psOcr.ocrImage(src);
    assert.equal(r.skipped, 'too_small');
    assert.equal(r.allText, '');
    assert.deepEqual(r.passes, []);
    assert.deepEqual(r.analysis.findings, []);
    assert.equal(r.analysis.sensitive, false);
  }
  const page = await psOcr.ocrImage({ width: 3, height: 3 }, { page: true });
  assert.equal(page.skipped, 'too_small');
  assert.equal(recognizeCalls, 0);
  assert.equal(workersCreated, 0);            // the OCR model is not even loaded for them
});
