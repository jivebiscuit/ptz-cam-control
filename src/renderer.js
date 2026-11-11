const $ = (s) => document.querySelector(s);
let cfg, sel = 0, tileEls = [];
const state = { proto: 'http', locked: {} }; // locked[camIndex] — camera can't report lock state, so we track it

const setStatus = (m, err) => { const s = $('#status'); s.textContent = m; s.title = m; s.className = err ? 'err' : ''; };
// don't leave a clicked button focused (it would show a focus ring and react to Space/Enter)
document.addEventListener('mouseup', (e) => { const b = e.target.closest && e.target.closest('button'); if (b) b.blur(); });
// dropdowns, sliders, checkboxes and radios give up keyboard focus once you've used them, so the shortcuts work again
document.addEventListener('change', (e) => { const t = e.target; if (t && t.matches && t.matches('select, input[type=range], input[type=checkbox], input[type=radio]')) t.blur(); }, true);
const cam = (a, forceVisca) => (forceVisca || state.proto === 'visca' ? window.api.visca(sel, a) : window.api.http(sel, a))
  .then((r) => { if (!r.ok) setStatus(`${cfg.cameras[sel].name}: ${r.error}`, true); return r; });

// ---- multiview: live MJPEG from local ffmpeg-backed stream server ----
let streamBase = ''; // http://127.0.0.1:<port>/cam/<token>  (from the main process)
function buildTiles() {
  const mv = $('#multiview'); mv.innerHTML = ''; tileEls = [];
  cfg.cameras.forEach((c, i) => {
    const t = document.createElement('div'); t.className = 'cell off';
    t.innerHTML = `<div class="tile"><img alt=""><div class="tag">${i + 1} · ${esc(c.name)}<i>${esc(c.ip)}</i></div><div class="badges"><span class="trk"></span><span class="pimg"></span><span class="fmode"></span></div></div>
      <div class="cap"><div class="pos stale"><span class="pp">— no position —</span><span class="adv"></span></div><div class="exp"></div></div>`;
    const img = t.querySelector('img');
    img.addEventListener('error', () => setTimeout(() => { if (streamBase) img.src = `${streamBase}/${i}?t=${Date.now()}`; }, 1500));
    t.onclick = () => select(i);
    mv.appendChild(t); tileEls.push(t);
  });
  select(sel);
}
function attachStreams() {
  tileEls.forEach((t, i) => { t.querySelector('img').src = `${streamBase}/${i}?t=${Date.now()}`; });
}
async function watchStreams() {
  const [st, why] = await Promise.all([window.api.streamStatus(), window.api.streamErrors()]);
  tileEls.forEach((t, i) => {
    const wasOff = t.classList.contains('off'), off = !st[i];
    t.classList.toggle('off', off);
    t.querySelector('.tile').dataset.why = off ? why[i] || '' : ''; // reason shown under NO SIGNAL (e.g. ffmpeg missing)
    // A camera that just came back needs a fresh HTTP connection (old one may be dead)
    if (wasOff && !off) t.querySelector('img').src = `${streamBase}/${i}?t=${Date.now()}`;
  });
}
function renderLock() {
  tileEls.forEach((t, k) => {
    let l = t.querySelector('.lock');
    if (state.locked[k] && !l) { l = document.createElement('div'); l.className = 'lock'; l.textContent = 'FOCUS LOCKED'; t.querySelector('.badges').appendChild(l); syncBlink(l, true); }
    else if (!state.locked[k] && l) l.remove();
  });
  const b = $('#afLock'), on = !!state.locked[sel];
  b.classList.toggle('on', on); b.textContent = on ? '🔒 Locked' : '🔓 Lock';
}
function select(i) {
  sel = i;
  tileEls.forEach((t, k) => t.classList.toggle('sel', k === i));
  renderLock();
  $('#selName').textContent = `${i + 1} · ${cfg.cameras[i].name}`;
  document.querySelectorAll('.dCam').forEach((el) => (el.textContent = `${i + 1} · ${cfg.cameras[i].name}`)); // drawer headers
  pollAdv(); // refresh the drawers' values for the newly selected camera
  setStatus('Ready');
}

// ---- PTZ ----
const speed = () => +$('#speed').value;
// HTTP pan 1-24, tilt 1-20 ; slider 1-20 maps directly
const panSp = () => Math.min(24, Math.round(speed() * 1.2)), tiltSp = () => speed();
const move = (dir) => cam({ type: 'move', dir, pan: panSp(), tilt: tiltSp() });
const stopMove = () => cam({ type: 'move', dir: 'stop', pan: 1, tilt: 1 });
const zoomSp = () => Math.max(1, Math.min(7, Math.round(speed() / 3)));
const focusSp = () => Math.max(1, Math.min(7, Math.round(speed() / 3)));

