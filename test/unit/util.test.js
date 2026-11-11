const test = require('node:test');
const assert = require('node:assert/strict');
const { esc, pollOne } = require('../../src/util');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('esc turns markup into harmless text', () => {
  assert.equal(esc('<img src=x onerror="a()">'), '&lt;img src=x onerror=&quot;a()&quot;&gt;');
  assert.equal(esc(`it's & "quoted"`), 'it&#39;s &amp; &quot;quoted&quot;');
  assert.equal(esc(5), '5');
  assert.equal(esc('plain'), 'plain');
});

test('pollOne stores a good value', async () => {
  const busy = [], store = [], times = [];
  await pollOne(busy, store, times, 0, async () => ({ ok: true, data: { v: 1 } }), 300);
  assert.deepEqual(store[0], { v: 1 });
});

test('pollOne keeps the last good value through a brief failure, then clears it after the stale limit', async () => {
  const busy = [], store = [], times = [];
  const bad = async () => ({ ok: false, error: 'timeout' });
  await pollOne(busy, store, times, 0, async () => ({ ok: true, data: 'x' }), 150);
  await pollOne(busy, store, times, 0, bad, 150);
  assert.equal(store[0], 'x', 'one failed poll must not blank the value');
  await pollOne(busy, store, times, 0, async () => { throw new Error('boom'); }, 150);
  assert.equal(store[0], 'x', 'a thrown error must not blank it either');
  await wait(200);
  await pollOne(busy, store, times, 0, bad, 150);
  assert.equal(store[0], null, 'after the stale limit it clears');
  await pollOne(busy, store, times, 0, async () => ({ ok: true, data: 'y' }), 150);
  assert.equal(store[0], 'y', 'and recovers on the next good reply');
});

test('a slow camera does not delay the others, and still updates when it answers', async () => {
  const busy = [], store = [], times = [];
  const slow = pollOne(busy, store, times, 1, async () => { await wait(150); return { ok: true, data: 'slow' }; }, 300);
  const t0 = Date.now();
  await pollOne(busy, store, times, 2, async () => ({ ok: true, data: 'fast' }), 300);
  assert.ok(Date.now() - t0 < 100, 'the fast camera must not wait for the slow one');
  assert.equal(store[2], 'fast');
  await slow;
  assert.equal(store[1], 'slow');
});

test('overlapping polls of the same camera are collapsed into one request', async () => {
  const busy = [], store = [], times = [];
  let calls = 0;
  const f = async () => { calls++; await wait(60); return { ok: true, data: 1 }; };
  await Promise.all([pollOne(busy, store, times, 0, f, 300), pollOne(busy, store, times, 0, f, 300), pollOne(busy, store, times, 0, f, 300)]);
  assert.equal(calls, 1);
  assert.equal(busy[0], false, 'and the camera is free again afterwards');
});
