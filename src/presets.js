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
