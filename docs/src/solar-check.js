import { Simulation } from "./simulation.js";
import { Camera } from "./camera.js";
import { BODY_FLOATS } from "./data.js";

const half = v => (v&0x8000?-1:1)*((v>>10&31)===0 ? 2**-14*(v&1023)/1024 : 2**((v>>10&31)-15)*(1+(v&1023)/1024));

export async function checkSolar(renderer, check) {
  const device = renderer.device, simulation = new Simulation(0), camera = new Camera();
  const saved = { scale: renderer.scale, bloom: renderer.bloom, atmospheres: renderer.atmospheres, orbits: renderer.orbits, markerOpacity: renderer.markerOpacity };
  let target, readback;
  try {
    renderer.scale = 2/Math.min(devicePixelRatio || 1,1.5); renderer.resize();
    renderer.bloom = false; renderer.atmospheres = false; renderer.orbits = false; renderer.markerOpacity = 0;
    const width = renderer.width, height = renderer.height, stride = Math.ceil(width*8/256)*256;
    target = device.createTexture({ size: [width,height], format: "rgba16float", usage: GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC });
    readback = device.createBuffer({ size: stride*height, usage: GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST });
    const view = target.createView();
    // Fixed reference copied from the original Sun shading, before either
    // visual revision. Compare displayed contrast/chroma after an independent
    // CPU tone curve; a monochrome glowing ball must fail these checks.
    const source = await (await fetch(new URL("./scene.wgsl",import.meta.url))).text();
    const current = "color = solarSurface(normal,max(dot(normal,-rd),0.0),nearest,lod);";
    if (!source.includes(current)) throw new Error("Solar baseline reference needs its production call site updated");
    const original = `let albedo = textureSampleLevel(maps,mapSampler,surfaceUV(normal,body),0,lod).rgb;
      let limb = pow(max(dot(normal,-rd),0.0),0.35);
      color = albedo*vec3f(5.5,3.8,2.4)*(0.5+0.5*limb);`;
    const baselinePipeline = await device.createRenderPipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [renderer.scenePipeline.getBindGroupLayout(0)] }),
      vertex: { module: device.createShaderModule({ code: source.replace(current,original) }), entryPoint: "vertex" },
      fragment: { module: device.createShaderModule({ code: source.replace(current,original) }), entryPoint: "fragment", targets: [{ format: "rgba16float" }] },
    });
    const park = () => {
      for (let i = 1; i < simulation.data.length/BODY_FLOATS; i++) simulation.data.set([1000+i*20,1000,1000],i*BODY_FLOATS);
    };
    park(); camera.focus(0,simulation.data); camera.goalDistance = 10;
    camera.snap = true; camera.update(0,simulation.data);
    async function pixels(baseline=false) {
      renderer.sceneAttachment.view = view;
      renderer.render(camera,simulation,0);
      const encoder = device.createCommandEncoder();
      if (baseline) {
        const pass = encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: "clear", storeOp: "store", clearValue: [0,0,0,0] }] });
        pass.setPipeline(baselinePipeline); pass.setBindGroup(0,renderer.sceneBind);
        pass.draw(3);
        pass.end();
      }
      encoder.copyTextureToBuffer({ texture: target },{ buffer: readback, bytesPerRow: stride },[width,height]);
      device.queue.submit([encoder.finish()]); await readback.mapAsync(GPUMapMode.READ);
      const source = new Uint16Array(readback.getMappedRange()), image = new Float32Array(width*height*3);
      for (let y = 0; y<height; y++) for (let x = 0; x<width; x++) for (let c = 0; c<3; c++) image[(y*width+x)*3+c] = half(source[y*stride/2+x*4+c]);
      readback.unmap(); return image;
    }
    const energy = image => image.reduce((sum,v) => sum+v,0);
    const difference = (a,b) => a.reduce((sum,v,i) => sum+Math.abs(v-b[i]),0)/a.length;
    const initial = await pixels();
    check("Animated Sun and aureole use only scene and composite draws",renderer.drawCalls===2);
    simulation.solarSeconds = 8;
    const evolved = await pixels();
    check("Solar surface evolves with a fixed body rotation and camera",difference(initial,evolved)>.001,`mean HDR change ${difference(initial,evolved).toFixed(4)}`);
    simulation.paused = true; simulation.tick(.05);
    check("Paused solar pixels remain identical as real time advances",difference(evolved,await pixels())===0);
    simulation.paused = false; simulation.speed = -1/24;
    for (let i = 0; i<160; i++) simulation.tick(.05);
    park(); simulation.data[4] = 0;
    check("Reversing the activity clock returns to the original solar pixels",difference(initial,await pixels())<.00001);
    const reference = await pixels(true);
    function appearance(image) {
      let count = 0, sum = 0, square = 0, chroma = 0, white = 0;
      const tone = value => {
        const x = Math.max(0,value*renderer.exposure);
        return Math.pow(Math.min(1,(x*(2.51*x+.03))/(x*(2.43*x+.59)+.14)),1/2.2);
      };
      const solarRadius = simulation.data[3];
      const radius = solarRadius*height/(2*camera.tanFov*Math.sqrt(camera.distance**2-solarRadius**2))*.85;
      for (let y = 0; y<height; y++) for (let x = 0; x<width; x++) {
        if ((x+.5-width*.5)**2+(y+.5-height*.5)**2>radius*radius) continue;
        const i = (y*width+x)*3, rgb = [tone(image[i]),tone(image[i+1]),tone(image[i+2])];
        const luma = rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
        sum += luma; square += luma*luma; count++;
        chroma += Math.max(...rgb)-Math.min(...rgb);
        if (Math.min(...rgb)>.96) white++;
      }
      return { contrast: Math.sqrt(square/count-(sum/count)**2), chroma: chroma/count, white: white/count };
    }
    const originalLook = appearance(reference), currentLook = appearance(initial);
    check("Sun retains the original's displayed texture contrast",currentLook.contrast>=originalLook.contrast*.95,`${originalLook.contrast.toFixed(3)} → ${currentLook.contrast.toFixed(3)}`);
    check("Sun retains the original's warm colour separation",currentLook.chroma>=originalLook.chroma*.9,`${originalLook.chroma.toFixed(3)} → ${currentLook.chroma.toFixed(3)}`);
    check("Sun does not wash out more surface into white",currentLook.white<=originalLook.white+.015,`${(originalLook.white*100).toFixed(2)}% → ${(currentLook.white*100).toFixed(2)}%`);
    // Place an opaque sphere between the camera and the Sun plus its aureole.
    for (let j = 0; j<3; j++) simulation.data[BODY_FLOATS+j] = camera.eye[j]+camera.forward[j]*3;
    simulation.data[BODY_FLOATS+3] = 2.1;
    const eclipsed = await pixels();
    check("Foreground planets suppress the bright disc and solar aureole",energy(eclipsed)<energy(initial)*.04);
  } finally {
    target?.destroy(); readback?.destroy();
    Object.assign(renderer,saved); renderer.resize();
    renderer.sceneAttachment.view = renderer.sceneTexture.createView();
  }
}
