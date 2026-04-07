import { describe, expect, it } from 'vitest';
import {
  MeshPhongMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
} from 'three/webgpu';

import { createDiceMaterial, resolveMaterialType } from '../../src/dice/materials.js';
import type { MaterialType } from '../../src/types/appearance.js';

const BASE_OPTIONS = {
  quality: 'high' as const,
  color: '#ff00ff',
  map: null,
  bumpMap: null,
  roughnessMap: null,
  envMap: null,
  emissive: 0,
  emissiveIntensity: 1,
};

describe('createDiceMaterial', () => {
  it('builds expected high-quality material classes per profile', () => {
    const cases: Array<[MaterialType, 'standard' | 'physical']> = [
      ['plastic', 'standard'],
      ['metal', 'standard'],
      ['wood', 'standard'],
      ['glass', 'standard'],
      ['chrome', 'standard'],
      ['stone', 'standard'],
      ['pristine', 'physical'],
      ['iridescent', 'physical'],
    ];

    for (const [materialType, kind] of cases) {
      const material = createDiceMaterial({
        ...BASE_OPTIONS,
        materialType,
      });

      if (kind === 'standard') {
        expect(material).toBeInstanceOf(MeshStandardMaterial);
      } else {
        expect(material).toBeInstanceOf(MeshPhysicalMaterial);
      }
    }
  });

  it('applies transparency defaults for glass profile', () => {
    const material = createDiceMaterial({
      ...BASE_OPTIONS,
      materialType: 'glass',
    }) as MeshStandardMaterial;

    expect(material.transparent).toBe(true);
    expect(material.opacity).toBeCloseTo(0.72, 6);
  });

  it('uses phong fallback when quality is low', () => {
    const metal = createDiceMaterial({
      ...BASE_OPTIONS,
      quality: 'low',
      materialType: 'metal',
    }) as MeshPhongMaterial;

    const glass = createDiceMaterial({
      ...BASE_OPTIONS,
      quality: 'low',
      materialType: 'glass',
    }) as MeshPhongMaterial;

    expect(metal).toBeInstanceOf(MeshPhongMaterial);
    expect(metal.specular.getHex()).toBe(0xffffff);

    expect(glass).toBeInstanceOf(MeshPhongMaterial);
    expect(glass.transparent).toBe(true);
    expect(glass.opacity).toBeCloseTo(0.72, 6);
  });
});

describe('resolveMaterialType', () => {
  it('resolves auto/custom from texture material fallback', () => {
    expect(resolveMaterialType('auto', 'metal')).toBe('metal');
    expect(resolveMaterialType('auto')).toBe('plastic');

    expect(resolveMaterialType('custom', 'wood')).toBe('wood');
    expect(resolveMaterialType('custom')).toBe('plastic');

    expect(resolveMaterialType('stone', 'metal')).toBe('stone');
  });
});
