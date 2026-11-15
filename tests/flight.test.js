import { describe, expect, test } from "bun:test";
import { Flight, FLIGHT_TUNING } from "../docs/src/flight.js";
import { Camera } from "../docs/src/camera.js";
import { Simulation } from "../docs/src/simulation.js";
import { BODY_FLOATS } from "../docs/src/data.js";

const forward = [0,0,-1], right = [1,0,0], up = [0,1,0];
function flight() { const f = new Flight(); f.enter([0,0,0]); return f; }
function advance(f,seconds,hz=60) {
  for (let i = 0; i<Math.round(seconds*hz); i++) f.update(1/hz,forward,right,up);
}

describe("spacecraft flight",() => {
  test("acceleration and distance match the independent continuous-time solution",() => {
    const f = flight(); f.setKey("KeyW",true);
    advance(f,.5);
    // dv/dt = k(V-v), x(t) = V[t-(1-exp(-kt))/k].
    const k = FLIGHT_TUNING.acceleration, V = f.maxSpeed, t = .5;
    expect(f.speed).toBeCloseTo(V*(1-Math.exp(-k*t)),10);
    expect(f.position[2]).toBeCloseTo(-V*(t-(1-Math.exp(-k*t))/k),10);
    expect(f.speed).toBeLessThan(V);
    advance(f,5);
    expect(f.speed).toBeCloseTo(V,6);
    expect(f.speed).toBeLessThanOrEqual(V);
  });

  test("release and opposing keys decelerate with the same response as acceleration",() => {
    for (const cancel of [false,true]) {
      const f = flight(); f.setKey("KeyW",true); advance(f,1);
      const speed = f.speed;
      f.setKey(cancel ? "KeyS" : "KeyW",cancel);
      f.update(1/60,forward,right,up);
      expect(f.speed).toBeGreaterThan(0);
      expect(f.speed).toBeLessThan(speed);
      const brakingStart = f.speed, accelerating = flight();
      accelerating.setKey("KeyW",true);
      for (const interval of [.25,.25,.5]) {
        advance(f,interval); advance(accelerating,interval);
        expect(f.speed/brakingStart).toBeCloseTo(1-accelerating.speed/accelerating.maxSpeed,10);
      }
      advance(f,4);
      expect(f.speed).toBe(0);
    }
  });

  test("opposing pairs cancel independently and releasing one restores the other",() => {
    const f = flight();
    for (const code of ["KeyW","KeyS","KeyA","KeyD","KeyE","KeyQ"]) f.setKey(code,true);
    expect(f.thrusting).toBe(false);
    advance(f,1); expect(f.speed).toBe(0);
    expect(Array.from(f.position)).toEqual([0,0,0]);
    f.setKey("KeyA",false); advance(f,1);
    expect(f.position[0]).toBeGreaterThan(0); expect(f.position[2]).toBe(0);
    f.stop(); f.setKey("KeyS",true); advance(f,1);
    expect(f.velocity[2]).toBeGreaterThan(0);
    f.stop(); f.setKey("KeyA",true); advance(f,1);
    expect(f.velocity[0]).toBeLessThan(0);
    expect(f.setKey("KeyX",true)).toBe(false);
  });

  test("diagonal input preserves the same speed and movement uses the craft basis",() => {
    const straight = flight(), diagonal = flight();
    straight.setKey("KeyW",true);
    diagonal.setKey("KeyW",true); diagonal.setKey("KeyD",true);
    advance(straight,1); advance(diagonal,1);
    expect(diagonal.speed).toBeCloseTo(straight.speed,10);
    expect(diagonal.velocity[0]).toBeCloseTo(-diagonal.velocity[2],10);
    const rotated = flight(); rotated.setKey("KeyW",true);
    rotated.update(.05,[1,0,0],[0,0,1],up);
    expect(rotated.position[0]).toBeGreaterThan(0); expect(rotated.position[2]).toBe(0);
  });

  test("E and Q move along local up, cancel each other and report vertical thrust",() => {
    const f = flight();
    f.setKey("KeyE",true); expect(f.thrusting).toBe(true);
    advance(f,1);
    expect(f.velocity[1]).toBeGreaterThan(0); expect(f.position[1]).toBeGreaterThan(0);
    expect(f.velocity[0]).toBe(0); expect(f.velocity[2]).toBe(0);
    const speed = f.speed;
    f.setKey("KeyQ",true); expect(f.thrusting).toBe(false);
    advance(f,1);
    expect(f.speed).toBeCloseTo(speed*Math.exp(-FLIGHT_TUNING.acceleration),10);
    f.setKey("KeyE",false); advance(f,1);
    expect(f.velocity[1]).toBeLessThan(0); expect(f.thrusting).toBe(true);
    f.stop(); expect(f.thrusting).toBe(false);
    f.setKey("KeyE",true);
    f.update(.05,[0,-1,0],right,[0,0,-1]);
    expect(f.velocity[2]).toBeLessThan(0); expect(f.velocity[1]).toBe(0);
  });

  test("three-axis thrust shares the cruise limit instead of increasing diagonal speed",() => {
    const straight = flight(), combined = flight();
    straight.setKey("KeyW",true);
    for (const code of ["KeyW","KeyD","KeyE"]) combined.setKey(code,true);
    advance(straight,2); advance(combined,2);
    expect(combined.speed).toBeCloseTo(straight.speed,10);
    expect(combined.speed).toBeLessThanOrEqual(4);
    expect(combined.velocity[0]).toBeCloseTo(combined.velocity[1],10);
    expect(combined.velocity[0]).toBeCloseTo(-combined.velocity[2],10);
  });

  test("30, 60 and 144 Hz agree through acceleration, braking and direction changes",() => {
    const flights = [30,60,144].map(hz => {
      const f = flight(); f.setKey("KeyW",true); advance(f,1,hz);
      f.setKey("KeyD",true); advance(f,1,hz);
      f.setKey("KeyE",true); advance(f,1,hz);
      f.setKey("KeyW",false); f.setKey("KeyD",false); f.setKey("KeyE",false); advance(f,.5,hz);
      return f;
    });
    for (const f of flights.slice(1)) for (let axis = 0; axis<3; axis++) {
      expect(f.position[axis]).toBeCloseTo(flights[0].position[axis],9);
      expect(f.velocity[axis]).toBeCloseTo(flights[0].velocity[axis],9);
    }
  });

  test("stalls are bounded, invalid deltas ignored, and stopping clears all input",() => {
    const f = flight(); f.setKey("KeyW",true);
    f.update(NaN,forward,right,up); f.update(-1,forward,right,up);
    expect(f.speed).toBe(0);
    f.update(120,forward,right,up);
    expect(Math.abs(f.position[2])).toBeLessThan(f.maxSpeed*.05);
    f.stop(); expect(f.speed).toBe(0); expect(Array.from(f.keys)).toEqual([0,0,0,0,0,0]);
    const position = f.position.slice(); advance(f,1); expect(f.position).toEqual(position);
    f.active = false; f.setKey("KeyW",true); advance(f,1); expect(f.position).toEqual(position);
  });

  test("cruise limit is 4 for both planetary close-ups and distant entry views",() => {
    const c = new Camera(), s = new Simulation(0);
    for (const distance of [.01,3,100,1000]) {
      c.distance = c.goalDistance = distance;
      c.update(0,s.data); c.enterCockpit();
      expect(c.flight.maxSpeed).toBe(4);
      c.exitCockpit(s.data);
    }
  });
});

