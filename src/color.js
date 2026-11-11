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
  const mode = +x.wb_mode;
  // which values matter for this white balance mode
  const item = (k, name, label) => ({ label, send: (i) => window.api.http(i, { type: 'image', name, value: +x[k] }), ok: (i) => +lastAdv[i][k] === +x[k] });
  const items = [item('wb_mode', 'wbmode', `Mode: ${WB_MODES[mode] ?? mode}`)];
  if (mode === 5) items.push(item('rgain', 'rgain', `Red gain: ${x.rgain}`), item('bgain', 'bgain', `Blue gain: ${x.bgain}`));
  if ([0, 3, 32].includes(mode)) items.push(item('rgain_tuning', 'rgaintuning', `Red tune: ${tuneFmt(+x.rgain_tuning)}`), item('bgain_tuning', 'bgaintuning', `Blue tune: ${tuneFmt(+x.bgain_tuning)}`));
  if (mode === 32) items.push(item('temperature', 'colortemp', `Temp: ${kelvin(+x.temperature)}`));
  copySettings({
    btn: $('#copyColor'), src, items, has: (i) => !!lastAdv[i], refresh: refreshAdv,
    what: 'white balance', modeName: 'white balance mode', done: `White balance copied from ${cfg.cameras[src].name}`,
    note: `${mode === 3 ? '(One push needs its calibrate button pressed on each camera.)\n\n' : ''}Takes a few seconds: it waits out the mode change and retries.`,
    timing: { modeLoops: 10, settle: 2500, afterSend: 1200, retryWait: 2000 },
  });
};
