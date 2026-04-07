import type { ClientSettings, WorldSettings } from '../types/settings.js';
import type { RollableArea } from '../types/rendering.js';
import { MODULE_ID, SETTING_KEYS } from './constants.js';
import {
  CLIENT_SETTINGS_SCHEMA,
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_WORLD_SETTINGS,
  WORLD_SETTINGS_SCHEMA,
  type SettingSchemaEntry,
} from './settings-schema.js';
import { DiceConfigSvelteApp } from '../ui/foundry-bridge.js';
import { RollableAreaConfigMenuApp } from './menu-apps.js';

function localizeOrKey(key: string): string {
  return game.i18n?.localize?.(key) ?? key;
}

function safeGet(moduleId: string, key: string): unknown {
  try {
    return game.settings.get(moduleId, key);
  } catch {
    return undefined;
  }
}

function registerSetting(key: string, schema: SettingSchemaEntry<unknown>): void {
  game.settings.register(MODULE_ID, key, {
    scope: schema.scope,
    config: schema.config,
    type: schema.type,
    default: schema.default,
    name: localizeOrKey(schema.name),
    hint: localizeOrKey(schema.hint),
    requiresReload: schema.requiresReload,
    choices: schema.choices,
    range: schema.range,
  });
}

export function normalizeGhostDiceMode(value: unknown): WorldSettings['showGhostDice'] {
  if (value === '0' || value === '1' || value === '2') {
    return value;
  }

  if (value === true) {
    return '1';
  }

  return '0';
}

export function registerDiceTowerSettings(): void {
  for (const [key, schema] of Object.entries(WORLD_SETTINGS_SCHEMA)) {
    registerSetting(key, schema);
  }

  for (const [key, schema] of Object.entries(CLIENT_SETTINGS_SCHEMA)) {
    registerSetting(key, schema);
  }

  game.settings.registerMenu(MODULE_ID, SETTING_KEYS.menus.diceConfig, {
    name: localizeOrKey('DICETOWER.Menu.DiceConfig.Name'),
    label: localizeOrKey('DICETOWER.Menu.DiceConfig.Label'),
    hint: localizeOrKey('DICETOWER.Menu.DiceConfig.Hint'),
    icon: 'fas fa-dice-d20',
    restricted: false,
    type: DiceConfigSvelteApp,
  });

  game.settings.registerMenu(MODULE_ID, SETTING_KEYS.menus.rollableArea, {
    name: localizeOrKey('DICETOWER.Menu.RollableAreaConfig.Name'),
    label: localizeOrKey('DICETOWER.Menu.RollableAreaConfig.Label'),
    hint: localizeOrKey('DICETOWER.Menu.RollableAreaConfig.Hint'),
    icon: 'fas fa-vector-square',
    restricted: false,
    type: RollableAreaConfigMenuApp,
  });
}

export function getWorldSettingsSnapshot(): WorldSettings {
  const value: WorldSettings = {
    ...DEFAULT_WORLD_SETTINGS,
  };

  for (const key of Object.keys(DEFAULT_WORLD_SETTINGS) as Array<keyof WorldSettings>) {
    const stored = safeGet(MODULE_ID, key);
    if (stored !== undefined) {
      (value as unknown as Record<string, unknown>)[key] = stored;
    }
  }

  value.showGhostDice = normalizeGhostDiceMode(value.showGhostDice);
  return value;
}

export function getClientSettingsSnapshot(): ClientSettings {
  const value: ClientSettings = {
    ...DEFAULT_CLIENT_SETTINGS,
  };

  for (const key of Object.keys(DEFAULT_CLIENT_SETTINGS) as Array<keyof ClientSettings>) {
    const stored = safeGet(MODULE_ID, key);
    if (stored !== undefined) {
      (value as unknown as Record<string, unknown>)[key] = stored;
    }
  }

  const rollingArea = value.rollingArea;
  if (rollingArea !== false && typeof rollingArea !== 'object') {
    value.rollingArea = false;
  }

  return value;
}

export async function setClientSetting<K extends keyof ClientSettings>(
  key: K,
  value: ClientSettings[K],
): Promise<void> {
  await game.settings.set(MODULE_ID, key, value);
}

export async function setClientSettingsPatch(patch: Partial<ClientSettings>): Promise<void> {
  for (const [key, value] of Object.entries(patch)) {
    await game.settings.set(MODULE_ID, key, value);
  }
}

export async function setWorldFormatVersion(version: string): Promise<void> {
  await game.settings.set(MODULE_ID, SETTING_KEYS.world.formatVersion, version);
}

export function getWorldFormatVersion(): string {
  const value = safeGet(MODULE_ID, SETTING_KEYS.world.formatVersion);
  return typeof value === 'string' ? value : '';
}

export function sanitizeRollableArea(value: unknown): RollableArea | false {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<RollableArea>;
  if (
    typeof candidate.left !== 'number' ||
    typeof candidate.top !== 'number' ||
    typeof candidate.width !== 'number' ||
    typeof candidate.height !== 'number'
  ) {
    return false;
  }

  return {
    left: candidate.left,
    top: candidate.top,
    width: candidate.width,
    height: candidate.height,
  };
}
