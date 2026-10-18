import type * as THREE from 'three';
import type { QualitySettings } from '../config/quality';
import type { Physics } from '../core/Physics';
import type { NetClient } from '../net/NetClient';
import type { CarState, PlayerInfo, RoomInfo } from '../net/protocol';
import { RemoteCar } from '../net/RemoteCar';
import type { CarController } from '../vehicle/CarController';
import type { Campaign } from './Campaign';

/** Send our car ~20 times a second. */
const SEND_INTERVAL = 0.05;

export interface OnlineStanding {
  readonly id: string;
  readonly name: string;
  readonly color: number;
  readonly time: number | null;
  readonly passed: boolean | null;
  readonly dnf: boolean;
  readonly me: boolean;
}

/**
 * One online race: other players' cars from the network, our car to the network,
 * a countdown on the shared server clock, and live standings / results.
 * The local run itself (stunt gates, retries, finish) is the normal Campaign.
 */
export class OnlineRace {
  readonly remotes = new Map<string, RemoteCar>();
  private sendTimer = 0;
  private readonly offs: (() => void)[] = [];
  private room: RoomInfo;
  private localFinish: number | null = null;
  /** Fires whenever results change (someone finished / left). */
  onResults: (() => void) | null = null;

  constructor(
    private readonly net: NetClient,
    private readonly physics: Physics,
    private readonly scene: THREE.Scene,
    private readonly quality: QualitySettings,
    private readonly campaign: Campaign,
    private readonly car: CarController,
    readonly raceId: number,
    readonly startAt: number,
    room: RoomInfo,
  ) {
    this.room = room;
    const me = room.players.find((p) => p.id === net.id);
    campaign.prepareOnline(me?.slot ?? 0);
    campaign.externalStanding = () => this.standing();
    for (const p of room.players) if (p.id !== net.id && p.finishTime !== -1) this.addRemote(p);

    this.offs.push(
      net.on('state', (m) => this.remotes.get(m.id)?.push(m.s)),
      net.on('room', (m) => {
        this.room = m.room;
        // Players who left or quit this race: take their cars off the track.
        for (const [id, car] of this.remotes) {
          const p = m.room.players.find((x) => x.id === id);
          if (!p || p.finishTime === -1) {
            car.dispose();
            this.remotes.delete(id);
          }
        }
        for (const p of m.room.players) {
          if (p.id !== net.id && !this.remotes.has(p.id) && p.finishTime !== -1 && m.room.raceId === raceId) this.addRemote(p);
        }
        this.onResults?.();
      }),
      net.on('left', (m) => {
        this.remotes.get(m.id)?.dispose();
        this.remotes.delete(m.id);
        this.onResults?.();
      }),
      net.on('finish', () => this.onResults?.()),
    );
  }

  private addRemote(p: PlayerInfo): void {
    this.remotes.set(p.id, new RemoteCar(this.physics, this.scene, p, this.quality));
  }

  /** Seconds until the green light (negative once racing). */
  get secondsToGo(): number {
    return (this.startAt - this.net.serverNow()) / 1000;
  }

  /** Before each physics step. */
  step(): void {
    const now = this.net.serverNow();
    // The 3-2-1 begins 3 s before the shared start time.
    if (this.campaign.phase === 'waiting' && now >= this.startAt - 3000) this.campaign.beginCountdown();
    this.campaign.syncCountdown((this.startAt - now) / 1000);
    this.campaign.syncRaceClock((now - this.startAt) / 1000);
    for (const r of this.remotes.values()) r.step(now);
  }

  /** Once per rendered frame. */
  frame(dt: number, viewportHeight: number, fov: number): void {
    const now = this.net.serverNow();
    for (const r of this.remotes.values()) r.updateVisual(dt, now, viewportHeight, fov);
    this.sendTimer += dt;
    if (this.sendTimer >= SEND_INTERVAL) {
      this.sendTimer = 0;
      this.sendState(now);
    }
  }

  private sendState(now: number): void {
    const c = this.car;
    const p = c.simPosition;
    const q = c.simQuaternion;
    const v = c.body.linvel();
    const t = c.thrust;
    const r2 = (x: number): number => Math.round(x * 100) / 100;
    const r4 = (x: number): number => Math.round(x * 10000) / 10000;
    const s: CarState = {
      t: Math.round(now),
      p: [r2(p.x), r2(p.y), r2(p.z)],
      q: [r4(q.x), r4(q.y), r4(q.z), r4(q.w)],
      v: [r2(v.x), r2(v.y), r2(v.z)],
      s: r2(c.forwardSpeed),
      th: (t.rear > 0 ? 1 : 0) | (t.down > 0.3 ? 2 : 0) | (t.left > 0.2 ? 4 : 0) | (t.right > 0.2 ? 8 : 0),
      d: Math.round(this.campaign.playerTracker.distance),
    };
    this.net.send({ type: 'state', s });
  }

  /** Our run ended (finish line): report it. */
  reportFinish(time: number, passed: boolean): void {
    this.localFinish = time;
    this.net.send({ type: 'finish', raceId: this.raceId, time, passed });
  }

  /** Place among everyone in this race: finishers by time, then by progress. */
  standing(): { place: number; racers: number } {
    const list = this.results();
    const i = list.findIndex((r) => r.me);
    return { place: i + 1, racers: list.length };
  }

  results(): OnlineStanding[] {
    const racers = this.room.players.filter((p) => p.finishTime !== -1 || p.id === this.net.id);
    const rows = racers.map((p) => {
      const me = p.id === this.net.id;
      const time = me ? (this.localFinish ?? p.finishTime) : p.finishTime;
      const dist = me ? this.campaign.playerTracker.distance : (this.remotes.get(p.id)?.distance ?? 0);
      return {
        row: { id: p.id, name: p.name, color: p.color, time: time !== null && time >= 0 ? time : null, passed: p.passed, dnf: false, me },
        dist,
      };
    });
    rows.sort((a, b) => {
      const ta = a.row.time;
      const tb = b.row.time;
      if (ta !== null && tb !== null) return ta - tb;
      if (ta !== null) return -1;
      if (tb !== null) return 1;
      return b.dist - a.dist;
    });
    return rows.map((r) => r.row);
  }

  /** Everyone still connected has a result. */
  get allDone(): boolean {
    return this.room.phase === 'lobby' || this.room.raceId !== this.raceId;
  }

  dispose(): void {
    this.offs.forEach((off) => off());
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear();
    this.campaign.externalStanding = null;
  }
}
