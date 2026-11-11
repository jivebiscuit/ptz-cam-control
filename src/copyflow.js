// "Copy the selected camera's settings to the other cameras", shared by the Exposure, Image and Color drawers.
// Cameras ignore changes for a few seconds after a mode switch and sometimes drop a command, so the flow is:
//   1) if the first item is a MODE and some camera differs: send it, wait until every camera reports it, let them settle
//   2) send the remaining items to every camera
//   3) re-read the cameras and re-send only what did not take (up to 2 retries), then report honestly
//
// copyFlow(opts) resolves to the list of leftovers ([] = everything verified). opts:
//   others      camera indexes to copy to          names     their display names (for messages)
//   items       [{ label, send(i), ok(i) }]        send writes one value to camera i; ok says whether camera i already has it
//   has(i)      true when camera i has been read at least once
//   refresh()   re-read all cameras                setStatus(text, isError)    sleep(ms)
//   hasMode     true when items[0] is a mode switch that must go first
//   timing      { modeLoops, settle, afterSend, retryWait }  milliseconds / counts
//   nameOf(i)   camera name, for the retry message
(function (root) {
  async function copyFlow(o) {
    const { others, items, has, refresh, setStatus, sleep, hasMode, timing, nameOf } = o;
    const wrong = () => others
      .map((i) => (has(i) ? { i, its: items.filter((it) => !it.ok(i)), none: false } : { i, its: items.slice(), none: true }))
      .filter((m) => m.its.length);
    const sendAll = (list) => Promise.all(list.map(async (m) => { for (const it of m.its) await it.send(m.i); }));
    await refresh();
    if (hasMode) {
      const mode = items[0];
      if (others.some((i) => !has(i) || !mode.ok(i))) {
        setStatus(`Copying… switching ${o.modeName}`);
        await Promise.all(others.map((i) => mode.send(i)));
        for (let k = 0; k < timing.modeLoops; k++) { await sleep(500); await refresh(); if (!wrong().some((m) => m.its.includes(mode))) break; }
        setStatus('Copying… waiting for the cameras to settle'); await sleep(timing.settle);
      }
    }
    setStatus('Copying… sending values');
    const rest = hasMode ? items.slice(1) : items;
    await sendAll(others.map((i) => ({ i, its: rest })));
    await sleep(timing.afterSend); await refresh();
    let bad = wrong();
    for (let attempt = 1; bad.length && attempt <= 2; attempt++) {
      setStatus(`Copying… retrying ${bad.map((m) => nameOf(m.i)).join(', ')} (${attempt}/2)`);
      await sendAll(bad);
      await sleep(timing.retryWait); await refresh(); bad = wrong();
    }
    return bad;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { copyFlow }; else root.copyFlow = copyFlow;
})(typeof window !== 'undefined' ? window : globalThis);
