import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { RoadDef, RoadStyle, Vec3 } from '../config/levels';
import type { Surface } from '../config/tuning';
import type { Physics } from '../core/Physics';
import type { TerrainRoad } from './Terrain';
import { roadTexture } from './Textures';

const SAMPLE_STEP = 3;
/** Road surface sits this far above its centre-line height. */
const ROAD_LIFT = 0.04;
const BARRIER_HEIGHT = 1.0;
const DECK_DEPTH = 1.3;
const PILLAR_SPACING = 32;

const STYLE_SURFACE: Record<RoadStyle, Surface> = {
  asphalt: 'asphalt',
  wet: 'wet',
  dirt: 'dirt',
  snow: 'snow',
  ice: 'ice',
  wood: 'asphalt',
  sand: 'hardSand',
};

export function toVec(v: Vec3): THREE.Vector3 {
  return new THREE.Vector3(v[0], v[1], v[2]);
}

export function roadCurve(road: RoadDef): THREE.CatmullRomCurve3 {
  return new THREE.CatmullRomCurve3(road.points.map(toVec), false, 'centripetal');
}

/** Sample a curve every ~SAMPLE_STEP metres. */
export function sampleCurve(curve: THREE.Curve<THREE.Vector3>, step = SAMPLE_STEP): THREE.Vector3[] {
  const n = Math.max(2, Math.ceil(curve.getLength() / step));
  return curve.getSpacedPoints(n);
}

export interface BuiltRoads {
  readonly group: THREE.Group;
  readonly colliders: RAPIER.Collider[];
  /** Ground-level roads, for terrain flattening. */
  readonly terrainRoads: TerrainRoad[];
  /** All sampled centre lines (including elevated decks). */
  readonly centerLines: THREE.Vector3[][];
}

