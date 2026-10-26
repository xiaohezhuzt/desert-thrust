import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CAR_TUNING as T, STUNT_TUNING as S, SURFACE_GRIP, SURFACE_ROLLING, type Surface } from '../config/tuning';
import { PLAYER_PERFORMANCE, type CarPerformance } from '../config/cars';
import type { Physics } from '../core/Physics';
import type { InputActions } from '../input/InputManager';
import type { CarRig } from './CarModelFactory';

function approach(current: number, target: number, maxDelta: number): number {
  return current < target ? Math.min(current + maxDelta, target) : Math.max(current - maxDelta, target);
}

/** Lateral grip vs slip angle: linear up to the peak, then falls off to the sliding level. */
function gripCurve(slip: number): number {
  const a = Math.abs(slip);
  if (a <= T.peakSlipAngle) return a / T.peakSlipAngle;
  const t = Math.min((a - T.peakSlipAngle) / (T.peakSlipAngle * 3), 1);
  return 1 - (1 - T.slidingGrip) * t;
}

interface Wheel {
  readonly local: THREE.Vector3;
  readonly front: boolean;
  readonly left: boolean;
  /** suspension length: hardpoint to wheel centre */
  length: number;
  grounded: boolean;
  load: number;
  surface: Surface;
  /** collider handle under this wheel, -1 when airborne */
  groundHandle: number;
  readonly contact: THREE.Vector3;
  readonly normal: THREE.Vector3;
  spin: number;
  spinRate: number;
  /** sideways slip speed at the contact, m/s */
  slip: number;
  /** Tire impulse computed this step, applied after all wheels are evaluated. */
  readonly impulse: THREE.Vector3;
  readonly impulsePoint: THREE.Vector3;
  hasImpulse: boolean;
}

const WORLD_UP = new THREE.Vector3(0, 1, 0);

/** Per-car physical layout differences (bigger wheels, taller ride). */
export interface CarGeometry {
  readonly wheelRadius: number;
  /** raise of the suspension mounts vs VOLT-R */
  readonly hardpointLift: number;
  /** raise of the chassis collider vs VOLT-R */
  readonly chassisLift: number;
}

const DEFAULT_GEOMETRY: CarGeometry = { wheelRadius: T.wheelRadius, hardpointLift: 0, chassisLift: 0 };
const WORLD_DOWN = new THREE.Vector3(0, -1, 0);
/** Approach speeds below this (m/s) are gentle contacts, not crashes. */
const IMPACT_MIN_SPEED = 1.8;
/** Scraping friction coefficient against walls and other cars. */
const IMPACT_SCRAPE = 0.15;

/** Current thruster activity, 0..1, for effects and audio. */
export interface ThrustState {
  rear: number;
  down: number;
  left: number;
  right: number;
}

/**
 * Raycast-suspension vehicle on a Rapier rigid body: one ray per wheel,
 * spring-damper + anti-roll, slip-angle lateral grip with a friction circle.
 */
/** Energy per second flowing in from a landing bonus. */
const ENERGY_BONUS_RATE = 55;

export class CarController {
  readonly body: RAPIER.RigidBody;
  /** Signed speed along the car's forward axis, m/s. */
  forwardSpeed = 0;
  groundedWheels = 0;
  /** Boost / hover energy, 0..STUNT_TUNING.energyMax. */
  energy: number;
  readonly energyMax: number;
  private pendingEnergy = 0;
  /** kg */
  readonly mass: number;
  readonly thrust: ThrustState = { rear: 0, down: 0, left: 0, right: 0 };
  /** Auto-right assist while airborne (default on for touch). */
  airAssist = false;
  /** World-space body up vector and averaged ground normal, refreshed each step. */
  readonly upVector = new THREE.Vector3(0, 1, 0);
  readonly groundNormal = new THREE.Vector3(0, 1, 0);
  horizontalSpeed = 0;
  /** True while at least two wheels are on an adhesive surface (loop track). */
  onAdhesive = false;
  /** Signed roll accumulated during the current flight, radians (+ = right). */
  airRoll = 0;
  /** Roll of the last completed flight, radians. */
  lastFlightRoll = 0;
  /** Fired when the car is put back on a safe point. */
  onReset: (() => void) | null = null;
  /** Extra veto for recording safe points (e.g. not inside a drop zone). */
  isSafeSpot: ((p: THREE.Vector3) => boolean) | null = null;

  /** Interpolated pose for rendering / camera. */
  readonly renderPosition = new THREE.Vector3();
  readonly renderQuaternion = new THREE.Quaternion();

  private readonly wheels: Wheel[];
  private steerAngle = 0;
  private readonly ray: RAPIER.Ray;

  private readonly prevPos = new THREE.Vector3();
  private readonly currPos = new THREE.Vector3();
  private readonly prevQuat = new THREE.Quaternion();
  private readonly currQuat = new THREE.Quaternion();

