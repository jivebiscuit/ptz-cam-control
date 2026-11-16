# Camera notes (PTZOptics Move SE)

What we learned about these cameras while building the app. Everything marked **verified** was tested on the real cameras;
**inferred** means it fits what we saw but was not proven; **not verified** means taken from PTZOptics documentation only.
PTZOptics' own docs are incomplete or contradict themselves in places, so the camera itself (and its built-in web page,
whose code shows exactly what it sends) was treated as the source of truth.

## The cameras

| | |
|---|---|
| Model | PTZOptics Move SE, SKU `PT30X-SE-GY-G3` (reports model `F64.HI`), 30x optical zoom |
| Firmware | `SOC v9.1.46` on all four (web UI `v1.5.5`) |
| Default addresses | 192.168.1.101-104 (Camera 1-4) |
| Authentication | none on HTTP or VISCA (anyone on the network can control them) |
| Built-in web page | `http://<ip>/` : reading its JavaScript (`/dist/build.his.min.js`, `/hisApplicationContext.js`) is the best way to learn what a setting really sends |

## Ways to talk to a camera

### HTTP CGI (port 80), used for basic control

```
GET /cgi-bin/ptzctrl.cgi?ptzcmd&<command>[&args]
```

| Action | Command | Notes |
|---|---|---|
| Move | `up` `down` `left` `right` `leftup` `rightup` `leftdown` `rightdown` + `&<pan>&<tilt>` | **diagonals are horizontal-first** (`leftup`, not `upleft`). Pan speed 1-24, tilt 1-20 |
| Stop | `ptzstop` | |
| Zoom | `zoomin&<s>` `zoomout&<s>` `zoomstop` | speed 1-7 |
| Focus | `focusin&<s>` `focusout&<s>` `focusstop` | speed 1-7 |
| Home | `home` | |
| Preset recall / save | `poscall&<n>` / `posset&<n>` | n = 0-254. **Do not use `poscall&0&<n>`**: the extra `0` is taken as the preset number, so every recall goes to preset 0 (verified) |

Image, exposure and color settings:

```
GET /cgi-bin/ptzctrl.cgi?post_image_value&<name>&<value>
```

| name | range | meaning |
|---|---|---|
| `luminance` `saturation` `contrast` `hue` | 0-14 | saturation % = 60 + 10 x value |
| `sharpness` | 0-16 | verified on these cameras (docs say 0-11 for other models) |
| `meter` | 0-3 | 0 Average, 1 Center, 2 Smart, 3 Top. Works in Auto / Shutter pri / Iris pri |
| `gainLimit` | 0-15 | cap on automatic gain |
| `drc` | 0-8 | dynamic range control (which direction brightens shadows: not verified) |
| `wbmode` | 0 Auto, 1 Indoor, 2 Outdoor, 3 One push, 5 Manual, 32 Color temp | |
| `rgain` `bgain` | 0-255 | **Manual** white balance only |
| `rgaintuning` `bgaintuning` | 0-20 | stored with a **+10 offset** (10 = 0, 13 = +3). Auto / One push / Color temp only |
| `colortemp` | 0-55 | an index: Kelvin = (25 + index) x 100, i.e. 2500K-8000K. Color temp mode only |
| `onepush` | `0` | starts a one-push calibration (takes up to ~15 s); One push mode only |

Reading state (all unauthenticated GET unless noted):

| URL | gives |
|---|---|
| `/cgi-bin/param.cgi?get_image_conf` | luminance (as `bright`), saturation, contrast, sharpness, hue |
| `/cgi-bin/param.cgi?get_advance_image_conf` | almost everything: `exposure_mode`, `iris`, `shutter`, `manual_gain`, `gain_limit`, `meter`, `drc`, `antiflicker`, `wb_mode`, `rgain`, `bgain`, `rgain_tuning`, `bgain_tuning`, `temperature`, `focus_mode`, `focus_mode_status` ... **Spelling matters: `advance`, not `advanced`** (the wrong spelling is a 404) |
| `/api/v1/information` | device id, model, SKU, firmware |
| `/api/v1/control/track` | tracking settings (JSON), see Tracking below |
| `/api/v1/control/mode`, `/api/v1/speeds` | preset tour settings; manual speeds and Motion Sync |
| `/cgi-bin/param.cgi?get_tally_status` | tally, standby, privacy, `objs` (see Tracking) |
| `POST /cgi-bin/param.cgi?get_path` body `path=/data/preset_param.conf` | the Image Presets switch (`isp_switch`) |