// HTTP zoom/focus speeds are 1-7; VISCA variable uses 0-7 — both accepted via zoomSp.
function hold(el, down, up) {
  const d = (e) => { e.preventDefault(); el.classList.add('on'); down(); };
  const u = () => { if (el.classList.contains('on')) { el.classList.remove('on'); up(); } };
  el.addEventListener('mousedown', d); window.addEventListener('mouseup', u); el.addEventListener('mouseleave', u);
}
function initControls() {
  document.querySelectorAll('.pad button').forEach((b) => {
    const d = b.dataset.d;
    if (d === 'home') b.onclick = () => cam({ type: 'home' });
    else hold(b, () => move(d), stopMove);
  });
  document.querySelectorAll('[data-z]').forEach((b) => hold(b,
    () => cam({ type: 'zoom', dir: b.dataset.z, speed: zoomSp() }), () => cam({ type: 'zoom', dir: 'stop' })));
  document.querySelectorAll('[data-f]').forEach((b) => hold(b,
    () => cam({ type: 'focus', dir: b.dataset.f, speed: focusSp() }), () => cam({ type: 'focus', dir: 'stop' })));
  $('#afAuto').onclick = () => { cam({ type: 'focusAuto' }, true); setTimeout(pollAdv, 500); };
  $('#afManual').onclick = () => { cam({ type: 'focusManual' }, true); setTimeout(pollAdv, 500); };
  $('#afLock').onclick = async () => {
    const i = sel, on = !state.locked[i];
    const r = await window.api.visca(i, { type: 'focusLock', on });
    if (!r.ok) return setStatus(`${cfg.cameras[i].name}: ${r.error}`, true);
    state.locked[i] = on; renderLock(); setStatus(`${cfg.cameras[i].name}: focus ${on ? 'LOCKED' : 'unlocked'}`); setTimeout(pollAdv, 500);
  };
  $('#afPush').onclick = () => cam({ type: 'focusOnePush' }, true);
  $('#speed').oninput = () => ($('#speedVal').textContent = speed());
  document.querySelectorAll('input[name=proto]').forEach((r) => (r.onchange = () => (state.proto = r.value)));

  // presets 0-9 (camera preset numbers 0..9)
  const P = $('#presets');
  for (let n = 0; n < 10; n++) {
    const b = document.createElement('button'); b.textContent = n; let timer, longed = false;
    const save = () => { cam({ type: 'presetSet', n }); setStatus(`Saved preset ${n} on ${cfg.cameras[sel].name}`); };
    b.onmousedown = () => { longed = false; timer = setTimeout(() => { longed = true; save(); }, 800); };
    b.onmouseup = () => clearTimeout(timer);
    b.onclick = (e) => { if (longed) return; if (e.shiftKey) save(); else cam({ type: 'presetRecall', n }); };
    P.appendChild(b);
  }

  // keyboard: 1-4 select a camera, arrows move, +/- zoom, space stop, H home.
  // Shortcuts only run when you are NOT typing or using a form control, with no Ctrl/Cmd/Alt held, and with the
  // Settings dialog closed; otherwise e.g. typing "North" in a name box would send Home to a camera.
  const keys = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
  // '+'/'=' and '-'/'_' are the same physical keys, so a key can be released as the other character if Shift is let go first
  const actionOf = (k) => (keys[k] ? k : k === '+' || k === '=' ? 'zoomin' : k === '-' || k === '_' ? 'zoomout' : null);
  const heldKeys = new Set(); // only actions WE started: their release (or the window losing focus) sends the matching stop
  const inForm = (el) => !!el && (['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) || el.isContentEditable);
  const stopHeld = () => { if (!heldKeys.size) return; const moved = [...heldKeys].some((k) => keys[k]), zoomed = heldKeys.has('zoomin') || heldKeys.has('zoomout'); heldKeys.clear(); if (moved) stopMove(); if (zoomed) cam({ type: 'zoom', dir: 'stop' }); };
  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (inForm(e.target) || !$('#dlg').hidden) return;
    const act = actionOf(e.key);
    if (/^[1-4]$/.test(e.key) && cfg.cameras[+e.key - 1]) return select(+e.key - 1);
    if (keys[e.key]) { e.preventDefault(); heldKeys.add(e.key); move(keys[e.key]); }
    else if (act === 'zoomin') { heldKeys.add(act); cam({ type: 'zoom', dir: 'in', speed: zoomSp() }); }
    else if (act === 'zoomout') { heldKeys.add(act); cam({ type: 'zoom', dir: 'out', speed: zoomSp() }); }
    else if (e.key === ' ') { e.preventDefault(); stopMove(); }
    else if (e.key.toLowerCase() === 'h') cam({ type: 'home' });
  });
  window.addEventListener('keyup', (e) => {
    const act = actionOf(e.key);
    if (!act || !heldKeys.has(act)) return;
    heldKeys.delete(act);
    if (keys[act]) stopMove(); else cam({ type: 'zoom', dir: 'stop' });
  });
  window.addEventListener('blur', stopHeld); // e.g. Cmd-Tab while holding an arrow: the key-up would never arrive
}

// ---- settings ----
function openSettings() {
  const f = $('#camFields'); f.innerHTML = '';
  cfg.cameras.forEach((c, i) => {
    const d = document.createElement('div'); d.className = 'cf';
    const nameIn = document.createElement('input'); nameIn.value = c.name; nameIn.maxLength = 24; nameIn.setAttribute('aria-label', `Camera ${i + 1} name`);
    const ipIn = document.createElement('input'); ipIn.value = c.ip; ipIn.maxLength = 253; ipIn.setAttribute('aria-label', `Camera ${i + 1} address`);
    d.append(nameIn, ipIn); f.appendChild(d);
  });
  $('#cfgErr').hidden = true;
  $('#dlg').hidden = false;
}
$('#settingsBtn').onclick = openSettings;
$('#cancelCfg').onclick = () => ($('#dlg').hidden = true);
$('#saveCfg').onclick = async () => {
  const cams = [...document.querySelectorAll('.cf')].map((d) => ({ name: d.children[0].value.trim(), ip: d.children[1].value.trim() }));
  const r = await window.api.setConfig({ cameras: cams });
  if (!r.ok) { $('#cfgErr').textContent = r.error; $('#cfgErr').hidden = false; return; } // keep the dialog open so it can be fixed
  cfg = r.config;
  $('#dlg').hidden = true; streamBase = await window.api.startStreams(); buildTiles(); attachStreams();
};

(async () => {
  cfg = await window.api.getConfig();
  initControls(); buildTiles();
  streamBase = await window.api.startStreams(); attachStreams();
  setInterval(watchStreams, 1000);
})();

// ---- scale (measured on an F64: pan ±2448, tilt -432..+1296, zoom 0..16384) ----
const UNITS_PER_DEG = 14.4;                 // 2448/170°, 1296/90°, 432/30°
const ZOOM_MAX = 16384, ZOOM_X_MAX = 30;
// Straight-line estimate only: real optical zoom is nonlinear in position. Replace with a lookup table once calibrated.
const zoomX = (z) => 1 + (ZOOM_X_MAX - 1) * z / ZOOM_MAX;
// units -> "R 12.3°" / "L 4.0°" (pan), "U 5.0°" / "D 2.0°" (tilt)
const side = (u, pos, neg) => { const d = Math.abs(u / UNITS_PER_DEG).toFixed(1); return d === '0.0' ? '0.0°' : `${u > 0 ? pos : neg} ${d}°`; };
const fmtLR = (u) => side(u, 'R', 'L'), fmtUD = (u) => side(u, 'U', 'D');

// Flashing chips (tracking/framing, manual focus) all use a 1 s cycle; give each the same wall-clock phase so they flip together
function syncBlink(el, active) {
  if (!active) { el.dataset.sync = ''; el.style.animationDelay = ''; return; }
  if (!el.dataset.sync) { el.style.animationDelay = `-${Date.now() % 1000}ms`; el.dataset.sync = '1'; }
}

// ---- live position readout (VISCA, every 500 ms, each camera independent; dims when a reply is late) ----
const lastPos = [], posT = [], posBusy = [];
function renderPos() {
  const now = Date.now();
  tileEls.forEach((t, i) => {
    const p = lastPos[i], el = t.querySelector('.pos .pp'); if (!el) return;
    el.textContent = p ? `${fmtLR(p.pan)}  ${fmtUD(p.tilt)}  ≈${zoomX(p.zoom).toFixed(1)}x` : '— no position —';
    t.querySelector('.pos').classList.toggle('stale', !p || now - (posT[i] || 0) > 1500);
  });
  const p = lastPos[sel], R = $('#readout');
  R.classList.toggle('stale', !p || now - (posT[sel] || 0) > 1500);
  $('#rPan').textContent = p ? fmtLR(p.pan) : '—'; $('#rTilt').textContent = p ? fmtUD(p.tilt) : '—';
  $('#rZoom').textContent = p ? `≈${zoomX(p.zoom).toFixed(1)}x` : '—';
}
async function pollPositions() {
  if (!cfg) return;
  await Promise.all(cfg.cameras.map((_, i) => pollOne(posBusy, lastPos, posT, i, () => window.api.visca(i, { type: 'position' }), 4000).then(renderPos)));
}
setInterval(pollPositions, 500);

