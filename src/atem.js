// Blackmagic ATEM switcher link (main process): connects over the network with the atem-connection library and keeps the
// current Program and Preview inputs of the first mix effect. Read-only: this app never sends anything to the switcher.
// The page asks for status() about twice a second; it reports what is on air so tiles can show PGM/PVW and scenes can
// leave the on-air camera alone.
let atem = null;
let connected = false, enabled = false;

function stop() {
  const a = atem; atem = null; connected = false; enabled = false;
  if (a) a.destroy().catch(() => {});
}

// ip '' turns it off
function start(ip) {
  stop();
  if (!ip) return;
  enabled = true;
  const { Atem } = require('atem-connection'); // loaded only when used
  const a = atem = new Atem();
  a.on('error', () => {}); // an EventEmitter with no 'error' listener would throw; the library reconnects by itself
  a.on('connected', () => { if (atem === a) connected = true; });
  a.on('disconnected', () => { if (atem === a) connected = false; });
  a.connect(ip).catch(() => {});
}

// { enabled, connected, program, preview } (program / preview are ATEM input numbers, or null when unknown)
function status() {
  const me = atem && connected && atem.state && atem.state.video.mixEffects[0];
  return { enabled, connected: !!me, program: me ? me.programInput : null, preview: me ? me.previewInput : null };
}

module.exports = { start, stop, status };
