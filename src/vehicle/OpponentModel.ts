import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import type { CarDef, CarShape } from '../config/cars';
import { CAR_TUNING } from '../config/tuning';
import type { CarGeometry } from './CarController';
import { bandPatch, polyLoft, type CarRig, type Nozzle, type PolySection, type WheelRig } from './CarModelFactory';

/** Collects small detail meshes and merges them per material (fewer draw calls on mobile). */
class MergeBag {
  private readonly byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();

  add(mat: THREE.Material, geo: THREE.BufferGeometry, matrix?: THREE.Matrix4): void {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    if (matrix) g = g.applyMatrix4(matrix);
    let list = this.byMat.get(mat);
    if (!list) this.byMat.set(mat, (list = []));
    list.push(g);
  }

  box(mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0): void {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rx) g.rotateX(rx);
    this.add(mat, g.translate(x, y, z));
  }

  build(target: THREE.Object3D, castShadow: boolean): void {
    for (const [mat, list] of this.byMat) {
      const merged = mergeGeometries(list);
      list.forEach((g) => g.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = castShadow;
      target.add(mesh);
    }
    this.byMat.clear();
  }
}

/** Physics layout for a shape: wheel size and how much to raise mounts / chassis. */
export function opponentGeometry(shape: CarShape): CarGeometry {
  const lift = shape.wheelRadius - CAR_TUNING.wheelRadius;
  return { wheelRadius: shape.wheelRadius, hardpointLift: lift, chassisLift: lift + (shape.rideHeight - 0.13) };
}

/** Half-profile sections: P0 bottom centre, P1 sill, P2 lower crease, P3 belt (widest), P4 shoulder, P5 top centre. */
function bodySections(s: CarShape): PolySection[] {
  const L = s.length;
  const hw = s.width / 2;
  const nose = -L / 2;
  const base = s.rideHeight;
  const belt = Math.max(s.noseHeight, s.tailHeight) * 0.62;
  const shoulderIn = 1 - 0.1 - 0.16 * s.roundness;
  const cowl = THREE.MathUtils.lerp(s.noseHeight, s.tailHeight, 0.75);
  const keys: [number, number, number, number, number][] = [
    // f, width factor, bottom, top centre, belt scale
    [0, 0.8, base + 0.14, s.noseHeight * 0.92, 0.75],
    [0.05, 0.95, base + 0.04, s.noseHeight + 0.04, 0.9],
    [0.2, 1.0, base, THREE.MathUtils.lerp(s.noseHeight, cowl, 0.5), 1],
    [s.cabinFrom, 0.99, base, cowl, 1],
    [(s.cabinFrom + s.cabinTo) / 2, 0.98, base, cowl + 0.02, 1],
    [Math.min(s.cabinTo, 0.88), 1.0, base, s.tailHeight, 1],
    [0.94, 0.98, base + 0.04, s.tailHeight, 1],
    [1, 0.88, base + 0.12, s.tailHeight * 0.94, 0.95],
  ];
  return keys.map(([f, wf, bottom, top, bs]) => {
    const w = hw * wf;
    const b = belt * bs;
    const shoulder = Math.min(top - 0.02, b + (top - b) * 0.75);
    return {
      z: nose + f * L,
      pts: [
        [0, bottom],
        [w * 0.9, bottom],
        [w * 0.985, bottom + (b - bottom) * 0.45],
        [w, b],
        [w * shoulderIn, shoulder],
        [0, top],
      ],
    };
  });
}

function canopySections(s: CarShape): PolySection[] {
  const L = s.length;
  const hw = s.width / 2;
  const nose = -L / 2;
  const cowl = THREE.MathUtils.lerp(s.noseHeight, s.tailHeight, 0.75);
  const span = s.cabinTo - s.cabinFrom;
  const roofW = hw * (0.66 - 0.08 * s.roundness);
  const keys: [number, number, number][] = [
    // f, base height, roof height
    [s.cabinFrom, cowl - 0.02, cowl + 0.02],
    [s.cabinFrom + span * 0.28, cowl, s.height],
    [s.cabinFrom + span * 0.62, cowl + 0.02, s.height - 0.02],
    [s.cabinTo, s.tailHeight - 0.03, s.tailHeight + 0.03],
  ];
  return keys.map(([f, b, r], i) => {
    const edge = i === 0 || i === keys.length - 1 ? 0.75 : 1;
    return {
      z: nose + f * L,
      pts: [
        [0, b - 0.1],
        [hw * 0.86 * edge, b],
        [roofW * edge, r - 0.04],
        [0, r],
      ],
    };
  });
}