// ---- exposure (selected camera only, once a second) ----
// Raw VISCA step indexes: the docs give no F-number/shutter/gain tables. Iris 17 (0x11) is the widest on these cameras.
// F-stop per iris step, from the camera's web UI list (F1.8 = step 17 confirmed by test; steps below counted down in order, F11 = 6, 0 = Close; 1-5 not offered by the web UI).
const IRIS_F = { 17: 'F1.8', 16: 'F2.0', 15: 'F2.4', 14: 'F2.8', 13: 'F3.4', 12: 'F4.0', 11: 'F4.8', 10: 'F5.6', 9: 'F6.8', 8: 'F8.0', 7: 'F9.6', 6: 'F11', 0: 'Close' };
// Shutter per step, from the camera's web UI list. 1/30 = step 1 confirmed (current camera value); rest counted up in order.
const SHUTTER = ['1/30','1/50','1/60','1/100','1/125','1/200','1/250','1/350','1/500','1/725','1/1000','1/1500','1/2000','1/3000','1/4000','1/6000','1/10000'];
const shutterLabel = (v) => SHUTTER[v - 1] || `step ${v}`;
const irisLabel = (v) => IRIS_F[v] || `step ${v}`;
const EX_HINT = { 0: 'Auto: camera controls everything.', 3: 'Manual: iris, shutter and gain all adjustable.', 10: 'Shutter priority: shutter adjustable; iris/gain are automatic.', 11: 'Iris priority: iris adjustable; shutter/gain are automatic.', 13: 'Bright: auto with brightness bias.' };
const lastExp = [];
const AE_SHORT = { 0: 'Auto', 3: 'Manual', 10: 'S-Pri', 11: 'I-Pri', 13: 'Bright' };
// Exposure now comes from the camera's HTTP state (already polled for the other readouts) instead of 5 VISCA queries
// per camera per second. exposure_mode/iris/shutter/manual_gain/gain_limit are the same values VISCA reports.
const AE_NAMES = { 0: 'Auto', 3: 'Manual', 10: 'Shutter priority', 11: 'Iris priority', 13: 'Bright' };
function deriveExposure() {
  cfg.cameras.forEach((_, i) => {
    const a = lastAdv[i];
    lastExp[i] = a ? { ae: +a.exposure_mode, aeName: AE_NAMES[+a.exposure_mode] || String(a.exposure_mode), iris: +a.iris, shutter: +a.shutter, gain: +a.manual_gain, gainLimit: +a.gain_limit } : null;
  });
}
function renderExposure() {
  tileEls.forEach((t, i) => {
    const el = t.querySelector('.exp'), e = lastExp[i]; if (!el) return;
    el.textContent = e ? `${irisLabel(e.iris)}  ${shutterLabel(e.shutter)}  gain ${e.gain} (max ${e.gainLimit})  ${AE_SHORT[e.ae] || e.aeName}` : '';
  });
  const e = lastExp[sel];
  $('#exIris').textContent = e ? irisLabel(e.iris) : '—';
  if (e && document.activeElement !== $('#irisSel')) $('#irisSel').value = IRIS_F[e.iris] ? e.iris : '';
  $('#exShutter').textContent = e ? shutterLabel(e.shutter) : '—';
  if (e && document.activeElement !== $('#shutSel')) $('#shutSel').value = SHUTTER[e.shutter - 1] ? e.shutter : '';
  $('#exGain').textContent = e ? e.gain : '—';
  if (e && document.activeElement !== $('#aeMode')) $('#aeMode').value = e.ae;
  if (e && document.activeElement !== $('#gainLim')) { $('#gainLim').value = e.gainLimit; $('#gainLimV').textContent = e.gainLimit; }
  $('#exHint').textContent = e ? EX_HINT[e.ae] || '' : '';
}
async function pollExposure() { await pollAdv(); }
$('#aeMode').onchange = () => { sendAll({ type: 'aeMode', mode: +$('#aeMode').value }); setTimeout(pollExposure, 300); };
document.querySelectorAll('[data-ex]').forEach((b) => (b.onclick = async () => {
  const [type, dir] = b.dataset.ex.split(',');
  await sendAll({ type, dir });
  setTimeout(pollExposure, 250);
}));

// direct F-stop select
Object.keys(IRIS_F).map(Number).sort((a, b) => b - a).forEach((v) => {
  const o = document.createElement('option'); o.value = v; o.textContent = IRIS_F[v]; $('#irisSel').appendChild(o);
});
$('#irisSel').onchange = async () => {
  const v = +$('#irisSel').value; if ($('#irisSel').value === '') return;
  await sendAll({ type: 'iris', value: v });
  setTimeout(pollExposure, 300);
};

SHUTTER.forEach((l, k) => { const o = document.createElement('option'); o.value = k + 1; o.textContent = l; $('#shutSel').appendChild(o); });
$('#shutSel').onchange = async () => {
  if ($('#shutSel').value === '') return;
  await sendAll({ type: 'shutter', value: +$('#shutSel').value });
  setTimeout(pollExposure, 300);
};

// ---- advanced drawer ----
let scopeAllFlag = false;
const scopeAll = () => scopeAllFlag;
const targets = () => (scopeAll() ? cfg.cameras.map((_, i) => i) : [sel]);
// send a VISCA command to the selected camera, or to all cameras when "All cameras" is on
async function sendAll(a) {
  const rs = await Promise.all(targets().map((i) => window.api.visca(i, a)));
  const bad = rs.map((r, k) => (r.ok ? null : `${cfg.cameras[targets()[k]].name}: ${r.error}`)).filter(Boolean);
  if (bad.length) setStatus(bad.join(' · '), true);
  return rs;
}
// same, for the HTTP image settings (meter / gainLimit / drc)
async function setImage(name, value) {
  const rs = await Promise.all(targets().map((i) => window.api.http(i, { type: 'image', name, value })));
  const bad = rs.map((r, k) => (r.ok ? null : `${cfg.cameras[targets()[k]].name}: ${r.error}`)).filter(Boolean);
  setTimeout(pollAdv, 400);
  setStatus(bad.length ? bad.join(' · ') : `${name} = ${value} → ${scopeAll() ? 'all cameras' : cfg.cameras[sel].name}`, !!bad.length);
}
// ---- drawers: generic. Each <aside class="drawer" data-title> gets a button, header and "apply to all" switch. ----
const drawers = [...document.querySelectorAll('.drawer')];
function renderScope() {
  document.querySelectorAll('.scopeChk').forEach((c) => (c.checked = scopeAllFlag));
  document.querySelectorAll('.scopeWarn').forEach((w) => (w.hidden = !scopeAllFlag));
}
function openDrawer(id) {
  drawers.forEach((d) => { const open = d.id === id; d.classList.toggle('closed', !open); d.setAttribute('aria-hidden', String(!open)); });
  document.querySelectorAll('#drawerBtns button').forEach((b) => b.classList.toggle('on', b.dataset.drawer === id));
  $('#app').classList.toggle('has-drawer', !!id); // video grid shrinks to make room
  scopeAllFlag = false; renderScope(); // never carry bulk mode across a drawer open/close/switch
}
drawers.forEach((d) => {
  const title = d.dataset.title;
  const noScope = d.dataset.noscope !== undefined; // e.g. Tracking: never applied to more than one camera
  d.insertAdjacentHTML('afterbegin', `<header><h3>${title} — <span class="dCam">—</span></h3><button class="dClose" title="Close (Esc)">✕</button></header>` + (noScope ? '' : `
    <label class="row scope"><input type="checkbox" class="scopeChk"> Apply changes to all cameras</label>
    <div class="scopeWarn" hidden>Changes below go to ALL cameras.</div>`));
  d.querySelector('.dClose').onclick = () => openDrawer(null);
  const chk = d.querySelector('.scopeChk'); if (chk) chk.onchange = (e) => { scopeAllFlag = e.target.checked; renderScope(); };
  const b = document.createElement('button'); b.textContent = title; b.dataset.drawer = d.id; b.title = `${title} controls`;
  if (d.dataset.accent) { const v = `var(--c-${d.dataset.accent})`; d.style.setProperty('--accent', v); b.style.setProperty('--accent', v); }
  b.onclick = () => openDrawer(d.classList.contains('closed') ? d.id : null);
  $('#drawerBtns').appendChild(b);
});
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') openDrawer(null); });
$('#meterSel').onchange = () => { const v = $('#meterSel').value; if (v !== '') setImage('meter', v); };
$('#gainLim').oninput = () => ($('#gainLimV').textContent = $('#gainLim').value);
$('#gainLim').onchange = () => setImage('gainLimit', $('#gainLim').value);
$('#drc').oninput = () => ($('#drcV').textContent = $('#drc').value);
$('#drc').onchange = () => setImage('drc', $('#drc').value);
$('#flickerSel').onchange = async () => { const v = $('#flickerSel').value; if (v === '') return; const rs = await sendAll({ type: 'flicker', value: +v }); if (rs.every((r) => r.ok)) setStatus('anti-flicker set'); setTimeout(pollAdv, 400); };

