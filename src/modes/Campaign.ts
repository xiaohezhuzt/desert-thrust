import * as THREE from 'three';
import type { GateDef, LevelDef } from '../config/levels';
import type { CarController } from '../vehicle/CarController';
import type { LandingGrade, LandingResult } from '../vehicle/LandingJudge';
import type { AIDriver, RacerView } from '../ai/AIDriver';
import { LineTracker, type RacingLine } from '../ai/RacingLine';
import { toVec } from '../world/TrackBuilder';

const GRADE_RANK: Record<LandingGrade, number> = { CRASH: 0, BAD: 1, GOOD: 2, PERFECT: 3 };
const COUNTDOWN = 3;
const RESTART_DELAY = 2.8;

export type RunPhase = 'waiting' | 'countdown' | 'racing' | 'finished' | 'failed';
type GateStatus = 'pending' | 'armed' | 'passed';

interface GateState {
  readonly def: GateDef;
  status: GateStatus;
  grade: LandingGrade | null;
  wasInverted: boolean;
  wasOnWall: boolean;
}

export interface RunResult {
  /** met every requirement (grades, place) */
  readonly passed: boolean;
  readonly place: number;
  readonly racers: number;
  readonly requiredPlace: number;
  readonly time: number;
  readonly grades: readonly (LandingGrade | null)[];
  readonly gateNames: readonly string[];
  readonly retriesUsed: number;
  readonly perfects: number;
}

/** Things the campaign wants shown; the Game forwards them to the HUD. */
export interface CampaignEvents {
  banner(text: string, sub: string, tone: 'info' | 'good' | 'bad', seconds: number): void;
  finished(result: RunResult): void;
}

/** Point inside an oriented box (heading about +Y). */
function insideBox(p: THREE.Vector3, center: readonly number[], half: readonly number[], heading: number): boolean {
  const dx = p.x - center[0]!;
  const dy = p.y - center[1]!;
  const dz = p.z - center[2]!;
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  const lx = c * dx - s * dz;
  const lz = s * dx + c * dz;
  return Math.abs(lx) <= half[0]! && Math.abs(dy) <= half[1]! && Math.abs(lz) <= half[2]!;
}

/**
 * One run of a campaign level: countdown, sequential must-pass stunt gates,
 * checkpoint retries with time penalty, time limit and finish.
 * (AI places and star ratings arrive in stages 7–8.)
 */
export class Campaign {
  phase: RunPhase = 'countdown';
  /** race clock, includes retry penalties */
  time = 0;
  /** Retry penalties added this run (kept when the online clock catches the timer up). */
  private penalties = 0;
  /** seconds since the level loaded (drives time of day) */
  elapsed = 0;
  retriesLeft: number;
  /** 0..1 along the racing line */
  progress = 0;

  private countdown = COUNTDOWN;
  private lastCount = -1;
  private restartTimer = 0;
  private readonly gates: GateState[];
  readonly playerTracker: LineTracker;
  /** race time each opponent crossed the line, or null */
  private readonly aiFinish: (number | null)[];
  private playerFinish: number | null = null;
  private readonly views: RacerView[];
  /** time spent outside an armed gate while on the ground */
  private outsideGrounded = 0;
  private perfects = 0;

  constructor(
    readonly def: LevelDef,
    private readonly line: RacingLine,
    private readonly car: CarController,
    private readonly obstacles: ReadonlySet<number>,
    private readonly events: CampaignEvents,
    readonly opponents: readonly AIDriver[] = [],
  ) {
    this.retriesLeft = def.retriesAllowed;
    this.playerTracker = new LineTracker(line);
    this.aiFinish = opponents.map(() => null);
    const tracker = this.playerTracker;
    this.views = [
      {
        get distance() {
          return tracker.distance;
        },
        get lateral() {
          return tracker.lateral;
        },
        car,
      },
      ...opponents.map((d) => ({
        get distance() {
          return d.tracker.distance;
        },
        get lateral() {
          return d.tracker.lateral;
        },
        car: d.car,
      })),
    ];
    this.gates = def.gates.map((g) => ({ def: g, status: 'pending', grade: null, wasInverted: false, wasOnWall: false }));
  }

  /** Controls are frozen during the countdown and after the run ends. */
  get controlsLocked(): boolean {
    return this.phase !== 'racing';
  }

  get currentGate(): GateDef | null {
    return this.gates.find((g) => g.status !== 'passed')?.def ?? null;
  }

  restart(): void {
    this.phase = 'countdown';
    this.time = 0;
    this.penalties = 0;
    this.elapsed = 0;
    this.countdown = COUNTDOWN;
    this.lastCount = -1;
    this.retriesLeft = this.def.retriesAllowed;
    this.perfects = 0;
    this.playerFinish = null;
    this.aiFinish.fill(null);
    for (const g of this.gates) {
      g.status = 'pending';
      g.grade = null;
    }
    this.placeOnGrid();
  }

