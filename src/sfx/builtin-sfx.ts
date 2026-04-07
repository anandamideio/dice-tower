import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  Scene,
  Sprite,
  SpriteMaterial,
  Timer,
  Vector3,
} from 'three/webgpu';

import { DiceSFX, type DiceMeshRef } from '../api/dice-sfx.js';

const SFX_SOUND_BASE = 'modules/dice-tower/assets/sounds/sfx';

const TMP_VEC3 = new Vector3();
const TMP_QUATERNION = new Quaternion();

interface RuntimeGlobals {
  game?: {
    i18n?: {
      localize(key: string): string;
    };
    audio?: {
      interface?: unknown;
    };
    macros?: {
      get?(id: string): MacroLike | undefined;
      getName?(name: string): MacroLike | undefined;
    };
  };
  foundry?: {
    audio?: {
      AudioHelper?: {
        preloadSound?(src: string): Promise<unknown>;
        play?(options: { src: string; volume?: number; loop?: boolean }, push?: boolean): Promise<unknown>;
      };
      Sound?: new (src: string, options?: Record<string, unknown>) => FoundrySoundLike;
    };
  };
  fromUuidSync?(uuid: string): unknown;
}

interface FoundrySoundLike {
  load(): Promise<unknown>;
  play?(options?: { volume?: number; loop?: boolean }): unknown;
}

interface MacroLike {
  execute?(scope?: Record<string, unknown>): unknown;
}

interface SceneBox {
  scene: Scene;
}

interface OutlineBox {
  outlineObjects: Object3D[];
}

interface SFXRenderable {
  render(deltaSeconds?: number): void;
}

interface SFXDisposable {
  destroy(): void;
}

interface Particle {
  mesh: Mesh;
  velocity: Vector3;
  angularVelocity: number;
  initialScale: number;
}

function getRuntimeGlobals(): RuntimeGlobals {
  return globalThis as unknown as RuntimeGlobals;
}

function getObject3D(meshRef: DiceMeshRef): Object3D | null {
  const candidate = meshRef as unknown;
  if (!(candidate instanceof Object3D)) {
    return null;
  }
  return candidate;
}

function getRuntimeScene(box: unknown): Scene | null {
  const candidate = box as SceneBox;
  if (!candidate.scene || !(candidate.scene instanceof Scene)) {
    return null;
  }
  return candidate.scene;
}

function getOutlineObjects(box: unknown): Object3D[] | null {
  const candidate = box as OutlineBox;
  if (!Array.isArray(candidate.outlineObjects)) {
    return null;
  }
  return candidate.outlineObjects;
}

function findFirstMaterialMesh(root: Object3D): Mesh | null {
  if (root instanceof Mesh) {
    return root;
  }

  let resolved: Mesh | null = null;
  root.traverse((object) => {
    if (resolved || !(object instanceof Mesh)) {
      return;
    }
    resolved = object;
  });

  return resolved;
}

function supportsEmissive(material: unknown): material is MeshBasicMaterial & { emissive: Color; emissiveMap?: unknown } {
  if (!material || typeof material !== 'object') {
    return false;
  }
  const candidate = material as { emissive?: unknown };
  return candidate.emissive instanceof Color;
}

function supportsColor(material: unknown): material is MeshBasicMaterial & { color: Color } {
  if (!material || typeof material !== 'object') {
    return false;
  }
  const candidate = material as { color?: unknown };
  return candidate.color instanceof Color;
}

function setMaterialOpacity(material: unknown, opacity: number): void {
  if (!material || typeof material !== 'object') {
    return;
  }

  const candidate = material as {
    transparent?: boolean;
    opacity?: number;
    needsUpdate?: boolean;
  };

  candidate.transparent = true;
  candidate.opacity = opacity;
  candidate.needsUpdate = true;
}

function localizeName(i18nKey: string): string {
  const runtime = getRuntimeGlobals();
  return runtime.game?.i18n?.localize?.(i18nKey) ?? i18nKey;
}

function playOneShotSound(src: string, volume: number): void {
  if (volume <= 0) {
    return;
  }

  const runtime = getRuntimeGlobals();
  const helper = runtime.foundry?.audio?.AudioHelper;
  if (helper?.play) {
    void helper.play({ src, volume, loop: false }, false);
    return;
  }

  const SoundCtor = runtime.foundry?.audio?.Sound;
  if (!SoundCtor) {
    return;
  }

  const sound = new SoundCtor(src, {
    forceBuffer: true,
    context: runtime.game?.audio?.interface,
  });

  void sound
    .load()
    .then((loaded) => {
      const playable = loaded && typeof loaded === 'object' ? (loaded as FoundrySoundLike) : sound;
      playable.play?.({ volume, loop: false });
    })
    .catch(() => undefined);
}

