import * as THREE from 'three';

export interface SkyColors {
  top: THREE.ColorRepresentation;
  horizon: THREE.ColorRepresentation;
  bottom: THREE.ColorRepresentation;
}

const tmpColor = new THREE.Color();

export const DUSK_SKY: SkyColors = { top: 0x1b2a4a, horizon: 0xf0a060, bottom: 0xc99a63 };

/**
 * Vertical gradient sky with a sun disc, a soft glow around it and a bright
 * haze band at the horizon (rendered on a BackSide sphere).
 */
export function createSkyMaterial(colors: SkyColors = DUSK_SKY): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(colors.top) },
      horizon: { value: new THREE.Color(colors.horizon) },
      bottom: { value: new THREE.Color(colors.bottom) },
      sunDir: { value: new THREE.Vector3(-0.5, 0.35, 0.3).normalize() },
      sunColor: { value: new THREE.Color(1, 0.92, 0.75) },
      sunSize: { value: 0.9995 },
      sunGlow: { value: 0.6 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom;
      uniform vec3 sunDir; uniform vec3 sunColor; uniform float sunSize; uniform float sunGlow;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 c = h > 0.0 ? mix(horizon, top, pow(clamp(h, 0.0, 1.0), 0.5)) : mix(horizon, bottom, min(1.0, -h * 6.0));
        // Bright haze hugging the horizon.
        c += horizon * 0.25 * exp(-abs(h) * 18.0);
        // Sun: hard disc plus wide soft glow.
        float s = max(dot(d, normalize(sunDir)), 0.0);
        c += sunColor * sunGlow * (pow(s, 12.0) * 0.35 + pow(s, 200.0) * 0.8);
        c += sunColor * smoothstep(sunSize, sunSize + 0.0003, s) * 3.0;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/** Camera-following sky dome. */
export class SkyDome {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;

  constructor(colors: SkyColors = DUSK_SKY) {
    this.material = createSkyMaterial(colors);
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.material);
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;
  }

  /** Place the sun (direction toward it), its colour, disc size and glow. */
  setSun(dir: THREE.Vector3, color: THREE.ColorRepresentation, glow = 0.6, size = 0.9995): void {
    const u = this.material.uniforms;
    (u.sunDir!.value as THREE.Vector3).copy(dir).normalize();
    (u.sunColor!.value as THREE.Color).set(color);
    u.sunGlow!.value = glow;
    u.sunSize!.value = size;
  }

  /** Blend between two palettes, t in [0, 1]. */
  blend(a: SkyColors, b: SkyColors, t: number): void {
    const u = this.material.uniforms;
    (u.top!.value as THREE.Color).set(a.top).lerp(tmpColor.set(b.top), t);
    (u.horizon!.value as THREE.Color).set(a.horizon).lerp(tmpColor.set(b.horizon), t);
    (u.bottom!.value as THREE.Color).set(a.bottom).lerp(tmpColor.set(b.bottom), t);
  }

  follow(camera: THREE.PerspectiveCamera): void {
    this.mesh.position.copy(camera.position);
    this.mesh.scale.setScalar(camera.far * 0.9);
  }
}