  private readonly spawnPos = new THREE.Vector3();
  private readonly spawnQuat = new THREE.Quaternion();
  /** Last place the car was upright on four wheels; R / flips return here. */
  private readonly safePos = new THREE.Vector3();
  private readonly safeQuat = new THREE.Quaternion();
  private safeTimer = 0;
  private flippedTimer = 0;

  private prevJump = false;
  private sinceJump = 99;
  private jumpBurst = 0;

  // Scratch (no per-step allocation on our side).
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly up = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly down = new THREE.Vector3();
  private readonly hp = new THREE.Vector3();
  private readonly wf = new THREE.Vector3();
  private readonly wr = new THREE.Vector3();
  private readonly pv = new THREE.Vector3();
  private readonly imp = new THREE.Vector3();
  private readonly steerQ = new THREE.Quaternion();
  private readonly invQuat = new THREE.Quaternion();
  private readonly av = new THREE.Vector3();
  private readonly axis = new THREE.Vector3();
  private readonly alpha = new THREE.Vector3();
  private noAirInput = 0;
  /** principal moments of inertia (car-local), kg·m² */
  private readonly inertia = new THREE.Vector3();

  private readonly quarterMass: number;
  private readonly springScale: number;

  private chassis: RAPIER.Collider | null = null;
  // ---- Impacts -------------------------------------------------------------
  private readonly preVel = new THREE.Vector3();
  private readonly tmpN = new THREE.Vector3();
  private readonly tmpP = new THREE.Vector3();
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpJ = new THREE.Vector3();
  /** tire grip multiplier right after a crash (tires skid instead of pinning the car), recovers to 1 */
  private impactGrip = 1;
  private impactCooldown = 0;
  /** Fired on a real hit (wall, barrier, building, car): impact speed m/s, contact point, push normal. */
  onImpact: ((speed: number, point: THREE.Vector3, normal: THREE.Vector3) => void) | null = null;
  private queryGroups: number | undefined = undefined;

  /** AI racers ignore city traffic (it is only there to get in the player's way). */
  ignoreTraffic(groups: number): void {
    this.chassis?.setCollisionGroups(groups);
    this.queryGroups = groups;
  }

