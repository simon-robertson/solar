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

The downloaded textures are included. To restore missing assets:

```sh
bun run textures
```

This downloads the original maps directly from Solar System Scope, caches existing
files, limits download concurrency and checks HTTP status and image MIME types.

## GitHub Pages

In the repository's **Settings → Pages**, choose **Deploy from a branch**, select
the publishing branch and **`/docs`**, then save. No build step or Bun server is
needed for hosting. `docs/.nojekyll` disables Jekyll processing.

See [GitHub's publishing-source documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

## Explore

- Select a world in the bottom rail to fly closer. System view returns to overview.
- Move near Saturn to reveal seven major moons as non-interactive circle markers.
  This proximity detail fades out when you zoom away; see [orbital detail and LOD](docs/ORBITAL-DETAIL.md).
- Drag the scene to orbit; scroll to zoom. Click a planet to focus it.
- Body labels hide during camera movement and fade back in once the camera settles.
- Space pauses/resumes; R resets the simulation date to today; Escape returns to
  system view. Shortcuts leave form controls and dialogs alone.
- Change speed or reverse time in the bottom bar.
- Render settings control orbital paths, labels, atmospheres, bloom, exposure
  and resolution. Expand **Rendering diagnostics** for live rendering diagnostics.
- Reduced-motion preferences start the simulation paused and remove camera flights.

Time speed/direction and all render settings persist across refreshes in
`localStorage` under `solar.preferences.v1`. Preferences are validated on load and
applied before GPU initialization; invalid values fall back to the defaults.
Storage writes happen only when controls change, with exposure saved when a slider
adjustment is committed. If storage is unavailable, the controls still work for
the current session.

## Rendering and allocation

The implementation follows this brief: render an interactive solar system locally
with a fullscreen primitive, analytic intersections and documented source assets;
advance deterministic orbits from delta time in seconds; keep steady rendering
draws low; reuse frame state; and verify both orbital equations and actual GPU
pixel output.

Each steady frame has **two draw calls**, both fullscreen triangles:

1. A WGSL fragment shader casts camera rays against the ten spheres, samples a
   mipmapped texture array, shades the nearest hit and evaluates finite-Sun
   visibility against the other bodies. Saturn's textured ring plane participates in
   occlusion and shadow casting. Earth has clouds, night lights and ocean specular
   highlights. Stars, orbital paths and bounded single-scattering atmospheres are evaluated
   in the same shader. Output is linear HDR (`rgba16float`).
2. The composite shader adds bloom, applies an ACES-style tone curve, a vignette
   and display gamma.

Bloom uses **three compute dispatches in one compute pass**: half-resolution
threshold/downsample and horizontal/vertical blur. Turning bloom off skips these
dispatches. No shadow maps, planet meshes, per-planet draws or depth buffer.

Texture initialization checks the device’s dimension and array-layer limits, then
tries the original 2048 × 1024 maps and 2048 × 125 Saturn ring. If texture allocation,
upload or mipmap initialization reports an out-of-memory error, it releases that
texture set and retries at 1024 × 512 (1024 × 64 for the ring). Asset failures and
unrelated validation errors are reported rather than retried. Image decoding uses
at most two concurrent bitmaps, each closed after upload.

The 12-layer sRGB array occupies approximately 128 MiB at 2K or 32 MiB at 1K,
including mipmaps. The full chains have 12 or 11 levels, generated with 132 or 120
extra **startup-only** draws, respectively, excluded from the steady-frame count.
Explicit texture LOD reads the actual texture dimensions and level count, avoiding
invalid implicit derivatives inside divergent ray-hit branches and reducing distant
texture aliasing. **Rendering diagnostics → Texture maps** reports the chosen size.

`requestAnimationFrame` produces a seconds-based delta. A 50 ms cap avoids large
simulation jumps after stalls. Rendering stops while the document is hidden, and
the previous timestamp resets on resume. A cached date object and formatter serve
the UI at 2 Hz; labels update at roughly 15 Hz. The hot path reuses:

- One `Float32Array` of body state, one of uniforms and the camera's vectors.
- GPU uniform/storage buffers, pipelines, bind groups, textures and samplers.
- Render-pass descriptors, attachments and the queue-submission array.
- DOM labels and controls created once at startup.

For a fixed set of ten bodies, preallocation is simpler than a general object pool.
Textures and bind groups rebuild only when the drawing resolution changes. WebGPU
command encoders, pass encoders, command buffers and the presentation texture view
are necessarily fresh handles each frame; the loop is allocation-conscious, not
literally allocation-free. Teardown releases textures, buffers and the device.
Resolution defaults to at most 1.5× device pixel ratio, with adjustable quality.

Diagnostics report frame intervals and CPU submission time; they are **not GPU
timestamp measurements**. Performance depends on browser, GPU and resolution.

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
(see [atmosphere model and validation](docs/ATMOSPHERES.md)), and eclipses follow the finite display
Sun as described above. The solar system is rendered in ordinary single-precision GPU display
coordinates. Labels, informational facts and texture colours are for exploration.

Sources:

- [JPL approximate planetary positions and orbital elements](https://ssd.jpl.nasa.gov/planets/approx_pos.html)
- [JPL planetary physical parameters](https://ssd.jpl.nasa.gov/planets/phys_par.html)
- [Solar System Scope textures](https://www.solarsystemscope.com/textures/),
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
  See [texture attribution](docs/assets/textures/ATTRIBUTION.md).

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

Open **http://127.0.0.1:3000/verify.html** to run 31 checks on the actual GPU:
texture profiles, final mip contents, resolution-dependent LOD, atmosphere geometry,
optical depth and attenuation against independent numerical references,
night-side/eclipsed atmosphere suppression, foreground/ring occlusion,
production-shader compilation, pixel-readback sunlight/eclipses/background tests,
frame-resource reuse, resolution rebuilds, bloom dispatch counts and WebGPU
validation. The controlled shadow test moves the Moon between the Sun and Earth's
visible lit surface, measures the brightness reduction, then moves it away and
checks that illumination returns. Additional tests exercise the production WGSL
visibility function directly: total and annular eclipses, a penumbra sweep,
distance/source-size changes, irrelevant blockers, and overlapping/disjoint
blockers. An independent Cartesian solar-disc integration checks the analytic
result against 3D ray/sphere silhouettes. The test page destroys its GPU resources
when finished.

HTTP checks cover assets and MIME types, missing files, private-file/path-traversal
rejection, HEAD and unsupported methods. Browser QA also covers Earth and Saturn
closeups, playback controls and render settings.

Controlled atmosphere views and a batch-completion benchmark are available at
**http://127.0.0.1:3000/atmospheres.html**. See [the atmosphere notes](docs/ATMOSPHERES.md)
for the model, reference images, measured cost and numerical error bounds.

## Files

- `server.ts`: Bun static HTTP server.
- `docs/`: public web root and complete GitHub Pages site.
- `docs/src/data.js`, `docs/src/simulation.js`: source data and deterministic simulation.
- `docs/src/camera.js`, `docs/src/app.js`: camera, interactions and frame lifecycle.
- `docs/src/renderer.js`: WebGPU resources and rendering pipeline.
- `docs/src/*.wgsl`: scene, post-processing, composite and startup mipmaps.
- `docs/assets/`: locally served texture assets and attribution.
