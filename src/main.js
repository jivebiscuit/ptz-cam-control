const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { ViscaClient, cmds, getPosition, getExposure } = require('./visca');
const { StreamServer } = require('./streams');
const streams = new StreamServer();

const DEFAULTS = {
  cameras: [
    { name: 'South', ip: '192.168.0.200' },
    { name: 'Center', ip: '192.168.0.201' },
    { name: 'North', ip: '192.168.0.202' },
    { name: 'Rear', ip: '192.168.0.203' },
  ],
  viscaPort: 5678,
  snapshotFps: 5,
};

const cfgPath = () => path.join(app.getPath('userData'), 'config.json');
function loadConfig() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(cfgPath(), 'utf8')) }; }
  catch { return JSON.parse(JSON.stringify(DEFAULTS)); }
}
let config;
let visca = [];
function rebuildClients() {
  visca.forEach((v) => v.close());
  visca = config.cameras.map((c) => new ViscaClient(c.ip, config.viscaPort));
}

function httpGet(ip, pathAndQuery) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: ip, path: pathAndQuery, timeout: 2000, agent: false }, (res) => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

function httpBody(ip, pathAndQuery) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: ip, path: pathAndQuery, timeout: 2000, agent: false }, (res) => {
      let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve(b));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}
function httpPost(ip, pathAndQuery, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: ip, path: pathAndQuery, method: 'POST', timeout: 2500, agent: false,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve(b));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.write(body); req.end();
  });
}
// ---- Auto tracking (Move SE): REST API /api/v1/control/track. Deliberately single-camera only: the renderer never
// sends tracking to more than one camera, and only these fields/values are accepted here. ----
function httpJson(ip, method, path, obj) {
  return new Promise((resolve, reject) => {
    const body = obj ? JSON.stringify(obj) : null;
    const req = http.request({ host: ip, path, method, timeout: 2500, agent: false,
      headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {} }, (res) => {
      let b = ''; res.on('data', (d) => (b += d));
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch { reject(new Error('unexpected reply')); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
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

// PTZOptics CGI names diagonals horizontal-first (leftup, not upleft)
const HTTP_DIR = { upleft: 'leftup', upright: 'rightup', downleft: 'leftdown', downright: 'rightdown' };

// HTTP CGI commands (basic control)
function httpCmd(ip, a) {
  const q = (...p) => `/cgi-bin/ptzctrl.cgi?ptzcmd&${p.join('&')}`;
  switch (a.type) {
    case 'move': return httpGet(ip, q(a.dir === 'stop' ? 'ptzstop' : (HTTP_DIR[a.dir] || a.dir), a.pan, a.tilt));
    case 'zoom': return httpGet(ip, a.dir === 'stop' ? q('zoomstop') : q(a.dir === 'in' ? 'zoomin' : 'zoomout', a.speed));
    case 'focus': return httpGet(ip, a.dir === 'stop' ? q('focusstop') : q(a.dir === 'in' ? 'focusin' : 'focusout', a.speed));
    case 'home': return httpGet(ip, q('home'));
    case 'imageConf': return imageConf(ip);
    case 'advConf': return advConf(ip);
    case 'trackGet': return trackGet(ip);
    case 'trackSet': return trackSet(ip, a.body);
    case 'presetImgRead': return presetImgRead(ip);
    case 'presetImgSet': return presetImgSet(ip, a.on);
    case 'image': return httpGet(ip, `/cgi-bin/ptzctrl.cgi?post_image_value&${encodeURIComponent(a.name)}&${encodeURIComponent(a.value)}`);
    // documented form is posset&N / poscall&N. The old posset&0&N / poscall&0&N ignored N and always used preset 0 (verified on a camera).
    case 'presetSet': return httpGet(ip, q('posset', a.n));
    case 'presetRecall': return httpGet(ip, q('poscall', a.n));
  }
  throw new Error('unknown http cmd ' + a.type);
}

// VISCA commands (fine control)
async function viscaCmd(i, a) {
  const c = visca[i];
  switch (a.type) {
    case 'move': return c.send(cmds.panTilt(a.dir === 'stop' ? 'stop' : a.dir, a.pan, a.tilt));
    case 'zoom': return c.send(a.dir === 'stop' ? cmds.zoomStop : a.dir === 'in' ? cmds.zoomTele(a.speed) : cmds.zoomWide(a.speed));
    case 'focus': return c.send(a.dir === 'stop' ? cmds.focusStop : a.dir === 'in' ? cmds.focusFar(a.speed) : cmds.focusNear(a.speed));
    case 'home': return c.send(cmds.home);
    case 'presetSet': return c.send(cmds.presetSet(a.n));
    case 'presetRecall': return c.send(cmds.presetRecall(a.n));
    case 'focusAuto': return c.send(cmds.focusAuto);
    case 'focusManual': return c.send(cmds.focusManual);
    case 'focusLock': return c.send(a.on ? cmds.focusLock : cmds.focusUnlock);
    case 'focusOnePush': return c.send(cmds.focusOnePush);
    case 'abs': return c.send(cmds.panTiltAbs(a.pan_speed, a.tilt_speed, a.pan, a.tilt));
    case 'rel': return c.send(cmds.panTiltRel(a.pan_speed, a.tilt_speed, a.dpan, a.dtilt));
    case 'zoomDirect': return c.send(cmds.zoomDirect(a.zoom));
    case 'position': return getPosition(c);
    case 'exposure': return getExposure(c);
    case 'flicker': return c.send(cmds.flicker(a.value));
    case 'aeMode': return c.send(cmds.aeMode(a.mode));
    case 'iris': return c.send(a.dir === 'up' ? cmds.irisUp : a.dir === 'down' ? cmds.irisDown : cmds.irisDirect(a.value));
    case 'shutter': return c.send(a.dir === 'up' ? cmds.shutterUp : a.dir === 'down' ? cmds.shutterDown : cmds.shutterDirect(a.value));
    case 'gain': return c.send(a.dir === 'up' ? cmds.gainUp : a.dir === 'down' ? cmds.gainDown : cmds.gainDirect(a.value));
  }
  throw new Error('unknown visca cmd ' + a.type);
}

ipcMain.handle('config:get', () => config);
ipcMain.handle('stream:start', () => streams.start(config.cameras));
ipcMain.handle('stream:status', () => streams.status());
ipcMain.handle('config:set', (_e, c) => {
  config = { ...config, ...c };
  fs.mkdirSync(path.dirname(cfgPath()), { recursive: true });
  fs.writeFileSync(cfgPath(), JSON.stringify(config, null, 2));
  rebuildClients();
  streams.start(config.cameras);
  return config;
});
ipcMain.handle('cam:http', async (_e, i, a) => {
  try { const data = await httpCmd(config.cameras[i].ip, a); return { ok: true, data }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('cam:visca', async (_e, i, a) => {
  try { return { ok: true, data: await viscaCmd(i, a) }; }
  catch (e) { return { ok: false, error: e.message }; }
});

app.whenReady().then(() => {
  config = loadConfig();
  rebuildClients();
  const win = new BrowserWindow({
    width: 1500, height: 900, backgroundColor: '#111',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'index.html'));
});
app.on('window-all-closed', () => { visca.forEach((v) => v.close()); streams.stopAll(); app.quit(); });
app.on('before-quit', () => streams.stopAll());
