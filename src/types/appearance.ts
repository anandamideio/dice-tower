/**
 * Appearance types — materials, textures, colorsets, and per-user customization.
 *
 * Derived from DiceColors.js, DiceFactory.initializeMaterials(), and
 * Dice3D.DEFAULT_APPEARANCE().
 */

/** Material type identifiers matching the original 8 materials. */
export type MaterialType =
  | 'plastic'
  | 'metal'
  | 'wood'
  | 'glass'
  | 'chrome'
  | 'pristine'
  | 'iridescent'
  | 'stone';

/** Extended material selector value (includes "auto" and "custom" sentinels). */
export type MaterialSelector = MaterialType | 'auto' | 'custom';

/** Three.js material backing type. */
export type MaterialBackingType = 'standard' | 'physical' | 'phong';

/** Material definition with base and quality-scoped options. */
export interface MaterialDefinition {
  type: MaterialBackingType;
  options: Record<string, unknown>;
  scopedOptions?: {
    roughnessMap?: string;
    envMap?: boolean;
  };
}

/** Canvas composite blend mode used when applying textures. */
export type TextureComposite =
  | 'source-over'
  | 'multiply'
  | 'destination-in'
  | 'difference'
  | 'soft-light';

/** A texture entry as registered in TEXTURELIST. */
export interface TextureDefinition {
  /** Localization key for the display name. */
  name: string;
  /** Canvas composite operation for layering. */
  composite: TextureComposite;
  /** Path to a texture atlas JSON, if atlas-based. */
  atlas?: string;
  /** Source texture filename (within the atlas or standalone). */
  source: string;
  /** Bump map filename. */
  bump: string;
  /** Override material when this texture is selected. */
  material?: MaterialType;
}

/** A registered colorset (theme). */
export interface Colorset {
  /** Unique identifier and key in the COLORSETS map. */
  name: string;
  /** Localization key for human-readable description. */
  description: string;
  /** Localization key for category grouping in the UI. */
  category: string;
  /** Label/foreground color — hex string or array of hex strings for random selection. */
  foreground: string | string[];
  /** Dice body background color — hex string or array for random selection. */
  background: string | string[];
  /** Label outline color — hex string, "none", or array for random selection. */
  outline: string | string[];
  /** Edge/bevel color — hex string or array for random selection. */
  edge?: string | string[];
  /** Texture ID to apply (from TEXTURELIST). */
  texture?: string | string[];
  /** Material override. */
  material?: MaterialType;
  /** Font family name. */
  font?: string;
  /** Visibility in the picker — "visible" or "hidden". */
  visibility?: 'visible' | 'hidden';
}

/**
 * Per-scope appearance settings as stored in user flags.
 * The "global" key applies to all dice; per-die-type keys (e.g. "d20") override.
 */
export interface DiceAppearance {
  labelColor: string;
  diceColor: string;
  outlineColor: string;
  edgeColor: string;
  texture: string;
  material: MaterialSelector;
  font: string;
  colorset: string;
  system: string;
  /** Per-system custom settings. */
  systemSettings?: Record<string, unknown>;
}

/** Map of appearance scopes — "global" plus optional per-die-type overrides. */
export type AppearanceMap = {
  global: DiceAppearance;
} & {
  [dieType: string]: DiceAppearance;
};
