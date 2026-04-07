import {
  Mesh,
  type Material,
  type Texture,
} from 'three/webgpu';

import type { IDiceFactory, IDiceSystem } from '../api/dice3d.js';
import { DiceSystem, type DiceMapEntry } from '../api/dice-system.js';
import { DICE_SHAPE_DEFINITIONS } from '../physics/dice-shape-definitions.js';
import type {
  Colorset,
  DiceAppearance,
  MaterialType,
  TextureDefinition,
} from '../types/appearance.js';
import type { DicePresetData, DieShape, DieType } from '../types/dice.js';
import {
  CORE_COLORSETS,
  DEFAULT_COLORSET_NAME,
  chooseRandomValue,
  cloneColorset,
} from './colorsets.js';
import { GeometryRegistry } from './geometry-registry.js';
import { LabelAtlasBuilder } from './label-atlas.js';
import {
  createDiceMaterial,
  resolveMaterialType,
  type DiceMaterialQuality,
} from './materials.js';
import { TEXTURE_LIST } from './textures.js';
import { TextureCompositor } from './texture-compositor.js';

type ProcessMaterialHook = (
  diceType: DieType,
  material: Record<string, unknown>,
  appearance: Record<string, unknown>,
) => unknown;

type BeforeShaderCompileHook = (shader: unknown, material: unknown) => void;

type MaterialWithHooks = Material & {
  onBeforeCompile?: (shader: unknown, renderer?: unknown) => void;
  userData?: Record<string, unknown>;
};

function normalizeSystemMode(mode: string | boolean | undefined): string {
  if (typeof mode === 'boolean') {
    return mode ? 'preferred' : 'default';
  }

  return mode ?? 'default';
}

function looksLikeDiceSystemInstance(system: unknown): system is IDiceSystem {
  if (!system || typeof system !== 'object') {
    return false;
  }

  const candidate = system as {
    constructor?: { name?: string };
    processMaterial?: unknown;
    beforeShaderCompile?: unknown;
    loadSettings?: unknown;
  };

  if (candidate.constructor?.name === 'DiceSystem') {
    return true;
  }

  return (
    typeof candidate.processMaterial === 'function'
    || typeof candidate.beforeShaderCompile === 'function'
    || typeof candidate.loadSettings === 'function'
  );
}

const DEFAULT_APPEARANCE: DiceAppearance = {
  labelColor: '#ffffff',
  diceColor: '#000000',
  outlineColor: '#000000',
  edgeColor: '#000000',
  texture: 'none',
  material: 'auto',
  font: 'Arial',
  colorset: DEFAULT_COLORSET_NAME,
  system: 'standard',
};

const DEFAULT_DICE_SCALES: Record<string, number> = {
  d2: 1,
  d4: 1,
  d6: 1.3,
  d8: 1.1,
  d10: 1,
  d12: 1.1,
  d14: 0.5,
  d16: 0.5,
  d20: 1,
  d24: 1,
  d30: 0.75,
  d100: 0.75,
};

const DEFAULT_SHAPES: Record<DieType, DieShape> = {
  d2: 'd2',
  d4: 'd4',
  d6: 'd6',
  d8: 'd8',
  d10: 'd10',
  d12: 'd12',
  d14: 'd14',
  d16: 'd16',
  d20: 'd20',
  d24: 'd24',
  d30: 'd30',
  d100: 'd10',
  dc: 'd2',
  df: 'd6',
};

const DEFAULT_TYPES: DieType[] = [
  'd2',
  'd4',
  'd6',
  'd8',
  'd10',
  'd12',
  'd14',
  'd16',
  'd20',
  'd24',
  'd30',
  'd100',
];

export interface DiceFactoryOptions {
  preferredSystem?: string;
  preferredColorset?: string;
  baseScale?: number;
  materialQuality?: DiceMaterialQuality;
  anisotropy?: number;
  envMap?: Texture | null;
  roughnessMaps?: Record<string, Texture>;
  random?: () => number;
}

export interface ResolvedDiceAppearance extends DiceAppearance {
  resolvedMaterialType: MaterialType;
}

export class DiceFactory implements IDiceFactory {
  preferredSystem: string;
  preferredColorset: string;
  baseScale: number;
  systems = new Map<string, IDiceSystem>();

  private materialQuality: DiceMaterialQuality;
  private envMap: Texture | null;
  private roughnessMaps: Record<string, Texture>;
  private readonly random: () => number;

