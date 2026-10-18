import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { Surface } from '../config/tuning';
import type { Physics } from '../core/Physics';

/** A road centre line the terrain should hug. */
export interface TerrainRoad {
  readonly points: readonly THREE.Vector3[];
  /** fully flat (at road height) within this distance of the centre line */
  readonly flat: number;
  /** blend distance back to the natural landform */
  readonly blend: number;
}

/** Circular area levelled to `y` (stunt bases, plazas). */
export interface TerrainPad {
  readonly x: number;
  readonly z: number;
  readonly y: number;
  readonly r: number;
}

/** Circular depression (ravines under gap jumps, lake beds). */
export interface TerrainCarve {
  readonly x: number;
  readonly z: number;
  readonly r: number;
  readonly depth: number;
}

export interface TerrainOptions {
  readonly halfSize: number;
  readonly cells: number;
  /** natural landform height */
  base(x: number, z: number): number;
  readonly roads: readonly TerrainRoad[];
  readonly pads?: readonly TerrainPad[];
  readonly carves?: readonly TerrainCarve[];
  /** vertex colour from height and slope (0 flat .. 1 vertical) */
  color(h: number, slope: number, out: THREE.Color, x: number, z: number): void;
  readonly texture?: THREE.Texture;
  /** detail normal map, tiled like `texture` */
  readonly normalMap?: THREE.Texture;
  readonly textureMetres?: number;
  readonly roughness?: number;
  surface(h: number, slope: number): Surface;
}

export interface BuiltTerrain {
  readonly mesh: THREE.Mesh;
  readonly collider: RAPIER.Collider;
  /** fast bilinear height lookup from the generated grid */
  heightAt(x: number, z: number): number;
}

/** Nearest point on any line: distance in XZ and the line's height there. */
function nearestOnRoads(roads: readonly TerrainRoad[], x: number, z: number): { mask: number; y: number } {
  let bestMask = 1;
  let bestY = 0;
  for (const road of roads) {
    const pts = road.points;
    let best = Infinity;
    let by = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const len2 = abx * abx + abz * abz || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / len2));
      const dx = a.x + abx * t - x;
      const dz = a.z + abz * t - z;
      const d = dx * dx + dz * dz;
      if (d < best) {
        best = d;
        by = a.y + (b.y - a.y) * t;
      }
    }
    const mask = THREE.MathUtils.smoothstep(Math.sqrt(best), road.flat, road.flat + road.blend);
    if (mask < bestMask) {
      bestMask = mask;
      bestY = by;
    }
  }
  return { mask: bestMask, y: bestY };
}

/**
 * Heightfield terrain as a trimesh: natural landform blended flat under roads
 * and pads, minus carved ravines. Vertex-coloured by height and slope.
 */
export function buildTerrain(physics: Physics, o: TerrainOptions): BuiltTerrain {
  const n = o.cells;
  const size = o.halfSize * 2;
  const step = size / n;
  const heights = new Float32Array((n + 1) * (n + 1));

  const raw = (x: number, z: number): number => {
    let h = o.base(x, z);
    const near = nearestOnRoads(o.roads, x, z);
    h = THREE.MathUtils.lerp(near.y - 0.3, h, near.mask);
    for (const p of o.pads ?? []) {
      const m = THREE.MathUtils.smoothstep(Math.hypot(x - p.x, z - p.z), p.r, p.r + 35);
      h = THREE.MathUtils.lerp(p.y - 0.05, h, m);
    }
    for (const c of o.carves ?? []) {
      const d = Math.hypot(x - c.x, z - c.z);
      h -= c.depth * (1 - THREE.MathUtils.smoothstep(d, c.r * 0.55, c.r));
    }
    return h;
  };

  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      heights[j * (n + 1) + i] = raw(-o.halfSize + i * step, -o.halfSize + j * step);
    }
  }

  const heightAt = (x: number, z: number): number => {
    const fx = THREE.MathUtils.clamp((x + o.halfSize) / step, 0, n - 1e-4);
    const fz = THREE.MathUtils.clamp((z + o.halfSize) / step, 0, n - 1e-4);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const h00 = heights[j * (n + 1) + i]!;
    const h10 = heights[j * (n + 1) + i + 1]!;
    const h01 = heights[(j + 1) * (n + 1) + i]!;
    const h11 = heights[(j + 1) * (n + 1) + i + 1]!;
    return h00 * (1 - u) * (1 - v) + h10 * u * (1 - v) + h01 * (1 - u) * v + h11 * u * v;
  };

  const geo = new THREE.PlaneGeometry(size, size, n, n).rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  // PlaneGeometry rotated: vertex order runs along +X, rows along +Z — same as `heights`.
  for (let k = 0; k < pos.count; k++) pos.setY(k, heights[k]!);
  geo.computeVertexNormals();
  const nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let k = 0; k < pos.count; k++) {
    o.color(heights[k]!, 1 - nrm.getY(k), c, pos.getX(k), pos.getZ(k));
    colors.set([c.r, c.g, c.b], k * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const reps = size / (o.textureMetres ?? 24);
  o.texture?.repeat.set(reps, reps);
  o.normalMap?.repeat.set(reps, reps);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      map: o.texture ?? null,
      normalMap: o.normalMap ?? null,
      normalScale: new THREE.Vector2(1.1, 1.1),
      vertexColors: true,
      roughness: o.roughness ?? 0.95,
    }),
  );
  mesh.receiveShadow = true;
  mesh.name = 'terrain';

  const collider = physics.world.createCollider(
    physics.R.ColliderDesc.trimesh(new Float32Array(pos.array), new Uint32Array(geo.index!.array)).setFriction(0.9),
  );
  physics.setSurface(collider, (_c, x, z) => {
    const h = heightAt(x, z);
    const slope = Math.min(1, Math.abs(heightAt(x + 2, z) - h) / 2 + Math.abs(heightAt(x, z + 2) - h) / 2);
    return o.surface(h, slope);
  });
  return { mesh, collider, heightAt };
}

/** Deterministic smooth value noise. */
export function makeNoise(seed: number): (x: number, z: number) => number {
  let a = seed >>> 0;
  const rand = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const perm = new Float32Array(256).map(() => rand());
  const h = (i: number, j: number): number => perm[((i * 73856093) ^ (j * 19349663)) & 255]!;
  return (x, z) => {
    const i = Math.floor(x);
    const j = Math.floor(z);
    const fx = x - i;
    const fz = z - j;
    const u = fx * fx * (3 - 2 * fx);
    const v = fz * fz * (3 - 2 * fz);
    const p = h(i, j);
    const q = h(i + 1, j);
    const r = h(i, j + 1);
    const s = h(i + 1, j + 1);
    return p + (q - p) * u + (r - p) * v + (p - q - r + s) * u * v;
  };
}

/** Fractal (multi-octave) noise in [0, ~1]. */
export function fbm(noise: (x: number, z: number) => number, x: number, z: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += noise(x * f + o * 17.3, z * f - o * 9.1) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}
