import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three/webgpu';

import { Dice3DRuntime } from '../../src/api/dice3d-runtime.js';
import { parseRollToNotation } from '../../src/dice/dice-notation.js';
import { PhysicsEngine } from '../../src/physics/physics-engine.js';
import { DEFAULT_CLIENT_SETTINGS, DEFAULT_WORLD_SETTINGS } from '../../src/config/settings-schema.js';
import type { DieShape, DieType } from '../../src/types/dice.js';
import type { ThrowParams } from '../../src/types/physics.js';
import { createMockDieTerm, createMockRoll } from '../helpers/roll-helpers.js';

const SHAPES = new Set<DieShape>([
  'd2',
  'd4',
  'd6',
  'd8',
  'd10',
  'd12',
  'd14',
  'd16',
  'd20',
  'd24',
  'd30',
]);

function resolveShapeForType(type: DieType): DieShape {
  if (type === 'd100') {
    return 'd10';
  }

  if (SHAPES.has(type as DieShape)) {
    return type as DieShape;
  }

  return 'd6';
}

function getTypeMax(type: DieType): number {
  if (type === 'd100') {
    return 100;
  }

  const parsed = Number.parseInt(type.slice(1), 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  return 6;
}

function createThrowParamsFromNotation(): ThrowParams {
  const roll = createMockRoll([
    createMockDieTerm({ faces: 6, results: [{ result: 4 }] }),
    createMockDieTerm({ faces: 20, results: [{ result: 17 }] }),
  ]);

  const notation = parseRollToNotation(roll);
  const dice = notation.throws.flatMap((throwGroup) => throwGroup.dice);

  return {
    seed: 11_337,
    config: {
      width: 900,
      height: 600,
      margin: 65,
      muteSoundSecretRolls: false,
    },
    bodies: dice.map((die, index) => ({
      id: `body-${index + 1}`,
      type: die.type,
      shape: resolveShapeForType(die.type),
      mass: 300,
      inertia: 13,
      position: {
        x: -150 + index * 200,
        y: 120 - index * 50,
        z: 360 + index * 40,
      },
      velocity: {
        x: 110 - index * 20,
        y: -40 + index * 25,
        z: 0,
      },
      angularVelocity: {
        x: 7 - index,
        y: 5 + index,
        z: 4,
      },
      rotation: {
        x: 0.05 * index,
        y: 0.12,
        z: 0.08,
        w: 0.99,
      },
    })),
  };
}

async function simulateThrow(params: ThrowParams) {
  const engine = new PhysicsEngine();
  try {
    return await engine.simulate(params);
  } finally {
    engine.destroy();
  }
}

function createRuntimeForCompression() {
  const RuntimeCtor = Dice3DRuntime as unknown as {
    new (
      diceFactory: unknown,
      box: unknown,
      hostElement: HTMLElement,
      clientSettings: typeof DEFAULT_CLIENT_SETTINGS,
      worldSettings: typeof DEFAULT_WORLD_SETTINGS,
    ): Dice3DRuntime;
  };

  return new RuntimeCtor(
    {},
    {
      configureRuntime: async () => undefined,
      running: false,
    },
    {
      remove: () => undefined,
    } as unknown as HTMLElement,
    { ...DEFAULT_CLIENT_SETTINGS },
    { ...DEFAULT_WORLD_SETTINGS },
  ) as unknown as {
    compressThrowParams: (params: ThrowParams) => unknown;
    expandThrowParams: (payload: unknown) => ThrowParams;
  };
}

describe('headless roll pipeline', () => {
  it('parses roll data, simulates physics, and maps final transforms to render objects', async () => {
    const params = createThrowParamsFromNotation();
    const result = await simulateThrow(params);

    expect(result.frames.bodyIds).toHaveLength(params.bodies.length);
    expect(result.results).toHaveLength(params.bodies.length);
    expect(result.frames.frameCount).toBeGreaterThan(0);

    const lastFrame = result.frames.frameCount - 1;

    for (let bodyIndex = 0; bodyIndex < result.frames.bodyIds.length; bodyIndex += 1) {
      const positionOffset = (bodyIndex * result.frames.frameCount + lastFrame) * 3;
      const rotationOffset = (bodyIndex * result.frames.frameCount + lastFrame) * 4;

      const position = new Vector3(
        result.frames.positions[positionOffset],
        result.frames.positions[positionOffset + 1],
        result.frames.positions[positionOffset + 2],
      );

      const rotation = new Quaternion(
        result.frames.rotations[rotationOffset],
        result.frames.rotations[rotationOffset + 1],
        result.frames.rotations[rotationOffset + 2],
        result.frames.rotations[rotationOffset + 3],
      );

      expect(Number.isFinite(position.x)).toBe(true);
      expect(Number.isFinite(position.y)).toBe(true);
      expect(Number.isFinite(position.z)).toBe(true);
      expect(Number.isFinite(rotation.w)).toBe(true);
    }

    for (const die of result.results) {
      const max = getTypeMax(die.type);
      if (die.type === 'd100') {
        expect([0, 10, 20, 30, 40, 50, 60, 70, 80, 90]).toContain(die.value);
      } else {
        expect(die.value).toBeGreaterThanOrEqual(1);
        expect(die.value).toBeLessThanOrEqual(max);
      }
    }
  });

  it('replays deterministic sync payload identically across two simulated clients', async () => {
    const runtime = createRuntimeForCompression();
    const original = createThrowParamsFromNotation();

    const payload = runtime.compressThrowParams(original);
    const replay = runtime.expandThrowParams(payload);

    const firstClient = await simulateThrow(original);
    const secondClient = await simulateThrow(replay);

    expect(secondClient.results).toEqual(firstClient.results);
    expect(secondClient.frames.bodyIds).toEqual(firstClient.frames.bodyIds);
    expect(secondClient.frames.frameCount).toBe(firstClient.frames.frameCount);
    expect(Array.from(secondClient.frames.positions)).toEqual(Array.from(firstClient.frames.positions));
    expect(Array.from(secondClient.frames.rotations)).toEqual(Array.from(firstClient.frames.rotations));
  });
});
