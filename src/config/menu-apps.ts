import { CORE_COLORSETS, TEXTURE_LIST } from '../dice/index.js';
import type { AppearanceMap, DiceAppearance } from '../types/appearance.js';
import type { SFXLine } from '../types/dice.js';
import type { RollableArea } from '../types/rendering.js';
import type { ClientSettings, WorldSettings } from '../types/settings.js';
import { MODULE_ID, SETTING_KEYS } from './constants.js';
import {
  getClientSettingsSnapshot,
  getWorldSettingsSnapshot,
  sanitizeRollableArea,
} from './register-settings.js';
import {
  getUserAppearanceFlags,
  getUserSfxFlags,
  setUserAppearanceFlags,
  setUserSfxFlags,
} from './user-flags.js';

interface FormDataObject {
  [key: string]: unknown;
}

interface SelectOption {
  value: string;
  label: string;
}

interface PreviewRollLike {
  dice: DiceTerm[];
  evaluate?(options?: Record<string, unknown>): Roll | Promise<Roll>;
}

interface RuntimeDice3DLike {
  refreshFromSettings?(): Promise<void>;
  showForRoll(
    roll: Roll,
    user?: User,
    synchronize?: boolean,
    users?: string[] | null,
    blind?: boolean,
    messageID?: string | null,
    speaker?: Record<string, unknown> | null,
    options?: { ghost?: boolean; secret?: boolean },
  ): Promise<boolean>;
  getSFXModes?(): Record<string, string>;
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

function defaultAppearanceForUser(user: User = game.user): DiceAppearance {
  const color = user.color?.toString?.();
  const userColor = typeof color === 'string' && color.length > 0 ? color : DEFAULT_APPEARANCE.diceColor;

  return {
    ...DEFAULT_APPEARANCE,
    diceColor: userColor,
    outlineColor: userColor,
    edgeColor: userColor,
  };
}

function localizeOrFallback(key: string, fallback: string): string {
  const localized = game.i18n.localize(key);
  return localized === key ? fallback : localized;
}

function parseBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') {
      return true;
    }
    if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') {
      return false;
    }
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  return fallback;
}

function parseString(value: unknown, fallback: string): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : fallback;
  }
  return fallback;
}

function parseChoice<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  if (typeof value === 'string' && allowed.includes(value as T)) {
    return value as T;
  }
  return fallback;
}

function parseNumber(value: unknown, fallback: number, min?: number, max?: number): number {
  const numeric = typeof value === 'number' ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  let normalized = numeric;
  if (typeof min === 'number') {
    normalized = Math.max(min, normalized);
  }
  if (typeof max === 'number') {
    normalized = Math.min(max, normalized);
  }
  return normalized;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return {};
  }
  return value as Record<string, unknown>;
}

function expandFormData(formData: FormDataObject): Record<string, unknown> {
  const source = toRecord(formData);

  const expanded: Record<string, unknown> = {};

  for (const [flatKey, value] of Object.entries(source)) {
    const parts = flatKey.split('.').filter((part) => part.length > 0);
    if (parts.length === 0) {
      continue;
    }

    let target: Record<string, unknown> = expanded;
    for (let index = 0; index < parts.length - 1; index += 1) {
      const part = parts[index];
      const next = target[part];
      if (!next || typeof next !== 'object') {
        target[part] = {};
      }
      target = target[part] as Record<string, unknown>;
    }

    target[parts[parts.length - 1]] = value;
  }

  return expanded;
}

