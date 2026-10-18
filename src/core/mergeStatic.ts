import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Merge the plain (single-material) meshes under `root` that share a material into
 * one mesh each, baked into `root`'s local space. Fewer draw calls on mobile.
 * Multi-material meshes, LOD nodes and anything under `keep` stay untouched.
 */
export function mergeStaticByMaterial(root: THREE.Object3D, keep: (o: THREE.Object3D) => boolean = () => false): void {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; meshes: THREE.Mesh[]; shadow: boolean }>();
  const visit = (o: THREE.Object3D): void => {
    if (o !== root && (keep(o) || o instanceof THREE.LOD)) return;
    if (o instanceof THREE.Mesh && !Array.isArray(o.material) && !(o instanceof THREE.InstancedMesh)) {
      const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()) as THREE.BufferGeometry;
      for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      let entry = groups.get(o.material);
      if (!entry) groups.set(o.material, (entry = { geos: [], meshes: [], shadow: false }));
      entry.geos.push(g);
      entry.meshes.push(o);
      entry.shadow ||= o.castShadow;
    }
    for (const c of [...o.children]) visit(c);
  };
  visit(root);
  for (const [mat, { geos, meshes, shadow }] of groups) {
    if (meshes.length < 2) {
      geos.forEach((g) => g.dispose());
      continue;
    }
    const merged = mergeGeometries(geos);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    for (const m of meshes) {
      m.removeFromParent();
      m.geometry.dispose();
    }
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    root.add(mesh);
  }
}