// ---- copy selected camera's exposure settings to the other cameras ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function refreshExp() { await refreshAdv(); }
$('#copyAll').onclick = async () => {
  const src = sel, e = lastExp[src];
  if (!e) return setStatus(`${cfg.cameras[src].name}: no exposure data yet`, true);
  const others = cfg.cameras.map((_, i) => i).filter((i) => i !== src);
  const manual = e.ae === 3;
  const fields = ['ae', ...(manual || e.ae === 10 ? ['shutter'] : []), ...(manual || e.ae === 11 ? ['iris'] : []), ...(manual ? ['gain'] : []), 'gainLimit'];
  const plan = [`Mode: ${e.aeName}`];
  if (fields.includes('shutter')) plan.push(`Shutter: ${shutterLabel(e.shutter)}`);
  if (fields.includes('iris')) plan.push(`Iris: ${irisLabel(e.iris)}`);
  if (fields.includes('gain')) plan.push(`Gain: step ${e.gain}`);
  plan.push(`Gain limit: ${e.gainLimit}`);
  const names = others.map((i) => cfg.cameras[i].name).join(', ');
  if (!confirm(`Copy from ${cfg.cameras[src].name} to ${names}?\n\n${plan.join('\n')}\n\n(Takes a few seconds: the cameras ignore changes just after a mode switch, so it waits and retries. Meter, DRC, flicker and image settings are not copied here.)`)) return;
  const sendField = (i, f) => (f === 'ae' ? window.api.visca(i, { type: 'aeMode', mode: e.ae })
    : f === 'shutter' ? window.api.visca(i, { type: 'shutter', value: e.shutter })
    : f === 'iris' ? window.api.visca(i, { type: 'iris', value: e.iris })
    : f === 'gain' ? window.api.visca(i, { type: 'gain', value: e.gain })
    : window.api.http(i, { type: 'image', name: 'gainLimit', value: e.gainLimit }));
  const wrong = () => others.map((i) => {
    const x = lastExp[i]; if (!x) return { i, fs: fields.slice(), none: true };
    const fs = fields.filter((f) => (f === 'ae' ? x.ae !== e.ae : f === 'shutter' ? x.shutter !== e.shutter : f === 'iris' ? x.iris !== e.iris : f === 'gain' ? x.gain !== e.gain : x.gainLimit !== e.gainLimit));
    return { i, fs };
  }).filter((m) => m.fs.length);
  const copyBtn = $('#copyAll'); copyBtn.disabled = true;
  try {
    // 1) mode first, then wait until every camera reports it and the post-switch dead time has passed
    await refreshExp();
    const modeChange = others.some((i) => !lastExp[i] || lastExp[i].ae !== e.ae);
    if (modeChange) {
      setStatus('Copying… switching exposure mode');
      await Promise.all(others.map((i) => sendField(i, 'ae')));
      for (let k = 0; k < 12; k++) { await sleep(500); await refreshExp(); if (!wrong().some((m) => m.fs.includes('ae'))) break; }
      setStatus('Copying… waiting for the cameras to settle'); await sleep(4000);
    }
    // 2) the remaining values, then verify and retry only what didn't take (up to 2 retries)
    const rest = fields.filter((f) => f !== 'ae');
    setStatus('Copying… sending values');
    await Promise.all(others.map(async (i) => { for (const f of rest) await sendField(i, f); }));
    await sleep(1500); await refreshExp();
    let bad = wrong();
    for (let attempt = 1; bad.length && attempt <= 2; attempt++) {
      setStatus(`Copying… retrying ${bad.map((m) => cfg.cameras[m.i].name).join(', ')} (${attempt}/2)`);
      await Promise.all(bad.map(async (m) => { for (const f of m.fs) await sendField(m.i, f); }));
      await sleep(2500); await refreshExp(); bad = wrong();
    }
    if (bad.length) setStatus(`Copied, but still different → ${bad.map((m) => `${cfg.cameras[m.i].name}: ${m.none ? 'no reply' : m.fs.join(', ')}`).join(' · ')}`, true);
    else setStatus(`Copied from ${cfg.cameras[src].name} to ${names} ✔ (verified)`);
  } finally { copyBtn.disabled = false; }
};

