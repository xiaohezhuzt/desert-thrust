import * as THREE from 'three';
import { STUNT_TUNING as S } from '../config/tuning';
import type { CarController } from './CarController';

export type LandingGrade = 'PERFECT' | 'GOOD' | 'BAD' | 'CRASH';

export interface LandingResult {
  grade: LandingGrade;
  airTime: number;
  /** body-to-ground angle at touchdown, degrees */
  angle: number;
  /** horizontal speed after / before touchdown */
  retention: number;
}

/** How long after first contact we keep collecting wheel touches before grading. */
const JUDGE_WINDOW = 0.25;
const ALL_WHEELS_WINDOW = 0.15;

/**
 * Grades every landing after a real jump:
 * PERFECT — 4 wheels within 0.15 s, < 10°, ≥ 85 % speed kept
 * GOOD    — < 25°, chassis clean, ≥ 60 % speed kept
 * BAD     — < 40° or a light scrape
 * CRASH   — roof / side first or ≥ 40°
 */
export class LandingJudge {
  private airTime = 0;
  private speedBefore = 0;
  private judging = false;
  private t = 0;
  private angle = 0;
  private allTouchedAt = -1;
  private scraped = false;
  private flipped = false;
  private readonly seen = [false, false, false, false];
  private landedAirTime = 0;
  /** Set after a chassis-first crash so lying on the roof doesn't re-report every frame. */
  private crashLatched = false;

  /** Forget the current flight (after a teleport / reset). */
  reset(): void {
    this.airTime = 0;
    this.judging = false;
    this.crashLatched = false;
  }

  update(dt: number, car: CarController): LandingResult | null {
    if (!this.judging) {
      if (car.airborne) {
        this.airTime += dt;
        this.speedBefore = car.horizontalSpeed;
        // Chassis-first impact while no wheel has touched yet.
        if (!this.crashLatched && this.airTime >= S.minGradedAirTime && car.chassisTouching() && car.upVector.y < 0.5) {
          this.crashLatched = true;
          return this.finish('CRASH', 90, 0);
        }
        return null;
      }
      const air = this.airTime;
      this.airTime = 0;
      this.crashLatched = false;
      if (air < S.minGradedAirTime) return null;
      this.judging = true;
      this.landedAirTime = air;
      this.t = 0;
      this.allTouchedAt = -1;
      this.scraped = false;
      this.flipped = false;
      this.seen.fill(false);
      this.angle = THREE.MathUtils.radToDeg(car.upVector.angleTo(car.groundNormal));
    }

    this.t += dt;
    for (let i = 0; i < 4; i++) if (car.isWheelGrounded(i)) this.seen[i] = true;
    if (this.allTouchedAt < 0 && this.seen.every(Boolean)) this.allTouchedAt = this.t;
    if (car.chassisTouching()) this.scraped = true;
    if (car.upVector.y < 0.3) this.flipped = true;
    if (this.t < JUDGE_WINDOW) return null;

    const retention = this.speedBefore > 1 ? car.horizontalSpeed / this.speedBefore : 1;
    let grade: LandingGrade;
    if (this.flipped || this.angle >= 40) grade = 'CRASH';
    else if (this.scraped) grade = this.angle < 25 ? 'BAD' : 'CRASH';
    else if (
      this.angle < 10 &&
      this.allTouchedAt >= 0 &&
      this.allTouchedAt <= ALL_WHEELS_WINDOW &&
      retention >= 0.85
    )
      grade = 'PERFECT';
    else if (this.angle < 25 && retention >= 0.6) grade = 'GOOD';
    else grade = 'BAD';
    return this.finish(grade, this.angle, retention);
  }

  private finish(grade: LandingGrade, angle: number, retention: number): LandingResult {
    const air = this.judging ? this.landedAirTime : this.airTime;
    this.judging = false;
    this.airTime = 0;
    return { grade, airTime: air, angle, retention };
  }
}
