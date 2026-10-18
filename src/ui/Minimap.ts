import type * as THREE from 'three';

const SIZE = 128;

/** Top-down track outline with racer dots (hidden on the low tier). */
export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly path: Path2D;
  private readonly minX: number;
  private readonly minZ: number;
  private readonly scale: number;
  private readonly offX: number;
  private readonly offY: number;

  constructor(parent: HTMLElement, points: readonly THREE.Vector3[]) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'minimap';
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = this.canvas.height = SIZE * dpr;
    parent.appendChild(this.canvas);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    ctx.scale(dpr, dpr);
    this.ctx = ctx;

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    const pad = 12;
    this.scale = (SIZE - pad * 2) / Math.max(maxX - minX, maxZ - minZ, 1);
    this.minX = minX;
    this.minZ = minZ;
    this.offX = pad + (SIZE - pad * 2 - (maxX - minX) * this.scale) / 2;
    this.offY = pad + (SIZE - pad * 2 - (maxZ - minZ) * this.scale) / 2;
    this.path = new Path2D();
    points.forEach((p, i) => {
      const [x, y] = this.map(p.x, p.z);
      if (i === 0) this.path.moveTo(x, y);
      else this.path.lineTo(x, y);
    });
  }

  dispose(): void {
    this.canvas.remove();
  }

  private map(x: number, z: number): [number, number] {
    return [this.offX + (x - this.minX) * this.scale, this.offY + (z - this.minZ) * this.scale];
  }

  draw(player: THREE.Vector3, playerRot: THREE.Quaternion, others: readonly THREE.Vector3[]): void {
    const c = this.ctx;
    c.clearRect(0, 0, SIZE, SIZE);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.strokeStyle = 'rgba(255,255,255,0.18)';
    c.lineWidth = 7;
    c.stroke(this.path);
    c.strokeStyle = 'rgba(255,255,255,0.75)';
    c.lineWidth = 2.5;
    c.stroke(this.path);
    c.fillStyle = '#ff5a4a';
    for (const o of others) {
      const [x, y] = this.map(o.x, o.z);
      c.beginPath();
      c.arc(x, y, 3.2, 0, Math.PI * 2);
      c.fill();
    }
    const [px, py] = this.map(player.x, player.z);
    // Heading arrow from the car's forward (-Z) direction.
    const fx = -2 * (playerRot.x * playerRot.z + playerRot.w * playerRot.y);
    const fz = -(1 - 2 * (playerRot.x * playerRot.x + playerRot.y * playerRot.y));
    const a = Math.atan2(fz, fx);
    c.save();
    c.translate(px, py);
    c.rotate(a);
    c.fillStyle = '#5fd4ff';
    c.beginPath();
    c.moveTo(7, 0);
    c.lineTo(-5, 4.5);
    c.lineTo(-5, -4.5);
    c.closePath();
    c.fill();
    c.restore();
  }
}
