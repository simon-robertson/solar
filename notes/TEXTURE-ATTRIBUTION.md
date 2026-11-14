# Texture credits

Planet, Sun, Moon, Earth cloud/night and Saturn ring textures by **Solar System Scope**.

- Source: https://www.solarsystemscope.com/textures/
- License: Creative Commons Attribution 4.0 International (CC BY 4.0)
- License text: https://creativecommons.org/licenses/by/4.0/
- Original download URLs: `https://www.solarsystemscope.com/textures/download/<filename>`

The original 2K files are included unmodified. At load time, maps use a
2048 × 1024 GPU texture array with a 1024 × 512 fallback if allocation fails or
device limits require it; mipmaps are generated on upload. Ring data uses a
separate GPU texture at the matching resolution. Visitor-facing source and license
links remain in the site's About dialog. The source maps are based on NASA imagery, with artistic adjustments
and some reconstructed terrain. They are illustrative rather than scientific data.

## Milky Way panorama

- Asset: `docs/assets/textures/gaia-early-dr3-sky.png`.
- Title: *Interactive map of the sky from Gaia’s Early Data Release 3*.
- Credit: **ESA/Gaia/DPAC**. Acknowledgement: **A. Moitinho**.
- Source: https://www.esa.int/media/interactive-map-of-the-sky-from-gaia-s-early-data-release-3
- Original file: https://media.esa.int/legacy/web/images/esa_multimedia/images/2020/12/interactive_map_of_the_sky_from_gaia_s_early_data_release_3/25364650-1-eng-GB/Interactive_map_of_the_sky_from_Gaia_s_Early_Data_Release_3.png
- Licence: **CC BY-SA 3.0 IGO**, https://creativecommons.org/licenses/by-sa/3.0/igo/
- Original dimensions: 2000 × 1000, equirectangular Galactic coordinates;
  longitude zero at the centre, increasing longitude leftwards, north at the top.
- Stored file is byte-identical to the downloaded PNG. SHA-256:
  `a831d1a88ce6df8406f498c2f6a30d3905138f8a6262e870903133c75339f4b9`.
- Display changes: resized during upload to 2048 × 1024 or 1024 × 512, mipmapped,
  sampled as sRGB and brightness-scaled by 0.075 in linear light; the negligible
  polar caps fade smoothly to the background. The app's tone map/exposure follows.
  The procedural point-star overlay is illustrative and not part of the Gaia map.

The image remains available under its source licence. Visitor-facing credit,
licence, source link and display-change notice are in the site's About dialog.
The source panorama is restored by `bun run textures` alongside the other assets.
