import { BODIES, BODY_FLOATS } from "./data.js";

const clamp = (value,low,high) => Math.max(low,Math.min(high,value));
const smooth = (low,high,value) => { const t = clamp((value-low)/Math.max(.00001,high-low),0,1); return t*t*(3-2*t); };

// Representative normals for the illustrated interior facets, in craft space.
// Different inner spar faces catch side light independently; screens emit light.
const MATERIALS = [
  ["roof",[0,-.4,.916]], ["spar-left",[.68,.08,.73]], ["spar-right",[-.68,.08,.73]],
  ["rim",[0,.6,.8]], ["deck",[0,.94,.342]], ["metal",[0,0,1]],
];
const PANEL_NORMALS = [[.5,.2,.843],[0,.2,.98],[-.5,.2,.843]];

// Returns craft-local Sun direction and incident intensity, reusing `out`.
// The compressed display scale uses a gentle artistic distance falloff. Spherical
// blockers soften across the projected solar disc; this is not ring ray tracing.
export function sampleCockpitSun(camera,data,out) {
  const dx = data[0]-camera.eye[0], dy = data[1]-camera.eye[1], dz = data[2]-camera.eye[2];
  const distance = Math.max(.00001,Math.hypot(dx,dy,dz));
  const x = dx/distance, y = dy/distance, z = dz/distance;
  out[0] = x*camera.right[0]+y*camera.right[1]+z*camera.right[2];
  out[1] = x*camera.up[0]+y*camera.up[1]+z*camera.up[2];
  out[2] = x*camera.forward[0]+y*camera.forward[1]+z*camera.forward[2];
  let visibility = 1;
  for (let i = 1; i<BODIES.length; i++) {
    const o = i*BODY_FLOATS, bx = data[o]-camera.eye[0], by = data[o+1]-camera.eye[1], bz = data[o+2]-camera.eye[2];
    const radius = data[o+3];
    if (bx*bx+by*by+bz*bz<radius*radius) { visibility = 0; break; }
    const along = bx*x+by*y+bz*z;
    if (along<=0 || along>=distance) continue;
    const separation = Math.hypot(bx-along*x,by-along*y,bz-along*z);
    const solarFootprint = Math.max(.00001,(data[3] || BODIES[0].radius)*along/distance);
    visibility *= smooth(radius-solarFootprint,radius+solarFootprint,separation);
  }
  // The forward/side glazing admits direct light; the rear cabin shades it.
  const glazing = .15+.85*smooth(-.3,.35,out[2]);
  out[3] = clamp((35/distance)**.35,.4,1.4)*visibility*glazing;
  return out;
}

export function facetLight(normal,sun) {
  const cosine = Math.max(0,(normal[0]*sun[0]+normal[1]*sun[1]+normal[2]*sun[2])/Math.hypot(normal[0],normal[1],normal[2]));
  return .48+2.1*cosine*sun[3];
}

function colour(base,light) {
  // Neutral cabin fill plus warm sunlight; retain the metal's original colour.
  const direct = Math.max(0,light-.48);
  return `rgb(${Math.min(255,Math.round(base[0]*(.48+direct)))},${Math.min(255,Math.round(base[1]*(.48+direct*.95)))},${Math.min(255,Math.round(base[2]*(.48+direct*.86)))})`;
}

export class CockpitLighting {
  constructor(container,panels) {
    this.container = container;
    this.panels = panels;
    this.sun = new Float64Array(4);
    this.previous = new Float64Array(4).fill(Infinity);
    this.materials = [];
  }

  async init() {
    // The canopy is authored alongside the code, unlike immutable map textures.
    // Revalidate it so layout/material edits cannot retain an older cached SVG.
    const response = await fetch(new URL("../assets/cockpit-frame.svg",import.meta.url),{ cache: "no-cache" });
    if (!response.ok) throw new Error("Unable to load spacecraft canopy.");
    const parsed = new DOMParser().parseFromString(await response.text(),"image/svg+xml");
    if (parsed.querySelector("parsererror")) throw new Error("Invalid spacecraft canopy SVG.");
    // This is the project's own local SVG, not third-party or user markup.
    this.container.replaceChildren(document.importNode(parsed.documentElement,true));
    for (const [id,normal] of MATERIALS) {
      const stops = this.container.querySelectorAll(`#${id} stop`);
      if (!stops.length) throw new Error(`Missing cockpit material: ${id}`);
      for (const stop of stops) {
        const hex = stop.getAttribute("stop-color").slice(1);
        const base = [0,2,4].map(offset=>parseInt(hex.slice(offset,offset+2),16));
        this.materials.push({ stop,normal,base,last: "" });
      }
    }
  }

  update(camera,data) {
    sampleCockpitSun(camera,data,this.sun);
    // No repaint while the same light is falling on the stationary cockpit.
    if (this.sun.every((value,i)=>Math.abs(value-this.previous[i])<.003)) return;
    this.previous.set(this.sun);
    for (const material of this.materials) {
      const value = colour(material.base,facetLight(material.normal,this.sun));
      if (value!==material.last) { material.stop.setAttribute("stop-color",value); material.last = value; }
    }
    for (let i = 0; i<this.panels.length; i++) {
      const panel = this.panels[i], light = facetLight(PANEL_NORMALS[i],this.sun);
      panel.style.setProperty("--case-edge",colour([80,81,77],light));
      panel.style.setProperty("--case-face",colour([42,43,40],light));
      panel.style.setProperty("--case-low",colour([17,18,16],light));
      panel.style.setProperty("--case-rim",colour([105,107,99],light));
      panel.style.setProperty("--glass-glint",(Math.max(0,light-.48)*.055).toFixed(3));
      panel.style.setProperty("--glass-angle",`${Math.round(Math.atan2(this.sun[0],this.sun[1])*180/Math.PI)}deg`);
    }
    this.container.dataset.sunDirection = `${this.sun[0].toFixed(3)},${this.sun[1].toFixed(3)},${this.sun[2].toFixed(3)}`;
    this.container.dataset.sunIntensity = this.sun[3].toFixed(3);
  }
}
