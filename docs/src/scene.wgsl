struct Camera {
  eye: vec4f,       // position, tan(fov / 2)
  right: vec4f,     // basis, aspect
  up: vec4f,        // basis, elapsed real seconds
  forward: vec4f,   // basis, exposure
  viewport: vec4f,  // width, height, selected body, orbit visibility
  effects: vec4f,   // bloom strength, atmosphere visibility, render/CSS ratio, annotation opacity
}
struct Body {
  sphere: vec4f,
  material: vec4f,   // rotation, obliquity, texture layer, emissive
  atmosphere: vec4f,
  orbitA: vec4f,     // plane basis X, display semimajor axis
  orbitB: vec4f,     // plane basis Y, eccentricity
  origin: vec4f,
}
struct Orbit {
  axisA: vec4f,  // orbital basis A, display semimajor axis
  axisB: vec4f,  // orbital basis B, eccentricity
  center: vec4f, // parent position, proximity LOD opacity
  phase: vec4f,  // eccentric anomaly, time direction, marker flag, selectable body ID (-1 for markers)
}
@group(0) @binding(5) var<storage, read> orbits: array<Orbit>;
@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<storage, read> bodies: array<Body>;
@group(0) @binding(2) var maps: texture_2d_array<f32>;
@group(0) @binding(3) var mapSampler: sampler;
@group(0) @binding(4) var ringMap: texture_2d<f32>;

const PI = 3.14159265359;
const TAU = 6.28318530718;
const FAR = 100000.0;
const RING_NORMAL = vec3f(0.0, 0.893143, 0.449786);

// Fixed equal-area Vogel samples of the projected solar disc. Only rings and
// multiple overlapping blockers use these; a lone sphere is integrated analytically.
// Keeping the pattern constant in light space avoids frame-to-frame shadow noise.
const SUN_SAMPLES = array<vec2f, 32>(
  vec2f(0.12500000, 0.00000000),
  vec2f(-0.15964505, 0.14624794),
  vec2f(0.02443623, -0.27843827),
  vec2f(0.20122224, 0.26245878),
  vec2f(-0.36926756, -0.06531823),
  vec2f(0.34980247, -0.22251570),
  vec2f(-0.11700208, 0.43524190),
  vec2f(-0.22313565, -0.42963412),
  vec2f(0.48411512, 0.17679806),
  vec2f(-0.50364111, 0.20789573),
  vec2f(0.24278829, -0.51882448),
  vec2f(0.17941437, 0.57200130),
  vec2f(-0.54075701, -0.31337974),
  vec2f(0.63436952, -0.13946436),
  vec2f(-0.38714585, 0.55067513),
  vec2f(-0.08943965, -0.69019964),
  vec2f(0.54907176, 0.46275826),
  vec2f(-0.73887847, 0.03055494),
  vec2f(0.53895513, -0.53633233),
  vec2f(-0.03605819, 0.77979152),
  vec2f(-0.51281753, -0.61452679),
  vec2f(0.81235959, 0.10930183),
  vec2f(-0.68831064, 0.47890862),
  vec2f(0.18808606, -0.83606138),
  vec2f(0.43503327, 0.75919105),
  vec2f(-0.85044841, -0.27131624),
  vec2f(0.82610240, -0.38168026),
  vec2f(-0.35788820, 0.85515556),
  vec2f(-0.31940733, -0.88803376),
  vec2f(0.84990864, 0.44668816),
  vec2f(-0.94403465, 0.24884450),
  vec2f(0.53659581, -0.83452977)
);

@vertex fn vertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let uv = vec2f(f32((index << 1u) & 2u), f32(index & 2u));
  return vec4f(uv * 2.0 - 1.0, 0.0, 1.0);
}

// Unit rays give a quadratic with a=1. Both roots are handled for inside views.
fn sphereHit(ro: vec3f, rd: vec3f, center: vec3f, radius: f32) -> f32 {
  let oc = ro - center;
  let b = dot(oc, rd);
  let closest = oc-rd*b;
  let h = radius*radius-dot(closest,closest);
  if (h < 0.0) { return FAR; }
  let root = sqrt(h);
  let near = -b - root;
  let far = -b + root;
  if (near > 0.0001) { return near; }
  if (far > 0.0001) { return far; }
  return FAR;
}