Other writes: `POST /cgi-bin/param.cgi?post_visca` with body `len=7&visca=0x81,0x0a,0x11,0x26,0x02,0x0V,0xff` sets the
Image Presets switch (V = 0 off, 1 on). `POST /cgi-bin/param.cgi?post_reboot` reboots the camera (it was back in about 15 s).

### VISCA over TCP (port 5678), used for focus control and a few settings

Raw VISCA bytes, **no IP header** (verified). UDP port 1259 did not answer. Each camera keeps one session; **two programs
connected to the same camera at once cause inquiry time-outs** (seen when a test script ran beside the app), which is why
the app only allows one running copy.

Used by the app: pan/tilt drive `81 01 06 01 VV WW xx yy FF`, zoom `81 01 04 07 ..`, home `81 01 06 04 FF`, presets
`81 01 04 3F 01|02 pp FF`, autofocus `81 01 04 38 02|03 FF`, one-push AF `81 01 04 18 01 FF`, focus lock
`81 0A 04 68 02|03 FF`, exposure mode `81 01 04 39 xx FF` (00 auto, 03 manual, 0A shutter pri, 0B iris pri, 0D bright),
iris/shutter direct `81 01 04 4B|4A 00 00 0p 0q FF`, anti-flicker `81 01 04 23 0p FF` (0 off, 1 50 Hz, 2 60 Hz).
Position inquiries: pan/tilt `81 09 06 12 FF`, zoom `81 09 04 47 FF`.

### Video

| Stream | URL | Codec | Measured |
|---|---|---|---|
| Main | `rtsp://<ip>:554/1` | H.264 1920x1080 30 fps | ~8.6 Mbit/s each (the app does not use it) |
| Sub | `rtsp://<ip>:554/2` | H.264 640x360 30 fps | ~2.2 Mbit/s each; all four within 2.15-2.19 even with different scenes, so probably constant-bitrate (inferred) |

`/snapshot.jpg` works normally (~20-50 KB). **An empty (0-byte) snapshot was the first sign of one camera's stuck tracking
engine** (see Tracking).

## Scales and tables (verified on the cameras)

**Position units.** Pan -2448...+2448, tilt -432...+1296, zoom 0...16384; 14.4 units = 1 degree on both axes (pan +-170 deg,
tilt -30 to +90 deg); positive = right / up; Home is 0,0. The camera's zoom position is not linear in magnification. The
app's "about N x" readout is a straight-line estimate from 1x to 30x and is only approximate.

