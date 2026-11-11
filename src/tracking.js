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
