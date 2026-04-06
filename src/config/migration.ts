import type { DiceAppearance } from '../types/appearance.js';
import type { SFXLine } from '../types/dice.js';
import type { ClientSettings } from '../types/settings.js';
import {
  DATA_FORMAT_VERSION,
  LEGACY_MODULE_ID,
  MODULE_ID,
  SETTING_KEYS,
} from './constants.js';
import {
  getWorldFormatVersion,
  normalizeGhostDiceMode,
  setWorldFormatVersion,
} from './register-settings.js';
import {
  getUserAppearanceFlags,
  getUserSettingsFlags,
  getUserSfxFlags,
  setUserAppearanceFlags,
  setUserSettingsFlags,
  setUserSfxFlags,
} from './user-flags.js';

const LEGACY_APPEARANCE_KEYS: Array<keyof DiceAppearance> = [
  'labelColor',
  'diceColor',
  'outlineColor',
  'edgeColor',
  'texture',
  'material',
  'font',
  'colorset',
  'system',
  'systemSettings',
];

function isVersionLessThan(a: string, b: string): boolean {
  const parse = (version: string): [number, number] => {
    const [majorRaw, minorRaw] = version.split('.');
    const major = Number.parseInt(majorRaw ?? '0', 10);
    const minor = Number.parseInt(minorRaw ?? '0', 10);
    return [Number.isFinite(major) ? major : 0, Number.isFinite(minor) ? minor : 0];
  };

  const [aMajor, aMinor] = parse(a);
  const [bMajor, bMinor] = parse(b);

  if (aMajor !== bMajor) {
    return aMajor < bMajor;
  }

  return aMinor < bMinor;
}

function readLegacyWorldFormatVersion(): string {
  try {
    const value = game.settings.get(LEGACY_MODULE_ID, SETTING_KEYS.world.formatVersion);
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
}

function getUsers(): User[] {
  const users: User[] = [];
  game.users.forEach((user) => {
    users.push(user);
  });
  return users;
}

function normalizeSfxLines(lines: SFXLine[]): SFXLine[] {
  return lines.map((line) => ({
    ...line,
    onResult: Array.isArray(line.onResult)
      ? line.onResult
      : typeof line.onResult === 'string'
        ? [line.onResult]
        : [],
  }));
}

export async function migrateDiceTowerSettings(): Promise<void> {
  let formatVersion = getWorldFormatVersion();

  if (!formatVersion) {
    formatVersion = readLegacyWorldFormatVersion();
  }

  if (!formatVersion) {
    await setWorldFormatVersion(DATA_FORMAT_VERSION);
    return;
  }

  if (formatVersion === DATA_FORMAT_VERSION) {
    return;
  }

  if (!game.user.isGM) {
    console.warn('Dice Tower: A GM must complete settings migration first.');
    return;
  }

  const users = getUsers();

  if (isVersionLessThan(formatVersion, '3.0')) {
    for (const user of users) {
      const legacyClientSettings = (() => {
        try {
          return game.settings.get(LEGACY_MODULE_ID, SETTING_KEYS.flags.settings);
        } catch {
          return undefined;
        }
      })();

      if (legacyClientSettings && typeof legacyClientSettings === 'object') {
        await setUserSettingsFlags(legacyClientSettings as Partial<ClientSettings>, user);
      }
    }
  }

  if (isVersionLessThan(formatVersion, '4.0')) {
    for (const user of users) {
      const normalizedAppearance = getUserAppearanceFlags(user);
      await setUserAppearanceFlags(normalizedAppearance, user);

      const normalizedSfx = normalizeSfxLines(getUserSfxFlags(user));
      await setUserSfxFlags(normalizedSfx, user);
    }
  }

  if (isVersionLessThan(formatVersion, '4.1')) {
    for (const user of users) {
      const appearance = getUserAppearanceFlags(user) as Record<string, unknown>;
      for (const key of LEGACY_APPEARANCE_KEYS) {
        if (key in appearance) {
          delete appearance[key];
        }
      }
      await setUserAppearanceFlags(appearance as ReturnType<typeof getUserAppearanceFlags>, user);
    }
  }

  if (isVersionLessThan(formatVersion, '4.2')) {
    try {
      const currentValue = game.settings.get(MODULE_ID, SETTING_KEYS.world.showGhostDice);
      await game.settings.set(MODULE_ID, SETTING_KEYS.world.showGhostDice, normalizeGhostDiceMode(currentValue));
    } catch {
      // Ignore missing registration and continue normalizing user settings.
    }

    for (const user of users) {
      const settings = getUserSettingsFlags(user);
      if ('showGhostDice' in settings) {
        await setUserSettingsFlags(
          {
            ...settings,
            showGhostDice: normalizeGhostDiceMode(settings.showGhostDice),
          } as Partial<ClientSettings>,
          user,
        );
      }
    }
  }

  await setWorldFormatVersion(DATA_FORMAT_VERSION);
  console.info('Dice Tower: Settings migrated to version 4.2.');
}
