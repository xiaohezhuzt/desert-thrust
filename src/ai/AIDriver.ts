import * as THREE from 'three';
import type { CarDef } from '../config/cars';
import { CAR_TUNING } from '../config/tuning';
import { createEmptyActions, type InputActions } from '../input/InputManager';
import type { CarController } from '../vehicle/CarController';
import { rollLandingSuccess } from './AIStuntPlanner';
import { LineTracker, type RacingLine } from './RacingLine';

/** What an AI needs to know about the other racers. */
export interface RacerView {
  readonly distance: number;
  readonly lateral: number;
  readonly car: CarController;
}

const OVERTAKE_OFFSET = 3.2;
const MAX_OFFSET = 4;

/**
 * Pure-pursuit driver: follows the racing line with a lateral offset for
 * overtaking, brakes to the speed profile (skill-scaled), times boosts,
 * handles stunts and recovers when stuck or off course. Never air-rolls for show.
 */
export class AIDriver {
  readonly actions: InputActions = createEmptyActions();
  readonly tracker: LineTracker;
  /** Set when it crosses the line; it then coasts to a stop. */
  finished = false;

  private offset = 0;
  private targetOffset = 0;
  private boostTimer = 0;
  private stuckTimer = 0;
  private offTimer = 0;
  private wasAirborne = false;
  private landingOk = true;
  private time = 0;
  /** late-braking error for this corner, metres */
  private brakeError = 0;
  private readonly seed: number;

  private readonly toTarget = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly spot = new THREE.Vector3();

  constructor(
    readonly car: CarController,
    private readonly line: RacingLine,
    readonly def: CarDef,
    private readonly skill: number,
    private readonly rubberBand: number,
    private readonly rng: () => number,
  ) {
    this.tracker = new LineTracker(line);
    this.seed = rng() * 100;
    car.airAssist = true;
  }

  /** Back to the grid / a checkpoint. */
  resetState(): void {
    this.tracker.lose();
    this.finished = false;
    this.offset = this.targetOffset = 0;
    this.boostTimer = this.stuckTimer = this.offTimer = 0;
    this.wasAirborne = false;
    this.landingOk = true;
    this.car.airAssist = true;
  }

