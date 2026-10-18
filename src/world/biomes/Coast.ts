import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRng } from '../../core/Random';
import { Ocean } from '../Ocean';
import { SkyDome } from '../Sky';
import { buildTerrain, fbm, makeNoise } from '../Terrain';
import { sandTexture } from '../Textures';
import { Clouds } from '../Clouds';
import { bush, flowerClump, grassTuft, propMaterial, roundTree, umbrella } from '../props/Nature';
import { applyLighting, density, palmGeometry, patchy, rockGeometry, scatter, type Biome, type BiomeContext } from './common';

const NOON = {
  sky: { top: 0x2a7de1, horizon: 0xbfe6ff, bottom: 0xe2cfa5 },
  fog: 0xc6e4f7,
  sunColor: 0xfff4e0,
  sunIntensity: 3.4,
  hemiSky: 0xbfe3ff,
  hemiGround: 0x8f8a52,
  hemiIntensity: 0.8,
  envIntensity: 1.1,
};

/** Shoreline x position for a given z (sea to the west). */
function shoreX(z: number): number {
  return -98 + Math.sin(z / 160) * 16;
}

/**
 * Sunny coast: cliffs and hills to the east, a beach, a wooden pier, a
 * breakwater and a lighthouse, with an animated Gerstner sea.
 */
