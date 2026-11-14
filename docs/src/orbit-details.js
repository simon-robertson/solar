import { BODIES, BODY_FLOATS, DEG, TAU } from "./data.js";
import { solveKepler } from "./simulation.js";
import { ProximityLod } from "./lod.js";

export const SATURN_INDEX = 6;
export const ORBIT_FLOATS = 16; // Four vec4s, 64 bytes; matches Orbit in scene.wgsl.
export const PLANET_ORBITS = BODIES.length-1;
export const RING_NORMAL = Object.freeze([0,.893143,.449786]);
// JPL SAT441 mean elements, J2000 (2000-01-01.5 TDB), local Laplace planes.
// https://ssd.jpl.nasa.gov/sats/elem/sep.html
// a[km], e, argument[deg], mean anomaly[deg], i[deg], node[deg], P[days], pole RA/Dec[deg].
export const SATURN_MOONS = Object.freeze([
  { name: "Mimas",      elements: [186000,.020,160.4,275.3,1.6,66.2,.942422,40.6,83.5] },
  { name: "Enceladus",  elements: [238400,.005,119.5,57.0,0,0,1.370218,40.6,83.5] },
  { name: "Tethys",     elements: [295000,.001,335.3,0,1.1,273.0,1.887802,40.6,83.5] },
  { name: "Dione",      elements: [377700,.002,116.0,212.0,0,0,2.736916,40.6,83.5] },
  { name: "Rhea",       elements: [527200,.001,44.3,31.5,.3,133.7,4.517503,40.6,83.5] },
  { name: "Titan",      elements: [1221900,.029,78.3,11.7,.3,78.6,15.945448,36.4,84.0] },
  { name: "Iapetus",    elements: [3561700,.028,254.5,74.8,7.6,86.5,79.331002,288.7,78.9] },
]);
export const ORBIT_COUNT = PLANET_ORBITS+SATURN_MOONS.length;
export const ORBIT_SEGMENTS = 1024;
export const compressedMoonRadius = km => BODIES[SATURN_INDEX].radius*(2.65+2.35*Math.log(km/150000));

const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const normalize = vector => { const length = Math.hypot(...vector); return vector.map(x => x/length); };
const equatorialToWorld = vector => {
  const c = Math.cos(23.4392911*DEG), s = Math.sin(23.4392911*DEG);
  return [vector[0],-s*vector[1]+c*vector[2],-c*vector[1]-s*vector[2]];
};
function pole(ra,dec) { return [Math.cos(ra)*Math.cos(dec),Math.sin(ra)*Math.cos(dec),Math.sin(dec)]; }
const sourcePole = equatorialToWorld(pole(40.6*DEG,83.5*DEG));
const targetPole = normalize(RING_NORMAL), rotationAxis = cross(sourcePole,targetPole), rotationCosine = dot(sourcePole,targetPole);
function alignWithDisplayRing(vector) {
  const v = equatorialToWorld(vector), once = cross(rotationAxis,v), twice = cross(rotationAxis,once);
  return v.map((x,i) => x+once[i]+twice[i]/(1+rotationCosine));
}
function moonAxes(elements) {
  const [, , argument, , inclination, node, , ra, dec] = elements;
  const h = pole(ra*DEG,dec*DEG), x = [-Math.sin(ra*DEG),Math.cos(ra*DEG),0], y = cross(h,x);
  const cw = Math.cos(argument*DEG), sw = Math.sin(argument*DEG), cn = Math.cos(node*DEG), sn = Math.sin(node*DEG), ci = Math.cos(inclination*DEG), si = Math.sin(inclination*DEG);
  const a = x.map((v,i) => v*(cn*cw-sn*sw*ci)+y[i]*(sn*cw+cn*sw*ci)+h[i]*sw*si);
  const b = x.map((v,i) => v*(-cn*sw-sn*cw*ci)+y[i]*(-sn*sw+cn*cw*ci)+h[i]*cw*si);
  return [...alignWithDisplayRing(a),...alignWithDisplayRing(b)];
}