function buildShell(s: CarShape, paint: THREE.Material, dark: THREE.Material, well: THREE.Material): THREE.Mesh {
  const shell = polyLoft(bodySections(s), (k) => (k <= 1 ? 1 : 0), 1, 0);
  let result = new Brush(shell, [paint, dark]);
  const evaluator = new Evaluator();
  evaluator.attributes = ['position', 'normal'];
  evaluator.useGroups = true;
  const track = s.width / 2 - 0.16;
  for (const z of [-s.wheelBase / 2, s.wheelBase / 2]) {
    for (const side of [-1, 1]) {
      const g = new THREE.CylinderGeometry(s.wheelRadius + 0.07, s.wheelRadius + 0.07, 0.8, 32).rotateZ(Math.PI / 2);
      g.deleteAttribute('uv');
      const cutter = new Brush(g, well);
      cutter.position.set(side * (track + 0.2), s.wheelRadius + 0.03, z);
      cutter.updateMatrixWorld();
      result.updateMatrixWorld();
      result = evaluator.evaluate(result, cutter, SUBTRACTION);
      g.dispose();
    }
  }
  shell.dispose();
  const mesh = new THREE.Mesh(result.geometry, result.material);
  mesh.castShadow = true;
  return mesh;
}

function buildWheel(radius: number, width: number, rim: THREE.Material, tire: THREE.Material): THREE.Group {
  const spin = new THREE.Group();
  const bag = new MergeBag();
  bag.add(tire, new THREE.CylinderGeometry(radius, radius, width, 24).rotateZ(Math.PI / 2));
  const rimR = radius * 0.7;
  bag.add(rim, new THREE.CylinderGeometry(rimR, rimR, 0.02, 20).rotateZ(Math.PI / 2).translate(width / 2 + 0.005, 0, 0));
  for (let k = 0; k < 5; k++) {
    const g = new THREE.BoxGeometry(0.03, rimR * 0.9, 0.06).translate(0, rimR * 0.45, 0);
    g.rotateX((k / 5) * Math.PI * 2);
    bag.add(rim, g.translate(width / 2 + 0.02, 0, 0));
  }
  bag.build(spin, true);
  return spin;
}

/** Cheap stand-in shown beyond the LOD distance. */
function buildFarModel(s: CarShape, paint: THREE.Material, glass: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const bag = new MergeBag();
  const midTop = (s.noseHeight + s.tailHeight) / 2;
  bag.box(paint, s.width * 0.96, midTop - s.rideHeight, s.length * 0.96, 0, (midTop + s.rideHeight) / 2, 0);
  const cz = ((s.cabinFrom + s.cabinTo) / 2 - 0.5) * s.length;
  bag.box(glass, s.width * 0.7, s.height - midTop, (s.cabinTo - s.cabinFrom) * s.length * 0.8, 0, (s.height + midTop) / 2, cz);
  bag.build(g, false);
  return g;
}

/**
 * Procedural opponent built from a CarDef's shape parameters, painted `color`.
 * Detailed model up close, a box stand-in beyond `lodDistance`.
 */