  private readonly presets = new Map<DieType, DicePresetData>();
  private readonly colorsets = new Map<string, Colorset>();
  private readonly textures = new Map<string, TextureDefinition>();

  private readonly geometryRegistry = new GeometryRegistry();
  private readonly labelAtlasBuilder = new LabelAtlasBuilder();
  private readonly textureCompositor: TextureCompositor;
  private readonly materialCache = new Map<string, Material>();

  constructor(options: DiceFactoryOptions = {}) {
    this.preferredSystem = options.preferredSystem ?? 'standard';
    this.preferredColorset = options.preferredColorset ?? 'custom';
    this.baseScale = options.baseScale ?? 1;
    this.materialQuality = options.materialQuality ?? 'high';
    this.envMap = options.envMap ?? null;
    this.roughnessMaps = options.roughnessMaps ?? {};
    this.random = options.random ?? Math.random;

    this.textureCompositor = new TextureCompositor({ anisotropy: options.anisotropy ?? 1 });

    this.registerDefaultTextures();
    this.registerDefaultColorsets();
    this.registerDefaultSystems();
    this.registerDefaultPresets();
  }

  addSystem(
    system: IDiceSystem | { id: string; name: string; group?: string },
    mode: string | boolean = 'default',
  ): void {
    const resolvedMode = normalizeSystemMode(mode);

    const normalized: IDiceSystem = looksLikeDiceSystemInstance(system)
      ? system
      : new DiceSystem(system.id, system.name, resolvedMode, system.group ?? null);

    const mutableSystem = normalized as {
      mode?: string;
      group?: string | null;
      loadSettings?: () => void;
    };

    const effectiveMode = typeof mutableSystem.mode === 'string' ? mutableSystem.mode : resolvedMode;
    mutableSystem.mode = effectiveMode;
    mutableSystem.group = mutableSystem.group ?? normalized.group ?? null;

    this.systems.set(normalized.id, normalized);
    mutableSystem.loadSettings?.();

    for (const preset of this.presets.values()) {
      if (preset.system === normalized.id) {
        this.attachPresetToSystem(preset);
      }
    }

    if (effectiveMode !== 'default' && this.preferredSystem === 'standard') {
      this.preferredSystem = normalized.id;
    }
  }

  addDicePreset(dice: DicePresetData, shape: string | null = null): void {
    const labels = normalizePresetLabels((dice as { labels?: unknown }).labels, dice);
    const values = normalizePresetValues((dice as { values?: unknown }).values, dice.type, dice);

    const normalized: DicePresetData = {
      ...dice,
      shape: (shape ?? dice.shape ?? DEFAULT_SHAPES[dice.type] ?? 'd6') as DieShape,
      scale: dice.scale ?? DEFAULT_DICE_SCALES[dice.type] ?? 1,
      labels,
      values,
      system: dice.system ?? 'standard',
    };

    this.presets.set(dice.type, normalized);
    this.attachPresetToSystem(normalized);
  }

  addColorset(colorset: Partial<Colorset> & { name: string }, mode = 'default'): void {
    const base = this.colorsets.get(colorset.name) ?? CORE_COLORSETS.custom;
    const merged: Colorset = {
      ...cloneColorset(base),
      ...colorset,
      name: colorset.name,
    };

    this.colorsets.set(merged.name, merged);
    if (mode === 'preferred') {
      this.preferredColorset = merged.name;
    }
  }

  addTexture(textureID: string, textureData: TextureDefinition): void {
    this.textures.set(textureID, { ...textureData });
  }

  setMaterialQuality(quality: DiceMaterialQuality): void {
    this.materialQuality = quality;
    this.clearMaterialCache();
  }

  setEnvironmentMaps(envMap: Texture | null, roughnessMaps: Record<string, Texture> = {}): void {
    this.envMap = envMap;
    this.roughnessMaps = roughnessMaps;
    this.clearMaterialCache();
  }

