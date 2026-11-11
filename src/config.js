// App settings (camera names / addresses and the VISCA port): defaults, validation, and tolerant loading.
const { int, isHost } = require('./validate');

const MAX_CAMERAS = 4; // the multiview grid, keyboard shortcuts 1-4 and the drawers are built for up to four
const DEFAULTS = {
  cameras: [
    { name: 'South', ip: '192.168.0.200' },
    { name: 'Center', ip: '192.168.0.201' },
    { name: 'North', ip: '192.168.0.202' },
    { name: 'Rear', ip: '192.168.0.203' },
  ],
  viscaPort: 5678,
};

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
  return { cameras, viscaPort };
}

// Tolerant check for a settings file read from disk: keep every valid piece, replace invalid pieces with the defaults,
// so a hand-edited or damaged file can never stop the app from starting.
function sanitizeSaved(saved) {
  const out = cloneDefaults();
  if (!saved || typeof saved !== 'object') return out;
  if (Array.isArray(saved.cameras) && saved.cameras.length >= 1 && saved.cameras.length <= MAX_CAMERAS) {
    out.cameras = saved.cameras.map((c, i) => {
      const fallback = DEFAULTS.cameras[i] || { name: `Camera ${i + 1}`, ip: '192.168.0.200' };
      const name = typeof (c && c.name) === 'string' && c.name.trim().length >= 1 && c.name.trim().length <= 24 ? c.name.trim() : fallback.name;
      const ip = typeof (c && c.ip) === 'string' && isHost(c.ip.trim()) ? c.ip.trim() : fallback.ip;
      return { name, ip };
    });
  }
  try { out.viscaPort = int(saved.viscaPort, 1, 65535); } catch { /* keep default */ }
  return out;
}

module.exports = { DEFAULTS, MAX_CAMERAS, cloneDefaults, validateConfig, sanitizeSaved };
