import { Renderer } from "./renderer.js";
import { Simulation } from "./simulation.js";
import { Camera } from "./camera.js";

const output = document.getElementById("results");
const errors = [];
const renderer = new Renderer(document.getElementById("fixture"),message => errors.push(message));
const simulation = new Simulation(0), camera = new Camera();
const parameters = new URLSearchParams(location.search);
const frames = 48, batches = 7;
const median = values => [...values].sort((a,b) => a-b)[Math.floor(values.length/2)];

// Time the whole batch once, from its first scene through its last composite.
// Some backends overlap pass timestamp ranges across frames; summing those
// ranges overcounts GPU time. No per-frame mapping, waits or profiling buffers.
function timestamps(renderer) {
  const device = renderer.device;
  if (!device.features.has("timestamp-query")) return null;
  const count = 2, size = count*8;
  const querySet = device.createQuerySet({ type: "timestamp", count });
  const resolve = device.createBuffer({ size, usage: GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC });
  const readback = device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ });
  const start = { querySet, beginningOfPassWriteIndex: 0 };
  const end = { querySet, endOfPassWriteIndex: 1 };
  return {
    frame(index) {
      if (index===0) renderer.scenePass.timestampWrites = start;
      else if (index===1) delete renderer.scenePass.timestampWrites;
      if (index===frames-1) renderer.finalPass.timestampWrites = end;
    },
    async read() {
      const encoder = device.createCommandEncoder();
      encoder.resolveQuerySet(querySet,0,count,resolve,0);
      encoder.copyBufferToBuffer(resolve,0,readback,0,size);
      device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      try {
        const values = new BigUint64Array(readback.getMappedRange());
        if (values[1]<values[0]) throw new Error("Non-monotonic GPU timestamps");
        return Number(values[1]-values[0])/1e6/frames;
      } finally { readback.unmap(); }
    },
    destroy() {
      delete renderer.scenePass.timestampWrites; delete renderer.finalPass.timestampWrites;
      querySet.destroy(); resolve.destroy(); readback.destroy();
    },
  };
}

let timer;
try {
  const width = Number(parameters.get("width") ?? 640), height = Number(parameters.get("height") ?? 360);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width<2 || height<2 || width>4096 || height>4096) {
    throw new Error("Benchmark width and height must be integers from 2 to 4096");
  }
  // CSS must not shrink the fixture when it exceeds the viewport.
  renderer.canvas.style.width = `${width}px`; renderer.canvas.style.height = `${height}px`;
  renderer.scale = 1/Math.min(devicePixelRatio || 1,1.5);
  renderer.bloom = parameters.get("bloom")!=="0";
  renderer.atmospheres = parameters.get("atmospheres")!=="0";
  await renderer.init(simulation.data,message => { output.textContent = message; },{ timestampQueries: true });
  if (renderer.width!==width || renderer.height!==height) throw new Error(`Requested ${width} × ${height}; actual target is ${renderer.width} × ${renderer.height}`);
  renderer.markerOpacity = 1;
  simulation.solarSeconds = 12; simulation.deltaSeconds = .25;
  const environment = {
    browser: navigator.userAgent, adapter: renderer.adapterName,
    width: renderer.width, height: renderer.height, maps: renderer.maps.width,
    bloom: renderer.bloom, atmospheres: renderer.atmospheres, frames, batches,
    timestampQueries: renderer.device.features.has("timestamp-query"),
  };
  const results = [];
  const heading = `${width} × ${height} · ${renderer.adapterName} · ${renderer.maps.width}px maps\nBloom ${renderer.bloom ? "on" : "off"}, atmospheres ${renderer.atmospheres ? "on" : "off"}\n${navigator.userAgent}\n`;
  for (const [name,index] of [["Low-angle system",-1],["Sun close-up",0],["Earth close-up",3],["Saturn close-up",6]]) {
    if (index<0) { camera.overview(); camera.goalPhi = .08; }
    else { camera.focus(index,simulation.data); }
    camera.snap = true; camera.update(0,simulation.data);
    // Leave warm-up untimed, and snap local detail to its settled state.
    for (let i = 0; i<24; i++) renderer.render(camera,simulation,index);
    await renderer.device.queue.onSubmittedWorkDone();
    timer = timestamps(renderer);
    const samples = [];
    for (let batch = 0; batch<batches; batch++) {
      const start = performance.now();
      for (let frame = 0; frame<frames; frame++) {
        timer?.frame(frame); renderer.render(camera,simulation,index);
      }
      const cpu = (performance.now()-start)/frames;
      await renderer.device.queue.onSubmittedWorkDone();
      const wall = (performance.now()-start)/frames;
      const gpu = timer ? await timer.read() : null;
      // Do not timestamp the next batch's warm-up/early frames with the old end.
      delete renderer.finalPass.timestampWrites;
      if (errors.length) throw new Error(errors.join("; "));
      samples.push({ cpu, wall, gpu });
    }
    timer?.destroy(); timer = null;
    const wall = median(samples.map(s => s.wall)), cpu = median(samples.map(s => s.cpu));
    const gpu = environment.timestampQueries ? median(samples.map(s => s.gpu)) : null;
    results.push({ name, wall, cpu, gpu, draws: renderer.drawCalls, samples });
    output.textContent = heading+results.map(r => `${r.name}:\n  Completion ${r.wall.toFixed(3)} ms/frame (batch range ${Math.min(...r.samples.map(s => s.wall)).toFixed(3)}–${Math.max(...r.samples.map(s => s.wall)).toFixed(3)})\n  CPU encode/submit ${r.cpu.toFixed(3)} ms/frame\n  GPU batch average ${r.gpu===null ? "timestamps unavailable" : `${r.gpu.toFixed(3)} ms/frame`} · ${r.draws} draws`).join("\n");
  }
  output.dataset.results = JSON.stringify({ environment, results });
  output.dataset.complete = "true";
} catch (error) { output.textContent = error.message; output.dataset.failed = "true"; }
finally { timer?.destroy(); renderer.destroy(); }
