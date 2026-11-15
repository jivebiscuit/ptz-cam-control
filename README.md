# SOTH Cam Control

A desktop app (Electron) for controlling and monitoring four PTZOptics Move SE cameras during a livestream:
live multiview, pan/tilt/zoom, focus, presets, exposure / image / color / tracking drawers with live read-back, and
visual alerts when a camera is in an abnormal state (tracking on, manual focus, focus locked, preset image recall, values that differ from the other cameras).

Default cameras: South 192.168.0.200, Center .201, North .202, Rear .203. Change names and addresses in **Settings**.

## Requirements
- Node 22 and npm (to run or build from source)
- Cameras reachable on the local network (Ethernet recommended)

## Run
```
npm install
npm start
```
Use `npm start`, not `electron .`: VS Code terminals set `ELECTRON_RUN_AS_NODE=1`, which makes Electron exit silently. `npm start` clears it.

## Keyboard
Arrow keys pan/tilt (hold to move, release to stop), Space stops, `H` goes Home, `1`–`4` selects a camera, `Esc` closes a drawer.
Shortcuts are ignored while typing in a field.

## Settings and environment
- Settings are saved in the app's user-data folder as `config.json`; a missing or damaged file falls back to defaults (valid fields are kept).
- `SOTH_FFMPEG=/path/to/ffmpeg` uses a different ffmpeg.
- `SOTH_TEST_HIDDEN=1` keeps the window hidden (used by the app test).
- Only one copy of the app can run at once (cameras allow one VISCA session each).

---

# Developer guide

