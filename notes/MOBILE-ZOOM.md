# Mobile zoom investigation

## Resolution

On 2026-11-14 the user confirmed that pinch zoom works on the Galaxy: cached
GitHub-hosted files caused the apparent failure. At the user's request, the
temporary + / − buttons, their handlers and layout styles were removed. The
original Pointer Events gesture implementation is unchanged. Mobile hints now
say “PINCH TO ZOOM”. The sections below record the earlier investigation.

## Initial report and limits

Reported on 2026-11-14: pinch zoom does not work on a Samsung Galaxy using
Chrome. The exact model, Android/Chrome versions and local/deployed URL were not
provided. No Android device or ADB tooling was available in this session, so the
phone's event stream and loaded asset versions could not be inspected. The
initial investigation did not establish an Android-specific implementation
defect; desktop responsive checks were not physical Android validation.

## Findings and decision

- `SceneGestures` listens to Pointer Events on the canvas, tracks two pointer IDs,
  uses pointer capture, and translates finger separation into `Camera.zoom()`.
  The proportional zoom, limits, cancellation and finger transitions pass the
  existing focused tests.
- The canvas already has `touch-action: none`. In portrait layouts it occupies a
  bounded part of the page. Browser hit-testing confirmed scene touches target
  `#universe`, whereas touches on the information panel target that panel.
  Both fingers must start in the scene. This is a possible explanation for some
  failed attempts, **not a confirmed explanation of the Galaxy report**.
- There was no device evidence justifying replacing Pointer Events or adding a
  concurrent Touch Events handler. Existing pinch behaviour is retained.
- A temporary fallback was implemented: accessible + / − buttons called the same
  zoom function as the mouse wheel, using deltas −200 / +200. Camera distance
  limits and smoothing remain centralized in `Camera.zoom()` and `update()`.

## Temporary implementation (now removed)

Controls appear at widths up to 850 px or when any input device has a coarse
pointer, without user-agent detection. Each target is 44 × 44 CSS pixels. Their
transparent wrapper shares the canvas's viewport rules, including information
panel visibility and landscape layout. Only the buttons receive input; surrounding
scene gestures and the gallery remain available. The hint updates when the media
query changes. Annotation bounds keep labels away from the buttons; CSS-hidden
controls reserve no annotation space.

## Checks of the temporary implementation

- `bun test tests/scene-gestures.test.js`: 8 passing tests.
- `bun test tests/simulation.test.js --test-name-pattern camera`: 5 passing tests.
- Actual in-app browser clicks at 390 × 844 visibly enlarged and reduced the
  paused Sun without changing selection. Before the final placement adjustment,
  its projected label moved from x=315 to 340 after zoom-in, then returned to
  x=316 after zoom-out (pixel rounding and settling tolerance).
- Final layout checked at 390 × 844, 320 × 568, 844 × 390 and 1280 × 720:
  controls stayed within the scene, clear of the header, panel and gallery, and
  were hidden on the desktop configuration. With loading complete, hit-testing
  resolved both button centres to the correct buttons. Panel-hidden placement
  and zoom after the final placement adjustment were also checked.
- `git diff --check` passes. No GPU shaders or draw submission changed.

## Diagnostic reference if the issue recurs

On the affected Galaxy, verify the latest HTML, `app.js`, CSS and gesture module
are loaded. Record the exact Android/Chrome versions and URL. Using Chrome remote
debugging, capture both fingers' `pointerdown`, `pointermove`, `pointerup`,
`pointercancel`, `gotpointercapture` and `lostpointercapture` events, including
targets, pointer IDs/types, button values and capture state. Break in the gesture
handler to inspect finger distance and `camera.goalDistance` when necessary.

Compare gestures beginning inside the canvas with those crossing panel/gallery
boundaries; test portrait, landscape, fullscreen, and the panel shown/hidden.
Confirm fresh assets are loaded before changing the event model.

Primary references:
[W3C Pointer Events](https://www.w3.org/TR/pointerevents/) and
[Chrome Android remote debugging](https://developer.chrome.com/docs/devtools/remote-debugging).
