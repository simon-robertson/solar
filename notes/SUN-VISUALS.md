# Sun visuals

The Sun keeps its warm texture, darker structure, bright highlights, animated
surface and bounded glow. Flares/prominences were removed at the user's request
to reduce GPU cost. There is no solar volume draw or flare toggle.

## Surface and glow

`scene.wgsl` samples the original Solar System Scope texture in RGB. A
material-space 3D flow field produces a bounded local warp, with a small evolving
modulation and filtered fine noise. It preserves the texture's broad features
and colour relationships. The map is not converted to luminance or replaced
by a neutral procedural surface. A small `albedo^1.06` contrast adjustment keeps
darker structure readable under the shared tone map. Emission uses RGB gains
`(5.4, 3.65, 2.55)` and limb factor `0.5 + 0.5 * mu^0.35`.

The analytic sphere, picking radius, finite-Sun shadows and planetary light
remain unchanged. Detail fades using the explicit ray footprint, including limb
stretching; texture reads use explicit LOD. Flow fades near the poles to avoid
amplifying source-map stretching. A warm aureole is bounded to 1.5 solar radii
and respects foreground spheres and ring opacity. Bloom and exposure retain
their existing controls. Visitor-facing About credits and the detailed
[texture attribution](TEXTURE-ATTRIBUTION.md) remain applicable.

## Flare removal — 14 November 2026

Removed the volume vertex/fragment entry points, density functions, draw,
pipeline, bindings, 384-byte region buffer, 256 KiB noise texture, sampler,
startup uploads, CPU visibility/LOD work and `solar.js` helpers. The surface
and glow functions were compared directly with the pre-removal source and are
byte-identical, including their colour and animation parameters. The aligned
camera uniform still carries the surface clock; its other solar fields are
reserved. No replacement rendering work was added.

The animated Sun/glow use the existing scene draw. Frames use 2–4 draws total:
scene plus composite, optionally orbital ribbons and moon circles. The usual
Sun view with paths now uses three draws instead of four. Orbital LOD is
independent of the remaining surface footprint filtering.

## Clock

`Simulation.solarSeconds` advances by `dt * clamp(speed * 24, -8, 8)`, where speed
is simulated days per real second. Default one-hour-per-second playback gives
one animation second per real second. Slower playback slows animation; faster
playback caps at 8×; reverse changes its sign. Pause freezes the surface,
including reduced-motion startup. Reset restarts it at zero. This is illustrative
surface evolution, not a reconstruction of historical solar weather.

## Relevant verification

- The focused Bun solar-clock test passes: pause, reverse, speed cap, invalid
  deltas, reset and reused body state. Obsolete region-frame and flare-LOD tests
  were removed with those features.
- 40 production GPU checks at `/verify.html`, including eight solar checks.
  These cover a two-draw Sun/glow budget, surface evolution at fixed rotation,
  exact pause/reverse, contrast/colour/clipping against the original Sun and
  foreground suppression of the disc/aureole. Shared atmosphere, shadow,
  texture/mip, bloom, resource and shader validation checks pass.
- 14 orbit GPU checks pass, including low/coplanar views and independent dense
  ellipse references. No unrelated HTTP or texture-allocation unit groups run.
- Controlled Sun close-up inspection confirms that the surface and glow remain
  while protruding plasma is absent. GPU validation reports zero errors.

The appearance checks retain a fixed copy of the original Sun shading as their
reference. They compare GPU HDR readbacks through an independent CPU tone curve,
protecting warm colour separation and texture contrast from another white-ball
regression. The surface/glow implementation is unchanged from the accepted
textured revision; only the flare overlay and its supporting work were removed.

## Matched rendering cost after removal

Before is the accepted version with volumetric flares, saved immediately before
removal. Both versions run alternately in one isolated Chrome page on an Apple
M3 (`metal-3`, Metal), with 2K maps, J2000 state, surface clock 12 seconds,
exposure 1.15, bloom/atmospheres/paths enabled and identical cameras. Each view
warms up 24 frames, then reports the median of seven 64-frame batches with
alternating execution order. The main explorer is stopped. Actual render-texture
width and height are asserted to be **1920×1080** for both versions; canvases
have flex shrinking and CSS maximum-width restrictions disabled.

| View | With flares | Without flares | Draws before → after |
| --- | ---: | ---: | ---: |
| Low-angle overview | 2.022 ms | 1.902 ms | 4 → 3 |
| Sun full disc | 3.577 ms | 2.070 ms | 4 → 3 |
| Sun limb close-up | 8.325 ms | 2.448 ms | 4 → 3 |
| Earth | 2.291 ms | 2.283 ms | 3 → 3 |
| Saturn | 3.136 ms | 3.131 ms | 4 → 4 |
| Neptune, Sun offscreen | 2.248 ms | 2.236 ms | 3 → 3 |

Measured frame completion time falls by about 42% for the full disc and 71% for
the tight limb view. Unrelated-view differences are within measurement noise.
Times include CPU submission and GPU queue completion, not isolated GPU
timestamps. These dimension-verified measurements supersede earlier CSS-sized
benchmark runs and are not predictions for other hardware. The retained
`/render-benchmark.html` includes a Sun close-up for future current-version checks.
