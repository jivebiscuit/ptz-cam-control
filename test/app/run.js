// App-level tests: runs the REAL app (window, renderer, main process, validators) with the network faked, so it needs no
// cameras and can never touch one. Settings go to a throwaway folder. Run with: npm run test:app
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const { EventEmitter } = require('node:events');

const { app, BrowserWindow } = require('electron');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'soth-apptest-'));
app.setPath('userData', userData);                 // before main.js asks for the single-instance lock
process.env.SOTH_FFMPEG = path.join(userData, 'no-such-ffmpeg'); // no video processes: tiles just show NO SIGNAL
process.env.SOTH_TEST_HIDDEN = '1';                               // never put a window or Dock icon on the desktop

// ---- fake network: camera WRITES are recorded and "succeed"; everything else behaves like an unreachable camera ----
const writes = []; // { cam: 0-3, what: 'home' | 'up' | 'ptzstop' | 'visca:81 01 ...' | ... }
const camOf = (host) => Math.max(0, Number(String(host).split('.').pop()) - 200);
const isWrite = (m, p) => /post_image_value|ptzcmd|post_visca/.test(p) || (m === 'POST' && /api\/v1\/control\/track/.test(p));
const label = (m, p) => (/ptzcmd&/.test(p) ? p.split('ptzcmd&')[1] : /post_image_value&/.test(p) ? 'image:' + p.split('post_image_value&')[1] : m === 'POST' && /track/.test(p) ? 'track' : p);
function fakeRequest(onResponse, bodyText, fail) {
  const req = new EventEmitter();
  req.write = () => {}; req.destroy = () => {};
  req.end = () => setImmediate(() => {
    if (fail) return req.emit('error', new Error('offline'));
    const res = new EventEmitter(); res.statusCode = 200; res.resume = () => {};
    onResponse(res);
    setImmediate(() => { if (bodyText) res.emit('data', Buffer.from(bodyText)); res.emit('end'); });
  });
  return req;
}
http.get = (o, cb) => {
  const p = o.path || '';
  const w = isWrite('GET', p);
  if (w) writes.push({ cam: camOf(o.host), what: label('GET', p) });
  const r = fakeRequest(cb, '', !w); r.end(); return r;
};
http.request = (o, cb) => {
  const p = o.path || '', m = o.method || 'GET', w = isWrite(m, p);
  if (w) writes.push({ cam: camOf(o.host), what: label(m, p) });
  return fakeRequest(cb, w ? '{"msg":"operate success"}' : '', !w);
};
const { ViscaClient } = require('../../src/visca');
ViscaClient.prototype.send = async function (hex) { writes.push({ cam: camOf(this.host), what: 'visca:' + hex }); };
ViscaClient.prototype.inquire = async function () { throw new Error('offline'); };

require('../../src/main.js');

