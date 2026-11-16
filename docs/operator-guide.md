# PTZ Cam Control: operator guide

For the person running the cameras during a livestream. No technical background needed.
For building or changing the app, see the [README](../README.md).

## Contents
1. [Starting the app](#starting-the-app)
2. [The screen](#the-screen)
3. [Choosing and moving a camera](#choosing-and-moving-a-camera)
4. [Focus](#focus)
5. [Presets](#presets)
6. [Scenes](#scenes)
7. [Auto tracking](#auto-tracking)
8. [Exposure, Image and Color](#exposure-image-and-color)
9. [Warnings on the tiles](#warnings-on-the-tiles)
10. [Working with an ATEM switcher](#working-with-an-atem-switcher)
11. [Settings](#settings)
12. [Updates](#updates)
13. [Keyboard shortcuts](#keyboard-shortcuts)
14. [When something goes wrong](#when-something-goes-wrong)

## Starting the app
Open `PTZ-Cam-Control-portable.exe`. It needs no installation. The first time, Windows SmartScreen may warn that the app is from an unknown publisher: choose **More info**, then **Run anyway**.

Only one copy can run at a time. Opening it again just brings the existing window to the front.

The computer must be on the same network as the cameras. On first use, open **⚙ Settings** and check that each camera's name and address are right (see [Settings](#settings)).

## The screen
- **Video grid (left):** one tile per camera, labelled with its number, name and address.
- **Drawers (middle, hidden until opened):** Exposure, Image, Color and Tracking. Opening one makes the video grid a little smaller.
- **Control panel (right):** the selected camera's name, the drawer buttons, scenes, speed sliders, the move pad, zoom, focus, tracking, presets, and a status line at the bottom.

Everything in the control panel acts on the **selected** camera, the one named at the top of the panel. Click a tile, or press `1`–`4`, to select a camera.

## Choosing and moving a camera
- **Pad:** hold an arrow button to move; let go to stop. The ⌂ button sends the camera Home.
- **Zoom − / +:** hold to zoom out or in.
- **Speed sliders:** Pan, Tilt, Zoom and Focus each have their own speed. Lower is slower and smoother. They also set the speed for the keyboard keys.
- **Position readout:** shows the camera's current pan, tilt and zoom.

## Focus
- **Focus near / far:** hold to adjust by hand.
- **AF mode Auto / Manual:** Auto lets the camera focus itself. Manual keeps the focus where you put it.
- **🔓 Lock:** freezes the current focus so the camera stops "hunting". Press again to unlock. A locked camera shows a **FOCUS LOCKED** badge on its tile so it is not forgotten.

## Presets
A preset is a saved camera position (pan, tilt, zoom and focus). The panel has presets **1–10** for the selected camera.

- **Recall:** click a number. The camera moves there.
- **Save:** aim the camera where you want it, then **shift-click** the number, or **press and hold it** for about a second. The status line confirms the save.

Saving over a number replaces what was there. Presets live in the camera, so they stay when the app is closed.

## Scenes
A scene is a named button that recalls a preset on **every camera at once**, for example "Wide", "Closeup" or "Panel".

- Press a scene button and all cameras in it move together. The button stays highlighted while the cameras remain where the scene put them.
- If you move a camera yourself afterwards (by hand, by tracking, or with a preset), the highlight clears, because the scene no longer matches what viewers see.
- A camera left blank in a scene is not moved.

**Setting scenes up:** open **⚙ Settings**, go to *Scenes*, click **+ Add scene**, give it a name, and type a preset number (1–254) for each camera. You can have up to 12 scenes. Save the presets on the cameras first, then build the scene from their numbers.

## Auto tracking
Open the **Tracking** drawer. Tracking always applies to the selected camera only, never to all cameras.

- **Off / Auto tracking:** turns tracking on or off. The panel also has a quick **Tracking Off / Track** switch.
- **Start at / Stop at:** where the camera goes when tracking starts and stops: stay where it is (*Track Now*), go *Home*, or go to a *Preset*.
- **Delay:** how many seconds the camera waits after you switch tracking on before it starts following.
- **Wait / Then go to:** if the camera loses the person it is following, how long it waits before doing something (6–60 seconds), and what it does (stay, go Home, or go to a preset).
- **Tracking overlay:** draws the camera's tracking box on its own video output. It does not change how it tracks.

**Tips for a steady result:** the camera chooses whom to follow, and you cannot pick the person. Save a preset aimed where the speaker normally stands, zoomed out to show face and body. Use it for both *Start at* and *Then go to*, with a wait of about 3–6 seconds.

A tracking camera can be fooled by posters or screens that show people. Check the tile if the camera drifts toward something unexpected.

## Exposure, Image and Color
These drawers change how the picture looks. Hover over any label for a plain-language explanation.

- **Exposure:** mode (Auto, Manual, Shutter priority, Iris priority), iris, shutter, gain, plus auto-exposure settings such as the metering area and anti-flicker (choose 60 Hz in the US, 50 Hz in much of the rest of the world, to stop lights pulsing on camera).
- **Image:** luminance, saturation, contrast, sharpness and hue.
- **Color:** white balance mode and its settings. **One-push calibrate** measures the scene once: point the camera at something white or neutral in your lighting first, then press it and wait up to about 15 seconds.

**Reading the values:** each setting shows the selected camera's value. The line underneath shows every camera's value, and an **orange** value means that camera differs from the selected one. Sliders send their value when you let go.

**Matching cameras:** two ways to make the cameras look the same:
- **Copy to other cameras** (bottom of each drawer): copies the selected camera's settings to the others. The status line reports any camera that did not take a value.
- **Apply changes to all cameras** (top of each drawer): while ticked, every change you make goes to all cameras and the drawer shows a warning. It switches itself off whenever you open, close or change drawers, so you never carry it by accident.

## Warnings on the tiles
Tiles show badges when a camera is in a state you may not intend:
- **Tracking is on**
- **Manual focus**
- **FOCUS LOCKED**
- **Values that differ from the other cameras**, shown in orange in the drawers
- **NO SIGNAL**, with the reason underneath

If a tile shows NO SIGNAL, read the reason. "Connection refused" or "timed out" usually means the camera is off, has the wrong address in Settings, or is on a different network.

## Working with an ATEM switcher
This is optional. Enter the switcher's address in **⚙ Settings**, and the ATEM input each camera is plugged into. The app only **reads** from the switcher and never changes it.

Tiles then show a red **PGM** (Program, on air) or green **PVW** (Preview) badge. This protects what viewers see:

- **Scenes never move the camera that is on air.** Its move is held and the scene button turns **amber**. As soon as that camera leaves Program, the move is sent.
- **Pressing another scene, or moving the camera yourself, cancels a held move.**
- **Preset buttons ask first** before moving a camera that is on air. Answer **OK** only if you really mean it.
- A **Preview** camera moves normally.
- **If the switcher cannot be reached**, a warning appears in the panel and scenes move every camera, including the one on air. Held moves wait for the switcher to come back rather than being sent blind.

Only the first mix effect's Program and Preview are read. A camera shown through a keyer or picture-in-picture is not detected as on air.

## Settings
Click **⚙** at the top of the control panel.

- **Cameras:** a name (1–24 characters) and a network address for each camera. Up to four cameras.
- **Scenes:** see [Scenes](#scenes).
- **ATEM switcher:** see [Working with an ATEM switcher](#working-with-an-atem-switcher). Leave the address blank to turn it off.

Press **Save** to apply. A mistake (for example an invalid address) keeps the window open and tells you what to fix. Settings are stored in the app's user-data folder, so they survive restarts.

## Updates
The app looks for a newer version each time it starts. It stays quiet unless one exists, in which case it offers to open the download page. You can also check by hand from the menu bar: **Help → Check for Updates…**.

Updating is manual: download the new `.exe` from the page that opens, close the app, and replace the old file with it. Your settings are kept.

## Keyboard shortcuts
Shortcuts are ignored while you are typing in a field or while Settings is open.

| Key | Action |
|---|---|
| `1`–`4` | Select that camera |
| Arrow keys | Pan/tilt (hold to move, release to stop) |
| `+` / `-` | Zoom in / out (hold) |
| `Space` | Stop moving |
| `H` | Send the selected camera Home |
| `Esc` | Close the open drawer |

## When something goes wrong
| What you see | What to try |
|---|---|
| A tile says NO SIGNAL | Read the reason on the tile. Check the camera has power and a network cable, and that its address in Settings is right. |
| NO SIGNAL but the camera answers controls | Another program may be using that camera's video. Close other viewers, or restart the camera. |
| A camera does not respond to controls | Only one control program can talk to a camera at a time. Close other camera-control software, then wait a few seconds. |
| A camera ignores tracking or stops responding | Restart the camera (power off and on). This has fixed stuck tracking before. |
| A scene button is amber | A camera in it is on air; the move is waiting until that camera leaves Program. |
| "ATEM not connected" in the panel | Check the switcher's address and network. Until it reconnects, scenes will move the camera on air. |
| "Copied, but still different" after Copy | Some camera refused a value. The message names which. Try that setting on the camera by hand. |
| Windows says the app is unrecognized | Choose **More info → Run anyway**. The app is not code-signed. |
