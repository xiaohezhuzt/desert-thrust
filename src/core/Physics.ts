import type RAPIER from '@dimforge/rapier3d-compat';
import type { Surface } from '../config/tuning';

export type Rapier = typeof RAPIER;

/**
 * Load the Rapier WASM module (its own chunk, fetched in parallel with the rest of boot).
 * Throws if WebAssembly is unavailable or the fetch fails.
 */
export async function loadRapier(): Promise<Rapier> {
  const mod = await import('@dimforge/rapier3d-compat');
  const R = mod.default;
  await R.init();
  return R;
}

/** Maps a hit collider (and hit position) to a ground surface type. */
export type SurfaceResolver = (collider: RAPIER.Collider, x: number, z: number) => Surface;

export class Physics {
  readonly world: RAPIER.World;
  private readonly surfaces = new Map<number, Surface | SurfaceResolver>();
  /** Colliders that pull the car onto them (loops, wall rides). */
  readonly adhesive = new Set<number>();
  /** Colliders that count as hitting a stunt obstacle (parked cars). */
  readonly obstacles = new Set<number>();

  constructor(readonly R: Rapier) {
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
  }

  step(dt: number): void {
    this.world.timestep = dt;
    this.world.step();
  }

  /** Register what a collider is made of: a fixed surface or a per-position resolver. */
  setSurface(collider: RAPIER.Collider, surface: Surface | SurfaceResolver): void {
    this.surfaces.set(collider.handle, surface);
  }

  surfaceAt(collider: RAPIER.Collider, x: number, z: number): Surface {
    const s = this.surfaces.get(collider.handle);
    if (s === undefined) return 'asphalt';
    return typeof s === 'function' ? s(collider, x, z) : s;
  }

  /** Remove colliders and their tags (level unload). */
  removeColliders(colliders: readonly RAPIER.Collider[]): void {
    for (const c of colliders) {
      this.surfaces.delete(c.handle);
      this.adhesive.delete(c.handle);
      this.obstacles.delete(c.handle);
      this.world.removeCollider(c, false);
    }
  }

  dispose(): void {
    this.world.free();
    this.surfaces.clear();
  }
}
