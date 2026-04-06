import { mergeQueuedRollCommands, parseRollToNotation, DiceFactory } from '../dice/index.js';
import { DiceBox, type DiceBoxConfig } from '../rendering/index.js';
import type { Colorset, TextureDefinition } from '../types/appearance.js';
import type { DicePresetData } from '../types/dice.js';
import type { ClientSettings, WorldSettings } from '../types/settings.js';
import {
  emitDiceRollComplete,
  emitDiceRollStart,
} from '../config/hook-bridge.js';
import {
  getClientSettingsSnapshot,
  getWorldSettingsSnapshot,
  setClientSettingsPatch,
} from '../config/register-settings.js';
import {
  applyUserSaveProfile,
  getMergedSfxListForUser,
  getUserAppearanceFlags,
} from '../config/user-flags.js';
import { MODULE_ID } from '../config/constants.js';
import type { IDice3D, IDiceBox, IDiceFactory, IDiceSFXClass, IDiceSystem } from './dice3d.js';

const OVERLAY_ID = `${MODULE_ID}-overlay`;

function ensureOverlayHost(): HTMLElement {
  const existing = document.getElementById(OVERLAY_ID);
  if (existing) {
    return existing;
  }

  const host = document.createElement('div');
  host.id = OVERLAY_ID;
  host.style.position = 'fixed';
  host.style.top = '0';
  host.style.left = '0';
  host.style.width = '100vw';
  host.style.height = '100vh';
  host.style.pointerEvents = 'none';
  host.style.zIndex = '0';
  document.body.appendChild(host);
  return host;
}

export class Dice3DRuntime implements IDice3D {
  readonly DiceFactory: IDiceFactory;
  readonly box: IDiceBox;
  readonly exports: Record<string, unknown>;
  canInteract = true;

  private readonly diceFactoryRuntime: DiceFactory;
  private readonly boxRuntime: DiceBox;
  private readonly hostElement: HTMLElement;
  private resizeListener: (() => void) | null = null;
  private clientSettings: ClientSettings;
  private worldSettings: WorldSettings;

  private constructor(
    diceFactory: DiceFactory,
    box: DiceBox,
    hostElement: HTMLElement,
    clientSettings: ClientSettings,
    worldSettings: WorldSettings,
  ) {
    this.diceFactoryRuntime = diceFactory;
    this.DiceFactory = diceFactory;
    this.boxRuntime = box;
    this.box = box;
    this.hostElement = hostElement;
    this.clientSettings = clientSettings;
    this.worldSettings = worldSettings;

    this.exports = {
      parseRollToNotation,
      mergeQueuedRollCommands,
    };
  }

  static async create(): Promise<Dice3DRuntime> {
    const clientSettings = getClientSettingsSnapshot();
    const worldSettings = getWorldSettingsSnapshot();

    const host = ensureOverlayHost();

    const boxConfig: DiceBoxConfig = {
      autoscale: clientSettings.autoscale,
      scale: clientSettings.scale,
      canvasZIndex: clientSettings.canvasZIndex,
      immersiveDarkness: clientSettings.immersiveDarkness,
      boxType: 'board',
      imageQuality: clientSettings.imageQuality,
      shadowQuality: clientSettings.shadowQuality,
      bumpMapping: clientSettings.bumpMapping,
      glow: clientSettings.glow,
      antialiasing: clientSettings.antialiasing,
      useHighDPI: clientSettings.useHighDPI,
      timeBeforeHide: clientSettings.timeBeforeHide,
    };

    const box = await DiceBox.create(host, boxConfig);

    const scale = clientSettings.autoscale ? 1 : Math.max(0.1, clientSettings.scale / 100);
    const diceFactory = new DiceFactory({
      baseScale: scale,
      preferredColorset: 'custom',
      preferredSystem: 'standard',
    });

    const runtime = new Dice3DRuntime(diceFactory, box, host, clientSettings, worldSettings);
    await runtime.applyRuntimeSettings();
    runtime.attachResizeListener();

    return runtime;
  }

