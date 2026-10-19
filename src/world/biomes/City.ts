import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ParkedVehicleKind } from '../../config/levels';
import { createRng } from '../../core/Random';
import { GROUP_TRAFFIC } from '../../core/Physics';
import { buildParkedVehicles, vehicleShape, type PlacedVehicle } from '../ParkedVehicles';
import { roundTree, propMaterial } from '../props/Nature';
import { SkyDome } from '../Sky';
import { canvasTexture } from '../Textures';
import { applyLighting, distToLines, type Biome, type BiomeContext } from './common';

/** Downtown at night: moonlight, sodium street lamps, lit windows and shopfronts. */
const NIGHT = {
  sky: { top: 0x03050d, horizon: 0x1c2440, bottom: 0x0b0d14 },
  fog: 0x121624,
  sunColor: 0x8fa2d6,
  sunIntensity: 0.55,
  hemiSky: 0x40507a,
  hemiGround: 0x2a2420,
  hemiIntensity: 0.45,
  envIntensity: 0.35,
};
/** Warm street-lamp colour (light pools and lamp heads). */
const LAMP = new THREE.Color(1, 0.72, 0.38);

/** Street centre lines of the city grid. The course follows some of them. */
const X_STREETS = [-520, -390, -260, -130, 0, 130, 260, 390];
const Z_STREETS = [-330, -200, -64, 40, 160, 296, 430, 560, 700, 830];
/** Road half width (kerb to kerb) and pavement width. */
const ROAD_HALF = 8;
const WALK = 6;
const CURB = 0.18;
/** The road that passes under a building on the 296 street. */
const ARCADE = { x0: -225, x1: -165, z: 296, clear: 7.5 };
/** Road works on the -260 street: barrier lines across half the road, alternating sides (z, side). */
const CHICANE: readonly (readonly [number, -1 | 1])[] = [[262, -1], [246, 1], [230, -1]];
const CHICANE_X = -260;
/** Elevated metro over the -260 street. */
const METRO = { x: -260, z0: 470, z1: -360, deck: 10.5 };

const UP = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------------------
// Facade textures (no text or logos: just windows, panels and brick)

function rng2(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

/** Office lights: the same windows lit in the colour map and the matching glow map. */
const WARM = ['#ffd9a0', '#fff0d0', '#cfe6ff', '#ffe6b8'];

function glassFacade(glow = false): THREE.CanvasTexture {
  return canvasTexture(512, (ctx, s) => {
    const r = rng2(11);
    const g = ctx.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, '#3a4a5e');
    g.addColorStop(1, '#1a2533');
    ctx.fillStyle = glow ? '#000' : g;
    ctx.fillRect(0, 0, s, s);
    const cols = 8;
    const rows = 8;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const v = 0.75 + r() * 0.35;
        const lit = r() < 0.38;
        const warm = WARM[Math.floor(r() * WARM.length)]!;
        if (!glow) {
          ctx.fillStyle = `rgba(${Math.round(70 * v)},${Math.round(90 * v)},${Math.round(115 * v)},0.6)`;
          ctx.fillRect((x * s) / cols + 2, (y * s) / rows + 2, s / cols - 4, s / rows - 4);
        }
        if (lit) {
          ctx.fillStyle = glow ? warm : 'rgba(255,236,200,0.5)';
          ctx.fillRect((x * s) / cols + 4, (y * s) / rows + 6, s / cols - 8, s / rows - 12);
        }
      }
    }
    // Mullions and floor slabs.
    ctx.fillStyle = glow ? '#000' : '#141a22';
    for (let x = 0; x <= cols; x++) ctx.fillRect((x * s) / cols - 2, 0, 4, s);
    ctx.fillStyle = glow ? '#000' : '#7d8288';
    for (let y = 0; y <= rows; y++) ctx.fillRect(0, (y * s) / rows - 3, s, 5);
  });
}

function officeFacade(glow = false): THREE.CanvasTexture {
  return canvasTexture(512, (ctx, s) => {
    const r = rng2(23);
    ctx.fillStyle = glow ? '#000' : '#d8d2c6';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 3000; i++) {
      const a = r() * 0.05;
      const x = r() * s;
      const y = r() * s;
      if (glow) continue;
      ctx.fillStyle = `rgba(0,0,0,${a})`;
      ctx.fillRect(x, y, 2, 2);
    }
    const cols = 6;
    const rows = 8;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const px = (x * s) / cols + 12;
        const py = (y * s) / rows + 12;
        const w = s / cols - 24;
        const h = s / rows - 22;
        ctx.fillStyle = glow ? '#000' : '#9b958a';
        ctx.fillRect(px - 3, py - 3, w + 6, h + 8);
        const lit = r() < 0.42;
        const gg = ctx.createLinearGradient(px, py, px + w, py + h);
        gg.addColorStop(0, lit ? '#f6dca8' : glow ? '#000' : '#3c4a5c');
        gg.addColorStop(1, lit ? '#c99b5a' : glow ? '#000' : '#1a222c');
        ctx.fillStyle = gg;
        ctx.fillRect(px, py, w, h);
        if (!glow) {
          ctx.fillStyle = 'rgba(255,255,255,0.12)';
          ctx.fillRect(px, py, w * 0.35, h);
        }
      }
    }
  });
}

function brickFacade(glow = false): THREE.CanvasTexture {
  return canvasTexture(512, (ctx, s) => {
    const r = rng2(37);
    ctx.fillStyle = glow ? '#000' : '#8a4a36';
    ctx.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 8) {
      for (let x = (y / 8) % 2 ? -8 : 0; x < s; x += 16) {
        const v = 0.8 + r() * 0.35;
        if (glow) continue;
        ctx.fillStyle = `rgb(${Math.round(150 * v)},${Math.round(78 * v)},${Math.round(58 * v)})`;
        ctx.fillRect(x + 1, y + 1, 14, 6);
      }
    }
    const cols = 5;
    const rows = 6;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const px = (x * s) / cols + 22;
        const py = (y * s) / rows + 16;
        const w = s / cols - 44;
        const h = s / rows - 34;
        ctx.fillStyle = glow ? '#000' : '#ece6da';
        ctx.fillRect(px - 5, py - 5, w + 10, h + 12);
        const lit = r() < 0.45;
        ctx.fillStyle = lit ? '#f2c98a' : glow ? '#000' : '#232a34';
        ctx.fillRect(px, py, w, h);
        ctx.fillStyle = glow ? '#000' : '#ece6da';
        ctx.fillRect(px + w / 2 - 2, py, 4, h);
        ctx.fillRect(px, py + h / 2 - 2, w, 4);
      }
    }
  });
}