export class OrbitDetails {
  constructor() {
    this.data = new Float32Array(ORBIT_COUNT*ORBIT_FLOATS);
    this.positions = new Float64Array(SATURN_MOONS.length*3);
    this.relativePositions = new Float64Array(SATURN_MOONS.length*3);
    this.moonDays = NaN;
    this.axes = SATURN_MOONS.map(moon => new Float64Array(moonAxes(moon.elements)));
    this.radii = new Float64Array(SATURN_MOONS.map(moon => compressedMoonRadius(moon.elements[0])));
    this.saturnLod = new ProximityLod();
    for (let i = 0; i < SATURN_MOONS.length; i++) {
      const o = (PLANET_ORBITS+i)*ORBIT_FLOATS, axes = this.axes[i];
      this.data.set(axes.subarray(0,3),o); this.data.set(axes.subarray(3),o+4);
      this.data[o+3] = this.radii[i]; this.data[o+7] = SATURN_MOONS[i].elements[1];
      this.data[o+15] = -1;
    }
  }
  update(simulation,camera,aspect = 1) {
    const bodies = simulation.data, out = this.data;
    const direction = simulation.speed<0 ? -1 : 1;
    for (let i = 1; i < BODIES.length; i++) {
      const body = i*BODY_FLOATS, o = (i-1)*ORBIT_FLOATS;
      for (let j = 0; j < 8; j++) out[o+j] = bodies[body+12+j];
      out[o+8] = bodies[body+20]; out[o+9] = bodies[body+21]; out[o+10] = bodies[body+22]; out[o+11] = 1;
      const dx = bodies[body]-out[o+8], dy = bodies[body+1]-out[o+9], dz = bodies[body+2]-out[o+10];
      const a = out[o+3], e = out[o+7], b = a*Math.sqrt(1-e*e);
      out[o+12] = Math.atan2((dx*out[o+4]+dy*out[o+5]+dz*out[o+6])/b,(dx*out[o]+dy*out[o+1]+dz*out[o+2])/a+e);
      out[o+13] = direction; out[o+14] = 0; out[o+15] = i;
    }
    const parent = SATURN_INDEX*BODY_FLOATS, radius = BODIES[SATURN_INDEX].radius;
    const dx = bodies[parent]-camera.eye[0], dy = bodies[parent+1]-camera.eye[1], dz = bodies[parent+2]-camera.eye[2];
    const distance = Math.hypot(dx,dy,dz)/radius;
    // Compressed planetary distances can put an Earth close-up inside Saturn's
    // distance threshold, even with Saturn behind the camera. Require the parent
    // in view too; retain a wider exit margin to avoid edge chatter while panning.
    const depth = dx*camera.forward[0]+dy*camera.forward[1]+dz*camera.forward[2];
    const limit = this.saturnLod.active ? 1.2 : 1.05;
    const inView = depth>0 &&
      Math.abs((dx*camera.right[0]+dy*camera.right[1]+dz*camera.right[2])/(depth*camera.tanFov*aspect))<limit &&
      Math.abs((dx*camera.up[0]+dy*camera.up[1]+dz*camera.up[2])/(depth*camera.tanFov))<limit;
    const opacity = this.saturnLod.update(inView ? distance : Infinity,simulation.deltaSeconds);
    // Local detail must never change the visibility of unrelated planet paths.
    const advance = simulation.days!==this.moonDays;
    for (let i = 0; i < SATURN_MOONS.length; i++) {
      const o = (PLANET_ORBITS+i)*ORBIT_FLOATS;
      out[o+11] = opacity;
      if (opacity===0) continue; // No moon Kepler work while this detail layer is absent.
      if (advance) {
        const elements = SATURN_MOONS[i].elements, e = elements[1], axes = this.axes[i];
        const a = this.radii[i], anomaly = solveKepler((elements[3]/360+(simulation.days%elements[6])/elements[6])*TAU,e);
        const x = a*(Math.cos(anomaly)-e), y = a*Math.sqrt(1-e*e)*Math.sin(anomaly);
        for (let j = 0; j < 3; j++) this.relativePositions[i*3+j] = axes[j]*x+axes[j+3]*y;
        out[o+12] = anomaly;
      }
      for (let j = 0; j < 3; j++) {
        out[o+8+j] = bodies[parent+j];
        this.positions[i*3+j] = bodies[parent+j]+this.relativePositions[i*3+j];
      }
      out[o+13] = direction; out[o+14] = 1;
    }
    if (opacity>0) this.moonDays = simulation.days;
  }
}

// Annotation visibility is evaluated against the existing opaque body catalogue.
// Rings conservatively hide names behind the annulus; GPU circles use ring alpha.
export function satelliteVisibility(camera,bodies,x,y,z) {
  const dx = x-camera.eye[0], dy = y-camera.eye[1], dz = z-camera.eye[2];
  const distance = Math.hypot(dx,dy,dz), rx = dx/distance, ry = dy/distance, rz = dz/distance;
  for (let i = 0; i < BODIES.length; i++) {
    const o = i*BODY_FLOATS, ox = bodies[o]-camera.eye[0], oy = bodies[o+1]-camera.eye[1], oz = bodies[o+2]-camera.eye[2];
    const t = ox*rx+oy*ry+oz*rz;
    if (t>0 && t<distance && ox*ox+oy*oy+oz*oz-t*t<bodies[o+3]*bodies[o+3]) return 0;
  }
  const o = SATURN_INDEX*BODY_FLOATS;
  const denominator = rx*RING_NORMAL[0]+ry*RING_NORMAL[1]+rz*RING_NORMAL[2];
  if (Math.abs(denominator)>.00001) {
    const t = ((bodies[o]-camera.eye[0])*RING_NORMAL[0]+(bodies[o+1]-camera.eye[1])*RING_NORMAL[1]+(bodies[o+2]-camera.eye[2])*RING_NORMAL[2])/denominator;
    if (t>0 && t<distance) {
      const r = Math.hypot(camera.eye[0]+rx*t-bodies[o],camera.eye[1]+ry*t-bodies[o+1],camera.eye[2]+rz*t-bodies[o+2])/bodies[o+3];
      if (r>1.23 && r<2.32) return 0;
    }
  }
  return 1;
}