fn surfaceUV(normal: vec3f, body: Body) -> vec2f {
  let c = cos(body.material.y);
  let s = sin(body.material.y);
  let n = vec3f(normal.x, c * normal.y + s * normal.z, -s * normal.y + c * normal.z);
  return vec2f(atan2(n.z, n.x) / TAU + 0.5 + body.material.x / TAU,
               acos(clamp(n.y, -1.0, 1.0)) / PI);
}

// Explicit mip LOD is required: ray hits create non-uniform control flow and
// textureSample's implicit derivatives would be invalid there. The cone
// footprint is projected onto the sphere, including grazing-angle stretching.
fn textureLOD(t: f32, radius: f32, facing: f32) -> f32 {
  let pixelWorld = 2.0 * t * camera.eye.w / camera.viewport.y;
  let footprint = pixelWorld * f32(textureDimensions(maps,0).x) / (TAU * radius * max(facing, 0.12));
  return clamp(log2(max(footprint, 1.0)), 0.0, f32(textureNumLevels(maps)-1u));
}

fn ringUV(point: vec3f) -> f32 {
  return (length(point - bodies[6].sphere.xyz) / bodies[6].sphere.w - 1.23) / (2.32 - 1.23);
}
fn ringIntersection(ro: vec3f, rd: vec3f) -> f32 {
  let denominator = dot(rd, RING_NORMAL);
  if (abs(denominator) < 0.00001) { return FAR; }
  let t = dot(bodies[6].sphere.xyz - ro, RING_NORMAL) / denominator;
  if (t <= 0.0001) { return FAR; }
  let u = ringUV(ro + rd * t);
  if (u < 0.0 || u > 1.0) { return FAR; }
  return t;
}

// Fraction of a uniform solar disc left visible by one angular circular disc.
// Normalize the Sun to radius 1 before evaluating the circle-intersection area.
// Separate containment/tangency cases avoid division by zero at alignment.
fn discVisibility(sunAngle: f32, blockerAngle: f32, separation: f32) -> f32 {
  let r = blockerAngle / sunAngle;
  let d = separation / sunAngle;
  if (d >= 1.0 + r) { return 1.0; }
  if (d <= abs(1.0-r)) { return max(0.0, 1.0-r*r); }
  let d2 = d*d;
  let r2 = r*r;
  let a = acos(clamp((d2+1.0-r2)/(2.0*d), -1.0, 1.0));
  let b = acos(clamp((d2+r2-1.0)/(2.0*d*r), -1.0, 1.0));
  let lens = sqrt(max(0.0, (-d+1.0+r)*(d+1.0-r)*(d-1.0+r)*(d+1.0+r)));
  return clamp(1.0 - (a+r2*b-0.5*lens)/PI, 0.0, 1.0);
}

