import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LevelDef } from '../../config/levels';
import type { Physics } from '../../core/Physics';
import type { Renderer } from '../../core/Renderer';
import type { SkyColors } from '../Sky';
import type { TerrainCarve, TerrainPad, TerrainRoad } from '../Terrain';

export interface BiomeContext {
  readonly physics: Physics;
  readonly renderer: Renderer;
  readonly def: LevelDef;
  readonly roads: readonly TerrainRoad[];
  /** all road centre lines incl. elevated, for keeping props off the course */
  readonly allLines: readonly THREE.Vector3[][];
  readonly pads: readonly TerrainPad[];
  readonly carves: readonly TerrainCarve[];
}

export interface Biome {
  readonly group: THREE.Group;
  readonly colliders: RAPIER.Collider[];
  heightAt(x: number, z: number): number;
  update(dt: number, elapsed: number, camera: THREE.PerspectiveCamera): void;
  dispose(): void;
}

export interface LightingPreset {
  readonly sky: SkyColors;
  readonly fog: number;
  readonly sunColor: number;
  readonly sunIntensity: number;
  readonly hemiSky: number;
  readonly hemiGround: number;
  readonly hemiIntensity: number;
  readonly envIntensity: number;
}

export function applyLighting(renderer: Renderer, l: LightingPreset): void {
  renderer.setFog(l.fog);
  renderer.sun.color.set(l.sunColor);
  renderer.sun.intensity = l.sunIntensity;
  renderer.hemi.color.set(l.hemiSky);
  renderer.hemi.groundColor.set(l.hemiGround);
  renderer.hemi.intensity = l.hemiIntensity;
  renderer.scene.environmentIntensity = l.envIntensity;
}

/** Strip to position+normal and merge (for instancing variety pieces). */
export function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const clean = parts.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(n.attributes)) if (name !== 'position' && name !== 'normal') n.deleteAttribute(name);
    return n;
  });
  const merged = mergeGeometries(clean) ?? new THREE.BufferGeometry();
  parts.forEach((g) => g.dispose());
  clean.forEach((g) => g.dispose());
  return merged;
}

/** Nearest distance (XZ) to any line, cheap enough for scattering a few hundred props. */
export function distToLines(lines: readonly THREE.Vector3[][], x: number, z: number, stride = 2): number {
  let best = Infinity;
  for (const line of lines) {
    for (let i = 0; i < line.length; i += stride) {
      const p = line[i]!;
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best);
}

/**
 * Scatter `count` instances of `geo` with random scale/rotation, keeping `clearance`
 * metres from the course. Positions come from `rng` within `radius` of the origin.
 */
export function scatter(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  count: number,
  rng: () => number,
  o: {
    radius: number;
    center?: readonly [number, number];
    lines: readonly THREE.Vector3[][];
    clearance: number;
    heightAt: (x: number, z: number) => number;
    scale: [number, number];
    accept?: (x: number, z: number, h: number) => boolean;
    sink?: number;
    tilt?: number;
    /** only place within this distance of the course (keeps detail where the camera is) */
    near?: number;
    /** random per-instance tints (multiply the vertex colours) */
    tints?: readonly number[];
    /** soft blob shadow radius under each instance (unscaled metres); props don't cast real shadows */
    blob?: number;
  },
): THREE.Object3D {
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  let placed = 0;
  for (let tries = 0; placed < count && tries < count * 12; tries++) {
    const x = (o.center?.[0] ?? 0) + (rng() * 2 - 1) * o.radius;
    const z = (o.center?.[1] ?? 0) + (rng() * 2 - 1) * o.radius;
    const dl = distToLines(o.lines, x, z);
    if (dl < o.clearance || (o.near !== undefined && dl > o.near)) continue;
    const h = o.heightAt(x, z);
    if (o.accept && !o.accept(x, z, h)) continue;
    const s = o.scale[0] + rng() * (o.scale[1] - o.scale[0]);
    dummy.position.set(x, h - (o.sink ?? 0) * s, z);
    dummy.rotation.set((rng() - 0.5) * (o.tilt ?? 0), rng() * Math.PI * 2, (rng() - 0.5) * (o.tilt ?? 0));
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    if (o.tints) mesh.setColorAt(placed, tint.set(o.tints[Math.floor(rng() * o.tints.length)]!));
    mesh.setMatrixAt(placed++, dummy.matrix);
  }
  mesh.count = placed;
  // Real shadow maps would render every instance again; a blob under each is far cheaper.
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  if (!o.blob || placed === 0) return mesh;
  const group = new THREE.Group();
  group.add(mesh);
  const blobs = new THREE.InstancedMesh(blobGeometry(), blobMaterial(), placed);
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  for (let i = 0; i < placed; i++) {
    mesh.getMatrixAt(i, m);
    m.decompose(p, q, sc);
    const r = o.blob * sc.x;
    m.compose(p.setY(p.y + 0.06), new THREE.Quaternion(), new THREE.Vector3(r, 1, r));
    blobs.setMatrixAt(i, m);
  }
  blobs.renderOrder = 1;
  group.add(blobs);
  return group;
}

/** Simple conifer: trunk + three stacked cones, vertex-coloured. */
export function pineGeometry(snowy: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const colorise = (g: THREE.BufferGeometry, c: THREE.Color): THREE.BufferGeometry => {
    const n = g.toNonIndexed();
    const col = new Float32Array(n.getAttribute('position').count * 3);
    for (let i = 0; i < col.length; i += 3) col.set([c.r, c.g, c.b], i);
    n.setAttribute('color', new THREE.BufferAttribute(col, 3));
    n.deleteAttribute('uv');
    g.dispose();
    return n;
  };
  parts.push(colorise(new THREE.CylinderGeometry(0.25, 0.35, 3, 6).translate(0, 1.5, 0), new THREE.Color(0x4a3426)));
  const green = new THREE.Color(snowy ? 0x3d5a4c : 0x2f5a34);
  const white = new THREE.Color(0xeef3f8);
  [
    [3.2, 5, 3.5],
    [2.6, 4.2, 6],
    [1.8, 3.4, 8.2],
  ].forEach(([r, h, y], i) => {
    parts.push(colorise(new THREE.ConeGeometry(r!, h!, 7).translate(0, y!, 0), snowy && i === 2 ? white : green));
  });
  const merged = mergeGeometries(parts) ?? new THREE.BufferGeometry();
  parts.forEach((g) => g.dispose());
  merged.computeVertexNormals();
  return merged;
}

/** Leaning palm: segmented trunk and drooping fronds. */
export function palmGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.Color(0x8a6a48);
  const leaf = new THREE.Color(0x3f7f3a);
  const add = (g: THREE.BufferGeometry, c: THREE.Color): void => {
    const n = g.toNonIndexed();
    const col = new Float32Array(n.getAttribute('position').count * 3);
    for (let i = 0; i < col.length; i += 3) col.set([c.r, c.g, c.b], i);
    n.setAttribute('color', new THREE.BufferAttribute(col, 3));
    n.deleteAttribute('uv');
    g.dispose();
    parts.push(n);
  };
  let x = 0;
  let y = 0;
  for (let k = 0; k < 6; k++) {
    const seg = new THREE.CylinderGeometry(0.22 - k * 0.015, 0.26 - k * 0.015, 1.6, 6);
    seg.rotateZ(-0.05 * k);
    seg.translate(x, y + 0.8, 0);
    add(seg, trunk);
    x += 0.08 * k;
    y += 1.55;
  }
  for (let k = 0; k < 7; k++) {
    const f = new THREE.PlaneGeometry(0.9, 3.4, 1, 3);
    const p = f.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setZ(i, -((p.getY(i) + 1.7) ** 2) * 0.12);
    f.rotateX(-Math.PI / 2 + 0.3);
    f.translate(0, 0, 1.7);
    f.rotateY((k / 7) * Math.PI * 2);
    f.translate(x, y, 0);
    add(f, leaf);
  }
  const merged = mergeGeometries(parts) ?? new THREE.BufferGeometry();
  parts.forEach((g) => g.dispose());
  merged.computeVertexNormals();
  return merged;
}

