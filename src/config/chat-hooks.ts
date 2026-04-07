import { emitDiceMessageProcessed } from './hook-bridge.js';
import { getWorldSettingsSnapshot } from './register-settings.js';
import { MODULE_ID } from './constants.js';

interface ChatHookOptions {
  diceTowerCountAddedRoll?: number;
  diceTowerIndexAddedRoll?: number;
  [key: string]: unknown;
}

interface MessageInterceptionContext {
  rolls: Roll[];
  user: User;
  blind: boolean;
  willTrigger3DRoll: boolean;
}

interface RollConstructorLike {
  fromJSON?(json: string): Roll;
}

let chatHooksRegistered = false;

function parseBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  return false;
}

function getRollConstructor(): RollConstructorLike | null {
  const diceConfig = CONFIG.Dice as unknown as Record<string, unknown>;
  const rollsValue = diceConfig.rolls;

  if (!Array.isArray(rollsValue) || rollsValue.length === 0) {
    return null;
  }

  const typedRolls = rollsValue as unknown[];
  const ctor = typedRolls[0];
  if (!ctor || typeof ctor !== 'object') {
    return null;
  }

  const withFromJson = ctor as { fromJSON?: unknown };
  if (typeof withFromJson.fromJSON !== 'function') {
    return null;
  }

  return {
    fromJSON: withFromJson.fromJSON as (json: string) => Roll,
  };
}

function readMessageFlag(chatMessage: ChatMessage, scope: string, key: string): unknown {
  const candidate = chatMessage as unknown as {
    getFlag?: (scopeArg: string, keyArg: string) => unknown;
  };

  if (typeof candidate.getFlag !== 'function') {
    return undefined;
  }

  return candidate.getFlag(scope, key);
}

function readMessageContent(chatMessage: ChatMessage): string {
  const candidate = chatMessage as unknown as Record<string, unknown>;
  const content = candidate.content;
  return typeof content === 'string' ? content : '';
}

function readMessageContentVisible(chatMessage: ChatMessage): boolean | null {
  const candidate = chatMessage as unknown as Record<string, unknown>;
  const value = candidate.isContentVisible;
  return typeof value === 'boolean' ? value : null;
}

function decodeInlineRollData(encoded: string): string {
  const runtime = globalThis as typeof globalThis & {
    unescape?(value: string): string;
  };

  try {
    return decodeURIComponent(encoded);
  } catch {
    if (typeof runtime.unescape === 'function') {
      return runtime.unescape(encoded);
    }
    return encoded;
  }
}

function parseInlineRolls(content: string): Roll[] {
  if (!content.includes('inline-roll')) {
    return [];
  }

  const ctor = getRollConstructor();
  if (!ctor?.fromJSON) {
    return [];
  }

  const parser = new DOMParser();
  const root = parser.parseFromString(`<div>${content}</div>`, 'text/html');
  const inlineNodes = root.querySelectorAll('.inline-roll.inline-result:not(.inline-dsn-hidden)');

  const rolls: Roll[] = [];

  for (const node of inlineNodes) {
    const payload = (node as HTMLElement).dataset.roll;
    if (typeof payload !== 'string' || payload.length === 0) {
      continue;
    }

    try {
      const roll = ctor.fromJSON(decodeInlineRollData(payload));
      rolls.push(roll);
    } catch {
      // Ignore malformed inline roll payloads and keep processing the rest.
    }
  }

  return rolls;
}

function messageLooksSecret(chatMessage: ChatMessage): boolean {
  if (chatMessage.blind === true) {
    return true;
  }

  if (readMessageContentVisible(chatMessage) === false) {
    return true;
  }

  if (Array.isArray(chatMessage.whisper) && chatMessage.whisper.length > 0) {
    return true;
  }

  return false;
}

function isCombatActive(): boolean {
  const combat = (game as unknown as { combat?: { started?: unknown } | null }).combat;
  return combat?.started === true;
}

function isNpcSpeakerRoll(chatMessage: ChatMessage): boolean {
  const actorId = chatMessage.speaker?.actor;
  if (typeof actorId !== 'string' || actorId.length === 0) {
    return false;
  }

  const actors = (game as unknown as { actors?: { get?: (id: string) => unknown } }).actors;
  if (!actors || typeof actors.get !== 'function') {
    return false;
  }

  const actor = actors.get(actorId);
  if (!actor || typeof actor !== 'object') {
    return false;
  }

  return (actor as { hasPlayerOwner?: unknown }).hasPlayerOwner !== true;
}

function canShowGhostDice(chatMessage: ChatMessage): boolean {
  const worldSettings = getWorldSettingsSnapshot();

  if (!worldSettings.hide3dDiceOnSecretRolls) {
    return true;
  }

  if (worldSettings.showGhostDice === '0') {
    return false;
  }

  if (worldSettings.showGhostDice === '1') {
    return true;
  }

  return chatMessage.user.id === game.user.id || game.user.isGM;
}