  resolveAppearance(
    dieType: DieType,
    overrides: Partial<DiceAppearance> = {},
  ): ResolvedDiceAppearance {
    const preferredColorset = overrides.colorset ?? this.preferredColorset;
    const colorset = this.colorsets.get(preferredColorset) ?? this.colorsets.get(DEFAULT_COLORSET_NAME) ?? cloneColorset(CORE_COLORSETS.custom);

    const resolved: DiceAppearance = {
      ...DEFAULT_APPEARANCE,
      ...overrides,
      colorset: preferredColorset,
      labelColor: chooseRandomValue(colorset.foreground, this.random) || DEFAULT_APPEARANCE.labelColor,
      diceColor: chooseRandomValue(colorset.background, this.random) || DEFAULT_APPEARANCE.diceColor,
      outlineColor: chooseRandomValue(colorset.outline, this.random) || DEFAULT_APPEARANCE.outlineColor,
      edgeColor: chooseRandomValue(colorset.edge, this.random) || DEFAULT_APPEARANCE.edgeColor,
      texture: chooseRandomValue(colorset.texture, this.random) || DEFAULT_APPEARANCE.texture,
      font: colorset.font ?? DEFAULT_APPEARANCE.font,
      system: overrides.system ?? this.preferredSystem,
    };

    const preset = this.resolvePreset(dieType);
    if (preset.system) {
      resolved.system = overrides.system ?? preset.system;
    }

    const textureDefinition = this.textures.get(resolved.texture);
    const resolvedMaterialType = resolveMaterialType(resolved.material, textureDefinition?.material);

    return {
      ...resolved,
      resolvedMaterialType,
    };
  }

  async getMesh(dieType: DieType, overrides: Partial<DiceAppearance> = {}): Promise<Mesh> {
    const preset = this.resolvePreset(dieType);
    const shape = preset.shape ?? DEFAULT_SHAPES[dieType] ?? 'd6';

    const geometryData = await this.geometryRegistry.getGeometry(shape, {
      modelFile: preset.modelFile,
      expectedFaceCount: preset.values.length,
    });

    const resolvedAppearance = this.resolveAppearance(dieType, overrides);

    const labels = preset.labels.length > 0
      ? preset.labels
      : geometryData.faceValues.map((value) => String(value));

    const atlasKey = [
      dieType,
      resolvedAppearance.font,
      resolvedAppearance.labelColor,
      resolvedAppearance.outlineColor,
      labels.map((value) => (Array.isArray(value) ? value.join('|') : value)).join(','),
    ].join('::');

    const labelAtlas = await this.labelAtlasBuilder.build({
      key: atlasKey,
      labels,
      faceValues: geometryData.faceValues,
      layout: geometryData.layout,
      fontFamily: resolvedAppearance.font,
      foreground: resolvedAppearance.labelColor,
      outline: resolvedAppearance.outlineColor,
      cellSize: 256,
    });

    const texture = this.textures.get(resolvedAppearance.texture) ?? this.textures.get('none') ?? null;

    const textureCacheKey = [
      dieType,
      resolvedAppearance.colorset,
      resolvedAppearance.texture,
      resolvedAppearance.diceColor,
      resolvedAppearance.labelColor,
      resolvedAppearance.outlineColor,
      atlasKey,
    ].join('::');

    const composed = await this.textureCompositor.compose({
      cacheKey: textureCacheKey,
      baseColor: resolvedAppearance.diceColor,
      texture,
      labelAtlas,
    });

    const roughnessMap = this.resolveRoughnessMap(resolvedAppearance.resolvedMaterialType);
    const material = this.getOrCreateMaterial({
      dieType,
      appearance: resolvedAppearance,
      map: composed.map,
      bumpMap: composed.bumpMap,
      roughnessMap,
      emissive: preset.emissive,
      emissiveIntensity: preset.emissiveIntensity,
    });

    const mesh = new Mesh(geometryData.geometry, material);
    const scale = (preset.scale ?? 1) * this.baseScale * (DEFAULT_DICE_SCALES[dieType] ?? 1);
    mesh.scale.setScalar(scale);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.userData = {
      ...mesh.userData,
      dieType,
      shape,
      system: resolvedAppearance.system,
      colorset: resolvedAppearance.colorset,
      texture: resolvedAppearance.texture,
      material: resolvedAppearance.resolvedMaterialType,
      faceValues: geometryData.faceValues,
      mass: preset.mass ?? 300,
      inertia: preset.inertia ?? 13,
    };

    return mesh;
  }

  dispose(): void {
    this.clearMaterialCache();
    this.textureCompositor.dispose();
    this.geometryRegistry.dispose();
    this.labelAtlasBuilder.clear();
  }

  private registerDefaultTextures(): void {
    for (const [id, definition] of Object.entries(TEXTURE_LIST)) {
      this.textures.set(id, { ...definition });
    }
  }

