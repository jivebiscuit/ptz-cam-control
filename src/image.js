// ---- Image drawer: luminance / saturation / contrast / sharpness / hue (HTTP, read back via get_image_conf) ----
const IMG_TIPS = {"bright": "Luminance \u2014 overall brightness of the picture, like a brightness knob. Higher makes the whole image lighter, lower makes it darker. It lifts or lowers everything at once, including the shadows, so it can wash out blacks if pushed too far. (This is separate from the exposure settings, which change how much light the camera captures.)", "saturation": "Saturation \u2014 how vivid the colors are. Low looks pale and washed out, heading toward grey. High looks rich and punchy, and too high makes skin tones orange and colors glow. 100% is the camera's neutral strength; range here is 60%\u2013200%.", "contrast": "Contrast \u2014 the difference between the darkest and lightest parts. Higher makes shadows deeper and highlights brighter for a punchier look, but can crush detail in dark areas and blow out bright ones. Lower looks flatter and softer.", "sharpness": "Sharpness \u2014 how crisp edges look, such as text, hair and fabric. Higher looks more detailed but too much adds halos around edges and makes noise more visible. Lower looks softer and more natural, which is often kinder to faces on video.", "hue": "Hue \u2014 rotates all the colors around the color wheel, shifting the overall color tint. Small changes move skin tones and wood toward warmer or cooler shades. If colors already look right, leave it alone."};
const IMG = [
  { key: 'bright', name: 'luminance', label: 'Luminance', max: 14, fmt: (v) => v },
  { key: 'saturation', name: 'saturation', label: 'Saturation', max: 14, fmt: (v) => `${60 + 10 * v}%` },
  { key: 'contrast', name: 'contrast', label: 'Contrast', max: 14, fmt: (v) => v },
  { key: 'sharpness', name: 'sharpness', label: 'Sharpness', max: 16, fmt: (v) => v }, // 0-16 verified on these cameras
  { key: 'hue', name: 'hue', label: 'Hue', max: 14, fmt: (v) => v },
];
const lastImg = [];
const imgBusy = [], imgT = [];
IMG.forEach((c) => {
  const d = document.createElement('div'); d.className = 'imgc'; d.id = 'img-' + c.key;
  d.innerHTML = `<div class="top"><span class="nm tip" title="${IMG_TIPS[c.key].replace(/"/g, '&quot;')}">${c.label}</span><button data-step="-1">−</button>
    <input type="range" min="0" max="${c.max}" step="1" value="0"><button data-step="1">+</button><b class="val">—</b></div><div class="per"></div>`;
  const r = d.querySelector('input'), val = d.querySelector('.val');
  r.oninput = () => (val.textContent = c.fmt(+r.value));
  r.onchange = () => { setImage(c.name, +r.value); setTimeout(pollImage, 400); };
  d.querySelectorAll('[data-step]').forEach((b) => (b.onclick = () => {
    const cur = lastImg[sel] ? lastImg[sel][c.key] : null; if (cur == null) return;
    const v = Math.max(0, Math.min(c.max, cur + +b.dataset.step));
    r.value = v; val.textContent = c.fmt(v);
    setImage(c.name, v); setTimeout(pollImage, 400);
  }));
  $('#imgControls').appendChild(d);
});
function renderImg() {
  IMG.forEach((c) => {
    const d = $('#img-' + c.key), r = d.querySelector('input'), mine = lastImg[sel] ? lastImg[sel][c.key] : null;
    if (mine != null && document.activeElement !== r) { r.value = mine; d.querySelector('.val').textContent = c.fmt(mine); }
    // short camera tag: first letter of its name if unique, else its number
    const tag = (i) => { const n = cfg.cameras[i].name.trim(); const ch = n[0] ? n[0].toUpperCase() : ''; return esc(ch && cfg.cameras.filter((x) => (x.name.trim()[0] || '').toUpperCase() === ch).length === 1 ? ch : String(i + 1)); };
    d.querySelector('.per').innerHTML = cfg.cameras.map((camera, i) => {
      const v = lastImg[i] ? lastImg[i][c.key] : null;
      return `<span title="${esc(camera.name)}" class="${v != null && mine != null && v !== mine ? 'diff' : ''}">${tag(i)} ${v == null ? '—' : c.fmt(v)}</span>`;
    }).join('');
  });
}
async function pollImage() {
  if (!cfg || $('#drawer-image').classList.contains('closed')) return;
  await Promise.all(cfg.cameras.map((_, i) => pollOne(imgBusy, lastImg, imgT, i, () => window.api.http(i, { type: 'imageConf' }), 9000).then(renderImg)));
}
setInterval(pollImage, 2000);
document.querySelectorAll('#drawerBtns button').forEach((b) => b.addEventListener('click', () => setTimeout(pollImage, 50)));
$('#copyImage').onclick = async () => {
  const src = sel, e = lastImg[src];
  if (!e) return setStatus(`${cfg.cameras[src].name}: no image data yet`, true);
  const items = IMG.map((c) => ({ label: `${c.label}: ${c.fmt(e[c.key])}`, send: (i) => window.api.http(i, { type: 'image', name: c.name, value: e[c.key] }), ok: (i) => lastImg[i][c.key] === e[c.key] }));
  copySettings({
    btn: $('#copyImage'), src, items, has: (i) => !!lastImg[i], refresh: pollImage,
    what: 'image settings', done: `Image settings copied from ${cfg.cameras[src].name}`, note: '',
    timing: { afterSend: 800, retryWait: 1000 },
  });
};
