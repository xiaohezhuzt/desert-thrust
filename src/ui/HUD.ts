import { MS_TO_KMH, MS_TO_MPH } from '../config/tuning';
import type { SpeedUnit } from '../core/SaveSystem';
import type { InputDevice } from '../input/InputManager';
import type { LandingResult } from '../vehicle/LandingJudge';

/** [key, what it does] pairs, shown as key caps. */
const HINTS: Record<InputDevice, readonly (readonly [string, string])[]> = {
  keyboard: [
    ['W/S', '油门'], ['A/D', '转向'], ['Shift', '加速'], ['空格', '跳跃（按住悬停）'],
    ['空中 W/S', '俯仰'], ['Q/E', '横滚'], ['C', '视角'], ['R', '复位'],
  ],
  gamepad: [
    ['RT/LT', '油门'], ['A', '加速'], ['B', '跳跃（按住悬停）'], ['LB/RB', '横滚'], ['左摇杆', '转向/俯仰'], ['Y', '视角'],
  ],
  touch: [['左摇杆', '转向'], ['BOOST', '加速'], ['JUMP', '跳跃（按住悬停）'], ['空中', '出现横滚键']],
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  parent.appendChild(e);
  return e;
}

export class HUD {
  private readonly chip: HTMLDivElement;
  private readonly speedValue: HTMLDivElement;
  private readonly speedUnit: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  private readonly autoThrottleToggle: HTMLDivElement;
  private readonly energyFill: HTMLDivElement;
  private readonly energyBar: HTMLDivElement;
  private readonly energyPct: HTMLSpanElement;
  private readonly energyGain: HTMLDivElement;
  private gainTimer = 0;
  private readonly gradeEl: HTMLDivElement;
  private readonly race: HTMLDivElement;
  private readonly timerEl: HTMLDivElement;
  private readonly placeEl: HTMLDivElement;
  private lastPlace = '';
  private readonly progressFill: HTMLDivElement;
  private readonly infoEl: HTMLDivElement;
  private readonly bannerEl: HTMLDivElement;
  private bannerTimer = 0;
  private lastTimerText = '';
  private lastInfo = '';
  onPause: (() => void) | null = null;
  onCamera: (() => void) | null = null;
  private readonly cameraBtn: HTMLDivElement;
  private gradeTimer = 0;
  private lastEnergyPct = -1;
  private lastSpeedText = '';
  private lastChipText = '';

  /** Fired when the player taps the quality chip. */
  onQualityChipClick: (() => void) | null = null;
  onAutoThrottleClick: (() => void) | null = null;

