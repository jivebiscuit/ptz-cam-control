// Small helpers shared by the page (loaded by index.html before the other scripts) and by the automated tests (Node).

// Camera names/addresses are user-typed text: always escape them before they go into HTML.
function esc(t) {
  return String(t).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

// Polling helper: every camera is polled on its own (a slow camera never delays the others), and a brief hiccup keeps
// the last good value instead of blanking it; it only clears after staleMs without a good reply.
//   busy/store/times: per-camera arrays, i: camera index, fetchOne(i) -> {ok, data}
function pollOne(busy, store, times, i, fetchOne, staleMs) {
  if (busy[i]) return Promise.resolve();
  busy[i] = true;
  const miss = () => { if (Date.now() - (times[i] || 0) > staleMs) store[i] = null; };
  return Promise.resolve().then(() => fetchOne(i))
    .then((r) => { if (r && r.ok) { store[i] = r.data; times[i] = Date.now(); } else miss(); }, miss)
    .finally(() => { busy[i] = false; });
}

if (typeof module !== 'undefined' && module.exports) module.exports = { esc, pollOne };
