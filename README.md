# Solar

A local WebGPU solar-system explorer: the Sun, eight planets and the Moon,
rendered as textured analytic spheres. No framework or runtime dependencies.

## Run

Requires [Bun](https://bun.sh/) and a desktop browser with WebGPU support.

```sh
bun run start
```

Open **http://127.0.0.1:3000**. The server binds to loopback only. Set `PORT` to
use another port, for example `PORT=3001 bun run start`. `bun run dev` watches the
Bun server; reload the browser after editing client code or shaders.

`docs/` is the public web root. It contains the complete static site, including
client JavaScript, shaders and textures. The Bun server serves only this folder.
HTML links resolve relative to the page, and JavaScript assets resolve relative
to their module URLs. This supports both localhost at `/` and GitHub Pages at
`/solar/`, without configuring a deployment prefix.

Development documentation lives in [`notes/`](notes/README.md), outside the public
web root. Contributors and agents should start with that index and `AGENTS.md`.
Keep implementation notes, reviews and benchmark records out of `docs/`.

The downloaded textures are included. To restore missing assets:

```sh
bun run textures
```

This downloads the original planetary maps from Solar System Scope and the Gaia
sky panorama from ESA. It caches existing files, limits download concurrency and
checks HTTP status and image MIME types.

## GitHub Pages

In the repository's **Settings → Pages**, choose **Deploy from a branch**, select
the publishing branch and **`/docs`**, then save. No build step or Bun server is
needed for hosting. `docs/.nojekyll` disables Jekyll processing.

See [GitHub's publishing-source documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

## Explore

- Select a world in the bottom rail to fly closer. System view returns to overview.
- Move near Saturn to reveal seven major moons as non-interactive circle markers.
  This proximity detail fades out when you zoom away; see [orbital detail and LOD](notes/ORBITAL-DETAIL.md).
- Drag the scene to orbit; scroll or pinch with both fingers inside the scene to
  zoom. Click or tap a planet to focus it.
- Body labels hide during camera movement and fade back in once the camera settles.
- Tab (or Shift+Tab) shows/hides the information and playback panels instead of
  moving focus. The panel button in the header provides the same toggle on touch
  devices. When hidden, the body selection rail moves down to the bottom.
- Space pauses/resumes; R resets the simulation date to today; Escape returns to
  system view. These playback/navigation shortcuts leave form controls and
  dialogs alone; the panel's Tab shortcut works throughout the app.
- Change speed or reverse time in the bottom bar.
- Render settings control orbital paths, labels, atmospheres, bloom, exposure
  and resolution. Expand **Rendering diagnostics** for live rendering diagnostics.
- Reduced-motion preferences start the simulation paused and remove camera flights.

Time speed/direction and all render settings persist across refreshes in
`localStorage` under `solar.preferences.v1`. Preferences are validated on load and
applied before GPU initialization; invalid values fall back to the defaults.
Resolution defaults to **High**. About two seconds below 60 FPS, measured in
consecutive half-second samples, automatically lower it one step, through
**Balanced** to **Performance**. Each step updates the control and saves the
preference; resolution never increases
automatically. FPS is rounded to a whole number to tolerate normal 60 Hz timing
jitter. Manual resolution changes and tab resumes restart the measurement.
Storage writes happen only when settings change, with exposure saved when a slider
adjustment is committed. If storage is unavailable, the controls still work for
the current session.

## Rendering and allocation

The implementation follows this brief: render an interactive solar system locally
with a fullscreen primitive, analytic intersections and documented source assets;
advance deterministic orbits from delta time in seconds; keep steady rendering
draws low; reuse frame state; and verify both orbital equations and actual GPU
pixel output.

Each steady frame has **2–4 draw calls**, below the budget of ten:

1. A WGSL fragment shader casts camera rays against the ten spheres, samples a
   mipmapped texture array, shades the nearest hit and evaluates finite-Sun
   visibility against the other bodies. Saturn's textured ring plane participates in
   occlusion and shadow casting. Earth has clouds, night lights and ocean specular
   highlights. Stars and bounded single-scattering atmospheres are evaluated
   in the same shader. Output is linear HDR (`rgba16float`).
2. When paths are enabled, one instanced draw renders all ellipses as thin,
   antialiased ribbons, clipped before perspective division. A shared static unit
   circle avoids per-frame meshes and repeated vertex trigonometry.
3. When nearby Saturn detail is visible, one instanced draw renders its hollow
   moon circles. Paths and circles share the scene pass, preserve sphere/ring
   occlusion, and shade only covered pixels.
4. The composite shader adds bloom, applies an ACES-style tone curve, a vignette
   and display gamma.

The Sun's warm texture evolves through coherent surface flow, filtered fine
detail and limb darkening in the sphere shader. Its animated surface and glow
require no additional draw. Surface animation pauses with playback and
reduced-motion startup, reverses with time, and follows the speed control with
an eightfold cap. Reset restarts the animation. It is illustrative rather than
a reconstruction of historical solar weather. See [Sun visuals](notes/SUN-VISUALS.md)
for sources, filtering, validation and measured rendering costs.

Bloom uses **three compute dispatches in one compute pass**: half-resolution
threshold/downsample and horizontal/vertical blur. Turning bloom off skips these
dispatches and the composite's bloom sample. Precomputed Gaussian weights pair
adjacent taps with linear filtering, using nine reads for the same 17-tap kernel.
No shadow maps, planet meshes, per-planet draws or depth buffer.
See [the rendering review](notes/RENDERING-REVIEW.md) for validation
and measured before/after costs.

The background combines an ESA/Gaia Milky Way panorama with illustrative point
stars. Its Galactic orientation is fixed in the J2000 world frame. The panorama
preserves observed stellar clouds, a brighter central region and dust lanes;
procedural stars vary in position, brightness and colour, with higher density
near the Galactic plane. Explicit mip selection and pixel-footprint filtering
reduce aliasing during movement and resolution changes. This uses the existing
scene draw and one additional texture-array layer. See [the sky notes](notes/MILKY-WAY.md)
for the approximation, attribution, validation and measured cost.

Texture initialization checks the device’s dimension and array-layer limits, then
tries the original 2048 × 1024 maps and 2048 × 125 Saturn ring. If texture allocation,
upload or mipmap initialization reports an out-of-memory error, it releases that
texture set and retries at 1024 × 512 (1024 × 64 for the ring). Asset failures and
unrelated validation errors are reported rather than retried. Image decoding uses
at most two concurrent bitmaps, each closed after upload.

The 13-layer sRGB array occupies approximately 139 MiB at 2K or 35 MiB at 1K,
including mipmaps and the sky layer. The full chains have 12 or 11 levels,
generated with 143 or 130 extra **startup-only** draws, respectively, excluded from the steady-frame count.
Explicit texture LOD reads the actual texture dimensions and level count, avoiding
invalid implicit derivatives inside divergent ray-hit branches and reducing distant
texture aliasing. **Rendering diagnostics → Texture maps** reports the chosen size.

`requestAnimationFrame` produces a seconds-based delta. A 50 ms cap avoids large
simulation jumps after stalls. Rendering stops while the document is hidden, and
the previous timestamp resets on resume. A cached date object and formatter serve
the UI at 2 Hz; planet labels update at roughly 15 Hz, visible moon labels each
frame. Paused body and moon orbital calculations are cached. The hot path reuses:

- Typed arrays of body/orbit state, uniforms and the camera's vectors.
- GPU uniform/storage buffers, pipelines, bind groups, textures and samplers.
- Render-pass descriptors, attachments and the queue-submission array.
- DOM labels and controls created once at startup.

For a fixed set of ten bodies, preallocation is simpler than a general object pool.
Textures and bind groups rebuild only when the drawing resolution changes. WebGPU
command encoders, pass encoders, command buffers and the presentation texture view
are necessarily fresh handles each frame; the loop is allocation-conscious, not
literally allocation-free. Teardown releases textures, buffers and the device.
The base device pixel ratio is capped at 1.5, then multiplied by the selected
resolution scale (1.35 for High, 1 for Balanced or 0.7 for Performance).

Diagnostics report frame intervals and CPU frame work (simulation, camera,
render submission and annotations); they are **not GPU timestamp measurements**.
Performance depends on browser, GPU and resolution.

### Finite-Sun shadows

For a single spherical blocker, the shader computes the Sun's and blocker's
apparent angular radii with `asin(radius / distance)` and their angular separation.
A circular-disc overlap calculation gives the visible fraction of the Sun,
including full light, penumbra, umbra and annular eclipses. Most bodies are rejected
with a cheap angular-cone test before any inverse trigonometry. A single eclipse
has smooth analytical edges, with no noise or shadow-map passes.

Where several blockers overlap, 32 fixed equal-area solar-disc samples integrate
the union of their silhouettes, avoiding double-counting. Translucent ring shadows
use the same sampling path, limited by a conservative outer-ring bound. Saturn's
shadow on its rings also uses finite-Sun visibility. These exceptional paths are
sampled approximations and can have slight quantization; the common single-body
case does not. All work stays in the existing scene draw, with no new GPU buffers,
render targets, compute dispatches or per-frame JavaScript allocations.

The model assumes uniform solar brightness and uses the apparent circular-disc
approximation for a single blocker; it does not model solar limb darkening or
integrate the receiver's BRDF across the Sun. Softness uses the **visible display
Sun's radius**, so it is consistent with the compressed scene geometry rather
than real astronomical eclipse widths. A small apparent blocker correctly leaves
an annular eclipse instead of producing an artificial black umbra.

Reference: [NASA, *A Smoothed Eclipse Model for Solar Electric Propulsion Trajectory Optimization*](https://ntrs.nasa.gov/api/citations/20170003689/downloads/20170003689.pdf),
for apparent-disc eclipse geometry.

## Simulation and limits

Planetary elements and their century rates come from NASA/JPL Table 1, referenced
to J2000 and valid for **1800–2050**. Newton iteration solves Kepler's equation;
positions are computed from simulation time rather than accumulating position
updates. The app pauses at the model's date limits.

Distances and body sizes are compressed independently for visibility. Earth's
orbit uses the Earth–Moon barycentre as an approximation; the Moon has a simplified
Earth-centred Kepler ellipse. Rotation/axial tilt and lighting are illustrative;
this is not a precision ephemeris or N-body integration. Atmospheres use bounded single scattering with display-calibrated density profiles
(see [atmosphere model and validation](notes/ATMOSPHERES.md)), and eclipses follow the finite display
Sun as described above. The solar system is rendered in ordinary single-precision GPU display
coordinates. Labels, informational facts and texture colours are for exploration.

Sources:

- [JPL approximate planetary positions and orbital elements](https://ssd.jpl.nasa.gov/planets/approx_pos.html)
- [JPL planetary physical parameters](https://ssd.jpl.nasa.gov/planets/phys_par.html)
- [Solar System Scope textures](https://www.solarsystemscope.com/textures/),
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
  See [texture attribution](notes/TEXTURE-ATTRIBUTION.md).

## Verification

Choose checks for the changed subsystem. For moon/orbit/LOD changes, run
`bun test tests/orbits.test.js` and open **http://127.0.0.1:3000/orbits-verify.html**.
These focused checks leave unrelated rendering groups out. The broader checks
below are available when the affected code warrants them.

```sh
bun test
# With the server running:
bun scripts/check-http.ts
```

The Bun tests check Kepler residuals, independently referenced J2000 Earth
coordinates, pause/reverse/delta handling, equivalent split time steps, model
limits, lunar distances, camera projection/buffer reuse, and continuous camera
flights to stationary or moving planets. Flights decay a preallocated look-at
offset relative to the selected body, so zoom settling never triggers a snap.
Texture-allocation tests cover native 2K selection, dimension limits, immediate
and deferred out-of-memory fallback, resource cleanup, and unrelated failures.

Open **http://127.0.0.1:3000/verify.html** to run 40 checks on the actual GPU:
texture profiles, final mip contents, resolution-dependent LOD, atmosphere geometry,
optical depth and attenuation against independent numerical references,
night-side/eclipsed atmosphere suppression, foreground/ring occlusion,
production-shader compilation, pixel-readback sunlight/eclipses/background tests,
frame-resource reuse, resolution rebuilds, Gaussian blur against an independent
double-precision convolution, bloom dispatch counts and WebGPU
validation. Solar checks cover surface evolution at fixed rotation, pause/reverse,
contrast/colour/clipping against the original Sun, eclipsed disc/aureole and
the two-draw solar rendering budget. The controlled shadow test
moves the Moon between the Sun and Earth's
visible lit surface, measures the brightness reduction, then moves it away and
checks that illumination returns. Additional tests exercise the production WGSL
visibility function directly: total and annular eclipses, a penumbra sweep,
distance/source-size changes, irrelevant blockers, and overlapping/disjoint
blockers. An independent Cartesian solar-disc integration checks the analytic
result against 3D ray/sphere silhouettes. The test page destroys its GPU resources
when finished.

For sky-only changes, open **http://127.0.0.1:3000/sky-verify.html** for 14 focused
GPU checks: Galactic orientation, independent Gaia panorama samples, seams/poles,
clock/camera invariance, filtering, occlusion and the draw budget. Texture-profile
changes also use `bun test tests/textures.test.js`.

HTTP checks cover assets and MIME types, missing files, private-file/path-traversal
rejection, HEAD and unsupported methods. Browser QA also covers Earth and Saturn
closeups, playback controls and render settings.

Controlled atmosphere views and a batch-completion benchmark are available at
**http://127.0.0.1:3000/atmospheres.html**. See [the atmosphere notes](notes/ATMOSPHERES.md)
for the model, reference images, measured cost and numerical error bounds.

The standalone **http://127.0.0.1:3000/render-benchmark.html** reports CPU
encoding/submission, frame-completion wall time and optional GPU batch timestamps
separately. It verifies actual target dimensions and records seven 48-frame
batches after warm-up. Add `?width=1920&height=1080` for full HD, optionally
`&bloom=0` or `&atmospheres=0`. Timestamp queries are requested only by this tool;
adapters without them still report CPU and completion timings. See the
[follow-up rendering review](notes/RENDERING-OPTIMISATIONS.md) for measured results,
pixel differences and rejected alternatives.

## Files

- `server.ts`: Bun static HTTP server.
- `docs/`: public web root and complete GitHub Pages site.
- `docs/src/data.js`, `docs/src/simulation.js`: source data and deterministic simulation.
- `docs/src/camera.js`, `docs/src/app.js`: camera, interactions and frame lifecycle.
- `docs/src/renderer.js`: WebGPU resources and rendering pipeline.
- `docs/src/*.wgsl`: scene, post-processing, composite and startup mipmaps.
- `docs/assets/`: locally served texture assets; visitor-facing credits are in About.
- `notes/`: development documentation, rendering reviews, measurements and texture attribution.