function shouldInterceptMessage(chatMessage: ChatMessage, rolls: Roll[]): boolean {
  const runtime = game.dice3d;
  if (!runtime) {
    return false;
  }

  if (!Array.isArray(rolls) || rolls.length === 0) {
    return false;
  }

  const hasRenderableDice = rolls.some((roll) => Array.isArray(roll.dice) && roll.dice.length > 0);
  if (!hasRenderableDice) {
    return false;
  }

  const worldSettings = getWorldSettingsSnapshot();

  if (worldSettings.enableDeterministicSync && chatMessage.user.id !== game.user.id) {
    return false;
  }

  if (worldSettings.disabledDuringCombat && isCombatActive()) {
    return false;
  }

  if (worldSettings.hideNpcRolls && isNpcSpeakerRoll(chatMessage)) {
    return false;
  }

  if (!runtime.isEnabled()) {
    return false;
  }

  if (parseBoolean(readMessageFlag(chatMessage, 'core', 'initiativeRoll')) && worldSettings.disabledForInitiative) {
    return false;
  }

  const rollTableFlag = readMessageFlag(chatMessage, 'core', 'RollTable');
  if (rollTableFlag && !worldSettings.animateRollTable) {
    return false;
  }

  if (messageLooksSecret(chatMessage) && !canShowGhostDice(chatMessage)) {
    return false;
  }

  return true;
}

function collectMessageRolls(chatMessage: ChatMessage, startIndex: number, includeInline: boolean): Roll[] {
  const rolls = Array.isArray(chatMessage.rolls) ? chatMessage.rolls.slice(startIndex) : [];

  const worldSettings = getWorldSettingsSnapshot();
  const content = readMessageContent(chatMessage);
  if (!includeInline || !worldSettings.animateInlineRoll || content.length === 0) {
    return rolls;
  }

  const inlineRolls = parseInlineRolls(content);
  if (inlineRolls.length === 0) {
    return rolls;
  }

  return [...rolls, ...inlineRolls];
}

function emitMessageProcessed(chatMessage: ChatMessage, rolls: Roll[]): boolean {
  const context: MessageInterceptionContext = {
    rolls,
    user: chatMessage.user,
    blind: messageLooksSecret(chatMessage),
    willTrigger3DRoll: shouldInterceptMessage(chatMessage, rolls),
  };

  emitDiceMessageProcessed(chatMessage.id, context);
  return context.willTrigger3DRoll;
}

function processChatMessageRolls(chatMessage: ChatMessage, rolls: Roll[]): void {
  const runtime = game.dice3d;
  if (!runtime) {
    return;
  }

  const shouldAnimate = emitMessageProcessed(chatMessage, rolls);
  if (!shouldAnimate) {
    return;
  }

  chatMessage._dice3danimating = true;
  runtime.renderRolls(chatMessage, rolls);
}

function onCreateChatMessage(chatMessage: ChatMessage): void {
  const rolls = collectMessageRolls(chatMessage, 0, true);
  if (rolls.length === 0) {
    return;
  }

  processChatMessageRolls(chatMessage, rolls);
}

function onPreUpdateChatMessage(
  chatMessage: ChatMessage,
  updateData: Record<string, unknown>,
  options: ChatHookOptions,
): void {
  if (!Array.isArray(updateData.rolls) || !Array.isArray(chatMessage.rolls)) {
    return;
  }

  const previousCount = chatMessage.rolls.length;
  const nextCount = updateData.rolls.length;
  const countAdded = nextCount - previousCount;

  if (countAdded <= 0) {
    return;
  }

  options.diceTowerCountAddedRoll = countAdded;
  options.diceTowerIndexAddedRoll = previousCount;
}

function onUpdateChatMessage(chatMessage: ChatMessage, options: ChatHookOptions): void {
  const countAdded = Number(options.diceTowerCountAddedRoll ?? 0);
  if (!Number.isFinite(countAdded) || countAdded <= 0) {
    return;
  }

  const startIndex = Number(options.diceTowerIndexAddedRoll ?? 0);
  const safeStart = Number.isFinite(startIndex) && startIndex >= 0 ? Math.floor(startIndex) : 0;

  const rolls = collectMessageRolls(chatMessage, safeStart, false);
  if (rolls.length === 0) {
    return;
  }

  processChatMessageRolls(chatMessage, rolls);
}

