import { BODIES, BODY_FLOATS } from "./data.js";

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
  }

  overview() {
    this.focusOffset.set(this.target);
    this.focused = -1;
    this.goalTheta = .35; this.goalPhi = .72; this.goalDistance = 100;
  }

  focus(index, data) {
    this.focused = index;
    const o = index * BODY_FLOATS;
    for (let axis = 0; axis < 3; axis++) {
      this.focusOffset[axis] = this.target[axis]-data[o+axis];
    }
    this.goalTheta = index === 0 ? .4 : Math.atan2(-data[o],-data[o+2])+.7;
    this.goalPhi = index === 6 ? .35 : .25;
    this.goalDistance = BODIES[index].radius * (index === 6 ? 9 : 5.6);
  }

  orbit(dx,dy) {
    this.goalTheta -= dx * .006;
    this.goalPhi = Math.max(-1.45,Math.min(1.45,this.goalPhi + dy * .006));
  }

  zoom(delta) {
    const minimum = this.focused < 0 ? 8 : BODIES[this.focused].radius * 2.6;
    this.goalDistance = Math.max(minimum,Math.min(200,this.goalDistance * Math.exp(delta * .001)));
  }

  update(dt, data) {
    const blend = this.snap ? 1 : 1-Math.exp(-dt*6);
    this.snap = false;
    this.theta += (this.goalTheta-this.theta)*blend;
    this.phi += (this.goalPhi-this.phi)*blend;
    this.distance += (this.goalDistance-this.distance)*blend;
    const o = this.focused * BODY_FLOATS;
    // Follow the body's motion throughout the flight while smoothly decaying
    // the initial look-at offset. Zoom completion must never snap the target.
    const tracking = this.focused >= 0;
    for (let axis = 0; axis < 3; axis++) {
      const desired = tracking ? data[o+axis] : 0;
      this.focusOffset[axis] *= 1-blend;
      this.target[axis] = desired+this.focusOffset[axis];
    }
    const cp = Math.cos(this.phi), sp = Math.sin(this.phi);
    const st = Math.sin(this.theta), ct = Math.cos(this.theta);
    this.eye[0] = this.target[0] + this.distance * cp * st;
    this.eye[1] = this.target[1] + this.distance * sp;
    this.eye[2] = this.target[2] + this.distance * cp * ct;
    this.forward[0] = -cp*st; this.forward[1] = -sp; this.forward[2] = -cp*ct;
    this.right[0] = ct; this.right[1] = 0; this.right[2] = -st;
    this.up[0] = -sp*st; this.up[1] = cp; this.up[2] = -sp*ct;
  }

  project(x,y,z,width,height) {
    const dx = x-this.eye[0], dy = y-this.eye[1], dz = z-this.eye[2];
    const depth = dx*this.forward[0]+dy*this.forward[1]+dz*this.forward[2];
    this.projection[0] = ((dx*this.right[0]+dy*this.right[1]+dz*this.right[2])/(depth*this.tanFov*width/height)+1+.18)*width*.5;
    this.projection[1] = (1-(dx*this.up[0]+dy*this.up[1]+dz*this.up[2])/(depth*this.tanFov))*height*.5;
    this.projection[2] = depth;
    return this.projection;
  }
}
