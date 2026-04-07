interface DiceTermBuilder {
  faces: number;
  results: DiceTermResult[];
  number?: number;
  denomination?: string;
  modifiers?: string[];
  options?: Record<string, unknown>;
}

export function createMockUser(id = 'user-1', isGM = false): User {
  return {
    id,
    name: id,
    color: {
      toString: () => '#336699',
    },
    isGM,
    getFlag: () => undefined,
    setFlag: async () => undefined,
    unsetFlag: async () => undefined,
  };
}

export function createMockDieTerm(builder: DiceTermBuilder): DiceTerm {
  return {
    faces: builder.faces,
    number: builder.number ?? builder.results.length,
    results: builder.results.map((result) => ({ ...result })),
    modifiers: [...(builder.modifiers ?? [])],
    options: { ...(builder.options ?? {}) },
    constructor: {
      DENOMINATION: builder.denomination ?? 'd',
    },
    getResultLabel: ({ result }) => String(result),
  };
}

export function createMockRoll(dice: DiceTerm[], options?: { ghost?: boolean; secret?: boolean }): Roll {
  return {
    dice,
    formula: 'mock-roll',
    total: undefined,
    options: {},
    ghost: options?.ghost,
    secret: options?.secret,
  };
}