describe("cockpit camera",() => {
  test("vertical thrust uses the pitched camera's up vector",() => {
    const c = new Camera(), s = new Simulation(0); c.update(0,s.data);
    const eye = c.eye.slice(); c.enterCockpit(); c.flight.setKey("KeyE",true); c.update(.05,s.data);
    const delta = Array.from(c.eye,(x,i) => x-eye[i]);
    expect(delta.reduce((sum,x,i) => sum+x*c.up[i],0)).toBeGreaterThan(0);
    expect(delta.reduce((sum,x,i) => sum+x*c.forward[i],0)).toBeCloseTo(0,5);
    expect(delta.reduce((sum,x,i) => sum+x*c.right[i],0)).toBeCloseTo(0,5);
  });

  test("entry preserves the eye and heading; drag turns in place, zoom and focus cannot take over",() => {
    const c = new Camera(), s = new Simulation(0); c.update(0,s.data);
    const eye = c.eye.slice(), direction = c.forward.slice(), distance = c.goalDistance;
    c.enterCockpit(); c.update(.02,s.data);
    expect(c.eye).toEqual(eye); expect(c.forward).toEqual(direction);
    c.zoom(-100); c.focus(3,s.data); c.overview();
    expect(c.goalDistance).toBe(distance); expect(c.focused).toBe(-1);
    c.orbit(80,20); c.update(.05,s.data);
    expect(c.eye).toEqual(eye); expect(c.forward).not.toEqual(direction);
    c.flight.setKey("KeyW",true); c.update(.05,s.data);
    const delta = Array.from(c.eye,(x,i) => x-eye[i]);
    expect(delta.reduce((sum,x,i) => sum+x*c.forward[i],0)).toBeGreaterThan(0);
  });

  test("exit restores the orbit view relative to the body's current position",() => {
    const c = new Camera(), s = new Simulation(0);
    c.focus(3,s.data); c.update(0,s.data);
    c.orbit(15,5); c.zoom(20); c.update(.05,s.data);
    const snapshot = { theta: c.theta, goalTheta: c.goalTheta, phi: c.phi, distance: c.distance, goalDistance: c.goalDistance };
    const relative = Array.from(c.eye,(x,i) => x-s.data[3*BODY_FLOATS+i]);
    c.enterCockpit(); c.enterCockpit(); c.orbit(100,100);
    c.flight.setKey("KeyW",true); c.update(.05,s.data);
    s.data[3*BODY_FLOATS] += 10;
    c.exitCockpit(s.data);
    for (const [key,value] of Object.entries(snapshot)) expect(c[key]).toBe(value);
    expect(c.focused).toBe(3); expect(c.flight.active).toBe(false); expect(c.flight.speed).toBe(0);
    for (let i = 0; i<3; i++) expect(c.eye[i]-s.data[3*BODY_FLOATS+i]).toBeCloseTo(relative[i],4);
    c.exitCockpit(s.data); expect(c.focused).toBe(3);
  });
});
