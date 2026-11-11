// ---- settings ----
function openSettings() {
  const f = $('#camFields'); f.innerHTML = '';
  cfg.cameras.forEach((c, i) => {
    const d = document.createElement('div'); d.className = 'cf';
    const nameIn = document.createElement('input'); nameIn.value = c.name; nameIn.maxLength = 24; nameIn.setAttribute('aria-label', `Camera ${i + 1} name`);
    const ipIn = document.createElement('input'); ipIn.value = c.ip; ipIn.maxLength = 253; ipIn.setAttribute('aria-label', `Camera ${i + 1} address`);
    d.append(nameIn, ipIn); f.appendChild(d);
  });
  $('#cfgErr').hidden = true;
  $('#dlg').hidden = false;
}
$('#settingsBtn').onclick = openSettings;
$('#cancelCfg').onclick = () => ($('#dlg').hidden = true);
$('#saveCfg').onclick = async () => {
  const cams = [...document.querySelectorAll('.cf')].map((d) => ({ name: d.children[0].value.trim(), ip: d.children[1].value.trim() }));
  const r = await window.api.setConfig({ cameras: cams });
  if (!r.ok) { $('#cfgErr').textContent = r.error; $('#cfgErr').hidden = false; return; } // keep the dialog open so it can be fixed
  cfg = r.config;
  $('#dlg').hidden = true; streamBase = await window.api.startStreams(); buildTiles(); attachStreams();
};
