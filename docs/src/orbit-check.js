import { Renderer } from "./renderer.js";
import { Simulation } from "./simulation.js";
import { Camera } from "./camera.js";
import { BODY_FLOATS } from "./data.js";
import { ORBIT_COUNT, ORBIT_FLOATS } from "./orbit-details.js";
const summary = document.getElementById("summary"), results = document.getElementById("results");
let passes = 0, failures = 0;
const errors = [];
const renderer = new Renderer(document.getElementById("test-canvas"),message => errors.push(message));
function check(name,condition,detail="") {
  const item = document.createElement("li"); item.className = condition ? "pass" : "fail";
  item.textContent = `${condition?"PASS":"FAIL"} — ${name}${detail?` (${detail})`:""}`; results.append(item);
  if (condition) passes++; else failures++;
}
try {
  const simulation = new Simulation(0), camera = new Camera();
  await renderer.init(simulation.data,message => { summary.textContent = message; });
  const device = renderer.device;
  device.pushErrorScope("validation");
  const source = await (await fetch(new URL("./scene.wgsl",import.meta.url))).text();
  const module = device.createShaderModule({ code: source+`
struct Probe { pixel: vec4f, mode: vec4f }
@group(1) @binding(0) var<storage, read> probes: array<Probe>;
@group(1) @binding(1) var<storage, read_write> output: array<vec4f>;
@compute @workgroup_size(64) fn probeOrbits(@builtin(global_invocation_id) id: vec3u) {
  if (id.x>=arrayLength(&probes)) { return; }
  let p = probes[id.x];
  let ndc = vec2f(p.pixel.x/camera.viewport.x*2.0-1.18,1.0-p.pixel.y/camera.viewport.y*2.0);
  let ray = normalize(camera.forward.xyz+camera.eye.w*(ndc.x*camera.right.w*camera.right.xyz+ndc.y*camera.up.xyz));
  var color = vec3f(0.0);
  if (p.mode.x==1.0) {
    color = satelliteMarkers(camera.eye.xyz,ray,p.pixel.xy,p.pixel.z,p.pixel.w);
  } else if (p.mode.x==2.0) {
    color = vec3f(orbitTrail(p.mode.y,p.mode.z,p.mode.w));
  } else if (p.mode.x==3.0) {
    color = vec3f(textureSampleLevel(ringMap,mapSampler,vec2f(p.mode.y,0.5),0.0).a);
  } else {
    color = orbitLines(camera.eye.xyz,ray,p.pixel.z,p.pixel.w);
  }
  output[id.x] = vec4f(color,1.0);
}` });
  const pipeline = await device.createComputePipelineAsync({ layout: "auto", compute: { module, entryPoint: "probeOrbits" } });
  const input = device.createBuffer({ size: 64*32, usage: GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST });
  const output = device.createBuffer({ size: 64*16, usage: GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC });
  const readback = device.createBuffer({ size: 64*16, usage: GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ });
  const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
    { binding: 0, resource: { buffer: renderer.uniformBuffer } },{ binding: 1, resource: { buffer: renderer.bodyBuffer } },
    { binding: 3, resource: renderer.mapSampler },{ binding: 4, resource: renderer.ring.createView() },
    { binding: 5, resource: { buffer: renderer.orbitBuffer } },
  ] });
  const orbits = new Float32Array(ORBIT_COUNT*ORBIT_FLOATS), uniforms = new Float32Array(24);
  orbits.set([1,0,0,1, 0,0,-1,0, 0,0,0,1, 0,1,0,1]);
  function view(distance=7,inclination=.7) {
    camera.goalDistance = distance; camera.goalTheta = 0; camera.goalPhi = inclination;
    camera.snap = true; camera.update(0,simulation.data);
    uniforms.set([...camera.eye,camera.tanFov,...camera.right,renderer.width/renderer.height,...camera.up,0,...camera.forward,1,renderer.width,renderer.height,1,1,0,0,1,1]);
    device.queue.writeBuffer(renderer.uniformBuffer,0,uniforms);
    device.queue.writeBuffer(renderer.orbitBuffer,0,orbits);
  }
  const project = point => Array.from(camera.project(...point,renderer.width,renderer.height));
  const pixel = (point,mode=0,near=100000) => [...point.slice(0,2),near,100000,mode,0,0,0];
  async function run(probes) {
    device.queue.writeBuffer(input,0,new Float32Array(probes.flat()));
    const probeBind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(1), entries: [
      { binding: 0, resource: { buffer: input, size: probes.length*32 } },{ binding: 1, resource: { buffer: output } },
    ] });
    const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass();
    pass.setPipeline(pipeline); pass.setBindGroup(0,bind); pass.setBindGroup(1,probeBind); pass.dispatchWorkgroups(1); pass.end();
    encoder.copyBufferToBuffer(output,0,readback,0,probes.length*16); device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const values = new Float32Array(readback.getMappedRange()).slice(0,probes.length*4); readback.unmap(); return values;
  }
  const light = (values,index=0) => values[index*4]+values[index*4+1]+values[index*4+2];
  view();
  const trail = await run([
    [0,0,100000,100000,2,0,-.4,1], [0,0,100000,100000,2,0,.4,1],
    [0,0,100000,100000,2,0,-.4,-1], [0,0,100000,100000,2,0,.4,-1],
  ]);
  check("Orbit emphasis trails the body and reverses with time",light(trail,0)>light(trail,1)*5 && light(trail,3)>light(trail,2)*5);

  const widths = [];
  for (const [distance,inclination] of [[5,.3],[10,.3],[5,1],[10,1]]) {
    view(distance,inclination);
    const angle = -.3, point = [Math.cos(angle),0,-Math.sin(angle)];
    const tangent = [-Math.sin(angle),0,-Math.cos(angle)], center = project(point);
    const along = project(point.map((x,j) => x+tangent[j]*.001));
    const length = Math.hypot(along[0]-center[0],along[1]-center[1]);
    const normal = [-(along[1]-center[1])/length,(along[0]-center[0])/length];
    const probes = [];
    for (let i = -20; i <= 20; i++) probes.push(pixel([center[0]+normal[0]*i*.25,center[1]+normal[1]*i*.25]));
    // Stay away from the trail's wrap point so a cross-section compares the
    // stroke itself rather than straddling its bright/dark phase boundary.
    for (const phase of [angle+.3,angle+.9*Math.PI*2]) {
      orbits[12] = phase; device.queue.writeBuffer(renderer.orbitBuffer,0,orbits);
      const values = await run(probes), peak = Math.max(...probes.map((_,i) => light(values,i)));
      widths.push(probes.filter((_,i) => light(values,i)>=peak*.5).length*.25);
    }
  }
  check("Thin orbit width stays uniform through brightness, zoom and foreshortening",Math.max(...widths)-Math.min(...widths)<=.5 && Math.min(...widths)>=.75 && Math.max(...widths)<=1.5,`half-maximum widths ${widths.map(x=>x.toFixed(2)).join(", ")} pixels`);
  orbits[12] = 0;

  view(); orbits[14] = 1; orbits[15] = -1; device.queue.writeBuffer(renderer.orbitBuffer,0,orbits);
  const center = project([1,0,0]);
  const marker = await run([pixel(center,1),pixel([center[0]+11,center[1]],1),pixel([center[0]+15,center[1]],1)]);
  check("Moon markers are hollow antialiased screen-space circles",light(marker)===0 && light(marker,1)>.5 && light(marker,2)===0);
  let fixedRadius = true;
  for (const distance of [5,14]) {
    for (const ratio of [.7,1,1.35,2]) {
      view(distance); uniforms[22] = ratio;
      device.queue.writeBuffer(renderer.uniformBuffer,0,uniforms);
      device.queue.writeBuffer(renderer.orbitBuffer,0,orbits);
      const c = project([1,0,0]);
      const samples = await run([pixel([c[0]+11*ratio,c[1]],1),pixel([c[0]+15*ratio,c[1]],1)]);
      fixedRadius &&= light(samples)>.5 && light(samples,1)===0;
    }
  }
  check("Circle CSS radius stays fixed through zoom and resolution changes",fixedRadius);
  view(); device.queue.writeBuffer(renderer.orbitBuffer,0,orbits);

  // Place the real ring annulus across the glyph's edge ray, with the sphere
  // itself clear of that ray. Compare against independently sampled ring alpha.
  const edge = [center[0]+11,center[1]], ndc = [edge[0]/renderer.width*2-1.18,1-edge[1]/renderer.height*2];
  const direction = Array.from(camera.forward,(_,j) => camera.forward[j]+camera.tanFov*(ndc[0]*renderer.width/renderer.height*camera.right[j]+ndc[1]*camera.up[j]));
  const magnitude = Math.hypot(...direction);
  const bodyData = simulation.data.slice(), saturn = 6*BODY_FLOATS;
  for (let j = 0; j < 3; j++) bodyData[saturn+j] = camera.eye[j]+direction[j]/magnitude-(j===0?1.5:0);
  bodyData[saturn+3] = 1; device.queue.writeBuffer(renderer.bodyBuffer,0,bodyData);
  const ringProbe = pixel(edge,1); ringProbe[3] = 1;
  const ring = await run([pixel(edge,1),ringProbe,[0,0,100000,100000,3,(1.5-1.23)/(2.32-1.23),0,0]]);
  const opacity = ring[8];
  check("Foreground rings attenuate circles using their texture opacity",opacity>0 && opacity<1 && Math.abs(light(ring,1)-light(ring)*(1-opacity))<.005);
  const depth = await run([pixel([center[0]+11,center[1]],1,.1)]);
  check("Foreground opaque depth hides moon markers",light(depth)===0);

  uniforms[19] = 0; device.queue.writeBuffer(renderer.uniformBuffer,0,uniforms);
  const independent = await run([pixel([center[0]+11,center[1]],1),pixel(project([Math.cos(-.3),0,-Math.sin(-.3)]))]);
  check("Orbit toggle hides paths while retaining moon entity circles",light(independent)>.5 && light(independent,1)===0);
  uniforms[19] = 1; uniforms[23] = 0; device.queue.writeBuffer(renderer.uniformBuffer,0,uniforms);
  const moving = await run([pixel([center[0]+11,center[1]],1)]);
  check("Camera-motion opacity hides circle annotations immediately",light(moving)===0);
  uniforms[23] = 1; device.queue.writeBuffer(renderer.uniformBuffer,0,uniforms);
  orbits[11] = 0; device.queue.writeBuffer(renderer.orbitBuffer,0,orbits);
  const far = await run([pixel([center[0]+11,center[1]],1),pixel(project([Math.cos(-.3),0,-Math.sin(-.3)]))]);
  check("Inactive LOD removes both local paths and moon markers",light(far)===0 && light(far,1)===0);

  renderer.render(camera,simulation,-1); await device.queue.onSubmittedWorkDone();
  const validation = await device.popErrorScope();
  check("Production orbit pipeline validates and retains two draws",!validation && errors.length===0 && renderer.drawCalls===2,validation?.message || errors.join("; "));
  input.destroy(); output.destroy(); readback.destroy();
} catch (error) { check("Orbit verification completed",false,error.message); }
finally {
  renderer.destroy(); summary.textContent = `${passes} passed, ${failures} failed.`; summary.className = failures ? "fail" : "pass";
}
