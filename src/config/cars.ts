/**
 * Car catalogue. Every opponent is an original design that only borrows a broad
 * style family; no real brands, logos or text. Performance is relative to VOLT-R.
 */

/** Physical performance; the player's VOLT-R is the 1.0 baseline. */
export interface CarPerformance {
  /** m/s */
  readonly maxSpeed: number;
  readonly powerScale: number;
  readonly gripScale: number;
  readonly massScale: number;
  readonly steerScale: number;
  /** boost / hover energy capacity */
  readonly boostCapacity: number;
  /** keeps more grip on sand and dirt */
  readonly offroad: boolean;
}

export interface AIPersonality {
  /** 0..1 how readily it overtakes and blocks */
  readonly aggression: number;
  /** 0..1 how eagerly it burns boost */
  readonly boostHappiness: number;
  /** 0..1 how much it slides through corners */
  readonly drift: number;
  /** 0..1 landing stability bonus */
  readonly landingStability: number;
}

export type WingStyle = 'none' | 'lip' | 'duck' | 'big';
export type LightStyle = 'slim' | 'round' | 'bar';

/** Parameters for the procedural body (metres). */
export interface CarShape {
  readonly length: number;
  readonly width: number;
  /** roof height */
  readonly height: number;
  readonly noseHeight: number;
  readonly tailHeight: number;
  /** cabin start / end as fractions of length from the nose */
  readonly cabinFrom: number;
  readonly cabinTo: number;
  /** 0 = slab sides, 1 = very rounded */
  readonly roundness: number;
  readonly wheelRadius: number;
  readonly wheelBase: number;
  readonly rideHeight: number;
  readonly hoodScoop: boolean;
  readonly sideIntakes: boolean;
  readonly wing: WingStyle;
  readonly lights: LightStyle;
  /** open roll-cage cabin instead of glass (buggies) */
  readonly openCabin: boolean;
}

export interface CarDef {
  readonly id: string;
  readonly name: string;
  readonly style: string;
  readonly shape: CarShape;
  readonly perf: CarPerformance;
  readonly ai: AIPersonality;
  /** body colours it may be painted in */
  readonly palette: readonly number[];
}

export const PLAYER_PERFORMANCE: CarPerformance = {
  maxSpeed: 75,
  powerScale: 1,
  gripScale: 1,
  massScale: 1,
  steerScale: 1,
  boostCapacity: 100,
  offroad: false,
};

