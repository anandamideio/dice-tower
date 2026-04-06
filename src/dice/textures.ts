import type {
  MaterialType,
  TextureComposite,
  TextureDefinition,
} from '../types/appearance.js';

const MODULE_TEXTURE_ROOT = 'modules/dice-tower/assets/textures';
const STANDARD_ATLAS = `${MODULE_TEXTURE_ROOT}/standard.json`;

function inferMaterialFromFrame(frame: string): MaterialType | undefined {
  if (frame.includes('metal') || frame.includes('bronze')) return 'metal';
  if (frame.includes('wood') || frame.includes('paper') || frame.includes('leopard') || frame.includes('tiger') || frame.includes('cheetah')) {
    return 'wood';
  }
  if (frame.includes('stone')) return 'stone';
  if (frame.includes('stainedglass')) return 'iridescent';
  return undefined;
}

function frameNameToTextureId(frame: string): string {
  return `atlas_standard_${frame.replace(/\.webp$/i, '')}`;
}

function frameNameToLocalizationKey(frame: string): string {
  return `DICETOWER.TextureAtlas.${frame.replace(/\.webp$/i, '')}`;
}

function buildStandardAtlasTextureDefinitions(): Record<string, TextureDefinition> {
  const out: Record<string, TextureDefinition> = {};
  for (const frame of STANDARD_ATLAS_FRAMES) {
    const id = frameNameToTextureId(frame);
    const material = inferMaterialFromFrame(frame);
    out[id] = {
      name: frameNameToLocalizationKey(frame),
      composite: 'source-over',
      atlas: STANDARD_ATLAS,
      source: frame,
      bump: frame.endsWith('_bump.webp') ? frame : '',
      ...(material ? { material } : {}),
    };
  }
  return out;
}

