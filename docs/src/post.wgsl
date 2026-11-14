@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var destination: texture_storage_2d<rgba16float, write>;

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
fn blur(p: vec2i, axis: vec2i) -> vec4f {
  var sum = vec3f(0.0);
  var weights = 0.0;
  for (var i = -8; i <= 8; i++) {
    let weight = exp(-f32(i*i)/24.0);
    sum += loadAt(p+axis*i)*weight;
    weights += weight;
  }
  return vec4f(sum/weights,1.0);
}
@compute @workgroup_size(8,8) fn blurX(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= textureDimensions(destination))) { return; }
  textureStore(destination,vec2i(id.xy),blur(vec2i(id.xy),vec2i(1,0)));
}
@compute @workgroup_size(8,8) fn blurY(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= textureDimensions(destination))) { return; }
  textureStore(destination,vec2i(id.xy),blur(vec2i(id.xy),vec2i(0,1)));
}