// ---- tiny test harness ----
const results = [];
const check = (cond, name) => { results.push({ ok: !!cond, name }); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  let win, js;
  try {
    for (let i = 0; i < 50 && !(win = BrowserWindow.getAllWindows()[0]); i++) await wait(100);
    const errors = [];
    // if the window ever goes away mid-run, fail at once instead of waiting for the overall time-out
    win.on('closed', () => { console.log('FAIL  the app window closed during the test'); app.exit(3); });
    win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message); });
    win.setSize(1500, 900);
    js = (c) => win.webContents.executeJavaScript(c + ';');
    await wait(3500); // let the page start
    check(win.isVisible() === false, 'the test window is hidden (nothing appears on the desktop)');
    await js(`window.confirm = () => true; 0`);
    const sent = async (fn) => { writes.length = 0; await fn(); await wait(180); return writes.map((w) => w.what); };
    const key = (type, k, extra) => js(`document.activeElement.dispatchEvent(new KeyboardEvent('${type}', { key: ${JSON.stringify(k)}, bubbles: true, ${extra || ''} })); 0`);
    const press = async (k, extra) => { await key('keydown', k, extra); await key('keyup', k, extra); };
    const focus = (sel) => js(`document.querySelector(${JSON.stringify(sel)}).focus(); 0`);
    const click = (sel) => js(`document.querySelector(${JSON.stringify(sel)}).click(); 0`);
    const none = (a) => a.length === 0;

    console.log('\n-- keyboard shortcuts --');
    await js(`document.activeElement.blur(); 0`);
    check((await sent(() => press('h'))).join() === 'home', 'H sends Home');
    check(/^up&\d+&\d+,ptzstop&1&1$/.test((await sent(async () => { await key('keydown', 'ArrowUp'); await key('keyup', 'ArrowUp'); })).join()), 'arrow up moves, releasing it stops');
    check((await sent(async () => { await key('keydown', '='); await key('keyup', '='); })).join().match(/zoomin&\d,zoomstop/), 'zoom key zooms and stops');
    check((await sent(async () => { await key('keydown', '+', 'shiftKey: true'); await key('keyup', '=', 'shiftKey: false'); })).join().match(/zoomin&\d,zoomstop/), 'Shift+= released as "=" still stops the zoom');
    check(none(await sent(async () => { await press('h', 'metaKey: true'); await press('h', 'ctrlKey: true'); })), 'Cmd+H / Ctrl+H are ignored');
    await click('#settingsBtn'); await focus('#camFields input');
    check(none(await sent(async () => { for (const k of ['N', 'o', 'r', 't', 'h', ' ', '2', '-', '=']) await press(k); })), 'typing a camera name in Settings sends nothing');
    await click('#cancelCfg'); await js(`document.activeElement.blur(); 0`);
    await click('#drawerBtns button[data-drawer="drawer-exposure"]'); await wait(300);
    await focus('#aeMode'); check(none(await sent(async () => { await press('ArrowDown'); await press('ArrowUp'); })), 'arrow keys on a dropdown do not move the camera');
    await focus('#speed'); check(none(await sent(async () => { await press('ArrowRight'); })), 'arrow keys on a slider do not move the camera');
    await js(`document.activeElement.blur(); 0`);
    check(/^left&\d+&\d+,ptzstop&1&1$/.test((await sent(async () => { await key('keydown', 'ArrowLeft'); await js(`window.dispatchEvent(new Event('blur')); 0`); })).join()), 'losing window focus while a key is held stops the camera');
    check((await js(`(() => { const s = document.querySelector('#aeMode'); s.focus(); s.dispatchEvent(new Event('change', { bubbles: true })); return document.activeElement.tagName; })()`)) === 'BODY', 'a dropdown gives up keyboard focus after use');

    console.log('\n-- the right camera gets the command --');
    await js(`document.querySelectorAll('.cell')[2].click(); 0`); await wait(200);
    check((await js(`document.querySelector('#selName').textContent`)).includes('North'), 'clicking tile 3 selects North');
    const rec = await sent(async () => { await js(`document.querySelectorAll('#presets button')[3].dispatchEvent(new MouseEvent('click', { bubbles: true })); 0`); });
    check(rec.join() === 'poscall&3' && writes[0].cam === 2, 'preset 3 recalls preset 3 (not preset 0) on the selected camera');
    const sav = await sent(async () => { await js(`document.querySelectorAll('#presets button')[3].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })); 0`); });
    check(sav.join() === 'posset&3', 'shift-click saves to preset 3');
    const trk = await sent(async () => { await click('#trkQuick button[data-mode="tracking"]'); });
    check(trk.length === 1 && writes[0].cam === 2, 'the tracking quick row writes to the selected camera only (one camera, one write)');
    check((await js(`!document.querySelector('#drawer-tracking .scopeChk')`)), 'the Tracking drawer has no "apply to all cameras" switch');

    console.log('\n-- malformed commands are refused before they can reach a camera --');
    const refuse = async (ch, i, a, why) => {
      writes.length = 0; const r = await js(`window.api.${ch}(${i}, ${JSON.stringify(a)})`);
      check(r && r.ok === false && /must be|refused|malformed|unknown|one of|whole number/.test(r.error || '') && writes.length === 0, `refused: ${why}`);
    };
    await refuse('http', 0, { type: 'image', name: 'reboot', value: 1 }, 'a setting name that is not on the list');
    await refuse('http', 0, { type: 'image', name: 'luminance', value: 999 }, 'a value out of range');
    await refuse('http', 0, { type: 'image', name: 'wbmode', value: 4 }, 'a white balance mode that does not exist');
    await refuse('http', 0, { type: 'move', dir: 'sideways', pan: 5, tilt: 5 }, 'an unknown direction');
    await refuse('http', 0, { type: 'move', dir: 'up', pan: 99, tilt: 5 }, 'a pan speed that is too high');
    await refuse('http', 0, { type: 'presetRecall', n: 300 }, 'preset 300');
    await refuse('http', 0, { type: 'presetSet', n: '1; reboot' }, 'a preset number with extra text');
    await refuse('http', 0, { type: 'trackSet', body: { trackSens: 'high' } }, 'a tracking field that does not exist on this camera');
    await refuse('http', 9, { type: 'home' }, 'camera number 9');
    await refuse('http', 0, null, 'no command at all');
    await refuse('visca', 0, { type: 'move', dir: '__proto__', pan: 5, tilt: 5 }, 'a VISCA direction of __proto__');
    await refuse('visca', 0, { type: 'aeMode', mode: 7 }, 'an exposure mode that does not exist');
    await refuse('visca', 0, { type: 'focusLock', on: 1 }, 'focus lock given 1 instead of true/false');

    console.log('\n-- settings --');
    const cfgFile = path.join(userData, 'config.json');
    const hash = () => (fs.existsSync(cfgFile) ? crypto.createHash('sha1').update(fs.readFileSync(cfgFile)).digest('hex') : 'absent');
    const before = hash();
    for (const [c, why] of [[{ cameras: [{ name: 'A', ip: '300.1.1.1' }] }, 'an impossible IP'], [{ cameras: [{ name: 'A', ip: '1.2.3' }] }, 'a shorthand IP'], [{ cameras: [{ name: '', ip: '1.2.3.4' }] }, 'an empty name'], [{ cameras: [] }, 'no cameras']]) {
      const r = await js(`window.api.setConfig(${JSON.stringify(c)})`);
      check(r.ok === false && !!r.error, `settings refused: ${why}`);
    }
    check(hash() === before, 'nothing was written to the settings file by the refused saves');
    await click('#settingsBtn');
    await js(`document.querySelectorAll('#camFields .cf')[1].children[1].value = '999.1.1.1'; document.querySelector('#saveCfg').click(); 0`); await wait(500);
    check(!(await js(`document.querySelector('#dlg').hidden`)) && (await js(`document.querySelector('#cfgErr').textContent`)).includes('999.1.1.1'), 'a bad address in the Settings dialog keeps it open and shows why');
    await click('#cancelCfg');

    console.log('\n-- camera names are text, never markup --');
    await js(`(() => { cfg.cameras[0].name = '<img src=x onerror="window.__xss=1">"\\'&<b>'; buildTiles(); renderAdv(); renderTrack(); renderIsp(); renderImg(); renderColor(); openSettings(); })()`); await wait(400);
    check((await js(`window.__xss`)) === undefined && (await js(`document.querySelectorAll('img[src="x"], .tag img, .tag b, .per img, .per b').length`)) === 0, 'a name containing markup does not run or create elements');
    check((await js(`document.querySelector('.cell .tag').textContent`)).includes('<img src=x onerror="window.__xss=1">'), 'it is shown literally, as typed');
    await click('#cancelCfg');

    console.log('\n-- the window stays on the app --');
    const wins = BrowserWindow.getAllWindows().length, url = win.webContents.getURL();
    const opened = await js(`(() => { try { return String(window.open('https://example.com')); } catch (e) { return 'threw'; } })()`);
    await js(`(() => { try { location.href = 'https://example.com'; } catch (e) {} })()`); await wait(1200);
    check(opened === 'null' && BrowserWindow.getAllWindows().length === wins, 'window.open() is blocked');
    check(win.webContents.getURL() === url, 'navigating away is blocked');
    const prefs = win.webContents.getLastWebPreferences();
    check(prefs.sandbox === true && prefs.contextIsolation === true && prefs.nodeIntegration === false, 'the renderer is sandboxed');
    check((await js(`navigator.mediaDevices.getUserMedia({ video: true }).then(() => 'granted', (e) => e.name)`)) !== 'granted', 'camera/microphone permission requests are refused');
    check((await js(`[...document.querySelectorAll('.cell.off')].length`)) === 4 && (await js(`document.querySelector('.cell .tile').dataset.why`)).includes('ffmpeg not found'), 'with no ffmpeg the tiles say NO SIGNAL and why');

    check(errors.length === 0, 'no errors in the page console' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  } catch (e) {
    check(false, 'test run crashed: ' + e.message);
  }
  if (win && !win.isDestroyed()) win.removeAllListeners('closed');
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch { /* best effort */ }
  app.exit(failed ? 1 : 0);
});
setTimeout(() => { console.log('FAIL  timed out'); app.exit(2); }, 90000);
