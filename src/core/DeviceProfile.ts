import { TIER_ORDER, type QualityTier } from '../config/quality';

export interface DeviceProfile {
  readonly isTouch: boolean;
  readonly isIOS: boolean;
  readonly isAndroid: boolean;
  readonly isIPad: boolean;
  readonly isPhone: boolean;
  readonly isTablet: boolean;
  readonly screenShort: number;
  readonly screenLong: number;
  readonly dpr: number;
  readonly gpu: string;
  readonly maxTextureSize: number;
  readonly memoryGB: number | null;
  readonly recommendedTier: QualityTier;
  readonly reason: string;
}

interface GpuInfo {
  renderer: string;
  maxTextureSize: number;
}

function probeGpu(): GpuInfo {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  if (!gl) return { renderer: 'none', maxTextureSize: 0 };
  let renderer = '';
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  if (ext) renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '');
  if (!renderer) renderer = String(gl.getParameter(gl.RENDERER) ?? '');
  const maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 0;
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return { renderer, maxTextureSize };
}

const SOFTWARE_GPU = /swiftshader|llvmpipe|software|basic render|microsoft basic/i;
// Older / weaker mobile GPUs that should start on the low tier.
const WEAK_MOBILE_GPU = /adreno \(tm\) [3-5]\d\d|adreno [3-5]\d\d|mali-[t4]|mali-g(31|51|52|57|68|71|72)|powervr|sgx/i;
// Older integrated desktop GPUs.
const WEAK_DESKTOP_GPU = /intel\(r\) (hd|uhd) graphics( [2-6]\d{2,3})?\b|intel hd|gma/i;

export function detectDeviceProfile(): DeviceProfile {
  const ua = navigator.userAgent;
  const maxTouch = navigator.maxTouchPoints || 0;
  const isTouch = maxTouch > 0 || 'ontouchstart' in window;
  // iPadOS 13+ reports a desktop Mac user agent.
  const isIPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && maxTouch > 1);
  const isIOS = isIPad || /iPhone|iPod/.test(ua);
  const isAndroid = /Android/.test(ua);
  const screenShort = Math.min(screen.width, screen.height);
  const screenLong = Math.max(screen.width, screen.height);
  const isTablet = isIPad || (isAndroid && !/Mobile/.test(ua)) || (isTouch && screenShort >= 700);
  const isPhone = isTouch && !isTablet && (isIOS || isAndroid || screenShort < 700);
  const dpr = window.devicePixelRatio || 1;
  const memoryGB = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null;
  const gpu = probeGpu();

  let tier: QualityTier;
  let reason: string;
  if (gpu.maxTextureSize === 0) {
    tier = 'low';
    reason = 'WebGL probe failed';
  } else if (SOFTWARE_GPU.test(gpu.renderer)) {
    tier = 'low';
    reason = 'software renderer';
  } else if (isPhone) {
    const weak =
      WEAK_MOBILE_GPU.test(gpu.renderer) ||
      gpu.maxTextureSize < 4096 ||
      (memoryGB !== null && memoryGB <= 3);
    tier = weak ? 'low' : 'medium';
    reason = weak ? 'older phone' : 'phone';
  } else if (isTablet) {
    // iPad Pro 12.9" / 13" report a 1024pt short side.
    const pro = isIPad && screenShort >= 1024;
    const weak = WEAK_MOBILE_GPU.test(gpu.renderer) || (memoryGB !== null && memoryGB <= 3);
    tier = weak ? 'low' : pro ? 'high' : 'medium';
    reason = weak ? 'older tablet' : pro ? 'large iPad' : 'tablet';
  } else {
    const weak = WEAK_DESKTOP_GPU.test(gpu.renderer) || (memoryGB !== null && memoryGB <= 4);
    tier = weak ? 'medium' : 'high';
    reason = weak ? 'integrated GPU' : 'desktop';
  }

  return {
    isTouch,
    isIOS,
    isAndroid,
    isIPad,
    isPhone,
    isTablet,
    screenShort,
    screenLong,
    dpr,
    gpu: gpu.renderer,
    maxTextureSize: gpu.maxTextureSize,
    memoryGB,
    recommendedTier: tier,
    reason,
  };
}

export function lowerTier(tier: QualityTier): QualityTier | null {
  const i = TIER_ORDER.indexOf(tier);
  return i > 0 ? TIER_ORDER[i - 1]! : null;
}

export function isQualityTier(v: unknown): v is QualityTier {
  return typeof v === 'string' && (TIER_ORDER as readonly string[]).includes(v);
}
