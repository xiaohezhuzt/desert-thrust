/**
 * Free Roam: an unlocked scene with no timer, opponents or stunt gates.
 * Tracks a few fun stats for the HUD line.
 */
export class FreeRoam {
  topSpeed = 0;
  airTime = 0;
  private flight = 0;

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
    return `自由驾驶 · 最高 ${toUnits(this.topSpeed)} · 最长滞空 ${this.airTime.toFixed(1)}s · Esc/⏸ 菜单`;
  }
}
