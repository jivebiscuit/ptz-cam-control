// Scenes: one button recalls a preset on every camera at once (names and preset numbers are set in Settings).
// A camera that is on air (ATEM Program, see onair.js) is not moved: its recall waits and is sent when it leaves Program.
// The last scene pressed stays highlighted until a camera in it moves (see scenewatch.js) or an operator move/zoom/home/preset is sent.
let activeScene = null; // { idx, watches: [createSceneWatch...], pending: { cameraIndex: presetNumber } }
let sceneToken = 0;     // bumped on every clear, so a recall that was still in flight does not light up afterwards

const sceneApi = () => window.api.http;
const sceneCamName = (c) => (cfg.cameras[c] ? cfg.cameras[c].name : String(c + 1));

function renderScenes() {
  const box = $('#scenes'); if (!box || !cfg) return;
  const list = cfg.scenes || [];
  const cls = (i) => (activeScene && activeScene.idx === i ? (Object.keys(activeScene.pending).length ? 'pending' : 'active') : '');
  box.innerHTML = list.length
    ? list.map((s, i) => `<button data-i="${i}" class="${cls(i)}" title="${esc(s.presets.map((n, c) => `${sceneCamName(c)}: ${n === null ? '—' : n}`).join(' · '))}">${esc(s.name)}</button>`).join('')
    : '<p class="hint">No scenes yet. Add them in ⚙ Settings.</p>';
}

function clearScene() {
  sceneToken++;
  if (!activeScene) return;
  const waiting = Object.keys(activeScene.pending).map((c) => sceneCamName(+c));
  const name = cfg.scenes[activeScene.idx] && cfg.scenes[activeScene.idx].name;
  activeScene = null; renderScenes();
  if (waiting.length) setStatus(`Scene ${name}: the move for ${waiting.join(', ')} was cancelled`, true);
}

async function recallScene(i) {
  const s = (cfg.scenes || [])[i]; if (!s) return;
  clearScene();
  const token = sceneToken;
  const cams = s.presets.map((n, c) => (n !== null && cfg.cameras[c] ? c : -1)).filter((c) => c >= 0);
  const held = cams.filter(onAir), now = cams.filter((c) => !onAir(c));
  const rs = await Promise.all(now.map((c) => sceneApi()(c, { type: 'presetRecall', n: s.presets[c] })));
  if (token !== sceneToken) return; // something else moved a camera, or another scene was pressed, in the meantime
  const bad = now.map((c, k) => (rs[k].ok ? null : `${sceneCamName(c)}: ${rs[k].error}`)).filter(Boolean);
  if (bad.length) { setStatus(`Scene ${s.name} failed → ${bad.join(' · ')}`, true); return; }
  activeScene = { idx: i, watches: now.length ? [createSceneWatch(now, Date.now())] : [], pending: Object.fromEntries(held.map((c) => [c, s.presets[c]])) };
  const parts = now.map((c) => `${sceneCamName(c)} → ${s.presets[c]}`);
  if (held.length) parts.push(`${held.map(sceneCamName).join(', ')} on air, will move when off Program`);
  if (atemState.enabled && !atemState.connected) parts.push('ATEM not connected: on-air cameras are not protected');
  setStatus(`Scene ${s.name}: ${parts.join(' · ')}`, atemState.enabled && !atemState.connected);
  renderScenes();
}

// a camera whose move was held back goes as soon as it is off Program (and only while the ATEM is connected: never blind)
function releaseHeld(a) {
  for (const key of Object.keys(a.pending)) {
    const c = +key;
    if (!atemState.connected || onAir(c)) continue;
    const n = a.pending[c]; delete a.pending[c];
    sceneApi()(c, { type: 'presetRecall', n }).then((r) => {
      if (activeScene !== a) return;
      if (r.ok) a.watches.push(createSceneWatch([c], Date.now()));
      setStatus(r.ok ? `Scene ${cfg.scenes[a.idx].name}: ${sceneCamName(c)} → ${n} (it left Program)` : `Scene ${cfg.scenes[a.idx].name}: ${sceneCamName(c)}: ${r.error}`, !r.ok);
      renderScenes();
    });
    renderScenes();
  }
}

$('#scenes').onclick = (e) => { const b = e.target.closest('button[data-i]'); if (b) recallScene(+b.dataset.i); };
setInterval(() => {
  const a = activeScene; if (!a) return;
  releaseHeld(a);
  const now = Date.now();
  if (a.watches.map((w) => w.update(lastPos, now)).includes('moved')) clearScene();
}, 400);
