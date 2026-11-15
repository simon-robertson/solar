export class SceneGestures {
  constructor(canvas,camera,onMove,onPick) {
    this.canvas = canvas;
    this.pointers = new Map();
    this.moved = 0; this.pinchDistance = 0;

    canvas.addEventListener("pointerdown",event => {
      if (event.button!==0 || this.pointers.size>=2 || this.pointers.has(event.pointerId)) return;
      if (!this.pointers.size) this.moved = 0;
      this.pointers.set(event.pointerId,{ x: event.clientX, y: event.clientY });
      canvas.setPointerCapture(event.pointerId);
      if (this.pointers.size===2) {
        // Neither finger may become a tap when a pinch finishes.
        this.moved = Infinity;
        this.pinchDistance = this.distance();
        onMove();
      }
    });

    canvas.addEventListener("pointermove",event => {
      const pointer = this.pointers.get(event.pointerId);
      if (!pointer) return;
      const dx = event.clientX-pointer.x, dy = event.clientY-pointer.y;
      pointer.x = event.clientX; pointer.y = event.clientY;
      if (this.pointers.size===2) {
        const distance = this.distance();
        if (this.pinchDistance>0 && distance>0) {
          // Camera.zoom uses an exponential wheel delta. This makes camera
          // distance inversely proportional to the fingers' separation.
          camera.zoom(1000*Math.log(this.pinchDistance/distance));
        }
        this.pinchDistance = distance;
        onMove();
      } else {
        this.moved += Math.abs(dx)+Math.abs(dy);
        if (this.moved>4) { onMove(); camera.orbit(dx,dy); }
      }
    });

    const end = (event,allowPick) => {
      if (!this.pointers.has(event.pointerId)) return;
      const tap = allowPick && this.pointers.size===1 && this.moved<=4;
      this.pointers.delete(event.pointerId);
      this.pinchDistance = 0;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      if (tap) onPick(event.clientX,event.clientY);
    };
    canvas.addEventListener("pointerup",event => end(event,true));
    canvas.addEventListener("pointercancel",event => end(event,false));
    canvas.addEventListener("lostpointercapture",event => end(event,false));
  }

  get dragging() { return this.pointers.size>0 && this.moved>4; }

  cancel() {
    const ids = Array.from(this.pointers.keys());
    this.pointers.clear(); this.moved = 0; this.pinchDistance = 0;
    for (const id of ids) if (this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id);
  }

  distance() {
    const [a,b] = this.pointers.values();
    return Math.hypot(a.x-b.x,a.y-b.y);
  }
}
