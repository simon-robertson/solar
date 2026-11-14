import { expect, test } from "bun:test";
import { SceneGestures } from "../docs/src/scene-gestures.js";
import { Camera } from "../docs/src/camera.js";
import { BODIES } from "../docs/src/data.js";

function setup() {
  const listeners = {}, captured = new Set(), picks = [];
  const canvas = {
    addEventListener(type,callback) { listeners[type] = callback; },
    setPointerCapture(id) { captured.add(id); },
    hasPointerCapture(id) { return captured.has(id); },
    releasePointerCapture(id) {
      captured.delete(id);
      listeners.lostpointercapture({ pointerId: id });
    },
  };
  const camera = new Camera();
  let moves = 0;
  const gestures = new SceneGestures(canvas,camera,() => moves++,(x,y) => picks.push([x,y]));
  const send = (type,id,x=0,y=0,button=0) => listeners[type]({ pointerId: id, clientX: x, clientY: y, button });
  return { camera, gestures, captured, picks, send, moves: () => moves };
}

test("spreading zooms in proportionally and pinching zooms back out without orbiting",() => {
  const { camera, gestures, send, picks, moves } = setup();
  const theta = camera.goalTheta, phi = camera.goalPhi;
  send("pointerdown",1,100,100); send("pointerdown",2,200,100);
  send("pointermove",2,300,100);
  expect(camera.goalDistance).toBeCloseTo(50,10);
  send("pointermove",2,200,100);
  expect(camera.goalDistance).toBeCloseTo(100,10);
  expect(camera.goalTheta).toBe(theta); expect(camera.goalPhi).toBe(phi);
  expect(gestures.dragging).toBe(true); expect(moves()).toBeGreaterThan(0);
  send("pointerup",2,200,100); send("pointerup",1,100,100);
  expect(picks).toEqual([]); expect(gestures.dragging).toBe(false);
});

test("pinch uses the full diagonal distance and respects camera zoom limits",() => {
  const { camera, send } = setup();
  send("pointerdown",1,0,0); send("pointerdown",2,30,40);
  send("pointermove",2,60,80);
  expect(camera.goalDistance).toBeCloseTo(50,10);
  send("pointermove",2,6000,8000);
  expect(camera.goalDistance).toBe(8);
  send("pointermove",2,.3,.4);
  expect(camera.goalDistance).toBe(200);
  camera.focused = 3; camera.goalDistance = 10;
  send("pointermove",2,6000,8000);
  expect(camera.goalDistance).toBe(BODIES[3].radius*2.6);
});

test("lifting either finger resumes one-finger orbiting without a jump or accidental pick",() => {
  for (const lifted of [1,2]) {
    const { camera, send, picks, captured } = setup();
    send("pointerdown",1,100,100); send("pointerdown",2,200,100);
    send("pointermove",1,80,100); send("pointermove",2,220,100);
    const theta = camera.goalTheta;
    send("pointerup",lifted,lifted===1?80:220,100);
    const remaining = lifted===1 ? 2 : 1, x = remaining===1 ? 80 : 220;
    expect(captured.has(remaining)).toBe(true);
    send("pointermove",remaining,x+10,100);
    expect(camera.goalTheta).toBeCloseTo(theta-.06,10);
    send("pointerup",remaining,x+10,100);
    expect(picks).toEqual([]); expect(captured.size).toBe(0);
    send("pointerdown",3,50,60); send("pointerup",3,50,60);
    expect(picks).toEqual([[50,60]]);
  }
});

test("two stationary fingers never select a planet",() => {
  const { send, picks } = setup();
  send("pointerdown",1,100,100); send("pointerdown",2,200,100);
  send("pointerup",1,100,100); send("pointerup",2,200,100);
  expect(picks).toEqual([]);
});

test("cancellation and lost capture remove only the affected finger and never pick",() => {
  for (const type of ["pointercancel","lostpointercapture"]) {
    const { camera, gestures, captured, send, picks } = setup();
    send("pointerdown",1,100,100); send("pointerdown",2,200,100);
    send(type,1,100,100);
    expect(gestures.pointers.size).toBe(1); expect(captured.has(2)).toBe(true);
    send("pointermove",2,210,100);
    expect(camera.goalTheta).toBeCloseTo(.29,10);
    send(type,2,210,100);
    expect(gestures.dragging).toBe(false); expect(picks).toEqual([]);
    send("pointerdown",3,10,20); send("pointerup",3,10,20);
    expect(picks).toEqual([[10,20]]);
  }
});

test("coincident fingers establish a fresh pinch baseline without invalid zoom",() => {
  const { camera, send } = setup();
  send("pointerdown",1,0,0); send("pointerdown",2,0,0);
  send("pointermove",2,100,0);
  expect(camera.goalDistance).toBe(100);
  send("pointermove",2,200,0);
  expect(camera.goalDistance).toBeCloseTo(50,10);
  send("pointermove",2,0,0);
  expect(Number.isFinite(camera.goalDistance)).toBe(true);
});

test("single-pointer taps, drag threshold, mouse buttons and unrelated pointers",() => {
  const { camera, gestures, send, picks, captured } = setup();
  send("pointerdown",9,0,0,2);
  expect(captured.size).toBe(0);
  send("pointerdown",1,10,20); send("pointermove",1,12,21); send("pointerup",1,12,21);
  expect(picks).toEqual([[12,21]]);
  send("pointerdown",2,10,20); send("pointermove",2,20,25);
  expect(camera.goalTheta).toBeCloseTo(.29,10); expect(camera.goalPhi).toBeCloseTo(.75,10);
  expect(gestures.dragging).toBe(true);
  send("pointermove",9,100,100); send("pointercancel",9);
  expect(gestures.dragging).toBe(true);
  send("pointerup",2,20,25);
  expect(picks).toHaveLength(1); expect(gestures.dragging).toBe(false);
});

test("an extra finger cannot reset or disturb the tracked pinch",() => {
  const { camera, send, picks } = setup();
  send("pointerdown",1,0,0); send("pointerdown",2,100,0);
  send("pointerdown",3,50,50); send("pointermove",3,500,500); send("pointerup",3,500,500);
  send("pointermove",2,200,0);
  expect(camera.goalDistance).toBeCloseTo(50,10);
  send("pointerup",1,0,0); send("pointerup",2,200,0);
  expect(picks).toEqual([]);
});
