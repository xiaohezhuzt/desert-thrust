import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRng } from '../../core/Random';
import { SkyDome, type SkyColors } from '../Sky';
import { buildTerrain, makeNoise } from '../Terrain';
import { sandNormalTexture, sandTexture } from '../Textures';
import { Clouds } from '../Clouds';
import { bush, cactus, grassTuft, mesa, propMaterial } from '../props/Nature';
import { density, patchy, rockGeometry, scatter, type Biome, type BiomeContext } from './common';

const DUSK: SkyColors = { top: 0x3a5aa0, horizon: 0xffb27a, bottom: 0xd59a62 };
const NIGHT: SkyColors = { top: 0x060b1e, horizon: 0x2c3360, bottom: 0x2a2420 };
/** Seconds from race start until full night. */
const NIGHTFALL = 110;

const TERRAIN_HALF = 900;
const TERRAIN_CELLS = 120;

/**
 * Desert launch site: hard-pan around the course, dunes beyond, a rocket test
 * tower, storage tanks, grandstand silhouettes with camera flashes and sweeping
 * searchlights. Dusk fades to night during the run.
 */
export function buildDesert(ctx: BiomeContext): Biome {
  const { physics, renderer } = ctx;
  const group = new THREE.Group();
  group.name = 'desert';
  const colliders: RAPIER.Collider[] = [];
  const noise = makeNoise(9);

  // ---- Terrain -------------------------------------------------------------
  const sand = sandTexture();
  sand.anisotropy = renderer.maxAnisotropy;
  const sandNormal = sandNormalTexture();
  sandNormal.anisotropy = renderer.maxAnisotropy;
  // Natural, slightly desaturated sand tones (the texture carries the grain and ripples).
  const sandA = new THREE.Color(0xf4d2a4);
  const sandB = new THREE.Color(0xe3b884);
  const crest = new THREE.Color(0xfbe6c4);
  const terrain = buildTerrain(physics, {
    halfSize: TERRAIN_HALF,
    cells: TERRAIN_CELLS,
    base: (x, z) =>
      noise(x / 180, z / 140) * 22 + noise(x / 60 + 7, z / 45) * 6 + Math.max(0, Math.sin((x + z * 0.6) / 70)) * 5,
    roads: ctx.roads,
    pads: ctx.pads,
    carves: ctx.carves,
    color: (h, slope, out, x, z) => {
      patchy(noise, sandA, sandB, x, z, out, 70);
      out.lerp(crest, Math.min(Math.max(h, 0) / 22, 1) * 0.6);
      // Lee sides of dunes a touch darker: cheap ambient occlusion.
      out.multiplyScalar(1 - Math.min(slope * 0.9, 0.3));
    },
    texture: sand,
    normalMap: sandNormal,
    textureMetres: 14,
    roughness: 0.97,
    surface: (h) => (h > 1.5 ? 'softSand' : 'hardSand'),
  });
  group.add(terrain.mesh);
  colliders.push(terrain.collider);

  // Far dune ring beyond the playable terrain so the horizon isn't a cliff edge.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(TERRAIN_HALF * 0.95, TERRAIN_HALF * 3, 64, 1).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xd9b282, roughness: 1 }),
  );
  ring.position.y = -0.5;
  group.add(ring);

  // ---- Nature: mesas on the horizon, cacti, shrubs, dry grass, rocks ------------
  const prng = createRng(1234);
  const k = density(ctx);
  const mat = propMaterial();
  const mesaMesh = new THREE.InstancedMesh(mesa(), mat, 14);
  {
    const d = new THREE.Object3D();
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + prng() * 0.3;
      const r = 520 + prng() * 260;
      d.position.set(Math.cos(a) * r, -2, Math.sin(a) * r);
      d.rotation.y = prng() * 6;
      d.scale.set(1 + prng() * 1.4, 0.8 + prng() * 1.2, 1 + prng() * 1.4);
      d.updateMatrix();
      mesaMesh.setMatrixAt(i, d.matrix);
    }
    group.add(mesaMesh);
  }
  const lines = ctx.allLines;
  group.add(
    scatter(cactus(), mat, Math.round(220 * k), prng, {
      radius: 750, lines, clearance: 13, heightAt: terrain.heightAt, scale: [0.8, 1.6], sink: 0.1, tints: [0xffffff, 0xd8f0c8, 0xf0ffe0],
      blob: 1.8,
    }),
    scatter(bush(0x6b6a2c, 0xa8a24a), mat, Math.round(260 * k), prng, {
      radius: 700, lines, clearance: 10, heightAt: terrain.heightAt, scale: [0.6, 1.3], tints: [0xffffff, 0xe8d0a0, 0xc8d890],
      blob: 2.2,
    }),
    scatter(grassTuft(0xa08440, 0xe6cf80), mat, Math.round(700 * k), prng, {
      radius: 500, lines, clearance: 9.5, near: 60, heightAt: terrain.heightAt, scale: [0.8, 1.6],
    }),
    scatter(rockGeometry(9), new THREE.MeshStandardMaterial({ color: 0xa8643c, roughness: 1, flatShading: true }), Math.round(160 * k), prng, {
      radius: 750, lines, clearance: 12, heightAt: terrain.heightAt, scale: [0.8, 3.2], sink: 0.4, tilt: 0.6,
    }),
  );
  const clouds = new Clouds({ count: Math.round(28 * Math.max(k, 0.5)), radius: [420, 900], height: [130, 240], top: 0xffe4cf, belly: 0xc98aa0, seed: 5 });
  group.add(clouds.group);

  // ---- Props ---------------------------------------------------------------
  const steel = new THREE.MeshStandardMaterial({ color: 0x8d939b, roughness: 0.45, metalness: 0.8 });
  const white = new THREE.MeshStandardMaterial({ color: 0xe9e7e2, roughness: 0.5, metalness: 0.2 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1e2024, roughness: 0.9 });
  const redLamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.3, 0.2) });

  const addStatic = (mesh: THREE.Mesh, halfX: number, halfY: number, halfZ: number): void => {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    const c = physics.world.createCollider(
      physics.R.ColliderDesc.cuboid(halfX, halfY, halfZ).setTranslation(
        mesh.position.x,
        mesh.position.y,
        mesh.position.z,
      ),
    );
    physics.setSurface(c, 'asphalt');
    colliders.push(c);
  };

  // Rocket test tower: lattice of beams, merged into one mesh.
  const tower = (x: number, z: number, h: number, w: number): void => {
    const beams: THREE.BufferGeometry[] = [];
    const legs: [number, number][] = [
      [-w, -w],
      [w, -w],
      [w, w],
      [-w, w],
    ];
    for (const [lx, lz] of legs) beams.push(new THREE.BoxGeometry(0.5, h, 0.5).translate(lx, h / 2, lz));
    for (let y = 4; y < h; y += 6) {
      for (let k = 0; k < 4; k++) {
        const [ax, az] = legs[k]!;
        const [bx, bz] = legs[(k + 1) % 4]!;
        const len = Math.hypot(bx - ax, bz - az);
        const g = new THREE.BoxGeometry(len, 0.3, 0.3);
        g.rotateY(-Math.atan2(bz - az, bx - ax));
        g.translate((ax + bx) / 2, y, (az + bz) / 2);
        beams.push(g);
        // Diagonal brace.
        const d = new THREE.BoxGeometry(Math.hypot(len, 6), 0.22, 0.22);
        d.rotateZ(Math.atan2(6, len));
        d.rotateY(-Math.atan2(bz - az, bx - ax));
        d.translate((ax + bx) / 2, y + 3, (az + bz) / 2);
        beams.push(d);
      }
    }
    beams.push(new THREE.BoxGeometry(w * 2 + 3, 1.2, w * 2 + 3).translate(0, h, 0));
    const merged = mergeGeometries(beams.map((b) => (b.index ? b.toNonIndexed() : b)));
    beams.forEach((b) => b.dispose());
    const mesh = new THREE.Mesh(merged ?? new THREE.BufferGeometry(), steel);
    mesh.position.set(x, 0, z);
    mesh.castShadow = true;
    group.add(mesh);
    const c = physics.world.createCollider(
      physics.R.ColliderDesc.cuboid(w + 0.3, h / 2, w + 0.3).setTranslation(x, h / 2, z),
    );
    colliders.push(c);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), redLamp);
    lamp.position.set(x, h + 1.4, z);
    lamp.name = 'beacon';
    group.add(lamp);
    // Rocket on the stand.
    const rocket = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, h * 0.75, 20), white);
    rocket.position.set(x + w + 3.5, h * 0.375, z);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(2.2, 6, 20), white);
    nose.position.set(x + w + 3.5, h * 0.75 + 3, z);
    group.add(nose);
    addStatic(rocket, 2.2, h * 0.375, 2.2);
  };
  tower(-70, 60, 62, 4);
  tower(-95, -140, 40, 3);

  // Storage tanks.
  const tankGeo = new THREE.CylinderGeometry(6, 6, 14, 24);
  const domeGeo = new THREE.SphereGeometry(6, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  for (const [x, z] of [
    [-120, 200],
    [-120, 180],
    [-138, 190],
    [130, -180],
  ] as const) {
    const tank = new THREE.Mesh(tankGeo, white);
    tank.position.set(x, 7, z);
    const dome = new THREE.Mesh(domeGeo, white);
    dome.position.set(x, 14, z);
    group.add(dome);
    addStatic(tank, 6, 7, 6);
  }

  // Grandstand silhouettes along the launch straight (right side).
  const stands: THREE.BufferGeometry[] = [];
  for (const z0 of [330, 150, -20]) {
    for (let step = 0; step < 6; step++) {
      stands.push(new THREE.BoxGeometry(5, 1.2 + step * 1.2, 120).translate(28 + step * 5, (1.2 + step * 1.2) / 2, z0));
    }
  }
  const standGeo = mergeGeometries(stands.map((b) => b.toNonIndexed()));
  stands.forEach((b) => b.dispose());
  const standMesh = new THREE.Mesh(standGeo ?? new THREE.BufferGeometry(), darkMat);
  standMesh.castShadow = true;
  group.add(standMesh);
  for (const z0 of [330, 150, -20]) {
    const c = physics.world.createCollider(physics.R.ColliderDesc.cuboid(15, 4, 60).setTranslation(40.5, 4, z0));
    colliders.push(c);
  }

  // Camera flashes in the crowd: additive points that blink at random.
  const FLASHES = 160;
  const flashPos = new Float32Array(FLASHES * 3);
  const flashRng = createRng(3);
  for (let i = 0; i < FLASHES; i++) {
    const stand = [330, 150, -20][i % 3]!;
    const step = Math.floor(flashRng() * 6);
    flashPos.set([28 + step * 5 + (flashRng() - 0.5) * 3, 1.6 + step * 1.2 + 0.8, stand + (flashRng() - 0.5) * 115], i * 3);
  }
  const flashGeo = new THREE.BufferGeometry();
  flashGeo.setAttribute('position', new THREE.BufferAttribute(flashPos, 3));
  const flashAlpha = new Float32Array(FLASHES);
  flashGeo.setAttribute('aAlpha', new THREE.BufferAttribute(flashAlpha, 1));
  const flashMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aAlpha; varying float vA;
      void main() { vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = 900.0 / max(-mv.z, 1.0); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main() { float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, d);
        gl_FragColor = vec4(vec3(4.0, 4.0, 3.6) * a * vA, a * vA); }`,
  });
  const flashes = new THREE.Points(flashGeo, flashMat);
  flashes.frustumCulled = false;
  group.add(flashes);

  // Searchlight beams: tall additive cones with a vertical fade, swinging slowly.
  const beamGeo = new THREE.CylinderGeometry(0.6, 9, 260, 20, 1, true).translate(0, 130, 0);
  const beamColors = new Float32Array(beamGeo.getAttribute('position').count * 3);
  const bp = beamGeo.getAttribute('position');
  for (let i = 0; i < bp.count; i++) {
    const f = 1 - bp.getY(i) / 260;
    beamColors.set([f, f, f], i * 3);
  }
  beamGeo.setAttribute('color', new THREE.BufferAttribute(beamColors, 3));
  const beamMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0.55, 0.65, 0.85),
    vertexColors: true,
    transparent: true,
    opacity: 0.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const beams: THREE.Mesh[] = [];
  for (const [x, z] of [
    [-45, 300],
    [-45, 0],
    [60, 250],
    [60, -120],
    [250, -300],
  ] as const) {
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.set(x, 0, z);
    group.add(beam);
    beams.push(beam);
  }

  // Course-side light poles (emissive heads; real lights would be too costly on mobile).
  const poleHead = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.6, 2) });
  const poles: THREE.BufferGeometry[] = [];
  const heads: THREE.BufferGeometry[] = [];
  for (let z = 480; z > -240; z -= 60) {
    for (const x of [-14, 14]) {
      poles.push(new THREE.CylinderGeometry(0.15, 0.2, 9, 6).translate(x, 4.5, z).toNonIndexed());
      heads.push(new THREE.BoxGeometry(1.4, 0.3, 0.6).translate(x - Math.sign(x) * 0.6, 9, z).toNonIndexed());
    }
  }
  const poleMesh = new THREE.Mesh(mergeGeometries(poles) ?? new THREE.BufferGeometry(), darkMat);
  const headMesh = new THREE.Mesh(mergeGeometries(heads) ?? new THREE.BufferGeometry(), poleHead);
  poles.forEach((g) => g.dispose());
  heads.forEach((g) => g.dispose());
  group.add(poleMesh, headMesh);

  // ---- Sky & lighting ------------------------------------------------------
  const sky = new SkyDome(DUSK);
  // Low evening sun, matching the key light's direction.
  sky.setSun(new THREE.Vector3(-60, 30, 40), 0xffc890, 0.9, 0.9993);
  group.add(sky.mesh);
  const fogColor = new THREE.Color();
  const duskFog = new THREE.Color(0xf0b88a);
  const nightFog = new THREE.Color(0x0d1020);
  renderer.setFog(duskFog);
  renderer.sun.color.set(0xffb070);
  renderer.hemi.color.set(0xffd9b8);
  renderer.hemi.groundColor.set(0x8a5236);
  renderer.sun.position.set(-60, 30, 40);
  const beaconRefs = group.children.filter((c) => c.name === 'beacon');

  return {
    group,
    colliders,
    heightAt: terrain.heightAt,
    update(dt, elapsed, camera) {
      const t = THREE.MathUtils.smoothstep(elapsed, 0, NIGHTFALL);
      sky.blend(DUSK, NIGHT, t);
      sky.follow(camera);
      clouds.update(dt, camera);
      clouds.group.visible = t < 0.85;
      fogColor.copy(duskFog).lerp(nightFog, t);
      if (renderer.scene.fog instanceof THREE.Fog) renderer.scene.fog.color.copy(fogColor);
      renderer.sun.intensity = THREE.MathUtils.lerp(3.1, 0.35, t);
      renderer.hemi.intensity = THREE.MathUtils.lerp(0.75, 0.25, t);
      renderer.scene.environmentIntensity = THREE.MathUtils.lerp(0.8, 0.25, t);

      beamMat.opacity = 0.05 + 0.12 * t;
      beams.forEach((b, i) => {
        b.rotation.z = Math.sin(elapsed * 0.25 + i * 1.7) * 0.45;
        b.rotation.x = Math.cos(elapsed * 0.2 + i * 2.3) * 0.3;
      });
      for (let i = 0; i < FLASHES; i++) {
        flashAlpha[i] = Math.max(0, flashAlpha[i]! - dt * 6);
        if (Math.random() < dt * 0.35) flashAlpha[i] = 1;
      }
      (flashGeo.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
      const blink = Math.sin(elapsed * 3) > 0 ? 1 : 0.1;
      for (const b of beaconRefs) b.visible = blink > 0.5;
    },
    dispose() {
      sand.dispose();
      sandNormal.dispose();
    },
  };
}