// ---- Image drawer: luminance / saturation / contrast / sharpness / hue (HTTP, read back via get_image_conf) ----
const IMG_TIPS = {"bright": "Luminance \u2014 overall brightness of the picture, like a brightness knob. Higher makes the whole image lighter, lower makes it darker. It lifts or lowers everything at once, including the shadows, so it can wash out blacks if pushed too far. (This is separate from the exposure settings, which change how much light the camera captures.)", "saturation": "Saturation \u2014 how vivid the colors are. Low looks pale and washed out, heading toward grey. High looks rich and punchy, and too high makes skin tones orange and colors glow. 100% is the camera's neutral strength; range here is 60%\u2013200%.", "contrast": "Contrast \u2014 the difference between the darkest and lightest parts. Higher makes shadows deeper and highlights brighter for a punchier look, but can crush detail in dark areas and blow out bright ones. Lower looks flatter and softer.", "sharpness": "Sharpness \u2014 how crisp edges look, such as text, hair and fabric. Higher looks more detailed but too much adds halos around edges and makes noise more visible. Lower looks softer and more natural, which is often kinder to faces on video.", "hue": "Hue \u2014 rotates all the colors around the color wheel, shifting the overall color tint. Small changes move skin tones and wood toward warmer or cooler shades. If colors already look right, leave it alone."};
const IMG = [
  { key: 'bright', name: 'luminance', label: 'Luminance', max: 14, fmt: (v) => v },
  { key: 'saturation', name: 'saturation', label: 'Saturation', max: 14, fmt: (v) => `${60 + 10 * v}%` },
  { key: 'contrast', name: 'contrast', label: 'Contrast', max: 14, fmt: (v) => v },
  { key: 'sharpness', name: 'sharpness', label: 'Sharpness', max: 16, fmt: (v) => v }, // 0-16 verified on these cameras
  { key: 'hue', name: 'hue', label: 'Hue', max: 14, fmt: (v) => v },
];
const lastImg = [];
const imgBusy = [], imgT = [];
IMG.forEach((c) => {
  const d = document.createElement('div'); d.className = 'imgc'; d.id = 'img-' + c.key;
  d.innerHTML = `<div class="top"><span class="nm tip" title="${IMG_TIPS[c.key].replace(/"/g, '&quot;')}">${c.label}</span><button data-step="-1">−</button>
    <input type="range" min="0" max="${c.max}" step="1" value="0"><button data-step="1">+</button><b class="val">—</b></div><div class="per"></div>`;
  const r = d.querySelector('input'), val = d.querySelector('.val');
  r.oninput = () => (val.textContent = c.fmt(+r.value));
  r.onchange = () => { setImage(c.name, +r.value); setTimeout(pollImage, 400); };
  d.querySelectorAll('[data-step]').forEach((b) => (b.onclick = () => {
    const cur = lastImg[sel] ? lastImg[sel][c.key] : null; if (cur == null) return;
    const v = Math.max(0, Math.min(c.max, cur + +b.dataset.step));
    r.value = v; val.textContent = c.fmt(v);
    setImage(c.name, v); setTimeout(pollImage, 400);
  }));
  $('#imgControls').appendChild(d);
});
function renderImg() {
  IMG.forEach((c) => {
    const d = $('#img-' + c.key), r = d.querySelector('input'), mine = lastImg[sel] ? lastImg[sel][c.key] : null;
    if (mine != null && document.activeElement !== r) { r.value = mine; d.querySelector('.val').textContent = c.fmt(mine); }
    // short camera tag: first letter of its name if unique, else its number
    const tag = (i) => { const n = cfg.cameras[i].name.trim(); const ch = n[0] ? n[0].toUpperCase() : ''; return esc(ch && cfg.cameras.filter((x) => (x.name.trim()[0] || '').toUpperCase() === ch).length === 1 ? ch : String(i + 1)); };
    d.querySelector('.per').innerHTML = cfg.cameras.map((camera, i) => {
      const v = lastImg[i] ? lastImg[i][c.key] : null;
      return `<span title="${esc(camera.name)}" class="${v != null && mine != null && v !== mine ? 'diff' : ''}">${tag(i)} ${v == null ? '—' : c.fmt(v)}</span>`;
    }).join('');
  });
}
async function pollImage() {
  if (!cfg || $('#drawer-image').classList.contains('closed')) return;
  await Promise.all(cfg.cameras.map((_, i) => pollOne(imgBusy, lastImg, imgT, i, () => window.api.http(i, { type: 'imageConf' }), 9000).then(renderImg)));
}
setInterval(pollImage, 2000);
document.querySelectorAll('#drawerBtns button').forEach((b) => b.addEventListener('click', () => setTimeout(pollImage, 50)));
$('#copyImage').onclick = async () => {
  const src = sel, e = lastImg[src];
  if (!e) return setStatus(`${cfg.cameras[src].name}: no image data yet`, true);
  const others = cfg.cameras.map((_, i) => i).filter((i) => i !== src), names = others.map((i) => cfg.cameras[i].name).join(', ');
  const plan = IMG.map((c) => `${c.label}: ${c.fmt(e[c.key])}`).join('\n');
  if (!confirm(`Copy image settings from ${cfg.cameras[src].name} to ${names}?\n\n${plan}`)) return;
  const btn = $('#copyImage'); btn.disabled = true;
  try {
    const send = (i, keys) => Promise.all(keys.map((c) => window.api.http(i, { type: 'image', name: c.name, value: e[c.key] })));
    const wrongImg = () => others.map((i) => ({ i, cs: lastImg[i] ? IMG.filter((c) => lastImg[i][c.key] !== e[c.key]) : IMG.slice(), none: !lastImg[i] })).filter((m) => m.cs.length);
    setStatus('Copying image settings…');
    await Promise.all(others.map((i) => send(i, IMG)));
    await sleep(800); await pollImage();
    let bad = wrongImg();
    for (let attempt = 1; bad.length && attempt <= 2; attempt++) {
      await Promise.all(bad.map((m) => send(m.i, m.cs)));
      await sleep(1000); await pollImage(); bad = wrongImg();
    }
    if (bad.length) setStatus(`Copied, but still different → ${bad.map((m) => `${cfg.cameras[m.i].name}: ${m.none ? 'no reply' : m.cs.map((c) => c.label).join(', ')}`).join(' · ')}`, true);
    else setStatus(`Image settings copied from ${cfg.cameras[src].name} ✔ (verified)`);
  } finally { btn.disabled = false; }
};