fn sunVisibility(point: vec3f, normal: vec3f, selfIndex: u32, includeRings: bool) -> f32 {
  let start = point + normal * 0.002;
  let lightVector = bodies[0].sphere.xyz - start;
  let lightDistance = length(lightVector);
  let light = lightVector / lightDistance;
  let sunSin = clamp(bodies[0].sphere.w / lightDistance, 0.000001, 0.999999);
  let sunCos = sqrt(1.0-sunSin*sunSin);
  let sunAngle = asin(sunSin);
  var blockers = 0u;
  var blockerCount = 0u;
  var analytic = 1.0;
  for (var j = 1u; j < arrayLength(&bodies); j++) {
    if (j == selfIndex) { continue; }
    let toBlocker = bodies[j].sphere.xyz-start;
    let distance = length(toBlocker);
    let radius = bodies[j].sphere.w;
    if (distance <= radius) { return 0.0; }
    // Bodies behind the receiver or beyond the Sun cannot eclipse it.
    if (dot(toBlocker,light) <= 0.0 || distance >= lightDistance) { continue; }
    let direction = toBlocker/distance;
    let blockerSin = clamp(radius/distance, 0.0, 1.0);
    let blockerCos = sqrt(1.0-blockerSin*blockerSin);
    let alignment = dot(light,direction);
    // Cone rejection avoids inverse trig for almost all bodies at most pixels.
    if (alignment <= sunCos*blockerCos-sunSin*blockerSin) { continue; }
    let separation = atan2(length(cross(light,direction)),alignment);
    let fraction = discVisibility(sunAngle,asin(blockerSin),separation);
    if (fraction <= 0.0) { return 0.0; }
    analytic = fraction;
    blockers |= 1u << j;
    blockerCount++;
  }

  // Conservative outer-sphere bound: sample ring transmission only where some
  // part of the solar cone can meet Saturn's annulus.
  var sampleRings = false;
  if (includeRings) {
    let toRing = bodies[6].sphere.xyz-start;
    let distance = length(toRing);
    let radius = bodies[6].sphere.w*2.32;
    if (distance <= radius) {
      sampleRings = true;
    } else if (distance < lightDistance && dot(toRing,light) > 0.0) {
      let ringSin = radius/distance;
      sampleRings = dot(toRing/distance,light) > sunCos*sqrt(1.0-ringSin*ringSin)-sunSin*ringSin;
    }
  }
  if (blockerCount <= 1u && !sampleRings) { return analytic; }

  // Integrate the union of silhouettes, not their product: overlapping blockers
  // must not darken the same part of the Sun twice. Ring opacity is integrated
  // along those same directions so its shadow also has a finite-source penumbra.
  let axis = select(vec3f(0.0,1.0,0.0),vec3f(1.0,0.0,0.0),abs(light.y)>0.9);
  let tangent = normalize(cross(light,axis));
  let bitangent = cross(tangent,light);
  var transmission = 0.0;
  for (var sampleIndex = 0u; sampleIndex < 32u; sampleIndex++) {
    let p = SUN_SAMPLES[sampleIndex]*sunSin;
    let ray = light*sqrt(1.0-dot(p,p)) + tangent*p.x + bitangent*p.y;
    let sunT = sphereHit(start,ray,bodies[0].sphere.xyz,bodies[0].sphere.w);
    var visible = 1.0;
    for (var j = 1u; j < arrayLength(&bodies); j++) {
      if ((blockers & (1u << j)) == 0u) { continue; }
      if (sphereHit(start,ray,bodies[j].sphere.xyz,bodies[j].sphere.w) < sunT) {
        visible = 0.0;
        break;
      }
    }
    if (visible > 0.0 && sampleRings) {
      let ringT = ringIntersection(start,ray);
      if (ringT < sunT) {
        let opacity = textureSampleLevel(ringMap,mapSampler,
          vec2f(ringUV(start+ray*ringT),0.5),0.0).a;
        visible *= 1.0-opacity*0.85;
      }
    }
    transmission += visible;
  }
  return transmission/32.0;
}

fn hash(p: vec3f) -> f32 {
  return fract(sin(dot(p, vec3f(127.1,311.7,74.7))) * 43758.5453);
}
fn stars(rd: vec3f) -> vec3f {
  var result = vec3f(0.0015,0.0025,0.005);
  // World-direction grid: the stars stay put as the camera turns. No geometry.
  for (var layer = 0; layer < 2; layer++) {
    let p = rd * (230.0 + f32(layer) * 240.0);
    let cell = floor(p);
    let seed = hash(cell);
    let local = fract(p) - 0.5;
    let core = exp(-dot(local,local) * 85.0);
    let exists = smoothstep(0.962, 0.998, seed);
    let warmth = hash(cell + vec3f(5.0));
    result += mix(vec3f(0.54,0.69,1.0),vec3f(1.0,0.82,0.61),warmth) * core * exists * 2.0;
  }
  return result;
}

