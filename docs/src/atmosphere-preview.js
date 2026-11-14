import { Renderer } from "./renderer.js";
import { Simulation } from "./simulation.js";
import { Camera } from "./camera.js";
import { BODIES, BODY_FLOATS, DEG } from "./data.js";
const $ = id => document.getElementById(id);
const status = $("status"), timing = $("timing");
const renderer = new Renderer($("fixture"),message => { status.textContent = message; });
const simulation = new Simulation(0);
let camera, ready = false, resizeObserver;
function setup() {
  const index = Number($("body").value), radius = BODIES[index].radius, data = simulation.data;
  simulation.reset(0);
  for (let i = 0; i < BODIES.length; i++) {
    const offset = i*BODY_FLOATS;
    data[offset] = 1000+i*20; data[offset+1] = data[offset+2] = 1000;
  }
  const offset = index*BODY_FLOATS;
  data[offset+1] = 0;
  const phase = Number($("phase").value)*DEG;
  data[offset] = -Math.sin(phase)*radius*30;
  data[offset+2] = -Math.cos(phase)*radius*30;
  data[0] = data[1] = data[2] = 0;
  data[3] = radius*.14;
  camera = new Camera(); camera.focus(index,data); camera.focusOffset.fill(0);
  camera.goalTheta = 0; camera.goalPhi = 0;
  camera.goalDistance = radius*(index===6?8:5.6);
  camera.snap = true; camera.update(0,data);
  renderer.atmospheres = $("atmospheres").checked;
  renderer.bloom = false; renderer.orbits = false;
  renderer.render(camera,simulation,index);
  status.textContent = `${BODIES[index].name} · ${$("phase").selectedOptions[0].text} · ${renderer.width} × ${renderer.height} · ${renderer.drawCalls} draws/frame`;
}
async function measure() {
  const controls = document.querySelectorAll(".controls select,.controls input,.controls button");
  for (const control of controls) control.disabled = true;
  const enabled = $("atmospheres").checked, index = Number($("body").value), samples = [];
  try {
    for (const atmosphere of [false,true]) {
      renderer.atmospheres = atmosphere;
      for (let i = 0; i < 16; i++) renderer.render(camera,simulation,index);
      await renderer.device.queue.onSubmittedWorkDone();
      const batches = [];
      for (let batch = 0; batch < 5; batch++) {
        const start = performance.now();
        for (let frame = 0; frame < 32; frame++) renderer.render(camera,simulation,index);
        await renderer.device.queue.onSubmittedWorkDone();
        batches.push((performance.now()-start)/32);
      }
      batches.sort((a,b) => a-b); samples.push(batches[2]);
    }
    timing.textContent = `Median batch completion time/frame (CPU submission + GPU completion, 5 × 32 frames):\nAtmospheres off: ${samples[0].toFixed(3)} ms\nAtmospheres on:  ${samples[1].toFixed(3)} ms\nDifference:      ${(samples[1]-samples[0]).toFixed(3)} ms`;
  } finally { renderer.atmospheres = enabled; setup(); for (const control of controls) control.disabled = false; }
}
try {
  await renderer.init(simulation.data,message => { status.textContent = message; });
  ready = true; setup(); $("benchmark").disabled = false;
  for (const id of ["body","phase","atmospheres"]) $(id).addEventListener("change",() => { timing.textContent = ""; setup(); });
  $("benchmark").addEventListener("click",() => measure().catch(error => { timing.textContent = error.message; }));
  resizeObserver = new ResizeObserver(() => { if (ready) { renderer.resize(); setup(); } });
  resizeObserver.observe($("fixture"));
} catch (error) { status.textContent = error.message; }
window.addEventListener("pagehide",() => { ready = false; resizeObserver?.disconnect(); renderer.destroy(); });
