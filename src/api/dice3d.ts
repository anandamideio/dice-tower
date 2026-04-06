/**
 * IDice3D — the public API interface for the Dice Tower module.
 *
 * This contract matches Dice so Nice's external surface so that existing
 * extensions can work without modification.
 */

import type { Colorset, DiceAppearance, TextureDefinition } from '../types/appearance.js';
import type { DicePresetData, SFXLine } from '../types/dice.js';
import type { Mesh } from 'three/webgpu';

/** The DiceFactory manages geometry, materials, presets, and systems. */
export interface IDiceFactory {
  /** The currently preferred system ID. */
  preferredSystem: string;
  /** The currently preferred colorset name. */
  preferredColorset: string;
  /** Base scale for dice meshes. */
  baseScale: number;
  /** All registered systems. */
  systems: Map<string, IDiceSystem>;
  /** Add a dice system. */
  addSystem(system: IDiceSystem | { id: string; name: string; group?: string }, mode?: string): void;
  /** Register a dice preset. */
  addDicePreset(dice: DicePresetData, shape?: string | null): void;
  /** Register a colorset (theme). */
  addColorset(colorset: Partial<Colorset> & { name: string }, mode?: string): void;
  /** Register a texture definition. */
  addTexture(textureID: string, textureData: TextureDefinition): void;
  /** Resolve appearance for a specific die type. */
  resolveAppearance(dieType: string, overrides?: Partial<DiceAppearance>): DiceAppearance;
  /** Build a mesh for a die with fully resolved geometry, labels, and material. */
  getMesh(dieType: string, overrides?: Partial<DiceAppearance>): Promise<Mesh>;
}

/** The DiceBox manages the Three.js scene and animation loop. */
export interface IDiceBox {
  /** Whether a roll animation is currently playing. */
  running: boolean;
}

/** A dice system registered via the API. */
export interface IDiceSystem {
  readonly id: string;
  readonly name: string;
  readonly mode: string;
  readonly group: string | null;
}

/** DiceSFX class constructor shape expected by addSFXMode. */
export interface IDiceSFXClass {
  /** Unique identifier for this SFX type. */
  id: string;
  /** Localization key for the display name. */
  specialEffectName: string;
  /** Whether to only play once per logical die. */
  PLAY_ONLY_ONCE_PER_MESH?: boolean;
  /** Async initialization hook. */
  init?(): Promise<boolean>;
  /** Return dialog content for the SFX config UI. */
  getDialogContent?(sfxLine: SFXLine, id: string): { content: string; data: Record<string, unknown> };
  /** Constructor. */
  new (box: IDiceBox, dicemesh: unknown, options?: Record<string, unknown>): {
    play(): Promise<void>;
  };
}

/**
 * The main public API — exposed as `game.dice3d`.
 *
 * Method signatures intentionally match Dice so Nice for backward compatibility.
 */
export interface IDice3D {
  // ── Roll display ──

  /**
   * Show the 3D dice animation for a Roll.
   *
   * @param roll         - Foundry Roll object
   * @param user         - The user who made the roll
   * @param synchronize  - Whether to broadcast to other clients
   * @param users        - Whisper target user IDs (null = public)
   * @param blind        - Whether this is a blind/GM-only roll
   * @param messageID    - Associated ChatMessage ID
   * @param speaker      - ChatMessage speaker data
   * @param options      - Additional options (ghost, secret)
   * @returns Resolves true when the animation completes
   */
  showForRoll(
    roll: Roll,
    user?: User,
    synchronize?: boolean,
    users?: string[] | null,
    blind?: boolean,
    messageID?: string | null,
    speaker?: Record<string, unknown> | null,
    options?: { ghost?: boolean; secret?: boolean },
  ): Promise<boolean>;

  /**
   * Render rolls for a chat message (called from the createChatMessage hook).
   */
  renderRolls(chatMessage: ChatMessage, rolls: Roll[]): void;

  // ── Extension registration ──

  /**
   * Register a new dice system.
   * @param system - DiceSystem instance or plain object with {id, name, group?}
   * @param mode   - "default" or "preferred"
   */
  addSystem(system: IDiceSystem | { id: string; name: string; group?: string }, mode?: string): void;

  /**
   * Register a new dice preset.
   * @param dice  - Preset definition
   * @param shape - Override shape (if different from dice.type)
   */
  addDicePreset(dice: DicePresetData, shape?: string | null): void;

  /**
   * Register a colorset (theme).
   * @param colorset - Colorset definition
   * @param mode     - "default" or "preferred"
   */
  addColorset(colorset: Partial<Colorset> & { name: string }, mode?: string): Promise<void>;

  /**
   * Register a texture.
   * @param textureID   - Unique texture key
   * @param textureData - Texture definition
   */
  addTexture(textureID: string, textureData: TextureDefinition): Promise<void>;

  /**
   * Register a custom SFX trigger type.
   * @param id      - Trigger identifier
   * @param name    - Localized name
   * @param results - Array of possible result values
   */
  addSFXTrigger(id: string, name: string, results: string[]): void;

  /**
   * Register a custom SFX mode class.
   * @param sfxClass - The SFX class to register
   */
  addSFXMode(sfxClass: IDiceSFXClass): void;

  /**
   * Get available SFX modes by id -> localized name.
   */
  getSFXModes(): Record<string, string>;

  /**
   * Load a user's saved appearance profile by name.
   */
  loadSaveFile(name: string): Promise<void>;

  /**
   * Get all loaded dice systems.
   */
  getLoadedDiceSystems(): Map<string, IDiceSystem>;

  // ── Accessors ──

  /** The DiceFactory instance. */
  DiceFactory: IDiceFactory;
  /** The active DiceBox instance. */
  box: IDiceBox;
  /** Whether dice3d is enabled for the current user. */
  isEnabled(): boolean;
  /** Whether the user can interact (no animation running). */
  canInteract: boolean;
  /** Exported utilities for extensions. */
  exports: Record<string, unknown>;
}
