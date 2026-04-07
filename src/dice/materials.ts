import {
  Color,
  MeshPhysicalMaterial,
  MeshPhongMaterial,
  MeshStandardMaterial,
  type Material,
  type Texture,
} from 'three/webgpu';

import type { MaterialType } from '../types/appearance.js';

export type DiceMaterialQuality = 'low' | 'medium' | 'high';

type MaterialKind = 'standard' | 'physical';

interface MaterialProfile {
  kind: MaterialKind;
  base: Record<string, number | boolean>;
}

export interface DiceMaterialCreateOptions {
  materialType: MaterialType;
  quality: DiceMaterialQuality;
  color: string;
  map: Texture | null;
  bumpMap: Texture | null;
  roughnessMap: Texture | null;
  envMap: Texture | null;
  emissive?: number;
  emissiveIntensity?: number;
}

const MATERIAL_PROFILES: Record<MaterialType, MaterialProfile> = {
  plastic: {
    kind: 'standard',
    base: {
      metalness: 0,
      roughness: 0.6,
    },
  },
  metal: {
    kind: 'standard',
    base: {
      metalness: 1,
      roughness: 0.6,
    },
  },
  wood: {
    kind: 'standard',
    base: {
      metalness: 0,
      roughness: 1,
    },
  },
  glass: {
    kind: 'standard',
    base: {
      metalness: 0,
      roughness: 0.3,
      transparent: true,
      opacity: 0.72,
    },
  },
  chrome: {
    kind: 'standard',
    base: {
      metalness: 1,
      roughness: 0.1,
    },
  },
  pristine: {
    kind: 'physical',
    base: {
      metalness: 0.05,
      roughness: 0.25,
      clearcoat: 1,
      clearcoatRoughness: 0.1,
    },
  },
  iridescent: {
    kind: 'physical',
    base: {
      metalness: 0.1,
      roughness: 0.35,
      iridescence: 1,
      iridescenceIOR: 1.8,
      clearcoat: 1,
    },
  },
  stone: {
    kind: 'standard',
    base: {
      metalness: 0,
      roughness: 1,
    },
  },
};

function createLowQualityMaterial(options: DiceMaterialCreateOptions): MeshPhongMaterial {
  // The albedo map is already fully composited (base color + texture + labels),
  // so keep material tint neutral to avoid multiplying labels into black.
  const color = new Color('#ffffff');
  const material = new MeshPhongMaterial({
    color,
    map: options.map,
    bumpMap: options.bumpMap,
    emissive: new Color(options.emissive ?? 0x000000),
    emissiveIntensity: options.emissiveIntensity ?? 1,
  });

  material.specular.setHex(options.materialType === 'metal' ? 0xffffff : 0x444444);
  material.shininess = options.materialType === 'glass' ? 95 : 40;

  if (options.materialType === 'glass') {
    material.transparent = true;
    material.opacity = 0.72;
  }

  return material;
}

export function createDiceMaterial(options: DiceMaterialCreateOptions): Material {
  if (options.quality === 'low') {
    return createLowQualityMaterial(options);
  }

  const profile = MATERIAL_PROFILES[options.materialType];
  const common = {
    // Keep base tint neutral because color is baked into the composed map.
    color: new Color('#ffffff'),
    map: options.map,
    bumpMap: options.bumpMap,
    roughnessMap: options.roughnessMap,
    envMap: options.envMap,
    emissive: new Color(options.emissive ?? 0x000000),
    emissiveIntensity: options.emissiveIntensity ?? 1,
    ...profile.base,
  };

  if (profile.kind === 'physical') {
    return new MeshPhysicalMaterial(common);
  }

  return new MeshStandardMaterial(common);
}

export function resolveMaterialType(
  selected: MaterialType | 'auto' | 'custom',
  textureMaterial?: MaterialType,
): MaterialType {
  if (selected === 'auto') {
    return textureMaterial ?? 'plastic';
  }
  if (selected === 'custom') {
    return textureMaterial ?? 'plastic';
  }
  return selected;
}
