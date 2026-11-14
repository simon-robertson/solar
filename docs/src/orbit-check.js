import { Renderer } from "./renderer.js";
import { Simulation } from "./simulation.js";
import { Camera } from "./camera.js";
import { BODIES, BODY_FLOATS } from "./data.js";
import { ORBIT_COUNT, ORBIT_FLOATS, ORBIT_SEGMENTS } from "./orbit-details.js";

const summary = document.getElementById("summary"), results = document.getElementById("results");
let passes = 0, failures = 0;
const errors = [], resources = [];
const renderer = new Renderer(document.getElementById("test-canvas"),message => errors.push(message));
function check(name,condition,detail="") {
  const item = document.createElement("li"); item.className = condition ? "pass" : "fail";
  item.textContent = `${condition?"PASS":"FAIL"} — ${name}${detail?` (${detail})`:""}`; results.append(item);
  if (condition) passes++; else failures++;
}
function half(value) {
  const sign = value&0x8000 ? -1 : 1, exp = (value>>10)&31, fraction = value&1023;
  return sign*(exp===0 ? 2**-14*fraction/1024 : exp===31 ? Infinity : 2**(exp-15)*(1+fraction/1024));
}
try {
  const simulation = new Simulation(0), camera = new Camera();
  await renderer.init(simulation.data,message => { summary.textContent = message; });
  renderer.scale = 2/Math.min(devicePixelRatio || 1,1.5); renderer.resize();
  const device = renderer.device, width = renderer.width, height = renderer.height;
  device.pushErrorScope("validation");
  const target = device.createTexture({ size: [width,height], format: "rgba16float", usage: GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC });
  const bytesPerRow = Math.ceil(width*8/256)*256;
  const readback = device.createBuffer({ size: bytesPerRow*height, usage: GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ });
  resources.push(target,readback);
  const passDescriptor = { colorAttachments: [{ view: target.createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0,g: 0,b: 0,a: 1 } }] };
  const orbits = new Float32Array(ORBIT_COUNT*ORBIT_FLOATS), uniforms = new Float32Array(24), bodies = simulation.data.slice();
  orbits.set([1,0,0,1, 0,0,-1,0, 0,0,0,1, 0,1,0,1]);
  function parkBodies() {
    for (let i = 0; i < BODIES.length; i++) {
      bodies[i*BODY_FLOATS] = 1000+i*20; bodies[i*BODY_FLOATS+1] = bodies[i*BODY_FLOATS+2] = 1000;
    }
  }
  parkBodies();
  function cameraUniforms() {
    uniforms.set([...camera.eye,camera.tanFov,...camera.right,width/height,...camera.up,0,...camera.forward,1,width,height,1,1,0,0,1,1]);
  }
  function view(distance=7,inclination=.7,target=[0,0,0]) {
    camera.goalDistance = distance; camera.goalTheta = 0; camera.goalPhi = inclination;
    camera.focused = -1; camera.focusOffset.fill(0); camera.snap = true; camera.update(0,simulation.data);
    for (let j = 0; j < 3; j++) camera.eye[j] += target[j];
    cameraUniforms();
  }
  const project = point => Array.from(camera.project(...point,width,height));
  const circlePoint = angle => [Math.cos(angle),0,-Math.sin(angle)];
  async function draw(lines=true,markers=false) {
    device.queue.writeBuffer(renderer.uniformBuffer,0,uniforms);
    device.queue.writeBuffer(renderer.orbitBuffer,0,orbits);
    device.queue.writeBuffer(renderer.bodyBuffer,0,bodies);
    const encoder = device.createCommandEncoder(), pass = encoder.beginRenderPass(passDescriptor);
    pass.setBindGroup(0,renderer.sceneBind);
    if (lines) { pass.setPipeline(renderer.orbitPipeline); pass.draw(ORBIT_SEGMENTS*6,ORBIT_COUNT); }
    if (markers) { pass.setPipeline(renderer.markerPipeline); pass.draw(6,ORBIT_COUNT); }
    pass.end();
    encoder.copyTextureToBuffer({ texture: target },{ buffer: readback,bytesPerRow },[width,height]);
    device.queue.submit([encoder.finish()]); await readback.mapAsync(GPUMapMode.READ);
    const pixels = new Uint16Array(readback.getMappedRange()), image = new Float32Array(width*height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const o = y*bytesPerRow/2+x*4;
      image[y*width+x] = half(pixels[o])+half(pixels[o+1])+half(pixels[o+2]);
    }
    readback.unmap(); return image;
  }
  const at = (image,x,y) => x>=0 && y>=0 && x<width && y<height ? image[Math.floor(y)*width+Math.floor(x)] : 0;
  function peakAt(image,point) {
    let peak = 0;
    for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) peak = Math.max(peak,at(image,point[0]+x,point[1]+y));
    return peak;
  }
  function bilinear(image,x,y) {
    const px = x-.5, py = y-.5, tx = px-Math.floor(px), ty = py-Math.floor(py);
    return (at(image,px,py)*(1-tx)+at(image,px+1,py)*tx)*(1-ty)+(at(image,px,py+1)*(1-tx)+at(image,px+1,py+1)*tx)*ty;
  }
  // Independent dense sampling of the mathematical ellipse, not the renderer's
  // polygon or clip function. Every lit pixel must lie in its 2-pixel envelope.
  function referenceEnvelope() {
    const mask = new Uint8Array(width*height);
    for (let i = 0; i < 32768; i++) {
      const p = project(circlePoint(i/32768*Math.PI*2));
      if (p[2]<=.001 || p[0]<-3 || p[0]>width+3 || p[1]<-3 || p[1]>height+3) continue;
      for (let y = Math.max(0,Math.floor(p[1])-2); y <= Math.min(height-1,Math.floor(p[1])+2); y++) {
        for (let x = Math.max(0,Math.floor(p[0])-2); x <= Math.min(width-1,Math.floor(p[0])+2); x++) mask[y*width+x] = 1;
      }
    }
    return mask;
  }
  let bounded = true, visible = true, stray = 0;
  for (const inclination of [.08,.005,0,-.005,-.08]) {
    view(7,inclination);
    const image = await draw(), mask = referenceEnvelope();
    const lit = image.reduce((count,value) => count+(value>.00001),0);
    visible &&= lit>30;
    image.forEach((value,i) => { if (!Number.isFinite(value) || (value>.00001 && !mask[i])) stray++; });
  }
  bounded &&= stray===0;
  check("Low-angle and coplanar views have no detached background trails",bounded && visible,`${stray} pixels outside the independent ellipse envelope`);
  let closeVisible = true;
  for (const [distance,inclination,target] of [[.5,0,[0,0,0]],[1,0,[0,0,0]],[.3,.25,[1,0,0]]]) {
    view(distance,inclination,target);
    const image = await draw(), mask = referenceEnvelope();
    closeVisible &&= image.filter(x=>x>.00001).length>30 && image.every((x,i)=>Number.isFinite(x) && (x<=.00001 || mask[i]));
  }
  check("Near-plane crossings and planet-scale close-ups retain bounded paths",closeVisible);
  const baseOrbit = orbits.slice(), closeups = [];
  bodies.set(simulation.data);
  for (let index = 1; index <= 8; index++) {
    camera.focus(index,simulation.data); camera.snap = true; camera.update(0,simulation.data); cameraUniforms();
    renderer.orbitDetails.update(simulation,camera,width/height);
    orbits.set(renderer.orbitDetails.data);
    for (let i = 0; i < ORBIT_COUNT; i++) if (i!==index-1) orbits[i*ORBIT_FLOATS+11] = 0;
    const image = await draw();
    closeups.push(image.filter(x=>x>.00001).length);
  }
  check("Every planet retains its actual orbit in its default close-up",closeups.every(count=>count>20),closeups.join(", ")+" lit path pixels");
  orbits.set(baseOrbit); parkBodies();
  view(); orbits[10] = 20;
  check("Orbits entirely behind the camera emit no pixels",(await draw()).every(x=>x===0)); orbits[10] = 0;

  view(); orbits[12] = 0;
  const forward = await draw(); orbits[13] = -1;
  const reverse = await draw();
  const before = project(circlePoint(-.5)), after = project(circlePoint(.5));
  check("Orbit brightness trails the body and reverses with time",peakAt(forward,before)>peakAt(forward,after)*3 && peakAt(reverse,after)>peakAt(reverse,before)*3);
  orbits[13] = 1;
  const widths = [], pairs = [];
  for (const [distance,inclination] of [[5,.3],[10,.3],[5,1],[10,1]]) {
    view(distance,inclination);
    const angle = -.3, center = project(circlePoint(angle)), along = project(circlePoint(angle+.001));
    const length = Math.hypot(along[0]-center[0],along[1]-center[1]);
    const normal = [-(along[1]-center[1])/length,(along[0]-center[0])/length], pair = [];
    for (const phase of [angle+.3,angle+.9*Math.PI*2]) {
      orbits[12] = phase;
      const image = await draw(), values = [];
      for (let i = -32; i <= 32; i++) values.push(bilinear(image,center[0]+normal[0]*i*.125,center[1]+normal[1]*i*.125));
      const peak = Math.max(...values), span = values.filter(x=>x>=peak*.5).length*.125;
      widths.push(span); pair.push(span);
    }
    pairs.push(Math.abs(pair[0]-pair[1]));
  }
  check("Thin stroke width is independent of trail brightness, zoom and inclination",Math.max(...pairs)<=.125 && Math.min(...widths)>=.75 && Math.max(...widths)<=2.5,`raster half-maximum widths ${widths.map(x=>x.toFixed(2)).join(", ")} pixels`);

  view(); orbits[12] = 0; orbits[14] = 1; orbits[15] = -1;
  const center = project([1,0,0]), marker = await draw(false,true);
  check("Moon annotations remain hollow screen-space circles",at(marker,...center)===0 && peakAt(marker,[center[0]+11,center[1]])>.3 && at(marker,center[0]+15,center[1])===0);
  let fixedRadius = true;
  for (const distance of [5,14]) for (const ratio of [.7,1,1.35,2]) {
    view(distance); uniforms[22] = ratio;
    const c = project([1,0,0]), image = await draw(false,true);
    fixedRadius &&= peakAt(image,[c[0]+11*ratio,c[1]])>.3 && at(image,c[0]+15*ratio,c[1])===0;
  }
  check("Circle CSS size survives zoom and resolution changes",fixedRadius);
  view();
  const edge = [Math.floor(center[0]+11)+.5,Math.floor(center[1])+.5];
  const ndc = [edge[0]/width*2-1.18,1-edge[1]/height*2];
  const ray = Array.from(camera.forward,(_,j)=>camera.forward[j]+camera.tanFov*(ndc[0]*width/height*camera.right[j]+ndc[1]*camera.up[j]));
  const magnitude = Math.hypot(...ray), saturn = 6*BODY_FLOATS;
  for (let j = 0; j < 3; j++) bodies[saturn+j] = camera.eye[j]+ray[j]/magnitude-(j===0?1.5:0);
  bodies[saturn+3] = 1;
  const ring = await draw(false,true), clearEdge = at(marker,...edge), ringEdge = at(ring,...edge);
  check("Foreground rings attenuate circles with actual texture alpha",ringEdge>clearEdge*.01 && ringEdge<clearEdge*.95,`${clearEdge.toFixed(3)} → ${ringEdge.toFixed(3)}`);
  parkBodies();
  for (let j = 0; j < 3; j++) bodies[BODY_FLOATS+j] = camera.eye[j]+camera.forward[j];
  bodies[BODY_FLOATS+3] = .8;
  check("Opaque foreground bodies hide circles",(await draw(false,true)).every(x=>x===0));
  parkBodies();
  uniforms[19] = 0;
  check("Orbit toggle removes lines while keeping entity circles",(await draw()).every(x=>x===0) && (await draw(false,true)).some(x=>x>.3));
  uniforms[19] = 1; uniforms[23] = 0;
  check("Camera motion opacity hides circle annotations",(await draw(false,true)).every(x=>x===0));
  uniforms[23] = 1; orbits[11] = 0;
  check("Inactive local LOD emits neither paths nor circles",(await draw(true,true)).every(x=>x===0));

  // The broad renderer checks also cover atmosphere/shadow/bloom changes. Here
  // validate the new batching, actual draw count and target/buffer reuse.
  const generation = renderer.resourceGeneration, points = renderer.orbitPoints;
  const production = new Simulation(0); camera.focus(6,production.data); camera.snap = true; camera.update(0,production.data);
  production.deltaSeconds = .25; renderer.render(camera,production,6);
  const detailedDraws = renderer.drawCalls;
  renderer.orbits = false; renderer.markerOpacity = 0; renderer.render(camera,production,6);
  await device.queue.onSubmittedWorkDone();
  const validation = await device.popErrorScope();
  check("Production batching validates, reuses resources and stays below ten draws",!validation && errors.length===0 && detailedDraws===4 && renderer.drawCalls===2 && renderer.resourceGeneration===generation && renderer.orbitPoints===points,validation?.message || errors.join("; ") || "4 draws with paths + moons; 2 with both hidden");
} catch (error) { check("Orbit verification completed",false,error.message); }
finally {
  for (const resource of resources) resource.destroy();
  renderer.destroy(); summary.textContent = `${passes} passed, ${failures} failed.`; summary.className = failures ? "fail" : "pass";
}
