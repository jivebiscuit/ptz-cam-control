#!/usr/bin/env node
// Guards the packaged build against shipping the wrong platform's ffmpeg.
//
// ffmpeg-static downloads ONE binary, for whichever OS ran `npm install`. A Windows package built on a Mac would
// silently contain the Mac binary and the video would never start. So:
//   node scripts/ffmpeg-check.js <win32|darwin|linux>              before building: is the installed ffmpeg right?
//   node scripts/ffmpeg-check.js <win32|darwin|linux> --packaged   after building: is the ffmpeg inside dist/ right?
const fs = require('fs');
const path = require('path');

const target = process.argv[2];
const packaged = process.argv.includes('--packaged');
if (!['win32', 'darwin', 'linux'].includes(target)) { console.error('usage: node scripts/ffmpeg-check.js <win32|darwin|linux> [--packaged]'); process.exit(2); }

// Identify an executable's platform from its first bytes.
function formatOf(file) {
  const fd = fs.openSync(file, 'r'); const b = Buffer.alloc(4); fs.readSync(fd, b, 0, 4, 0); fs.closeSync(fd);
  const hex = b.toString('hex');
  if (hex.startsWith('4d5a')) return 'win32';                                   // "MZ": Windows PE
  if (hex === '7f454c46') return 'linux';                                       // ELF
  if (['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca'].includes(hex)) return 'darwin'; // Mach-O
  return 'unknown';
}

function findFiles(dir, wanted, out = []) {
  for (const e of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) findFiles(p, wanted, out);
    else if (wanted(p)) out.push(p);
  }
  return out;
}

const root = path.join(__dirname, '..');
let files;
if (packaged) {
  files = findFiles(path.join(root, 'dist'), (p) => /app\.asar\.unpacked[\\/]node_modules[\\/]ffmpeg-static[\\/]ffmpeg(\.exe)?$/.test(p));
  if (!files.length) {
    console.error('FAIL: no ffmpeg found inside dist/ under app.asar.unpacked. The packaged app could not start video.\n' +
      '      Check "asarUnpack" in package.json (it must include node_modules/ffmpeg-static/**).');
    process.exit(1);
  }
} else {
  files = [require('ffmpeg-static')].filter(Boolean);
  if (!files.length || !fs.existsSync(files[0])) { console.error('FAIL: ffmpeg-static has no binary installed on this machine. Run `npm ci` (or `npm rebuild ffmpeg-static`).'); process.exit(1); }
}

let bad = 0;
for (const f of files) {
  const fmt = formatOf(f);
  const ok = fmt === target;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${path.relative(root, f)}  is a ${fmt} executable (need ${target})`);
  if (!ok) bad++;
}
if (bad) {
  console.error('\nThe ffmpeg that would be bundled is for the wrong platform, so video would not work in this build.');
  if (!packaged) {
    console.error('Fix: build on a ' + (target === 'win32' ? 'Windows' : target === 'darwin' ? 'Mac' : 'Linux') + ' machine (run `npm ci` there first), or fetch that platform\'s binary:');
    console.error('  npm_config_platform=' + target + ' npm_config_arch=x64 npm rebuild ffmpeg-static   (this replaces the binary used by `npm start` on this machine)');
  }
  process.exit(1);
}
console.log('ffmpeg check passed for ' + target + (packaged ? ' (packaged build)' : ''));
