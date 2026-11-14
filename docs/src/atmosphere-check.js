import { BODIES, BODY_FLOATS } from "./data.js";

// Independent double-precision midpoint quadrature (4096 slices), rather than
// the shader's four-point Gauss rule or eight view-ray segments.
function referenceDepth(point,direction,height,distance) {
  const result = [0,0], count = 4096, step = distance/count;
  for (let i = 0; i < count; i++) {
    const t = (i+.5)*step;
    const altitude = Math.max(0,Math.hypot(...point.map((v,j) => v+direction[j]*t))-1);
    result[0] += Math.exp(-altitude/height)*step;
    result[1] += Math.exp(-altitude/(height*.5))*step;
  }
  return result;
}
function interval(origin,direction,radius) {
  const b = origin.reduce((sum,x,i) => sum+x*direction[i],0);
  const discriminant = b*b-origin.reduce((sum,x) => sum+x*x,0)+radius*radius;
  if (discriminant<=0) return [0,0];
  return [-b-Math.sqrt(discriminant),-b+Math.sqrt(discriminant)];
}
const ray = (impact,index=3) => ({ origin: [impact,0,-4], direction: [0,0,1], index, mode: 0, near: 0, far: Math.abs(impact)<1 ? 4-Math.sqrt(1-impact*impact) : 8 });

