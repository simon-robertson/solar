import { test, expect, beforeAll, afterAll } from "bun:test";
import { allocatePlanetTextures } from "../docs/src/textures.js";

const originalUsage = globalThis.GPUTextureUsage;
beforeAll(() => { globalThis.GPUTextureUsage = { COPY_DST: 2, TEXTURE_BINDING: 4, RENDER_ATTACHMENT: 16 }; });
afterAll(() => {
  if (originalUsage===undefined) delete globalThis.GPUTextureUsage;
  else globalThis.GPUTextureUsage = originalUsage;
});

function mockDevice({ limit = 8192, layers = 256, oomWidths = [], deferred = false, validation = false } = {}) {
  const textures = [], scopes = [], attempts = [];
  let width, oom;
  return {
    limits: { maxTextureDimension2D: limit, maxTextureArrayLayers: layers },
    textures, scopes, attempts,
    pushErrorScope(filter) { scopes.push(filter); },
    async popErrorScope() {
      const filter = scopes.pop();
      return filter==="out-of-memory" ? oom : validation || oom ? { message: "invalid texture" } : null;
    },
    createTexture(descriptor) {
      if (descriptor.size.length===3) {
        width = descriptor.size[0]; attempts.push(width);
        oom = !deferred && oomWidths.includes(width) ? { message: "texture memory exhausted" } : null;
      }
      const texture = { ...descriptor, destroyed: false, destroy() { this.destroyed = true; } };
      textures.push(texture);
      return texture;
    },
    queue: { async onSubmittedWorkDone() {
      if (deferred && oomWidths.includes(width)) oom = { message: "deferred texture allocation failed" };
    } },
  };
}

test("original planet and ring textures retain their size and full mip chain",async () => {
  const device = mockDevice();
  const textures = await allocatePlanetTextures(device,async () => {});
  expect(textures.maps.size).toEqual([2048,1024,13]);
  expect(textures.maps.mipLevelCount).toBe(12);
  expect(textures.ring.size).toEqual([2048,125]);
  expect(device.attempts).toEqual([2048]);
  expect(device.scopes).toEqual([]);
});

test("device dimension limits skip unsupported 2K allocations",async () => {
  const device = mockDevice({ limit: 1024 });
  const textures = await allocatePlanetTextures(device,async () => {});
  expect(device.attempts).toEqual([1024]);
  expect(textures.maps.size).toEqual([1024,512,13]);
  expect(textures.maps.mipLevelCount).toBe(11);
  expect(textures.ring.size).toEqual([1024,64]);
});

for (const deferred of [false,true]) {
  test(`2K ${deferred?"deferred":"immediate"} OOM releases both textures before initializing 1K`,async () => {
    const device = mockDevice({ oomWidths: [2048], deferred });
    const initialized = [];
    const textures = await allocatePlanetTextures(device,async config => {
      initialized.push(config.width);
      if (config.width===1024) expect(device.textures.slice(0,2).every(texture => texture.destroyed)).toBe(true);
    });
    expect(initialized).toEqual([2048,1024]);
    expect(device.attempts).toEqual([2048,1024]);
    expect(textures.maps.size).toEqual([1024,512,13]);
    expect(textures.maps.destroyed).toBe(false);
    expect(device.scopes).toEqual([]);
  });
}

test("exhausted 1K fallback reports failure and releases all attempted textures",async () => {
  const device = mockDevice({ oomWidths: [2048,1024] });
  await expect(allocatePlanetTextures(device,async () => {})).rejects.toThrow("2K or 1K");
  expect(device.textures.every(texture => texture.destroyed)).toBe(true);
  expect(device.scopes).toEqual([]);
});

test("unrelated GPU validation failures are not retried",async () => {
  const device = mockDevice({ validation: true });
  await expect(allocatePlanetTextures(device,async () => {})).rejects.toThrow("invalid texture");
  expect(device.attempts).toEqual([2048]);
  expect(device.textures.every(texture => texture.destroyed)).toBe(true);
});

test("asset failures preserve the error and release resources without retrying",async () => {
  const device = mockDevice();
  await expect(allocatePlanetTextures(device,async () => { throw new Error("Missing texture"); })).rejects.toThrow("Missing texture");
  expect(device.attempts).toEqual([2048]);
  expect(device.textures.every(texture => texture.destroyed)).toBe(true);
  expect(device.scopes).toEqual([]);
});

test("insufficient layer or dimension limits fail without attempting an invalid allocation",async () => {
  for (const options of [{ layers: 12 },{ limit: 512 }]) {
    const device = mockDevice(options);
    await expect(allocatePlanetTextures(device,async () => {})).rejects.toThrow("GPU cannot support");
    expect(device.textures).toEqual([]);
  }
});
