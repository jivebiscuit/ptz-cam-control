// Start-up: load settings, build the UI, start the video. Loaded last so every other file is ready first.
(async () => {
  cfg = await window.api.getConfig();
  initControls(); buildTiles(); renderScenes();
  streamBase = await window.api.startStreams(); attachStreams();
  setInterval(watchStreams, 1000);
})();
