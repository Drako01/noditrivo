const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { smokeVsix, readZip, defaultVsix } = require('../scripts/smoke-vsix.cjs');

test('rejects data that is not a ZIP archive', () => {
  assert.throws(() => readZip(Buffer.from('definitely not a zip file')), /Not a ZIP file/);
});

// `npm run package` builds the VSIX and then runs the same smoke test; this test covers an already built package.
test('packaged VSIX smoke test (runs when a built VSIX is present)', async t => {
  const vsix = process.env.NODITRIVO_VSIX ? path.resolve(process.env.NODITRIVO_VSIX) : defaultVsix();
  if (!fs.existsSync(vsix)) return t.skip(`no VSIX at ${vsix}; run "npm run package" first`);
  const { failures } = await smokeVsix(vsix);
  assert.deepEqual(failures, []);
});
