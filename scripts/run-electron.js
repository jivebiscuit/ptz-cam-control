#!/usr/bin/env node
// Launches Electron with a clean environment. Some terminals (VS Code's, for one) set ELECTRON_RUN_AS_NODE=1, which
// makes the Electron binary behave as plain Node: `electron .` then exits at once with no window and no error.
// usage: node scripts/run-electron.js <electron args...>      e.g.  node scripts/run-electron.js .
const { spawn } = require('child_process');
const electron = require('electron'); // path to the Electron binary
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, process.argv.slice(2), { stdio: 'inherit', env, windowsHide: false });
child.on('exit', (code, signal) => process.exit(signal ? 1 : code === null ? 1 : code));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
