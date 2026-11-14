// Distance is expressed in the parent body's display radii. Independent enter
// and exit thresholds avoid boundary flicker and can serve future detail layers.
export class ProximityLod {
  constructor(enter = 18, exit = 22, fadeSeconds = .25) {
    if (!(enter>0 && exit>enter && fadeSeconds>0)) throw new Error("Invalid proximity LOD thresholds");
    this.enter = enter; this.exit = exit; this.fadeSeconds = fadeSeconds;
    this.active = false; this.opacity = 0; this.initialized = false;
  }
  update(distance, deltaSeconds) {
    if (!Number.isFinite(distance)) distance = Infinity;
    if (this.active ? distance>=this.exit : distance<=this.enter) this.active = !this.active;
    const target = this.active ? 1 : 0;
    if (!this.initialized) { this.opacity = target; this.initialized = true; }
    else {
      const step = Math.max(0,Number.isFinite(deltaSeconds)?deltaSeconds:0)/this.fadeSeconds;
      this.opacity += Math.sign(target-this.opacity)*Math.min(Math.abs(target-this.opacity),step);
    }
    return this.opacity;
  }
}
