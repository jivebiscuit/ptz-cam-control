// Live position readout under each tile and in the side panel (VISCA, every 500 ms).
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
