import type { QualityLock, Settings, SpeedUnit } from '../core/SaveSystem';
import { button, h } from './dom';

export interface SettingsActions {
  change(next: Settings): void;
  calibrateTilt(): void;
  resetProgress(): void;
  back(): void;
}

function segmented<T extends string>(
  parent: HTMLElement,
  label: string,
  options: readonly [T, string][],
  value: T,
  onPick: (v: T) => void,
): void {
  const row = h('div', 'setting-row', undefined, parent);
  h('div', 'setting-label', label, row);
  const seg = h('div', 'segmented', undefined, row);
  for (const [v, text] of options) {
    const b = h('button', v === value ? 'on' : '', text, seg);
    b.type = 'button';
    b.addEventListener('click', () => onPick(v));
  }
}

function slider(
  parent: HTMLElement,
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  format: (v: number) => string,
  onCommit: (v: number) => void,
): void {
  const row = h('div', 'setting-row', undefined, parent);
  h('div', 'setting-label', label, row);
  const wrap = h('div', 'slider', undefined, row);
  const input = h('input', '', undefined, wrap);
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  const out = h('span', 'slider-value', format(value), wrap);
  input.addEventListener('input', () => (out.textContent = format(Number(input.value))));
  input.addEventListener('change', () => onCommit(Number(input.value)));
}

/**
 * Settings panel. Re-rendered on every change so the selected state stays in sync.
 * `effective` gives the resolved device defaults for the null settings.
 */
export function settingsScreen(
  current: Settings,
  effective: { autoThrottle: boolean; airAssist: boolean },
  a: SettingsActions,
): HTMLElement {
  const s = h('div', 'screen panel-screen');
  const p = h('div', 'panel settings-panel', undefined, s);
  h('h2', '', '设置', p);
  const set = (patch: Partial<Settings>): void => a.change({ ...current, ...patch });

  segmented<QualityLock>(
    p,
    '画质',
    [
      ['auto', '自动'],
      ['low', '低'],
      ['medium', '中'],
      ['high', '高'],
    ],
    current.qualityLock,
    (v) => set({ qualityLock: v }),
  );
  segmented<SpeedUnit>(
    p,
    '速度单位',
    [
      ['kmh', 'km/h'],
      ['mph', 'mph'],
    ],
    current.units,
    (v) => set({ units: v }),
  );
  segmented<'on' | 'off'>(
    p,
    '自动油门（触屏）',
    [
      ['on', '开'],
      ['off', '关'],
    ],
    effective.autoThrottle ? 'on' : 'off',
    (v) => set({ autoThrottle: v === 'on' }),
  );
  segmented<'on' | 'off'>(
    p,
    '空中自动扶正',
    [
      ['on', '开'],
      ['off', '关'],
    ],
    effective.airAssist ? 'on' : 'off',
    (v) => set({ airAssist: v === 'on' }),
  );
  segmented<'stick' | 'tilt'>(
    p,
    '触屏操控方案',
    [
      ['stick', '虚拟摇杆'],
      ['tilt', '重力感应'],
    ],
    current.controlScheme,
    (v) => set({ controlScheme: v }),
  );
  if (current.controlScheme === 'tilt') {
    slider(p, '重力灵敏度', 0.4, 2.5, 0.1, current.tiltSensitivity, (v) => `${v.toFixed(1)}×`, (v) => set({ tiltSensitivity: v }));
    slider(p, '重力死区', 0, 0.3, 0.01, current.tiltDeadzone, (v) => `${Math.round(v * 100)}%`, (v) => set({ tiltDeadzone: v }));
    const row = h('div', 'setting-row', undefined, p);
    h('div', 'setting-label', '把设备放平到你习惯的握持角度', row);
    button('校准', a.calibrateTilt, 'secondary', row);
  }
  slider(p, '音效音量', 0, 1, 0.05, current.sfxVolume, (v) => `${Math.round(v * 100)}%`, (v) => set({ sfxVolume: v }));
  slider(p, '音乐音量', 0, 1, 0.05, current.musicVolume, (v) => `${Math.round(v * 100)}%`, (v) => set({ musicVolume: v }));
  segmented<'on' | 'off'>(
    p,
    'PERFECT 慢动作镜头',
    [
      ['on', '开'],
      ['off', '关'],
    ],
    current.slowMo ? 'on' : 'off',
    (v) => set({ slowMo: v === 'on' }),
  );

  const btns = h('div', 'btn-row', undefined, p);
  const reset = button(
    '重置存档',
    () => {
      if (reset.dataset.armed) a.resetProgress();
      else {
        reset.dataset.armed = '1';
        reset.textContent = '再点一次确认重置';
      }
    },
    'ghost',
    btns,
  );
  button('完成', a.back, 'primary', btns);
  return s;
}