export function buildCoast(ctx: BiomeContext): Biome {
  const { physics, renderer, def } = ctx;
  const group = new THREE.Group();
  group.name = 'coast';
  const noise = makeNoise(21);
  const waterLevel = def.waterLevel ?? 0;

  const base = (x: number, z: number): number => {
    const d = x - shoreX(z);
    if (d < -45) return -9 + fbm(noise, x / 90, z / 90, 2) * 2;
    if (d < 10) return THREE.MathUtils.lerp(-9, 1.4, THREE.MathUtils.smoothstep(d, -45, 10));
    // A wide, gently rising coastal plain before the hills, so the shore road isn't in a cutting.
    if (d < 85) return 1.4 + (d - 10) * 0.012;
    return 2.3 + (d - 85) * 0.32 + fbm(noise, x / 140, z / 140) * 26 * THREE.MathUtils.smoothstep(d, 85, 150);
  };
  const sandC = new THREE.Color(0xf2dca4);
  const grassA = new THREE.Color(0x6fbf45);
  const grassB = new THREE.Color(0x4f9c38);
  const rock = new THREE.Color(0x9a9286);
  const seabed = new THREE.Color(0x3fc3c8);
  const tex = sandTexture();
  tex.anisotropy = renderer.maxAnisotropy;
  const terrain = buildTerrain(physics, {
    halfSize: 1000,
    cells: 140,
    base,
    roads: ctx.roads,
    pads: ctx.pads,
    carves: ctx.carves,
    color: (h, slope, out, x, z) => {
      if (h < waterLevel - 0.5) out.copy(seabed).lerp(sandC, THREE.MathUtils.clamp((h + 4) / 4, 0, 1) * 0.6);
      else if (h < 3.2) out.copy(sandC);
      else patchy(noise, grassA, grassB, x, z, out, 55);
      if (h >= 3.2 && h < 4.2) out.lerp(sandC, 1 - (h - 3.2));
      if (slope > 0.45 && h > 2) out.copy(rock);
    },
    texture: tex,
    textureMetres: 20,
    surface: (h, slope) => (h < 3.5 ? 'hardSand' : slope > 0.45 ? 'dirt' : 'dirt'),
  });
  group.add(terrain.mesh);

  const q = renderer.currentQuality;
  const ocean = new Ocean(waterLevel, 2400, q.tier !== 'low');
  group.add(ocean.mesh);

  const rng = createRng(5);
  const k = density(ctx);
  const mat = propMaterial();
  const lines = ctx.allLines;
  const h = terrain.heightAt;
  group.add(
    scatter(palmGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }), Math.round(110 * k), rng, {
      blob: 2.6,
      radius: 700, lines, clearance: 10, heightAt: h, scale: [0.9, 1.5], accept: (_x, _z, y) => y > waterLevel + 0.6 && y < 7,
    }),
    scatter(roundTree(0x2f7d2e, 0x8fd14f, 11), mat, Math.round(260 * k), rng, {
      radius: 750, lines, clearance: 12, heightAt: h, scale: [0.8, 1.5], accept: (_x, _z, y) => y > 5, tints: [0xffffff, 0xe0ffd0, 0xfff0c0],
      blob: 4.2,
    }),
    scatter(bush(0x2f7a2e, 0x7fcc4c), mat, Math.round(300 * k), rng, {
      radius: 600, lines, clearance: 9, heightAt: h, scale: [0.6, 1.3], accept: (_x, _z, y) => y > 3.5,
      blob: 2.2,
    }),
    scatter(flowerClump(), mat, Math.round(700 * k), rng, {
      radius: 500, lines, clearance: 8.5, near: 45, heightAt: h, scale: [0.9, 1.5], accept: (_x, _z, y) => y > 3.4,
      tints: [0xff5a8a, 0xffd23b, 0xffffff, 0xb58aff, 0xff8a3b],
    }),
    scatter(grassTuft(0x3f8a2e, 0x9fe05a), mat, Math.round(900 * k), rng, {
      radius: 500, lines, clearance: 8.5, near: 60, heightAt: h, scale: [0.8, 1.5], accept: (_x, _z, y) => y > 3.3,
    }),
    scatter(umbrella(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide }), Math.round(60 * k), rng, {
      blob: 1.6,
      radius: 600, lines, clearance: 10, heightAt: h, scale: [1, 1.3], accept: (_x, _z, y) => y > waterLevel + 0.4 && y < 2.8,
      tints: [0xff4a4a, 0x2f8cff, 0xffd23b, 0x3fc35a, 0xff7ad9],
    }),
  );

  // Sailboats bobbing out at sea.
  const boatParts = [
    new THREE.BoxGeometry(2.4, 1.0, 7).translate(0, 0.3, 0),
    new THREE.CylinderGeometry(0.1, 0.1, 9, 6).translate(0, 5, 0.5),
  ];
  const boatGeo = mergeGeometries(boatParts.map((g) => g.toNonIndexed())) ?? new THREE.BufferGeometry();
  boatParts.forEach((g) => g.dispose());
  const sailGeo = new THREE.BufferGeometry();
  sailGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 1.2, 0.6, 0, 9.3, 0.6, 0, 1.2, -3.6], 3));
  sailGeo.computeVertexNormals();
  const boats: THREE.Group[] = [];
  const boatMat = new THREE.MeshStandardMaterial({ color: 0xf5f3ee, roughness: 0.5 });
  const sailMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, side: THREE.DoubleSide });
  for (let i = 0; i < 9; i++) {
    const z = -650 + i * 150 + rng() * 60;
    const x = shoreX(z) - 140 - rng() * 320;
    const b = new THREE.Group();
    b.add(new THREE.Mesh(boatGeo, boatMat), new THREE.Mesh(sailGeo, sailMat));
    b.position.set(x, waterLevel, z);
    b.rotation.y = rng() * Math.PI * 2;
    b.userData.phase = rng() * 6;
    group.add(b);
    boats.push(b);
  }
  const clouds = new Clouds({ count: Math.round(36 * Math.max(k, 0.5)), radius: [380, 900], height: [140, 260], top: 0xffffff, belly: 0xb9cde8, seed: 21 });
  group.add(clouds.group);

  // Breakwater armour rocks wherever a road runs over the sea.
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x7c7a76, roughness: 1, flatShading: true });
  const rockGeo = rockGeometry(3);
  const placements: THREE.Matrix4[] = [];
  const m = new THREE.Matrix4();
  for (const line of ctx.allLines) {
    for (let i = 0; i < line.length; i += 2) {
      const p = line[i]!;
      if (terrain.heightAt(p.x, p.z) > waterLevel - 0.2 || p.y > waterLevel + 2.6) continue;
      const nxt = line[Math.min(i + 1, line.length - 1)]!;
      const dir = new THREE.Vector3().subVectors(nxt, p).setY(0).normalize();
      const right = new THREE.Vector3(-dir.z, 0, dir.x);
      for (const side of [-1, 1]) {
        const s = 1.6 + rng() * 1.4;
        const at = p.clone().addScaledVector(right, side * (5.5 + rng() * 2.5));
        m.compose(
          new THREE.Vector3(at.x, waterLevel - 0.6, at.z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(rng(), rng() * 6, rng())),
          new THREE.Vector3(s, s, s),
        );
        placements.push(m.clone());
      }
    }
  }
  const armour = new THREE.InstancedMesh(rockGeo, rockMat, Math.max(placements.length, 1));
  placements.forEach((mm, i) => armour.setMatrixAt(i, mm));
  armour.count = placements.length;
  armour.receiveShadow = true;
  group.add(armour);

  // Lighthouse at the far end of the breakwater (last point of the last road).
  const lastLine = ctx.allLines[ctx.allLines.length - 1]!;
  const tip = lastLine[lastLine.length - 1]!;
  const lh = new THREE.Group();
  const stripes = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
  const red = new THREE.MeshStandardMaterial({ color: 0xc8302a, roughness: 0.6 });
  for (let k = 0; k < 6; k++) {
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(2.2 - k * 0.15, 2.35 - k * 0.15, 4, 16), k % 2 ? red : stripes);
    seg.position.y = 2 + k * 4;
    seg.castShadow = true;
    lh.add(seg);
  }
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(1.2, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.6, 2.6) }));
  lamp.position.y = 25.5;
  lh.add(lamp);
  lh.position.set(tip.x - 14, tip.y - 1, tip.z + 10);
  group.add(lh);

  const sky = new SkyDome(NOON.sky);
  sky.setSun(new THREE.Vector3(-60, 90, 40), 0xfff2d8, 0.55, 0.9996);
  group.add(sky.mesh);
  let t = 0;
  applyLighting(renderer, NOON);

  return {
    group,
    colliders: [terrain.collider],
    heightAt: terrain.heightAt,
    update(dt, _elapsed, camera) {
      t += dt;
      ocean.update(dt, camera);
      sky.follow(camera);
      clouds.update(dt, camera);
      for (const b of boats) {
        const p = b.userData.phase as number;
        b.position.y = waterLevel + Math.sin(t * 0.9 + p) * 0.35;
        b.rotation.z = Math.sin(t * 0.7 + p) * 0.06;
      }
    },
    dispose() {
      tex.dispose();
      ocean.dispose();
    },
  };
}
