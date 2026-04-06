/**
 * Core dice types and data structures.
 *
 * These mirror the shapes and values used by Dice so Nice's DiceNotation,
 * DicePreset, and DiceFactory.
 */

/** All physical die shapes the engine can render. */
export type DieShape =
  | 'd2'
  | 'd4'
  | 'd6'
  | 'd8'
  | 'd10'
  | 'd12'
  | 'd14'
  | 'd16'
  | 'd20'
  | 'd24'
  | 'd30';

/**
 * Die type string as used in notation — includes the face-count variants
 * (e.g. "d20") plus special forms like "d100", "dc" (coin), "df" (fate).
 */
export type DieType = `d${number}` | 'dc' | 'df';

/** The supported number of faces for 3D rendering. */
export const SUPPORTED_FACES = [2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 20, 24, 30, 100] as const;
export type SupportedFaceCount = (typeof SUPPORTED_FACES)[number];

/** A single die result coming out of the physics simulation / notation parser. */
export interface DieResult {
  /** The die type string, e.g. "d20", "d10". */
  type: DieType;
  /** The numeric result value (after any d100 decomposition). */
  result: number;
  /** Human-readable label for the result (may differ from numeric value for custom dice). */
  resultLabel: string;
  /** For d100 dice: the full 1-100 value before tens/ones decomposition. */
  d100Result?: number;
  /** Whether this die was discarded by keep/drop modifiers. */
  discarded?: boolean;
  /** Initial throw vectors for physics replay. */
  vectors: number[];
  /** Roll options passed through from Foundry (owner, ghost, secret, modifiers, flavor, sfx, etc.). */
  options: DieOptions;
  /** Special effects that should trigger for this die (populated during merge). */
  specialEffects?: SFXLineResolved[];
}

/** Options attached to an individual die during notation parsing. */
export interface DieOptions {
  owner?: string;
  ghost?: boolean;
  secret?: boolean;
  modifiers?: string[];
  flavor?: string;
  colorset?: string;
  sfx?: {
    id: string;
    result: string;
    specialEffect?: string;
    options?: Record<string, unknown>;
  };
  [key: string]: unknown;
}

/** A resolved SFX line after filtering — ready for playback. */
export interface SFXLineResolved {
  specialEffect: string;
  options?: Record<string, unknown>;
}

/** A single throw group — one "wave" of dice that land together. */
export interface DiceThrow {
  dice: DieResult[];
  /** Customization config snapshot attached during queue merging. */
  dsnConfig?: {
    specialEffects: SFXLine[];
    [key: string]: unknown;
  };
}

/** An SFX trigger line as stored in user flags. */
export interface SFXLine {
  diceType: string;
  onResult: string[];
  specialEffect: string;
  options?: {
    isGlobal?: boolean;
    muteSound?: boolean;
    [key: string]: unknown;
  };
}

/** Full parsed notation — an ordered list of throw groups. */
export interface DiceNotationData {
  throws: DiceThrow[];
}

/**
 * A dice preset definition — describes geometry, labels, values, and
 * system association for a single die type.
 */
export interface DicePresetData {
  /** Die type identifier, e.g. "d20". */
  type: DieType;
  /** The FoundryVTT DiceTerm name, e.g. "Die". */
  term?: string;
  /** Physical shape to use (may differ from type for custom dice). */
  shape?: DieShape;
  /** Scale multiplier relative to base size. */
  scale?: number;
  /** Face labels — strings (unicode) or texture paths. */
  labels: (string | string[])[];
  /** Optional value-to-face mapping override. */
  valueMap?: Record<number, number> | null;
  /** Ordered list of possible result values. */
  values: number[];
  /** Per-face bump map paths. */
  bumps?: (string | string[])[];
  /** Per-face emissive map paths. */
  emissiveMaps?: (string | string[])[];
  /** Emissive color (hex). */
  emissive?: number;
  /** Emissive intensity. */
  emissiveIntensity?: number;
  /** Physics mass. */
  mass?: number;
  /** Physics inertia. */
  inertia?: number;
  /** System this preset belongs to. */
  system: string;
  /** Path to a GLTF/GLB model file (for fully custom geometry). */
  modelFile?: string | null;
  /** Texture atlas JSON path. */
  atlas?: string | null;
}
