const MAX_FRAME_DT = 0.25;
const MAX_SUBSTEPS = 8;

/**
 * Fixed-timestep simulation with interpolated rendering.
 * `step` runs at `fixedDt`; `render` receives the interpolation alpha in [0, 1).
 */
export class GameLoop {
  private accumulator = 0;
  private lastTime = 0;
  private rafId = 0;
  private running = false;
  private paused = false;
  /** Simulation speed (slow motion < 1). */
  timeScale = 1;

  constructor(
    private fixedDt: number,
    private readonly step: (dt: number) => void,
    private readonly render: (alpha: number, frameDt: number, realDt: number) => void,
  ) {}

  setFixedDt(dt: number): void {
    this.fixedDt = dt;
    this.accumulator = 0;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.accumulator = 0;
    this.lastTime = performance.now();
  }

  private readonly tick = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.tick);

    const frameDt = Math.min((now - this.lastTime) / 1000, MAX_FRAME_DT);
    this.lastTime = now;

    if (!this.paused) {
      this.accumulator += frameDt * this.timeScale;
      let steps = 0;
      while (this.accumulator >= this.fixedDt && steps < MAX_SUBSTEPS) {
        this.step(this.fixedDt);
        this.accumulator -= this.fixedDt;
        steps++;
      }
      // Spiral-of-death guard: drop time we could not simulate.
      if (steps === MAX_SUBSTEPS) this.accumulator = 0;
    }

    this.render(this.paused ? 1 : this.accumulator / this.fixedDt, this.paused ? 0 : frameDt * this.timeScale, frameDt);
  };
}
