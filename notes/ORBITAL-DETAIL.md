# Orbital paths and Saturn detail

All existing planet paths, Earth's Moon path and the seven new Saturnian moon
paths use the same batched ellipse renderer: warm grey/cream tracks, a brighter
trailing arc near the current body position, and a faint continuous
remainder. The arc follows eccentric anomaly and flips direction when time is
reversed; it is a visual trail, not a stored history of sampled positions.
Stroke width is uniformly thin, matching the faint sections; only brightness
changes along each path.

The bright endpoint contributes 50% of its original linear HDR intensity
(`vec3f(0.29,0.265,0.19) * 0.5`). The faint endpoint, trail progression, stroke
coverage, selected-body emphasis and moon-circle intensity are unchanged. Paths
use additive blending, so this scales their effective visual opacity without
changing geometry or the blend pipeline.

Each ellipse uses 1024 finite line segments from a shared static unit circle.
Segments are clipped against the near plane and viewport before perspective
division, then expanded into thin screen-space ribbons. This keeps width stable
under zoom and foreshortening, including coplanar camera views, without the
detached background lines produced by the old infinite-plane distance estimate.
Edges are antialiased. Foreground body depth clips
paths and circle markers; ring texture alpha attenuates portions behind the rings.

## Local detail / LOD

`ProximityLod` is a reusable distance gate, independent of camera selection:

- Saturn detail enters within 18 display radii of Saturn's centre and exits at 22.
- Saturn must also be in view. A 5% entry margin and 20% exit margin around the
  viewport prevent edge chatter. Proximity alone is insufficient with compressed
  distances: an Earth close-up can be near Saturn while Saturn is behind the camera.
- The hysteresis band prevents boundary chatter; opacity changes over 0.25 seconds.
- The camera can activate detail through manual zoom/orbit, even without targeting
  Saturn. Zooming out removes the moons while Saturn can remain the selected body.
- Moon LOD affects only moon detail. Planetary paths stay enabled in close-ups,
  including near Saturn, and remain governed by the orbital-path toggle.
- Moon Kepler updates and annotation work are skipped while the detail is absent.
  The circle draw is omitted when detail is off. Inactive path instances are
  rejected in the vertex shader, before fragment shading.
- Saturn targeting starts 12 radii away, outside the largest compressed moon orbit.

The seven moons are Mimas, Enceladus, Tethys, Dione, Rhea, Titan and Iapetus.
They have hollow 22 CSS-pixel circle annotations and names. They are separate from
the physical `BODIES` catalogue: no sphere intersections, texture layers, shadow
casters, navigation entries, picking or camera targets are added. The existing
interactive, spherical Earth Moon is unchanged.

Names follow the body-label toggle, and paths follow the orbital-path toggle.
The circles represent the moon entities and remain visible with either toggle off.
Circles and names hide during camera motion and fade back in after settling.
Names update each frame while local detail is visible, so they follow the fast
inner moons smoothly. Circle annotations are clipped out of the header, information
panel and control regions. Overlapping names may be omitted independently. Names are conservatively hidden behind the ring annulus,
while the GPU circles use its actual opacity.

## Orbit model and source

[JPL SAT441 mean orbital elements](https://ssd.jpl.nasa.gov/sats/elem/sep.html),
epoch 2000-01-01.5 TDB, supply semimajor axes, eccentricities, arguments of periapsis,
mean anomalies, inclinations, nodes, periods and local Laplace-plane poles.

The source planes are constructed in ICRF equatorial coordinates, converted to the
app's ecliptic/world convention, then rotated together so the inner Laplace pole
matches the displayed Saturn ring normal. This preserves differences between the
moons' planes, including Iapetus's distinctive inclination, rather than incorrectly
treating every local inclination as an inclination to Saturn's equator.

Display semimajor axes use `R × (2.65 + 2.35 ln(a_km / 150000))`, preserving order
and keeping even the innermost periapsis beyond the outer ring edge. Periods and
eccentricities retain their source values. Positions are evaluated from absolute
simulation days through the existing Kepler solver and then translated by Saturn's
current position; they are not accumulated frame by frame.

This is an illustrative mean-elements model. Planes and periapses are frozen at
the source epoch; it does not integrate precession, resonances or perturbations,
and it uses the app's existing time scale without a UTC/TDB conversion. It should
not be used as a precision moon ephemeris. Distances and marker sizes are display
choices, not astronomical scale.

## Rendering and focused verification

One reusable 1024-byte storage buffer holds sixteen 64-byte orbit records. An
8200-byte static unit-circle buffer supplies all path segments. Moon axes and
display radii are computed once; paused moon anomalies and relative positions are
cached. Position/bounds arrays and label nodes are reused.

Paths and circle annotations stay inside the scene render pass as separate
instanced draws. This means 3 steady-frame draws for the system, 4 with Saturn's
circles visible, or 2 with paths and circles both absent. Bloom dispatches are
unchanged. Only covered line/circle pixels evaluate occlusion; the full-screen
scene shader no longer loops over every orbit and marker at every pixel.

For orbital-detail changes, run:

```sh
bun test tests/orbits.test.js
```

Then open `/orbits-verify.html` for 15 focused GPU checks. Actual raster readbacks
are compared against an independent, densely sampled mathematical ellipse,
including near-coplanar views, near-plane crossings and every planet's default
close-up. These also cover trail
reversal, half-strength head/tail contrast, constant stroke width under zoom/foreshortening, hollow circle coverage,
fixed marker radius, foreground sphere/ring coverage, orbit toggling, camera-motion
opacity, inactive LOD and production pipeline validation. They do not execute the
unrelated texture, atmosphere, eclipse or bloom test groups.

The unit tests cover proximity hysteresis, non-targeted/manual camera activation,
Saturn framing, separate entity catalogues, source phases/periods, compressed orbit
ordering, plane mapping, parent translation, pause/reverse determinism, buffer reuse
and annotation occlusion. Browser QA also checks the LOD boundary through manual
zoom, navigation/picking, label and orbit toggles, motion fade and narrower layouts.

See [the rendering review](RENDERING-REVIEW.md) for broader cleanup, validation and
before/after timing measurements.
