import { resolve, sep } from "node:path";

const root = import.meta.dir;
const publicRoot = resolve(root, "docs");
const port = Number(process.env.PORT ?? 3000);

const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch(request) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }
    let pathname: string;
    try { pathname = decodeURIComponent(new URL(request.url).pathname); }
    catch { return new Response("Bad URL", { status: 400 }); }
    const relative = pathname === "/" ? "index.html" : pathname.slice(1);
    const path = resolve(publicRoot, relative);
    if (!path.startsWith(publicRoot + sep) || relative.split(/[\\/]/).some(part => part.startsWith("."))) {
      return new Response("Not found", { status: 404 });
    }
    const file = Bun.file(path);
    if (!(await file.exists())) return new Response("Not found", { status: 404 });
    const headers = new Headers({
      "Cache-Control": pathname.startsWith("/assets/") ? "public, max-age=86400" : "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Content-Type": path.endsWith(".wgsl") ? "text/plain; charset=utf-8" : file.type,
    });
    return new Response(request.method === "HEAD" ? null : file, { headers });
  },
});

console.log(`Solar is running at http://${server.hostname}:${server.port}`);