export const BASE_TEXTURE_LIST: Record<string, TextureDefinition> = {
  none: {
    name: 'DICESONICE.TextureNone',
    composite: 'source-over',
    source: '',
    bump: '',
  },
  cloudy: {
    name: 'DICESONICE.TextureCloudsTransparent',
    composite: 'destination-in',
    atlas: STANDARD_ATLAS,
    source: 'cloudy.webp',
    bump: 'cloudy.alt.webp',
  },
  cloudy_2: {
    name: 'DICESONICE.TextureClouds',
    composite: 'multiply',
    atlas: STANDARD_ATLAS,
    source: 'cloudy.alt.webp',
    bump: 'cloudy.alt.webp',
  },
  fire: {
    name: 'DICESONICE.TextureFire',
    composite: 'multiply',
    atlas: STANDARD_ATLAS,
    source: 'fire.webp',
    bump: 'fire.webp',
  },
  marble: {
    name: 'DICESONICE.TextureMarble',
    composite: 'multiply',
    atlas: STANDARD_ATLAS,
    source: 'marble.webp',
    bump: '',
    material: 'glass',
  },
  water: {
    name: 'DICESONICE.TextureWaterTransparent',
    composite: 'destination-in',
    atlas: STANDARD_ATLAS,
    source: 'water.webp',
    bump: 'water.webp',
    material: 'glass',
  },
  water_2: {
    name: 'DICESONICE.TextureWater',
    composite: 'multiply',
    atlas: STANDARD_ATLAS,
    source: 'water.webp',
    bump: 'water.webp',
    material: 'glass',
  },
  ice: {
    name: 'DICESONICE.TextureIceTransparent',
    composite: 'destination-in',
    atlas: STANDARD_ATLAS,
    source: 'ice.webp',
    bump: 'ice.webp',
    material: 'glass',
  },
  ice_2: {
    name: 'DICESONICE.TextureIce',
    composite: 'multiply',
    atlas: STANDARD_ATLAS,
    source: 'ice.webp',
    bump: 'ice.webp',
    material: 'glass',
  },
  paper: {
    name: 'DICESONICE.TexturePaper',
    composite: 'multiply',
    atlas: STANDARD_ATLAS,
    source: 'paper.webp',
    bump: 'paper_bump.webp',
    material: 'wood',
  },
  speckles: {
    name: 'DICESONICE.TextureSpeckles',
    composite: 'multiply',
    atlas: STANDARD_ATLAS,
    source: 'speckles.webp',
    bump: 'speckles.webp',
  },
  glitter: {
    name: 'DICESONICE.TextureGlitter',
    composite: 'multiply',
    atlas: STANDARD_ATLAS,
    source: 'glitter.webp',
    bump: 'glitter_bump.webp',
  },
  glitter_2: {
    name: 'DICESONICE.TextureGlitterTransparent',
    composite: 'destination-in',
    atlas: STANDARD_ATLAS,
    source: 'glitter-alpha.webp',
    bump: '',
  },
  stars: {
    name: 'DICESONICE.TextureStars',
    composite: 'multiply',
    atlas: STANDARD_ATLAS,
    source: 'stars.webp',
    bump: 'stars.webp',
  },
  stainedglass: {
    name: 'DICESONICE.TextureStainedGlass',
    composite: 'multiply',
    atlas: STANDARD_ATLAS,
    source: 'stainedglass.webp',
    bump: 'stainedglass_bump.webp',
    material: 'iridescent',
  },
  skulls: {
    name: 'DICESONICE.TextureSkulls',
    composite: 'multiply',
    atlas: STANDARD_ATLAS,
    source: 'skulls.webp',
    bump: 'skulls.webp',
  },
  leopard: {
    name: 'DICESONICE.TextureLeopard',
    composite: 'multiply',
    atlas: STANDARD_ATLAS,
    source: 'leopard.webp',
    bump: 'leopard.webp',
    material: 'wood',
  },
  tiger: {
    name: 'DICESONICE.TextureTiger',
    composite: 'multiply',
    atlas: STANDARD_ATLAS,
    source: 'tiger.webp',
    bump: 'tiger.webp',
    material: 'wood',
  },
  cheetah: {
    name: 'DICESONICE.TextureCheetah',
    composite: 'multiply',
    atlas: STANDARD_ATLAS,
    source: 'cheetah.webp',
    bump: 'cheetah.webp',
    material: 'wood',
  },
  dragon: {
    name: 'DICESONICE.TextureDragon',
    composite: 'multiply',
    atlas: STANDARD_ATLAS,
    source: 'dragon.webp',
    bump: 'dragon_bump.webp',
  },
  lizard: {
    name: 'DICESONICE.TextureLizard',
    composite: 'multiply',
    atlas: STANDARD_ATLAS,
    source: 'lizard.webp',
    bump: 'lizard_bump.webp',
  },
  bird: {
    name: 'DICESONICE.TextureBird',
    composite: 'multiply',
    atlas: STANDARD_ATLAS,
    source: 'feather.webp',
    bump: 'feather_bump.webp',
  },
  astral: {
    name: 'DICESONICE.TextureAstralSea',
    composite: 'multiply',
    atlas: STANDARD_ATLAS,
    source: 'astral.webp',
    bump: 'stars.webp',
  },
  wood: {
    name: 'DICESONICE.TextureWood',
    composite: 'multiply',
    atlas: STANDARD_ATLAS,
    source: 'wood.webp',
    bump: 'wood.webp',
    material: 'wood',
  },
  metal: {
    name: 'DICESONICE.TextureMetal',
    composite: 'multiply',
    atlas: STANDARD_ATLAS,
    source: 'metal.webp',
    bump: '',
    material: 'metal',
  },
  stone: {
    name: 'DICESONICE.TextureStone',
    composite: 'soft-light',
    atlas: STANDARD_ATLAS,
    source: 'stone.webp',
    bump: 'stone.webp',
    material: 'stone',
  },
  radial: {
    name: 'DICESONICE.TextureRadial',
    composite: 'source-over',
    atlas: STANDARD_ATLAS,
    source: 'radial.webp',
    bump: '',
  },
  bronze01: {
    name: 'DICESONICE.TextureBronze1',
    composite: 'difference',
    atlas: STANDARD_ATLAS,
    source: 'bronze01.webp',
    bump: '',
    material: 'metal',
  },
  bronze02: {
    name: 'DICESONICE.TextureBronze2',
    composite: 'difference',
    atlas: STANDARD_ATLAS,
    source: 'bronze02.webp',
    bump: '',
    material: 'metal',
  },
  bronze03: {
    name: 'DICESONICE.TextureBronze3',
    composite: 'difference',
    atlas: STANDARD_ATLAS,
    source: 'bronze03.webp',
    bump: '',
    material: 'metal',
  },
  bronze03a: {
    name: 'DICESONICE.TextureBronze3a',
    composite: 'difference',
    atlas: STANDARD_ATLAS,
    source: 'bronze03a.webp',
    bump: '',
    material: 'metal',
  },
  bronze03b: {
    name: 'DICESONICE.TextureBronze3b',
    composite: 'difference',
    atlas: STANDARD_ATLAS,
    source: 'bronze03b.webp',
    bump: '',
    material: 'metal',
  },
  bronze04: {
    name: 'DICESONICE.TextureBronze4',
    composite: 'difference',
    atlas: STANDARD_ATLAS,
    source: 'bronze04.webp',
    bump: '',
    material: 'metal',
  },
  dot: {
    name: 'DICETOWER.TextureDot',
    composite: 'source-over',
    atlas: `${MODULE_TEXTURE_ROOT}/dot.json`,
    source: 'dot.webp',
    bump: 'dot.webp',
  },
  spectrum_0: {
    name: 'DICETOWER.TextureSpectrum0',
    composite: 'source-over',
    atlas: `${MODULE_TEXTURE_ROOT}/spectrum-0.json`,
    source: 'spectrum-0.webp',
    bump: '',
  },
  spectrum_1: {
    name: 'DICETOWER.TextureSpectrum1',
    composite: 'source-over',
    atlas: `${MODULE_TEXTURE_ROOT}/spectrum-1.json`,
    source: 'spectrum-1.webp',
    bump: '',
  },
  coin_heads: {
    name: 'DICETOWER.TextureCoinHeads',
    composite: 'source-over',
    source: `${MODULE_TEXTURE_ROOT}/coin/heads.webp`,
    bump: `${MODULE_TEXTURE_ROOT}/coin/heads_bump.webp`,
    material: 'metal',
  },
  coin_tails: {
    name: 'DICETOWER.TextureCoinTails',
    composite: 'source-over',
    source: `${MODULE_TEXTURE_ROOT}/coin/tail.webp`,
    bump: `${MODULE_TEXTURE_ROOT}/coin/tail_bump.webp`,
    material: 'metal',
  },
};

