/** Tiny DOM helpers for the menus (no framework). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text?: string,
  parent?: HTMLElement,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

/** A large touch-friendly button (≥ 56 px); fires on click, which covers mouse, touch and pen. */
export function button(
  label: string,
  onClick: () => void,
  variant: ButtonVariant = 'secondary',
  parent?: HTMLElement,
  disabled = false,
): HTMLButtonElement {
  const b = h('button', `btn-ui ${variant}`, label, parent);
  b.type = 'button';
  b.disabled = disabled;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!b.disabled) onClick();
  });
  return b;
}

export function stars(count: number, max = 3, parent?: HTMLElement): HTMLDivElement {
  const row = h('div', 'stars', undefined, parent);
  for (let i = 0; i < max; i++) h('span', i < count ? 'star on' : 'star', '★', row);
  return row;
}

export function formatTime(t: number | null): string {
  if (t === null) return '—';
  return `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
}
