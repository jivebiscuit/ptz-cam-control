# PTZ Cam Control

Electron desktop app that controls and monitors up to four PTZOptics Move SE cameras during a livestream (multiview, VISCA/HTTP control, scenes, optional read-only ATEM link). The README has the full architecture; `docs/camera-notes.md` has verified camera behaviour; `docs/operator-guide.md` is the end-user guide.

## Commands
- `npm start` runs the app. Use it instead of `electron .`: VS Code terminals set `ELECTRON_RUN_AS_NODE=1`, which makes Electron exit silently.
- `npm run lint` (zero warnings allowed), `npm test` (unit), `npm run test:app` (launches the real app hidden against a fake camera network). Run all three before committing.
- `npm run dist:win` builds the portable exe (Windows only; builds are per-platform because of ffmpeg-static).

## Conventions
- Main process is CommonJS. The page is plain classic `<script>` files sharing one global scope, loaded in the order listed in `src/index.html`. A new page script must be added to that list; the lint config reads it.
- The renderer is untrusted. Every IPC value is range-checked in `main.js` / `validate.js` before it reaches a camera. Keep `contextIsolation` on, `nodeIntegration` off, `sandbox` on.
- Tracking is never applied to more than one camera. The ATEM link is read-only: never send anything to the switcher.
- Camera facts in `docs/camera-notes.md` are marked verified / inferred / not verified. Keep that distinction.
- Tests must never touch a real camera. `test/app/run.js` fakes the network; the unit tests that use a fake POSIX ffmpeg are skipped on Windows.
- Update the README, operator guide and tests when behaviour changes.

## This repo is public
- Keep it generic: no venue, organisation or personal names, no real IPs, no secrets or tokens. Defaults are Camera 1-4 at 192.168.1.101-104.
- Commits use the GitHub noreply address.

## Workflow
- `main` is protected: change it through a branch and a pull request that the owner approves. Don't push to `main` or force-push.
- Releases are built by hand on Windows: bump the version with `npm version X.Y.Z --no-git-tag-version`, run the three checks, `npm run dist:win`, tag `vX.Y.Z`, then `gh release create vX.Y.Z dist/PTZ-Cam-Control-portable.exe`. The app's update check reads the latest GitHub release and compares its tag to `package.json`, so the tag must match the version.
- The update check (`src/updater.js`) only notifies; it never downloads or installs.
