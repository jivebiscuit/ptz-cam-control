// Shared basics: selected camera, status line, sending commands (to one camera or all), scale formatting, small helpers.
const $ = (s) => document.querySelector(s);
let cfg, sel = 0, tileEls = [];
const state = { locked: {} }; // locked[camIndex] — camera can't report lock state, so we track it

const setStatus = (m, err) => { const s = $('#status'); s.textContent = m; s.title = m; s.className = err ? 'err' : ''; };
// don't leave a clicked button focused (it would show a focus ring and react to Space/Enter)
document.addEventListener('mouseup', (e) => { const b = e.target.closest && e.target.closest('button'); if (b) b.blur(); });
// dropdowns, sliders, checkboxes and radios give up keyboard focus once you've used them, so the shortcuts work again
document.addEventListener('change', (e) => { const t = e.target; if (t && t.matches && t.matches('select, input[type=range], input[type=checkbox], input[type=radio]')) t.blur(); }, true);
const MOVE_CMDS = new Set(['move', 'zoom', 'home', 'presetRecall']); // commands that move a camera: they end the highlighted scene
const cam = (a, forceVisca) => {
  if (MOVE_CMDS.has(a.type) && a.dir !== 'stop') clearScene();
  return (forceVisca ? window.api.visca(sel, a) : window.api.http(sel, a))
    .then((r) => { if (!r.ok) setStatus(`${cfg.cameras[sel].name}: ${r.error}`, true); return r; });
};

// ---- scale (measured on an F64: pan ±2448, tilt -432..+1296, zoom 0..16384) ----
const UNITS_PER_DEG = 14.4;                 // 2448/170°, 1296/90°, 432/30°
const ZOOM_MAX = 16384, ZOOM_X_MAX = 30;
// Straight-line estimate only: real optical zoom is nonlinear in position. Replace with a lookup table once calibrated.
const zoomX = (z) => 1 + (ZOOM_X_MAX - 1) * z / ZOOM_MAX;
// units -> "R 12.3°" / "L 4.0°" (pan), "U 5.0°" / "D 2.0°" (tilt)
const side = (u, pos, neg) => { const d = Math.abs(u / UNITS_PER_DEG).toFixed(1); return d === '0.0' ? '0.0°' : `${u > 0 ? pos : neg} ${d}°`; };
const fmtLR = (u) => side(u, 'R', 'L'), fmtUD = (u) => side(u, 'U', 'D');

// Flashing chips (tracking/framing, manual focus) all use a 1 s cycle; give each the same wall-clock phase so they flip together
function syncBlink(el, active) {
  if (!active) { el.dataset.sync = ''; el.style.animationDelay = ''; return; }
  if (!el.dataset.sync) { el.style.animationDelay = `-${Date.now() % 1000}ms`; el.dataset.sync = '1'; }
}

// ---- apply-to-all scope + sending to the selected camera / all cameras ----
let scopeAllFlag = false;
const scopeAll = () => scopeAllFlag;
const targets = () => (scopeAll() ? cfg.cameras.map((_, i) => i) : [sel]);
// send a VISCA command to the selected camera, or to all cameras when "All cameras" is on
async function sendAll(a) {
  const rs = await Promise.all(targets().map((i) => window.api.visca(i, a)));
  const bad = rs.map((r, k) => (r.ok ? null : `${cfg.cameras[targets()[k]].name}: ${r.error}`)).filter(Boolean);
  if (bad.length) setStatus(bad.join(' · '), true);
  return rs;
}
// same, for the HTTP image settings (meter / gainLimit / drc)
async function setImage(name, value) {
  const rs = await Promise.all(targets().map((i) => window.api.http(i, { type: 'image', name, value })));
  const bad = rs.map((r, k) => (r.ok ? null : `${cfg.cameras[targets()[k]].name}: ${r.error}`)).filter(Boolean);
  setTimeout(pollAdv, 400);
  setStatus(bad.length ? bad.join(' · ') : `${name} = ${value} → ${scopeAll() ? 'all cameras' : cfg.cameras[sel].name}`, !!bad.length);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const camTag = (i) => { const n = cfg.cameras[i].name.trim(); const ch = n[0] ? n[0].toUpperCase() : ''; return esc(ch && cfg.cameras.filter((x) => (x.name.trim()[0] || '').toUpperCase() === ch).length === 1 ? ch : String(i + 1)); };

// Confirm, then copy items from camera `src` to every other camera with verification (see copyflow.js).
// o: { btn, src, items, has, refresh, what, modeName?, done, note, timing }; a mode item (items[0]) is used when modeName is given.
async function copySettings(o) {
  const others = cfg.cameras.map((_, i) => i).filter((i) => i !== o.src);
  const names = others.map((i) => cfg.cameras[i].name).join(', ');
  const plan = o.items.map((it) => it.label).join('\n');
  if (!confirm(`Copy ${o.what} from ${cfg.cameras[o.src].name} to ${names}?\n\n${plan}${o.note ? `\n\n${o.note}` : ''}`)) return;
  o.btn.disabled = true;
  try {
    const bad = await copyFlow({ others, items: o.items, has: o.has, refresh: o.refresh, setStatus, sleep, hasMode: !!o.modeName, modeName: o.modeName, timing: o.timing, nameOf: (i) => cfg.cameras[i].name });
    if (bad.length) setStatus(`Copied, but still different → ${bad.map((m) => `${cfg.cameras[m.i].name}: ${m.none ? 'no reply' : m.its.map((it) => it.label.split(':')[0]).join(', ')}`).join(' · ')}`, true);
    else setStatus(`${o.done} ✔ (verified)`);
  } finally { o.btn.disabled = false; }
}
