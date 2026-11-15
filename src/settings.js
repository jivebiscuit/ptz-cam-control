// ---- settings ----
const MAX_SCENES_UI = 12; // keep in step with MAX_SCENES in config.js
// one editable row of the Scenes list: name, one preset box per camera, move up / down / remove
function sceneRow(s) {
  const d = document.createElement('div'); d.className = 'sf';
  const nameIn = document.createElement('input'); nameIn.value = s ? s.name : ''; nameIn.maxLength = 24; nameIn.placeholder = 'Scene name'; nameIn.setAttribute('aria-label', 'Scene name');
  d.appendChild(nameIn);
  cfg.cameras.forEach((c, i) => {
    const n = document.createElement('input'); n.type = 'number'; n.min = 1; n.max = 254; n.step = 1;
    n.value = s && s.presets[i] !== null && s.presets[i] !== undefined ? s.presets[i] : '';
    n.placeholder = '—'; n.title = `${c.name}: preset number (blank = leave alone)`; n.setAttribute('aria-label', `${c.name} preset`);
    d.appendChild(n);
  });
  const btn = (txt, label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'sq'; b.textContent = txt; b.title = label; b.setAttribute('aria-label', label); b.onclick = fn; d.appendChild(b); };
  btn('↑', 'Move up', () => { if (d.previousElementSibling) d.parentNode.insertBefore(d, d.previousElementSibling); });
  btn('↓', 'Move down', () => { if (d.nextElementSibling) d.parentNode.insertBefore(d.nextElementSibling, d); });
  btn('×', 'Remove scene', () => { d.remove(); syncAddScene(); });
  return d;
}
const syncAddScene = () => { $('#addScene').disabled = $('#sceneFields').querySelectorAll('.sf:not(.sfh)').length >= MAX_SCENES_UI; };
function openSettings() {
  const f = $('#camFields'); f.innerHTML = '';
  cfg.cameras.forEach((c, i) => {
    const d = document.createElement('div'); d.className = 'cf';
    const nameIn = document.createElement('input'); nameIn.value = c.name; nameIn.maxLength = 24; nameIn.setAttribute('aria-label', `Camera ${i + 1} name`);
    const ipIn = document.createElement('input'); ipIn.value = c.ip; ipIn.maxLength = 253; ipIn.setAttribute('aria-label', `Camera ${i + 1} address`);
    d.append(nameIn, ipIn); f.appendChild(d);
  });
  const sf = $('#sceneFields');
  sf.innerHTML = `<div class="sf sfh"><span></span>${cfg.cameras.map((c) => `<span title="${esc(c.name)}">${esc(c.name)}</span>`).join('')}</div>`;
  (cfg.scenes || []).forEach((s) => sf.appendChild(sceneRow(s)));
  syncAddScene();
  $('#atemIp').value = cfg.atem.ip;
  $('#atemInputs').innerHTML = '<span class="lbl">Inputs</span>' + cfg.cameras.map((c, i) => `<label class="ai">${esc(c.name)} <input type="number" min="1" max="99" step="1" value="${cfg.atem.inputs[i] == null ? '' : cfg.atem.inputs[i]}" placeholder="—" aria-label="${esc(c.name)} ATEM input"></label>`).join('');
  $('#cfgErr').hidden = true;
  $('#dlg').hidden = false;
}
$('#addScene').onclick = () => { $('#sceneFields').appendChild(sceneRow(null)); syncAddScene(); };
$('#settingsBtn').onclick = openSettings;
$('#cancelCfg').onclick = () => ($('#dlg').hidden = true);
$('#saveCfg').onclick = async () => {
  const cams = [...document.querySelectorAll('.cf')].map((d) => ({ name: d.children[0].value.trim(), ip: d.children[1].value.trim() }));
  const scenes = [...$('#sceneFields').querySelectorAll('.sf:not(.sfh)')].map((d) => {
    const [name, ...nums] = [...d.querySelectorAll('input')];
    return { name: name.value.trim(), presets: nums.map((n) => (n.value.trim() === '' ? null : Number(n.value))) };
  }).filter((s) => s.name !== '' || s.presets.some((p) => p !== null)); // a row left completely empty is just dropped
  const atem = { ip: $('#atemIp').value.trim(), inputs: [...document.querySelectorAll('#atemInputs input')].map((n) => (n.value.trim() === '' ? null : Number(n.value))) };
  const r = await window.api.setConfig({ cameras: cams, scenes, atem });
  if (!r.ok) { $('#cfgErr').textContent = r.error; $('#cfgErr').hidden = false; return; } // keep the dialog open so it can be fixed
  cfg = r.config;
  clearScene(); renderScenes();
  $('#dlg').hidden = true; streamBase = await window.api.startStreams(); buildTiles(); attachStreams();
};
