import {
  mergeQueuedRollCommands,
  parseRollToNotation,
  DiceFactory,
  CORE_COLORSETS,
  TEXTURE_LIST,
} from '../dice/index.js';
import { DiceBox, type DiceBoxConfig } from '../rendering/index.js';
import type { Colorset, TextureDefinition } from '../types/appearance.js';
import type { DiceNotationData, DicePresetData, SFXLine } from '../types/dice.js';
import type {
  CompressedThrowParams,
  ShowMessage,
  SocketMessage,
  SyncRollMessage,
  SyncThrowPayload,
} from '../types/network.js';
import type { DiceBodyDef, ThrowParams } from '../types/physics.js';
import type { RollableArea } from '../types/rendering.js';
import type { ClientSettings, WorldSettings } from '../types/settings.js';
import {
  emitDiceTowerSocketMessage,
  subscribeDiceTowerSocketMessages,
} from '../network/index.js';
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
const SYNC_ROLL_MIN_INTERVAL_MS = 30;

interface RollPlaybackOptions {
  broadcast: boolean;
  whisperTargets: string[] | null;
  blind: boolean;
  senderUser: User;
  throwParams?: ThrowParams;
}

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
  private socketUnsubscribe: (() => void) | null = null;
  private syncRollQueue: SyncRollMessage[] = [];
  private syncRollTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSyncRollEmitAt = 0;
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
    runtime.attachSocketListener();

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

  private attachSocketListener(): void {
    this.socketUnsubscribe?.();
    this.socketUnsubscribe = subscribeDiceTowerSocketMessages((message) => {
      void this.handleSocketMessage(message);
    });
  }

  private async handleSocketMessage(message: SocketMessage): Promise<void> {
    if (!message || message.user === game.user.id) {
      return;
    }

    if (message.type === 'update') {
      return;
    }

    await this.refreshSettings();
    if (!this.canRenderSocketRoll(message)) {
      return;
    }

    const sender = game.users.get(message.user) ?? game.user;
    const messageId = message.messageId ?? `dice-tower-${Date.now().toString(36)}`;

    await this.playNotation(
      message.notation,
      messageId,
      {
        roll: this.createSyntheticRoll(),
        user: sender,
        blind: message.blind,
      },
      {
        broadcast: false,
        whisperTargets: message.whisperTargets,
        blind: message.blind,
        senderUser: sender,
        throwParams: message.type === 'syncRoll'
          ? this.expandThrowParams(message.throwParams)
          : undefined,
      },
    );
  }

  private canRenderSocketRoll(message: ShowMessage | SyncRollMessage): boolean {
    if (!this.isEnabled()) {
      return false;
    }

    if (this.clientSettings.onlyShowOwnDice && message.user !== game.user.id) {
      return false;
    }

    if (message.blind && !game.user.isGM && message.user !== game.user.id) {
      return false;
    }

    if (Array.isArray(message.whisperTargets) && message.whisperTargets.length > 0) {
      const targetsLocalUser = message.whisperTargets.includes(game.user.id);
      if (!targetsLocalUser && !game.user.isGM && message.user !== game.user.id) {
        return false;
      }
    }

    return true;
  }

  private createSyntheticRoll(): Roll {
    return {
      dice: [],
      formula: '',
      total: undefined,
      options: {},
    } as Roll;
  }

  private normalizeWhisperTargets(targets?: string[] | null): string[] | null {
    if (!Array.isArray(targets)) {
      return null;
    }

    const normalized = targets.filter(
      (target): target is string => typeof target === 'string' && target.length > 0,
    );

    return normalized.length > 0 ? normalized : null;
  }

  private buildDsnConfig(user: User): {
    appearance: ReturnType<typeof getUserAppearanceFlags>;
    specialEffects: SFXLine[];
  } {
    return {
      appearance: getUserAppearanceFlags(user),
      specialEffects: getMergedSfxListForUser(user, {
        viewer: user,
        includeOthers: false,
      }),
    };
  }

  private roundToPrecision(value: number, precision = 3): number {
    const factor = 10 ** precision;
    return Math.round(value * factor) / factor;
  }

  private compressThrowParams(params: ThrowParams): SyncThrowPayload {
    let previousStart = 0;

    const compressed: CompressedThrowParams = {
      kind: 'compressed',
      seed: params.seed,
      config: params.config,
      bodies: params.bodies.map((body, index) => {
        const startAtIteration = body.startAtIteration ?? 0;
        const startDelta = index === 0
          ? startAtIteration
          : startAtIteration - previousStart;
        previousStart = startAtIteration;

        return {
          id: body.id,
          shape: body.shape,
          type: body.type,
          m: this.roundToPrecision(body.mass),
          i: this.roundToPrecision(body.inertia),
          p: [
            this.roundToPrecision(body.position.x),
            this.roundToPrecision(body.position.y),
            this.roundToPrecision(body.position.z),
          ],
          v: [
            this.roundToPrecision(body.velocity.x),
            this.roundToPrecision(body.velocity.y),
            this.roundToPrecision(body.velocity.z),
          ],
          a: [
            this.roundToPrecision(body.angularVelocity.x),
            this.roundToPrecision(body.angularVelocity.y),
            this.roundToPrecision(body.angularVelocity.z),
          ],
          r: [
            this.roundToPrecision(body.rotation.x),
            this.roundToPrecision(body.rotation.y),
            this.roundToPrecision(body.rotation.z),
            this.roundToPrecision(body.rotation.w),
          ],
          ...(startDelta !== 0 ? { s: startDelta } : {}),
          ...(body.secretRoll ? { h: 1 as const } : {}),
        };
      }),
    };

    return JSON.stringify(compressed).length < JSON.stringify(params).length
      ? compressed
      : params;
  }

  private isCompressedThrowParams(payload: SyncThrowPayload): payload is CompressedThrowParams {
    return (
      typeof payload === 'object'
      && payload !== null
      && 'kind' in payload
      && payload.kind === 'compressed'
    );
  }

  private expandThrowParams(payload: SyncThrowPayload): ThrowParams {
    if (!this.isCompressedThrowParams(payload)) {
      return payload;
    }

    let previousStart = 0;

    const bodies: DiceBodyDef[] = payload.bodies.map((body, index) => {
      const startAtIteration = index === 0
        ? (body.s ?? 0)
        : previousStart + (body.s ?? 0);
      previousStart = startAtIteration;

      return {
        id: body.id,
        shape: body.shape,
        type: body.type,
        mass: body.m,
        inertia: body.i,
        position: {
          x: body.p[0],
          y: body.p[1],
          z: body.p[2],
        },
        velocity: {
          x: body.v[0],
          y: body.v[1],
          z: body.v[2],
        },
        angularVelocity: {
          x: body.a[0],
          y: body.a[1],
          z: body.a[2],
        },
        rotation: {
          x: body.r[0],
          y: body.r[1],
          z: body.r[2],
          w: body.r[3],
        },
        ...(startAtIteration !== 0 ? { startAtIteration } : {}),
        ...(body.h === 1 ? { secretRoll: true } : {}),
      };
    });

    return {
      seed: payload.seed,
      config: payload.config,
      bodies,
    };
  }

  private enqueueSyncRollMessage(payload: SyncRollMessage): void {
    this.syncRollQueue.push(payload);
    this.flushSyncRollQueue();
  }

  private flushSyncRollQueue(): void {
    if (this.syncRollQueue.length === 0) {
      return;
    }

    const elapsed = Date.now() - this.lastSyncRollEmitAt;
    if (elapsed < SYNC_ROLL_MIN_INTERVAL_MS) {
      if (this.syncRollTimer !== null) {
        return;
      }

      this.syncRollTimer = setTimeout(() => {
        this.syncRollTimer = null;
        this.flushSyncRollQueue();
      }, SYNC_ROLL_MIN_INTERVAL_MS - elapsed);
      return;
    }

    const payload = this.syncRollQueue.shift();
    if (!payload) {
      return;
    }

    this.lastSyncRollEmitAt = Date.now();
    emitDiceTowerSocketMessage(payload);

    if (this.syncRollQueue.length > 0 && this.syncRollTimer === null) {
      this.syncRollTimer = setTimeout(() => {
        this.syncRollTimer = null;
        this.flushSyncRollQueue();
      }, SYNC_ROLL_MIN_INTERVAL_MS);
    }
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
    const shouldBroadcast = synchronize === true && rollUser.id === game.user.id;
    return this.playNotation(
      notation,
      resolvedMessageId,
      {
        roll,
        user: rollUser,
        blind: secretRoll,
      },
      {
        broadcast: shouldBroadcast,
        whisperTargets: this.normalizeWhisperTargets(users),
        blind: secretRoll,
        senderUser: rollUser,
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
    const deterministicSync = this.worldSettings.enableDeterministicSync;
    const shouldBroadcast = deterministicSync && rollUser.id === game.user.id;

    try {
      if (deterministicSync && rollUser.id !== game.user.id) {
        return;
      }

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
        }, {
          broadcast: shouldBroadcast,
          whisperTargets: this.normalizeWhisperTargets(chatMessage.whisper),
          blind: secretRoll,
          senderUser: rollUser,
        });
        return;
      }

      for (const roll of rolls) {
        await this.showForRoll(
          roll,
          rollUser,
          shouldBroadcast,
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
    playbackOptions?: RollPlaybackOptions,
  ): Promise<boolean> {
    const allowed = emitDiceRollStart(messageId, context);
    if (!allowed) {
      return false;
    }

    let capturedThrowParams: ThrowParams | undefined;

    this.refreshCanInteract();
    let rendered: boolean;

    try {
      rendered = await this.boxRuntime.add(notation, {
        throwParams: playbackOptions?.throwParams,
        captureThrowParams: playbackOptions?.broadcast
          ? (params) => {
            capturedThrowParams = params;
          }
          : undefined,
      });
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to render dice notation.`, error);
      return false;
    } finally {
      this.refreshCanInteract();
    }

    if (rendered) {
      emitDiceRollComplete(messageId);

      if (playbackOptions?.broadcast && playbackOptions.senderUser.id === game.user.id) {
        const dsnConfig = this.buildDsnConfig(playbackOptions.senderUser);

        if (this.worldSettings.enableDeterministicSync && capturedThrowParams) {
          const payload: SyncRollMessage = {
            type: 'syncRoll',
            user: playbackOptions.senderUser.id,
            messageId,
            throwParams: this.compressThrowParams(capturedThrowParams),
            notation,
            dsnConfig,
            whisperTargets: playbackOptions.whisperTargets,
            blind: playbackOptions.blind,
          };
          this.enqueueSyncRollMessage(payload);
        } else {
          const payload: ShowMessage = {
            type: 'show',
            user: playbackOptions.senderUser.id,
            messageId,
            notation,
            dsnConfig,
            whisperTargets: playbackOptions.whisperTargets,
            blind: playbackOptions.blind,
          };
          emitDiceTowerSocketMessage(payload);
        }
      }
    }

    return rendered;
  }

  addSystem(
    system: IDiceSystem | { id: string; name: string; group?: string },
    mode?: string | boolean,
  ): void {
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

  addSFX(sfxClass: IDiceSFXClass): void {
    this.addSFXMode(sfxClass);
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
    this.socketUnsubscribe?.();
    this.socketUnsubscribe = null;
    if (this.syncRollTimer !== null) {
      clearTimeout(this.syncRollTimer);
      this.syncRollTimer = null;
    }
    this.syncRollQueue = [];
    this.boxRuntime.dispose();
    this.diceFactoryRuntime.dispose();
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
    const queueMergeWindowMs = this.worldSettings.enableDeterministicSync
      ? 0
      : this.worldSettings.enabledSimultaneousRolls
        ? SIMULTANEOUS_ROLL_MERGE_WINDOW_MS
        : 0;

    await this.boxRuntime.configureRuntime({
      diceFactory: this.diceFactoryRuntime,
      throwingForce: this.clientSettings.throwingForce,
      speed: this.resolveAnimationSpeed(),
      hideAfterRoll: this.clientSettings.hideAfterRoll,
      allowInteractivity: true,
      maxDiceNumber: this.worldSettings.maxDiceNumber,
      queueMergeWindowMs,
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
