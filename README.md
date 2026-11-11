# SOTH Cam Control

A desktop app (Electron) for controlling and monitoring four PTZOptics Move SE cameras during a livestream:
live multiview, pan/tilt/zoom, focus, presets, exposure / image / color / tracking drawers with live read-back, and
visual alerts when a camera is in an abnormal state (tracking on, manual focus, focus locked, preset image recall, values that differ from the other cameras).

Default cameras: South 192.168.0.200, Center .201, North .202, Rear .203. Change names and addresses in **Settings**.

## Requirements
- Node 22 and npm (to run or build)
- Cameras reachable on the local network (Ethernet recommended)

## Run
```
npm install
npm start
```
Use `npm start`, not `electron .`: VS Code terminals set `ELECTRON_RUN_AS_NODE=1`, which makes Electron exit silently. `npm start` clears it.

## Develop
| Command | What it does |
|---|---|
| `npm run lint` | ESLint, zero warnings allowed |
| `npm test` | unit tests (validators, config, VISCA client, ffmpeg failures, video server) |
| `npm run test:app` | launches the real app hidden, with a fake camera network, and checks the UI end to end |

## Build
`ffmpeg-static` installs only the binary for the platform you run `npm install` on, so **build each platform on that platform**:
```
npm run dist:win     # on Windows: portable .exe in dist/
npm run dist:mac     # on a Mac: unpacked app in dist/
```
The build scripts check that the bundled ffmpeg matches the target and refuse to continue if it does not.
The Windows build has not yet been run on a Windows machine.

## Keyboard
Arrow keys pan/tilt (hold to move, release to stop), Space stops, `H` goes Home, `1`–`4` selects a camera, `Esc` closes a drawer.
Shortcuts are ignored while typing in a field.

## Settings and environment
- Settings are saved in the app's user-data folder as `config.json`; a damaged file falls back to defaults.
- `SOTH_FFMPEG=/path/to/ffmpeg` uses a different ffmpeg.
- `SOTH_TEST_HIDDEN=1` keeps the window hidden (used by the app test).
- Only one copy of the app can run at once (cameras allow one VISCA session each).

## Troubleshooting a tile that says NO SIGNAL
The tile shows the reason when it knows it:
- **ffmpeg not found / wrong platform**: reinstall dependencies on this platform, or set `SOTH_FFMPEG`.
- **Connection refused / timed out**: camera off, wrong address, or not on the same network.
- **Connection works but no video**: another RTSP client may be using the stream, or the camera needs a reboot (South once needed one for stuck tracking).

## More
Verified camera behavior, command formats and gotchas: [docs/camera-notes.md](docs/camera-notes.md).