function preloadSound(src: string): void {
  const runtime = getRuntimeGlobals();
  const helper = runtime.foundry?.audio?.AudioHelper;
  if (!helper?.preloadSound) {
    return;
  }
  void helper.preloadSound(src);
}

function createRadialGradientSpriteTexture(inner: string, outer: string): SpriteMaterial {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return new SpriteMaterial({ color: 0xffffff, transparent: true });
  }

  const gradient = ctx.createRadialGradient(128, 128, 6, 128, 128, 128);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(1, outer);

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);

  const material = new SpriteMaterial({
    map: new CanvasTexture(canvas),
    color: 0xffffff,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });

  return material;
}

function getWorldPositionAndQuaternion(meshRef: DiceMeshRef): { position: Vector3; quaternion: Quaternion } | null {
  const object = getObject3D(meshRef);
  if (!object) {
    return null;
  }

  object.getWorldPosition(TMP_VEC3);
  object.getWorldQuaternion(TMP_QUATERNION);

  return {
    position: TMP_VEC3.clone(),
    quaternion: TMP_QUATERNION.clone(),
  };
}

abstract class TimedDiceSFX extends DiceSFX implements SFXRenderable {
  protected readonly clock = new Timer();
  protected started = false;

  protected abstract durationSeconds: number;

  protected updateTimer(): void {
    if (!this.started) {
      return;
    }
    this.clock.update();
  }

  protected get progress(): number {
    if (!this.started) {
      return 0;
    }
    return Math.min(1, this.clock.getElapsed() / this.durationSeconds);
  }

  protected startTimer(): void {
    this.clock.reset();
    this.started = true;
    this.renderReady = true;
  }

  protected isExpired(): boolean {
    return this.started && this.clock.getElapsed() >= this.durationSeconds;
  }

  abstract render(deltaSeconds?: number): void;
}

abstract class TimedParticleSFX extends TimedDiceSFX implements SFXDisposable {
  protected readonly particleGroup = new Group();
  protected particles: Particle[] = [];
  protected gravity = -0.6;
  protected drag = 0.96;
  protected spawnRadius = 0.12;
  protected sizeRange: [number, number] = [0.03, 0.08];

  protected abstract particleCount: number;
  protected abstract particleColor: number;

  play(): Promise<void> {
    const scene = getRuntimeScene(this.box);
    const transform = getWorldPositionAndQuaternion(this.dicemesh);
    if (!scene || !transform) {
      return Promise.resolve();
    }

    this.particles = this.buildParticles();

    this.particleGroup.position.copy(transform.position);
    this.particleGroup.quaternion.copy(transform.quaternion);

    for (const particle of this.particles) {
      this.particleGroup.add(particle.mesh);
    }

    scene.add(this.particleGroup);
    this.startTimer();
    return Promise.resolve();
  }

  render(deltaSeconds = 1 / 60): void {
    if (!this.renderReady) {
      return;
    }

    this.updateTimer();

    const progress = this.progress;
    const opacity = Math.max(0, 1 - progress);

    for (const particle of this.particles) {
      const material = particle.mesh.material;
      setMaterialOpacity(material, opacity);

      particle.velocity.multiplyScalar(this.drag);
      particle.velocity.z += this.gravity * deltaSeconds;

      particle.mesh.position.addScaledVector(particle.velocity, deltaSeconds * 60);
      particle.mesh.rotation.z += particle.angularVelocity * deltaSeconds;

      const scale = particle.initialScale * (1 + progress * 0.6);
      particle.mesh.scale.set(scale, scale, scale);
    }

    if (this.isExpired()) {
      this.destroy();
    }
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.particleGroup.parent?.remove(this.particleGroup);

    for (const particle of this.particles) {
      particle.mesh.geometry.dispose();
      if (!Array.isArray(particle.mesh.material)) {
        particle.mesh.material.dispose();
      }
    }

    this.particles = [];
    this.destroyed = true;
  }

