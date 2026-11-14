import { describe, expect, test } from "bun:test";
import { ProximityLod } from "../docs/src/lod.js";
import { OrbitDetails, SATURN_MOONS, ORBIT_FLOATS, PLANET_ORBITS, compressedMoonRadius, RING_NORMAL, satelliteVisibility } from "../docs/src/orbit-details.js";
import { BODIES, BODY_FLOATS, DEG } from "../docs/src/data.js";
import { Simulation } from "../docs/src/simulation.js";
import { Camera } from "../docs/src/camera.js";

const parent = 6*BODY_FLOATS;
function nearCamera(simulation,distance=10) {
  const camera = new Camera();
  camera.eye.set([simulation.data[parent],simulation.data[parent+1],simulation.data[parent+2]+BODIES[6].radius*distance]);
  camera.forward.set([0,0,-1]); camera.right.set([1,0,0]); camera.up.set([0,1,0]);
  return camera;
}
const relative = (details,simulation,i) => [0,1,2].map(j => details.positions[i*3+j]-simulation.data[parent+j]);

describe("proximity LOD",() => {
  test("uses camera distance with hysteresis and a bounded transition",() => {
    const lod = new ProximityLod();
    expect(lod.update(100,0)).toBe(0);
    expect(lod.update(18,.1)).toBeCloseTo(.4,8);
    expect(lod.active).toBe(true);
    expect(lod.update(20,.15)).toBe(1);
    expect(lod.update(21.99,.1)).toBe(1);
    expect(lod.update(22,.1)).toBeCloseTo(.6,8);
    expect(lod.active).toBe(false);
    expect(lod.update(20,.15)).toBe(0);
    expect(lod.update(17,1)).toBe(1);
    expect(lod.update(Infinity,1)).toBe(0);
  });
  test("depends on proximity rather than the selected camera target",() => {
    const simulation = new Simulation(0), details = new OrbitDetails();
    const camera = nearCamera(simulation,100); camera.focused = 6;
    details.update(simulation,camera);
    expect(details.saturnLod.opacity).toBe(0);
    simulation.deltaSeconds = .25; camera.focused = -1;
    camera.eye = nearCamera(simulation).eye;
    details.update(simulation,camera);
    expect(details.saturnLod.opacity).toBe(1);
    camera.eye = nearCamera(simulation,24).eye;
    details.update(simulation,camera);
    expect(details.saturnLod.opacity).toBe(0);
    for (let i = 0; i < SATURN_MOONS.length; i++) expect(details.data[(PLANET_ORBITS+i)*ORBIT_FLOATS+11]).toBe(0);
  });
  test("moon LOD never hides planet paths and ignores Saturn behind the camera",() => {
    const simulation = new Simulation(0), details = new OrbitDetails(), camera = nearCamera(simulation);
    details.update(simulation,camera);
    expect(details.saturnLod.opacity).toBe(1);
    for (let i = 0; i < PLANET_ORBITS; i++) expect(details.data[i*ORBIT_FLOATS+11]).toBe(1);
    camera.forward.set([0,0,1]); simulation.deltaSeconds = .25;
    details.update(simulation,camera);
    expect(details.saturnLod.opacity).toBe(0);
    for (let i = 0; i < PLANET_ORBITS; i++) expect(details.data[i*ORBIT_FLOATS+11]).toBe(1);
  });
  test("each planet close-up retains its own path and does not enable offscreen Saturn detail",() => {
    const simulation = new Simulation(0), camera = new Camera();
    for (let index = 1; index < 9; index++) {
      const details = new OrbitDetails();
      camera.focus(index,simulation.data); camera.snap = true; camera.update(0,simulation.data);
      details.update(simulation,camera,16/9);
      expect(details.data[(index-1)*ORBIT_FLOATS+11]).toBe(1);
      if (index===3) expect(details.saturnLod.opacity).toBe(0); // J2000 regression: Saturn is close but behind us.
    }
  });
});

