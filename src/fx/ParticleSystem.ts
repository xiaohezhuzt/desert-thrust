import * as THREE from 'three';

/**
 * Pooled CPU particles drawn as one THREE.Points with soft round sprites.
 * No per-frame allocation; dead particles are swap-removed.
 */
export class ParticleSystem {
  readonly points: THREE.Points;
  private readonly max: number;
  private count = 0;

  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly size0: Float32Array;
  private readonly size1: Float32Array;
  private readonly rgb: Float32Array;
  private readonly alpha0: Float32Array;

  private readonly posAttr: THREE.BufferAttribute;
  private readonly colorAttr: THREE.BufferAttribute;
  private readonly sizeAttr: THREE.BufferAttribute;
  private readonly material: THREE.ShaderMaterial;

  constructor(max: number, additive: boolean) {
    this.max = Math.max(1, max);
    const n = this.max;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.age = new Float32Array(n);
    this.life = new Float32Array(n);
    this.size0 = new Float32Array(n);
    this.size1 = new Float32Array(n);
    this.rgb = new Float32Array(n * 3);
    this.alpha0 = new Float32Array(n);

    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.colorAttr = new THREE.BufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aColor', this.colorAttr);
    geo.setAttribute('aSize', this.sizeAttr);
    geo.setDrawRange(0, 0);

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uScale: { value: 500 } },
      vertexShader: /* glsl */ `
        attribute vec4 aColor;
        attribute float aSize;
        uniform float uScale;
        varying vec4 vColor;
        void main() {
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(-mv.z, 0.1);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec4 vColor;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = smoothstep(1.0, 0.0, d);
          gl_FragColor = vec4(vColor.rgb, vColor.a * a * a);
        }`,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  /** Pixel scale for size attenuation: viewport height / (2 tan(fov/2)). */
  setViewport(heightPx: number, fovDeg: number): void {
    this.material.uniforms.uScale!.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
  }

  emit(
    px: number,
    py: number,
    pz: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    size0: number,
    size1: number,
    r: number,
    g: number,
    b: number,
    alpha: number,
  ): void {
    if (this.count >= this.max) return;
    const i = this.count++;
    const i3 = i * 3;
    this.pos[i3] = px;
    this.pos[i3 + 1] = py;
    this.pos[i3 + 2] = pz;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
    this.age[i] = 0;
    this.life[i] = life;
    this.size0[i] = size0;
    this.size1[i] = size1;
    this.rgb[i3] = r;
    this.rgb[i3 + 1] = g;
    this.rgb[i3 + 2] = b;
    this.alpha0[i] = alpha;
  }

  update(dt: number, drag: number, gravity: number): void {
    const damp = Math.exp(-drag * dt);
    const p = this.posAttr.array as Float32Array;
    const c = this.colorAttr.array as Float32Array;
    const s = this.sizeAttr.array as Float32Array;
    let i = 0;
    while (i < this.count) {
      this.age[i]! += dt;
      if (this.age[i]! >= this.life[i]!) {
        this.kill(i);
        continue;
      }
      const i3 = i * 3;
      this.vel[i3] = this.vel[i3]! * damp;
      this.vel[i3 + 1] = this.vel[i3 + 1]! * damp + gravity * dt;
      this.vel[i3 + 2] = this.vel[i3 + 2]! * damp;
      this.pos[i3] = this.pos[i3]! + this.vel[i3]! * dt;
      this.pos[i3 + 1] = Math.max(this.pos[i3 + 1]! + this.vel[i3 + 1]! * dt, 0.05);
      this.pos[i3 + 2] = this.pos[i3 + 2]! + this.vel[i3 + 2]! * dt;

      const t = this.age[i]! / this.life[i]!;
      p[i3] = this.pos[i3]!;
      p[i3 + 1] = this.pos[i3 + 1]!;
      p[i3 + 2] = this.pos[i3 + 2]!;
      const i4 = i * 4;
      c[i4] = this.rgb[i3]!;
      c[i4 + 1] = this.rgb[i3 + 1]!;
      c[i4 + 2] = this.rgb[i3 + 2]!;
      // Quick fade-in, smooth fade-out.
      c[i4 + 3] = this.alpha0[i]! * Math.min(1, t * 8) * (1 - t) * (1 - t);
      s[i] = this.size0[i]! + (this.size1[i]! - this.size0[i]!) * t;
      i++;
    }
    this.posAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.points.geometry.setDrawRange(0, this.count);
  }

  clear(): void {
    this.count = 0;
    this.points.geometry.setDrawRange(0, 0);
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
    this.points.removeFromParent();
  }

  private kill(i: number): void {
    const last = --this.count;
    if (i === last) return;
    const i3 = i * 3;
    const l3 = last * 3;
    for (let k = 0; k < 3; k++) {
      this.pos[i3 + k] = this.pos[l3 + k]!;
      this.vel[i3 + k] = this.vel[l3 + k]!;
      this.rgb[i3 + k] = this.rgb[l3 + k]!;
    }
    this.age[i] = this.age[last]!;
    this.life[i] = this.life[last]!;
    this.size0[i] = this.size0[last]!;
    this.size1[i] = this.size1[last]!;
    this.alpha0[i] = this.alpha0[last]!;
  }
}