// ---- live readback of everything the cameras report over HTTP (meter, DRC, flicker, gain limit, focus lock) ----
const METER_S = ['Avg', 'Ctr', 'Smt', 'Top'], FLICK = ['Off', '50 Hz', '60 Hz'];
const lastAdv = [];
const advBusyArr = [], advT = [];
const advBusyAny = () => advBusyArr.some(Boolean);
const camTag = (i) => { const n = cfg.cameras[i].name.trim(); const ch = n[0] ? n[0].toUpperCase() : ''; return esc(ch && cfg.cameras.filter((x) => (x.name.trim()[0] || '').toUpperCase() === ch).length === 1 ? ch : String(i + 1)); };
function perLine(id, get, fmt) {
  const mine = lastAdv[sel] ? get(lastAdv[sel]) : null;
  $('#' + id).innerHTML = cfg.cameras.map((camera, i) => {
    const v = lastAdv[i] ? get(lastAdv[i]) : null;
    return `<span title="${esc(camera.name)}" class="${v != null && mine != null && v !== mine ? 'diff' : ''}">${camTag(i)} ${v == null ? '—' : fmt(v)}</span>`;
  }).join('');
}
// Tile captions no longer list meter/DRC/flicker or image settings; instead an orange badge shows up only when a
// camera's auto-exposure tuning or image settings differ from the others. Reference = the value most cameras share (tie -> the selected camera).
const WB_MODES = { 0: 'Auto', 1: 'Indoor', 2: 'Outdoor', 3: 'One push', 5: 'Manual', 32: 'Color temp' };
const WB_S = { 0: 'Auto', 1: 'Indoor', 2: 'Outdoor', 3: '1-push', 5: 'Manual', 32: 'Temp' };
const tuneFmt = (v) => (v - 10 > 0 ? '+' : '') + (v - 10);
const kelvin = (i) => `${(25 + i) * 100}K`;
const inMode = (...ms) => (x) => ms.includes(+x.wb_mode); // gains/tuning/temp only matter in some modes
const TUNE = [
  { get: (x) => +x.meter, fmt: (v) => `Meter ${METER_S[v] ?? v}` },
  { get: (x) => +x.drc, fmt: (v) => `DRC ${v}` },
  { get: (x) => +x.antiflicker, fmt: (v) => FLICK[v] ?? v },
  { get: (x) => +x.gain_limit, fmt: (v) => `Gain limit ${v}` },
  // image settings (advanced config's `luminance` equals the image config's `bright`; verified on all four cameras)
  { get: (x) => +x.luminance, fmt: (v) => `Lum ${v}` },
  { get: (x) => +x.saturation, fmt: (v) => `Sat ${60 + 10 * v}%` },
  { get: (x) => +x.contrast, fmt: (v) => `Con ${v}` },
  { get: (x) => +x.sharpness, fmt: (v) => `Shp ${v}` },
  { get: (x) => +x.hue, fmt: (v) => `Hue ${v}` },
  // white balance (the numbers are only compared when they apply to the camera's mode)
  { get: (x) => +x.wb_mode, fmt: (v) => `WB ${WB_S[v] ?? v}` },
  { get: (x) => +x.rgain, fmt: (v) => `Red ${v}`, when: inMode(5) },
  { get: (x) => +x.bgain, fmt: (v) => `Blue ${v}`, when: inMode(5) },
  { get: (x) => +x.rgain_tuning, fmt: (v) => `R-tune ${tuneFmt(v)}`, when: inMode(0, 3, 32) },
  { get: (x) => +x.bgain_tuning, fmt: (v) => `B-tune ${tuneFmt(v)}`, when: inMode(0, 3, 32) },
  { get: (x) => +x.temperature, fmt: (v) => kelvin(v), when: inMode(32) },
];
function tuneReference(t) {
  const get = t.get, ok = (x) => x && (!t.when || t.when(x));
  const counts = new Map();
  lastAdv.filter(ok).forEach((x) => counts.set(get(x), (counts.get(get(x)) || 0) + 1));
  let best = null, top = 0, tie = false;
  counts.forEach((c, v) => { if (c > top) { best = v; top = c; tie = false; } else if (c === top) tie = true; });
  return tie && ok(lastAdv[sel]) ? get(lastAdv[sel]) : best;
}
function updateTuneBadges() {
  const ref = TUNE.map((t) => tuneReference(t));
  tileEls.forEach((t, i) => {
    const el = t.querySelector('.adv'), x = lastAdv[i]; if (!el) return;
    const diffs = x ? TUNE.map((tu, k) => ({ tu, k })).filter(({ tu, k }) => (!tu.when || tu.when(x)) && tu.get(x) !== ref[k]) : [];
    el.textContent = diffs.length ? '≠ ' + diffs.map(({ tu }) => tu.fmt(tu.get(x))).join(' · ') : '';
    el.title = diffs.length ? 'Differs from the other cameras (' + diffs.map(({ tu, k }) => tu.fmt(ref[k])).join(' · ') + ')' : '';
  });
}
function renderAdv() {
  deriveExposure(); renderExposure();
  // focus lock state comes from the camera, so it stays right after a reboot or a lock from another controller
  lastAdv.forEach((a, i) => { if (a && a.focus_mode_status != null) state.locked[i] = /^lock/i.test(a.focus_mode_status); });
  renderLock();
  const a = lastAdv[sel];
  if (a) {
    if (document.activeElement !== $('#meterSel')) $('#meterSel').value = a.meter;
    if (document.activeElement !== $('#flickerSel')) $('#flickerSel').value = a.antiflicker;
    if (document.activeElement !== $('#drc')) { $('#drc').value = a.drc; $('#drcV').textContent = a.drc; }
  }
  updateTuneBadges();
  renderColor();
  renderFocusMode();
  perLine('per-meter', (x) => +x.meter, (v) => METER_S[v] ?? v);
  perLine('per-flicker', (x) => +x.antiflicker, (v) => FLICK[v] ?? v);
  perLine('per-drc', (x) => +x.drc, (v) => v);
  perLine('per-gainLimit', (x) => +x.gain_limit, (v) => v);
}
async function pollAdv() {
  if (!cfg) return;
  await Promise.all(cfg.cameras.map((_, i) => pollOne(advBusyArr, lastAdv, advT, i, () => window.api.http(i, { type: 'advConf' }), 9000).then(renderAdv)));
}
setInterval(pollAdv, 2000);
setTimeout(pollAdv, 800);

