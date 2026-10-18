import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type {
  BuildingStunt,
  CarRowStunt,
  HalfLoopStunt,
  HumpStunt,
  KickerStunt,
  RockfallStunt,
  StuntDef,
  TunnelStunt,
  WallRideStunt,
} from '../config/levels';
import type { Physics } from '../core/Physics';
import { buildParkedVehicles, vehicleShape, type PlacedVehicle } from './ParkedVehicles';
import { canvasTexture } from './Textures';

/** Per-frame context for animated stunt pieces. */
export interface StuntContext {
  readonly player: THREE.Vector3;
  warn(text: string, sub: string): void;
}

export interface BuiltStunt {
  readonly group: THREE.Group;
  readonly colliders: RAPIER.Collider[];
  update?(dt: number, ctx: StuntContext): void;
  dispose?(): void;
}

const UP = new THREE.Vector3(0, 1, 0);

/** World transform for a stunt: translate to `position`, rotate by `heading` about +Y. */
function frame(def: StuntDef): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...def.position),
    new THREE.Quaternion().setFromAxisAngle(UP, def.heading),
    new THREE.Vector3(1, 1, 1),
  );
}

function trimeshCollider(physics: Physics, geo: THREE.BufferGeometry, matrix: THREE.Matrix4): RAPIER.Collider {
  const g = geo.index ? geo : geo.clone();
  const pos = g.getAttribute('position');
  const verts = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
    verts.set([v.x, v.y, v.z], i * 3);
  }
  const index = g.index ? new Uint32Array(g.index.array) : new Uint32Array(pos.count).map((_, i) => i);
  return physics.world.createCollider(physics.R.ColliderDesc.trimesh(verts, index).setFriction(0.9));
}

function stripeTexture(base: string, stripe: string): THREE.CanvasTexture {
  return canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = stripe;
    ctx.fillRect(0, 0, s * 0.06, s);
    ctx.fillRect(s * 0.94, 0, s * 0.06, s);
    ctx.fillRect(s * 0.47, 0, s * 0.06, s * 0.5);
  });
}

// ---------------------------------------------------------------------------

/** Wedge ramp, low end at the origin, rising toward local -Z. */
function buildKicker(def: KickerStunt, physics: Physics): BuiltStunt {
  const { width, length, angleDeg } = def.params;
  const a = THREE.MathUtils.degToRad(angleDeg);
  const run = length * Math.cos(a);
  const h = length * Math.sin(a);
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(run, h);
  shape.lineTo(run, 0);
  shape.closePath();
  // Shape is (along-ramp, height); extrude across the width, then orient so "along" is -Z.
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
  geo.translate(0, 0, -width / 2);
  geo.rotateY(Math.PI / 2);
  const tex = stripeTexture('#ff7a1a', '#ffffff');
  tex.repeat.set(1, 1);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.5, map: tex }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.add(mesh);
  const m = frame(def);
  group.applyMatrix4(m);

  // Convex hull of the wedge corners.
  const pts: number[] = [];
  const v = new THREE.Vector3();
  const p = geo.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(m);
    pts.push(v.x, v.y, v.z);
  }
  const desc = physics.R.ColliderDesc.convexHull(new Float32Array(pts));
  const colliders: RAPIER.Collider[] = [];
  if (desc) {
    const c = physics.world.createCollider(desc.setFriction(0.9));
    physics.setSurface(c, 'asphalt');
    colliders.push(c);
  }
  return { group, colliders };
}

