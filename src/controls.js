// Operator controls: pan/tilt/zoom/focus buttons, presets 1-10 and the keyboard shortcuts.
// ---- PTZ ----
// One slider per axis, each with the camera's documented range (pan 1-24, tilt 1-20, zoom 1-7, focus 1-7; see index.html)
const panSp = () => +$('#speedPan').value, tiltSp = () => +$('#speedTilt').value;
const zoomSp = () => +$('#speedZoom').value, focusSp = () => +$('#speedFocus').value;
const move = (dir) => cam({ type: 'move', dir, pan: panSp(), tilt: tiltSp() });
const stopMove = () => cam({ type: 'move', dir: 'stop', pan: 1, tilt: 1 });

function hold(el, down, up) {
  const d = (e) => { e.preventDefault(); el.classList.add('on'); down(); };
  const u = () => { if (el.classList.contains('on')) { el.classList.remove('on'); up(); } };
  el.addEventListener('mousedown', d); window.addEventListener('mouseup', u); el.addEventListener('mouseleave', u);
}
function initControls() {
  document.querySelectorAll('.pad button').forEach((b) => {
    const d = b.dataset.d;
    if (d === 'home') b.onclick = () => cam({ type: 'home' });
    else hold(b, () => move(d), stopMove);
  });
  document.querySelectorAll('[data-z]').forEach((b) => hold(b,
    () => cam({ type: 'zoom', dir: b.dataset.z, speed: zoomSp() }), () => cam({ type: 'zoom', dir: 'stop' })));
  document.querySelectorAll('[data-f]').forEach((b) => hold(b,
    () => cam({ type: 'focus', dir: b.dataset.f, speed: focusSp() }), () => cam({ type: 'focus', dir: 'stop' })));
  $('#afAuto').onclick = () => { cam({ type: 'focusAuto' }, true); setTimeout(pollAdv, 500); };
  $('#afManual').onclick = () => { cam({ type: 'focusManual' }, true); setTimeout(pollAdv, 500); };
  $('#afLock').onclick = async () => {
    const i = sel, on = !state.locked[i];
    const r = await window.api.visca(i, { type: 'focusLock', on });
    if (!r.ok) return setStatus(`${cfg.cameras[i].name}: ${r.error}`, true);
    state.locked[i] = on; renderLock(); setStatus(`${cfg.cameras[i].name}: focus ${on ? 'LOCKED' : 'unlocked'}`); setTimeout(pollAdv, 500);
  };
  ['speedPan', 'speedTilt', 'speedZoom', 'speedFocus'].forEach((id) => { $('#' + id).oninput = () => ($('#' + id + 'V').textContent = $('#' + id).value); });

  // presets 1-10 (preset 0 is not used)
  const P = $('#presets');
  for (let n = 1; n <= 10; n++) {
    const b = document.createElement('button'); b.textContent = n; let timer, longed = false;
    const save = () => { cam({ type: 'presetSet', n }); setStatus(`Saved preset ${n} on ${cfg.cameras[sel].name}`); };
    b.onmousedown = () => { longed = false; timer = setTimeout(() => { longed = true; save(); }, 800); };
    b.onmouseup = () => clearTimeout(timer);
    // recalling moves the camera: if it is on air (ATEM Program) ask first. Saving a preset does not move it, so no question.
    const recall = () => { if (!onAir(sel) || confirm(`${cfg.cameras[sel].name} is ON AIR (ATEM Program).\n\nMove it to preset ${n} anyway?`)) cam({ type: 'presetRecall', n }); };
    b.onclick = (e) => { if (longed) return; if (e.shiftKey) save(); else recall(); };
    P.appendChild(b);
  }

  // keyboard: 1-4 select a camera, arrows move, +/- zoom, space stop, H home.
  // Shortcuts only run when you are NOT typing or using a form control, with no Ctrl/Cmd/Alt held, and with the
  // Settings dialog closed; otherwise e.g. typing "North" in a name box would send Home to a camera.
  const keys = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
  // '+'/'=' and '-'/'_' are the same physical keys, so a key can be released as the other character if Shift is let go first
  const actionOf = (k) => (keys[k] ? k : k === '+' || k === '=' ? 'zoomin' : k === '-' || k === '_' ? 'zoomout' : null);
  const heldKeys = new Set(); // only actions WE started: their release (or the window losing focus) sends the matching stop
  const inForm = (el) => !!el && (['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) || el.isContentEditable);
  const stopHeld = () => { if (!heldKeys.size) return; const moved = [...heldKeys].some((k) => keys[k]), zoomed = heldKeys.has('zoomin') || heldKeys.has('zoomout'); heldKeys.clear(); if (moved) stopMove(); if (zoomed) cam({ type: 'zoom', dir: 'stop' }); };
  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (inForm(e.target) || !$('#dlg').hidden) return;
    const act = actionOf(e.key);
    if (/^[1-4]$/.test(e.key) && cfg.cameras[+e.key - 1]) return select(+e.key - 1);
    if (keys[e.key]) { e.preventDefault(); heldKeys.add(e.key); move(keys[e.key]); }
    else if (act === 'zoomin') { heldKeys.add(act); cam({ type: 'zoom', dir: 'in', speed: zoomSp() }); }
    else if (act === 'zoomout') { heldKeys.add(act); cam({ type: 'zoom', dir: 'out', speed: zoomSp() }); }
    else if (e.key === ' ') { e.preventDefault(); stopMove(); }
    else if (e.key.toLowerCase() === 'h') cam({ type: 'home' });
  });
  window.addEventListener('keyup', (e) => {
    const act = actionOf(e.key);
    if (!act || !heldKeys.has(act)) return;
    heldKeys.delete(act);
    if (keys[act]) stopMove(); else cam({ type: 'zoom', dir: 'stop' });
  });
  window.addEventListener('blur', stopHeld); // e.g. Cmd-Tab while holding an arrow: the key-up would never arrive
}
