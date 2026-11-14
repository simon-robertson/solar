# Rendering optimisation follow-up — 14 November 2026

Reviewed the current JavaScript, all four WGSL modules, and the complete frame,
startup, resize and teardown paths. The baseline was the working tree at the
start of this task, **including its existing uncommitted Sun and documentation
changes**, rather than Git HEAD alone. HEAD was
`409a5ef8968ad94ca249896e867a7940ba414cc2`; baseline source hashes and raw
measurement batches are in [the results record](RENDERING-OPTIMISATIONS-RESULTS.json).
Existing work was preserved.

## Findings and retained changes

The main architecture was already appropriate for this scene. Ten analytic bodies
share a scene draw, orbital ribbons and local circles are batched into that pass,
bloom uses three half-resolution compute dispatches, and a final draw composites
and tone maps the result. Frame buffers, textures, bind groups and descriptors are
reused. Texture decoding is bounded, mipmaps are startup-only, and the adaptive
texture allocator retains its existing scoped 2K/1K fallback. Simulation, camera
tracking, paused body/moon caches and DOM annotation throttling were retained.

The baseline explorer profile at 1280 × 900 showed about 0.28 ms of CPU frame work
and a 16.7 ms frame interval. A 180-frame CPU/allocation capture found no sustained
JavaScript allocation hotspot warranting a new cache or object pool. These are
browser observations, not isolated GPU timings. Atmosphere-on/off experiments
confirmed that shading, particularly atmosphere integration, dominates these
controlled close-ups.

Implemented:

- **Gaussian blur:** pair adjacent weighted samples using linear filtering. The
  normalized 17-tap kernel now uses nine filtered reads rather than seventeen
  individual loads, with the same separable passes and clamp-to-edge boundaries.
  This adds one existing sampler binding, no textures or dispatches. Weights and
  weighted offsets are fixed constants.
- **Atmosphere density:** compute molecular density once and square it for the
  aerosol density, whose scale height is exactly half as large. This preserves
  the exponential model and all integration sample counts.
- **Eclipse rejection:** test squared distances before normalization and reuse an
  inverse distance. Evaluate the Sun's inverse sine only for candidate overlapping
  discs. Inside-blocker, behind-receiver and beyond-Sun cases retain their roles.
- **Orbital submissions:** omit the seven inactive Saturn moon path instances.
  An ordinary path draw now submits nine instances instead of sixteen, avoiding
  43,008 vertex invocations. Circle draws submit only the seven moon instances,
  using their existing buffer range. Planet path visibility and local LOD are
  independent. Skip the orbit-buffer upload when no path/circle draw consumes it.
- **Measurement:** the standalone benchmark checks actual target dimensions,
  fixes camera/simulation/surface state, records batch variation and browser/adapter
  context, and separates CPU encoding/submission, queue-completion wall time, and
  optional GPU frame timestamps. Query buffers are reused within each batch;
  resolving/mapping occurs after the completion measurement, never per frame.
  Only the benchmark requests `timestamp-query`, after checking the adapter.
- **Diagnostics wording:** the explorer's existing CPU metric includes simulation,
  camera, submission and annotation work. Its label now says “CPU frame work”.

The steady-frame draw count remains **2–4**, and bloom remains **0 or 3 dispatches**.
The scene/composite shader structure, texture quality, orbital tessellation,
lighting models, UI styling and deterministic simulation remain intact.

## Measurements

Chrome 157.0.0.0 on macOS; WebGPU vendor `apple`, architecture `metal-3`.
The browser exposes no more specific device description. Both renderers ran
alternately in one isolated page, using verified 1920 × 1080 targets, J2000,
2K maps, surface time 12 seconds, exposure 1.15, paths, atmospheres and bloom on.
Each view warmed up for 96 frames per renderer. Nine 128-frame batches alternated
execution order. The main explorer was stopped. Values are medians in ms/frame.

| View | Completion before | Completion after | Reduction | GPU frame before → after | Bloom GPU range before → after |
| --- | ---: | ---: | ---: | ---: | ---: |
| Low-angle overview | 1.891 | 1.855 | 1.9% | 1.873 → 1.841 | 0.292 → 0.263 |
| Sun | 2.057 | 2.015 | 2.1% | 2.041 → 2.000 | 0.325 → 0.283 |
| Earth | 2.270 | 2.206 | 2.8% | 2.253 → 2.191 | 0.314 → 0.278 |
| Saturn | 3.106 | 3.060 | 1.5% | 3.090 → 3.046 | 0.351 → 0.317 |

Bloom GPU ranges fall by about 10–13% in this longer run; earlier matched runs
showed about 15%. CPU encode/submission medians remain around 0.03–0.04 ms/frame
in these batched measurements. The improvement is chiefly GPU work, not a large
JavaScript speedup. With Earth bloom disabled, the completion difference is only
0.006 ms (0.3%), too small to attribute confidently to the arithmetic cleanups.

