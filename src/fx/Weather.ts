import * as THREE from 'three';

export type WeatherKind = 'snow' | 'rain';

const BOX = new THREE.Vector3(60, 30, 60);

/**
 * Camera-following precipitation. Snow is soft drifting points; rain is
 * slanted streaks. Particle count comes from the quality tier.
 */
export class Weather {
  readonly object: THREE.Object3D;
  private readonly pos: Float32Array;
  private readonly speed: Float32Array;
  private readonly attr: THREE.BufferAttribute;
  private time = 0;

  constructor(
    private readonly kind: WeatherKind,
    private readonly count: number,
  ) {
    const verts = kind === 'rain' ? count * 2 : count;
    this.pos = new Float32Array(verts * 3);
    this.speed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * BOX.x;
      const y = Math.random() * BOX.y;
      const z = (Math.random() - 0.5) * BOX.z;
      this.speed[i] = kind === 'rain' ? 22 + Math.random() * 8 : 1.2 + Math.random() * 1.4;
      this.write(i, x, y, z);
    }
    const geo = new THREE.BufferGeometry();
    this.attr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.attr);
    if (kind === 'rain') {
      this.object = new THREE.LineSegments(
        geo,
        new THREE.LineBasicMaterial({ color: 0x9fb4d8, transparent: true, opacity: 0.45, depthWrite: false, fog: true }),
      );
    } else {
      this.object = new THREE.Points(
        geo,
        new THREE.PointsMaterial({ color: 0xffffff, size: 0.18, transparent: true, opacity: 0.85, depthWrite: false }),
      );
    }
    this.object.frustumCulled = false;
  }

  private write(i: number, x: number, y: number, z: number): void {
    if (this.kind === 'rain') {
      this.pos.set([x, y, z, x - 0.12, y + 0.9, z - 0.05], i * 6);
    } else {
      this.pos.set([x, y, z], i * 3);
    }
  }

  update(dt: number, camera: THREE.Camera): void {
    this.time += dt;
    const cx = camera.position.x;
    const cy = camera.position.y;
    const cz = camera.position.z;
    const stride = this.kind === 'rain' ? 6 : 3;
    for (let i = 0; i < this.count; i++) {
      const k = i * stride;
      let x = this.pos[k]!;
      let y = this.pos[k + 1]! - this.speed[i]! * dt;
      let z = this.pos[k + 2]!;
      if (this.kind === 'snow') {
        x += Math.sin(this.time * 0.7 + i) * 0.4 * dt;
        z += Math.cos(this.time * 0.5 + i * 1.3) * 0.4 * dt;
      } else {
        x += 2.5 * dt;
      }
      // Wrap inside a box that travels with the camera.
      if (y < cy - BOX.y * 0.4) y += BOX.y;
      if (x < cx - BOX.x / 2) x += BOX.x;
      if (x > cx + BOX.x / 2) x -= BOX.x;
      if (z < cz - BOX.z / 2) z += BOX.z;
      if (z > cz + BOX.z / 2) z -= BOX.z;
      this.write(i, x, y, z);
    }
    this.attr.needsUpdate = true;
  }

  dispose(): void {
    const o = this.object as THREE.Points | THREE.LineSegments;
    o.geometry.dispose();
    (o.material as THREE.Material).dispose();
    o.removeFromParent();
  }
}