  protected buildParticles(): Particle[] {
    const particles: Particle[] = [];

    for (let i = 0; i < this.particleCount; i += 1) {
      const size = this.randomRange(this.sizeRange[0], this.sizeRange[1]);
      const material = new MeshBasicMaterial({
        color: this.particleColor,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        blending: AdditiveBlending,
      });

      const mesh = new Mesh(new PlaneGeometry(size, size), material);
      mesh.position.set(
        this.randomRange(-this.spawnRadius, this.spawnRadius),
        this.randomRange(-this.spawnRadius, this.spawnRadius),
        this.randomRange(0.01, this.spawnRadius),
      );

      const velocity = new Vector3(
        this.randomRange(-0.01, 0.01),
        this.randomRange(-0.01, 0.01),
        this.randomRange(0.012, 0.032),
      );

      particles.push({
        mesh,
        velocity,
        angularVelocity: this.randomRange(-6, 6),
        initialScale: size,
      });
    }

    return particles;
  }

  protected randomRange(min: number, max: number): number {
    return min + Math.random() * (max - min);
  }
}

abstract class TimedConfettiSFX extends TimedDiceSFX implements SFXDisposable {
  protected readonly confettiGroup = new Group();
  protected pieces: Particle[] = [];
  protected gravity = -0.0025;
  protected drag = 0.992;
  protected durationSeconds = 2.2;

  protected abstract strength: number;

  play(): Promise<void> {
    const scene = getRuntimeScene(this.box);
    const transform = getWorldPositionAndQuaternion(this.dicemesh);
    if (!scene || !transform) {
      return Promise.resolve();
    }

    this.pieces = this.buildPieces();

    this.confettiGroup.position.copy(transform.position);
    this.confettiGroup.position.z += 0.4;

    for (const piece of this.pieces) {
      this.confettiGroup.add(piece.mesh);
    }

    scene.add(this.confettiGroup);
    this.startTimer();
    return Promise.resolve();
  }

  render(deltaSeconds = 1 / 60): void {
    if (!this.renderReady) {
      return;
    }

    this.updateTimer();

    const opacity = Math.max(0, 1 - this.progress);

    for (const piece of this.pieces) {
      const material = piece.mesh.material;
      setMaterialOpacity(material, opacity);

      piece.velocity.multiplyScalar(this.drag);
      piece.velocity.z += this.gravity * deltaSeconds * 60;
      piece.mesh.position.addScaledVector(piece.velocity, deltaSeconds * 60);

      piece.mesh.rotation.x += piece.angularVelocity * deltaSeconds;
      piece.mesh.rotation.y += piece.angularVelocity * 0.5 * deltaSeconds;
    }

    if (this.isExpired()) {
      this.destroy();
    }
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.confettiGroup.parent?.remove(this.confettiGroup);
    for (const piece of this.pieces) {
      piece.mesh.geometry.dispose();
      if (!Array.isArray(piece.mesh.material)) {
        piece.mesh.material.dispose();
      }
    }
    this.pieces = [];
    this.destroyed = true;
  }

  private buildPieces(): Particle[] {
    const palette = [0xff5f6d, 0xffc371, 0x22c55e, 0x0ea5e9, 0xf59e0b, 0xf8fafc];
    const count = Math.max(8, this.strength);
    const output: Particle[] = [];

    for (let i = 0; i < count; i += 1) {
      const width = this.randomRange(0.02, 0.05);
      const height = this.randomRange(0.01, 0.04);
      const color = palette[Math.floor(Math.random() * palette.length)] ?? 0xffffff;

      const mesh = new Mesh(
        new PlaneGeometry(width, height),
        new MeshBasicMaterial({
          color,
          side: DoubleSide,
          transparent: true,
          opacity: 1,
          depthWrite: false,
        }),
      );

      mesh.position.set(
        this.randomRange(-0.14, 0.14),
        this.randomRange(-0.14, 0.14),
        this.randomRange(0, 0.1),
      );

      output.push({
        mesh,
        velocity: new Vector3(
          this.randomRange(-0.01, 0.01),
          this.randomRange(-0.01, 0.01),
          this.randomRange(0.02, 0.045),
        ),
        angularVelocity: this.randomRange(-12, 12),
        initialScale: 1,
      });
    }

    return output;
  }

  private randomRange(min: number, max: number): number {
    return min + Math.random() * (max - min);
  }
}

