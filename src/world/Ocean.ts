import * as THREE from 'three';

/** (dirX, dirZ, steepness, wavelength) */
// Wavelengths stay ≥ 4 grid cells so the swell never aliases into facets.
// Amplitude = steepness × wavelength / 2π: kept under ~0.8 m total so the sea stays off the beach road.
const WAVES_HIGH = [
  [1, 0.35, 0.035, 95],
  [0.7, -0.8, 0.03, 62],
  [-0.4, 1, 0.025, 48],
];
const WAVES_LOW = [[1, 0.35, 0.035, 110]];

/**
 * Animated sea: Gerstner waves displaced in the vertex shader of a standard
 * material (so it keeps lighting, fog and reflections). Low tier: one wave, coarse grid.
 */
export class Ocean {
  readonly mesh: THREE.Mesh;
  private readonly uniforms = { uTime: { value: 0 } };

  constructor(level: number, size: number, detailed: boolean) {
    const waves = detailed ? WAVES_HIGH : WAVES_LOW;
    const geo = new THREE.PlaneGeometry(size, size, detailed ? 220 : 80, detailed ? 220 : 80).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1ba6c8,
      roughness: 0.22,
      metalness: 0.1,
      transparent: true,
      opacity: 0.82,
    });
    const uniforms = this.uniforms;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uniforms.uTime;
      const waveDefs = waves.map((w, i) => `const vec4 W${i} = vec4(${w.map((v) => v.toFixed(3)).join(', ')});`).join('\n');
      const sum = waves.map((_, i) => `gOff += gerstner(W${i}, gWorld, gT, gB);`).join('\n');
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uTime;
          ${waveDefs}
          vec3 gerstner(vec4 w, vec3 p, inout vec3 t, inout vec3 b) {
            float k = 6.28318 / w.w;
            float c = sqrt(9.8 / k);
            vec2 d = normalize(w.xy);
            float f = k * (dot(d, p.xz) - c * uTime);
            float a = w.z / k;
            t += vec3(-d.x * d.x * w.z * sin(f), d.x * w.z * cos(f), -d.x * d.y * w.z * sin(f));
            b += vec3(-d.x * d.y * w.z * sin(f), d.y * w.z * cos(f), -d.y * d.y * w.z * sin(f));
            return vec3(d.x * a * cos(f), a * sin(f), d.y * a * cos(f));
          }`,
        )
        .replace(
          '#include <beginnormal_vertex>',
          `vec3 gT = vec3(1.0, 0.0, 0.0);
          vec3 gB = vec3(0.0, 0.0, 1.0);
          vec3 gOff = vec3(0.0);
          // World-space phase so the grid can follow the camera without the waves sliding.
          vec3 gWorld = (modelMatrix * vec4(position, 1.0)).xyz;
          ${sum}
          vec3 objectNormal = normalize(cross(gB, gT));`,
        )
        .replace('#include <begin_vertex>', 'vec3 transformed = position + gOff;');
    };
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.y = level;
    this.mesh.receiveShadow = true;
    this.mesh.name = 'ocean';
  }

  update(dt: number, camera: THREE.Camera): void {
    this.uniforms.uTime.value += dt;
    // Keep the detailed grid under the camera.
    this.mesh.position.x = Math.round(camera.position.x / 40) * 40;
    this.mesh.position.z = Math.round(camera.position.z / 40) * 40;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.removeFromParent();
  }
}
