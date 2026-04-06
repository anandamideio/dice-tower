/**
 * DiceBox — Three.js WebGPU rendering core for Dice Tower.
 *
 * Manages:
 *  - WebGPURenderer (auto-fallback to WebGL 2)
 *  - Canvas overlay positioning over the Foundry UI
 *  - Scene, PerspectiveCamera, lighting, environment mapping
 *  - Shadow-receiver ground plane (desk)
 *  - Node-based post-processing pipeline (bloom, SMAA, outline)
 *  - requestAnimationFrame render loop with start/stop control
 *  - Auto-hide after roll settles
 *
 * Stage 3 of the Dice Tower implementation plan.
 * Physics integration (frame replay) is wired in Stage 5.
 */

import {
  ACESFilmicToneMapping,
  Clock,
  Color,
  CubeTextureLoader,
  DirectionalLight,
  HalfFloatType,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PCFShadowMap,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Raycaster,
  RenderPipeline,
  Scene,
  ShadowMaterial,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  WebGPURenderer,
} from 'three/webgpu';
import { emissive, mrt, output, pass, uniform } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import { outline } from 'three/addons/tsl/display/OutlineNode.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

import type {
  DisplayMetrics,
  QualitySettings,
  RendererBackend,
} from '../types/rendering.js';

// ─── Configuration passed to DiceBox ─────────────────────────────────────────

export interface DiceBoxConfig extends QualitySettings {
  /** Autoscale dice to viewport. */
  autoscale: boolean;
  /** Manual scale percentage (0–100, used when autoscale is off). */
  scale: number;
  /** Canvas z-index mode: 'over' renders above Foundry canvas, 'under' below. */
  canvasZIndex: 'over' | 'under';
  /** Whether immersive darkness (tone mapping responds to scene darkness). */
  immersiveDarkness: boolean;
  /** Milliseconds before the canvas auto-hides after dice settle. */
  timeBeforeHide: number;
  /** Type qualifier for this box — 'board' (main) or 'showcase' (config preview). */
  boxType: 'board' | 'showcase';
  /** Optional dimensions override; if absent, uses container client size. */
  dimensions?: { width: number; height: number; margin?: BoxMargin };
}

export interface BoxMargin {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

// ─── Internal camera heights ──────────────────────────────────────────────────

interface CameraHeights {
  max: number;
  close: number;
  medium: number;
  far: number;
}

// ─── Bloom configuration (mirrors Dice3D.uniforms) ───────────────────────────

export interface BloomUniforms {
  strength: number;
  radius: number;
  threshold: number;
}

const DEFAULT_BLOOM: BloomUniforms = {
  strength: 1.1,
  radius: 0.2,
  threshold: 0,
};

// ─── DiceBox ──────────────────────────────────────────────────────────────────

export class DiceBox {
  // Core rendering objects
  readonly container: HTMLElement;
  renderer!: WebGPURenderer;
  scene!: Scene;
  camera!: PerspectiveCamera;

  // Lighting
  private light!: DirectionalLight;
  private lightAmb!: HemisphereLight;

  // Ground plane (shadow receiver / raycaster target for mouse drag)
  desk!: Mesh;

  // Display metrics computed from container + config dimensions
  display: DisplayMetrics = {
    currentWidth: null,
    currentHeight: null,
    containerWidth: null,
    containerHeight: null,
    innerWidth: null,
    innerHeight: null,
    aspect: null,
    scale: null,
  };

  private cameraHeight: CameraHeights = { max: 0, close: 0, medium: 0, far: 0 };

  // Post-processing
  private renderPipeline: RenderPipeline | null = null;
  /** Objects highlighted by the outline effect (populated in Stage 5/7). */
  readonly outlineObjects: Object3D[] = [];
  private bloomUniforms: BloomUniforms = { ...DEFAULT_BLOOM };
  private timeUniform = uniform(0);