// Finite, instanced ribbons avoid the projective pole of a ray/ellipse-plane
// distance estimate. Both near-plane and viewport clipping happen before divide.
@group(0) @binding(6) var<storage, read> orbitPoints: array<vec2f>;
override ORBIT_SEGMENTS: u32 = 1024u;
struct OrbitVertex {
  @builtin(position) position: vec4f,
  @location(0) @interpolate(flat) start: vec4f, // screen xy, inverse depth, anomaly
  @location(1) @interpolate(flat) end: vec4f,
  @location(2) @interpolate(flat) style: vec4f, // opacity, phase, direction, emphasis
  @location(3) @interpolate(flat) marker: u32,
}
fn emptyOrbitVertex() -> OrbitVertex {
  return OrbitVertex(vec4f(2.0,2.0,0.0,1.0),vec4f(0.0),vec4f(0.0),vec4f(0.0),0u);
}
fn orbitTrail(phase: f32, angle: f32, direction: f32) -> f32 {
  let lag = fract(direction*(phase-angle)/TAU+1.0);
  return pow(1.0-smoothstep(0.0,0.8,lag),1.5);
}
fn orbitPoint(orbit: Orbit, point: vec2f) -> vec3f {
  let a = orbit.axisA.w;
  let e = orbit.axisB.w;
  return orbit.center.xyz+orbit.axisA.xyz*a*(point.x-e)+orbit.axisB.xyz*a*sqrt(1.0-e*e)*point.y;
}
fn orbitClipPosition(point: vec3f) -> vec3f {
  let delta = point-camera.eye.xyz;
  let z = dot(delta,camera.forward.xyz);
  return vec3f(dot(delta,camera.right.xyz)/(camera.eye.w*camera.right.w)+0.18*z,
    dot(delta,camera.up.xyz)/camera.eye.w,z);
}
fn orbitScreen(point: vec3f) -> vec2f {
  return (point.xy/point.z*vec2f(1.0,-1.0)+1.0)*camera.viewport.xy*0.5;
}
fn orbitClipSegment(a: vec3f, b: vec3f) -> vec2f {
  let margin = 4.0*max(camera.effects.z,0.001)/camera.viewport.xy;
  let extent = 1.0+margin;
  let da = array<f32,5>(a.z-0.001,a.x+extent.x*a.z,extent.x*a.z-a.x,a.y+extent.y*a.z,extent.y*a.z-a.y);
  let db = array<f32,5>(b.z-0.001,b.x+extent.x*b.z,extent.x*b.z-b.x,b.y+extent.y*b.z,extent.y*b.z-b.y);
  var lo = 0.0;
  var hi = 1.0;
  for (var i = 0u; i<5u; i++) {
    if (da[i]<0.0 && db[i]<0.0) { return vec2f(1.0,0.0); }
    if (da[i]<0.0) { lo = max(lo,da[i]/(da[i]-db[i])); }
    if (db[i]<0.0) { hi = min(hi,da[i]/(da[i]-db[i])); }
  }
  return vec2f(lo,hi);
}
fn orbitCorner(index: u32) -> vec2f {
  let corners = array<vec2f,6>(vec2f(0.0,-1.0),vec2f(1.0,-1.0),vec2f(0.0,1.0),vec2f(0.0,1.0),vec2f(1.0,-1.0),vec2f(1.0,1.0));
  return corners[index%6u];
}
@vertex fn orbitVertex(@builtin(vertex_index) index: u32, @builtin(instance_index) instance: u32) -> OrbitVertex {
  let orbit = orbits[instance];
  if (orbit.center.w<=0.0 || camera.viewport.w<0.5) { return emptyOrbitVertex(); }
  let segment = index/6u;
  let a = orbitClipPosition(orbitPoint(orbit,orbitPoints[segment]));
  let b = orbitClipPosition(orbitPoint(orbit,orbitPoints[segment+1u]));
  let clip = orbitClipSegment(a,b);
  if (clip.x>=clip.y) { return emptyOrbitVertex(); }
  let ca = mix(a,b,clip.x);
  let cb = mix(a,b,clip.y);
  let start = orbitScreen(ca);
  let end = orbitScreen(cb);
  let delta = end-start;
  let lengthSquared = dot(delta,delta);
  if (lengthSquared<0.00000001) { return emptyOrbitVertex(); }
  let normal = vec2f(-delta.y,delta.x)*inverseSqrt(lengthSquared);
  let corner = orbitCorner(index);
  let halfWidth = 0.38*max(camera.effects.z,0.001);
  let screen = mix(start,end,corner.x)+normal*corner.y*(halfWidth+0.7);
  let step = TAU/f32(ORBIT_SEGMENTS);
  let phase = f32(segment)*step;
  let selected = orbit.phase.w>=0.0 && abs(camera.viewport.z-orbit.phase.w)<0.1;
  return OrbitVertex(vec4f(screen/camera.viewport.xy*vec2f(2.0,-2.0)+vec2f(-1.0,1.0),0.0,1.0),
    vec4f(start,1.0/ca.z,phase+clip.x*step),vec4f(end,1.0/cb.z,phase+clip.y*step),
    vec4f(orbit.center.w,orbit.phase.xy,select(0.85,1.1,selected)),0u);
}
@vertex fn markerVertex(@builtin(vertex_index) index: u32, @builtin(instance_index) instance: u32) -> OrbitVertex {
  let orbit = orbits[instance];
  if (orbit.center.w<=0.0 || orbit.phase.z<0.5 || camera.effects.w<=0.0) { return emptyOrbitVertex(); }
  let p = orbitClipPosition(orbitPoint(orbit,vec2f(cos(orbit.phase.x),sin(orbit.phase.x))));
  if (p.z<=0.001) { return emptyOrbitVertex(); }
  let center = orbitScreen(p);
  let ratio = max(camera.effects.z,0.001);
  let corner = orbitCorner(index);
  let screen = center+vec2f(corner.x*2.0-1.0,corner.y)*12.5*ratio;
  return OrbitVertex(vec4f(screen/camera.viewport.xy*vec2f(2.0,-2.0)+vec2f(-1.0,1.0),0.0,1.0),
    vec4f(center,1.0/p.z,11.0*ratio),vec4f(0.0),vec4f(orbit.center.w*camera.effects.w,0.0,0.0,1.0),1u);
}
// Only covered line/circle fragments evaluate depth. No extra full-screen pass,
// depth texture, per-planet draw or per-frame geometry upload is required.
@fragment fn orbitFragment(input: OrbitVertex) -> @location(0) vec4f {
  let pixel = input.position.xy;
  let ratio = max(camera.effects.z,0.001);
  var inverseDepth = input.start.z;
  var coverage = 0.0;
  var ink = vec3f(0.5,0.48,0.41);
  if (input.marker==1u) {
    let edge = abs(length(pixel-input.start.xy)-input.start.w);
    coverage = 1.0-smoothstep(0.7*ratio,1.5*ratio,edge);
  } else {
    let delta = input.end.xy-input.start.xy;
    let t = clamp(dot(pixel-input.start.xy,delta)/max(dot(delta,delta),0.00000001),0.0,1.0);
    let edge = length(pixel-mix(input.start.xy,input.end.xy,t));
    let halfWidth = 0.38*ratio;
    coverage = 1.0-smoothstep(max(0.0,halfWidth-0.7),halfWidth+0.7,edge);
    inverseDepth = mix(input.start.z,input.end.z,t);
    let anomaly = mix(input.start.w*input.start.z,input.end.w*input.end.z,t)/inverseDepth;
    let trail = orbitTrail(input.style.y,anomaly,input.style.z);
    ink = mix(vec3f(0.026,0.025,0.020),vec3f(0.29,0.265,0.19),trail)*input.style.w;
  }
  if (coverage<=0.0) { discard; }
  let ndc = vec2f(pixel.x/camera.viewport.x*2.0-1.18,1.0-pixel.y/camera.viewport.y*2.0);
  let rd = normalize(camera.forward.xyz+camera.eye.w*(ndc.x*camera.right.w*camera.right.xyz+ndc.y*camera.up.xyz));
  let ro = camera.eye.xyz;
  let depth = 1.0/(inverseDepth*max(dot(rd,camera.forward.xyz),0.000001));
  for (var i = 0u; i<arrayLength(&bodies); i++) {
    if (sphereHit(ro,rd,bodies[i].sphere.xyz,bodies[i].sphere.w)<depth) { discard; }
  }
  let ringDepth = ringIntersection(ro,rd);
  if (ringDepth<depth) {
    let opacity = textureSampleLevel(ringMap,mapSampler,vec2f(ringUV(ro+rd*ringDepth),0.5),0.0).a;
    coverage *= 1.0-opacity;
  }
  return vec4f(ink*coverage*input.style.x,0.0);
}