describe("Saturn moon detail",() => {
  test("Saturn targeting frames the outer display orbit within the local LOD",() => {
    const simulation = new Simulation(0), camera = new Camera();
    camera.focus(6,simulation.data);
    const outer = Math.max(...SATURN_MOONS.map(moon => compressedMoonRadius(moon.elements[0])*(1+moon.elements[1])));
    expect(camera.goalDistance).toBeGreaterThan(outer);
    expect(camera.goalDistance/BODIES[6].radius).toBeLessThan(new ProximityLod().enter);
  });
  test("separates seven marker-only moons from all physical/pickable bodies",() => {
    expect(SATURN_MOONS.map(moon => moon.name)).toEqual(["Mimas","Enceladus","Tethys","Dione","Rhea","Titan","Iapetus"]);
    expect(SATURN_MOONS.every(moon => !BODIES.some(body => body.name===moon.name))).toBe(true);
    const simulation = new Simulation(0), copy = simulation.data.slice(), details = new OrbitDetails();
    details.update(simulation,nearCamera(simulation));
    expect(simulation.data).toEqual(copy);
    for (let i = 0; i < SATURN_MOONS.length; i++) {
      const o = (PLANET_ORBITS+i)*ORBIT_FLOATS;
      expect(details.data[o+14]).toBe(1); expect(details.data[o+15]).toBe(-1);
    }
  });
  test("source periods/phases and compressed ellipses preserve order and clear the rings",() => {
    const simulation = new Simulation(0), details = new OrbitDetails();
    details.update(simulation,nearCamera(simulation));
    let previous = 0;
    SATURN_MOONS.forEach((moon,i) => {
      const [km,e,,mean] = moon.elements, a = compressedMoonRadius(km), o = (PLANET_ORBITS+i)*ORBIT_FLOATS;
      const anomaly = details.data[o+12];
      const wrapped = Math.atan2(Math.sin(mean*DEG),Math.cos(mean*DEG));
      expect(Math.abs(anomaly-e*Math.sin(anomaly)-wrapped)).toBeLessThan(2e-7);
      expect(a).toBeGreaterThan(previous); previous = a;
      expect(a*(1-e)).toBeGreaterThan(BODIES[6].radius*2.32);
      expect(Math.hypot(...relative(details,simulation,i))).toBeCloseTo(a*(1-e*Math.cos(anomaly)),5);
      const before = relative(details,simulation,i);
      simulation.days = moon.elements[6]; details.update(simulation,nearCamera(simulation));
      const after = relative(details,simulation,i);
      after.forEach((value,j) => expect(value).toBeCloseTo(before[j],9));
      simulation.days = 0; details.update(simulation,nearCamera(simulation));
    });
  });
  test("maps inner Laplace planes into the ring frame while keeping Iapetus tilted",() => {
    const details = new OrbitDetails();
    const normal = index => {
      const a = details.axes[index];
      return [a[1]*a[5]-a[2]*a[4],a[2]*a[3]-a[0]*a[5],a[0]*a[4]-a[1]*a[3]];
    };
    const alignment = index => normal(index).reduce((sum,x,j) => sum+x*RING_NORMAL[j],0)/Math.hypot(...RING_NORMAL);
    expect(alignment(1)).toBeCloseTo(1,9); // Enceladus: zero inclination in the inner Laplace plane.
    expect(alignment(6)).toBeLessThan(Math.cos(5*DEG));
    details.axes.forEach(a => {
      expect(Math.hypot(a[0],a[1],a[2])).toBeCloseTo(1,10);
      expect(Math.hypot(a[3],a[4],a[5])).toBeCloseTo(1,10);
      expect(a[0]*a[3]+a[1]*a[4]+a[2]*a[5]).toBeCloseTo(0,10);
    });
  });
  test("parent translation moves every moon and orbit by the same amount",() => {
    const simulation = new Simulation(0), details = new OrbitDetails(), camera = nearCamera(simulation);
    details.update(simulation,camera);
    const before = details.positions.slice(), translation = [7,-3,11];
    translation.forEach((x,j) => { simulation.data[parent+j] += x; camera.eye[j] += x; });
    details.update(simulation,camera);
    for (let i = 0; i < SATURN_MOONS.length; i++) for (let j = 0; j < 3; j++) {
      expect(details.positions[i*3+j]-before[i*3+j]).toBeCloseTo(translation[j],5);
      expect(details.data[(PLANET_ORBITS+i)*ORBIT_FLOATS+8+j]).toBe(simulation.data[parent+j]);
    }
  });
  test("pause, reverse and split time steps produce deterministic reusable moon state",() => {
    const a = new Simulation(0), b = new Simulation(0), x = new OrbitDetails(), y = new OrbitDetails();
    x.update(a,nearCamera(a)); y.update(b,nearCamera(b));
    const initial = x.positions.slice(), data = x.data, positions = x.positions;
    a.paused = true; a.tick(.04); x.update(a,nearCamera(a));
    expect(x.positions).toEqual(initial);
    a.paused = false; a.speed = b.speed = 1;
    a.tick(.04); b.tick(.01); b.tick(.03);
    x.update(a,nearCamera(a)); y.update(b,nearCamera(b));
    x.positions.forEach((value,i) => expect(value).toBeCloseTo(y.positions[i],7));
    a.speed = -1; a.tick(.04); x.update(a,nearCamera(a));
    x.positions.forEach((value,i) => expect(value).toBeCloseTo(initial[i],8));
    expect(x.data[(PLANET_ORBITS)*ORBIT_FLOATS+13]).toBe(-1);
    expect(x.data).toBe(data); expect(x.positions).toBe(positions);
  });
  test("names are occluded by foreground spheres and Saturn's ring annulus",() => {
    const simulation = new Simulation(0), data = simulation.data;
    for (let i = 0; i < BODIES.length; i++) { data[i*BODY_FLOATS] = 1000; data[i*BODY_FLOATS+1] = data[i*BODY_FLOATS+2] = 1000; }
    data[parent] = data[parent+1] = data[parent+2] = 0; data[parent+3] = 1;
    const camera = { eye: [0,0,-4] };
    expect(satelliteVisibility(camera,data,0,0,4)).toBe(0);
    expect(satelliteVisibility(camera,data,0,0,-2)).toBe(1);
    expect(satelliteVisibility(camera,data,0,1.5,1)).toBe(0);
    expect(satelliteVisibility(camera,data,0,.3,-3)).toBe(1);
  });
});