  /** Opponents line up ahead in pairs; the player starts at the back. */
  private placeOnGrid(): void {
    const { position, heading } = this.def.start;
    const fwd = new THREE.Vector3(-Math.sin(heading), 0, -Math.cos(heading));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const start = toVec(position);
    const slot = (k: number): THREE.Vector3 => {
      const row = Math.floor(k / 2);
      const side = k % 2 === 0 ? -1 : 1;
      return start
        .clone()
        .addScaledVector(fwd, (Math.ceil(this.opponents.length / 2) - row) * 9)
        .addScaledVector(right, side * 4.2);
    };
    this.opponents.forEach((d, k) => {
      d.car.setSpawn(slot(k), heading);
      d.resetState();
    });
    if (this.gridSlot !== null) {
      // Online: players take the grid two by two, slot 0 at the front.
      const row = Math.floor(this.gridSlot / 2);
      const side = this.gridSlot % 2 === 0 ? -1 : 1;
      this.car.setSpawn(start.clone().addScaledVector(fwd, -row * 9).addScaledVector(right, side * 4.2), heading);
    } else {
      this.car.setSpawn(start, heading);
    }
    this.playerTracker.lose();
  }

  /** Every racer, for AI awareness. */
  get racerViews(): readonly RacerView[] {
    return this.views;
  }

  /** Player's current place (1-based) and number of racers. */
  get standing(): { place: number; racers: number } {
    if (this.externalStanding) return this.externalStanding();
    const racers = this.opponents.length + 1;
    const me = this.playerFinish;
    let ahead = 0;
    this.opponents.forEach((d, k) => {
      const f = this.aiFinish[k];
      if (f !== null && (me === null || f < me)) ahead++;
      else if (f === null && me === null && d.tracker.distance > this.playerTracker.distance) ahead++;
    });
    return { place: ahead + 1, racers };
  }

  /** Online: someone else decides standings (other players' progress over the network). */
  externalStanding: (() => { place: number; racers: number }) | null = null;
  /** Online: grid slot of the local player and the field size. */
  private gridSlot: number | null = null;
  /** Online: failing all retries restarts the run locally instead of from the grid countdown. */
  online = false;

  /**
   * Online start: put the car on its grid slot and freeze until `beginCountdown`
   * (called when the shared server clock reaches the countdown).
   */
  prepareOnline(slot: number): void {
    this.online = true;
    this.gridSlot = slot;
    this.restart();
    this.phase = 'waiting';
  }

  /** Online: drive the 3-2-1 from the shared clock so every device gets the green light together. */
  syncCountdown(secondsLeft: number): void {
    if (this.phase === 'countdown') this.countdown = Math.min(this.countdown, secondsLeft);
  }

  /** Online: the race clock follows the shared server clock, so pausing never shortens your time. */
  syncRaceClock(secondsSinceGo: number): void {
    if (this.phase === 'racing') this.time = Math.max(this.time, secondsSinceGo + this.penalties);
  }

  beginCountdown(): void {
    if (this.phase !== 'waiting') return;
    this.phase = 'countdown';
    this.countdown = 3;
    this.lastCount = -1;
  }

  /** Line distance of the player (for AI rubber-banding). */
  get playerDistance(): number {
    return this.playerTracker.distance;
  }

  /** Call once per physics step, after the landing judge. */
  step(dt: number, landing: LandingResult | null): void {
    this.elapsed += dt;
    switch (this.phase) {
      case 'waiting':
        this.playerTracker.update(this.car.simPosition);
        return;
      case 'countdown':
        // Keep positions meaningful on the grid.
        this.playerTracker.update(this.car.simPosition);
        for (const d of this.opponents) d.tracker.update(d.car.simPosition);
        this.tickCountdown(dt);
        return;
      case 'failed':
        this.restartTimer -= dt;
        if (this.restartTimer <= 0) this.restart();
        return;

      case 'finished':
        return;
      case 'racing':
        break;
    }

    this.time += dt;
    this.playerTracker.update(this.car.simPosition);
    this.progress = this.playerTracker.progress;
    this.opponents.forEach((d, k) => {
      if (this.aiFinish[k] === null && d.tracker.distance >= this.line.length - 25) {
        this.aiFinish[k] = this.time;
        d.finished = true;
      }
    });
    if (this.time > this.def.timeLimit) {
      this.failLevel('超时', '本关重来');
      return;
    }
    if (landing?.grade === 'PERFECT') this.perfects++;

    const gate = this.gates.find((g) => g.status !== 'passed');
    if (gate) this.updateGate(gate, landing, dt);

    const f = this.def.finish;
    if (insideBox(this.car.simPosition, f.center, f.halfSize, f.heading)) {
      if (gate) {
        this.failGate(gate, '未完成特技', gate.def.name);
      } else if (this.perfects < (this.def.requiredPerfects ?? 0)) {
        this.failLevel('需要至少 1 次 PERFECT', '本关重来');
      } else {
        this.phase = 'finished';
        this.playerFinish = this.time;
        const { place, racers } = this.standing;
        this.events.finished({
          passed: place <= this.def.requiredPlace,
          place,
          racers,
          requiredPlace: this.def.requiredPlace,
          time: this.time,
          grades: this.gates.map((g) => g.grade),
          gateNames: this.gates.map((g) => g.def.name),
          retriesUsed: this.def.retriesAllowed - this.retriesLeft,
          perfects: this.perfects,
        });
      }
    }
  }

