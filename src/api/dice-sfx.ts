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
  userData?: Record<string, unknown>;
  [key: string]: unknown;
}

interface SFXBoxRuntime {
  sfxVolume?: number;
  muteSoundSecretRollsEnabled?: boolean;
  muteSoundSecretRolls?: boolean;
  diceFactory?: {
    baseScale?: number;
  };
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

    const runtimeBox = box as unknown as SFXBoxRuntime;
    const baseVolume =
      typeof runtimeBox.sfxVolume === 'number' && Number.isFinite(runtimeBox.sfxVolume)
        ? Math.max(0, Math.min(1, runtimeBox.sfxVolume))
        : 1;

    const secretRollMuted =
      dicemesh.options.secretRoll === true &&
      (runtimeBox.muteSoundSecretRollsEnabled === true || runtimeBox.muteSoundSecretRolls === true);

    this.volume = this.options.muteSound || secretRollMuted ? 0 : baseVolume;
  }

  /** Called once when the SFX type is first used. Override for async asset loading. */
  static init(): Promise<boolean> {
    return Promise.resolve(true);
  }

  /** Play the special effect. Must be implemented by subclasses. */
  abstract play(): Promise<void>;

  /** Compute a die-shape-adjusted effect scale based on the current dice base scale. */
  computeScale(): number {
    const runtimeBox = this.box as unknown as SFXBoxRuntime;
    const baseScale = runtimeBox.diceFactory?.baseScale ?? 75;

    let scale = baseScale / 100;
    switch (this.dicemesh.shape) {
      case 'd2':
        scale *= 1.3;
        break;
      case 'd4':
        scale *= 1.1;
        break;
      case 'd8':
        scale *= 1.1;
        break;
      case 'd12':
        scale *= 1.2;
        break;
      case 'd20':
        scale *= 1.3;
        break;
      default:
        break;
    }

    return scale;
  }

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
    sfxLine: SFXLine,
    id: string,
  ): { content: string; data: Record<string, unknown> } {
    const isGlobal = sfxLine.options?.isGlobal ?? false;
    const muteSound = sfxLine.options?.muteSound ?? false;

    const disabled = game.user.isGM ? '' : 'disabled="disabled"';
    const checkedGlobal = isGlobal ? 'checked="checked"' : '';
    const checkedMute = muteSound ? 'checked="checked"' : '';

    return {
      content: `<div class="form-group">
  <label>{{localize "DICESONICE.sfxOptionsIsGlobal"}}</label>
  <div class="form-fields">
    <input type="checkbox" name="sfxLine[${id}][options][isGlobal]" data-dtype="Boolean" ${disabled} ${checkedGlobal} />
  </div>
</div>
<div class="form-group">
  <label>{{localize "DICESONICE.sfxOptionsMuteSound"}}</label>
  <div class="form-fields">
    <input type="checkbox" name="sfxLine[${id}][options][muteSound]" data-dtype="Boolean" ${disabled} ${checkedMute} />
  </div>
</div>`,
      data: {
        id,
        isGlobal,
        muteSound,
      },
    };
  }
}
