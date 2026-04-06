import { mergeQueuedRollCommands, parseRollToNotation, DiceFactory } from '../dice/index.js';
import { DiceBox, type DiceBoxConfig } from '../rendering/index.js';
import type { Colorset, TextureDefinition } from '../types/appearance.js';
import type { DiceNotationData, DicePresetData } from '../types/dice.js';
import type { RollableArea } from '../types/rendering.js';
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
const SIMULTANEOUS_ROLL_MERGE_WINDOW_MS = 80;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function resolveDimensionsFromRollingArea(
  rollingArea: RollableArea | false,
): DiceBoxConfig['dimensions'] | undefined {
  if (!rollingArea) {
    return undefined;
  }

  const viewportWidth = Math.max(1, Math.floor(window.innerWidth || 1));
  const viewportHeight = Math.max(1, Math.floor(window.innerHeight || 1));

  const left = clamp(Math.floor(rollingArea.left), 0, viewportWidth - 1);
  const top = clamp(Math.floor(rollingArea.top), 0, viewportHeight - 1);
  const width = clamp(Math.floor(rollingArea.width), 1, viewportWidth - left);
  const height = clamp(Math.floor(rollingArea.height), 1, viewportHeight - top);

  const right = Math.max(0, viewportWidth - left - width);
  const bottom = Math.max(0, viewportHeight - top - height);

  return {
    width: viewportWidth,
    height: viewportHeight,
    margin: {
      top,
      left,
      right,
      bottom,
    },
  };
}

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

function resolveSpeakerActor(speaker?: Record<string, unknown> | null): { hasPlayerOwner: boolean } | null {
  if (!speaker || typeof speaker !== 'object') {
    return null;
  }

  const actorId = speaker.actor;
  if (typeof actorId !== 'string' || actorId.length === 0) {
    return null;
  }

  const actorCollection = (game as unknown as { actors?: { get?: (id: string) => unknown } }).actors;
  if (!actorCollection || typeof actorCollection.get !== 'function') {
    return null;
  }

  const actor = actorCollection.get(actorId);
  if (!actor || typeof actor !== 'object') {
    return null;
  }

  return {
    hasPlayerOwner: (actor as { hasPlayerOwner?: unknown }).hasPlayerOwner === true,
  };
}

function isCombatActive(): boolean {
  const combat = (game as unknown as { combat?: { started?: unknown } | null }).combat;
  return combat?.started === true;
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
      dimensions: resolveDimensionsFromRollingArea(clientSettings.rollingArea),
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
    if (!this.clientSettings.enabled) {
      return false;
    }

    if (this.worldSettings.disabledDuringCombat && isCombatActive()) {
      return false;
    }

    return true;
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

    await this.refreshSettings();

    const rollUser = user ?? game.user;

    if (this.worldSettings.hideNpcRolls) {
      const actor = resolveSpeakerActor(speaker);
      if (actor && !actor.hasPlayerOwner) {
        return false;
      }
    }

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

    const notation = this.buildNotationForRoll(roll, rollUser, {
      secretRoll,
      forceGhost: options?.ghost === true || shouldGhost,
    });

    if (!notation) {
      return false;
    }

    const resolvedMessageId = messageID ?? `dice-tower-${Date.now().toString(36)}`;
    return this.playNotation(
      notation,
      resolvedMessageId,
      {
        roll,
        user: rollUser,
        blind: secretRoll,
      },
    );
  }

  renderRolls(chatMessage: ChatMessage, rolls: Roll[]): void {
    void this.renderRollsInternal(chatMessage, rolls);
  }

  private async renderRollsInternal(chatMessage: ChatMessage, rolls: Roll[]): Promise<void> {
    if (rolls.length === 0) {
      return;
    }

    await this.refreshSettings();

    chatMessage._dice3danimating = true;

    const rollUser = chatMessage.user ?? game.user;
    const secretRoll = chatMessage.blind === true;
    const messageId = chatMessage.id ?? `dice-tower-${Date.now().toString(36)}`;

    try {
      if (this.worldSettings.enabledSimultaneousRollForMessage) {
        const queue = rolls
          .map((roll) => {
            const notation = this.buildNotationForRoll(roll, rollUser, {
              secretRoll,
              forceGhost: false,
            });

            return notation ? { notation } : null;
          })
          .filter((entry): entry is { notation: DiceNotationData } => entry !== null);

        if (queue.length === 0) {
          return;
        }

        const merged = mergeQueuedRollCommands(queue);
        await this.playNotation(merged, messageId, {
          roll: rolls[0],
          user: rollUser,
          blind: secretRoll,
        });
        return;
      }

      for (const roll of rolls) {
        await this.showForRoll(
          roll,
          rollUser,
          false,
          chatMessage.whisper,
          chatMessage.blind,
          messageId,
          { ...chatMessage.speaker },
          {
            secret: secretRoll,
          },
        );
      }
    } finally {
      chatMessage._dice3danimating = false;
      this.refreshCanInteract();
    }
  }

  private buildNotationForRoll(
    roll: Roll,
    rollUser: User,
    options: { secretRoll: boolean; forceGhost: boolean },
  ): DiceNotationData | null {
    const notation = parseRollToNotation(roll, {
      maxDiceNumber: this.worldSettings.maxDiceNumber,
      enableFlavorColorset: this.clientSettings.enableFlavorColorset,
      user: rollUser,
      appearance: getUserAppearanceFlags(rollUser),
      specialEffects: getMergedSfxListForUser(rollUser, {
        viewer: game.user,
        includeOthers: this.clientSettings.showOthersSFX,
      }),
    });

    if (notation.throws.every((throwGroup) => throwGroup.dice.length === 0)) {
      return null;
    }

    for (const throwGroup of notation.throws) {
      for (const die of throwGroup.dice) {
        if (options.forceGhost) {
          die.options.ghost = true;
          delete die.options.secret;
        } else if (options.secretRoll) {
          die.options.secret = true;
        }
      }
    }

    return notation;
  }

  private async playNotation(
    notation: DiceNotationData,
    messageId: string,
    context: { roll: Roll; user: User; blind: boolean },
  ): Promise<boolean> {
    const allowed = emitDiceRollStart(messageId, context);
    if (!allowed) {
      return false;
    }

    this.refreshCanInteract();
    const rendered = await this.boxRuntime.add(notation);
    this.refreshCanInteract();

    if (rendered) {
      emitDiceRollComplete(messageId);
    }

    return rendered;
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

  async refreshFromSettings(): Promise<void> {
    await this.refreshSettings();
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
      dimensions: resolveDimensionsFromRollingArea(this.clientSettings.rollingArea),
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
      queueMergeWindowMs: this.worldSettings.enabledSimultaneousRolls
        ? SIMULTANEOUS_ROLL_MERGE_WINDOW_MS
        : 0,
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
