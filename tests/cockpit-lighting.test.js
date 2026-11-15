import { expect, test } from "bun:test";
import { BODIES, BODY_FLOATS } from "../docs/src/data.js";
import { sampleCockpitSun, facetLight } from "../docs/src/cockpit-lighting.js";

function fixture() {
  const data = new Float32Array(BODIES.length*BODY_FLOATS);
  for (let i = 0; i<BODIES.length; i++) {
    const o = i*BODY_FLOATS; data[o+3] = BODIES[i].radius;
    if (i) { data[o] = 500+i*10; data[o+1] = data[o+2] = 500; }
  }
  const camera = { eye: [0,0,100], right: [1,0,0], up: [0,1,0], forward: [0,0,-1] };
  return { camera,data,out: new Float64Array(4) };
}

test("Sun direction follows the camera basis, not screen coordinates or a fixed lamp",() => {
  const { camera,data,out } = fixture();
  expect(sampleCockpitSun(camera,data,out)).toBe(out);
  expect(Array.from(out.slice(0,3))).toEqual([0,0,1]);
  const frontIntensity = out[3];
  camera.forward = [1,0,0]; camera.right = [0,0,1];
  sampleCockpitSun(camera,data,out); expect(out[0]).toBe(-1); expect(out[2]).toBe(0);
  camera.forward = [0,0,1]; camera.right = [-1,0,0];
  sampleCockpitSun(camera,data,out); expect(out[2]).toBe(-1);
  expect(out[3]).toBeLessThan(frontIntensity);
});

test("opposite spar facets exchange their highlights as sunlight changes sides",() => {
  const left = [.68,.08,.73], right = [-.68,.08,.73];
  expect(facetLight(left,[1,0,0,1])).toBeGreaterThan(facetLight(right,[1,0,0,1]));
  expect(facetLight(left,[-1,0,0,1])).toBeLessThan(facetLight(right,[-1,0,0,1]));
  expect(facetLight(left,[0,0,-1,1])).toBeCloseTo(.48,10);
  expect(facetLight(left,[1,0,0,0])).toBeCloseTo(.48,10);
});

test("a foreground world shades the cockpit with a smooth transition at its silhouette",() => {
  const { camera,data,out } = fixture(), earth = 3*BODY_FLOATS;
  sampleCockpitSun(camera,data,out); const unobstructed = out[3];
  data[earth] = data[earth+1] = 0; data[earth+2] = 90;
  sampleCockpitSun(camera,data,out); expect(out[3]).toBe(0);
  data[earth] = BODIES[3].radius;
  sampleCockpitSun(camera,data,out); expect(out[3]).toBeGreaterThan(0); expect(out[3]).toBeLessThan(unobstructed);
  data[earth] = 2;
  sampleCockpitSun(camera,data,out); expect(out[3]).toBeCloseTo(unobstructed,10);
  data[earth] = 0; data[earth+2] = 110;
  sampleCockpitSun(camera,data,out); expect(out[3]).toBeCloseTo(unobstructed,10);
});

test("light responds to spacecraft position and remains finite at extreme distances",() => {
  const { camera,data,out } = fixture();
  sampleCockpitSun(camera,data,out); const distant = out[3];
  camera.eye[2] = 20; sampleCockpitSun(camera,data,out); expect(out[3]).toBeGreaterThan(distant);
  for (const distance of [0,.001,1,1e6]) {
    camera.eye[2] = distance; sampleCockpitSun(camera,data,out);
    expect(Array.from(out).every(Number.isFinite)).toBe(true);
    expect(out[3]).toBeGreaterThanOrEqual(0); expect(out[3]).toBeLessThanOrEqual(1.4);
  }
});