function shopFacade(): THREE.CanvasTexture {
  return canvasTexture(512, (ctx, s) => {
    const r = rng2(51);
    ctx.fillStyle = '#2b2b2e';
    ctx.fillRect(0, 0, s, s);
    const bays = 4;
    const signs = ['#c8322c', '#1f6fb2', '#2f8a4a', '#e0a21f', '#6a3fa0', '#d4d0c8'];
    for (let b = 0; b < bays; b++) {
      const x0 = (b * s) / bays;
      const w = s / bays;
      // Sign band (plain colour, no text) and a fabric awning.
      ctx.fillStyle = signs[Math.floor(r() * signs.length)]!;
      ctx.fillRect(x0 + 4, s * 0.06, w - 8, s * 0.13);
      // Shop window with a warm interior.
      const gg = ctx.createLinearGradient(0, s * 0.25, 0, s);
      gg.addColorStop(0, '#f3dfb5');
      gg.addColorStop(1, '#8f7550');
      ctx.fillStyle = gg;
      ctx.fillRect(x0 + 10, s * 0.27, w - 20, s * 0.66);
      // Shelves / silhouettes inside.
      for (let k = 0; k < 6; k++) {
        ctx.fillStyle = `rgba(60,40,25,${0.25 + r() * 0.3})`;
        ctx.fillRect(x0 + 14 + r() * (w - 40), s * (0.4 + r() * 0.45), 8 + r() * 20, 4 + r() * 30);
      }
      // Glass reflection and door.
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.beginPath();
      ctx.moveTo(x0 + 10, s * 0.93);
      ctx.lineTo(x0 + w * 0.45, s * 0.27);
      ctx.lineTo(x0 + w * 0.6, s * 0.27);
      ctx.lineTo(x0 + w * 0.2, s * 0.93);
      ctx.fill();
      ctx.fillStyle = '#1b1b1d';
      ctx.fillRect(x0 + w * 0.66, s * 0.4, w * 0.22, s * 0.53);
      ctx.fillStyle = '#4a4a4f';
      ctx.fillRect(x0, 0, 6, s);
    }
  });
}

function asphaltTexture(): THREE.CanvasTexture {
  return canvasTexture(512, (ctx, s) => {
    const r = rng2(5);
    ctx.fillStyle = '#4a4b4e';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 26000; i++) {
      const v = r();
      ctx.fillStyle = v < 0.5 ? `rgba(0,0,0,${v * 0.22})` : `rgba(255,255,255,${(v - 0.5) * 0.12})`;
      ctx.fillRect(r() * s, r() * s, 1.5, 1.5);
    }
    // Patches and cracks.
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = `rgba(20,20,22,${0.15 + r() * 0.15})`;
      ctx.fillRect(r() * s, r() * s, 40 + r() * 80, 30 + r() * 60);
    }
    ctx.strokeStyle = 'rgba(15,15,15,0.35)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 8; i++) {
      ctx.beginPath();
      let x = r() * s;
      let y = r() * s;
      ctx.moveTo(x, y);
      for (let k = 0; k < 6; k++) ctx.lineTo((x += (r() - 0.5) * 40), (y += (r() - 0.5) * 40));
      ctx.stroke();
    }
  });
}

function pavementTexture(): THREE.CanvasTexture {
  return canvasTexture(256, (ctx, s) => {
    const r = rng2(9);
    ctx.fillStyle = '#b9b5ad';
    ctx.fillRect(0, 0, s, s);
    const n = 4;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const v = 0.9 + r() * 0.15;
        ctx.fillStyle = `rgb(${Math.round(185 * v)},${Math.round(181 * v)},${Math.round(173 * v)})`;
        ctx.fillRect((x * s) / n + 2, (y * s) / n + 2, s / n - 4, s / n - 4);
      }
    }
    for (let i = 0; i < 2500; i++) {
      ctx.fillStyle = `rgba(0,0,0,${r() * 0.08})`;
      ctx.fillRect(r() * s, r() * s, 2, 2);
    }
  });
}

/** Box with UVs scaled to world metres (`tile` metres per texture repeat). */
function texturedBox(w: number, h: number, d: number, tileU: number, tileV: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  // Face order: +x, -x, +y, -y, +z, -z (4 vertices each).
  const faceSize: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [fu, fv] = faceSize[f]!;
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, (uv.getX(i) * fu) / tileU, (uv.getY(i) * fv) / tileV);
    }
  }
  return g;
}

// ---------------------------------------------------------------------------
// Pedestrians: simple low-poly people, animated with instancing.

interface Walker {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  t: number;
  dir: number;
  speed: number;
  phase: number;
  side: number;
}

const SHIRTS = [0x2f4f7f, 0xc8322c, 0xe8e4da, 0x3a3a3c, 0x6c8a5a, 0xe0a21f, 0x7a5c8f, 0x2b8a8a, 0xd78a6a, 0x1f2a44];
const PANTS = [0x22252b, 0x34445e, 0x5b5146, 0x2e2e30, 0x7d7466, 0x1d2f4a];
const SKIN = [0xf1c9a5, 0xd9a77e, 0xa8774f, 0x7a5236, 0xe8b893];

