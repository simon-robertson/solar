// Display units, independent of the astronomical clock and camera entry distance.
export const FLIGHT_TUNING = Object.freeze({ acceleration: 3.5, braking: 3.5, maxSpeed: 4 });
const KEYS = { KeyW: 0, KeyS: 1, KeyA: 2, KeyD: 3, KeyE: 4, KeyQ: 5 };

export class Flight {
  constructor() {
    this.active = false;
    this.position = new Float64Array(3);
    this.velocity = new Float64Array(3);
    this.keys = new Uint8Array(6);
    this.maxSpeed = FLIGHT_TUNING.maxSpeed;
  }

  enter(eye) {
    this.position.set(eye);
    this.maxSpeed = FLIGHT_TUNING.maxSpeed;
    this.stop();
    this.active = true;
  }

  setKey(code,pressed) {
    if (!Object.hasOwn(KEYS,code)) return false;
    this.keys[KEYS[code]] = pressed ? 1 : 0;
    return true;
  }

  stop() { this.keys.fill(0); this.velocity.fill(0); }
  get speed() { return Math.hypot(this.velocity[0],this.velocity[1],this.velocity[2]); }
  get thrusting() { return this.keys[0]!==this.keys[1] || this.keys[2]!==this.keys[3] || this.keys[4]!==this.keys[5]; }

  update(dt,forward,right,up) {
    if (!this.active || !Number.isFinite(dt) || dt<=0) return;
    dt = Math.min(.05,dt);
    let longitudinal = this.keys[0]-this.keys[1], lateral = this.keys[3]-this.keys[2], vertical = this.keys[4]-this.keys[5];
    const length = Math.hypot(longitudinal,lateral,vertical);
    if (length) { longitudinal /= length; lateral /= length; vertical /= length; }
    const rate = length ? FLIGHT_TUNING.acceleration : FLIGHT_TUNING.braking;
    const decay = Math.exp(-rate*dt), integral = -Math.expm1(-rate*dt)/rate;
    for (let axis = 0; axis<3; axis++) {
      const desired = (forward[axis]*longitudinal+right[axis]*lateral+up[axis]*vertical)*this.maxSpeed;
      // Exact integral of exponential velocity relaxation for a fixed heading.
      // Position as well as speed therefore agrees across frame rates.
      this.position[axis] += desired*dt+(this.velocity[axis]-desired)*integral;
      this.velocity[axis] = desired+(this.velocity[axis]-desired)*decay;
    }
    if (!length && this.speed<.0001) this.velocity.fill(0);
  }
}