  // Animation loop
  private animFrameId: number | null = null;
  private hideTimeoutId: ReturnType<typeof setTimeout> | null = null;
  readonly clock = new Clock();

  // Interaction
  readonly raycaster = new Raycaster();

  // State
  isVisible = false;
  /** Whether this box is currently in a roll animation (set by Stage 5). */
  rolling = false;
  /** Detected renderer backend — populated after initialize(). */
  backend: RendererBackend = 'webgl2';

  // Config snapshot
  config: DiceBoxConfig;

  // Rendering quality mirrors (derived from config)
  private realisticLighting = false;
  private anisotropy = 1;

  private constructor(container: HTMLElement, config: DiceBoxConfig) {
    this.container = container;
    this.config = config;
  }

  // ─── Factory ───────────────────────────────────────────────────────────────

  /**
   * Async factory — constructs and fully initializes a DiceBox.
   * Prefer this over `new DiceBox()` + `initialize()` separately.
   */
  static async create(container: HTMLElement, config: DiceBoxConfig): Promise<DiceBox> {
    const box = new DiceBox(container, config);
    await box.initialize();
    return box;
  }

  // ─── Initialization ────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    this.realisticLighting = this.config.imageQuality !== 'low';

    // --- Renderer ---
    this.renderer = new WebGPURenderer({
      antialias: false,
      alpha: true,
      powerPreference: 'high-performance',
      logarithmicDepthBuffer: true,
    });

    if (this.config.useHighDPI) {
      this.renderer.setPixelRatio(window.devicePixelRatio);
    }

    if (this.realisticLighting) {
      this.renderer.toneMapping = ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.0;
    }

    // Detect actual backend after renderer init (async for WebGPU)
    await this.renderer.init();
    const backendInfo = this.renderer.backend as { constructor?: { name?: string } } | undefined;
    const backendName = backendInfo?.constructor?.name?.toLowerCase() ?? '';
    this.backend = backendName.includes('webgpu') ? 'webgpu' : 'webgl2';

    // Shadow map settings
    this.renderer.shadowMap.enabled = this.config.shadowQuality !== 'low' || this.config.imageQuality !== 'low';
    this.renderer.shadowMap.type =
      this.config.shadowQuality === 'high' ? PCFSoftShadowMap : PCFShadowMap;
    this.renderer.setClearColor(0x000000, 0.0);

    // Anisotropy cap
    const caps = (this.renderer as unknown as { capabilities?: { getMaxAnisotropy(): number } }).capabilities;
    const maxAniso = caps?.getMaxAnisotropy?.() ?? 1;
    this.anisotropy = Math.min(maxAniso, 16);

    // Attach canvas to container
    this.container.appendChild(this.renderer.domElement);
    this.applyZIndex();

    // --- Scene ---
    this.scene = new Scene();

    // --- Environment textures (sets scene.environment) ---
    await this.loadEnvironment();

    // --- Camera, lights, desk (all layout-dependent) ---
    this.setScene(this.config.dimensions);

    // --- Post-processing ---
    if (this.realisticLighting) {
      this.setupPostProcessing();
    }
  }

  // ─── Canvas z-index ────────────────────────────────────────────────────────

  private applyZIndex(): void {
    const el = this.renderer.domElement;
    el.style.position = 'absolute';
    el.style.top = '0';
    el.style.left = '0';
    el.style.pointerEvents = 'none'; // mouse events handled by Foundry layer

    if (this.config.canvasZIndex === 'over') {
      // Above the Foundry #board canvas (z-index 0)
      el.style.zIndex = '10';
    } else {
      // Below the Foundry #board canvas
      el.style.zIndex = '-1';
    }
  }

  // ─── Environment mapping ───────────────────────────────────────────────────

  private async loadEnvironment(): Promise<void> {
    if (this.realisticLighting) {
      await this.loadHDREnvironment();
    } else {
      this.loadCubemapEnvironment();
    }
  }

