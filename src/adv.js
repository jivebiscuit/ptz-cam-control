// ---- live readback of everything the cameras report over HTTP (meter, DRC, flicker, gain limit, focus lock) ----
const METER_S = ['Avg', 'Ctr', 'Smt', 'Top'], FLICK = ['Off', '50 Hz', '60 Hz'];
const lastAdv = [];
const advBusyArr = [], advT = [];
const advBusyAny = () => advBusyArr.some(Boolean);
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
