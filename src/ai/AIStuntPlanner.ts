import * as THREE from 'three';
import type { LevelDef } from '../config/levels';
import type { RacingLine } from './RacingLine';

export interface StuntSpeedPlan {
  readonly minSpeed: Float32Array;
  readonly locked: Uint8Array;
  /** samples over long gaps where the AI should boost / hover in the air */
  readonly airAssist: Uint8Array;
  /** approach speed caps so gap jumps don't overshoot the landing (Infinity = none) */
  readonly maxSpeed: Float32Array;
}

/** Take-off speed that safely clears a kicker's gap, m/s. */
const KICKER_SPEED = 30;
/** Entry speed for a half loop of radius R: enough to stay stuck at the top, with margin. */
function loopSpeed(radius: number): number {
  return Math.sqrt(2 * 9.81 * 2 * radius + 13 * 13) + 3;
}

/**
 * Turns the level's stunts into speed constraints along the racing line:
 * hold speed into ramps, carry enough into loops, and don't steer on them.
 */
export function planStuntSpeeds(def: LevelDef, line: RacingLine): StuntSpeedPlan {
  const n = line.points.length;
  const minSpeed = new Float32Array(n);
  const locked = new Uint8Array(n);
  const airAssist = new Uint8Array(n);
  const maxSpeed = new Float32Array(n).fill(Infinity);
  const pos = new THREE.Vector3();
  const mark = (center: number, before: number, after: number, speed: number, lock: boolean): void => {
    const d0 = line.distances[center]! - before;
    const d1 = line.distances[center]! + after;
    for (let i = 0; i < n; i++) {
      const d = line.distances[i]!;
      if (d < d0 || d > d1) continue;
      minSpeed[i] = Math.max(minSpeed[i]!, speed);
      if (lock && d > line.distances[center]! - 25) locked[i] = 1;
    }
  };
  for (const s of def.stunts) {
    pos.set(...s.position);
    const i = line.nearest(pos, -1);
    if (s.type === 'kicker') {
      const clear = s.params.clearDistance;
      const theta = THREE.MathUtils.degToRad(s.params.angleDeg);
      // Ballistic range v² sin 2θ / g, with margin; capped (beyond that it boosts / hovers mid-air).
      const need =
        s.params.approachSpeed ?? (clear ? Math.min(Math.sqrt((clear * 9.81) / Math.sin(2 * theta)) * 1.12, 62) : KICKER_SPEED);
      // Only hold the approach speed on the straight run-up (don't force it through a bend before it).
      let runUp = 0;
      const h0 = line.right[i]!;
      for (let k = i; k > 0 && runUp < 160; k--) {
        if (line.right[k]!.dot(h0) < 0.985) break;
        runUp = line.distances[i]! - line.distances[k]!;
      }
      mark(i, Math.max(40, runUp), s.params.length + 5, s.params.approachSpeed ?? Math.max(KICKER_SPEED, need), true);
      if (s.params.approachSpeed || (clear && clear <= 90)) {
        // Short gaps: don't fly miles past the landing.
        const d0 = line.distances[i]!;
        for (let k = 0; k < n; k++) {
          const d = line.distances[k]!;
          if (d > d0 - Math.max(40, runUp) && d < d0 + s.params.length) maxSpeed[k] = (s.params.approachSpeed ?? Math.max(KICKER_SPEED, need)) * (s.params.approachSpeed ? 1.12 : 1.3);
        }
      }
      if (clear && clear > 90) {
        const d0 = line.distances[i]!;
        for (let k = 0; k < n; k++) {
          const d = line.distances[k]!;
          if (d > d0 && d < d0 + s.params.length + clear + 20) airAssist[k] = 1;
        }
      }
    } else if (s.type === 'invertedHalfLoop' || s.type === 'fullLoop') {
      const arc = s.type === 'fullLoop' ? Math.PI * 2 : Math.PI;
      const v = loopSpeed(s.params.radius);
      mark(i, 140, arc * s.params.radius + s.params.entryLength * 2, v, true);
      const d0 = line.distances[i]!;
      for (let k = 0; k < n; k++) {
        const d = line.distances[k]!;
        if (d > d0 - 140 && d < d0 + arc * s.params.radius + 20) maxSpeed[k] = Math.min(maxSpeed[k]!, v * 1.18);
      }
    } else if (s.type === 'carRow') {
      mark(i, 60, 20, KICKER_SPEED, true);
    }
  }
  return { minSpeed, locked, airAssist, maxSpeed };
}

/** Does this AI stick the landing this time? Better drivers and stable cars crash less. */
export function rollLandingSuccess(skill: number, stability: number, rng: () => number): boolean {
  const p = THREE.MathUtils.clamp(0.55 + 0.38 * skill + 0.15 * stability, 0, 0.98);
  return rng() < p;
}
