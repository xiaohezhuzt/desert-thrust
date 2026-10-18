/**
 * Device-independent actions. Game logic reads only these and never cares
 * whether they came from keyboard, gamepad, touch or tilt.
 */
export interface InputActions {
  /** 0..1 */
  throttle: number;
  /** 0..1, brake / reverse */
  brake: number;
  /** -1 (left) .. 1 (right) */
  steer: number;
  /** -1 (nose up) .. 1 (nose down), used while airborne; W / stick-up = nose down */
  pitch: number;
  /** -1 (left) .. 1 (right), used while airborne */
  roll: number;
  boost: boolean;
  jump: boolean;
  handbrake: boolean;
  /** Edge-triggered: true for exactly one frame. */
  cameraPressed: boolean;
  resetPressed: boolean;
  pausePressed: boolean;
}

export type InputDevice = 'keyboard' | 'gamepad' | 'touch';

export interface InputSource {
  readonly device: InputDevice;
  /** True if this source saw user activity since the last frame. */
  consumeActivity(): boolean;
  /** Merge this source's state into `out` (sources are combined by max magnitude / OR). */
  poll(out: InputActions): void;
  /** Called after the frame's actions were consumed, to clear edge triggers. */
  endFrame(): void;
  dispose(): void;
}

export function createEmptyActions(): InputActions {
  return {
    throttle: 0,
    brake: 0,
    steer: 0,
    pitch: 0,
    roll: 0,
    boost: false,
    jump: false,
    handbrake: false,
    cameraPressed: false,
    resetPressed: false,
    pausePressed: false,
  };
}

function resetActions(a: InputActions): void {
  a.throttle = 0;
  a.brake = 0;
  a.steer = 0;
  a.pitch = 0;
  a.roll = 0;
  a.boost = false;
  a.jump = false;
  a.handbrake = false;
  a.cameraPressed = false;
  a.resetPressed = false;
  a.pausePressed = false;
}

/** Larger-magnitude value wins when combining analog axes from several sources. */
export function mergeAxis(current: number, incoming: number): number {
  return Math.abs(incoming) > Math.abs(current) ? incoming : current;
}

export class InputManager {
  readonly actions: InputActions = createEmptyActions();
  private readonly sources: InputSource[] = [];
  /** Device the player used most recently; drives touch-control visibility. */
  activeDevice: InputDevice;
  onDeviceChange: ((device: InputDevice) => void) | null = null;

  constructor(initialDevice: InputDevice) {
    this.activeDevice = initialDevice;
  }

  add(source: InputSource): void {
    this.sources.push(source);
  }

  /** Poll all sources once per rendered frame. */
  update(): InputActions {
    resetActions(this.actions);
    for (const s of this.sources) {
      if (s.consumeActivity() && s.device !== this.activeDevice) {
        this.activeDevice = s.device;
        this.onDeviceChange?.(s.device);
      }
      s.poll(this.actions);
    }
    return this.actions;
  }

  endFrame(): void {
    for (const s of this.sources) s.endFrame();
  }

  dispose(): void {
    for (const s of this.sources) s.dispose();
    this.sources.length = 0;
  }
}
