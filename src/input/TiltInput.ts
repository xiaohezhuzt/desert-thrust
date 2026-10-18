import type { TouchControls } from '../ui/TouchControls';
import { type InputActions, type InputSource } from './InputManager';

type PermissionFn = () => Promise<'granted' | 'denied'>;

/**
 * Tilt-to-steer (control scheme B): device roll steers, the on-screen buttons
 * still handle throttle, boost, jump and air rolls. Calibrate sets "straight".
 */
export class TiltInput implements InputSource {
  readonly device = 'touch' as const;
  enabled = false;
  sensitivity = 1;
  deadzone = 0.06;
  private raw = 0;
  private offset = 0;
  private hasData = false;

  private readonly onOrient = (e: DeviceOrientationEvent): void => {
    if (e.beta === null || e.gamma === null) return;
    // In landscape the steering axis is beta, sign flipped by which way the phone is turned.
    const angle = (screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0) as number;
    let v: number;
    if (angle === 90) v = e.beta;
    else if (angle === -90 || angle === 270) v = -e.beta;
    else v = e.gamma;
    this.raw = v;
    this.hasData = true;
  };

  constructor(private readonly controls: TouchControls) {
    window.addEventListener('deviceorientation', this.onOrient);
  }

  /** iOS 13+ needs explicit permission, from inside a user gesture. */
  static async requestPermission(): Promise<boolean> {
    const D = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: PermissionFn } }).DeviceOrientationEvent;
    if (!D) return false;
    if (typeof D.requestPermission !== 'function') return true;
    try {
      return (await D.requestPermission()) === 'granted';
    } catch {
      return false;
    }
  }

  calibrate(): void {
    this.offset = this.raw;
  }

  consumeActivity(): boolean {
    return false;
  }

  poll(out: InputActions): void {
    if (!this.enabled || !this.hasData) return;
    // ~25° of tilt for full lock at sensitivity 1.
    let s = ((this.raw - this.offset) / 25) * this.sensitivity;
    s = Math.max(-1, Math.min(1, s));
    const a = Math.abs(s);
    s = a < this.deadzone ? 0 : (Math.sign(s) * (a - this.deadzone)) / (1 - this.deadzone);
    if (Math.abs(s) > Math.abs(out.steer)) out.steer = s;
    void this.controls;
  }

  endFrame(): void {}

  dispose(): void {
    window.removeEventListener('deviceorientation', this.onOrient);
  }
}
