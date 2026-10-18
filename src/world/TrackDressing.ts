import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LevelDef, RoadDef } from '../config/levels';
import type { QualityTier } from '../config/quality';
import { createRng } from '../core/Random';
import { canvasTexture } from './Textures';

/** Biome-specific dressing colours. */
export interface DressingStyle {
  /** grass / sand band just outside the road edge */
  readonly verge: number;
  readonly kerbA: number;
  readonly kerbB: number;
  /** bunting / balloon palette */
  readonly festive: readonly number[];
  /** emissive bulbs on the bunting (night levels) */
  readonly lights?: boolean;
  /** city streets: no kerbs, verges, flags, tyres, balloons or grandstand; just the start / finish gantries */
  readonly urban?: boolean;
}

export interface TrackDressing {
  readonly group: THREE.Group;
  update(dt: number): void;
  dispose(): void;
}

const KERB_WIDTH = 0.95;
const KERB_LENGTH = 3;
const VERGE_WIDTH = 4;

interface Sample {
  p: THREE.Vector3;
  right: THREE.Vector3;
  fwd: THREE.Vector3;
  /** signed heading change over ±30 m (positive = turning left) */
  turn: number;
}

function samplesOf(line: readonly THREE.Vector3[]): Sample[] {
  const out: Sample[] = [];
  for (let i = 0; i < line.length; i++) {
    const a = line[Math.max(i - 1, 0)]!;
    const b = line[Math.min(i + 1, line.length - 1)]!;
    const fwd = new THREE.Vector3().subVectors(b, a).setY(0).normalize();
    out.push({ p: line[i]!, fwd, right: new THREE.Vector3(-fwd.z, 0, fwd.x), turn: 0 });
  }
  const span = 10;
  for (let i = 0; i < out.length; i++) {
    const f0 = out[Math.max(i - span, 0)]!.fwd;
    const f1 = out[Math.min(i + span, out.length - 1)]!.fwd;
    out[i]!.turn = Math.atan2(f0.x * f1.z - f0.z * f1.x, f0.x * f1.x + f0.z * f1.z) * -1;
  }
  return out;
}

function chevronTexture(): THREE.CanvasTexture {
  return canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#ffd21f';
    ctx.fillRect(0, 0, s, s / 2);
    ctx.fillStyle = '#181818';
    for (let k = 0; k < 3; k++) {
      const x = 30 + k * 75;
      ctx.beginPath();
      ctx.moveTo(x, 18);
      ctx.lineTo(x + 40, s / 4);
      ctx.lineTo(x, s / 2 - 18);
      ctx.lineTo(x + 22, s / 2 - 18);
      ctx.lineTo(x + 62, s / 4);
      ctx.lineTo(x + 22, 18);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = '#e8322c';
    ctx.fillRect(0, s / 2, s, s / 2);
  });
}

function checkerTexture(): THREE.CanvasTexture {
  return canvasTexture(256, (ctx, s) => {
    const n = 8;
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < n; x++) {
        ctx.fillStyle = (x + y) % 2 ? '#111' : '#f5f5f5';
        ctx.fillRect((x * s) / n, (y * s) / 4, s / n, s / 4);
      }
    }
    ctx.fillStyle = '#e8322c';
    ctx.fillRect(0, s / 2, s, s / 4);
    ctx.fillStyle = '#ffd21f';
    ctx.fillRect(0, (s * 3) / 4, s, s / 4);
  });
}

/**
 * Kart-racer trackside dressing generated from the level's roads: red/white kerbs,
 * grass verges, corner chevrons, tyre walls, flag poles with bunting,
 * start / finish arches with balloons, and a little grandstand crowd.
 */
