/**
 * DiceSystem — base class for custom dice system extensions.
 *
 * Matches the Dice so Nice DiceSystem API so existing extensions can
 * subclass or interact with it unchanged.
 */

import type { DiceEventType } from '../types/sfx.js';

// ── Static enums exposed on the class ──

export const SETTING_SCOPE = {
  LOCAL: 0,
  SHARED: 1,
} as const;
export type SettingScope = (typeof SETTING_SCOPE)[keyof typeof SETTING_SCOPE];

export const SETTING_TYPE = {
  BOOLEAN: 'boolean',
  SELECT: 'select',
  COLOR: 'color',
  FILE: 'file',
  RANGE: 'range',
  STRING: 'string',
} as const;
export type SettingType = (typeof SETTING_TYPE)[keyof typeof SETTING_TYPE];

export const SETTING_FORMATTING = {
  SEPARATOR: 'separator',
  HTML: 'html',
} as const;

/** A setting definition stored on a DiceSystem. */
export interface DiceSystemSetting {
  type: string;
  id: string | null;
  name: string;
  defaultValue: unknown;
  scope: SettingScope;
  // Range-specific
  min?: number;
  max?: number;
  step?: number;
  // Select-specific
  options?: Record<string, string>;
}

/** Event listener callback for dice lifecycle events. */
export type DiceEventListener = (event: unknown) => void;

/** Material processing callback. */
export type ProcessMaterialCallback = (
  diceType: string,
  material: unknown,
  appearance: Record<string, unknown>,
) => void;

/** Shader compile callback. */
export type BeforeShaderCompileCallback = (
  shader: unknown,
  material: unknown,
  diceType: string,
  appearance: Record<string, unknown>,
) => void;

function readUserFlagSafe<T>(user: User, scope: string, key: string): T | undefined {
  try {
    return user.getFlag(scope, key) as T | undefined;
  } catch {
    const candidate = user as unknown as { flags?: Record<string, unknown> };
    const scopeFlags = candidate.flags?.[scope];
    if (!scopeFlags || typeof scopeFlags !== 'object') {
      return undefined;
    }

    return (scopeFlags as Record<string, unknown>)[key] as T | undefined;
  }
}

/**
 * Dice preset entry stored in the system's dice map.
 */
export interface DiceMapEntry {
  shape: string;
  values: unknown[];
  diceSystem?: DiceSystem;
  [key: string]: unknown;
}

/**
 * DiceSystem base class.
 *
 * Extension authors subclass this (or pass a plain {id, name} object)
 * to register custom dice types, materials, and settings.
 */
export class DiceSystem {
  static readonly SETTING_SCOPE = SETTING_SCOPE;
  static readonly SETTING_TYPE = SETTING_TYPE;
  static readonly SETTING_FORMATTING = SETTING_FORMATTING;

  static readonly DICE_EVENT_TYPE = {
    SPAWN: 0 as const,
    CLICK: 1 as const,
    RESULT: 2 as const,
    COLLIDE: 3 as const,
    DESPAWN: 4 as const,
  };

  private _id: string;
  private _name: string;
  private _dice: Map<string, DiceMapEntry>;
  private _mode: string;
  private _group: string | null;

  private _settings: DiceSystemSetting[] = [];
  private _scopedSettings: Map<string, Record<string, unknown>> = new Map();
  private _listeners: Map<number, DiceEventListener[]> = new Map();

  private _registeredProcessMaterialCallbacks: ProcessMaterialCallback[] = [];
  private _registeredBeforeShaderCompileCallbacks: BeforeShaderCompileCallback[] = [];

  constructor(id: string, name: string, mode = 'default', group: string | null = null) {
    this._id = id;
    this._name = name;
    this._dice = new Map();
    this._mode = mode;
    this._group = group;
  }

  get id(): string {
    return this._id;
  }
  get name(): string {
    return this._name;
  }
  get dice(): Map<string, DiceMapEntry> {
    return this._dice;
  }
  get mode(): string {
    return this._mode;
  }
  get group(): string | null {
    return this._group;
  }

  get settings(): DiceSystemSetting[] {
    const validTypes = Object.values(SETTING_TYPE) as string[];
    return this._settings.filter((s) => validTypes.includes(s.type));
  }

  // ── Event system ──

  on(eventType: DiceEventType, listener: DiceEventListener): void {
    if (!this._listeners.has(eventType)) {
      this._listeners.set(eventType, []);
    }
    this._listeners.get(eventType)!.push(listener);
  }

  off(eventType: DiceEventType, listener: DiceEventListener): void {
    const list = this._listeners.get(eventType);
    if (!list) return;
    const idx = list.indexOf(listener);
    if (idx > -1) list.splice(idx, 1);
  }

  fire(eventType: DiceEventType, event: unknown): void {
    const list = this._listeners.get(eventType);
    if (!list) return;
    for (const listener of list) {
      listener(event);
    }
  }

  // ── Scoped settings ──

  getSettingsByDiceType(diceType: string): Record<string, unknown> | undefined {
    return this._scopedSettings.get(diceType) ?? this._scopedSettings.get('global');
  }

  getScopedSettingValue(diceType: string, settingId: string): unknown {
    return (
      this._scopedSettings.get(diceType)?.[settingId] ??
      this._scopedSettings.get('global')?.[settingId]
    );
  }

