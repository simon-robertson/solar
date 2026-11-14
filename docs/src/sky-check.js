import { SKY_TEXTURE } from "./textures.js";
import { Simulation } from "./simulation.js";
import { Camera } from "./camera.js";

const DEG = Math.PI/180;
const half = v => (v&0x8000?-1:1)*((v>>10&31)===0 ? 2**-14*(v&1023)/1024 : 2**((v>>10&31)-15)*(1+(v&1023)/1024));
const luma = rgb => rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
const equatorialToWorld = ([x,y,z]) => {
  const c = Math.cos(23.4392911*DEG), s = Math.sin(23.4392911*DEG);
  return [x,-s*y+c*z,-c*y-s*z];
};
const icrs = (ra,dec) => equatorialToWorld([Math.cos(ra*DEG)*Math.cos(dec*DEG),Math.sin(ra*DEG)*Math.cos(dec*DEG),Math.sin(dec*DEG)]);
// Independent reference: published ICRS axes, then the existing world-axis
// convention. Do not copy the shader's pre-composed world-to-Galactic matrix.
function galactic(l,b) {
  const g = [Math.cos(l*DEG)*Math.cos(b*DEG),Math.sin(l*DEG)*Math.cos(b*DEG),Math.sin(b*DEG)];
  return equatorialToWorld([
    -.0548755604162154*g[0]+.4941094278755837*g[1]-.8676661490190047*g[2],
    -.8734370902348850*g[0]-.4448296299600112*g[1]-.1980763734312015*g[2],
    -.4838350155487132*g[0]+.7469822444972189*g[1]+.4559837761750669*g[2],
  ]);
}

