# Spacecraft cockpit

First version, validated 15 November 2026. The landscape-only spacecraft button
retains the header and icon bar, replacing the exploration interface with an
original SVG canopy and glass instruments. No external artwork or dependencies.

## Camera and lifecycle

`Camera` owns a separate `Flight` state. Entry copies the current eye and heading,
cancels unfinished angular travel, and stores the regular camera state. Drag uses
the existing sensitivity, pitch limits and angular smoothing, but rotates about
the spacecraft's position. The craft-fixed canopy and instruments stay aligned
with this pilot view. There is no roll or separate head-look control.

Exit restores the stored orbit parameters and focus offset relative to the
selected body's current position. This intentionally returns to the original
exploration view rather than trying to infer an orbit from the flight position.
The toggle, Escape, and portrait transition all use the same exit path.

Exploration panels are temporarily hidden and `main` is inert. Existing panel
visibility, selected body, playback state, and saved display preferences survive.
Settings/About close on entry; their buttons and the information toggle remain
in the header but are disabled during flight. Fullscreen and the cockpit exit
remain available. Tab uses ordinary focus navigation in this mode.

WASD and E/Q are held-key input using physical `KeyboardEvent.code` values.
W/S, A/D and E/Q cancel independently; combined three-axis input is normalized.
E moves up and Q moves down along the spacecraft's local up vector, including
when pitched. Vertical thrust uses the same acceleration/braking response and
shares the overall 4 display units/sec cruise limit. Wheel/pinch zoom, scene
picking, double-click overview, and regular playback/navigation shortcuts cannot
take over the flight camera. Forms, editable content, dialogs and modified key
chords do not receive movement bindings. Key repeat cannot restart cleared input.
Blur, visibility changes, page hiding and mode exit clear velocity and keys.
Gesture cancellation releases captured pointers without producing a tap.

## Flight tuning

All constants are in `docs/src/flight.js`, in compressed display units rather than
physical kilometres. Flight uses the frame delta independently of the simulation
clock and continues while playback is paused.

- Cruise limit: 4 display units/sec in every view, including planetary close-ups.
  Entry-distance scaling was removed after the slower version proved too slow;
  the pilot now gets the same cruise limit wherever cockpit mode is entered.
- Velocity approaches the requested camera-local movement vector exponentially,
  with acceleration response 3.5/sec (95% in about 0.86 sec).
- With zero resolved movement input, braking matches acceleration at 3.5/sec
  (95% speed reduction in about 0.86 sec). Tiny remaining velocity snaps to zero below
  0.0001 display units/sec. Focus loss stops immediately.
- Both velocity and displacement use the exact exponential integral for a fixed
  heading, so frame partitioning does not change straight-line travel. Changing
  heading smoothly redirects thrust while existing world-space velocity settles.
  Deltas are capped at 50 ms, matching the app's suspension/stall policy.

There is no collision response, altitude hold, or physical orbital flight model.
The speed/heading/pitch readouts report actual camera/flight state. The canopy
and holograms are craft-fixed vector/CSS artwork, not a free-look 3D cockpit
interior. The dashboard has small animated display details.

## Flight deck redesign

The reference image supplied by the user informed the construction and lighting,
not a traced layout or copied artwork. The original canopy is now a separate,
locally served `docs/assets/cockpit-frame.svg`: layered spars, machined mounting
clamps, slotted fasteners, recessed channels, vents and a bevelled dashboard.
These are vector surfaces with bounded material patterns; there are no image
textures, SVG turbulence filters or full-window blur effects. The physical finish
is neutral matte gunmetal, with cyan retained for projected and emissive displays.

Three monitors sit on the lower deck. Left/right share the same case, glass,
bezel, typography, colour and switch detailing, with mirrored perspective. The
centre console carries the existing flight state and controls. Their content is
actual flight telemetry: signed forward/lateral/vertical velocity, heading and
pitch. The horizon display follows pitch. Readouts reuse the existing 10 Hz
cockpit update, with DOM elements cached once at startup. The small trace on the
right is decorative telemetry activity, not a sensor or historical measurement.