/** Faceted boulder, slightly squashed. */
export function rockGeometry(seed: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  let s = seed;
  const rnd = (): number => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < p.count; i++) {
    const k = 0.75 + rnd() * 0.5;
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.7, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

/** Far-away mountain ring (no collision) so horizons have silhouettes. */
export function mountainRing(radius: number, color: number, snowCap: boolean, seed: number): THREE.Mesh {
  const parts: THREE.BufferGeometry[] = [];
  let s = seed;
  const rnd = (): number => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 28; k++) {
    const a = (k / 28) * Math.PI * 2 + rnd() * 0.1;
    const h = 120 + rnd() * 220;
    const r = 140 + rnd() * 160;
    const cone = new THREE.ConeGeometry(r, h, 7, 3);
    cone.translate(Math.cos(a) * radius, h / 2 - 20, Math.sin(a) * radius);
    parts.push(cone);
  }
  const geo = mergeParts(parts);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const base = new THREE.Color(color);
  const snow = new THREE.Color(0xf2f5fa);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    c.copy(base);
    if (snowCap && pos.getY(i) > 140) c.copy(snow);
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, fog: true }));
  mesh.name = 'mountain-ring';
  return mesh;
}

/** Prop density multiplier per quality tier. */
export function density(ctx: BiomeContext): number {
  const t = ctx.renderer.currentQuality.tier;
  return t === 'low' ? 0.35 : t === 'medium' ? 0.7 : 1;
}

/** Two-tone ground: blend `a`→`b` by large soft noise patches. */
export function patchy(
  noise: (x: number, z: number) => number,
  a: THREE.Color,
  b: THREE.Color,
  x: number,
  z: number,
  out: THREE.Color,
  scale = 60,
): THREE.Color {
  const n = noise(x / scale, z / scale) * 0.7 + noise(x / (scale * 0.3) + 11, z / (scale * 0.3)) * 0.3;
  return out.copy(a).lerp(b, THREE.MathUtils.smoothstep(n, 0.3, 0.7));
}

let blobGeo: THREE.BufferGeometry | null = null;
let blobMat: THREE.MeshBasicMaterial | null = null;

/** Unit disc with a radial alpha falloff baked into vertex colours. */
function blobGeometry(): THREE.BufferGeometry {
  if (blobGeo) return blobGeo;
  const g = new THREE.CircleGeometry(1, 20, 0, Math.PI * 2).rotateX(-Math.PI / 2);
  // Ring of vertices at radius 1 fades to transparent; centre stays dark.
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getZ(i));
    col.set([0, 0, 0, r < 0.01 ? 0.45 : 0], i * 4);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  blobGeo = g;
  return g;
}

function blobMaterial(): THREE.MeshBasicMaterial {
  blobMat ??= new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  return blobMat;
}
