const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULTS, validateConfig, sanitizeSaved, cloneDefaults } = require('../../src/config');

const good = () => ({ cameras: cloneDefaults().cameras, viscaPort: 5678 });

test('the default config is valid and unchanged by validation', () => {
  assert.deepEqual(validateConfig(good()), good());
});

test('names and addresses are trimmed; unknown keys are dropped', () => {
  const r = validateConfig({ ...good(), evil: 1, cameras: [{ name: '  North  ', ip: ' 1.2.3.4 ', extra: 'x' }] });
  assert.deepEqual(r, { cameras: [{ name: 'North', ip: '1.2.3.4' }], viscaPort: 5678 });
});

test('markup-looking names are allowed as plain text (the page escapes them)', () => {
  assert.equal(validateConfig({ ...good(), cameras: [{ name: '<b>x</b>', ip: '1.2.3.4' }] }).cameras[0].name, '<b>x</b>');
});

test('invalid settings are refused with a message the user can act on', () => {
  const cases = [
    [{ ...good(), cameras: [] }, /1 to 4 cameras/],
    [{ ...good(), cameras: Array(5).fill(DEFAULTS.cameras[0]) }, /1 to 4 cameras/],
    [{ ...good(), cameras: [{ name: '', ip: '1.2.3.4' }] }, /Camera 1: the name must be 1 to 24/],
    [{ ...good(), cameras: [{ name: 'x'.repeat(25), ip: '1.2.3.4' }] }, /Camera 1: the name must be 1 to 24/],
    [{ ...good(), cameras: [{ name: 'A', ip: '999.1.1.1' }] }, /Camera 1: "999.1.1.1" is not a valid IP/],
    [{ ...good(), cameras: [{ name: 'A', ip: '1.2.3' }] }, /not a valid IP/],
    [{ ...good(), viscaPort: 99999 }, /VISCA port must be a whole number from 1 to 65535/],
    [null, /must be an object/],
    ['text', /must be an object/],
  ];
  for (const [input, message] of cases) assert.throws(() => validateConfig(input), message);
});

test('a damaged saved file keeps what is valid and defaults the rest', () => {
  const r = sanitizeSaved({ cameras: [{ name: 'Alpha', ip: '10.0.0.5' }, { name: 5, ip: 'bad ip' }], viscaPort: 'x', snapshotFps: 5, junk: 1 });
  assert.deepEqual(r.cameras[0], { name: 'Alpha', ip: '10.0.0.5' });
  assert.deepEqual(r.cameras[1], DEFAULTS.cameras[1]);
  assert.equal(r.viscaPort, 5678);
  assert.ok(!('junk' in r) && !('snapshotFps' in r));
});

test('null, garbage and wrong types fall back to the defaults', () => {
  for (const v of [null, undefined, 'garbage', 42, { cameras: 'no' }, { cameras: [] }]) assert.deepEqual(sanitizeSaved(v), DEFAULTS);
});

test('cloneDefaults returns an independent copy', () => {
  const a = cloneDefaults(); a.cameras[0].name = 'changed';
  assert.equal(DEFAULTS.cameras[0].name, 'South');
});
