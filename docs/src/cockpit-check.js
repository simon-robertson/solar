const frame = document.getElementById("fixture"), run = document.getElementById("run"), status = document.getElementById("status"), results = document.getElementById("results");
const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
const percentile = (values,p) => [...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))];
let doc;
document.getElementById("layout").addEventListener("change",event => {
  const [width,height] = event.target.value.split(",").map(Number);
  frame.style.width = `${width}px`; frame.style.height = `${height}px`;
});
document.getElementById("motion").addEventListener("click",event => {
  if (!doc) return;
  const reduced = doc.body.classList.toggle("cockpit-reduced-motion");
  event.target.setAttribute("aria-pressed",String(reduced));
});
async function ready() {
  while (!frame.contentDocument?.getElementById("loading")?.hidden) {
    if (frame.contentDocument?.getElementById("error")?.hidden===false) throw new Error(frame.contentDocument.getElementById("error-text").textContent);
    await nextFrame();
  }
  doc = frame.contentDocument;
  const preferenceKey = "solar.preferences.v1", saved = localStorage.getItem(preferenceKey);
  try {
    // Lowest explicit quality cannot be reduced again by adaptive quality.
    const quality = doc.getElementById("quality"); quality.value = "0.7"; quality.dispatchEvent(new Event("change",{ bubbles: true }));
    if (doc.getElementById("pause").getAttribute("aria-label")==="Pause simulation") doc.getElementById("pause").click();
    if (!doc.getElementById("orbits").checked) doc.getElementById("orbits").click();
    if (!doc.getElementById("bloom").checked) doc.getElementById("bloom").click();
    doc.getElementById("cockpit-toggle").click();
  } finally {
    if (saved===null) localStorage.removeItem(preferenceKey); else localStorage.setItem(preferenceKey,saved);
  }
  status.textContent = "Ready — paused overview, fixed quality"; run.disabled = false;
}
run.addEventListener("click",async () => {
  run.disabled = true; results.textContent = "Collecting four 240-frame samples…";
  document.getElementById("layout").disabled = document.getElementById("motion").disabled = true;
  document.getElementById("travel").disabled = true;
  frame.style.pointerEvents = "none";
  const samples = [], cpu = [], longFrames = [];
  const moving = document.getElementById("travel").checked;
  const flightKey = pressed => doc.body.dispatchEvent(new KeyboardEvent(pressed?"keydown":"keyup",{ code: "KeyE", key: "e", bubbles: true }));
  let observer;
  try {
    document.getElementById("layout").value = "1280,800";
    frame.style.width = "1280px"; frame.style.height = "800px";
    doc.body.classList.remove("cockpit-reduced-motion");
    document.getElementById("motion").setAttribute("aria-pressed","false");
    for (let i = 0; i<3; i++) await nextFrame();
    if (!doc.getElementById("cockpit").hidden) doc.getElementById("cockpit-toggle").click();
    doc.getElementById("overview").click();
    for (let i = 0; i<120; i++) await nextFrame();
    doc.getElementById("cockpit-toggle").click();
    if (PerformanceObserver.supportedEntryTypes.includes("long-animation-frame")) {
      observer = new PerformanceObserver(list => longFrames.push(...list.getEntries().map(entry=>entry.duration)));
      observer.observe({ type: "long-animation-frame" });
    }
    for (const animated of [false,true,true,false]) {
      // Every moving sample follows the same trajectory from the stored view.
      if (!doc.getElementById("cockpit").hidden) doc.getElementById("cockpit-toggle").click();
      doc.getElementById("cockpit-toggle").click();
      if (moving) flightKey(true);
      doc.body.classList.toggle("cockpit-static",!animated);
      status.textContent = `${animated?"Animated":"Static"} sample ${samples.length+1} / 4`;
      for (let i = 0; i<45; i++) await nextFrame();
      const intervals = [], startLongFrames = longFrames.length; cpu.length = 0;
      let previous = await nextFrame();
      for (let i = 0; i<240; i++) {
        if (document.hidden) throw new Error("Keep the comparison tab visible while sampling.");
        const now = await nextFrame(); intervals.push(now-previous); previous = now;
        if (i%30===0) cpu.push(parseFloat(doc.getElementById("stat-cpu").textContent));
      }
      samples.push({
        animated, frames: intervals.length, medianMs: percentile(intervals,.5), p95Ms: percentile(intervals,.95),
        over25ms: intervals.filter(x=>x>25).length, longFrames: longFrames.length-startLongFrames,
        medianAppCpuMs: percentile(cpu,.5), draws: doc.getElementById("stat-draws").textContent,
        resolution: doc.getElementById("stat-resolution").textContent, gpuErrors: doc.getElementById("stat-errors").textContent,
      });
      flightKey(false);
    }
    results.textContent = JSON.stringify({ viewport: [1280,800], devicePixelRatio, moving, samples },null,2);
    status.textContent = "Completed — four samples";
  } catch (error) { status.textContent = `Failed: ${error.message}`; }
  finally {
    observer?.disconnect(); doc.body.classList.remove("cockpit-static"); run.disabled = false;
    flightKey(false);
    document.getElementById("layout").disabled = document.getElementById("motion").disabled = false;
    document.getElementById("travel").disabled = false;
    frame.style.pointerEvents = "";
  }
});
ready().catch(error => { status.textContent = `Failed: ${error.message}`; });
