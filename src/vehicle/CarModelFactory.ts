import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import { CAR_TUNING } from '../config/tuning';
import { mergeStaticByMaterial } from '../core/mergeStatic';

export interface WheelRig {
  /** Rotates about Y for steering (front wheels only). */
  readonly pivot: THREE.Object3D;
  /** Rotates about X for rolling. */
  readonly spin: THREE.Object3D;
  readonly front: boolean;
  /** +1 for right-side wheels, -1 for left (their spin node is mirrored). */
  readonly spinSign: number;
}

/** Hidden thruster outlets in car-local space; each points along `dir`. */
export interface Nozzle {
  readonly position: THREE.Vector3;
  readonly dir: THREE.Vector3;
}

export interface CarNozzles {
  /** Rear outlets (boost). */
  readonly rear: readonly Nozzle[];
  /** Underbody outlets (jump / hover). */
  readonly down: readonly Nozzle[];
  /** Side outlets that fire when rolling left / right. */
  readonly left: readonly Nozzle[];
  readonly right: readonly Nozzle[];
}

export interface CarRig {
  readonly root: THREE.Group;
  /** Body sub-group that leans/pitches independently of the wheels. */
  readonly body: THREE.Group;
  readonly wheels: readonly WheelRig[];
  readonly nozzles?: CarNozzles;
}

export interface CarModelOptions {
  paintColor: THREE.ColorRepresentation;
  /** Clearcoat MeshPhysicalMaterial (medium/high tier) vs MeshStandardMaterial. */
  physicalPaint: boolean;
}

// ---------------------------------------------------------------------------
// Faceted loft: the body is a stack of polygon cross-sections joined by flat
// panels, giving the crisp creased surfaces of the reference car.
// Local frame: forward = -Z, up = +Y, right = +X, ground at y = 0.
// ---------------------------------------------------------------------------

/** Half profile (x >= 0) from bottom centre, up the right side, to top centre. */
export interface PolySection {
  readonly z: number;
  readonly pts: readonly (readonly [number, number])[];
}

/**
 * Loft mirrored polygon sections into a closed solid with material groups.
 * `bandMaterial(k)` gives the material index for half-profile segment k (k = 0 is the underside).
 */
