import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BODY, bandPatch } from '../vehicle/CarModelFactory';
import type { ThrustState } from '../vehicle/CarController';
import { createOptimus, type RobotJoints } from './Optimus';

/** Driver door outline on the body side (z from front hinge to rear edge). */
const DOOR_Z0 = -0.76;
const DOOR_Z1 = 1.04;
const HINGE = new THREE.Vector3(-0.98, 0.62, DOOR_Z0);

/** Where the robot waits beside the car (car-local, driver = -X side). */
const WAIT = new THREE.Vector3(-1.9, 0, -1.25);
const AT_DOOR = new THREE.Vector3(-1.55, 0, 0.35);
const SEAT = new THREE.Vector3(-0.33, 0.5, 0.45);
/** Idle heading: turned toward the title-screen camera. */
const IDLE_YAW = 0.8;
/** Boarding timeline (seconds): the race version starts at the door and runs faster. */
const RACE_START = 1.6;
const RACE_SPEED = 1.35;
const DONE_AT = 5.2;

const ease = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const seg = (t: number, a: number, b: number): number => ease((t - a) / (b - a));

/**
 * The robot driver. On the title screen ('menu') it stands by the parked car and idles
 * (looks around, waves). At the start of a race ('race') it waits at the driver door and,
 * during the 3-2-1 countdown, opens it, climbs in and shuts it; the car wakes with a puff
 * of vapour from its thrusters just before GO.
 */
export class Showroom {
  /** Extra thrust for the parked car's nozzles (the wake-up puff). */
  readonly thrust: ThrustState = { rear: 0, down: 0, left: 0, right: 0 };
  private readonly robot: RobotJoints;
  private readonly disposeRobot: () => void;
  private readonly door: THREE.Group;
  private readonly opening: THREE.Mesh;
  private readonly doorMats: THREE.Material[] = [];
  private t = 0;
  private boardT = -1;
  private onBoarded: (() => void) | null = null;
  private readonly tmp = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly camPos = new THREE.Vector3();
  private readonly camLook = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private camInit = false;

