import * as THREE from 'three';
import {
  BloomEffect,
  ChromaticAberrationEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
} from 'postprocessing';
import type { QualitySettings } from '../config/quality';
import { RadialBlurEffect } from '../fx/RadialBlurEffect';

const SHADOW_EXTENT = 45;
const SUN_OFFSET = new THREE.Vector3(-60, 90, 40);

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;

  private composer: EffectComposer | null = null;
  private radialBlur: RadialBlurEffect | null = null;
  private quality: QualitySettings;
  private renderScale = 1;
  private width = 1;
  private height = 1;
  private resizeQueued = false;
  private readonly onResize = (): void => this.queueResize();

  constructor(private readonly container: HTMLElement, quality: QualitySettings) {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // Count draw calls across all post-processing passes of a frame (reset manually below).
    this.renderer.info.autoReset = false;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, quality.viewDistance);

    this.hemi = new THREE.HemisphereLight(0xbfd6ff, 0x8a6a48, 0.45);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffe2b8, 2.6);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    const sc = this.sun.shadow.camera;
    sc.left = -SHADOW_EXTENT;
    sc.right = SHADOW_EXTENT;
    sc.top = SHADOW_EXTENT;
    sc.bottom = -SHADOW_EXTENT;
    sc.near = 1;
    sc.far = 300;
    this.scene.add(this.sun, this.sun.target);

    this.applyQuality(quality);

    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', this.onResize);
    window.visualViewport?.addEventListener('resize', this.onResize);
  }

  get maxAnisotropy(): number {
    return Math.min(this.quality.maxAnisotropy, this.renderer.capabilities.getMaxAnisotropy());
  }

  /** Drawing-buffer height in device pixels (for point-sprite sizing). */
  get drawingHeight(): number {
    return this.renderer.domElement.height;
  }

  get currentQuality(): QualitySettings {
    return this.quality;
  }

  get currentRenderScale(): number {
    return this.renderScale;
  }

  applyQuality(q: QualitySettings): void {
    this.quality = q;

    this.renderer.shadowMap.enabled = q.shadows;
    this.sun.castShadow = q.shadows;
    if (q.shadows && this.sun.shadow.mapSize.x !== q.shadowMapSize) {
      this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    // Shadow program variants differ, so materials must recompile.
    this.scene.traverse((o) => {
      const m = (o as Partial<THREE.Mesh>).material;
      if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
      else if (m) m.needsUpdate = true;
    });

    this.camera.far = q.viewDistance;
    this.camera.updateProjectionMatrix();
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.near = q.viewDistance * 0.35;
      this.scene.fog.far = q.viewDistance * 0.98;
    }

    this.rebuildComposer();
    this.resize();
  }

  /** Boost / speed zoom blur, 0..1 (no-op on the low tier). */
  setBlur(amount: number): void {
    if (this.radialBlur) this.radialBlur.strength = amount;
  }

  setRenderScale(scale: number): void {
    this.renderScale = THREE.MathUtils.clamp(scale, 0.4, 1);
    this.resize();
  }

  /** Bake `envScene` into a prefiltered environment map used for reflections. */
  setEnvironment(envScene: THREE.Scene): void {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const rt = pmrem.fromScene(envScene, 0.02);
    this.scene.environment?.dispose();
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = 0.8;
    pmrem.dispose();
  }

  setFog(color: THREE.ColorRepresentation): void {
    this.scene.fog = new THREE.Fog(color, this.quality.viewDistance * 0.35, this.quality.viewDistance * 0.98);
  }

  /** Keep the shadow frustum centred on the player. */
  followShadow(target: THREE.Vector3): void {
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).add(SUN_OFFSET);
  }

  render(deltaSeconds: number): void {
    this.renderer.info.reset();
    if (this.resizeQueued) this.resize();
    if (this.composer) this.composer.render(deltaSeconds);
    else this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('orientationchange', this.onResize);
    window.visualViewport?.removeEventListener('resize', this.onResize);
    this.composer?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private queueResize(): void {
    this.resizeQueued = true;
  }

  private resize(): void {
    this.resizeQueued = false;
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.width = w;
    this.height = h;
    const ratio = Math.min(window.devicePixelRatio || 1, this.quality.maxPixelRatio) * this.renderScale;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private rebuildComposer(): void {
    this.composer?.dispose();
    this.composer = null;
    this.radialBlur = null;

    if (!this.quality.bloom && !this.quality.chromaticAberration) {
      // Low tier: no post stack, tone map directly in the material shaders.
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.0;
      return;
    }

    this.renderer.toneMapping = THREE.NoToneMapping;
    const composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType });
    composer.addPass(new RenderPass(this.scene, this.camera));

    const toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    if (this.quality.bloom) {
      const bloom = new BloomEffect({
        intensity: 1.1,
        luminanceThreshold: 0.9,
        luminanceSmoothing: 0.15,
        mipmapBlur: true,
      });
      composer.addPass(new EffectPass(this.camera, bloom, toneMapping));
    } else {
      composer.addPass(new EffectPass(this.camera, toneMapping));
    }

    // Zoom blur for boosts (and speed-based "motion blur" on high).
    this.radialBlur = new RadialBlurEffect();
    composer.addPass(new EffectPass(this.camera, this.radialBlur));

    if (this.quality.chromaticAberration) {
      const ca = new ChromaticAberrationEffect({
        offset: new THREE.Vector2(0.0007, 0.0007),
        radialModulation: true,
        modulationOffset: 0.35,
      });
      composer.addPass(new EffectPass(this.camera, ca));
    }
    // Motion blur (high tier) arrives with the camera/FX stage.

    this.composer = composer;
    this.composer.setSize(this.width, this.height, false);
  }
}
