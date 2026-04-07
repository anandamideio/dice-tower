import type { AppearanceMap, DiceAppearance } from '../types/appearance.js';
import type { SFXLine } from '../types/dice.js';
import type { ClientSettings } from '../types/settings.js';
import { LEGACY_MODULE_ID, MODULE_ID, SETTING_KEYS } from './constants.js';

export interface DiceSaveProfile {
  appearance?: AppearanceMap;
  sfxList?: SFXLine[];
  settings?: Partial<ClientSettings>;
}

const DEFAULT_APPEARANCE: DiceAppearance = {
  labelColor: '#ffffff',
  diceColor: '#000000',
  outlineColor: '#000000',
  edgeColor: '#000000',
  texture: 'none',
  material: 'auto',
  font: 'auto',
  colorset: 'custom',
  system: 'standard',
};

function resolveUserColor(user: User): string {
  const color = user.color?.toString?.();
  if (typeof color === 'string' && color.length > 0) {
    return color;
  }

  return DEFAULT_APPEARANCE.diceColor;
}

function createDefaultAppearanceForUser(user: User): DiceAppearance {
  const userColor = resolveUserColor(user);
  return {
    ...DEFAULT_APPEARANCE,
    diceColor: userColor,
    outlineColor: userColor,
    edgeColor: userColor,
  };
}

function cloneDefaultAppearance(user: User): AppearanceMap {
  return {
    global: createDefaultAppearanceForUser(user),
  } as AppearanceMap;
}

function readRawFlag<T>(user: User, scope: string, key: string): T | undefined {
  const candidate = user as unknown as {
    flags?: Record<string, unknown>;
  };

  const scopeFlags = candidate.flags?.[scope];
  if (!scopeFlags || typeof scopeFlags !== 'object') {
    return undefined;
  }

  return (scopeFlags as Record<string, unknown>)[key] as T | undefined;
}

function readFlagSafe<T>(user: User, scope: string, key: string): T | undefined {
  try {
    return user.getFlag(scope, key) as T | undefined;
  } catch {
    // Foundry can reject legacy scopes that are no longer active modules.
    return readRawFlag<T>(user, scope, key);
  }
}

function readFlag<T>(user: User, key: string): T | undefined {
  const local = readFlagSafe<T>(user, MODULE_ID, key);
  if (local !== undefined) {
    return local;
  }

  return readFlagSafe<T>(user, LEGACY_MODULE_ID, key);
}

function toArraySfx(value: unknown): SFXLine[] {
  if (Array.isArray(value)) {
    return value.filter((line): line is SFXLine => {
      if (!line || typeof line !== 'object') {
        return false;
      }
      const candidate = line as Partial<SFXLine>;
      return (
        typeof candidate.diceType === 'string' &&
        Array.isArray(candidate.onResult) &&
        typeof candidate.specialEffect === 'string'
      );
    });
  }

  if (value && typeof value === 'object') {
    return Object.values(value).flatMap((line) => toArraySfx([line]));
  }

  return [];
}

function normalizeAppearance(value: unknown, user: User): AppearanceMap {
  if (!value || typeof value !== 'object') {
    return cloneDefaultAppearance(user);
  }

  const typed = value as Record<string, unknown>;
  if (typed.global && typeof typed.global === 'object') {
    return typed as unknown as AppearanceMap;
  }

  const migrated = cloneDefaultAppearance(user);
  migrated.global = {
    ...migrated.global,
    ...(typed as Partial<DiceAppearance>),
  };
  return migrated;
}

export function getUserSettingsFlags(user: User = game.user): Partial<ClientSettings> {
  const settings = readFlag<unknown>(user, SETTING_KEYS.flags.settings);
  if (!settings || typeof settings !== 'object') {
    return {};
  }
  return settings as Partial<ClientSettings>;
}

export async function setUserSettingsFlags(
  patch: Partial<ClientSettings>,
  user: User = game.user,
): Promise<void> {
  const current = getUserSettingsFlags(user);
  await user.setFlag(MODULE_ID, SETTING_KEYS.flags.settings, {
    ...current,
    ...patch,
  });
}

export function getUserAppearanceFlags(user: User = game.user): AppearanceMap {
  return normalizeAppearance(readFlag<unknown>(user, SETTING_KEYS.flags.appearance), user);
}

export async function setUserAppearanceFlags(
  appearance: AppearanceMap,
  user: User = game.user,
): Promise<void> {
  await user.setFlag(MODULE_ID, SETTING_KEYS.flags.appearance, appearance);
}

export function getUserSfxFlags(user: User = game.user): SFXLine[] {
  return toArraySfx(readFlag<unknown>(user, SETTING_KEYS.flags.sfxList));
}

export async function setUserSfxFlags(lines: SFXLine[], user: User = game.user): Promise<void> {
  await user.setFlag(MODULE_ID, SETTING_KEYS.flags.sfxList, lines);
}

export function getMergedSfxListForUser(
  user: User = game.user,
  options?: {
    includeOthers?: boolean;
    viewer?: User;
  },
): SFXLine[] {
  const viewer = options?.viewer ?? game.user;
  const includeOthers = options?.includeOthers ?? true;

  const merged: SFXLine[] = [];
  if (includeOthers || user.id === viewer.id) {
    merged.push(...getUserSfxFlags(user));
  }

  if (includeOthers) {
    game.users.forEach((other) => {
      if (!other.isGM || other.id === user.id) {
        return;
      }

      const gmGlobal = getUserSfxFlags(other).filter((line) => line.options?.isGlobal === true);
      merged.push(...gmGlobal);
    });
  }

  const deduped: SFXLine[] = [];
  const seen = new Set<string>();
  for (const line of merged) {
    const key = JSON.stringify(line);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(line);
  }

  return deduped;
}

export function getUserSaves(user: User = game.user): Record<string, DiceSaveProfile> {
  const value = readFlag<unknown>(user, SETTING_KEYS.flags.saves);
  if (!value || typeof value !== 'object') {
    return {};
  }
  return value as Record<string, DiceSaveProfile>;
}

export async function applyUserSaveProfile(name: string, user: User = game.user): Promise<DiceSaveProfile | null> {
  const saves = getUserSaves(user);
  const profile = saves[name];
  if (!profile) {
    return null;
  }

  if (profile.appearance) {
    await setUserAppearanceFlags(profile.appearance, user);
  }

  if (profile.sfxList) {
    await setUserSfxFlags(profile.sfxList, user);
  }

  if (profile.settings) {
    await setUserSettingsFlags(profile.settings, user);
  }

  return profile;
}