  private registerDefaultColorsets(): void {
    for (const [id, colorset] of Object.entries(CORE_COLORSETS)) {
      this.colorsets.set(id, cloneColorset(colorset));
    }
  }

  private registerDefaultSystems(): void {
    this.addSystem(new DiceSystem('standard', 'Standard'));
  }

  private registerDefaultPresets(): void {
    for (const dieType of DEFAULT_TYPES) {
      this.addDicePreset(createDefaultPreset(dieType));
    }
  }

  private resolvePreset(dieType: DieType): DicePresetData {
    const preset = this.presets.get(dieType);
    if (preset) return preset;

    const fallback = createDefaultPreset(dieType);
    this.presets.set(dieType, fallback);
    return fallback;
  }

  private attachPresetToSystem(preset: DicePresetData): void {
    const system = this.systems.get(preset.system) ?? this.systems.get('standard');
    if (!system) {
      return;
    }

    const diceMap = (system as { dice?: unknown }).dice;
    if (!(diceMap instanceof Map)) {
      return;
    }

    const diceEntry: DiceMapEntry = {
      shape: preset.shape ?? DEFAULT_SHAPES[preset.type] ?? 'd6',
      values: [...preset.values],
      diceSystem: system as unknown as DiceSystem,
    };

    (diceMap as Map<string, DiceMapEntry>).set(preset.type, diceEntry);
  }

  private resolveRoughnessMap(material: MaterialType): Texture | null {
    if (material === 'metal' || material === 'chrome') {
      return this.roughnessMaps.metal ?? null;
    }
    if (material === 'stone') {
      return this.roughnessMaps.stone ?? null;
    }
    if (material === 'wood') {
      return this.roughnessMaps.wood ?? null;
    }
    return this.roughnessMaps.fingerprint ?? null;
  }

  private getOrCreateMaterial(args: {
    dieType: DieType;
    appearance: ResolvedDiceAppearance;
    map: Texture;
    bumpMap: Texture | null;
    roughnessMap: Texture | null;
    emissive?: number;
    emissiveIntensity?: number;
  }): Material {
    const materialCacheKey = [
      args.dieType,
      args.appearance.resolvedMaterialType,
      this.materialQuality,
      args.appearance.diceColor,
      args.appearance.texture,
      args.map.uuid,
      args.bumpMap?.uuid ?? 'none',
      args.roughnessMap?.uuid ?? 'none',
      this.envMap?.uuid ?? 'none',
      String(args.emissive ?? 0),
      String(args.emissiveIntensity ?? 1),
    ].join('::');

    const cached = this.materialCache.get(materialCacheKey);
    if (cached) {
      const hooked = this.applySystemMaterialHooks(args.dieType, cached, args.appearance);
      Hooks.callAll('diceSoNiceOnMaterialReady', hooked, materialCacheKey);
      return hooked;
    }

    const material = createDiceMaterial({
      materialType: args.appearance.resolvedMaterialType,
      quality: this.materialQuality,
      color: args.appearance.diceColor,
      map: args.map,
      bumpMap: args.bumpMap,
      roughnessMap: args.roughnessMap,
      envMap: this.envMap,
      emissive: args.emissive,
      emissiveIntensity: args.emissiveIntensity,
    });

    this.materialCache.set(materialCacheKey, material);
    const hooked = this.applySystemMaterialHooks(args.dieType, material, args.appearance);
    Hooks.callAll('diceSoNiceOnMaterialReady', hooked, materialCacheKey);
    return hooked;
  }

  private applySystemMaterialHooks(
    dieType: DieType,
    baseMaterial: Material,
    appearance: ResolvedDiceAppearance,
  ): Material {
    const system = this.systems.get(appearance.system);
    if (!system) {
      return baseMaterial;
    }

    const maybeProcessMaterial =
      (system as { processMaterial?: ProcessMaterialHook } | undefined)?.processMaterial;
    const maybeBeforeShaderCompile =
      (system as { beforeShaderCompile?: BeforeShaderCompileHook } | undefined)?.beforeShaderCompile;

    if (typeof maybeProcessMaterial !== 'function' && typeof maybeBeforeShaderCompile !== 'function') {
      return baseMaterial;
    }

    const clone = baseMaterial.clone();
    let resolved: Material = clone;

    if (typeof maybeProcessMaterial === 'function') {
      const processed = maybeProcessMaterial(
        dieType,
        clone as unknown as Record<string, unknown>,
        appearance as unknown as Record<string, unknown>,
      );

      if (processed && typeof processed === 'object') {
        resolved = processed as Material;
      }
    }

    if (typeof maybeBeforeShaderCompile === 'function') {
      const hookTarget = resolved as MaterialWithHooks;
      const previous = hookTarget.onBeforeCompile;
      hookTarget.onBeforeCompile = (shader: unknown, renderer?: unknown) => {
        previous?.call(hookTarget, shader, renderer);
        Hooks.callAll('diceSoNiceShaderOnBeforeCompile', shader, hookTarget);
        maybeBeforeShaderCompile(shader, hookTarget);
      };
    }

    return resolved;
  }

