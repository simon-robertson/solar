import { BODIES, BODY_FLOATS } from "./data.js";
import { Flight } from "./flight.js";

export class Camera {
  constructor() {
    this.eye = new Float32Array(3);
    this.target = new Float32Array(3);
    // Keep the approach offset separate from the moving planet. Extra precision
    // preserves the current target when retargeting across large distances.
    this.focusOffset = new Float64Array(3);
    this.right = new Float32Array(3);
    this.up = new Float32Array(3);
    this.forward = new Float32Array(3);
    this.projection = new Float32Array(3);
    this.tanFov = Math.tan(38 * Math.PI / 360);
    this.theta = this.goalTheta = .35;
    this.phi = this.goalPhi = .72;
    this.distance = this.goalDistance = 100;
    this.focused = -1;
    this.snap = true;
    this.flight = new Flight();
    this.savedView = null;
  }

  enterCockpit() {
    if (this.flight.active) return;
    this.savedView = {
      theta: this.theta, goalTheta: this.goalTheta, phi: this.phi, goalPhi: this.goalPhi,
      distance: this.distance, goalDistance: this.goalDistance, focused: this.focused,
      snap: this.snap, focusOffset: this.focusOffset.slice(),
    };
    this.flight.enter(this.eye);
    this.goalTheta = this.theta; this.goalPhi = this.phi;
  }

  exitCockpit(data) {
    if (!this.flight.active) return;
    this.flight.stop(); this.flight.active = false;
    const { focusOffset, ...view } = this.savedView;
    Object.assign(this,view);
    this.focusOffset.set(focusOffset);
    this.savedView = null;
    // Reconstruct against the body's CURRENT position, not stale world space.
    this.update(0,data);
  }

  overview() {
    if (this.flight.active) return;
    this.focusOffset.set(this.target);
    this.focused = -1;
    this.goalTheta = .35; this.goalPhi = .72; this.goalDistance = 100;
  }

  focus(index, data) {
    if (this.flight.active) return;
    this.focused = index;
    const o = index * BODY_FLOATS;
    for (let axis = 0; axis < 3; axis++) {
      this.focusOffset[axis] = this.target[axis]-data[o+axis];
    }
    this.goalTheta = index === 0 ? .4 : Math.atan2(-data[o],-data[o+2])+.7;
    this.goalPhi = index === 6 ? .35 : .25;
    this.goalDistance = BODIES[index].radius * (index === 6 ? 12 : 5.6);
  }

  orbit(dx,dy) {
    this.goalTheta -= dx * .006;
    this.goalPhi = Math.max(-1.45,Math.min(1.45,this.goalPhi + dy * .006));
  }

  zoom(delta) {
    if (this.flight.active) return;
    const minimum = this.focused < 0 ? 8 : BODIES[this.focused].radius * 2.6;
    this.goalDistance = Math.max(minimum,Math.min(200,this.goalDistance * Math.exp(delta * .001)));
  }

  get moving() {
    // Measure the remaining camera flight, not the motion of a tracked planet.
    // Relative tolerances keep close-ups and system views equally quiet.
    const tolerance = this.distance*.0001;
    return Math.abs(this.goalTheta-this.theta)>.0001 ||
      Math.abs(this.goalPhi-this.phi)>.0001 ||
      Math.abs(this.goalDistance-this.distance)>tolerance ||
      Math.hypot(this.focusOffset[0],this.focusOffset[1],this.focusOffset[2])>tolerance;
  }

  update(dt, data) {
    const blend = this.snap ? 1 : 1-Math.exp(-dt*6);
    this.snap = false;
    this.theta += (this.goalTheta-this.theta)*blend;
    this.phi += (this.goalPhi-this.phi)*blend;
    this.distance += (this.goalDistance-this.distance)*blend;
    this.updateBasis();
    if (this.flight.active) {
      this.flight.update(dt,this.forward,this.right,this.up);
      this.eye.set(this.flight.position);
      for (let axis = 0; axis<3; axis++) this.target[axis] = this.eye[axis]+this.forward[axis];
      return;
    }
    const o = this.focused * BODY_FLOATS;
    // Follow the body's motion throughout the flight while smoothly decaying
    // the initial look-at offset. Zoom completion must never snap the target.
    const tracking = this.focused >= 0;
    for (let axis = 0; axis < 3; axis++) {
      const desired = tracking ? data[o+axis] : 0;
      this.focusOffset[axis] *= 1-blend;
      this.target[axis] = desired+this.focusOffset[axis];
    }
    for (let axis = 0; axis<3; axis++) this.eye[axis] = this.target[axis]-this.distance*this.forward[axis];
  }

  updateBasis() {
    const cp = Math.cos(this.phi), sp = Math.sin(this.phi);
    const st = Math.sin(this.theta), ct = Math.cos(this.theta);
    this.forward[0] = -cp*st; this.forward[1] = -sp; this.forward[2] = -cp*ct;
    this.right[0] = ct; this.right[1] = 0; this.right[2] = -st;
    this.up[0] = -sp*st; this.up[1] = cp; this.up[2] = -sp*ct;
  }

  project(x,y,z,width,height) {
    const dx = x-this.eye[0], dy = y-this.eye[1], dz = z-this.eye[2];
    const depth = dx*this.forward[0]+dy*this.forward[1]+dz*this.forward[2];
    this.projection[0] = ((dx*this.right[0]+dy*this.right[1]+dz*this.right[2])/(depth*this.tanFov*width/height)+1)*width*.5;
    this.projection[1] = (1-(dx*this.up[0]+dy*this.up[1]+dz*this.up[2])/(depth*this.tanFov))*height*.5;
    this.projection[2] = depth;
    return this.projection;
  }
}
