const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { ViscaClient, cmds, getPosition } = require('./visca');
const { StreamServer } = require('./streams');
const { int, oneOf, bool } = require('./validate');
const { cloneDefaults, validateConfig, sanitizeSaved } = require('./config');
const streams = new StreamServer();

const cfgPath = () => path.join(app.getPath('userData'), 'config.json');
function loadConfig() {
  // a missing, hand-edited or damaged file can never stop the app starting: keep what is valid, default the rest
  try { return sanitizeSaved(JSON.parse(fs.readFileSync(cfgPath(), 'utf8'))); }
  catch { return cloneDefaults(); }
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
function httpJson(ip, method, urlPath, obj) {
  return new Promise((resolve, reject) => {
    const body = obj ? JSON.stringify(obj) : null;
    const req = http.request({ host: ip, path: urlPath, method, timeout: 2500, agent: false,
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

// ---- What the renderer is allowed to ask for. Every value is checked here before it can reach a camera. ----
const MOVE_DIRS = ['up', 'down', 'left', 'right', 'upleft', 'upright', 'downleft', 'downright', 'stop'];
const PAN_SPEED = (v) => int(v, 1, 24, 'pan speed');
const TILT_SPEED = (v) => int(v, 1, 20, 'tilt speed');
const PRESET_NO = (v) => int(v, 0, 254, 'preset number');
// camera image/exposure/color settings sent as post_image_value&<name>&<value>, with each one's allowed range
const IMAGE_RANGE = {
  luminance: [0, 14], saturation: [0, 14], contrast: [0, 14], sharpness: [0, 16], hue: [0, 14],
  meter: [0, 3], gainLimit: [0, 15], drc: [0, 8], wbmode: [0, 32], rgain: [0, 255], bgain: [0, 255],
  rgaintuning: [0, 20], bgaintuning: [0, 20], colortemp: [0, 55], onepush: [0, 0],
};
const WB_MODES = [0, 1, 2, 3, 5, 32];
const AE_MODES = [0, 3, 10, 11, 13];

// PTZOptics CGI names diagonals horizontal-first (leftup, not upleft)
const HTTP_DIR = { upleft: 'leftup', upright: 'rightup', downleft: 'leftdown', downright: 'rightdown' };

// HTTP CGI commands (basic control)
function httpCmd(ip, a) {
  const q = (...p) => `/cgi-bin/ptzctrl.cgi?ptzcmd&${p.join('&')}`;
  switch (a.type) {
    case 'move': {
      const dir = oneOf(a.dir, MOVE_DIRS, 'direction'), pan = PAN_SPEED(a.pan), tilt = TILT_SPEED(a.tilt);
      return httpGet(ip, q(dir === 'stop' ? 'ptzstop' : (HTTP_DIR[dir] || dir), pan, tilt));
    }
    case 'zoom': {
      const dir = oneOf(a.dir, ['in', 'out', 'stop'], 'direction');
      return httpGet(ip, dir === 'stop' ? q('zoomstop') : q(dir === 'in' ? 'zoomin' : 'zoomout', int(a.speed, 1, 7, 'zoom speed')));
    }
    case 'focus': {
      const dir = oneOf(a.dir, ['in', 'out', 'stop'], 'direction');
      return httpGet(ip, dir === 'stop' ? q('focusstop') : q(dir === 'in' ? 'focusin' : 'focusout', int(a.speed, 1, 7, 'focus speed')));
    }
    case 'home': return httpGet(ip, q('home'));
    case 'imageConf': return imageConf(ip);
    case 'advConf': return advConf(ip);
    case 'trackGet': return trackGet(ip);
    case 'trackSet': return trackSet(ip, a.body);
    case 'presetImgRead': return presetImgRead(ip);
    case 'presetImgSet': return presetImgSet(ip, bool(a.on, 'on'));
    case 'image': {
      const name = oneOf(a.name, Object.keys(IMAGE_RANGE), 'setting'), [lo, hi] = IMAGE_RANGE[name];
      const value = int(a.value, lo, hi, name);
      if (name === 'wbmode') oneOf(value, WB_MODES, 'white balance mode');
      return httpGet(ip, `/cgi-bin/ptzctrl.cgi?post_image_value&${name}&${value}`);
    }
    // documented form is posset&N / poscall&N. The old posset&0&N / poscall&0&N ignored N and always used preset 0 (verified on a camera).
    case 'presetSet': return httpGet(ip, q('posset', PRESET_NO(a.n)));
    case 'presetRecall': return httpGet(ip, q('poscall', PRESET_NO(a.n)));
  }
  throw new Error('unknown http cmd ' + a.type);
}

// VISCA commands
async function viscaCmd(i, a) {
  const c = visca[i];
  const upDown = (up, down, direct) => (a.dir !== undefined ? (oneOf(a.dir, ['up', 'down'], 'direction') === 'up' ? up : down) : direct(int(a.value, 0, 17, 'value')));
  switch (a.type) {
    case 'move': return c.send(cmds.panTilt(oneOf(a.dir, MOVE_DIRS, 'direction'), PAN_SPEED(a.pan), TILT_SPEED(a.tilt)));
    case 'zoom': {
      const dir = oneOf(a.dir, ['in', 'out', 'stop'], 'direction');
      return c.send(dir === 'stop' ? cmds.zoomStop : dir === 'in' ? cmds.zoomTele(int(a.speed, 0, 7, 'zoom speed')) : cmds.zoomWide(int(a.speed, 0, 7, 'zoom speed')));
    }
    case 'focus': {
      const dir = oneOf(a.dir, ['in', 'out', 'stop'], 'direction');
      return c.send(dir === 'stop' ? cmds.focusStop : dir === 'in' ? cmds.focusFar(int(a.speed, 0, 7, 'focus speed')) : cmds.focusNear(int(a.speed, 0, 7, 'focus speed')));
    }
    case 'home': return c.send(cmds.home);
    case 'presetSet': return c.send(cmds.presetSet(PRESET_NO(a.n)));
    case 'presetRecall': return c.send(cmds.presetRecall(PRESET_NO(a.n)));
    case 'focusAuto': return c.send(cmds.focusAuto);
    case 'focusManual': return c.send(cmds.focusManual);
    case 'focusLock': return c.send(bool(a.on, 'on') ? cmds.focusLock : cmds.focusUnlock);
    case 'focusOnePush': return c.send(cmds.focusOnePush);
    case 'position': return getPosition(c);
    case 'flicker': return c.send(cmds.flicker(int(a.value, 0, 2, 'flicker')));
    case 'aeMode': return c.send(cmds.aeMode(oneOf(int(a.mode, 0, 13, 'exposure mode'), AE_MODES, 'exposure mode')));
    case 'iris': return c.send(upDown(cmds.irisUp, cmds.irisDown, cmds.irisDirect));
    case 'shutter': return c.send(upDown(cmds.shutterUp, cmds.shutterDown, cmds.shutterDirect));
    case 'gain': return c.send(upDown(cmds.gainUp, cmds.gainDown, cmds.gainDirect));
  }
  throw new Error('unknown visca cmd ' + a.type);
}

ipcMain.handle('config:get', () => config);
ipcMain.handle('stream:start', () => streams.start(config.cameras)); // returns the base URL of the (token-protected) video server
ipcMain.handle('stream:status', () => streams.status());
ipcMain.handle('stream:errors', () => streams.errors());
ipcMain.handle('config:set', (_e, c) => {
  let next;
  try { next = validateConfig({ ...config, ...(c && typeof c === 'object' ? c : {}) }); }
  catch (e) { return { ok: false, error: e.message }; }
  try {
    fs.mkdirSync(path.dirname(cfgPath()), { recursive: true });
    fs.writeFileSync(cfgPath(), JSON.stringify(next, null, 2));
  } catch (e) { return { ok: false, error: `could not save settings: ${e.message}` }; }
  config = next;
  rebuildClients();
  streams.start(config.cameras);
  return { ok: true, config };
});
// the renderer's camera index and command object are untrusted input like everything else
const cameraIndex = (i) => int(i, 0, config.cameras.length - 1, 'camera');
const commandObject = (a) => { if (!a || typeof a !== 'object' || typeof a.type !== 'string') throw new Error('malformed command'); return a; };
ipcMain.handle('cam:http', async (_e, i, a) => {
  try { const data = await httpCmd(config.cameras[cameraIndex(i)].ip, commandObject(a)); return { ok: true, data }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('cam:visca', async (_e, i, a) => {
  try { return { ok: true, data: await viscaCmd(cameraIndex(i), commandObject(a)) }; }
  catch (e) { return { ok: false, error: e.message }; }
});

// ---- window ----
let win = null;
function createWindow() {
  config = loadConfig();
  rebuildClients();
  // this app only ever shows its own page: no permission prompts (camera/mic/location...), no pop-ups, no navigation away
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  win = new BrowserWindow({
    width: 1500, height: 900, backgroundColor: '#111',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: false },
  });
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => { if (url !== win.webContents.getURL()) e.preventDefault(); });
  win.on('closed', () => { win = null; });
  win.loadFile(path.join(__dirname, 'index.html'));
}

// Only one copy of the app may run: two copies would fight over each camera's single VISCA connection and double the polling.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  app.whenReady().then(createWindow);
}
app.on('window-all-closed', () => { visca.forEach((v) => v.close()); streams.stopAll(); app.quit(); });
app.on('before-quit', () => streams.stopAll());