  constructor(
    private readonly carRoot: THREE.Object3D,
    carBody: THREE.Object3D,
    paint: THREE.Material,
    private readonly mode: 'menu' | 'race',
  ) {
    const { joints, dispose } = createOptimus();
    this.robot = joints;
    this.disposeRobot = dispose;
    carRoot.add(joints.root);

    // Door panel: the driver-side body bands between the door seams, hinged at the front.
    const parts = [2, 3, 4].map((band) =>
      bandPatch(BODY, band, [[DOOR_Z0, 0], [DOOR_Z1, 0]], [[DOOR_Z0, 1], [DOOR_Z1, 1]], 0.014, [-1]),
    );
    const doorGeo = mergeGeometries(parts) ?? new THREE.BufferGeometry();
    parts.forEach((p) => p.dispose());
    doorGeo.translate(-HINGE.x, -HINGE.y, -HINGE.z);
    const doorMesh = new THREE.Mesh(doorGeo, paint);
    doorMesh.castShadow = true;
    this.door = new THREE.Group();
    this.door.position.copy(HINGE);
    this.door.rotation.order = 'YXZ';
    this.door.add(doorMesh);
    carBody.add(this.door);
    // Dark door opening revealed behind the panel.
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.9, side: THREE.DoubleSide });
    this.doorMats.push(darkMat);
    const holeGeo = doorGeo.clone();
    this.opening = new THREE.Mesh(holeGeo, darkMat);
    this.opening.position.copy(HINGE);
    this.opening.scale.set(0.97, 0.97, 1);
    this.opening.visible = false;
    carBody.add(this.opening);
    if (mode === 'race') this.boardForCountdown();
    else this.reset();
  }

  /** Robot back outside, door shut (e.g. returning to the title screen). */
  reset(): void {
    this.boardT = -1;
    this.onBoarded = null;
    this.robot.root.visible = true;
    if (this.mode === 'race') {
      this.robot.root.position.copy(AT_DOOR);
      this.robot.root.rotation.set(0, -Math.PI / 2, 0);
    } else {
      this.robot.root.position.copy(WAIT);
      this.robot.root.rotation.set(0, IDLE_YAW, 0);
    }
    this.setDoor(0);
    this.camInit = false;
  }

  /** Race start: get in during the countdown (≈3 s; skips the walk, already at the door). */
  boardForCountdown(done?: () => void): void {
    this.reset();
    this.boardT = RACE_START;
    this.onBoarded = done ?? null;
  }

  /** Inside the car with the door shut (after boarding, while racing). */
  get seated(): boolean {
    return this.mode === 'race' && this.boardT >= DONE_AT;
  }

  get boarding(): boolean {
    return this.boardT >= 0;
  }

  /** Play the boarding sequence, then call `done`. */
  board(done: () => void): void {
    if (this.boardT >= 0) return;
    this.boardT = 0;
    this.onBoarded = done;
  }

  private setDoor(open: number): void {
    // Butterfly-style: swings out and up about the front hinge.
    this.door.rotation.set(-open * 0.55, -open * 1.05, 0);
    this.opening.visible = open > 0.01;
  }

  /** Animate; with a camera, also frame the shot (title screen / countdown). */
  update(dt: number, camera: THREE.PerspectiveCamera | null): void {
    this.t += dt;
    const r = this.robot;
    const t = this.t;
    this.thrust.rear = 0;
    this.thrust.down = 0;

    // Neutral pose each frame, then layer the animation on top.
    for (const j of [r.hips, r.torso, r.head, r.shoulderL, r.shoulderR, r.elbowL, r.elbowR, r.hipL, r.hipR, r.kneeL, r.kneeR]) j.rotation.set(0, 0, 0);
    r.hips.position.y = 0.94;
    r.shoulderL.rotation.z = -0.08;
    r.shoulderR.rotation.z = 0.08;
    r.elbowL.rotation.x = 0.15;
    r.elbowR.rotation.x = 0.15;

    if (this.boardT < 0) {
      // Idle: breathe, look around, wave now and then.
      r.torso.rotation.x = Math.sin(t * 1.6) * 0.015;
      r.head.rotation.y = Math.sin(t * 0.45) * 0.5;
      r.head.rotation.x = Math.sin(t * 0.3) * 0.08;
      const wave = Math.max(0, Math.sin(t * 0.55)) ** 6;
      if (wave > 0.01) {
        r.shoulderR.rotation.z = 0.08 + wave * 2.5;
        r.elbowR.rotation.z = wave * (0.9 + Math.sin(t * 9) * 0.35);
      }
    } else if (this.boardT >= DONE_AT && this.mode === 'race') {
      r.root.visible = false;
    } else {
      this.boardT += dt * (this.mode === 'race' ? RACE_SPEED : 1);
      const b = this.boardT;
      // 0.0–1.6 walk to the door, 1.6–2.4 open it, 2.4–3.6 climb in, 3.6–4.2 shut, 4.2–5.2 wake-up.
      const walk = seg(b, 0, 1.6);
      const facing = Math.atan2(-(AT_DOOR.x - WAIT.x), -(AT_DOOR.z - WAIT.z));
      if (b < 1.6 && this.mode === 'menu') {
        r.root.position.lerpVectors(WAIT, AT_DOOR, walk);
        r.root.rotation.y = THREE.MathUtils.lerp(IDLE_YAW, facing, Math.min(1, b * 2.5));
        const ph = b * 7.5;
        const s = Math.sin(ph) * (1 - seg(b, 1.3, 1.6));
        r.hipL.rotation.x = s * 0.5;
        r.hipR.rotation.x = -s * 0.5;
        r.kneeL.rotation.x = -Math.max(0, -Math.sin(ph)) * 0.7;
        r.kneeR.rotation.x = -Math.max(0, Math.sin(ph)) * 0.7;
        r.shoulderL.rotation.x = -s * 0.4;
        r.shoulderR.rotation.x = s * 0.4;
        r.hips.position.y = 0.94 - Math.abs(Math.sin(ph)) * 0.025;
      } else {
        // Turn to face the car (+X) at the door.
        r.root.rotation.y = this.mode === 'race' ? -Math.PI / 2 : THREE.MathUtils.lerp(facing, -Math.PI / 2, seg(b, 1.6, 2.0));
      }
      // Reach for the door and lift it.
      const open = seg(b, 1.9, 2.5) * (1 - seg(b, 3.6, 4.2));
      this.setDoor(open);
      if (b >= 1.6 && b < 2.7) {
        const reach = seg(b, 1.6, 1.95) * (1 - seg(b, 2.4, 2.7));
        r.shoulderR.rotation.x = reach * (1.3 + seg(b, 1.9, 2.5) * 0.9);
        r.elbowR.rotation.x = reach * 0.3;
      }
      // Climb in: step toward the sill, duck, and slide down into the seat.
      if (b >= 2.4) {
        const inT = seg(b, 2.4, 3.6);
        this.tmp.lerpVectors(AT_DOOR, SEAT, inT);
        r.root.position.copy(this.tmp);
        r.torso.rotation.x = -Math.sin(inT * Math.PI) * 0.7;
        r.head.rotation.x = -Math.sin(inT * Math.PI) * 0.3;
        r.hipL.rotation.x = inT * 1.5;
        r.hipR.rotation.x = inT * 1.3;
        r.kneeL.rotation.x = -inT * 1.5;
        r.kneeR.rotation.x = -inT * 1.4;
        r.hips.position.y = 0.94 - inT * 0.55;
        r.root.visible = inT < 0.98;
      }
      // Wake-up: headlights are already on; a puff of vapour from every nozzle.
      if (b >= 4.2) {
        const puff = 1 - seg(b, 4.3, 5.0);
        this.thrust.rear = puff;
        this.thrust.down = puff * 0.6;
      }
      if (b >= DONE_AT && this.onBoarded) {
        const done = this.onBoarded;
        this.onBoarded = null;
        done();
      }
    }

    if (!camera) return;
    // Camera: a low three-quarter view of robot and car (no endless orbit), drifting gently.
    // The subject sits right of centre so the menu on the left doesn't cover it.
    const sway = Math.sin(t * 0.18) * 0.35;
    const closer = this.mode === 'race' ? 1 : this.boardT >= 0 ? seg(this.boardT, 0, 2.2) : 0;
    this.tmp.set(-5.4 + closer * 1.4 + sway, 1.25 - closer * 0.15, -4.4 + closer * 1.5);
    this.carRoot.localToWorld(this.tmp);
    this.look.set(-0.6 - closer * 0.4, 0.85, 0.2 - closer * 0.2);
    this.carRoot.localToWorld(this.look);
    // Aim left of the subject so it sits in the right half of the screen (wide screens only).
    const wide = this.mode === 'menu' ? THREE.MathUtils.clamp((camera.aspect - 1) * 1.6, 0, 1) : 0;
    this.right.subVectors(this.look, this.tmp).cross(camera.up).normalize();
    this.look.addScaledVector(this.right, -2.6 * wide * (1 - closer * 0.6));
    if (!this.camInit) {
      this.camPos.copy(this.tmp);
      this.camLook.copy(this.look);
      this.camInit = true;
    }
    const k = 1 - Math.exp(-dt * 2.5);
    this.camPos.lerp(this.tmp, k);
    this.camLook.lerp(this.look, k);
    camera.up.set(0, 1, 0);
    camera.position.copy(this.camPos);
    camera.lookAt(this.camLook);
  }

  dispose(): void {
    this.robot.root.removeFromParent();
    this.disposeRobot();
    this.door.removeFromParent();
    this.opening.removeFromParent();
    (this.door.children[0] as THREE.Mesh).geometry.dispose();
    this.opening.geometry.dispose();
    this.doorMats.forEach((m) => m.dispose());
  }
}