export class PlayAnimationBright extends TimedDiceSFX implements SFXDisposable {
  static id = 'PlayAnimationBright';
  static specialEffectName = 'DICESONICE.PlayAnimationBright';
  static brightColor = new Color(0.5, 0.5, 0.5);
  static duration = 0.6;
  static sound = `${SFX_SOUND_BASE}/bright.mp3`;

  protected durationSeconds = PlayAnimationBright.duration;

  private baseMaterial: Mesh['material'] | null = null;
  private targetMesh: Mesh | null = null;
  private baseColor: Color | null = null;

  static init(): Promise<boolean> {
    preloadSound(PlayAnimationBright.sound);
    return Promise.resolve(true);
  }

  play(): Promise<void> {
    const object = getObject3D(this.dicemesh);
    if (!object) {
      return Promise.resolve();
    }

    const target = findFirstMaterialMesh(object);
    if (!target || Array.isArray(target.material) || !supportsEmissive(target.material)) {
      return Promise.resolve();
    }

    this.baseMaterial = target.material;
    this.targetMesh = target;
    this.baseColor = target.material.emissive.clone();

    target.material = target.material.clone();
    playOneShotSound(PlayAnimationBright.sound, this.volume);
    this.startTimer();
    return Promise.resolve();
  }

  render(): void {
    if (!this.renderReady || !this.targetMesh || !this.baseColor) {
      return;
    }

    this.updateTimer();

    if (Array.isArray(this.targetMesh.material) || !supportsEmissive(this.targetMesh.material)) {
      this.destroy();
      return;
    }

    const x = this.progress;
    const val = (Math.sin(2 * Math.PI * (x - 0.25)) + 1) / 2;

    this.targetMesh.material.emissive.copy(this.baseColor);
    this.targetMesh.material.emissive.lerp(PlayAnimationBright.brightColor, val);

    if (this.isExpired()) {
      this.destroy();
    }
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }

    if (this.targetMesh && this.baseMaterial) {
      const sfxMaterial = this.targetMesh.material;
      this.targetMesh.material = this.baseMaterial;
      if (!Array.isArray(sfxMaterial)) {
        sfxMaterial.dispose();
      }
    }

    this.destroyed = true;
  }
}

export class PlayAnimationDark extends TimedDiceSFX implements SFXDisposable {
  static id = 'PlayAnimationDark';
  static specialEffectName = 'DICESONICE.PlayAnimationDark';
  static darkColor = new Color(0.12, 0.12, 0.12);
  static duration = 0.65;
  static sound = `${SFX_SOUND_BASE}/darkness.mp3`;

  protected durationSeconds = PlayAnimationDark.duration;

  private baseMaterial: Mesh['material'] | null = null;
  private targetMesh: Mesh | null = null;
  private baseColor: Color | null = null;

  static init(): Promise<boolean> {
    preloadSound(PlayAnimationDark.sound);
    return Promise.resolve(true);
  }

  play(): Promise<void> {
    const object = getObject3D(this.dicemesh);
    if (!object) {
      return Promise.resolve();
    }

    const target = findFirstMaterialMesh(object);
    if (!target || Array.isArray(target.material) || !supportsColor(target.material)) {
      return Promise.resolve();
    }

    this.baseMaterial = target.material;
    this.targetMesh = target;
    this.baseColor = target.material.color.clone();

    target.material = target.material.clone();
    playOneShotSound(PlayAnimationDark.sound, this.volume);
    this.startTimer();
    return Promise.resolve();
  }

  render(): void {
    if (!this.renderReady || !this.targetMesh || !this.baseColor) {
      return;
    }

    this.updateTimer();

    if (Array.isArray(this.targetMesh.material) || !supportsColor(this.targetMesh.material)) {
      this.destroy();
      return;
    }

    const x = this.progress;
    const val = (Math.sin(2 * Math.PI * (x - 0.25)) + 1) / 2;

    this.targetMesh.material.color.copy(this.baseColor);
    this.targetMesh.material.color.lerp(PlayAnimationDark.darkColor, val);

    if (this.isExpired()) {
      this.destroy();
    }
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }

    if (this.targetMesh && this.baseMaterial) {
      const sfxMaterial = this.targetMesh.material;
      this.targetMesh.material = this.baseMaterial;
      if (!Array.isArray(sfxMaterial)) {
        sfxMaterial.dispose();
      }
    }

    this.destroyed = true;
  }
}

export class PlayAnimationOutline extends TimedDiceSFX {
  static id = 'PlayAnimationOutline';
  static specialEffectName = 'DICESONICE.PlayAnimationOutline';
  static duration = 1.2;

