import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { disposeObject } from '../core/dispose';
import type { Physics } from '../core/Physics';
import { createRng } from '../core/Random';
import { createSkyMaterial } from './Sky';
import { runwayTexture, sandTexture } from './Textures';

export const TEST_GROUND_HALF_SIZE = 1000;
const RUNWAY_WIDTH = 20;
const RUNWAY_LENGTH = 1400;

/** Small scene (sky gradient + sun + soft panels) baked into a PMREM env map for paint reflections. */
export function createSkyEnvironmentScene(): THREE.Scene {
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), createSkyMaterial()));
  const sunMat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(30, 20, 12) });
  const sun = new THREE.Mesh(new THREE.SphereGeometry(2.5, 16, 8), sunMat);
  sun.position.set(-30, 40, 20);
  env.add(sun);
  // Long soft light strips give the clearcoat crisp highlight lines.
  const stripMat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(3, 3, 3.2), side: THREE.DoubleSide });
  for (const [x, z, ry] of [
    [0, -35, 0],
    [35, 0, Math.PI / 2],
  ] as const) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(60, 4), stripMat);
    strip.position.set(x, 18, z);
    strip.rotation.y = ry;
    env.add(strip);
  }
  return env;
}

/** Kicker ramp + rolling bumps on the runway to exercise suspension and air time. */
export function addTestFeatures(group: THREE.Group, physics: Physics): RAPIER.Collider[] {
  const colliders: RAPIER.Collider[] = [];
  const R = physics.R;
  const world = physics.world;
  const rampMat = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.55 });
  const bumpMat = new THREE.MeshStandardMaterial({ color: 0x5a5a60, roughness: 0.8 });

  // Kicker: a tilted slab, low end flush with the ground (car drives toward -Z).
  const addRamp = (z: number, width: number, length: number, angleDeg: number): void => {
    const th = 0.6;
    const a = THREE.MathUtils.degToRad(angleDeg);
    const cy = (length / 2) * Math.sin(a) - (th / 2) * Math.cos(a);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, th, length), rampMat);
    mesh.position.set(0, cy, z);
    mesh.rotation.x = a;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    const q = mesh.quaternion;
    const c = world.createCollider(
      R.ColliderDesc.cuboid(width / 2, th / 2, length / 2)
        .setTranslation(0, cy, z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setFriction(0.9),
    );
    physics.setSurface(c, 'asphalt');
    colliders.push(c);
  };
  addRamp(-150, 9, 12, 13);
  addRamp(-420, 9, 16, 18);

  // Rolling bumps: buried capsules across the runway.
  const bumpR = 1.6;
  const bumpH = 0.28;
  const halfW = RUNWAY_WIDTH / 2 - 0.5;
  const bumpGeo = new THREE.CylinderGeometry(bumpR, bumpR, halfW * 2, 40, 1).rotateZ(Math.PI / 2);
  for (let i = 0; i < 6; i++) {
    const z = 120 + i * 11;
    const y = bumpH - bumpR;
    const mesh = new THREE.Mesh(bumpGeo, bumpMat);
    mesh.position.set(0, y, z);
    mesh.receiveShadow = true;
    group.add(mesh);
    const c = world.createCollider(
      R.ColliderDesc.capsule(halfW, bumpR)
        .setTranslation(0, y, z)
        .setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2))
        .setFriction(0.9),
    );
    physics.setSurface(c, 'asphalt');
    colliders.push(c);
  }
  return colliders;
}

export interface TestGround {
  readonly group: THREE.Group;
  readonly spawn: THREE.Vector3;
  readonly spawnHeading: number;
  /** Keep the sky dome centred on the camera and inside its far plane. */
  updateSky(camera: THREE.PerspectiveCamera): void;
  dispose(): void;
}

