import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Chunky, stylized prop geometry (vertex-coloured, merged, ready for instancing).
 * Shapes lean toward a bright kart-racer look: round canopies, fat trunks,
 * soft colour gradients that fake ambient occlusion.
 */

type Paint = (y: number, out: THREE.Color) => void;

function painted(g: THREE.BufferGeometry, paint: Paint): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  if (n !== g) g.dispose();
  n.deleteAttribute('uv');
  const pos = n.getAttribute('position') as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    paint(pos.getY(i), c);
    col.set([c.r, c.g, c.b], i * 3);
  }
  n.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return n;
}

function solid(color: THREE.ColorRepresentation): Paint {
  const c = new THREE.Color(color);
  return (_y, out) => out.copy(c);
}

function gradient(bottom: THREE.ColorRepresentation, top: THREE.ColorRepresentation, y0: number, y1: number): Paint {
  const a = new THREE.Color(bottom);
  const b = new THREE.Color(top);
  return (y, out) => out.copy(a).lerp(b, THREE.MathUtils.smoothstep(y, y0, y1));
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // Keep each part's own smooth normals (recomputing on merged non-indexed data would facet them).
  const g = mergeGeometries(parts) ?? new THREE.BufferGeometry();
  parts.forEach((p) => p.dispose());
  return g;
}

/** Deterministic little jitter for organic shapes. */
function jitter(g: THREE.BufferGeometry, amount: number, seed: number): THREE.BufferGeometry {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  let s = seed;
  const rnd = (): number => ((s = (s * 16807) % 2147483647) / 2147483647) - 0.5;
  const map = new Map<string, [number, number, number]>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    let d = map.get(key);
    if (!d) map.set(key, (d = [rnd() * amount, rnd() * amount, rnd() * amount]));
    pos.setXYZ(i, pos.getX(i) + d[0], pos.getY(i) + d[1], pos.getZ(i) + d[2]);
  }
  return g;
}

/** Round "lollipop" broadleaf tree: fat trunk, three overlapping canopy balls. */
export function roundTree(leafDark: number, leafLight: number, seed = 1): THREE.BufferGeometry {
  const trunk = painted(new THREE.CylinderGeometry(0.45, 0.7, 4.2, 8).translate(0, 2.1, 0), gradient(0x4a2f1c, 0x7a5232, 0, 4));
  const leaf = gradient(leafDark, leafLight, 3.5, 9.5);
  const balls = [
    [0, 6.4, 0, 3.3],
    [1.8, 5.4, 0.6, 2.4],
    [-1.6, 5.6, -0.8, 2.5],
    [0.3, 8.0, -0.2, 2.2],
  ].map(([x, y, z, r]) => painted(jitter(new THREE.IcosahedronGeometry(r!, 1), 0.3, seed++).translate(x!, y!, z!), leaf));
  return merge([trunk, ...balls]);
}

/** Tall cone conifer with drooping tiers (optionally snow-capped). */
export function tierPine(snowy: boolean): THREE.BufferGeometry {
  const parts = [painted(new THREE.CylinderGeometry(0.3, 0.5, 3, 7).translate(0, 1.5, 0), solid(0x4a3426))];
  const tiers: [number, number, number][] = [
    [3.6, 4.2, 3.6],
    [3.0, 3.8, 6.0],
    [2.3, 3.4, 8.2],
    [1.5, 3.0, 10.2],
  ];
  for (const [r, h, y] of tiers) {
    const paint = snowy ? gradient(0x2f5141, 0xf1f6fb, y - 0.6, y + h * 0.35) : gradient(0x1f4a2a, 0x4f8a3e, y - h / 2, y + h / 2);
    parts.push(painted(new THREE.ConeGeometry(r, h, 9).translate(0, y, 0), paint));
  }
  return merge(parts);
}

/** Saguaro cactus with two arms. */
export function cactus(): THREE.BufferGeometry {
  const paint = gradient(0x2f6b34, 0x6db04f, 0, 7);
  const parts = [
    painted(new THREE.CapsuleGeometry(0.75, 5.5, 4, 10).translate(0, 3.5, 0), paint),
    painted(new THREE.CapsuleGeometry(0.5, 2.2, 4, 8).translate(1.6, 4.4, 0), paint),
    painted(new THREE.CapsuleGeometry(0.45, 1.2, 4, 8).rotateZ(Math.PI / 2).translate(0.95, 3.4, 0), paint),
    painted(new THREE.CapsuleGeometry(0.45, 1.8, 4, 8).translate(-1.5, 3.6, 0), paint),
    painted(new THREE.CapsuleGeometry(0.4, 1.0, 4, 8).rotateZ(Math.PI / 2).translate(-0.85, 2.9, 0), paint),
  ];
  return merge(parts);
}

