import * as THREE from 'three';
import { CAMERA_TUNING as C } from '../config/tuning';

export type CameraMode = 'chase' | 'cockpit';

/** Spring-follow chase camera (FOV widens with speed) plus a cockpit view. */
export class ChaseCamera {
  mode: CameraMode = 'chase';

  private yaw = 0;
  private height = 0;
  private fov: number = C.baseFov;
  private initialized = false;
  private readonly desired = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly offset = new THREE.Vector3();
  private readonly carUp = new THREE.Vector3();
  private readonly attached = new THREE.Vector3();
  /** 0 = world-up chase, 1 = locked to the car's frame (loops, wall rides). */
  private attachT = 0;
  private shake = 0;
  private cinematic = 0;
  private cineAngle = 0;

  /** Add camera shake (landings, crashes, boost). */
  addShake(amount: number): void {
    this.shake = Math.min(1.2, this.shake + amount);
  }

  /** Orbit the car for `seconds` of real time (PERFECT slow-motion replay feel). */
  startCinematic(seconds: number): void {
    this.cinematic = seconds;
    this.cineAngle = 0;
  }

  get inCinematic(): boolean {
    return this.cinematic > 0;
  }

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  snap(): void {
    this.initialized = false;
  }

  toggleMode(): void {
    this.mode = this.mode === 'chase' ? 'cockpit' : 'chase';
    this.snap();
  }

  /**
   * @param attach follow the car's own up vector (true on loop tracks) instead of world up.
   */
  update(dt: number, target: THREE.Vector3, rotation: THREE.Quaternion, speed: number, attach = false, realDt = dt): void {
    this.attachT = THREE.MathUtils.clamp(this.attachT + (attach ? 3 : -1.6) * dt, 0, 1);
    if (this.cinematic > 0) {
      this.cinematic -= realDt;
      this.cineAngle += realDt * 1.6;
      this.fwd.set(0, 0, -1).applyQuaternion(rotation);
      const base = Math.atan2(-this.fwd.x, -this.fwd.z);
      const a = base + Math.PI * 0.65 + this.cineAngle;
      this.camera.up.set(0, 1, 0);
      this.camera.position.set(target.x + Math.sin(a) * 7.5, target.y + 2.2, target.z + Math.cos(a) * 7.5);
      this.camera.lookAt(target.x, target.y + 0.6, target.z);
      if (this.cinematic <= 0) this.snap();
      return;
    }
    if (this.mode === 'cockpit') {
      this.offset.set(...C.cockpitOffset).applyQuaternion(rotation);
      this.camera.position.copy(target).add(this.offset);
      this.camera.quaternion.copy(rotation);
    } else {
      this.updateChase(dt, target, rotation);
    }

    if (this.shake > 0.001) {
      const s = this.shake * this.shake * 0.35;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.camera.position.z += (Math.random() - 0.5) * s;
      this.shake *= Math.exp(-6 * realDt);
    }

    const speedFrac = Math.min(Math.abs(speed) / C.fovSpeedRef, 1);
    const targetFov = THREE.MathUtils.lerp(C.baseFov, C.maxFov, speedFrac * speedFrac);
    this.fov += (targetFov - this.fov) * (1 - Math.exp(-C.fovSmoothing * dt));
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  private updateChase(dt: number, target: THREE.Vector3, rotation: THREE.Quaternion): void {
    // Follow the car's heading on the ground plane; hold it while pointing straight up/down.
    this.fwd.set(0, 0, -1).applyQuaternion(rotation);
    const flat = Math.hypot(this.fwd.x, this.fwd.z);
    const heading = flat > 0.2 ? Math.atan2(-this.fwd.x, -this.fwd.z) : this.yaw;

    if (!this.initialized) {
      this.yaw = heading;
      this.height = target.y;
    } else {
      let d = (heading - this.yaw) % (Math.PI * 2);
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * (1 - Math.exp(-C.yawStiffness * dt));
      this.height += (target.y - this.height) * (1 - Math.exp(-C.heightStiffness * dt));
    }

    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    this.desired.set(target.x - fx * C.distance, this.height + C.height, target.z - fz * C.distance);
    // Never dip below the ground plane.
    this.desired.y = Math.max(this.desired.y, 0.4);

    if (!this.initialized) {
      this.camera.position.copy(this.desired);
      this.initialized = true;
    } else {
      const k = 1 - Math.exp(-C.followStiffness * dt);
      this.camera.position.x += (this.desired.x - this.camera.position.x) * k;
      this.camera.position.z += (this.desired.z - this.camera.position.z) * k;
      this.camera.position.y = this.desired.y;
    }

    this.lookTarget.set(target.x + fx * C.lookAhead, this.height + C.lookHeight, target.z + fz * C.lookAhead);

    // Blend toward a camera rigidly attached behind the car, sharing its up vector.
    const a = this.attachT * this.attachT * (3 - 2 * this.attachT);
    if (a > 0.001) {
      this.carUp.set(0, 1, 0).applyQuaternion(rotation);
      this.attached
        .copy(target)
        .addScaledVector(this.fwd, -C.distance)
        .addScaledVector(this.carUp, C.height);
      this.camera.position.lerp(this.attached, a);
      this.attached.copy(target).addScaledVector(this.fwd, C.lookAhead).addScaledVector(this.carUp, C.lookHeight);
      this.lookTarget.lerp(this.attached, a);
      this.camera.up.set(0, 1, 0).lerp(this.carUp, a).normalize();
    } else {
      this.camera.up.set(0, 1, 0);
    }
    this.camera.lookAt(this.lookTarget);
  }
}
