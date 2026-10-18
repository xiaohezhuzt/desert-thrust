import * as THREE from 'three';
import type { CarController } from '../vehicle/CarController';

/** 60 mph in m/s. */
export const SIXTY_MPH = 26.8224;
const COUNTDOWN = 3;

export type DragPhase = 'countdown' | 'run' | 'done';

export interface DragEvents {
  banner(text: string, sub: string, tone: 'info' | 'good' | 'bad', seconds: number): void;
  done(time: number): void;
}

/**
 * 0–60 mph sprint on the runway. The clock starts on GO (so a launch with
 * throttle held through the countdown is rewarded) and stops at 60 mph.
 */
export class DragRun {
  phase: DragPhase = 'countdown';
  time = 0;
  private countdown = COUNTDOWN;
  private lastCount = -1;

  constructor(
    private readonly car: CarController,
    private readonly start: THREE.Vector3,
    private readonly heading: number,
    private readonly events: DragEvents,
  ) {}

  get controlsLocked(): boolean {
    return this.phase === 'countdown';
  }

  restart(): void {
    this.phase = 'countdown';
    this.time = 0;
    this.countdown = COUNTDOWN;
    this.lastCount = -1;
    this.car.setSpawn(this.start, this.heading);
  }

  step(dt: number): void {
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      const n = Math.ceil(this.countdown);
      if (n !== this.lastCount && n > 0) {
        this.lastCount = n;
        this.events.banner(String(n), '0–60 mph 直线加速', 'info', 0.9);
      }
      if (this.countdown <= 0) {
        this.phase = 'run';
        this.events.banner('GO!', '油门 + Boost 冲！', 'good', 0.8);
      }
      return;
    }
    if (this.phase !== 'run') return;
    this.time += dt;
    if (this.car.forwardSpeed >= SIXTY_MPH) {
      this.phase = 'done';
      this.events.done(this.time);
    }
  }
}
