import { Renderer } from "./renderer.js";
import { Simulation } from "./simulation.js";
import { Camera } from "./camera.js";

const output = document.getElementById("results");
const renderer = new Renderer(document.getElementById("fixture"),message => { throw new Error(message); });
const simulation = new Simulation(0), camera = new Camera();
try {
  await renderer.init(simulation.data,message => { output.textContent = message; });
  renderer.scale = 1/(Math.min(devicePixelRatio || 1,1.5)); renderer.resize();
  renderer.markerOpacity = 1;
  const results = [];
  for (const [name,index] of [["Low-angle system",-1],["Earth close-up",3],["Saturn close-up",6]]) {
    if (index<0) { camera.overview(); camera.goalPhi = .08; }
    else { camera.focus(index,simulation.data); }
    camera.snap = true; camera.update(0,simulation.data);
    // Snap local detail to its settled state for each measurement.
    simulation.deltaSeconds = .25;
    for (let i = 0; i < 8; i++) renderer.render(camera,simulation,index);
    await renderer.device.queue.onSubmittedWorkDone();
    const batches = [];
    for (let batch = 0; batch < 5; batch++) {
      const start = performance.now();
      for (let frame = 0; frame < 24; frame++) renderer.render(camera,simulation,index);
      await renderer.device.queue.onSubmittedWorkDone();
      batches.push((performance.now()-start)/24);
    }
    batches.sort((a,b) => a-b);
    results.push(`${name}: ${batches[2].toFixed(3)} ms/frame, ${renderer.drawCalls} draws`);
    output.textContent = `${renderer.width} × ${renderer.height}\n${results.join("\n")}`;
  }
  output.dataset.complete = "true";
} catch (error) { output.textContent = error.message; output.dataset.failed = "true"; }
finally { renderer.destroy(); }
