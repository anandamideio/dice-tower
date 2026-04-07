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
  Timer,
  Color,
  CubeTextureLoader,
  DirectionalLight,
  Group,
  HalfFloatType,
  HemisphereLight,
  LoadingManager,
  Mesh,
  NoToneMapping,
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
  Quaternion,
  Vector2,
  Vector3,
  WebGPURenderer,
} from 'three/webgpu';
import { emissive, mrt, output, pass, uniform } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import { outline } from 'three/addons/tsl/display/OutlineNode.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

import type {
  DisplayMetrics,
  QualitySettings,
  RendererBackend,
  ThrowingForce,
} from '../types/rendering.js';
import type { DiceAppearance } from '../types/appearance.js';
import type {
  DiceNotationData,
  DiceThrow,
  DieResult,
  DieShape,
} from '../types/dice.js';
import type {
  CollisionEvent,
  DiceBodyDef,
  PhysicsConfig,
  SimulationFrames,
  SimulationResult,
  ThrowParams,
  Vec3,
} from '../types/physics.js';
import type { SoundsSurface } from '../types/settings.js';
import { mergeQueuedRollCommands } from '../dice/dice-notation.js';
import { PhysicsWorkerClient } from '../physics/physics-worker-client.js';
import { DICE_SHAPE_DEFINITIONS, getFaceIndices } from '../physics/dice-shape-definitions.js';
import type { IDiceFactory, IDiceSFXClass, IDiceSystem } from '../api/dice3d.js';
import type { DiceMeshRef } from '../api/dice-sfx.js';
import { SoundManager, type CollisionDieMetadata } from '../audio/sound-manager.js';
import { DiceSFXManager } from '../sfx/dice-sfx-manager.js';

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
  /** Milliseconds before the canvas auto-hides after dice settle. Defaults to 2000. */
  timeBeforeHide?: number;
  /** Type qualifier for this box — 'board' (main) or 'showcase' (config preview). */
  boxType: 'board' | 'showcase';
  /** Camera distance preset. */
  cameraDistance?: CameraDistanceMode;
  /** Shadow-plane material settings. */
  deskSurface?: Partial<DeskSurfaceConfig>;
  /** Optional dimensions override; if absent, uses container client size. */
  dimensions?: { width: number; height: number; margin?: BoxMargin };
}

