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

// ---- copy selected camera's exposure settings to the other cameras ----
$('#copyAll').onclick = async () => {
  const src = sel, e = lastExp[src];
  if (!e) return setStatus(`${cfg.cameras[src].name}: no exposure data yet`, true);
  const manual = e.ae === 3;
  // which values matter in this exposure mode
  const items = [{ label: `Mode: ${e.aeName}`, send: (i) => window.api.visca(i, { type: 'aeMode', mode: e.ae }), ok: (i) => lastExp[i].ae === e.ae }];
  if (manual || e.ae === 10) items.push({ label: `Shutter: ${shutterLabel(e.shutter)}`, send: (i) => window.api.visca(i, { type: 'shutter', value: e.shutter }), ok: (i) => lastExp[i].shutter === e.shutter });
  if (manual || e.ae === 11) items.push({ label: `Iris: ${irisLabel(e.iris)}`, send: (i) => window.api.visca(i, { type: 'iris', value: e.iris }), ok: (i) => lastExp[i].iris === e.iris });
  if (manual) items.push({ label: `Gain: step ${e.gain}`, send: (i) => window.api.visca(i, { type: 'gain', value: e.gain }), ok: (i) => lastExp[i].gain === e.gain });
  items.push({ label: `Gain limit: ${e.gainLimit}`, send: (i) => window.api.http(i, { type: 'image', name: 'gainLimit', value: e.gainLimit }), ok: (i) => lastExp[i].gainLimit === e.gainLimit });
  copySettings({
    btn: $('#copyAll'), src, items, has: (i) => !!lastExp[i], refresh: refreshAdv,
    what: 'exposure settings', modeName: 'exposure mode', done: `Copied from ${cfg.cameras[src].name}`,
    note: '(Takes a few seconds: the cameras ignore changes just after a mode switch, so it waits and retries. Meter, DRC, flicker and image settings are not copied here.)',
    timing: { modeLoops: 12, settle: 4000, afterSend: 1500, retryWait: 2500 },
  });
};
