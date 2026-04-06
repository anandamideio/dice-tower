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
  font: 'Arial',
  colorset: 'custom',
  system: 'standard',
};

function cloneDefaultAppearance(): AppearanceMap {
  return {
    global: { ...DEFAULT_APPEARANCE },
  } as AppearanceMap;
}

function readFlag<T>(user: User, key: string): T | undefined {
  const local = user.getFlag(MODULE_ID, key);
  if (local !== undefined) {
    return local as T;
  }

  const legacy = user.getFlag(LEGACY_MODULE_ID, key);
  return legacy as T | undefined;
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

function normalizeAppearance(value: unknown): AppearanceMap {
  if (!value || typeof value !== 'object') {
    return cloneDefaultAppearance();
  }

  const typed = value as Record<string, unknown>;
  if (typed.global && typeof typed.global === 'object') {
    return typed as unknown as AppearanceMap;
  }

  const migrated = cloneDefaultAppearance();
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
  return normalizeAppearance(readFlag<unknown>(user, SETTING_KEYS.flags.appearance));
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

export function getMergedSfxListForUser(user: User = game.user): SFXLine[] {
  const merged = [...getUserSfxFlags(user)];
  game.users.forEach((other) => {
    if (!other.isGM || other.id === user.id) {
      return;
    }

    const gmGlobal = getUserSfxFlags(other).filter((line) => line.options?.isGlobal === true);
    merged.push(...gmGlobal);
  });

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
