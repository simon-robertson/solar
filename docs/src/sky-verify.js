import { Renderer } from "./renderer.js";
import { Simulation } from "./simulation.js";
import { checkSky } from "./sky-check.js";

const summary = document.getElementById("summary"), results = document.getElementById("results");
let passes = 0, failures = 0;
const errors = [];
const renderer = new Renderer(document.getElementById("test-canvas"),message => errors.push(message));
function check(name,condition,detail="") {
  const item = document.createElement("li"); item.className = condition ? "pass" : "fail";
  item.textContent = `${condition ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`; results.append(item);
  if (condition) passes++; else failures++;
}
try {
  await renderer.init(new Simulation(0).data,message => { summary.textContent = message; });
  await checkSky(renderer,check);
  check("No uncaptured GPU errors",errors.length===0,errors.join("; "));
} catch (error) { check("Sky verification completed",false,error.message); }
finally {
  renderer.destroy(); summary.textContent = `${passes} passed, ${failures} failed.`;
  summary.className = failures ? "fail" : "pass";
}