class Pedestrians {
  readonly group = new THREE.Group();
  private readonly walkers: Walker[] = [];
  private readonly parts: { mesh: THREE.InstancedMesh; kind: 'torso' | 'head' | 'legL' | 'legR' | 'armL' | 'armR' | 'hair' }[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly base = new THREE.Matrix4();
  private readonly local = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private t = 0;

  constructor(paths: readonly [number, number, number, number][], count: number, rng: () => number) {
    for (let i = 0; i < count; i++) {
      const p = paths[Math.floor(rng() * paths.length)]!;
      this.walkers.push({
        ax: p[0], az: p[1], bx: p[2], bz: p[3],
        t: rng(),
        dir: rng() < 0.5 ? 1 : -1,
        speed: 1.1 + rng() * 0.6,
        phase: rng() * 6.28,
        side: (rng() - 0.5) * 2.6,
      });
    }
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.85 });
    const make = (geo: THREE.BufferGeometry, kind: Pedestrians['parts'][number]['kind'], palette: readonly number[]): void => {
      const mesh = new THREE.InstancedMesh(geo, mat, count);
      const c = new THREE.Color();
      for (let i = 0; i < count; i++) mesh.setColorAt(i, c.set(palette[(i * 7) % palette.length]!));
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.parts.push({ mesh, kind });
    };
    // Geometry pivots: legs and arms hang from their top.
    make(new THREE.CapsuleGeometry(0.2, 0.42, 3, 8).translate(0, 1.15, 0), 'torso', SHIRTS);
    make(new THREE.SphereGeometry(0.13, 10, 8).translate(0, 1.66, 0), 'head', SKIN);
    make(new THREE.SphereGeometry(0.135, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55).translate(0, 1.69, 0), 'hair', [0x1b1410, 0x3a2414, 0x6b4a2a, 0x2b2b2b, 0xc9a66b]);
    const leg = new THREE.CapsuleGeometry(0.085, 0.62, 3, 6).translate(0, -0.4, 0);
    make(leg, 'legL', PANTS);
    make(leg.clone(), 'legR', PANTS);
    const arm = new THREE.CapsuleGeometry(0.06, 0.5, 3, 6).translate(0, -0.3, 0);
    make(arm, 'armL', SHIRTS);
    make(arm.clone(), 'armR', SHIRTS);
    this.update(0, new THREE.Vector3(), true);
  }

  update(dt: number, cam: THREE.Vector3, all = false): void {
    this.t += dt;
    const parts = this.parts;
    this.walkers.forEach((w, i) => {
      const len = Math.hypot(w.bx - w.ax, w.bz - w.az);
      w.t += (w.dir * w.speed * dt) / Math.max(len, 1);
      if (w.t > 1) {
        w.t = 1;
        w.dir = -1;
      } else if (w.t < 0) {
        w.t = 0;
        w.dir = 1;
      }
      const dx = (w.bx - w.ax) / len;
      const dz = (w.bz - w.az) / len;
      const x = w.ax + (w.bx - w.ax) * w.t - dz * w.side;
      const z = w.az + (w.bz - w.az) * w.t + dx * w.side;
      if (!all && Math.abs(x - cam.x) + Math.abs(z - cam.z) > 260) return;
      const yaw = Math.atan2(-dx * w.dir, -dz * w.dir);
      this.q.setFromAxisAngle(UP, yaw);
      this.base.compose(new THREE.Vector3(x, CURB, z), this.q, new THREE.Vector3(1, 1, 1));
      const swing = Math.sin(this.t * w.speed * 5.2 + w.phase) * 0.55;
      for (const part of parts) {
        switch (part.kind) {
          case 'legL':
          case 'legR':
            this.local.compose(
              new THREE.Vector3(part.kind === 'legL' ? -0.1 : 0.1, 0.82, 0),
              this.q.setFromEuler(this.e.set(part.kind === 'legL' ? swing : -swing, 0, 0)),
              new THREE.Vector3(1, 1, 1),
            );
            this.m.multiplyMatrices(this.base, this.local);
            break;
          case 'armL':
          case 'armR':
            this.local.compose(
              new THREE.Vector3(part.kind === 'armL' ? -0.27 : 0.27, 1.42, 0),
              this.q.setFromEuler(this.e.set(part.kind === 'armL' ? -swing * 0.8 : swing * 0.8, 0, part.kind === 'armL' ? -0.08 : 0.08)),
              new THREE.Vector3(1, 1, 1),
            );
            this.m.multiplyMatrices(this.base, this.local);
            break;
          default:
            this.m.copy(this.base);
        }
        part.mesh.setMatrixAt(i, this.m);
      }
    });
    for (const part of parts) part.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const p of this.parts) p.mesh.geometry.dispose();
  }
}

// ---------------------------------------------------------------------------
// Traffic: ordinary cars driving in lanes along the course. They only collide with
// the player (collision group), so the AI racers aren't jammed behind them.

interface TrafficCar {
  readonly group: THREE.Group;
  readonly body: RAPIER.RigidBody;
  readonly lane: number;
  readonly dir: 1 | -1;
  readonly speed: number;
  readonly seg: { s0: number; s1: number };
  s: number;
  parked: boolean;
}

// ---------------------------------------------------------------------------

