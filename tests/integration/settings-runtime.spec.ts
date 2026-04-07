import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Dice3DRuntime } from '../../src/api/dice3d-runtime.js';
import { DEFAULT_CLIENT_SETTINGS, DEFAULT_WORLD_SETTINGS } from '../../src/config/settings-schema.js';

interface RuntimeHarness {
  runtime: {
    applyRuntimeSettings: () => Promise<void>;
    isEnabled: () => boolean;
    clientSettings: typeof DEFAULT_CLIENT_SETTINGS;
    worldSettings: typeof DEFAULT_WORLD_SETTINGS;
  };
  configureRuntime: ReturnType<typeof vi.fn>;
}

function installGameStub(combatStarted = false): void {
  (globalThis as Record<string, unknown>).game = {
    user: {
      id: 'local-user',
      isGM: false,
    },
    combat: combatStarted ? { started: true } : null,
  };
}

function createRuntimeHarness(options?: {
  clientPatch?: Partial<typeof DEFAULT_CLIENT_SETTINGS>;
  worldPatch?: Partial<typeof DEFAULT_WORLD_SETTINGS>;
}): RuntimeHarness {
  const configureRuntime = vi.fn(async () => undefined);

  const RuntimeCtor = Dice3DRuntime as unknown as {
    new (
      diceFactory: unknown,
      box: unknown,
      hostElement: HTMLElement,
      clientSettings: typeof DEFAULT_CLIENT_SETTINGS,
      worldSettings: typeof DEFAULT_WORLD_SETTINGS,
    ): Dice3DRuntime;
  };

  const runtime = new RuntimeCtor(
    {},
    {
      configureRuntime,
      running: false,
    },
    {
      remove: () => undefined,
    } as unknown as HTMLElement,
    {
      ...DEFAULT_CLIENT_SETTINGS,
      ...(options?.clientPatch ?? {}),
    },
    {
      ...DEFAULT_WORLD_SETTINGS,
      ...(options?.worldPatch ?? {}),
    },
  ) as unknown as RuntimeHarness['runtime'];

  return {
    runtime,
    configureRuntime,
  };
}

describe('Dice3DRuntime settings integration', () => {
  beforeEach(() => {
    vi.useRealTimers();
    installGameStub(false);
  });

  it('applies world speed override and simultaneous-roll merge window to runtime config', async () => {
    const { runtime, configureRuntime } = createRuntimeHarness({
      clientPatch: {
        speed: 1.25,
      },
      worldPatch: {
        globalAnimationSpeed: '3',
        enabledSimultaneousRolls: true,
        enableDeterministicSync: false,
      },
    });

    await runtime.applyRuntimeSettings();

    expect(configureRuntime).toHaveBeenCalledTimes(1);
    const config = configureRuntime.mock.calls[0]?.[0] as Record<string, unknown>;

    expect(config.speed).toBe(3);
    expect(config.queueMergeWindowMs).toBe(80);
    expect(config.maxDiceNumber).toBe(runtime.worldSettings.maxDiceNumber);
    expect(config.throwingForce).toBe(runtime.clientSettings.throwingForce);
  });

  it('disables merge window in deterministic mode and uses client speed without world override', async () => {
    const { runtime, configureRuntime } = createRuntimeHarness({
      clientPatch: {
        speed: 1.9,
      },
      worldPatch: {
        globalAnimationSpeed: '0',
        enabledSimultaneousRolls: true,
        enableDeterministicSync: true,
      },
    });

    await runtime.applyRuntimeSettings();

    const config = configureRuntime.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(config.speed).toBe(1.9);
    expect(config.queueMergeWindowMs).toBe(0);
  });

  it('toggles runtime enablement from client and combat-related world settings', () => {
    const { runtime: disabledClient } = createRuntimeHarness({
      clientPatch: {
        enabled: false,
      },
    });

    expect(disabledClient.isEnabled()).toBe(false);

    installGameStub(true);
    const { runtime: disabledCombat } = createRuntimeHarness({
      worldPatch: {
        disabledDuringCombat: true,
      },
    });

    expect(disabledCombat.isEnabled()).toBe(false);

    installGameStub(false);
    const { runtime: enabled } = createRuntimeHarness();
    expect(enabled.isEnabled()).toBe(true);
  });
});