  protected durationSeconds = PlayAnimationOutline.duration;

  private outlinedObject: Object3D | null = null;

  play(): Promise<void> {
    const object = getObject3D(this.dicemesh);
    const outlineObjects = getOutlineObjects(this.box);
    if (!object || !outlineObjects) {
      return Promise.resolve();
    }

    this.outlinedObject = object;
    if (!outlineObjects.includes(object)) {
      outlineObjects.push(object);
    }

    this.startTimer();
    return Promise.resolve();
  }

  render(): void {
    if (!this.renderReady) {
      return;
    }

    this.updateTimer();

    if (this.isExpired()) {
      this.destroy();
    }
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }

    const outlineObjects = getOutlineObjects(this.box);
    if (outlineObjects && this.outlinedObject) {
      const index = outlineObjects.indexOf(this.outlinedObject);
      if (index >= 0) {
        outlineObjects.splice(index, 1);
      }
    }

    this.destroyed = true;
  }
}

export class PlayAnimationImpact extends TimedDiceSFX implements SFXDisposable {
  static id = 'PlayAnimationImpact';
  static specialEffectName = 'DICESONICE.PlayAnimationImpact';
  static duration = 0.75;
  static sound = `${SFX_SOUND_BASE}/hit_glass.mp3`;

  protected durationSeconds = PlayAnimationImpact.duration;

  private sprite: Sprite | null = null;

  static init(): Promise<boolean> {
    preloadSound(PlayAnimationImpact.sound);
    return Promise.resolve(true);
  }

  play(): Promise<void> {
    const scene = getRuntimeScene(this.box);
    const transform = getWorldPositionAndQuaternion(this.dicemesh);
    if (!scene || !transform) {
      return Promise.resolve();
    }

    const material = createRadialGradientSpriteTexture('rgba(255,255,255,0.95)', 'rgba(255,180,72,0)');
    this.sprite = new Sprite(material);
    this.sprite.position.copy(transform.position);
    this.sprite.position.z += 0.02;
    this.sprite.scale.set(0.04, 0.04, 0.04);

    scene.add(this.sprite);
    playOneShotSound(PlayAnimationImpact.sound, this.volume);
    this.startTimer();
    return Promise.resolve();
  }

  render(): void {
    if (!this.renderReady || !this.sprite || !(this.sprite.material instanceof SpriteMaterial)) {
      return;
    }

    this.updateTimer();

    const progress = this.progress;
    const size = 0.05 + progress * 0.6;
    this.sprite.scale.set(size, size, size);
    this.sprite.material.opacity = Math.max(0, 1 - progress);

    if (this.isExpired()) {
      this.destroy();
    }
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }

    if (this.sprite) {
      this.sprite.parent?.remove(this.sprite);
      if (this.sprite.material instanceof SpriteMaterial) {
        this.sprite.material.map?.dispose();
        this.sprite.material.dispose();
      }
    }

    this.sprite = null;
    this.destroyed = true;
  }
}

export class PlayAnimationThrow extends TimedDiceSFX implements SFXDisposable {
  static id = 'PlayAnimationThrow';
  static specialEffectName = 'DICESONICE.PlayAnimationThrow';
  static duration = 0.9;
  static sound = `${SFX_SOUND_BASE}/thormund.mp3`;

  protected durationSeconds = PlayAnimationThrow.duration;

  private trail: Mesh | null = null;
  private basePosition: Vector3 | null = null;

  static init(): Promise<boolean> {
    preloadSound(PlayAnimationThrow.sound);
    return Promise.resolve(true);
  }