// ---- Color drawer: white balance mode, red/blue gain, red/blue tuning, color temperature, one-push ----
// (modes 0 Auto, 1 Indoor, 2 Outdoor, 3 One push, 5 Manual, 32 Color temp; HTTP post_image_value&wbmode|rgain|bgain|rgaintuning|bgaintuning|colortemp|onepush)
Object.entries(WB_MODES).forEach(([k, l]) => { const o = document.createElement('option'); o.value = k; o.textContent = l; $('#wbMode').appendChild(o); });
for (let i = 0; i <= 55; i++) { const o = document.createElement('option'); o.value = i; o.textContent = kelvin(i); $('#ctempSel').appendChild(o); }
const COLOR_SLIDERS = [
  { id: 'rgain', name: 'rgain', get: (x) => +x.rgain, fmt: (v) => v, send: (v) => v },
  { id: 'bgain', name: 'bgain', get: (x) => +x.bgain, fmt: (v) => v, send: (v) => v },
  { id: 'rtune', name: 'rgaintuning', get: (x) => +x.rgain_tuning - 10, fmt: (v) => (v > 0 ? '+' : '') + v, send: (v) => v + 10 }, // camera stores tuning with a +10 offset
  { id: 'btune', name: 'bgaintuning', get: (x) => +x.bgain_tuning - 10, fmt: (v) => (v > 0 ? '+' : '') + v, send: (v) => v + 10 },
];
COLOR_SLIDERS.forEach((c) => {
  const r = $('#' + c.id);
  r.oninput = () => ($('#' + c.id + 'V').textContent = c.fmt(+r.value));
  r.onchange = () => { setImage(c.name, c.send(+r.value)); setTimeout(pollAdv, 500); };
});
$('#wbMode').onchange = () => { setImage('wbmode', $('#wbMode').value); setTimeout(pollAdv, 600); };
$('#ctempSel').onchange = () => { setImage('colortemp', $('#ctempSel').value); setTimeout(pollAdv, 500); };
$('#onePush').onclick = async () => {
  await setImage('onepush', 0);
  setStatus('One-push white balance: calculating (up to ~15 s)…');
  setTimeout(pollAdv, 4000); setTimeout(pollAdv, 16000);
};
const WB_HINT = { 0: 'Auto: the camera adjusts continuously. Red/Blue tune nudge it.', 1: 'Indoor preset.', 2: 'Outdoor preset.', 3: 'One push: aim at something white, then press One-push calibrate.', 5: 'Manual: red and blue gain are fixed by hand (steady, but won\'t follow changing light).', 32: 'Color temp: choose the light color to treat as white.' };
function renderColor() {
  const a = lastAdv[sel]; if (!a) return;
  const mode = +a.wb_mode;
  if (document.activeElement !== $('#wbMode')) $('#wbMode').value = mode;
  COLOR_SLIDERS.forEach((c) => { const r = $('#' + c.id); if (document.activeElement !== r) { r.value = c.get(a); $('#' + c.id + 'V').textContent = c.fmt(c.get(a)); } });
  if (document.activeElement !== $('#ctempSel')) $('#ctempSel').value = +a.temperature;
  const dim = (id, on) => $(id).classList.toggle('dim', !on);
  dim('#row-rgain', mode === 5); dim('#row-bgain', mode === 5);
  dim('#row-rtune', [0, 3, 32].includes(mode)); dim('#row-btune', [0, 3, 32].includes(mode));
  dim('#row-ctemp', mode === 32); dim('#row-onepush', mode === 3);
  $('#wbHint').textContent = WB_HINT[mode] || '';
  perLine('per-wbmode', (x) => +x.wb_mode, (v) => ({ 0: 'Auto', 1: 'Ind', 2: 'Out', 3: '1-push', 5: 'Man', 32: 'Temp' })[v] ?? v);
  perLine('per-rgain', (x) => +x.rgain, (v) => v);
  perLine('per-bgain', (x) => +x.bgain, (v) => v);
  perLine('per-rtune', (x) => +x.rgain_tuning - 10, (v) => (v > 0 ? '+' : '') + v);
  perLine('per-btune', (x) => +x.bgain_tuning - 10, (v) => (v > 0 ? '+' : '') + v);
  perLine('per-ctemp', (x) => +x.temperature, (v) => kelvin(v));
}
async function refreshAdv() { while (advBusyAny()) await sleep(100); await pollAdv(); }
$('#copyColor').onclick = async () => {
  const src = sel, x = lastAdv[src];
  if (!x) return setStatus(`${cfg.cameras[src].name}: no color data yet`, true);
  const mode = +x.wb_mode, others = cfg.cameras.map((_, i) => i).filter((i) => i !== src);
  const names = others.map((i) => cfg.cameras[i].name).join(', ');
  // which values matter for this mode
  const items = [{ k: 'wb_mode', name: 'wbmode', val: mode, label: `Mode: ${WB_MODES[mode] ?? mode}` }];
  if (mode === 5) items.push({ k: 'rgain', name: 'rgain', val: +x.rgain, label: `Red gain: ${x.rgain}` }, { k: 'bgain', name: 'bgain', val: +x.bgain, label: `Blue gain: ${x.bgain}` });
  if ([0, 3, 32].includes(mode)) items.push({ k: 'rgain_tuning', name: 'rgaintuning', val: +x.rgain_tuning, label: `Red tune: ${tuneFmt(+x.rgain_tuning)}` }, { k: 'bgain_tuning', name: 'bgaintuning', val: +x.bgain_tuning, label: `Blue tune: ${tuneFmt(+x.bgain_tuning)}` });
  if (mode === 32) items.push({ k: 'temperature', name: 'colortemp', val: +x.temperature, label: `Temp: ${kelvin(+x.temperature)}` });
  if (!confirm(`Copy white balance from ${cfg.cameras[src].name} to ${names}?\n\n${items.map((i) => i.label).join('\n')}${mode === 3 ? '\n\n(One push needs its calibrate button pressed on each camera.)' : ''}\n\nTakes a few seconds: it waits out the mode change and retries.`)) return;
  const send = (i, it) => window.api.http(i, { type: 'image', name: it.name, value: it.val });
  const wrong = () => others.map((i) => ({ i, its: lastAdv[i] ? items.filter((it) => +lastAdv[i][it.k] !== it.val) : items.slice(), none: !lastAdv[i] })).filter((m) => m.its.length);
  const btn = $('#copyColor'); btn.disabled = true;
  try {
    await refreshAdv();
    const modeChange = others.some((i) => !lastAdv[i] || +lastAdv[i].wb_mode !== mode);
    if (modeChange) {
      setStatus('Copying… switching white balance mode');
      await Promise.all(others.map((i) => send(i, items[0])));
      for (let k = 0; k < 10; k++) { await sleep(500); await refreshAdv(); if (!wrong().some((m) => m.its.includes(items[0]))) break; }
      setStatus('Copying… waiting for the cameras to settle'); await sleep(2500);
    }
    setStatus('Copying… sending values');
    await Promise.all(others.map(async (i) => { for (const it of items.slice(1)) await send(i, it); }));
    await sleep(1200); await refreshAdv();
    let bad = wrong();
    for (let attempt = 1; bad.length && attempt <= 2; attempt++) {
      setStatus(`Copying… retrying ${bad.map((m) => cfg.cameras[m.i].name).join(', ')} (${attempt}/2)`);
      await Promise.all(bad.map(async (m) => { for (const it of m.its) await send(m.i, it); }));
      await sleep(2000); await refreshAdv(); bad = wrong();
    }
    if (bad.length) setStatus(`Copied, but still different → ${bad.map((m) => `${cfg.cameras[m.i].name}: ${m.none ? 'no reply' : m.its.map((it) => it.label.split(':')[0]).join(', ')}`).join(' · ')}`, true);
    else setStatus(`White balance copied from ${cfg.cameras[src].name} ✔ (verified)`);
  } finally { btn.disabled = false; }
};

// ---- focus mode badge on every tile (camera reports focus_mode: 2 = Auto, 3 = Manual); lock has its own badge ----
function renderFocusMode() {
  tileEls.forEach((t, i) => {
    const el = t.querySelector('.fmode'), a = lastAdv[i]; if (!el) return;
    const m = a ? +a.focus_mode : null;
    el.textContent = m === 2 ? 'AF' : m === 3 ? 'MF' : '';
    el.title = m === 2 ? 'Autofocus' : m === 3 ? 'Manual focus' : '';
    el.className = 'fmode' + (m === 3 ? ' mf' : '');
    syncBlink(el, m === 3);
  });
  const m = lastAdv[sel] ? +lastAdv[sel].focus_mode : null;
  $('#afAuto').classList.toggle('cur', m === 2);
  $('#afManual').classList.toggle('cur', m === 3);
}

