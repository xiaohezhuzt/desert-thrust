import { button, h, stars, type ButtonVariant } from './dom';

export interface ResultModel {
  readonly title: string;
  readonly passed: boolean;
  readonly headline: string;
  readonly subline?: string;
  readonly stars?: number;
  readonly rows: readonly (readonly [string, string, string?])[];
  readonly checks?: readonly { label: string; met: boolean }[];
  readonly buttons: readonly { label: string; variant: ButtonVariant; onClick: () => void }[];
}

/** End-of-run summary: stars pop in one by one, then details and next actions. */
export function resultScreen(m: ResultModel): HTMLElement {
  const s = h('div', 'screen panel-screen');
  const p = h('div', 'panel result-panel', undefined, s);
  h('h2', m.passed ? 'ok' : 'fail', m.title, p);
  if (m.stars !== undefined) {
    const row = stars(m.stars, 3, p);
    row.classList.add('big', 'animate');
  }
  h('div', 'big-num', m.headline, p);
  if (m.subline) h('div', 'subline', m.subline, p);
  const table = h('table', '', undefined, p);
  for (const [k, v, cls] of m.rows) {
    const tr = h('tr', '', undefined, table);
    h('td', '', k, tr);
    h('td', cls ?? '', v, tr);
  }
  if (m.checks) {
    const ul = h('ul', 'checks', undefined, p);
    for (const c of m.checks) h('li', c.met ? 'met' : '', `${c.met ? '★' : '☆'} ${c.label}`, ul);
  }
  const btns = h('div', 'btn-row', undefined, p);
  for (const b of m.buttons) button(b.label, b.onClick, b.variant, btns);
  return s;
}
