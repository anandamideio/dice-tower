/**
 * Rendering types — quality settings, scene configuration, and camera parameters.
 *
 * Derived from DiceBox.js and Dice3D.DEFAULT_OPTIONS.
 */

/** Image quality presets. */
export type ImageQuality = 'low' | 'medium' | 'high';

/** Shadow quality presets. */
export type ShadowQuality = 'low' | 'high';

/** Antialiasing modes. */
export type AntialiasingMode = 'none' | 'smaa' | 'msaa';

/** Canvas z-index positioning relative to the Foundry board. */
export type CanvasZIndex = 'over' | 'under';

/** Hide animation after roll completes. */
export type HideFX = 'fadeOut' | 'none';

/** Throwing force presets. */
export type ThrowingForce = 'weak' | 'medium' | 'strong';

/** Detected renderer backend. */
export type RendererBackend = 'webgpu' | 'webgl2';

/** Quality-related render settings (derived from Foundry's performance mode). */
export interface QualitySettings {
  imageQuality: ImageQuality;
  shadowQuality: ShadowQuality;
  bumpMapping: boolean;
  glow: boolean;
  antialiasing: AntialiasingMode;
  useHighDPI: boolean;
}

/** Full render configuration for the DiceBox. */
export interface RenderConfig extends QualitySettings {
  /** Automatically scale dice to viewport. */
  autoscale: boolean;
  /** Manual scale percentage (when autoscale is off). */
  scale: number;
  /** Canvas z-index positioning. */
  canvasZIndex: CanvasZIndex;
  /** Whether immersive darkness is enabled. */
  immersiveDarkness: boolean;
}

/** Camera configuration. */
export interface CameraConfig {
  /** Field of view in degrees. */
  fov: number;
  /** Camera distance from the desk surface. */
  distance: number;
  /** Near clipping plane. */
  near: number;
  /** Far clipping plane. */
  far: number;
}

/** Scene lighting configuration. */
export interface LightingConfig {
  /** Directional light intensity. */
  directionalIntensity: number;
  /** Hemisphere light intensity. */
  hemisphereIntensity: number;
  /** Whether shadows are enabled. */
  shadows: boolean;
  /** Shadow map type. */
  shadowQuality: ShadowQuality;
}

/** Display dimensions computed at runtime. */
export interface DisplayMetrics {
  currentWidth: number | null;
  currentHeight: number | null;
  containerWidth: number | null;
  containerHeight: number | null;
  innerWidth: number | null;
  innerHeight: number | null;
  aspect: number | null;
  scale: number | null;
}

/** Rollable area boundaries (user-configurable sub-region of the viewport). */
export interface RollableArea {
  left: number;
  top: number;
  width: number;
  height: number;
}