// Atmosphere calculations use planet radii as the length unit. RGB stores
// vertical molecular optical depth; w is the illustrative density scale height.
// See ATMOSPHERES.md for the display-scale calibration and limitations.
struct AtmosphereResult { scattering: vec3f, transmission: vec3f }

fn sphereInterval(ro: vec3f, rd: vec3f, radius: f32) -> vec2f {
  let middle = -dot(ro,rd);
  let closest = ro+rd*middle;
  let discriminant = radius*radius-dot(closest,closest);
  if (discriminant<=0.0) { return vec2f(0.0); }
  let halfChord = sqrt(discriminant);
  return vec2f(middle-halfChord,middle+halfChord);
}

fn aerosolProfile(index: u32) -> vec4f {
  switch index {
    case 2u: { return vec4f(0.075,0.070,0.055,0.72); } // Venus haze above clouds
    case 3u: { return vec4f(0.008,0.008,0.008,0.76); } // Earth aerosols
    case 4u: { return vec4f(0.035,0.025,0.015,0.60); } // Martian dust
    case 5u: { return vec4f(0.010,0.009,0.007,0.65); }
    case 6u: { return vec4f(0.018,0.015,0.010,0.65); }
    case 7u: { return vec4f(0.012,0.018,0.019,0.60); }
    case 8u: { return vec4f(0.008,0.013,0.017,0.60); }
    default: { return vec4f(0.0); }
  }
}

