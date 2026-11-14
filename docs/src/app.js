import { BODIES, BODY_FLOATS } from "./data.js";
import { Simulation, MIN_DAY, MAX_DAY } from "./simulation.js";
import { Camera } from "./camera.js";
import { Renderer } from "./renderer.js";
import { SATURN_MOONS, PLANET_ORBITS, ORBIT_FLOATS, satelliteVisibility } from "./orbit-details.js";
import { AdaptiveQuality } from "./adaptive-quality.js";
import { SceneGestures } from "./scene-gestures.js";

const $ = id => document.getElementById(id);
const canvas = $("universe");
const simulation = new Simulation();
const camera = new Camera();
const renderer = new Renderer(canvas,fail);
const adaptiveQuality = new AdaptiveQuality();
renderer.prepareAnnotations = prepareSatelliteMarkers;
const date = new Date();
const dateFormat = new Intl.DateTimeFormat("en-GB",{ day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const numbers = new Intl.NumberFormat("en-GB",{ maximumFractionDigits: 0 });
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
if (reducedMotion) simulation.paused = true;

let selected = -1, running = false, animation = 0, lastTime = 0, lastUI = 0, lastLabels = 0;
let frames = 0, frameMillis = 0, cpuMillis = 0, validationErrors = 0;
let width = window.innerWidth, height = window.innerHeight, showLabels = true;
let compactScene = false;
let labelsSuppressed = true, labelsQuietSince = 0, labelsFadeStarted = 0, satelliteNamesActive = false;
const buttons = [], labels = [], satelliteLabels = [];
const labelBounds = new Float32Array((BODIES.length+SATURN_MOONS.length)*4);
const annotationPanels = [".header",".intro",".view-controls",".bottom-deck","#settings"].map(selector => document.querySelector(selector));
const annotationBounds = new Float32Array(annotationPanels.length*4);
const nav = $("planet-nav");
const labelsContainer = $("labels");
const informationPanel = $("information-panel"), infoToggle = $("info-toggle");
const loadScreen = $("loading");
const loadingText = $("loading-text");
const pauseIcon = $("pause-icon"), playIcon = $("play-icon"), pauseButton = $("pause");
const timeState = $("time-state"), dateText = $("date");
const stats = { fps: $("stat-fps"), frame: $("stat-frame"), cpu: $("stat-cpu"), draws: $("stat-draws"), compute: $("stat-compute"), resolution: $("stat-resolution"), textures: $("stat-textures"), delta: $("stat-delta"), resources: $("stat-resources"), errors: $("stat-errors") };
const info = { kind: $("body-kind"), name: $("body-name"), label1: $("fact-one-label"), value1: $("fact-one"), label2: $("fact-two-label"), value2: $("fact-two") };
const preferencesKey = "solar.preferences.v1";
const preferences = {
  speed: $("speed").value, reverse: false,
  orbits: renderer.orbits, labels: showLabels, atmospheres: renderer.atmospheres,
  bloom: renderer.bloom, quality: $("quality").value, exposure: renderer.exposure,
};

function restorePreferences() {
  // Apply the default even when storage is empty, malformed or unavailable.
  renderer.scale = Number(preferences.quality);
  let saved;
  try { saved = JSON.parse(localStorage.getItem(preferencesKey)); }
  catch { return; } // Storage can be disabled or contain malformed JSON.
  if (!saved || typeof saved!=="object" || Array.isArray(saved)) return;
  for (const key of ["reverse","orbits","labels","atmospheres","bloom"]) {
    if (typeof saved[key]==="boolean") preferences[key] = saved[key];
  }
  for (const key of ["speed","quality"]) {
    for (const option of $(key).options) {
      if (option.value===saved[key]) { preferences[key] = saved[key]; break; }
    }
  }
  const exposure = $("exposure");
  if (Number.isFinite(saved.exposure) && saved.exposure>=Number(exposure.min) && saved.exposure<=Number(exposure.max)) {
    preferences.exposure = saved.exposure;
  }
  $("speed").value = preferences.speed;
  simulation.speed = Number(preferences.speed)*(preferences.reverse?-1:1);
  $("reverse").setAttribute("aria-pressed",String(preferences.reverse));
  renderer.orbits = $("orbits").checked = preferences.orbits;
  renderer.bloom = $("bloom").checked = preferences.bloom;
  renderer.atmospheres = $("atmospheres").checked = preferences.atmospheres;
  showLabels = $("labels-toggle").checked = preferences.labels;
  labelsContainer.hidden = !showLabels;
  $("quality").value = preferences.quality;
  renderer.scale = Number(preferences.quality);
  exposure.value = preferences.exposure;
  renderer.exposure = Number(exposure.value);
}

function savePreferences() {
  preferences.speed = $("speed").value;
  preferences.reverse = simulation.speed<0;
  preferences.orbits = renderer.orbits;
  preferences.labels = showLabels;
  preferences.atmospheres = renderer.atmospheres;
  preferences.bloom = renderer.bloom;
  preferences.quality = $("quality").value;
  preferences.exposure = renderer.exposure;
  // Write only when a setting changes, including an automatic quality step.
  try { localStorage.setItem(preferencesKey,JSON.stringify(preferences)); }
  catch { /* Continue normally when browser storage is unavailable or full. */ }
}

function applyQuality() {
  renderer.scale = Number($("quality").value);
  renderer.resize();
  adaptiveQuality.reset();
  savePreferences();
}

for (let i = 0; i < BODIES.length; i++) {
  const body = BODIES[i];
  const button = document.createElement("button");
  button.className = "planet-button";
  button.dataset.index = i;
  button.style.setProperty("--planet",body.color);
  button.setAttribute("aria-label",`Explore ${body.name}`);
  button.setAttribute("aria-pressed","false");
  // All markup comes from the static local body catalogue, never external input.
  const textureURL = new URL(`../assets/textures/${body.texture}`,import.meta.url).href;
  button.innerHTML = `<span class="planet-caption"><strong>${body.name}</strong></span><span class="planet-thumb" style="background-image:url('${textureURL}')" aria-hidden="true"></span>`;
  button.addEventListener("click",() => selectBody(i));
  nav.append(button); buttons.push(button);
  const label = document.createElement("span");
  label.className = "planet-label"; label.textContent = body.name.toUpperCase();
  label.style.setProperty("--planet",body.color);
  labelsContainer.append(label); labels.push(label);
}

for (const moon of SATURN_MOONS) {
  const label = document.createElement("span");
  label.className = "satellite-label"; label.textContent = moon.name; label.hidden = true;
  label.dataset.moon = moon.name;
  labelsContainer.append(label); satelliteLabels.push(label);
}

function selectBody(index) {
  hideMovingLabels();
  selected = index;
  document.body.dataset.view = "body";
  camera.focus(index,simulation.data);
  if (reducedMotion) camera.snap = true;
  const body = BODIES[index];
  for (let i = 0; i < buttons.length; i++) {
    buttons[i].classList.toggle("active",i===index);
    buttons[i].setAttribute("aria-pressed",String(i===index));
    labels[i].classList.toggle("selected",i===index);
  }
  info.kind.textContent = body.kind;
  info.name.textContent = body.name;
  info.label1.textContent = "MEAN RADIUS";
  info.value1.innerHTML = `${numbers.format(body.km)} <small>km</small>`;
  info.label2.textContent = index===0 ? "ROTATION PERIOD" : "ORBITAL PERIOD";
  const period = index===0 ? body.day : body.period;
  info.value2.innerHTML = period > 1000 ? `${(period/365.25).toFixed(1)} <small>years</small>` : `${period.toFixed(period < 100 ? 1 : 0)} <small>days</small>`;
  setViewButtons(true);
  refreshAnnotationBounds();
}

function overview() {
  hideMovingLabels();
  camera.overview();
  if (reducedMotion) camera.snap = true;
  setViewButtons(false);
  document.body.dataset.view = "system";
  info.kind.textContent = "SYSTEM OVERVIEW";
  info.name.textContent = "Solar system";
  info.label1.textContent = "PLANETS";
  info.value1.textContent = "08";
  info.label2.textContent = "SYSTEM AGE";
  info.value2.innerHTML = "4.6 <small>billion yr</small>";
  refreshAnnotationBounds();
}

function setViewButtons(focused) {
  $("overview").classList.toggle("active",!focused);
  $("overview").setAttribute("aria-pressed",String(!focused));
  $("planet-view").classList.toggle("active",focused);
  $("planet-view").setAttribute("aria-pressed",String(focused));
  $("planet-view").disabled = selected<0;
}

function updatePause() {
  pauseIcon.toggleAttribute("hidden",simulation.paused); playIcon.toggleAttribute("hidden",!simulation.paused);
  pauseButton.setAttribute("aria-label",simulation.paused ? "Resume simulation" : "Pause simulation");
  const limit = simulation.days===MIN_DAY || simulation.days===MAX_DAY;
  timeState.innerHTML = `<i></i> ${limit ? "MODEL LIMIT" : simulation.paused ? "PAUSED" : simulation.speed<0 ? "REVERSING" : "SIMULATING"}`;
}

function togglePause() { simulation.paused = !simulation.paused; updatePause(); }
function reset() { hideMovingLabels(); simulation.reset(); updatePause(); lastUI = 0; }
function setSettings(open) {
  $("settings").hidden = !open;
  refreshAnnotationBounds();
  $("settings-open").setAttribute("aria-expanded",String(open));
  if (open) $("settings-close").focus();
  else if ($("settings").contains(document.activeElement)) $("settings-open").focus();
}

function toggleInformation() {
  const show = informationPanel.hidden;
  // Do not leave focus inside a panel that has just been removed from view.
  if (!show && informationPanel.contains(document.activeElement)) document.activeElement.blur();
  informationPanel.hidden = !show;
  document.body.classList.toggle("info-hidden",!show);
  infoToggle.setAttribute("aria-expanded",String(show));
  const action = `${show ? "Hide" : "Show"} information panel`;
  infoToggle.setAttribute("aria-label",action);
  infoToggle.title = `${action} (Tab)`;
  hideMovingLabels();
  resizeScene();
}

$("overview").addEventListener("click",overview);
$("planet-view").addEventListener("click",() => { if (selected>=0) selectBody(selected); });
pauseButton.addEventListener("click",togglePause);
$("reset").addEventListener("click",reset);
$("reverse").addEventListener("click",() => {
  simulation.speed = -simulation.speed;
  $("reverse").setAttribute("aria-pressed",String(simulation.speed<0));
  updatePause();
  savePreferences();
});
$("speed").addEventListener("change",event => { simulation.speed = Number(event.target.value) * (simulation.speed<0?-1:1); savePreferences(); });
$("settings-open").addEventListener("click",() => setSettings($("settings").hidden));
$("settings-close").addEventListener("click",() => setSettings(false));
infoToggle.addEventListener("click",toggleInformation);
document.querySelector(".diagnostics").addEventListener("toggle",refreshAnnotationBounds);
$("about-open").addEventListener("click",() => $("about").showModal());
$("about-close").addEventListener("click",() => $("about").close());
$("about").addEventListener("click",event => { if (event.target===$("about")) { const rect = event.target.getBoundingClientRect(); if (event.clientX<rect.left || event.clientX>rect.right || event.clientY<rect.top || event.clientY>rect.bottom) event.target.close(); } });
$("orbits").addEventListener("change",event => { renderer.orbits = event.target.checked; savePreferences(); });
$("bloom").addEventListener("change",event => { renderer.bloom = event.target.checked; savePreferences(); });
$("atmospheres").addEventListener("change",event => { renderer.atmospheres = event.target.checked; savePreferences(); });
$("labels-toggle").addEventListener("change",event => { showLabels = event.target.checked; labelsContainer.hidden = !showLabels; savePreferences(); });
$("quality").addEventListener("change",applyQuality);
$("exposure").addEventListener("input",event => { renderer.exposure = Number(event.target.value); });
$("exposure").addEventListener("change",savePreferences);
$("reload").addEventListener("click",() => location.reload());
$("fullscreen").hidden = !document.fullscreenEnabled;
$("fullscreen").addEventListener("click",async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
  catch { /* The host browser can decline fullscreen without affecting rendering. */ }
});
document.addEventListener("fullscreenchange",() => $("fullscreen").setAttribute("aria-label",document.fullscreenElement?"Exit fullscreen":"Enter fullscreen"));

document.addEventListener("keydown",event => {
  if (event.key==="Tab" && !event.ctrlKey && !event.altKey && !event.metaKey) {
    event.preventDefault();
    if (!event.repeat) toggleInformation();
    return;
  }
  if ($("about").open) return;
  if (event.code==="Escape") { setSettings(false); overview(); return; }
  if (/INPUT|SELECT|TEXTAREA/.test(event.target.tagName) || event.target.isContentEditable) return;
  if (event.code==="Space" && !event.target.closest("button,a,summary")) { event.preventDefault(); togglePause(); }
  else if (event.code==="KeyR") reset();
});

const sceneGestures = new SceneGestures(canvas,camera,hideMovingLabels,pick);
if (window.matchMedia("(pointer: coarse)").matches) $("zoom-gesture").textContent = "PINCH TO ZOOM";
canvas.addEventListener("wheel",event => {
  event.preventDefault();
  hideMovingLabels();
  camera.zoom(Math.max(-200,Math.min(200,event.deltaY)));
},{ passive: false });
canvas.addEventListener("dblclick",overview);

function pick(x,y) {
  const bounds = canvas.getBoundingClientRect();
  x -= bounds.left; y -= bounds.top;
  let closest = -1, bestScore = Infinity;
  for (let i = 0; i < BODIES.length; i++) {
    const o = i*BODY_FLOATS;
    const p = camera.project(simulation.data[o],simulation.data[o+1],simulation.data[o+2],width,height);
    if (p[2]<=0) continue;
    const radius = Math.max(13,BODIES[i].radius/p[2]/camera.tanFov*height*.5);
    const distance = Math.hypot(x-p[0],y-p[1]);
    const score = distance/radius;
    if (score<1 && score<bestScore) { bestScore = score; closest = i; }
  }
  if (closest>=0) selectBody(closest);
}

function hideMovingLabels() {
  labelsQuietSince = 0;
  renderer.markerOpacity = 0;
  if (labelsSuppressed) return;
  labelsSuppressed = true;
  labelsContainer.classList.add("camera-moving");
}

function updateLabelVisibility(now) {
  if (camera.moving || sceneGestures.dragging) { hideMovingLabels(); return; }
  if (!labelsSuppressed) return;
  if (!labelsQuietSince) labelsQuietSince = now;
  if (now-labelsQuietSince<160) return;
  // Position every label before revealing the group, including after retargeting.
  updateLabels(); lastLabels = now;
  labelsSuppressed = false; labelsFadeStarted = now;
  labelsContainer.classList.remove("camera-moving");
}

function updateLabels() {
  if (!showLabels) return;
  const data = simulation.data;
  for (let i = 0; i < labels.length; i++) {
    const box = i*4;
    labelBounds[box] = Infinity;
    const o = i*BODY_FLOATS;
    const x = data[o], y = data[o+1], z = data[o+2];
    const p = camera.project(x,y,z,width,height);
    const depth = p[2];
    const radius = BODIES[i].radius / depth / camera.tanFov * height*.5;
    let visible = depth>0 && p[0]>15 && p[0]<width-90 && p[1]>(compactScene?12:112) && p[1]<height-(compactScene?12:210) && radius<height*.36;
    const lx = Math.round(p[0]+radius+9), ly = Math.round(p[1]-4);
    const labelWidth = BODIES[i].name.length*7+24;
    if (!informationPanel.hidden && !compactScene && lx < (width<850?235:340) && ly<height-210) visible = false;
    // Reuse a fixed bounds buffer to prevent labels from overlapping each other.
    if (visible) {
      for (let j = 0; j < i; j++) {
        const previous = j*4;
        if (lx<labelBounds[previous+2] && lx+labelWidth>labelBounds[previous] &&
            ly<labelBounds[previous+3] && ly+15>labelBounds[previous+1]) { visible = false; break; }
      }
    }
    // Suppress a label when another sphere actually occludes that body's centre.
    if (visible) {
      const dx = x-camera.eye[0],dy = y-camera.eye[1],dz = z-camera.eye[2];
      const length = Math.hypot(dx,dy,dz), rx = dx/length,ry = dy/length,rz = dz/length;
      for (let j = 0; j < BODIES.length; j++) {
        if (j===i) continue;
        const k = j*BODY_FLOATS;
        const ox = data[k]-camera.eye[0],oy = data[k+1]-camera.eye[1],oz = data[k+2]-camera.eye[2];
        const t = ox*rx+oy*ry+oz*rz;
        if (t<=0 || t>=length) continue;
        const d2 = ox*ox+oy*oy+oz*oz-t*t;
        if (d2<BODIES[j].radius*BODIES[j].radius) { visible = false; break; }
      }
    }
    labels[i].hidden = !visible;
    if (visible) {
      labelBounds[box] = lx; labelBounds[box+1] = ly;
      labelBounds[box+2] = lx+labelWidth; labelBounds[box+3] = ly+15;
      labels[i].style.transform = `translate(${lx}px,${ly}px)`;
    } else { labelBounds[box+2] = -Infinity; }
  }
}

function refreshAnnotationBounds() {
  const canvasRect = canvas.getBoundingClientRect();
  compactScene = canvasRect.top>0;
  for (let i = 0; i < annotationPanels.length; i++) {
    if (annotationPanels[i].hidden) {
      annotationBounds.set([Infinity,Infinity,-Infinity,-Infinity],i*4);
      continue;
    }
    const rect = annotationPanels[i].getBoundingClientRect(), o = i*4;
    annotationBounds[o] = rect.left-canvasRect.left-15;
    annotationBounds[o+1] = rect.top-canvasRect.top-15;
    annotationBounds[o+2] = rect.right-canvasRect.left+15;
    annotationBounds[o+3] = rect.bottom-canvasRect.top+15;
  }
}

function annotationAreaClear(left,top,right,bottom) {
  for (let i = 0; i < annotationBounds.length; i += 4) {
    if (left<annotationBounds[i+2] && right>annotationBounds[i] && top<annotationBounds[i+3] && bottom>annotationBounds[i+1]) return false;
  }
  return true;
}

function prepareSatelliteMarkers(detail) {
  if (detail.saturnLod.opacity<=0) return;
  for (let i = 0; i < SATURN_MOONS.length; i++) {
    const p = camera.project(detail.positions[i*3],detail.positions[i*3+1],detail.positions[i*3+2],width,height);
    const clear = p[2]>0 && p[0]>15 && p[0]<width-15 && p[1]>15 && p[1]<height-15 && annotationAreaClear(p[0],p[1],p[0],p[1]);
    detail.data[(PLANET_ORBITS+i)*ORBIT_FLOATS+14] = clear ? 1 : 0;
  }
}

function updateSatelliteLabels() {
  const detail = renderer.orbitDetails, opacity = detail.saturnLod.opacity;
  if (!showLabels || opacity<=0) {
    if (satelliteNamesActive) for (const label of satelliteLabels) label.hidden = true;
    satelliteNamesActive = false;
    return;
  }
  satelliteNamesActive = true;
  for (let i = 0; i < satelliteLabels.length; i++) {
    const label = satelliteLabels[i], box = (BODIES.length+i)*4;
    labelBounds[box] = Infinity;
    const x = detail.positions[i*3], y = detail.positions[i*3+1], z = detail.positions[i*3+2];
    const p = camera.project(x,y,z,width,height);
    let visible = detail.data[(PLANET_ORBITS+i)*ORBIT_FLOATS+14]>.5;
    if (visible) visible = satelliteVisibility(camera,simulation.data,x,y,z)>0;
    const labelWidth = SATURN_MOONS[i].name.length*6.8, labelHeight = 15;
    let lx = p[0]+19, ly = p[1]-7;
    let placed = false;
    for (let attempt = 0; visible && attempt<4; attempt++) {
      lx = attempt%2===0 ? p[0]+19 : p[0]-19-labelWidth;
      ly = attempt<2 ? p[1]-7 : p[1]+15;
      if (lx<12 || lx+labelWidth>width-12 || ly<(compactScene?4:98) || ly+labelHeight>height-(compactScene?4:195)) continue;
      if (!annotationAreaClear(lx,ly,lx+labelWidth,ly+labelHeight)) continue;
      let clear = true;
      for (let j = 0; j < BODIES.length+i; j++) {
        const previous = j*4;
        if (lx<labelBounds[previous+2]+8 && lx+labelWidth>labelBounds[previous]-8 && ly<labelBounds[previous+3]+6 && ly+labelHeight>labelBounds[previous+1]-6) { clear = false; break; }
      }
      if (clear) { placed = true; break; }
    }
    visible &&= placed;
    label.hidden = !visible;
    if (visible) {
      labelBounds[box] = lx; labelBounds[box+1] = ly;
      labelBounds[box+2] = lx+labelWidth; labelBounds[box+3] = ly+labelHeight;
      label.style.transform = `translate(${Math.round(lx)}px,${Math.round(ly)}px)`;
      label.style.opacity = opacity;
    }
  }
}

function frame(now) {
  animation = 0;
  if (!running || document.hidden) return;
  const start = performance.now();
  const rawDelta = lastTime ? (now-lastTime)/1000 : 0;
  lastTime = now;
  const dt = Math.min(.05,Math.max(0,rawDelta));
  simulation.tick(dt);
  camera.update(dt,simulation.data);
  updateLabelVisibility(now);
  const fade = Math.min(1,Math.max(0,(now-labelsFadeStarted)/350));
  renderer.markerOpacity = labelsSuppressed ? 0 : reducedMotion ? 1 : 1-Math.pow(1-fade,3);
  renderer.render(camera,simulation,selected);
  if ($("quality").selectedIndex>0 && adaptiveQuality.update(now)) {
    $("quality").selectedIndex--;
    applyQuality();
  }
  if (!labelsSuppressed && now-lastLabels>65) { updateLabels(); lastLabels = now; }
  if (!labelsSuppressed) updateSatelliteLabels();
  frames++;
  if (rawDelta>0) frameMillis += rawDelta*1000;
  cpuMillis += performance.now()-start;
  if (now-lastUI>500) {
    stats.fps.textContent = `${Math.round(frames/Math.max(frameMillis/1000,.001))} fps`;
    stats.frame.textContent = `${(frameMillis/Math.max(frames,1)).toFixed(1)} ms`;
    stats.cpu.textContent = `${(cpuMillis/Math.max(frames,1)).toFixed(2)} ms`;
    stats.compute.textContent = renderer.computePasses;
    stats.draws.textContent = renderer.drawCalls;
    stats.resolution.textContent = `${renderer.width} × ${renderer.height}`;
    stats.delta.textContent = dt.toFixed(4);
    stats.resources.textContent = renderer.resourceGeneration;
    stats.errors.textContent = validationErrors;
    date.setTime(Date.UTC(2000,0,1,12)+simulation.days*86400000);
    dateText.textContent = dateFormat.format(date).toUpperCase();
    dateText.dateTime = date.toISOString();
    const atLimit = simulation.days===MIN_DAY || simulation.days===MAX_DAY;
    if (atLimit && !pauseIcon.hasAttribute("hidden")) updatePause();
    frames = 0; frameMillis = 0; cpuMillis = 0; lastUI = now;
  }
  animation = requestAnimationFrame(frame);
}

function fail(message) {
  validationErrors++;
  running = false;
  cancelAnimationFrame(animation);
  $("error-text").textContent = message;
  $("error").hidden = false;
  loadScreen.hidden = true;
  stats.errors.textContent = validationErrors;
  renderer.destroy();
  console.error(message);
}

function resizeScene() {
  const nextWidth = canvas.clientWidth, nextHeight = canvas.clientHeight;
  if (nextWidth!==width || nextHeight!==height) hideMovingLabels();
  width = nextWidth; height = nextHeight;
  renderer.resize();
  refreshAnnotationBounds();
}
const resizeObserver = new ResizeObserver(resizeScene);
function resumeFrameLoop() {
  cancelAnimationFrame(animation); animation = 0; lastTime = 0;
  adaptiveQuality.reset();
  frames = 0; frameMillis = 0; cpuMillis = 0;
  if (!document.hidden && running) animation = requestAnimationFrame(frame);
}
document.addEventListener("visibilitychange",resumeFrameLoop);
window.addEventListener("pageshow",event => { if (event.persisted) resumeFrameLoop(); });
window.addEventListener("pagehide",event => {
  if (event.persisted) { cancelAnimationFrame(animation); animation = 0; return; }
  running = false; cancelAnimationFrame(animation); resizeObserver.disconnect(); renderer.destroy();
});

try {
  // Apply saved resolution before the renderer creates its first targets.
  restorePreferences();
  updatePause();
  await renderer.init(simulation.data,message => { loadingText.textContent = message; });
  stats.textures.textContent = `${renderer.maps.width} × ${renderer.maps.height} · ${renderer.maps.mipLevelCount} levels`;
  refreshAnnotationBounds();
  resizeObserver.observe(canvas);
  camera.update(0,simulation.data);
  running = true;
  animation = requestAnimationFrame(frame);
  loadScreen.classList.add("ready");
  setTimeout(() => { loadScreen.hidden = true; },750);
} catch (error) { fail(error.message || String(error)); }
