const { app, BrowserWindow, ipcMain, session, Menu, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { ViscaClient, cmds, getPosition } = require('./visca');
const { StreamServer } = require('./streams');
const { httpGet, trackGet, trackSet, imageConf, advConf } = require('./camhttp');
const { int, oneOf, bool } = require('./validate');
const { cloneDefaults, validateConfig, sanitizeSaved } = require('./config');
const atem = require('./atem');
const { checkForUpdate } = require('./updater');
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
ipcMain.handle('atem:status', () => atem.status());
ipcMain.handle('config:set', (_e, c) => {
  let next;
  try { next = validateConfig({ ...config, ...(c && typeof c === 'object' ? c : {}) }); }
  catch (e) { return { ok: false, error: e.message }; }
  try {
    fs.mkdirSync(path.dirname(cfgPath()), { recursive: true });
    fs.writeFileSync(cfgPath(), JSON.stringify(next, null, 2));
  } catch (e) { return { ok: false, error: `could not save settings: ${e.message}` }; }
  const atemChanged = next.atem.ip !== config.atem.ip;
  config = next;
  if (atemChanged) atem.start(config.atem.ip);
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

// ---- update check (GitHub Releases of the private repo; needs a read-only token, see updater.js) ----
const tokenPath = () => path.join(app.getPath('userData'), 'update-token.txt');
function updateToken() {
  if (process.env.PTZ_UPDATE_TOKEN) return process.env.PTZ_UPDATE_TOKEN.trim();
  try { return fs.readFileSync(tokenPath(), 'utf8').trim(); } catch { return ''; }
}
// manual = from the menu: always say what happened. On launch: stay silent unless there is a newer version.
async function runUpdateCheck(manual) {
  const r = await checkForUpdate(app.getVersion(), updateToken());
  if (!manual && r.state !== 'available') return;
  const opts = { type: 'info', title: 'Updates', buttons: ['OK'], message: '' };
  if (r.state === 'available') {
    opts.message = `Version ${r.version} is available (you have ${app.getVersion()}).`;
    opts.detail = 'Open the release page to download it, then replace the app.';
    opts.buttons = ['Open release page', 'Later'];
  } else if (r.state === 'up-to-date') opts.message = `You are up to date (${app.getVersion()}).`;
  else if (r.state === 'error') { opts.type = 'warning'; opts.message = 'Could not check for updates.'; opts.detail = r.error; }
  else {
    opts.type = 'warning';
    opts.message = r.state === 'denied' ? 'GitHub refused the update token.' : 'No update token set.';
    opts.detail = `The repo is private, so checking needs a read-only GitHub token (fine-grained, this repo only, "Contents: read").
Save it as a single line in:
${tokenPath()}`;
  }
  const { response } = await (win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts));
  if (r.state === 'available' && response === 0 && /^https:\/\/github\.com\//.test(r.url || '')) shell.openExternal(r.url);
}
function buildMenu() {
  const mac = process.platform === 'darwin';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(mac ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    { label: 'Help', submenu: [{ label: 'Check for Updates…', click: () => runUpdateCheck(true) }] },
  ]));
}

// ---- window ----
let win = null;
function createWindow() {
  config = loadConfig();
  atem.start(config.atem.ip);
  rebuildClients();
  // this app only ever shows its own page: no permission prompts (camera/mic/location...), no pop-ups, no navigation away
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  // Automated tests set PTZ_TEST_HIDDEN=1 so they never put a window (or a Dock icon) on the desktop.
  const hidden = process.env.PTZ_TEST_HIDDEN === '1';
  if (hidden && process.platform === 'darwin' && app.dock) app.dock.hide();
  win = new BrowserWindow({
    width: 1500, height: 900, backgroundColor: '#111', show: !hidden,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: false, backgroundThrottling: !hidden },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => { if (url !== win.webContents.getURL()) e.preventDefault(); });
  win.on('closed', () => { win = null; });
  win.loadFile(path.join(__dirname, 'index.html'));
  buildMenu();
  if (!hidden && app.isPackaged) runUpdateCheck(false);
}

// Only one copy of the app may run: two copies would fight over each camera's single VISCA connection and double the polling.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  app.whenReady().then(createWindow);
}
app.on('window-all-closed', () => { visca.forEach((v) => v.close()); streams.stopAll(); app.quit(); });
app.on('before-quit', () => { streams.stopAll(); atem.stop(); });
