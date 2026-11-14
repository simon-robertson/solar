// Four consecutive half-second samples avoid reacting to isolated slow frames.
export class AdaptiveQuality {
  constructor() { this.reset(); }

  reset() {
    this.lastTime = null;
    this.frames = 0; this.millis = 0; this.slowSamples = 0;
  }

  update(now) {
    const elapsed = this.lastTime===null ? 0 : now-this.lastTime;
    this.lastTime = now;
    if (elapsed<=0) return false;
    this.frames++; this.millis += elapsed;
    if (this.millis<500) return false;
    // Match the displayed whole FPS: normal 60 Hz timing jitter is not a drop.
    const fps = Math.round(this.frames*1000/this.millis);
    this.slowSamples = fps<60 ? this.slowSamples+1 : 0;
    this.frames = 0; this.millis = 0;
    if (this.slowSamples<4) return false;
    this.reset();
    return true;
  }
}
