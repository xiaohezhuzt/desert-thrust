import * as THREE from 'three';
import { ParticleSystem } from '../fx/ParticleSystem';
import type { ThrustState } from './CarController';
import type { CarNozzles, Nozzle } from './CarModelFactory';

interface Flame {
  readonly nozzle: Nozzle;
  readonly group: THREE.Group;
  readonly outer: THREE.Mesh;
  readonly core: THREE.Mesh;
  level: number;
}

type Channel = keyof ThrustState;

const FLAME_LENGTH: Record<Channel, number> = { rear: 1.9, down: 1.1, left: 0.55, right: 0.55 };
const FLAME_RADIUS: Record<Channel, number> = { rear: 0.058, down: 0.08, left: 0.045, right: 0.045 };

/**
 * Cold-gas thrusters that look like real compressed air: a faint white condensation
 * cone at each hidden nozzle, a dense white vapour plume that expands, slows and
 * drifts up as it fades, lingering mist, and dust / spray kicked up under the hover jets.
 */
export class Thrusters {
  readonly jets: ParticleSystem;
  readonly mist: ParticleSystem;
  private readonly flames: Record<Channel, Flame[]> = { rear: [], down: [], left: [], right: [] };
  private readonly outerMat: THREE.MeshBasicMaterial;
  private readonly coreMat: THREE.MeshBasicMaterial;
  private readonly flameGeo: THREE.ConeGeometry;

  private readonly wp = new THREE.Vector3();
  private readonly wd = new THREE.Vector3();
  private readonly carVel = new THREE.Vector3();
  private readonly lastPos = new THREE.Vector3();
  private hasLast = false;
  private emitCarry = 0;
  private time = 0;

