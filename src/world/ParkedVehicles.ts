import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ParkedVehicleKind } from '../config/levels';

/** Material slots shared by all parked vehicles. */
type Slot = 'body' | 'glass' | 'dark' | 'wheel' | 'lamp';

interface Part {
  slot: Slot;
  size: [number, number, number];
  pos: [number, number, number];
  rotZ?: number;
}

export interface VehicleShape {
  /** along local X (vehicles are parked across the jumper's path) */
  readonly length: number;
  /** along local Z */
  readonly width: number;
  readonly height: number;
  readonly parts: readonly Part[];
}

const WHEEL_SIZE = (r: number, w: number): [number, number, number] => [r, w, r];

/** Original low-poly vehicles. Local frame: length along X, ground at y = 0. */
function shapeOf(kind: ParkedVehicleKind): VehicleShape {
  const wheels = (r: number, xs: number[], halfTrack: number, w = 0.26): Part[] =>
    xs.flatMap((x) => [-1, 1].map((s): Part => ({ slot: 'wheel', size: WHEEL_SIZE(r, w), pos: [x, r, s * halfTrack] })));

  switch (kind) {
    case 'pickup':
      return {
        length: 5.4,
        width: 2.0,
        height: 1.9,
        parts: [
          { slot: 'body', size: [5.3, 0.62, 1.96], pos: [0, 0.78, 0] },
          { slot: 'body', size: [2.1, 0.75, 1.9], pos: [-0.55, 1.45, 0] },
          { slot: 'glass', size: [2.0, 0.55, 1.92], pos: [-0.55, 1.47, 0] },
          { slot: 'body', size: [2.2, 0.38, 0.08], pos: [1.55, 1.27, 0.94] },
          { slot: 'body', size: [2.2, 0.38, 0.08], pos: [1.55, 1.27, -0.94] },
          { slot: 'dark', size: [5.4, 0.22, 2.0], pos: [0, 0.42, 0] },
          { slot: 'lamp', size: [0.05, 0.12, 1.6], pos: [-2.66, 0.92, 0] },
          ...wheels(0.42, [-1.7, 1.75], 0.86),
        ],
      };
    case 'boxTruck':
      return {
        length: 6.6,
        width: 2.4,
        height: 3.25,
        parts: [
          { slot: 'body', size: [1.9, 1.6, 2.3], pos: [-2.3, 1.45, 0] },
          { slot: 'glass', size: [0.6, 0.6, 2.32], pos: [-2.95, 1.85, 0] },
          { slot: 'body', size: [4.5, 2.5, 2.4], pos: [0.95, 1.95, 0] },
          { slot: 'dark', size: [6.5, 0.3, 2.2], pos: [0, 0.6, 0] },
          { slot: 'lamp', size: [0.05, 0.14, 1.9], pos: [-3.26, 1.05, 0] },
          ...wheels(0.48, [-2.3, 1.4, 2.4], 0.95, 0.32),
        ],
      };
    case 'suv':
      return {
        length: 4.8,
        width: 1.95,
        height: 1.75,
        parts: [
          { slot: 'body', size: [4.7, 0.8, 1.92], pos: [0, 0.82, 0] },
          { slot: 'body', size: [3.0, 0.6, 1.8], pos: [0.3, 1.45, 0] },
          { slot: 'glass', size: [2.9, 0.45, 1.82], pos: [0.3, 1.45, 0] },
          { slot: 'dark', size: [4.8, 0.2, 1.96], pos: [0, 0.45, 0] },
          { slot: 'lamp', size: [0.05, 0.1, 1.5], pos: [-2.36, 1.0, 0] },
          ...wheels(0.4, [-1.45, 1.45], 0.84),
        ],
      };
    case 'sedan':
      return {
        length: 4.7,
        width: 1.85,
        height: 1.45,
        parts: [
          { slot: 'body', size: [4.6, 0.6, 1.82], pos: [0, 0.68, 0] },
          { slot: 'body', size: [2.3, 0.45, 1.66], pos: [0.15, 1.18, 0] },
          { slot: 'glass', size: [2.2, 0.36, 1.68], pos: [0.15, 1.18, 0] },
          { slot: 'dark', size: [4.7, 0.16, 1.84], pos: [0, 0.4, 0] },
          { slot: 'lamp', size: [0.05, 0.08, 1.4], pos: [-2.31, 0.82, 0] },
          ...wheels(0.34, [-1.4, 1.4], 0.8),
        ],
      };
    case 'robotaxi':
      // Compact two-seat pod with no steering wheel: one big glass canopy, short overhangs.
      return {
        length: 3.7,
        width: 1.9,
        height: 1.55,
        parts: [
          { slot: 'body', size: [3.6, 0.6, 1.86], pos: [0, 0.66, 0] },
          { slot: 'glass', size: [2.4, 0.62, 1.7], pos: [0.1, 1.22, 0] },
          { slot: 'body', size: [0.5, 0.3, 1.8], pos: [-1.55, 1.05, 0], rotZ: 0.5 },
          { slot: 'body', size: [0.6, 0.3, 1.8], pos: [1.5, 1.05, 0], rotZ: -0.5 },
          { slot: 'lamp', size: [0.04, 0.05, 1.7], pos: [-1.81, 0.86, 0] },
          { slot: 'dark', size: [3.7, 0.15, 1.88], pos: [0, 0.38, 0] },
          ...wheels(0.36, [-1.2, 1.2], 0.84, 0.24),
        ],
      };
  }
}