export async function checkAtmospheres(renderer,simulation,check) {
  const device = renderer.device;
  const module = device.createShaderModule({ code: await (await fetch(new URL("./scene.wgsl",import.meta.url))).text()+`
struct AtmosphereProbe { origin: vec4f, direction: vec4f, bounds: vec4f, point: vec4f, light: vec4f }
@group(1) @binding(0) var<storage, read> probes: array<AtmosphereProbe>;
@group(1) @binding(1) var<storage, read_write> results: array<vec4f>;
@compute @workgroup_size(64) fn probeAtmosphere(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i>=arrayLength(&probes)) { return; }
  let p = probes[i];
  var value = AtmosphereResult(vec3f(0.0),vec3f(1.0));
  if (p.direction.w==1.0) {
    value.scattering = vec3f(atmosphereOpticalDepth(p.point.xyz,p.light.xyz,p.bounds.z),0.0);
  } else if (p.direction.w==2.0) {
    value.scattering = vec3f(sphereInterval(p.origin.xyz,p.direction.xyz,p.bounds.z),0.0);
  } else if (p.direction.w==3.0) {
    value.scattering = surfaceAtmosphereTransmission(u32(p.origin.w),p.point.xyz,p.light.xyz);
  } else if (p.direction.w==4.0) {
    value.scattering = compositeAtmospheres(p.point.xyz,p.origin.xyz,p.direction.xyz,p.bounds.x,p.bounds.y);
  } else if (p.direction.w==5.0) {
    value.scattering = compositeRingAtmospheres(p.point.xyz,p.origin.xyz,p.direction.xyz,p.bounds.y);
    let t = ringIntersection(p.origin.xyz,p.direction.xyz);
    let alpha = textureSampleLevel(ringMap,mapSampler,vec2f(ringUV(p.origin.xyz+p.direction.xyz*t),0.5),0.0).a;
    value.transmission = vec3f(alpha,t,0.0);
  } else {
    value = integrateAtmosphere(u32(p.origin.w),p.origin.xyz,p.direction.xyz,p.bounds.x,p.bounds.y);
  }
  results[i*2u] = vec4f(value.scattering,1.0);
  results[i*2u+1u] = vec4f(value.transmission,1.0);
}` });
  const pipeline = await device.createComputePipelineAsync({ layout: "auto", compute: { module, entryPoint: "probeAtmosphere" } });
  const inputs = device.createBuffer({ size: 64*80, usage: GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST });
  const output = device.createBuffer({ size: 64*32, usage: GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC });
  const readback = device.createBuffer({ size: 64*32, usage: GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ });
  const sourceBind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
    { binding: 0, resource: { buffer: renderer.uniformBuffer } },{ binding: 1, resource: { buffer: renderer.bodyBuffer } },
    { binding: 3, resource: renderer.mapSampler },{ binding: 4, resource: renderer.ring.createView() },
  ] });
  const data = simulation.data.slice(), uniforms = new Float32Array(24);
  uniforms[21] = 1;
  for (let i = 0; i < BODIES.length; i++) { data[i*BODY_FLOATS] = 1000+i*20; data[i*BODY_FLOATS+1] = data[i*BODY_FLOATS+2] = 1000; }
  data[0] = data[1] = 0; data[2] = -30; data[3] = .14;
  const earth = 3*BODY_FLOATS, saturn = 6*BODY_FLOATS, moon = 9*BODY_FLOATS;
  data[earth] = data[earth+1] = data[earth+2] = 0; data[earth+3] = 1;
  const upload = () => { device.queue.writeBuffer(renderer.bodyBuffer,0,data); device.queue.writeBuffer(renderer.uniformBuffer,0,uniforms); };
  async function run(cases) {
    const values = new Float32Array(cases.length*20);
    cases.forEach((p,i) => {
      const o = i*20;
      values.set(p.origin || [0,0,0],o); values[o+3] = p.index ?? 3;
      values.set(p.direction || [0,0,1],o+4); values[o+7] = p.mode ?? 0;
      values.set([p.near ?? 0,p.far ?? 8,p.height ?? .0025,0],o+8);
      values.set(p.point || [0,0,0],o+12); values.set(p.light || [0,1,0],o+16);
    });
    device.queue.writeBuffer(inputs,0,values);
    const inputBind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(1), entries: [
      { binding: 0, resource: { buffer: inputs, size: values.byteLength } },{ binding: 1, resource: { buffer: output } },
    ] });
    const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass();
    pass.setPipeline(pipeline); pass.setBindGroup(0,sourceBind); pass.setBindGroup(1,inputBind); pass.dispatchWorkgroups(1); pass.end();
    encoder.copyBufferToBuffer(output,0,readback,0,cases.length*32); device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const result = new Float32Array(readback.getMappedRange()).slice(0,cases.length*8);
    readback.unmap(); return result;
  }
  try {
    upload();
    const geometries = [ray(0),ray(.99),ray(1.005),ray(1.1),{ origin: [0,0,1.005], direction: [0,0,1] }];
    const chords = await run(geometries.map(p => ({ ...p, mode: 2, height: 1.015 })));
    let chordError = 0;
    geometries.forEach((p,i) => { const expected = interval(p.origin,p.direction,1.015); for (let j = 0; j < 2; j++) chordError = Math.max(chordError,Math.abs(chords[i*8+j]-expected[j])); });
    check("Atmosphere shell intervals agree with independent ray/sphere geometry",chordError<.00002,`max error ${chordError.toExponential(1)} radii`);

    const depthCases = [];
    for (const height of [.0012,.0018,.0025,.003]) for (const altitude of [0,1,3,5.9]) for (const elevation of [-8,-3,0,10,45,90]) {
      const angle = elevation*Math.PI/180, r = 1+altitude*height;
      if (elevation<0 && r*Math.cos(angle)<1) continue;
      depthCases.push({ mode: 1, height, point: [0,r,0], light: [Math.cos(angle),Math.sin(angle),0] });
    }
    let depthError = 0;
    for (let start = 0; start < depthCases.length; start += 64) {
      const cases = depthCases.slice(start,start+64), actual = await run(cases);
      cases.forEach((p,i) => {
        const distance = interval(p.point,p.light,1+6*p.height)[1];
        const expected = referenceDepth(p.point,p.light,p.height,distance);
        for (let j = 0; j < 2; j++) depthError = Math.max(depthError,Math.abs(actual[i*8+j]-expected[j])/Math.max(expected[j],1e-8));
      });
    }
    check("Sun optical depths agree with independent 4096-slice integration",depthError<.025,`${depthCases.length} horizon/altitude cases; max error ${(depthError*100).toFixed(2)}%`);

    const impacts = [0,.9,.99,.9999,1,1.001,1.005,1.01,1.0149], cases = impacts.map(x => ray(x));
    const atmosphere = await run(cases);
    let transmissionError = 0, bounded = true;
    cases.forEach((p,i) => {
      const enter = Math.max(0,interval(p.origin,p.direction,1.015)[0]);
      const point = p.origin.map((x,j) => x+p.direction[j]*enter);
      const exit = Math.min(p.far,interval(p.origin,p.direction,1.015)[1]);
      const depths = referenceDepth(point,p.direction,.0025,exit-enter);
      for (let j = 0; j < 3; j++) {
        const expected = Math.exp(-BODIES[3].atmo[j]/.0025*depths[0]-.008/.00125*1.1*depths[1]);
        const value = atmosphere[i*8+4+j];
        transmissionError = Math.max(transmissionError,Math.abs(value-expected));
        bounded &&= value>=0 && value<=1 && Number.isFinite(atmosphere[i*8+j]) && atmosphere[i*8+j]>=0;
      }
    });
    check("View attenuation follows Beer–Lambert across surface and limb rays",bounded && transmissionError<.012,`max absolute transmission error ${transmissionError.toFixed(4)}`);
    const surface = await run([-.0002,0,.0002].map(error => ({ mode: 3, point: [0,0,-1+error], light: [0,0,-1] })));
    check("Surface atmospheric lighting tolerates distant-hit precision error",
      [0,1,2].every(i => [0,1,2].every(j => surface[i*8+j]>.5 && Math.abs(surface[i*8+j]-surface[j])<.00001)));
    const empty = await run([ray(1.005,1),ray(1.005,9),{ ...ray(1.005), far: 2 }]);
    check("Airless bodies and foreground opaque depth produce no atmosphere",[0,1,2].every(i => [0,1,2].every(j => empty[i*8+j]===0 && empty[i*8+4+j]===1)));

    data[0] = 30; data[2] = 0; upload();
    const half = await run([ray(1.001),ray(-1.001)]);
    const energy = (values,i=0) => values[i*8]+values[i*8+1]+values[i*8+2];
    check("Half-lit atmosphere follows the Sun and suppresses the dark limb",energy(half)>energy(half,1)*5 && energy(half)>.005);
    data[0] = 0; data[2] = 30; upload();
    const dark = await run([ray(0)]);
    check("An unlit surface gains no emissive atmospheric rim",energy(dark)<.00001);
    data[2] = -30; upload();
    const lit = await run([ray(1.001)]);
    data[moon] = data[moon+1] = 0; data[moon+2] = -3; data[moon+3] = 1.5; upload();
    const eclipse = await run([ray(1.001)]);
    check("An eclipsing body suppresses atmospheric in-scattering",energy(lit)>.005 && energy(eclipse)<energy(lit)*.01);
    data[moon] = data[moon+1] = data[moon+2] = 1000;

    uniforms[21] = 0; upload();
    const background = [.12,.18,.25];
    const off = await run([{ ...ray(1.001), mode: 4, point: background }]);
    check("Atmosphere toggle restores the input radiance exactly",background.every((value,i) => Math.abs(off[i]-value)<.000001));

    data[earth] = data[earth+1] = data[earth+2] = 1000;
    data[saturn] = data[saturn+1] = data[saturn+2] = 0; data[saturn+3] = 1;
    const direction = [0,.25,1].map(x => x/Math.hypot(.25,1));
    const opaque = interval([0,0,-4],direction,1)[0];
    const ringCase = { mode: 5, origin: [0,0,-4], direction, far: opaque, point: background };
    const volumeCase = { ...ringCase, mode: 4 };
    upload(); const ringOff = await run([ringCase]);
    uniforms[21] = 1; upload(); const ringOn = await run([ringCase,volumeCase]);
    const alpha = ringOn[4];
    const ringError = Math.max(...background.map((value,j) => Math.abs((ringOn[j]-ringOff[j])-(1-alpha)*(ringOn[8+j]-value))));
    check("Foreground ring opacity attenuates the atmosphere behind it",alpha>0 && alpha<=1 && ringError<.00002,`alpha ${alpha.toFixed(3)}, composition error ${ringError.toExponential(1)}`);
  } finally {
    inputs.destroy(); output.destroy(); readback.destroy();
    device.queue.writeBuffer(renderer.bodyBuffer,0,simulation.data);
  }
}
