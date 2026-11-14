# Planet atmospheres

Solar uses a bounded, single-scattering volume in the existing scene fragment
shader. It replaces the separate additive surface rim and outer glow. It retains
the two-render-draw architecture, 96-byte body records, adaptive 2K/1K textures,
existing camera/label behaviour, and the reduced solar bloom settings.

## Model

All atmospheric distances are normalized by the individual planet's display
radius. Each atmosphere ends at six density scale heights. `atmo.rgb` stores
vertical molecular optical depths; `atmo.w` stores scale height divided by radius.
Aerosol optical depths and forward-scattering parameters are in `aerosolProfile`.

- Ray–sphere intervals clip the volume to the visible ray and nearest opaque body.
- Eight view-ray segments integrate exponential molecular and aerosol density.
  Aerosol scale height is half the molecular scale height.
- Light optical depth uses four-point Gauss–Legendre quadrature per interval,
  splitting at closest approach when the light ray crosses its density peak.
- Rayleigh and Henyey–Greenstein phase functions respond to the Sun/view angle.
  Beer–Lambert attenuation applies along the light path and toward the camera.
- Locally constant source/extinction is integrated analytically in each segment,
  keeping grazing-angle radiance bounded. The display irradiance is 4.8 in the
  renderer's linear HDR units, approximately consistent with its surface lighting.
- The planet blocks direct sunlight on its night side. External eclipses and
  ring shadows use the existing finite-display-Sun visibility function, evaluated
  once at each visible atmosphere segment's midpoint.
- Surface hits are projected back onto the sphere before sampling their air column,
  preventing distant-hit rounding errors from producing speckled self-shadowing.
  Surface lighting is attenuated through the overlying atmosphere. Earth’s
  existing night lights, clouds and ocean highlights retain their material roles.
- The ring plane splits atmospheric integration into front and back portions.
  Ring alpha attenuates the back portion; atmosphere in front remains visible.

Earth has a thin blue molecular limb with modest neutral aerosols. Mars has weak
molecular scattering and dust-dominated haze. Venus's haze represents the region
above its already-textured cloud deck. The giant-planet profiles likewise model
haze above visible cloud tops. Mercury and the Moon have no visible atmosphere.

## Calibration and limits

The equations describe single scattering, but the profiles are illustrative RGB
fits, not measured complete planetary atmosphere models. Earth's display scale
height is about twice its familiar lower-atmosphere molecular scale height, making
the limb legible at the application's camera distances. The other planet profiles
are separately tuned rather than reusing Earth's colour and thickness.

The model omits multiple scattering, spectral gas absorption, refraction, airglow,
aurorae and volumetric clouds. Its local planetary shadow uses the Sun-centre ray;
external eclipses retain finite-Sun coverage. External shadow variation within an
atmosphere segment is approximated by the midpoint. Separate atmospheric volumes
are composed in catalogue order in the rare case that two otherwise unobscured
limbs overlap. These simplifications preserve the existing rendering budget.

## References

- [Sean O'Neil, Accurate Atmospheric Scattering, GPU Gems 2](https://developer.nvidia.com/gpugems/gpugems2/part-ii-shading-lighting-and-shadows/chapter-16-accurate-atmospheric-scattering):
  exponential density, phase functions and optical-depth integration.
- [Eric Bruneton, Precomputed Atmospheric Scattering](https://ebruneton.github.io/precomputed_atmospheric_scattering/):
  reference implementation and validation practice. Solar does not implement its
  precomputed multiple-scattering lookup tables; the bounded integration requires
  no additional atmospheric textures or passes.
- [NASA, The Top of the Atmosphere](https://science.nasa.gov/earth/earth-observatory/the-top-of-the-atmosphere-7373/):
  ISS013-E-54329, a visible-light Earth-limb photograph, guides thickness and falloff.
- [NASA/Cassini, A Splendor Seldom Seen](https://science.nasa.gov/resource/a-splendor-seldom-seen-2/):
  backlit Saturn/ring geometry provides a qualitative comparison. Its processed
  spacecraft imagery is a visual reference, not an absolute radiometric target.

## Repeatable checks

`/atmospheres.html` isolates one body, fixes texture rotation at J2000, places a
Sun with an angular radius of 0.27°, and uses fixed full, half-lit, crescent and
backlit views. Bloom is disabled to isolate scattering. These scenes deliberately
replace the compressed atlas arrangement, rather than claiming ephemeris accuracy.
The atmosphere toggle enables direct comparisons against the same underlying view.

`/verify.html` runs the production functions on the GPU. The atmosphere checks use
an independent double-precision CPU quadratic for sphere intervals and 4096-slice
midpoint integration for density, rather than reusing the shader's quadrature.
On the Apple M3 used for verification:

- Shell interval error: at most 1.4e-7 planet radii in the tested cases.
- Sun optical-depth error: at most 1.70% across 78 altitude/horizon cases and four
  scale heights, including paths near the twilight tangent.
- View transmission error: at most 0.0078 absolute across surface and limb rays.
- Additional checks cover nonnegative finite radiance, transmission in [0,1],
  distant-hit precision error, dark-limb suppression, no in-scattering on an unlit surface, eclipses, the
  atmosphere toggle, airless bodies, foreground opaque depth and ring opacity.
- Existing texture, lighting, shadow, resource-reuse and pipeline checks pass too:
  31 GPU checks in total, with two draws and the same bloom dispatch count.

## Measured cost

Apple M3; 1440 × 810 rendering; 2K maps; bloom off; isolated half-lit bodies.
The original shader and profiles were captured before editing. Both runs used
identical geometry, phase and texture rotation. Median of five 32-frame batches,
following 16 warm-up frames; each batch waits for GPU completion.

| Fixture | Original atmosphere on | Scattering on | Increase |
| --- | ---: | ---: | ---: |
| Earth | 0.872 ms/frame | 1.563 ms/frame | 0.691 ms/frame |
| Saturn | 1.072 ms/frame | 2.122 ms/frame | 1.050 ms/frame |

These are CPU-submission-plus-GPU-completion wall times, not GPU timestamp queries.
They include driver and scheduling overhead, and are not predictions for other
hardware. The fixture page exposes the same benchmark for rerunning measurements.

In the main explorer, Earth and Saturn close-ups both maintained 60 fps at
1920 × 1080 with 2K maps and bloom enabled on this M3, with zero GPU validation
errors. This is an observed frame-interval result, not a GPU execution-time measurement.
