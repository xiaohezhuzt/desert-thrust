/** Raw state produced by the on-screen controls; TouchInput maps it to actions. */
export interface TouchState {
  stickX: number;
  stickY: number;
  throttle: boolean;
  brake: boolean;
  boost: boolean;
  jump: boolean;
  rollLeft: boolean;
  rollRight: boolean;
}

type ButtonKey = 'throttle' | 'brake' | 'boost' | 'jump' | 'rollLeft' | 'rollRight';

const STICK_DEADZONE = 0.08;

function capture(el: HTMLElement, pointerId: number): void {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // Pointer already gone (or synthetic); events still arrive on the element.
  }
}

function vibrate(ms: number): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // iOS and some browsers ignore or block vibration.
  }
}

/**
 * Floating joystick (left) + action buttons (right), built with Pointer Events
 * so several fingers work at once.
 */
export class TouchControls {
  readonly state: TouchState = {
    stickX: 0,
    stickY: 0,
    throttle: false,
    brake: false,
    boost: false,
    jump: false,
    rollLeft: false,
    rollRight: false,
  };
  /** Set whenever any touch control was used. */
  touched = false;

  private readonly root: HTMLDivElement;
  private readonly stickZone: HTMLDivElement;
  private readonly stickBase: HTMLDivElement;
  private readonly stickKnob: HTMLDivElement;
  private readonly rollButtons: HTMLElement[] = [];
  private stickPointer: number | null = null;
  /** Which pointers (fingers) are holding each button. */
  private readonly held = new Map<ButtonKey, Set<number>>();
  private readonly buttonEls = new Map<ButtonKey, HTMLElement>();
  private stickCx = 0;
  private stickCy = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'touch-controls';
    parent.appendChild(this.root);

    this.stickZone = this.div('stick-zone');
    this.stickBase = this.div('stick-base', this.stickZone);
    this.stickKnob = this.div('stick-knob', this.stickBase);
    this.stickZone.addEventListener('pointerdown', this.onStickDown);
    this.stickZone.addEventListener('pointermove', this.onStickMove);
    this.stickZone.addEventListener('pointerup', this.onStickUp);
    this.stickZone.addEventListener('pointercancel', this.onStickUp);

    this.button('throttle', 'btn btn-throttle', '油门');
    this.button('brake', 'btn btn-brake', '刹车');
    this.button('boost', 'btn btn-boost', 'BOOST');
    this.button('jump', 'btn btn-jump', 'JUMP');
    this.rollButtons.push(this.button('rollLeft', 'btn btn-roll btn-roll-left', '⟲'));
    this.rollButtons.push(this.button('rollRight', 'btn btn-roll btn-roll-right', '⟳'));
    this.setAirborne(false);

    // Any finger on the screen re-activates touch mode (e.g. iPad after using a keyboard).
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') this.touched = true;
    });

    // iPad Safari does not always deliver pointerup to the button that was pressed,
    // which left BOOST / throttle stuck on. Listen for releases on the whole window,
    // and when no finger at all is on the screen, let go of everything.
    const lift = (e: PointerEvent): void => this.releasePointer(e.pointerId);
    window.addEventListener('pointerup', lift, true);
    window.addEventListener('pointercancel', lift, true);
    const allUp = (e: TouchEvent): void => {
      if (e.touches.length === 0) this.releaseAll();
    };
    window.addEventListener('touchend', allUp, true);
    window.addEventListener('touchcancel', allUp, true);
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => this.releaseAll());

    // Block long-press menus and gestures on the controls layer.
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Tilt scheme: hide the joystick (steering comes from the device). */
  setStickVisible(visible: boolean): void {
    this.stickZone.classList.toggle('hidden', !visible);
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
    if (!visible) this.releaseAll();
  }

  /** Roll buttons only appear in the air, to avoid accidental taps. */
  setAirborne(airborne: boolean): void {
    for (const b of this.rollButtons) b.classList.toggle('hidden', !airborne);
    if (!airborne) {
      this.state.rollLeft = false;
      this.state.rollRight = false;
    }
  }

  private div(className: string, parent: HTMLElement = this.root): HTMLDivElement {
    const d = document.createElement('div');
    d.className = className;
    parent.appendChild(d);
    return d;
  }

  private button(key: ButtonKey, className: string, label: string): HTMLDivElement {
    const b = this.div(className);
    b.textContent = label;
    const pointers = new Set<number>();
    this.held.set(key, pointers);
    this.buttonEls.set(key, b);
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      capture(b, e.pointerId);
      pointers.add(e.pointerId);
      this.touched = true;
      this.sync(key);
    });
    const release = (e: PointerEvent): void => {
      pointers.delete(e.pointerId);
      this.sync(key);
    };
    b.addEventListener('pointerup', release);
    b.addEventListener('pointercancel', release);
    b.addEventListener('lostpointercapture', release);
    return b;
  }

  /** Push a button's held state into `state` and its pressed look. */
  private sync(key: ButtonKey): void {
    const on = (this.held.get(key)?.size ?? 0) > 0;
    if (on && !this.state[key]) vibrate(8);
    this.state[key] = on;
    this.buttonEls.get(key)?.classList.toggle('active', on);
  }

  /** A finger lifted somewhere: it no longer holds any button or the stick. */
  private releasePointer(id: number): void {
    for (const [key, set] of this.held) {
      if (set.delete(id)) this.sync(key);
    }
    if (this.stickPointer === id) {
      this.stickPointer = null;
      this.stickBase.classList.remove('active');
      this.moveKnob(0, 0);
    }
  }

  private readonly onStickDown = (e: PointerEvent): void => {
    if (this.stickPointer !== null) return;
    e.preventDefault();
    this.stickPointer = e.pointerId;
    capture(this.stickZone, e.pointerId);
    const rect = this.stickZone.getBoundingClientRect();
    this.stickCx = e.clientX;
    this.stickCy = e.clientY;
    this.stickBase.style.left = `${e.clientX - rect.left}px`;
    this.stickBase.style.top = `${e.clientY - rect.top}px`;
    this.stickBase.classList.add('active');
    this.touched = true;
    this.moveKnob(0, 0);
  };

  private readonly onStickMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.stickPointer) return;
    const radius = this.stickBase.clientWidth / 2;
    let dx = (e.clientX - this.stickCx) / radius;
    let dy = (e.clientY - this.stickCy) / radius;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    this.moveKnob(dx, dy);
  };

  private readonly onStickUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.stickPointer) return;
    this.stickPointer = null;
    this.stickBase.classList.remove('active');
    this.moveKnob(0, 0);
  };

  private moveKnob(dx: number, dy: number): void {
    const radius = this.stickBase.clientWidth / 2;
    this.stickKnob.style.transform = `translate(calc(-50% + ${dx * radius}px), calc(-50% + ${dy * radius}px))`;
    const dz = (v: number): number =>
      Math.abs(v) < STICK_DEADZONE ? 0 : (Math.sign(v) * (Math.abs(v) - STICK_DEADZONE)) / (1 - STICK_DEADZONE);
    this.state.stickX = dz(dx);
    // Screen Y grows downward; pushing up = +1.
    this.state.stickY = -dz(dy);
  }

  private releaseAll(): void {
    this.stickPointer = null;
    this.stickBase.classList.remove('active');
    this.moveKnob(0, 0);
    for (const [key, set] of this.held) {
      set.clear();
      this.sync(key);
    }
  }
}
