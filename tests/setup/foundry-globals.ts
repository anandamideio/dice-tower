type UnknownRecord = Record<string, unknown>;
type AppOptions = Record<string, unknown>;

function duplicate<T>(data: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(data);
  }
  return JSON.parse(JSON.stringify(data)) as T;
}

function mergeObject<T extends UnknownRecord>(original: T, other: Partial<T>): T {
  return {
    ...original,
    ...other,
  };
}

class TestApplication {
  static get defaultOptions(): AppOptions {
    return {};
  }

  options: AppOptions;

  constructor(options: Partial<AppOptions> = {}) {
    this.options = {
      ...(this.constructor as typeof TestApplication).defaultOptions,
      ...options,
    };
  }

  render(): this {
    return this;
  }

  async close(): Promise<void> {
    return;
  }
}

class TestFormApplication<TObject = Record<string, unknown>> extends TestApplication {
  object: TObject;

  constructor(object?: TObject, options: Partial<AppOptions> = {}) {
    super(options);
    this.object = (object ?? {}) as TObject;
  }

  getData(): Record<string, unknown> {
    return {};
  }

  protected _updateObject(): Promise<void> {
    return Promise.resolve();
  }
}

(globalThis as UnknownRecord).Application = TestApplication;
(globalThis as UnknownRecord).FormApplication = TestFormApplication;
(globalThis as UnknownRecord).renderTemplate = async () => '';

(globalThis as UnknownRecord).Hooks = {
  once: () => 0,
  on: () => 0,
  off: () => undefined,
  call: () => true,
  callAll: () => true,
};

(globalThis as UnknownRecord).foundry = {
  utils: {
    duplicate,
    mergeObject,
    expandObject: <T extends UnknownRecord>(data: UnknownRecord) => data as T,
    flattenObject: <T extends UnknownRecord>(data: T) => data,
  },
  audio: {
    Sound: class {
      src: string;

      constructor(src: string) {
        this.src = src;
      }

      async load(): Promise<void> {
        return;
      }

      play(): void {
        return;
      }
    },
    AudioHelper: {
      preloadSound: async () => undefined,
      play: async () => undefined,
    },
  },
  dice: {
    terms: {
      Coin: { DENOMINATION: 'c' },
      FateDie: { DENOMINATION: 'f' },
      Die: { DENOMINATION: 'd' },
    },
  },
  applications: {
    settings: {
      menus: {
        FontConfig: {
          getAvailableFonts: () => [],
          loadFont: async () => undefined,
        },
      },
    },
  },
};

(globalThis as UnknownRecord).ui = {
  chat: {
    element: {},
  },
  sidebar: {
    popouts: {},
  },
  notifications: {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  },
};

(globalThis as UnknownRecord).CONFIG = {
  Dice: {
    terms: {},
    rolls: [],
  },
};

(globalThis as UnknownRecord).game = {
  user: {
    id: 'local-user',
    name: 'Local User',
    color: {
      toString: () => '#336699',
    },
    isGM: false,
    getFlag: () => undefined,
    setFlag: async () => undefined,
    unsetFlag: async () => undefined,
  },
  users: {
    forEach: () => undefined,
    get: () => undefined,
  },
  actors: {
    get: () => undefined,
  },
  combat: null,
  settings: {
    register: () => undefined,
    registerMenu: () => undefined,
    get: () => undefined,
    set: async () => undefined,
  },
  i18n: {
    localize: (key: string) => key,
    format: (key: string) => key,
  },
  audio: {
    pending: [],
    interface: {},
    muted: false,
    volume: 1,
    AudioHelper: {},
  },
  canvas: {
    app: {
      renderer: {
        context: {
          webGLVersion: 2,
        },
      },
    },
  },
  modules: {
    get: () => ({ active: true }),
  },
  socket: {
    emit: () => undefined,
    on: () => undefined,
  },
};
