/**
 * Generates the PWA / home-screen icons as PNGs with no dependencies
 * (pure pixel drawing + zlib).   node scripts/make-icons.mjs
 */
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Draw in a 0..1 design space; `pad` shrinks the art for maskable icons. */
function draw(size, pad) {
  const buf = Buffer.alloc(size * size * 4);
  // Wedge supercar silhouette (side view, facing right) + canopy + wheels + rear jets.
  const body = [[0.2, 0.62], [0.3, 0.55], [0.55, 0.5], [0.82, 0.56], [0.86, 0.6], [0.84, 0.66], [0.2, 0.66]];
  const canopy = [[0.38, 0.53], [0.47, 0.44], [0.6, 0.45], [0.72, 0.53]];
  const wing = [[0.18, 0.47], [0.3, 0.47], [0.3, 0.5], [0.25, 0.55], [0.22, 0.5]];
  const wheels = [[0.33, 0.665, 0.065], [0.71, 0.665, 0.065]];
  const S = 4; // supersampling
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const u0 = (px + (sx + 0.5) / S) / size;
          const v0 = (py + (sy + 0.5) / S) / size;
          const u = (u0 - 0.5) / (1 - pad * 2) + 0.5;
          const v = (v0 - 0.5) / (1 - pad * 2) + 0.5;
          // Background: night sky into a warm desert horizon.
          let c;
          const sky = Math.min(1, v0 / 0.72);
          c = [11 + 30 * sky, 13 + 18 * sky, 28 + 30 * (1 - sky)];
          if (v0 > 0.66) c = [210, 120, 60];
          if (v0 > 0.7) c = [150, 82, 42];
          const glow = Math.max(0, 1 - Math.hypot(u0 - 0.5, v0 - 0.66) / 0.55);
          c = [c[0] + 120 * glow * glow, c[1] + 60 * glow * glow, c[2] + 20 * glow * glow];
          // Blue jet flames streaming left from the tail.
          for (const [fy, fl] of [[0.6, 0.18], [0.63, 0.14]]) {
            const t = (0.2 - u) / fl;
            if (t > 0 && t < 1 && Math.abs(v - fy) < 0.018 * (1 - t)) c = [120 + 135 * (1 - t), 200 + 55 * (1 - t), 255];
          }
          if (inPoly(u, v, wing) || inPoly(u, v, body)) c = [242, 242, 238];
          if (inPoly(u, v, canopy)) c = [24, 28, 36];
          if (v > 0.585 && v < 0.6 && u > 0.78 && u < 0.86) c = [230, 246, 255];
          for (const [wx, wy, wr] of wheels) {
            const d = Math.hypot(u - wx, v - wy);
            if (d < wr) c = d < wr * 0.55 ? [230, 230, 228] : [18, 18, 20];
          }
          r += c[0];
          g += c[1];
          b += c[2];
        }
      }
      const i = (py * size + px) * 4;
      buf[i] = Math.min(255, r / (S * S));
      buf[i + 1] = Math.min(255, g / (S * S));
      buf[i + 2] = Math.min(255, b / (S * S));
      buf[i + 3] = 255;
    }
  }
  return png(size, buf);
}

writeFileSync('public/icons/icon-192.png', draw(192, 0.02));
writeFileSync('public/icons/icon-512.png', draw(512, 0.02));
writeFileSync('public/icons/maskable-512.png', draw(512, 0.12));
writeFileSync('public/icons/apple-touch-icon.png', draw(180, 0.04));
writeFileSync('public/favicon.png', draw(64, 0));
console.log('icons written');
