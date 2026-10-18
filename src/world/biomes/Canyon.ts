import * as THREE from 'three';
import { createRng } from '../../core/Random';
import { SkyDome } from '../Sky';
import { buildTerrain, fbm, makeNoise } from '../Terrain';
import { Clouds } from '../Clouds';
import { bush, cactus, flowerClump, mesa, propMaterial } from '../props/Nature';
import { applyLighting, density, mergeParts, mountainRing, rockGeometry, scatter, type Biome, type BiomeContext } from './common';

const SUNRISE = {
  sky: { top: 0x3f7ad0, horizon: 0xffc58a, bottom: 0xb05a32 },
  fog: 0xf2bf8e,
  sunColor: 0xffd0a0,
  sunIntensity: 3.2,
  hemiSky: 0xb8d0ff,
  hemiGround: 0xa0502a,
  hemiIntensity: 0.7,
  envIntensity: 0.9,
};

/** Hoodoo: three stacked, tapered, faceted drums. */
function hoodooGeometry(): THREE.BufferGeometry {
  return mergeParts([
    new THREE.CylinderGeometry(3.2, 4.2, 10, 7).translate(0, 5, 0),
    new THREE.CylinderGeometry(2.4, 3.1, 9, 7).translate(0.4, 14.5, 0),
    new THREE.CylinderGeometry(3.0, 2.2, 3, 7).translate(0.2, 20.5, 0.3),
  ]);
}

/** Red-rock canyon at sunrise: layered cliffs, hoodoos, stone arches, dry riverbed. */
export function buildCanyon(ctx: BiomeContext): Biome {
  const { physics, renderer } = ctx;
  const group = new THREE.Group();
  group.name = 'canyon';
  const noise = makeNoise(55);
  const a = new THREE.Color(0xc65a2c);
  const b = new THREE.Color(0xeea063);
  const bed = new THREE.Color(0xd8b07a);
  const terrain = buildTerrain(physics, {
    halfSize: 1000,
    cells: 150,
    base: (x, z) => 42 + fbm(noise, x / 160, z / 160, 4) * 40,
    roads: ctx.roads,
    pads: ctx.pads,
    carves: ctx.carves,
    color: (h, slope, out) => {
      // Sediment layers: alternating bands by height.
      out.copy(a).lerp(b, 0.5 + 0.5 * Math.sin(h * 0.55));
      if (slope < 0.15 && h < 6) out.copy(bed);
    },
    surface: (h) => (h < 6 ? 'hardSand' : 'dirt'),
    roughness: 1,
  });
  group.add(terrain.mesh);

  const rng = createRng(17);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0xb85a32, roughness: 1, flatShading: true });
  group.add(
    scatter(hoodooGeometry(), rockMat, 70, rng, {
      radius: 600,
      lines: ctx.allLines,
      clearance: 16,
      heightAt: terrain.heightAt,
      scale: [0.7, 1.6],
      accept: (_x, _z, h) => h < 30,
      sink: 1,
    }),
  );

  // Natural arches spanning the course at a few points.
  const archGeo = new THREE.TorusGeometry(16, 3.2, 6, 20, Math.PI);
  const mainLine = ctx.allLines[0]!;
  for (const f of [0.22, 0.75]) {
    const i = Math.floor(mainLine.length * f);
    const p = mainLine[i]!;
    const nxt = mainLine[Math.min(i + 1, mainLine.length - 1)]!;
    const arch = new THREE.Mesh(archGeo, rockMat);
    arch.position.set(p.x, p.y - 1, p.z);
    arch.rotation.y = Math.atan2(nxt.x - p.x, nxt.z - p.z) + Math.PI / 2;
    arch.scale.set(1, 1.2, 1);
    arch.castShadow = true;
    group.add(arch);
  }
  const k = density(ctx);
  const pmat = propMaterial();
  const lines = ctx.allLines;
  const flat = (_x: number, _z: number, y: number): boolean => y < 10;
  group.add(
    scatter(mesa(), pmat, 18, rng, { radius: 800, lines, clearance: 120, heightAt: terrain.heightAt, scale: [0.9, 2.2], sink: 0.05 }),
    scatter(cactus(), pmat, Math.round(160 * k), rng, { radius: 600, lines, clearance: 12, heightAt: terrain.heightAt, scale: [0.8, 1.5], accept: flat, blob: 1.8 }),
    scatter(bush(0x7a6a2a, 0xc0a84a), pmat, Math.round(220 * k), rng, { radius: 600, lines, clearance: 10, heightAt: terrain.heightAt, scale: [0.6, 1.2], blob: 2.2 }),
    scatter(flowerClump(), pmat, Math.round(400 * k), rng, {
      radius: 450, lines, clearance: 10, near: 40, heightAt: terrain.heightAt, scale: [0.9, 1.4], accept: flat,
      tints: [0xffd23b, 0xff8a3b, 0xff5a5a, 0xffffff],
    }),
    scatter(rockGeometry(31), new THREE.MeshStandardMaterial({ color: 0xb8653a, roughness: 1, flatShading: true }), Math.round(200 * k), rng, {
      radius: 650, lines, clearance: 11, heightAt: terrain.heightAt, scale: [0.8, 3.5], sink: 0.4, tilt: 0.6,
    }),
  );
  const clouds = new Clouds({ count: Math.round(28 * Math.max(k, 0.5)), radius: [400, 900], height: [160, 260], top: 0xfff0e0, belly: 0xe09a90, seed: 55 });
  group.add(clouds.group);
  group.add(mountainRing(1400, 0x9a4a2a, false, 6));

  const sky = new SkyDome(SUNRISE.sky);
  sky.setSun(new THREE.Vector3(-70, 22, 40), 0xffd8a8, 1.0, 0.9993);
  group.add(sky.mesh);
  applyLighting(renderer, SUNRISE);
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