export function createTestGround(maxAnisotropy: number, physics: Physics): TestGround {
  const R = physics.R;
  const world = physics.world;
  const group = new THREE.Group();
  group.name = 'test-ground';

  const size = TEST_GROUND_HALF_SIZE * 2;
  const sand = sandTexture();
  sand.repeat.set(size / 20, size / 20);
  sand.anisotropy = maxAnisotropy;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: sand, roughness: 0.95 }),
  );
  ground.receiveShadow = true;
  group.add(ground);

  const colliders: RAPIER.Collider[] = [];
  const groundCollider = world.createCollider(
    R.ColliderDesc.cuboid(TEST_GROUND_HALF_SIZE, 1, TEST_GROUND_HALF_SIZE).setTranslation(0, -1, 0).setFriction(0.9),
  );
  physics.setSurface(groundCollider, (_c, x, z) =>
    Math.abs(x) <= RUNWAY_WIDTH / 2 && Math.abs(z) <= RUNWAY_LENGTH / 2 ? 'asphalt' : 'hardSand',
  );

  const asphalt = runwayTexture();
  asphalt.repeat.set(1, RUNWAY_LENGTH / RUNWAY_WIDTH);
  asphalt.anisotropy = maxAnisotropy;
  const runway = new THREE.Mesh(
    new THREE.PlaneGeometry(RUNWAY_WIDTH, RUNWAY_LENGTH).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({
      map: asphalt,
      roughness: 0.75,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
  runway.position.y = 0.01;
  runway.receiveShadow = true;
  group.add(runway);

  const rng = createRng(42);
  const dummy = new THREE.Object3D();

  // Cones along both runway edges every 25 m.
  const coneCount = Math.floor(RUNWAY_LENGTH / 25) * 2;
  const cones = new THREE.InstancedMesh(
    new THREE.ConeGeometry(0.3, 0.8, 10).translate(0, 0.4, 0),
    new THREE.MeshStandardMaterial({ color: 0xff6a1a, emissive: 0x401000, roughness: 0.6 }),
    coneCount,
  );
  for (let i = 0; i < coneCount; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const z = RUNWAY_LENGTH / 2 - Math.floor(i / 2) * 25;
    dummy.position.set(side * (RUNWAY_WIDTH / 2 + 1), 0, z);
    dummy.updateMatrix();
    cones.setMatrixAt(i, dummy.matrix);
  }
  cones.castShadow = true;
  group.add(cones);

  // Scattered rocks as landmarks off the runway.
  const rockCount = 400;
  const rocks = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 0),
    new THREE.MeshStandardMaterial({ color: 0x8c5a3a, roughness: 1, flatShading: true }),
    rockCount,
  );
  for (let i = 0; i < rockCount; i++) {
    let x = 0;
    do x = (rng() * 2 - 1) * (TEST_GROUND_HALF_SIZE - 30);
    while (Math.abs(x) < RUNWAY_WIDTH * 1.5);
    const z = (rng() * 2 - 1) * (TEST_GROUND_HALF_SIZE - 30);
    const s = 0.6 + rng() * rng() * 6;
    dummy.position.set(x, s * 0.3, z);
    dummy.rotation.set(rng() * 3, rng() * 3, rng() * 3);
    dummy.scale.set(s, s * (0.5 + rng() * 0.6), s);
    dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
    // Sphere roughly matching the squashed rock; sunk a little into the sand.
    const rc = world.createCollider(R.ColliderDesc.ball(s * 0.6).setTranslation(x, s * 0.1, z).setFriction(0.8));
    physics.setSurface(rc, 'dirt');
    colliders.push(rc);
  }
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  group.add(rocks);

  colliders.push(groundCollider, ...addTestFeatures(group, physics));

  // Dusk gradient sky dome that follows the camera.
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), createSkyMaterial());
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  group.add(sky);

  return {
    group,
    spawn: new THREE.Vector3(0, 0, RUNWAY_LENGTH / 2 - 20),
    spawnHeading: 0,
    dispose(): void {
      physics.removeColliders(colliders);
      disposeObject(group);
    },
    updateSky(camera: THREE.PerspectiveCamera): void {
      sky.position.copy(camera.position);
      sky.scale.setScalar(camera.far * 0.9);
    },
  };
}