The reticle, heading ruler, speed/cruise display, pitch and cyan orbital guides
remain on the glass. The large circular HUD graphic from the reference was not
introduced. All cockpit artwork remains transparent to pointer input. Compact
landscape has a taller centre console to retain the steering/exit hints; portrait
still exits the mode and restores the explorer.

Only the narrow telemetry sweep (transform) and input-link lamp (opacity)
animate continuously. They are bounded inside their monitors. Animation applies
only while the cockpit is active and the document is visible. Reduced-motion
preferences disable both; the verification page also exposes a static-motion
preview using the same unanimated treatment. Live flight readouts still work.

### Redesign validation and cost

`/cockpit-verify.html` provides a fixed paused overview with Performance quality,
alternating static/animated runs, compact/portrait presets and a static-motion
preview. It restores saved preferences after fixture setup. Each sample uses
45 warm-up frames and 240 measured frames. Its repeat-run setup also restores
the overview before sampling. Browser frame intervals and app CPU work are
reported separately from WebGPU draw counts. These are not isolated GPU or
browser-paint timers; the animation comparison holds WebGPU scene work constant.

Native-density results: 1280 × 800 CSS viewport, DPR 2, 1344 × 840 rendering target.
Raw measurements are in [COCKPIT-REDESIGN-RESULTS.json](COCKPIT-REDESIGN-RESULTS.json).

| Treatment | Median frame interval | p95 interval across batches | Draws |
| --- | --- | --- | --- |
| Original cockpit | 16.7 ms | 17.3–17.4 ms | 3 |
| Redesigned, static | 16.7 ms | 17.4–17.5 ms | 3 |
| Redesigned, animated | 16.7 ms | 17.4 ms | 3 |

The native runs reported no intervals above 25 ms, no long-animation-frame
entries and no GPU validation errors. Median app CPU samples were 0.15–0.17 ms
after redesign; these exclude paint and GPU execution and do not establish a
CPU performance improvement. The optional animation showed no meaningful frame
regression in this fixture, so it is enabled. A separate DPR 1 comparison is
retained in the raw data; one animated batch had four intervals above 25 ms,
which did not recur in the native-density run. These are workstation results,
not a guarantee for all hardware.

Relevant checks: 12 flight tests passed; the canopy SVG parses and HTML IDs are
unique; `git diff --check` passed. Browser checks cover desktop and 844 × 390
landscape, 390 × 844 portrait restoration, static animation treatment, actual
E/Q instrument readings, dragging through a monitor, Escape restoration, bright
Earth and Saturn close-ups, low-angle viewing and the clear overview window.
The renderer and flight tuning are unchanged by this redesign.

### Sun-responsive materials

`docs/src/cockpit-lighting.js` loads the local canopy SVG inline so its material
gradients can be lit. The SVG is explicitly revalidated on load; the texture
asset cache must not retain an older canopy layout or colour palette.

The Sun's actual direction is transformed into the camera's right/up/forward
frame. Representative normals light the left/right inner spars independently,
the roof underside, deck, rim and mounting metal. The monitor casings use the
same directional model, with subtle warm glass reflections; their screen pixels
and HUD remain emissive. Turning away from the Sun leaves a neutral ambient
fill. Moving changes the light direction and an intentionally gentle display-
scale distance falloff. Spherical foreground worlds soften the sunlight across
an approximate projected solar disc. This is an illustrative facet model, not a
normal-mapped 3D interior; it does not cast strut shadows or trace ring opacity.

Lighting is sampled at most 30 Hz only in cockpit mode, reusing numeric state.
Material paints are skipped when the direction/intensity has not meaningfully
changed. No WebGPU draw or full-screen lighting loop was added. The two small
decorative screen animations retain the static/reduced-motion treatment above.