  private loadHDREnvironment(): Promise<void> {
    return new Promise((resolve) => {
      const pmremGen = new PMREMGenerator(
        this.renderer as unknown as ConstructorParameters<typeof PMREMGenerator>[0],
      );
      void pmremGen.compileEquirectangularShader();

      // Load roughness maps for texture cache (used by DiceFactory in Stage 4)
      const texLoader = new TextureLoader();
      const base = 'modules/dice-tower/textures/';
      const roughnessMaps = {
        fingerprint: texLoader.load(base + 'roughnessMap_finger.webp'),
        wood: texLoader.load(base + 'roughnessMap_wood.webp'),
        metal: texLoader.load(base + 'roughnessMap_metal.webp'),
        stone: texLoader.load(base + 'roughnessMap_stone.webp'),
      };
      for (const tex of Object.values(roughnessMaps)) {
        tex.anisotropy = this.anisotropy;
      }
      // Expose for DiceFactory (Stage 4)
      (this.renderer as unknown as Record<string, unknown>).textureCache = {
        roughnessMaps,
      };

      new RGBELoader()
        .setDataType(HalfFloatType)
        .setPath('modules/dice-tower/textures/equirectangular/')
        .load('blouberg_sunrise_2_1k.hdr', (hdrTex) => {
          const envMap = pmremGen.fromEquirectangular(hdrTex).texture;
          envMap.colorSpace = SRGBColorSpace;
          if (this.scene) {
            this.scene.environment = envMap;
          }
          // Cache for reuse
          (this.renderer as unknown as Record<string, unknown>).envMap = envMap;
          hdrTex.dispose();
          pmremGen.dispose();
          resolve();
        });
    });
  }

  private loadCubemapEnvironment(): void {
    const loader = new CubeTextureLoader();
    loader.setPath('modules/dice-tower/textures/cubemap/');
    const cubemap = loader.load(['px.webp', 'nx.webp', 'py.webp', 'ny.webp', 'pz.webp', 'nz.webp']);
    if (this.scene) {
      this.scene.environment = cubemap;
    }
    (this.renderer as unknown as Record<string, unknown>).envMap = cubemap;
  }

  // ─── Scene layout ──────────────────────────────────────────────────────────

  /**
   * (Re-)configures the viewport, camera, lights, and desk.
   * Called on init and on resize/config-change.
   */
  setScene(dimensions?: DiceBoxConfig['dimensions']): void {
    // Compute display dimensions
    this.display.currentWidth =
      this.container.clientWidth > 0
        ? this.container.clientWidth
        : parseInt(this.container.style.width) || 800;
    this.display.currentHeight =
      this.container.clientHeight > 0
        ? this.container.clientHeight
        : parseInt(this.container.style.height) || 600;

    if (dimensions) {
      this.display.containerWidth = dimensions.width;
      this.display.containerHeight = dimensions.height;
      this.display.containerMargin = dimensions.margin ?? null;
      if (!this.display.currentWidth) this.display.currentWidth = dimensions.width;
      if (!this.display.currentHeight) this.display.currentHeight = dimensions.height;
    } else {
      this.display.containerWidth = this.display.currentWidth;
      this.display.containerHeight = this.display.currentHeight;
      this.display.containerMargin = null;
    }

    this.updateInnerDimensions();

    this.display.aspect = Math.min(
      this.display.currentWidth / (this.display.containerWidth ?? 1),
      this.display.currentHeight / (this.display.containerHeight ?? 1),
    );

    this.updateScale(this.config.scale, this.config.autoscale);
    this.renderer.setSize(this.display.currentWidth, this.display.currentHeight);

    this.setupCamera();
    this.setupLighting();
    this.setupDesk();

    // Post-processing resize
    if (this.renderPipeline) {
      this.setupPostProcessing();
    }

    this.renderScene();
  }

  // ─── Camera ────────────────────────────────────────────────────────────────