fn atmosphereDensity(point: vec3f, scaleHeight: f32) -> vec2f {
  let altitude = max(length(point)-1.0,0.0);
  return exp(-altitude/vec2f(scaleHeight,scaleHeight*0.5));
}

// Four-point Gauss-Legendre quadrature on each side of closest approach.
// Splitting at the density peak keeps grazing/twilight paths accurate.
fn atmosphereDepthInterval(point: vec3f, direction: vec3f, scaleHeight: f32, start: f32, end: f32) -> vec2f {
  let distance = end-start;
  let nodes = array<f32,4>(0.0694318442,0.3300094782,0.6699905218,0.9305681558);
  let weights = array<f32,4>(0.1739274226,0.3260725774,0.3260725774,0.1739274226);
  var depth = vec2f(0.0);
  for (var i = 0u; i<4u; i++) {
    depth += atmosphereDensity(point+direction*(start+distance*nodes[i]),scaleHeight)*weights[i];
  }
  return depth*distance;
}

fn atmosphereOpticalDepth(point: vec3f, direction: vec3f, scaleHeight: f32) -> vec2f {
  let interval = sphereInterval(point,direction,1.0+6.0*scaleHeight);
  let end = max(interval.y,0.0);
  let closest = clamp(-dot(point,direction),0.0,end);
  var depth = atmosphereDepthInterval(point,direction,scaleHeight,closest,end);
  if (closest>0.0) { depth += atmosphereDepthInterval(point,direction,scaleHeight,0.0,closest); }
  return depth;
}

fn atmosphereSunTransmission(point: vec3f, light: vec3f, scaleHeight: f32,
    molecular: vec3f, aerosol: vec3f) -> vec3f {
  // The planet blocks direct sunlight on the night side. External eclipses and
  // ring shadows are evaluated separately with the existing finite-Sun model.
  if (dot(point,light)<0.0 && sphereHit(point,light,vec3f(0.0),1.0)<FAR) { return vec3f(0.0); }
  let depth = atmosphereOpticalDepth(point,light,scaleHeight);
  return exp(-molecular*depth.x-aerosol*1.1*depth.y);
}