After the final neutral-material/cache update, a native-density moving-flight
comparison gave 16.7 ms median frame intervals, 17.6 ms p95, three WebGPU draws,
and no intervals above 25 ms or GPU validation errors. App CPU sample medians
were 0.21–0.22 ms. Four 240-frame batches held E along identical reset trajectories,
exercising actual sunlight/material changes with display animation off/on.
The raw result is `sunlight_gunmetal_moving` in the linked JSON.

`bun test tests/cockpit-lighting.test.js tests/flight.test.js`: 16 passed.
Lighting checks cover camera-relative Sun direction, opposite-facet response,
foreground occultation transitions, distance changes and finite edge cases.

## Rendering and validation

The SVG/CSS cockpit introduces no WebGPU passes. Orbital paths remain enabled
according to the saved path setting, using the existing single batched path draw.
The existing orbit uniform encodes 0=off, 1=normal and 2=cyan cockpit guides.
Only the path ink changes in cockpit mode; geometry, trail brightness, body/ring
occlusion, and local moon LOD stay shared with the regular view. The opaque
canopy covers the guides, leaving them visible through the window. Flight uses
3 draws with paths enabled and 2 with paths off.

`Renderer.render` suppresses selection emphasis and moon circles while flight is
active, without changing saved rendering settings. Labels remain hidden
throughout the mode, including when the camera is stationary. The regular view's
path colours and annotations are unchanged.

Initial-version checks (before the speed and cyan-path follow-up):

- `bun test tests/flight.test.js tests/scene-gestures.test.js`: 18 passed.
  Includes independent continuous-time acceleration/displacement references,
  braking, opposing keys, diagonal speed, rotated movement axes, 30/60/144 Hz
  agreement, bounded stalls, state clearing, camera entry/exit and gesture reset.
- `bun test tests/simulation.test.js -t camera`: 5 passed.
- `bun test tests/orbits.test.js`: 11 passed.
- `/orbits-verify.html`: 15 actual GPU checks passed, including low/coplanar
  views, near-plane crossings, every planetary close-up, circle coverage and
  production batching/resource reuse. Zero WebGPU errors reported.
- Browser QA at 1440×900, 844×390, and 390×844: landscape availability, portrait
  exit, drag steering, W thrust and W+S cancellation, paused-simulation flight,
  overview, Earth and Saturn cockpit views, Escape, settings closure, ordinary
  cockpit Tab navigation, restored hidden panels and disabled-label preference.
  Actual flight diagnostics showed 2 render draws and 0 validation errors.
- `git diff --check` passed.

Run the focused checks above when changing flight behaviour. Avoid unrelated
rendering groups unless the change touches their shared code.

Follow-up validation, 15 November 2026:

- `bun test tests/flight.test.js tests/orbits.test.js`: 20 passed with the slower
  cruise limits. Acceleration/braking curves and frame-rate consistency still pass.
- `/orbits-verify.html`: 18 actual GPU checks passed. Added colour-channel and
  equal-coverage checks for cyan guides, bounded low/coplanar cockpit paths, and
  production entry/exit/path-toggle checks (3/2 cockpit draws, 4 normal draws with
  local moon detail). Existing planetary close-up and occlusion checks pass.
- Browser overview and planetary close-up checks verify cyan paths inside the
  canopy, live lower cruise limits, and no GPU validation errors.

Cruise-limit revision: set a fixed 4 display units/sec for all entry distances.
`bun test tests/flight.test.js` passes all 9 checks, including close-up/overview
entry, acceleration, braking, opposing keys and frame-rate consistency.

Vertical-thrust revision: E/Q now provide local up/down movement, with opposite
keys cancelling and three-axis input sharing the cruise limit. The cockpit hint,
accessible canvas description, and thrust indicator include the new controls.
`bun test tests/flight.test.js`: 12 passed, including pitched-camera vertical
thrust, E/Q cancellation and braking, combined speed and frame-rate consistency.