  constructor(root: HTMLElement) {
    this.chip = el('div', 'hud-chip', root);
    this.chip.addEventListener('pointerup', () => this.onQualityChipClick?.());

    const speed = el('div', 'hud-speed', root);
    this.speedValue = el('div', 'value', speed);
    this.speedUnit = el('div', 'unit', speed);
    // Thrust energy: shared by BOOST, jump and hover; refills on the ground and from good landings.
    const gauge = el('div', 'energy-gauge', speed);
    const head = el('div', 'energy-head', gauge);
    el('span', 'energy-label', head).textContent = '⚡ 推进能量';
    this.energyPct = el('span', 'energy-pct', head);
    this.energyBar = el('div', 'energy', gauge);
    this.energyFill = el('div', 'energy-fill', this.energyBar);
    el('div', 'energy-ticks', this.energyBar);
    this.energyGain = el('div', 'energy-gain', gauge);

    this.gradeEl = el('div', 'grade', root);

    this.race = el('div', 'race hidden', root);
    this.placeEl = el('div', 'place', this.race);
    this.timerEl = el('div', 'timer', this.race);
    const bar = el('div', 'progress', this.race);
    this.progressFill = el('div', 'progress-fill', bar);
    this.infoEl = el('div', 'race-info', this.race);
    this.bannerEl = el('div', 'banner', root);
    // Fire on finger-down: iPad Safari doesn't reliably deliver pointerup to plain divs.
    const tap = (e: HTMLElement, fn: () => void): void => {
      e.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        fn();
      });
    };
    const pause = el('div', 'hud-btn hud-pause', root);
    pause.textContent = '⏸';
    tap(pause, () => this.onPause?.());
    this.cameraBtn = el('div', 'hud-btn hud-camera', root);
    tap(this.cameraBtn, () => this.onCamera?.());
    this.setCameraMode('chase');

    this.autoThrottleToggle = el('div', 'hud-toggle', root);
    tap(this.autoThrottleToggle, () => this.onAutoThrottleClick?.());

    this.hint = el('div', 'hud-hint', root);
  }

  setEnergy(fraction: number, active: boolean): void {
    const pct = Math.round(fraction * 100);
    if (pct !== this.lastEnergyPct) {
      this.energyFill.style.transform = `scaleX(${pct / 100})`;
      this.energyPct.textContent = pct <= 0 ? '能量耗尽' : `${pct}%`;
      this.lastEnergyPct = pct;
    }
    this.energyBar.classList.toggle('active', active);
    this.energyBar.classList.toggle('mid', pct < 45 && pct >= 20);
    this.energyBar.classList.toggle('low', pct < 20);
    this.energyPct.classList.toggle('empty', pct <= 0);
  }

  /** "+N" next to the gauge when a landing earns bonus energy (it then flows in). */
  energyBonus(amount: number): void {
    if (amount <= 0) return;
    this.energyGain.textContent = `+${Math.round(amount)}`;
    this.energyGain.classList.remove('show');
    void this.energyGain.offsetWidth;
    this.energyGain.classList.add('show');
    window.clearTimeout(this.gainTimer);
    this.gainTimer = window.setTimeout(() => this.energyGain.classList.remove('show'), 1400);
  }

  showLanding(r: LandingResult): void {
    const pct = Math.round(r.retention * 100);
    const detail = r.grade === 'CRASH' ? '翻车' : `滞空 ${r.airTime.toFixed(1)}s · ${Math.round(r.angle)}° · 速度保留 ${pct}%`;
    this.gradeEl.innerHTML = `<div class="g">${r.grade}</div><div class="d">${detail}</div>`;
    this.gradeEl.className = `grade show ${r.grade.toLowerCase()}`;
    window.clearTimeout(this.gradeTimer);
    this.gradeTimer = window.setTimeout(() => this.gradeEl.classList.remove('show'), 1800);
  }

  setRace(
    visible: boolean,
    time: number,
    limit: number,
    progress: number,
    info: string,
    place: number,
    racers: number,
  ): void {
    this.race.classList.toggle('hidden', !visible);
    if (!visible) return;
    const placeText = racers > 1 ? `${place}<small>/${racers}</small>` : '';
    if (placeText !== this.lastPlace) {
      this.placeEl.innerHTML = placeText;
      this.lastPlace = placeText;
    }
    const left = Math.max(0, limit - time);
    const text = `${Math.floor(time / 60)}:${(time % 60).toFixed(1).padStart(4, '0')}`;
    if (text !== this.lastTimerText) {
      this.timerEl.textContent = text;
      this.timerEl.classList.toggle('warn', left < 15);
      this.lastTimerText = text;
    }
    this.progressFill.style.transform = `scaleX(${progress.toFixed(3)})`;
    if (info !== this.lastInfo) {
      this.infoEl.textContent = info;
      this.lastInfo = info;
    }
  }

  banner(text: string, sub: string, tone: 'info' | 'good' | 'bad', seconds: number): void {
    this.bannerEl.innerHTML = '';
    const t = document.createElement('div');
    t.className = 'b';
    t.textContent = text;
    const d = document.createElement('div');
    d.className = 's';
    d.textContent = sub;
    this.bannerEl.append(t, d);
    this.bannerEl.className = `banner show ${tone}`;
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.bannerEl.classList.remove('show'), seconds * 1000);
  }

  setDevice(device: InputDevice): void {
    this.hint.replaceChildren();
    for (const [key, label] of HINTS[device]) {
      const item = el('span', 'hint-item', this.hint);
      el('kbd', '', item).textContent = key;
      item.append(label);
    }
    this.autoThrottleToggle.classList.toggle('hidden', device !== 'touch');
  }

  setCameraMode(mode: 'chase' | 'cockpit'): void {
    this.cameraBtn.innerHTML = `<span class="ico">🎥</span>${mode === 'chase' ? '第三视角' : '第一视角'}`;
  }

  setAutoThrottle(on: boolean): void {
    this.autoThrottleToggle.textContent = on ? '自动油门 开' : '自动油门 关';
    this.autoThrottleToggle.classList.toggle('on', on);
  }

  setSpeed(metersPerSecond: number, unit: SpeedUnit): void {
    const v = Math.round(Math.abs(metersPerSecond) * (unit === 'kmh' ? MS_TO_KMH : MS_TO_MPH));
    const text = String(v);
    if (text !== this.lastSpeedText) {
      this.speedValue.textContent = text;
      this.speedUnit.textContent = unit === 'kmh' ? 'KM/H' : 'MPH';
      this.lastSpeedText = text;
    }
  }

  setPerf(fps: number, tier: string, locked: boolean, renderScale: number): void {
    const text = `${Math.round(fps)} FPS|${tier.toUpperCase()}${locked ? ' 🔒' : ' AUTO'}|${Math.round(renderScale * 100)}%`;
    if (text === this.lastChipText) return;
    this.lastChipText = text;
    const [f, t, s] = text.split('|');
    this.chip.innerHTML = `<b>${f}</b><br>${t}<br>渲染 ${s}`;
  }
}
