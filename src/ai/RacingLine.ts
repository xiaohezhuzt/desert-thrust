import * as THREE from 'three';
import type { LevelDef } from '../config/levels';
import type { TrackLine } from '../world/Level';
import { planStuntSpeeds } from './AIStuntPlanner';

/** Comfortable cornering acceleration for the speed profile, m/s². */
const LATERAL_ACCEL = 10.5;
/** Braking used when back-propagating corner speeds, m/s². */
const BRAKE_DECEL = 9;
const NO_LIMIT = 200;

/**
 * The level's ideal line with a precomputed target-speed profile:
 * corner limits from horizontal curvature, braking zones propagated backwards,
 * and minimum speeds from the stunt planner (ramps, loops).
 */
export class RacingLine {
  readonly points: THREE.Vector3[];
  readonly distances: number[];
  readonly length: number;
  /** horizontal right vector at each sample */
  readonly right: THREE.Vector3[];
  /** target speed before driver skill scaling */
  readonly maxSpeed: Float32Array;
  /** speed the planner insists on (stunt approaches) */
  readonly minSpeed: Float32Array;
  /** samples where the car must hold its line (ramps, loops) */
  readonly locked: Uint8Array;
  /** samples over long gaps: boost / hover while airborne */
  readonly airAssist: Uint8Array;
  /** metres to the next long-gap section (Infinity if none ahead) */
  readonly gapAhead: Float32Array;

  constructor(line: TrackLine, def: LevelDef) {
    this.points = line.points;
    this.distances = line.distances;
    this.length = line.length;
    const n = this.points.length;
    this.right = [];
    const t = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      t.subVectors(this.points[Math.min(i + 1, n - 1)]!, this.points[Math.max(i - 1, 0)]!).setY(0).normalize();
      this.right.push(new THREE.Vector3(-t.z, 0, t.x));
    }

    this.maxSpeed = new Float32Array(n).fill(NO_LIMIT);
    const span = 8;
    for (let i = 0; i < n; i++) {
      const p = this.points[i]!;
      const a = this.points[Math.max(i - span, 0)]!;
      const b = this.points[Math.min(i + span, n - 1)]!;
      // Steep sections are ramps / loops / flights, not corners: no corner limit there.
      const run = Math.hypot(b.x - a.x, b.z - a.z);
      if (Math.abs(b.y - a.y) > Math.max(run, 1) * 0.22 || Math.abs(p.y - (a.y + b.y) / 2) > 1.5) continue;
      const h0 = Math.atan2(p.x - a.x, p.z - a.z);
      const h1 = Math.atan2(b.x - p.x, b.z - p.z);
      let dh = Math.abs(h1 - h0);
      if (dh > Math.PI) dh = Math.PI * 2 - dh;
      const ds = Math.max(this.distances[Math.min(i + span, n - 1)]! - this.distances[Math.max(i - span, 0)]!, 1);
      const k = dh / ds;
      if (k > 1e-4) this.maxSpeed[i] = Math.min(NO_LIMIT, Math.sqrt(LATERAL_ACCEL / k));
    }

    const plan = planStuntSpeeds(def, this);
    this.minSpeed = plan.minSpeed;
    this.locked = plan.locked;
    this.airAssist = plan.airAssist;
    this.gapAhead = new Float32Array(n).fill(Infinity);
    let next = Infinity;
    for (let i = n - 1; i >= 0; i--) {
      if (this.airAssist[i]) next = this.distances[i]!;
      this.gapAhead[i] = next - this.distances[i]!;
    }
    for (let i = 0; i < n; i++) {
      this.maxSpeed[i] = Math.min(Math.max(this.maxSpeed[i]!, this.minSpeed[i]!), plan.maxSpeed[i]!);
    }

    // Backward pass: start braking early enough for each corner.
    for (let i = n - 2; i >= 0; i--) {
      const ds = this.distances[i + 1]! - this.distances[i]!;
      const reach = Math.sqrt(this.maxSpeed[i + 1]! ** 2 + 2 * BRAKE_DECEL * ds);
      if (reach < this.maxSpeed[i]!) this.maxSpeed[i] = Math.max(reach, this.minSpeed[i]!);
    }
  }

  /** Nearest sample to `pos`, searching `back` behind and `ahead` beyond `hint` (or everywhere if hint < 0). */
  nearest(pos: THREE.Vector3, hint: number, back = 20, ahead = 60): number {
    const n = this.points.length;
    const from = hint < 0 ? 0 : Math.max(0, hint - back);
    const to = hint < 0 ? n : Math.min(n, hint + ahead);
    let best = Infinity;
    let bi = Math.max(hint, 0);
    for (let i = from; i < to; i++) {
      const d = this.points[i]!.distanceToSquared(pos);
      if (d < best) {
        best = d;
        bi = i;
      }
    }
    return bi;
  }

  /** Index `meters` further along from `index`. */
  ahead(index: number, meters: number): number {
    const target = this.distances[index]! + meters;
    let i = index;
    while (i < this.points.length - 1 && this.distances[i]! < target) i++;
    return i;
  }

  /** Heading (radians about +Y, 0 = toward -Z) of the line at `index`. */
  headingAt(index: number): number {
    // right = (-f.z, 0, f.x)  =>  forward = (r.z, 0, -r.x); heading h has forward (-sin h, 0, -cos h).
    const r = this.right[index]!;
    return Math.atan2(-r.z, r.x);
  }
}

/** Follows one car along a racing line: progress distance and lateral offset. */
export class LineTracker {
  index = -1;
  distance = 0;
  lateral = 0;
  private readonly tmp = new THREE.Vector3();

  constructor(private readonly line: RacingLine) {}

  /** Forget the last index (after a teleport). */
  lose(): void {
    this.index = -1;
  }

  update(pos: THREE.Vector3): void {
    this.index = this.line.nearest(pos, this.index);
    this.distance = this.line.distances[this.index]!;
    this.lateral = this.tmp.subVectors(pos, this.line.points[this.index]!).dot(this.line.right[this.index]!);
  }

  get progress(): number {
    return this.distance / this.line.length;
  }
}