  play(): Promise<void> {
    const scene = getRuntimeScene(this.box);
    const transform = getWorldPositionAndQuaternion(this.dicemesh);
    if (!scene || !transform) {
      return Promise.resolve();
    }

    this.basePosition = transform.position.clone();

    this.trail = new Mesh(
      new PlaneGeometry(0.15, 0.45),
      new MeshBasicMaterial({
        color: 0x99ddff,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );

    this.trail.position.copy(transform.position);
    this.trail.position.z += 0.08;
    this.trail.quaternion.copy(transform.quaternion);

    scene.add(this.trail);
    playOneShotSound(PlayAnimationThrow.sound, this.volume);
    this.startTimer();
    return Promise.resolve();
  }

  render(): void {
    if (!this.renderReady || !this.trail || !this.basePosition) {
      return;
    }

    this.updateTimer();

    const progress = this.progress;
    this.trail.position.copy(this.basePosition);
    this.trail.position.z += progress * 0.8;

    if (!Array.isArray(this.trail.material)) {
      this.trail.material.opacity = Math.max(0, 0.8 - progress);
      this.trail.material.needsUpdate = true;
    }

    if (this.isExpired()) {
      this.destroy();
    }
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }

    if (this.trail) {
      this.trail.parent?.remove(this.trail);
      this.trail.geometry.dispose();
      if (!Array.isArray(this.trail.material)) {
        this.trail.material.dispose();
      }
    }

    this.trail = null;
    this.basePosition = null;
    this.destroyed = true;
  }
}

export class PlayAnimationThormund extends PlayAnimationThrow {
  static id = 'PlayAnimationThormund';
  static specialEffectName = 'DICESONICE.PlayAnimationThormund';
}

export class PlayAnimationParticleSparkles extends TimedParticleSFX {
  static id = 'PlayAnimationParticleSparkles';
  static specialEffectName = 'DICESONICE.PlayAnimationParticleSparkles';
  static sound = `${SFX_SOUND_BASE}/sparkles.mp3`;

  protected durationSeconds = 1.4;
  protected particleCount = 22;
  protected particleColor = 0xffe08c;

  static init(): Promise<boolean> {
    preloadSound(PlayAnimationParticleSparkles.sound);
    return Promise.resolve(true);
  }

  async play(): Promise<void> {
    await super.play();
    if (this.renderReady) {
      playOneShotSound(PlayAnimationParticleSparkles.sound, this.volume);
    }
  }
}

export class PlayAnimationParticleSpiral extends TimedParticleSFX {
  static id = 'PlayAnimationParticleSpiral';
  static specialEffectName = 'DICESONICE.PlayAnimationParticleSpiral';
  static sound = `${SFX_SOUND_BASE}/doublespiral.mp3`;

  protected durationSeconds = 1.6;
  protected particleCount = 28;
  protected particleColor = 0x7dd3fc;
  protected gravity = -0.2;
  protected drag = 0.985;

  static init(): Promise<boolean> {
    preloadSound(PlayAnimationParticleSpiral.sound);
    return Promise.resolve(true);
  }

  protected override buildParticles(): Particle[] {
    const particles = super.buildParticles();
    for (let index = 0; index < particles.length; index += 1) {
      const particle = particles[index];
      const angle = (index / Math.max(1, particles.length)) * Math.PI * 2;
      particle.velocity.x = Math.cos(angle) * 0.012;
      particle.velocity.y = Math.sin(angle) * 0.012;
      particle.velocity.z = 0.016;
    }
    return particles;
  }

  async play(): Promise<void> {
    await super.play();
    if (this.renderReady) {
      playOneShotSound(PlayAnimationParticleSpiral.sound, this.volume);
    }
  }
}

export class PlayAnimationParticleVortex extends TimedParticleSFX {
  static id = 'PlayAnimationParticleVortex';
  static specialEffectName = 'DICESONICE.PlayAnimationParticleVortex';
  static sound = `${SFX_SOUND_BASE}/vortex.mp3`;

  protected durationSeconds = 1.5;
  protected particleCount = 32;
  protected particleColor = 0xf472b6;
  protected gravity = -0.08;
  protected drag = 0.99;

  static init(): Promise<boolean> {
    preloadSound(PlayAnimationParticleVortex.sound);
    return Promise.resolve(true);
  }

  render(deltaSeconds = 1 / 60): void {
    if (!this.renderReady) {
      return;
    }

    this.updateTimer();

    const elapsed = this.clock.getElapsed();
    const twist = elapsed * 7;

    for (let index = 0; index < this.particles.length; index += 1) {
      const particle = this.particles[index];
      const radius = Math.max(0.03, particle.mesh.position.length() * 0.98);
      const angle = twist + index * 0.45;

      particle.mesh.position.x = Math.cos(angle) * radius;
      particle.mesh.position.y = Math.sin(angle) * radius;
      particle.mesh.position.z += particle.velocity.z * deltaSeconds * 45;

      const material = particle.mesh.material;
      setMaterialOpacity(material, Math.max(0, 1 - this.progress));
    }

    if (this.isExpired()) {
      this.destroy();
    }
  }