export function buildCity(ctx: BiomeContext): Biome {
  const { physics, renderer, def } = ctx;
  const R = physics.R;
  const group = new THREE.Group();
  group.name = 'city';
  const rng = createRng(606);
  const colliders: RAPIER.Collider[] = [];
  const q = renderer.currentQuality;
  const low = q.tier === 'low';
  const lines = ctx.allLines;
  const onCourse = (x: number, z: number, r: number): boolean => distToLines(lines, x, z) < r;
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };

  // ---- Ground: flat asphalt everywhere (the course roads sit on top) ----------
  const ground = physics.world.createCollider(R.ColliderDesc.cuboid(1100, 1, 1100).setTranslation(0, -1, 0).setFriction(1));
  physics.setSurface(ground, 'asphalt');
  colliders.push(ground);
  const asphalt = keep(asphaltTexture());
  asphalt.wrapS = asphalt.wrapT = THREE.RepeatWrapping;
  asphalt.repeat.set(220, 220);
  asphalt.anisotropy = renderer.maxAnisotropy;
  const groundMesh = new THREE.Mesh(
    keep(new THREE.PlaneGeometry(2200, 2200).rotateX(-Math.PI / 2)),
    keep(new THREE.MeshStandardMaterial({ map: asphalt, color: 0x9a9a9a, roughness: 0.7, metalness: 0.1 })),
  );
  groundMesh.position.y = -0.03;
  groundMesh.receiveShadow = true;
  group.add(groundMesh);

  // ---- Blocks: pavement slabs with kerbs, and buildings -------------------------
  const pave = keep(pavementTexture());
  pave.wrapS = pave.wrapT = THREE.RepeatWrapping;
  const paveMat = keep(new THREE.MeshStandardMaterial({ map: pave, roughness: 0.9 }));
  const prep = (t: THREE.CanvasTexture): THREE.CanvasTexture => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = renderer.maxAnisotropy;
    return keep(t);
  };
  const facadeTex = [glassFacade(), officeFacade(), brickFacade()].map(prep);
  const glowTex = [glassFacade(true), officeFacade(true), brickFacade(true)].map(prep);
  const lit = (k: number, extra: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial =>
    keep(new THREE.MeshStandardMaterial({ map: facadeTex[k], emissive: 0xffffff, emissiveMap: glowTex[k], emissiveIntensity: 0.85, ...extra }));
  const facadeMats = [lit(0, { roughness: 0.18, metalness: 0.55 }), lit(1, { roughness: 0.75 }), lit(2, { roughness: 0.85 })];
  const facadeTile: [number, number][] = [[24, 28], [21, 28], [17, 21]];
  const shopTex = keep(shopFacade());
  shopTex.wrapS = THREE.RepeatWrapping;
  const shopMat = keep(new THREE.MeshStandardMaterial({ map: shopTex, roughness: 0.4, emissive: 0xffffff, emissiveMap: shopTex, emissiveIntensity: 0.85 }));
  const roofMat = keep(new THREE.MeshStandardMaterial({ color: 0x55575b, roughness: 0.95 }));
  const trimMat = keep(new THREE.MeshStandardMaterial({ color: 0xa9a49a, roughness: 0.8 }));

  const slabGeos: THREE.BufferGeometry[] = [];
  const facadeGeos: THREE.BufferGeometry[][] = [[], [], []];
  const shopGeos: THREE.BufferGeometry[] = [];
  const roofGeos: THREE.BufferGeometry[] = [];
  const trimGeos: THREE.BufferGeometry[] = [];
  const box = (target: THREE.BufferGeometry[], g: THREE.BufferGeometry, x: number, y: number, z: number): void => {
    g.translate(x, y, z);
    target.push(g);
  };
  const solid = (x: number, y: number, z: number, hx: number, hy: number, hz: number): void => {
    const c = physics.world.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setFriction(0.4));
    physics.setSurface(c, 'asphalt');
    colliders.push(c);
  };

  const building = (cx: number, cz: number, w: number, d: number, h: number, kind: number): void => {
    const [tu, tv] = facadeTile[kind]!;
    const shopH = 5;
    // Ground-floor shops, then the tower above, then a roof cap and plant.
    box(shopGeos, texturedBox(w + 0.3, shopH, d + 0.3, 14, shopH), cx, CURB + shopH / 2, cz);
    box(trimGeos, new THREE.BoxGeometry(w + 0.9, 0.5, d + 0.9), cx, CURB + shopH + 0.25, cz);
    box(facadeGeos[kind]!, texturedBox(w, h - shopH, d, tu, tv), cx, CURB + shopH + (h - shopH) / 2, cz);
    box(roofGeos, new THREE.BoxGeometry(w + 0.4, 0.6, d + 0.4), cx, CURB + h + 0.3, cz);
    if (h > 30 && rng() < 0.6) {
      // Set-back crown on taller towers.
      const w2 = w * (0.55 + rng() * 0.2);
      const d2 = d * (0.55 + rng() * 0.2);
      const h2 = 6 + rng() * 18;
      box(facadeGeos[kind]!, texturedBox(w2, h2, d2, tu, tv), cx, CURB + h + h2 / 2, cz);
      box(roofGeos, new THREE.BoxGeometry(w2 + 0.4, 0.6, d2 + 0.4), cx, CURB + h + h2 + 0.3, cz);
    }
    for (let k = 0; k < 3; k++) {
      // Rooftop plant boxes.
      box(roofGeos, new THREE.BoxGeometry(1.5 + rng() * 3, 1.2 + rng() * 2, 1.5 + rng() * 3), cx + (rng() - 0.5) * w * 0.6, CURB + h + 1.2, cz + (rng() - 0.5) * d * 0.6);
    }
    solid(cx, CURB + h / 2, cz, w / 2 + 0.15, h / 2, d / 2 + 0.15);
  };

  const parked: PlacedVehicle[] = [];
  const kinds: ParkedVehicleKind[] = ['sedan', 'suv', 'robotaxi', 'sedan', 'pickup', 'suv', 'boxTruck'];
  const trees: THREE.Matrix4[] = [];
  const lamps: THREE.Matrix4[] = [];
  const walkPaths: [number, number, number, number][] = [];
  const mm = new THREE.Matrix4();
  const qq = new THREE.Quaternion();

  for (let i = 0; i < X_STREETS.length - 1; i++) {
    for (let j = 0; j < Z_STREETS.length - 1; j++) {
      const x0 = X_STREETS[i]! + ROAD_HALF;
      const x1 = X_STREETS[i + 1]! - ROAD_HALF;
      const z0 = Z_STREETS[j]! + ROAD_HALF;
      const z1 = Z_STREETS[j + 1]! - ROAD_HALF;
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      const w = x1 - x0;
      const d = z1 - z0;
      // Pavement slab (kerb height) over the whole block.
      const slab = texturedBox(w, CURB, d, 4, 4);
      box(slabGeos, slab, cx, CURB / 2, cz);
      solid(cx, CURB / 2, cz, w / 2, CURB / 2, d / 2);

      // Buildings: lots around the block, inset by the pavement.
      const bx0 = x0 + WALK;
      const bx1 = x1 - WALK;
      const bz0 = z0 + WALK;
      const bz1 = z1 - WALK;
      const nx = Math.max(1, Math.round((bx1 - bx0) / 38));
      const nz = Math.max(1, Math.round((bz1 - bz0) / 34));
      const downtown = 1 - Math.min(1, Math.hypot(cx + 120, cz - 150) / 700);
      for (let a = 0; a < nx; a++) {
        for (let b = 0; b < nz; b++) {
          const lw = (bx1 - bx0) / nx;
          const ld = (bz1 - bz0) / nz;
          const lx = bx0 + lw * (a + 0.5);
          const lz = bz0 + ld * (b + 0.5);
          const h = 14 + rng() * 26 + downtown * downtown * rng() * 120;
          const kind = h > 55 ? (rng() < 0.75 ? 0 : 1) : rng() < 0.45 ? 2 : rng() < 0.7 ? 1 : 0;
          building(lx, lz, lw - 0.8, ld - 0.8, h, kind);
        }
      }

      // Sidewalk life on all four sides: trees, lamps, walkers; parked cars on side streets.
      const sides: [number, number, number, number, number, number][] = [
        // ax, az, bx, bz, outward normal x, z (toward the street)
        [x0, z0, x1, z0, 0, -1],
        [x0, z1, x1, z1, 0, 1],
        [x0, z0, x0, z1, -1, 0],
        [x1, z0, x1, z1, 1, 0],
      ];
      for (const [ax, az, bx, bz, nxx, nzz] of sides) {
        const len = Math.hypot(bx - ax, bz - az);
        const ux = (bx - ax) / len;
        const uz = (bz - az) / len;
        // Street centre beside this side, to know if the course runs here.
        const sx = (ax + bx) / 2 + nxx * ROAD_HALF;
        const sz = (az + bz) / 2 + nzz * ROAD_HALF;
        const course = onCourse(sx, sz, 6);
        const inset = (k: number): [number, number] => [ax + ux * k - nxx * k * 0, az + uz * k];
        for (let k = 10; k < len - 8; k += course ? 24 : 40) {
          const [px, pz] = inset(k);
          trees.push(mm.compose(new THREE.Vector3(px - nxx * 1.6, CURB, pz - nzz * 1.6), qq.setFromAxisAngle(UP, rng() * 6), new THREE.Vector3(0.55, 0.62 + rng() * 0.2, 0.55)).clone());
        }
        if (course) {
          for (let k = 4; k < len; k += 30) {
            const [px, pz] = inset(k);
            lamps.push(mm.compose(new THREE.Vector3(px - nxx * 0.6, CURB, pz - nzz * 0.6), qq.setFromAxisAngle(UP, Math.atan2(nxx, nzz)), new THREE.Vector3(1, 1, 1)).clone());
          }
        }
        // Walking line in the middle of the pavement.
        walkPaths.push([ax + ux * 3 - nxx * 3.2, az + uz * 3 - nzz * 3.2, bx - ux * 3 - nxx * 3.2, bz - uz * 3 - nzz * 3.2]);
        if (course) walkPaths.push([ax + ux * 3 - nxx * 3.2, az + uz * 3 - nzz * 3.2, bx - ux * 3 - nxx * 3.2, bz - uz * 3 - nzz * 3.2]);
        if (!course && rng() < 0.5) {
          // Parked cars along the kerb of side streets.
          for (let k = 8; k < len - 8; k += 6.5 + rng() * 6) {
            if (rng() < 0.45) continue;
            const kind = kinds[Math.floor(rng() * kinds.length)]!;
            const shape = vehicleShape(kind);
            const px = ax + ux * k + nxx * (shape.width / 2 + 0.4);
            const pz = az + uz * k + nzz * (shape.width / 2 + 0.4);
            const yaw = Math.atan2(ux, uz) + Math.PI / 2;
            parked.push({ kind, matrix: new THREE.Matrix4().compose(new THREE.Vector3(px, 0, pz), new THREE.Quaternion().setFromAxisAngle(UP, yaw), new THREE.Vector3(1, 1, 1)) });
            const c = physics.world.createCollider(
              R.ColliderDesc.cuboid(shape.length / 2, shape.height / 2, shape.width / 2)
                .setTranslation(px, shape.height / 2, pz)
                .setRotation(new THREE.Quaternion().setFromAxisAngle(UP, yaw)),
            );
            colliders.push(c);
            k += shape.length;
          }
        }
      }
    }
  }

  // ---- The arcade: a building straddling the street, you drive under it ------------
  {
    const { x0, x1, z, clear } = ARCADE;
    const w = x1 - x0;
    const d = (ROAD_HALF + WALK) * 2 + 2;
    const h = 46;
    const cx = (x0 + x1) / 2;
    box(facadeGeos[1]!, texturedBox(w, h - clear, d, facadeTile[1]![0], facadeTile[1]![1]), cx, clear + (h - clear) / 2, z);
    box(roofGeos, new THREE.BoxGeometry(w + 0.4, 0.6, d + 0.4), cx, h + 0.3, z);
    box(trimGeos, new THREE.BoxGeometry(w + 1, 1.2, d + 1), cx, clear + 0.6, z);
    // Ceiling seen from below with strip lights, and columns on the pavements.
    box(roofGeos, new THREE.BoxGeometry(w, 0.3, d), cx, clear - 0.15, z);
    const strip = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.9, 2.4) });
    keep(strip);
    for (let x = x0 + 4; x < x1; x += 8) {
      const m = new THREE.Mesh(keep(new THREE.BoxGeometry(2.4, 0.06, 0.3)), strip);
      m.position.set(x, clear - 0.33, z);
      group.add(m);
    }
    solid(cx, clear + (h - clear) / 2, z, w / 2, (h - clear) / 2, d / 2);
    for (let x = x0 + 3; x <= x1 - 3; x += (w - 6) / 3) {
      for (const side of [-1, 1]) {
        const pz = z + side * (ROAD_HALF + 1.2);
        box(trimGeos, new THREE.BoxGeometry(1.4, clear, 1.4), x, clear / 2, pz);
        solid(x, clear / 2, pz, 0.7, clear / 2, 0.7);
      }
    }
  }

  // ---- Metro viaduct over the -260 street --------------------------------------
  const concrete = keep(new THREE.MeshStandardMaterial({ color: 0xa6a39d, roughness: 0.9 }));
  const metroGeos: THREE.BufferGeometry[] = [];
  {
    const { x, z0, z1, deck } = METRO;
    const len = z0 - z1;
    box(metroGeos, new THREE.BoxGeometry(9, 1.4, len), x, deck, (z0 + z1) / 2);
    for (const side of [-1, 1]) box(metroGeos, new THREE.BoxGeometry(0.4, 1.3, len), x + side * 4.3, deck + 1.3, (z0 + z1) / 2);
    for (let z = z0 - 10; z > z1; z -= 28) {
      if (Z_STREETS.some((s) => Math.abs(s - z) < ROAD_HALF + 3)) continue;
      for (const side of [-1, 1]) {
        const px = x + side * (ROAD_HALF + 1.4);
        box(metroGeos, new THREE.BoxGeometry(1.3, deck, 1.3), px, deck / 2, z);
        solid(px, deck / 2, z, 0.65, deck / 2, 0.65);
      }
      box(metroGeos, new THREE.BoxGeometry((ROAD_HALF + 1.4) * 2 + 1.3, 1.2, 1.6), x, deck - 1.2, z);
    }
  }
  const metro = new THREE.Mesh(keep(mergeGeometries(metroGeos.map((g) => g.toNonIndexed())) ?? new THREE.BufferGeometry()), concrete);
  metroGeos.forEach((g) => g.dispose());
  metro.castShadow = true;
  metro.receiveShadow = true;
  group.add(metro);
  // A train gliding along the viaduct.
  const train = new THREE.Group();
  const trainBody = keep(new THREE.MeshStandardMaterial({ color: 0xe9ecef, roughness: 0.35, metalness: 0.4 }));
  const trainGlass = keep(new THREE.MeshStandardMaterial({ color: 0x1f2a36, roughness: 0.1, metalness: 0.4, emissive: 0xfff1d0, emissiveIntensity: 1.1 }));
  const trainStripe = keep(new THREE.MeshStandardMaterial({ color: 0x1f6fb2, roughness: 0.5 }));
  for (let k = 0; k < 4; k++) {
    const car = new THREE.Mesh(keep(new THREE.BoxGeometry(3, 3.4, 17)), trainBody);
    car.position.set(0, 1.7, -k * 17.6);
    const glass = new THREE.Mesh(keep(new THREE.BoxGeometry(3.06, 1.1, 15)), trainGlass);
    glass.position.set(0, 2.3, -k * 17.6);
    const stripe = new THREE.Mesh(keep(new THREE.BoxGeometry(3.08, 0.3, 16.6)), trainStripe);
    stripe.position.set(0, 1.25, -k * 17.6);
    car.castShadow = true;
    train.add(car, glass, stripe);
  }
  train.position.set(METRO.x, METRO.deck + 0.7, METRO.z0);
  group.add(train);

  // ---- Merge static city meshes per material ------------------------------------
  const addMerged = (geos: THREE.BufferGeometry[], mat: THREE.Material, shadow = true): void => {
    if (!geos.length) return;
    const merged = mergeGeometries(geos);
    geos.forEach((g) => g.dispose());
    if (!merged) return;
    keep(merged);
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  addMerged(slabGeos, paveMat, false);
  facadeGeos.forEach((g, k) => addMerged(g, facadeMats[k]!));
  addMerged(shopGeos, shopMat);
  addMerged(roofGeos, roofMat);
  addMerged(trimGeos, trimMat);

  // ---- Distant skyline beyond the grid ------------------------------------------
  {
    const sky: THREE.Matrix4[] = [];
    for (let k = 0; k < (low ? 60 : 140); k++) {
      const a = rng() * Math.PI * 2;
      const r = 760 + rng() * 280;
      const w = 30 + rng() * 40;
      const h = 40 + rng() ** 2 * 200;
      sky.push(mm.compose(new THREE.Vector3(Math.cos(a) * r - 60, h / 2, Math.sin(a) * r + 180), qq.setFromAxisAngle(UP, rng()), new THREE.Vector3(w, h, w)).clone());
    }
    const skyline = new THREE.InstancedMesh(keep(texturedBox(1, 1, 1, 1 / 3, 1 / 5)), facadeMats[0]!, sky.length);
    sky.forEach((x, i) => skyline.setMatrixAt(i, x));
    group.add(skyline);
  }

  // ---- Road markings: zebra crossings at every junction, centre lines on side streets
  const paint = keep(new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -4 }));
  const yellow = keep(new THREE.MeshStandardMaterial({ color: 0xe8c23a, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -4 }));
  const zebra: THREE.Matrix4[] = [];
  const dashes: THREE.Matrix4[] = [];
  for (const sx of X_STREETS) {
    for (const sz of Z_STREETS) {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        // Crossing across the arm (dx, dz), 2 m past the junction box.
        const cx = sx + dx * (ROAD_HALF + 2.2);
        const cz = sz + dz * (ROAD_HALF + 2.2);
        for (let k = -ROAD_HALF + 0.8; k < ROAD_HALF - 0.4; k += 1.4) {
          const px = dx ? cx : sx + k;
          const pz = dz ? cz : sz + k;
          zebra.push(mm.compose(new THREE.Vector3(px, 0.045, pz), qq.identity(), new THREE.Vector3(dx ? 3 : 0.7, 0.02, dx ? 0.7 : 3)).clone());
        }
      }
    }
  }
  const sideStreet = (x0: number, z0: number, x1: number, z1: number): void => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const ux = (x1 - x0) / len;
    const uz = (z1 - z0) / len;
    for (let k = ROAD_HALF + 6; k < len - ROAD_HALF - 6; k += 9) {
      const px = x0 + ux * k;
      const pz = z0 + uz * k;
      if (onCourse(px, pz, 4)) continue;
      dashes.push(mm.compose(new THREE.Vector3(px, 0.045, pz), qq.identity(), new THREE.Vector3(ux ? 4 : 0.22, 0.02, uz ? 4 : 0.22)).clone());
    }
  };
  for (const sx of X_STREETS) for (let j = 0; j < Z_STREETS.length - 1; j++) sideStreet(sx, Z_STREETS[j]!, sx, Z_STREETS[j + 1]!);
  for (const sz of Z_STREETS) for (let i = 0; i < X_STREETS.length - 1; i++) sideStreet(X_STREETS[i]!, sz, X_STREETS[i + 1]!, sz);
  const unit = keep(new THREE.BoxGeometry(1, 1, 1));
  const zebraMesh = new THREE.InstancedMesh(unit, paint, zebra.length);
  zebra.forEach((x, i) => zebraMesh.setMatrixAt(i, x));
  zebraMesh.receiveShadow = true;
  const dashMesh = new THREE.InstancedMesh(unit, yellow, Math.max(dashes.length, 1));
  dashes.forEach((x, i) => dashMesh.setMatrixAt(i, x));
  dashMesh.count = dashes.length;
  group.add(zebraMesh, dashMesh);

  // ---- Street trees, lamps, traffic lights --------------------------------------
  const treeMat = keep(propMaterial());
  // Night: foliage only catches lamplight.
  treeMat.color.setRGB(0.45, 0.5, 0.45);
  const treeMesh = new THREE.InstancedMesh(keep(roundTree(0x2c5a28, 0x5e8a3e, 5)), treeMat, trees.length);
  trees.forEach((x, i) => treeMesh.setMatrixAt(i, x));
  treeMesh.castShadow = true;
  group.add(treeMesh);

  const metal = keep(new THREE.MeshStandardMaterial({ color: 0x3b3e43, roughness: 0.5, metalness: 0.6 }));
  const lampGeo = keep(
    mergeGeometries([
      new THREE.CylinderGeometry(0.09, 0.13, 8.5, 8).translate(0, 4.25, 0).toNonIndexed(),
      new THREE.BoxGeometry(0.12, 0.12, 2.6).translate(0, 8.4, 1.3).toNonIndexed(),
    ]) ?? new THREE.BufferGeometry(),
  );
  const lampMesh = new THREE.InstancedMesh(lampGeo, metal, lamps.length);
  const headMesh = new THREE.InstancedMesh(
    keep(new THREE.BoxGeometry(0.5, 0.18, 0.9).translate(0, 8.3, 2.5)),
    keep(new THREE.MeshBasicMaterial({ color: LAMP.clone().multiplyScalar(4) })),
    lamps.length,
  );
  lamps.forEach((x, i) => {
    lampMesh.setMatrixAt(i, x);
    headMesh.setMatrixAt(i, x);
  });
  lampMesh.castShadow = true;
  group.add(lampMesh, headMesh);

  // Pools of warm light on the road under every lamp (and fainter ones on side streets).
  const poolTex = keep(
    canvasTexture(128, (c, sz) => {
      const gr = c.createRadialGradient(sz / 2, sz / 2, 0, sz / 2, sz / 2, sz / 2);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.45, 'rgba(255,255,255,0.45)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = gr;
      c.fillRect(0, 0, sz, sz);
    }),
  );
  const pools: THREE.Matrix4[] = [];
  const lampHead = new THREE.Vector3();
  for (const x of lamps) {
    lampHead.set(0, 0, 2.5).applyMatrix4(x);
    pools.push(mm.compose(new THREE.Vector3(lampHead.x, 0.06, lampHead.z), qq.identity(), new THREE.Vector3(15, 1, 15)).clone());
  }
  for (const x of trees) {
    if (rng() < 0.6) continue;
    const p = new THREE.Vector3().setFromMatrixPosition(x);
    pools.push(mm.compose(new THREE.Vector3(p.x, CURB + 0.05, p.z), qq.identity(), new THREE.Vector3(9, 1, 9)).clone());
  }
  const poolMesh = new THREE.InstancedMesh(
    keep(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)),
    keep(new THREE.MeshBasicMaterial({ map: poolTex, color: LAMP.clone().multiplyScalar(0.55), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6 })),
    pools.length,
  );
  pools.forEach((x, i) => poolMesh.setMatrixAt(i, x));
  poolMesh.renderOrder = 1;
  group.add(poolMesh);

  // Traffic signals at the corners of junctions on the course.
  const signals: THREE.Matrix4[] = [];
  for (const sx of X_STREETS) {
    for (const sz of Z_STREETS) {
      if (!onCourse(sx, sz, 10)) continue;
      for (const [cx, cz] of [[1, 1], [-1, -1]] as const) {
        signals.push(mm.compose(new THREE.Vector3(sx + cx * (ROAD_HALF + 1), CURB, sz + cz * (ROAD_HALF + 1)), qq.setFromAxisAngle(UP, Math.atan2(-cx, -cz)), new THREE.Vector3(1, 1, 1)).clone());
      }
    }
  }
  const signalPole = keep(
    mergeGeometries([
      new THREE.CylinderGeometry(0.12, 0.14, 6, 8).translate(0, 3, 0).toNonIndexed(),
      new THREE.BoxGeometry(0.16, 0.16, 6).translate(0, 5.8, 3).toNonIndexed(),
      new THREE.BoxGeometry(0.45, 1.3, 0.4).translate(0, 5.2, 5.5).toNonIndexed(),
    ]) ?? new THREE.BufferGeometry(),
  );
  const signalMesh = new THREE.InstancedMesh(signalPole, metal, Math.max(signals.length, 1));
  const lightMesh = new THREE.InstancedMesh(
    keep(new THREE.SphereGeometry(0.13, 8, 6).translate(0, 4.8, 5.28)),
    keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 3, 0.8) })),
    Math.max(signals.length, 1),
  );
  signals.forEach((x, i) => {
    signalMesh.setMatrixAt(i, x);
    lightMesh.setMatrixAt(i, x);
  });
  signalMesh.count = lightMesh.count = signals.length;
  group.add(signalMesh, lightMesh);

  // Parked cars.
  group.add(buildParkedVehicles(parked, 13));

  // ---- Road works chicane ---------------------------------------------------------
  const blink: THREE.Mesh[] = [];
  {
    const stripe = keep(
      canvasTexture(128, (c, sz) => {
        c.fillStyle = '#e8e6e0';
        c.fillRect(0, 0, sz, sz);
        c.fillStyle = '#c62828';
        for (let k = -sz; k < sz * 2; k += 32) {
          c.beginPath();
          c.moveTo(k, 0);
          c.lineTo(k + 16, 0);
          c.lineTo(k + 16 + sz * 0.5, sz);
          c.lineTo(k + sz * 0.5, sz);
          c.fill();
        }
      }),
    );
    const barrierMat = keep(new THREE.MeshStandardMaterial({ map: stripe, roughness: 0.7 }));
    const coneMat = keep(new THREE.MeshStandardMaterial({ color: 0xff6a13, roughness: 0.5, emissive: 0x401400 }));
    const amber = keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 2.2, 0.3) }));
    // Jersey barrier: wide foot, narrow top.
    const jersey = keep(
      mergeGeometries([
        new THREE.BoxGeometry(3, 0.35, 0.7).translate(0, 0.175, 0).toNonIndexed(),
        new THREE.BoxGeometry(3, 0.55, 0.32).translate(0, 0.62, 0).toNonIndexed(),
      ]) ?? new THREE.BufferGeometry(),
    );
    const cone = keep(new THREE.ConeGeometry(0.2, 0.7, 12).translate(0, 0.35, 0));
    const lampGeo = keep(new THREE.SphereGeometry(0.12, 10, 8));
    for (const [z, side] of CHICANE) {
      // Barrier line from the kerb to the centre line.
      const x0 = CHICANE_X + side * ROAD_HALF;
      const x1 = CHICANE_X + side * 0.2;
      const cx = (x0 + x1) / 2;
      const len = Math.abs(x1 - x0);
      for (let k = 0; k < 3; k++) {
        const b = new THREE.Mesh(jersey, barrierMat);
        b.position.set(x0 + (x1 - x0) * ((k + 0.5) / 3), 0, z);
        b.castShadow = true;
        b.receiveShadow = true;
        group.add(b);
        const lamp = new THREE.Mesh(lampGeo, amber);
        lamp.position.set(b.position.x, 1.05, z);
        group.add(lamp);
        blink.push(lamp);
      }
      solid(cx, 0.45, z, len / 2, 0.45, 0.35);
      // Cones tapering in ahead of each barrier.
      for (let k = 1; k <= 4; k++) {
        const c = new THREE.Mesh(cone, coneMat);
        c.position.set(x0 - side * (k * 1.9), 0, z + 4 + k * 2.2);
        c.castShadow = true;
        group.add(c);
      }
    }
    // Lit arrow board warning of the works ahead (both pavements).
    const arrowTex = keep(
      canvasTexture(128, (c, sz) => {
        c.fillStyle = '#111';
        c.fillRect(0, 0, sz, sz);
        c.fillStyle = '#ffb21a';
        for (let k = 0; k < 3; k++) {
          const x = 14 + k * 36;
          c.beginPath();
          c.moveTo(x, 30);
          c.lineTo(x + 22, sz / 2);
          c.lineTo(x, sz - 30);
          c.lineTo(x + 10, sz - 30);
          c.lineTo(x + 32, sz / 2);
          c.lineTo(x + 10, 30);
          c.fill();
        }
      }),
    );
    for (const side of [-1, 1]) {
      const board = new THREE.Mesh(
        keep(new THREE.PlaneGeometry(2.4, 1.4)),
        keep(new THREE.MeshBasicMaterial({ map: arrowTex, color: new THREE.Color(1.8, 1.8, 1.8), side: THREE.DoubleSide })),
      );
      board.position.set(CHICANE_X + side * (ROAD_HALF + 1.2), 2.4, 278);
      group.add(board);
      const pole = new THREE.Mesh(unit, metal);
      pole.scale.set(0.12, 1.8, 0.12);
      pole.position.set(board.position.x, 0.9, 278.05);
      group.add(pole);
    }
  }

  // ---- Pedestrians ------------------------------------------------------------
  const peds = new Pedestrians(walkPaths, low ? 90 : 260, rng);
  group.add(peds.group);

  // ---- Traffic along the course -------------------------------------------------
  const trafficLine = buildTrafficLine(def.trackSpline.map((p) => new THREE.Vector3(...p)));
  // Keep traffic away from the jumps: only on the stretches between them.
  const segs = trafficSegments(trafficLine, [
    ...def.stunts.filter((s) => s.type === 'kicker' || s.type === 'carRow').map((s) => new THREE.Vector3(...s.position)),
    new THREE.Vector3(CHICANE_X, 0, 246),
  ]);
  const traffic: TrafficCar[] = [];
  const trafficKinds: ParkedVehicleKind[] = ['sedan', 'suv', 'robotaxi', 'sedan', 'boxTruck', 'pickup', 'suv'];
  let n = 0;
  for (const seg of segs) {
    const count = Math.max(1, Math.round((seg.s1 - seg.s0) / (low ? 110 : 70)));
    for (let k = 0; k < count; k++) {
      const dir: 1 | -1 = k % 3 === 2 ? -1 : 1;
      const kind = trafficKinds[n++ % trafficKinds.length]!;
      const shape = vehicleShape(kind);
      const g = buildParkedVehicles([{ kind, matrix: new THREE.Matrix4().makeRotationY(Math.PI / 2) }], n * 3);
      group.add(g);
      const body = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -50, 0));
      const c = physics.world.createCollider(
        R.ColliderDesc.cuboid(shape.width / 2, shape.height / 2, shape.length / 2)
          .setTranslation(0, shape.height / 2, 0)
          .setCollisionGroups(GROUP_TRAFFIC)
          .setFriction(0.5),
        body,
      );
      physics.obstacles.add(c.handle);
      traffic.push({
        group: g,
        body,
        lane: dir === 1 ? 4.2 : -4.2,
        dir,
        speed: kind === 'boxTruck' ? 11 : 13 + rng() * 5,
        seg,
        s: seg.s0 + ((k + 0.5) / count) * (seg.s1 - seg.s0),
        parked: false,
      });
    }
  }
  const pose = new THREE.Vector3();
  const ahead = new THREE.Vector3();
  const tq = new THREE.Quaternion();
  const placeTraffic = (car: TrafficCar): void => {
    trafficLine.at(car.s, pose, ahead);
    const rx = -ahead.z;
    const rz = ahead.x;
    pose.x += rx * car.lane;
    pose.z += rz * car.lane;
    const yaw = Math.atan2(-ahead.x * car.dir, -ahead.z * car.dir);
    tq.setFromAxisAngle(UP, yaw);
    car.group.position.copy(pose);
    car.group.quaternion.copy(tq);
    car.body.setNextKinematicTranslation(pose);
    car.body.setNextKinematicRotation(tq);
  };
  traffic.forEach(placeTraffic);
  traffic.forEach((c) => {
    c.body.setTranslation(c.group.position, true);
    c.body.setRotation(c.group.quaternion, true);
  });

  // ---- Sky and light ------------------------------------------------------------
  const sky = new SkyDome(NIGHT.sky);
  // A small pale moon.
  sky.setSun(new THREE.Vector3(-60, 90, 40), 0xdfe6ff, 0.25, 0.99985);
  group.add(sky.mesh);
  applyLighting(renderer, NIGHT);

  let blinkT = 0;
  let trainZ = METRO.z0;
  let trainDir = -1;
  const camPos = new THREE.Vector3();
  return {
    group,
    colliders,
    heightAt: () => 0,
    update(dt, _elapsed, camera) {
      sky.follow(camera);
      camPos.copy(camera.position);
      peds.update(dt, camPos);
      blinkT += dt;
      const on = Math.floor(blinkT * 2.2) % 2 === 0;
      blink.forEach((l, i) => (l.visible = on !== (i % 2 === 0)));
      trainZ += trainDir * 16 * dt;
      if (trainZ < METRO.z1 + 70) trainDir = 1;
      else if (trainZ > METRO.z0) trainDir = -1;
      train.position.z = trainZ;
      train.rotation.y = trainDir < 0 ? 0 : Math.PI;
      for (const car of traffic) {
        car.s += car.dir * car.speed * dt;
        const out = car.dir > 0 ? car.s > car.seg.s1 : car.s < car.seg.s0;
        if (out) {
          // Re-enter at the far end of its stretch, but never right in front of the player.
          const s = car.dir > 0 ? car.seg.s0 : car.seg.s1;
          trafficLine.at(s, pose, ahead);
          if (pose.distanceTo(camPos) < 140) {
            car.s = car.dir > 0 ? car.seg.s1 : car.seg.s0;
            car.group.visible = false;
            car.body.setNextKinematicTranslation({ x: 0, y: -50, z: 0 });
            car.parked = true;
            continue;
          }
          car.s = s;
          car.parked = false;
          car.group.visible = true;
        }
        if (!car.parked) placeTraffic(car);
      }
    },
    dispose() {
      peds.dispose();
      for (const c of traffic) physics.world.removeRigidBody(c.body);
      disposables.forEach((d) => d.dispose());
    },
  };
}