function roadMaterial(style: RoadStyle, maxAnisotropy: number): THREE.MeshStandardMaterial {
  const tex = roadTexture(style);
  tex.anisotropy = maxAnisotropy;
  const wet = style === 'wet';
  return new THREE.MeshStandardMaterial({
    map: tex,
    color: wet ? 0x8a8f99 : 0xffffff,
    roughness: wet ? 0.12 : style === 'ice' ? 0.08 : style === 'snow' ? 0.9 : 0.78,
    metalness: wet ? 0.35 : style === 'ice' ? 0.2 : 0,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

/** Ribbon roads (flat across, following the centre-line height), optional decks and barriers. */
export function buildRoads(roads: readonly RoadDef[], physics: Physics, maxAnisotropy: number): BuiltRoads {
  const group = new THREE.Group();
  group.name = 'roads';
  const colliders: RAPIER.Collider[] = [];
  const terrainRoads: TerrainRoad[] = [];
  const centerLines: THREE.Vector3[][] = [];
  const mats = new Map<RoadStyle, THREE.MeshStandardMaterial>();
  const concrete = new THREE.MeshStandardMaterial({ color: 0x8c8e93, roughness: 0.85 });
  const rail = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.35, metalness: 0.7 });

  for (const road of roads) {
    const style = road.style ?? 'asphalt';
    let mat = mats.get(style);
    if (!mat) mats.set(style, (mat = roadMaterial(style, maxAnisotropy)));
    const pts = sampleCurve(roadCurve(road));
    centerLines.push(pts);
    if (!road.elevated) {
      terrainRoads.push({ points: pts, flat: road.terrainFlat ?? 40, blend: road.terrainBlend ?? 120 });
    }

    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const lefts: THREE.Vector3[] = [];
    const rights: THREE.Vector3[] = [];
    const tangent = new THREE.Vector3();
    const right = new THREE.Vector3();
    let dist = 0;
    const hw = road.width / 2;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      const a = pts[Math.max(i - 1, 0)]!;
      const b = pts[Math.min(i + 1, pts.length - 1)]!;
      tangent.subVectors(b, a).setY(0).normalize();
      right.set(-tangent.z, 0, tangent.x);
      if (i > 0) dist += p.distanceTo(pts[i - 1]!);
      const l = new THREE.Vector3(p.x - right.x * hw, p.y + ROAD_LIFT, p.z - right.z * hw);
      const r = new THREE.Vector3(p.x + right.x * hw, p.y + ROAD_LIFT, p.z + right.z * hw);
      lefts.push(l);
      rights.push(r);
      pos.push(l.x, l.y, l.z, r.x, r.y, r.z);
      const v = dist / road.width;
      uv.push(0, v, 1, v);
      if (i > 0) {
        const k = (i - 1) * 2;
        idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    group.add(mesh);

    const c = physics.world.createCollider(
      physics.R.ColliderDesc.trimesh(new Float32Array(pos), new Uint32Array(idx)).setFriction(0.9),
    );
    physics.setSurface(c, STYLE_SURFACE[style]);
    colliders.push(c);

    if (road.elevated) group.add(buildDeck(lefts, rights, pts, concrete));
    if (road.barriers) {
      const built = buildBarriers(lefts, rights, physics, style === 'wood' ? rail : concrete);
      group.add(built.mesh);
      colliders.push(built.collider);
    }
  }
  return { group, colliders, terrainRoads, centerLines };
}

/** Side skirts, underside and pillars for an elevated road. */
function buildDeck(
  lefts: readonly THREE.Vector3[],
  rights: readonly THREE.Vector3[],
  centre: readonly THREE.Vector3[],
  mat: THREE.Material,
): THREE.Mesh {
  const pos: number[] = [];
  const idx: number[] = [];
  const strip = (top: readonly THREE.Vector3[], outward: number): void => {
    const base = pos.length / 3;
    for (const p of top) pos.push(p.x, p.y - 0.02, p.z, p.x, p.y - DECK_DEPTH, p.z);
    for (let i = 0; i < top.length - 1; i++) {
      const k = base + i * 2;
      if (outward > 0) idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      else idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  };
  strip(lefts, -1);
  strip(rights, 1);
  // Underside.
  const base = pos.length / 3;
  for (let i = 0; i < lefts.length; i++) {
    const l = lefts[i]!;
    const r = rights[i]!;
    pos.push(l.x, l.y - DECK_DEPTH, l.z, r.x, r.y - DECK_DEPTH, r.z);
    if (i > 0) {
      const k = base + (i - 1) * 2;
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }
  const geos: THREE.BufferGeometry[] = [];
  const deck = new THREE.BufferGeometry();
  deck.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  deck.setIndex(idx);
  geos.push(deck.toNonIndexed());
  let acc = 0;
  for (let i = 1; i < centre.length; i++) {
    acc += centre[i]!.distanceTo(centre[i - 1]!);
    if (acc < PILLAR_SPACING) continue;
    acc = 0;
    const p = centre[i]!;
    const h = p.y - DECK_DEPTH + 30;
    geos.push(new THREE.CylinderGeometry(0.9, 1.1, h, 10).translate(p.x, p.y - DECK_DEPTH - h / 2, p.z).toNonIndexed());
  }
  for (const g of geos) {
    for (const name of Object.keys(g.attributes)) if (name !== 'position') g.deleteAttribute(name);
  }
  const merged = mergeGeometries(geos) ?? new THREE.BufferGeometry();
  merged.computeVertexNormals();
  geos.forEach((g) => g.dispose());
  const mesh = new THREE.Mesh(merged, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Low walls along both edges, with a matching trimesh collider. */
function buildBarriers(
  lefts: readonly THREE.Vector3[],
  rights: readonly THREE.Vector3[],
  physics: Physics,
  mat: THREE.Material,
): { mesh: THREE.Mesh; collider: RAPIER.Collider } {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const edge of [lefts, rights]) {
    const base = pos.length / 3;
    for (const p of edge) pos.push(p.x, p.y - 0.05, p.z, p.x, p.y + BARRIER_HEIGHT, p.z);
    for (let i = 0; i < edge.length - 1; i++) {
      const k = base + i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const m = (mat as THREE.MeshStandardMaterial).clone();
  m.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(geo, m);
  mesh.castShadow = true;
  const collider = physics.world.createCollider(
    physics.R.ColliderDesc.trimesh(new Float32Array(pos), new Uint32Array(idx)).setFriction(0.2),
  );
  physics.setSurface(collider, 'asphalt');
  return { mesh, collider };
}

/** Distance in the XZ plane from (x, z) to the nearest sampled centre line. */
export function distanceToLines(lines: readonly THREE.Vector3[][], x: number, z: number): number {
  let best = Infinity;
  for (const line of lines) {
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i]!;
      const b = line[i + 1]!;
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const len2 = abx * abx + abz * abz || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / len2));
      const dx = a.x + abx * t - x;
      const dz = a.z + abz * t - z;
      const d = dx * dx + dz * dz;
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best);
}
