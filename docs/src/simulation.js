import { BODIES, BODY_FLOATS, ELEMENTS, DEG, TAU } from "./data.js";

export const MIN_DAY = (Date.UTC(1800, 0, 1) - Date.UTC(2000, 0, 1, 12)) / 86400000;
export const MAX_DAY = (Date.UTC(2051, 0, 1) - Date.UTC(2000, 0, 1, 12)) / 86400000 - 1;
export const toEpochDays = milliseconds => (milliseconds - Date.UTC(2000, 0, 1, 12)) / 86400000;

export function solveKepler(meanAnomaly, eccentricity) {
  const m = Math.atan2(Math.sin(meanAnomaly), Math.cos(meanAnomaly));
  let e = m + eccentricity * Math.sin(m);
  for (let iteration = 0; iteration < 8; iteration++) {
    const delta = (e - eccentricity * Math.sin(e) - m) / (1 - eccentricity * Math.cos(e));
    e -= delta;
    if (Math.abs(delta) < 1e-12) break;
  }
  return e;
}

export class Simulation {
  constructor(epochDays = toEpochDays(Date.now())) {
    this.days = epochDays;
    this.elapsedSeconds = 0;
    this.solarSeconds = 0;
    this.deltaSeconds = 0;
    this.speed = 1 / 24; // Simulated days per real second: one hour per second.
    this.paused = false;
    this.data = new Float32Array(BODIES.length * BODY_FLOATS);
    this.reset(epochDays);
  }

  reset(epochDays = toEpochDays(Date.now())) {
    this.days = Math.min(MAX_DAY, Math.max(MIN_DAY, epochDays));
    this.elapsedSeconds = 0;
    this.solarSeconds = 0;
    this.updateBodies();
  }

  tick(deltaSeconds) {
    // Ignore time spent backgrounded; a tab resume must not launch the planets.
    const dt = Math.min(.05, Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0));
    this.deltaSeconds = dt;
    this.elapsedSeconds += dt;
    if (!this.paused) {
      // An illustrative activity clock: normal playback is real time, reverse
      // reverses activity, and high orbital speeds cap activity at eightfold.
      this.solarSeconds += dt*Math.max(-8,Math.min(8,this.speed*24));
      this.days = Math.min(MAX_DAY, Math.max(MIN_DAY, this.days + dt * this.speed));
      if (this.days === MIN_DAY || this.days === MAX_DAY) this.paused = true;
    }
    if (this.days!==this.bodyDays) this.updateBodies();
  }

  updateBodies() {
    this.bodyDays = this.days;
    const out = this.data;
    const centuries = this.days / 36525;
    for (let i = 0; i < BODIES.length; i++) {
      const body = BODIES[i];
      const o = i * BODY_FLOATS;
      out[o + 3] = body.radius;
      out[o + 4] = ((this.days / body.day) % 1) * TAU;
      out[o + 5] = body.tilt * DEG;
      out[o + 6] = i;
      out[o + 7] = i === 0 ? 1 : 0;
      out[o + 8] = body.atmo[0]; out[o + 9] = body.atmo[1];
      out[o + 10] = body.atmo[2]; out[o + 11] = body.atmo[3];
      if (i === 0) continue;
      let eccentricity, inclination, node, argument, meanAnomaly;
      if (i === 9) {
        eccentricity = .0549; inclination = 5.145 * DEG;
        node = 125.08 * DEG; argument = 318.15 * DEG;
        meanAnomaly = (115.3654 + this.days * 360 / 27.3217) * DEG;
        const earth = 3 * BODY_FLOATS;
        out[o + 20] = out[earth]; out[o + 21] = out[earth + 1]; out[o + 22] = out[earth + 2];
      } else {
        const el = ELEMENTS[i];
        eccentricity = el[1] + el[7] * centuries;
        inclination = (el[2] + el[8] * centuries) * DEG;
        node = (el[5] + el[11] * centuries) * DEG;
        argument = (el[4] + el[10] * centuries) * DEG - node;
        meanAnomaly = ((el[3] - el[4]) + (el[9] - el[10]) * centuries) * DEG;
      }
      const cw = Math.cos(argument), sw = Math.sin(argument);
      const cn = Math.cos(node), sn = Math.sin(node);
      const ci = Math.cos(inclination), si = Math.sin(inclination);
      // Ecliptic Z becomes world Y, and ecliptic Y becomes world -Z.
      out[o + 12] = cw * cn - sw * sn * ci;
      out[o + 13] = sw * si;
      out[o + 14] = -(cw * sn + sw * cn * ci);
      out[o + 15] = body.orbit;
      out[o + 16] = -sw * cn - cw * sn * ci;
      out[o + 17] = cw * si;
      out[o + 18] = -(-sw * sn + cw * cn * ci);
      out[o + 19] = eccentricity;
      const anomaly = solveKepler(meanAnomaly, eccentricity);
      const x = body.orbit * (Math.cos(anomaly) - eccentricity);
      const y = body.orbit * Math.sqrt(1 - eccentricity * eccentricity) * Math.sin(anomaly);
      out[o] = out[o + 12] * x + out[o + 16] * y + out[o + 20];
      out[o + 1] = out[o + 13] * x + out[o + 17] * y + out[o + 21];
      out[o + 2] = out[o + 14] * x + out[o + 18] * y + out[o + 22];
    }
  }
}
