/**
 * Settings types — world-level and client-level configuration.
 *
 * Derived from Dice so Nice's main.js settings registration and
 * Dice3D.DEFAULT_OPTIONS / DEFAULT_APPEARANCE / SFX.
 */

import type { AppearanceMap } from './appearance.js';
import type { SFXLine } from './dice.js';
import type {
  AntialiasingMode,
  CanvasZIndex,
  HideFX,
  ImageQuality,
  RollableArea,
  ShadowQuality,
  ThrowingForce,
} from './rendering.js';

/** Secret-roll ghost display modes matching DSN 4.2. */
export type GhostDiceMode = '0' | '1' | '2';

/** World-scoped settings (GM-only). */
export interface WorldSettings {
  /** Maximum number of dice rendered simultaneously. */
  maxDiceNumber: number;
  /**
   * Global animation speed override.
   * "0" = player's own speed, "1" = 1x, "2" = 2x, "3" = 3x.
   */
  globalAnimationSpeed: string;
  /** Disable 3D dice during combat encounters. */
  disabledDuringCombat: boolean;
  /** Disable 3D dice for initiative rolls. */
  disabledForInitiative: boolean;
  /** Hide 3D dice for secret/blind rolls. */
  hide3dDiceOnSecretRolls: boolean;
  /** Show "ghost" dice for hidden rolls (0=off, 1=all, 2=owner only). */
  showGhostDice: GhostDiceMode;
  /** Hide NPC roll animations. */
  hideNpcRolls: boolean;
  /** Animate rolls triggered by roll tables. */
  animateRollTable: boolean;
  /** Animate inline roll formulas in chat. */
  animateInlineRoll: boolean;
  /** Allow simultaneous roll animations from multiple users. */
  enabledSimultaneousRolls: boolean;
  /** Merge simultaneous rolls within the same chat message. */
  enabledSimultaneousRollForMessage: boolean;
  /** Use socket-transmitted throw parameters for deterministic multiplayer replay. */
  enableDeterministicSync: boolean;
  /** Allow dice to be flipped after settling. */
  diceCanBeFlipped: boolean;
  /** GM toggle for mouse interaction with dice. */
  allowInteractivity: boolean;
  /** Display chat messages immediately without waiting for animation to finish. */
  immediatelyDisplayChatMessages: boolean;
  /** Use the character owner's dice appearance for initiative rolls. */
  forceCharacterOwnerAppearanceForInitiative: boolean;
}

/** Client-scoped settings (per-user). */
export interface ClientSettings {
  /** Master enable/disable. */
  enabled: boolean;
  /** Show extra dice (e.g. modifier dice). */
  showExtraDice: boolean;
  /** Only show the local user's own dice. */
  onlyShowOwnDice: boolean;
  /** Auto-hide dice after settling. */
  hideAfterRoll: boolean;
  /** Milliseconds before auto-hide. */
  timeBeforeHide: number;
  /** Hide animation style. */
  hideFX: HideFX;
  /** Autoscale dice to viewport. */
  autoscale: boolean;
  /** Manual scale percentage. */
  scale: number;
  /** Animation speed multiplier (0.5–3). */
  speed: number;
  /** Texture/rendering quality. */
  imageQuality: ImageQuality;
  /** Shadow map quality. */
  shadowQuality: ShadowQuality;
  /** Enable bump/normal mapping on dice. */
  bumpMapping: boolean;
  /** Enable collision sounds. */
  sounds: boolean;
  /** Surface type for collision sounds. */
  soundsSurface: SoundsSurface;
  /** Sound effects volume (0–1). */
  soundsVolume: number;
  /** Canvas z-index mode. */
  canvasZIndex: CanvasZIndex;
  /** Throwing force preset. */
  throwingForce: ThrowingForce;
  /** Use the device's native high-DPI resolution. */
  useHighDPI: boolean;
  /** Antialiasing mode. */
  antialiasing: AntialiasingMode;
  /** Enable glow/bloom post-processing. */
  glow: boolean;
  /** Show other players' special effects. */
  showOthersSFX: boolean;
  /** Dim the scene during dice rolls. */
  immersiveDarkness: boolean;
  /** Mute sound on secret/blind rolls. */
  muteSoundSecretRolls: boolean;
  /** Enable flavor-text-based colorset selection. */
  enableFlavorColorset: boolean;
  /** Custom rollable area, or false for full viewport. */
  rollingArea: RollableArea | false;
}

/** Sound surface types for collision audio. */
export type SoundsSurface = 'felt' | 'metal' | 'wood_table' | 'wood_tray';

/**
 * Complete user configuration — the union of client settings,
 * appearance, and SFX stored in Foundry user flags.
 */
export interface UserConfig extends ClientSettings {
  appearance: AppearanceMap;
  specialEffects: SFXLine[];
}

/** SFX configuration list as stored in user flags under "sfxList". */
export type SFXConfig = SFXLine[];
