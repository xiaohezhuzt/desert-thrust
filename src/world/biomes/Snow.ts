import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRng } from '../../core/Random';
import { Weather } from '../../fx/Weather';
import { SkyDome } from '../Sky';
import { buildTerrain, fbm, makeNoise } from '../Terrain';
import { Clouds } from '../Clouds';
import { bush, propMaterial, snowman, tierPine } from '../props/Nature';
import { applyLighting, density, mountainRing, patchy, scatter, type Biome, type BiomeContext } from './common';

const SNOW_NIGHT = {
  sky: { top: 0x0a1430, horizon: 0x3a5288, bottom: 0xc8d2e4 },
  fog: 0x34446a,
  sunColor: 0xb8ccff,
  sunIntensity: 1.6,
  hemiSky: 0x9ab4ff,
  hemiGround: 0xe6eeff,
  hemiIntensity: 0.65,
  envIntensity: 0.5,
};

/** Snowfield at night: snowfall, frozen lake, snowy pines and a cable car line. */
export function buildSnow(ctx: BiomeContext): Biome {
  const { physics, renderer, def } = ctx;
  const group = new THREE.Group();
  group.name = 'snow';
  const solids: RAPIER.Collider[] = [];
  const noise = makeNoise(44);
  const snowC = new THREE.Color(0xe8eef7);
  const shade = new THREE.Color(0xb8c6dc);
  const rock = new THREE.Color(0x4c5058);
  const terrain = buildTerrain(physics, {
    halfSize: 1000,
    cells: 140,
    base: (x, z) => fbm(noise, x / 230, z / 230, 4) * 90 - 20,
    roads: ctx.roads,
    pads: ctx.pads,
    carves: ctx.carves,
    color: (h, slope, out, x, z) => {
      patchy(noise, snowC, shade, x, z, out, 80);
      out.lerp(shade, Math.min(1, slope * 1.4));
      if (slope > 0.6) out.copy(rock);
      void h;
    },
    surface: () => 'snow',
    roughness: 0.85,
  });
  group.add(terrain.mesh);

  // Frozen lake sheen under every ice road.
  const iceMat = new THREE.MeshStandardMaterial({ color: 0xa9d2ee, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.85 });
  def.roads.forEach((r, i) => {
    if (r.style !== 'ice') return;
    const line = ctx.allLines[i]!;
    const box = new THREE.Box3().setFromPoints(line);
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const disc = new THREE.Mesh(new THREE.CircleGeometry(Math.max(size.x, size.z) / 2 + 45, 48).rotateX(-Math.PI / 2), iceMat);
    disc.position.set(c.x, c.y + 0.01, c.z);
    disc.receiveShadow = true;
    group.add(disc);
  });

  const rng = createRng(12);
  const low = renderer.currentQuality.tier === 'low';
  const k = density(ctx);
  const mat = propMaterial();
  const lines = ctx.allLines;
  group.add(
    scatter(tierPine(true), mat, Math.round(420 * k), rng, {
      solid: { physics, out: solids, shape: 'cylinder', r: 0.6, h: 3 }, radius: 650, lines, clearance: 14, heightAt: terrain.heightAt, scale: [0.8, 1.7], sink: 0.3,
      blob: 3.6,
    }),
    scatter(bush(0x9fb0c8, 0xffffff), mat, Math.round(200 * k), rng, {
      radius: 500, lines, clearance: 9, heightAt: terrain.heightAt, scale: [0.6, 1.4],
      blob: 2.2,
    }),
    scatter(snowman(), mat, Math.round(26 * Math.max(k, 0.5)), rng, {
      solid: { physics, out: solids, shape: 'cylinder', r: 1.2, h: 4 }, radius: 500, lines, clearance: 11, near: 30, heightAt: terrain.heightAt, scale: [0.9, 1.3],
      blob: 1.8,
    }),
  );
  const clouds = new Clouds({ count: Math.round(22 * Math.max(k, 0.5)), radius: [350, 850], height: [150, 240], top: 0x5a6c96, belly: 0x232c48, seed: 44, opacity: 0.85 });
  group.add(clouds.group);
  group.add(mountainRing(1400, 0x3a4052, true, 9));

  // Cable car: towers alongside the course, a cable, gondolas gliding along it.
  const first = ctx.allLines[0]!;
  const towers: THREE.Vector3[] = [];
  for (let i = 0; i < first.length; i += 40) {
    const p = first[i]!;
    const nxt = first[Math.min(i + 1, first.length - 1)]!;
    const dir = new THREE.Vector3().subVectors(nxt, p).setY(0).normalize();
    const at = p.clone().addScaledVector(new THREE.Vector3(-dir.z, 0, dir.x), -45);
    at.y = terrain.heightAt(at.x, at.z);
    towers.push(at);
  }
  const steel = new THREE.MeshStandardMaterial({ color: 0x5a6070, roughness: 0.5, metalness: 0.7 });
  const towerParts: THREE.BufferGeometry[] = [];
  for (const t of towers) {
    towerParts.push(new THREE.BoxGeometry(1.2, 28, 1.2).translate(t.x, t.y + 14, t.z).toNonIndexed());
    towerParts.push(new THREE.BoxGeometry(8, 0.8, 0.8).translate(t.x, t.y + 28, t.z).toNonIndexed());
  }
  const towerMesh = new THREE.Mesh(mergeGeometries(towerParts) ?? new THREE.BufferGeometry(), steel);
  towerParts.forEach((g) => g.dispose());
  towerMesh.castShadow = true;
  group.add(towerMesh);
  const cablePts = towers.map((t) => new THREE.Vector3(t.x, t.y + 28.4, t.z));
  const cable = cablePts.length > 1 ? new THREE.CatmullRomCurve3(cablePts) : null;
  if (cable) {
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(cable.getPoints(200)), new THREE.LineBasicMaterial({ color: 0x20242c })));
  }
  const gondolas: THREE.Mesh[] = [];
  const gMat = new THREE.MeshStandardMaterial({ color: 0xd63b2f, roughness: 0.5, emissive: 0x220000 });
  for (let k = 0; k < 6 && cable; k++) {
    const g = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2, 2.4), gMat);
    group.add(g);
    gondolas.push(g);
  }

  const weather = new Weather('snow', low ? 500 : renderer.currentQuality.tier === 'medium' ? 1200 : 2200);
  group.add(weather.object);
  const sky = new SkyDome(SNOW_NIGHT.sky);
  // A big bright moon.
  sky.setSun(new THREE.Vector3(-60, 55, 40), 0xdfe8ff, 0.5, 0.9990);
  group.add(sky.mesh);
  applyLighting(renderer, SNOW_NIGHT);
  let t = 0;
  return {
    group,
    colliders: [terrain.collider, ...solids],
    heightAt: terrain.heightAt,
    update(dt, _e, camera) {
      t += dt;
      sky.follow(camera);
      clouds.update(dt, camera);
      weather.update(dt, camera);
      if (cable) {
        gondolas.forEach((g, k) => {
          const u = (t * 0.01 + k / gondolas.length) % 1;
          g.position.copy(cable.getPointAt(u)).add(new THREE.Vector3(0, -2.2, 0));
        });
      }
    },
    dispose() {
      weather.dispose();
    },
  };
}
