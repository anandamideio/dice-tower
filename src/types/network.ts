/**
 * Network/multiplayer sync types — socket protocol messages.
 *
 * Derived from Dice so Nice's socket protocol and the planned
 * deterministic sync mode.
 */

import type { ThrowParams } from './physics.js';
import type { DiceNotationData, SFXLine } from './dice.js';
import type { AppearanceMap } from './appearance.js';

/** Sync mode for dice animation across clients. */
export type SyncMode = 'classic' | 'deterministic';

/** Compact deterministic payload body representation. */
export interface CompressedThrowBody {
  id: string;
  shape: ThrowParams['bodies'][number]['shape'];
  type: ThrowParams['bodies'][number]['type'];
  m: number;
  i: number;
  p: [number, number, number];
  v: [number, number, number];
  a: [number, number, number];
  r: [number, number, number, number];
  /** Delta from previous body's startAtIteration (first entry uses absolute value). */
  s?: number;
  /** Secret-roll marker (1 = true). */
  h?: 1;
}

/** Compact deterministic throw payload optimized for socket bandwidth. */
export interface CompressedThrowParams {
  kind: 'compressed';
  seed: number;
  config: ThrowParams['config'];
  bodies: CompressedThrowBody[];
}

/** Deterministic payload can be sent as raw ThrowParams or compressed form. */
export type SyncThrowPayload = ThrowParams | CompressedThrowParams;

/**
 * Classic "show" broadcast — each client simulates independently
 * and face-swaps to match the result.
 */
export interface ShowMessage {
  type: 'show';
  /** The user ID who initiated the roll. */
  user: string;
  /** Chat message ID. */
  messageId: string | null;
  /** Parsed dice notation with results. */
  notation: DiceNotationData;
  /** The roller's customization config. */
  dsnConfig: {
    appearance: AppearanceMap;
    specialEffects: SFXLine[];
  };
  /** Whisper target user IDs (null = public). */
  whisperTargets: string[] | null;
  /** Whether this is a blind/GM-only roll. */
  blind: boolean;
}

/**
 * Deterministic "syncRoll" message — transmits initial conditions
 * so receiving clients replay the exact same simulation.
 */
export interface SyncRollMessage {
  type: 'syncRoll';
  /** The user ID who initiated the roll. */
  user: string;
  /** Chat message ID. */
  messageId: string | null;
  /** Full throw parameters for deterministic replay. */
  throwParams: SyncThrowPayload;
  /** Parsed dice notation with desired roll results. */
  notation: DiceNotationData;
  /** The roller's customization config. */
  dsnConfig: {
    appearance: AppearanceMap;
    specialEffects: SFXLine[];
  };
  /** Whisper target user IDs (null = public). */
  whisperTargets: string[] | null;
  /** Whether this is a blind/GM-only roll. */
  blind: boolean;
}

/** Appearance/SFX update broadcast. */
export interface UpdateMessage {
  type: 'update';
  /** The user ID whose settings changed. */
  user: string;
}

/** Union of all socket message types. */
export type SocketMessage = ShowMessage | SyncRollMessage | UpdateMessage;

/** Roll broadcast payload passed to the queue handler. */
export interface RollBroadcast {
  /** Socket message with roll data. */
  message: ShowMessage | SyncRollMessage;
  /** Speaker data from the originating ChatMessage. */
  speaker: Record<string, unknown> | null;
}