/** Low rounded shrub. */
export function bush(dark: number, light: number, seed = 3): THREE.BufferGeometry {
  const paint = gradient(dark, light, 0, 2.4);
  const parts = [
    [0, 1.0, 0, 1.4],
    [1.1, 0.8, 0.3, 1.0],
    [-1.0, 0.8, -0.2, 1.1],
    [0.2, 1.6, -0.3, 0.9],
  ].map(([x, y, z, r]) => painted(jitter(new THREE.IcosahedronGeometry(r!, 1), 0.2, seed++).translate(x!, y!, z!), paint));
  return merge(parts);
}

/** A small clump of flowers (white heads; per-instance colour tints them). */
export function flowerClump(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const spots = [
    [0, 0],
    [0.5, 0.3],
    [-0.4, 0.4],
    [0.2, -0.5],
    [-0.5, -0.3],
  ];
  for (const [x, z] of spots) {
    const h = 0.5 + ((x! * 7 + z! * 3) % 0.3);
    parts.push(painted(new THREE.CylinderGeometry(0.04, 0.05, h, 4).translate(x!, h / 2, z!), solid(0x3f7d34)));
    parts.push(painted(new THREE.IcosahedronGeometry(0.17, 0).translate(x!, h + 0.08, z!), solid(0xffffff)));
  }
  return merge(parts);
}

/** Grass tuft: a fan of thin blades. */
export function grassTuft(dark: number, light: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 7; k++) {
    const blade = new THREE.ConeGeometry(0.09, 0.9 + (k % 3) * 0.25, 3);
    blade.translate(0, 0.45, 0);
    blade.rotateZ(((k / 6) - 0.5) * 0.9);
    blade.rotateY(k * 2.1);
    parts.push(painted(blade, gradient(dark, light, 0, 1)));
  }
  return merge(parts);
}

/** Classic three-ball snowman with a carrot nose and coal eyes. */
export function snowman(): THREE.BufferGeometry {
  const white = gradient(0xc8d6ea, 0xffffff, 0, 3.5);
  return merge([
    painted(new THREE.IcosahedronGeometry(1.3, 2).translate(0, 1.2, 0), white),
    painted(new THREE.IcosahedronGeometry(0.95, 2).translate(0, 2.9, 0), white),
    painted(new THREE.IcosahedronGeometry(0.68, 2).translate(0, 4.2, 0), white),
    painted(new THREE.ConeGeometry(0.12, 0.6, 6).rotateX(Math.PI / 2).translate(0, 4.2, 0.85), solid(0xff7a1a)),
    painted(new THREE.SphereGeometry(0.08, 6, 4).translate(0.25, 4.45, 0.6), solid(0x111111)),
    painted(new THREE.SphereGeometry(0.08, 6, 4).translate(-0.25, 4.45, 0.6), solid(0x111111)),
    painted(new THREE.CylinderGeometry(0.55, 0.55, 0.6, 12).translate(0, 4.95, 0), solid(0x1a1a22)),
    painted(new THREE.CylinderGeometry(0.85, 0.85, 0.08, 12).translate(0, 4.65, 0), solid(0x1a1a22)),
  ]);
}

/** Beach umbrella (white canopy, tinted per instance) with a pole. */
export function umbrella(): THREE.BufferGeometry {
  return merge([
    painted(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6).translate(0, 1.3, 0), solid(0xeeeeee)),
    painted(new THREE.ConeGeometry(1.6, 0.7, 10, 1, true).translate(0, 2.7, 0), solid(0xffffff)),
  ]);
}

/** Layered sandstone mesa (flat top, banded colours). */
export function mesa(): THREE.BufferGeometry {
  const bands = [0xb4532c, 0xd98a4f, 0xc66a3a, 0xe3a15e];
  const parts: THREE.BufferGeometry[] = [];
  let y = 0;
  let r = 20;
  for (let k = 0; k < 4; k++) {
    const h = 7 + k * 1.5;
    parts.push(painted(jitter(new THREE.CylinderGeometry(r * 0.94, r, h, 9, 2), 1.2, 40 + k).translate(0, y + h / 2, 0), solid(bands[k]!)));
    y += h;
    r *= 0.9;
  }
  return merge(parts);
}

/** Material for all vertex-coloured props (instance colour multiplies vertex colour). */
export function propMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: false });
}