  private setupCamera(): void {
    const w = this.display.currentWidth ?? 800;
    const h = this.display.currentHeight ?? 600;
    const aspect = this.display.aspect ?? 1;

    // Camera height follows legacy formula: viewport_height / aspect / tan(10°)
    this.cameraHeight.max = h / aspect / Math.tan((10 * Math.PI) / 180);
    this.cameraHeight.medium = this.cameraHeight.max / 1.5;
    this.cameraHeight.far = this.cameraHeight.max;
    this.cameraHeight.close = this.cameraHeight.max / 2;

    if (this.camera) this.scene.remove(this.camera);

    this.camera = new PerspectiveCamera(20, w / h, 10, this.cameraHeight.max * 1.3);

    if (this.config.boxType === 'showcase') {
      // Showcase positions camera based on dice count (populated in Stage 5)
      this.camera.position.z = this.cameraHeight.medium;
    } else {
      this.camera.position.z = this.cameraHeight.far;
    }

    this.camera.lookAt(new Vector3(0, 0, 0));
    this.camera.near = 10;
    this.camera.updateProjectionMatrix();
  }

  // ─── Lighting ──────────────────────────────────────────────────────────────

  private setupLighting(): void {
    const cw = this.display.containerWidth ?? 800;
    const ch = this.display.containerHeight ?? 600;
    const maxDim = Math.max(cw / 2, ch / 2);

    // Remove existing lights
    if (this.light) this.scene.remove(this.light);
    if (this.lightAmb) this.scene.remove(this.lightAmb);

    let directionalIntensity: number;
    let hemisphereIntensity: number;

    const ambientColor = new Color(0xf0f0f0);
    const groundColor = new Color(0x080820);
    let spotlightColor = new Color(0x000000);

    if (this.realisticLighting) {
      directionalIntensity = 1.5;
      hemisphereIntensity = 4.0;
    } else {
      spotlightColor = new Color(0xffffff);
      directionalIntensity = 0.2;
      hemisphereIntensity = 8.0;
    }

    this.lightAmb = new HemisphereLight(ambientColor, groundColor, hemisphereIntensity);
    this.scene.add(this.lightAmb);

    this.light = new DirectionalLight(spotlightColor, directionalIntensity);
    if (this.config.boxType === 'board') {
      this.light.position.set(-cw / 20, ch / 20, maxDim / 2);
    } else {
      this.light.position.set(0, ch / 20, maxDim / 2);
    }
    this.light.target.position.set(0, 0, 0);

    const hasShadows =
      this.renderer.shadowMap.enabled;
    this.light.castShadow = hasShadows;

    if (hasShadows) {
      const shadowMapSize = this.config.shadowQuality === 'high' ? 2048 : 1024;
      this.light.shadow.mapSize.set(shadowMapSize, shadowMapSize);
      this.light.shadow.camera.near = maxDim / 10;
      this.light.shadow.camera.far = maxDim * 5;
      this.light.shadow.bias = -0.0001;

      const halfW = cw / 2;
      const halfH = ch / 2;
      const d = Math.max(halfW, halfH) * 1.05;
      this.light.shadow.camera.left = -d * 2;
      this.light.shadow.camera.right = d * 2;
      this.light.shadow.camera.top = d;
      this.light.shadow.camera.bottom = -d;
    }

    this.scene.add(this.light);
    this.scene.add(this.light.target);
  }

  // ─── Ground plane ──────────────────────────────────────────────────────────

  private setupDesk(): void {
    if (this.desk) {
      this.scene.remove(this.desk);
      this.desk.geometry.dispose();
      (this.desk.material as MeshBasicMaterial).dispose();
    }

    const cw = (this.display.containerWidth ?? 800) * 3;
    const ch = (this.display.containerHeight ?? 600) * 3;
    const shadowPlane = new ShadowMaterial({ opacity: 0.5, depthWrite: false });
    this.desk = new Mesh(new PlaneGeometry(cw, ch, 1, 1), shadowPlane);
    this.desk.receiveShadow = this.renderer.shadowMap.enabled;
    this.desk.position.set(0, 0, -1);
    this.scene.add(this.desk);
  }

