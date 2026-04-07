import type { Mesh } from 'three/webgpu';

import type { Colorset, DiceAppearance, TextureDefinition } from '../types/appearance.js';
import type { DicePresetData } from '../types/dice.js';
import {
  CORE_COLORSETS,
  DiceFactory,
  mergeQueuedRollCommands,
  parseRollToNotation,
  TEXTURE_LIST,
} from '../dice/index.js';
import { MODULE_ID } from '../config/constants.js';
import type { IDice3D, IDiceBox, IDiceFactory, IDiceSFXClass, IDiceSystem } from './dice3d.js';

const DEFAULT_DISABLED_APPEARANCE: DiceAppearance = {
  labelColor: '#ffffff',
  diceColor: '#000000',
  outlineColor: '#000000',
  edgeColor: '#000000',
  texture: 'none',
  material: 'auto',
  font: 'Arial',
  colorset: 'custom',
  system: 'standard',
};

class DisabledDiceFactory implements IDiceFactory {
  preferredSystem = 'standard';
  preferredColorset = 'custom';
  baseScale = 1;
  systems = new Map<string, IDiceSystem>();

  addSystem(system: IDiceSystem | { id: string; name: string; group?: string }): void {
    const normalized: IDiceSystem = 'mode' in system
      ? system
      : {
          id: system.id,
          name: system.name,
          mode: 'default',
          group: system.group ?? null,
        };

    this.systems.set(normalized.id, normalized);
  }

  addDicePreset(_dice: DicePresetData, _shape?: string | null): void {
    void _dice;
    void _shape;
  }

  addColorset(_colorset: Partial<Colorset> & { name: string }, _mode?: string): void {
    void _colorset;
    void _mode;
  }

  addTexture(_textureID: string, _textureData: TextureDefinition): void {
    void _textureID;
    void _textureData;
  }

  resolveAppearance(_dieType: string, _overrides?: Partial<DiceAppearance>): DiceAppearance {
    void _dieType;
    void _overrides;
    return { ...DEFAULT_DISABLED_APPEARANCE };
  }

  getMesh(_dieType: string, _overrides?: Partial<DiceAppearance>): Promise<Mesh> {
    void _dieType;
    void _overrides;
    return Promise.reject(new Error('Dice Tower rendering backend is unavailable.'));
  }
}

class DisabledDiceBox implements IDiceBox {
  running = false;
}

export class Dice3DDisabledRuntime implements IDice3D {
  readonly DiceFactory: IDiceFactory = new DisabledDiceFactory();
  readonly box: IDiceBox = new DisabledDiceBox();
  readonly exports: Record<string, unknown> = {
    parseRollToNotation,
    mergeQueuedRollCommands,
    DiceFactory,
    CORE_COLORSETS,
    TEXTURE_LIST,
    Utils: {
      parseRollToNotation,
      mergeQueuedRollCommands,
    },
    COLORSETS: CORE_COLORSETS,
    TEXTURELIST: TEXTURE_LIST,
  };

  canInteract = false;

  private warned = false;
  private readonly reasonText: string;

  constructor(reason?: unknown) {
    this.reasonText = reason instanceof Error
      ? reason.message
      : (typeof reason === 'string' ? reason : 'Unknown initialization failure.');
  }

  private warnOnce(): void {
    if (this.warned) {
      return;
    }

    this.warned = true;
    const message = `Dice Tower is running in fallback mode and 3D dice are disabled. ${this.reasonText}`;
    console.warn(`${MODULE_ID} | ${message}`);

    const runtimeUi = ui as unknown as {
      notifications?: {
        warn?: (text: string) => void;
      };
    };

    runtimeUi.notifications?.warn?.(message);
  }

  isEnabled(): boolean {
    return false;
  }

  showForRoll(
    _roll: Roll,
    _user?: User,
    _synchronize?: boolean,
    _users?: string[] | null,
    _blind?: boolean,
    _messageID?: string | null,
    _speaker?: Record<string, unknown> | null,
    _options?: { ghost?: boolean; secret?: boolean },
  ): Promise<boolean> {
    void _roll;
    void _user;
    void _synchronize;
    void _users;
    void _blind;
    void _messageID;
    void _speaker;
    void _options;

    this.warnOnce();
    return Promise.resolve(false);
  }

  renderRolls(_chatMessage: ChatMessage, _rolls: Roll[]): void {
    void _chatMessage;
    void _rolls;
    this.warnOnce();
  }

  addSystem(system: IDiceSystem | { id: string; name: string; group?: string }, mode?: string | boolean): void {
    void mode;
    this.DiceFactory.addSystem(system);
  }

  addDicePreset(dice: DicePresetData, shape?: string | null): void {
    this.DiceFactory.addDicePreset(dice, shape);
  }

  addColorset(colorset: Partial<Colorset> & { name: string }, mode?: string): Promise<void> {
    this.DiceFactory.addColorset(colorset, mode);
    return Promise.resolve();
  }

  addTexture(textureID: string, textureData: TextureDefinition): Promise<void> {
    this.DiceFactory.addTexture(textureID, textureData);
    return Promise.resolve();
  }

  addSFXTrigger(_id: string, _name: string, _results: string[]): void {
    void _id;
    void _name;
    void _results;
  }

  addSFXMode(_sfxClass: IDiceSFXClass): void {
    void _sfxClass;
  }

  addSFX(sfxClass: IDiceSFXClass): void {
    this.addSFXMode(sfxClass);
  }

  getSFXModes(): Record<string, string> {
    return {};
  }

  loadSaveFile(_name: string): Promise<void> {
    void _name;
    return Promise.resolve();
  }

  getLoadedDiceSystems(): Map<string, IDiceSystem> {
    return this.DiceFactory.systems;
  }

  show(
    _data: { throws: unknown[] } & Record<string, unknown>,
    _user?: User,
    _synchronize?: boolean,
    _users?: string[] | null,
    _blind?: boolean,
  ): Promise<boolean> {
    this.warnOnce();
    return Promise.resolve(false);
  }

  waitFor3DAnimationByMessageID(_targetMessageId: string): Promise<boolean> {
    return Promise.resolve(true);
  }

  update(_settings: Record<string, unknown>): void {
    // No-op in disabled mode.
  }

  showExtraDiceByDefault(_show?: boolean): void {
    // No-op in disabled mode.
  }

  enableDebugMode(): void {
    // No-op in disabled mode.
  }

  CONFIG(_user?: User): Record<string, unknown> {
    return { enabled: false };
  }

  ALL_CONFIG(_user?: User): Record<string, unknown> {
    return { enabled: false, appearance: {}, specialEffects: [] };
  }

  APPEARANCE(_user?: User): Record<string, unknown> {
    return { global: { ...DEFAULT_DISABLED_APPEARANCE } };
  }

  DEFAULT_APPEARANCE(_user?: User): Record<string, unknown> {
    return { global: { ...DEFAULT_DISABLED_APPEARANCE } };
  }

  get DEFAULT_OPTIONS(): Record<string, unknown> {
    return { enabled: false };
  }

  ALL_DEFAULT_OPTIONS(_user?: User): Record<string, unknown> {
    return { enabled: false, appearance: { global: { ...DEFAULT_DISABLED_APPEARANCE } } };
  }

  SFX(_user?: User): unknown[] {
    return [];
  }

  SYSTEM_SETTINGS(_user?: User): unknown[] {
    return [];
  }

  ALL_CUSTOMIZATION(_user?: User, _dicefactory?: IDiceFactory | null): Record<string, unknown> {
    return { enabled: false, appearance: {}, specialEffects: [] };
  }
}
