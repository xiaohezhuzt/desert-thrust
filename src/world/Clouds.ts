import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRng } from '../core/Random';

/**
 * Chunky, cartoon cumulus: clusters of soft spheres with flattened bellies,
 * white on top and shaded underneath, drifting slowly on a ring around the course.
 */
export class Clouds {
  readonly group = new THREE.Group();
  private readonly drift: number;

  constructor(opts: {
    count: number;
    radius: [number, number];
    height: [number, number];
    top: THREE.ColorRepresentation;
    belly: THREE.ColorRepresentation;
    seed?: number;
    drift?: number;
    opacity?: number;
  }) {
    this.drift = opts.drift ?? 0.004;
    const rng = createRng(opts.seed ?? 99);
    const top = new THREE.Color(opts.top);
    const belly = new THREE.Color(opts.belly);
    const variants: THREE.BufferGeometry[] = [];
    for (let v = 0; v < 4; v++) {
      const parts: THREE.BufferGeometry[] = [];
      const puffs = 6 + Math.floor(rng() * 5);
      for (let k = 0; k < puffs; k++) {
        const r = 9 + rng() * 11 * (k === 0 ? 1.4 : 1);
        const g = new THREE.IcosahedronGeometry(r, 2);
        g.translate((rng() - 0.5) * 55, rng() * 9, (rng() - 0.5) * 22);
        parts.push(g);
      }
      const merged = mergeGeometries(parts) ?? new THREE.BufferGeometry();
      parts.forEach((g) => g.dispose());
      // Flatten the underside and colour by height (lit top, shaded belly).
      const pos = merged.getAttribute('position') as THREE.BufferAttribute;
      const col = new Float32Array(pos.count * 3);
      const c = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        let y = pos.getY(i);
        if (y < -2) y = -2 - (-2 - y) * 0.25;
        pos.setY(i, y);
        c.copy(belly).lerp(top, THREE.MathUtils.smoothstep(y, -4, 12));
        col.set([c.r, c.g, c.b], i * 3);
      }
      merged.setAttribute('color', new THREE.BufferAttribute(col, 3));
      merged.computeVertexNormals();
      variants.push(merged);
    }
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      fog: false,
      transparent: (opts.opacity ?? 1) < 1,
      opacity: opts.opacity ?? 1,
    });
    const per = Math.ceil(opts.count / variants.length);
    const dummy = new THREE.Object3D();
    variants.forEach((geo) => {
      const inst = new THREE.InstancedMesh(geo, mat, per);
      for (let i = 0; i < per; i++) {
        const a = rng() * Math.PI * 2;
        const d = opts.radius[0] + rng() * (opts.radius[1] - opts.radius[0]);
        dummy.position.set(Math.cos(a) * d, opts.height[0] + rng() * (opts.height[1] - opts.height[0]), Math.sin(a) * d);
        dummy.rotation.set(0, rng() * Math.PI * 2, 0);
        dummy.scale.setScalar(0.7 + rng() * 0.9);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
      }
      inst.frustumCulled = false;
      this.group.add(inst);
    });
    this.group.name = 'clouds';
  }

  update(dt: number, camera: THREE.Camera): void {
    this.group.rotation.y += this.drift * dt;
    // Centre on the camera horizontally so the ring always surrounds the player.
    this.group.position.x = camera.position.x;
    this.group.position.z = camera.position.z;
  }
}