  // ─── Scale ─────────────────────────────────────────────────────────────────

  updateScale(scale = 100, autoscale = false): void {
    this.config.autoscale = autoscale;
    this.config.scale = scale;

    if (autoscale) {
      this.display.scale = this.computeAutoScale();
    } else {
      const autoRef = this.computeAutoScale();
      const BASE = 75;
      const pct = Math.min(100, Math.max(0, scale));
      this.display.scale = (autoRef * pct) / BASE || 1;
    }
  }

  private computeAutoScale(): number {
    const w = this.display.innerWidth ?? this.display.containerWidth ?? 800;
    const h = this.display.innerHeight ?? this.display.containerHeight ?? 600;
    return Math.sqrt(w * w + h * h) / 13;
  }

  private updateInnerDimensions(): void {
    const m = this.display.containerMargin;
    const cw = this.display.containerWidth ?? 0;
    const ch = this.display.containerHeight ?? 0;

    if (m) {
      this.display.innerWidth = Math.max(0, cw - (m.left ?? 0) - (m.right ?? 0)) || cw;
      this.display.innerHeight = Math.max(0, ch - (m.top ?? 0) - (m.bottom ?? 0)) || ch;
    } else {
      this.display.innerWidth = cw;
      this.display.innerHeight = ch;
    }
  }

  /** Update physics barrier bounds after a margin/dimension change. */
  updateBoundaries(dimensions: Partial<{ width: number; height: number; margin: BoxMargin }>): void {
    const newDimensions = {
      width: dimensions.width ?? this.display.containerWidth ?? 800,
      height: dimensions.height ?? this.display.containerHeight ?? 600,
      margin: dimensions.margin ?? (this.display.containerMargin as BoxMargin | null) ?? {
        top: 0, bottom: 0, left: 0, right: 0,
      },
    };

    this.display.containerWidth = newDimensions.width;
    this.display.containerHeight = newDimensions.height;
    this.display.containerMargin = newDimensions.margin;

    this.updateInnerDimensions();
    this.updateScale(this.config.scale, this.config.autoscale);
    // Physics worker notification is handled by the caller (DiceBoxController, Stage 5)
  }

  // ─── Post-processing ───────────────────────────────────────────────────────

  /**
   * Builds or rebuilds the RenderPipeline post-processing graph.
   *
   * Pipeline (when all effects are enabled):
   *   scenePass (MRT: output + emissive)
   *     → bloom(emissivePass)
   *     → outlinePass
   *     → sceneColor + bloom + outline
   *     → smaa (optional)
   *   → output
   *
   * Notes:
   * - Bloom is selective via MRT: only meshes with emissive color contribute.
   * - SMAA should run BEFORE tone-mapping / color-space conversion for best
   *   results; RenderPipeline.outputColorTransform = false lets us control this.
   * - On WebGL 2 fallback, all passes still work because three/webgpu's
   *   WebGL backend supports TSL nodes.
   */
  private setupPostProcessing(): void {
    if (this.renderPipeline) {
      this.renderPipeline.dispose?.();
      this.renderPipeline = null;
    }

    const scene = this.scene;
    const camera = this.camera;
    const bloomCfg = this.bloomUniforms;

    // Scene pass with optional MRT for selective bloom
    const scenePass = pass(scene, camera);

    let outputNode;

    if (this.config.glow) {
      // Selective bloom: only emissive surfaces glow
      scenePass.setMRT(mrt({ output, emissive }));
      const sceneColor = scenePass.getTextureNode('output');
      const emissivePass = scenePass.getTextureNode('emissive');
      const bloomPass = bloom(emissivePass, bloomCfg.strength, bloomCfg.radius, bloomCfg.threshold);

      // Outline effect for interactive dice (Stage 5/7 populates outlineObjects)
      const outlinePass = outline(scene, camera, {
        selectedObjects: this.outlineObjects,
      });
      const { visibleEdge, hiddenEdge } = outlinePass;
      const outlineColor = visibleEdge
        .mul(uniform(new Color(0xffffff)))
        .add(hiddenEdge.mul(uniform(new Color(0x4e3636))))
        .mul(uniform(2.0));

      outputNode = sceneColor.add(bloomPass).add(outlineColor);
    } else {
      // No bloom — still include outline for interactivity
      const sceneColor = scenePass.getTextureNode('output');
      const outlinePass = outline(scene, camera, {
        selectedObjects: this.outlineObjects,
      });
      const { visibleEdge } = outlinePass;
      const outlineColor = visibleEdge.mul(uniform(new Color(0xffffff))).mul(uniform(2.0));
      outputNode = sceneColor.add(outlineColor);
    }

    // SMAA anti-aliasing (applied after compositing, before output color transform)
    if (this.config.antialiasing === 'smaa') {
      outputNode = smaa(outputNode);
    }

    const pipeline = new RenderPipeline(this.renderer, outputNode);
    pipeline.outputColorTransform = true;
    this.renderPipeline = pipeline;
  }

