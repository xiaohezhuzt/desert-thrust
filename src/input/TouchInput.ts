import type { TouchControls } from '../ui/TouchControls';
import { mergeAxis, type InputActions, type InputSource } from './InputManager';

export class TouchInput implements InputSource {
  readonly device = 'touch' as const;
  /** Hold throttle automatically unless braking (beginner friendly). */
  autoThrottle: boolean;
  /** Set by the game so auto-throttle only applies while touch is the active device. */
  isActiveDevice = false;
  /** Auto-throttle waits for the first touch so the car doesn't launch on page load. */
  private engaged = false;

  constructor(private readonly controls: TouchControls, autoThrottle: boolean) {
    this.autoThrottle = autoThrottle;
  }

  consumeActivity(): boolean {
    const t = this.controls.touched;
    this.controls.touched = false;
    if (t) this.engaged = true;
    return t;
  }

  poll(out: InputActions): void {
    const s = this.controls.state;
    if (s.throttle || (this.autoThrottle && this.engaged && !s.brake && this.isActiveDevice)) out.throttle = 1;
    if (s.brake) out.brake = 1;
    out.steer = mergeAxis(out.steer, s.stickX);
    out.pitch = mergeAxis(out.pitch, s.stickY);
    out.roll = mergeAxis(out.roll, (s.rollRight ? 1 : 0) - (s.rollLeft ? 1 : 0));
    out.boost ||= s.boost;
    out.jump ||= s.jump;
  }

  endFrame(): void {}

  dispose(): void {}
}