At 640 × 360, seven 48-frame batches observed roughly 8–10% completion reductions
for overview/Sun/Earth and 2.5% for Saturn. Absolute times are small and scheduling
costs matter. Short full-HD runs were less stable: one seven-batch run was about
1–3% slower after the changes. Individual before/after ranges overlap even in the
longer run. These are modest local observations, not guaranteed speedups on other
GPUs. Raw batches, including the mixed short run, are retained in the results.

GPU frame time is the first scene timestamp through the last composite timestamp.
Exploratory render/compute pass ranges can overlap on this backend; they are not
added together or treated as an exact partition of frame time. Browser timestamp
quantization and scheduling also limit conclusions for very small differences.

Subsequent [sky work](MILKY-WAY.md#timestamp-correction) exposed overlapping
per-frame ranges in a two-draw fixture too. The retained benchmark now times a
whole batch with one pair instead of summing frame ranges. The completion wall
times above are unaffected; timestamp ranges should be read with that limitation.

## Validation

- **23 Bun tests:** `tests/orbits.test.js`, `tests/simulation.test.js` and
  `tests/solar.test.js`; 1,728 assertions. Unrelated HTTP and texture-allocation
  unit groups were not run.
- **40 shared GPU checks:** shader/command validation, textures/mips, numerical
  atmosphere references, eclipses, occlusion, solar animation/appearance, resource
  reuse, resize and bloom. Expanded Gaussian checks cover 17 × 17, 1 × 1,
  1 × 19, 19 × 1, 31 × 19 and 257 × 3 textures. Impulses, constant fields and
  boundary impulses are compared to an independent double-precision convolution.
  Maximum absolute error is **2.4e-4 HDR**, below the existing 5e-4 threshold.
  Atmosphere errors remain 1.70% for optical depth and 0.0078 absolute transmission
  against the existing independent 4096-slice reference.
- **14 orbit GPU checks:** dense independent ellipse envelopes, low/coplanar
  angles, near-plane crossings, every planetary close-up, trails, width, circle
  shape, sphere/ring occlusion, toggles, LOD and draw budget.
- **Before/after pixel readbacks:** coplanar and near-coplanar overview, Sun,
  Earth, Saturn and Neptune at 641 × 359 and 1920 × 1080. Maximum scene difference
  is 2.44e-4 HDR; bloom differs by at most 0.00390625 HDR. Final display channels
  differ by at most **1/255**. At worst, 0.057% of display channel samples change.
  The small rounding/interpolation differences are recorded rather than claiming
  bit-identical output.
- **Benchmark checks:** full HD, odd 641 × 359 dimensions with bloom off,
  timestamp support masked off at 321 × 181 with atmospheres off, and invalid
  dimension handling. The masked-feature run uses the CPU/completion fallback
  without requesting optional features. It is not a second physical adapter test.
- **Browser QA:** inspected desktop Sun/Earth/Saturn, flights and settled labels,
  paths/bloom toggles, high resolution, 390 × 844 Earth and information-panel
  toggling. Planet/moon computed fonts match. Desktop settled views report 60 fps,
  3/4 draws and zero validation errors. JavaScript syntax and diff whitespace
  checks pass.

## Compute decision and rejected alternatives

Compute shaders are already part of the renderer's WebGPU baseline. The retained
blur optimisation works within its existing compute path and core resource limits;
it needs no OS-name routing, subgroup operations or half-precision feature.
Capability/limit checks remain the way to select optional functionality. See the
[WebGPU specification](https://www.w3.org/TR/webgpu/) for compute, limits and
`timestamp-query`, and [WGSL](https://www.w3.org/TR/WGSL/) for sampling semantics.

A tested shared-memory blur loaded an 8 × 8 output tile plus its halo, reducing
source loads from 1,088 to 192 per workgroup. It passed pixel/numerical checks but
made bloom roughly 7% slower in the initial matched tests on this GPU. Its barrier
and shared-memory costs outweighed the saved loads, so that implementation was
removed. The filtered approach is both simpler and faster in the retained tests.

Moving the ten-body orbital simulation to compute has no demonstrated benefit:
its CPU work is already small, and picking, camera tracking and labels need those
positions on the CPU. Added dispatch/readback machinery is unjustified here.
Likewise, replacing analytic scene shading or atmosphere integration with a new
compute/LUT architecture would introduce substantial storage, precision and
validation decisions. The measured results do not justify that rewrite as cleanup.

## Repeating the standalone benchmark

Run the local server, then open `/render-benchmark.html`. The default is 640 × 360;
use `?width=1920&height=1080` for full HD. Add `&bloom=0` or `&atmospheres=0` to
isolate settings. The tool uses seven 48-frame batches following 24 warm-up frames
and reports the actual dimensions. It measures the current version only; the
controlled before/after results above used a separately captured baseline and
longer runs. Machine-readable metadata and samples are available in the result
node's `data-results` attribute. No profiler runs in the production explorer.
