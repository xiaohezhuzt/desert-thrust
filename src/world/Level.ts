import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { LevelDef } from '../config/levels';
import { disposeObject } from '../core/dispose';
import type { Physics } from '../core/Physics';
import type { Renderer } from '../core/Renderer';
import { buildCanyon } from './biomes/Canyon';
import { buildCoast } from './biomes/Coast';
import type { Biome, BiomeContext } from './biomes/common';
import { buildDesert } from './biomes/Desert';
import { buildMountain } from './biomes/Mountain';
import { buildCity } from './biomes/City';
import { buildSnow } from './biomes/Snow';
import { buildStunt, type BuiltStunt, type StuntContext } from './StuntPieces';
import type { TerrainPad } from './Terrain';
import { buildRoads, toVec } from './TrackBuilder';
import { buildTrackDressing, type DressingStyle, type TrackDressing } from './TrackDressing';

/** Racing line sampled every metre with cumulative distance. */
export interface TrackLine {
  readonly points: THREE.Vector3[];
  readonly distances: number[];
  readonly length: number;
}

export type Hazard = 'fall' | 'deepWater' | 'shallowWater' | null;

const FESTIVE = [0xe8322c, 0xffd21f, 0x2f8cff, 0x3fc35a, 0xffffff, 0xff7ad9];

/** Trackside dressing colours per biome. */
const DRESSING: Record<LevelDef['biome'], DressingStyle> = {
  desert: { verge: 0xe2c08a, kerbA: 0xe8322c, kerbB: 0xf7f3ea, festive: FESTIVE, lights: true },
  coast: { verge: 0x7cc451, kerbA: 0xe8322c, kerbB: 0xffffff, festive: FESTIVE },
  mountain: { verge: 0x63a33f, kerbA: 0xe8322c, kerbB: 0xffffff, festive: FESTIVE },
  snow: { verge: 0xf1f5fa, kerbA: 0xd8262b, kerbB: 0xffffff, festive: [0xff3b3b, 0x3bff7a, 0xffd23b, 0x3bb4ff], lights: true },
  canyon: { verge: 0xe0ab6f, kerbA: 0xe8322c, kerbB: 0xffffff, festive: FESTIVE },
  city: { verge: 0xb9b5ad, kerbA: 0x3b3e43, kerbB: 0xf2f2ee, festive: FESTIVE, urban: true },
};

const BIOMES: Record<LevelDef['biome'], (ctx: BiomeContext) => Biome> = {
  desert: buildDesert,
  coast: buildCoast,
  mountain: buildMountain,
  snow: buildSnow,
  canyon: buildCanyon,
  city: buildCity,
};

/** A level built from its data: biome, roads, stunt pieces, racing line, hazards. */
export class Level {
  readonly group = new THREE.Group();
  readonly line: TrackLine;
  readonly spawn: THREE.Vector3;
  readonly spawnHeading: number;
  private readonly colliders: RAPIER.Collider[] = [];
  private readonly stunts: BuiltStunt[] = [];
  private readonly biome: Biome;
  private readonly dressing: TrackDressing;

  constructor(
    readonly def: LevelDef,
    private readonly physics: Physics,
    renderer: Renderer,
  ) {
    this.group.name = `level-${def.id}`;

    const roads = buildRoads(def.roads, physics, renderer.maxAnisotropy);
    this.group.add(roads.group);
    this.colliders.push(...roads.colliders);

    for (const stunt of def.stunts) {
      const built = buildStunt(stunt, physics);
      this.group.add(built.group);
      this.colliders.push(...built.colliders);
      this.stunts.push(built);
    }

    // Level the ground under ground-standing stunt structures.
    const pads: TerrainPad[] = def.stunts
      .filter((s) => s.type === 'carRow' || s.type === 'invertedHalfLoop' || s.type === 'fullLoop' || s.type === 'wallRide')
      .map((s) => ({ x: s.position[0], z: s.position[2], y: s.position[1], r: s.type === 'carRow' ? 22 : 30 }));

    this.biome = BIOMES[def.biome]({
      physics,
      renderer,
      def,
      roads: roads.terrainRoads,
      allLines: roads.centerLines,
      pads,
      carves: def.carves ?? [],
    });
    this.group.add(this.biome.group);
    this.colliders.push(...this.biome.colliders);

    this.dressing = buildTrackDressing(def, roads.centerLines, DRESSING[def.biome], renderer.currentQuality.tier);
    this.group.add(this.dressing.group);

    // Roads and most stunt pieces never move: skip per-frame matrix updates for them.
    const freeze = (o: THREE.Object3D): void =>
      o.traverse((c) => {
        c.updateMatrix();
        c.matrixAutoUpdate = false;
      });
    freeze(roads.group);
    this.stunts.forEach((st, i) => {
      if (def.stunts[i]!.type !== 'rockfall') freeze(st.group);
    });

    const curve = new THREE.CatmullRomCurve3(def.trackSpline.map(toVec), false, 'centripetal');
    const pts = curve.getSpacedPoints(Math.max(2, Math.ceil(curve.getLength())));
    const distances = [0];
    for (let i = 1; i < pts.length; i++) distances.push(distances[i - 1]! + pts[i]!.distanceTo(pts[i - 1]!));
    this.line = { points: pts, distances, length: distances[distances.length - 1]! };

    this.spawn = toVec(def.start.position);
    this.spawnHeading = def.start.heading;
  }

  heightAt(x: number, z: number): number {
    return this.biome.heightAt(x, z);
  }

  /** Is the car at `p` lost (fell / sank) or wading? */
  hazardAt(p: THREE.Vector3): Hazard {
    const d = this.def;
    if (d.killY !== undefined && p.y < d.killY) return 'fall';
    for (const k of d.killZones ?? []) {
      if (p.y < k.belowY && Math.hypot(p.x - k.center[0], p.z - k.center[1]) < k.radius) return 'fall';
    }
    if (d.waterLevel !== undefined && p.y < d.waterLevel + 0.5) {
      const depth = d.waterLevel - this.biome.heightAt(p.x, p.z);
      if (depth > 1.3 && p.y < d.waterLevel - 0.2) return 'deepWater';
      if (depth > 0.05) return 'shallowWater';
    }
    return null;
  }

  /** Depth of water at a point (0 if dry or no sea). */
  waterDepthAt(x: number, z: number): number {
    if (this.def.waterLevel === undefined) return 0;
    return Math.max(0, this.def.waterLevel - this.biome.heightAt(x, z));
  }

  update(dt: number, elapsed: number, camera: THREE.PerspectiveCamera, ctx?: StuntContext): void {
    this.biome.update(dt, elapsed, camera);
    this.dressing.update(dt);
    if (ctx) for (const s of this.stunts) s.update?.(dt, ctx);
  }

  /** Release GPU resources and physics colliders (iOS memory is tight). */
  dispose(): void {
    for (const s of this.stunts) s.dispose?.();
    this.physics.removeColliders(this.colliders);
    this.colliders.length = 0;
    this.biome.dispose();
    this.dressing.dispose();
    disposeObject(this.group);
  }
}
