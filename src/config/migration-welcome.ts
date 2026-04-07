import { LEGACY_MODULE_ID, MODULE_ID } from './constants.js';
import { DiceConfigMenuApp } from './menu-apps.js';

const STORAGE_KEY_PREFIX = `${MODULE_ID}.migrationWelcomeSeen`;

interface RuntimeNotifications {
  notifications?: {
    info?: (text: string) => void;
  };
}

interface RuntimeDialogButton {
  label: string;
  callback?: () => void;
}

interface RuntimeDialogData {
  title: string;
  content: string;
  buttons: Record<string, RuntimeDialogButton>;
  default?: string;
  close?: () => void;
}

interface RuntimeDialog {
  render(force?: boolean): void;
}

interface RuntimeDialogCtor {
  new (data: RuntimeDialogData): RuntimeDialog;
}

function localizeOrFallback(key: string, fallback: string): string {
  const localized = game.i18n?.localize?.(key) ?? key;
  return localized === key ? fallback : localized;
}

function getStorageKey(): string {
  const worldId = (game as unknown as { world?: { id?: string } }).world?.id ?? 'world';
  return `${STORAGE_KEY_PREFIX}.${worldId}.${game.user.id}`;
}

function hasSeenWelcome(): boolean {
  try {
    return window.localStorage.getItem(getStorageKey()) === '1';
  } catch {
    return false;
  }
}

function markWelcomeSeen(): void {
  try {
    window.localStorage.setItem(getStorageKey(), '1');
  } catch {
    // Ignore storage failures and continue.
  }
}

function hasLegacyContext(): boolean {
  const modules = (game as unknown as {
    modules?: {
      get?: (id: string) => { active?: boolean } | undefined;
    };
  }).modules;

  if (modules?.get?.(LEGACY_MODULE_ID)) {
    return true;
  }

  try {
    const formatVersion = game.settings.get(LEGACY_MODULE_ID, 'formatVersion');
    if (typeof formatVersion === 'string' && formatVersion.length > 0) {
      return true;
    }
  } catch {
    // The legacy module may not be installed.
  }

  return false;
}

function openDiceTowerConfig(): void {
  new DiceConfigMenuApp().render(true);
}

export function maybeShowMigrationWelcome(): void {
  if (!hasLegacyContext() || hasSeenWelcome()) {
    return;
  }

  const title = localizeOrFallback(
    'DICETOWER.MigrationWelcome.Title',
    'Welcome to Dice Tower',
  );

  const content = [
    localizeOrFallback(
      'DICETOWER.MigrationWelcome.Body.Line1',
      'Dice Tower imported your Dice So Nice preferences and is ready to roll.',
    ),
    localizeOrFallback(
      'DICETOWER.MigrationWelcome.Body.Line2',
      'Open the configuration panel to review appearance presets, SFX, and performance options.',
    ),
    localizeOrFallback(
      'DICETOWER.MigrationWelcome.Body.Line3',
      'This message is shown once per user and world.',
    ),
  ].map((line) => `<p>${line}</p>`).join('');

  const openLabel = localizeOrFallback(
    'DICETOWER.MigrationWelcome.Button.OpenConfig',
    'Open Configuration',
  );
  const closeLabel = localizeOrFallback(
    'DICETOWER.MigrationWelcome.Button.Close',
    'Close',
  );

  const DialogCtor = (globalThis as unknown as { Dialog?: RuntimeDialogCtor }).Dialog;
  if (typeof DialogCtor === 'function') {
    const dialog = new DialogCtor({
      title,
      content,
      buttons: {
        open: {
          label: openLabel,
          callback: () => {
            markWelcomeSeen();
            openDiceTowerConfig();
          },
        },
        close: {
          label: closeLabel,
          callback: () => {
            markWelcomeSeen();
          },
        },
      },
      default: 'open',
      close: () => {
        markWelcomeSeen();
      },
    });

    dialog.render(true);
    return;
  }

  markWelcomeSeen();
  const runtimeUi = ui as RuntimeNotifications;
  runtimeUi.notifications?.info?.(title);
}
