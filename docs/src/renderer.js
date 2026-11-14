import { BODIES } from "./data.js";
import { OrbitDetails } from "./orbit-details.js";
import { allocatePlanetTextures, MAP_LAYERS } from "./textures.js";

const shaderURL = name => new URL(`./${name}.wgsl`, import.meta.url);

async function shader(device, name) {
  const response = await fetch(shaderURL(name));
  if (!response.ok) throw new Error(`Could not load ${name}.wgsl (${response.status})`);
  const module = device.createShaderModule({ label: name, code: await response.text() });
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter(message => message.type === "error");
  if (errors.length) throw new Error(errors.map(m => `${name}.wgsl:${m.lineNum}: ${m.message}`).join("\n"));
  return module;
}

async function bitmap(name, width, height) {
  const response = await fetch(new URL(`../assets/textures/${name}`,import.meta.url));
  if (!response.ok) throw new Error(`Missing texture: ${name}. Run bun run textures, then reload.`);
  return createImageBitmap(await response.blob(), {
    resizeWidth: width, resizeHeight: height, resizeQuality: "high",
    colorSpaceConversion: "none", premultiplyAlpha: "none",
  });
}

export class Renderer {
  constructor(canvas, onError) {
    this.canvas = canvas;
    this.onError = onError;
    this.uniforms = new Float32Array(24);
    this.orbitDetails = new OrbitDetails();
    this.markerOpacity = 1;
    this.prepareAnnotations = null;
    this.width = 0; this.height = 0;
    this.scale = 1;
    this.bloom = true; this.atmospheres = true; this.orbits = true;
    this.exposure = 1.15;
    this.drawCalls = 2; this.computePasses = 3;
    this.resourceGeneration = 0;
    this.disposed = false;
    // Reuse all JS descriptors/arrays in the hot path. GPU encoders and the
    // presentation texture view are fresh WebGPU handles required each frame.
    this.sceneAttachment = { view: null, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } };
    this.finalAttachment = { ...this.sceneAttachment };
    this.scenePass = { label: "Analytic solar system", colorAttachments: [this.sceneAttachment] };
    this.finalPass = { label: "Bloom + tone mapping", colorAttachments: [this.finalAttachment] };
    this.submit = [null];
    this.encoderDescriptor = { label: "Solar frame" };
    this.computeDescriptor = { label: "Bloom" };
  }

  async init(bodyData, progress) {
    if (!navigator.gpu) throw new Error("This browser does not expose WebGPU. Open this page in a current desktop Chrome, Edge or Safari with WebGPU enabled.");
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) throw new Error("A WebGPU adapter could not be found. Try a browser with WebGPU support and hardware acceleration enabled.");
    this.device = await adapter.requestDevice();
    const device = this.device;
    device.addEventListener("uncapturederror", event => this.onError(event.error.message));
    device.lost.then(info => { if (!this.disposed) this.onError(`Graphics device lost: ${info.message || info.reason}. Reload to reconnect.`); });
    this.adapterName = adapter.info?.description || adapter.info?.architecture || "WebGPU";
    this.context = this.canvas.getContext("webgpu");
    if (!this.context) throw new Error("Could not create a WebGPU canvas context.");
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device, format: this.format, alphaMode: "opaque" });
    this.uniformBuffer = device.createBuffer({ label: "Reusable camera", size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.bodyBuffer = device.createBuffer({ label: "Reusable body state", size: bodyData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.orbitBuffer = device.createBuffer({ label: "Reusable orbital detail state", size: this.orbitDetails.data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.mapSampler = device.createSampler({ label: "Planet sampler", magFilter: "linear", minFilter: "linear", mipmapFilter: "linear", addressModeU: "repeat", addressModeV: "clamp-to-edge" });
    this.linearSampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });

    progress("Compiling shaders");
    const [scene, post, composite, mipmap] = await Promise.all([
      shader(device,"scene"),shader(device,"post"),shader(device,"composite"),shader(device,"mipmap"),
    ]);
    const [scenePipeline, finalPipeline, extract, blurX, blurY, mipPipeline] = await Promise.all([
      device.createRenderPipelineAsync({ label: "Spheres, shadows, rings and atmospheres", layout: "auto", vertex: { module: scene, entryPoint: "vertex" }, fragment: { module: scene, entryPoint: "fragment", targets: [{ format: "rgba16float" }] }, primitive: { topology: "triangle-list" } }),
      device.createRenderPipelineAsync({ label: "Final composite", layout: "auto", vertex: { module: composite, entryPoint: "vertex" }, fragment: { module: composite, entryPoint: "fragment", targets: [{ format: this.format }] }, primitive: { topology: "triangle-list" } }),
      ...["extract","blurX","blurY"].map(entryPoint => device.createComputePipelineAsync({ label: entryPoint, layout: "auto", compute: { module: post, entryPoint } })),
      device.createRenderPipelineAsync({ label: "Startup mipmaps", layout: "auto", vertex: { module: mipmap, entryPoint: "vertex" }, fragment: { module: mipmap, entryPoint: "fragment", targets: [{ format: "rgba8unorm-srgb" }] } }),
    ]);
    this.scenePipeline = scenePipeline; this.finalPipeline = finalPipeline;
    this.extractPipeline = extract; this.blurXPipeline = blurX; this.blurYPipeline = blurY;
    const textures = await allocatePlanetTextures(device,async ({ maps, ring, width, height, ringWidth, ringHeight, mipLevelCount }) => {
      const filenames = BODIES.map(body => body.texture).concat("2k_earth_nightmap.jpg","2k_earth_clouds.jpg");
      // Decode two images at a time and release each bitmap immediately after upload.
      for (let start = 0; start < MAP_LAYERS; start += 2) {
        const uploads = await Promise.allSettled(filenames.slice(start,start+2).map(async (name,offset) => {
          progress(`Loading ${start+offset+1} / ${MAP_LAYERS+1} textures`);
          const image = await bitmap(name,width,height);
          try { device.queue.copyExternalImageToTexture({ source: image }, { texture: maps, origin: [0,0,start+offset] }, [width,height]); }
          finally { image.close(); }
        }));
        for (const upload of uploads) if (upload.status==="rejected") throw upload.reason;
      }
      const ringImage = await bitmap("2k_saturn_ring_alpha.png",ringWidth,ringHeight);
      try { device.queue.copyExternalImageToTexture({ source: ringImage },{ texture: ring },[ringWidth,ringHeight]); }
      finally { ringImage.close(); }

      progress("Preparing textures");
      const mipEncoder = device.createCommandEncoder({ label: "Generate texture mipmaps once" });
      for (let layer = 0; layer < MAP_LAYERS; layer++) {
        for (let mip = 1; mip < mipLevelCount; mip++) {
          const input = maps.createView({ dimension: "2d", baseArrayLayer: layer, arrayLayerCount: 1, baseMipLevel: mip-1, mipLevelCount: 1 });
          const output = maps.createView({ dimension: "2d", baseArrayLayer: layer, arrayLayerCount: 1, baseMipLevel: mip, mipLevelCount: 1 });
          const bind = device.createBindGroup({ layout: mipPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: input },{ binding: 1, resource: this.linearSampler }] });
          const pass = mipEncoder.beginRenderPass({ colorAttachments: [{ view: output, loadOp: "clear", storeOp: "store" }] });
          pass.setPipeline(mipPipeline); pass.setBindGroup(0,bind); pass.draw(3); pass.end();
        }
      }
      device.queue.submit([mipEncoder.finish()]);
    });
    this.maps = textures.maps; this.ring = textures.ring;
    this.sceneBind = device.createBindGroup({ layout: scenePipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: this.uniformBuffer } },{ binding: 1, resource: { buffer: this.bodyBuffer } },
      { binding: 2, resource: this.maps.createView({ dimension: "2d-array" }) },{ binding: 3, resource: this.mapSampler },{ binding: 4, resource: this.ring.createView() },{ binding: 5, resource: { buffer: this.orbitBuffer } },
    ] });
    this.resize();
    await device.queue.onSubmittedWorkDone();
  }

  resize() {
    if (!this.device || !this.scenePipeline || this.disposed) return;
    const ratio = Math.min(window.devicePixelRatio || 1,1.5) * this.scale;
    const max = this.device.limits.maxTextureDimension2D;
    const w = Math.min(max,Math.max(2,Math.round(this.canvas.clientWidth * ratio)));
    const h = Math.min(max,Math.max(2,Math.round(this.canvas.clientHeight * ratio)));
    if (w === this.width && h === this.height) return;
    this.width = this.canvas.width = w; this.height = this.canvas.height = h;
    this.sceneTexture?.destroy(); this.bloomA?.destroy(); this.bloomB?.destroy();
    const device = this.device;
    const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT;
    this.sceneTexture = device.createTexture({ label: "HDR scene", size: [w,h], format: "rgba16float", usage });
    this.bw = Math.max(1,Math.ceil(w/2)); this.bh = Math.max(1,Math.ceil(h/2));
    const bloomUsage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING;
    this.bloomA = device.createTexture({ label: "Bloom A", size: [this.bw,this.bh], format: "rgba16float", usage: bloomUsage });
    this.bloomB = device.createTexture({ label: "Bloom B", size: [this.bw,this.bh], format: "rgba16float", usage: bloomUsage });
    const sceneView = this.sceneTexture.createView(), a = this.bloomA.createView(), b = this.bloomB.createView();
    const bind = (pipeline,input,output) => device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: input },{ binding: 1, resource: output }] });
    this.extractBind = bind(this.extractPipeline,sceneView,a);
    this.blurXBind = bind(this.blurXPipeline,a,b);
    this.blurYBind = bind(this.blurYPipeline,b,a);
    this.finalBind = device.createBindGroup({ layout: this.finalPipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: this.uniformBuffer } },{ binding: 1, resource: sceneView },{ binding: 2, resource: a },{ binding: 3, resource: this.linearSampler },
    ] });
    this.sceneAttachment.view = sceneView;
    this.workgroupsX = Math.ceil(this.bw/8); this.workgroupsY = Math.ceil(this.bh/8);
    this.resourceGeneration++;
  }

  render(camera,simulation,selected) {
    this.orbitDetails.update(simulation,camera);
    this.prepareAnnotations?.(this.orbitDetails);
    const u = this.uniforms;
    u[0] = camera.eye[0]; u[1] = camera.eye[1]; u[2] = camera.eye[2]; u[3] = camera.tanFov;
    u[4] = camera.right[0]; u[5] = camera.right[1]; u[6] = camera.right[2]; u[7] = this.width/this.height;
    u[8] = camera.up[0]; u[9] = camera.up[1]; u[10] = camera.up[2]; u[11] = simulation.elapsedSeconds;
    u[12] = camera.forward[0]; u[13] = camera.forward[1]; u[14] = camera.forward[2]; u[15] = this.exposure;
    u[16] = this.width; u[17] = this.height; u[18] = selected; u[19] = this.orbits ? 1 : 0;
    u[20] = this.bloom ? 0.325 : 0; u[21] = this.atmospheres ? 1 : 0;
    u[22] = this.width/this.canvas.clientWidth;
    u[23] = this.orbitDetails.saturnLod.opacity>0 ? this.markerOpacity : 0;
    const device = this.device;
    device.queue.writeBuffer(this.uniformBuffer,0,u);
    device.queue.writeBuffer(this.bodyBuffer,0,simulation.data);
    device.queue.writeBuffer(this.orbitBuffer,0,this.orbitDetails.data);
    const encoder = device.createCommandEncoder(this.encoderDescriptor);
    const scene = encoder.beginRenderPass(this.scenePass);
    scene.setPipeline(this.scenePipeline); scene.setBindGroup(0,this.sceneBind); scene.draw(3); scene.end();
    if (this.bloom) {
      const compute = encoder.beginComputePass(this.computeDescriptor);
      compute.setPipeline(this.extractPipeline); compute.setBindGroup(0,this.extractBind); compute.dispatchWorkgroups(this.workgroupsX,this.workgroupsY);
      compute.setPipeline(this.blurXPipeline); compute.setBindGroup(0,this.blurXBind); compute.dispatchWorkgroups(this.workgroupsX,this.workgroupsY);
      compute.setPipeline(this.blurYPipeline); compute.setBindGroup(0,this.blurYBind); compute.dispatchWorkgroups(this.workgroupsX,this.workgroupsY);
      compute.end();
    }
    this.finalAttachment.view = this.context.getCurrentTexture().createView();
    const final = encoder.beginRenderPass(this.finalPass);
    final.setPipeline(this.finalPipeline); final.setBindGroup(0,this.finalBind); final.draw(3); final.end();
    this.submit[0] = encoder.finish();
    device.queue.submit(this.submit);
    this.computePasses = this.bloom ? 3 : 0;
  }

  destroy() {
    this.disposed = true;
    this.sceneTexture?.destroy(); this.bloomA?.destroy(); this.bloomB?.destroy();
    this.maps?.destroy(); this.ring?.destroy(); this.uniformBuffer?.destroy(); this.bodyBuffer?.destroy(); this.orbitBuffer?.destroy();
    this.context?.unconfigure(); this.device?.destroy();
  }
}
