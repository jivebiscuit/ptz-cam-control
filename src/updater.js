// "Is there a newer release?" check against the GitHub Releases of this repo.
// It only ever looks and tells the user; installing is manual (open the release page, download, replace the app).
// A public repo needs no token; for a private one put a read-only token in <userData>/update-token.txt (or the PTZ_UPDATE_TOKEN env var).
const https = require('https');

const REPO = 'jivebiscuit/ptz-cam-control';

// "v1.2.3" / "1.2.3-beta" -> [1,2,3]; null if it is not a version
function parseVersion(s) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(s || '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
function isNewer(latest, current) {
  const a = parseVersion(latest), b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

function fetchLatest(token, { host = 'api.github.com', timeout = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { 'User-Agent': 'ptz-cam-control', Accept: 'application/vnd.github+json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const req = https.get({ host, path: `/repos/${REPO}/releases/latest`, headers, timeout }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; if (body.length > 1e6) req.destroy(new Error('response too large')); });
      res.on('end', () => {
        if (res.statusCode === 404 || res.statusCode === 401 || res.statusCode === 403) {
          return resolve({ status: token ? 'denied' : 'no-token' });
        }
        if (res.statusCode !== 200) return reject(new Error(`GitHub answered ${res.statusCode}`));
        try { resolve({ status: 'ok', release: JSON.parse(body) }); } catch { reject(new Error('unreadable response from GitHub')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
  });
}

// -> { state: 'up-to-date' | 'available' | 'no-token' | 'denied' | 'error', version?, url?, error? }
async function checkForUpdate(currentVersion, token, opts) {
  try {
    const r = await fetchLatest(token, opts);
    if (r.status !== 'ok') return { state: r.status };
    const rel = r.release || {};
    if (isNewer(rel.tag_name, currentVersion)) return { state: 'available', version: String(rel.tag_name).replace(/^v/, ''), url: rel.html_url };
    return { state: 'up-to-date' };
  } catch (e) { return { state: 'error', error: e.message }; }
}

module.exports = { parseVersion, isNewer, checkForUpdate, REPO };