  isEnabled(): boolean {
    return this.clientSettings.enabled;
  }

  async showForRoll(
    roll: Roll,
    user?: User,
    synchronize?: boolean,
    users?: string[] | null,
    blind?: boolean,
    messageID?: string | null,
    speaker?: Record<string, unknown> | null,
    options?: { ghost?: boolean; secret?: boolean },
  ): Promise<boolean> {
    void synchronize;
    void users;
    void speaker;

    await this.refreshSettings();

    const rollUser = user ?? game.user;

    if (!this.isEnabled()) {
      return false;
    }

    if (this.clientSettings.onlyShowOwnDice && rollUser.id !== game.user.id) {
      return false;
    }

    const secretRoll = blind === true || options?.secret === true || roll.secret === true;
    const shouldGhost =
      secretRoll &&
      this.worldSettings.hide3dDiceOnSecretRolls &&
      this.worldSettings.showGhostDice !== '0';

    if (secretRoll && this.worldSettings.hide3dDiceOnSecretRolls && this.worldSettings.showGhostDice === '0') {
      return false;
    }

    if (
      secretRoll &&
      this.worldSettings.hide3dDiceOnSecretRolls &&
      this.worldSettings.showGhostDice === '2' &&
      rollUser.id !== game.user.id &&
      !game.user.isGM
    ) {
      return false;
    }

    const notation = parseRollToNotation(roll, {
      maxDiceNumber: this.worldSettings.maxDiceNumber,
      enableFlavorColorset: this.clientSettings.enableFlavorColorset,
      user: rollUser,
      appearance: getUserAppearanceFlags(rollUser),
      specialEffects: getMergedSfxListForUser(rollUser),
    });

    if (notation.throws.every((throwGroup) => throwGroup.dice.length === 0)) {
      return false;
    }

    for (const throwGroup of notation.throws) {
      for (const die of throwGroup.dice) {
        if (options?.ghost === true || shouldGhost) {
          die.options.ghost = true;
          delete die.options.secret;
        } else if (secretRoll) {
          die.options.secret = true;
        }
      }
    }

    const resolvedMessageId = messageID ?? `dice-tower-${Date.now().toString(36)}`;
    const allowed = emitDiceRollStart(resolvedMessageId, {
      roll,
      user: rollUser,
      blind: secretRoll,
    });

    if (!allowed) {
      return false;
    }

    this.refreshCanInteract();
    const rendered = await this.boxRuntime.add(notation);
    this.refreshCanInteract();

    if (rendered) {
      emitDiceRollComplete(resolvedMessageId);
    }

    return rendered;
  }

  renderRolls(chatMessage: ChatMessage, rolls: Roll[]): void {
    void this.renderRollsInternal(chatMessage, rolls);
  }

  private async renderRollsInternal(chatMessage: ChatMessage, rolls: Roll[]): Promise<void> {
    if (rolls.length === 0) {
      return;
    }

    chatMessage._dice3danimating = true;

    try {
      for (const roll of rolls) {
        await this.showForRoll(
          roll,
          chatMessage.user,
          false,
          chatMessage.whisper,
          chatMessage.blind,
          chatMessage.id,
          { ...chatMessage.speaker },
          {
            secret: chatMessage.blind,
          },
        );
      }
    } finally {
      chatMessage._dice3danimating = false;
      this.refreshCanInteract();
    }
  }

  addSystem(system: IDiceSystem | { id: string; name: string; group?: string }, mode?: string): void {
    this.diceFactoryRuntime.addSystem(system, mode);
  }

  addDicePreset(dice: DicePresetData, shape?: string | null): void {
    this.diceFactoryRuntime.addDicePreset(dice, shape ?? null);
  }

  addColorset(colorset: Partial<Colorset> & { name: string }, mode?: string): Promise<void> {
    this.diceFactoryRuntime.addColorset(colorset, mode);
    return Promise.resolve();
  }