export const CARS: readonly CarDef[] = [
  {
    id: 'fulmine',
    name: 'Fulmine V12',
    style: '意式楔形超跑',
    shape: {
      length: 4.6, width: 2.04, height: 1.12, noseHeight: 0.5, tailHeight: 0.95,
      cabinFrom: 0.33, cabinTo: 0.7, roundness: 0.15, wheelRadius: 0.36, wheelBase: 2.7,
      rideHeight: 0.12, hoodScoop: false, sideIntakes: true, wing: 'lip', lights: 'slim', openCabin: false,
    },
    perf: { maxSpeed: 82, powerScale: 1.0, gripScale: 0.9, massScale: 1.0, steerScale: 0.9, boostCapacity: 85, offroad: false },
    ai: { aggression: 0.7, boostHappiness: 0.8, drift: 0.2, landingStability: 0.4 },
    palette: [0xd8231f, 0xf4c20d, 0xff6a00, 0x1a1a1a],
  },
  {
    id: 'kaiser',
    name: 'Kaiser GT-S',
    style: '德式豪华 GT',
    shape: {
      length: 4.7, width: 1.98, height: 1.3, noseHeight: 0.66, tailHeight: 1.0,
      cabinFrom: 0.38, cabinTo: 0.82, roundness: 0.7, wheelRadius: 0.36, wheelBase: 2.75,
      rideHeight: 0.13, hoodScoop: false, sideIntakes: false, wing: 'duck', lights: 'slim', openCabin: false,
    },
    perf: { maxSpeed: 74, powerScale: 0.96, gripScale: 1.02, massScale: 1.08, steerScale: 1.0, boostCapacity: 95, offroad: false },
    ai: { aggression: 0.45, boostHappiness: 0.5, drift: 0.1, landingStability: 0.7 },
    palette: [0xb7bcc3, 0x101215, 0x1f3a5f, 0xf2f2f0],
  },
  {
    id: 'raijin',
    name: 'Raijin RX',
    style: '日系改装跑车',
    shape: {
      length: 4.4, width: 1.95, height: 1.28, noseHeight: 0.62, tailHeight: 1.0,
      cabinFrom: 0.36, cabinTo: 0.78, roundness: 0.35, wheelRadius: 0.35, wheelBase: 2.6,
      rideHeight: 0.11, hoodScoop: true, sideIntakes: false, wing: 'big', lights: 'round', openCabin: false,
    },
    perf: { maxSpeed: 71, powerScale: 0.92, gripScale: 1.12, massScale: 0.94, steerScale: 1.1, boostCapacity: 90, offroad: false },
    ai: { aggression: 0.6, boostHappiness: 0.6, drift: 0.8, landingStability: 0.5 },
    palette: [0x1e5bd8, 0xf5f5f5, 0xff8a00, 0x7a1fd6],
  },
  {
    id: 'hammer',
    name: 'Bolt Hammer',
    style: '美式肌肉车',
    shape: {
      length: 4.9, width: 2.0, height: 1.36, noseHeight: 0.8, tailHeight: 1.0,
      cabinFrom: 0.45, cabinTo: 0.78, roundness: 0.1, wheelRadius: 0.38, wheelBase: 2.9,
      rideHeight: 0.14, hoodScoop: true, sideIntakes: false, wing: 'duck', lights: 'round', openCabin: false,
    },
    perf: { maxSpeed: 78, powerScale: 1.12, gripScale: 0.88, massScale: 1.25, steerScale: 0.78, boostCapacity: 100, offroad: false },
    ai: { aggression: 0.9, boostHappiness: 0.7, drift: 0.5, landingStability: 0.35 },
    palette: [0x101010, 0xe85d0c, 0x2d6b3a, 0x8b0f14],
  },
  {
    id: 'aurora',
    name: 'Aurora E',
    style: '北欧电动跑车',
    shape: {
      length: 4.5, width: 1.96, height: 1.32, noseHeight: 0.64, tailHeight: 1.02,
      cabinFrom: 0.32, cabinTo: 0.85, roundness: 0.85, wheelRadius: 0.36, wheelBase: 2.75,
      rideHeight: 0.13, hoodScoop: false, sideIntakes: false, wing: 'none', lights: 'bar', openCabin: false,
    },
    perf: { maxSpeed: 71, powerScale: 1.18, gripScale: 1.0, massScale: 1.05, steerScale: 1.0, boostCapacity: 55, offroad: false },
    ai: { aggression: 0.35, boostHappiness: 0.4, drift: 0.05, landingStability: 0.65 },
    palette: [0xeef2f2, 0x3fb8af, 0x9fb7c9, 0x2b2f36],
  },
  {
    id: 'dunerex',
    name: 'Dune Rex',
    style: '越野沙地车',
    shape: {
      length: 4.1, width: 2.05, height: 1.6, noseHeight: 0.85, tailHeight: 1.05,
      cabinFrom: 0.3, cabinTo: 0.78, roundness: 0.2, wheelRadius: 0.44, wheelBase: 2.65,
      rideHeight: 0.32, hoodScoop: false, sideIntakes: false, wing: 'none', lights: 'round', openCabin: true,
    },
    perf: { maxSpeed: 66, powerScale: 0.95, gripScale: 1.0, massScale: 1.1, steerScale: 1.0, boostCapacity: 90, offroad: true },
    ai: { aggression: 0.5, boostHappiness: 0.5, drift: 0.3, landingStability: 0.95 },
    palette: [0xc9a25a, 0x5d6b3c, 0xd0461f, 0x3a3a3a],
  },
];
