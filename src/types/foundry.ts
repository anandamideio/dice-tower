/**
 * FoundryVTT ambient type declarations.
 *
 * Minimal stubs for the Foundry globals used by Dice Tower.
 * These will be refined as implementation progresses. The goal here is to
 * allow the rest of the codebase to compile without errors.
 */

// ── Core document stubs ──

declare global {
  interface Constructor<T = object> {
    new (...args: never[]): T;
  }

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
    content?: string;
    rolls: Roll[];
    speaker: ChatSpeakerData;
    whisper: string[];
    blind: boolean;
    user: User;
    isRoll?: boolean;
    isContentVisible?: boolean;
    sound?: string;
    flags?: Record<string, unknown>;
    getFlag?(scope: string, key: string): unknown;
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

  interface Actor {
    id: string;
    hasPlayerOwner: boolean;
  }

  /** A Foundry Roll object. */
  interface Roll {
    dice: DiceTerm[];
    formula: string;
    total: number | undefined;
    options?: Record<string, unknown>;
    /** DSN extension: flag for ghost dice. */
    ghost?: boolean;
    /** DSN extension: flag for secret rolls. */
    secret?: boolean;
    isContentVisible?: boolean;
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
    context: { rolls: Roll[]; user: User; blind: boolean; willTrigger3DRoll?: boolean },
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
    menus?: Map<string, SettingMenuRegistration>;
    register(module: string, key: string, data: SettingRegistration<unknown>): void;
    registerMenu(module: string, key: string, data: SettingMenuRegistration): void;
    get(module: string, key: string): unknown;
    set(module: string, key: string, value: unknown): Promise<unknown>;
  }

  interface SettingRegistration<T> {
    name: string;
    hint: string;
    scope: 'world' | 'client';
    config: boolean;
    default: T;
    type: Constructor | StringConstructor | NumberConstructor | BooleanConstructor | ObjectConstructor;
    choices?: Record<string, string>;
    range?: {
      min: number;
      max: number;
      step: number;
    };
    requiresReload?: boolean;
    onChange?: (value: T) => void;
  }

  interface SettingMenuRegistration {
    name: string;
    label: string;
    hint: string;
    icon: string;
    restricted: boolean;
    type: Constructor;
  }

  interface GameI18n {
    localize(key: string): string;
    format(key: string, data?: Record<string, unknown>): string;
  }

  interface GameUsers {
    forEach(fn: (user: User) => void): void;
    get(id: string): User | undefined;
  }

  interface GameActors {
    get(id: string): Actor | undefined;
  }

  interface GameCombat {
    started: boolean;
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
    actors: GameActors;
    combat?: GameCombat | null;
    settings: GameSettings;
    i18n: GameI18n;
    audio: GameAudio;
    canvas: GameCanvas;
    modules: GameModules;
    dice3d?: import('../api/dice3d.js').IDice3D;
    socket?: {
      emit?(namespace: string, payload: unknown): void;
      on?(namespace: string, listener: (...args: unknown[]) => void): void;
    };
  }

  const game: Game;

  // ── Foundry utilities ──

  interface FoundryUtils {
    duplicate<T>(data: T): T;
    expandObject<T extends Record<string, unknown>>(data: Record<string, unknown>): T;
    flattenObject<T extends Record<string, unknown>>(data: T): Record<string, unknown>;
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
    rolls?: Array<{
      fromJSON?(json: string): Roll;
    }>;
  }

  const CONFIG: {
    Dice: DiceConfig;
  };

  interface ApplicationOptions {
    id?: string;
    title?: string;
    template?: string;
    width?: number;
    height?: number | 'auto';
    closeOnSubmit?: boolean;
    submitOnClose?: boolean;
    submitOnChange?: boolean;
    classes?: string[];
    [key: string]: unknown;
  }

  abstract class Application {
    static get defaultOptions(): ApplicationOptions;
    options: ApplicationOptions;
    constructor(options?: Partial<ApplicationOptions>);
    render(force?: boolean, options?: Record<string, unknown>): this;
    close(options?: Record<string, unknown>): Promise<void>;
  }

  abstract class FormApplication<TObject = Record<string, unknown>> extends Application {
    object: TObject;
    constructor(object?: TObject, options?: Partial<ApplicationOptions>);
    getData(options?: Record<string, unknown>): Promise<Record<string, unknown>> | Record<string, unknown>;
    protected _updateObject(event: Event, formData: Record<string, unknown>): Promise<void> | void;
  }

  function renderTemplate(path: string, data?: Record<string, unknown>): Promise<string>;

  // ── UI ──

  const ui: {
    chat: { element: HTMLElement };
    sidebar: { popouts: { chat?: { element: HTMLElement } } };
    notifications?: {
      info(message: string): void;
      warn(message: string): void;
      error(message: string): void;
    };
  };
}

export {};
