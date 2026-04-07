import type { IDiceBox, IDiceSFXClass } from '../api/dice3d.js';
import type { DiceMeshRef } from '../api/dice-sfx.js';
import type { SFXLine, SFXLineResolved } from '../types/dice.js';
import type { SFXTriggerResult, SFXTriggerType } from '../types/sfx.js';
import { BUILTIN_SFX_MODE_CLASSES } from './builtin-sfx.js';

interface SFXRenderableInstance {
  destroyed?: boolean;
  enableGC?: boolean;
  renderReady?: boolean;
  render?(deltaSeconds?: number): void;
  destroy?(): void;
}

type SFXClassRecord = Record<string, IDiceSFXClass>;

interface RuntimeUserLike {
  id: string;
  isGM?: boolean;
  getFlag(scope: string, key: string): unknown;
}

interface RuntimeUsersCollection {
  forEach(callback: (user: RuntimeUserLike) => void): void;
}

interface RuntimeGameLike {
  user?: RuntimeUserLike;
  users?: RuntimeUsersCollection;
}

export interface DiceSFXManagerOptions {
  playDelayBaseMs?: number;
  playDelayJitterMs?: number;
  onQueueEmpty?: () => void;
}

function localize(i18nKey: string): string {
  const runtime = globalThis as typeof globalThis & {
    game?: {
      i18n?: {
        localize?(key: string): string;
      };
    };
  };

  return runtime.game?.i18n?.localize?.(i18nKey) ?? i18nKey;
}

function extractUserData(mesh: DiceMeshRef): Record<string, unknown> {
  const candidate = mesh as unknown as { userData?: unknown };
  if (candidate.userData && typeof candidate.userData === 'object') {
    return candidate.userData as Record<string, unknown>;
  }

  const fallback: Record<string, unknown> = {};
  (mesh as unknown as { userData?: Record<string, unknown> }).userData = fallback;
  return fallback;
}

