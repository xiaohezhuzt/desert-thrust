/**
 * Online multiplayer messages (JSON over one WebSocket at /ws).
 * The Node server in server/index.mjs mirrors these shapes.
 */

export const MAX_PLAYERS = 8;

/** Car paints players can be given (index into this list travels on the wire). */
export const PLAYER_COLORS: readonly number[] = [
  0xf4f4f1, 0xe8322c, 0x2f8cff, 0xffd21f, 0x3fc35a, 0xff7ad9, 0x9a5cff, 0xff8a1a,
];

export interface PlayerInfo {
  id: string;
  name: string;
  color: number;
  /** grid slot for the current race (join order) */
  slot: number;
  /** race time in seconds once finished this race */
  finishTime: number | null;
  /** passed every requirement (place aside) when finishing */
  passed: boolean | null;
}

export interface RoomInfo {
  code: string;
  hostId: string;
  level: number;
  phase: 'lobby' | 'racing';
  raceId: number;
  players: PlayerInfo[];
}

/** Compact car snapshot, ~20 per second per player. */
export interface CarState {
  /** server time (ms) the snapshot was taken */
  t: number;
  p: [number, number, number];
  q: [number, number, number, number];
  v: [number, number, number];
  /** forward speed m/s */
  s: number;
  /** thruster bits: 1 rear, 2 down, 4 left, 8 right */
  th: number;
  /** distance along the racing line, metres */
  d: number;
}

export type ClientMsg =
  | { type: 'create'; name: string; level: number }
  | { type: 'join'; code: string; name: string }
  | { type: 'leave' }
  | { type: 'setLevel'; level: number }
  | { type: 'setColor'; color: number }
  | { type: 'start' }
  | { type: 'state'; s: CarState }
  | { type: 'finish'; raceId: number; time: number; passed: boolean }
  | { type: 'backToLobby' }
  | { type: 'ping'; c: number };

export type ServerMsg =
  | { type: 'welcome'; id: string; lan: string | null }
  | { type: 'room'; room: RoomInfo }
  | { type: 'error'; message: string }
  | { type: 'start'; raceId: number; level: number; startAt: number; room: RoomInfo }
  | { type: 'state'; id: string; s: CarState }
  | { type: 'finish'; id: string; time: number; passed: boolean }
  | { type: 'left'; id: string }
  | { type: 'pong'; c: number; s: number };
