// Fake "ffmpeg" programs (POSIX shell scripts) and a loader that gives each test a fresh streams.js pointed at one of them.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptz-fakeff-'));
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });
const write = (name, body, mode = 0o755) => { const p = path.join(dir, name); fs.writeFileSync(p, body, { mode }); fs.chmodSync(p, mode); return p; };

const fake = {
  // prints an error and exits, like ffmpeg failing to reach a camera
  crash: write('crash.sh', '#!/bin/sh\necho "Connection refused" >&2\nexit 1\n'),
  // streams a little fake video forever
  ok: write('ok.sh', '#!/bin/sh\nwhile true; do printf -- "--ffmpeg\\r\\nContent-type: image/jpeg\\r\\n\\r\\nFAKEJPEG\\r\\n"; sleep 0.1; done\n'),
  // floods ~12 MB/s of data
  flood: write('flood.sh', `#!/bin/sh\nhead -c 65536 /dev/zero > "${path.join(dir, 'chunk')}"\nwhile true; do cat "${path.join(dir, 'chunk')}"; sleep 0.005; done\n`),
  // exists but is not executable
  noexec: write('noexec.sh', 'not a program', 0o644),
  missing: path.join(dir, 'does-not-exist'),
};

// Returns { StreamServer, spawns } where spawns lists the time of every process start attempt.
function loadStreams(ffmpegPath) {
  const spawns = [];
  const realSpawn = cp.spawn;
  cp.spawn = (...a) => { spawns.push(Date.now()); return realSpawn(...a); };
  process.env.PTZ_FFMPEG = ffmpegPath;
  const file = require.resolve('../../../src/streams.js');
  delete require.cache[file];
  const mod = require(file);
  cp.spawn = realSpawn; // streams.js keeps its own reference to the wrapper, so the counting continues
  return { StreamServer: mod.StreamServer, spawns };
}

const gaps = (spawns) => spawns.slice(1).map((t, i) => (t - spawns[i]) / 1000);
const posixOnly = process.platform === 'win32' ? 'fake ffmpegs are POSIX shell scripts' : false;

module.exports = { fake, loadStreams, gaps, posixOnly };