export interface BoxMargin {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export type CameraDistanceMode = 'close' | 'medium' | 'far';

export interface DeskSurfaceConfig {
  shadowOpacity: number;
  shadowColor: number;
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

export interface AssetLoadProgress {
  phase: 'idle' | 'roughness' | 'environment' | 'complete' | 'error';
  loaded: number;
  total: number;
  percent: number;
  item?: string;
}

export interface RenderFrameContext {
  deltaSeconds: number;
  elapsedSeconds: number;
  fixedStepSeconds: number;
  fixedSteps: number;
  interpolationAlpha: number;
  frame: number;
}

const DEFAULT_BLOOM: BloomUniforms = {
  strength: 1.1,
  radius: 0.2,
  threshold: 0,
};

const DEFAULT_HIDE_DELAY_MS = 2000;
const DEFAULT_CAMERA_DISTANCE: CameraDistanceMode = 'far';
const DEFAULT_DESK_SURFACE: DeskSurfaceConfig = {
  shadowOpacity: 0.5,
  shadowColor: 0x000000,
};

const ROLL_GROUP_STEP = 15;
const FORCE_MODIFIERS: Record<ThrowingForce, number> = {
  weak: 0.5,
  medium: 0.8,
  strong: 1.8,
};
const DEFAULT_SPEED_MULTIPLIER = 1;
const DEFAULT_MAX_DICE = 100;
const DEFAULT_QUEUE_MERGE_WINDOW_MS = 80;
const FACE_SWAP_BLEND_FRAMES = 10;

const DICE_SYSTEM_EVENT_TYPE = {
  SPAWN: 0,
  CLICK: 1,
  RESULT: 2,
  COLLIDE: 3,
  DESPAWN: 4,
} as const;

export interface DiceBoxRuntimeOptions {
  diceFactory: IDiceFactory;
  physics?: PhysicsWorkerClient;
  throwingForce?: ThrowingForce;
  speed?: number;
  hideAfterRoll?: boolean;
  allowInteractivity?: boolean;
  maxDiceNumber?: number;
  queueMergeWindowMs?: number;
  sounds?: boolean;
  soundsSurface?: SoundsSurface;
  soundsVolume?: number;
  muteSoundSecretRolls?: boolean;
}

export interface DiceBoxAddOptions {
  throwParams?: ThrowParams;
  captureThrowParams?: (params: ThrowParams) => void;
}

interface DiceThrowCommand {
  notation: DiceNotationData;
  options?: DiceBoxAddOptions;
  resolve: (value: boolean) => void;
  reject: (reason?: unknown) => void;
}

interface ActiveDie {
  bodyId: string;
  throwIndex: number;
  die: DieResult;
  shape: DieShape;
  systemId: string;
  startAtIteration: number;
  group: Group;
  mesh: Mesh;
  simulatedResult: number;
  finalQuaternion: Quaternion;
  correctedQuaternion: Quaternion | null;
}

interface PlaybackState {
  frames: SimulationFrames;
  lastFrame: number;
  elapsedSeconds: number;
  lastAppliedFrame: number;
  collisionsByFrame: Map<number, CollisionEvent[]>;
  bodyIndexById: Map<string, number>;
}

interface ThrowVectorBasis {
  x: number;
  y: number;
  dist: number;
  boost: number;
}

interface DiceFactoryRuntime {
  getMesh(dieType: DieResult['type'], overrides?: Partial<DiceAppearance>): Promise<Mesh>;
  setEnvironmentMaps?: (envMap: unknown, roughnessMaps: Record<string, unknown>) => void;
  setMaterialQuality?: (quality: 'low' | 'high') => void;
  systems: Map<string, IDiceSystem>;
}

interface PhysicsRuntimeClient {
  init(config: PhysicsConfig): Promise<void>;
  simulate(params: ThrowParams): Promise<SimulationResult>;
  playStep(deltaSeconds: number): Promise<RealtimeStepPayload>;
  addDice(dice: DiceBodyDef[]): void;
  addConstraint(position: Vec3): void;
  moveConstraint(position: Vec3): void;
  removeConstraint(): void;
  destroy(): void;
}

interface RealtimeStepPayload {
  bodyIds: string[];
  positions: Float32Array;
  rotations: Float32Array;
  collisions: CollisionEvent[];
  worldAsleep: boolean;
}

class Mulberry32 {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state += 0x6d2b79f5;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }
}

function packPhysicsMargin(display: DisplayMetrics): PhysicsConfig['margin'] {
  const margin = display.containerMargin;
  if (!margin) {
    return 0;
  }

  return {
    top: margin.top,
    bottom: margin.bottom,
    left: margin.left,
    right: margin.right,
  };
}

function randomQuaternion(rng: Mulberry32): Quaternion {
  const u1 = rng.next();
  const u2 = rng.next();
  const u3 = rng.next();

  const sq1 = Math.sqrt(1 - u1);
  const sq2 = Math.sqrt(u1);

  const x = sq1 * Math.sin(2 * Math.PI * u2);
  const y = sq1 * Math.cos(2 * Math.PI * u2);
  const z = sq2 * Math.sin(2 * Math.PI * u3);
  const w = sq2 * Math.cos(2 * Math.PI * u3);

  return new Quaternion(x, y, z, w).normalize();
}

function shapeForDieType(dieType: DieResult['type'], fallback: DieShape): DieShape {
  if (dieType === 'd100') {
    return 'd10';
  }

  return fallback;
}

function resolveDesiredFaceValue(die: DieResult): number {
  if (die.type === 'd100') {
    if (typeof die.d100Result === 'number') {
      const tens = Math.floor(die.d100Result / 10);
      return tens === 10 ? 0 : tens * 10;
    }

    return die.result * 10;
  }

  return die.result;
}

function valueForFaceSwap(shape: DieShape, value: number): number {
  if (shape === 'd10' && value === 0) {
    return 10;
  }
  return value;
}

function getFaceNormalByValue(shape: DieShape, value: number): Vector3 | null {
  if (shape === 'd2') {
    if (value === 1) return new Vector3(0, -1, 0);
    if (value === 2) return new Vector3(0, 1, 0);
    return null;
  }

  const definition = DICE_SHAPE_DEFINITIONS[shape];
  if (definition.type !== 'ConvexPolyhedron') {
    return null;
  }

  for (let faceIndex = 0; faceIndex < definition.faces.length; faceIndex += 1) {
    const faceValue = definition.faceValues[faceIndex] ?? 0;
    if (faceValue !== value) {
      continue;
    }

    const indices = getFaceIndices(definition.faces[faceIndex], definition.skipLastFaceIndex);
    if (indices.length < 3) {
      continue;
    }

    const a = definition.vertices[indices[0]];
    const b = definition.vertices[indices[1]];
    const c = definition.vertices[indices[2]];

    const va = new Vector3(a[0], a[1], a[2]);
    const vb = new Vector3(b[0], b[1], b[2]);
    const vc = new Vector3(c[0], c[1], c[2]);

    const normal = new Vector3()
      .subVectors(vb, va)
      .cross(new Vector3().subVectors(vc, va))
      .normalize();

    return normal;
  }

  return null;
}

function interpolateBodyPosition(
  frames: SimulationFrames,
  bodyIndex: number,
  frameA: number,
  frameB: number,
  alpha: number,
  out: Vector3,
): void {
  const frameCount = frames.frameCount;
  const baseA = (bodyIndex * frameCount + frameA) * 3;
  const baseB = (bodyIndex * frameCount + frameB) * 3;

  const ax = frames.positions[baseA];
  const ay = frames.positions[baseA + 1];
  const az = frames.positions[baseA + 2];
  const bx = frames.positions[baseB];
  const by = frames.positions[baseB + 1];
  const bz = frames.positions[baseB + 2];

  out.set(
    ax + (bx - ax) * alpha,
    ay + (by - ay) * alpha,
    az + (bz - az) * alpha,
  );
}

function interpolateBodyRotation(
  frames: SimulationFrames,
  bodyIndex: number,
  frameA: number,
  frameB: number,
  alpha: number,
  out: Quaternion,
): void {
  const frameCount = frames.frameCount;
  const baseA = (bodyIndex * frameCount + frameA) * 4;
  const baseB = (bodyIndex * frameCount + frameB) * 4;

  const qa = new Quaternion(
    frames.rotations[baseA],
    frames.rotations[baseA + 1],
    frames.rotations[baseA + 2],
    frames.rotations[baseA + 3],
  );

  const qb = new Quaternion(
    frames.rotations[baseB],
    frames.rotations[baseB + 1],
    frames.rotations[baseB + 2],
    frames.rotations[baseB + 3],
  );

  out.copy(qa).slerp(qb, alpha);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isDiceTowerDebugEnabled(): boolean {
  const runtimeGlobal = globalThis as unknown as { DICE_TOWER_DEBUG?: unknown };
  return runtimeGlobal.DICE_TOWER_DEBUG === true;
}

function debugLog(message: string, payload?: Record<string, unknown>): void {
  if (!isDiceTowerDebugEnabled()) {
    return;
  }

  if (payload) {
    console.debug(`dice-tower | ${message}`, payload);
    return;
  }

  console.debug(`dice-tower | ${message}`);
}

function normalizeDiceBoxConfig(config: DiceBoxConfig): DiceBoxConfig {
  const hideDelay =
    typeof config.timeBeforeHide === 'number' && Number.isFinite(config.timeBeforeHide)
      ? Math.max(0, config.timeBeforeHide)
      : DEFAULT_HIDE_DELAY_MS;

  const surfaceOpacity =
    typeof config.deskSurface?.shadowOpacity === 'number' && Number.isFinite(config.deskSurface.shadowOpacity)
      ? clamp(config.deskSurface.shadowOpacity, 0, 1)
      : DEFAULT_DESK_SURFACE.shadowOpacity;

  const surfaceColor =
    typeof config.deskSurface?.shadowColor === 'number' && Number.isFinite(config.deskSurface.shadowColor)
      ? config.deskSurface.shadowColor
      : DEFAULT_DESK_SURFACE.shadowColor;

  return {
    ...config,
    timeBeforeHide: hideDelay,
    cameraDistance: config.cameraDistance ?? DEFAULT_CAMERA_DISTANCE,
    deskSurface: {
      shadowOpacity: surfaceOpacity,
      shadowColor: surfaceColor,
    },
  };
}

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
  private postProcessingFallbackNotified = false;
  /** Objects highlighted by the outline effect (populated in Stage 5/7). */
  readonly outlineObjects: Object3D[] = [];
  private bloomUniforms: BloomUniforms = { ...DEFAULT_BLOOM };
  private timeUniform = uniform(0);

  // Animation loop
  private animFrameId: number | null = null;
  private hideTimeoutId: ReturnType<typeof setTimeout> | null = null;
  readonly clock = new Timer();

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

  // Asset loading progress listeners
  private progressListeners = new Set<(progress: AssetLoadProgress) => void>();
  private assetLoadProgress: AssetLoadProgress = {
    phase: 'idle',
    loaded: 0,
    total: 0,
    percent: 0,
  };

  // Fixed-step timing for physics/render decoupling
  private fixedStepSeconds = 1 / 60;
  private fixedStepAccumulator = 0;
  private lastFrameTimeMs: number | null = null;
  private frameCount = 0;

  // Rendering quality mirrors (derived from config)
  private realisticLighting = false;
  private anisotropy = 1;

  // Stage 5 runtime integration
  private diceFactory: DiceFactoryRuntime | null = null;
  private physicsClient: PhysicsRuntimeClient | null = null;
  private ownsPhysicsClient = false;
  private runtimeReady = false;
  private physicsUnavailable = false;
  private physicsFailureNotified = false;

  private throwingForce: ThrowingForce = 'medium';
  private speedMultiplier = DEFAULT_SPEED_MULTIPLIER;
  private hideAfterRoll = true;
  private allowInteractivity = false;
  private maxDiceNumber = DEFAULT_MAX_DICE;
  private queueMergeWindowMs = DEFAULT_QUEUE_MERGE_WINDOW_MS;
  private muteSoundSecretRolls = false;
  private sfxVolume = 0.5;
  private readonly soundManager = new SoundManager();
  private readonly sfxManager = new DiceSFXManager({
    onQueueEmpty: () => {
      this.handleSfxQueueDrained();
    },
  });
  private pendingHideAfterSfx = false;
  private readonly bodyCollisionAudio = new Map<string, CollisionDieMetadata>();

  private commandQueue: DiceThrowCommand[] = [];
  private queueWindowTimer: ReturnType<typeof setTimeout> | null = null;
  private processingQueue = false;
  private activeResolveBatch: Array<(value: boolean) => void> = [];

  private activeDice: ActiveDie[] = [];
  private playback: PlaybackState | null = null;

  private interactionPointer = new Vector2();
  private interactionDragging = false;
  private interactionDraggedDieId: string | null = null;
  private interactionRealtimePending = false;
  private interactionOffset = new Vector3();
  private reusablePosition = new Vector3();
  private reusableQuaternion = new Quaternion();

  private collisionListeners = new Set<(event: CollisionEvent) => void>();

  private constructor(container: HTMLElement, config: DiceBoxConfig) {
    this.container = container;
    this.config = normalizeDiceBoxConfig(config);
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
    } else {
      this.renderer.toneMapping = NoToneMapping;
      this.renderer.toneMappingExposure = 1.0;
    }

    // Detect actual backend after renderer init (async for WebGPU)
    await this.renderer.init();
    const backendInfo = this.renderer.backend as { constructor?: { name?: string } } | undefined;
    const backendName = backendInfo?.constructor?.name?.toLowerCase() ?? '';
    this.backend = backendName.includes('webgpu') ? 'webgpu' : 'webgl2';

    debugLog('DiceBox renderer initialized', {
      backend: this.backend,
      imageQuality: this.config.imageQuality,
      glow: this.config.glow,
      antialiasing: this.config.antialiasing,
    });

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
    this.reconcilePostProcessing();
  }