export function createOpponentCar(def: CarDef, color: number, physicalPaint: boolean, lodDistance: number): CarRig {
  const s = def.shape;
  const root = new THREE.Group();
  root.name = `opponent-${def.id}`;
  const body = new THREE.Group();
  root.add(body);

  const paint = physicalPaint
    ? new THREE.MeshPhysicalMaterial({ color, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.08, flatShading: true })
    : new THREE.MeshStandardMaterial({ color, roughness: 0.35, flatShading: true });
  const dark = new THREE.MeshStandardMaterial({ color: 0x17181b, roughness: 0.6, flatShading: true });
  const well = new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.9 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0b0e14, roughness: 0.08, metalness: 0.6, flatShading: true });
  const head = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4e0, emissiveIntensity: 2.2 });
  const tail = new THREE.MeshStandardMaterial({ color: 0x400008, emissive: 0xff1a22, emissiveIntensity: 3 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.3, metalness: 0.9 });
  const tire = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });

  const near = new THREE.Group();
  near.add(buildShell(s, paint, dark, well));
  const L = s.length;
  const hw = s.width / 2;
  const nose = -L / 2;
  const tailZ = L / 2;
  const bag = new MergeBag();

  if (s.openCabin) {
    // Roll cage: two hoops plus side rails, seats inside.
    const cz0 = nose + s.cabinFrom * L;
    const cz1 = nose + s.cabinTo * L;
    const top = s.height;
    const baseY = s.noseHeight;
    for (const z of [cz0 + 0.25, cz1 - 0.2]) {
      for (const x of [-hw * 0.72, hw * 0.72]) {
        bag.add(dark, new THREE.CylinderGeometry(0.04, 0.04, top - baseY, 6).translate(x, (top + baseY) / 2, z));
      }
      bag.add(dark, new THREE.CylinderGeometry(0.04, 0.04, hw * 1.44, 6).rotateZ(Math.PI / 2).translate(0, top, z));
    }
    for (const x of [-hw * 0.72, hw * 0.72]) {
      bag.add(dark, new THREE.CylinderGeometry(0.04, 0.04, cz1 - cz0 - 0.45, 6).rotateX(Math.PI / 2).translate(x, top, (cz0 + cz1) / 2 - 0.02));
    }
    for (const x of [-0.4, 0.4]) bag.box(dark, 0.5, 0.6, 0.5, x, baseY + 0.25, (cz0 + cz1) / 2);
  } else {
    const canopy = new THREE.Mesh(polyLoft(canopySections(s), (k) => (k === 1 ? 1 : k === 2 ? 1 : 0), 1, 1), [paint, glass]);
    canopy.castShadow = true;
    near.add(canopy);
  }

  // Lights.
  const ly = s.noseHeight * 0.78;
  const ty = s.tailHeight * 0.82;
  if (s.lights === 'bar') {
    bag.box(head, s.width * 0.78, 0.03, 0.03, 0, ly, nose + 0.06);
    bag.box(tail, s.width * 0.82, 0.04, 0.03, 0, ty, tailZ - 0.04);
  } else if (s.lights === 'round') {
    for (const side of [-1, 1]) {
      for (const dx of [0.62, 0.42]) {
        bag.add(head, new THREE.CircleGeometry(0.075, 12).rotateY(Math.PI).translate(side * hw * dx, ly, nose + 0.07));
        bag.add(tail, new THREE.CircleGeometry(0.07, 12).translate(side * hw * dx, ty, tailZ - 0.03));
      }
    }
  } else {
    for (const side of [-1, 1]) {
      bag.box(head, 0.42, 0.04, 0.05, side * hw * 0.62, ly, nose + 0.08);
      bag.box(tail, 0.5, 0.05, 0.04, side * hw * 0.6, ty, tailZ - 0.04);
    }
  }
  // Dark grille / intake, rear diffuser.
  bag.box(dark, s.width * 0.55, 0.12, 0.05, 0, s.rideHeight + 0.18, nose + 0.1);
  bag.box(dark, s.width * 0.7, 0.14, 0.2, 0, s.rideHeight + 0.12, tailZ - 0.12);

  if (s.hoodScoop) {
    const z = nose + L * 0.2;
    bag.box(dark, 0.5, 0.1, 0.6, 0, THREE.MathUtils.lerp(s.noseHeight, s.tailHeight, 0.4) + 0.04, z, 0.08);
  }
  if (s.wing === 'lip') bag.box(paint, s.width * 0.8, 0.04, 0.16, 0, s.tailHeight + 0.02, tailZ - 0.12, -0.2);
  if (s.wing === 'duck') bag.box(paint, s.width * 0.86, 0.06, 0.26, 0, s.tailHeight + 0.04, tailZ - 0.14, -0.35);
  if (s.wing === 'big') {
    bag.box(dark, s.width * 0.95, 0.04, 0.34, 0, s.tailHeight + 0.38, tailZ - 0.2, 0.1);
    for (const side of [-1, 1]) {
      bag.box(dark, 0.04, 0.38, 0.12, side * hw * 0.55, s.tailHeight + 0.19, tailZ - 0.25);
      bag.box(paint, 0.03, 0.3, 0.42, side * s.width * 0.475, s.tailHeight + 0.38, tailZ - 0.2);
    }
  }
  if (s.sideIntakes) {
    bag.add(
      dark,
      bandPatch(
        bodySections(s),
        2,
        [
          [nose + L * 0.55, 0.15],
          [nose + L * 0.7, 0.15],
        ],
        [
          [nose + L * 0.6, 0.9],
          [nose + L * 0.7, 0.9],
        ],
        0.008,
      ),
    );
  }

  // Twin rear thruster outlets (boost flames).
  const rear: Nozzle[] = [];
  for (const x of [-0.35, 0.35]) {
    bag.add(metal, new THREE.TorusGeometry(0.05, 0.015, 6, 14).translate(x, s.rideHeight + 0.24, tailZ + 0.01));
    rear.push({ position: new THREE.Vector3(x, s.rideHeight + 0.24, tailZ + 0.03), dir: new THREE.Vector3(0, 0, 1) });
  }
  bag.build(near, false);

  const lod = new THREE.LOD();
  lod.addLevel(near, 0);
  lod.addLevel(buildFarModel(s, paint, glass), lodDistance);
  body.add(lod);

  // Wheels.
  const wheels: WheelRig[] = [];
  const track = s.width / 2 - 0.16;
  for (const [front, z] of [
    [true, -s.wheelBase / 2],
    [false, s.wheelBase / 2],
  ] as const) {
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * track, s.wheelRadius, z);
      const mirror = new THREE.Group();
      if (side < 0) mirror.rotation.y = Math.PI;
      const spin = buildWheel(s.wheelRadius, s.openCabin ? 0.36 : 0.28, metal, tire);
      mirror.add(spin);
      pivot.add(mirror);
      root.add(pivot);
      wheels.push({ pivot, spin, front, spinSign: side });
    }
  }

  return { root, body, wheels, nozzles: { rear, down: [], left: [], right: [] } };
}
