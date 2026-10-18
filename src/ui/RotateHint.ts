import { h } from './dom';

const PORTRAIT_TOUCH = '(orientation: portrait) and (pointer: coarse)';

/**
 * "Please rotate" overlay for phones held upright. Calls `onChange(true)` while
 * portrait so the game can pause.
 */
export class RotateHint {
  private readonly el: HTMLDivElement;
  private readonly mq = window.matchMedia(PORTRAIT_TOUCH);

  constructor(parent: HTMLElement, private readonly onChange: (portrait: boolean) => void) {
    this.el = h('div', 'rotate-hint', undefined, parent);
    const box = h('div', 'rotate-box', undefined, this.el);
    h('div', 'rotate-phone', '📱', box);
    h('div', 'rotate-title', '请旋转设备', box);
    h('div', 'rotate-sub', '横屏游玩体验最佳', box);
    const update = (): void => {
      this.el.classList.toggle('show', this.mq.matches);
      this.onChange(this.mq.matches);
    };
    this.mq.addEventListener?.('change', update);
    window.addEventListener('orientationchange', update);
    update();
  }

  get portrait(): boolean {
    return this.mq.matches;
  }
}

/** Running as an installed app (home screen / PWA)? */
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** Fullscreen + landscape lock where the platform allows it (Android / desktop). */
export async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    await o.lock?.('landscape').catch(() => undefined);
  } catch {
    // Not supported (iOS Safari): the menu shows the "add to home screen" hint instead.
  }
}
