import * as THREE from 'three';
import type { Surface } from '../config/tuning';
import { ParticleSystem } from './ParticleSystem';

export interface WheelContact {
  readonly grounded: boolean;
  readonly surface: Surface;
  readonly contact: THREE.Vector3;
  /** sideways slip speed, m/s */
  readonly slip: number;
  readonly front: boolean;
}

const DUST: Partial<Record<Surface, [number, number, number]>> = {
  hardSand: [0.86, 0.72, 0.52],
  softSand: [0.9, 0.76, 0.55],
  wetSand: [0.7, 0.6, 0.45],
  dirt: [0.62, 0.5, 0.38],
  snow: [0.95, 0.97, 1.0],
  ice: [0.85, 0.92, 1.0],
};

const MARK_SEGMENTS: Record<string, number> = { low: 240, medium: 700, high: 1400 };

/**
 * Tyre-kicked dust / sand / snow spray, water splashes, and skid marks on
 * hard surfaces. Pools sized by quality tier; no per-frame allocation.
 */
export class GroundFX {
  readonly particles: ParticleSystem;
  readonly marks: THREE.Mesh;
  private readonly markPos: Float32Array;
  private readonly markAttr: THREE.BufferAttribute;
  private readonly maxMarks: number;
  private markHead = 0;
  private readonly lastMark: (THREE.Vector3 | null)[] = [null, null, null, null];
  private carry = 0;

  constructor(scene: THREE.Scene, maxParticles: number, tier: 'low' | 'medium' | 'high') {
    this.particles = new ParticleSystem(Math.floor(maxParticles * 0.5), false);
    scene.add(this.particles.points);
    this.maxMarks = MARK_SEGMENTS[tier]!;
    this.markPos = new Float32Array(this.maxMarks * 6 * 3);
    const geo = new THREE.BufferGeometry();
    this.markAttr = new THREE.BufferAttribute(this.markPos, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.markAttr);
    this.marks = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color: 0x111111,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      }),
    );
    this.marks.frustumCulled = false;
    this.marks.renderOrder = 1;
    scene.add(this.marks);
  }

  setViewport(h: number, fov: number): void {
    this.particles.setViewport(h, fov);
  }

  clearMarks(): void {
    this.markPos.fill(0);
    this.markAttr.needsUpdate = true;
    this.lastMark.fill(null);
  }

  update(dt: number, wheels: readonly WheelContact[], speed: number, waterDepth: number, right: THREE.Vector3): void {
    if (dt <= 0) return;
    this.carry += dt * 60;
    const n = Math.floor(this.carry);
    this.carry -= n;
    const v = Math.abs(speed);
    wheels.forEach((w, i) => {
      if (!w.grounded) {
        this.lastMark[i] = null;
        return;
      }
      const dust = DUST[w.surface];
      const kick = Math.min(1, v / 30 + w.slip / 6);
      if (dust && !w.front && kick > 0.15) {
        for (let k = 0; k < n; k++) {
          if (Math.random() > kick) continue;
          this.particles.emit(
            w.contact.x + (Math.random() - 0.5) * 0.4,
            w.contact.y + 0.15,
            w.contact.z + (Math.random() - 0.5) * 0.4,
            (Math.random() - 0.5) * 2,
            0.8 + Math.random() * 1.5,
            (Math.random() - 0.5) * 2,
            0.7 + Math.random() * 0.8,
            0.4,
            w.surface === 'snow' ? 2.4 : 1.9,
            dust[0],
            dust[1],
            dust[2],
            0.35 * kick,
          );
        }
      }
      if (waterDepth > 0.05 && v > 3) {
        for (let k = 0; k < n * 2; k++) {
          const side = Math.random() < 0.5 ? -1 : 1;
          this.particles.emit(
            w.contact.x,
            w.contact.y + 0.2,
            w.contact.z,
            right.x * side * (2 + Math.random() * 3),
            2 + Math.random() * 3 * Math.min(1, v / 20),
            right.z * side * (2 + Math.random() * 3),
            0.6 + Math.random() * 0.4,
            0.3,
            1.2,
            0.85,
            0.93,
            1.0,
            0.5,
          );
        }
      }
      // Skid marks when sliding hard on a firm surface.
      const firm = w.surface === 'asphalt' || w.surface === 'wet' || w.surface === 'ice' || w.surface === 'hardSand';
      if (!w.front && firm && w.slip > 3.5) {
        const last = this.lastMark[i];
        if (last && last.distanceToSquared(w.contact) > 0.25) {
          this.addMark(last, w.contact, right);
          last.copy(w.contact);
        } else if (!last) {
          this.lastMark[i] = w.contact.clone();
        }
      } else {
        this.lastMark[i] = null;
      }
    });
    this.particles.update(dt, 1.8, -2.5);
  }

  private addMark(a: THREE.Vector3, b: THREE.Vector3, right: THREE.Vector3): void {
    const hw = 0.14;
    const o = this.markHead * 18;
    const lift = 0.03;
    const ax1 = a.x - right.x * hw;
    const az1 = a.z - right.z * hw;
    const ax2 = a.x + right.x * hw;
    const az2 = a.z + right.z * hw;
    const bx1 = b.x - right.x * hw;
    const bz1 = b.z - right.z * hw;
    const bx2 = b.x + right.x * hw;
    const bz2 = b.z + right.z * hw;
    this.markPos.set(
      [ax1, a.y + lift, az1, ax2, a.y + lift, az2, bx1, b.y + lift, bz1, ax2, a.y + lift, az2, bx2, b.y + lift, bz2, bx1, b.y + lift, bz1],
      o,
    );
    this.markHead = (this.markHead + 1) % this.maxMarks;
    this.markAttr.needsUpdate = true;
  }

  dispose(): void {
    this.particles.dispose();
    this.marks.geometry.dispose();
    (this.marks.material as THREE.Material).dispose();
    this.marks.removeFromParent();
  }
}
