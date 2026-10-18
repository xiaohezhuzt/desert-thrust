import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';
import * as THREE from 'three';

const fragment = /* glsl */ `
uniform float strength;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  if (strength < 0.001) { outputColor = inputColor; return; }
  vec2 dir = uv - vec2(0.5);
  vec4 sum = vec4(0.0);
  for (int i = 0; i < 8; i++) {
    float s = 1.0 - strength * float(i) * 0.012;
    sum += texture2D(inputBuffer, vec2(0.5) + dir * s);
  }
  // Keep the centre sharp, smear the edges.
  float edge = smoothstep(0.08, 0.55, length(dir));
  outputColor = mix(inputColor, sum / 8.0, edge);
}`;

/** Speed / boost zoom blur toward the screen centre (medium + high tiers). */
export class RadialBlurEffect extends Effect {
  constructor() {
    super('RadialBlurEffect', fragment, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map([['strength', new THREE.Uniform(0)]]),
    });
  }

  set strength(v: number) {
    this.uniforms.get('strength')!.value = v;
  }
}
