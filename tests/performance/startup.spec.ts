import { afterEach, describe, expect, it, vi } from 'vitest';

import { Dice3DRuntime } from '../../src/api/dice3d-runtime.js';
import { DiceBox } from '../../src/rendering/index.js';

describe('startup timing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes runtime within startup budget in headless test mode', async () => {
    const originalWindow = (globalThis as Record<string, unknown>).window;
    const originalDocument = (globalThis as Record<string, unknown>).document;

    const elements = new Map<string, Record<string, unknown>>();
    const documentStub = {
      getElementById: (id: string) => elements.get(id) ?? null,
      createElement: () => {
        const element: Record<string, unknown> = {
          id: '',
          style: {},
          remove: () => {
            const id = element.id;
            if (typeof id === 'string' && id.length > 0) {
              elements.delete(id);
            }
          },
        };
        return element;
      },
      body: {
        appendChild: (element: Record<string, unknown>) => {
          const id = element.id;
          if (typeof id === 'string' && id.length > 0) {
            elements.set(id, element);
          }
          return element;
        },
      },
    };

    const windowStub = {
      innerWidth: 1920,
      innerHeight: 1080,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    (globalThis as Record<string, unknown>).document = documentStub;
    (globalThis as Record<string, unknown>).window = windowStub;

    const fakeBox = {
      running: false,
      configureRuntime: vi.fn(async () => undefined),
      update: vi.fn(async () => undefined),
      resize: vi.fn(),
      add: vi.fn(async () => true),
      addSFXTrigger: vi.fn(),
      addSFXMode: vi.fn(),
      getSFXModes: vi.fn(() => ({})),
      dispose: vi.fn(),
    };

    const createSpy = vi
      .spyOn(DiceBox, 'create')
      .mockResolvedValue(fakeBox as unknown as DiceBox);

    try {
      const startedAt = performance.now();
      const runtime = await Dice3DRuntime.create();
      const elapsedMs = performance.now() - startedAt;

      expect(elapsedMs).toBeLessThan(2_000);
      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(fakeBox.configureRuntime).toHaveBeenCalledTimes(1);

      runtime.dispose();
      expect(fakeBox.dispose).toHaveBeenCalledTimes(1);
    } finally {
      (globalThis as Record<string, unknown>).window = originalWindow;
      (globalThis as Record<string, unknown>).document = originalDocument;
    }
  });
});
