import { mount, unmount } from 'svelte';
import DiceConfig from './DiceConfig.svelte';
import { MODULE_ID, SETTING_KEYS } from '../config/constants.js';
import { CORE_COLORSETS, TEXTURE_LIST } from '../dice/index.js';
import type { DiceAppearance } from '../types/appearance.js';
import type { ClientSettings, WorldSettings } from '../types/settings.js';
import type { SFXLine } from '../types/dice.js';
import {
  getClientSettingsSnapshot,
  getWorldSettingsSnapshot,
} from '../config/register-settings.js';
import {
  getUserAppearanceFlags,
  getUserSfxFlags,
  setUserAppearanceFlags,
  setUserSfxFlags,
} from '../config/user-flags.js';

interface SelectOption {
  value: string;
  label: string;
}

const DIE_TYPES = ['d2', 'd4', 'd6', 'd8', 'd10', 'd12', 'd14', 'd16', 'd20', 'd24', 'd30', 'd100'] as const;
const MATERIAL_OPTIONS = ['auto', 'plastic', 'metal', 'wood', 'glass', 'chrome', 'pristine', 'iridescent', 'stone'] as const;

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

function loc(key: string, fallback: string): string {
  const localized = game.i18n?.localize?.(key);
  return localized && localized !== key ? localized : fallback;
}