  private clearMaterialCache(): void {
    for (const material of this.materialCache.values()) {
      material.dispose();
    }
    this.materialCache.clear();
  }
}

function createDefaultPreset(dieType: DieType): DicePresetData {
  const shape = DEFAULT_SHAPES[dieType] ?? 'd6';
  const values = defaultValuesForType(dieType);
  const labels = values.map((value) => String(value));

  return {
    type: dieType,
    shape,
    labels,
    values,
    scale: DEFAULT_DICE_SCALES[dieType] ?? 1,
    system: 'standard',
  };
}

function defaultValuesForType(dieType: DieType): number[] {
  if (dieType === 'd100') {
    return [10, 20, 30, 40, 50, 60, 70, 80, 90, 0];
  }
  if (dieType === 'd10') {
    return [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];
  }
  if (dieType === 'dc') {
    return [1, 2];
  }
  if (dieType === 'df') {
    return [-1, 0, 1, -1, 0, 1];
  }

  const shape = DEFAULT_SHAPES[dieType];
  if (shape && shape in DICE_SHAPE_DEFINITIONS) {
    const count = DICE_SHAPE_DEFINITIONS[shape].faceValues.length;
    return Array.from({ length: count }, (_, index) => index + 1);
  }

  const numericFaces = Number.parseInt(dieType.slice(1), 10);
  const faces = Number.isFinite(numericFaces) && numericFaces > 0 ? numericFaces : 6;
  return Array.from({ length: faces }, (_, index) => index + 1);
}

function normalizePresetLabels(source: unknown, context: unknown): (string | string[])[] {
  const resolved = resolvePresetProperty(source, context);

  if (Array.isArray(resolved)) {
    return resolved.map(normalizeLabelValue);
  }

  if (typeof resolved === 'string') {
    return [resolved];
  }

  if (isIterableUnknown(resolved)) {
    return Array.from(resolved).map(normalizeLabelValue);
  }

  return [];
}

function normalizePresetValues(source: unknown, dieType: DieType, context: unknown): number[] {
  const resolved = resolvePresetProperty(source, context);
  const normalized = normalizeNumericList(resolved);

  if (normalized.length > 0) {
    return normalized;
  }

  const min = getNumericField(resolved, 'min');
  const max = getNumericField(resolved, 'max');
  if (min !== null && max !== null && Number.isInteger(min) && Number.isInteger(max) && max >= min) {
    return Array.from({ length: max - min + 1 }, (_, index) => min + index);
  }

  return defaultValuesForType(dieType);
}

function resolvePresetProperty(source: unknown, context: unknown): unknown {
  if (typeof source !== 'function') {
    return source;
  }

  try {
    return source.call(context);
  } catch {
    return undefined;
  }
}

function normalizeNumericList(source: unknown): number[] {
  if (typeof source === 'number' && Number.isFinite(source)) {
    return [source];
  }

  if (typeof source === 'string') {
    const parsed = Number(source);
    return Number.isFinite(parsed) ? [parsed] : [];
  }

  if (Array.isArray(source) || isIterableUnknown(source)) {
    const rawValues = Array.isArray(source) ? source : Array.from(source);
    return rawValues
      .map((value) => (typeof value === 'number' ? value : Number(value)))
      .filter((value) => Number.isFinite(value));
  }

  return [];
}

function normalizeLabelValue(value: unknown): string | string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry));
  }

  return String(value);
}

function isIterableUnknown(value: unknown): value is Iterable<unknown> {
  if (value === null || value === undefined || typeof value === 'string') {
    return false;
  }

  return Symbol.iterator in Object(value);
}

function getNumericField(source: unknown, key: 'min' | 'max'): number | null {
  if (typeof source !== 'object' || source === null) {
    return null;
  }

  const value = source[key as keyof typeof source];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}
