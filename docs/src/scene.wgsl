struct Camera {
  eye: vec4f,       // position, tan(fov / 2)
  right: vec4f,     // basis, aspect
  up: vec4f,        // basis, elapsed real seconds
  forward: vec4f,   // basis, exposure
  viewport: vec4f,  // width, height, selected body, orbit visibility
  effects: vec4f,   // bloom strength, atmosphere visibility, unused, unused
}
struct Body {
  sphere: vec4f,
  material: vec4f,   // rotation, obliquity, texture layer, emissive
  atmosphere: vec4f,
  orbitA: vec4f,     // plane basis X, display semimajor axis
  orbitB: vec4f,     // plane basis Y, eccentricity
  origin: vec4f,
}
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
  let c = dot(oc, oc) - radius * radius;
  let h = b * b - c;
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
  let footprint = pixelWorld * 1024.0 / (TAU * radius * max(facing, 0.12));
  return clamp(log2(max(footprint, 1.0)), 0.0, 10.0);
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

fn orbitLines(ro: vec3f, rd: vec3f, nearest: f32) -> vec3f {
  var color = vec3f(0.0);
  if (camera.viewport.w < 0.5) { return color; }
  for (var i = 1u; i < arrayLength(&bodies); i++) {
    let body = bodies[i];
    let normal = cross(body.orbitA.xyz, body.orbitB.xyz);
    let denominator = dot(rd, normal);
    if (abs(denominator) < 0.0001) { continue; }
    let t = dot(body.origin.xyz - ro, normal) / denominator;
    if (t <= 0.0 || t > nearest) { continue; }
    let p = ro + rd * t - body.origin.xyz;
    let a = body.orbitA.w;
    let e = body.orbitB.w;
    let q = vec2f(dot(p, body.orbitA.xyz) / a + e,
                  dot(p, body.orbitB.xyz) / (a * sqrt(1.0-e*e)));
    let error = abs(length(q) - 1.0) * a;
    let width = max(0.0003, t * camera.eye.w / camera.viewport.y);
    let alpha = 1.0 - smoothstep(width * 0.2, width * 1.6, error);
    let selected = abs(camera.viewport.z - f32(i)) < 0.1;
    color += select(vec3f(0.045,0.057,0.069),vec3f(0.34,0.23,0.11),selected) * alpha;
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
  var color = stars(rd);
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
      color = albedo * (0.018 + ndl * 1.55 * shadow);
      if (hit == 3) {
        let night = textureSampleLevel(maps,mapSampler,uv,10,lod).rgb;
        color += night * (1.0-smoothstep(-0.15,0.16,dot(normal,light))) * 1.4;
        let clouds = textureSampleLevel(maps,mapSampler,uv,11,lod).r;
        color = mix(color, vec3f(0.92) * (0.02 + ndl * 1.5 * shadow), clouds * 0.66);
        let ocean = pow(clamp(albedo.b-albedo.r,0.0,1.0),0.5);
        let halfVector = normalize(light-rd);
        color += vec3f(0.7,0.8,1.0) * pow(max(dot(normal,halfVector),0.0),100.0) * ocean * shadow;
      }
      if (camera.effects.y > 0.5 && body.atmosphere.w > 0.0) {
        let rim = pow(1.0-max(dot(normal,-rd),0.0),3.0);
        color += body.atmosphere.rgb * rim * smoothstep(-0.2,0.5,dot(normal,light)) * 0.5;
      }
    }
  }
  // The ring plane is evaluated against sphere depth, so front/back occlusion
  // and Saturn's shadow are correct without a depth buffer or extra draw.
  let ringT = ringIntersection(ro,rd);
  if (ringT < nearest) {
    let point = ro + rd * ringT;
    let ring = textureSampleLevel(ringMap,mapSampler,vec2f(ringUV(point),0.5),0.0);
    let light = normalize(bodies[0].sphere.xyz-point);
    let normal = RING_NORMAL*select(-1.0,1.0,dot(RING_NORMAL,light)>=0.0);
    let shadow = 0.08+0.92*sunVisibility(point,normal,0u,false);
    let ringLight = 0.3 + 0.7 * abs(dot(RING_NORMAL,light));
    color = mix(color,ring.rgb * ringLight * shadow * 1.7,ring.a);
  }
  color += orbitLines(ro,rd,min(nearest,ringT));
  // Thin analytic atmosphere halos; no volumetric integration in this version.
  if (camera.effects.y > 0.5) {
    for (var i = 1u; i < arrayLength(&bodies); i++) {
      let body = bodies[i];
      if (body.atmosphere.w <= 0.0) { continue; }
      let toBody = body.sphere.xyz - ro;
      let t = dot(toBody,rd);
      if (t <= 0.0 || t >= nearest) { continue; }
      let distance = length(toBody-rd*t);
      let altitude = (distance-body.sphere.w) / (body.sphere.w * body.atmosphere.w);
      if (altitude > 0.0 && altitude < 6.0) {
        let n = normalize(ro+rd*t-body.sphere.xyz);
        let lit = smoothstep(-0.3,0.6,dot(n,normalize(-body.sphere.xyz)));
        color += body.atmosphere.rgb * exp(-altitude) * lit * 0.35;
      }
    }
  }
  // A warm solar aureole, hidden by any foreground planet (including eclipses).
  let sunVector = bodies[0].sphere.xyz-ro;
  let sunT = dot(sunVector,rd);
  if (sunT > 0.0 && sunT < nearest + bodies[0].sphere.w) {
    let distance = length(sunVector-rd*sunT) / bodies[0].sphere.w;
    let corona = exp(-max(distance-1.0,0.0)*5.0)*0.22 + exp(-distance*0.65)*0.035;
    color += vec3f(1.0,0.38,0.065) * corona;
  }
  return vec4f(color,1.0);
}