/** Parked vehicles side by side, long axis across the jumper's path. */
function buildCarRow(def: CarRowStunt, physics: Physics): BuiltStunt {
  const { vehicles, gap } = def.params;
  const shapes = vehicles.map(vehicleShape);
  const total = shapes.reduce((s, v) => s + v.width, 0) + gap * (shapes.length - 1);
  const m = frame(def);
  const placed: PlacedVehicle[] = [];
  const colliders: RAPIER.Collider[] = [];
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();

  // First vehicle nearest the ramp (+Z side in local space, since travel is toward -Z).
  let z = total / 2;
  vehicles.forEach((kind, i) => {
    const shape = shapes[i]!;
    z -= shape.width / 2;
    // Alternate facing so the row looks parked, not cloned.
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3(0, 0, z),
      new THREE.Quaternion().setFromAxisAngle(UP, i % 2 ? Math.PI : 0),
      new THREE.Vector3(1, 1, 1),
    );
    const world = m.clone().multiply(local);
    placed.push({ kind, matrix: world });

    world.decompose(pos, q, scale);
    const centre = new THREE.Vector3(0, shape.height / 2, 0).applyMatrix4(world);
    const c = physics.world.createCollider(
      physics.R.ColliderDesc.cuboid(shape.length / 2, shape.height / 2, shape.width / 2)
        .setTranslation(centre.x, centre.y, centre.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setFriction(0.6),
    );
    physics.setSurface(c, 'asphalt');
    physics.obstacles.add(c.handle);
    colliders.push(c);
    z -= shape.width / 2 + gap;
  });

  const group = buildParkedVehicles(placed, Math.round(def.position[2]));
  return { group, colliders };
}

/**
 * Orange toy-track half loop. Local frame: approach along -Z from the origin.
 * Flat entry pad, then a half circle up and over (ground → vertical → inverted),
 * drifting `lateralOffset` to the right so the inverted exit clears the entry.
 */
function buildHalfLoop(def: HalfLoopStunt, physics: Physics): BuiltStunt {
  const { radius: R, width, lateralOffset, entryLength } = def.params;
  const full = def.type === 'fullLoop';
  const arc = full ? Math.PI * 2 : Math.PI;
  const N = 72;
  const railH = 0.7;
  const centres: THREE.Vector3[] = [];
  const normals: THREE.Vector3[] = [];
  const widths: number[] = [];

  // Entry pad samples (flat).
  const padSteps = 4;
  for (let i = 0; i < padSteps; i++) {
    centres.push(new THREE.Vector3(0, 0.06, (-entryLength * i) / padSteps));
    normals.push(new THREE.Vector3(0, 1, 0));
    // Funnel: the entry is wider so an off-centre car is guided in, not stopped by a rail end.
    widths.push(width * THREE.MathUtils.lerp(1.8, 1, i / padSteps));
  }
  const steps = full ? N * 2 : N;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * arc;
    const drift = (lateralOffset * (1 - Math.cos((t / arc) * Math.PI))) / 2;
    centres.push(new THREE.Vector3(drift, R - R * Math.cos(t) + 0.06, -entryLength - R * Math.sin(t)));
    normals.push(new THREE.Vector3(0, Math.cos(t), Math.sin(t)));
    widths.push(width);
  }
  if (full) {
    // Exit pad continuing forward in the offset lane.
    for (let i = 1; i <= padSteps; i++) {
      centres.push(new THREE.Vector3(lateralOffset, 0.06, -entryLength - (entryLength * 1.5 * i) / padSteps));
      normals.push(new THREE.Vector3(0, 1, 0));
      widths.push(width * THREE.MathUtils.lerp(1, 1.4, i / padSteps));
    }
  }

  // Surface + rails as one strip set: [rail top L, edge L, edge R, rail top R] per sample.
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const tan = new THREE.Vector3();
  const right = new THREE.Vector3();
  let dist = 0;
  for (let i = 0; i < centres.length; i++) {
    const c = centres[i]!;
    const n = normals[i]!;
    tan.subVectors(centres[Math.min(i + 1, centres.length - 1)]!, centres[Math.max(i - 1, 0)]!).normalize();
    right.crossVectors(tan, n).normalize();
    if (i > 0) dist += c.distanceTo(centres[i - 1]!);
    const w = widths[i]!;
    const l = c.clone().addScaledVector(right, -w / 2);
    const r = c.clone().addScaledVector(right, w / 2);
    const lt = l.clone().addScaledVector(n, railH);
    const rt = r.clone().addScaledVector(n, railH);
    for (const p of [lt, l, r, rt]) pos.push(p.x, p.y, p.z);
    const v = dist / width;
    uv.push(-0.1, v, 0, v, 1, v, 1.1, v);
    if (i > 0) {
      const a = (i - 1) * 4;
      const b = i * 4;
      for (let k = 0; k < 3; k++) idx.push(a + k, a + k + 1, b + k, a + k + 1, b + k + 1, b + k);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  const tex = stripeTexture('#ff6a00', '#fff4e0');
  tex.wrapS = THREE.ClampToEdgeWrapping;
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: tex,
    roughness: 0.35,
    metalness: 0.05,
    side: THREE.DoubleSide,
    emissive: 0x401400,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const group = new THREE.Group();
  group.add(mesh);

  // Slim support posts under the climbing side (visual only, outside the drop zone).
  const postMat = new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.6, metalness: 0.6 });
  for (const t of full ? [] : [0.3, 0.45]) {
    const i = padSteps + Math.round(t * N);
    const c = centres[i]!;
    const n = normals[i]!;
    const top = c.clone().addScaledVector(n, -0.2);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, top.y, 8), postMat);
    post.position.set(top.x, top.y / 2, top.z);
    group.add(post);
  }

  const m = frame(def);
  group.applyMatrix4(m);
  const c = trimeshCollider(physics, geo, m);
  // Low friction so the chassis glances off the rails instead of sticking.
  c.setFriction(0.15);
  physics.setSurface(c, 'asphalt');
  physics.adhesive.add(c.handle);
  return { group, colliders: [c] };
}

