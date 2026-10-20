/**
 * Free Roam: an unlocked scene with no opponents or stunt gates. Tracks a few fun
 * stats for the HUD line, and times start-to-finish runs when the scene has a finish.
 */
const COUNTDOWN = 3;

export class FreeRoam {
  topSpeed = 0;
  airTime = 0;
  /** best start-to-finish time this visit */
  best: number | null = null;
  private flight = 0;
  private atFinish = false;
  /** 3-2-1 before driving (the robot climbs in meanwhile). */
  private countdown = COUNTDOWN;
  private lastCount = -1;

  get counting(): boolean {
    return this.countdown > 0;
  }

  /** Seconds since the countdown began (for the boarding animation). */
  get countdownElapsed(): number {
    return COUNTDOWN - Math.max(this.countdown, 0);
  }

  restartCountdown(): void {
    this.countdown = COUNTDOWN;
    this.lastCount = -1;
  }

  /** Advance the countdown; returns the number to show when it changes (0 = GO), else null. */
  tickCountdown(dt: number): number | null {
    if (this.countdown <= 0) return null;
    this.countdown -= dt;
    const n = Math.max(0, Math.ceil(this.countdown));
    if (n === this.lastCount) return null;
    this.lastCount = n;
    return n;
  }

  /** Call each step with whether the car is inside the finish box; returns the run time when it just arrived. */
  checkFinish(inside: boolean, elapsed: number): number | null {
    if (inside && !this.atFinish) {
      this.atFinish = true;
      this.best = this.best === null ? elapsed : Math.min(this.best, elapsed);
      return elapsed;
    }
    if (!inside) this.atFinish = false;
    return null;
  }

  step(dt: number, speed: number, airborne: boolean): void {
    this.topSpeed = Math.max(this.topSpeed, Math.abs(speed));
    if (airborne) {
      this.flight += dt;
      this.airTime = Math.max(this.airTime, this.flight);
    } else {
      this.flight = 0;
    }
  }

  info(toUnits: (mps: number) => string): string {
    const best = this.best === null ? '' : ` · 最快到终点 ${this.best.toFixed(1)}s`;
    return `自由驾驶 · 最高 ${toUnits(this.topSpeed)} · 最长滞空 ${this.airTime.toFixed(1)}s${best}`;
  }
}