fn surfaceAtmosphereTransmission(index: u32, point: vec3f, light: vec3f) -> vec3f {
  let body = bodies[index];
  let height = body.atmosphere.w;
  if (camera.effects.y<0.5 || height<=0.0) { return vec3f(1.0); }
  // Distant ray/sphere hits can land fractionally inside the surface in f32.
  // Project onto the sphere before sampling the overlying atmospheric column.
  let local = normalize(point-body.sphere.xyz)*(1.0+0.000002);
  return atmosphereSunTransmission(local,light,height,body.atmosphere.rgb/height,
    aerosolProfile(index).rgb/(height*0.5));
}

fn integrateAtmosphere(index: u32, ro: vec3f, rd: vec3f, nearDepth: f32, farDepth: f32) -> AtmosphereResult {
  var result = AtmosphereResult(vec3f(0.0),vec3f(1.0));
  let body = bodies[index];
  let height = body.atmosphere.w;
  if (height<=0.0 || farDepth<=nearDepth) { return result; }
  let radius = body.sphere.w;
  let local = (ro-body.sphere.xyz)/radius;
  let interval = sphereInterval(local,rd,1.0+6.0*height);
  let start = max(max(interval.x,0.0),nearDepth/radius);
  let end = min(interval.y,farDepth/radius);
  if (end<=start) { return result; }
  let molecular = body.atmosphere.rgb/height;
  let aerosol = aerosolProfile(index);
  let aerosolScattering = aerosol.rgb/(height*0.5);
  let midpoint = ro+rd*((start+end)*0.5*radius);
  let visibility = sunVisibility(midpoint,vec3f(0.0),index,true);
  let step = (end-start)/8.0;
  for (var sample = 0u; sample<8u; sample++) {
    let t = start+(f32(sample)+0.5)*step;
    let point = local+rd*t;
    let density = atmosphereDensity(point,height);
    let extinction = molecular*density.x+aerosolScattering*1.1*density.y;
    let segmentTransmission = exp(-extinction*step);
    let worldPoint = body.sphere.xyz+point*radius;
    let light = normalize(bodies[0].sphere.xyz-worldPoint);
    let lightTransmission = atmosphereSunTransmission(point,light,height,molecular,aerosolScattering);
    let cosine = clamp(dot(rd,light),-1.0,1.0);
    let rayleighPhase = 3.0*(1.0+cosine*cosine)/(16.0*PI);
    let g = aerosol.w;
    let miePhase = (1.0-g*g)/(4.0*PI*pow(max(1.0+g*g-2.0*g*cosine,0.001),1.5));
    let source = molecular*density.x*rayleighPhase+aerosolScattering*density.y*miePhase;
    // Exact segment integration for locally constant density/source. This
    // bounds the energy at grazing angles rather than adding an unbounded rim.
    result.scattering += result.transmission*lightTransmission*source*
      (vec3f(1.0)-segmentTransmission)/max(extinction,vec3f(0.000001))*4.8*visibility;
    result.transmission *= segmentTransmission;
  }
  return result;
}

fn compositeAtmospheres(background: vec3f, ro: vec3f, rd: vec3f, nearDepth: f32, farDepth: f32) -> vec3f {
  var color = background;
  if (camera.effects.y<0.5) { return color; }
  for (var index = 1u; index<arrayLength(&bodies); index++) {
    let atmosphere = integrateAtmosphere(index,ro,rd,nearDepth,farDepth);
    color = color*atmosphere.transmission+atmosphere.scattering;
  }
  return color;
}

