export const MAP_LAYERS = 12;

// Keep uploads and mip generation inside the scopes too: an implementation can
// defer backing-memory allocation until the texture is first used.
export async function allocatePlanetTextures(device, initialize) {
  if (device.limits.maxTextureArrayLayers<MAP_LAYERS) {
    throw new Error("The GPU cannot support the solar system’s 12 texture layers.");
  }
  let allocationError;
  for (const width of [2048,1024]) {
    if (width>device.limits.maxTextureDimension2D) continue;
    const height = width/2, mipLevelCount = Math.floor(Math.log2(width))+1;
    const ringWidth = width, ringHeight = width===2048 ? 125 : 64;
    const textures = { width, height, mipLevelCount, ringWidth, ringHeight };
    device.pushErrorScope("out-of-memory");
    device.pushErrorScope("validation");
    let failure;
    try {
      const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT;
      textures.maps = device.createTexture({ label: "Planet texture array", size: [width,height,MAP_LAYERS], format: "rgba8unorm-srgb", mipLevelCount, usage });
      textures.ring = device.createTexture({ label: "Saturn ring opacity", size: [ringWidth,ringHeight], format: "rgba8unorm-srgb", usage });
      await initialize(textures);
      await device.queue.onSubmittedWorkDone();
    } catch (error) { failure = error; }
    const validationError = await device.popErrorScope();
    const outOfMemory = await device.popErrorScope();
    if (!failure && !validationError && !outOfMemory) return textures;
    textures.maps?.destroy(); textures.ring?.destroy();
    // An invalid resource following an OOM can produce secondary validation
    // errors. Retry that case, but never disguise unrelated bugs or asset errors.
    if (outOfMemory) { allocationError = outOfMemory; continue; }
    throw failure || new Error(validationError.message);
  }
  throw new Error(allocationError
    ? `Unable to allocate planet textures at 2K or 1K: ${allocationError.message}`
    : "The GPU cannot support 1024-pixel planet textures.");
}
