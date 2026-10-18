/**
 * All handling / feel parameters live here.
 */

export type Surface = 'asphalt' | 'wet' | 'hardSand' | 'softSand' | 'wetSand' | 'dirt' | 'snow' | 'ice';

/** Tire grip multiplier per ground type. */
export const SURFACE_GRIP: Record<Surface, number> = {
  asphalt: 1.0,
  wet: 0.82,
  hardSand: 0.8,
  softSand: 0.6,
  wetSand: 0.7,
  dirt: 0.75,
  snow: 0.45,
  ice: 0.25,
};

/** Extra rolling resistance per ground type, N per wheel. */
export const SURFACE_ROLLING: Record<Surface, number> = {
  asphalt: 0,
  wet: 0,
  hardSand: 60,
  softSand: 220,
  wetSand: 120,
  dirt: 80,
  snow: 120,
  ice: 0,
};

/** VOLT-R raycast-suspension vehicle. Units: SI (kg, m, s, N). */
export const CAR_TUNING = {
  mass: 1650,
  /** centre of mass height above the model origin (ground at rest) */
  centerOfMassY: 0.42,
  chassisHalfExtents: [0.9, 0.25, 2.12] as const,
  chassisOffsetY: 0.68,
  chassisFriction: 0.25,

  wheelRadius: 0.36,
  wheelBase: 2.65,
  frontTrack: 0.84,
  rearTrack: 0.87,
  /** suspension top mount height above the model origin */
  hardpointY: 0.78,

  suspensionRestLength: 0.48,
  suspensionMinLength: 0.2,
  suspensionMaxLength: 0.56,
  springStiffness: 60000,
  damperCompression: 4200,
  damperRebound: 5600,
  bumpStopStiffness: 650000,
  antiRollStiffness: 12000,

  /** peak tire friction coefficient (multiplied by surface grip) */
  tireMu: 1.3,
  /** slip angle (rad) where lateral grip peaks */
  peakSlipAngle: 0.13,
  /** grip fraction left when fully sliding (lower = easier drifts) */
  slidingGrip: 0.75,
  /** tire forces are applied this far above the contact point to reduce rollovers */
  forceLift: 0.25,

  maxDriveForce: 18500,
  maxPower: 950000,
  frontDriveShare: 0.4,
  /** m/s (~270 km/h); drive force fades out over the last 15 % */
  maxSpeed: 75,
  maxReverseSpeed: 12,
  reverseForce: 7000,
  brakeForce: 30000,
  engineBraking: 160,
  handbrakeRearGrip: 0.45,
  handbrakeForce: 3000,

  rollingResistance: 140,
  aeroDrag: 0.42,
  downforce: 0.9,
  angularDamping: 0.6,

  /** rad at low speed */
  maxSteerAngle: 0.55,
  /** steer authority multiplier at max speed */
  highSpeedSteerFactor: 0.22,
  steerSpeed: 4.0,
  steerReturnSpeed: 7.0,
} as const;

/** Thrusters, flight and air control. */
export const STUNT_TUNING = {
  energyMax: 100,
  /** rear thrust while boosting, N */
  boostForce: 30000,
  /** boost fades out approaching this speed, m/s (~380 km/h) */
  boostMaxSpeed: 105,
  boostDrain: 26,
  /** vertical launch speed of a jump, m/s (~7 m apex) */
  jumpSpeed: 11.5,
  jumpCost: 8,
  /** how long the underbody jets flare after a jump, s */
  jumpBurstTime: 0.35,
  /** hold jump this long after take-off before hover kicks in, s */
  hoverDelay: 0.25,
  /** upward acceleration while hovering (> g, so it climbs slowly), m/s² */
  hoverAccel: 11.0,
  hoverDrain: 15,
  /** energy regained per second on the ground while not boosting */
  passiveRegen: 6,
  // Air control is torque from the side / underbody jets: it spins the car up,
  // and the spin carries on (inertia) until you counter-thrust or it damps out.
  /** angular acceleration from the jets, rad/s² */
  airPitchAccel: 7,
  airRollAccel: 11,
  airYawAccel: 5,
  /** the jets stop adding spin beyond these rates, rad/s */
  airPitchMaxRate: 4.2,
  airRollMaxRate: 7,
  airYawMaxRate: 2.8,
  /**
   * Aerodynamic spin damping in the air, 1/s (on top of the body's own); lower = more coasting.
   * Rolls keep their momentum; pitch and yaw weathervane like a dart so ramps launch cleanly.
   */
  airRollDamping: 0.9,
  airPitchDamping: 2.6,
  airYawDamping: 2.0,
  /** extra jet authority when pushing against the current spin (counter-thrust) */
  airCounterBoost: 1.6,
  /** auto-right assist: corrective spin per radian of tilt, and its max angular acceleration */
  autoRightRate: 2.2,
  autoRightAccel: 6,
  /** assist waits this long after the last pitch/roll input, s */
  autoRightDelay: 0.35,
  /** upside-down and nearly stopped for this long -> auto reset, s */
  flipResetDelay: 1.5,
  /** minimum air time for a landing to be graded, s */
  minGradedAirTime: 0.6,
  landingRegen: { PERFECT: 35, GOOD: 15, BAD: 5, CRASH: 0 },
  /** landing cushion: underbody jets fire automatically when dropping fast near the ground */
  cushionSpeed: 5,
  cushionAccel: 85,
  cushionRange: 8,
  /** pull toward adhesive track surfaces (loops), m/s²; must exceed g to hold inverted */
  adhesionAccel: 17,
  /** adhesion fades in between these speeds, m/s */
  adhesionMinSpeed: 6,
  adhesionFullSpeed: 13,
  /** loop tracks scrub speed above this (keeps g-loads survivable), m/s */
  adhesiveSpeedLimit: 40,
} as const;

export const CAMERA_TUNING = {
  distance: 7.2,
  height: 2.4,
  lookAhead: 4,
  lookHeight: 1.0,
  /** exponential smoothing rate for position, 1/s */
  followStiffness: 7,
  /** exponential smoothing rate for yaw, 1/s */
  yawStiffness: 5,
  baseFov: 62,
  maxFov: 80,
  /** speed (m/s) at which FOV reaches maxFov */
  fovSpeedRef: 75,
  fovSmoothing: 3,
  /** vertical follow is softer so landings don't jolt the view */
  heightStiffness: 4,
  /** cockpit camera position in car-local space */
  cockpitOffset: [0, 0.98, 0.15] as const,
} as const;

export const MS_TO_KMH = 3.6;
export const MS_TO_MPH = 2.236936;
