const test = require('node:test');
const assert = require('node:assert/strict');
const { createSceneWatch, SCENE_SETTLE_MS, SCENE_GIVE_UP_MS } = require('../../src/scenewatch');

const P = (pan, tilt = 0, zoom = 0) => ({ pan, tilt, zoom });

test('stays settling while cameras move, becomes active once they have been still long enough', () => {
  const w = createSceneWatch([0, 1], 0);
  assert.equal(w.update([P(0), P(0)], 0), 'settling');
  assert.equal(w.update([P(100), P(50)], 500), 'settling');   // still travelling
  assert.equal(w.update([P(200), P(50)], 1000), 'settling');
  assert.equal(w.update([P(200), P(50)], 1000 + SCENE_SETTLE_MS - 1), 'settling');
  assert.equal(w.update([P(200), P(50)], 1000 + SCENE_SETTLE_MS), 'active');
});

test('once active, any camera in the scene moving ends it; jitter inside the tolerance does not', () => {
  const w = createSceneWatch([0, 1], 0);
  w.update([P(10), P(20)], 0); w.update([P(10), P(20)], SCENE_SETTLE_MS);
  assert.equal(w.update([P(13), P(18, 3, 20)], 3000), 'active');
  assert.equal(w.update([P(10), P(60)], 3500), 'moved');
});

test('zoom changes count as movement', () => {
  const w = createSceneWatch([0], 0);
  w.update([P(0, 0, 100)], 0); w.update([P(0, 0, 100)], SCENE_SETTLE_MS);
  assert.equal(w.update([P(0, 0, 400)], 2000), 'moved');
});

test('cameras outside the scene and cameras with no reading never end it', () => {
  const w = createSceneWatch([0], 0);
  w.update([P(0), P(0)], 0); w.update([P(0), P(0)], SCENE_SETTLE_MS);
  assert.equal(w.update([P(0), P(900)], 2000), 'active');
  assert.equal(w.update([null, P(0)], 2500), 'active');
});

test('a camera with no reading holds settling, but not forever', () => {
  const w = createSceneWatch([0, 1], 0);
  assert.equal(w.update([P(0), null], 0), 'settling');
  assert.equal(w.update([P(0), null], SCENE_SETTLE_MS + 500), 'settling');
  assert.equal(w.update([P(0), null], SCENE_GIVE_UP_MS), 'active');
});

test('a manual move during settling just delays settling, then the new place is the baseline', () => {
  const w = createSceneWatch([0], 0);
  w.update([P(0)], 0); w.update([P(500)], 800);
  assert.equal(w.update([P(500)], 800 + SCENE_SETTLE_MS), 'active');
  assert.equal(w.update([P(700)], 5000), 'moved');
});