  /** Update bloom parameters at runtime (e.g. from settings change). */
  setBloom(cfg: Partial<BloomUniforms>): void {
    Object.assign(this.bloomUniforms, cfg);
    if (this.renderPipeline) {
      this.setupPostProcessing();
    }
  }

  // ─── Immersive darkness ────────────────────────────────────────────────────

  /** Call each frame to sync tone mapping with scene darkness level (0–1). */
  applyImmersiveDarkness(darknessLevel: number): void {
    if (!this.realisticLighting || !this.config.immersiveDarkness) return;
    // Mirrors legacy formula: toneMappingExposure = default * 0.4 + (default * 0.6 - darkness * 0.6)
    this.renderer.toneMappingExposure = 1.0 * 0.4 + (1.0 * 0.6 - darknessLevel * 0.6);
  }

  // ─── Render scene ──────────────────────────────────────────────────────────

  /**
   * Render one frame.
   * Uses RenderPipeline when post-processing is active,
   * plain renderer otherwise.
   */
  renderScene(): void {
    this.timeUniform.value = performance.now() / 1000;

    if (this.realisticLighting && this.renderPipeline) {
      // Fire-and-forget; WebGPURenderer handles the Promise internally
      void this.renderPipeline.renderAsync();
    } else {
      void this.renderer.renderAsync(this.scene, this.camera);
    }
  }

  // ─── Animation loop ────────────────────────────────────────────────────────

  /**
   * Start the render loop.
   * The optional `onFrame` callback runs each tick before rendering — Stage 5
   * plugs in physics frame interpolation here.
   */
  startAnimating(onFrame?: () => void): void {
    if (this.animFrameId !== null) return;

    const loop = (): void => {
      this.animFrameId = requestAnimationFrame(loop);
      onFrame?.();
      if (this.isVisible) {
        this.renderScene();
      }
    };

    this.animFrameId = requestAnimationFrame(loop);
    this.isVisible = true;
    this.cancelAutoHide();
  }

  /** Stop the render loop immediately. */
  stopAnimating(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    this.cancelAutoHide();
  }

  /**
   * Signal that a roll has finished settling.
   * Schedules auto-hide after `config.timeBeforeHide` ms.
   */
  scheduleAutoHide(): void {
    this.cancelAutoHide();
    this.hideTimeoutId = setTimeout(() => {
      this.hideTimeoutId = null;
      this.hide();
    }, this.config.timeBeforeHide);
  }

  private cancelAutoHide(): void {
    if (this.hideTimeoutId !== null) {
      clearTimeout(this.hideTimeoutId);
      this.hideTimeoutId = null;
    }
  }

  /** Fade out and stop rendering. */
  hide(): void {
    this.isVisible = false;
    const el = this.renderer.domElement;
    el.style.opacity = '0';
    this.stopAnimating();
  }

