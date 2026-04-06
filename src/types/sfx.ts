/**
 * Special effects types — triggers, definitions, and playback events.
 *
 * Derived from DiceSFX.js and DiceSFXManager.js.
 */

/** Dice event types that a DiceSystem can listen for. */
export enum DiceEventType {
  SPAWN = 0,
  CLICK = 1,
  RESULT = 2,
  COLLIDE = 3,
  DESPAWN = 4,
}

/** An SFX trigger type registered via the API (beyond built-in dice types). */
export interface SFXTriggerType {
  /** Unique trigger identifier, e.g. "fate3df". */
  id: string;
  /** Localized display name, e.g. "Fate Roll". */
  name: string;
}

/** A result option for an SFX trigger type. */
export interface SFXTriggerResult {
  id: string;
  name: string;
}

/**
 * SFX definition — a class registered with the SFX manager
 * that can be instantiated to play an effect.
 */
export interface SFXDefinition {
  /** Unique class identifier, e.g. "PlayAnimationBright". */
  id: string;
  /** Localization key for the display name. */
  specialEffectName: string;
  /** Whether this effect should only fire once per logical die (e.g. d100 = two meshes but one effect). */
  playOnlyOncePerMesh?: boolean;
}

/** Options passed to a DiceSFX instance at construction time. */
export interface SFXPlaybackOptions {
  /** Whether this is a GM-global effect applied to all players. */
  isGlobal: boolean;
  /** Whether to suppress the sound component. */
  muteSound: boolean;
  /** Effect-specific options passed through from SFX config lines. */
  [key: string]: unknown;
}

/** An SFX event emitted during the roll lifecycle. */
export interface SFXEvent {
  /** The SFX class ID to instantiate. */
  effectId: string;
  /** The die mesh this effect is attached to. */
  dieId: string;
  /** Playback options. */
  options: SFXPlaybackOptions;
}
