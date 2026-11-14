// Run once. The app serves these files locally and never hotlinks texture assets.
const names = [
  "2k_sun.jpg", "2k_mercury.jpg", "2k_venus_atmosphere.jpg", "2k_earth_daymap.jpg",
  "2k_mars.jpg", "2k_jupiter.jpg", "2k_saturn.jpg", "2k_uranus.jpg",
  "2k_neptune.jpg", "2k_moon.jpg", "2k_earth_nightmap.jpg", "2k_earth_clouds.jpg",
  "2k_saturn_ring_alpha.png",
];
const origin = "https://www.solarsystemscope.com/textures/download/";
const resources = names.map(name => ({ name, url: origin+name })).concat({
  name: "gaia-early-dr3-sky.png",
  url: "https://media.esa.int/legacy/web/images/esa_multimedia/images/2020/12/interactive_map_of_the_sky_from_gaia_s_early_data_release_3/25364650-1-eng-GB/Interactive_map_of_the_sky_from_Gaia_s_Early_Data_Release_3.png",
});
// Bound concurrency to avoid overwhelming the source. Cache existing downloads.
let cursor = 0;
async function worker() {
  while (cursor < resources.length) {
    const { name, url } = resources[cursor++];
    const file = Bun.file(new URL(`../docs/assets/textures/${name}`, import.meta.url));
    if (await file.exists() && file.size > 1024) { console.log(`Cached ${name}`); continue; }
    const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) {
      throw new Error(`${name}: HTTP ${response.status}, expected an image`);
    }
    const bytes = await response.arrayBuffer();
    await Bun.write(file, bytes);
    console.log(`Downloaded ${name} (${Math.round(bytes.byteLength / 1024)} KB)`);
  }
}
await Promise.all([worker(), worker(), worker()]);
