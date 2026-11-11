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