export function polyLoft(
  sections: readonly PolySection[],
  bandMaterial: (k: number) => number,
  frontCapMaterial: number,
  rearCapMaterial: number,
): THREE.BufferGeometry {
  const half = sections[0]!.pts.length;
  const ringSize = half + (half - 2);
  const ringOf = (s: PolySection): [number, number][] => {
    const r: [number, number][] = s.pts.map(([x, y]) => [x, y]);
    for (let k = half - 2; k >= 1; k--) r.push([-s.pts[k]![0], s.pts[k]![1]]);
    return r;
  };
  // Segment j of the full ring -> half-profile segment index.
  const segOf = (j: number): number => (j < half - 1 ? j : ringSize - 1 - j);

  const pos: number[] = [];
  for (const s of sections) for (const [x, y] of ringOf(s)) pos.push(x, y, s.z);

  const g = new THREE.BufferGeometry();
  const idx: number[] = [];
  const nSeg = half - 1;
  // Group faces by material: emit all quads of one half-profile segment together.
  const byMat = new Map<number, number[]>();
  const push = (m: number, ...v: number[]): void => {
    let arr = byMat.get(m);
    if (!arr) byMat.set(m, (arr = []));
    arr.push(...v);
  };
  for (let i = 0; i < sections.length - 1; i++) {
    for (let j = 0; j < ringSize; j++) {
      const a = i * ringSize + j;
      const b = i * ringSize + ((j + 1) % ringSize);
      const c = a + ringSize;
      const d = b + ringSize;
      const m = bandMaterial(Math.min(segOf(j), nSeg - 1));
      push(m, a, b, c, b, d, c);
    }
  }
  const cap = (si: number, front: boolean, m: number): void => {
    const start = pos.length / 3;
    let cx = 0;
    let cy = 0;
    for (const [x, y] of ringOf(sections[si]!)) {
      pos.push(x, y, sections[si]!.z);
      cx += x;
      cy += y;
    }
    const center = pos.length / 3;
    pos.push(cx / ringSize, cy / ringSize, sections[si]!.z);
    for (let j = 0; j < ringSize; j++) {
      const a = start + j;
      const b = start + ((j + 1) % ringSize);
      if (front) push(m, center, b, a);
      else push(m, center, a, b);
    }
  };
  cap(0, true, frontCapMaterial);
  cap(sections.length - 1, false, rearCapMaterial);

  for (const [m, arr] of [...byMat.entries()].sort((x, y) => x[0] - y[0])) {
    g.addGroup(idx.length, arr.length, m);
    idx.push(...arr);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Point on half-profile segment `k` of a section stack at (z, u), u in [0,1] along the segment. */
function bandPoint(sections: readonly PolySection[], k: number, z: number, u: number, out: THREE.Vector3): void {
  let i = 0;
  while (i < sections.length - 2 && z > sections[i + 1]!.z) i++;
  const s0 = sections[i]!;
  const s1 = sections[i + 1]!;
  const t = THREE.MathUtils.clamp((z - s0.z) / (s1.z - s0.z), 0, 1);
  const ax = THREE.MathUtils.lerp(s0.pts[k]![0], s1.pts[k]![0], t);
  const ay = THREE.MathUtils.lerp(s0.pts[k]![1], s1.pts[k]![1], t);
  const bx = THREE.MathUtils.lerp(s0.pts[k + 1]![0], s1.pts[k + 1]![0], t);
  const by = THREE.MathUtils.lerp(s0.pts[k + 1]![1], s1.pts[k + 1]![1], t);
  out.set(THREE.MathUtils.lerp(ax, bx, u), THREE.MathUtils.lerp(ay, by, u), z);
}

/**
 * A flat decal patch (window, vent, lamp) lying on band `k`, outlined in (z, u) space
 * by a bottom edge and a top edge, mirrored to both sides.
 */
export function bandPatch(
  sections: readonly PolySection[],
  k: number,
  bottom: readonly (readonly [number, number])[],
  top: readonly (readonly [number, number])[],
  lift: number,
): THREE.BufferGeometry {
  const steps = 14;
  const pos: number[] = [];
  const idx: number[] = [];
  const p = new THREE.Vector3();
  const edge = (pts: readonly (readonly [number, number])[], t: number): [number, number] => {
    const f = t * (pts.length - 1);
    const i = Math.min(Math.floor(f), pts.length - 2);
    const r = f - i;
    return [
      THREE.MathUtils.lerp(pts[i]![0], pts[i + 1]![0], r),
      THREE.MathUtils.lerp(pts[i]![1], pts[i + 1]![1], r),
    ];
  };
  for (const side of [1, -1]) {
    const base = pos.length / 3;
    for (let s = 0; s <= steps; s++) {
      for (const e of [bottom, top]) {
        const [z, u] = edge(e, s / steps);
        bandPoint(sections, k, z, u, p);
        pos.push(side * (p.x + lift), p.y + lift * 0.3, p.z);
      }
    }
    // Pick the winding whose normal faces away from the car's centre line.
    const v = (i: number): THREE.Vector3 => new THREE.Vector3(pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!);
    const a0 = v(base);
    const n = new THREE.Vector3().crossVectors(v(base + 1).sub(a0), v(base + 2).sub(a0));
    const out = new THREE.Vector3(a0.x, a0.y - 0.5, 0);
    const flip = n.dot(out) < 0;
    for (let s = 0; s < steps; s++) {
      const a = base + s * 2;
      if (flip) idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      else idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// VOLT-R: low wedge two-seater with tall faceted front fender pods,
// a recessed hood, a dark wraparound canopy and a big rear wing.
// ---------------------------------------------------------------------------

const WHEEL_R = CAR_TUNING.wheelRadius;
const HALF_BASE = CAR_TUNING.wheelBase / 2;
const FRONT_TRACK = CAR_TUNING.frontTrack;
const REAR_TRACK = CAR_TUNING.rearTrack;

// Half-profile points: P0 bottom centre, P1 sill corner, P2 lower crease (dark/white split),
// P3 widest crease, P4 outer fender ridge, P5 inner fender ridge, P6 hood edge, P7 top centre.
function sec(
  z: number,
  bottom: number,
  sillX: number,
  p2: [number, number],
  p3: [number, number],
  p4: [number, number],
  p5: [number, number],
  p6: [number, number],
  topY: number,
): PolySection {
  return { z, pts: [[0, bottom], [sillX, bottom], p2, p3, p4, p5, p6, [0, topY]] };
}

const BODY: readonly PolySection[] = [
  sec(-2.28, 0.2, 0.78, [0.86, 0.3], [0.9, 0.46], [0.84, 0.62], [0.58, 0.63], [0.5, 0.55], 0.55),
  sec(-2.08, 0.15, 0.88, [0.96, 0.3], [0.99, 0.52], [0.95, 0.84], [0.62, 0.86], [0.54, 0.62], 0.61),
  sec(-HALF_BASE, 0.14, 0.9, [0.98, 0.32], [1.0, 0.56], [0.96, 0.93], [0.66, 0.93], [0.57, 0.68], 0.68),
  sec(-0.82, 0.14, 0.9, [0.98, 0.32], [0.99, 0.56], [0.93, 0.87], [0.72, 0.88], [0.62, 0.76], 0.76),
  sec(0.25, 0.14, 0.88, [0.96, 0.32], [0.97, 0.55], [0.9, 0.79], [0.74, 0.81], [0.6, 0.82], 0.82),
  sec(1.0, 0.14, 0.9, [1.0, 0.34], [1.03, 0.58], [0.98, 0.86], [0.82, 0.88], [0.6, 0.88], 0.88),
  sec(1.65, 0.15, 0.9, [1.02, 0.35], [1.04, 0.6], [1.0, 0.9], [0.85, 0.92], [0.6, 0.92], 0.92),
  sec(2.12, 0.24, 0.86, [0.98, 0.36], [1.0, 0.6], [0.96, 0.88], [0.83, 0.9], [0.6, 0.9], 0.9),
  sec(2.25, 0.32, 0.8, [0.92, 0.38], [0.95, 0.6], [0.92, 0.86], [0.8, 0.88], [0.6, 0.88], 0.88),
];
const NOSE_Z = BODY[0]!.z;
const TAIL_Z = BODY[BODY.length - 1]!.z;

// Canopy half profile: underside centre, base edge, roof edge, roof centre.
function canopySec(z: number, baseX: number, baseY: number, roofX: number, roofY: number): PolySection {
  return { z, pts: [[0, baseY - 0.12], [baseX, baseY], [roofX, roofY], [0, roofY + 0.025]] };
}

const CANOPY: readonly PolySection[] = [
  canopySec(-1.05, 0.58, 0.72, 0.54, 0.74),
  canopySec(-0.5, 0.72, 0.81, 0.6, 1.0),
  canopySec(0.2, 0.75, 0.82, 0.62, 1.14),
  canopySec(0.9, 0.76, 0.86, 0.6, 1.1),
  canopySec(1.6, 0.72, 0.9, 0.56, 0.99),
  canopySec(2.14, 0.62, 0.9, 0.5, 0.92),
];

function createPaint(opts: CarModelOptions): THREE.MeshStandardMaterial {
  const m = createPaintMaterial(opts);
  // Named so the body colour can be changed later (online players pick a colour).
  m.name = 'paint';
  return m;
}

/** Repaint every body-colour material under a car. */
export function setCarPaint(root: THREE.Object3D, color: THREE.ColorRepresentation): void {
  root.traverse((o) => {
    const mats = (o as Partial<THREE.Mesh>).material;
    for (const m of Array.isArray(mats) ? mats : mats ? [mats] : []) {
      if (m.name === 'paint') (m as THREE.MeshStandardMaterial).color.set(color);
    }
  });
}

function createPaintMaterial(opts: CarModelOptions): THREE.MeshStandardMaterial {
  if (opts.physicalPaint) {
    return new THREE.MeshPhysicalMaterial({
      color: opts.paintColor,
      roughness: 0.42,
      metalness: 0.0,
      clearcoat: 0.6,
      clearcoatRoughness: 0.12,
      flatShading: true,
    });
  }
  return new THREE.MeshStandardMaterial({ color: opts.paintColor, roughness: 0.4, metalness: 0.05, flatShading: true });
}

function buildBody(paint: THREE.Material, dark: THREE.Material, wellMat: THREE.Material): THREE.Mesh {
  // Segments 0 (underside) and 1 (sill) are dark; everything above is paint. Nose face is dark.
  const shell = polyLoft(BODY, (k) => (k <= 1 ? 1 : 0), 1, 0);
  const body = new Brush(shell, [paint, dark]);

  // Cut wheel arches; the cut faces take the dark well material.
  const evaluator = new Evaluator();
  evaluator.attributes = ['position', 'normal'];
  evaluator.useGroups = true;
  let result: Brush = body;
  for (const [z, track] of [
    [-HALF_BASE, FRONT_TRACK],
    [HALF_BASE, REAR_TRACK],
  ] as const) {
    for (const side of [-1, 1]) {
      const cutterGeo = new THREE.CylinderGeometry(WHEEL_R + 0.07, WHEEL_R + 0.07, 0.8, 40);
      cutterGeo.rotateZ(Math.PI / 2);
      cutterGeo.deleteAttribute('uv');
      const cutter = new Brush(cutterGeo, wellMat);
      cutter.position.set(side * (track + 0.2), WHEEL_R + 0.03, z);
      cutter.updateMatrixWorld();
      result.updateMatrixWorld();
      result = evaluator.evaluate(result, cutter, SUBTRACTION);
      cutterGeo.dispose();
    }
  }
  shell.dispose();
  const mesh = new THREE.Mesh(result.geometry, result.material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'body';
  return mesh;
}

function buildWheel(front: boolean): { spin: THREE.Group; static: THREE.Group } {
  const width = front ? 0.27 : 0.31;
  const rimR = 0.29;

  // Low-profile tire: lathe of a rounded rectangle cross-section, axis along X.
  const prof: THREE.Vector2[] = [];
  const hw = width / 2;
  const round = 0.035;
  prof.push(new THREE.Vector2(rimR, -hw + 0.01));
  for (let k = 0; k <= 5; k++) {
    const a = -Math.PI / 2 + (k / 5) * (Math.PI / 2);
    prof.push(new THREE.Vector2(WHEEL_R - round + Math.cos(a) * round, -hw + round + Math.sin(a) * round));
  }
  for (let k = 0; k <= 5; k++) {
    const a = (k / 5) * (Math.PI / 2);
    prof.push(new THREE.Vector2(WHEEL_R - round + Math.cos(a) * round, hw - round + Math.sin(a) * round));
  }
  prof.push(new THREE.Vector2(rimR, hw - 0.01));
  const tireGeo = new THREE.LatheGeometry(prof, 40);
  tireGeo.rotateZ(-Math.PI / 2);

  const tireMat = new THREE.MeshStandardMaterial({ color: 0x0f0f10, roughness: 0.92 });
  const coverMat = new THREE.MeshStandardMaterial({ color: 0xe9e9e6, roughness: 0.35, metalness: 0.1 });
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.3, metalness: 0.6 });
  const discMat = new THREE.MeshStandardMaterial({ color: 0x55575c, roughness: 0.45, metalness: 0.9 });

  const spin = new THREE.Group();
  const tire = new THREE.Mesh(tireGeo, tireMat);
  tire.castShadow = true;
  spin.add(tire);

  // White aero cover...
  const cover = new THREE.Mesh(new THREE.CylinderGeometry(rimR, rimR * 0.96, 0.03, 40).rotateZ(Math.PI / 2), coverMat);
  cover.position.x = width * 0.38;
  spin.add(cover);
  const back = new THREE.Mesh(new THREE.CircleGeometry(rimR, 32).rotateY(-Math.PI / 2), bladeMat);
  back.position.x = -width * 0.3;
  spin.add(back);

  // ...with dark twisted star blades cut into it (6 split spokes).
  const blades: THREE.BufferGeometry[] = [];
  const count = 6;
  for (let k = 0; k < count; k++) {
    for (const off of [-0.11, 0.11]) {
      const g = new THREE.BoxGeometry(0.02, rimR - 0.07, 0.026);
      g.translate(0, (rimR - 0.07) / 2 + 0.06, 0);
      g.rotateX(off);
      g.rotateY(0.45);
      g.rotateX((k / count) * Math.PI * 2);
      blades.push(g);
    }
  }
  blades.push(new THREE.CylinderGeometry(0.07, 0.075, 0.025, 6).rotateZ(Math.PI / 2));
  const face = new THREE.Mesh(mergeGeometries(blades) ?? new THREE.BufferGeometry(), bladeMat);
  face.position.x = width * 0.4 + 0.012;
  spin.add(face);
  blades.forEach((g) => g.dispose());

  const stat = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.025, 32).rotateZ(Math.PI / 2), discMat);
  disc.position.x = width * 0.05;
  stat.add(disc);
  return { spin, static: stat };
}

function box(mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

/**
 * Procedural VOLT-R: an original angular two-seat electric hypercar.
 * No logos or text. Local forward is -Z, ground at y = 0.
 */
export function createVoltR(opts: CarModelOptions): CarRig {
  const root = new THREE.Group();
  root.name = 'volt-r';
  const body = new THREE.Group();
  root.add(body);

  const paint = createPaint(opts);
  const dark = new THREE.MeshStandardMaterial({ color: 0x16181c, roughness: 0.55, metalness: 0.2, flatShading: true });
  const wellMat = new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.9 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x06080b,
    roughness: 0.05,
    metalness: 0.3,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    flatShading: true,
  });
  const lamp = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xeaf6ff, emissiveIntensity: 3 });
  const tailLamp = new THREE.MeshStandardMaterial({ color: 0x400008, emissive: 0xff1a2a, emissiveIntensity: 4 });
  const copper = new THREE.MeshStandardMaterial({ color: 0xb87a4b, roughness: 0.3, metalness: 1 });
  const nozzleCore = new THREE.MeshStandardMaterial({ color: 0x050608, roughness: 0.6 });

  const shell = buildBody(paint, dark, wellMat);
  body.add(shell);

  // Canopy: side band is paint (pillars), roof and windscreen are dark glass.
  const canopyGeo = polyLoft(CANOPY, (k) => (k === 2 ? 1 : 0), 1, 1);
  const canopy = new THREE.Mesh(canopyGeo, [paint, glass]);
  canopy.castShadow = true;
  body.add(canopy);

  // Wedge-shaped side windows on the canopy's side band.
  const windowGeo = bandPatch(
    CANOPY,
    1,
    [
      [-0.62, 0.08],
      [1.3, 0.08],
    ],
    [
      [-0.3, 0.88],
      [0.85, 0.9],
    ],
    0.006,
  );
  body.add(new THREE.Mesh(windowGeo, glass));

  // Dark vent on the rear haunch behind the side window.
  const ventGeo = bandPatch(
    BODY,
    3,
    [
      [1.3, 0.15],
      [1.95, 0.15],
    ],
    [
      [1.5, 0.92],
      [1.95, 0.92],
    ],
    0.006,
  );
  body.add(new THREE.Mesh(ventGeo, dark));

  // Headlights: slim lamps tucked under the inner corner of each fender pod.
  const headGeo = bandPatch(
    BODY,
    4,
    [
      [-2.27, 0.55],
      [-2.16, 0.62],
    ],
    [
      [-2.27, 0.92],
      [-2.16, 0.95],
    ],
    0.008,
  );
  body.add(new THREE.Mesh(headGeo, lamp));

  // Full-width light bar under the hood lip, dark fascia and splitter below.
  body.add(box(lamp, 1.18, 0.022, 0.03, 0, 0.535, NOSE_Z - 0.005));
  body.add(box(dark, 1.9, 0.035, 0.2, 0, 0.17, NOSE_Z + 0.04));

  // Rear: full-width red light bar, dark lower panel, diffuser and four copper thruster nozzles.
  body.add(box(tailLamp, 1.7, 0.03, 0.03, 0, 0.8, TAIL_Z + 0.004));
  body.add(box(dark, 1.84, 0.32, 0.06, 0, 0.47, TAIL_Z - 0.01));
  const diffuser = box(dark, 1.6, 0.06, 0.5, 0, 0.24, TAIL_Z - 0.2);
  diffuser.rotation.x = -0.25;
  body.add(diffuser);

  const rear: Nozzle[] = [];
  for (const x of [-0.55, -0.2, 0.2, 0.55]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.018, 8, 20), copper);
    ring.position.set(x, 0.42, TAIL_Z + 0.03);
    const core = new THREE.Mesh(new THREE.CircleGeometry(0.06, 16), nozzleCore);
    core.position.set(x, 0.42, TAIL_Z + 0.025);
    body.add(ring, core);
    rear.push({ position: new THREE.Vector3(x, 0.42, TAIL_Z + 0.05), dir: new THREE.Vector3(0, 0, 1) });
  }

  // Rear wing on tall angular endplates.
  const plateShape = new THREE.Shape();
  plateShape.moveTo(1.5, 0.88);
  plateShape.lineTo(2.2, 0.88);
  plateShape.lineTo(2.32, 1.36);
  plateShape.lineTo(2.0, 1.36);
  plateShape.closePath();
  const plateGeo = new THREE.ExtrudeGeometry(plateShape, { depth: 0.035, bevelEnabled: false });
  // Shape is drawn in (z, y); rotate so the extrusion runs along X.
  plateGeo.rotateY(-Math.PI / 2);
  for (const side of [-1, 1]) {
    const plate = new THREE.Mesh(plateGeo, paint);
    plate.position.x = side * 0.86 + (side > 0 ? 0.035 : 0);
    body.add(plate);
  }
  const wing = box(paint, 1.98, 0.035, 0.46, 0, 1.37, 2.16);
  wing.rotation.x = 0.08;
  body.add(wing);
  const wingLip = box(dark, 1.98, 0.05, 0.04, 0, 1.39, 2.4);
  body.add(wingLip);

  body.traverse((o) => {
    if (o instanceof THREE.Mesh && o !== shell) o.castShadow = true;
  });

  // Hidden thrusters: underbody pairs for jump/hover, sill outlets for roll.
  const down: Nozzle[] = [];
  const left: Nozzle[] = [];
  const right: Nozzle[] = [];
  for (const z of [-0.6, 0.6]) {
    for (const side of [-1, 1]) {
      down.push({ position: new THREE.Vector3(side * 0.6, 0.14, z), dir: new THREE.Vector3(0, -1, 0) });
      const n = { position: new THREE.Vector3(side * 0.98, 0.5, z), dir: new THREE.Vector3(side, 0, 0) };
      (side < 0 ? left : right).push(n);
    }
  }

  // Wheels.
  const wheels: WheelRig[] = [];
  for (const [front, z, track] of [
    [true, -HALF_BASE, FRONT_TRACK],
    [false, HALF_BASE, REAR_TRACK],
  ] as const) {
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * track, WHEEL_R, z);
      const mirror = new THREE.Group();
      if (side < 0) mirror.rotation.y = Math.PI;
      const parts = buildWheel(front);
      mirror.add(parts.spin, parts.static);
      pivot.add(mirror);
      root.add(pivot);
      wheels.push({ pivot, spin: parts.spin, front, spinSign: side });
    }
  }

  // Collapse the static body details (lamps, vents, wing, nozzles…) into one mesh per material.
  mergeStaticByMaterial(body);
  for (const w of wheels) mergeStaticByMaterial(w.spin);

  return { root, body, wheels, nozzles: { rear, down, left, right } };
}
