import { mergeAxis, type InputActions, type InputSource } from './InputManager';

const DEADZONE = 0.15;
const TRIGGER_DEADZONE = 0.05;

// Standard Gamepad mapping indices.
const B = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  BACK: 8,
  START: 9,
} as const;

function axis(v: number | undefined): number {
  const x = v ?? 0;
  const a = Math.abs(x);
  if (a < DEADZONE) return 0;
  return (Math.sign(x) * (a - DEADZONE)) / (1 - DEADZONE);
}

export class GamepadInput implements InputSource {
  readonly device = 'gamepad' as const;
  private prev: boolean[] = [];
  private active = false;

  consumeActivity(): boolean {
    const a = this.active;
    this.active = false;
    return a;
  }

  private findPad(): Gamepad | null {
    if (!navigator.getGamepads) return null;
    for (const p of navigator.getGamepads()) if (p && p.connected) return p;
    return null;
  }

  poll(out: InputActions): void {
    const pad = this.findPad();
    if (!pad) return;
    const btn = (i: number): number => pad.buttons[i]?.value ?? 0;
    const held = (i: number): boolean => pad.buttons[i]?.pressed ?? false;
    const edge = (i: number): boolean => held(i) && !this.prev[i];

    const steer = axis(pad.axes[0]);
    const stickY = axis(pad.axes[1]);
    const rt = btn(B.RT);
    const lt = btn(B.LT);

    if (Math.abs(steer) > 0 || Math.abs(stickY) > 0 || rt > TRIGGER_DEADZONE || lt > TRIGGER_DEADZONE) this.active = true;
    for (let i = 0; i < pad.buttons.length; i++) if (held(i)) this.active = true;

    out.throttle = Math.max(out.throttle, rt > TRIGGER_DEADZONE ? rt : 0);
    out.brake = Math.max(out.brake, lt > TRIGGER_DEADZONE ? lt : 0);
    out.steer = mergeAxis(out.steer, steer);
    // Stick up behaves like W in the air.
    out.pitch = mergeAxis(out.pitch, -stickY);
    out.roll = mergeAxis(out.roll, (held(B.RB) ? 1 : 0) - (held(B.LB) ? 1 : 0));
    out.boost ||= held(B.A);
    out.jump ||= held(B.B);
    out.handbrake ||= held(B.X);
    out.cameraPressed ||= edge(B.Y);
    out.resetPressed ||= edge(B.BACK);
    out.pausePressed ||= edge(B.START);

    this.prev.length = pad.buttons.length;
    for (let i = 0; i < pad.buttons.length; i++) this.prev[i] = held(i);
  }

  endFrame(): void {}

  dispose(): void {}
}
