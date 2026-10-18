import type { ClientMsg, RoomInfo, ServerMsg } from './protocol';

type Handler<T extends ServerMsg['type']> = (msg: Extract<ServerMsg, { type: T }>) => void;

/**
 * One WebSocket to the game server (same host as the page, path /ws).
 * Keeps an estimate of the server clock so every player's countdown lines up.
 */
export class NetClient {
  id = '';
  room: RoomInfo | null = null;
  private ws: WebSocket | null = null;
  private readonly handlers = new Map<string, Set<(m: ServerMsg) => void>>();
  private readonly offsets: number[] = [];
  private offset = 0;
  private pingTimer = 0;
  private opening: Promise<void> | null = null;
  /** Fired when the connection drops (after it had been open). */
  onDisconnect: (() => void) | null = null;

  /** Server's LAN address (for invite links when this page was opened as localhost). */
  lan: string | null = null;

  /** Link that brings someone else into `code`. */
  inviteLink(code: string): string {
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    const host = local && this.lan ? `${this.lan}${location.port ? `:${location.port}` : ''}` : location.host;
    return `${location.protocol}//${host}${location.pathname}?room=${code}`;
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  get isHost(): boolean {
    return !!this.room && this.room.hostId === this.id;
  }

  /** Estimated server time in ms. */
  serverNow(): number {
    return Date.now() + this.offset;
  }

  on<T extends ServerMsg['type']>(type: T, fn: Handler<T>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    const h = fn as (m: ServerMsg) => void;
    set.add(h);
    return () => set!.delete(h);
  }

  connect(): Promise<void> {
    if (this.connected) return Promise.resolve();
    if (this.opening) return this.opening;
    this.opening = new Promise<void>((resolve, reject) => {
      const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        this.opening = null;
        reject(e instanceof Error ? e : new Error(String(e)));
        return;
      }
      this.ws = ws;
      const timeout = window.setTimeout(() => {
        ws.close();
        this.opening = null;
        reject(new Error('timeout'));
      }, 6000);
      let welcomed = false;
      ws.onmessage = (ev) => {
        let msg: ServerMsg;
        try {
          msg = JSON.parse(String(ev.data)) as ServerMsg;
        } catch {
          return;
        }
        if (msg.type === 'welcome') {
          this.id = msg.id;
          this.lan = msg.lan;
          welcomed = true;
          window.clearTimeout(timeout);
          this.opening = null;
          this.startClockSync();
          resolve();
        } else if (msg.type === 'pong') {
          this.onPong(msg.c, msg.s);
        } else if (msg.type === 'room') {
          this.room = msg.room;
        } else if (msg.type === 'start') {
          this.room = msg.room;
        }
        this.handlers.get(msg.type)?.forEach((h) => h(msg));
      };
      ws.onerror = () => {
        if (!welcomed) {
          window.clearTimeout(timeout);
          this.opening = null;
          reject(new Error('connect failed'));
        }
      };
      ws.onclose = () => {
        window.clearInterval(this.pingTimer);
        this.ws = null;
        this.room = null;
        if (welcomed) this.onDisconnect?.();
      };
    });
    return this.opening;
  }

  send(msg: ClientMsg): void {
    if (this.connected) this.ws!.send(JSON.stringify(msg));
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
    this.room = null;
  }

  private startClockSync(): void {
    const ping = (): void => this.send({ type: 'ping', c: Date.now() });
    // A quick burst for a good first estimate, then a slow refresh.
    for (let i = 0; i < 5; i++) window.setTimeout(ping, i * 150);
    window.clearInterval(this.pingTimer);
    this.pingTimer = window.setInterval(ping, 4000);
  }

  private onPong(sent: number, server: number): void {
    const now = Date.now();
    const rtt = now - sent;
    this.offsets.push(server + rtt / 2 - now);
    if (this.offsets.length > 9) this.offsets.shift();
    // Median: robust to one slow round trip.
    const sorted = [...this.offsets].sort((a, b) => a - b);
    this.offset = sorted[Math.floor(sorted.length / 2)]!;
  }
}
