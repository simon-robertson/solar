@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var destination: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var blurSampler: sampler;

fn loadAt(p: vec2i) -> vec3f {
  return textureLoad(source,clamp(p,vec2i(0),vec2i(textureDimensions(source))-1),0).rgb;
}
@compute @workgroup_size(8,8) fn extract(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= textureDimensions(destination))) { return; }
  let p = vec2i(id.xy)*2;
  let color = (loadAt(p)+loadAt(p+vec2i(1,0))+loadAt(p+vec2i(0,1))+loadAt(p+vec2i(1,1)))*0.25;
  let brightness = max(color.r,max(color.g,color.b));
  let contribution = max(brightness-0.8,0.0)/max(brightness,0.0001);
  textureStore(destination,vec2i(id.xy),vec4f(color*contribution,1.0));
}
// Pair adjacent taps with linear filtering: the same normalized 17-tap
// Gaussian needs nine filtered reads instead of seventeen individual loads.
const CENTER_WEIGHT = 0.116776880116;
// Combined weight and weighted offset for taps (1,2), (3,4), (5,6), (7,8).
const BLUR_PAIRS = array<vec2f,4>(
  vec2f(0.210860647149,1.468790626626),vec2f(0.140214747073,3.427595888523),
  vec2f(0.067263044053,5.387381277916),vec2f(0.023273121668,7.348645135334));
fn blur(p: vec2i, axis: vec2f) -> vec4f {
  let texel = 1.0/vec2f(textureDimensions(source));
  let uv = (vec2f(p)+0.5)*texel;
  var sum = textureSampleLevel(source,blurSampler,uv,0.0).rgb*CENTER_WEIGHT;
  for (var i = 0u; i<4u; i++) {
    let pair = BLUR_PAIRS[i];
    let offset = axis*texel*pair.y;
    sum += (textureSampleLevel(source,blurSampler,uv+offset,0.0).rgb+
      textureSampleLevel(source,blurSampler,uv-offset,0.0).rgb)*pair.x;
  }
  return vec4f(sum,1.0);
}
@compute @workgroup_size(8,8) fn blurX(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= textureDimensions(destination))) { return; }
  textureStore(destination,vec2i(id.xy),blur(vec2i(id.xy),vec2f(1,0)));
}
@compute @workgroup_size(8,8) fn blurY(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= textureDimensions(destination))) { return; }
  textureStore(destination,vec2i(id.xy),blur(vec2i(id.xy),vec2f(0,1)));
}
