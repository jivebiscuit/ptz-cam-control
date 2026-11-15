// The local video server: who may watch, and what happens to a viewer that stops reading.
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const http = require('node:http');
const { fake, loadStreams, posixOnly } = require('./helpers/fake-ffmpeg');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const opts = { skip: posixOnly };

// GET and report the status plus how many body bytes arrived (stops after ~2 KB)
const get = (url, headers) => new Promise((resolve) => {
  const u = new URL(url);
  const r = http.get({ host: u.hostname, port: u.port, path: u.pathname + u.search, headers, timeout: 4000 }, (res) => {
    let n = 0;
    res.on('data', (d) => { n += d.length; if (n > 2000) res.destroy(); });
    res.on('close', () => resolve({ status: res.statusCode, bytes: n }));
  });
  r.on('error', () => resolve({ status: 0, bytes: 0 }));
  r.on('timeout', () => { r.destroy(); resolve({ status: -1, bytes: 0 }); });
});

test('only requests with the right token, a loopback Host and a real camera are served', opts, async () => {
  const { StreamServer } = loadStreams(fake.ok);
  const s = new StreamServer();
  const base = await s.start([{ ip: '203.0.113.9' }]);
  const port = new URL(base).port, token = base.split('/').pop();
  await wait(1200); // let the fake ffmpeg start producing
  assert.match(token, /^[0-9a-f]{32}$/);
  assert.equal((await get(`http://127.0.0.1:${port}/cam/0`)).status, 404, 'no token');
  assert.equal((await get(`http://127.0.0.1:${port}/cam/${'0'.repeat(32)}/0`)).status, 404, 'wrong token');
  assert.equal((await get(`http://127.0.0.1:${port}/cam/${token}/0`, { Host: 'evil.example' })).status, 404, 'foreign Host header');
  assert.equal((await get(`http://127.0.0.1:${port}/cam/${token}/9`)).status, 404, 'camera that does not exist');
  const good = await get(`http://127.0.0.1:${port}/cam/${token}/0`);
  assert.equal(good.status, 200);
  assert.ok(good.bytes > 100, 'and the video actually flows');
  s.stopAll();
});

test('the token is different on every run', opts, async () => {
  const a = loadStreams(fake.ok), b = loadStreams(fake.ok);
  const sa = new a.StreamServer(), sb = new b.StreamServer();
  assert.notEqual(sa.token, sb.token);
});

test('a viewer that stops reading is cut off; a normal viewer is kept; memory stays bounded', opts, async () => {
  const { StreamServer } = loadStreams(fake.flood);
  const s = new StreamServer();
  const base = await s.start([{ ip: '203.0.113.9' }]);
  const port = +new URL(base).port, path = new URL(base).pathname + '/0';
  const open = (reading) => new Promise((resolve) => {
    const sock = net.connect(port, '127.0.0.1', () => {
      sock.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`);
      if (reading) sock.on('data', () => {}); else sock.pause();
      resolve(sock);
    });
    sock.on('error', () => {});
  });
  await wait(1500);
  const socks = [];
  try {
    // Watch the viewer count while connecting: on a fast machine the stalled viewer can already be 4 MB behind (and cut off)
    // within a second, so a single check after a fixed wait is a race. The count must reach 2 at some point.
    let peak = 0;
    const watcher = setInterval(() => { peak = Math.max(peak, s.feeds[0].clients.size); }, 5);
    socks.push(await open(true), await open(false));
    await wait(1000);
    clearInterval(watcher);
    assert.equal(peak, 2, 'both viewers connected');
    const before = process.memoryUsage().rss;
    for (let i = 0; i < 100 && s.feeds[0].clients.size !== 1; i++) await wait(100); // up to 10 s
    assert.equal(s.feeds[0].clients.size, 1, 'the stalled viewer was dropped once 4 MB behind');
    await wait(1000);
    assert.equal(s.feeds[0].clients.size, 1, 'the normal viewer is kept');
    const growthMB = (process.memoryUsage().rss - before) / 1048576;
    assert.ok(growthMB < 80, `memory stayed bounded (grew ${Math.round(growthMB)} MB)`);
  } finally {
    // always release the sockets and the fake ffmpeg, so a failed assertion cannot leave the test process hanging
    socks.forEach((k) => k.destroy()); s.stopAll();
  }
});
