import { Renderer } from "./renderer.js";
import { Simulation } from "./simulation.js";
import { Camera } from "./camera.js";
import { BODY_FLOATS } from "./data.js";

const summary = document.getElementById("summary");
const results = document.getElementById("results");
let failures = 0, passes = 0;
const errors = [];
const renderer = new Renderer(document.getElementById("test-canvas"),message => errors.push(message));
function check(name,condition,detail="") {
  const li = document.createElement("li");
  li.className = condition ? "pass" : "fail";
  li.textContent = `${condition?"PASS":"FAIL"} — ${name}${detail?` (${detail})`:""}`;
  results.append(li);
  if (condition) passes++; else failures++;
}
function half(value) {
  const sign = value&0x8000 ? -1 : 1, exp = (value>>10)&31, fraction = value&1023;
  return sign * (exp===0 ? Math.pow(2,-14)*(fraction/1024) : exp===31 ? Infinity : Math.pow(2,exp-15)*(1+fraction/1024));
}

try {
  const simulation = new Simulation(0), camera = new Camera();
  await renderer.init(simulation.data,message => { summary.textContent = message; });
  renderer.bloom = false; renderer.atmospheres = false; renderer.orbits = false;
  const device = renderer.device;
  device.pushErrorScope("validation");
  const target = device.createTexture({ size: [renderer.width,renderer.height],format: "rgba16float",usage: GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC });
  const targetView = target.createView();
  renderer.sceneAttachment.view = targetView;
  const readback = device.createBuffer({ size: 256,usage: GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ });
  camera.eye.set([7.5,0,0]); camera.forward.set([1,0,0]);
  camera.right.set([0,0,1]); camera.up.set([0,1,0]);
  const data = simulation.data;
  for (let i = 0; i < 10; i++) {
    data[i*BODY_FLOATS] = 1000+i*20; data[i*BODY_FLOATS+1] = 1000; data[i*BODY_FLOATS+2] = 1000;
  }
  data[0] = data[1] = data[2] = 0;
  // A small Sun gives this controlled scene a genuine umbra. Display geometry
  // with the normal 2.5-unit Sun instead produces an annular eclipse here.
  data[3] = .4;
  const earth = 3*BODY_FLOATS, moon = 9*BODY_FLOATS;
  data[earth] = 10; data[earth+1] = data[earth+2] = 0;
  data[moon] = 6; data[moon+1] = 2; data[moon+2] = 0;

  async function luminance() {
    renderer.render(camera,simulation,3);
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture: target,origin: [Math.floor(renderer.width*.59),Math.floor(renderer.height*.5)] },{ buffer: readback,bytesPerRow: 256 },[1,1]);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const rgba = new Uint16Array(readback.getMappedRange());
    const luma = half(rgba[0])*.2126+half(rgba[1])*.7152+half(rgba[2])*.0722;
    readback.unmap();
    return luma;
  }
  const lit = await luminance();
  check("Textured surface receives direct sunlight",lit>.04,`linear luminance ${lit.toFixed(4)}`);
  data[moon+1] = 0;
  const shadow = await luminance();
  check("An intervening Moon casts a shadow",shadow<lit*.18,`${lit.toFixed(4)} → ${shadow.toFixed(4)}`);
  data[moon+1] = 2;
  const restored = await luminance();
  check("Moving the occluder restores sunlight",Math.abs(restored-lit)<.001);
  data[earth+1] = 10;
  const background = await luminance();
  check("A missed sphere reveals the background",background<lit*.2);
  data[earth+1] = 0;

  // Exercise the production visibility function directly, independently of
  // albedo, ambient light and post-processing. This test-only entry point is
  // appended to the unchanged production WGSL and uses its existing resources.
  const visibilityModule = device.createShaderModule({ code:
    await (await fetch(new URL("./scene.wgsl",import.meta.url))).text() + `
@group(1) @binding(0) var<storage, read_write> shadowResult: array<f32>;
@compute @workgroup_size(1) fn checkVisibility() {
  shadowResult[0] = sunVisibility(vec3f(10.002,0.0,0.0),vec3f(-1.0,0.0,0.0),3u,true);
}` });
  const output = device.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC });
  const resultLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }] });
  const resultBind = device.createBindGroup({ layout: resultLayout, entries: [{ binding: 0, resource: { buffer: output } }] });
  // The scene's automatic layout exposes resources to fragment shaders only;
  // the test entry point needs a compute-visible layout for those same resources.
  const visibilityLayout = device.createBindGroupLayout({ entries: [
    { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
    { binding: 3, visibility: GPUShaderStage.COMPUTE, sampler: { type: "filtering" } },
    { binding: 4, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "float", viewDimension: "2d" } },
  ] });
  const visibilityBind = device.createBindGroup({ layout: visibilityLayout, entries: [
    { binding: 1, resource: { buffer: renderer.bodyBuffer } },
    { binding: 3, resource: renderer.mapSampler },
    { binding: 4, resource: renderer.ring.createView() },
  ] });
  const visibilityPipeline = await device.createComputePipelineAsync({
    layout: device.createPipelineLayout({ bindGroupLayouts: [visibilityLayout,resultLayout] }),
    compute: { module: visibilityModule, entryPoint: "checkVisibility" },
  });
  async function readVisibility() {
    device.queue.writeBuffer(renderer.bodyBuffer,0,data);
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(visibilityPipeline); pass.setBindGroup(0,visibilityBind); pass.setBindGroup(1,resultBind);
    pass.dispatchWorkgroups(1); pass.end();
    encoder.copyBufferToBuffer(output,0,readback,0,4);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const value = new Float32Array(readback.getMappedRange())[0];
    readback.unmap();
    return value;
  }
  // Independent numerical reference: a Cartesian grid across the actual visible
  // solar disc, testing 3D ray/sphere silhouettes. No circle-overlap formula or
  // production sampling pattern is reused in this reference.
  function referenceVisibility(indices) {
    let clear = 0, total = 0;
    const sunSin = data[3]/10;
    for (let y = 0; y < 128; y++) for (let z = 0; z < 128; z++) {
      const sy = (y+.5)/64-1, sz = (z+.5)/64-1;
      if (sy*sy+sz*sz>=1) continue;
      const ry = sy*sunSin, rz = sz*sunSin, rx = -Math.sqrt(1-ry*ry-rz*rz);
      let blocked = false;
      for (const index of indices) {
        const o = index*BODY_FLOATS;
        const dx = data[o]-10, dy = data[o+1], dz = data[o+2];
        const t = dx*rx+dy*ry+dz*rz;
        if (t>0 && t<10 && dx*dx+dy*dy+dz*dz-t*t < data[o+3]*data[o+3]) { blocked = true; break; }
      }
      if (!blocked) clear++;
      total++;
    }
    return clear/total;
  }
  data[3] = 1;
  data[moon] = 6; data[moon+1] = data[moon+2] = 0; data[moon+3] = .8;
  check("A larger apparent Moon produces totality",(await readVisibility())<.0001);
  data[moon+3] = .2;
  const annular = await readVisibility();
  check("A smaller aligned Moon leaves an annular eclipse",Math.abs(annular-.7506)<.002,`visible fraction ${annular.toFixed(4)}`);
  data[moon+3] = .6;
  let last = -1, intermediate = 0, maxError = 0, maxStep = 0, monotonic = true;
  for (let i = 0; i <= 12; i++) {
    data[moon+1] = i*.1;
    const fraction = await readVisibility();
    const reference = referenceVisibility([9]);
    if (fraction>0.001 && fraction<.999) intermediate++;
    if (last>=0) { monotonic &&= fraction>=last-.0001; maxStep = Math.max(maxStep,fraction-last); }
    maxError = Math.max(maxError,Math.abs(fraction-reference));
    last = fraction;
  }
  check("Penumbra changes continuously from umbra to full light",monotonic && intermediate>=6 && maxStep<.21 && last>.999,`${intermediate} partial-shadow positions`);
  check("Analytic penumbra agrees with independent solar-disc integration",maxError<.02,`maximum error ${maxError.toFixed(4)}`);
  data[moon+1] = 0; data[moon+3] = .3;
  const nearBlocker = await readVisibility();
  data[moon] = 3;
  const farBlocker = await readVisibility();
  check("A more distant blocker covers less of the finite Sun",farBlocker>nearBlocker+.2);
  data[moon] = 6; data[moon+3] = .2;
  data[3] = .5; const smallSun = await readVisibility();
  data[3] = 2; const largeSun = await readVisibility();
  check("Increasing the Sun's radius changes eclipse coverage",smallSun<.001 && largeSun>.9);
  data[3] = 1;
  data[moon] = 12; const behind = await readVisibility();
  data[moon] = -2; const beyond = await readVisibility();
  check("Bodies behind the receiver or beyond the Sun do not shadow it",behind>.999 && beyond>.999);
  data[moon] = 6;
  const single = await readVisibility();
  const mercury = BODY_FLOATS;
  data[mercury] = 6; data[mercury+1] = data[mercury+2] = 0; data[mercury+3] = .2;
  const duplicate = await readVisibility();
  check("Overlapping blockers do not count the same shadow twice",Math.abs(duplicate-single)<.04);
  data[moon+1] = .25; data[moon+3] = .15;
  data[mercury+1] = -.25; data[mercury+3] = .15;
  const disjoint = await readVisibility(), disjointReference = referenceVisibility([1,9]);
  check("Multiple blockers integrate the union of their silhouettes",Math.abs(disjoint-disjointReference)<.08 && disjoint<.82,`${disjoint.toFixed(4)} vs reference ${disjointReference.toFixed(4)}`);
  // Restore a normal controlled scene for the existing resource/pipeline checks.
  data[mercury] = data[mercury+1] = data[mercury+2] = 1000;
  data[moon+1] = 2;
  output.destroy();
  const generation = renderer.resourceGeneration, uniforms = renderer.uniforms, buffer = renderer.bodyBuffer;
  for (let i = 0; i < 10; i++) renderer.render(camera,simulation,3);
  await device.queue.onSubmittedWorkDone();
  check("Steady frames reuse targets, uniforms and body buffers",renderer.resourceGeneration===generation && renderer.uniforms===uniforms && renderer.bodyBuffer===buffer);
  check("Bloom off skips all compute dispatches",renderer.computePasses===0);

  // Resize once, then repeat at the same size: only one resource rebuild.
  renderer.scale = .7; renderer.resize();
  renderer.resize();
  check("Resolution changes rebuild targets exactly once",renderer.resourceGeneration===generation+1);
  // Real bloom pipelines, including storage-texture transitions, are validated.
  renderer.bloom = true;
  renderer.render(camera,simulation,3);
  await device.queue.onSubmittedWorkDone();
  check("Bloom uses three dispatches and two render draws",renderer.computePasses===3 && renderer.drawCalls===2);
  const validation = await device.popErrorScope();
  check("All production shaders and GPU commands validate",!validation && errors.length===0,validation?.message || errors.join("; "));
  readback.destroy(); target.destroy();
  summary.textContent = `${passes} passed, ${failures} failed.`;
  summary.className = failures ? "fail" : "pass";
} catch (error) {
  check("GPU verification completed",false,error.message);
  summary.textContent = `${passes} passed, ${failures} failed.`;
  summary.className = "fail";
} finally { renderer.destroy(); }
