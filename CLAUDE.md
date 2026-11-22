# Gunport

A retro first-person turret-gunner game for the web: you sit in a gun turret looking out through an octagonal window, swing a four-barrel laser cannon around a cone in front of your ship, and fight off a wing of four enemy fighters. Everything is drawn with **Phosphor3D**, the owner's own 90s-style wireframe/solid-fill polygon renderer for HTML5 Canvas. The game is inspired by a famous film scene of gunners defending their ship from fighters, but the models, sounds and code are the owner's own.

- Hosted snapshot: https://engineersneedart.com/gunport/ (the owner updates it by hand).
- Status: feature-complete for a first release; the next step is a day or so of polish toward 1.0.

## Folder layout: Gunport needs Phosphor3D beside it

```
<parent folder>/
  Gunport/       this repo
  Phosphor3D/    the renderer: its own repo, github.com/EngineersNeedArt/Phosphor3D
```

The game imports `../Phosphor3D/*.js` directly, so **both repos must be cloned into the same parent folder**. The game uses Phosphor3D features added during this work (hidden edges, billboard faces, per-face colours, `Camera.projectViewPoints`), so Phosphor3D must be up to date too.

## Working across two machines

The owner works on this project from two Macs, with GitHub as the shared copy. Conversation history and Claude's memory don't travel between machines; this file and the repos do.

- **At the start of a session:** `git pull` in both `Gunport` and `../Phosphor3D` before doing anything else. If either has uncommitted local changes, say so and ask before pulling.
- **When the owner wraps up for the day or says they're switching machines:**
  1. Update the "Where things stand" section below: what was done, what's in progress, what's next.
  2. Commit and push both repos (Phosphor3D only if it changed).
  3. Confirm both are pushed and clean.

### Where things stand

Feature-complete for a first release; polishing toward 1.0. As of 2026-11-21:

- **Done today (second machine):** difficulty pass. Our fire rate halved, enemy hits do triple damage, three waves of four with enemy fire speeding up each wave, a "WAVE n" banner, and a white bezel flash on each hit. Details under "Game rules and tuning knobs".
- **Playtest:** the owner played four games: lost, won at 100% hull, lost, won at 4%. Close games that swing both ways, which the owner enjoyed; leave the tuning alone unless asked.
- **Next session (planned to wrap up 1.0):** a "targeting computer" that replaces the small edge triangles showing where off-screen enemies are (`drawOffscreenArrow` in `main.js`). Design not discussed yet: ask the owner how it should look and behave before building.
- Also open: the ideas at the end of this file.

## Running it

ES modules need HTTP, not `file://`. From anywhere:

```bash
python3 Gunport/tools/serve.py        # serves the PARENT folder on port 8123
```

Then open http://localhost:8123/Gunport/ (the game) or http://localhost:8123/Gunport/viewer.html (model viewer; add `?model=models/bezel.json` for another model).

- `serve.py` sends `Cache-Control: no-store` and listens on both IPv4 and IPv6 (Safari tries `::1` first). It refuses to start if the port is in use: stop the old server first.
- If the browser seems to run old code anyway (most often Safari, e.g. "x is not a function" for a method that exists), empty the cache: Safari Develop > Empty Caches (Opt-Cmd-E), then reload.
- `.claude/launch.json` (a plain `http.server` config) is old and unused; `serve.py` is the one to use.

There's no build step, package manager or test suite. Changes are checked by small Node scripts (`node --input-type=module -e "..."`, importing the game's modules directly) and by loading the page.

## Working with the owner

- The owner is an experienced programmer and the author of Phosphor3D, new to Claude Code. They like explanations of how things work and their trade-offs, then concise changes.
- **Hand-edited files: don't regenerate them.**
  - `models/fighter.json` is the owner's own hand-tuned model. `tools/make-fighter.mjs` would overwrite it, so never run it.
  - Their recorded sounds live in `sounds/`, wired up in `SAMPLE_FILES` at the top of `sound.js`.