  /** Make canvas visible and start (or resume) the render loop. */
  show(): void {
    const el = this.renderer.domElement;
    el.style.opacity = '1';
    this.isVisible = true;
  }

  // ─── Resize handling ───────────────────────────────────────────────────────

  /**
   * Handle viewport resize (sidebar collapse, window resize, etc.).
   * Call from a ResizeObserver or Foundry's canvas resize hook.
   */
  resize(width?: number, height?: number): void {
    const w = width ?? this.container.clientWidth;
    const h = height ?? this.container.clientHeight;
    this.display.currentWidth = w;
    this.display.currentHeight = h;
    this.setScene(this.config.dimensions);
  }

  // ─── Config update ─────────────────────────────────────────────────────────

  /**
   * Apply a partial config update at runtime (e.g. from settings dialog).
   * Rebuilds lighting + post-processing as needed.
   */
  async update(partial: Partial<DiceBoxConfig>): Promise<void> {
    const prev = this.config;
    this.config = { ...this.config, ...partial };

    const qualityChanged = partial.imageQuality !== undefined && partial.imageQuality !== prev.imageQuality;
    const shadowChanged = partial.shadowQuality !== undefined && partial.shadowQuality !== prev.shadowQuality;
    const ppChanged =
      partial.glow !== undefined || partial.antialiasing !== undefined;

    if (qualityChanged) {
      this.realisticLighting = this.config.imageQuality !== 'low';
      this.renderer.shadowMap.enabled = this.config.shadowQuality !== 'low' || this.config.imageQuality !== 'low';
      this.renderer.shadowMap.type =
        this.config.shadowQuality === 'high' ? PCFSoftShadowMap : PCFShadowMap;

      // Reload environment at new quality level
      await this.loadEnvironment();
    }

    if (shadowChanged) {
      this.renderer.shadowMap.enabled = this.config.shadowQuality !== 'low' || this.config.imageQuality !== 'low';
      this.renderer.shadowMap.type =
        this.config.shadowQuality === 'high' ? PCFSoftShadowMap : PCFShadowMap;
      this.light.castShadow = this.renderer.shadowMap.enabled;
      this.desk.receiveShadow = this.renderer.shadowMap.enabled;
    }

    if (partial.canvasZIndex !== undefined) {
      this.applyZIndex();
    }

    if (ppChanged && this.realisticLighting) {
      this.setupPostProcessing();
    }

    // Always reflow scene layout when scale/autoscale change
    if (partial.scale !== undefined || partial.autoscale !== undefined) {
      this.updateScale(this.config.scale, this.config.autoscale);
    }

    // Ensure materials pick up changes on next frame
    this.scene.traverse((obj) => {
      if ((obj as Mesh).isMesh) {
        const mat = (obj as Mesh).material;
        if (mat && !Array.isArray(mat)) {
          mat.needsUpdate = true;
        }
      }
    });
  }

  // ─── Disposal ──────────────────────────────────────────────────────────────

  /**
   * Release all GPU resources. Call when the DiceBox is destroyed
   * (module teardown, config dialog close, etc.).
   */
  dispose(): void {
    this.stopAnimating();

    // Dispose post-processing
    this.renderPipeline?.dispose?.();
    this.renderPipeline = null;

    // Dispose desk geometry + material
    if (this.desk) {
      this.scene.remove(this.desk);
      this.desk.geometry.dispose();
      (this.desk.material as ShadowMaterial).dispose();
    }

    // Dispose shadow map
    if (this.light?.shadow?.map) {
      this.light.shadow.map.dispose();
    }

    // Clear scene
    while (this.scene.children.length > 0) {
      this.scene.remove(this.scene.children[0]);
    }

    // Dispose renderer
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

// ─── Augment DisplayMetrics to carry the margin ───────────────────────────────

declare module '../types/rendering.js' {
  interface DisplayMetrics {
    containerMargin?: BoxMargin | null;
  }
}
