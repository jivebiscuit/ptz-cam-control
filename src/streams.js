// Live video: one ffmpeg per camera decodes RTSP (H.264) -> MJPEG, re-served over
// a localhost multipart HTTP stream that the renderer shows in a plain <img>.
const { spawn } = require('child_process');
const http = require('http');

// ffmpeg-static ships ONE platform's binary (whichever platform `npm install` ran on); SOTH_FFMPEG overrides it
// (e.g. to point at a system ffmpeg). Inside a packaged app the binary lives in app.asar.unpacked.
let ffmpegPath = process.env.SOTH_FFMPEG || require('ffmpeg-static');
if (ffmpegPath && ffmpegPath.includes('app.asar')) ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');

const BOUNDARY = 'ffmpeg';
const RETRY_MIN = 2000, RETRY_MAX = 15000; // reconnect delay grows while a feed keeps failing, resets once video flows

class Feed {
  constructor(url) {
    this.url = url; this.clients = new Set();
    this.proc = null; this.stopped = false; this.live = false;
    this.error = '';          // why the feed is down (shown on the tile), '' when fine or unknown
    this.delay = RETRY_MIN; this.timer = null;
  }

  start() {
    if (this.stopped || this.proc) return;
    if (!ffmpegPath) { this.error = 'ffmpeg is not available for this platform'; return this._retry(); }
    const args = [
      '-hide_banner', '-loglevel', 'error',
      '-rtsp_transport', 'tcp', '-fflags', 'nobuffer', '-flags', 'low_delay',
      '-i', this.url, '-an',
      '-vf', 'fps=25', '-q:v', '5',
      '-f', 'mpjpeg', '-boundary_tag', BOUNDARY, 'pipe:1',
    ];
    let proc;
    try { proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); }
    catch (e) { this.error = e.message; return this._retry(); }
    this.proc = proc;
    proc.stdout.on('data', (d) => {
      this.live = true; this.error = ''; this.delay = RETRY_MIN;
      for (const res of this.clients) if (!res.destroyed) res.write(d);
    });
    proc.stderr.on('data', (d) => { this.error = String(d).trim().split('\n').pop().slice(0, 160); }); // ffmpeg's last complaint
    // spawn itself failed (binary missing, not executable, wrong platform): without this handler Node would throw
    proc.on('error', (err) => {
      this.error = err.code === 'ENOENT' ? `ffmpeg not found (${ffmpegPath})` : `${err.code || 'error'}: ${err.message}`;
      this._ended(proc);
    });
    proc.on('exit', () => this._ended(proc));
  }

  _ended(proc) {
    if (this.proc !== proc) return; // already handled ('error' and 'exit' can both fire)
    this.live = false; this.proc = null; this._retry();
  }

  _retry() {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; this.start(); }, this.delay);
    this.delay = Math.min(this.delay * 2, RETRY_MAX);
  }

  stop() {
    this.stopped = true; clearTimeout(this.timer);
    if (this.proc) this.proc.kill();
    for (const res of this.clients) res.end();
    this.clients.clear();
  }
}

class StreamServer {
  constructor() { this.feeds = []; this.server = null; this.port = 0; }

  async start(cameras, stream = 2) {
    this.stopFeeds();
    this.feeds = cameras.map((c) => new Feed(`rtsp://${c.ip}:554/${stream}`));
    this.feeds.forEach((f) => f.start());
    if (this.server) return this.port;
    this.server = http.createServer((req, res) => {
      const m = /^\/cam\/(\d+)/.exec(req.url);
      const feed = m && this.feeds[+m[1]];
      if (!feed) { res.writeHead(404); return res.end(); }
      res.writeHead(200, {
        'Content-Type': `multipart/x-mixed-replace;boundary=${BOUNDARY}`,
        'Cache-Control': 'no-cache', Connection: 'close',
      });
      feed.clients.add(res);
      const drop = () => feed.clients.delete(res);
      req.on('close', drop); res.on('error', drop);
    });
    await new Promise((r) => this.server.listen(0, '127.0.0.1', r));
    this.port = this.server.address().port;
    return this.port;
  }

  status() { return this.feeds.map((f) => f.live); }
  errors() { return this.feeds.map((f) => (f.live ? '' : f.error)); }
  stopFeeds() { this.feeds.forEach((f) => f.stop()); this.feeds = []; }
  stopAll() { this.stopFeeds(); if (this.server) this.server.close(); }
}

module.exports = { StreamServer };