  update(dt: number, playerDistance: number, others: readonly RacerView[]): void {
    this.time += dt;
    const car = this.car;
    const a = this.actions;
    const pos = car.simPosition;
    this.tracker.update(pos);
    const i = this.tracker.index;
    const line = this.line;
    const v = car.forwardSpeed;

    this.fwd.set(0, 0, -1).applyQuaternion(car.simQuaternion);
    this.right.set(1, 0, 0).applyQuaternion(car.simQuaternion);
    this.up.set(0, 1, 0).applyQuaternion(car.simQuaternion);

    a.roll = 0;
    a.pitch = 0;
    a.jump = false;
    a.handbrake = false;
    if (this.finished) {
      a.throttle = 0;
      a.boost = false;
      a.steer *= 0.9;
      // Brake only while rolling forward; holding brake at a standstill would select reverse.
      a.brake = v > 1 ? 0.6 : 0;
      a.handbrake = v <= 1;
      return;
    }

    // ---- Air: no stunts, just decide whether this landing works out.
    if (car.airborne) {
      if (!this.wasAirborne) {
        this.landingOk = rollLandingSuccess(this.skill, this.def.ai.landingStability, this.rng);
        car.airAssist = this.landingOk;
      }
      this.wasAirborne = true;
      // Recovering from an inverted loop exit when the landing is going to work.
      if (this.landingOk && this.up.y < 0) a.roll = this.right.y > 0 ? 1 : -1;
      a.steer = 0;
      a.throttle = 1;
      a.brake = 0;
      // Long gaps: push across with the rear jets, hover when dropping.
      const assist = line.airAssist[i] === 1;
      a.boost = assist && car.energy > 0;
      a.jump = assist && car.body.linvel().y < -1 && car.energy > 5;
      return;
    }
    if (this.wasAirborne) {
      this.wasAirborne = false;
      car.airAssist = true;
    }

    // ---- Overtaking: move over when someone is close ahead on our line.
    const locked = line.locked[i] === 1;
    let blocker: RacerView | null = null;
    for (const o of others) {
      if (o.car === car) continue;
      const gap = o.distance - this.tracker.distance;
      if (gap > 0 && gap < 22 && Math.abs(o.lateral - this.offset) < 2.6) {
        if (!blocker || gap < blocker.distance - this.tracker.distance) blocker = o;
      }
    }
    if (locked) this.targetOffset = 0;
    else if (blocker) {
      const side = blocker.lateral > 0 ? -1 : 1;
      const want = blocker.lateral + side * OVERTAKE_OFFSET * (0.7 + 0.3 * this.def.ai.aggression);
      this.targetOffset = THREE.MathUtils.clamp(want, -MAX_OFFSET, MAX_OFFSET);
    } else {
      this.targetOffset *= Math.exp(-0.4 * dt);
    }
    this.offset += THREE.MathUtils.clamp(this.targetOffset - this.offset, -2.5 * dt, 2.5 * dt);

    // ---- Steering: pure pursuit to a look-ahead point.
    const look = THREE.MathUtils.clamp(7 + Math.abs(v) * 0.42, 9, 38);
    const j = line.ahead(i, look);
    this.spot.copy(line.points[j]!).addScaledVector(line.right[j]!, this.offset);
    this.toTarget.subVectors(this.spot, pos);
    const lx = this.toTarget.dot(this.right);
    const lz = this.toTarget.dot(this.fwd);
    const angle = Math.atan2(lx, Math.max(lz, 0.1));
    const speedFrac = Math.min(Math.abs(v) / car.perf.maxSpeed, 1);
    const steerLimit =
      CAR_TUNING.maxSteerAngle * car.perf.steerScale * THREE.MathUtils.lerp(1, CAR_TUNING.highSpeedSteerFactor, speedFrac);
    const wobble = Math.sin(this.time * 1.7 + this.seed) * 0.06 * (1 - this.skill);
    a.steer = car.onAdhesive ? 0 : THREE.MathUtils.clamp(angle / steerLimit + wobble, -1, 1);
    a.handbrake = !locked && this.def.ai.drift > 0.6 && Math.abs(angle) > 0.35 && v > 18;

    // ---- Speed: profile × skill × rubber band; late-braking errors for weaker drivers.
    if (this.rng() < dt * 0.5) this.brakeError = this.rng() * (1 - this.skill) * 14;
    const bi = line.ahead(i, 4 + this.brakeError);
    const profile = line.maxSpeed[bi]!;
    const skillScale = 0.5 + 0.5 * this.skill;
    const gap = this.tracker.distance - playerDistance;
    const band = gap > 0 ? 1 - this.rubberBand * 0.45 * Math.min(gap / 100, 1) : 1 + this.rubberBand * 0.12 * Math.min(-gap / 150, 1);
    let target = Math.min(profile * skillScale * band, car.perf.maxSpeed * (0.6 + 0.4 * this.skill) * band);
    target = Math.max(target, line.minSpeed[i]!, line.minSpeed[bi]!);
    const err = target - v;
    a.throttle = err > -0.5 ? THREE.MathUtils.clamp(0.35 + err * 0.25, 0, 1) : 0;
    a.brake = err < -2.5 ? THREE.MathUtils.clamp(-err / 8, 0.25, 1) : 0;

    // ---- Boost: on straights when well under target, or to make a stunt speed.
    const needStunt = v < line.minSpeed[bi]! - 1;
    // Save the tank for a long gap ahead: it needs boost + hover in the air.
    const reserve = line.gapAhead[i]! < 450 && !needStunt;
    this.boostTimer = Math.max(0, this.boostTimer - dt);
    if (
      !reserve &&
      this.boostTimer === 0 &&
      car.energy > 35 &&
      (needStunt || (err > 7 && this.rng() < dt * (0.4 + this.def.ai.boostHappiness * this.skill * 1.5)))
    ) {
      this.boostTimer = 0.8 + this.rng() * 1.4;
    }
    a.boost = this.boostTimer > 0 && (err > 1 || needStunt) && car.energy > 0 && (!reserve || needStunt);

    // ---- Occasional show-off hop on long straights.
    const far = line.ahead(i, 160);
    const flatStraight =
      Math.abs(line.points[far]!.y - pos.y) < 2 && line.maxSpeed[far]! > 60 && line.maxSpeed[line.ahead(i, 80)]! > 60;
    if (
      !reserve &&
      !locked &&
      flatStraight &&
      err > -2 &&
      profile > 60 &&
      car.energy > 60 &&
      this.rng() < dt * 0.02 * (0.5 + this.def.ai.aggression)
    ) {
      a.jump = true;
    }

    // ---- Recovery: stuck, or wandered off the course.
    this.stuckTimer = Math.abs(v) < 1.5 ? this.stuckTimer + dt : 0;
    const off = line.points[i]!.distanceTo(pos);
    this.offTimer = off > 24 ? this.offTimer + dt : 0;
    if (this.stuckTimer > 3 || this.offTimer > 2) this.recover(i);
  }

  /** Put the car back on the racing line, a little behind where it was. */
  /** Put the car back on the line now (fell off / sank). */
  recoverNow(): void {
    const line = this.line;
    let i = this.tracker.index < 0 ? 0 : this.tracker.index;
    // Fell off a stunt: go back before it and try again (no free crossing).
    const d0 = line.distances[i]!;
    for (let k = i; k >= 0 && d0 - line.distances[k]! < 400; k--) {
      if (line.locked[k]) {
        while (k > 0 && line.locked[k]) k--;
        i = Math.max(0, k - 20);
        break;
      }
    }
    this.recover(i);
  }

  private recover(index: number): void {
    const k = Math.max(0, index - 10);
    const p = this.line.points[k]!.clone();
    p.y = Math.max(0, p.y);
    if (this.line.locked[k]) {
      // Never drop a car onto a loop; back off to the approach.
      let m = k;
      while (m > 0 && this.line.locked[m]) m--;
      p.copy(this.line.points[Math.max(0, m - 30)]!);
    }
    this.car.respawn(p, this.line.headingAt(this.line.nearest(p, -1)));
    this.resetState();
  }
}
