import * as THREE from 'three';
import { createRng } from '../core/Random';
import { makeNoise } from './Terrain';

/** Procedural canvas textures (kept ≤ 2048 px for iOS). */
export function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Wind-rippled sand height (0..1) on a seamless 512 tile. */
function sandHeight(s: number): Float32Array {
  const noise = makeNoise(41);
  const h = new Float32Array(s * s);
  const TAU = Math.PI * 2;
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      // Seamless: sample noise on a torus.
      const u = (x / s) * TAU;
      const v = (y / s) * TAU;
      const nx = Math.cos(u) * 1.6;
      const nz = Math.sin(u) * 1.6;
      const warp = noise(nx + Math.cos(v) * 1.6, nz + Math.sin(v) * 1.6) * 0.9;
      // Ripples run across the tile (whole number of crests so it tiles), bent by the warp.
      const ripple = Math.sin(v * 14 + warp * 3.2 + noise(nx * 3, Math.sin(v) * 3) * 0.6);
      const sharp = Math.pow(ripple * 0.5 + 0.5, 1.6);
      h[y * s + x] = sharp * 0.75 + (noise(nx * 6 + 9, Math.cos(v) * 6) * 0.5 + 0.5) * 0.25;
    }
  }
  return h;
}

let sandHeightCache: Float32Array | null = null;
const SAND = 512;

export function sandTexture(): THREE.CanvasTexture {
  return canvasTexture(SAND, (ctx, s) => {
    sandHeightCache ??= sandHeight(s);
    const h = sandHeightCache;
    const img = ctx.createImageData(s, s);
    const rng = createRng(7);
    for (let i = 0; i < s * s; i++) {
      // Crests catch light, troughs collect darker coarse grains.
      const k = 0.86 + h[i]! * 0.16 + (rng() - 0.5) * 0.12;
      img.data[i * 4] = Math.min(255, 214 * k);
      img.data[i * 4 + 1] = Math.min(255, 178 * k);
      img.data[i * 4 + 2] = Math.min(255, 132 * k);
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    // Scattered pebbles and darker grit.
    for (let i = 0; i < 1400; i++) {
      const v = 90 + rng() * 70;
      ctx.fillStyle = `rgba(${v + 20},${v},${v - 20},${0.25 + rng() * 0.4})`;
      const r = 0.6 + rng() * 1.6;
      ctx.beginPath();
      ctx.arc(rng() * s, rng() * s, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/** Normal map for the sand ripples (same tile as `sandTexture`). */
export function sandNormalTexture(): THREE.CanvasTexture {
  const tex = canvasTexture(SAND, (ctx, s) => {
    sandHeightCache ??= sandHeight(s);
    const h = sandHeightCache;
    const img = ctx.createImageData(s, s);
    const at = (x: number, y: number): number => h[((y + s) % s) * s + ((x + s) % s)]!;
    const strength = 3.2;
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
        const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
        const len = Math.hypot(dx, dy, 1);
        const i = (y * s + x) * 4;
        img.data[i] = (-dx / len) * 127 + 128;
        img.data[i + 1] = (dy / len) * 127 + 128;
        img.data[i + 2] = (1 / len) * 127 + 128;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

export function runwayTexture(): THREE.CanvasTexture {
  return canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#3a3a3e';
    ctx.fillRect(0, 0, s, s);
    const rng = createRng(11);
    for (let i = 0; i < 3000; i++) {
      const v = 40 + rng() * 40;
      ctx.fillStyle = `rgba(${v},${v},${v + 4},0.5)`;
      ctx.fillRect(rng() * s, rng() * s, 1.5, 1.5);
    }
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(6, 0, 6, s);
    ctx.fillRect(s - 12, 0, 6, s);
    ctx.fillStyle = '#ffb000';
    ctx.fillRect(s / 2 - 3, 0, 6, s * 0.5);
  });
}


/** Road surface textures per style (lane markings run along V). */
export function roadTexture(style: 'asphalt' | 'dirt' | 'snow' | 'ice' | 'wet' | 'wood' | 'sand'): THREE.CanvasTexture {
  if (style === 'asphalt' || style === 'wet') {
    const t = runwayTexture();
    return t;
  }
  return canvasTexture(256, (ctx, s) => {
    const rng = createRng(style.length * 31);
    const base: Record<string, string> = {
      dirt: '#8a6a4a',
      snow: '#e9eef5',
      ice: '#bcd8ec',
      wood: '#8b5a34',
      sand: '#d8b07a',
    };
    ctx.fillStyle = base[style] ?? '#888';
    ctx.fillRect(0, 0, s, s);
    if (style === 'wood') {
      for (let y = 0; y < s; y += 16) {
        ctx.fillStyle = `rgba(40,20,5,${0.25 + rng() * 0.2})`;
        ctx.fillRect(0, y, s, 2);
        for (let k = 0; k < 6; k++) {
          ctx.fillStyle = 'rgba(255,220,180,0.06)';
          ctx.fillRect(rng() * s, y + 3 + rng() * 10, 30 + rng() * 60, 1);
        }
      }
      return;
    }
    for (let i = 0; i < 2500; i++) {
      const v = rng();
      ctx.fillStyle = style === 'ice' ? `rgba(255,255,255,${v * 0.25})` : `rgba(0,0,0,${v * 0.12})`;
      ctx.fillRect(rng() * s, rng() * s, 2, 2);
    }
    // Wheel tracks.
    ctx.fillStyle = style === 'snow' ? 'rgba(120,140,160,0.25)' : style === 'ice' ? 'rgba(255,255,255,0.3)' : 'rgba(40,25,10,0.2)';
    for (const x of [0.28, 0.38, 0.62, 0.72]) ctx.fillRect(x * s, 0, s * 0.05, s);
  });
}