  updateSettings(diceType: string = 'global', settings: Record<string, unknown>): void {
    this._scopedSettings.set(diceType, { ...settings });
  }

  loadSettings(): void {
    this._scopedSettings = new Map();
    const defaults = this.settings.reduce(
      (acc, { id, defaultValue }) => {
        if (id) acc[id] = defaultValue;
        return acc;
      },
      {} as Record<string, unknown>,
    );
    this._scopedSettings.set('global', defaults);

    const saved =
      readUserFlagSafe<Record<string, Record<string, unknown>>>(game.user, 'dice-so-nice', 'appearance')
      ?? readUserFlagSafe<Record<string, Record<string, unknown>>>(game.user, 'dice-tower', 'appearance');
    if (saved) {
      for (const diceType of Object.keys(saved)) {
        const entry = saved[diceType];
        const systemSettings = entry.systemSettings;
        if (
          entry.system === this.id &&
          typeof systemSettings === 'object' &&
          systemSettings !== null
        ) {
          this._scopedSettings.set(diceType, {
            ...(systemSettings as Record<string, unknown>),
          });
        }
      }
    }
  }

  getDefaultSettings(): Record<string, unknown> {
    return this.settings.reduce(
      (acc, { id, defaultValue }) => {
        if (id) acc[id] = defaultValue;
        return acc;
      },
      {} as Record<string, unknown>,
    );
  }

  getCacheString(appearance: Record<string, unknown>): string {
    return this.id + JSON.stringify(Object.values(appearance));
  }

  // ── Material hooks ──

  registerProcessMaterialCallback(callback: ProcessMaterialCallback): void {
    this._registeredProcessMaterialCallbacks.push(callback);
  }

  registerBeforeShaderCompileCallback(callback: BeforeShaderCompileCallback): void {
    this._registeredBeforeShaderCompileCallbacks.push(callback);
  }

  processMaterial(
    diceType: string,
    material: Record<string, unknown>,
    appearance: Record<string, unknown>,
  ): Record<string, unknown> {
    if (this.dice.has(diceType)) {
      for (const callback of this._registeredProcessMaterialCallbacks) {
        callback(diceType, material, appearance);
      }
      (material as Record<string, Record<string, unknown>>).userData ??= {};
      (material as Record<string, Record<string, unknown>>).userData.diceType = diceType as unknown as Record<string, unknown>;
      (material as Record<string, Record<string, unknown>>).userData.system = this.id as unknown as Record<string, unknown>;
      (material as Record<string, Record<string, unknown>>).userData.appearance = appearance;
    }
    return material;
  }

  // ── Setting builder methods ──

  addSettingSeparator({ name = '' } = {}): void {
    this._createSetting('separator', null, name, SETTING_SCOPE.LOCAL, null);
  }

  addSettingHTML({ name }: { name: string }): void {
    this._createSetting('html', null, name, SETTING_SCOPE.LOCAL, null);
  }

  addSettingBoolean({
    id,
    name,
    scope = SETTING_SCOPE.SHARED,
    defaultValue = false,
  }: {
    id: string;
    name: string;
    scope?: SettingScope;
    defaultValue?: boolean;
  }): void {
    this._createSetting('boolean', id, name, scope, defaultValue);
  }

  addSettingColor({
    id,
    name,
    scope = SETTING_SCOPE.SHARED,
    defaultValue = '#ffffff',
  }: {
    id: string;
    name: string;
    scope?: SettingScope;
    defaultValue?: string;
  }): void {
    this._createSetting('color', id, name, scope, defaultValue);
  }

  addSettingRange({
    id,
    name,
    scope = SETTING_SCOPE.SHARED,
    defaultValue = 0,
    min = 0,
    max = 100,
    step = 1,
  }: {
    id: string;
    name: string;
    scope?: SettingScope;
    defaultValue?: number;
    min?: number;
    max?: number;
    step?: number;
  }): void {
    this._createSetting('range', id, name, scope, defaultValue, { min, max, step });
  }

  addSettingFile({
    id,
    name,
    scope = SETTING_SCOPE.SHARED,
    defaultValue = '',
  }: {
    id: string;
    name: string;
    scope?: SettingScope;
    defaultValue?: string;
  }): void {
    this._createSetting('file', id, name, scope, defaultValue || '');
  }

  addSettingSelect({
    id,
    name,
    scope = SETTING_SCOPE.SHARED,
    defaultValue = null,
    options = {},
  }: {
    id: string;
    name: string;
    scope?: SettingScope;
    defaultValue?: string | null;
    options?: Record<string, string>;
  }): void {
    this._createSetting('select', id, name, scope, defaultValue, { options });
  }

  addSettingString({
    id,
    name,
    scope = SETTING_SCOPE.SHARED,
    defaultValue = '',
  }: {
    id: string;
    name: string;
    scope?: SettingScope;
    defaultValue?: string;
  }): void {
    this._createSetting('string', id, name, scope, defaultValue || '');
  }

  // ── Internals ──

  private _createSetting(
    type: string,
    id: string | null,
    name: string,
    scope: SettingScope,
    defaultValue: unknown,
    extra: Record<string, unknown> = {},
  ): void {
    this._settings.push({ type, id, name, defaultValue, scope, ...extra } as DiceSystemSetting);
  }
}