/** Rounded crest across the road: a buried cylinder. */
function buildHump(def: HumpStunt, physics: Physics): BuiltStunt {
  const { width, radius: r, height } = def.params;
  const geo = new THREE.CylinderGeometry(r, r, width, 48, 1).rotateZ(Math.PI / 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x55585e, roughness: 0.85 }));
  mesh.position.y = height - r;
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.add(mesh);
  const m = frame(def);
  group.applyMatrix4(m);
  const centre = new THREE.Vector3(0, height - r, 0).applyMatrix4(m);
  const q = new THREE.Quaternion().setFromAxisAngle(UP, def.heading).multiply(
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2),
  );
  const c = physics.world.createCollider(
    physics.R.ColliderDesc.capsule(width / 2, r)
      .setTranslation(centre.x, centre.y, centre.z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setFriction(0.9),
  );
  physics.setSurface(c, 'asphalt');
  return { group, colliders: [c] };
}

/**
 * Quarter-pipe on the right of the road, curving up to past vertical.
 * Its height tapers in and out so you can ride up the wall and come back down.
 */
function buildWallRide(def: WallRideStunt, physics: Physics): BuiltStunt {
  const { length: L, radius: R, offset } = def.params;
  const sSteps = Math.ceil(L / 2);
  const tSteps = 14;
  const maxAngle = THREE.MathUtils.degToRad(98);
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= sSteps; i++) {
    const s = (i / sSteps) * L;
    const taper = THREE.MathUtils.smoothstep(Math.min(s, L - s), 0, 22);
    const top = 0.12 + (maxAngle - 0.12) * taper;
    for (let j = 0; j <= tSteps; j++) {
      const t = (j / tSteps) * top;
      pos.push(offset + R * Math.sin(t), R - R * Math.cos(t) + 0.04, -s);
      uv.push(j / tSteps, s / 8);
      if (i > 0 && j > 0) {
        const a = (i - 1) * (tSteps + 1) + j - 1;
        const b = i * (tSteps + 1) + j - 1;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const tex = stripeTexture('#b8562e', '#f3d2a2');
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, side: THREE.DoubleSide, flatShading: true }),
  );
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  const group = new THREE.Group();
  group.add(mesh);
  const m = frame(def);
  group.applyMatrix4(m);
  const c = trimeshCollider(physics, geo, m);
  c.setFriction(0.3);
  physics.setSurface(c, 'asphalt');
  physics.adhesive.add(c.handle);
  return { group, colliders: [c] };
}