const STANDARD_ATLAS_FRAMES = [
  'astral.webp',
  'bronze01.webp',
  'bronze02.webp',
  'bronze03.webp',
  'bronze03a.webp',
  'bronze03b.webp',
  'bronze04.webp',
  'cheetah.webp',
  'cloudy.alt.webp',
  'cloudy.webp',
  'dragon.webp',
  'dragon_bump.webp',
  'feather.webp',
  'feather_bump.webp',
  'fire.webp',
  'glitter-alpha.webp',
  'glitter.webp',
  'glitter_bump.webp',
  'heads.webp',
  'heads_bump.webp',
  'ice.webp',
  'leopard.webp',
  'lizard.webp',
  'lizard_bump.webp',
  'marble.webp',
  'metal.webp',
  'metal_bump.webp',
  'noise.webp',
  'paper.webp',
  'paper_bump.webp',
  'radial.webp',
  'skulls.webp',
  'speckles.webp',
  'stainedglass.webp',
  'stainedglass_bump.webp',
  'stars.webp',
  'stone.webp',
  'tail.webp',
  'tail_bump.webp',
  'tiger.webp',
  'water.webp',
  'wood.webp',
] as const;

export const TEXTURE_LIST: Record<string, TextureDefinition> = {
  ...BASE_TEXTURE_LIST,
  ...buildStandardAtlasTextureDefinitions(),
};

export const TEXTURE_IDS = Object.freeze(Object.keys(TEXTURE_LIST));

export function getTextureDefinition(textureId: string): TextureDefinition | undefined {
  return TEXTURE_LIST[textureId];
}

export function normalizeCompositeOperation(composite: TextureComposite | undefined): TextureComposite {
  return composite ?? 'source-over';
}
