import { describe, expect, test } from "bun:test";
import { Simulation, solveKepler, MIN_DAY, MAX_DAY } from "../docs/src/simulation.js";
import { Camera } from "../docs/src/camera.js";
import { BODY_FLOATS, BODIES } from "../docs/src/data.js";

describe("Kepler solver",() => {
  test("satisfies Kepler's equation for a full revolution and Mercury's eccentricity",() => {
    for (const eccentricity of [0,.0167,.206,.8]) {
      for (let angle = -Math.PI; angle <= Math.PI; angle += .03) {
        const e = solveKepler(angle,eccentricity);
        expect(Math.abs(e-eccentricity*Math.sin(e)-angle)).toBeLessThan(1e-10);
      }
    }
  });
});

describe("simulation",() => {
  test("J2000 Earth agrees with published JPL heliocentric reference coordinates",() => {
    // JPL approximate J2000 ecliptic coordinates: (-.17717, .96721, -.00000026) AU.
    // Convert display scale back to AU; world (x,y,z) maps to ecliptic (x,-z,y).
    const simulation = new Simulation(0);
    const o = 3*BODY_FLOATS, scale = BODIES[3].orbit;
    expect(simulation.data[o]/scale).toBeCloseTo(-.17717,4);
    expect(-simulation.data[o+2]/scale).toBeCloseTo(.96721,4);
    expect(simulation.data[o+1]/scale).toBeCloseTo(-.00000026,6);
  });
  test("uses seconds, clamps suspension gaps, pauses and reverses without reallocating state",() => {
    const simulation = new Simulation(0), data = simulation.data;
    simulation.speed = 10;
    simulation.tick(.02); expect(simulation.days).toBeCloseTo(.2,9);
    simulation.tick(120); expect(simulation.days).toBeCloseTo(.7,9);
    simulation.paused = true;
    const frozen = data.slice();
    simulation.tick(.03); expect(simulation.days).toBeCloseTo(.7,9);
    expect(simulation.data).toEqual(frozen);
    simulation.paused = false; simulation.speed = -10;
    simulation.tick(.02); expect(simulation.days).toBeCloseTo(.5,9);
    expect(simulation.data).toBe(data);
  });
  test("split and combined time steps give the same orbital state",() => {
    const a = new Simulation(9000), b = new Simulation(9000);
    a.tick(.04); b.tick(.01); b.tick(.03);
    for (let i = 0; i < a.data.length; i++) expect(a.data[i]).toBeCloseTo(b.data[i],5);
  });
  test("ignores invalid time deltas and stops at the model's validity limits",() => {
    const s = new Simulation(MAX_DAY-.01); s.speed = 100;
    s.tick(.02); expect(s.days).toBe(MAX_DAY); expect(s.paused).toBe(true);
    s.reset(MIN_DAY+.01); s.paused = false; s.speed = -100;
    s.tick(.02); expect(s.days).toBe(MIN_DAY); expect(s.paused).toBe(true);
    s.reset(0); s.paused = false; s.tick(NaN); s.tick(-1);
    expect(s.days).toBe(0);
  });
  test("Moon remains in its Earth-centred ellipse and all state stays finite",() => {
    const s = new Simulation(0);
    for (const epoch of [-73000,0,9813,18000]) {
      s.reset(epoch);
      const e = 3*BODY_FLOATS,m = 9*BODY_FLOATS;
      const distance = Math.hypot(s.data[m]-s.data[e],s.data[m+1]-s.data[e+1],s.data[m+2]-s.data[e+2]);
      expect(distance).toBeGreaterThan(1.8*(1-.0549)-.0001);
      expect(distance).toBeLessThan(1.8*(1+.0549)+.0001);
      expect(Array.from(s.data).every(Number.isFinite)).toBe(true);
    }
  });
});

