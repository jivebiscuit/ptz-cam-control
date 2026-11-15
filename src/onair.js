// ATEM Program / Preview indicators on the tiles. The main process holds the switcher connection; this polls its status.
// Which camera is on which ATEM input is set in Settings (cfg.atem.inputs).
let atemState = { enabled: false, connected: false, program: null, preview: null };
const onAir = (i) => !!cfg && atemState.connected && cfg.atem.inputs[i] != null && cfg.atem.inputs[i] === atemState.program;
const onPreview = (i) => !!cfg && atemState.connected && cfg.atem.inputs[i] != null && cfg.atem.inputs[i] === atemState.preview && !onAir(i);

function renderOnAir() {
  if (!cfg) return;
  tileEls.forEach((t, i) => {
    const pgm = onAir(i), pvw = onPreview(i), el = t.querySelector('.tally'); if (!el) return;
    el.textContent = pgm ? 'PGM' : pvw ? 'PVW' : '';
    t.classList.toggle('pgm', pgm); t.classList.toggle('pvw', pvw);
  });
  const note = $('#atemNote');
  note.hidden = !(atemState.enabled && !atemState.connected);
}
async function pollAtem() {
  if (!cfg) return;
  try { atemState = await window.api.atemStatus(); } catch { /* keep the last state */ }
  renderOnAir();
}
setInterval(pollAtem, 400);
