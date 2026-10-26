/**
 * Campaign levels, fully data driven. Adding a level = adding an entry here.
 * Coordinates are world metres; y is up; headings are radians about +Y
 * (0 = driving toward -Z, π/2 = toward -X, -π/2 = toward +X).
 */
import type { LandingGrade } from '../vehicle/LandingJudge';

export type Vec3 = readonly [number, number, number];

export type Biome = 'desert' | 'coast' | 'mountain' | 'snow' | 'canyon' | 'city';
export type TimeOfDay = 'dawn' | 'noon' | 'dusk' | 'duskToNight' | 'night';
export type Weather = 'clear' | 'haze' | 'snow' | 'rain';

export type RoadStyle = 'asphalt' | 'dirt' | 'snow' | 'ice' | 'wet' | 'wood' | 'sand';

export interface RoadDef {
  /** Centre-line control points (Catmull-Rom). */
  readonly points: readonly Vec3[];
  readonly width: number;
  readonly style?: RoadStyle;
  /** on a deck with pillars (terrain doesn't follow it) */
  readonly elevated?: boolean;
  /** guard rails / walls along both edges */
  readonly barriers?: boolean;
  /** terrain flattening around the road (default 40 m flat + 120 m blend) */
  readonly terrainFlat?: number;
  readonly terrainBlend?: number;
}

/** A kicker ramp: low end at `position`, rising along `heading`. */
export interface KickerStunt {
  readonly type: 'kicker';
  readonly position: Vec3;
  readonly heading: number;
  readonly params: {
    readonly width: number;
    readonly length: number;
    readonly angleDeg: number;
    /** gap the AI must clear from the lip, metres (sets its approach speed) */
    readonly clearDistance?: number;
    /** explicit AI approach speed, m/s (overrides the ballistic estimate; also caps it) */
    readonly approachSpeed?: number;
  };
}

/** Parked vehicles side by side across the road, to be jumped over. */
export interface CarRowStunt {
  readonly type: 'carRow';
  /** centre of the row */
  readonly position: Vec3;
  /** travel direction of the jumper */
  readonly heading: number;
  readonly params: {
    readonly vehicles: readonly ParkedVehicleKind[];
    readonly gap: number;
  };
}

/** Orange toy-track loop: 'invertedHalfLoop' exits upside down; 'fullLoop' comes back to the road. */
export interface HalfLoopStunt {
  readonly type: 'invertedHalfLoop' | 'fullLoop';
  /** entry point on the ground */
  readonly position: Vec3;
  readonly heading: number;
  readonly params: {
    readonly radius: number;
    readonly width: number;
    /** sideways drift (to the right) over the half loop, so the exit clears the entry */
    readonly lateralOffset: number;
    readonly entryLength: number;
  };
}

/** A rounded crest across the road (downhill jumps). */
export interface HumpStunt {
  readonly type: 'hump';
  readonly position: Vec3;
  readonly heading: number;
  readonly params: { readonly width: number; readonly radius: number; readonly height: number };
}

/** Quarter-pipe wall along the right side of the road that the car can ride vertically. */
export interface WallRideStunt {
  readonly type: 'wallRide';
  /** start of the wall, on the road centre line */
  readonly position: Vec3;
  readonly heading: number;
  readonly params: { readonly length: number; readonly radius: number; readonly offset: number };
}

/** Arched tunnel over the road. */
export interface TunnelStunt {
  readonly type: 'tunnel';
  readonly position: Vec3;
  readonly heading: number;
  readonly params: { readonly length: number; readonly width: number; readonly height: number };
}

/** Building whose flat roof is drivable. `position` is the roof centre. */
export interface BuildingStunt {
  readonly type: 'building';
  readonly position: Vec3;
  readonly heading: number;
  readonly params: { readonly width: number; readonly length: number };
}

/** Boulders that roll down onto the road when the player arrives (with a warning). */
export interface RockfallStunt {
  readonly type: 'rockfall';
  /** trigger point on the road */
  readonly position: Vec3;
  readonly heading: number;
  readonly params: { readonly count: number; readonly side: number; readonly ahead: number };
}