  constructor(
    private readonly physics: Physics,
    private readonly rig: CarRig,
    readonly perf: CarPerformance = PLAYER_PERFORMANCE,
    private readonly geom: CarGeometry = DEFAULT_GEOMETRY,
  ) {
    const R = physics.R;
    this.mass = T.mass * perf.massScale;
    this.quarterMass = this.mass / 4;
    // Heavier cars get proportionally stiffer suspension so ride height stays the same.
    this.springScale = perf.massScale;
    this.energyMax = perf.boostCapacity;
    this.energy = this.energyMax;
    this.pendingEnergy = 0;
    const [hx, hy, hz] = T.chassisHalfExtents;
    const bodyDesc = R.RigidBodyDesc.dynamic()
      .setCanSleep(false)
      .setCcdEnabled(true)
      .setAngularDamping(T.angularDamping);
    this.body = physics.world.createRigidBody(bodyDesc);

    // Box inertia of the full car footprint, centre of mass kept low for stability.
    const w = 2 * hx;
    const h = 1.1;
    const l = 2 * hz + 0.2;
    const inertia = {
      x: (this.mass / 12) * (h * h + l * l),
      y: (this.mass / 12) * (w * w + l * l),
      z: (this.mass / 12) * (w * w + h * h),
    };
    this.inertia.set(inertia.x, inertia.y, inertia.z);
    // Rounded and slightly shortened box so the chassis glides over curved track instead of digging in.
    const round = 0.18;
    const colDesc = R.ColliderDesc.roundCuboid(hx - round, hy - round * 0.5, hz - round - 0.25, round)
      .setTranslation(0, T.chassisOffsetY + geom.chassisLift, 0)
      .setFriction(T.chassisFriction)
      .setRestitution(0.05)
      .setMassProperties(this.mass, { x: 0, y: T.centerOfMassY - T.chassisOffsetY, z: 0 }, inertia, { x: 0, y: 0, z: 0, w: 1 });
    this.chassis = physics.world.createCollider(colDesc, this.body);

    this.ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });

    this.wheels = rig.wheels.map((wr) => ({
      local: new THREE.Vector3(wr.pivot.position.x, T.hardpointY + geom.hardpointLift, wr.pivot.position.z),
      front: wr.front,
      left: wr.pivot.position.x < 0,
      length: T.suspensionRestLength,
      grounded: false,
      load: 0,
      surface: 'asphalt' as Surface,
      groundHandle: -1,
      contact: new THREE.Vector3(),
      normal: new THREE.Vector3(0, 1, 0),
      spin: 0,
      spinRate: 0,
      slip: 0,
      impulse: new THREE.Vector3(),
      impulsePoint: new THREE.Vector3(),
      hasImpulse: false,
    }));
  }

  /** Remove the rigid body (level unload). */
  dispose(): void {
    this.physics.world.removeRigidBody(this.body);
  }

  /** Latest simulated pose (not interpolated); use from fixed-step logic. */
  get simPosition(): THREE.Vector3 {
    return this.currPos;
  }

  get simQuaternion(): THREE.Quaternion {
    return this.currQuat;
  }

  get airborne(): boolean {
    return this.groundedWheels === 0;
  }

  setSpawn(position: THREE.Vector3, heading: number): void {
    this.spawnPos.copy(position);
    this.spawnQuat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, heading);
    this.safePos.copy(this.spawnPos);
    this.safeQuat.copy(this.spawnQuat);
    this.energy = this.energyMax;
    this.reset();
  }

  /** Bonus energy (e.g. a good landing): flows into the tank over a moment instead of all at once. */
  addEnergy(amount: number): void {
    this.pendingEnergy = Math.min(this.pendingEnergy + amount, this.energyMax);
  }

  /** Return to the last safe point (checkpoint stand-in until levels exist). */
  reset(): void {
    this.body.setTranslation({ x: this.safePos.x, y: this.safePos.y + 0.3, z: this.safePos.z }, true);
    this.body.setRotation(this.safeQuat, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steerAngle = 0;
    this.flippedTimer = 0;
    this.sinceJump = 99;
    this.airRoll = 0;
    this.lastFlightRoll = 0;
    for (const w of this.wheels) {
      w.length = T.suspensionRestLength;
      w.spinRate = 0;
    }
    this.capture();
    this.onReset?.();
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
  }

  /** Apply suspension, tire and aero forces. Call before the physics step. */
  step(dt: number, input: InputActions): void {
    const body = this.body;
    const t = body.translation();
    const r = body.rotation();
    this.pos.set(t.x, t.y, t.z);
    this.quat.set(r.x, r.y, r.z, r.w);
    this.up.set(0, 1, 0).applyQuaternion(this.quat);
    this.fwd.set(0, 0, -1).applyQuaternion(this.quat);
    this.down.copy(this.up).negate();

    this.upVector.copy(this.up);
    const lv = body.linvel();
    this.forwardSpeed = lv.x * this.fwd.x + lv.y * this.fwd.y + lv.z * this.fwd.z;
    this.horizontalSpeed = Math.hypot(lv.x, lv.z);
    const speed = Math.hypot(lv.x, lv.y, lv.z);
    const absFwd = Math.abs(this.forwardSpeed);
    const maxSpeed = this.perf.maxSpeed;
    const speedFrac = Math.min(absFwd / maxSpeed, 1);

    // Steering: less lock at speed, faster return to centre.
    const steerLimit = T.maxSteerAngle * this.perf.steerScale * THREE.MathUtils.lerp(1, T.highSpeedSteerFactor, speedFrac);
    const steerTarget = input.steer * steerLimit;
    const steerRate = Math.abs(steerTarget) < Math.abs(this.steerAngle) ? T.steerReturnSpeed : T.steerSpeed;
    this.steerAngle = approach(this.steerAngle, steerTarget, steerRate * dt);

    this.suspension(dt);

    // Drive / brake demand for the whole car.
    let drive = 0;
    let braking = 0;
    if (input.throttle > 0) {
      if (this.forwardSpeed > -1) {
        const limiter = 1 - THREE.MathUtils.smoothstep(this.forwardSpeed, maxSpeed * 0.85, maxSpeed);
        const p = this.perf.powerScale * this.perf.massScale;
        drive = Math.min(T.maxDriveForce * p, (T.maxPower * p) / Math.max(absFwd, 1)) * input.throttle * limiter;
      } else {
        braking = Math.max(braking, input.throttle);
      }
    }
    if (input.brake > 0) {
      if (this.forwardSpeed > 1) braking = Math.max(braking, input.brake);
      else if (this.forwardSpeed > -T.maxReverseSpeed) drive -= T.reverseForce * this.perf.massScale * input.brake;
    }

    let groundedFront = 0;
    for (const w of this.wheels) if (w.front && w.grounded) groundedFront++;
    const groundedRear = this.groundedWheels - groundedFront;

    // Read every contact velocity before applying anything, so wheel order can't bias the car.
    for (const w of this.wheels) {
      w.hasImpulse = false;
      if (!w.grounded) {
        // Free wheels keep spinning and slowly wind down; throttle spins them up.
        w.spinRate = approach(w.spinRate, input.throttle > 0 ? 60 : 0, 30 * dt);
        continue;
      }
      const n = w.normal;

      // Wheel heading, projected onto the contact plane.
      this.wf.copy(this.fwd);
      if (w.front) this.wf.applyQuaternion(this.steerQ.setFromAxisAngle(this.up, -this.steerAngle));
      this.wf.addScaledVector(n, -this.wf.dot(n)).normalize();
      this.wr.crossVectors(this.wf, n).normalize();

      const v = body.velocityAtPoint(w.contact);
      this.pv.set(v.x, v.y, v.z);
      const vLong = this.pv.dot(this.wf);
      const vLat = this.pv.dot(this.wr);
      w.slip = Math.abs(vLat);
      w.spinRate = vLong / this.geom.wheelRadius;

      const surfaceGrip = this.perf.offroad ? THREE.MathUtils.lerp(SURFACE_GRIP[w.surface], 1, 0.6) : SURFACE_GRIP[w.surface];
      const maxF = T.tireMu * this.perf.gripScale * surfaceGrip * w.load * this.impactGrip;
      const stopCap = (Math.abs(vLong) * this.quarterMass) / dt;

      // Longitudinal.
      let fx = 0;
      if (drive !== 0) {
        const share = w.front ? T.frontDriveShare : 1 - T.frontDriveShare;
        const count = w.front ? groundedFront : groundedRear;
        fx += (drive * share) / Math.max(count, 1);
      }
      const resist =
        braking * ((T.brakeForce * this.perf.massScale) / 4) +
        (input.handbrake && !w.front ? T.handbrakeForce * this.perf.massScale : 0) +
        (drive === 0 && braking === 0 ? T.engineBraking : 0) +
        SURFACE_ROLLING[w.surface];
      fx -= Math.sign(vLong) * Math.min(resist, stopCap);

      // Lateral, from slip angle (low-speed denominator floor avoids jitter at standstill).
      const slip = Math.atan2(vLat, Math.max(Math.abs(vLong), 4));
      const latMul = input.handbrake && !w.front ? T.handbrakeRearGrip : 1;
      let fy = -Math.sign(vLat) * maxF * gripCurve(slip) * latMul;
      const latCap = (Math.abs(vLat) * this.quarterMass) / dt;
      if (Math.abs(fy) > latCap) fy = Math.sign(fy) * latCap;

      // Friction circle.
      const total = Math.hypot(fx, fy);
      if (total > maxF && total > 0) {
        const k = maxF / total;
        fx *= k;
        fy *= k;
      }

      w.impulse.copy(this.wf).multiplyScalar(fx * dt).addScaledVector(this.wr, fy * dt);
      w.impulsePoint.copy(w.contact).addScaledVector(this.up, T.forceLift);
      w.hasImpulse = true;
    }
    for (const w of this.wheels) if (w.hasImpulse) body.applyImpulseAtPoint(w.impulse, w.impulsePoint, true);

    // Aero drag, rolling resistance, downforce.
    if (speed > 0.01) {
      const dragF = T.aeroDrag * speed * speed + (this.groundedWheels > 0 ? T.rollingResistance : 0);
      const k = (-dragF * dt) / speed;
      this.imp.set(lv.x * k, lv.y * k, lv.z * k);
      if (this.groundedWheels > 0) this.imp.addScaledVector(this.down, T.downforce * absFwd * absFwd * dt);
      body.applyImpulse(this.imp, true);
    }

    for (const w of this.wheels) w.spin += w.spinRate * dt;

    this.adhesion(dt);
    this.thrusters(dt, input, absFwd);
    // Track air rolls (for "360°" stunt requirements).
    if (this.airborne) {
      const w = body.angvel();
      this.airRoll += (w.x * this.fwd.x + w.y * this.fwd.y + w.z * this.fwd.z) * dt;
    } else if (this.airRoll !== 0) {
      this.lastFlightRoll = this.airRoll;
      this.airRoll = 0;
    }
    if (this.airborne) this.airControl(dt, input);
    this.trackSafety(dt, speed);
    // Velocity going into the physics step, to judge impacts afterwards (see collide()).
    const v = body.linvel();
    this.preVel.set(v.x, v.y, v.z);
    this.impactGrip = Math.min(1, this.impactGrip + dt * 1.6);
    this.impactCooldown = Math.max(0, this.impactCooldown - dt);
  }

  /** Stick to loop tracks: pull along the averaged ground normal. */
  private adhesion(dt: number): void {
    let n = 0;
    for (const w of this.wheels) if (w.grounded && this.physics.adhesive.has(w.groundHandle)) n++;
    this.onAdhesive = n >= 2;
    if (!this.onAdhesive) return;
    // Too slow and the track lets go (you need commitment to make the loop).
    const grip = THREE.MathUtils.smoothstep(Math.abs(this.forwardSpeed), S.adhesionMinSpeed, S.adhesionFullSpeed);
    this.imp.copy(this.groundNormal).multiplyScalar(-this.mass * S.adhesionAccel * grip * dt);
    // Track friction governor: too fast for the loop's radius would crush the suspension.
    const over = Math.abs(this.forwardSpeed) - S.adhesiveSpeedLimit;
    if (over > 0) this.imp.addScaledVector(this.fwd, -Math.sign(this.forwardSpeed) * this.mass * Math.min(over * 4, 30) * dt);
    this.body.applyImpulse(this.imp, true);
  }

  /** Touching any collider in `handles` with the chassis, or resting a wheel on one. */
  touchingAny(handles: ReadonlySet<number>): boolean {
    if (handles.size === 0) return false;
    for (const w of this.wheels) if (w.grounded && handles.has(w.groundHandle)) return true;
    const world = this.physics.world;
    const col = this.body.collider(0);
    let touching = false;
    world.contactPairsWith(col, (other) => {
      if (touching || !handles.has(other.handle)) return;
      world.contactPair(col, other, (manifold) => {
        for (let i = 0; i < manifold.numContacts(); i++) if (manifold.contactDist(i) < 0.05) touching = true;
      });
    });
    return touching;
  }

  /** Wading: water drag proportional to depth and speed. */
  applyWaterDrag(dt: number, depth: number): void {
    const v = this.body.linvel();
    const k = Math.min(depth, 1.3) * 1.6 * dt;
    this.body.applyImpulse({ x: -v.x * this.mass * k, y: 0, z: -v.z * this.mass * k }, true);
  }

  /** Teleport to a checkpoint and make it the new safe point. */
  respawn(position: THREE.Vector3, heading: number): void {
    this.safePos.copy(position);
    this.safeQuat.setFromAxisAngle(WORLD_UP, heading);
    this.reset();
  }

  /** Boost, jump and hover. */
  private thrusters(dt: number, input: InputActions, absFwd: number): void {
    const body = this.body;
    const m = this.mass;
    this.thrust.rear = 0;
    this.thrust.down = 0;

    const jumpPressed = input.jump && !this.prevJump;
    this.prevJump = input.jump;
    this.sinceJump += dt;
    this.jumpBurst = Math.max(0, this.jumpBurst - dt);

    if (jumpPressed && this.groundedWheels >= 2 && this.energy >= S.jumpCost) {
      // Fire along body up, but never less than half straight up so slopes still lift.
      this.imp.copy(this.up).multiplyScalar(0.7).addScaledVector(WORLD_UP, 0.5).normalize();
      this.imp.multiplyScalar(m * S.jumpSpeed);
      body.applyImpulse(this.imp, true);
      this.energy -= S.jumpCost;
      this.sinceJump = 0;
      this.jumpBurst = S.jumpBurstTime;
    }

    const hovering = input.jump && this.airborne && this.sinceJump > S.hoverDelay && this.energy > 0;
    if (hovering) {
      body.applyImpulse(this.imp.copy(WORLD_UP).multiplyScalar(m * S.hoverAccel * dt), true);
      this.energy -= S.hoverDrain * dt;
    }
    this.thrust.down = Math.max(hovering ? 0.8 : 0, this.jumpBurst / S.jumpBurstTime);

    const boosting = input.boost && this.energy > 0;
    if (boosting) {
      const fade = 1 - THREE.MathUtils.smoothstep(absFwd, S.boostMaxSpeed * 0.85, S.boostMaxSpeed);
      body.applyImpulse(this.imp.copy(this.fwd).multiplyScalar(S.boostForce * this.perf.massScale * fade * dt), true);
      this.energy -= S.boostDrain * dt;
      this.thrust.rear = 1;
    }

    // Landing cushion: brake a hard vertical drop just before touchdown (free, automatic).
    const lv = body.linvel();
    if (this.airborne && lv.y < -S.cushionSpeed && this.up.y > 0.5) {
      const gy = this.probeGroundY(S.cushionRange + 1);
      if (gy !== null && this.currPos.y - gy < S.cushionRange) {
        const dv = Math.min(-S.cushionSpeed - lv.y, S.cushionAccel * dt);
        body.applyImpulse(this.imp.set(0, m * dv, 0), true);
        this.thrust.down = Math.max(this.thrust.down, 1);
      }
    }

    // Steady refill whenever the thrusters are idle, on the ground or in the air.
    if (!boosting && !hovering) this.energy += S.passiveRegen * dt;
    if (this.pendingEnergy > 0) {
      const flow = Math.min(this.pendingEnergy, ENERGY_BONUS_RATE * dt);
      this.energy += flow;
      this.pendingEnergy -= flow;
    }
    this.energy = THREE.MathUtils.clamp(this.energy, 0, this.energyMax);
  }

  /** Direct pitch / roll / yaw rate control while all wheels are off the ground. */
  private airControl(dt: number, input: InputActions): void {
    const body = this.body;
    const w = body.angvel();
    this.invQuat.copy(this.quat).invert();
    this.av.set(w.x, w.y, w.z).applyQuaternion(this.invQuat);

    // Local axes: +X = nose up, +Y = yaw left, +Z = roll left (right side rises).
    // Jets add angular acceleration while held; nothing stops the spin when released
    // except the body's own damping, so rolls carry momentum and need a counter-thrust.
    const jet = (current: number, cmd: number, accel: number, maxRate: number): number => {
      if (cmd === 0) return 0;
      const dir = Math.sign(cmd);
      const opposing = current * dir < 0;
      if (!opposing && Math.abs(current) >= maxRate * Math.abs(cmd)) return 0;
      return dir * accel * Math.abs(cmd) * (opposing ? S.airCounterBoost : 1);
    };
    this.alpha.set(
      jet(this.av.x, -input.pitch, S.airPitchAccel, S.airPitchMaxRate),
      jet(this.av.y, -input.steer, S.airYawAccel, S.airYawMaxRate),
      jet(this.av.z, -input.roll, S.airRollAccel, S.airRollMaxRate),
    );

    // Air drag on the spin: momentum carries on, but fades.
    this.alpha.x -= this.av.x * S.airPitchDamping;
    this.alpha.y -= this.av.y * S.airYawDamping;
    this.alpha.z -= this.av.z * S.airRollDamping;

    // Optional gyro assist: after a moment without pitch/roll input, steer the spin toward upright.
    this.noAirInput = input.pitch === 0 && input.roll === 0 ? this.noAirInput + dt : 0;
    if (this.airAssist && this.noAirInput > S.autoRightDelay) {
      this.axis.crossVectors(this.up, WORLD_UP);
      // Exactly inverted has no preferred axis: pick a roll.
      if (this.up.y < -0.98) this.axis.copy(this.fwd);
      this.axis.multiplyScalar(S.autoRightRate).applyQuaternion(this.invQuat);
      const max = S.autoRightAccel;
      this.alpha.x += THREE.MathUtils.clamp((this.axis.x - this.av.x) * 4, -max, max);
      this.alpha.z += THREE.MathUtils.clamp((this.axis.z - this.av.z) * 4, -max, max);
    }

    // Torque impulse = I · α · dt (local inertia), rotated to world space.
    this.imp
      .set(this.alpha.x * this.inertia.x, this.alpha.y * this.inertia.y, this.alpha.z * this.inertia.z)
      .multiplyScalar(dt)
      .applyQuaternion(this.quat);
    body.applyTorqueImpulse(this.imp, true);

    // Side jets show which way they're pushing (including counter-thrust).
    // (Jet visuals follow the commanded thrust, not the passive damping.)
    const roll = (this.alpha.z + this.av.z * S.airRollDamping) / S.airRollAccel;
    const yaw = (this.alpha.y + this.av.y * S.airYawDamping) / S.airYawAccel;
    this.thrust.left = Math.min(1, Math.max(roll > 0 ? roll : 0, yaw > 0 ? yaw * 0.5 : 0));
    this.thrust.right = Math.min(1, Math.max(roll < 0 ? -roll : 0, yaw < 0 ? -yaw * 0.5 : 0));
  }

  /** Remember safe points; auto-recover when stuck upside down. */
  private trackSafety(dt: number, speed: number): void {
    if (!this.airborne) {
      this.thrust.left = 0;
      this.thrust.right = 0;
    }
    if (this.groundedWheels === 4 && this.up.y > 0.92 && this.groundNormal.y > 0.95) {
      this.safeTimer += dt;
      if (this.safeTimer > 1 && (this.isSafeSpot?.(this.pos) ?? true)) {
        this.safeTimer = 0;
        this.safePos.copy(this.pos);
        // Keep only the heading so the car comes back level.
        const yaw = Math.atan2(-this.fwd.x, -this.fwd.z);
        this.safeQuat.setFromAxisAngle(WORLD_UP, yaw);
      }
    }
    if (this.up.y < 0.3 && speed < 3) {
      this.flippedTimer += dt;
      if (this.flippedTimer > S.flipResetDelay) this.reset();
    } else {
      this.flippedTimer = 0;
    }
  }

  /** True while the chassis box itself touches something (scrape / roof hit). */
  chassisTouching(): boolean {
    const world = this.physics.world;
    const col = this.body.collider(0);
    let touching = false;
    world.contactPairsWith(col, (other) => {
      if (touching) return;
      world.contactPair(col, other, (manifold) => {
        // Manifolds include speculative contacts; only count real (near-zero distance) ones.
        for (let i = 0; i < manifold.numContacts(); i++) {
          if (manifold.contactDist(i) < 0.02) touching = true;
        }
      });
    });
    return touching;
  }

  /** Height of the ground below the car (for effects), or null if nothing within range. */
  probeGroundY(range = 12): number | null {
    this.ray.origin = this.currPos;
    this.ray.dir = WORLD_DOWN;
    const hit = this.physics.world.castRay(this.ray, range, true, undefined, this.queryGroups, undefined, this.body);
    return hit ? this.currPos.y - hit.timeOfImpact : null;
  }

  /** Live wheel state for ground effects (no copies; read immediately). */
  get wheelStates(): readonly {
    readonly grounded: boolean;
    readonly surface: Surface;
    readonly contact: THREE.Vector3;
    readonly slip: number;
    readonly front: boolean;
  }[] {
    return this.wheels;
  }

  isWheelGrounded(i: number): boolean {
    return this.wheels[i]?.grounded ?? false;
  }

  /** Record the post-step pose for interpolation. Call after the physics step. */
  /**
   * Realistic crash response. The rigid-body solver alone stops the chassis dead against a
   * wall (low restitution keeps landings and loops stable), and the tires then pin it. After
   * each step, a real side/front/rear hit gets: a rebound along the contact normal (more
   * elastic at low speed, crumpling at high speed), scraping friction along the surface, both
   * applied at the contact point so off-centre hits spin the car, and a moment of reduced
   * tire grip so it can skid and rotate instead of sticking.
   */
  private collide(): void {
    const col = this.chassis;
    if (!col || this.impactCooldown > 0) return;
    const world = this.physics.world;
    let best: { vn: number; other: RAPIER.Collider; n: THREE.Vector3; p: THREE.Vector3 } | null = null;
    world.contactPairsWith(col, (other) => {
      world.contactPair(col, other, (manifold, flipped) => {
        if (manifold.numSolverContacts() === 0) return;
        const raw = manifold.normal();
        // Normal from the car into the other shape; we want the push direction (other → car).
        const sign = flipped ? 1 : -1;
        const n = this.tmpN.set(raw.x * sign, raw.y * sign, raw.z * sign);
        // Skip the surface we're driving on (bottoming out, loops, wall rides) and floors/roofs.
        if (n.dot(this.up) > 0.55 || Math.abs(n.y) > 0.8) return;
        // Centre of the contact patch (a flat hit touches along a whole edge, not one corner).
        const p = this.tmpP.set(0, 0, 0);
        const k = manifold.numSolverContacts();
        for (let i = 0; i < k; i++) {
          const cp = manifold.solverContactPoint(i);
          if (cp) p.add(this.tmpV.set(cp.x, cp.y, cp.z));
        }
        p.divideScalar(k);
        // Approach speed at the contact, relative to the other body (moving traffic, other cars).
        const ob = other.parent();
        const ov = ob ? ob.linvel() : { x: 0, y: 0, z: 0 };
        const vn = (this.preVel.x - ov.x) * n.x + (this.preVel.y - ov.y) * n.y + (this.preVel.z - ov.z) * n.z;
        if (vn < -IMPACT_MIN_SPEED && (!best || vn < best.vn)) best = { vn, other, n: n.clone(), p: p.clone() };
      });
    });
    if (!best) return;
    const { vn, other, n, p } = best as { vn: number; other: RAPIER.Collider; n: THREE.Vector3; p: THREE.Vector3 };
    const hit = -vn;
    const body = this.body;
    const m = this.mass;
    const ob = other.parent();
    const ov = ob ? ob.linvel() : { x: 0, y: 0, z: 0 };
    const v = body.linvel();
    const rel = this.tmpV.set(v.x - ov.x, v.y - ov.y, v.z - ov.z);
    // Rebound: restitution falls from ~0.45 (light knock) to ~0.2 (big crash, the body crumples).
    const e = THREE.MathUtils.lerp(0.45, 0.2, THREE.MathUtils.clamp(hit / 35, 0, 1));
    const postN = rel.dot(n);
    const dvn = Math.max(0, e * hit - postN);
    // Scrape: kinetic friction along the surface, proportional to how hard we hit.
    const tang = rel.addScaledVector(n, -postN);
    const vt = tang.length();
    const dvt = Math.min(vt * 0.35, IMPACT_SCRAPE * (hit + dvn));
    // Walls and kinematic traffic don't give; a loose body (another car, a traffic cone)
    // shares the impulse by mass, so a cone barely nudges the car and flies off instead.
    const dynamicPartner = !!ob && ob.isDynamic();
    const share = dynamicPartner ? ob!.mass() / (m + ob!.mass()) : 1;
    const impulse = this.tmpJ.copy(n).multiplyScalar(dvn * m * share);
    if (vt > 1e-3) impulse.addScaledVector(tang.normalize(), -dvt * m * share);
    body.applyImpulseAtPoint({ x: impulse.x, y: impulse.y, z: impulse.z }, { x: p.x, y: p.y, z: p.z }, true);
    // Light loose props get the equal and opposite kick; other cars run this same code for themselves.
    if (dynamicPartner && ob!.mass() < 300) ob!.applyImpulseAtPoint({ x: -impulse.x, y: -impulse.y, z: -impulse.z }, { x: p.x, y: p.y, z: p.z }, true);
    this.impactCooldown = 0.12;
    if (share < 0.2) return;
    // Hard hits knock the tires loose for a moment.
    this.impactGrip = Math.min(this.impactGrip, THREE.MathUtils.lerp(0.75, 0.15, THREE.MathUtils.clamp((hit * share) / 25, 0, 1)));
    this.onImpact?.(hit * share, p, n);
  }

  capture(): void {
    this.collide();
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
    const t = this.body.translation();
    const r = this.body.rotation();
    this.currPos.set(t.x, t.y, t.z);
    this.currQuat.set(r.x, r.y, r.z, r.w);
  }

  /** Update interpolated pose and push it to the visual rig. */
  updateVisual(alpha: number): void {
    this.renderPosition.lerpVectors(this.prevPos, this.currPos, alpha);
    this.renderQuaternion.slerpQuaternions(this.prevQuat, this.currQuat, alpha);

    const { root, wheels } = this.rig;
    root.position.copy(this.renderPosition);
    root.quaternion.copy(this.renderQuaternion);
    for (let i = 0; i < wheels.length; i++) {
      const rigWheel = wheels[i]!;
      const w = this.wheels[i]!;
      rigWheel.pivot.position.y = T.hardpointY + this.geom.hardpointLift - w.length;
      if (rigWheel.front) rigWheel.pivot.rotation.y = -this.steerAngle;
      rigWheel.spin.rotation.x = -w.spin * rigWheel.spinSign;
    }
  }

  private suspension(dt: number): void {
    const world = this.physics.world;
    const r = this.geom.wheelRadius;
    const maxToi = T.suspensionMaxLength + r;
    this.groundedWheels = 0;

    for (const w of this.wheels) {
      this.hp.copy(w.local).applyQuaternion(this.quat).add(this.pos);
      this.ray.origin = this.hp;
      this.ray.dir = this.down;
      const hit = world.castRayAndGetNormal(this.ray, maxToi, true, undefined, this.queryGroups, undefined, this.body);
      const prevLength = w.length;
      if (hit && hit.timeOfImpact - r <= T.suspensionMaxLength) {
        const len = Math.max(hit.timeOfImpact - r, 0);
        const compVel = (prevLength - len) / dt;
        let force =
          this.springScale *
          (T.springStiffness * (T.suspensionRestLength - len) +
            (compVel > 0 ? T.damperCompression : T.damperRebound) * compVel);
        if (len < T.suspensionMinLength) force += this.springScale * T.bumpStopStiffness * (T.suspensionMinLength - len);
        w.length = Math.max(len, T.suspensionMinLength * 0.5);
        w.load = Math.max(force, 0);
        w.grounded = true;
        w.contact.copy(this.hp).addScaledVector(this.down, hit.timeOfImpact);
        w.normal.set(hit.normal.x, hit.normal.y, hit.normal.z);
        w.surface = this.physics.surfaceAt(hit.collider, w.contact.x, w.contact.z);
        w.groundHandle = hit.collider.handle;
        this.groundedWheels++;
      } else {
        // Extend toward full droop smoothly.
        w.length = approach(w.length, T.suspensionMaxLength, 2 * dt);
        w.load = 0;
        w.grounded = false;
        w.groundHandle = -1;
      }
    }

    this.groundNormal.set(0, 0, 0);
    for (const w of this.wheels) if (w.grounded) this.groundNormal.add(w.normal);
    if (this.groundedWheels > 0) this.groundNormal.normalize();
    else this.groundNormal.set(0, 1, 0);

    // Anti-roll bars: resist left/right compression difference per axle.
    for (let i = 0; i < this.wheels.length; i += 2) {
      const a = this.wheels[i]!;
      const b = this.wheels[i + 1]!;
      if (!a.grounded && !b.grounded) continue;
      const f = this.springScale * T.antiRollStiffness * (b.length - a.length);
      if (a.grounded) a.load = Math.max(a.load + f, 0);
      if (b.grounded) b.load = Math.max(b.load - f, 0);
    }

    for (const w of this.wheels) {
      if (w.load <= 0) continue;
      this.hp.copy(w.local).applyQuaternion(this.quat).add(this.pos);
      this.imp.copy(this.up).multiplyScalar(w.load * dt);
      this.body.applyImpulseAtPoint(this.imp, this.hp, true);
    }
  }
}
