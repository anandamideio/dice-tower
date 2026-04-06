import type { IDice3D } from '../api/dice3d.js';
import { HOOK_NAMES } from './constants.js';

function callBothHooks(hooks: readonly [string, string], ...args: unknown[]): boolean {
  const [primary, legacy] = hooks;
  const primaryResult = Hooks.call(primary, ...args);
  const legacyResult = Hooks.call(legacy, ...args);
  return primaryResult && legacyResult;
}

function callAllBothHooks(hooks: readonly [string, string], ...args: unknown[]): void {
  const [primary, legacy] = hooks;
  Hooks.callAll(primary, ...args);
  Hooks.callAll(legacy, ...args);
}

export function emitDiceInit(dice3d: IDice3D): void {
  callAllBothHooks(HOOK_NAMES.init, dice3d);
}

export function emitDiceReady(dice3d: IDice3D): void {
  callAllBothHooks(HOOK_NAMES.ready, dice3d);
}

export function emitDiceRollStart(
  messageId: string,
  context: { roll: Roll; user: User; blind: boolean },
): boolean {
  return callBothHooks(HOOK_NAMES.rollStart, messageId, context);
}

export function emitDiceRollComplete(messageId: string): void {
  callAllBothHooks(HOOK_NAMES.rollComplete, messageId);
}

export function emitDiceMessageProcessed(
  messageId: string,
  context: { rolls: Roll[]; user: User; blind: boolean; willTrigger3DRoll?: boolean },
): void {
  callAllBothHooks(HOOK_NAMES.messageProcessed, messageId, context);
}
