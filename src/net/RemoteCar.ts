import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { QualitySettings } from '../config/quality';
import { CAR_TUNING as T } from '../config/tuning';
import { disposeObject } from '../core/dispose';
import type { Physics } from '../core/Physics';
import type { ThrustState } from '../vehicle/CarController';
import { createVoltR, type CarRig } from '../vehicle/CarModelFactory';
import { Thrusters } from '../vehicle/Thrusters';
import { PLAYER_COLORS, type CarState, type PlayerInfo } from './protocol';

/** Render other players this far in the past so there is always a snapshot pair to blend. */
const INTERP_DELAY_MS = 120;
/** Past the newest snapshot, coast on velocity for at most this long. */
const MAX_EXTRAPOLATE_MS = 300;
const BUFFER = 24;

function nameTag(name: string, color: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = 'rgba(10,12,18,0.72)';
    ctx.beginPath();
    ctx.roundRect(4, 8, 248, 48, 24);
    ctx.fill();
    ctx.fillStyle = `#${new THREE.Color(color).getHexString()}`;
    ctx.beginPath();
    ctx.arc(32, 32, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 28px system-ui, "PingFang SC", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, 52, 33, 190);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(3.2, 0.8, 1);
  sprite.position.y = 2.4;
  sprite.renderOrder = 20;
  return sprite;
}

/**
 * Another player's car: their VOLT-R in their colour, driven by network snapshots.
 * A kinematic body lets your car bump into theirs.
 */
export class RemoteCar {
  readonly rig: CarRig;
  readonly id: string;
  name: string;
  /** distance along the racing line from the latest snapshot (for standings) */
  distance = 0;
  speed = 0;
  private readonly body: RAPIER.RigidBody;
  private readonly thrusters: Thrusters | null;
  private readonly tag: THREE.Sprite;
  private readonly buf: CarState[] = [];
  private readonly thrust: ThrustState = { rear: 0, down: 0, left: 0, right: 0 };
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly qa = new THREE.Quaternion();
  private readonly qb = new THREE.Quaternion();
  private readonly pb = new THREE.Vector3();
  private spin = 0;
  private seen = false;

  constructor(
    private readonly physics: Physics,
    scene: THREE.Scene,
    info: PlayerInfo,
    quality: QualitySettings,
  ) {
    this.id = info.id;
    this.name = info.name;
    const color = PLAYER_COLORS[info.color] ?? PLAYER_COLORS[0]!;
    this.rig = createVoltR({ paintColor: color, physicalPaint: quality.physicalPaint });
    this.rig.root.visible = false;
    scene.add(this.rig.root);
    this.tag = nameTag(info.name, color);
    this.rig.root.add(this.tag);
    this.thrusters = this.rig.nozzles
      ? new Thrusters(scene, this.rig.root, this.rig.nozzles, Math.floor(quality.maxParticles * 0.12))
      : null;

    const R = physics.R;
    const [hx, hy, hz] = T.chassisHalfExtents;
    this.body = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -100, 0));
    physics.world.createCollider(
      R.ColliderDesc.roundCuboid(hx - 0.18, hy - 0.09, hz - 0.43, 0.18).setTranslation(0, T.chassisOffsetY, 0).setFriction(0.3),
      this.body,
    );
  }

  push(s: CarState): void {
    // Keep snapshots ordered by time; drop stale or duplicate ones.
    const last = this.buf[this.buf.length - 1];
    if (last && s.t <= last.t) return;
    this.buf.push(s);
    if (this.buf.length > BUFFER) this.buf.shift();
    this.distance = s.d;
  }

  /** Pose at `serverNow - delay`, interpolated (or briefly extrapolated). Returns false if unknown. */
  private sample(serverNow: number): boolean {
    const buf = this.buf;
    if (!buf.length) return false;
    const t = serverNow - INTERP_DELAY_MS;
    let i = buf.length - 1;
    while (i > 0 && buf[i]!.t > t) i--;
    const a = buf[i]!;
    const b = buf[i + 1];
    if (b && t >= a.t) {
      const u = THREE.MathUtils.clamp((t - a.t) / Math.max(b.t - a.t, 1), 0, 1);
      this.pos.set(a.p[0], a.p[1], a.p[2]).lerp(this.pb.set(b.p[0], b.p[1], b.p[2]), u);
      this.qa.set(a.q[0], a.q[1], a.q[2], a.q[3]);
      this.qb.set(b.q[0], b.q[1], b.q[2], b.q[3]);
      this.quat.slerpQuaternions(this.qa, this.qb, u);
      this.speed = a.s + (b.s - a.s) * u;
      this.thrustFrom(u < 0.5 ? a.th : b.th);
    } else {
      // Newest snapshot is older than the render time: coast forward a little.
      const n = buf[buf.length - 1]!;
      const dt = THREE.MathUtils.clamp(t - n.t, 0, MAX_EXTRAPOLATE_MS) / 1000;
      this.pos.set(n.p[0] + n.v[0] * dt, n.p[1] + n.v[1] * dt, n.p[2] + n.v[2] * dt);
      this.quat.set(n.q[0], n.q[1], n.q[2], n.q[3]);
      this.speed = n.s;
      this.thrustFrom(n.th);
    }
    return true;
  }

  private thrustFrom(bits: number): void {
    this.thrust.rear = bits & 1 ? 1 : 0;
    this.thrust.down = bits & 2 ? 1 : 0;
    this.thrust.left = bits & 4 ? 1 : 0;
    this.thrust.right = bits & 8 ? 1 : 0;
  }

  /** Before each physics step: move the kinematic body to the networked pose. */
  step(serverNow: number): void {
    if (!this.sample(serverNow)) return;
    this.body.setNextKinematicTranslation(this.pos);
    this.body.setNextKinematicRotation(this.quat);
  }

  updateVisual(dt: number, serverNow: number, viewportHeight: number, fov: number): void {
    if (!this.sample(serverNow)) return;
    const root = this.rig.root;
    root.visible = true;
    root.position.copy(this.pos);
    root.quaternion.copy(this.quat);
    this.spin += (this.speed / T.wheelRadius) * dt;
    for (const w of this.rig.wheels) {
      w.pivot.position.y = T.wheelRadius;
      w.spin.rotation.x = -this.spin * w.spinSign;
    }
    if (!this.seen) {
      this.seen = true;
      this.thrusters?.resetTrail();
    }
    this.thrusters?.setViewport(viewportHeight, fov);
    this.thrusters?.update(dt, this.thrust, root, null);
  }

  dispose(): void {
    this.thrusters?.dispose();
    this.physics.world.removeRigidBody(this.body);
    this.tag.material.map?.dispose();
    this.tag.material.dispose();
    disposeObject(this.rig.root);
  }
}