function buildSelectOptions(
  entries: Record<string, string>,
  prefix: string,
): SelectOption[] {
  return Object.keys(entries)
    .map((value) => ({ value, label: loc(entries[value], value) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function normalizeAppearance(
  source: Record<string, unknown>,
  fallback: DiceAppearance,
): DiceAppearance {
  return {
    labelColor: typeof source.labelColor === 'string' ? source.labelColor : fallback.labelColor,
    diceColor: typeof source.diceColor === 'string' ? source.diceColor : fallback.diceColor,
    outlineColor: typeof source.outlineColor === 'string' ? source.outlineColor : fallback.outlineColor,
    edgeColor: typeof source.edgeColor === 'string' ? source.edgeColor : fallback.edgeColor,
    texture: typeof source.texture === 'string' ? source.texture : fallback.texture,
    material: (typeof source.material === 'string' ? source.material : fallback.material) as DiceAppearance['material'],
    font: typeof source.font === 'string' ? source.font : fallback.font,
    colorset: typeof source.colorset === 'string' ? source.colorset : fallback.colorset,
    system: typeof source.system === 'string' ? source.system : fallback.system,
  };
}

function mergeApplicationOptions(
  base: ApplicationOptions,
  overrides: ApplicationOptions,
): ApplicationOptions {
  if (typeof foundry !== 'undefined' && foundry.utils?.mergeObject) {
    return foundry.utils.mergeObject({ ...base }, overrides, {
      recursive: true,
      overwrite: true,
    }) as ApplicationOptions;
  }
  return { ...base, ...overrides };
}

function notify(level: 'info' | 'warn' | 'error', message: string): void {
  const handler = ui.notifications?.[level];
  if (typeof handler === 'function') {
    handler(message);
  }
}

export class DiceConfigSvelteApp extends FormApplication<Record<string, unknown>> {
  #component: ReturnType<typeof mount> | null = null;

  static override get defaultOptions(): ApplicationOptions {
    return mergeApplicationOptions(super.defaultOptions, {
      id: `${MODULE_ID}-config`,
      title: loc('DICETOWER.Menu.DiceConfig.Title', 'Dice Tower Configuration'),
      template: `modules/${MODULE_ID}/assets/templates/svelte-shell.hbs`,
      width: 980,
      height: 720,
      closeOnSubmit: false,
      submitOnChange: false,
      submitOnClose: false,
      classes: ['dice-tower-config-app'],
    });
  }

  override getData(): Record<string, unknown> {
    return {};
  }

  activateListeners(html: unknown): void {
    const root = html instanceof HTMLElement
      ? html
      : Array.isArray(html) && html[0] instanceof HTMLElement
        ? html[0]
        : (html as { 0?: HTMLElement })?.[0] ?? null;

    if (!root) return;

    const target = root.querySelector('#svelte-mount') ?? root;

    const clientSettings = getClientSettingsSnapshot();
    const worldSettings = getWorldSettingsSnapshot();
    const appearanceFlags = getUserAppearanceFlags();
    const globalAppearance = normalizeAppearance(
      (appearanceFlags.global ?? {}) as unknown as Record<string, unknown>,
      DEFAULT_APPEARANCE,
    );

    const appearanceScopes = DIE_TYPES.map((dieType) => {
      const override = (appearanceFlags as Record<string, unknown>)[dieType];
      const normalized = override
        ? normalizeAppearance(override as Record<string, unknown>, globalAppearance)
        : { ...globalAppearance };
      return {
        id: dieType,
        enabled: Boolean(override),
        ...normalized,
      };
    });

    const sfxRows = getUserSfxFlags().map((line, index) => ({
      index,
      diceType: line.diceType,
      onResult: line.onResult.join(', '),
      specialEffect: line.specialEffect,
      isGlobal: line.options?.isGlobal === true,
    }));

    const runtime = game.dice3d as unknown as { getSFXModes?: () => Record<string, string> } | undefined;
    const sfxModes = runtime?.getSFXModes?.() ?? {};

    this.#component = mount(DiceConfig, {
      target: target as Element,
      props: {
        isGM: game.user.isGM,
        clientSettings,
        worldSettings,
        globalAppearance,
        appearanceScopes,
        sfxRows,
        colorsets: Object.keys(CORE_COLORSETS).map((name) => ({ value: name, label: name })),
        textures: Object.keys(TEXTURE_LIST).map((name) => ({ value: name, label: name })),
        materials: MATERIAL_OPTIONS.map((m) => ({ value: m, label: loc(`DICETOWER.Material.${m}`, m) })),
        sfxModeOptions: Object.entries(sfxModes).map(([value, label]) => ({ value, label })),
        hideFxOptions: [
          { value: 'fadeOut', label: loc('DICETOWER.Settings.hideFX.FadeOut', 'Fade Out') },
          { value: 'none', label: loc('DICETOWER.Settings.hideFX.None', 'None') },
        ],
        imageQualityOptions: [
          { value: 'low', label: loc('DICETOWER.Settings.imageQuality.Low', 'Low') },
          { value: 'medium', label: loc('DICETOWER.Settings.imageQuality.Medium', 'Medium') },
          { value: 'high', label: loc('DICETOWER.Settings.imageQuality.High', 'High') },
        ],
        shadowQualityOptions: [
          { value: 'low', label: loc('DICETOWER.Settings.shadowQuality.Low', 'Low') },
          { value: 'high', label: loc('DICETOWER.Settings.shadowQuality.High', 'High') },
        ],
        antialiasingOptions: [
          { value: 'none', label: 'None' },
          { value: 'smaa', label: 'SMAA' },
          { value: 'msaa', label: 'MSAA' },
        ],
        soundsSurfaceOptions: [
          { value: 'felt', label: 'Felt' },
          { value: 'metal', label: 'Metal' },
          { value: 'wood_table', label: 'Wood Table' },
          { value: 'wood_tray', label: 'Wood Tray' },
        ],
        canvasZIndexOptions: [
          { value: 'over', label: 'Over' },
          { value: 'under', label: 'Under' },
        ],
        throwingForceOptions: [
          { value: 'weak', label: 'Weak' },
          { value: 'medium', label: 'Medium' },
          { value: 'strong', label: 'Strong' },
        ],
        worldSpeedOptions: [
          { value: '0', label: 'Player Speed' },
          { value: '1', label: 'Normal' },
          { value: '2', label: 'Fast' },
          { value: '3', label: 'Very Fast' },
        ],
        ghostModeOptions: [
          { value: '0', label: 'Disabled' },
          { value: '1', label: 'Enabled' },
          { value: '2', label: 'Owner Only' },
        ],
        onpreview: (_formula: string, _appearance: DiceAppearance) => {
          // TODO: Wire up preview roll
        },
        onsave: async (data: {
          clientSettings: Partial<ClientSettings>;
          worldSettings: Partial<WorldSettings>;
          appearance: Record<string, unknown>;
          sfxRows: SFXLine[];
        }) => {
          const cs = data.clientSettings;
          for (const [key, value] of Object.entries(cs)) {
            await game.settings.set(MODULE_ID, key, value);
          }

          if (game.user.isGM) {
            const ws = data.worldSettings;
            for (const [key, value] of Object.entries(ws)) {
              await game.settings.set(MODULE_ID, key, value);
            }
          }

          await setUserAppearanceFlags(data.appearance as never);
          await setUserSfxFlags(data.sfxRows);

          const runtimeRefresh = game.dice3d as unknown as { refreshFromSettings?: () => Promise<void> } | undefined;
          if (runtimeRefresh?.refreshFromSettings) {
            await runtimeRefresh.refreshFromSettings();
          }

          notify('info', loc('DICETOWER.Notifications.ConfigSaved', 'Dice Tower configuration saved.'));
        },
      },
    });
  }

  override async close(options?: Record<string, unknown>): Promise<void> {
    if (this.#component) {
      unmount(this.#component);
      this.#component = null;
    }
    return super.close(options);
  }

  protected override async _updateObject(): Promise<void> {
    // No-op — Svelte handles saves internally via the onsave callback.
  }
}
