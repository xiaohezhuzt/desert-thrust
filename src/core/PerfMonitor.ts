import { AUTO_DOWNGRADE } from '../config/quality';

/**
 * Samples frame rate in fixed windows. When FPS stays under the threshold for
 * `sustainSeconds`, calls `onDegrade`; it returns false once nothing is left to drop.
 */
export class PerfMonitor {
  fps = 60;
  enabled = true;

  private windowTime = 0;
  private windowFrames = 0;
  private lowTime = 0;
  private warmup: number = AUTO_DOWNGRADE.warmupSeconds;
  private exhausted = false;

  constructor(private readonly onDegrade: () => boolean) {}

  /** Restart warm-up, e.g. after a quality change or resuming from background. */
  reset(): void {
    this.windowTime = 0;
    this.windowFrames = 0;
    this.lowTime = 0;
    this.warmup = AUTO_DOWNGRADE.warmupSeconds;
    this.exhausted = false;
  }

  sample(frameDt: number): void {
    if (frameDt <= 0) return;
    this.windowTime += frameDt;
    this.windowFrames++;
    if (this.windowTime < AUTO_DOWNGRADE.sampleWindow) return;

    this.fps = this.windowFrames / this.windowTime;
    const elapsed = this.windowTime;
    this.windowTime = 0;
    this.windowFrames = 0;

    if (this.warmup > 0) {
      this.warmup -= elapsed;
      return;
    }
    if (!this.enabled || this.exhausted) return;

    this.lowTime = this.fps < AUTO_DOWNGRADE.fpsThreshold ? this.lowTime + elapsed : 0;
    if (this.lowTime >= AUTO_DOWNGRADE.sustainSeconds) {
      this.lowTime = 0;
      this.warmup = AUTO_DOWNGRADE.warmupSeconds;
      if (!this.onDegrade()) this.exhausted = true;
    }
  }
}
