// Decides when a recalled scene should stop being shown as "active": once the cameras in it have arrived and settled,
// any of them moving away (by hand, by tracking, by anything) ends it. Pure logic so it can be unit tested; the page
// (scenes.js) feeds it the live positions. Positions are { pan, tilt, zoom } in camera units, or null when unknown.
const SCENE_TOL = { pan: 6, tilt: 6, zoom: 40 }; // camera units; ~0.4 degree of pan/tilt. A camera at rest does not drift
const SCENE_SETTLE_MS = 1500;    // a camera counts as arrived once its position has not changed for this long
const SCENE_GIVE_UP_MS = 20000;  // a recall normally takes under 8 s; after this, settle on whatever positions are known

const scenePosSame = (a, b) => Math.abs(a.pan - b.pan) <= SCENE_TOL.pan && Math.abs(a.tilt - b.tilt) <= SCENE_TOL.tilt && Math.abs(a.zoom - b.zoom) <= SCENE_TOL.zoom;

// cams: indexes of the cameras the scene moves. update(positions, now) returns 'settling' | 'active' | 'moved'.
function createSceneWatch(cams, startedAt) {
  const ref = {}, since = {}; let base = null;
  return {
    update(positions, now) {
      if (base) {
        for (const i of cams) { const p = positions[i]; if (p && base[i] && !scenePosSame(p, base[i])) return 'moved'; }
        return 'active';
      }
      let allSettled = true;
      for (const i of cams) {
        const p = positions[i];
        if (!p) { allSettled = false; continue; }
        if (ref[i] && scenePosSame(p, ref[i])) { if (now - since[i] < SCENE_SETTLE_MS) allSettled = false; }
        else { ref[i] = p; since[i] = now; allSettled = false; }
      }
      if (allSettled || now - startedAt >= SCENE_GIVE_UP_MS) {
        base = {}; for (const i of cams) { const p = positions[i] || ref[i]; if (p) base[i] = p; }
        return 'active';
      }
      return 'settling';
    },
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { createSceneWatch, SCENE_SETTLE_MS, SCENE_GIVE_UP_MS };