describe("camera",() => {
  test("a distant planet flight decelerates without a final target snap",() => {
    const camera = new Camera(), data = new Float32Array(BODIES.length*BODY_FLOATS);
    const earth = 3*BODY_FLOATS, venus = 2*BODY_FLOATS;
    data[earth] = -40; data[venus] = 40;
    camera.focus(3,data); camera.update(0,data);
    camera.focus(2,data);
    let previous = camera.target[0], previousStep = Infinity;
    for (let i = 0; i < 180; i++) {
      camera.update(.016,data);
      const step = Math.abs(camera.target[0]-previous);
      // On a stationary approach, late movement must not suddenly increase.
      expect(step).toBeLessThanOrEqual(previousStep+.00002);
      previous = camera.target[0]; previousStep = step;
    }
    expect(camera.target[0]).toBeCloseTo(data[venus],4);
  });
  test("a moving planet has a smoothly diminishing approach offset",() => {
    const camera = new Camera(), data = new Float32Array(BODIES.length*BODY_FLOATS);
    const earth = 3*BODY_FLOATS, venus = 2*BODY_FLOATS;
    data[earth] = -40; data[venus] = 40;
    camera.focus(3,data); camera.update(0,data);
    camera.focus(2,data);
    let previousOffset = camera.target[0]-data[venus], previousStep = Infinity;
    for (let i = 0; i < 180; i++) {
      data[venus] += .25; // Stress tracking at much faster than the default speed.
      camera.update(.016,data);
      const offset = camera.target[0]-data[venus];
      const step = Math.abs(offset-previousOffset);
      expect(step).toBeLessThanOrEqual(previousStep+.00004);
      previousOffset = offset; previousStep = step;
    }
    expect(camera.target[0]).toBeCloseTo(data[venus],4);
  });
  test("retargeting and returning to overview preserve the current position at zero delta",() => {
    const camera = new Camera(), data = new Float32Array(BODIES.length*BODY_FLOATS);
    data[3*BODY_FLOATS] = -40; data[2*BODY_FLOATS] = 40;
    camera.focus(3,data); camera.update(0,data);
    camera.focus(2,data); camera.update(.1,data);
    const previousEye = camera.eye.slice(), previousTarget = camera.target.slice();
    camera.overview(); camera.update(0,data);
    expect(camera.eye).toEqual(previousEye); expect(camera.target).toEqual(previousTarget);
    camera.focus(3,data); camera.update(0,data);
    expect(camera.eye).toEqual(previousEye); expect(camera.target).toEqual(previousTarget);
    // Explicit snapping still supports reduced-motion navigation.
    camera.snap = true; camera.update(0,data);
    expect(camera.target[0]).toBe(data[3*BODY_FLOATS]);
  });
  test("camera motion settles after targeting and manual input while tracking a moving body",() => {
    const camera = new Camera(), data = new Float32Array(BODIES.length*BODY_FLOATS);
    const earth = 3*BODY_FLOATS;
    data[earth] = 40;
    camera.update(0,data);
    expect(camera.moving).toBe(false);
    camera.focus(3,data);
    expect(camera.moving).toBe(true);
    for (let i = 0; i < 500; i++) {
      data[earth] += .25;
      camera.update(.016,data);
    }
    expect(camera.moving).toBe(false);
    camera.orbit(30,10);
    expect(camera.moving).toBe(true);
    for (let i = 0; i < 200; i++) camera.update(.016,data);
    expect(camera.moving).toBe(false);
    camera.zoom(-100);
    expect(camera.moving).toBe(true);
    for (let i = 0; i < 200; i++) camera.update(.016,data);
    expect(camera.moving).toBe(false);
    camera.overview();
    expect(camera.moving).toBe(true);
    camera.snap = true; camera.update(0,data);
    expect(camera.moving).toBe(false);
  });
  test("projects its target at the shader's optical centre and retains its arrays",() => {
    const camera = new Camera(), s = new Simulation(0), eye = camera.eye, projected = camera.projection;
    camera.update(0,s.data);
    const p = camera.project(0,0,0,1200,800);
    expect(p[0]).toBeCloseTo(708,2); expect(p[1]).toBeCloseTo(400,2);
    camera.focus(3,s.data);
    for (let i = 0; i < 500; i++) camera.update(.016,s.data);
    const o = 3*BODY_FLOATS;
    camera.project(s.data[o],s.data[o+1],s.data[o+2],1200,800);
    expect(projected[0]).toBeCloseTo(708,2); expect(projected[1]).toBeCloseTo(400,2);
    expect(camera.eye).toBe(eye); expect(camera.projection).toBe(projected);
  });
});
