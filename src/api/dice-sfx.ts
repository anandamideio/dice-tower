/**
 * DiceSFX — abstract base class for special effect implementations.
 *
 * Extension authors subclass this to create custom SFX that can be
 * registered via `game.dice3d.addSFXMode()`.
 */

import type { IDiceBox } from './dice3d.js';
import type { SFXPlaybackOptions } from '../types/sfx.js';
import type { SFXLine } from '../types/dice.js';

/** Minimal dice mesh interface needed by SFX effects. */
export interface DiceMeshRef {
  shape: string;
  options: {
    secretRoll?: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Base class for all dice special effects.
 *
 * Subclasses must define the static `id` and `specialEffectName` properties
 * and implement the `play()` method.
 */
export abstract class DiceSFX {
  /** Unique identifier for this SFX type. Must be overridden by subclasses. */
  static id: string;
  /** Localization key for the display name. Must be overridden by subclasses. */
  static specialEffectName: string;
  /** Whether to only play once per logical die (e.g. d100 is two meshes). */
  static PLAY_ONLY_ONCE_PER_MESH = false;

  readonly options: SFXPlaybackOptions;
  readonly dicemesh: DiceMeshRef;
  readonly box: IDiceBox;
  destroyed = false;
  enableGC = false;
  renderReady = false;
  readonly volume: number;

  constructor(box: IDiceBox, dicemesh: DiceMeshRef, options?: Partial<SFXPlaybackOptions>) {
    const defaults: SFXPlaybackOptions = { isGlobal: false, muteSound: false };
    this.options = { ...defaults, ...options };
    this.dicemesh = dicemesh;
    this.box = box;
    this.volume = this.options.muteSound ? 0 : 1;
  }

  /** Called once when the SFX type is first used. Override for async asset loading. */
  static async init(): Promise<boolean> {
    return true;
  }

  /** Play the special effect. Must be implemented by subclasses. */
  abstract play(): Promise<void>;

  /** Helper to load an asset via a Three.js-style loader. */
  static async loadAsset<T>(
    loader: { load(url: string, onLoad: (data: T) => void, onProgress: null, onError: (err: unknown) => void): void },
    url: string,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      loader.load(url, resolve, null, reject);
    });
  }

  /** Return config dialog content for the SFX settings UI. Override in subclasses. */
  static getDialogContent(
    _sfxLine: SFXLine,
    _id: string,
  ): { content: string; data: Record<string, unknown> } {
    return { content: '', data: {} };
  }
}
