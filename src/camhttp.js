// Everything main.js says to a camera over HTTP (port 80): one request helper plus the camera-specific calls built on it.
const http = require('http');

// One HTTP request to a camera. Resolves { status, body }; rejects on timeout or network error.
function request(ip, { method = 'GET', path, body = null, type = 'application/x-www-form-urlencoded', timeout } = {}) {
  return new Promise((resolve, reject) => {
    const headers = body == null ? {} : { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) };
    const req = http.request({ host: ip, path, method, timeout: timeout || (body == null ? 2000 : 2500), agent: false, headers }, (res) => {
      let text = ''; res.on('data', (d) => (text += d)); res.on('end', () => resolve({ status: res.statusCode, body: text }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}
const httpGet = async (ip, path) => (await request(ip, { path })).status;          // commands: only the status matters
const httpBody = async (ip, path) => (await request(ip, { path })).body;
const httpPost = async (ip, path, body) => (await request(ip, { method: 'POST', path, body })).body;
async function httpJson(ip, method, path, obj) {
  const r = await request(ip, { method, path, body: obj ? JSON.stringify(obj) : null, type: 'application/json' });
  try { return JSON.parse(r.body); } catch { throw new Error('unexpected reply'); }
}

// ---- Auto tracking (Move SE): REST API /api/v1/control/track. Deliberately single-camera only: the renderer never
// sends tracking to more than one camera, and only these fields/values are accepted here. ----
async function trackGet(ip) { return httpJson(ip, 'GET', '/api/v1/control/track'); }
const TRACK_MODES = ['off', 'tracking', 'autoframe'];
const isLoc = (v) => v === 'now' || v === 'home' || (/^\d{1,3}$/.test(String(v)) && +v >= 0 && +v <= 254);
async function trackSet(ip, body) {
  const out = {};
  for (const [k, v] of Object.entries(body || {})) {
    if (k === 'trackMode' && TRACK_MODES.includes(v)) out[k] = v;
    else if (k === 'delayTime' && Number.isInteger(+v) && +v >= 1 && +v <= 60) out[k] = +v;
    else if (k === 'lossTime' && Number.isInteger(+v) && +v >= 6 && +v <= 60) out[k] = +v;
    else if (['startPosition', 'stopPosition', 'lossPosition'].includes(k) && isLoc(v)) out[k] = String(v);
    else if (k === 'trackingOverlay' && (v === 'on' || v === 'off')) out[k] = v;
    else throw new Error(`refused tracking field ${k}=${v}`);
  }
  const r = await httpJson(ip, 'POST', '/api/v1/control/track', out);
  if (r.msg !== 'operate success') throw new Error(r.msg || 'rejected by camera');
  return r;
}

// "Image Presets": when on, recalling a preset also applies the image settings (color/exposure) saved with it; when off,
// recall only moves pan/tilt/zoom/focus. Set with VISCA 81 0A 11 26 02 0V FF (V = 0/1) via post_visca, read from /data/preset_param.conf.
async function presetImgRead(ip) {
  const body = await httpPost(ip, '/cgi-bin/param.cgi?get_path', 'path=' + encodeURIComponent('/data/preset_param.conf'));
  const m = /isp_switch="(\d)"/.exec(body);
  if (!m) throw new Error('unexpected preset_param reply');
  return m[1];
}
async function presetImgSet(ip, on) {
  const v = on ? 1 : 0;
  return httpPost(ip, '/cgi-bin/param.cgi?post_visca', 'len=7&visca=' + encodeURIComponent('0x81,0x0a,0x11,0x26,0x02,0x0' + v + ',0xff'));
}

// parse key="value" pairs from param.cgi?get_image_conf
async function imageConf(ip) {
  const body = await httpBody(ip, '/cgi-bin/param.cgi?get_image_conf');
  const o = {};
  for (const k of ['bright', 'saturation', 'contrast', 'sharpness', 'hue']) {
    const m = new RegExp(`^${k}="(\\d+)"`, 'm').exec(body);
    if (!m) throw new Error('no ' + k + ' in reply');
    o[k] = +m[1];
  }
  return o;
}

// Everything the camera's own web UI reads: exposure mode, iris, shutter, gain(+limit), meter, DRC, anti-flicker,
// white balance, focus lock state... (note the spelling: get_advance_image_conf)
async function advConf(ip) {
  const body = await httpBody(ip, '/cgi-bin/param.cgi?get_advance_image_conf');
  const o = {};
  for (const m of body.matchAll(/^(\w+)="([^"]*)"/gm)) o[m[1]] = m[2];
  if (!('exposure_mode' in o)) throw new Error('unexpected advanced config reply');
  return o;
}

module.exports = { request, httpGet, httpBody, httpPost, httpJson, trackGet, trackSet, presetImgRead, presetImgSet, imageConf, advConf };