/** Arched concrete tunnel along local -Z, with ceiling lights. */
function buildTunnel(def: TunnelStunt, physics: Physics): BuiltStunt {
  const { length: L, width: w, height: h } = def.params;
  const profile: [number, number][] = [];
  const wall = h * 0.55;
  profile.push([-w / 2, -0.5], [-w / 2, wall]);
  for (let k = 1; k < 10; k++) {
    const a = Math.PI - (k / 10) * Math.PI;
    profile.push([(Math.cos(a) * w) / 2, wall + Math.sin(a) * (h - wall)]);
  }
  profile.push([w / 2, wall], [w / 2, -0.5]);
  const pos: number[] = [];
  const idx: number[] = [];
  const steps = Math.ceil(L / 4);
  for (let i = 0; i <= steps; i++) {
    const z = -(i / steps) * L;
    for (const [x, y] of profile) pos.push(x, y, z);
    if (i > 0) {
      const a = (i - 1) * profile.length;
      const b = i * profile.length;
      for (let k = 0; k < profile.length - 1; k++) idx.push(a + k, b + k, a + k + 1, a + k + 1, b + k, b + k + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const shell = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x6d6a66, roughness: 0.9, side: THREE.DoubleSide }));
  shell.receiveShadow = true;
  const group = new THREE.Group();
  group.add(shell);
  // Ceiling light strip and portal frames.
  const lamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.6, 1.8) });
  for (let z = 6; z < L; z += 12) {
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, 2.2), lamp);
    light.position.set(0, h - 0.15, -z);
    group.add(light);
  }
  const portalMat = new THREE.MeshStandardMaterial({ color: 0x8e8a84, roughness: 0.9 });
  for (const z of [0, -L]) {
    const portal = new THREE.Mesh(new THREE.BoxGeometry(w + 6, 3, 1.5), portalMat);
    portal.position.set(0, h + 1.2, z);
    group.add(portal);
  }
  const m = frame(def);
  group.applyMatrix4(m);
  const c = trimeshCollider(physics, geo, m);
  c.setFriction(0.3);
  return { group, colliders: [c] };
}

let windowTexture: THREE.CanvasTexture | null = null;
export function buildingMaterial(): THREE.MeshStandardMaterial {
  windowTexture ??= canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#1a1d26';
    ctx.fillRect(0, 0, s, s);
    let seed = 7;
    const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let y = 8; y < s; y += 22) {
      for (let x = 6; x < s; x += 18) {
        const lit = rnd() < 0.45;
        ctx.fillStyle = lit ? (rnd() < 0.5 ? '#ffd9a0' : '#bfe4ff') : '#2a2f3c';
        ctx.fillRect(x, y, 10, 13);
      }
    }
  });
  return new THREE.MeshStandardMaterial({
    color: 0x9aa0ad,
    map: windowTexture,
    emissive: 0xffffff,
    emissiveMap: windowTexture,
    emissiveIntensity: 0.9,
    roughness: 0.6,
  });
}