function notify(level: 'info' | 'warn' | 'error', message: string): void {
  const runtimeUi = ui as unknown as {
    notifications?: {
      info?: (text: string) => void;
      warn?: (text: string) => void;
      error?: (text: string) => void;
    };
  };

  const handler = runtimeUi.notifications?.[level];
  if (typeof handler === 'function') {
    handler(message);
  }
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

function toSelectOptions(
  values: Record<string, string>,
  fallbackPrefix: string,
  sort = true,
): SelectOption[] {
  const entries = Object.entries(values).map(([value, label]) => ({
    value,
    label: localizeOrFallback(label, `${fallbackPrefix}.${value}`),
  }));

  if (sort) {
    entries.sort((a, b) => a.label.localeCompare(b.label));
  }

  return entries;
}

function normalizeAppearanceEntry(
  source: Record<string, unknown>,
  fallback: DiceAppearance,
): DiceAppearance {
  return {
    labelColor: parseString(source.labelColor, fallback.labelColor),
    diceColor: parseString(source.diceColor, fallback.diceColor),
    outlineColor: parseString(source.outlineColor, fallback.outlineColor),
    edgeColor: parseString(source.edgeColor, fallback.edgeColor),
    texture: parseString(source.texture, fallback.texture),
    material: parseChoice(source.material, MATERIAL_OPTIONS, fallback.material),
    font: parseString(source.font, fallback.font),
    colorset: parseString(source.colorset, fallback.colorset),
    system: parseString(source.system, fallback.system),
  };
}

function buildAppearanceMapFromExpanded(expanded: Record<string, unknown>): AppearanceMap {
  const appearanceRoot = toRecord(expanded.appearance);
  const globalAppearance = normalizeAppearanceEntry(toRecord(appearanceRoot.global), DEFAULT_APPEARANCE);

  const map: AppearanceMap = {
    global: globalAppearance,
  } as AppearanceMap;

  for (const dieType of DIE_TYPES) {
    const dieSource = toRecord(appearanceRoot[dieType]);
    const enabled = parseBoolean(dieSource.enabled, false);
    if (!enabled) {
      continue;
    }

    map[dieType] = normalizeAppearanceEntry(dieSource, globalAppearance);
  }

  return map;
}

function buildSfxListFromExpanded(expanded: Record<string, unknown>): SFXLine[] {
  const sfxRoot = toRecord(expanded.sfxRows);
  const rows = Object.entries(sfxRoot)
    .sort((a, b) => Number.parseInt(a[0], 10) - Number.parseInt(b[0], 10))
    .map(([, value]) => toRecord(value));

  const output: SFXLine[] = [];

  for (const row of rows) {
    const diceType = parseString(row.diceType, '');
    const specialEffect = parseString(row.specialEffect, '');
    const onResultRaw = parseString(row.onResult, '');
    const onResult = onResultRaw
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    if (!diceType || !specialEffect || onResult.length === 0) {
      continue;
    }

    const isGlobal = parseBoolean(row.isGlobal, false);
    output.push({
      diceType,
      onResult,
      specialEffect,
      options: isGlobal ? { isGlobal: true } : undefined,
    });
  }

  return output;
}

function resolveRootElement(html: unknown): HTMLElement | null {
  if (html instanceof HTMLElement) {
    return html;
  }

  if (Array.isArray(html) && html[0] instanceof HTMLElement) {
    return html[0];
  }

  const maybeArrayLike = html as { 0?: unknown } | null;
  if (maybeArrayLike?.[0] instanceof HTMLElement) {
    return maybeArrayLike[0];
  }

  return null;
}

function extractFormData(form: HTMLFormElement): FormDataObject {
  const data: FormDataObject = {};
  const formData = new FormData(form);

  for (const [key, value] of formData.entries()) {
    if (value instanceof File) {
      continue;
    }
    data[key] = value;
  }

  return data;
}

function resolveDieTypeFromTerm(term: DiceTerm): string {
  if (term.faces === 100) {
    return 'd100';
  }

  const denomination = typeof term.constructor?.DENOMINATION === 'string'
    ? term.constructor.DENOMINATION
    : 'd';

  if (denomination === 'd') {
    return `d${term.faces}`;
  }

  return `d${denomination}`;
}

function applyAppearanceToRoll(roll: Roll, appearance: AppearanceMap): void {
  for (const term of roll.dice) {
    const dieType = resolveDieTypeFromTerm(term);
    const selected = appearance[dieType] ?? appearance.global;

    if (!term.options || typeof term.options !== 'object') {
      term.options = {};
    }

    term.options.colorset = selected.colorset;
    term.options.texture = selected.texture;
    term.options.material = selected.material;
    term.options.system = selected.system;
  }
}

async function createRollFromFormula(formula: string): Promise<Roll | null> {
  const runtime = globalThis as typeof globalThis & {
    Roll?: new (formulaText: string) => PreviewRollLike;
  };

  if (typeof runtime.Roll !== 'function') {
    return null;
  }

  const rollLike = new runtime.Roll(formula);
  if (typeof rollLike.evaluate !== 'function') {
    return rollLike as unknown as Roll;
  }

  const evaluated = await Promise.resolve(rollLike.evaluate({ async: true }));
  return evaluated;
}

async function refreshRuntimeFromSettings(): Promise<void> {
  const runtime = game.dice3d as unknown as RuntimeDice3DLike | undefined;
  if (!runtime || typeof runtime.refreshFromSettings !== 'function') {
    return;
  }

  await runtime.refreshFromSettings();
}

export class DiceConfigMenuApp extends FormApplication<FormDataObject> {
  static override get defaultOptions(): ApplicationOptions {
    return mergeApplicationOptions(super.defaultOptions, {
      id: `${MODULE_ID}-config`,
      title: 'DICETOWER.Menu.DiceConfig.Title',
      template: 'modules/dice-tower/assets/templates/dice-config.hbs',
      width: 980,
      height: 'auto',
      closeOnSubmit: false,
      submitOnChange: false,
      submitOnClose: false,
      classes: ['dice-tower-config-app'],
    });
  }

  override getData(): Record<string, unknown> {
    const clientSettings = getClientSettingsSnapshot();
    const worldSettings = getWorldSettingsSnapshot();
    const appearanceFlags = getUserAppearanceFlags();
    const appearanceFallback = defaultAppearanceForUser();
    const globalAppearance = normalizeAppearanceEntry(
      toRecord(appearanceFlags.global),
      appearanceFallback,
    );

    const appearanceScopes = DIE_TYPES.map((dieType) => {
      const override = appearanceFlags[dieType];
      const normalized = normalizeAppearanceEntry(toRecord(override), globalAppearance);
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
    sfxRows.push({
      index: sfxRows.length,
      diceType: '',
      onResult: '',
      specialEffect: '',
      isGlobal: false,
    });

    const runtime = game.dice3d as unknown as RuntimeDice3DLike | undefined;
    const sfxModes = runtime?.getSFXModes?.() ?? {};

    return {
      isGM: game.user.isGM,
      clientSettings,
      worldSettings,
      globalAppearance,
      appearanceScopes,
      sfxRows,
      materials: MATERIAL_OPTIONS.map((value) => ({
        value,
        label: localizeOrFallback(`DICETOWER.Material.${value}`, value),
      })),
      colorsets: toSelectOptions(
        Object.fromEntries(Object.keys(CORE_COLORSETS).map((name) => [name, name])),
        'Colorset',
      ),
      textures: toSelectOptions(
        Object.fromEntries(Object.keys(TEXTURE_LIST).map((name) => [name, name])),
        'Texture',
      ),
      hideFxOptions: [
        {
          value: 'fadeOut',
          label: localizeOrFallback('DICETOWER.Settings.hideFX.FadeOut', 'Fade Out'),
        },
        {
          value: 'none',
          label: localizeOrFallback('DICETOWER.Settings.hideFX.None', 'None'),
        },
      ],
      imageQualityOptions: [
        {
          value: 'low',
          label: localizeOrFallback('DICETOWER.Settings.imageQuality.Low', 'Low'),
        },
        {
          value: 'medium',
          label: localizeOrFallback('DICETOWER.Settings.imageQuality.Medium', 'Medium'),
        },
        {
          value: 'high',
          label: localizeOrFallback('DICETOWER.Settings.imageQuality.High', 'High'),
        },
      ],
      shadowQualityOptions: [
        {
          value: 'low',
          label: localizeOrFallback('DICETOWER.Settings.shadowQuality.Low', 'Low'),
        },
        {
          value: 'high',
          label: localizeOrFallback('DICETOWER.Settings.shadowQuality.High', 'High'),
        },
      ],
      antialiasingOptions: [
        {
          value: 'none',
          label: localizeOrFallback('DICETOWER.Settings.antialiasing.None', 'None'),
        },
        {
          value: 'smaa',
          label: localizeOrFallback('DICETOWER.Settings.antialiasing.SMAA', 'SMAA'),
        },
        {
          value: 'msaa',
          label: localizeOrFallback('DICETOWER.Settings.antialiasing.MSAA', 'MSAA'),
        },
      ],
      soundsSurfaceOptions: [
        {
          value: 'felt',
          label: localizeOrFallback('DICETOWER.Settings.soundsSurface.Felt', 'Felt'),
        },
        {
          value: 'metal',
          label: localizeOrFallback('DICETOWER.Settings.soundsSurface.Metal', 'Metal'),
        },
        {
          value: 'wood_table',
          label: localizeOrFallback('DICETOWER.Settings.soundsSurface.WoodTable', 'Wood Table'),
        },
        {
          value: 'wood_tray',
          label: localizeOrFallback('DICETOWER.Settings.soundsSurface.WoodTray', 'Wood Tray'),
        },
      ],
      canvasZIndexOptions: [
        {
          value: 'over',
          label: localizeOrFallback('DICETOWER.Settings.canvasZIndex.Over', 'Over'),
        },
        {
          value: 'under',
          label: localizeOrFallback('DICETOWER.Settings.canvasZIndex.Under', 'Under'),
        },
      ],
      throwingForceOptions: [
        {
          value: 'weak',
          label: localizeOrFallback('DICETOWER.Settings.throwingForce.Weak', 'Weak'),
        },
        {
          value: 'medium',
          label: localizeOrFallback('DICETOWER.Settings.throwingForce.Medium', 'Medium'),
        },
        {
          value: 'strong',
          label: localizeOrFallback('DICETOWER.Settings.throwingForce.Strong', 'Strong'),
        },
      ],
      worldSpeedOptions: [
        {
          value: '0',
          label: localizeOrFallback('DICETOWER.Settings.globalAnimationSpeed.Player', 'Player Speed'),
        },
        {
          value: '1',
          label: localizeOrFallback('DICETOWER.Settings.globalAnimationSpeed.Normal', 'Normal'),
        },
        {
          value: '2',
          label: localizeOrFallback('DICETOWER.Settings.globalAnimationSpeed.Fast', 'Fast'),
        },
        {
          value: '3',
          label: localizeOrFallback('DICETOWER.Settings.globalAnimationSpeed.VeryFast', 'Very Fast'),
        },
      ],
      ghostModeOptions: [
        {
          value: '0',
          label: localizeOrFallback('DICETOWER.Settings.showGhostDice.Disabled', 'Disabled'),
        },
        {
          value: '1',
          label: localizeOrFallback('DICETOWER.Settings.showGhostDice.Enabled', 'Enabled'),
        },
        {
          value: '2',
          label: localizeOrFallback('DICETOWER.Settings.showGhostDice.OwnerOnly', 'Owner Only'),
        },
      ],
      sfxModeOptions: Object.entries(sfxModes).map(([value, label]) => ({ value, label })),
      previewFormula: '1d20',
    };
  }

  activateListeners(html: unknown): void {
    const root = resolveRootElement(html);
    if (!root) {
      return;
    }

    const previewButton = root.querySelector<HTMLElement>('[data-action="preview"]');
    previewButton?.addEventListener('click', (event) => {
      event.preventDefault();
      void this.previewFromForm(root);
    });

  }

  private async previewFromForm(root: HTMLElement): Promise<void> {
    const runtime = game.dice3d as unknown as RuntimeDice3DLike | undefined;
    if (!runtime || typeof runtime.showForRoll !== 'function') {
      notify(
        'warn',
        localizeOrFallback(
          'DICETOWER.Notifications.RuntimeNotReady',
          'Dice Tower runtime is not ready yet.',
        ),
      );
      return;
    }

    const form = root.querySelector('form');
    if (!(form instanceof HTMLFormElement)) {
      return;
    }

    const expanded = expandFormData(extractFormData(form));
    const preview = toRecord(expanded.preview);
    const formula = parseString(preview.formula, '1d20');

    try {
      const roll = await createRollFromFormula(formula);
      if (!roll || !Array.isArray(roll.dice) || roll.dice.length === 0) {
        notify(
          'warn',
          localizeOrFallback(
            'DICETOWER.Notifications.PreviewNoDice',
            'Preview formula did not produce any dice terms.',
          ),
        );
        return;
      }

      const appearance = buildAppearanceMapFromExpanded(expanded);
      applyAppearanceToRoll(roll, appearance);

      await runtime.showForRoll(roll, game.user, false, null, false, null, null, {
        ghost: false,
        secret: false,
      });
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to preview roll.`, error);
      notify(
        'error',
        localizeOrFallback(
          'DICETOWER.Notifications.PreviewFailed',
          'Failed to preview roll. Check the formula and console for details.',
        ),
      );
    }
  }

  protected override async _updateObject(_event: Event, formData: FormDataObject): Promise<void> {
    void _event;

    const expanded = expandFormData(formData);
    const settingsRoot = toRecord(expanded.settings);
    const clientInput = toRecord(settingsRoot.client);
    const worldInput = toRecord(settingsRoot.world);

    const currentClient = getClientSettingsSnapshot();
    const clientNext: ClientSettings = {
      ...currentClient,
      enabled: parseBoolean(clientInput.enabled, currentClient.enabled),
      showExtraDice: parseBoolean(clientInput.showExtraDice, currentClient.showExtraDice),
      onlyShowOwnDice: parseBoolean(clientInput.onlyShowOwnDice, currentClient.onlyShowOwnDice),
      hideAfterRoll: parseBoolean(clientInput.hideAfterRoll, currentClient.hideAfterRoll),
      timeBeforeHide: parseNumber(clientInput.timeBeforeHide, currentClient.timeBeforeHide, 0, 20000),
      hideFX: parseChoice(clientInput.hideFX, ['fadeOut', 'none'] as const, currentClient.hideFX),
      autoscale: parseBoolean(clientInput.autoscale, currentClient.autoscale),
      scale: parseNumber(clientInput.scale, currentClient.scale, 10, 200),
      speed: parseNumber(clientInput.speed, currentClient.speed, 0.5, 3),
      imageQuality: parseChoice(clientInput.imageQuality, ['low', 'medium', 'high'] as const, currentClient.imageQuality),
      shadowQuality: parseChoice(clientInput.shadowQuality, ['low', 'high'] as const, currentClient.shadowQuality),
      bumpMapping: parseBoolean(clientInput.bumpMapping, currentClient.bumpMapping),
      sounds: parseBoolean(clientInput.sounds, currentClient.sounds),
      soundsSurface: parseChoice(
        clientInput.soundsSurface,
        ['felt', 'metal', 'wood_table', 'wood_tray'] as const,
        currentClient.soundsSurface,
      ),
      soundsVolume: parseNumber(clientInput.soundsVolume, currentClient.soundsVolume, 0, 1),
      canvasZIndex: parseChoice(clientInput.canvasZIndex, ['over', 'under'] as const, currentClient.canvasZIndex),
      throwingForce: parseChoice(clientInput.throwingForce, ['weak', 'medium', 'strong'] as const, currentClient.throwingForce),
      useHighDPI: parseBoolean(clientInput.useHighDPI, currentClient.useHighDPI),
      antialiasing: parseChoice(clientInput.antialiasing, ['none', 'smaa', 'msaa'] as const, currentClient.antialiasing),
      glow: parseBoolean(clientInput.glow, currentClient.glow),
      showOthersSFX: parseBoolean(clientInput.showOthersSFX, currentClient.showOthersSFX),
      immersiveDarkness: parseBoolean(clientInput.immersiveDarkness, currentClient.immersiveDarkness),
      muteSoundSecretRolls: parseBoolean(clientInput.muteSoundSecretRolls, currentClient.muteSoundSecretRolls),
      enableFlavorColorset: parseBoolean(clientInput.enableFlavorColorset, currentClient.enableFlavorColorset),
      rollingArea: currentClient.rollingArea,
    };

    for (const key of Object.keys(clientNext) as Array<keyof ClientSettings>) {
      await game.settings.set(MODULE_ID, key, clientNext[key]);
    }

    if (game.user.isGM) {
      const currentWorld = getWorldSettingsSnapshot();
      const worldNext: WorldSettings = {
        ...currentWorld,
        maxDiceNumber: parseNumber(worldInput.maxDiceNumber, currentWorld.maxDiceNumber, 1, 1000),
        globalAnimationSpeed: parseChoice(worldInput.globalAnimationSpeed, ['0', '1', '2', '3'] as const, currentWorld.globalAnimationSpeed),
        disabledDuringCombat: parseBoolean(worldInput.disabledDuringCombat, currentWorld.disabledDuringCombat),
        disabledForInitiative: parseBoolean(worldInput.disabledForInitiative, currentWorld.disabledForInitiative),
        hide3dDiceOnSecretRolls: parseBoolean(worldInput.hide3dDiceOnSecretRolls, currentWorld.hide3dDiceOnSecretRolls),
        showGhostDice: parseChoice(worldInput.showGhostDice, ['0', '1', '2'] as const, currentWorld.showGhostDice),
        hideNpcRolls: parseBoolean(worldInput.hideNpcRolls, currentWorld.hideNpcRolls),
        animateRollTable: parseBoolean(worldInput.animateRollTable, currentWorld.animateRollTable),
        animateInlineRoll: parseBoolean(worldInput.animateInlineRoll, currentWorld.animateInlineRoll),
        enabledSimultaneousRolls: parseBoolean(worldInput.enabledSimultaneousRolls, currentWorld.enabledSimultaneousRolls),
        enabledSimultaneousRollForMessage: parseBoolean(
          worldInput.enabledSimultaneousRollForMessage,
          currentWorld.enabledSimultaneousRollForMessage,
        ),
      };

      for (const key of Object.keys(worldNext) as Array<keyof WorldSettings>) {
        await game.settings.set(MODULE_ID, key, worldNext[key]);
      }
    }

    await setUserAppearanceFlags(buildAppearanceMapFromExpanded(expanded));
    await setUserSfxFlags(buildSfxListFromExpanded(expanded));

    await refreshRuntimeFromSettings();
    notify(
      'info',
      localizeOrFallback('DICETOWER.Notifications.ConfigSaved', 'Dice Tower configuration saved.'),
    );
  }
}

export class RollableAreaConfigMenuApp extends FormApplication<FormDataObject> {
  static override get defaultOptions(): ApplicationOptions {
    return mergeApplicationOptions(super.defaultOptions, {
      id: `${MODULE_ID}-rollable-area-config`,
      title: 'DICETOWER.Menu.RollableAreaConfig.Title',
      template: 'modules/dice-tower/assets/templates/rollable-area-config.hbs',
      width: 520,
      height: 'auto',
      closeOnSubmit: false,
      submitOnChange: false,
      submitOnClose: false,
      classes: ['dice-tower-rollable-area-app'],
    });
  }

  override getData(): Record<string, unknown> {
    const settings = getClientSettingsSnapshot();
    const currentArea = sanitizeRollableArea(settings.rollingArea);

    const fallbackArea: RollableArea = {
      left: 0,
      top: 0,
      width: Math.max(1, Math.floor(window.innerWidth || 1)),
      height: Math.max(1, Math.floor(window.innerHeight || 1)),
    };

    const area = currentArea || fallbackArea;

    return {
      enabled: Boolean(currentArea),
      area,
    };
  }

  activateListeners(html: unknown): void {
    const root = resolveRootElement(html);
    if (!root) {
      return;
    }

    const resetButton = root.querySelector<HTMLElement>('[data-action="reset"]');
    resetButton?.addEventListener('click', (event) => {
      event.preventDefault();
      const form = root.querySelector('form');
      if (!(form instanceof HTMLFormElement)) {
        return;
      }

      const enabled = form.querySelector<HTMLInputElement>('input[name="area.enabled"]');
      const left = form.querySelector<HTMLInputElement>('input[name="area.left"]');
      const top = form.querySelector<HTMLInputElement>('input[name="area.top"]');
      const width = form.querySelector<HTMLInputElement>('input[name="area.width"]');
      const height = form.querySelector<HTMLInputElement>('input[name="area.height"]');

      if (enabled) enabled.checked = false;
      if (left) left.value = '0';
      if (top) top.value = '0';
      if (width) width.value = String(Math.max(1, Math.floor(window.innerWidth || 1)));
      if (height) height.value = String(Math.max(1, Math.floor(window.innerHeight || 1)));
    });
  }

  protected override async _updateObject(_event: Event, formData: FormDataObject): Promise<void> {
    void _event;

    const expanded = expandFormData(formData);
    const areaRoot = toRecord(expanded.area);
    const enabled = parseBoolean(areaRoot.enabled, false);

    if (!enabled) {
      await game.settings.set(MODULE_ID, SETTING_KEYS.client.rollingArea, false);
      await refreshRuntimeFromSettings();
      notify(
        'info',
        localizeOrFallback('DICETOWER.Notifications.RollingAreaCleared', 'Custom rolling area cleared.'),
      );
      return;
    }

    const viewportWidth = Math.max(1, Math.floor(window.innerWidth || 1));
    const viewportHeight = Math.max(1, Math.floor(window.innerHeight || 1));

    const left = parseNumber(areaRoot.left, 0, 0, viewportWidth - 1);
    const top = parseNumber(areaRoot.top, 0, 0, viewportHeight - 1);
    const width = parseNumber(areaRoot.width, viewportWidth, 1, viewportWidth - left);
    const height = parseNumber(areaRoot.height, viewportHeight, 1, viewportHeight - top);

    const rollingArea: RollableArea = {
      left,
      top,
      width,
      height,
    };

    await game.settings.set(MODULE_ID, SETTING_KEYS.client.rollingArea, rollingArea);
    await refreshRuntimeFromSettings();
    notify(
      'info',
      localizeOrFallback('DICETOWER.Notifications.RollingAreaUpdated', 'Rollable area updated.'),
    );
  }
}