  async play(): Promise<void> {
    await super.play();
    if (this.renderReady) {
      playOneShotSound(PlayAnimationParticleVortex.sound, this.volume);
    }
  }
}

export class PlayConfettiStrength1 extends TimedConfettiSFX {
  static id = 'PlayConfettiStrength1';
  static specialEffectName = 'DICESONICE.PlayConfettiStrength1';

  protected strength = 18;
}

export class PlayConfettiStrength2 extends TimedConfettiSFX {
  static id = 'PlayConfettiStrength2';
  static specialEffectName = 'DICESONICE.PlayConfettiStrength2';

  protected strength = 34;
}

export class PlayConfettiStrength3 extends TimedConfettiSFX {
  static id = 'PlayConfettiStrength3';
  static specialEffectName = 'DICESONICE.PlayConfettiStrength3';

  protected strength = 52;
}

abstract class SimpleSoundSFX extends DiceSFX {
  protected abstract src: string;

  play(): Promise<void> {
    playOneShotSound(this.src, this.volume);
    return Promise.resolve();
  }
}

export class PlaySoundEpicWin extends SimpleSoundSFX {
  static id = 'PlaySoundEpicWin';
  static specialEffectName = 'DICESONICE.PlaySoundEpicWin';
  static sound = `${SFX_SOUND_BASE}/epic_win.mp3`;

  protected src = PlaySoundEpicWin.sound;

  static init(): Promise<boolean> {
    preloadSound(PlaySoundEpicWin.sound);
    return Promise.resolve(true);
  }
}

export class PlaySoundEpicFail extends SimpleSoundSFX {
  static id = 'PlaySoundEpicFail';
  static specialEffectName = 'DICESONICE.PlaySoundEpicFail';
  static sound = `${SFX_SOUND_BASE}/epic_fail.mp3`;

  protected src = PlaySoundEpicFail.sound;

  static init(): Promise<boolean> {
    preloadSound(PlaySoundEpicFail.sound);
    return Promise.resolve(true);
  }
}

export class PlayMacro extends DiceSFX {
  static id = 'PlayMacro';
  static specialEffectName = 'DICESONICE.PlayMacro';
  static PLAY_ONLY_ONCE_PER_MESH = true;

  async play(): Promise<void> {
    const runtime = getRuntimeGlobals();
    const rawOptions = this.options as Record<string, unknown>;

    const macroUuid = typeof rawOptions.macroUuid === 'string' ? rawOptions.macroUuid : undefined;
    const macroId = typeof rawOptions.macroId === 'string' ? rawOptions.macroId : undefined;
    const macroName = typeof rawOptions.macroName === 'string'
      ? rawOptions.macroName
      : (typeof rawOptions.macro === 'string' ? rawOptions.macro : undefined);

    let macro: MacroLike | null = null;

    if (macroUuid && typeof runtime.fromUuidSync === 'function') {
      const resolved = runtime.fromUuidSync(macroUuid);
      if (resolved && typeof resolved === 'object') {
        macro = resolved as MacroLike;
      }
    }

    if (!macro && macroId) {
      macro = runtime.game?.macros?.get?.(macroId) ?? null;
    }

    if (!macro && macroName) {
      macro = runtime.game?.macros?.getName?.(macroName) ?? null;
    }

    if (!macro?.execute) {
      return;
    }

    await Promise.resolve(
      macro.execute({
        sfxId: PlayMacro.id,
        die: this.dicemesh,
        options: this.options,
      }),
    );
  }
}

export const BUILTIN_SFX_MODE_CLASSES = {
  PlayAnimationBright,
  PlayAnimationDark,
  PlayAnimationOutline,
  PlayAnimationImpact,
  PlayAnimationThrow,
  PlayAnimationThormund,
  PlayAnimationParticleSparkles,
  PlayAnimationParticleSpiral,
  PlayAnimationParticleVortex,
  PlayConfettiStrength1,
  PlayConfettiStrength2,
  PlayConfettiStrength3,
  PlaySoundEpicWin,
  PlaySoundEpicFail,
  PlayMacro,
} as const;

export type BuiltinSFXClassId = keyof typeof BUILTIN_SFX_MODE_CLASSES;

export function getBuiltinSfxModesLocalized(): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [id, ctor] of Object.entries(BUILTIN_SFX_MODE_CLASSES)) {
    output[id] = localizeName(ctor.specialEffectName);
  }
  return output;
}
