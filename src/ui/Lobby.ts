import type { LevelDef } from '../config/levels';
import type { OnlineStanding } from '../modes/OnlineRace';
import { PLAYER_COLORS, type RoomInfo } from '../net/protocol';
import { button, formatTime, h } from './dom';

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

export interface OnlineHomeActions {
  create(name: string): void;
  join(name: string, code: string): void;
  back(): void;
}

/** Name entry plus "create room" / "join with code". */
export function onlineHome(savedName: string, presetCode: string | null, a: OnlineHomeActions, error?: string): HTMLElement {
  const s = h('div', 'screen panel-screen');
  const p = h('div', 'panel lobby-panel', undefined, s);
  h('h2', '', '多人联机', p);
  h('div', 'lobby-sub', '和同学在同一个场景里比赛：创建房间后把邀请链接发给他们。', p);
  if (error) h('div', 'lobby-error', error, p);

  const nameRow = h('label', 'field', undefined, p);
  h('span', '', '你的昵称', nameRow);
  const name = h('input', '', undefined, nameRow);
  name.id = 'online-name';
  name.maxLength = 16;
  name.value = savedName;
  name.placeholder = '例如：小明';
  name.setAttribute('autocomplete', 'nickname');

  const getName = (): string => name.value.trim() || '车手';
  if (presetCode) {
    h('div', 'lobby-invite-note', `你收到了房间 ${presetCode} 的邀请`, p);
    const row = h('div', 'btn-row', undefined, p);
    button(`加入房间 ${presetCode}`, () => a.join(getName(), presetCode), 'primary', row);
    button('返回', a.back, 'ghost', row);
    return s;
  }
  const row = h('div', 'btn-row', undefined, p);
  button('创建房间', () => a.create(getName()), 'primary', row);

  const joinRow = h('div', 'join-row', undefined, p);
  const code = h('input', '', undefined, joinRow);
  code.id = 'online-code';
  code.maxLength = 4;
  code.placeholder = '房间码';
  code.autocapitalize = 'characters';
  code.addEventListener('input', () => (code.value = code.value.toUpperCase().replace(/[^A-Z]/g, '')));
  button('加入', () => code.value.length === 4 && a.join(getName(), code.value), 'secondary', joinRow);

  const back = h('div', 'btn-row', undefined, p);
  button('返回', a.back, 'ghost', back);
  return s;
}

export interface LobbyActions {
  start(): void;
  setLevel(level: number): void;
  setColor(color: number): void;
  leave(): void;
}