/** Arc-length parametrised polyline of the course for driving traffic along. */
function buildTrafficLine(points: THREE.Vector3[]): { length: number; at(s: number, out: THREE.Vector3, dir: THREE.Vector3): void } {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const pts = curve.getSpacedPoints(Math.ceil(curve.getLength() / 2));
  const dist = [0];
  for (let i = 1; i < pts.length; i++) dist.push(dist[i - 1]! + pts[i]!.distanceTo(pts[i - 1]!));
  const length = dist[dist.length - 1]!;
  return {
    length,
    at(s, out, dir) {
      const c = THREE.MathUtils.clamp(s, 0, length);
      let lo = 0;
      let hi = dist.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (dist[mid]! <= c) lo = mid;
        else hi = mid;
      }
      const u = (c - dist[lo]!) / Math.max(dist[hi]! - dist[lo]!, 1e-6);
      out.lerpVectors(pts[lo]!, pts[hi]!, u);
      out.y = 0;
      dir.subVectors(pts[hi]!, pts[lo]!).setY(0).normalize();
    },
  };
}

/** Stretches of the course well clear of every jump's run-up and landing, and of the starting straight. */
function trafficSegments(line: ReturnType<typeof buildTrafficLine>, jumps: THREE.Vector3[]): { s0: number; s1: number }[] {
  const blocked: boolean[] = [];
  const p = new THREE.Vector3();
  const d = new THREE.Vector3();
  const step = 4;
  for (let s = 0; s <= line.length; s += step) {
    line.at(s, p, d);
    blocked.push(s < 200 || s > line.length - 40 || jumps.some((j) => Math.hypot(j.x - p.x, j.z - p.z) < 130));
  }
  const segs: { s0: number; s1: number }[] = [];
  let start = -1;
  blocked.forEach((b, i) => {
    if (!b && start < 0) start = i;
    if ((b || i === blocked.length - 1) && start >= 0) {
      const s0 = start * step;
      const s1 = i * step;
      if (s1 - s0 > 60) segs.push({ s0, s1 });
      start = -1;
    }
  });
  return segs;
}
