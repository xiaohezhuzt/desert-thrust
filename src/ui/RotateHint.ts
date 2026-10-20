import { h } from './dom';

const PORTRAIT_TOUCH = '(orientation: portrait) and (pointer: coarse)';

const KEY = 'rotate-hint-dismissed';

/**
 * "Please rotate" suggestion for phones held upright. The player can rotate, or tap
 * "keep playing in portrait" (remembered), so a phone with rotation lock on is never stuck.
 * Calls `onChange(true)` while the hint is up so the game can pause.
 */
export class RotateHint {
  private readonly el: HTMLDivElement;
  private readonly mq = window.matchMedia(PORTRAIT_TOUCH);
  private dismissed = false;

  constructor(parent: HTMLElement, private readonly onChange: (portrait: boolean) => void) {
    try {
      this.dismissed = localStorage.getItem(KEY) === '1';
    } catch {
      this.dismissed = false;
    }
    this.el = h('div', 'rotate-hint', undefined, parent);
    const box = h('div', 'rotate-box', undefined, this.el);
    h('div', 'rotate-phone', '📱', box);
    h('div', 'rotate-title', '建议横屏游玩', box);
    h('div', 'rotate-sub', '把手机横过来，画面更大、操作更顺手', box);
    h('div', 'rotate-tip', '转不过来？iPhone 请从右上角下拉打开控制中心，关闭「竖排方向锁定」🔒', box);
    const keep = h('button', 'btn-ui primary rotate-keep', '竖屏继续玩', box);
    keep.addEventListener('click', () => {
      this.dismissed = true;
      try {
        localStorage.setItem(KEY, '1');
      } catch {
        // private mode: just for this visit
      }
      this.update();
    });
    this.mq.addEventListener?.('change', () => this.update());
    window.addEventListener('orientationchange', () => this.update());
    this.update();
  }

  private update(): void {
    const show = this.mq.matches && !this.dismissed;
    this.el.classList.toggle('show', show);
    this.onChange(show);
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
