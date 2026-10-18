/**
 * DESERT THRUST game server: serves the built game (dist/) and hosts online
 * race rooms over a WebSocket at /ws. One process, one port.
 *
 *   npm run build && npm run serve            (PORT defaults to 4173)
 *
 * Message shapes: src/net/protocol.ts.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT ?? 4173);
const DIST = resolve(process.env.DIST ?? 'dist');
const MAX_PLAYERS = 8;
const COLORS = 8;
const LEVELS = 6;
/** Time between "start" and the green light: lets every device load the level. */
const START_DELAY_MS = 7000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.ico': 'image/x-icon',
};

// ---- Static files -----------------------------------------------------------------
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  let file = normalize(join(DIST, decodeURIComponent(url.pathname)));
  if (!file.startsWith(DIST)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end('dist/ 不存在：请先运行 npm run build');
    return;
  }
  const type = MIME[extname(file)] ?? 'application/octet-stream';
  // Hashed assets can be cached forever; the page and service worker must revalidate.
  const cache = file.includes(`${'/'}assets${'/'}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
  res.writeHead(200, { 'content-type': type, 'cache-control': cache });
  createReadStream(file).pipe(res);
});

// ---- Rooms --------------------------------------------------------------------------
/** @type {Map<string, any>} */
const rooms = new Map();
let nextId = 1;

function makeCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += letters[Math.floor(Math.random() * letters.length)];
    if (!rooms.has(c)) return c;
  }
}

function cleanName(n) {
  const s = String(n ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16);
  return s || '车手';
}

function roomInfo(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    level: room.level,
    phase: room.phase,
    raceId: room.raceId,
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      slot: p.slot,
      finishTime: p.finishTime,
      passed: p.passed,
    })),
  };
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcast(room, msg, exceptId) {
  const data = JSON.stringify(msg);
  for (const p of room.players.values()) if (p.id !== exceptId && p.ws.readyState === 1) p.ws.send(data);
}

function pushRoom(room) {
  broadcast(room, { type: 'room', room: roomInfo(room) });
}

function freeColor(room) {
  const used = new Set([...room.players.values()].map((p) => p.color));
  for (let c = 0; c < COLORS; c++) if (!used.has(c)) return c;
  return 0;
}

function leaveRoom(client) {
  const room = client.room;
  if (!room) return;
  room.players.delete(client.id);
  client.room = null;
  if (room.players.size === 0) {
    rooms.delete(room.code);
    return;
  }
  if (room.hostId === client.id) room.hostId = room.players.keys().next().value;
  broadcast(room, { type: 'left', id: client.id });
  maybeEndRace(room);
  pushRoom(room);
}

function maybeEndRace(room) {
  if (room.phase !== 'racing') return;
  const all = [...room.players.values()];
  if (all.every((p) => p.finishTime !== null)) room.phase = 'lobby';
}

/** This machine's LAN IPv4 address, so invite links opened from localhost still work for others. */
function lanAddress() {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return null;
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

wss.on('connection', (ws) => {
  const client = { id: String(nextId++), ws, room: null };
  send(ws, { type: 'welcome', id: client.id, lan: lanAddress() });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    const room = client.room;
    const me = room?.players.get(client.id);
    switch (msg.type) {
      case 'ping':
        send(ws, { type: 'pong', c: msg.c, s: Date.now() });
        break;
      case 'create': {
        leaveRoom(client);
        const level = Math.min(LEVELS, Math.max(1, Math.floor(Number(msg.level) || 1)));
        const r = { code: makeCode(), hostId: client.id, level, phase: 'lobby', raceId: 0, startAt: 0, players: new Map() };
        rooms.set(r.code, r);
        r.players.set(client.id, { id: client.id, ws, name: cleanName(msg.name), color: 0, slot: 0, finishTime: null, passed: null });
        client.room = r;
        pushRoom(r);
        break;
      }
      case 'join': {
        const r = rooms.get(String(msg.code ?? '').toUpperCase());
        if (!r) return send(ws, { type: 'error', message: '房间不存在或已解散' });
        if (r.players.size >= MAX_PLAYERS) return send(ws, { type: 'error', message: '房间已满（最多 8 人）' });
        leaveRoom(client);
        r.players.set(client.id, {
          id: client.id,
          ws,
          name: cleanName(msg.name),
          color: freeColor(r),
          slot: r.players.size,
          // Joining mid-race: watch from the lobby until the next one.
          finishTime: r.phase === 'racing' ? -1 : null,
          passed: null,
        });
        client.room = r;
        pushRoom(r);
        break;
      }
      case 'leave':
        leaveRoom(client);
        break;
      case 'setLevel':
        if (room && room.hostId === client.id && room.phase === 'lobby') {
          room.level = Math.min(LEVELS, Math.max(1, Math.floor(Number(msg.level) || 1)));
          pushRoom(room);
        }
        break;
      case 'setColor':
        if (me && room.phase === 'lobby') {
          const c = Math.floor(Number(msg.color));
          const taken = [...room.players.values()].some((p) => p.id !== me.id && p.color === c);
          if (c >= 0 && c < COLORS && !taken) {
            me.color = c;
            pushRoom(room);
          }
        }
        break;
      case 'start':
        if (room && room.hostId === client.id && room.phase === 'lobby') {
          room.phase = 'racing';
          room.raceId++;
          room.startAt = Date.now() + START_DELAY_MS;
          let slot = 0;
          for (const p of room.players.values()) {
            p.slot = slot++;
            p.finishTime = null;
            p.passed = null;
          }
          broadcast(room, { type: 'start', raceId: room.raceId, level: room.level, startAt: room.startAt, room: roomInfo(room) });
        }
        break;
      case 'state':
        if (room && room.phase === 'racing' && msg.s && typeof msg.s === 'object') {
          broadcast(room, { type: 'state', id: client.id, s: msg.s }, client.id);
        }
        break;
      case 'finish':
        if (me && room.phase === 'racing' && msg.raceId === room.raceId && me.finishTime === null) {
          me.finishTime = Math.max(0, Number(msg.time) || 0);
          me.passed = !!msg.passed;
          broadcast(room, { type: 'finish', id: me.id, time: me.finishTime, passed: me.passed });
          maybeEndRace(room);
          pushRoom(room);
        }
        break;
      case 'backToLobby':
        // A player quit the race early: count them as done so the race can end.
        if (me && room.phase === 'racing' && me.finishTime === null) {
          me.finishTime = -1;
          maybeEndRace(room);
          pushRoom(room);
        }
        break;
    }
  });

  ws.on('close', () => leaveRoom(client));
});

// Drop dead connections (phones that slept, closed tabs).
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 15000);
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
});
wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, '0.0.0.0', () => {
  console.log(`DESERT THRUST 服务器已启动: http://localhost:${PORT}/`);
  console.log(`同一 Wi-Fi 下的手机/iPad/同学电脑打开: http://${lanAddress() ?? '192.168.x.x'}:${PORT}/`);
});
