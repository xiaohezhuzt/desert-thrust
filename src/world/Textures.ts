import * as THREE from 'three';
import { createRng } from '../core/Random';

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

export function sandTexture(): THREE.CanvasTexture {
  return canvasTexture(512, (ctx, s) => {
    ctx.fillStyle = '#c99a63';
    ctx.fillRect(0, 0, s, s);
    const rng = createRng(7);
    for (let i = 0; i < 9000; i++) {
      const v = 160 + rng() * 60;
      ctx.fillStyle = `rgba(${v + 30},${v},${v - 50},0.18)`;
      ctx.fillRect(rng() * s, rng() * s, 2, 2);
    }
    // 20 m grid so speed is readable.
    ctx.strokeStyle = 'rgba(90,60,30,0.35)';
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(90,60,30,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(s / 2, 0);
    ctx.lineTo(s / 2, s);
    ctx.moveTo(0, s / 2);
    ctx.lineTo(s, s / 2);
    ctx.stroke();
  });
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