// Composite the atmosphere on either side of the ring plane independently.
// Ring alpha attenuates only the atmosphere behind it, including opaque bands.
fn compositeRingAtmospheres(background: vec3f, ro: vec3f, rd: vec3f, nearest: f32) -> vec3f {
  var color = background;
  let ringT = ringIntersection(ro,rd);
  if (ringT < nearest) {
    color = compositeAtmospheres(color,ro,rd,ringT,nearest);
    let point = ro + rd * ringT;
    let ring = textureSampleLevel(ringMap,mapSampler,vec2f(ringUV(point),0.5),0.0);
    let light = normalize(bodies[0].sphere.xyz-point);
    let normal = RING_NORMAL*select(-1.0,1.0,dot(RING_NORMAL,light)>=0.0);
    let shadow = 0.08+0.92*sunVisibility(point,normal,0u,false);
    let ringLight = 0.3 + 0.7 * abs(dot(RING_NORMAL,light));
    color = mix(color,ring.rgb * ringLight * shadow * 1.7,ring.a);
    color = compositeAtmospheres(color,ro,rd,0.0,ringT);
  } else {
    color = compositeAtmospheres(color,ro,rd,0.0,nearest);
  }
  return color;
}

@fragment fn fragment(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  let ndc = vec2f(frag.x / camera.viewport.x * 2.0 - 1.0 - 0.18,
                 1.0 - frag.y / camera.viewport.y * 2.0);
  let ro = camera.eye.xyz;
  let rd = normalize(camera.forward.xyz + camera.eye.w *
    (ndc.x * camera.right.w * camera.right.xyz + ndc.y * camera.up.xyz));
  var nearest = FAR;
  var hit = -1;
  for (var i = 0u; i < arrayLength(&bodies); i++) {
    let t = sphereHit(ro, rd, bodies[i].sphere.xyz, bodies[i].sphere.w);
    if (t < nearest) { nearest = t; hit = i32(i); }
  }
  var color = vec3f(0.0);
  if (hit >= 0) {
    let body = bodies[hit];
    let point = ro + rd * nearest;
    let normal = normalize(point - body.sphere.xyz);
    let uv = surfaceUV(normal, body);
    let lod = textureLOD(nearest, body.sphere.w, dot(normal,-rd));
    let albedo = textureSampleLevel(maps,mapSampler,uv,hit,lod).rgb;
    if (hit == 0) {
      let limb = pow(max(dot(normal,-rd),0.0),0.35);
      color = albedo * vec3f(5.5,3.8,2.4) * (0.5 + 0.5 * limb);
    } else {
      let light = normalize(bodies[0].sphere.xyz - point);
      let ndl = max(dot(normal,light),0.0);
      var shadow = 1.0;
      if (ndl > 0.0) { shadow = sunVisibility(point,normal,u32(hit),true); }
      let sunlight = surfaceAtmosphereTransmission(u32(hit),point,light);
      color = albedo * (vec3f(0.018) + sunlight * ndl * 1.55 * shadow);
      if (hit == 3) {
        let night = textureSampleLevel(maps,mapSampler,uv,10,lod).rgb;
        color += night * (1.0-smoothstep(-0.15,0.16,dot(normal,light))) * 1.4;
        let clouds = textureSampleLevel(maps,mapSampler,uv,11,lod).r;
        color = mix(color, vec3f(0.92) * (vec3f(0.02) + sunlight * ndl * 1.5 * shadow), clouds * 0.66);
        let ocean = pow(clamp(albedo.b-albedo.r,0.0,1.0),0.5);
        let halfVector = normalize(light-rd);
        color += vec3f(0.7,0.8,1.0) * pow(max(dot(normal,halfVector),0.0),100.0) * ocean * shadow * sunlight;
      }
    }
  }
  if (hit<0) { color = stars(rd); }
  color = compositeRingAtmospheres(color,ro,rd,nearest);
  // A warm solar aureole, hidden by any foreground planet (including eclipses).
  let sunVector = bodies[0].sphere.xyz-ro;
  let sunT = dot(sunVector,rd);
  if (sunT > 0.0 && sunT < nearest + bodies[0].sphere.w) {
    let distance = length(sunVector-rd*sunT) / bodies[0].sphere.w;
    let haloDistance = distance + max(distance-1.0,0.0);
    let corona = (exp(-max(haloDistance-1.0,0.0)*5.0)*0.22 + exp(-haloDistance*0.65)*0.035)*0.5;
    color += vec3f(1.0,0.38,0.065) * corona;
  }
  return vec4f(color,1.0);
}
