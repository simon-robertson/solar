# Development notes

Context for contributors, agents and subagents. Follow the root
[AGENTS.md](../AGENTS.md) instructions. This folder is outside `docs/`, so its
contents are not served by the local app or deployed with the GitHub Pages site.

- [Atmospheres](ATMOSPHERES.md): scattering model, calibration, sources and validation.
- [Orbital detail and LOD](ORBITAL-DETAIL.md): moon model, path rendering and focused checks.
- [Rendering review](RENDERING-REVIEW.md): orbit fixes, JS/GPU cleanup, regressions and measurements.
- [Rendering optimisation follow-up](RENDERING-OPTIMISATIONS.md): filtered compute bloom, shading/submission cleanup, GPU timing, raw measurements and rejected alternatives.
- [Milky Way and starfield](MILKY-WAY.md): Gaia sky orientation, filtered stars, resource cost, visual references and focused GPU checks.
- [Sun visuals](SUN-VISUALS.md): animated photosphere, filtering, flare removal and measured costs.
- [Mobile zoom](MOBILE-ZOOM.md): resolved Android caching report, pinch support and temporary control history.
- [Spacecraft cockpit](COCKPIT.md): landscape flight mode, camera lifecycle, movement tuning, gunmetal flight deck, Sun-responsive materials and measured animation cost.
- [Texture attribution](TEXTURE-ATTRIBUTION.md): source assets, license links and texture handling.

The root [README.md](../README.md) covers running the app, the project layout and
verification entry points. Notes describe design decisions and recorded results;
use the current [client source](../docs/src/app.js) and relevant checks to verify
current behavior. Keep new development documentation here and add it to this index.
