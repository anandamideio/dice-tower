/**
 * FoundryVTT ambient type declarations.
 *
 * Minimal stubs for the Foundry globals used by Dice Tower.
 * These will be refined as implementation progresses. The goal here is to
 * allow the rest of the codebase to compile without errors.
 */

// ── Core document stubs ──

declare global {
  /** A Foundry User document. */
  interface User {
    id: string;
    name: string;
    color: { toString(): string };
    isGM: boolean;
    getFlag(scope: string, key: string): unknown;
    setFlag(scope: string, key: string, value: unknown): Promise<void>;
    unsetFlag(scope: string, key: string): Promise<void>;
  }

  /** A Foundry ChatMessage document. */
  interface ChatMessage {
    id: string;
    rolls: Roll[];
    speaker: ChatSpeakerData;
    whisper: string[];
    blind: boolean;
    user: User;
    /** DSN-internal flag: animation is in progress. */
    _dice3danimating?: boolean;
  }

  /** Chat speaker data attached to a ChatMessage. */
  interface ChatSpeakerData {
    scene?: string | null;
    actor?: string | null;
    token?: string | null;
    alias?: string;
  }

  /** A Foundry Roll object. */
  interface Roll {
    dice: DiceTerm[];
    formula: string;
    total: number | undefined;
    /** DSN extension: flag for ghost dice. */
    ghost?: boolean;
    /** DSN extension: flag for secret rolls. */
    secret?: boolean;
  }

  /** A single DiceTerm within a Roll. */
  interface DiceTerm {
    faces: number;
    number: number;
    results: DiceTermResult[];
    modifiers: string[];
    options: Record<string, unknown>;
    constructor: DiceTermConstructor;
    getResultLabel(result: { result: number }): string;
  }

  interface DiceTermConstructor {
    DENOMINATION: string;
  }

  /** A single result from a DiceTerm. */
  interface DiceTermResult {
    result: number;
    active?: boolean;
    exploded?: boolean;
    rerolled?: boolean;
    discarded?: boolean;
    hidden?: boolean;
    /** DSN-internal: throw group index. */
    indexThrow?: number;
  }

  // ── Hooks API ──

  interface FoundryHookApi {
    once(hook: string, callback: (...args: unknown[]) => void): number;
    on(hook: string, callback: (...args: unknown[]) => void): number;
    off(hook: string, id: number): void;
    call(hook: string, ...args: unknown[]): boolean;
    callAll(hook: string, ...args: unknown[]): boolean;
  }

  const Hooks: FoundryHookApi;

  // ── Dice Tower hook signatures (canonical) ──
  //
  // These are the primary hooks fired by Dice Tower. Extension authors should
  // prefer these when writing new code. Dice so Nice-compatible shims below
  // are type aliases to these, so they are fully interchangeable.

  /** Fired during module init, before textures are loaded. */
  type DiceTowerInitHook = (dice3d: import('../api/dice3d.js').IDice3D) => void;

  /** Fired after all assets are loaded and the module is ready. */
  type DiceTowerReadyHook = (dice3d: import('../api/dice3d.js').IDice3D) => void;

  /** Fired when a dice roll animation begins. Return false to cancel. */
  type DiceTowerRollStartHook = (
    messageId: string,
    context: { roll: Roll; user: User; blind: boolean },
  ) => boolean | void;

  /** Fired when a dice roll animation completes. */
  type DiceTowerRollCompleteHook = (messageId: string) => void;

  /**
   * Fired after a chat message's rolls have been processed for animation.
   * Allows modules to intercept or modify roll handling.
   */
  type DiceTowerMessageProcessedHook = (
    messageId: string,
    context: { rolls: Roll[]; user: User; blind: boolean },
  ) => void;

  // ── Dice so Nice compatibility shims ──
  //
  // These are aliases to the canonical DiceTower hooks above. They exist so
  // that modules written against Dice so Nice continue to compile and work
  // without modification. At runtime Dice Tower fires both the native hook
  // name (e.g. "diceTowerReady") and the legacy name ("diceSoNiceReady") so
  // consumers of either name receive the same event.

  /** @deprecated Prefer {@link DiceTowerInitHook}. Fires simultaneously. */
  type DiceSoNiceInitHook = DiceTowerInitHook;

  /** @deprecated Prefer {@link DiceTowerReadyHook}. Fires simultaneously. */
  type DiceSoNiceReadyHook = DiceTowerReadyHook;

  /** @deprecated Prefer {@link DiceTowerRollStartHook}. Fires simultaneously. */
  type DiceSoNiceRollStartHook = DiceTowerRollStartHook;

  /** @deprecated Prefer {@link DiceTowerRollCompleteHook}. Fires simultaneously. */
  type DiceSoNiceRollCompleteHook = DiceTowerRollCompleteHook;

  /** @deprecated Prefer {@link DiceTowerMessageProcessedHook}. Fires simultaneously. */
  type DiceSoNiceMessageProcessedHook = DiceTowerMessageProcessedHook;

  // ── Game global ──

  interface GameAudio {
    pending: Array<() => void>;
    interface: unknown;
    muted?: boolean;
    volume?: number;
    AudioHelper: unknown;
  }

  interface GameSettings {
    register(module: string, key: string, data: Record<string, unknown>): void;
    registerMenu(module: string, key: string, data: Record<string, unknown>): void;
    get(module: string, key: string): unknown;
    set(module: string, key: string, value: unknown): Promise<unknown>;
  }

  interface GameI18n {
    localize(key: string): string;
    format(key: string, data?: Record<string, unknown>): string;
  }

  interface GameUsers {
    forEach(fn: (user: User) => void): void;
    get(id: string): User | undefined;
  }

  interface GameCanvas {
    app: {
      renderer: {
        context: {
          webGLVersion: number;
        };
      };
    };
  }

  interface GameModules {
    get(id: string): { active: boolean } | undefined;
  }

  interface Game {
    user: User;
    users: GameUsers;
    settings: GameSettings;
    i18n: GameI18n;
    audio: GameAudio;
    canvas: GameCanvas;
    modules: GameModules;
    dice3d?: import('../api/dice3d.js').IDice3D;
  }

  const game: Game;

  // ── Foundry utilities ──

  interface FoundryUtils {
    duplicate<T>(data: T): T;
    mergeObject<T extends Record<string, unknown>>(
      original: T,
      other: Partial<T>,
      options?: {
        insertKeys?: boolean;
        insertValues?: boolean;
        overwrite?: boolean;
        recursive?: boolean;
        performDeletions?: boolean;
      },
    ): T;
  }

  const foundry: {
    utils: FoundryUtils;
    audio: {
      Sound: new (src: string, options?: Record<string, unknown>) => {
        src: string;
        load(): Promise<unknown>;
        play(options?: {
          loop?: boolean;
          loopStart?: number;
          loopEnd?: number;
          volume?: number;
        }): unknown;
      };
      AudioHelper?: {
        preloadSound?(src: string): Promise<unknown>;
        play?(options: {
          src: string;
          volume?: number;
          loop?: boolean;
        }): Promise<unknown>;
      };
    };
    dice: {
      terms: {
        Coin: DiceTermConstructor;
        FateDie: DiceTermConstructor;
        Die: DiceTermConstructor;
      };
    };
    applications: {
      settings: {
        menus: {
          FontConfig: {
            getAvailableFonts(): string[];
            loadFont(font: string, options: Record<string, unknown>): Promise<void>;
          };
        };
      };
    };
  };

  // ── CONFIG global ──

  interface DiceConfig {
    terms: Record<string, DiceTermConstructor>;
  }

  const CONFIG: {
    Dice: DiceConfig;
  };

  // ── UI ──

  const ui: {
    chat: { element: HTMLElement };
    sidebar: { popouts: { chat?: { element: HTMLElement } } };
  };
}

export {};
