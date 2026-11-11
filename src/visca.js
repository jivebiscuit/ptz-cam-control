// Minimal VISCA-over-IP client (raw VISCA over TCP, port 5678 on PTZOptics).
const net = require('net');

class ViscaClient {
  constructor(host, port = 5678) {
    this.host = host; this.port = port;
    this.sock = null; this.buf = Buffer.alloc(0);
    this.pending = []; // the (at most one) inquiry currently waiting for its reply
    this.queue = Promise.resolve(); // inquiries run strictly one at a time per camera
    this.connecting = null;
  }

  connect() {
    if (this.sock && !this.sock.destroyed) return Promise.resolve();
    if (this.connecting) return this.connecting;
    this.connecting = new Promise((resolve, reject) => {
      const s = net.connect({ host: this.host, port: this.port });
      s.setNoDelay(true);
      s.setTimeout(0);
      const fail = (e) => { this.connecting = null; reject(e); };
      s.once('error', fail);
      s.once('connect', () => {
        s.removeListener('error', fail);
        this.sock = s; this.buf = Buffer.alloc(0); this.connecting = null;
        s.on('data', (d) => this._onData(d));
        s.on('error', () => this._drop());
        s.on('close', () => this._drop());
        resolve();
      });
      setTimeout(() => { if (this.connecting) { s.destroy(); fail(new Error('connect timeout')); } }, 2000);
    });
    return this.connecting;
  }

  _drop() {
    if (this.sock) this.sock.destroy();
    this.sock = null;
    this.pending.splice(0).forEach((p) => p.reject(new Error('connection lost')));
  }

  _onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    let i;
    while ((i = this.buf.indexOf(0xff)) >= 0) {
      const msg = this.buf.subarray(0, i + 1);
      this.buf = this.buf.subarray(i + 1);
      // Inquiry reply: y0 50 ... FF (acks are y0 4z, completions y0 5z with len 3)
      if (msg.length > 3 && msg[1] === 0x50) {
        const p = this.pending.shift();
        if (p) {
          clearTimeout(p.t);
          if (p.expectLen && msg.length !== p.expectLen) { p.reject(new Error('unexpected reply')); this._drop(); }
          else p.resolve(msg);
        }
      }
    }
  }

  async send(hex) {
    await this.connect();
    this.sock.write(Buffer.from(hex.replace(/\s+/g, ''), 'hex'));
  }

  // One inquiry at a time. If a reply is late we drop the connection (so that reply can never be mistaken for the
  // answer to the next question) and reconnect on the next call. expectLen (bytes incl. FF) sanity-checks the reply.
  inquire(hex, timeout = 1200, expectLen = 0) {
    const run = () => this._inquireNow(hex, timeout, expectLen);
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => {});
    return next;
  }

  async _inquireNow(hex, timeout, expectLen) {
    await this.connect();
    return new Promise((resolve, reject) => {
      const p = { resolve, reject, expectLen };
      p.t = setTimeout(() => {
        const k = this.pending.indexOf(p); if (k >= 0) this.pending.splice(k, 1);
        this._drop();
        reject(new Error('inquiry timeout'));
      }, timeout);
      this.pending.push(p);
      this.sock.write(Buffer.from(hex.replace(/\s+/g, ''), 'hex'));
    });
  }

  close() { this._drop(); }
}

const hx = (n) => n.toString(16).padStart(2, '0');
// 16-bit value -> 4 nibble bytes "0a 0b 0c 0d"
const nib = (v) => [(v >> 12) & 15, (v >> 8) & 15, (v >> 4) & 15, v & 15].map(hx).join(' ');
const unnib = (b, o) => ((b[o] & 15) << 12) | ((b[o + 1] & 15) << 8) | ((b[o + 2] & 15) << 4) | (b[o + 3] & 15);
const s16 = (v) => (v & 0x8000 ? v - 0x10000 : v);

const DIR = {
  up: '03 01', down: '03 02', left: '01 03', right: '02 03',
  upleft: '01 01', upright: '02 01', downleft: '01 02', downright: '02 02', stop: '03 03',
};

const cmds = {
  panTilt(dir, vv, ww) { return `81 01 06 01 ${hx(vv)} ${hx(ww)} ${DIR[dir]} ff`; },
  // panTiltAbs / zoomDirect are not wired to the UI; kept as diagnostic helpers (used by test scripts)
  panTiltAbs(vv, ww, pan, tilt) { return `81 01 06 02 ${hx(vv)} ${hx(ww)} ${nib(pan & 0xffff)} ${nib(tilt & 0xffff)} ff`; },
  home: '81 01 06 04 ff',
  zoomStop: '81 01 04 07 00 ff',
  zoomTele(p) { return `81 01 04 07 2${p & 7} ff`; },
  zoomWide(p) { return `81 01 04 07 3${p & 7} ff`; },
  zoomDirect(z) { return `81 01 04 47 ${nib(z)} ff`; },
  focusStop: '81 01 04 08 00 ff',
  focusFar(p) { return `81 01 04 08 2${p & 7} ff`; },
  focusNear(p) { return `81 01 04 08 3${p & 7} ff`; },
  focusAuto: '81 01 04 38 02 ff',
  focusManual: '81 01 04 38 03 ff',
  focusLock: '81 0a 04 68 02 ff',
  focusUnlock: '81 0a 04 68 03 ff',
  focusOnePush: '81 01 04 18 01 ff',
  presetSet(n) { return `81 01 04 3f 01 ${hx(n)} ff`; },
  presetRecall(n) { return `81 01 04 3f 02 ${hx(n)} ff`; },
  panTiltInq: '81 09 06 12 ff',
  zoomInq: '81 09 04 47 ff',
};

// Exposure (standard VISCA; the PTZOptics doc page has copy/paste errors in the shutter/gain rows)
// Exposure builders (the live exposure readout itself comes from the camera's HTTP state, not VISCA inquiries)
Object.assign(cmds, {
  flicker(p) { return `81 01 04 23 0${p & 15} ff`; }, // 0 off, 1 50Hz, 2 60Hz
  aeMode(m) { return `81 01 04 39 ${hx(m)} ff`; },
  irisUp: '81 01 04 0b 02 ff', irisDown: '81 01 04 0b 03 ff',
  irisDirect(v) { return `81 01 04 4b 00 00 0${(v >> 4) & 15} 0${v & 15} ff`; },
  shutterUp: '81 01 04 0a 02 ff', shutterDown: '81 01 04 0a 03 ff',
  shutterDirect(v) { return `81 01 04 4a 00 00 0${(v >> 4) & 15} 0${v & 15} ff`; },
  gainUp: '81 01 04 0c 02 ff', gainDown: '81 01 04 0c 03 ff',
  gainDirect(v) { return `81 01 04 4c 00 00 0${(v >> 4) & 15} 0${v & 15} ff`; },
});
async function getPosition(c) {
  const pt = await c.inquire(cmds.panTiltInq, 1200, 11);
  const z = await c.inquire(cmds.zoomInq, 1200, 7);
  return { pan: s16(unnib(pt, 2)), tilt: s16(unnib(pt, 6)), zoom: unnib(z, 2) };
}

module.exports = { ViscaClient, cmds, getPosition };