  addTexture(textureID: string, textureData: TextureDefinition): Promise<void> {
    this.diceFactoryRuntime.addTexture(textureID, textureData);
    return Promise.resolve();
  }

  addSFXTrigger(id: string, name: string, results: string[]): void {
    this.boxRuntime.addSFXTrigger(id, name, results);
  }

  addSFXMode(sfxClass: IDiceSFXClass): void {
    this.boxRuntime.addSFXMode(sfxClass);
  }

  getSFXModes(): Record<string, string> {
    return this.boxRuntime.getSFXModes();
  }

  async loadSaveFile(name: string): Promise<void> {
    const profile = await applyUserSaveProfile(name);
    if (!profile) {
      return;
    }

    if (profile.settings) {
      await setClientSettingsPatch(profile.settings);
    }

    if (profile.appearance?.global) {
      const globalAppearance = profile.appearance.global;
      if (typeof globalAppearance.colorset === 'string') {
        this.diceFactoryRuntime.preferredColorset = globalAppearance.colorset;
      }
      if (typeof globalAppearance.system === 'string') {
        this.diceFactoryRuntime.preferredSystem = globalAppearance.system;
      }
    }

    await this.refreshSettings();
  }

  getLoadedDiceSystems(): Map<string, IDiceSystem> {
    return this.diceFactoryRuntime.systems;
  }

  dispose(): void {
    this.resizeListener?.();
    this.resizeListener = null;
    this.boxRuntime.dispose();
    this.hostElement.remove();
  }

  private async refreshSettings(): Promise<void> {
    this.clientSettings = getClientSettingsSnapshot();
    this.worldSettings = getWorldSettingsSnapshot();

    await this.boxRuntime.update({
      autoscale: this.clientSettings.autoscale,
      scale: this.clientSettings.scale,
      canvasZIndex: this.clientSettings.canvasZIndex,
      immersiveDarkness: this.clientSettings.immersiveDarkness,
      imageQuality: this.clientSettings.imageQuality,
      shadowQuality: this.clientSettings.shadowQuality,
      bumpMapping: this.clientSettings.bumpMapping,
      glow: this.clientSettings.glow,
      antialiasing: this.clientSettings.antialiasing,
      useHighDPI: this.clientSettings.useHighDPI,
      timeBeforeHide: this.clientSettings.timeBeforeHide,
    });

    await this.applyRuntimeSettings();
    this.refreshCanInteract();
  }

  private async applyRuntimeSettings(): Promise<void> {
    await this.boxRuntime.configureRuntime({
      diceFactory: this.diceFactoryRuntime,
      throwingForce: this.clientSettings.throwingForce,
      speed: this.resolveAnimationSpeed(),
      hideAfterRoll: this.clientSettings.hideAfterRoll,
      allowInteractivity: true,
      maxDiceNumber: this.worldSettings.maxDiceNumber,
      sounds: this.clientSettings.sounds,
      soundsSurface: this.clientSettings.soundsSurface,
      soundsVolume: this.clientSettings.soundsVolume,
      muteSoundSecretRolls: this.clientSettings.muteSoundSecretRolls,
    });
  }

  private resolveAnimationSpeed(): number {
    const worldOverride = this.worldSettings.globalAnimationSpeed;
    if (worldOverride === '1' || worldOverride === '2' || worldOverride === '3') {
      return Number.parseFloat(worldOverride);
    }

    return this.clientSettings.speed;
  }

  private attachResizeListener(): void {
    const onResize = () => {
      this.boxRuntime.resize(window.innerWidth, window.innerHeight);
    };

    window.addEventListener('resize', onResize);
    this.resizeListener = () => {
      window.removeEventListener('resize', onResize);
    };
  }

  private refreshCanInteract(): void {
    this.canInteract = this.isEnabled() && !this.boxRuntime.running;
  }
}
