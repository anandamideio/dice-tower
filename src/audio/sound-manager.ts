import type { DieType } from '../types/dice.js';
import type { CollisionEvent } from '../types/physics.js';
import type { SoundsSurface } from '../types/settings.js';

const SOUND_BASE_PATH = 'modules/dice-tower/assets/sounds';
const SURFACES_JSON_URL = `${SOUND_BASE_PATH}/surfaces.json`;
const DICE_HIT_JSON_URL = `${SOUND_BASE_PATH}/dicehit.json`;

const DEFAULT_DICE_DENOMINATOR = 550;
const DEFAULT_SURFACE_DENOMINATOR = 500;
const MIN_STRENGTH = 0.2;

type DiceMaterialBucket = 'coin' | 'metal' | 'plastic' | 'wood';

interface AudioSprite {
  start: number;
  end: number;
  loop: boolean;
}

interface AudioSpriteMap {
  resources: string[];
  spritemap: Record<string, AudioSprite>;
}

interface SoundSpriteLibrary {
  sourceUrl: string;
  loaded: boolean;
  entries: Record<string, AudioSprite[]>;
}

interface FoundrySoundLike {
  src: string;
  load(): Promise<unknown>;
  play?(options: {
    loop?: boolean;
    loopStart?: number;
    loopEnd?: number;
    volume?: number;
  }): unknown;
}

type RuntimeGlobals = typeof globalThis & {
  game?: {
    audio?: {
      pending?: Array<() => void>;
      interface?: unknown;
      muted?: boolean;
      volume?: number;
    };
    settings?: {
      get(module: string, key: string): unknown;
    };
  };
  foundry?: {
    audio?: {
      Sound?: new (src: string, options?: Record<string, unknown>) => FoundrySoundLike;
      AudioHelper?: {
        preloadSound?: (src: string) => Promise<unknown>;
      };
    };
  };
};

export interface CollisionDieMetadata {
  dieType: DieType;
  material: string;
  secretRoll: boolean;
}

export interface CollisionSoundContext {
  bodyA?: CollisionDieMetadata;
  bodyB?: CollisionDieMetadata;
}

export interface SoundManagerConfig {
  sounds: boolean;
  volume: number;
  soundsSurface: SoundsSurface;
  muteSoundSecretRolls: boolean;
}

