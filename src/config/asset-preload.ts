import { TEXTURE_LIST } from '../dice/textures.js';
import { MODULE_ID } from './constants.js';
import { getUserAppearanceFlags } from './user-flags.js';

const CORE_ATLAS_URLS = [
  'modules/dice-tower/assets/textures/standard.json',
  'modules/dice-tower/assets/textures/dot.json',
  'modules/dice-tower/assets/textures/spectrum-0.json',
  'modules/dice-tower/assets/textures/spectrum-1.json',
] as const;

const CORE_IMAGE_URLS = [
  'modules/dice-tower/assets/textures/coin/heads.webp',
  'modules/dice-tower/assets/textures/coin/heads_bump.webp',
  'modules/dice-tower/assets/textures/coin/tail.webp',
  'modules/dice-tower/assets/textures/coin/tail_bump.webp',
  'modules/dice-tower/assets/textures/roughnessMap_finger.webp',
  'modules/dice-tower/assets/textures/roughnessMap_metal.webp',
  'modules/dice-tower/assets/textures/roughnessMap_stone.webp',
  'modules/dice-tower/assets/textures/roughnessMap_wood.webp',
  'modules/dice-tower/assets/textures/cubemap/px.webp',
  'modules/dice-tower/assets/textures/cubemap/nx.webp',
  'modules/dice-tower/assets/textures/cubemap/py.webp',
  'modules/dice-tower/assets/textures/cubemap/ny.webp',
  'modules/dice-tower/assets/textures/cubemap/pz.webp',
  'modules/dice-tower/assets/textures/cubemap/nz.webp',
  'modules/dice-tower/assets/textures/equirectangular/blouberg_sunrise_2_1k.hdr',
] as const;

const CORE_AUDIO_URLS = [
  'modules/dice-tower/assets/sounds/surfaces.mp3',
  'modules/dice-tower/assets/sounds/dicehit.mp3',
  'modules/dice-tower/assets/sounds/sfx/bright.mp3',
  'modules/dice-tower/assets/sounds/sfx/darkness.mp3',
  'modules/dice-tower/assets/sounds/sfx/doublespiral.mp3',
  'modules/dice-tower/assets/sounds/sfx/vortex.mp3',
  'modules/dice-tower/assets/sounds/sfx/sparkles.mp3',
  'modules/dice-tower/assets/sounds/sfx/hit_glass.mp3',
  'modules/dice-tower/assets/sounds/sfx/thormund.mp3',
  'modules/dice-tower/assets/sounds/sfx/epic_win.mp3',
  'modules/dice-tower/assets/sounds/sfx/epic_fail.mp3',
] as const;

let warmupPromise: Promise<void> | null = null;

interface RuntimeFoundryLike {
  foundry?: {
    audio?: {
      AudioHelper?: {
        preloadSound?: (src: string) => Promise<unknown>;
      };
    };
  };
}

function unique(values: Iterable<string>): string[] {
  return [...new Set(values)];
}

function isModuleAssetPath(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('modules/');
}

function toAtlasImageUrl(atlasUrl: string): string {
  return atlasUrl.replace(/\.json$/i, '.webp');
}

function collectLikelyTextureIds(): string[] {
  try {
    const appearance = getUserAppearanceFlags() as unknown as Record<string, unknown>;
    const ids: string[] = [];

    for (const entry of Object.values(appearance)) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }

      const textureId = (entry as Record<string, unknown>).texture;
      if (typeof textureId === 'string' && textureId.length > 0) {
        ids.push(textureId);
      }
    }

    return ids.length > 0 ? ids : ['none'];
  } catch {
    return ['none'];
  }
}

function collectTextureUrlsForId(textureId: string): string[] {
  const texture = TEXTURE_LIST[textureId];
  if (!texture) {
    return [];
  }

  const urls: string[] = [];

  if (typeof texture.atlas === 'string' && texture.atlas.length > 0) {
    urls.push(texture.atlas, toAtlasImageUrl(texture.atlas));
  }

  if (isModuleAssetPath(texture.source)) {
    urls.push(texture.source);
  }

  if (isModuleAssetPath(texture.bump)) {
    urls.push(texture.bump);
  }

  return urls;
}

async function primeFetch(url: string): Promise<void> {
  try {
    await fetch(url, { cache: 'force-cache' });
  } catch {
    // Background warmup should never block module startup.
  }
}

async function primeImage(url: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve();
    image.onerror = () => resolve();
    image.src = url;
  });
}

async function preloadAudio(urls: string[]): Promise<void> {
  const runtime = globalThis as RuntimeFoundryLike;
  const helper = runtime.foundry?.audio?.AudioHelper;

  if (helper?.preloadSound) {
    await Promise.all(
      urls.map(async (url) => {
        try {
          await helper.preloadSound?.(url);
        } catch {
          // Keep warmup best-effort.
        }
      }),
    );
    return;
  }

  await Promise.all(urls.map((url) => primeFetch(url)));
}

export function warmDiceTowerAssetsOnInit(): void {
  if (warmupPromise) {
    return;
  }

  warmupPromise = (async () => {
    const prioritizedTextureUrls = unique(
      collectLikelyTextureIds().flatMap((textureId) => collectTextureUrlsForId(textureId)),
    );

    const atlasUrls = unique([
      ...CORE_ATLAS_URLS,
      ...prioritizedTextureUrls.filter((url) => url.endsWith('.json')),
    ]);

    const imageUrls = unique([
      ...CORE_IMAGE_URLS,
      ...prioritizedTextureUrls.filter((url) => !url.endsWith('.json')),
      ...atlasUrls.map((atlasUrl) => toAtlasImageUrl(atlasUrl)),
    ]);

    await Promise.all(atlasUrls.map((atlasUrl) => primeFetch(atlasUrl)));
    await Promise.all(imageUrls.map((imageUrl) => primeImage(imageUrl)));
    await preloadAudio(unique(CORE_AUDIO_URLS));
  })().catch((error) => {
    console.warn(`${MODULE_ID} | Asset warmup failed.`, error);
  });
}

export function getDiceTowerAssetWarmupPromise(): Promise<void> | null {
  return warmupPromise;
}
