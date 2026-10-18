import { button, h } from './dom';

export interface MainMenuActions {
  campaign(): void;
  online(): void;
  freeRoam(): void;
  dragRun(): void;
  settings(): void;
  /** null when fullscreen isn't available (iOS Safari) */
  fullscreen: (() => void) | null;
  /** shown under the menu, e.g. the iOS "add to home screen" tip */
  hint: string | null;
}

/** Title screen; the launch site and the car slowly orbit behind it. */
export function mainMenu(a: MainMenuActions, totalStars: number, maxStars: number): HTMLElement {
  const s = h('div', 'screen main-menu');
  const title = h('div', 'title', undefined, s);
  h('div', 'logo', 'DESERT THRUST', title);
  h('div', 'tagline', '3D 特技赛车闯关', title);
  const list = h('div', 'menu-list', undefined, s);
  button('闯关', a.campaign, 'primary', list);
  button('多人联机', a.online, 'primary', list);
  button('自由驾驶', a.freeRoam, 'secondary', list);
  button('直线加速 0–60', a.dragRun, 'secondary', list);
  button('设置', a.settings, 'ghost', list);
  if (a.fullscreen) button('全屏', a.fullscreen, 'ghost', list);
  h('div', 'menu-foot', `★ ${totalStars} / ${maxStars}`, s);
  if (a.hint) h('div', 'menu-hint', a.hint, s);
  return s;
}

export interface PauseActions {
  resume(): void;
  restart(): void;
  settings(): void;
  quit(): void;
}

export function pauseMenu(a: PauseActions, canRestart: boolean): HTMLElement {
  const s = h('div', 'screen panel-screen');
  const p = h('div', 'panel', undefined, s);
  h('h2', '', '暂停', p);
  const list = h('div', 'menu-list', undefined, p);
  button('继续', a.resume, 'primary', list);
  if (canRestart) button('重新开始', a.restart, 'secondary', list);
  button('设置', a.settings, 'secondary', list);
  button('退出到菜单', a.quit, 'ghost', list);
  return s;
}

export function loadingScreen(text: string): HTMLElement {
  const s = h('div', 'screen panel-screen');
  const p = h('div', 'panel loading', undefined, s);
  h('div', 'spinner', undefined, p);
  h('div', '', text, p);
  return s;
}
