import { h } from './dom';

/** Full-screen layer that shows one menu screen at a time above the game and HUD. */
export class Overlay {
  readonly root: HTMLDivElement;
  private current: HTMLElement | null = null;

  constructor(parent: HTMLElement) {
    this.root = h('div', 'overlay hidden', undefined, parent);
    // Menus must never let touches fall through to the game.
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  get visible(): boolean {
    return this.current !== null;
  }

  /** Replace the current screen; `dim` darkens the game behind it. */
  show(screen: HTMLElement, dim = true): void {
    this.current?.remove();
    this.current = screen;
    this.root.appendChild(screen);
    this.root.classList.remove('hidden');
    this.root.classList.toggle('dim', dim);
  }

  hide(): void {
    this.current?.remove();
    this.current = null;
    this.root.classList.add('hidden');
  }
}
