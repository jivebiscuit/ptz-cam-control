// Small pure validators. Everything that arrives over IPC (and everything read from config.json) goes through these
// before it can reach a camera or the disk.

// A whole number in [min, max]. Accepts numeric strings ("12"); rejects NaN, decimals, empty strings, null.
function int(v, min, max, label = 'value') {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label} must be a whole number from ${min} to ${max}`);
  return n;
}

function oneOf(v, list, label = 'value') {
  if (!list.includes(v)) throw new Error(`${label} must be one of: ${list.join(', ')}`);
  return v;
}

function bool(v, label = 'value') {
  if (typeof v !== 'boolean') throw new Error(`${label} must be true or false`);
  return v;
}

// IPv4 dotted quad, or a plain hostname (letters, digits, hyphens, dots). Anything made only of digits and dots must be
// a proper four-part IP: "1.2.3" or "1.2.3.4.5" would otherwise pass as a host name, and network software reads
// those as IPv4 shorthand, so a typo could silently point at the wrong address.
function isHost(s) {
  if (typeof s !== 'string' || s.length === 0 || s.length > 253) return false;
  if (/^[\d.]+$/.test(s)) return /^\d+(\.\d+){3}$/.test(s) && s.split('.').every((o) => o.length <= 3 && +o >= 0 && +o <= 255);
  return /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/.test(s);
}

module.exports = { int, oneOf, bool, isHost };