  private tickCountdown(dt: number): void {
    this.countdown -= dt;
    const n = Math.ceil(this.countdown);
    if (n !== this.lastCount) {
      this.lastCount = n;
      if (n > 0) this.events.banner(String(n), this.def.name, 'info', 0.9);
    }
    if (this.countdown <= 0) {
      this.phase = 'racing';
      this.events.banner('GO!', this.def.subtitle, 'good', 1.1);
    }
  }

  private updateGate(gate: GateState, landing: LandingResult | null, dt: number): void {
    const d = gate.def;
    const inside = insideBox(this.car.simPosition, d.center, d.halfSize, d.heading);
    if (gate.status === 'pending') {
      if (inside) {
        gate.status = 'armed';
        gate.wasInverted = false;
        gate.wasOnWall = false;
      }
      return;
    }
    if (this.car.onAdhesive && this.car.upVector.y < -0.5) gate.wasInverted = true;
    if (this.car.onAdhesive && Math.abs(this.car.upVector.y) < 0.4) gate.wasOnWall = true;
    if (this.car.touchingAny(this.obstacles)) {
      this.failGate(gate, 'CRASH', `撞上了${d.name}的车辆`);
      return;
    }
    if (d.pass === 'ride') {
      // Ride gates (wall rides, full loops): no landing needed, just do it and get back down.
      const done = d.requires === 'wall' ? gate.wasOnWall : d.requires === 'inverted' ? gate.wasInverted : true;
      if (done && !this.car.onAdhesive && !this.car.airborne && this.car.groundedWheels >= 3) {
        gate.status = 'passed';
        gate.grade = 'GOOD';
        this.events.banner(`${d.name} 通过`, d.requires === 'wall' ? '飞檐走壁！' : '完美回环！', 'good', 1.6);
        return;
      }
      if (landing?.grade === 'CRASH') this.failGate(gate, 'CRASH', d.name);
      else if (!inside && !this.car.airborne) {
        this.outsideGrounded += dt;
        if (this.outsideGrounded > 0.6) this.failGate(gate, '特技失败', `没有完成${d.name}`);
      }
      return;
    }
    if (landing && d.requires === 'inverted' && !gate.wasInverted) return;
    if (landing && d.landingZone && landing.grade !== 'CRASH') {
      const z = d.landingZone;
      if (!insideBox(this.car.simPosition, z.center, z.halfSize, d.heading)) {
        this.failGate(gate, '特技失败', `没有落到${d.name}的对岸`);
        return;
      }
    }
    if (landing) {
      const need = d.minGrade ?? this.def.requiredLandingGrade;
      if (d.requires === 'roll360' && Math.abs(this.car.lastFlightRoll) < Math.PI * 2 * 0.92) {
        this.failGate(gate, '特技失败', `需要空中横滚 360°（这次 ${Math.round(Math.abs(this.car.lastFlightRoll) * 57.3)}°）`);
        return;
      }
      if (GRADE_RANK[landing.grade] >= GRADE_RANK[need]) {
        gate.status = 'passed';
        gate.grade = landing.grade;
        this.events.banner(`${d.name} 通过`, `落地 ${landing.grade}`, 'good', 1.6);
      } else {
        this.failGate(gate, '特技失败', `落地 ${landing.grade}，需要 ≥ ${need}`);
      }
      return;
    }
    // Allow the landing judge to finish before calling it a miss.
    this.outsideGrounded = !inside && !this.car.airborne ? this.outsideGrounded + dt : 0;
    if (this.outsideGrounded > 0.6) this.failGate(gate, '特技失败', `没有完成${d.name}`);
  }

  /** The car fell off the course or sank: a gate retry if a stunt was armed, else back to the last safe spot. */
  carLost(reason: string): void {
    if (this.phase !== 'racing') {
      this.car.reset();
      return;
    }
    const gate = this.gates.find((g) => g.status === 'armed');
    if (gate) this.failGate(gate, reason, gate.def.name);
    else {
      this.events.banner(reason, '回到上一个安全位置', 'bad', 1.4);
      this.car.reset();
    }
  }

  private failGate(gate: GateState, title: string, detail: string): void {
    gate.status = 'pending';
    this.outsideGrounded = 0;
    if (this.retriesLeft <= 0) {
      this.failLevel(title, '重试次数用完，本关重来');
      return;
    }
    this.retriesLeft--;
    this.time += this.def.retryPenalty;
    this.penalties += this.def.retryPenalty;
    this.events.banner(title, `${detail} · 检查点重试 +${this.def.retryPenalty}s · 剩余 ${this.retriesLeft} 次`, 'bad', 2.2);
    this.car.respawn(toVec(gate.def.checkpoint), gate.def.checkpointHeading);
    this.playerTracker.lose();
  }

  private failLevel(title: string, sub: string): void {
    this.phase = 'failed';
    this.restartTimer = RESTART_DELAY;
    this.events.banner(title, sub, 'bad', RESTART_DELAY);
  }
}
