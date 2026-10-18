import * as THREE from 'three';
import { createRng } from '../../core/Random';
import { Weather } from '../../fx/Weather';
import { SkyDome } from '../Sky';
import { buildingMaterial } from '../StuntPieces';
import { buildTerrain } from '../Terrain';
import { canvasTexture } from '../Textures';
import { applyLighting, distToLines, type Biome, type BiomeContext } from './common';

const RAIN_NIGHT = {
  sky: { top: 0x020208, horizon: 0x2c1745, bottom: 0x0d0d14 },
  fog: 0x1a1030,
  sunColor: 0x8090ff,
  sunIntensity: 0.5,
  hemiSky: 0x6a5aff,
  hemiGround: 0x141420,
  hemiIntensity: 0.35,
  envIntensity: 0.7,
};

const NEON = [new THREE.Color(4, 0.4, 3.2), new THREE.Color(0.3, 3.4, 4), new THREE.Color(4, 3, 0.4), new THREE.Color(0.6, 4, 1)];

/** Rainy neon city: towers with lit windows, neon strips, wet streets, elevated highways. */
export function buildNightCity(ctx: BiomeContext): Biome {
  const { physics, renderer } = ctx;
  const group = new THREE.Group();
  group.name = 'night-city';
  const street = new THREE.Color(0x15161c);
  const terrain = buildTerrain(physics, {
    halfSize: 1000,
    cells: 60,
    base: () => 0,
    roads: ctx.roads,
    pads: ctx.pads,
    carves: ctx.carves,
    color: (_h, _s, out) => out.copy(street),
    surface: () => 'wet',
    roughness: 0.25,
  });
  (terrain.mesh.material as THREE.MeshStandardMaterial).metalness = 0.3;
  group.add(terrain.mesh);

  // City blocks on a grid, kept clear of the course.
  const rng = createRng(77);
  const low = renderer.currentQuality.tier === 'low';
  const placements: THREE.Matrix4[] = [];
  const neonPlacements: THREE.Matrix4[][] = NEON.map(() => []);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const span = low ? 520 : 760;
  for (let x = -span; x <= span; x += 46) {
    for (let z = -span; z <= span; z += 46) {
      const jx = x + (rng() - 0.5) * 10;
      const jz = z + (rng() - 0.5) * 10;
      if (distToLines(ctx.allLines, jx, jz) < 30) continue;
      const w = 18 + rng() * 14;
      const d = 18 + rng() * 14;
      const h = 18 + rng() ** 2 * 110;
      m.compose(new THREE.Vector3(jx, h / 2, jz), q, new THREE.Vector3(w, h, d));
      placements.push(m.clone());
      if (rng() < 0.55) {
        const k = Math.floor(rng() * NEON.length);
        const sh = 4 + rng() * 10;
        m.compose(
          new THREE.Vector3(jx + w / 2 + 0.3, Math.min(h - 3, 8 + rng() * 30), jz),
          q,
          new THREE.Vector3(0.4, sh, 1 + rng() * 3),
        );
        neonPlacements[k]!.push(m.clone());
      }
    }
  }
  const mat = buildingMaterial();
  const towers = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, Math.max(placements.length, 1));
  placements.forEach((mm, i) => towers.setMatrixAt(i, mm));
  towers.count = placements.length;
  towers.receiveShadow = true;
  group.add(towers);
  NEON.forEach((c, k) => {
    const list = neonPlacements[k]!;
    if (!list.length) return;
    const signs = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: c }), list.length);
    list.forEach((mm, i) => signs.setMatrixAt(i, mm));
    group.add(signs);
  });

  // Giant glowing billboards facing the highway (abstract art, no text).
  const boardTextures = [0, 1, 2, 3].map((v) =>
    canvasTexture(256, (ctx2, sz) => {
      const pal = [
        ['#ff2e88', '#2ee6ff'],
        ['#ffe02e', '#ff4d2e'],
        ['#9a5cff', '#2effa6'],
        ['#2e7bff', '#ff2ee0'],
      ][v]!;
      const grad = ctx2.createLinearGradient(0, 0, sz, sz);
      grad.addColorStop(0, pal[0]!);
      grad.addColorStop(1, pal[1]!);
      ctx2.fillStyle = grad;
      ctx2.fillRect(0, 0, sz, sz);
      ctx2.globalAlpha = 0.85;
      ctx2.fillStyle = '#0b0b14';
      for (let k = 0; k < 6; k++) {
        ctx2.beginPath();
        ctx2.arc(((k * 97 + v * 41) % sz), ((k * 61 + v * 23) % sz), 18 + ((k * 13) % 40), 0, Math.PI * 2);
        ctx2.fill();
      }
      ctx2.globalAlpha = 1;
      ctx2.strokeStyle = '#ffffff';
      ctx2.lineWidth = 8;
      ctx2.strokeRect(10, 10, sz - 20, sz - 20);
    }),
  );
  const boardGeo = new THREE.PlaneGeometry(1, 1);
  const boardLists: THREE.Matrix4[][] = boardTextures.map(() => []);
  const fwd = new THREE.Vector3();
  for (const line of ctx.allLines) {
    for (let i = 10; i < line.length - 10; i += low ? 40 : 24) {
      const p = line[i]!;
      fwd.subVectors(line[i + 1]!, line[i - 1]!).setY(0).normalize();
      const side = i % 48 < 24 ? 1 : -1;
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      const at = p.clone().addScaledVector(right, side * (38 + rng() * 20)).addScaledVector(fwd, -20);
      at.y = p.y + 14 + rng() * 18;
      const w = 18 + rng() * 10;
      // Face back toward the road, angled slightly toward oncoming traffic.
      const yaw = Math.atan2(-right.x * side, -right.z * side) + side * 0.35;
      m.compose(at, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(w, w * 0.56, 1));
      boardLists[Math.floor(rng() * boardLists.length)]!.push(m.clone());
    }
  }
  boardTextures.forEach((tex, v) => {
    const list = boardLists[v]!;
    if (!list.length) return;
    const mesh = new THREE.InstancedMesh(
      boardGeo,
      new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.7, 1.7, 1.7), side: THREE.DoubleSide }),
      list.length,
    );
    list.forEach((mm, i) => mesh.setMatrixAt(i, mm));
    group.add(mesh);
  });

  // Light poles along the elevated decks.
  const heads: THREE.Matrix4[] = [];
  for (const line of ctx.allLines) {
    for (let i = 0; i < line.length; i += 12) {
      const p = line[i]!;
      m.compose(new THREE.Vector3(p.x, p.y + 7, p.z), q, new THREE.Vector3(1.6, 0.25, 0.6));
      heads.push(m.clone());
    }
  }
  const headMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.6, 3.4) }),
    Math.max(heads.length, 1),
  );
  heads.forEach((mm, i) => headMesh.setMatrixAt(i, mm));
  headMesh.count = heads.length;
  group.add(headMesh);

  const weather = new Weather('rain', low ? 400 : renderer.currentQuality.tier === 'medium' ? 900 : 1600);
  group.add(weather.object);
  const sky = new SkyDome(RAIN_NIGHT.sky);
  group.add(sky.mesh);
  applyLighting(renderer, RAIN_NIGHT);
  return {
    group,
    colliders: [terrain.collider],
    heightAt: terrain.heightAt,
    update(dt, _e, camera) {
      sky.follow(camera);
      weather.update(dt, camera);
    },
    dispose() {
      weather.dispose();
    },
  };
}
