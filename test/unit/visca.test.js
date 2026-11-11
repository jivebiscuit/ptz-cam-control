// The VISCA client against a fake camera that speaks just enough VISCA-over-TCP.
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { ViscaClient, cmds, getPosition } = require('../../src/visca');

const nibs = (v) => [(v >> 12) & 15, (v >> 8) & 15, (v >> 4) & 15, v & 15];
const PAN = 300, TILT = -150, ZOOM = 5000;
const PT = Buffer.from([0x90, 0x50, ...nibs(PAN & 0xffff), ...nibs(TILT & 0xffff), 0xff]); // 11 bytes
const ZM = Buffer.from([0x90, 0x50, ...nibs(ZOOM), 0xff]);                                    // 7 bytes

// mode: 'normal' | 'lateZoom' (the first zoom reply arrives 1.6 s late) | 'wrongSize' (pan/tilt answered with a zoom-sized reply)
async function fakeCamera(getMode) {
  const state = { connections: 0, lateSent: false, received: [] };
  const server = net.createServer((sock) => {
    state.connections++;
    let buf = Buffer.alloc(0);
    sock.on('error', () => {});
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      let i;
      while ((i = buf.indexOf(0xff)) >= 0) {
        const msg = buf.subarray(0, i + 1); buf = buf.subarray(i + 1);
        const hex = msg.toString('hex');
        state.received.push(hex);
        const reply = hex === '81090612ff' ? PT : hex === '81090447ff' ? ZM : null;
        if (!reply) continue;
        if (getMode() === 'lateZoom' && hex === '81090447ff' && !state.lateSent) { state.lateSent = true; setTimeout(() => { try { sock.write(ZM); } catch { /* closed */ } }, 1600); continue; }
        if (getMode() === 'wrongSize' && hex === '81090612ff') { sock.write(ZM); continue; }
        sock.write(reply);
      }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { port: server.address().port, state, close: () => server.close() };
}

test('reads pan, tilt (signed) and zoom', async () => {
  const cam = await fakeCamera(() => 'normal'); const c = new ViscaClient('127.0.0.1', cam.port);
  assert.deepEqual(await getPosition(c), { pan: PAN, tilt: TILT, zoom: ZOOM });
  c.close(); cam.close();
});

test('concurrent reads are serialized and each gets its own answer', async () => {
  const cam = await fakeCamera(() => 'normal'); const c = new ViscaClient('127.0.0.1', cam.port);
  const all = await Promise.all([getPosition(c), getPosition(c), getPosition(c)]);
  for (const p of all) assert.deepEqual(p, { pan: PAN, tilt: TILT, zoom: ZOOM });
  c.close(); cam.close();
});

test('a late reply fails that read, and can never be mistaken for the answer to the next one', async () => {
  let mode = 'lateZoom';
  const cam = await fakeCamera(() => mode); const c = new ViscaClient('127.0.0.1', cam.port);
  await assert.rejects(getPosition(c), /inquiry timeout/);
  await new Promise((r) => setTimeout(r, 1700)); // the late reply now arrives on the old, dropped connection
  mode = 'normal';
  assert.deepEqual(await getPosition(c), { pan: PAN, tilt: TILT, zoom: ZOOM });
  assert.equal(cam.state.connections, 2, 'the client reconnected exactly once');
  c.close(); cam.close();
});

test('a reply of the wrong size is rejected, and the client recovers', async () => {
  let mode = 'wrongSize';
  const cam = await fakeCamera(() => mode); const c = new ViscaClient('127.0.0.1', cam.port);
  await assert.rejects(getPosition(c), /unexpected reply/);
  mode = 'normal';
  assert.deepEqual(await getPosition(c), { pan: PAN, tilt: TILT, zoom: ZOOM });
  c.close(); cam.close();
});

test('command bytes: pan/tilt drive, zoom, home, presets', () => {
  assert.equal(cmds.panTilt('up', 8, 8), '81 01 06 01 08 08 03 01 ff');
  assert.equal(cmds.panTilt('stop', 1, 1), '81 01 06 01 01 01 03 03 ff');
  assert.equal(cmds.panTilt('downleft', 24, 20), '81 01 06 01 18 14 01 02 ff');
  assert.equal(cmds.home, '81 01 06 04 ff');
  assert.equal(cmds.zoomTele(5), '81 01 04 07 25 ff');
  assert.equal(cmds.zoomWide(3), '81 01 04 07 33 ff');
  assert.equal(cmds.zoomStop, '81 01 04 07 00 ff');
  assert.equal(cmds.presetRecall(5), '81 01 04 3f 02 05 ff');
  assert.equal(cmds.presetSet(12), '81 01 04 3f 01 0c ff');
  assert.equal(cmds.focusLock, '81 0a 04 68 02 ff');
  assert.equal(cmds.focusUnlock, '81 0a 04 68 03 ff');
  assert.equal(cmds.flicker(2), '81 01 04 23 02 ff');
});
