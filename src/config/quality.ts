export type QualityTier = 'low' | 'medium' | 'high';

export const TIER_ORDER: readonly QualityTier[] = ['low', 'medium', 'high'];

export interface QualitySettings {
  readonly tier: QualityTier;
  /** Upper bound applied to window.devicePixelRatio. */
  readonly maxPixelRatio: number;
  readonly shadows: boolean;
  /** Number of shadow cascades (0 = off). Stage 1 renders a single follow-shadow. */
  readonly shadowCascades: number;
  readonly shadowMapSize: number;
  readonly bloom: boolean;
  readonly chromaticAberration: boolean;
  readonly motionBlur: boolean;
  readonly maxParticles: number;
  /** Camera far plane / fog end, metres. */
  readonly viewDistance: number;
  /** Fixed physics rate. */
  readonly physicsHz: number;
  /** Clearcoat MeshPhysicalMaterial for car paint (vs MeshStandardMaterial). */
  readonly physicalPaint: boolean;
  readonly minimap: boolean;
  readonly maxAnisotropy: number;
}

export const QUALITY: Record<QualityTier, QualitySettings> = {
  low: {
    tier: 'low',
    maxPixelRatio: 1.0,
    shadows: false,
    shadowCascades: 0,
    shadowMapSize: 0,
    bloom: false,
    chromaticAberration: false,
    motionBlur: false,
    maxParticles: 200,
    viewDistance: 400,
    physicsHz: 60,
    physicalPaint: false,
    minimap: false,
    maxAnisotropy: 1,
  },
  medium: {
    tier: 'medium',
    maxPixelRatio: 1.5,
    shadows: true,
    shadowCascades: 1,
    shadowMapSize: 1024,
    bloom: true,
    chromaticAberration: false,
    motionBlur: false,
    maxParticles: 600,
    viewDistance: 800,
    physicsHz: 120,
    physicalPaint: true,
    minimap: true,
    maxAnisotropy: 4,
  },
  high: {
    tier: 'high',
    maxPixelRatio: 2.0,
    shadows: true,
    shadowCascades: 2,
    shadowMapSize: 2048,
    bloom: true,
    chromaticAberration: true,
    motionBlur: true,
    maxParticles: 1500,
    viewDistance: 1500,
    physicsHz: 120,
    physicalPaint: true,
    minimap: true,
    maxAnisotropy: 8,
  },
};

/** Runtime auto-downgrade policy. */
export const AUTO_DOWNGRADE = {
  fpsThreshold: 45,
  sustainSeconds: 3,
  sampleWindow: 0.5,
  warmupSeconds: 2,
  /** First drop render scale to this before dropping a tier. */
  firstRenderScale: 0.85,
  /** Floor for render scale once already on the lowest tier. */
  minRenderScale: 0.6,
  renderScaleStep: 0.1,
} as const;

/** iOS Safari WebGL memory is limited; never allocate textures above this. */
export const MAX_TEXTURE_SIZE = 2048;