/** A building from the ground up to a drivable flat roof at `position.y`. */
function buildBuilding(def: BuildingStunt, physics: Physics): BuiltStunt {
  const { width, length } = def.params;
  const h = def.position[1];
  const tex = buildingMaterial();
  const body = new THREE.Mesh(new THREE.BoxGeometry(width, h, length), tex);
  body.position.y = -h / 2 - 0.02;
  const uv = body.geometry.getAttribute('uv') as THREE.BufferAttribute;
  // Tile the window texture by size (6 m per tile).
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (width / 6), uv.getY(i) * (h / 6));
  body.castShadow = true;
  body.receiveShadow = true;
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(width + 0.6, 0.3, length + 0.6),
    new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.7 }),
  );
  roof.position.y = -0.14;
  roof.receiveShadow = true;
  const group = new THREE.Group();
  group.add(body, roof);
  const m = frame(def);
  group.applyMatrix4(m);
  const q = new THREE.Quaternion().setFromAxisAngle(UP, def.heading);
  const c = physics.world.createCollider(
    physics.R.ColliderDesc.cuboid(width / 2, h / 2, length / 2)
      .setTranslation(def.position[0], h / 2 - 0.02, def.position[2])
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
  );
  physics.setSurface(c, 'asphalt');
  return { group, colliders: [c] };
}

/** Boulders tumble down from the right-hand slope after a warning; re-arms after a while. */
function buildRockfall(def: RockfallStunt, physics: Physics): BuiltStunt {
  const group = new THREE.Group();
  const trigger = new THREE.Vector3(...def.position);
  const q = new THREE.Quaternion().setFromAxisAngle(UP, def.heading);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x7a6f66, roughness: 1, flatShading: true });
  const rocks: { body: RAPIER.RigidBody; mesh: THREE.Mesh }[] = [];
  let cooldown = 0;
  let pending = 0;
  const clear = (): void => {
    for (const r of rocks) {
      physics.world.removeRigidBody(r.body);
      r.mesh.geometry.dispose();
      r.mesh.removeFromParent();
    }
    rocks.length = 0;
  };
  return {
    group,
    colliders: [],
    update(dt, ctx) {
      cooldown = Math.max(0, cooldown - dt);
      if (pending > 0) {
        pending -= dt;
        if (pending <= 0) {
          for (let k = 0; k < def.params.count; k++) {
            const r = 1.1 + Math.random() * 1.1;
            const p = trigger
              .clone()
              .addScaledVector(fwd, def.params.ahead + k * 7 + Math.random() * 4)
              .addScaledVector(right, def.params.side)
              .add(new THREE.Vector3(0, 14 + Math.random() * 6, 0));
            const body = physics.world.createRigidBody(
              physics.R.RigidBodyDesc.dynamic()
                .setTranslation(p.x, p.y, p.z)
                .setLinvel(-right.x * 9, -2, -right.z * 9)
                .setAngularDamping(0.2),
            );
            physics.world.createCollider(physics.R.ColliderDesc.ball(r).setDensity(1.4).setFriction(0.9), body);
            const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), rockMat);
            mesh.castShadow = true;
            group.add(mesh);
            rocks.push({ body, mesh });
          }
        }
      }
      if (cooldown === 0 && pending <= 0 && ctx.player.distanceTo(trigger) < 12) {
        clear();
        ctx.warn('⚠ 落石！', '注意右侧山坡');
        pending = 0.9;
        cooldown = 20;
      }
      for (const r of rocks) {
        const t = r.body.translation();
        const o = r.body.rotation();
        r.mesh.position.set(t.x, t.y, t.z);
        r.mesh.quaternion.set(o.x, o.y, o.z, o.w);
      }
    },
    dispose() {
      clear();
      rockMat.dispose();
    },
  };
}

export function buildStunt(def: StuntDef, physics: Physics): BuiltStunt {
  switch (def.type) {
    case 'kicker':
      return buildKicker(def, physics);
    case 'carRow':
      return buildCarRow(def, physics);
    case 'invertedHalfLoop':
    case 'fullLoop':
      return buildHalfLoop(def, physics);
    case 'hump':
      return buildHump(def, physics);
    case 'wallRide':
      return buildWallRide(def, physics);
    case 'tunnel':
      return buildTunnel(def, physics);
    case 'building':
      return buildBuilding(def, physics);
    case 'rockfall':
      return buildRockfall(def, physics);
  }
}