**Iris** (the camera's own list): 0 Close, 6 F11, 7 F9.6, 8 F8, 9 F6.8, 10 F5.6, 11 F4.8, 12 F4, 13 F3.4, 14 F2.8, 15 F2.4,
16 F2, 17 F1.8 (widest). The same step numbers work over VISCA and HTTP. The readout is the iris *setting*; whether the lens
really delivers F1.8 when zoomed far in is not verified (many zoom lenses cannot).

**Shutter** (the camera's own list): 1 = 1/30, 2 = 1/50, 3 = 1/60, 4 = 1/100, 5 = 1/125, 6 = 1/200, 7 = 1/250, 8 = 1/350,
9 = 1/500, 10 = 1/725, 11 = 1/1000, 12 = 1/1500, 13 = 1/2000, 14 = 1/3000, 15 = 1/4000, 16 = 1/6000, 17 = 1/10000.
Only step 1 (1/30) and step 3 (1/60) were confirmed against a live camera; the rest follow the list order.

## Findings and gotchas

### Presets
- **Image Presets switch.** When it is **on**, recalling a preset also applies the color/exposure settings saved with it
  (verified: luminance, saturation, contrast, sharpness, tuning, color temperature, shutter, gain limit, meter and DRC all
  changed). When **off**, a recall moves pan/tilt/zoom/focus only (verified). **A preset saved while the switch is off still stores
  the image settings** (verified), so the switch only decides whether they are applied; it does not strip them. All four cameras
  are set **off**.
- **Preset speed does nothing for normal recalls.** The "preset speed" setting (`presetSpeed`, 1-24) and per-call speeds
  (`poscallwithspeed`) made no difference to how fast a recall moves (verified); the setting appears to belong to the preset tour.
- **Motion Sync** (on by default) times pan, tilt and zoom to arrive together. With it on, a long move took ~6.8 s; with it
  off ~4.1 s (verified on one move). Off looks less smooth (axes finish at different times, not evaluated on screen). It is
  currently left **on**; it is a camera-wide setting, so it also applies to joystick recalls.
- Slot 200 on one camera stores the Home position (a leftover from testing the save command).

### Exposure
- After switching the exposure mode, iris/shutter commands sent in the next few seconds can be ignored by the camera
  (observed; roughly 4 s dead time, inferred). The copy buttons wait and retry for this reason.
- Mode summary: Shutter priority fixes the shutter; iris and gain are automatic. Anything adjustable depends on the mode.
- Flicker: 60 Hz lights need a shutter that is a multiple of 1/120 s at 30 fps, such as 1/60 or 1/30; the cameras run 1/60.

### White balance
- Manual gains 60 / 160 are the settings we settled on. One-push calibrates to what the camera sees; **the calibrated gains
  cannot be read back**, so there is no way to copy a one-push result to another camera.
- Auto white balance is thrown off by large areas of warm wood (the cameras facing the wood looked tinted; the one facing
  neutral walls did not).

### Focus
- `focus_mode` 2 = auto, 3 = manual; `focus_mode_status` is `lock` / `unlock`. Focus lock blocks other focus commands (per
  the docs; not tested).

### Auto tracking (Move SE)
- The Move SE offers: Auto Tracking, Auto Framing, time delay, start/stop location, target-loss timeout and preset, tracking
  overlay. **No target selection, composition, sensitivity, zoom level or tilt lock**: those are Move 4K features and the
  camera rejects them (verified for the ones we tried). The object list in `get_tally_status` (`objs`) stayed empty on the SE.
- REST: `GET/POST /api/v1/control/track` with JSON `{trackMode: "off"|"tracking"|"autoframe", delayTime: 1-60,
  lossTime: 6-60, startPosition / stopPosition / lossPosition: "now"|"home"|"<preset 0-254>", trackingOverlay: "on"|"off"}`.
  Out-of-range values answer `{"msg":"RequestError"}`. The joystick-style `param.cgi?set_overlay&autotracking&on|off` just
  sets `trackMode` to `tracking` / `off`.
- The camera picks the person itself, so a poster with printed people can attract it (one camera locked onto a wall poster).
  The documented way to bias it is a start preset aimed where the speaker stands and a short target-loss timeout (3-6 s).
- **One camera's tracking once stopped working entirely** (no response in either mode, `snapshot.jpg` returned 0 bytes) while its
  settings matched the others; a reboot fixed it.
- Tracking is deliberately **never applied to more than one camera** in the app.

### Network
- The app uses about 8.7 Mbit/s for the four sub-streams and a few kilobits per second for control (measured). The Mac used
  for development was on 2.4 GHz Wi-Fi; latency spikes of 100-150 ms were seen, with no packet loss. Production uses Ethernet.
- ffmpeg-static ships one binary per install platform, so a Windows build must be made on Windows (the build scripts check).
