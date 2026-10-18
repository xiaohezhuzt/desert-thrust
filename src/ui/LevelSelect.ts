import type { LevelDef } from '../config/levels';
import type { Progress } from '../core/SaveSystem';
import { button, formatTime, h, stars } from './dom';

export interface UpcomingLevel {
  readonly id: number;
  readonly name: string;
}

/**
 * Level cards with lock state, stars and best time.
 * `mode` 'free' only allows scenes already unlocked, without race rules.
 */
export function levelSelect(
  levels: readonly LevelDef[],
  upcoming: readonly UpcomingLevel[],
  progress: Progress,
  mode: 'campaign' | 'free',
  onPick: (id: number) => void,
  onBack: () => void,
): HTMLElement {
  const s = h('div', 'screen select-screen');
  const head = h('div', 'select-head', undefined, s);
  button('‹ 返回', onBack, 'ghost', head);
  h('h2', '', mode === 'campaign' ? '选择关卡' : '自由驾驶 · 选择场景', head);
  const grid = h('div', 'level-grid', undefined, s);
  for (const def of levels) {
    const locked = def.id > progress.unlocked;
    const rec = progress.levels[String(def.id)];
    const card = h('button', `level-card${locked ? ' locked' : ''}`, undefined, grid);
    card.type = 'button';
    card.disabled = locked;
    h('div', 'num', String(def.id).padStart(2, '0'), card);
    h('div', 'name', def.name, card);
    h('div', 'sub', locked ? '🔒 通过上一关解锁' : def.subtitle, card);
    if (mode === 'campaign') {
      stars(rec?.stars ?? 0, 3, card);
      h('div', 'meta', `最佳 ${formatTime(rec?.bestTime ?? null)} · 需名次 ≤ ${def.requiredPlace}`, card);
    }
    card.addEventListener('click', () => {
      if (!locked) onPick(def.id);
    });
  }
  for (const u of upcoming) {
    const card = h('div', 'level-card locked soon', undefined, grid);
    h('div', 'num', String(u.id).padStart(2, '0'), card);
    h('div', 'name', u.name, card);
    h('div', 'sub', '即将推出', card);
  }
  return s;
}
