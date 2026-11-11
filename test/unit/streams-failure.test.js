// How the video feeds behave when ffmpeg is missing, unusable, crashing or healthy.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fake, loadStreams, gaps, posixOnly } = require('./helpers/fake-ffmpeg');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const opts = { skip: posixOnly };

async function run(ffmpeg, seconds) {
  const { StreamServer, spawns } = loadStreams(ffmpeg);
  const s = new StreamServer();
  await s.start([{ ip: '203.0.113.9' }]);
  await wait(seconds * 1000);
  return { s, spawns, live: s.status()[0], reason: s.errors()[0] };
}
async function stopAndCheckNoMoreSpawns(s, spawns) {
  const n = spawns.length;
  s.stopAll();
  await wait(2500);
  assert.equal(spawns.length, n, 'stopAll() must cancel any pending retry');
}

test('missing ffmpeg: no crash, the reason is reported, and retries back off', opts, async () => {
  const { s, spawns, live, reason } = await run(fake.missing, 7);
  assert.equal(live, false);
  assert.match(reason, /ffmpeg not found/);
  assert.ok(spawns.length >= 3, `expected at least 3 attempts, got ${spawns.length}`);
  const g = gaps(spawns);
  assert.ok(g[0] >= 1.9, `first retry after about 2 s (was ${g[0]})`);
  assert.ok(g[1] > g[0], `the delay grows (${g[0]} then ${g[1]})`);
  await stopAndCheckNoMoreSpawns(s, spawns);
});

test('ffmpeg that cannot be executed: no crash and the reason is reported', opts, async () => {
  const { s, spawns, live, reason } = await run(fake.noexec, 3);
  assert.equal(live, false);
  assert.match(reason, /EACCES|ENOEXEC|error/);
  await stopAndCheckNoMoreSpawns(s, spawns);
});

test("ffmpeg that crashes straight away: its own message becomes the reason, and the delay grows", opts, async () => {
  const { s, spawns, live, reason } = await run(fake.crash, 7);
  assert.equal(live, false);
  assert.equal(reason, 'Connection refused');
  const g = gaps(spawns);
  assert.ok(g.length >= 2 && g[1] > g[0], `the delay grows (${g.join(', ')})`);
  await stopAndCheckNoMoreSpawns(s, spawns);
});

test('healthy ffmpeg: live, no error, a single process', opts, async () => {
  const { s, spawns, live, reason } = await run(fake.ok, 2.5);
  assert.equal(live, true);
  assert.equal(reason, '');
  assert.equal(spawns.length, 1);
  await stopAndCheckNoMoreSpawns(s, spawns);
});
