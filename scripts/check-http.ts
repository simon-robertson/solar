const origin = process.env.SOLAR_URL ?? "http://127.0.0.1:3000";
const routes: [string, number, string][] = [
  ["/",200,"text/html"],
  ["/src/app.js",200,"javascript"],
  ["/src/textures.js",200,"javascript"],
  ["/src/atmosphere-check.js",200,"javascript"],
  ["/src/atmosphere-preview.js",200,"javascript"],
  ["/atmospheres.html",200,"text/html"],
  ["/src/scene.wgsl",200,"text/plain"],
  ["/style.css",200,"text/css"],
  ["/assets/textures/2k_sun.jpg",200,"image/jpeg"],
  ["/assets/textures/2k_saturn_ring_alpha.png",200,"image/png"],
  ["/missing",404,""],
  ["/server.ts",404,""],
  ["/.git/config",404,""],
  ["/src/%2e%2e%2fserver.ts",404,""],
];
for (const [path,status,type] of routes) {
  const response = await fetch(origin+path);
  if (response.status!==status || (type && !response.headers.get("content-type")?.includes(type))) throw new Error(`${path}: unexpected HTTP ${response.status}, ${response.headers.get("content-type")}`);
  console.log(`PASS ${path}: ${response.status}`);
}
const head = await fetch(origin,{method:"HEAD"});
if (head.status!==200 || (await head.text()).length!==0) throw new Error("Invalid HEAD response");
const post = await fetch(origin,{method:"POST"});
if (post.status!==405) throw new Error("POST should return 405");
console.log("PASS HEAD and unsupported-method handling");
