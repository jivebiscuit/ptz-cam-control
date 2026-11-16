// App settings (camera names / addresses and the VISCA port): defaults, validation, and tolerant loading.
const { int, isHost } = require('./validate');

const MAX_CAMERAS = 4; // the multiview grid, keyboard shortcuts 1-4 and the drawers are built for up to four
const DEFAULTS = {
  cameras: [
    { name: 'Camera 1', ip: '192.168.1.101' },
    { name: 'Camera 2', ip: '192.168.1.102' },
    { name: 'Camera 3', ip: '192.168.1.103' },
    { name: 'Camera 4', ip: '192.168.1.104' },
  ],
  viscaPort: 5678,
  scenes: [], // [{ name, presets: [preset number or null per camera] }]; null leaves that camera where it is
  atem: { ip: '', inputs: [1, 2, 3, 4] }, // optional ATEM switcher: address ('' = off) and the ATEM input number each camera is plugged into
};

const MAX_SCENES = 12; // the scene bar in the side panel is laid out for this many
const PRESET_MIN = 1, PRESET_MAX = 254; // scenes use presets 1-254 (the camera also accepts 0, but it is not used)

const cloneDefaults = () => JSON.parse(JSON.stringify(DEFAULTS));

// Strict check for settings coming from the Settings dialog. Throws a message meant to be shown to the user.
// Only known keys survive; anything else is dropped.
function validateConfig(input) {
  if (!input || typeof input !== 'object') throw new Error('settings must be an object');
  const cams = input.cameras;
  if (!Array.isArray(cams) || cams.length < 1 || cams.length > MAX_CAMERAS) throw new Error(`there must be 1 to ${MAX_CAMERAS} cameras`);
  const cameras = cams.map((c, i) => {
    const n = i + 1;
    const name = typeof (c && c.name) === 'string' ? c.name.trim() : '';
    if (name.length < 1 || name.length > 24) throw new Error(`Camera ${n}: the name must be 1 to 24 characters`);
    const ip = typeof (c && c.ip) === 'string' ? c.ip.trim() : '';
    if (!isHost(ip)) throw new Error(`Camera ${n}: "${String(c && c.ip).slice(0, 40)}" is not a valid IP address or host name`);
    return { name, ip };
  });
  const viscaPort = input.viscaPort === undefined ? DEFAULTS.viscaPort : int(input.viscaPort, 1, 65535, 'VISCA port');
  return { cameras, viscaPort, scenes: validateScenes(input.scenes, cameras.length), atem: validateAtem(input.atem, cameras.length) };
}

const defaultInput = (c) => c + 1;
// Strict check of the ATEM settings: an address ('' = off) and an input number (1-99, or null = not on the switcher) per camera.
function validateAtem(input, camCount) {
  if (input === undefined) return { ip: '', inputs: Array.from({ length: camCount }, (_, c) => defaultInput(c)) };
  if (!input || typeof input !== 'object') throw new Error('ATEM settings must be an object');
  const ip = typeof input.ip === 'string' ? input.ip.trim() : '';
  if (ip !== '' && !isHost(ip)) throw new Error(`ATEM: "${String(input.ip).slice(0, 40)}" is not a valid IP address or host name`);
  const raw = Array.isArray(input.inputs) ? input.inputs : [];
  const inputs = Array.from({ length: camCount }, (_, c) => (raw[c] === undefined ? defaultInput(c) : raw[c] === null ? null : int(raw[c], 1, 99, `ATEM input for camera ${c + 1}`)));
  const used = inputs.filter((n) => n !== null);
  const dup = used.find((n, k) => used.indexOf(n) !== k);
  if (dup !== undefined) throw new Error(`ATEM: more than one camera is set to input ${dup}`);
  return { ip, inputs };
}

function sanitizeAtem(saved, camCount) {
  const out = validateAtem(undefined, camCount);
  if (!saved || typeof saved !== 'object') return out;
  if (typeof saved.ip === 'string' && (saved.ip.trim() === '' || isHost(saved.ip.trim()))) out.ip = saved.ip.trim();
  try { out.inputs = validateAtem({ ip: '', inputs: saved.inputs }, camCount).inputs; } catch { /* keep default inputs */ }
  return out;
}

// Strict check of the scene list (a name, and a preset number or null for each camera). Throws a message for the user.
function validateScenes(input, camCount) {
  if (input === undefined) return [];
  if (!Array.isArray(input)) throw new Error('scenes must be a list');
  if (input.length > MAX_SCENES) throw new Error(`there can be at most ${MAX_SCENES} scenes`);
  return input.map((s, i) => {
    const n = i + 1;
    const name = typeof (s && s.name) === 'string' ? s.name.trim() : '';
    if (name.length < 1 || name.length > 24) throw new Error(`Scene ${n}: the name must be 1 to 24 characters`);
    const raw = Array.isArray(s.presets) ? s.presets : [];
    const presets = Array.from({ length: camCount }, (_, c) => (raw[c] == null ? null : int(raw[c], PRESET_MIN, PRESET_MAX, `Scene ${n} (${name}), camera ${c + 1}: preset number`)));
    if (presets.every((p) => p === null)) throw new Error(`Scene ${n} (${name}): choose a preset for at least one camera`);
    return { name, presets };
  });
}

// Tolerant version for a file read from disk: keep every usable scene, drop the rest.
function sanitizeScenes(saved, camCount) {
  if (!Array.isArray(saved)) return [];
  const out = [];
  for (const s of saved) {
    if (out.length >= MAX_SCENES) break;
    const name = typeof (s && s.name) === 'string' ? s.name.trim() : '';
    if (name.length < 1 || name.length > 24) continue;
    const raw = Array.isArray(s.presets) ? s.presets : [];
    const presets = Array.from({ length: camCount }, (_, c) => { try { return raw[c] == null ? null : int(raw[c], PRESET_MIN, PRESET_MAX); } catch { return null; } });
    if (presets.some((p) => p !== null)) out.push({ name, presets });
  }
  return out;
}

// Tolerant check for a settings file read from disk: keep every valid piece, replace invalid pieces with the defaults,
// so a hand-edited or damaged file can never stop the app from starting.
function sanitizeSaved(saved) {
  const out = cloneDefaults();
  if (!saved || typeof saved !== 'object') return out;
  if (Array.isArray(saved.cameras) && saved.cameras.length >= 1 && saved.cameras.length <= MAX_CAMERAS) {
    out.cameras = saved.cameras.map((c, i) => {
      const fallback = DEFAULTS.cameras[i] || { name: `Camera ${i + 1}`, ip: '192.168.1.101' };
      const name = typeof (c && c.name) === 'string' && c.name.trim().length >= 1 && c.name.trim().length <= 24 ? c.name.trim() : fallback.name;
      const ip = typeof (c && c.ip) === 'string' && isHost(c.ip.trim()) ? c.ip.trim() : fallback.ip;
      return { name, ip };
    });
  }
  try { out.viscaPort = int(saved.viscaPort, 1, 65535); } catch { /* keep default */ }
  out.scenes = sanitizeScenes(saved.scenes, out.cameras.length);
  out.atem = sanitizeAtem(saved.atem, out.cameras.length);
  return out;
}

module.exports = { DEFAULTS, MAX_CAMERAS, MAX_SCENES, cloneDefaults, validateConfig, sanitizeSaved };
