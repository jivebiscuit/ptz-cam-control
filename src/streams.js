// Live video: one ffmpeg per camera decodes RTSP (H.264) -> MJPEG, re-served over
// a localhost multipart HTTP stream that the renderer shows in a plain <img>.
const { spawn } = require('child_process');
const http = require('http');

let ffmpegPath = require('ffmpeg-static');
if (ffmpegPath && ffmpegPath.includes('app.asar')) ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');

const BOUNDARY = 'ffmpeg';

class Feed {
  constructor(url) { this.url = url; this.clients = new Set(); this.proc = null; this.stopped = false; this.live = false; }

  start() {
    if (this.stopped) return;
    const args = [
      '-hide_banner', '-loglevel', 'error',
      '-rtsp_transport', 'tcp', '-fflags', 'nobuffer', '-flags', 'low_delay',
      '-i', this.url, '-an',
      '-vf', 'fps=25', '-q:v', '5',
      '-f', 'mpjpeg', '-boundary_tag', BOUNDARY, 'pipe:1',
    ];
    this.proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    this.proc.stdout.on('data', (d) => {
      this.live = true;
      for (const res of this.clients) res.write(d);
    });
    this.proc.on('exit', () => {
      this.live = false; this.proc = null;
      if (!this.stopped) setTimeout(() => this.start(), 2000); // auto-reconnect
    });
  }

  stop() { this.stopped = true; if (this.proc) this.proc.kill(); }
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
      req.on('close', () => feed.clients.delete(res));
    });
    await new Promise((r) => this.server.listen(0, '127.0.0.1', r));
    this.port = this.server.address().port;
    return this.port;
  }

  status() { return this.feeds.map((f) => f.live); }
  stopFeeds() { this.feeds.forEach((f) => f.stop()); this.feeds = []; }
  stopAll() { this.stopFeeds(); if (this.server) this.server.close(); }
}

module.exports = { StreamServer };