  get running(): boolean {
    return this.rolling || this.processingQueue;
  }

  async configureRuntime(options: DiceBoxRuntimeOptions): Promise<void> {
    this.diceFactory = options.diceFactory as unknown as DiceFactoryRuntime;

    if (options.physics) {
      if (this.ownsPhysicsClient && this.physicsClient) {
        this.physicsClient.destroy();
      }
      this.physicsClient = options.physics as unknown as PhysicsRuntimeClient;
      this.ownsPhysicsClient = false;
    } else if (!this.physicsClient) {
      this.physicsClient = new PhysicsWorkerClient() as unknown as PhysicsRuntimeClient;
      this.ownsPhysicsClient = true;
    }

    this.throwingForce = options.throwingForce ?? this.throwingForce;
    this.speedMultiplier = clamp(options.speed ?? this.speedMultiplier, 0.5, 3);
    this.hideAfterRoll = options.hideAfterRoll ?? this.hideAfterRoll;
    this.allowInteractivity = options.allowInteractivity ?? this.allowInteractivity;
    this.maxDiceNumber = Math.max(1, options.maxDiceNumber ?? this.maxDiceNumber);
    this.queueMergeWindowMs = Math.max(0, options.queueMergeWindowMs ?? this.queueMergeWindowMs);
    this.muteSoundSecretRolls = options.muteSoundSecretRolls ?? this.muteSoundSecretRolls;
    if (typeof options.soundsVolume === 'number' && Number.isFinite(options.soundsVolume)) {
      this.sfxVolume = clamp(options.soundsVolume, 0, 1);
    }
    this.soundManager.update({
      sounds: options.sounds,
      soundsSurface: options.soundsSurface,
      volume: options.soundsVolume,
      muteSoundSecretRolls: this.muteSoundSecretRolls,
    });

    const envMap = (this.renderer as unknown as { envMap?: unknown }).envMap;
    const textureCache = (this.renderer as unknown as {
      textureCache?: { roughnessMaps?: Record<string, unknown> };
    }).textureCache;

    const factory = this.diceFactory;

    factory.setEnvironmentMaps?.(
      envMap ?? null,
      (textureCache?.roughnessMaps as Record<string, unknown>) ?? {},
    );
    factory.setMaterialQuality?.(this.config.imageQuality === 'low' ? 'low' : 'high');

    this.physicsUnavailable = false;
    this.physicsFailureNotified = false;
    await this.ensurePhysicsInitialized();
    this.runtimeReady = true;
  }

  setRollSpeed(speed: number): void {
    if (!Number.isFinite(speed)) {
      return;
    }
    this.speedMultiplier = clamp(speed, 0.5, 3);
  }

  setThrowingForce(force: ThrowingForce): void {
    this.throwingForce = force;
  }

  setInteractivityEnabled(enabled: boolean): void {
    this.allowInteractivity = enabled;
  }

  addSFXTrigger(id: string, name: string, results: string[]): void {
    this.sfxManager.addSFXTrigger(id, name, results);
  }

  addSFXMode(sfxClass: IDiceSFXClass): void {
    this.sfxManager.registerSFXModeClass(sfxClass);
  }

  getSFXModes(): Record<string, string> {
    return this.sfxManager.getSFXModes(true);
  }

  onCollision(listener: (event: CollisionEvent) => void): () => void {
    this.collisionListeners.add(listener);
    return () => {
      this.collisionListeners.delete(listener);
    };
  }

