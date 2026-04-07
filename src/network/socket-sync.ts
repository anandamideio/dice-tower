import { LEGACY_MODULE_ID } from '../config/constants.js';
import type { SocketMessage } from '../types/network.js';

const SOCKET_NAMESPACE = `module.${LEGACY_MODULE_ID}`;

type SocketMessageListener = (message: SocketMessage) => void;

const listeners = new Set<SocketMessageListener>();
let socketBound = false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function isSocketMessage(value: unknown): value is SocketMessage {
  if (!isRecord(value)) {
    return false;
  }

  const messageType = value.type;
  return messageType === 'show' || messageType === 'syncRoll' || messageType === 'update';
}

function bindSocketListener(): void {
  if (socketBound) {
    return;
  }

  if (!game.socket || typeof game.socket.on !== 'function') {
    return;
  }

  game.socket.on(SOCKET_NAMESPACE, (...args: unknown[]) => {
    const payload = args[0];
    if (!isSocketMessage(payload)) {
      return;
    }

    for (const listener of listeners) {
      listener(payload);
    }
  });

  socketBound = true;
}

export function getDiceTowerSocketNamespace(): string {
  return SOCKET_NAMESPACE;
}

export function emitDiceTowerSocketMessage(message: SocketMessage): void {
  if (!game.socket || typeof game.socket.emit !== 'function') {
    return;
  }

  game.socket.emit(SOCKET_NAMESPACE, message);
}

export function subscribeDiceTowerSocketMessages(listener: SocketMessageListener): () => void {
  listeners.add(listener);
  bindSocketListener();

  return () => {
    listeners.delete(listener);
  };
}