function onRenderChatMessageHTML(chatMessage: ChatMessage, html: HTMLElement): void {
  const runtime = game.dice3d;
  if (!runtime) {
    return;
  }

  // Allow extensions to disable the message hook temporarily.
  if ((runtime as unknown as { messageHookDisabled?: boolean }).messageHookDisabled) {
    return;
  }

  const worldSettings = getWorldSettingsSnapshot() as unknown as Record<string, unknown>;
  if (worldSettings.immediatelyDisplayChatMessages === true) {
    return;
  }

  if (!chatMessage._dice3danimating) {
    return;
  }

  if (chatMessage._dice3dCountNewRolls) {
    if (!chatMessage._dice3dRollsHidden) {
      chatMessage._dice3dRollsHidden = [];
    }

    chatMessage._dice3dRollsHidden.push(chatMessage._dice3dCountNewRolls);

    const sumOfAllHiddenRolls = chatMessage._dice3dRollsHidden.reduce(
      (a: number, b: number) => a + b,
      0,
    );

    const diceRollElements = [...html.querySelectorAll('.dice-roll')];
    diceRollElements.slice(-sumOfAllHiddenRolls).forEach((el) => el.classList.add('dsn-hide'));

    if (chatMessage._dice3dMessageHidden) {
      html.classList.add('dsn-hide');
    }
  } else {
    html.classList.add('dsn-hide');
    chatMessage._dice3dMessageHidden = true;
  }
}

function registerChatCommand(): void {
  Hooks.on('chatCommandsReady', (...args: unknown[]) => {
    const [commands] = args as [{ register?: (config: Record<string, unknown>) => void }];
    if (!commands || typeof commands.register !== 'function') {
      return;
    }

    commands.register({
      name: '/dice3d',
      module: MODULE_ID,
      aliases: ['/d3d', '/dsn'],
      description: game.i18n?.localize?.('DICETOWER.ChatCommand.Description') ?? 'Roll 3D dice',
      icon: "<i class='fas fa-dice-d20'></i>",
      requiredRole: 'NONE',
      callback: async (_chat: unknown, parameters: string) => {
        const runtime = game.dice3d;
        if (runtime && typeof parameters === 'string' && parameters.trim().length > 0) {
          const RollCtor = (globalThis as unknown as { Roll?: new (formula: string) => Roll & { evaluate(options?: Record<string, unknown>): Promise<Roll> } }).Roll;
          if (RollCtor) {
            const roll = await new RollCtor(parameters).evaluate({ async: true });
            await runtime.showForRoll(roll, game.user, true);
          }
        }
        return {};
      },
      autocompleteCallback: () => {
        const chatCommands = (game as unknown as { chatCommands?: { createInfoElement?: (text: string) => unknown } }).chatCommands;
        if (chatCommands?.createInfoElement) {
          return [chatCommands.createInfoElement(
            game.i18n?.localize?.('DICETOWER.ChatCommand.CompletionDescription') ?? 'Roll a dice formula with 3D animation',
          )];
        }
        return [];
      },
      closeOnComplete: true,
    });
  });
}

function registerHiddenTabHandler(): void {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      return;
    }

    const runtime = game.dice3d as unknown as {
      hiddenAnimationQueue?: Array<{
        timestamp: number;
        resolve: (displayed: boolean) => void;
        data: unknown;
        config: unknown;
      }>;
      _showAnimation?: (data: unknown, config: unknown) => Promise<boolean>;
    } | null;

    if (!runtime?.hiddenAnimationQueue?.length) {
      return;
    }

    const now = Date.now();
    for (const anim of runtime.hiddenAnimationQueue) {
      if (now - anim.timestamp > 10000) {
        anim.resolve(false);
      } else if (typeof runtime._showAnimation === 'function') {
        runtime._showAnimation(anim.data, anim.config).then((displayed) => {
          anim.resolve(displayed);
        });
      } else {
        anim.resolve(false);
      }
    }

    runtime.hiddenAnimationQueue = [];
  });
}

function registerCollapseSidebarHandler(): void {
  Hooks.on('collapseSidebar', () => {
    const sidebarContent = document.getElementById('sidebar-content');
    if (!sidebarContent) {
      return;
    }

    sidebarContent.addEventListener(
      'transitionend',
      () => {
        const runtime = game.dice3d as unknown as {
          box?: { resize?: (w: number, h: number) => void };
        } | null;

        if (runtime?.box?.resize) {
          runtime.box.resize(window.innerWidth, window.innerHeight);
        }
      },
      { once: true },
    );
  });
}

export function registerDiceTowerChatHooks(): void {
  if (chatHooksRegistered) {
    return;
  }

  chatHooksRegistered = true;

  Hooks.on('createChatMessage', (...args: unknown[]) => {
    const [chatMessage] = args as [ChatMessage];
    onCreateChatMessage(chatMessage);
  });

  Hooks.on('preUpdateChatMessage', (...args: unknown[]) => {
    const [chatMessage, updateData, options] = args as [ChatMessage, Record<string, unknown>, ChatHookOptions];
    onPreUpdateChatMessage(chatMessage, updateData, options);
  });

  Hooks.on('updateChatMessage', (...args: unknown[]) => {
    const [chatMessage, _updateData, options] = args as [ChatMessage, Record<string, unknown>, ChatHookOptions];
    void _updateData;
    onUpdateChatMessage(chatMessage, options);
  });

  Hooks.on('renderChatMessageHTML', (...args: unknown[]) => {
    const [message, html] = args as [ChatMessage, HTMLElement];
    onRenderChatMessageHTML(message, html);
  });

  registerChatCommand();
  registerHiddenTabHandler();
  registerCollapseSidebarHandler();
}