## What it is built on
| Piece | Used for |
|---|---|
| [Electron](https://www.electronjs.org/) 45 | Desktop shell: a Node.js main process plus a sandboxed Chromium renderer |
| Plain JavaScript (CommonJS in main, classic `<script>` files in the page) | No framework, no bundler, no transpiler |
| [ffmpeg-static](https://www.npmjs.com/package/ffmpeg-static) | Bundled ffmpeg binary that turns each camera's RTSP video into something the page can show |
| Node built-ins (`http`, `net`, `child_process`) | Talking to cameras and serving video; there are no runtime dependencies other than ffmpeg-static |
| electron-builder | Packaging (Windows portable exe, unpacked Mac app) |
| ESLint 10 + `node --test` | Lint (zero warnings) and unit tests |

## How it works

```mermaid
flowchart LR
  subgraph R["Renderer (index.html + scripts)"]
    UI["Page UI<br/>window.api via preload.js"]
    IMG["img tag showing video"]
  end
  subgraph M["Main process (main.js)"]
    V["Validate every value"]
    SS["StreamServer<br/>127.0.0.1 + token"]
    FF["One ffmpeg per camera"]
  end
  subgraph C["PTZOptics camera"]
    VI["VISCA TCP :5678<br/>PTZ, focus, presets, exposure"]
    HT["HTTP CGI / REST :80<br/>image settings, tracking, read-back"]
    RT["RTSP :554<br/>H.264 stream 2"]
  end
  UI -- IPC --> V
  V --> VI
  V --> HT
  RT --> FF --> SS --> IMG
```

**Control.** The page never talks to a camera directly. It calls `window.api` (defined in `preload.js` with `contextIsolation` on, `nodeIntegration` off and `sandbox` on), which sends an IPC message to the main process. `main.js` treats every message as untrusted: the camera index, command type and each value are range-checked (`validate.js`, the `IMAGE_RANGE` table, etc.) before anything is sent. Two protocols are used:
- **VISCA over TCP** (`visca.js`, port 5678): movement, zoom, focus, presets, exposure mode, iris/shutter/gain, and position read-back. One persistent connection per camera; inquiries are queued one at a time.
- **HTTP** (`camhttp.js`, port 80): the CGI endpoints (`ptzctrl.cgi`, `param.cgi`) for image/color settings and for reading the camera's configuration, plus the REST API `/api/v1/control/track` for auto-tracking. Tracking writes accept only a whitelist of fields and values, and the UI only ever sends them to one camera.

**Read-back and alerts.** The renderer polls each camera on timers (position every 0.5 s; image, advanced/exposure and tracking every 2 s; preset-image setting every 5 s; stream health every 1 s). Each drawer shows live values, and `core.js` compares cameras so a camera that is tracking, in manual focus, focus-locked, or differs from the others lights up on its tile.

**Video.** `streams.js` starts one ffmpeg process per camera that reads `rtsp://<ip>:554/2` over TCP and outputs MJPEG. A small HTTP server bound to `127.0.0.1` re-serves each as a multipart stream that a plain `<img>` displays. Requests must carry a random per-run token and a loopback Host header. Feeds reconnect with a growing delay (2 s up to 15 s), slow viewers are cut off rather than buffered without limit, and the last ffmpeg error is shown on the tile when a feed is down.

**Settings.** `config.js` holds defaults, validation and tolerant loading. `config:set` validates, writes `config.json`, rebuilds the VISCA clients and restarts the video feeds.

**Copy to other cameras.** `copyflow.js` holds the logic for applying one camera's setting to the others (shared by several drawers); it is plain code with unit tests.

## Code layout (`src/`)
Main process: `main.js` (window, IPC, command validation), `camhttp.js` (HTTP to the cameras), `visca.js`, `streams.js` (ffmpeg video), `config.js`, `validate.js`, `preload.js` (the only bridge to the page).
The page is plain scripts that share one global scope, loaded in this order by `index.html`: `util`, `copyflow`, `core` (shared state and helpers), then one file per area
(`tiles`, `controls`, `settings`, `position`, `exposure`, `drawers`, `image`, `adv`, `color`, `presets`, `tracking`) and `app` last (start-up).
New page scripts must be added to `index.html`; lint reads that list, so it knows their shared names.

Other folders: `test/unit` (unit tests), `test/app` (end-to-end test), `scripts/` (run and build helpers), `docs/camera-notes.md` (verified camera behavior).

## Commands
| Command | What it does |
|---|---|
| `npm start` | Run the app |
| `npm run lint` | ESLint, zero warnings allowed |
| `npm test` | Unit tests (validators, config, copy logic, VISCA client, ffmpeg failures, video server) |
| `npm run test:app` | Launches the real app hidden, with a fake camera network that records writes and never touches a real camera, and checks the UI end to end |
| `npm run dist:win` | Windows portable exe in `dist/` |
| `npm run dist:mac` | Unpacked Mac app in `dist/` |

## Build and release
`ffmpeg-static` installs only the binary for the platform you run `npm install` on, so **build each platform on that platform**. The build scripts (`scripts/ffmpeg-check.js`) check that the bundled ffmpeg matches the target, both before and after packaging, and refuse to continue if it does not. In the packaged app ffmpeg is unpacked from the asar (`asarUnpack`).

**Windows:** `.github/workflows/release.yml` runs lint and unit tests, then builds the portable exe on GitHub's Windows runner and attaches it to a release. Push a tag (`git tag v0.2.0 && git push origin v0.2.0`), or use Actions > Windows release > Run workflow with an existing tag. The exe needs no Node or npm on the machine that runs it. It is not code-signed, so Windows SmartScreen may warn: choose More info > Run anyway.

**Mac:** run `npm run dist:mac` on a Mac. The app is ad-hoc signed (`scripts/adhoc-sign.js`) and includes a Local Network usage description (see below).

## Troubleshooting a tile that says NO SIGNAL
The tile shows the reason when it knows it:
- **ffmpeg not found / wrong platform**: reinstall dependencies on this platform, or set `SOTH_FFMPEG`.
- **Connection refused / timed out**: camera off, wrong address, or not on the same network.
- **Connection works but no video**: another RTSP client may be using the stream, or the camera needs a reboot (South once needed one for stuck tracking).

## Mac: packaged app freezes or shows "No route to host"
macOS blocks apps from local-network devices until they are allowed in **System Settings → Privacy & Security → Local Network**. Without it the feeds say "No route to host" and the app can freeze (beach ball) because closing the blocked sockets stalls.
The build includes the permission text and is ad-hoc signed, but macOS may still not list or prompt for it. Copy the app to /Applications, open the Local Network page, click **+**, add *SOTH Cam Control.app*, then relaunch (this fixed it on the development Mac). `npm start` always works because Electron.app is already allowed. Windows has no such permission.

## More
Verified camera behavior, command formats and gotchas: [docs/camera-notes.md](docs/camera-notes.md).
