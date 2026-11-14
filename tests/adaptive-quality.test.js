import { expect, test } from "bun:test";
import { AdaptiveQuality } from "../docs/src/adaptive-quality.js";

function sample(monitor,clock,fps,seconds) {
  let reductions = 0;
  for (let i = 0; i < fps*seconds; i++) {
    clock.now += 1000/fps;
    if (monitor.update(clock.now)) reductions++;
  }
  return reductions;
}

function start() {
  const monitor = new AdaptiveQuality(), clock = { now: 10000 };
  expect(monitor.update(clock.now)).toBe(false);
  return { monitor, clock };
}

test("requires two seconds of sustained low FPS and repeats for further reductions",() => {
  const { monitor, clock } = start();
  expect(sample(monitor,clock,30,1)).toBe(0);
  expect(sample(monitor,clock,30,1.1)).toBe(1);
  expect(sample(monitor,clock,30,1)).toBe(0);
  expect(sample(monitor,clock,30,1.1)).toBe(1);
});

test("keeps 60 Hz, normal timing jitter and higher refresh rates",() => {
  for (const fps of [60,59.94,90,120,144]) {
    const { monitor, clock } = start();
    expect(sample(monitor,clock,fps,10)).toBe(0);
  }
});

test("detects a modest sustained drop below 60 FPS",() => {
  const { monitor, clock } = start();
  expect(sample(monitor,clock,59,2.2)).toBe(1);
});

test("healthy FPS breaks a low-FPS streak",() => {
  const { monitor, clock } = start();
  expect(sample(monitor,clock,30,1.1)).toBe(0);
  expect(sample(monitor,clock,60,1.1)).toBe(0);
  expect(sample(monitor,clock,30,1.1)).toBe(0);
  expect(sample(monitor,clock,30,1.1)).toBe(1);
});

test("an isolated long stall cannot cause a reduction",() => {
  const { monitor, clock } = start();
  clock.now += 5000;
  expect(monitor.update(clock.now)).toBe(false);
  expect(sample(monitor,clock,60,3)).toBe(0);
});

test("reset discards previous slow samples and time spent outside the frame loop",() => {
  const { monitor, clock } = start();
  expect(sample(monitor,clock,30,1.1)).toBe(0);
  monitor.reset();
  clock.now += 60000;
  expect(monitor.update(clock.now)).toBe(false);
  expect(sample(monitor,clock,30,1.1)).toBe(0);
  expect(sample(monitor,clock,30,1.1)).toBe(1);
});