  constructor(
    scene: THREE.Scene,
    carRoot: THREE.Object3D,
    nozzles: CarNozzles,
    maxParticles: number,
  ) {
    this.jets = new ParticleSystem(Math.floor(maxParticles * 0.55), false);
    this.mist = new ParticleSystem(Math.floor(maxParticles * 0.45), false);
    scene.add(this.jets.points, this.mist.points);

    // Cone along +Y with its base at the origin, so scaling Y stretches the flame out of the nozzle.
    this.flameGeo = new THREE.ConeGeometry(1, 1, 14, 1, true);
    this.flameGeo.rotateX(Math.PI);
    this.flameGeo.translate(0, 0.5, 0);
    this.outerMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.93, 0.95, 0.97),
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.coreMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(1, 1, 1),
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const up = new THREE.Vector3(0, 1, 0);
    for (const ch of ['rear', 'down', 'left', 'right'] as const) {
      for (const n of nozzles[ch]) {
        const group = new THREE.Group();
        group.position.copy(n.position);
        group.quaternion.setFromUnitVectors(up, n.dir);
        const outer = new THREE.Mesh(this.flameGeo, this.outerMat);
        const core = new THREE.Mesh(this.flameGeo, this.coreMat);
        group.add(outer, core);
        group.visible = false;
        carRoot.add(group);
        this.flames[ch].push({ nozzle: n, group, outer, core, level: 0 });
      }
    }
  }

  setViewport(heightPx: number, fovDeg: number): void {
    this.jets.setViewport(heightPx, fovDeg);
    this.mist.setViewport(heightPx, fovDeg);
  }

  /** Teleports (resets) must not leave a streak of particles. */
  resetTrail(): void {
    this.hasLast = false;
  }

  /**
   * @param groundY height of the ground under the car, or null if it is far below.
   */
  update(dt: number, thrust: ThrustState, carRoot: THREE.Object3D, groundY: number | null): void {
    if (dt <= 0) return;
    this.time += dt;
    carRoot.updateMatrixWorld();

    // Car velocity from the rendered pose (cheap, no physics query).
    if (this.hasLast) this.carVel.subVectors(carRoot.position, this.lastPos).divideScalar(dt);
    else this.carVel.set(0, 0, 0);
    this.lastPos.copy(carRoot.position);
    this.hasLast = true;

    this.emitCarry += dt * 60;
    const emits = Math.floor(this.emitCarry);
    this.emitCarry -= emits;

    for (const ch of ['rear', 'down', 'left', 'right'] as const) {
      const target = thrust[ch];
      for (const f of this.flames[ch]) {
        // Snappy ignition, quick cut-off.
        f.level += (target - f.level) * (1 - Math.exp(-(target > f.level ? 25 : 12) * dt));
        const on = f.level > 0.02;
        f.group.visible = on;
        if (!on) continue;

        const flicker = 0.85 + 0.15 * Math.sin(this.time * 70 + f.nozzle.position.x * 13) + Math.random() * 0.1;
        const len = FLAME_LENGTH[ch] * f.level * flicker;
        const r = FLAME_RADIUS[ch];
        f.outer.scale.set(r, len, r);
        f.core.scale.set(r * 0.45, len * 0.6, r * 0.45);

        this.wp.copy(f.nozzle.position).applyMatrix4(carRoot.matrixWorld);
        this.wd.copy(f.nozzle.dir).transformDirection(carRoot.matrixWorld);
        for (let k = 0; k < emits; k++) this.emitJet(ch, f.level);
        if (ch === 'down' && groundY !== null) for (let k = 0; k < emits; k++) this.emitGroundSpray(f.level, groundY);
      }
    }

    // Strong drag: the gas spreads and stalls behind the car; warm vapour rises a little.
    this.jets.update(dt, 4.2, 0.5);
    this.mist.update(dt, 1.8, 0.9);
  }

  private emitJet(ch: Channel, level: number): void {
    const speed = ch === 'rear' ? 28 : ch === 'down' ? 18 : 10;
    const j = 2.4;
    const vx = this.carVel.x + this.wd.x * speed * level + (Math.random() - 0.5) * j;
    const vy = this.carVel.y + this.wd.y * speed * level + (Math.random() - 0.5) * j;
    const vz = this.carVel.z + this.wd.z * speed * level + (Math.random() - 0.5) * j;
    const sz = ch === 'rear' ? 0.2 : 0.16;
    const shade = 0.9 + Math.random() * 0.08;
    // Dense white plume: starts as a tight jet, billows to a wide puff.
    for (let k = 0; k < 2; k++) {
      this.jets.emit(
        this.wp.x + this.wd.x * 0.1 * k,
        this.wp.y + this.wd.y * 0.1 * k,
        this.wp.z + this.wd.z * 0.1 * k,
        vx, vy, vz,
        0.35 + Math.random() * 0.3,
        sz,
        sz * (7 + Math.random() * 4),
        shade, shade + 0.02, shade + 0.04,
        0.42 * level,
      );
    }

    // Lingering vapour left hanging in the air behind the car.
    if (Math.random() < 0.7 * level) {
      const mv = speed * 0.45;
      this.mist.emit(
        this.wp.x + this.wd.x * 0.6,
        this.wp.y + this.wd.y * 0.6,
        this.wp.z + this.wd.z * 0.6,
        this.carVel.x * 0.6 + this.wd.x * mv + (Math.random() - 0.5) * 2,
        this.carVel.y * 0.6 + this.wd.y * mv + (Math.random() - 0.5) * 2,
        this.carVel.z * 0.6 + this.wd.z * mv + (Math.random() - 0.5) * 2,
        1.1 + Math.random() * 0.9,
        0.5,
        3.4,
        0.9,
        0.91,
        0.93,
        0.22 * level,
      );
    }
  }

  /** Mist / sand blasted outward where the down-jets hit the ground. */
  private emitGroundSpray(level: number, groundY: number): void {
    const height = this.wp.y - groundY;
    if (height > 7) return;
    const strength = level * (1 - height / 7);
    if (Math.random() > strength) return;
    const a = Math.random() * Math.PI * 2;
    const sp = 6 + Math.random() * 8 * strength;
    this.mist.emit(
      this.wp.x + Math.cos(a) * 0.4,
      groundY + 0.15,
      this.wp.z + Math.sin(a) * 0.4,
      Math.cos(a) * sp,
      0.6 + Math.random() * 1.2,
      Math.sin(a) * sp,
      0.9 + Math.random() * 0.7,
      0.6,
      2.8,
      0.93,
      0.88,
      0.8,
      0.45 * strength,
    );
  }

  dispose(): void {
    this.jets.dispose();
    this.mist.dispose();
    this.flameGeo.dispose();
    this.outerMat.dispose();
    this.coreMat.dispose();
  }
}