const DEFAULT_CONFIG: SoundManagerConfig = {
  sounds: true,
  volume: 0.5,
  soundsSurface: 'felt',
  muteSoundSecretRolls: false,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function calculateStrength(impulse: number, maxImpulse: number): number {
  const normalized = impulse / maxImpulse;
  return Math.max(Math.min(normalized, 1), MIN_STRENGTH);
}

function materialBucketForCollision(dieType: DieType, material: string): DiceMaterialBucket {
  if (dieType === 'dc') {
    return 'coin';
  }

  switch (material) {
    case 'metal':
    case 'chrome':
      return 'metal';
    case 'wood':
    case 'stone':
      return 'wood';
    default:
      return 'plastic';
  }
}

function parseSpriteGroups(
  spritemap: Record<string, AudioSprite>,
  prefix: string,
): Record<string, AudioSprite[]> {
  const output: Record<string, AudioSprite[]> = {};

  for (const [name, sprite] of Object.entries(spritemap)) {
    const match = name.match(new RegExp(`^${prefix}_([a-z_]+)`));
    if (!match) {
      continue;
    }

    const group = match[1];
    output[group] ??= [];
    output[group].push(sprite);
  }

  return output;
}

export class SoundManager {
  private config: SoundManagerConfig = { ...DEFAULT_CONFIG };

  private preloadQueued = false;

  private readonly surfaces: SoundSpriteLibrary = {
    sourceUrl: `${SOUND_BASE_PATH}/surfaces.mp3`,
    loaded: false,
    entries: {},
  };

  private readonly diceHits: SoundSpriteLibrary = {
    sourceUrl: `${SOUND_BASE_PATH}/dicehit.mp3`,
    loaded: false,
    entries: {},
  };

  update(config: Partial<SoundManagerConfig>): void {
    if (typeof config.sounds === 'boolean') {
      this.config.sounds = config.sounds;
    }

    if (typeof config.volume === 'number' && Number.isFinite(config.volume)) {
      this.config.volume = clamp(config.volume, 0, 1);
    }

    if (typeof config.soundsSurface === 'string') {
      this.config.soundsSurface = config.soundsSurface;
    }

    if (typeof config.muteSoundSecretRolls === 'boolean') {
      this.config.muteSoundSecretRolls = config.muteSoundSecretRolls;
    }

    this.ensurePreloaded();
  }

  dispose(): void {
    this.preloadQueued = false;
    this.surfaces.entries = {};
    this.surfaces.loaded = false;
    this.diceHits.entries = {};
    this.diceHits.loaded = false;
  }

  handleCollision(event: CollisionEvent, context: CollisionSoundContext): void {
    if (!this.config.sounds || this.config.volume <= 0) {
      return;
    }

    if (this.isGloballyMuted()) {
      return;
    }

    if (event.impulse <= 0) {
      return;
    }

    if (this.config.muteSoundSecretRolls && this.isSecretCollision(context)) {
      return;
    }

    if (event.type === 'die-die') {
      this.playDiceCollision(event, context.bodyA);
      return;
    }

    this.playSurfaceCollision(event);
  }

  private ensurePreloaded(): void {
    if (this.preloadQueued) {
      return;
    }

    this.preloadQueued = true;

    const runtime = globalThis as RuntimeGlobals;
    const pending = runtime.game?.audio?.pending;

    if (Array.isArray(pending)) {
      pending.push(() => {
        void this.preloadSounds();
      });
      return;
    }

    void this.preloadSounds();
  }

  private async preloadSounds(): Promise<void> {
    await Promise.all([
      this.loadLibrary(this.surfaces, SURFACES_JSON_URL, 'surface'),
      this.loadLibrary(this.diceHits, DICE_HIT_JSON_URL, 'dicehit'),
    ]);
  }

  private async loadLibrary(
    target: SoundSpriteLibrary,
    jsonUrl: string,
    prefix: string,
  ): Promise<void> {
    if (target.loaded) {
      return;
    }

    try {
      const response = await fetch(jsonUrl);
      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as AudioSpriteMap;
      const firstResource = payload.resources[0];
      if (typeof firstResource !== 'string') {
        return;
      }

      target.sourceUrl = `${SOUND_BASE_PATH}/${firstResource}`;
      target.entries = parseSpriteGroups(payload.spritemap, prefix);

      this.preloadRawSource(target.sourceUrl);
      target.loaded = true;
    } catch {
      // Loading failure should not break rolling.
    }
  }

  private preloadRawSource(sourceUrl: string): void {
    const runtime = globalThis as RuntimeGlobals;
    const helper = runtime.foundry?.audio?.AudioHelper;
    if (helper?.preloadSound) {
      void helper.preloadSound(sourceUrl);
      return;
    }

    const SoundCtor = runtime.foundry?.audio?.Sound;
    if (!SoundCtor) {
      return;
    }

    const sound = new SoundCtor(sourceUrl, {
      forceBuffer: true,
      context: runtime.game?.audio?.interface,
    });
    void sound.load().catch(() => undefined);
  }

  private playDiceCollision(event: CollisionEvent, bodyA?: CollisionDieMetadata): void {
    if (!this.diceHits.loaded) {
      return;
    }

    const dieType = bodyA?.dieType ?? 'd6';
    const material = bodyA?.material ?? 'plastic';
    const bucket = materialBucketForCollision(dieType, material);
    const sprites = this.diceHits.entries[bucket] ?? this.diceHits.entries.plastic;
    if (!sprites || sprites.length === 0) {
      return;
    }

    const sprite = sprites[Math.floor(Math.random() * sprites.length)];
    const strength = calculateStrength(event.impulse, DEFAULT_DICE_DENOMINATOR);
    this.playSprite(this.diceHits.sourceUrl, sprite, strength * this.config.volume);
  }

  private playSurfaceCollision(event: CollisionEvent): void {
    if (!this.surfaces.loaded) {
      return;
    }

    const sprites = this.surfaces.entries[this.config.soundsSurface];
    if (!sprites || sprites.length === 0) {
      return;
    }

    const sprite = sprites[Math.floor(Math.random() * sprites.length)];
    const strength = calculateStrength(event.impulse, DEFAULT_SURFACE_DENOMINATOR);
    this.playSprite(this.surfaces.sourceUrl, sprite, strength * this.config.volume);
  }

  private playSprite(sourceUrl: string, sprite: AudioSprite, volume: number): void {
    const runtime = globalThis as RuntimeGlobals;
    const SoundCtor = runtime.foundry?.audio?.Sound;
    if (!SoundCtor) {
      return;
    }

    const sound = new SoundCtor(sourceUrl, {
      forceBuffer: true,
      context: runtime.game?.audio?.interface,
    });

    void sound
      .load()
      .then((loaded) => {
        const playable = this.resolvePlayableSound(sound, loaded);
        playable.play?.({
          loop: sprite.loop,
          loopStart: sprite.start,
          loopEnd: sprite.end,
          volume,
        });
      })
      .catch(() => undefined);
  }

  private resolvePlayableSound(
    sound: FoundrySoundLike,
    loaded: unknown,
  ): FoundrySoundLike {
    if (loaded && typeof loaded === 'object' && typeof (loaded as FoundrySoundLike).play === 'function') {
      return loaded as FoundrySoundLike;
    }

    return sound;
  }

  private isSecretCollision(context: CollisionSoundContext): boolean {
    return context.bodyA?.secretRoll === true || context.bodyB?.secretRoll === true;
  }

  private isGloballyMuted(): boolean {
    const runtime = globalThis as RuntimeGlobals;
    const gameAudio = runtime.game?.audio;
    if (!gameAudio) {
      return false;
    }

    if (gameAudio.muted === true) {
      return true;
    }

    if (typeof gameAudio.volume === 'number' && gameAudio.volume <= 0) {
      return true;
    }

    if (!runtime.game?.settings?.get) {
      return false;
    }

    try {
      const interfaceVolume = runtime.game.settings.get('core', 'globalInterfaceVolume');
      if (typeof interfaceVolume === 'number' && interfaceVolume <= 0) {
        return true;
      }
    } catch {
      // Some hosts may not expose this setting.
    }

    return false;
  }
}
