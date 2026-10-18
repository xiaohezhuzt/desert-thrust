import * as THREE from 'three';
import { createRng } from '../../core/Random';
import { SkyDome } from '../Sky';
import { buildTerrain, fbm, makeNoise } from '../Terrain';
import { Clouds } from '../Clouds';
import { bush, flowerClump, grassTuft, propMaterial, roundTree, tierPine } from '../props/Nature';
import { applyLighting, density, mountainRing, patchy, rockGeometry, scatter, type Biome, type BiomeContext } from './common';

const HAZY_DUSK = {
  sky: { top: 0x3f63b0, horizon: 0xffc08a, bottom: 0x7a6a58 },
  fog: 0xd8b8a0,
  sunColor: 0xffc890,
  sunIntensity: 3.0,
  hemiSky: 0xc8d8ff,
  hemiGround: 0x5a6a3a,
  hemiIntensity: 0.7,
  envIntensity: 0.8,
};

/** Pine-covered mountain pass at dusk with haze, rock walls and distant snowy peaks. */
export function buildMountain(ctx: BiomeContext): Biome {
  const { physics, renderer } = ctx;
  const group = new THREE.Group();
  group.name = 'mountain';
  const noise = makeNoise(33);
  const grassA = new THREE.Color(0x63ad3e);
  const grassB = new THREE.Color(0x3f8a32);
  const rock = new THREE.Color(0x8c857c);
  const snow = new THREE.Color(0xeef2f6);
  const terrain = buildTerrain(physics, {
    halfSize: 1000,
    cells: 150,
    base: (x, z) => fbm(noise, x / 260, z / 260, 5) * 150 - 30 + noise(x / 70, z / 70) * 14,
    roads: ctx.roads,
    pads: ctx.pads,
    carves: ctx.carves,
    color: (h, slope, out, x, z) => {
      if (slope > 0.42) out.copy(rock);
      else patchy(noise, grassA, grassB, x, z, out, 45);
      if (h > 95) out.lerp(snow, Math.min(1, (h - 95) / 20));
    },
    surface: () => 'dirt',
    roughness: 0.95,
  });
  group.add(terrain.mesh);

  const rng = createRng(8);
  const k = density(ctx);
  const mat = propMaterial();
  const lines = ctx.allLines;
  const h = terrain.heightAt;
  const gentle = (x: number, z: number, y: number): boolean =>
    Math.abs(h(x + 3, z) - y) + Math.abs(h(x, z + 3) - y) < 3.5 && y < 90;
  group.add(
    scatter(tierPine(false), mat, Math.round(420 * k), rng, {
      radius: 650, lines, clearance: 12, heightAt: h, scale: [0.8, 1.7], accept: gentle, sink: 0.3, tints: [0xffffff, 0xd8ffd8, 0xe8f0d0],
      blob: 3.6,
    }),
    scatter(roundTree(0x2f6e2a, 0x9ad34f, 31), mat, Math.round(200 * k), rng, {
      radius: 600, lines, clearance: 12, heightAt: h, scale: [0.8, 1.4], accept: gentle,
      tints: [0xffffff, 0xffd080, 0xff9a60, 0xfff0a0],
      blob: 4.2,
    }),
    scatter(bush(0x2f6a2a, 0x7fbf48), mat, Math.round(260 * k), rng, {
      radius: 500, lines, clearance: 8.5, heightAt: h, scale: [0.6, 1.2], accept: gentle,
      blob: 2.2,
    }),
    scatter(flowerClump(), mat, Math.round(600 * k), rng, {
      radius: 450, lines, clearance: 8, near: 40, heightAt: h, scale: [0.9, 1.4], accept: gentle,
      tints: [0xffffff, 0xffd23b, 0xb58aff, 0xff6aa0],
    }),
    scatter(grassTuft(0x3f8a2e, 0x9fd85a), mat, Math.round(800 * k), rng, {
      radius: 450, lines, clearance: 8, near: 50, heightAt: h, scale: [0.8, 1.5], accept: gentle,
    }),
    scatter(rockGeometry(21), new THREE.MeshStandardMaterial({ color: 0x8f8a84, roughness: 1, flatShading: true }), Math.round(180 * k), rng, {
      radius: 600, lines, clearance: 10, heightAt: h, scale: [1, 4], sink: 0.5, tilt: 0.5,
    }),
  );
  const clouds = new Clouds({ count: Math.round(30 * Math.max(k, 0.5)), radius: [400, 900], height: [170, 280], top: 0xfff1e2, belly: 0xb8a6c8, seed: 33 });
  group.add(clouds.group);
  group.add(mountainRing(1400, 0x5d5a66, true, 4));

  const sky = new SkyDome(HAZY_DUSK.sky);
  sky.setSun(new THREE.Vector3(-60, 40, 40), 0xffd0a0, 0.8, 0.9994);
  group.add(sky.mesh);
  applyLighting(renderer, HAZY_DUSK);
  return {
    group,
    colliders: [terrain.collider],
    heightAt: terrain.heightAt,
    update(dt, _e, camera) {
      sky.follow(camera);
      clouds.update(dt, camera);
    },
    dispose() {},
  };
}
