const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULTS, validateConfig, sanitizeSaved, cloneDefaults } = require('../../src/config');

const good = () => ({ cameras: cloneDefaults().cameras, viscaPort: 5678, scenes: [], atem: { ip: '', inputs: [1, 2, 3, 4] } });

test('the default config is valid and unchanged by validation', () => {
  assert.deepEqual(validateConfig(good()), good());
});

test('names and addresses are trimmed; unknown keys are dropped', () => {
  const r = validateConfig({ ...good(), evil: 1, cameras: [{ name: '  North  ', ip: ' 1.2.3.4 ', extra: 'x' }] });
  assert.deepEqual(r, { cameras: [{ name: 'North', ip: '1.2.3.4' }], viscaPort: 5678, scenes: [], atem: { ip: '', inputs: [1] } });
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

test('scenes: valid ones are kept (trimmed, padded to the camera count); blank means leave the camera alone', () => {
  const r = validateConfig({ ...good(), scenes: [{ name: ' Sermon ', presets: [3, '4', null, 254], x: 1 }, { name: 'Bells', presets: [1] }] });
  assert.deepEqual(r.scenes, [{ name: 'Sermon', presets: [3, 4, null, 254] }, { name: 'Bells', presets: [1, null, null, null] }]);
});

test('scenes: bad input is refused with a message the user can act on', () => {
  const sc = (scenes) => ({ ...good(), scenes });
  const cases = [
    [sc('x'), /must be a list/],
    [sc(Array.from({ length: 13 }, (_, i) => ({ name: `S${i}`, presets: [1] }))), /at most 12/],
    [sc([{ name: '', presets: [1] }]), /Scene 1: the name must be 1 to 24/],
    [sc([{ name: 'x'.repeat(25), presets: [1] }]), /the name must be 1 to 24/],
    [sc([{ name: 'A', presets: [255] }]), /Scene 1 \(A\), camera 1: preset number must be a whole number from 1 to 254/],
    [sc([{ name: 'A', presets: [1, 1.5] }]), /camera 2: preset number/],
    [sc([{ name: 'A', presets: [null, null] }]), /choose a preset for at least one camera/],
    [sc([null]), /the name must be 1 to 24/],
  ];
  for (const [input, message] of cases) assert.throws(() => validateConfig(input), message);
  assert.equal(validateConfig(sc(Array.from({ length: 12 }, (_, i) => ({ name: `S${i}`, presets: [1] })))).scenes.length, 12);
});

test('scenes: a damaged saved file keeps the usable scenes and drops the rest', () => {
  const r = sanitizeSaved({ scenes: [{ name: 'Ok', presets: [1, 'x', 999, 7] }, { name: '', presets: [1] }, { name: 'None', presets: [] }, 5, { name: 'Two', presets: [2] }] });
  assert.deepEqual(r.scenes, [{ name: 'Ok', presets: [1, null, null, 7] }, { name: 'Two', presets: [2, null, null, null] }]);
  assert.deepEqual(sanitizeSaved({ scenes: 'no' }).scenes, []);
  assert.equal(sanitizeSaved({ scenes: Array.from({ length: 20 }, (_, i) => ({ name: `S${i}`, presets: [1] })) }).scenes.length, 12);
});

test('atem: address and per-camera input numbers are validated; blank input = not on the switcher', () => {
  const ok = validateConfig({ ...good(), atem: { ip: ' 192.168.0.240 ', inputs: [5, '2', null, 8] } });
  assert.deepEqual(ok.atem, { ip: '192.168.0.240', inputs: [5, 2, null, 8] });
  assert.deepEqual(validateConfig({ ...good(), atem: { ip: '', inputs: [1, 2, 3, 4] } }).atem, { ip: '', inputs: [1, 2, 3, 4] });
  const bad = (atem) => ({ ...good(), atem });
  assert.throws(() => validateConfig(bad({ ip: '999.1.1.1', inputs: [1, 2, 3, 4] })), /ATEM: "999.1.1.1" is not a valid IP/);
  assert.throws(() => validateConfig(bad({ ip: '', inputs: [0, 2, 3, 4] })), /ATEM input for camera 1 must be a whole number from 1 to 99/);
  assert.throws(() => validateConfig(bad({ ip: '', inputs: [1, 1, 3, 4] })), /more than one camera is set to input 1/);
  assert.throws(() => validateConfig(bad('x')), /ATEM settings must be an object/);
});

test('atem: a damaged saved file falls back to off with the default inputs', () => {
  assert.deepEqual(sanitizeSaved({ atem: { ip: 'not an ip!', inputs: [1, 1, 1, 1] } }).atem, { ip: '', inputs: [1, 2, 3, 4] });
  assert.deepEqual(sanitizeSaved({ atem: { ip: '10.0.0.9', inputs: [4, 3, 2, 1] } }).atem, { ip: '10.0.0.9', inputs: [4, 3, 2, 1] });
  assert.deepEqual(sanitizeSaved({ atem: 5 }).atem, { ip: '', inputs: [1, 2, 3, 4] });
});