function wait(delayMs: number): Promise<void> {
  if (delayMs <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function readUserFlagSafe(user: RuntimeUserLike, scope: string, key: string): unknown {
  try {
    return user.getFlag(scope, key);
  } catch {
    const candidate = user as unknown as { flags?: Record<string, unknown> };
    const scopeFlags = candidate.flags?.[scope];
    if (!scopeFlags || typeof scopeFlags !== 'object') {
      return undefined;
    }

    return (scopeFlags as Record<string, unknown>)[key];
  }
}

export class DiceSFXManager {
  private readonly sfxModeClasses: SFXClassRecord = {
    ...BUILTIN_SFX_MODE_CLASSES,
  };

  private readonly initializedClasses: SFXClassRecord = {};
  private readonly modeList: Record<string, string> = {};
  private readonly renderQueue: SFXRenderableInstance[] = [];
  private readonly garbageCollector: SFXRenderableInstance[] = [];

  private readonly extraTriggerTypes: SFXTriggerType[] = [];
  private readonly extraTriggerResults: Record<string, SFXTriggerResult[]> = {};

  private playDelayBaseMs: number;
  private playDelayJitterMs: number;
  private onQueueEmpty: (() => void) | null;
  private pendingPlayCount = 0;
  private generation = 0;

  constructor(options: DiceSFXManagerOptions = {}) {
    this.playDelayBaseMs = Math.max(0, options.playDelayBaseMs ?? 100);
    this.playDelayJitterMs = Math.max(0, options.playDelayJitterMs ?? 750);
    this.onQueueEmpty = options.onQueueEmpty ?? null;

    for (const [id, ctor] of Object.entries(this.sfxModeClasses)) {
      this.modeList[id] = ctor.specialEffectName;
    }
  }

  setOnQueueEmpty(callback: (() => void) | null): void {
    this.onQueueEmpty = callback;
  }

  setPlaybackDelay(baseMs: number, jitterMs: number): void {
    this.playDelayBaseMs = Math.max(0, baseMs);
    this.playDelayJitterMs = Math.max(0, jitterMs);
  }

  getRenderQueueLength(): number {
    return this.renderQueue.length;
  }

  hasActiveEffects(): boolean {
    return this.renderQueue.length > 0 || this.pendingPlayCount > 0;
  }

  getSFXModes(localized = true): Record<string, string> {
    const output: Record<string, string> = {};
    for (const [id, key] of Object.entries(this.modeList)) {
      output[id] = localized ? localize(key) : key;
    }
    return output;
  }

  getExtraTriggerTypes(): SFXTriggerType[] {
    return [...this.extraTriggerTypes];
  }

  getExtraTriggerResults(): Record<string, SFXTriggerResult[]> {
    const output: Record<string, SFXTriggerResult[]> = {};
    for (const [id, results] of Object.entries(this.extraTriggerResults)) {
      output[id] = [...results];
    }
    return output;
  }

  /**
   * Resolve a user's effective SFX list from flags, including GM-global entries.
   *
   * This mirrors DSN's SFX resolution strategy used by the config and roll pipelines.
   */
  getUserSFXList(user?: RuntimeUserLike | null): SFXLine[] {
    const runtime = globalThis as typeof globalThis & { game?: RuntimeGameLike };
    const effectiveUser = user ?? runtime.game?.user;
    if (!effectiveUser) {
      return [];
    }

    const merged = this.readSFXListFromFlags(effectiveUser);

    runtime.game?.users?.forEach((candidate) => {
      if (!candidate.isGM || candidate.id === effectiveUser.id) {
        return;
      }

      const gmSfx = this.readSFXListFromFlags(candidate).filter((line) => line.options?.isGlobal === true);
      merged.push(...gmSfx);
    });

    const deduped: SFXLine[] = [];
    const seen = new Set<string>();

    for (const line of merged) {
      const key = JSON.stringify(line);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      deduped.push(line);
    }

    return deduped;
  }

  addSFXTrigger(id: string, name: string, results: string[]): void {
    if (this.extraTriggerResults[id]) {
      return;
    }

    this.extraTriggerTypes.push({ id, name });
    this.extraTriggerResults[id] = results.map((result) => ({
      id: result,
      name: result,
    }));
  }

  registerSFXModeClass(sfxClass: IDiceSFXClass): void {
    if (!sfxClass?.id || !sfxClass.specialEffectName) {
      return;
    }

    this.sfxModeClasses[sfxClass.id] = sfxClass;
    this.modeList[sfxClass.id] = sfxClass.specialEffectName;
  }

  async addSFXMode(sfxClass: IDiceSFXClass): Promise<void> {
    this.registerSFXModeClass(sfxClass);

    if (this.initializedClasses[sfxClass.id]) {
      return;
    }

    this.initializedClasses[sfxClass.id] = sfxClass;

    if (typeof sfxClass.init === 'function') {
      await sfxClass.init();
    }
  }

  async playSFX(
    sfx: SFXLineResolved,
    box: IDiceBox,
    diceMesh: DiceMeshRef,
  ): Promise<void> {
    const id = sfx.specialEffect;
    const ctor = this.sfxModeClasses[id];
    if (!ctor) {
      return;
    }

    if (!this.initializedClasses[id]) {
      await this.addSFXMode(ctor);
    }

    const userData = extractUserData(diceMesh);
    const playedSet = ((): Set<string> => {
      const existing = userData._sfxPlayed;
      if (existing instanceof Set) {
        const typed = new Set<string>();
        for (const value of existing.values()) {
          if (typeof value === 'string') {
            typed.add(value);
          }
        }
        userData._sfxPlayed = typed;
        return typed;
      }
      const created = new Set<string>();
      userData._sfxPlayed = created;
      return created;
    })();

    if (ctor.PLAY_ONLY_ONCE_PER_MESH && playedSet.has(id)) {
      return;
    }

    playedSet.add(id);

    const activeGeneration = this.generation;
    this.pendingPlayCount += 1;

    try {
      const jitter = this.playDelayJitterMs > 0
        ? Math.floor(Math.random() * (this.playDelayJitterMs + 1))
        : 0;
      const delay = this.playDelayBaseMs + jitter;
      await wait(delay);

      if (this.generation !== activeGeneration) {
        return;
      }

      const instance = new ctor(box, diceMesh, sfx.options ?? {});
      await instance.play();
      if (this.generation !== activeGeneration) {
        return;
      }

      const runtime = instance as SFXRenderableInstance;
      if (typeof runtime.render === 'function') {
        this.renderQueue.push(runtime);
      }

      if (runtime.enableGC) {
        this.garbageCollector.push(runtime);
      }
    } finally {
      this.pendingPlayCount = Math.max(0, this.pendingPlayCount - 1);
      if (!this.hasActiveEffects()) {
        this.onQueueEmpty?.();
      }
    }
  }

  async playSFXList(
    effects: SFXLineResolved[],
    box: IDiceBox,
    diceMesh: DiceMeshRef,
  ): Promise<void> {
    for (const effect of effects) {
      await this.playSFX(effect, box, diceMesh);
    }
  }

  renderSFX(deltaSeconds = 1 / 60): void {
    if (this.renderQueue.length === 0) {
      return;
    }

    const queue = [...this.renderQueue];
    for (const effect of queue) {
      if (effect.destroyed) {
        this.endSFX(effect);
        continue;
      }

      effect.render?.(deltaSeconds);

      if (effect.destroyed) {
        this.endSFX(effect);
      }
    }
  }

  clearQueue(): void {
    this.generation += 1;

    const queue = [...this.renderQueue];
    for (const effect of queue) {
      effect.destroy?.();
      this.endSFX(effect);
    }

    for (const effect of this.garbageCollector) {
      effect.destroy?.();
    }
    this.garbageCollector.length = 0;
    this.pendingPlayCount = 0;

    if (!this.hasActiveEffects()) {
      this.onQueueEmpty?.();
    }
  }

  dispose(): void {
    this.clearQueue();
    this.onQueueEmpty = null;
  }

  private readSFXListFromFlags(user: RuntimeUserLike): SFXLine[] {
    const payload =
      readUserFlagSafe(user, 'dice-so-nice', 'sfxList')
      ?? readUserFlagSafe(user, 'dice-tower', 'sfxList');

    if (Array.isArray(payload)) {
      return payload.filter((entry): entry is SFXLine => this.isSFXLine(entry));
    }

    if (!payload || typeof payload !== 'object') {
      return [];
    }

    return Object.values(payload).filter((entry): entry is SFXLine => this.isSFXLine(entry));
  }

  private isSFXLine(value: unknown): value is SFXLine {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const candidate = value as {
      diceType?: unknown;
      onResult?: unknown;
      specialEffect?: unknown;
      options?: unknown;
    };

    return (
      typeof candidate.diceType === 'string' &&
      Array.isArray(candidate.onResult) &&
      typeof candidate.specialEffect === 'string' &&
      (candidate.options === undefined || (typeof candidate.options === 'object' && candidate.options !== null))
    );
  }

  private endSFX(effect: SFXRenderableInstance): void {
    const index = this.renderQueue.indexOf(effect);
    if (index >= 0) {
      this.renderQueue.splice(index, 1);
    }

    if (this.renderQueue.length === 0) {
      this.onQueueEmpty?.();
    }
  }
}
