import { mergeAxis, type InputActions, type InputSource } from './InputManager';

const PREVENT_DEFAULT = new Set([
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Tab',
]);

export class KeyboardInput implements InputSource {
  readonly device = 'keyboard' as const;
  private active = false;
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (PREVENT_DEFAULT.has(e.code)) e.preventDefault();
    if (!e.repeat) this.pressed.add(e.code);
    this.active = true;
    this.down.add(e.code);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };

  private readonly onBlur = (): void => {
    this.down.clear();
    this.pressed.clear();
  };

  constructor() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  private any(...codes: string[]): boolean {
    for (const c of codes) if (this.down.has(c)) return true;
    return false;
  }

  consumeActivity(): boolean {
    const a = this.active;
    this.active = false;
    return a;
  }

  poll(out: InputActions): void {
    const up = this.any('KeyW', 'ArrowUp');
    const down = this.any('KeyS', 'ArrowDown');
    const left = this.any('KeyA', 'ArrowLeft');
    const right = this.any('KeyD', 'ArrowRight');

    if (up) out.throttle = 1;
    if (down) out.brake = 1;
    out.steer = mergeAxis(out.steer, (right ? 1 : 0) - (left ? 1 : 0));
    out.pitch = mergeAxis(out.pitch, (up ? 1 : 0) - (down ? 1 : 0));
    out.roll = mergeAxis(out.roll, (this.down.has('KeyE') ? 1 : 0) - (this.down.has('KeyQ') ? 1 : 0));
    out.boost ||= this.any('ShiftLeft', 'ShiftRight');
    out.jump ||= this.down.has('Space');
    out.handbrake ||= this.any('ControlLeft', 'ControlRight');
    out.cameraPressed ||= this.pressed.has('KeyC');
    out.resetPressed ||= this.pressed.has('KeyR');
    out.pausePressed ||= this.pressed.has('Escape');
  }

  endFrame(): void {
    this.pressed.clear();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }
}
