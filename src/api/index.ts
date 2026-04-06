/**
 * Public API barrel exports.
 */

export { DiceSystem } from './dice-system.js';
export { DiceSFX } from './dice-sfx.js';
export { Dice3DRuntime } from './dice3d-runtime.js';
export type { IDice3D, IDiceFactory, IDiceBox, IDiceSystem, IDiceSFXClass } from './dice3d.js';
export { DiceFactory, CORE_COLORSETS, TEXTURE_LIST } from '../dice/index.js';
export {
	DiceSFXManager,
	BUILTIN_SFX_MODE_CLASSES,
	PlayAnimationBright,
	PlayAnimationDark,
	PlayAnimationOutline,
	PlayAnimationImpact,
	PlayAnimationThrow,
	PlayAnimationThormund,
	PlayAnimationParticleSparkles,
	PlayAnimationParticleSpiral,
	PlayAnimationParticleVortex,
	PlayConfettiStrength1,
	PlayConfettiStrength2,
	PlayConfettiStrength3,
	PlaySoundEpicWin,
	PlaySoundEpicFail,
	PlayMacro,
} from '../sfx/index.js';
