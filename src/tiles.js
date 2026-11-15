// Multiview tiles: live video, no-signal handling, focus-lock badge, camera selection.
// ---- multiview: live MJPEG from local ffmpeg-backed stream server ----
let streamBase = ''; // http://127.0.0.1:<port>/cam/<token>  (from the main process)
function buildTiles() {
  const mv = $('#multiview'); mv.innerHTML = ''; tileEls = [];
  cfg.cameras.forEach((c, i) => {
    const t = document.createElement('div'); t.className = 'cell off';
    t.innerHTML = `<div class="tile"><img alt=""><div class="tag">${i + 1} · ${esc(c.name)}<i>${esc(c.ip)}</i></div><div class="badges"><span class="tally"></span><span class="trk"></span><span class="fmode"></span></div></div>
      <div class="cap"><div class="pos stale"><span class="pp">— no position —</span><span class="adv"></span></div><div class="exp"></div></div>`;
    const img = t.querySelector('img');
    img.addEventListener('error', () => setTimeout(() => { if (streamBase) img.src = `${streamBase}/${i}?t=${Date.now()}`; }, 1500));
    t.onclick = () => select(i);
    mv.appendChild(t); tileEls.push(t);
  });
  select(sel); renderOnAir();
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
