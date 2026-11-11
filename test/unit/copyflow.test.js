const test = require('node:test');
const assert = require('node:assert');
const { copyFlow } = require('../../src/copyflow');

// Fake cameras: state[i] = { mode, shutter }. `drop` makes a camera ignore its first N writes of an item.
function setup({ source = { mode: 10, shutter: 3 }, cams, drop = {}, silent = [] }) {
  const state = cams.map((c) => ({ ...c })), log = [], dropped = {};
  const item = (key, label) => ({
    label,
    send: async (i) => {
      log.push(`${i}:${key}`);
      dropped[`${i}${key}`] = (dropped[`${i}${key}`] || 0) + 1;
      if (dropped[`${i}${key}`] <= (drop[`${i}${key}`] || 0)) return; // camera ignores this write
      state[i][key] = source[key];
    },
    ok: (i) => state[i][key] === source[key],
  });
  const statuses = [];
  const opts = (extra = {}) => ({
    others: [1, 2], items: [item('mode', 'Mode'), item('shutter', 'Shutter')], hasMode: true, modeName: 'mode',
    has: (i) => !silent.includes(i), refresh: async () => {}, setStatus: (t) => statuses.push(t), sleep: async () => {},
    timing: { modeLoops: 3, settle: 0, afterSend: 0, retryWait: 0 }, nameOf: (i) => `cam${i}`, ...extra,
  });
  return { state, log, statuses, opts };
}

test('copies mode first, then the rest, and verifies', async () => {
  const t = setup({ cams: [{}, { mode: 0, shutter: 1 }, { mode: 3, shutter: 9 }] });
  const bad = await copyFlow(t.opts());
  assert.deepStrictEqual(bad, []);
  assert.deepStrictEqual([t.state[1], t.state[2]], [{ mode: 10, shutter: 3 }, { mode: 10, shutter: 3 }]);
  assert.ok(t.log.indexOf('1:mode') < t.log.indexOf('1:shutter'));
  assert.ok(t.log.indexOf('2:mode') < t.log.indexOf('1:shutter'), 'every camera gets the mode before any value is sent');
});

test('skips the mode step when every camera already has the mode', async () => {
  const t = setup({ cams: [{}, { mode: 10, shutter: 1 }, { mode: 10, shutter: 9 }] });
  assert.deepStrictEqual(await copyFlow(t.opts()), []);
  assert.ok(!t.log.some((l) => l.endsWith(':mode')));
  assert.ok(!t.statuses.some((s) => /switching/.test(s)));
});

test('retries only what a camera dropped', async () => {
  const t = setup({ cams: [{}, { mode: 10, shutter: 1 }, { mode: 10, shutter: 1 }], drop: { '2shutter': 1 } });
  assert.deepStrictEqual(await copyFlow(t.opts()), []);
  assert.strictEqual(t.log.filter((l) => l === '1:shutter').length, 1);
  assert.strictEqual(t.log.filter((l) => l === '2:shutter').length, 2);
  assert.ok(t.statuses.some((s) => /retrying cam2 \(1\/2\)/.test(s)));
});

test('gives up after two retries and reports what is still different', async () => {
  const t = setup({ cams: [{}, { mode: 10, shutter: 1 }, { mode: 10, shutter: 1 }], drop: { '1shutter': 99 } });
  const bad = await copyFlow(t.opts());
  assert.strictEqual(bad.length, 1);
  assert.strictEqual(bad[0].i, 1);
  assert.deepStrictEqual(bad[0].its.map((it) => it.label), ['Shutter']);
  assert.strictEqual(t.log.filter((l) => l === '1:shutter').length, 3); // first send + 2 retries
});

test('a camera that never reports back is flagged "none"', async () => {
  const t = setup({ cams: [{}, { mode: 10, shutter: 1 }, { mode: 10, shutter: 3 }], silent: [1] });
  const bad = await copyFlow(t.opts());
  assert.deepStrictEqual(bad.map((m) => [m.i, m.none]), [[1, true]]);
});

test('without a mode item every value is sent straight away', async () => {
  const t = setup({ cams: [{}, { mode: 0, shutter: 1 }, { mode: 0, shutter: 1 }] });
  const o = t.opts({ hasMode: false });
  assert.deepStrictEqual(await copyFlow(o), []);
  assert.ok(!t.statuses.some((s) => /switching/.test(s)));
});