export type StuntDef =
  | KickerStunt
  | CarRowStunt
  | HalfLoopStunt
  | HumpStunt
  | WallRideStunt
  | TunnelStunt
  | BuildingStunt
  | RockfallStunt;

export type ParkedVehicleKind = 'pickup' | 'boxTruck' | 'suv' | 'sedan' | 'robotaxi';

/**
 * A must-pass stunt gate: an oriented box. Entering arms it; the next graded landing
 * inside it must meet the level's required grade. Leaving without a landing fails it.
 */
export interface GateDef {
  readonly name: string;
  readonly center: Vec3;
  readonly halfSize: Vec3;
  readonly heading: number;
  /** where to respawn after failing this gate */
  readonly checkpoint: Vec3;
  readonly checkpointHeading: number;
  /** extra condition: upside down on a loop, a full air roll, or riding a vertical wall */
  readonly requires?: 'inverted' | 'roll360' | 'wall';
  /** stricter landing grade for this gate than the level default */
  readonly minGrade?: LandingGrade;
  /** landings outside this box (x, y, z centre / half size, same heading) don't count as clearing the stunt */
  readonly landingZone?: { readonly center: Vec3; readonly halfSize: Vec3 };
  /** 'landing' (default): judged on the next graded landing; 'ride': passes once `requires` is met and the car is back on normal ground */
  readonly pass?: 'landing' | 'ride';
}

export interface LevelDef {
  readonly id: number;
  readonly name: string;
  readonly subtitle: string;
  readonly biome: Biome;
  readonly timeOfDay: TimeOfDay;
  readonly weather: Weather;
  readonly aiCount: number;
  readonly aiSkill: number;
  readonly aiRubberBand: number;
  readonly requiredPlace: number;
  readonly requiredLandingGrade: LandingGrade;
  /** PERFECT landings required in total (level 4 needs 1) */
  readonly requiredPerfects?: number;
  readonly retriesAllowed: number;
  /** seconds */
  readonly timeLimit: number;
  /** target time for the third star, seconds */
  readonly parTime: number;
  /** seconds added on each checkpoint retry */
  readonly retryPenalty: number;
  readonly start: { readonly position: Vec3; readonly heading: number };
  readonly finish: { readonly center: Vec3; readonly halfSize: Vec3; readonly heading: number };
  readonly roads: readonly RoadDef[];
  readonly stunts: readonly StuntDef[];
  /** below this height the car is lost (fell off the course) */
  readonly killY?: number;
  /** local drop zones: inside `radius` of `center` (x, z) and below `belowY` = lost */
  readonly killZones?: readonly { readonly center: readonly [number, number]; readonly radius: number; readonly belowY: number }[];
  /** sea level; deeper than 1.3 m is a crash, shallow water slows you down */
  readonly waterLevel?: number;
  /** ravines / lake beds cut into the terrain */
  readonly carves?: readonly { readonly x: number; readonly z: number; readonly r: number; readonly depth: number }[];
  readonly gates: readonly GateDef[];
  /** Racing line from start to finish (progress, AI). */
  readonly trackSpline: readonly Vec3[];
}

const TO_PLUS_X = -Math.PI / 2;
const TO_MINUS_X = Math.PI / 2;

