import { expect, test } from "bun:test";
import { Simulation } from "../docs/src/simulation.js";

test("solar surface animation pauses, reverses, caps speed and resets without replacing body state",() => {
  const s = new Simulation(0), data = s.data;
  s.tick(.05); expect(s.solarSeconds).toBeCloseTo(.05,10);
  s.paused = true; s.tick(.05); expect(s.solarSeconds).toBeCloseTo(.05,10);
  s.paused = false; s.speed = -1/24; s.tick(.05); expect(s.solarSeconds).toBeCloseTo(0,10);
  s.speed = 1000; s.tick(.05); expect(s.solarSeconds).toBeCloseTo(.4,10);
  s.speed = -1000; s.tick(.05); expect(s.solarSeconds).toBeCloseTo(0,10);
  s.tick(NaN); expect(s.solarSeconds).toBeCloseTo(0,10);
  s.reset(10); expect(s.solarSeconds).toBe(0); expect(s.data).toBe(data);
});