export async function checkSky(renderer,check) {
  const device = renderer.device, resources = [];
  const saved = { bloom: renderer.bloom, orbits: renderer.orbits, atmospheres: renderer.atmospheres, markerOpacity: renderer.markerOpacity };
  const uniforms = renderer.uniforms.slice(), attachment = renderer.sceneAttachment.view;
  device.pushErrorScope("validation");
  try {
    const directions = [];
    const add = (direction,footprint=.0001) => { directions.push(...direction,footprint); return directions.length/4-1; };
    const centre = add(icrs(266.4049948,-28.9361740)), north = add(icrs(192.85948,27.12825)), south = add(icrs(12.85948,-27.12825));
    const seam = [add(galactic(180-.00001,0)),add(galactic(-180+.00001,0))];
    const poles = [];
    for (const b of [-89.9999,89.9999]) for (let l = -180; l<180; l += 45) poles.push(add(galactic(l,b)));
    const plane = [], high = [], core = [], anticentre = [], references = [];
    for (let l = -180; l<180; l += 5) {
      plane.push(add(galactic(l,0))); high.push(add(galactic(l,65)));
    }
    for (let l = -10; l<=10; l += 5) for (let b = -8; b<=8; b += 4) {
      core.push(add(galactic(l,b))); anticentre.push(add(galactic(l+180,b)));
    }
    for (const [l,b] of [[0,0],[30,5],[90,-10],[-90,20],[175,40]]) references.push({ index: add(galactic(l,b)), u: .5-l/360, v: .5-b/180 });
    for (let i = 0; i<1024; i++) {
      const z = 1-2*(i+.5)/1024, a = i*Math.PI*(3-Math.sqrt(5)), r = Math.sqrt(1-z*z);
      add([r*Math.cos(a),z,r*Math.sin(a)]);
    }
    const count = directions.length/4;
    const source = await (await fetch(new URL("./scene.wgsl",import.meta.url))).text();
    const module = device.createShaderModule({ label: "Sky probes", code: source+`
struct SkySample { galactic: vec4f, uv: vec4f, diffuse: vec4f, stars: vec4f }
@group(1) @binding(0) var<storage,read> directions: array<vec4f>;
@group(1) @binding(1) var<storage,read_write> results: array<SkySample>;
@compute @workgroup_size(64) fn probeSky(@builtin(global_invocation_id) id: vec3u) {
  if (id.x>=arrayLength(&directions)) { return; }
  let input = directions[id.x];
  let g = galacticDirection(input.xyz);
  results[id.x] = SkySample(vec4f(g,0.0),vec4f(skyUV(g),0.0,0.0),
    vec4f(milkyWay(g,input.w),0.0),vec4f(stars(input.xyz),0.0));
}` });
    const pipeline = await device.createComputePipelineAsync({ layout: "auto", compute: { module, entryPoint: "probeSky" } });
    const input = device.createBuffer({ size: count*16, usage: GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST });
    const output = device.createBuffer({ size: count*64, usage: GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC });
    const readback = device.createBuffer({ size: count*64, usage: GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ });
    resources.push(input,output,readback);
    device.queue.writeBuffer(input,0,new Float32Array(directions));
    const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: renderer.uniformBuffer } },
      { binding: 2, resource: renderer.maps.createView({ dimension: "2d-array" }) },
      { binding: 3, resource: renderer.mapSampler },
    ] });
    const probes = device.createBindGroup({ layout: pipeline.getBindGroupLayout(1), entries: [
      { binding: 0, resource: { buffer: input } },{ binding: 1, resource: { buffer: output } },
    ] });
    const camera = new Float32Array(28); camera[3] = .35; camera[17] = 900;
    async function run() {
      device.queue.writeBuffer(renderer.uniformBuffer,0,camera);
      const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass();
      pass.setPipeline(pipeline); pass.setBindGroup(0,bind); pass.setBindGroup(1,probes); pass.dispatchWorkgroups(Math.ceil(count/64)); pass.end();
      encoder.copyBufferToBuffer(output,0,readback,0,count*64); device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      const data = new Float32Array(readback.getMappedRange()).slice(); readback.unmap(); return data;
    }
    const data = await run(), g = index => data.slice(index*16,index*16+3), diffuse = index => data.slice(index*16+8,index*16+11);
    const maxDifference = (a,b) => Math.max(...a.map((v,i) => Math.abs(v-b[i])));
    check("Sky Galactic centre and poles agree with published ICRS directions",
      maxDifference(g(centre),[1,0,0])<.00002 && maxDifference(g(north),[0,0,1])<.000001 && maxDifference(g(south),[0,0,-1])<.000001);
    check("Sky maps Galactic longitude zero to the panorama centre",Math.abs(data[centre*16+4]-.5)<.00001 && Math.abs(data[centre*16+5]-.5)<.00001);
    check("Milky Way is continuous across the longitude wrap",maxDifference(diffuse(seam[0]),diffuse(seam[1]))<.00001);
    check("Sky poles remain finite and continuous at every longitude",poles.every(i => diffuse(i).every(v => Number.isFinite(v) && Math.abs(v)<.000001)));
    check("All sampled sky directions have finite, nonnegative radiance",data.every((v,i) => Number.isFinite(v) && (i%16<8 || v>=0)));
    const average = indices => indices.reduce((sum,i) => sum+luma(diffuse(i)),0)/indices.length;
    check("The Galactic plane is brighter than the high-latitude sky",average(plane)>average(high)*4,`${average(plane).toFixed(4)} vs ${average(high).toFixed(4)} HDR`);
    check("The central stellar clouds are brighter than the anticentre",average(core)>average(anticentre)*1.5);
    // Independent CPU bilinear sample: decode sRGB before interpolating. Use the
    // same documented upload size, but no shader UV/LOD/colour calculation.
    const bitmap = await createImageBitmap(await (await fetch(new URL(`../assets/textures/${SKY_TEXTURE}`,import.meta.url))).blob(), {
      resizeWidth: renderer.maps.width, resizeHeight: renderer.maps.height, resizeQuality: "high", colorSpaceConversion: "none", premultiplyAlpha: "none",
    });
    const canvas = new OffscreenCanvas(bitmap.width,bitmap.height), context = canvas.getContext("2d");
    context.drawImage(bitmap,0,0); bitmap.close();
    const pixels = context.getImageData(0,0,canvas.width,canvas.height).data;
    const linear = v => v<=.04045 ? v/12.92 : ((v+.055)/1.055)**2.4;
    let error = 0;
    for (const {index,u,v} of references) {
      const x = u*canvas.width-.5, y = v*canvas.height-.5, actual = diffuse(index), expected = [0,0,0];
      for (let yy = 0; yy<2; yy++) for (let xx = 0; xx<2; xx++) {
        const px = (Math.floor(x)+xx+canvas.width)%canvas.width, py = Math.max(0,Math.min(canvas.height-1,Math.floor(y)+yy));
        const weight = (xx ? x-Math.floor(x) : 1-x+Math.floor(x))*(yy ? y-Math.floor(y) : 1-y+Math.floor(y));
        for (let c = 0; c<3; c++) expected[c] += linear(pixels[(py*canvas.width+px)*4+c]/255)*weight*.075;
      }
      error = Math.max(error,maxDifference(actual,expected));
    }
    check("GPU sky sampling matches independent Gaia panorama samples",error<.0001,`max HDR error ${error.toExponential(1)}`);
    camera.set([10000,-20000,30000],0); camera[11] = 1e6; camera[24] = -1e6;
    camera.set([0,1,0],4); camera.set([1,0,0],8); camera.set([0,0,-1],12);
    const later = await run();
    check("A fixed sky direction ignores camera position/basis and simulation clocks",data.every((v,i) => v===later[i]));
    camera[17] = 240;
    const small = await run();
    check("Low-resolution star filtering stays finite and bounded",small.every((v,i) => Number.isFinite(v) && (i%16<12 || v>=0 && v<4)));

    // Render the actual sphere pipeline twice, changing only the unreachable
    // sky branch in the reference. A foreground sphere must hide every sky pixel.
    const target = device.createTexture({ size: [renderer.width,renderer.height], format: "rgba16float", usage: GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC });
    const stride = Math.ceil(renderer.width*8/256)*256;
    const image = device.createBuffer({ size: stride*renderer.height, usage: GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ });
    resources.push(target,image);
    const originalCall = "if (hit<0) { color = stars(rd); }";
    if (!source.includes(originalCall)) throw new Error("Sky occlusion reference needs its production call site updated");
    const referenceModule = device.createShaderModule({ code: source.replace(originalCall,"if (hit<0) { color = vec3f(1.0,0.0,1.0); }") });
    const reference = await device.createRenderPipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [renderer.scenePipeline.getBindGroupLayout(0)] }),
      vertex: { module: referenceModule, entryPoint: "vertex" }, fragment: { module: referenceModule, entryPoint: "fragment", targets: [{ format: "rgba16float" }] },
    });
    const simulation = new Simulation(0), view = new Camera();
    for (let i = 0; i<10; i++) simulation.data.set([9999+i*20,9999,9999],i*24);
    view.eye.set([0,0,0]); view.forward.set([0,0,1]); view.right.set([-1,0,0]); view.up.set([0,1,0]);
    simulation.data.set([0,0,4,3],24);
    renderer.bloom = renderer.orbits = renderer.atmospheres = false; renderer.markerOpacity = 0;
    renderer.sceneAttachment.view = target.createView();
    renderer.render(view,simulation,-1);
    async function read(pipeline) {
      const encoder = device.createCommandEncoder(), pass = encoder.beginRenderPass({ colorAttachments: [{ view: renderer.sceneAttachment.view, loadOp: "clear", storeOp: "store" }] });
      pass.setPipeline(pipeline); pass.setBindGroup(0,renderer.sceneBind); pass.draw(3); pass.end();
      encoder.copyTextureToBuffer({ texture: target },{ buffer: image, bytesPerRow: stride },[renderer.width,renderer.height]); device.queue.submit([encoder.finish()]);
      await image.mapAsync(GPUMapMode.READ); const values = new Uint16Array(image.getMappedRange()).slice(); image.unmap(); return values;
    }
    const actual = await read(renderer.scenePipeline), expected = await read(reference);
    check("Opaque foreground bodies completely occlude the new sky",actual.every((v,i) => v===expected[i]) && actual.some(v => half(v)>.001));
    check("The improved sky adds no frame draws or compute dispatches",renderer.drawCalls===2 && renderer.computePasses===0);
  } finally {
    Object.assign(renderer,saved); renderer.uniforms.set(uniforms);
    renderer.sceneAttachment.view = attachment;
    device.queue.writeBuffer(renderer.uniformBuffer,0,uniforms);
    for (const resource of resources) resource.destroy();
    const validation = await device.popErrorScope();
    check("Sky shaders and commands validate",!validation,validation?.message || "");
  }
}