  add(notation: DiceNotationData, options?: DiceBoxAddOptions): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      this.commandQueue.push({ notation, options, resolve, reject });
      this.scheduleQueueFlush();
    });
  }

  onMouseMove(_event: MouseEvent | PointerEvent | null, ndc: { x: number; y: number }): Promise<void> {
    this.interactionPointer.set(ndc.x, ndc.y);

    if (!this.interactionDragging || !this.physicsClient) {
      return Promise.resolve();
    }

    this.raycaster.setFromCamera(this.interactionPointer, this.camera);
    const intersections = this.raycaster.intersectObject(this.desk, false);
    if (intersections.length === 0) {
      return Promise.resolve();
    }

    const targetPoint = intersections[0].point.sub(this.interactionOffset);
    this.reusablePosition.copy(targetPoint);
    this.physicsClient.moveConstraint({
      x: targetPoint.x,
      y: targetPoint.y,
      z: targetPoint.z,
    });
    this.interactionRealtimePending = false;
    return Promise.resolve();
  }

  onMouseDown(
    _event: MouseEvent | PointerEvent | null,
    ndc: { x: number; y: number },
  ): Promise<boolean> {
    if (!this.allowInteractivity || this.rolling || !this.physicsClient || this.activeDice.length === 0) {
      return Promise.resolve(false);
    }

    this.interactionPointer.set(ndc.x, ndc.y);
    this.raycaster.setFromCamera(this.interactionPointer, this.camera);

    const intersections = this.raycaster.intersectObjects(this.activeDice.map((die) => die.group), true);
    if (intersections.length === 0) {
      return Promise.resolve(false);
    }

    const hit = intersections[0];
    const die = this.findActiveDieFromObject(hit.object);
    if (!die) {
      return Promise.resolve(false);
    }

    this.interactionDraggedDieId = die.bodyId;
    this.interactionDragging = true;
    this.interactionOffset.copy(hit.point).sub(die.group.position);
    this.physicsClient.addConstraint({ x: hit.point.x, y: hit.point.y, z: hit.point.z });

    this.emitDiceSystemEvent(die, DICE_SYSTEM_EVENT_TYPE.CLICK, {
      dice: die.group,
      position: hit.point.clone(),
    });

    this.outlineObjects.length = 0;
    this.outlineObjects.push(die.group);
    this.show();
    this.startAnimating(this.handleFrame);

    return Promise.resolve(true);
  }

  onMouseUp(_eventUnused: MouseEvent | PointerEvent | null): Promise<boolean> {
    void _eventUnused;
    if (!this.interactionDragging || !this.physicsClient) {
      return Promise.resolve(false);
    }

    this.interactionDragging = false;
    this.interactionDraggedDieId = null;
    this.physicsClient.removeConstraint();
    this.outlineObjects.length = 0;
    this.interactionRealtimePending = false;

    return Promise.resolve(true);
  }

  clearAllDice(): void {
    this.cancelQueueFlush();
    this.commandQueue = [];
    this.processingQueue = false;
    this.playback = null;
    this.rolling = false;
    this.pendingHideAfterSfx = false;
    this.activeResolveBatch = [];
    this.sfxManager.clearQueue();

    this.clearActiveDiceFromScene();

    this.outlineObjects.length = 0;
    this.renderScene();

    if (this.physicsClient) {
      this.physicsClient.addDice([]);
    }
  }

  private scheduleQueueFlush(): void {
    if (this.queueWindowTimer !== null) {
      return;
    }

    this.queueWindowTimer = setTimeout(() => {
      this.queueWindowTimer = null;
      void this.flushQueuedCommands();
    }, this.queueMergeWindowMs);
  }

  private cancelQueueFlush(): void {
    if (this.queueWindowTimer === null) {
      return;
    }

    clearTimeout(this.queueWindowTimer);
    this.queueWindowTimer = null;
  }

  private async flushQueuedCommands(): Promise<void> {
    if (this.processingQueue || this.commandQueue.length === 0) {
      return;
    }

    this.processingQueue = true;
    const batch = this.commandQueue.splice(0, this.commandQueue.length);

    try {
      const hasDeterministicOptions = batch.some(
        (command) => command.options?.throwParams || command.options?.captureThrowParams,
      );

      if (hasDeterministicOptions) {
        for (const command of batch) {
          try {
            const result = await this.runThrow(command.notation, command.options);
            command.resolve(result);
          } catch (error) {
            command.reject(error);
          }
        }
        return;
      }

      const merged = mergeQueuedRollCommands(batch.map((command) => ({ notation: command.notation })));
      const result = await this.runThrow(merged, undefined);
      for (const command of batch) {
        command.resolve(result);
      }
    } catch (error) {
      for (const command of batch) {
        command.reject(error);
      }
    } finally {
      this.processingQueue = false;
      if (this.commandQueue.length > 0) {
        this.scheduleQueueFlush();
      }
    }
  }

  private async ensurePhysicsInitialized(config: PhysicsConfig = this.getPhysicsConfig()): Promise<boolean> {
    if (!this.physicsClient) {
      throw new Error('Physics runtime is not configured. Call configureRuntime() first.');
    }

    if (this.physicsUnavailable) {
      return false;
    }

    try {
      await this.physicsClient.init(config);
      return true;
    } catch (error) {
      this.physicsUnavailable = true;

      if (!this.physicsFailureNotified) {
        this.physicsFailureNotified = true;
        console.error('dice-tower | Physics worker initialization failed. 3D dice will be disabled.', error);

        const runtimeUi = ui as unknown as {
          notifications?: {
            warn?: (text: string) => void;
          };
        };

        runtimeUi.notifications?.warn?.(
          'Dice Tower could not initialize physics. 3D dice animations are disabled for this session.',
        );
      }

      return false;
    }
  }

  private getPhysicsConfig(): PhysicsConfig {
    return {
      width: this.display.containerWidth ?? this.display.currentWidth ?? 800,
      height: this.display.containerHeight ?? this.display.currentHeight ?? 600,
      margin: packPhysicsMargin(this.display),
      muteSoundSecretRolls: this.muteSoundSecretRolls,
    };
  }

  private async runThrow(notation: DiceNotationData, options?: DiceBoxAddOptions): Promise<boolean> {
    if (!this.runtimeReady) {
      throw new Error('DiceBox runtime is not ready. Call configureRuntime() first.');
    }

    const diceFactory = this.diceFactory;
    const physicsClient = this.physicsClient;
    if (!diceFactory || !physicsClient) {
      throw new Error('DiceBox runtime dependencies are missing.');
    }

    const mergedThrows = notation.throws.filter((throwGroup) => throwGroup.dice.length > 0);
    if (mergedThrows.length === 0) {
      return true;
    }

    const providedThrowParams = options?.throwParams;
    const simulationConfig = providedThrowParams?.config ?? this.getPhysicsConfig();

    const physicsReady = await this.ensurePhysicsInitialized(simulationConfig);
    if (!physicsReady) {
      return false;
    }

    this.cancelAutoHide();
    this.clearActiveDiceFromScene();
    this.pendingHideAfterSfx = false;
    this.sfxManager.clearQueue();

    const totalDice = mergedThrows.reduce((count, throwGroup) => count + throwGroup.dice.length, 0);
    const effectiveThrows = this.limitThrowsByMaxDice(mergedThrows, Math.max(1, this.maxDiceNumber));

    if (effectiveThrows.length === 0) {
      return true;
    }

    if (totalDice > this.maxDiceNumber) {
      console.warn(
        `DiceBox received ${totalDice} dice, limiting animation to ${this.maxDiceNumber} based on maxDiceNumber.`,
      );
    }

    const expectedBodyCount = effectiveThrows.reduce(
      (count, throwGroup) => count + throwGroup.dice.length,
      0,
    );

    debugLog('Starting dice throw playback', {
      backend: this.backend,
      postProcessing: this.renderPipeline !== null,
      groups: effectiveThrows.length,
      dice: expectedBodyCount,
      hideAfterRoll: this.hideAfterRoll,
    });

    const providedBodies = providedThrowParams?.bodies;
    const useProvidedBodies =
      Array.isArray(providedBodies) && providedBodies.length === expectedBodyCount;

    if (providedBodies && !useProvidedBodies) {
      console.warn(
        `DiceBox received ${providedBodies.length} deterministic bodies for ${expectedBodyCount} dice; falling back to classic simulation.`,
      );
    }

    const seed = providedThrowParams?.seed
      ?? ((Math.floor(performance.now() * 1000) ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0);
    const rng = new Mulberry32(seed);

    const bodies: DiceBodyDef[] = [];
    const activeDice: ActiveDie[] = [];
    this.activeDice = activeDice;

    let bodyCounter = 0;
    let providedBodyIndex = 0;

    for (let throwIndex = 0; throwIndex < effectiveThrows.length; throwIndex += 1) {
      const throwGroup = effectiveThrows[throwIndex];
      const basis = useProvidedBodies ? null : this.createThrowVectorBasis(rng);

      for (let dieIndex = 0; dieIndex < throwGroup.dice.length; dieIndex += 1) {
        const die = throwGroup.dice[dieIndex];
        const appearance = this.resolveAppearanceOverrides(die);
        const mesh = await diceFactory.getMesh(die.type, appearance);
        const meshUserData = mesh.userData as Record<string, unknown>;

        const fallbackShape = ((meshUserData.shape as DieShape | undefined) ?? 'd6');
        let body: DiceBodyDef;

        if (useProvidedBodies && providedBodies) {
          const providedBody = providedBodies[providedBodyIndex];
          providedBodyIndex += 1;
          if (!providedBody) {
            throw new Error('Deterministic throw payload is missing body definitions.');
          }
          body = providedBody;
        } else {
          const shape = shapeForDieType(die.type, fallbackShape);
          const bodyId = `die-${bodyCounter.toString(36)}-${Math.floor(rng.next() * 1_000_000).toString(36)}`;
          bodyCounter += 1;

          body = this.createBodyDefinition({
            id: bodyId,
            die,
            shape,
            throwIndex,
            basis: basis ?? this.createThrowVectorBasis(rng),
            rng,
            mesh,
          });
        }

        const shape = shapeForDieType(die.type, body.shape);
        const bodyId = body.id;
        const systemId = typeof meshUserData.system === 'string'
          ? meshUserData.system
          : (typeof appearance.system === 'string' ? appearance.system : 'standard');

        const group = new Group();
        group.add(mesh);
        group.visible = (body.startAtIteration ?? 0) === 0;
        group.position.set(body.position.x, body.position.y, body.position.z);
        group.quaternion.set(body.rotation.x, body.rotation.y, body.rotation.z, body.rotation.w);
        group.userData = {
          ...group.userData,
          diceBodyId: bodyId,
          throwIndex,
          system: systemId,
        };
        this.scene.add(group);

        meshUserData.diceBodyId = bodyId;
        meshUserData.throwIndex = throwIndex;
        meshUserData.system = systemId;

        this.bodyCollisionAudio.set(bodyId, {
          dieType: die.type,
          material: typeof meshUserData.material === 'string' ? meshUserData.material : 'plastic',
          secretRoll: body.secretRoll === true || die.options.secret === true,
        });

        bodies.push(body);
        activeDice.push({
          bodyId,
          throwIndex,
          die,
          shape,
          systemId,
          startAtIteration: body.startAtIteration ?? 0,
          group,
          mesh,
          simulatedResult: 0,
          finalQuaternion: group.quaternion.clone(),
          correctedQuaternion: null,
        });

        this.emitDiceSystemEvent(activeDice[activeDice.length - 1], DICE_SYSTEM_EVENT_TYPE.SPAWN, {
          dice: group,
        });
      }
    }

    this.activeDice = activeDice;

    if (useProvidedBodies && providedBodies && providedBodyIndex !== providedBodies.length) {
      console.warn(
        `DiceBox consumed ${providedBodyIndex} deterministic bodies but received ${providedBodies.length}; proceeding with consumed set.`,
      );
    }

    const params: ThrowParams = {
      seed,
      bodies,
      config: simulationConfig,
    };

    options?.captureThrowParams?.(params);

    const simulation = await physicsClient.simulate(params);
    this.setupPlayback(simulation);

    this.show();
    this.startAnimating(this.handleFrame);

    return new Promise<boolean>((resolve) => {
      this.activeResolveBatch = [resolve];
    });
  }

  private setupPlayback(result: SimulationResult): void {
    const bodyIndexById = new Map<string, number>();
    for (let index = 0; index < result.frames.bodyIds.length; index += 1) {
      bodyIndexById.set(result.frames.bodyIds[index], index);
    }

    const resultsById = new Map(result.results.map((entry) => [entry.id, entry.value]));

    const lastFrame = Math.max(0, result.frames.frameCount - 1);

    for (const die of this.activeDice) {
      const bodyIndex = bodyIndexById.get(die.bodyId);
      if (bodyIndex === undefined) {
        continue;
      }

      const base = (bodyIndex * result.frames.frameCount + lastFrame) * 4;
      die.finalQuaternion.set(
        result.frames.rotations[base],
        result.frames.rotations[base + 1],
        result.frames.rotations[base + 2],
        result.frames.rotations[base + 3],
      );

      die.simulatedResult = resultsById.get(die.bodyId) ?? 0;
      die.correctedQuaternion = this.computeFaceSwapQuaternion(die);
    }

    const collisionsByFrame = new Map<number, CollisionEvent[]>();
    for (const event of result.collisions) {
      const frameEvents = collisionsByFrame.get(event.frame) ?? [];
      frameEvents.push(event);
      collisionsByFrame.set(event.frame, frameEvents);
    }

    this.playback = {
      frames: result.frames,
      lastFrame,
      elapsedSeconds: 0,
      lastAppliedFrame: -1,
      collisionsByFrame,
      bodyIndexById,
    };

    this.rolling = true;
  }

  private computeFaceSwapQuaternion(die: ActiveDie): Quaternion | null {
    const desired = valueForFaceSwap(die.shape, resolveDesiredFaceValue(die.die));
    const simulated = valueForFaceSwap(die.shape, die.simulatedResult);

    if (desired === simulated || desired <= 0 || simulated <= 0) {
      return null;
    }

    const simulatedNormal = getFaceNormalByValue(die.shape, simulated);
    const desiredNormal = getFaceNormalByValue(die.shape, desired);
    if (!simulatedNormal || !desiredNormal) {
      return null;
    }

    const delta = new Quaternion().setFromUnitVectors(desiredNormal, simulatedNormal).normalize();
    return die.finalQuaternion.clone().multiply(delta).normalize();
  }

  private createThrowVectorBasis(rng: Mulberry32): ThrowVectorBasis {
    const width = this.display.innerWidth ?? this.display.containerWidth ?? 800;
    const height = this.display.innerHeight ?? this.display.containerHeight ?? 600;

    const x = rng.range(-0.5, 1.5) * width;
    const y = -rng.range(-0.5, 1.5) * height;
    const dist = Math.max(1e-5, Math.hypot(x, y));
    const modifier = FORCE_MODIFIERS[this.throwingForce] ?? FORCE_MODIFIERS.medium;
    const boost = (rng.range(3, 4) * modifier) * dist;

    return { x, y, dist, boost };
  }

  private rotateThrowVector(x: number, y: number, rng: Mulberry32): { x: number; y: number } {
    const angle = rng.range(-Math.PI / 10, Math.PI / 10);
    const rx = x * Math.cos(angle) - y * Math.sin(angle);
    const ry = x * Math.sin(angle) + y * Math.cos(angle);
    return {
      x: rx === 0 ? 0.01 : rx,
      y: ry === 0 ? 0.01 : ry,
    };
  }

  private createBodyDefinition(args: {
    id: string;
    die: DieResult;
    shape: DieShape;
    throwIndex: number;
    basis: ThrowVectorBasis;
    rng: Mulberry32;
    mesh: Mesh;
  }): DiceBodyDef {
    const width = this.display.innerWidth ?? this.display.containerWidth ?? 800;
    const height = this.display.innerHeight ?? this.display.containerHeight ?? 600;

    const vec = this.rotateThrowVector(args.basis.x, args.basis.y, args.rng);
    const nx = vec.x / args.basis.dist;
    const ny = vec.y / args.basis.dist;

    const position: Vec3 = {
      x: width * (nx > 0 ? -1 : 1) * 0.9 + Math.floor(args.rng.range(-100, 101)),
      y: height * (ny > 0 ? -1 : 1) * 0.9 + Math.floor(args.rng.range(-100, 101)),
      z: args.rng.range(200, 400),
    };

    const projector = Math.abs(nx / ny);
    if (projector > 1) {
      position.y /= projector;
    } else {
      position.x *= projector;
    }

    const vel = this.rotateThrowVector(args.basis.x, args.basis.y, args.rng);
    const vnx = vel.x / args.basis.dist;
    const vny = vel.y / args.basis.dist;

    let velocity: Vec3 = {
      x: vnx * args.basis.boost,
      y: vny * args.basis.boost,
      z: -10,
    };

    let angularVelocity: Vec3 = {
      x: args.rng.range(-35, 35),
      y: args.rng.range(-35, 35),
      z: args.rng.range(-15, 15),
    };

    if (args.shape === 'd2') {
      velocity = {
        x: vnx * args.basis.boost * 0.1,
        y: vny * args.basis.boost * 0.1,
        z: 3000,
      };
      angularVelocity = {
        x: args.rng.range(6, 14),
        y: args.rng.range(0.5, 1.5),
        z: args.rng.range(-6, 6),
      };
    }

    const rotation = randomQuaternion(args.rng);

    const materialType = String(args.mesh.userData.material ?? 'plastic');
    let mass = Number(args.mesh.userData.mass ?? 300);
    if (!Number.isFinite(mass) || mass <= 0) {
      mass = 300;
    }

    if (materialType === 'metal') mass *= 7;
    if (materialType === 'wood') mass *= 0.65;
    if (materialType === 'glass') mass *= 2;
    if (materialType === 'stone') mass *= 1.5;

    let inertia = Number(args.mesh.userData.inertia ?? 13);
    if (!Number.isFinite(inertia) || inertia <= 0) {
      inertia = 13;
    }

    return {
      id: args.id,
      shape: args.shape,
      type: args.die.type,
      mass,
      inertia,
      position,
      velocity,
      angularVelocity,
      rotation: {
        x: rotation.x,
        y: rotation.y,
        z: rotation.z,
        w: rotation.w,
      },
      startAtIteration: args.throwIndex * ROLL_GROUP_STEP,
      secretRoll: args.die.options.secret === true,
    };
  }

  private resolveAppearanceOverrides(die: DieResult): Partial<DiceAppearance> {
    const appearance: Partial<DiceAppearance> = {};

    if (typeof die.options.colorset === 'string') {
      appearance.colorset = die.options.colorset;
    }

    if (typeof die.options.texture === 'string') {
      appearance.texture = die.options.texture;
    }

    if (typeof die.options.material === 'string') {
      appearance.material = die.options.material as DiceAppearance['material'];
    }

    if (typeof die.options.system === 'string') {
      appearance.system = die.options.system;
    }

    return appearance;
  }

  private limitThrowsByMaxDice(throws: DiceThrow[], maxDice: number): DiceThrow[] {
    const output: DiceThrow[] = [];
    let count = 0;

    for (const throwGroup of throws) {
      if (count >= maxDice) {
        break;
      }

      const dice = throwGroup.dice.slice(0, maxDice - count);
      if (dice.length === 0) {
        continue;
      }

      output.push({
        dice,
        dsnConfig: throwGroup.dsnConfig,
      });

      count += dice.length;
    }

    return output;
  }

  private clearActiveDiceFromScene(): void {
    for (const die of this.activeDice) {
      this.emitDiceSystemEvent(die, DICE_SYSTEM_EVENT_TYPE.DESPAWN, {
        dice: die.group,
      });
      this.scene.remove(die.group);
    }
    this.activeDice = [];
    this.bodyCollisionAudio.clear();
    this.outlineObjects.length = 0;
    this.playback = null;
    this.rolling = false;
    this.pendingHideAfterSfx = false;
  }

  private findActiveDieFromObject(object: Object3D): ActiveDie | null {
    let cursor: Object3D | null = object;
    while (cursor) {
      const userData = (cursor as { userData?: unknown }).userData;
      const id =
        userData && typeof userData === 'object'
          ? (userData as Record<string, unknown>).diceBodyId
          : undefined;
      if (typeof id === 'string') {
        return this.activeDice.find((die) => die.bodyId === id) ?? null;
      }
      cursor = cursor.parent;
    }
    return null;
  }

  private handleFrame = (context: RenderFrameContext): void => {
    if (this.playback) {
      this.applyPlaybackFrame(context);
    } else if (this.allowInteractivity && this.physicsClient) {
      if (this.interactionDragging || !this.interactionRealtimePending) {
        this.interactionRealtimePending = true;
        void this.physicsClient.playStep(context.deltaSeconds * this.speedMultiplier)
          .then((result) => {
            this.applyRealtimeStep(result);
          })
          .finally(() => {
            this.interactionRealtimePending = false;
          });
      }
    }

    this.sfxManager.renderSFX(context.deltaSeconds);

    if (!this.rolling && !this.playback && this.pendingHideAfterSfx && !this.sfxManager.hasActiveEffects()) {
      this.handleSfxQueueDrained();
    }
  };

  private applyPlaybackFrame(context: RenderFrameContext): void {
    if (!this.playback) {
      return;
    }

    this.playback.elapsedSeconds += context.deltaSeconds * this.speedMultiplier;

    const frameFloat = this.playback.elapsedSeconds / context.fixedStepSeconds;
    const clampedFrame = Math.min(this.playback.lastFrame, frameFloat);
    const frameA = Math.floor(clampedFrame);
    const frameB = Math.min(this.playback.lastFrame, frameA + 1);
    const alpha = clampedFrame - frameA;

    const bodyIndexById = this.playback.bodyIndexById;

    for (const die of this.activeDice) {
      const bodyIndex = bodyIndexById.get(die.bodyId);
      if (bodyIndex === undefined) {
        continue;
      }

      if (frameA < die.startAtIteration) {
        die.group.visible = false;
        continue;
      }

      die.group.visible = true;

      interpolateBodyPosition(
        this.playback.frames,
        bodyIndex,
        frameA,
        frameB,
        alpha,
        this.reusablePosition,
      );
      interpolateBodyRotation(
        this.playback.frames,
        bodyIndex,
        frameA,
        frameB,
        alpha,
        this.reusableQuaternion,
      );

      if (die.correctedQuaternion) {
        const swapStart = Math.max(die.startAtIteration, this.playback.lastFrame - FACE_SWAP_BLEND_FRAMES);
        if (frameA >= swapStart) {
          const denom = Math.max(1, this.playback.lastFrame - swapStart);
          const t = clamp((clampedFrame - swapStart) / denom, 0, 1);
          this.reusableQuaternion.slerp(die.correctedQuaternion, t);
        }
      }

      die.group.position.copy(this.reusablePosition);
      die.group.quaternion.copy(this.reusableQuaternion);
    }

    for (let frame = this.playback.lastAppliedFrame + 1; frame <= frameA; frame += 1) {
      const collisions = this.playback.collisionsByFrame.get(frame);
      if (!collisions) {
        continue;
      }
      for (const collision of collisions) {
        this.emitCollision(collision);
      }
    }

    this.playback.lastAppliedFrame = Math.max(this.playback.lastAppliedFrame, frameA);

    if (frameA < this.playback.lastFrame) {
      return;
    }

    for (const die of this.activeDice) {
      if (die.correctedQuaternion) {
        die.group.quaternion.copy(die.correctedQuaternion);
      } else {
        die.group.quaternion.copy(die.finalQuaternion);
      }

      this.emitDiceSystemEvent(die, DICE_SYSTEM_EVENT_TYPE.RESULT, {
        dice: die.group,
      });
    }

    this.playback = null;
    this.rolling = false;

    const startedSfx = this.triggerSpecialEffectsForSettledDice();

    for (const resolve of this.activeResolveBatch) {
      resolve(true);
    }
    this.activeResolveBatch = [];

    if (this.hideAfterRoll) {
      if (startedSfx || this.sfxManager.hasActiveEffects()) {
        this.pendingHideAfterSfx = true;
      } else {
        this.scheduleAutoHide();
        this.stopAnimating();
      }
    } else if (!this.allowInteractivity && !this.sfxManager.hasActiveEffects()) {
      this.stopAnimating();
    }
  }

  private applyRealtimeStep(result: RealtimeStepPayload): void {
    const indexById = new Map<string, number>();
    for (let i = 0; i < result.bodyIds.length; i += 1) {
      indexById.set(result.bodyIds[i], i);
    }

    for (const die of this.activeDice) {
      const index = indexById.get(die.bodyId);
      if (index === undefined) {
        continue;
      }

      const posOffset = index * 3;
      const rotOffset = index * 4;

      die.group.position.set(
        result.positions[posOffset],
        result.positions[posOffset + 1],
        result.positions[posOffset + 2],
      );

      die.group.quaternion.set(
        result.rotations[rotOffset],
        result.rotations[rotOffset + 1],
        result.rotations[rotOffset + 2],
        result.rotations[rotOffset + 3],
      );
    }

    for (const collision of result.collisions) {
      this.emitCollision(collision);
    }
  }

  private emitCollision(event: CollisionEvent): void {
    this.soundManager.handleCollision(event, {
      bodyA: this.bodyCollisionAudio.get(event.bodyA),
      bodyB: event.bodyB ? this.bodyCollisionAudio.get(event.bodyB) : undefined,
    });

    const dieA = this.activeDice.find((die) => die.bodyId === event.bodyA);
    if (dieA) {
      this.emitDiceSystemEvent(dieA, DICE_SYSTEM_EVENT_TYPE.COLLIDE, {
        dice: dieA.group,
        collision: event,
      });
    }

    if (event.bodyB) {
      const dieB = this.activeDice.find((die) => die.bodyId === event.bodyB);
      if (dieB && dieB.bodyId !== dieA?.bodyId) {
        this.emitDiceSystemEvent(dieB, DICE_SYSTEM_EVENT_TYPE.COLLIDE, {
          dice: dieB.group,
          collision: event,
        });
      }
    }

    for (const listener of this.collisionListeners) {
      listener(event);
    }
  }

  private emitDiceSystemEvent(
    die: ActiveDie,
    eventType: number,
    event: Record<string, unknown>,
  ): void {
    const systems = this.diceFactory?.systems;
    if (!(systems instanceof Map)) {
      return;
    }

    const system = systems.get(die.systemId);
    const fire = (system as { fire?: (type: number, data: unknown) => void } | undefined)?.fire;
    if (typeof fire !== 'function') {
      return;
    }

    try {
      fire.call(system, eventType, event);
    } catch (error) {
      console.warn(`DiceBox system event ${eventType} failed for ${die.systemId}.`, error);
    }
  }

  private createSfxMeshRef(die: ActiveDie): DiceMeshRef {
    const meshRef = die.group as unknown as DiceMeshRef;
    meshRef.shape = die.shape;
    meshRef.options = {
      ...die.die.options,
      secretRoll: die.die.options.secret === true,
    };
    return meshRef;
  }

  private triggerSpecialEffectsForSettledDice(): boolean {
    let started = false;

    for (const die of this.activeDice) {
      const specialEffects = die.die.specialEffects;
      if (!Array.isArray(specialEffects) || specialEffects.length === 0) {
        continue;
      }

      const meshRef = this.createSfxMeshRef(die);
      for (const effect of specialEffects) {
        started = true;
        void this.sfxManager.playSFX(effect, this, meshRef).catch((error) => {
          console.warn('DiceBox SFX playback failed:', error);
        });
      }
    }

    return started;
  }

  private handleSfxQueueDrained(): void {
    if (this.rolling || this.playback || this.sfxManager.hasActiveEffects()) {
      return;
    }

    if (this.pendingHideAfterSfx) {
      this.pendingHideAfterSfx = false;
      if (this.hideAfterRoll) {
        this.scheduleAutoHide();
        this.stopAnimating();
        return;
      }
    }

    if (!this.allowInteractivity) {
      this.stopAnimating();
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
      await this.loadCubemapEnvironment();
    }
  }

  getAssetLoadProgress(): AssetLoadProgress {
    return { ...this.assetLoadProgress };
  }

  onAssetLoadProgress(listener: (progress: AssetLoadProgress) => void): () => void {
    this.progressListeners.add(listener);
    listener(this.getAssetLoadProgress());
    return () => {
      this.progressListeners.delete(listener);
    };
  }

  private emitAssetLoadProgress(progress: AssetLoadProgress): void {
    this.assetLoadProgress = progress;
    for (const listener of this.progressListeners) {
      listener(this.getAssetLoadProgress());
    }
  }

  private reportAssetLoad(
    phase: AssetLoadProgress['phase'],
    loaded: number,
    total: number,
    item?: string,
  ): void {
    const safeTotal = Math.max(0, total);
    const safeLoaded = clamp(loaded, 0, safeTotal || loaded);
    const percent = safeTotal > 0 ? clamp((safeLoaded / safeTotal) * 100, 0, 100) : 0;
    this.emitAssetLoadProgress({ phase, loaded: safeLoaded, total: safeTotal, percent, item });
  }

  private disposeRendererAssetCaches(): void {
    const rendererBag = this.renderer as unknown as {
      envMap?: { dispose?: () => void } | null;
      textureCache?: {
        roughnessMaps?: Record<string, { dispose?: () => void }>;
      };
    };

    if (rendererBag.textureCache?.roughnessMaps) {
      for (const texture of Object.values(rendererBag.textureCache.roughnessMaps)) {
        texture?.dispose?.();
      }
      rendererBag.textureCache.roughnessMaps = {};
    }

    rendererBag.envMap?.dispose?.();
    rendererBag.envMap = null;
  }

  private replaceRendererRoughnessMaps(roughnessMaps: Record<string, { dispose?: () => void }>): void {
    const rendererBag = this.renderer as unknown as {
      textureCache?: {
        roughnessMaps?: Record<string, { dispose?: () => void }>;
      };
    };

    if (rendererBag.textureCache?.roughnessMaps) {
      for (const texture of Object.values(rendererBag.textureCache.roughnessMaps)) {
        texture?.dispose?.();
      }
    }

    rendererBag.textureCache = {
      roughnessMaps,
    };
  }

  private replaceRendererEnvironmentMap(envMap: { dispose?: () => void } | null): void {
    const rendererBag = this.renderer as unknown as {
      envMap?: { dispose?: () => void } | null;
    };

    const previous = rendererBag.envMap;
    if (previous && previous !== envMap) {
      previous.dispose?.();
    }

    rendererBag.envMap = envMap;
  }

  private loadHDREnvironment(): Promise<void> {
    return new Promise((resolve) => {
      this.reportAssetLoad('roughness', 0, 5, 'environment');

      const manager = new LoadingManager();
      manager.onProgress = (url, itemsLoaded, itemsTotal) => {
        const phase = url.endsWith('.hdr') ? 'environment' : 'roughness';
        this.reportAssetLoad(phase, itemsLoaded, itemsTotal, url);
      };
      manager.onError = (url) => {
        const current = this.getAssetLoadProgress();
        this.reportAssetLoad('error', current.loaded, Math.max(current.total, 1), url);
      };

      const pmremGen = new PMREMGenerator(
        this.renderer as unknown as ConstructorParameters<typeof PMREMGenerator>[0],
      );
      void pmremGen.compileEquirectangularShader();

      // Load roughness maps for texture cache (used by DiceFactory in Stage 4)
      const texLoader = new TextureLoader(manager);
      const base = 'modules/dice-tower/assets/textures/';
      const roughnessMaps = {
        fingerprint: texLoader.load(base + 'roughnessMap_finger.webp'),
        wood: texLoader.load(base + 'roughnessMap_wood.webp'),
        metal: texLoader.load(base + 'roughnessMap_metal.webp'),
        stone: texLoader.load(base + 'roughnessMap_stone.webp'),
      };
      for (const tex of Object.values(roughnessMaps)) {
        tex.anisotropy = this.anisotropy;
      }
      this.replaceRendererRoughnessMaps(roughnessMaps);

      new HDRLoader(manager)
        .setDataType(HalfFloatType)
        .setPath('modules/dice-tower/assets/textures/equirectangular/')
        .load('blouberg_sunrise_2_1k.hdr', (hdrTex) => {
          const envMap = pmremGen.fromEquirectangular(hdrTex).texture;
          envMap.colorSpace = SRGBColorSpace;
          if (this.scene) {
            this.scene.environment = envMap;
          }
          this.replaceRendererEnvironmentMap(envMap);
          hdrTex.dispose();
          pmremGen.dispose();
          const current = this.getAssetLoadProgress();
          const total = Math.max(current.total, 5);
          this.reportAssetLoad('complete', total, total, 'environment');
          resolve();
        }, undefined, () => {
          pmremGen.dispose();
          void this.loadCubemapEnvironment().then(resolve);
        });
    });
  }

  private loadCubemapEnvironment(): Promise<void> {
    return new Promise((resolve) => {
      this.reportAssetLoad('environment', 0, 6, 'cubemap');

      const manager = new LoadingManager();
      manager.onProgress = (url, itemsLoaded, itemsTotal) => {
        this.reportAssetLoad('environment', itemsLoaded, itemsTotal, url);
      };
      manager.onError = (url) => {
        const current = this.getAssetLoadProgress();
        this.reportAssetLoad('error', current.loaded, Math.max(current.total, 1), url);
      };

      const loader = new CubeTextureLoader(manager);
      loader.setPath('modules/dice-tower/assets/textures/cubemap/');
      loader.load(
        ['px.webp', 'nx.webp', 'py.webp', 'ny.webp', 'pz.webp', 'nz.webp'],
        (cubemap) => {
          if (this.scene) {
            this.scene.environment = cubemap;
          }
          this.replaceRendererEnvironmentMap(cubemap);
          const current = this.getAssetLoadProgress();
          const total = Math.max(current.total, 6);
          this.reportAssetLoad('complete', total, total, 'cubemap');
          resolve();
        },
      );
    });
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

    const distance = this.config.cameraDistance ?? DEFAULT_CAMERA_DISTANCE;
    this.camera.position.z = this.cameraHeight[distance];

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
      (this.desk.material as ShadowMaterial).dispose();
    }

    const cw = (this.display.containerWidth ?? 800) * 3;
    const ch = (this.display.containerHeight ?? 600) * 3;
    const deskSurface = this.config.deskSurface ?? DEFAULT_DESK_SURFACE;
    const shadowPlane = new ShadowMaterial({
      color: new Color(deskSurface.shadowColor),
      opacity: deskSurface.shadowOpacity,
      depthWrite: false,
    });
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

    if (this.runtimeReady) {
      void this.ensurePhysicsInitialized();
    }
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

  private isPostProcessingSupported(): boolean {
    return this.backend === 'webgpu';
  }

  private reconcilePostProcessing(): void {
    const shouldEnable = this.realisticLighting && this.isPostProcessingSupported();
    if (shouldEnable) {
      this.setupPostProcessing();
      return;
    }

    if (this.realisticLighting && !this.isPostProcessingSupported() && !this.postProcessingFallbackNotified) {
      this.postProcessingFallbackNotified = true;
      console.warn(
        'dice-tower | WebGPU backend unavailable; disabling post-processing on WebGL2 fallback to keep the dice overlay transparent.',
      );
    }

    if (this.renderPipeline) {
      this.renderPipeline.dispose?.();
      this.renderPipeline = null;
    }
  }

  /** Update bloom parameters at runtime (e.g. from settings change). */
  setBloom(cfg: Partial<BloomUniforms>): void {
    Object.assign(this.bloomUniforms, cfg);
    if (this.renderPipeline) {
      this.setupPostProcessing();
    }
  }

  /** Update desk shadow material properties at runtime. */
  setDeskSurfaceMaterial(surface: Partial<DeskSurfaceConfig>): void {
    this.config = normalizeDiceBoxConfig({
      ...this.config,
      deskSurface: {
        ...(this.config.deskSurface ?? DEFAULT_DESK_SURFACE),
        ...surface,
      },
    });
    this.setupDesk();
    this.renderScene();
  }

  /** Set camera distance preset and re-render. */
  setCameraDistance(distance: CameraDistanceMode): void {
    this.config.cameraDistance = distance;
    this.setupCamera();
    this.renderScene();
  }

  /** Configure fixed physics-step frequency used for interpolation timing context. */
  setFixedPhysicsFps(hz: number): void {
    if (!Number.isFinite(hz) || hz <= 0) return;
    this.fixedStepSeconds = 1 / hz;
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
      const pipeline = this.renderPipeline as unknown as {
        render?: () => void;
        renderAsync?: () => Promise<void>;
      };

      if (typeof pipeline.render === 'function') {
        pipeline.render();
      } else if (typeof pipeline.renderAsync === 'function') {
        void pipeline.renderAsync();
      }
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  // ─── Animation loop ────────────────────────────────────────────────────────

  /**
   * Start the render loop.
   * The optional `onFrame` callback runs each tick before rendering — Stage 5
   * plugs in physics frame interpolation here.
   */
  startAnimating(onFrame?: (context: RenderFrameContext) => void): void {
    if (this.animFrameId !== null) return;

    this.clock.reset();
    this.lastFrameTimeMs = null;
    this.fixedStepAccumulator = 0;
    this.frameCount = 0;

    const loop = (timeMs: number): void => {
      this.animFrameId = requestAnimationFrame(loop);

      if (this.lastFrameTimeMs === null) {
        this.lastFrameTimeMs = timeMs;
      }

      const deltaSeconds = Math.min(0.25, (timeMs - this.lastFrameTimeMs) / 1000);
      this.lastFrameTimeMs = timeMs;

      this.fixedStepAccumulator += deltaSeconds;
      let fixedSteps = 0;
      while (this.fixedStepAccumulator >= this.fixedStepSeconds) {
        this.fixedStepAccumulator -= this.fixedStepSeconds;
        fixedSteps += 1;
      }

      this.clock.update(timeMs);
      this.frameCount += 1;

      onFrame?.({
        deltaSeconds,
        elapsedSeconds: this.clock.getElapsed(),
        fixedStepSeconds: this.fixedStepSeconds,
        fixedSteps,
        interpolationAlpha: this.fixedStepAccumulator / this.fixedStepSeconds,
        frame: this.frameCount,
      });

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
    this.lastFrameTimeMs = null;
    this.fixedStepAccumulator = 0;
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

    debugLog('Hiding dice overlay', {
      activeDice: this.activeDice.length,
      running: this.running,
    });

    this.cancelAutoHide();
    this.stopAnimating();
  }

  /** Make canvas visible and start (or resume) the render loop. */
  show(): void {
    const el = this.renderer.domElement;
    el.style.opacity = '1';
    this.isVisible = true;

    debugLog('Showing dice overlay', {
      backend: this.backend,
      postProcessing: this.renderPipeline !== null,
      activeDice: this.activeDice.length,
    });
  }

  // ─── Resize handling ───────────────────────────────────────────────────────

  /**
   * Handle viewport resize (sidebar collapse, window resize, etc.).
   * Call from a ResizeObserver or Foundry's canvas resize hook.
   */
  resize(width?: number, height?: number): void {
    if (width !== undefined || height !== undefined) {
      this.config.dimensions = {
        width: width ?? this.config.dimensions?.width ?? this.container.clientWidth,
        height: height ?? this.config.dimensions?.height ?? this.container.clientHeight,
        margin: this.config.dimensions?.margin,
      };
    }
    this.setScene(this.config.dimensions);
  }

  // ─── Config update ─────────────────────────────────────────────────────────

  /**
   * Apply a partial config update at runtime (e.g. from settings dialog).
   * Rebuilds lighting + post-processing as needed.
   */
  async update(partial: Partial<DiceBoxConfig>): Promise<void> {
    const prev = this.config;
    this.config = normalizeDiceBoxConfig({ ...this.config, ...partial });

    const qualityChanged = partial.imageQuality !== undefined && partial.imageQuality !== prev.imageQuality;
    const shadowChanged = partial.shadowQuality !== undefined && partial.shadowQuality !== prev.shadowQuality;
    const ppChanged =
      partial.glow !== undefined || partial.antialiasing !== undefined;
    const layoutChanged = partial.dimensions !== undefined;

    if (qualityChanged) {
      this.realisticLighting = this.config.imageQuality !== 'low';
      this.renderer.shadowMap.enabled = this.config.shadowQuality !== 'low' || this.config.imageQuality !== 'low';
      this.renderer.shadowMap.type =
        this.config.shadowQuality === 'high' ? PCFSoftShadowMap : PCFShadowMap;
      this.renderer.toneMapping = this.realisticLighting ? ACESFilmicToneMapping : NoToneMapping;
      this.renderer.toneMappingExposure = 1.0;

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

    if (qualityChanged || ppChanged) {
      this.reconcilePostProcessing();
    }

    // Always reflow scene layout when scale/autoscale change
    if (partial.scale !== undefined || partial.autoscale !== undefined) {
      this.updateScale(this.config.scale, this.config.autoscale);
    }

    if (layoutChanged) {
      this.setScene(this.config.dimensions);
      if (this.runtimeReady) {
        await this.ensurePhysicsInitialized();
      }
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
    this.cancelAutoHide();
    this.stopAnimating();
    this.cancelQueueFlush();
    this.clearActiveDiceFromScene();

    for (const command of this.commandQueue) {
      command.reject(new Error('DiceBox disposed before queued roll could start.'));
    }
    this.commandQueue = [];
    this.activeResolveBatch = [];

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
    this.disposeRendererAssetCaches();
    this.renderer.dispose();
    this.renderer.domElement.remove();

    if (this.ownsPhysicsClient && this.physicsClient) {
      this.physicsClient.destroy();
    }
    this.physicsClient = null;
    this.diceFactory = null;
    this.runtimeReady = false;
    this.physicsUnavailable = false;
    this.physicsFailureNotified = false;
    this.bodyCollisionAudio.clear();
    this.soundManager.dispose();
    this.sfxManager.dispose();

    this.progressListeners.clear();
    this.reportAssetLoad('idle', 0, 0);
  }
}

// ─── Augment DisplayMetrics to carry the margin ───────────────────────────────

declare module '../types/rendering.js' {
  interface DisplayMetrics {
    containerMargin?: BoxMargin | null;
  }
}
