import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/** Joints that the showroom animates (all rotate about their local axes). */
export interface RobotJoints {
  readonly root: THREE.Group;
  readonly hips: THREE.Group;
  readonly torso: THREE.Group;
  readonly head: THREE.Group;
  readonly shoulderL: THREE.Group;
  readonly shoulderR: THREE.Group;
  readonly elbowL: THREE.Group;
  readonly elbowR: THREE.Group;
  readonly hipL: THREE.Group;
  readonly hipR: THREE.Group;
  readonly kneeL: THREE.Group;
  readonly kneeR: THREE.Group;
}

/**
 * A humanoid robot in the style of a modern general-purpose robot: glossy white shell
 * panels, black joints and hands, and a dark glass face. About 1.73 m tall. No logos.
 * Local forward is -Z; feet on y = 0.
 */
export function createOptimus(): { joints: RobotJoints; dispose(): void } {
  const geos: THREE.BufferGeometry[] = [];
  const g = <T extends THREE.BufferGeometry>(x: T): T => {
    geos.push(x);
    return x;
  };
  const shell = new THREE.MeshPhysicalMaterial({ color: 0xf3f3f1, roughness: 0.28, metalness: 0.05, clearcoat: 0.8, clearcoatRoughness: 0.1 });
  const joint = new THREE.MeshStandardMaterial({ color: 0x17181b, roughness: 0.45, metalness: 0.4 });
  const visor = new THREE.MeshPhysicalMaterial({ color: 0x050607, roughness: 0.04, metalness: 0.6, clearcoat: 1, clearcoatRoughness: 0.02 });
  const mats = [shell, joint, visor];

  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };
  const group = (parent: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Group => {
    const gr = new THREE.Group();
    gr.position.set(x, y, z);
    parent.add(gr);
    return gr;
  };

  const root = new THREE.Group();
  root.name = 'optimus';
  const hips = group(root, 0, 0.94, 0);
  hips.add(mesh(g(new RoundedBoxGeometry(0.34, 0.16, 0.2, 3, 0.05)), shell));
  hips.add(mesh(g(new THREE.CylinderGeometry(0.1, 0.12, 0.12, 16)), joint, 0, 0.1, 0));

  // Torso pivots at the waist.
  const torso = group(hips, 0, 0.12, 0);
  torso.add(mesh(g(new THREE.CylinderGeometry(0.13, 0.11, 0.16, 18)), joint, 0, 0.08, 0));
  torso.add(mesh(g(new RoundedBoxGeometry(0.4, 0.34, 0.23, 4, 0.08)), shell, 0, 0.33, 0));
  // Chest plate and a dark battery band.
  torso.add(mesh(g(new RoundedBoxGeometry(0.3, 0.16, 0.05, 3, 0.02)), shell, 0, 0.38, -0.115));
  torso.add(mesh(g(new THREE.BoxGeometry(0.36, 0.03, 0.235)), joint, 0, 0.19, 0));
  torso.add(mesh(g(new THREE.CylinderGeometry(0.045, 0.05, 0.09, 12)), joint, 0, 0.54, 0));

  const head = group(torso, 0, 0.57, 0);
  head.add(mesh(g(new RoundedBoxGeometry(0.19, 0.23, 0.21, 4, 0.07)), shell, 0, 0.1, 0.01));
  // Face: a dark curved glass visor covering the front.
  const face = mesh(g(new THREE.SphereGeometry(0.105, 24, 16, Math.PI * 1.15, Math.PI * 0.7, Math.PI * 0.22, Math.PI * 0.55)), visor, 0, 0.1, 0);
  face.scale.set(0.95, 1.15, 1.07);
  head.add(face);

  const arm = (side: number): { shoulder: THREE.Group; elbow: THREE.Group } => {
    const shoulder = group(torso, side * 0.235, 0.44, 0);
    shoulder.add(mesh(g(new THREE.SphereGeometry(0.065, 16, 12)), joint));
    shoulder.add(mesh(g(new THREE.CapsuleGeometry(0.052, 0.2, 4, 12)), shell, 0, -0.16, 0));
    const elbow = group(shoulder, 0, -0.3, 0);
    elbow.add(mesh(g(new THREE.SphereGeometry(0.045, 14, 10)), joint));
    elbow.add(mesh(g(new THREE.CapsuleGeometry(0.045, 0.18, 4, 12)), shell, 0, -0.14, 0));
    // Black hand with a thumb.
    elbow.add(mesh(g(new RoundedBoxGeometry(0.06, 0.11, 0.08, 2, 0.02)), joint, 0, -0.32, 0));
    elbow.add(mesh(g(new RoundedBoxGeometry(0.025, 0.06, 0.025, 2, 0.01)), joint, side * -0.035, -0.3, -0.035));
    return { shoulder, elbow };
  };
  const armL = arm(-1);
  const armR = arm(1);

  const leg = (side: number): { hip: THREE.Group; knee: THREE.Group } => {
    const hip = group(hips, side * 0.1, -0.06, 0);
    hip.add(mesh(g(new THREE.SphereGeometry(0.07, 14, 10)), joint));
    hip.add(mesh(g(new THREE.CapsuleGeometry(0.075, 0.28, 4, 12)), shell, 0, -0.22, 0));
    const knee = group(hip, 0, -0.43, 0);
    knee.add(mesh(g(new THREE.SphereGeometry(0.055, 14, 10)), joint));
    knee.add(mesh(g(new THREE.CapsuleGeometry(0.062, 0.28, 4, 12)), shell, 0, -0.21, 0));
    knee.add(mesh(g(new RoundedBoxGeometry(0.1, 0.06, 0.24, 2, 0.02)), joint, 0, -0.42, -0.04));
    return { hip, knee };
  };
  const legL = leg(-1);
  const legR = leg(1);

  return {
    joints: {
      root,
      hips,
      torso,
      head,
      shoulderL: armL.shoulder,
      shoulderR: armR.shoulder,
      elbowL: armL.elbow,
      elbowR: armR.elbow,
      hipL: legL.hip,
      hipR: legR.hip,
      kneeL: legL.knee,
      kneeR: legR.knee,
    },
    dispose() {
      geos.forEach((x) => x.dispose());
      mats.forEach((m) => m.dispose());
    },
  };
}
