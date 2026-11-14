# Orbit fixes and rendering review

Reviewed the production JavaScript (`app`, `camera`, `data`, `simulation`,
`renderer`, `textures`, `orbit-details`, `lod`), all four WGSL modules, and the
GPU verification/preview tools. The review used the actual buffers, shader source,
pixel readbacks and frame submission path, with the supplied low-angle screenshot
as the visual reproduction case. Baseline: commit
`c46e5ca2d30a2caf105126c9609d2e3e48e8782e`.

## Defects corrected

- **Detached background trails:** the old implicit ellipse distance divided by
  the projected gradient of an infinite ray/plane intersection. Near the plane's
  vanishing line that gradient grows very large, so unrelated pixels pass the
  thin-stroke test. At exactly coplanar angles, the denominator guard instead
  removes legitimate paths. Finite 1024-segment ribbons now clip in homogeneous
  coordinates before perspective division. There is no infinite-plane distance
  estimate in the drawing path.
- **Missing planetary tracks:** Saturn LOD explicitly assigned `1 - moonOpacity`
  to every planetary path. That coupling is removed. Local detail changes only
  the moon records.
- **Unwanted detail near other planets:** at J2000, the default Earth camera is
  only 14.17 Saturn display radii from Saturn, but Saturn is behind the camera.
  The old distance-only gate still enabled its moon system. Parent visibility
  now participates in detail activation, with entry/exit viewport margins to
  prevent chatter. Selection remains independent of LOD.

## Cleanup and optimization

The scene still uses analytic spheres, the existing lighting/atmosphere models,
and the existing 2K/1K texture allocator. Changes are concentrated in repeated
work and rendering boundaries:

- One instanced draw batches all orbital ribbons; another batches visible moon
  circles. Both use the existing scene pass. Occlusion runs only on covered
  fragments, instead of looping over sixteen paths and seven circles at every
  screen pixel. Sphere depth and ring texture alpha still govern visibility.
- One static 8200-byte unit-circle buffer serves every ellipse. It eliminates
  repeated vertex trigonometry and needs no per-frame geometry upload. Explicit
  shared pipeline layouts let the three scene pipelines reuse one bind group.
- The normal frame uses three draws; nearby Saturn uses four. Hiding paths and
  circles leaves two. Diagnostics now report the submitted count, rather than
  a fixed value. Bloom still uses three optional compute dispatches.
- Paused simulation body updates and moon anomalies/relative positions are
  cached. Parent translation, camera motion, fades and reverse direction continue
  updating. Camera and orbit tests preserve deterministic time behavior.
- Canvas size and compact-layout state are cached at resize/layout changes.
  Annotation bounds also refresh when settings or diagnostics change. Camera
  motion suppression happens before rendering, and Space on diagnostics no
  longer also changes playback.
- Ray/sphere intersections use the closest-approach vector to avoid subtracting
  two large squared distances. Stars are evaluated only for background rays.
- The same 17-tap Gaussian uses precomputed, normalized symmetric weights.
  Disabling bloom also skips its composite texture sample.
- Resolution limiting scales both axes together, preserving aspect ratio.
  Teardown is idempotent; error callbacks ignore disposed devices. Persisted
  page navigation suspends rendering and can resume without reusing a destroyed
  device.

Texture fallback, mip generation, Kepler equations, the camera flight model and
the atmosphere quadrature were reviewed and retained. Changes to those algorithms
were unnecessary for the reported defects. Tests of unchanged HTTP routing and
mock texture allocation were not run.

## Independent validation

- **22 Bun tests:** orbit/LOD and simulation/camera files only. Regression cases
  cover planetary-path independence and the Earth camera with Saturn behind it.
- **14 orbit GPU checks:** actual raster output is compared to a separate
  32,768-sample mathematical ellipse. Across five low/coplanar angles, zero lit
  pixels fall outside its two-pixel envelope. Near-plane crossings and all eight
  default planetary close-ups retain paths. Other checks cover trail direction,
  uniform thin width, hollow circles, zoom/resolution, sphere/ring occlusion,
  toggles, motion fades, inactive LOD and the 2–4 draw budget.
- **32 shared GPU checks:** production compilation, texture/mip contents,
  atmosphere integration, eclipses, occlusion, frame-resource reuse, resolution
  rebuilds, bloom and validation scopes. The added Gaussian comparison uses an
  independent double-precision convolution with impulses, a constant field and
  boundary impulses; maximum HDR error was `1.9e-4`.
- Browser QA reproduced the screenshot's low angle and checked Earth/Saturn
  close-ups, playback, camera interaction, annotations, diagnostics and a
  390 × 844 layout. The
  local desktop view maintained 60 fps at 1920 × 1080 with zero validation errors.

The broader GPU page was appropriate here because shared sphere intersection,
pipeline layout and post-processing code changed. Routine future orbital edits
can continue using just the focused checks described in [orbital detail](ORBITAL-DETAIL.md).

## Measured rendering cost

Controlled before/after renderers ran alternately in the same page, with the main
explorer stopped. Both used identical J2000 body state, camera settings, 2K maps,
atmospheres and bloom at 640 × 360, scale 1. After 16 warm-up frames per renderer,
seven 32-frame batches alternated their execution order; the table reports the
median completion time per frame.

| View | Before | After | Reduction | After draws |
| --- | ---: | ---: | ---: | ---: |
| Low-angle system | 0.431 ms | 0.366 ms | 15% | 3 |
| Earth close-up | 0.578 ms | 0.381 ms | 34% | 3 |
| Saturn close-up | 0.700 ms | 0.609 ms | 13% | 4 |

These are local CPU-submission-plus-GPU-completion wall times, not GPU timestamp
queries or predictions for other devices. They exclude the app's DOM updates.
The temporary baseline copy was removed after comparison. The retained
`/render-benchmark.html` provides standalone current-version measurements using
five 24-frame batches; it is not an identical A/B harness.