// ---- "Presets also recall image settings" (camera setting isp_switch), shown per camera; orange badge on any tile where it is ON ----
const lastIsp = [];
const ispBusy = [], ispT = [];
function renderIsp() {
  const vals = lastIsp.map((v) => (v === '1' ? 1 : v === '0' ? 0 : null));
  const known = vals.filter((v) => v !== null);
  const chk = $('#ispChk');
  chk.checked = known.length > 0 && known.every((v) => v === 1);
  chk.indeterminate = known.length > 0 && known.some((v) => v === 1) && known.some((v) => v === 0);
  $('#per-isp').innerHTML = cfg.cameras.map((camera, i) => `<span title="${esc(camera.name)}" class="${vals[i] === 1 ? 'diff' : ''}">${camTag(i)} ${vals[i] === null ? '—' : vals[i] ? 'ON' : 'off'}</span>`).join('');
  tileEls.forEach((t, i) => {
    const el = t.querySelector('.pimg'); if (!el) return;
    el.textContent = vals[i] === 1 ? 'PRESET IMG' : '';
    el.title = vals[i] === 1 ? 'Recalling a preset on this camera also changes its color/exposure (Presets > "also recall image settings")' : '';
    syncBlink(el, vals[i] === 1);
  });
}
async function pollIsp() {
  if (!cfg) return;
  await Promise.all(cfg.cameras.map((_, i) => pollOne(ispBusy, lastIsp, ispT, i, () => window.api.http(i, { type: 'presetImgRead' }), 12000).then(renderIsp)));
}
$('#ispChk').onchange = async () => {
  const on = $('#ispChk').checked;
  if (on && !confirm('Turn ON for all cameras?\n\nRecalling a preset will then also change that camera\'s color and exposure to what was saved with the preset.')) { renderIsp(); return; }
  const rs = await Promise.all(cfg.cameras.map((_, i) => window.api.http(i, { type: 'presetImgSet', on })));
  const bad = rs.map((r, i) => (r.ok ? null : cfg.cameras[i].name)).filter(Boolean);
  setStatus(bad.length ? `Preset image setting failed on: ${bad.join(', ')}` : `Presets ${on ? 'also recall image settings' : 'recall pan/tilt/zoom/focus only'} (all cameras)`, !!bad.length);
  setTimeout(pollIsp, 800);
};
setInterval(pollIsp, 5000);
setTimeout(pollIsp, 1500);

// ---- Auto tracking (Move SE). SELECTED CAMERA ONLY: nothing below ever uses targets()/the apply-to-all switch. ----
const lastTrack = [];
const trkBusy = [], trkT = [];
const TRK_NAMES = { off: 'Off', tracking: 'Tracking', autoframe: 'Framing' };
async function trackSet(body) {
  const i = sel;                                   // always exactly the selected camera
  const r = await window.api.http(i, { type: 'trackSet', body });
  if (!r.ok) setStatus(`${cfg.cameras[i].name}: tracking change failed (${r.error})`, true);
  else setStatus(`${cfg.cameras[i].name}: ${Object.entries(body).map(([k, v]) => `${k} = ${v}`).join(', ')}`);
  setTimeout(pollTrack, 300);
  return r;
}
async function pollTrack() {
  if (!cfg) return;
  await Promise.all(cfg.cameras.map((_, i) => pollOne(trkBusy, lastTrack, trkT, i, () => window.api.http(i, { type: 'trackGet' }), 9000).then(renderTrack)));
}
function setLoc(prefix, v) {                      // v: 'now' | 'home' | '<preset>'
  const selEl = $('#' + prefix + 'Sel'), num = $('#' + prefix + 'Num');
  if (document.activeElement === selEl || document.activeElement === num) return;
  if (v === 'now' || v === 'home') { selEl.value = v; num.value = ''; num.disabled = true; }
  else { selEl.value = 'preset'; num.value = v; num.disabled = false; }
}
function renderTrack() {
  const t = lastTrack[sel];
  // tile badges (pink, only when a camera is tracking or framing)
  tileEls.forEach((el, i) => {
    const b = el.querySelector('.trk'), x = lastTrack[i]; if (!b) return;
    b.textContent = x && x.trackMode === 'tracking' ? 'TRACKING' : x && x.trackMode === 'autoframe' ? 'FRAMING' : '';
    b.title = b.textContent ? 'Auto ' + b.textContent.toLowerCase() + ' is on for this camera' : '';
    syncBlink(b, !!b.textContent);
  });
  document.querySelectorAll('#trkSeg button, #trkQuick button').forEach((b) => b.classList.toggle('trkcur', !!t && b.dataset.mode === t.trackMode));
  $('#per-trkmode').innerHTML = cfg.cameras.map((c, i) => { const x = lastTrack[i], m = x ? x.trackMode : null; return `<span title="${esc(c.name)}: ${m ? TRK_NAMES[m] : 'no reply'}" class="${m && m !== 'off' ? 'diff' : ''}">${camTag(i)} ${m ? ({ off: 'Off', tracking: 'Track', autoframe: 'Frame' })[m] : '—'}</span>`; }).join('');
  if (!t) return;
  $('#trkHint').textContent = t.trackMode === 'tracking' ? 'Following one person in view.' : t.trackMode === 'autoframe' ? 'Keeping everyone in view framed.' : 'Tracking is off for this camera.';
  if (document.activeElement !== $('#trkDelay')) { $('#trkDelay').value = t.delayTime; $('#trkDelayV').textContent = t.delayTime + ' s'; }
  if (document.activeElement !== $('#trkLossTime')) { $('#trkLossTime').value = t.lossTime; $('#trkLossTimeV').textContent = t.lossTime + ' s'; }
  setLoc('trkStart', t.startPosition); setLoc('trkStop', t.stopPosition); setLoc('trkLoss', t.lossPosition);
  if (document.activeElement !== $('#trkOverlay')) $('#trkOverlay').checked = t.trackingOverlay === 'on';
}
document.querySelectorAll('#trkSeg button, #trkQuick button').forEach((b) => (b.onclick = () => trackSet({ trackMode: b.dataset.mode })));
$('#trkDelay').oninput = () => ($('#trkDelayV').textContent = $('#trkDelay').value + ' s');
$('#trkDelay').onchange = () => trackSet({ delayTime: +$('#trkDelay').value });
$('#trkLossTime').oninput = () => ($('#trkLossTimeV').textContent = $('#trkLossTime').value + ' s');
$('#trkLossTime').onchange = () => trackSet({ lossTime: +$('#trkLossTime').value });
[['trkStart', 'startPosition'], ['trkStop', 'stopPosition'], ['trkLoss', 'lossPosition']].forEach(([id, key]) => {
  const selEl = $('#' + id + 'Sel'), num = $('#' + id + 'Num');
  selEl.onchange = () => {
    if (selEl.value === 'preset') { num.disabled = false; if (num.value === '') num.value = '1'; trackSet({ [key]: String(Math.max(0, Math.min(254, +num.value || 0))) }); num.focus(); }
    else { num.disabled = true; num.value = ''; trackSet({ [key]: selEl.value }); }
  };
  num.onchange = () => { const v = Math.max(0, Math.min(254, Math.round(+num.value || 0))); num.value = v; trackSet({ [key]: String(v) }); };
});
$('#trkOverlay').onchange = () => trackSet({ trackingOverlay: $('#trkOverlay').checked ? 'on' : 'off' });
setInterval(pollTrack, 2000);
setTimeout(pollTrack, 1800);
