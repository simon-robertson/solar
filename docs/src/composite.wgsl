struct Camera {
  eye: vec4f, right: vec4f, up: vec4f, forward: vec4f, viewport: vec4f, effects: vec4f,
}
@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var scene: texture_2d<f32>;
@group(0) @binding(2) var bloom: texture_2d<f32>;
@group(0) @binding(3) var linearSampler: sampler;
@vertex fn vertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let uv = vec2f(f32((index << 1u) & 2u),f32(index & 2u));
  return vec4f(uv*2.0-1.0,0.0,1.0);
}
fn aces(x: vec3f) -> vec3f {
  return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),vec3f(0.0),vec3f(1.0));
}
@fragment fn fragment(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  let uv = frag.xy/camera.viewport.xy;
  var color = textureSample(scene,linearSampler,uv).rgb;
  color += textureSample(bloom,linearSampler,uv).rgb * camera.effects.x;
  color = aces(color * camera.forward.w);
  let vignette = 1.0 - 0.22 * dot(uv-0.5,uv-0.5);
  color = pow(color*vignette,vec3f(1.0/2.2));
  return vec4f(color,1.0);
}