export function buildTrackDressing(
  def: LevelDef,
  lines: readonly THREE.Vector3[][],
  style: DressingStyle,
  tier: QualityTier,
): TrackDressing {
  const group = new THREE.Group();
  group.name = 'track-dressing';
  const rng = createRng(def.id * 31 + 7);
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const low = tier === 'low';

  // ---- Kerbs and verges --------------------------------------------------------
  const kerbPos: number[] = [];
  const kerbCol: number[] = [];
  const vergePos: number[] = [];
  const vergeUv: number[] = [];
  const kA = new THREE.Color(style.kerbA);
  const kB = new THREE.Color(style.kerbB);
  const quad = (out: number[], a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3): void => {
    out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, b.x, b.y, b.z, d.x, d.y, d.z, c.x, c.y, c.z);
  };
  const v = (s: Sample, off: number, lift: number): THREE.Vector3 =>
    s.p.clone().addScaledVector(s.right, off).setY(s.p.y + lift);

  const allSamples: { road: RoadDef; samples: Sample[] }[] = [];
  (style.urban ? [] : def.roads).forEach((road, ri) => {
    const line = lines[ri];
    if (!line) return;
    const samples = samplesOf(line);
    allSamples.push({ road, samples });
    const paved = !road.style || road.style === 'asphalt' || road.style === 'wet';
    const hw = road.width / 2;
    let dist = 0;
    for (let i = 0; i < samples.length - 1; i++) {
      const s0 = samples[i]!;
      const s1 = samples[i + 1]!;
      dist += s0.p.distanceTo(s1.p);
      if (paved) {
        const c = Math.floor(dist / KERB_LENGTH) % 2 ? kA : kB;
        for (const side of [-1, 1]) {
          const inner = side * (hw - KERB_WIDTH);
          const outer = side * hw;
          if (side > 0) quad(kerbPos, v(s0, inner, 0.09), v(s0, outer, 0.09), v(s1, inner, 0.09), v(s1, outer, 0.09));
          else quad(kerbPos, v(s0, outer, 0.09), v(s0, inner, 0.09), v(s1, outer, 0.09), v(s1, inner, 0.09));
          for (let k = 0; k < 6; k++) kerbCol.push(c.r, c.g, c.b);
        }
      }
      if (!road.elevated) {
        const v0 = (dist - s0.p.distanceTo(s1.p)) / 4;
        const v1 = dist / 4;
        for (const side of [-1, 1]) {
          const a = side * hw;
          const b = side * (hw + VERGE_WIDTH);
          if (side > 0) {
            quad(vergePos, v(s0, a, -0.12), v(s0, b, -0.2), v(s1, a, -0.12), v(s1, b, -0.2));
            vergeUv.push(0, v0, 1, v0, 0, v1, 1, v0, 1, v1, 0, v1);
          } else {
            quad(vergePos, v(s0, b, -0.2), v(s0, a, -0.12), v(s1, b, -0.2), v(s1, a, -0.12));
            vergeUv.push(1, v0, 0, v0, 1, v1, 0, v0, 0, v1, 1, v1);
          }
        }
      }
    }
  });
  if (kerbPos.length) {
    const g = keep(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.Float32BufferAttribute(kerbPos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(kerbCol, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(
      g,
      keep(
        new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.6,
          polygonOffset: true,
          polygonOffsetFactor: -4,
          polygonOffsetUnits: -4,
        }),
      ),
    );
    m.receiveShadow = true;
    group.add(m);
  }
  if (vergePos.length) {
    const g = keep(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.Float32BufferAttribute(vergePos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(vergeUv, 2));
    g.computeVertexNormals();
    const base = new THREE.Color(style.verge);
    const grassy = base.g > base.r * 1.15 && base.g > base.b;
    const vergeTex = keep(
      canvasTexture(128, (ctx, sz) => {
        // Mowed-lawn stripes on grass; fine speckle on sand / snow.
        const light = base.clone().multiplyScalar(grassy ? 1.12 : 1.04);
        const dark = base.clone().multiplyScalar(grassy ? 0.86 : 0.95);
        ctx.fillStyle = `#${light.getHexString()}`;
        ctx.fillRect(0, 0, sz, sz);
        ctx.fillStyle = `#${dark.getHexString()}`;
        ctx.fillRect(0, 0, sz, sz / 2);
        for (let i = 0; i < 900; i++) {
          ctx.fillStyle = `rgba(${grassy ? '20,60,10' : '90,70,40'},${Math.random() * 0.12})`;
          ctx.fillRect(Math.random() * sz, Math.random() * sz, 2, 2);
        }
      }),
    );
    vergeTex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(
      g,
      keep(
        new THREE.MeshStandardMaterial({
          map: vergeTex,
          roughness: 0.95,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        }),
      ),
    );
    m.receiveShadow = true;
    group.add(m);
  }

  // ---- Corner chevrons and tyre walls -------------------------------------------
  const chevronMat = keep(new THREE.MeshStandardMaterial({ map: keep(chevronTexture()), roughness: 0.5, side: THREE.DoubleSide }));
  const boardGeo = keep(new THREE.PlaneGeometry(2.6, 1.3));
  // Use only the top (chevron) half of the texture on the board.
  {
    const uv = boardGeo.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 0.5 + uv.getY(i) * 0.5);
  }
  const postGeo = keep(new THREE.CylinderGeometry(0.08, 0.08, 1.6, 6).translate(0, 0.8, 0));
  const tyreGeo = keep(new THREE.TorusGeometry(0.5, 0.22, 8, 16).rotateX(Math.PI / 2));
  const boards: THREE.Matrix4[] = [];
  const posts: THREE.Matrix4[] = [];
  const tyres: THREE.Matrix4[] = [];
  const tyreColors: THREE.Color[] = [];
  for (const { road, samples } of allSamples) {
    const hw = road.width / 2;
    for (let i = 0; i < samples.length; i += low ? 6 : 4) {
      const s = samples[i]!;
      if (Math.abs(s.turn) < 0.5) continue;
      const side = s.turn > 0 ? 1 : -1; // outside of the bend
      const base = road.barriers ? 1.0 : 0;
      const at = s.p.clone().addScaledVector(s.right, side * (hw + (road.barriers ? 0.2 : 4.5)));
      // Face oncoming traffic; arrows point into the turn.
      dummy.position.set(at.x, s.p.y + base + 1.85, at.z);
      dummy.rotation.set(0, Math.atan2(-s.fwd.x, -s.fwd.z), 0);
      dummy.scale.set(side > 0 ? -1 : 1, 1, 1);
      dummy.updateMatrix();
      boards.push(dummy.matrix.clone());
      dummy.position.y = s.p.y + base;
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      posts.push(dummy.matrix.clone());
      if (!road.barriers && !road.elevated && !low) {
        for (let k = -1; k <= 1; k++) {
          const t = s.p.clone().addScaledVector(s.right, side * (hw + 7)).addScaledVector(s.fwd, k * 1.1);
          for (let h = 0; h < 3; h++) {
            dummy.position.set(t.x, s.p.y - 0.25 + 0.22 + h * 0.44, t.z);
            dummy.rotation.set(0, 0, 0);
            dummy.updateMatrix();
            tyres.push(dummy.matrix.clone());
            tyreColors.push(color.set(h === 2 ? (k % 2 ? style.kerbA : 0xf5f5f5) : 0x1b1b1d).clone());
          }
        }
      }
    }
  }
  const instanced = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    list: readonly THREE.Matrix4[],
    colors?: readonly THREE.Color[],
  ): void => {
    if (!list.length) return;
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((mm, i) => {
      m.setMatrixAt(i, mm);
      if (colors) m.setColorAt(i, colors[i]!);
    });
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  };
  const steel = keep(new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.4, metalness: 0.7 }));
  instanced(boardGeo, chevronMat, boards);
  instanced(postGeo, steel, posts);
  instanced(tyreGeo, keep(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 })), tyres, tyreColors);

  // ---- Flag poles with bunting along the straights -------------------------------
  const poleGeo = keep(new THREE.CylinderGeometry(0.12, 0.16, 7, 8).translate(0, 3.5, 0));
  const flagGeo = keep(new THREE.BufferGeometry());
  flagGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, -1.4, 0, 2.4, -0.7, 0], 3));
  flagGeo.computeVertexNormals();
  const pennantGeo = keep(new THREE.BufferGeometry());
  pennantGeo.setAttribute('position', new THREE.Float32BufferAttribute([-0.32, 0, 0, 0.32, 0, 0, 0, -0.75, 0], 3));
  pennantGeo.computeVertexNormals();
  const poles: THREE.Matrix4[] = [];
  const flags: THREE.Matrix4[] = [];
  const flagCols: THREE.Color[] = [];
  const pennants: THREE.Matrix4[] = [];
  const pennantCols: THREE.Color[] = [];
  const pick = (): THREE.Color => new THREE.Color(style.festive[Math.floor(rng() * style.festive.length)]!);
  for (const { road, samples } of allSamples) {
    if (road.elevated) continue;
    const hw = road.width / 2;
    const every = low ? 22 : 14; // samples are ~3 m apart
    for (const side of [-1, 1]) {
      let prev: THREE.Vector3 | null = null;
      for (let i = 4; i < samples.length - 4; i += every) {
        const s = samples[i]!;
        if (Math.abs(s.turn) > 0.35) {
          prev = null;
          continue;
        }
        const at = s.p.clone().addScaledVector(s.right, side * (hw + 6));
        at.y = s.p.y - 0.3;
        dummy.position.copy(at);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        poles.push(dummy.matrix.clone());
        dummy.position.set(at.x, at.y + 7, at.z);
        dummy.rotation.set(0, Math.atan2(s.fwd.x, s.fwd.z) + Math.PI / 2, 0);
        dummy.updateMatrix();
        flags.push(dummy.matrix.clone());
        flagCols.push(pick());
        if (prev && !low) {
          // Sagging string of pennants between this pole and the previous one.
          const top0 = prev.clone().setY(prev.y + 6.2);
          const top1 = at.clone().setY(at.y + 6.2);
          const n = 12;
          for (let k = 1; k < n; k++) {
            const t = k / n;
            const p = top0.clone().lerp(top1, t);
            p.y -= Math.sin(t * Math.PI) * 1.4;
            dummy.position.copy(p);
            dummy.rotation.set(0, Math.atan2(top1.x - top0.x, top1.z - top0.z) + Math.PI / 2, 0);
            dummy.updateMatrix();
            pennants.push(dummy.matrix.clone());
            pennantCols.push(new THREE.Color(style.festive[k % style.festive.length]!));
          }
        }
        prev = at;
      }
    }
  }
  const white = keep(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, side: THREE.DoubleSide }));
  instanced(poleGeo, steel, poles);
  instanced(flagGeo, white, flags, flagCols);
  if (style.lights) {
    instanced(pennantGeo, keep(new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })), pennants, pennantCols.map((c) => c.multiplyScalar(2.2)));
  } else {
    instanced(pennantGeo, white, pennants, pennantCols);
  }

  // ---- Start / finish arches with balloons ---------------------------------------
  const balloons: { mesh: THREE.InstancedMesh; base: THREE.Matrix4[]; phase: number[] } = {
    mesh: new THREE.InstancedMesh(keep(new THREE.SphereGeometry(0.9, 14, 10).scale(1, 1.18, 1)), keep(new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.1 })), low ? 16 : 40),
    base: [],
    phase: [],
  };
  const checker = keep(checkerTexture());
  const beamMat = keep(new THREE.MeshStandardMaterial({ map: checker, roughness: 0.6 }));
  const pillarMat = keep(new THREE.MeshStandardMaterial({ color: style.kerbA, roughness: 0.5 }));
  const arch = (pos: THREE.Vector3, heading: number, width: number): void => {
    const g = new THREE.Group();
    const span = width / 2 + 2.5;
    for (const side of [-1, 1]) {
      const pillar = new THREE.Mesh(keep(new THREE.BoxGeometry(1.4, 10, 1.4)), pillarMat);
      pillar.position.set(side * span, 5, 0);
      pillar.castShadow = true;
      g.add(pillar);
    }
    const beam = new THREE.Mesh(keep(new THREE.BoxGeometry(span * 2 + 1.4, 2.6, 1.2)), beamMat);
    beam.position.y = 10.6;
    beam.castShadow = true;
    g.add(beam);
    g.position.copy(pos);
    g.rotation.y = heading;
    group.add(g);
    // Balloon bunches on top of both pillars.
    for (const side of [-1, 1]) {
      for (let k = 0; k < (style.urban ? 0 : low ? 4 : 10); k++) {
        if (balloons.base.length >= balloons.mesh.count) break;
        const local = new THREE.Vector3(side * span + (rng() - 0.5) * 2.4, 12.5 + rng() * 2.5, (rng() - 0.5) * 2.4);
        local.applyAxisAngle(new THREE.Vector3(0, 1, 0), heading).add(pos);
        dummy.position.copy(local);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        balloons.base.push(dummy.matrix.clone());
        balloons.phase.push(rng() * Math.PI * 2);
        balloons.mesh.setColorAt(balloons.base.length - 1, pick());
      }
    }
  };
  const start = new THREE.Vector3(...def.start.position);
  const sf = new THREE.Vector3(-Math.sin(def.start.heading), 0, -Math.cos(def.start.heading));
  const firstRoad = def.roads[0];
  arch(start.clone().addScaledVector(sf, 12).setY(start.y - 0.2), def.start.heading, firstRoad?.width ?? 16);
  const fin = new THREE.Vector3(...def.finish.center);
  arch(fin.clone().setY(fin.y - 2.2), def.finish.heading, (def.roads[def.roads.length - 1]?.width ?? 16) + 2);
  balloons.mesh.count = balloons.base.length;
  balloons.mesh.castShadow = true;
  group.add(balloons.mesh);

  // ---- Grandstand with a crowd beside the start ----------------------------------
  if (firstRoad && !firstRoad.elevated && !style.urban) {
    const right = new THREE.Vector3(-sf.z, 0, sf.x);
    const base = start.clone().addScaledVector(right, firstRoad.width / 2 + 13).addScaledVector(sf, -10);
    const stand = new THREE.Group();
    const standMat = keep(new THREE.MeshStandardMaterial({ color: 0x9aa3b0, roughness: 0.8 }));
    for (let row = 0; row < 4; row++) {
      const step = new THREE.Mesh(keep(new THREE.BoxGeometry(4, 1 + row * 1.1, 46)), standMat);
      step.position.set(row * 3.2, (1 + row * 1.1) / 2, 0);
      step.receiveShadow = true;
      stand.add(step);
    }
    const roof = new THREE.Mesh(keep(new THREE.BoxGeometry(15, 0.4, 48)), keep(new THREE.MeshStandardMaterial({ color: 0xc9ccd1, roughness: 0.45, metalness: 0.6 })));
    roof.position.set(5, 8.5, 0);
    roof.castShadow = true;
    stand.add(roof);
    // Spectators: seated bodies in everyday clothes with heads (no toy colours).
    const crowdMat = keep(new THREE.MeshStandardMaterial({ roughness: 0.8 }));
    const n = low ? 60 : 160;
    const bodies = new THREE.InstancedMesh(keep(new THREE.CapsuleGeometry(0.26, 0.5, 3, 8)), crowdMat, n);
    const heads = new THREE.InstancedMesh(keep(new THREE.SphereGeometry(0.15, 10, 8)), crowdMat, n);
    const clothes = [0x2f4f7f, 0xe8e4da, 0x3a3a3c, 0x6c8a5a, 0xc8322c, 0x1f2a44, 0x8a8f96, 0xd8c7a2, 0x5a3f2e, 0x2b8a8a];
    const skin = [0xf1c9a5, 0xd9a77e, 0xa8774f, 0x7a5236, 0xe8b893];
    for (let i = 0; i < n; i++) {
      const row = i % 4;
      dummy.position.set(row * 3.2 - 0.6 + (rng() - 0.5) * 1.6, 1 + row * 1.1 + 0.62, (rng() - 0.5) * 44);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      bodies.setMatrixAt(i, dummy.matrix);
      bodies.setColorAt(i, color.set(clothes[Math.floor(rng() * clothes.length)]!));
      dummy.position.y += 0.62;
      dummy.updateMatrix();
      heads.setMatrixAt(i, dummy.matrix);
      heads.setColorAt(i, color.set(skin[Math.floor(rng() * skin.length)]!));
    }
    stand.add(bodies, heads);
    stand.position.set(base.x, start.y - 0.3, base.z);
    stand.rotation.y = def.start.heading;
    group.add(stand);
  }

  let t = 0;
  const m = new THREE.Matrix4();
  return {
    group,
    update(dt) {
      t += dt;
      balloons.base.forEach((b, i) => {
        m.copy(b);
        m.elements[13] += Math.sin(t * 1.3 + balloons.phase[i]!) * 0.25;
        balloons.mesh.setMatrixAt(i, m);
      });
      balloons.mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      disposables.forEach((d) => d.dispose());
      balloons.mesh.dispose();
    },
  };
}

/** Merge helper re-exported for biome code that wants plain merged meshes. */
export function mergeAll(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts) ?? new THREE.BufferGeometry();
  parts.forEach((p) => p.dispose());
  return g;
}
