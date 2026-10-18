import * as THREE from 'three';

/** Release GPU resources of everything under `root` (used when switching levels). */
export function disposeObject(root: THREE.Object3D): void {
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();
  root.traverse((obj) => {
    const mesh = obj as Partial<THREE.Mesh>;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const mat = mesh.material;
    if (Array.isArray(mat)) mat.forEach((m) => materials.add(m));
    else if (mat) materials.add(mat);
  });
  for (const m of materials) {
    for (const value of Object.values(m)) {
      if (value instanceof THREE.Texture) value.dispose();
    }
    m.dispose();
  }
  for (const g of geometries) g.dispose();
  root.removeFromParent();
}