- **Indentation is tabs.** The owner's editor strips whitespace from blank lines, so re-read a file before editing it.
- **Testing in an in-app or automated browser:** the game makes sound once the intro is dismissed. Either leave the intro up, or switch audio off in the page first (`window.AudioContext = undefined; window.webkitAudioContext = undefined;`) before pressing Enter. Close the tab when done, or it keeps playing.
- **Phosphor3D changes** (hidden edges, billboards, per-face colours) were made at the owner's request. Keep that library general-purpose, not game-specific.

## Coordinates and rendering: the parts that bite

- **World:** +x right, +y up, +z straight out from the ship (the middle of the turret's reach). The turret, and the camera, sit at the origin.
- **Phosphor3D's Matrix4 is row-vector** (`v' = v * M`): operations apply in the order written. `Model3D.localMatrix()` is its own transform, then `parent.localMatrix()`.
- **Coordinate frames are parents:** anything with a `localMatrix()` method can be a model's parent (`coordinateFrame(fn)` in `renderer.js`). The game uses three:
  - `worldFrame`: `turret.viewMatrix()`, for things in space.
  - `gunFrame`: `turret.gunMatrix()`, for the cannon, which turns exactly with the aim.
  - `cockpitFrame`: `turret.cockpitMatrix()`, for the window bezel, which lags the aim by 12% (`BEZEL_TILT`), both up/down and left/right.
- **The camera** stays at the origin with no rotation and only does the perspective; the turret's rotation is in the view matrix.
  - Phosphor3D's native screen mapping shows +x as screen-left and +y as screen-down, so the view matrices end with `rotateZ(π)`.
  - A point is in front of the camera when its view z > 0.
- **No near-plane clipping:** a face with any vertex behind the camera is dropped entirely. That's why long shapes near the camera get split up.
- **Winding:** a face is front-facing when its vertices run counter-clockwise as seen by the viewer. Equivalently, the plain cross product `(b - a) x (c - a)` of the first three vertices points INTO the model. The generator scripts orient faces automatically.
- **Faces close** by repeating the first vertex at the end; otherwise the last edge isn't stroked.
- **`faces2` entries** are objects: `{ vertices, doublesided, hiddenEdges, billboard, fill, stroke }`. A model uses `faces2` or `faces`, never both.
  - `hiddenEdges`: edge *i* runs from `vertices[i]` to `vertices[i + 1]`.
  - `billboard`: the face always turns flat to the screen (only its centre is transformed). The fighter's ball and the explosion fireballs use it.
  - `fill` / `stroke`: per-face colour overrides; `null` means none.
- **Sorting:** painter's algorithm, sorted ascending by depth, with two-vertex faces drawn as lines. Draw passes run back to front:
  1. stars
  2. one shared sort for fighters, explosions and all bolts
  3. the cannon
  4. the bezel
  5. reticle, edge arrows, mouse marker, hit flash, HUD, end screen
- **Stars** are directions at infinity (w = 0) with motion-blur streaks computed in view space (`starfield.js`). Blur is always on.

## Files

| File | What it does |
|---|---|
| `main.js` | Setup, input (arrows/WASD, joystick-style mouse, Space/click to fire), combat, hull/damage, intro, game states, drawing, HUD, main loop |
| `turret.js` | Pan/tilt limited to ±70° each (`PAN_LIMIT`, `TILT_LIMIT`), easing to a stop at the limits; `viewMatrix`, `gunMatrix`, `cockpitMatrix`, `axes()` |
| `fighter.js` | Enemy flight: arrives 200 units out (`ARRIVAL_DISTANCE`) flying inward, then waypoints in front of the ship (loiter 35–130 units out, or a close strafing pass), turning at a limited rate; 2 hits to destroy |
| `wing.js` | One game = 3 waves of 4 fighters, 4 s apart within a wave; no replacements; the next wave comes 3 s after one is cleared |
| `guns.js` | Our cannon fire: pairs alternating top/bottom from the barrel tips, converging 45 units out |
| `bolt.js` | A laser bolt (ours or theirs) as glow and core line models; swept hit test; shared vector helpers |
| `enemyfire.js` | Fighters fire bursts of green bolts when lined up on us; aim spread decides hits and misses |
| `cannon.js` | Cannon body and four barrels in gun space; recoil (fast snap back, slow return); muzzle positions for `guns.js` |
| `explosion.js` | Destroyed fighter: tumbling face shards, sparks, and 3–5 billboard fireballs that balloon out and fade |
| `sound.js` | Web Audio: positioned one-shots (pan, distance falloff, `falloff: Infinity` = no falloff) and a looping engine per fighter (pan, level, muffling, exaggerated Doppler); built-in synthesized fallbacks for every sound; recordings in `SAMPLE_FILES` |
| `renderer.js` | Loads Phosphor3D JSON models; draws a list of models with one depth sort (honours hidden edges) |
| `starfield.js` | 400 seeded stars with brightness, plus motion-blur streaks |
| `index.html` | Canvas plus the intro screen. Dismissing it with a click or key is what lets the browser play sound |
| `viewer.html`, `viewer.js` | Model viewer: arrows turn and zoom, Shift-arrows tilt, Space spins, W toggles wireframe, R resets |
| `models/` | `bezel.json`, `cannon-body.json`, `cannon-barrel.json` (generated); `fighter.json` (hand-edited: see above) |
| `tools/` | `serve.py` (dev server); `make-bezel.mjs` and `make-cannon.mjs` regenerate their models; `make-fighter.mjs` is the original generator, now superseded by the hand-edited JSON |
| `sounds/` | The owner's recordings (WAV) |

## Game rules and tuning knobs (current values)

- **Wing:** 3 waves of 4 fighters, 4 s apart, the next wave 3 s after one is cleared (`new Wing({ waves: 3, size: 4, interval: 4, pause: 3 })` in `main.js`). A "WAVE n" / "FINAL WAVE" banner shows as each begins. Clear all three for VICTORY; at 0% hull it's SHIP DESTROYED. Enter or a click starts a new game.
- **Our fire rate:** one pair every 0.28 s while the trigger is held (`FIRE_INTERVAL` in `guns.js`); a fresh press fires at once.
- **Hull:** 100 points, 6 per enemy hit, so 17 hits to lose (`HIT_DAMAGE` in `main.js`). Each hit brings a screen flash, the bezel lit white for 1/30 s (`BEZEL_FLASH_TIME`), a cockpit jolt and a sound.
- **Enemy fire** (`enemyfire.js`): fires from 10–90 units when its nose is within 15° of us, in bursts of 3 pairs, pausing 3–6 s times `pauseScale`, which `main.js` sets per wave from `WAVE_FIRE_PAUSE` = [1, 0.7, 0.5], so later waves fire more often. Aim spread 8 against a ship radius of 3, so about 3 in 8 hit.
  - Simulation (not play) put it at about 30 s of hull against all four if you never shoot back. The owner may have tuned these since; read the file.
- **Sound volumes** are set where each sound is played, in `main.js`. Explosions play at full volume at any distance; our laser plays at 0.18.

## History, briefly

Built up in one long session:
1. starfield and turret controls
2. motion blur
3. mouse steering
4. window bezel, plus hidden edges added to Phosphor3D
5. fighter flight
6. shooting
7. hits and explosions
8. billboards and per-face colours added to Phosphor3D
9. the owner's fighter model
10. the laser cannon with recoil
11. limited pan/tilt cone
12. enemy fire and hull damage
13. sound, then the owner's recordings
14. fireballs
15. a fixed wing of four with win and lose screens
16. (second machine) slower fire rate, triple hull damage, three waves with faster enemy fire, bezel hit flash

A ring of hull "skyline" panels was tried and removed: the owner decided the ship's own hull wouldn't be visible from the turret.

Ideas raised but not done:
- a lead marker on the HUD
- a muzzle flash at the barrel tips