export function vehicleShape(kind: ParkedVehicleKind): VehicleShape {
  return shapeOf(kind);
}

const SLOTS: readonly Slot[] = ['body', 'glass', 'dark', 'wheel', 'lamp'];

function slotMaterial(slot: Slot): THREE.MeshStandardMaterial {
  switch (slot) {
    case 'body':
      return new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0.3, flatShading: true });
    case 'glass':
      return new THREE.MeshStandardMaterial({ color: 0x1a1f28, roughness: 0.1, metalness: 0.6 });
    case 'dark':
      return new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.8 });
    case 'wheel':
      return new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
    case 'lamp':
      return new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d8, emissiveIntensity: 1.5 });
  }
}

function slotGeometry(shape: VehicleShape, slot: Slot): THREE.BufferGeometry | null {
  const geos: THREE.BufferGeometry[] = [];
  for (const p of shape.parts) {
    if (p.slot !== slot) continue;
    let g: THREE.BufferGeometry;
    if (slot === 'wheel') {
      g = new THREE.CylinderGeometry(p.size[0], p.size[0], p.size[1], 14).rotateX(Math.PI / 2);
    } else {
      g = new THREE.BoxGeometry(...p.size);
      if (p.rotZ) g.rotateZ(p.rotZ);
    }
    g.translate(...p.pos);
    geos.push(g.index ? g.toNonIndexed() : g);
  }
  if (geos.length === 0) return null;
  const merged = mergeGeometries(geos);
  geos.forEach((g) => g.dispose());
  return merged;
}

const PALETTE = [0xd94a3a, 0x2f6fd6, 0xe8e6df, 0x3b3f46, 0xf2b632, 0x6c8a5a, 0x9aa3ad, 0xffffff];

export interface PlacedVehicle {
  readonly kind: ParkedVehicleKind;
  readonly matrix: THREE.Matrix4;
}

/**
 * Draw any number of parked vehicles with one InstancedMesh per (kind, material),
 * body colours varied per instance.
 */
export function buildParkedVehicles(placed: readonly PlacedVehicle[], seed: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'parked-vehicles';
  const byKind = new Map<ParkedVehicleKind, THREE.Matrix4[]>();
  for (const v of placed) {
    let list = byKind.get(v.kind);
    if (!list) byKind.set(v.kind, (list = []));
    list.push(v.matrix);
  }
  const mats = new Map<Slot, THREE.MeshStandardMaterial>(SLOTS.map((s) => [s, slotMaterial(s)]));
  let colorIndex = seed;
  const color = new THREE.Color();
  for (const [kind, matrices] of byKind) {
    const shape = shapeOf(kind);
    for (const slot of SLOTS) {
      const geo = slotGeometry(shape, slot);
      if (!geo) continue;
      const mesh = new THREE.InstancedMesh(geo, mats.get(slot)!, matrices.length);
      matrices.forEach((m, i) => {
        mesh.setMatrixAt(i, m);
        if (slot === 'body') mesh.setColorAt(i, color.set(PALETTE[colorIndex++ % PALETTE.length]!));
      });
      mesh.castShadow = slot !== 'lamp';
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
  return group;
}