export const LEVELS: readonly LevelDef[] = [
  {
    id: 1,
    name: '沙漠发布会场',
    subtitle: '飞越车队，倒挂半环',
    biome: 'desert',
    timeOfDay: 'duskToNight',
    weather: 'clear',
    aiCount: 3,
    aiSkill: 0.3,
    aiRubberBand: 0.5,
    requiredPlace: 3,
    requiredLandingGrade: 'GOOD',
    retriesAllowed: 3,
    timeLimit: 150,
    parTime: 38,
    retryPenalty: 5,
    start: { position: [0, 0, 520], heading: 0 },
    finish: { center: [80, 2, -325], halfSize: [10, 6, 2], heading: TO_MINUS_X },
    roads: [
      // Launch straight with the kicker and the parked-car row.
      { points: [[0, 0, 560], [0, 0, 300], [0, 0, -100], [0, 0, -250]], width: 18 },
      // Right-hand sweep to the half-loop approach.
      {
        points: [[0, 0, -230], [2, 0, -290], [30, 0, -335], [80, 0, -340], [160, 0, -340], [222, 0, -340]],
        width: 12,
      },
      // Return lane where the loop drops you, running to the finish.
      { points: [[230, 0, -325], [160, 0, -325], [60, 0, -325], [20, 0, -322]], width: 12 },
    ],
    stunts: [
      { type: 'kicker', position: [0, 0, 214], heading: 0, params: { width: 11, length: 14, angleDeg: 15 } },
      {
        type: 'carRow',
        position: [0, 0, 183],
        heading: 0,
        params: { vehicles: ['pickup', 'boxTruck', 'suv', 'sedan', 'robotaxi'], gap: 0.8 },
      },
      {
        type: 'invertedHalfLoop',
        position: [222, 0, -340],
        heading: TO_PLUS_X,
        params: { radius: 15, width: 9, lateralOffset: 15, entryLength: 8 },
      },
    ],
    gates: [
      {
        name: '飞越车队',
        center: [0, 10, 65],
        halfSize: [14, 40, 165],
        heading: 0,
        checkpoint: [0, 0, 420],
        checkpointHeading: 0,
      },
      {
        name: '倒挂半环',
        center: [175, 20, -330],
        halfSize: [75, 45, 16],
        heading: 0,
        checkpoint: [120, 0, -340],
        checkpointHeading: TO_PLUS_X,
        requires: 'inverted',
      },
    ],
    trackSpline: [
      [0, 0, 520],
      [0, 0, 214],
      [0, 3.6, 200],
      [0, 0, 60],
      [0, 0, -230],
      [2, 0, -290],
      [30, 0, -335],
      [80, 0, -340],
      [222, 0, -340],
      [245, 15, -333],
      [230, 30, -325],
      [190, 0, -325],
      [80, 0, -325],
    ],
  },
  // ---------------------------------------------------------------------------
  {
    id: 2,
    name: '海边公路',
    subtitle: '沙滩飞越 8 车，码头飞跃海面',
    biome: 'coast',
    timeOfDay: 'noon',
    weather: 'clear',
    aiCount: 4,
    aiSkill: 0.45,
    aiRubberBand: 0.45,
    requiredPlace: 3,
    requiredLandingGrade: 'GOOD',
    retriesAllowed: 3,
    timeLimit: 170,
    parTime: 48,
    retryPenalty: 5,
    waterLevel: 0,
    killY: -25,
    start: { position: [20, 24, 640], heading: 0.05 },
    finish: { center: [-385, 4, -175], halfSize: [8, 6, 2], heading: Math.PI },
    roads: [
      {
        points: [[20, 24, 660], [20, 24, 640], [15, 20, 540], [0, 14, 450], [-20, 8, 360], [-35, 3, 280], [-45, 2, 220]],
        width: 12,
        barriers: true,
        terrainFlat: 10,
        terrainBlend: 45,
      },
      { points: [[-45, 2, 220], [-50, 1.8, 150], [-50, 1.8, -60], [-50, 1.8, -230]], width: 16, terrainFlat: 14, terrainBlend: 30 },
      { points: [[-50, 1.8, -230], [-58, 1.8, -262], [-80, 2.2, -280], [-125, 3, -285]], width: 12, terrainFlat: 10, terrainBlend: 30 },
      { points: [[-125, 3, -285], [-180, 3, -285], [-236, 3, -285]], width: 10, style: 'wood', elevated: true, barriers: true },
      {
        points: [[-280, 2.2, -285], [-340, 2.2, -285], [-370, 2.2, -265], [-385, 2.2, -225], [-385, 2.2, -150]],
        width: 9,
        terrainFlat: 5,
        terrainBlend: 9,
      },
    ],
    stunts: [
      { type: 'kicker', position: [-50, 1.8, 130], heading: 0, params: { width: 12, length: 14, angleDeg: 15 } },
      {
        type: 'carRow',
        position: [-50, 1.8, 100],
        heading: 0,
        params: { vehicles: ['sedan', 'suv', 'pickup', 'robotaxi', 'sedan', 'boxTruck', 'suv', 'robotaxi'], gap: 0.7 },
      },
      {
        type: 'kicker',
        position: [-222, 3, -285],
        heading: TO_MINUS_X,
        params: { width: 9, length: 14, angleDeg: 17, approachSpeed: 30 },
      },
    ],
    gates: [
      {
        name: '沙滩飞越',
        center: [-50, 10, 10],
        halfSize: [16, 40, 150],
        heading: 0,
        checkpoint: [-49, 1.8, 200],
        checkpointHeading: 0.08,
      },
      {
        name: '码头飞跃',
        center: [-300, 10, -275],
        halfSize: [110, 40, 32],
        heading: 0,
        // Far enough back to build up speed for the jump over the sea.
        checkpoint: [-88, 2.4, -282],
        checkpointHeading: TO_MINUS_X - 0.1,
      },
    ],
    trackSpline: [
      [20, 24, 640], [15, 20, 540], [0, 14, 450], [-20, 8, 360], [-45, 2, 220], [-50, 1.8, 130], [-50, 5.4, 117],
      [-50, 1.8, 40], [-50, 1.8, -230], [-58, 1.8, -262], [-80, 2.2, -280], [-125, 3, -285], [-222, 3, -285],
      [-236, 7, -285], [-280, 2.2, -285], [-340, 2.2, -285], [-370, 2.2, -265], [-385, 2.2, -225], [-385, 2.2, -160],
    ],
  },
  // ---------------------------------------------------------------------------
  {
    id: 3,
    name: '山地盘山路',
    subtitle: '悬崖缺口两跳，下坡三连跳，隧道出口飞跃',
    biome: 'mountain',
    timeOfDay: 'dusk',
    weather: 'haze',
    aiCount: 5,
    aiSkill: 0.6,
    aiRubberBand: 0.5,
    requiredPlace: 2,
    requiredLandingGrade: 'GOOD',
    retriesAllowed: 3,
    timeLimit: 170,
    parTime: 52,
    retryPenalty: 5,
    killY: -60,
    killZones: [
      { center: [0, 447], radius: 24, belowY: 40 },
      { center: [0, 162], radius: 24, belowY: 22 },
    ],
    carves: [
      { x: 0, z: 447, r: 34, depth: 45 },
      { x: 0, z: 162, r: 34, depth: 45 },
    ],
    start: { position: [0, 60, 600], heading: 0 },
    finish: { center: [60, 5, -470], halfSize: [10, 6, 2], heading: 0 },
    roads: [
      { points: [[0, 60, 640], [0, 60, 600], [0, 58, 520], [0, 57, 470]], width: 12, barriers: true, terrainFlat: 10, terrainBlend: 50 },
      {
        points: [[0, 49, 425], [0, 45, 330], [0, 41, 240], [0, 40, 200], [0, 40, 185]],
        width: 12,
        barriers: true,
        terrainFlat: 10,
        terrainBlend: 50,
      },
      {
        points: [[0, 31, 140], [0, 24, 80], [0, 16, 10], [0, 9, -60], [0, 8, -110], [20, 7, -170], [60, 7, -215], [60, 7, -330], [60, 4, -400], [60, 3, -500]],
        width: 12,
        barriers: true,
        terrainFlat: 10,
        terrainBlend: 50,
      },
    ],
    stunts: [
      { type: 'kicker', position: [0, 57, 480], heading: 0, params: { width: 11, length: 12, angleDeg: 6, approachSpeed: 34 } },
      { type: 'rockfall', position: [0, 46.5, 350], heading: 0, params: { count: 4, side: 24, ahead: 40 } },
      { type: 'kicker', position: [0, 40, 195], heading: 0, params: { width: 11, length: 12, angleDeg: 6, approachSpeed: 34 } },
      { type: 'hump', position: [0, 25.75, 95], heading: 0, params: { width: 11.5, radius: 7, height: 1.3 } },
      { type: 'hump', position: [0, 19.4, 40], heading: 0, params: { width: 11.5, radius: 7, height: 1.3 } },
      { type: 'hump', position: [0, 13.5, -15], heading: 0, params: { width: 11.5, radius: 7, height: 1.3 } },
      { type: 'tunnel', position: [60, 7.9, -230], heading: 0, params: { length: 80, width: 14, height: 9 } },
      { type: 'kicker', position: [60, 7, -318], heading: 0, params: { width: 11, length: 12, angleDeg: 12 } },
    ],
    gates: [
      {
        name: '悬崖缺口 1',
        center: [0, 55, 420],
        halfSize: [16, 30, 75],
        heading: 0,
        checkpoint: [0, 58, 540],
        checkpointHeading: 0,
      },
      {
        name: '悬崖缺口 2',
        center: [0, 36, 140],
        halfSize: [16, 30, 75],
        heading: 0,
        checkpoint: [0, 41, 245],
        checkpointHeading: 0,
      },
      {
        name: '隧道出口飞跃',
        center: [60, 8, -380],
        halfSize: [16, 25, 70],
        heading: 0,
        checkpoint: [60, 8, -245],
        checkpointHeading: 0,
      },
    ],
    trackSpline: [
      [0, 60, 600], [0, 57, 470], [0, 58.3, 468], [0, 49, 425], [0, 45, 330], [0, 41, 240], [0, 40, 195], [0, 41.3, 183],
      [0, 31, 140], [0, 24, 80], [0, 16, 10], [0, 9, -60], [0, 8, -110], [20, 7, -170], [60, 7, -215], [60, 7, -318],
      [60, 9.5, -330], [60, 4, -400], [60, 3, -480],
    ],
  },
  // ---------------------------------------------------------------------------
  {
    id: 4,
    name: '雪山',
    subtitle: '冰湖漂移，滑雪跳台空中 360° 横滚',
    biome: 'snow',
    timeOfDay: 'night',
    weather: 'snow',
    aiCount: 5,
    aiSkill: 0.75,
    aiRubberBand: 0.5,
    requiredPlace: 2,
    requiredLandingGrade: 'GOOD',
    requiredPerfects: 1,
    retriesAllowed: 3,
    timeLimit: 150,
    parTime: 42,
    retryPenalty: 5,
    killY: -70,
    killZones: [{ center: [0, 30], radius: 60, belowY: -3 }],
    carves: [{ x: 0, z: 35, r: 85, depth: 50 }],
    start: { position: [0, 40, 520], heading: 0 },
    finish: { center: [0, -16, -310], halfSize: [12, 6, 2], heading: 0 },
    roads: [
      { points: [[0, 40, 540], [0, 40, 520], [0, 36, 400], [0, 34, 330]], width: 14, style: 'snow', terrainFlat: 12, terrainBlend: 60 },
      { points: [[0, 34, 330], [0, 34, 250], [0, 34, 150]], width: 18, style: 'ice', terrainFlat: 40, terrainBlend: 60 },
      { points: [[0, 34, 150], [0, 33, 120], [0, 20, 40], [0, 12, 2]], width: 14, style: 'snow', elevated: true, barriers: true },
      { points: [[0, 0, -60], [0, -12, -160], [0, -18, -240], [0, -18, -340]], width: 22, style: 'snow', terrainFlat: 25, terrainBlend: 60 },
    ],
    stunts: [
      { type: 'kicker', position: [0, 34, 255], heading: 0, params: { width: 10, length: 10, angleDeg: 10 } },
      { type: 'kicker', position: [0, 12, 6], heading: 0, params: { width: 12, length: 12, angleDeg: 12, clearDistance: 75 } },
    ],
    gates: [
      {
        name: '滑雪跳台 360°',
        center: [0, 10, -100],
        halfSize: [20, 50, 110],
        heading: 0,
        checkpoint: [0, 33.5, 128],
        checkpointHeading: 0,
        requires: 'roll360',
      },
    ],
    trackSpline: [
      [0, 40, 520], [0, 36, 400], [0, 34, 330], [0, 34, 255], [0, 34, 150], [0, 33, 120], [0, 20, 40], [0, 12, 6],
      [0, 14.5, -6], [0, 4, -80], [0, -12, -160], [0, -18, -240], [0, -18, -330],
    ],
  },
  // ---------------------------------------------------------------------------
  {
    id: 5,
    name: '红岩峡谷',
    subtitle: '飞越 12 车，竖直岩壁吸附，峡谷长距离飞跃',
    biome: 'canyon',
    timeOfDay: 'dawn',
    weather: 'clear',
    aiCount: 6,
    aiSkill: 0.85,
    aiRubberBand: 0.6,
    requiredPlace: 1,
    requiredLandingGrade: 'GOOD',
    retriesAllowed: 3,
    timeLimit: 160,
    parTime: 45,
    retryPenalty: 5,
    killY: -90,
    killZones: [{ center: [0, 0], radius: 70, belowY: -15 }],
    carves: [{ x: 0, z: 0, r: 92, depth: 95 }],
    start: { position: [0, 0, 620], heading: 0 },
    finish: { center: [20, 0, -395], halfSize: [12, 6, 2], heading: 0 },
    roads: [
      { points: [[0, 0, 640], [0, 0, 620], [0, 0, 300], [0, 0, 85]], width: 18, style: 'dirt', terrainFlat: 20, terrainBlend: 45 },
      { points: [[0, -2, -85], [0, -2, -255], [20, -2, -335], [20, -2, -425]], width: 18, style: 'dirt', terrainFlat: 20, terrainBlend: 45 },
    ],
    stunts: [
      { type: 'kicker', position: [0, 0, 470], heading: 0, params: { width: 12, length: 14, angleDeg: 16, clearDistance: 55 } },
      {
        type: 'carRow',
        position: [0, 0, 425],
        heading: 0,
        params: {
          vehicles: ['pickup', 'sedan', 'suv', 'robotaxi', 'boxTruck', 'sedan', 'pickup', 'suv', 'robotaxi', 'sedan', 'suv', 'pickup'],
          gap: 0.7,
        },
      },
      { type: 'wallRide', position: [0, 0, 340], heading: 0, params: { length: 100, radius: 9, offset: 9 } },
      { type: 'kicker', position: [0, 0, 100], heading: 0, params: { width: 14, length: 14, angleDeg: 8, clearDistance: 175 } },
    ],
    gates: [
      {
        name: '飞越 12 车',
        center: [0, 10, 405],
        halfSize: [14, 40, 80],
        heading: 0,
        checkpoint: [0, 0, 560],
        checkpointHeading: 0,
      },
      {
        name: '竖直岩壁',
        center: [8, 8, 285],
        halfSize: [20, 22, 62],
        heading: 0,
        checkpoint: [0, 0, 365],
        checkpointHeading: 0,
        requires: 'wall',
        pass: 'ride',
      },
      {
        name: '峡谷飞跃',
        center: [0, 10, -5],
        halfSize: [20, 70, 120],
        heading: 0,
        checkpoint: [0, 0, 200],
        checkpointHeading: 0,
        landingZone: { center: [0, 0, -265], halfSize: [30, 40, 185] },
      },
    ],
    trackSpline: [
      [0, 0, 620], [0, 0, 470], [0, 3.8, 457], [0, 0, 380], [0, 0, 300], [0, 0, 125], [0, 0, 100], [0, 2, 86],
      [0, 6, 5], [0, -2, -85], [0, -2, -255], [20, -2, -335], [20, -2, -415],
    ],
  },
  // ---------------------------------------------------------------------------
  {
    id: 6,
    name: '都市街区',
    subtitle: '夜间街道：车流、施工路段、穿楼、三次路口飞越',
    biome: 'city',
    timeOfDay: 'night',
    weather: 'clear',
    aiCount: 5,
    aiSkill: 0.85,
    aiRubberBand: 0.55,
    requiredPlace: 2,
    requiredLandingGrade: 'GOOD',
    retriesAllowed: 3,
    timeLimit: 170,
    parTime: 52,
    retryPenalty: 5,
    start: { position: [0, 0, 800], heading: 0 },
    finish: { center: [200, 2, -64], halfSize: [10, 6, 2], heading: TO_PLUS_X },
    roads: [
      {
        // One street course through the downtown grid: four streets, three tight 90° junctions.
        points: [
          [0, 0, 840], [0, 0, 800], [0, 0, 420], [0, 0, 330], [0, 0, 308], [-3.5, 0, 299.5], [-12, 0, 296],
          [-120, 0, 296], [-248, 0, 296], [-256.5, 0, 292.5], [-260, 0, 284], [-260, 0, 120], [-260, 0, -52],
          [-256.5, 0, -60.5], [-248, 0, -64], [-60, 0, -64], [260, 0, -64],
        ],
        width: 16,
      },
    ],
    stunts: [
      { type: 'kicker', position: [0, 0, 540], heading: 0, params: { width: 11, length: 14, angleDeg: 8, approachSpeed: 38 } },
      {
        type: 'carRow',
        position: [0, 0, 509],
        heading: 0,
        params: { vehicles: ['sedan', 'robotaxi', 'suv', 'pickup', 'sedan'], gap: 0.8 },
      },
      { type: 'kicker', position: [-60, 0, -64], heading: TO_PLUS_X, params: { width: 11, length: 14, angleDeg: 8, approachSpeed: 38 } },
      { type: 'kicker', position: [-260, 0, 90], heading: 0, params: { width: 11, length: 14, angleDeg: 8, approachSpeed: 36 } },
      {
        type: 'carRow',
        position: [-260, 0, 59],
        heading: 0,
        params: { vehicles: ['sedan', 'robotaxi', 'suv', 'sedan'], gap: 0.8 },
      },
      {
        type: 'carRow',
        position: [-29, 0, -64],
        heading: TO_PLUS_X,
        params: { vehicles: ['sedan', 'suv', 'robotaxi', 'pickup', 'sedan'], gap: 0.8 },
      },
    ],
    gates: [
      {
        name: '街头飞越',
        center: [0, 10, 440],
        halfSize: [14, 40, 110],
        heading: 0,
        checkpoint: [0, 0, 700],
        checkpointHeading: 0,
      },
      {
        name: '高架桥下飞越',
        center: [-260, 10, 25],
        halfSize: [14, 40, 80],
        heading: 0,
        checkpoint: [-260, 0, 212],
        checkpointHeading: 0,
      },
      {
        name: '路口飞越',
        center: [30, 10, -64],
        halfSize: [14, 40, 100],
        heading: TO_PLUS_X,
        checkpoint: [-230, 0, -64],
        checkpointHeading: TO_PLUS_X,
      },
    ],
    trackSpline: [
      [0, 0, 800], [0, 0, 540], [0, 1.95, 526], [0, 0, 400], [0, 0, 330], [0, 0, 308], [-3.5, 0, 299.5], [-12, 0, 296],
      [-248, 0, 296], [-256.5, 0, 292.5], [-260, 0, 284],
      // Weave through the road-works chicane (barriers alternate sides), then the jump under the metro.
      [-256, 0, 272], [-255, 0, 262], [-258.5, 0, 254], [-265, 0, 246], [-261.5, 0, 238], [-255, 0, 230], [-258, 0, 218],
      [-260, 0, 205], [-260, 0, 90], [-260, 1.95, 76], [-260, 0, -52], [-256.5, 0, -60.5], [-248, 0, -64],
      [-60, 0, -64], [-46, 1.95, -64], [200, 0, -64],
    ],
  },
];

/** Levels shown as "coming soon" in level select (none: all six are playable). */
export const UPCOMING_LEVELS: readonly { id: number; name: string }[] = [];