/** Waiting room: invite link, players, level (host) and colour choice. */
export function lobbyScreen(room: RoomInfo, myId: string, link: string, levels: readonly LevelDef[], a: LobbyActions): HTMLElement {
  const s = h('div', 'screen panel-screen');
  const p = h('div', 'panel lobby-panel', undefined, s);
  const isHost = room.hostId === myId;
  const head = h('div', 'lobby-head', undefined, p);
  h('h2', '', '房间', head);
  h('div', 'room-code', room.code, head);

  // Invite link: copy / share. Clipboard needs HTTPS or localhost, so fall back to selecting the text.
  const inviteBox = h('div', 'invite', undefined, p);
  const linkInput = h('input', 'invite-link', undefined, inviteBox);
  linkInput.id = 'invite-link';
  linkInput.readOnly = true;
  linkInput.value = link;
  linkInput.addEventListener('focus', () => linkInput.select());
  const copyBtn = button(
    '复制邀请链接',
    () => {
      const done = (): void => {
        copyBtn.textContent = '已复制';
        window.setTimeout(() => (copyBtn.textContent = '复制邀请链接'), 1600);
      };
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(link).then(done, () => linkInput.select());
      else {
        linkInput.focus();
        linkInput.select();
        try {
          if (document.execCommand('copy')) done();
        } catch {
          // Leave the text selected so the player can copy it by hand.
        }
      }
    },
    'secondary',
    inviteBox,
  );
  if (navigator.share) {
    button('分享', () => void navigator.share({ title: 'DESERT THRUST 赛车邀请', text: `来和我比赛！房间码 ${room.code}`, url: link }).catch(() => undefined), 'ghost', inviteBox);
  }

  const list = h('ul', 'players', undefined, p);
  for (const pl of room.players) {
    const li = h('li', pl.id === myId ? 'me' : '', undefined, list);
    const chip = h('span', 'chip', undefined, li);
    chip.style.background = hex(PLAYER_COLORS[pl.color] ?? 0xffffff);
    h('span', 'pname', pl.name + (pl.id === myId ? '（我）' : ''), li);
    if (pl.id === room.hostId) h('span', 'tag', '房主', li);
    if (pl.finishTime === -1 && room.phase === 'racing') h('span', 'tag dim', '下一场加入', li);
  }

  const me = room.players.find((pl) => pl.id === myId);
  const colors = h('div', 'color-row', undefined, p);
  h('span', 'setting-label', '车身颜色', colors);
  const taken = new Set(room.players.filter((pl) => pl.id !== myId).map((pl) => pl.color));
  PLAYER_COLORS.forEach((c, i) => {
    const b = h('button', `swatch${me?.color === i ? ' on' : ''}`, undefined, colors);
    b.type = 'button';
    b.style.background = hex(c);
    b.disabled = taken.has(i);
    b.setAttribute('aria-label', `颜色 ${i + 1}`);
    b.addEventListener('click', () => a.setColor(i));
  });

  const levelRow = h('div', 'setting-row', undefined, p);
  h('div', 'setting-label', '赛道', levelRow);
  if (isHost) {
    const sel = h('select', 'level-select', undefined, levelRow);
    sel.id = 'room-level';
    for (const l of levels) {
      const o = h('option', '', `${l.id}. ${l.name}`, sel);
      o.value = String(l.id);
      if (l.id === room.level) o.selected = true;
    }
    sel.addEventListener('change', () => a.setLevel(Number(sel.value)));
  } else {
    h('div', 'level-name', levels.find((l) => l.id === room.level)?.name ?? '', levelRow);
  }

  const btns = h('div', 'btn-row', undefined, p);
  if (isHost) {
    const b = button(room.players.length > 1 ? '开始比赛' : '开始比赛（等朋友加入或先单人试跑）', a.start, 'primary', btns);
    b.disabled = room.phase === 'racing';
  } else {
    h('div', 'lobby-sub', room.phase === 'racing' ? '比赛进行中，下一场一起开始…' : '等待房主开始比赛…', btns);
  }
  button('退出房间', a.leave, 'ghost', btns);
  return s;
}

/** Live race results (fills in as players cross the line). */
export function onlineResults(rows: readonly OnlineStanding[], done: boolean, a: { lobby(): void }): HTMLElement {
  const s = h('div', 'screen panel-screen');
  const p = h('div', 'panel result-panel', undefined, s);
  h('h2', 'ok', done ? '比赛结束' : '你已到达终点', p);
  const table = h('table', '', undefined, p);
  rows.forEach((r, i) => {
    const tr = h('tr', r.me ? 'me' : '', undefined, table);
    h('td', 'rank', String(i + 1), tr);
    const name = h('td', '', undefined, tr);
    const chip = h('span', 'chip', undefined, name);
    chip.style.background = hex(PLAYER_COLORS[r.color] ?? 0xffffff);
    name.append(` ${r.name}${r.me ? '（我）' : ''}`);
    h('td', '', r.time !== null ? formatTime(r.time) : done ? '未完成' : '比赛中…', tr);
  });
  if (!done) h('div', 'lobby-sub', '等待其他车手冲线…', p);
  const btns = h('div', 'btn-row', undefined, p);
  button('回到房间', a.lobby, 'primary', btns);
  return s;
}
