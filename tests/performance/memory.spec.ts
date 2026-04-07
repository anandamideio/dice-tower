import { describe, expect, it } from 'vitest';

import { PhysicsEngine } from '../../src/physics/physics-engine.js';
import { createPhysicsThrowParams } from './perf-helpers.js';
import type { ThrowParams } from '../../src/types/physics.js';

function createHighVolumeD20ThrowParams(diceCount: number, seed: number): ThrowParams {
  return {
    seed,
    config: {
      width: 1200,
      height: 800,
      margin: 80,
      muteSoundSecretRolls: false,
    },
    bodies: Array.from({ length: diceCount }, (_, index) => {
      const column = index % 10;
      const row = Math.floor(index / 10);

      return {
        id: `stress-${index + 1}`,
        type: 'd20',
        shape: 'd20',
        mass: 300,
        inertia: 13,
        position: {
          x: -360 + column * 78,
          y: 260 - row * 62,
          z: 360 + (index % 6) * 26,
        },
        velocity: {
          x: 125 - (index % 7) * 11,
          y: -60 + (index % 5) * 15,
          z: -10,
        },
        angularVelocity: {
          x: 4 + (index % 6),
          y: 5 + (index % 5),
          z: 3 + (index % 4),
        },
        rotation: {
          x: (index % 11) * 0.05,
          y: (index % 7) * 0.05,
          z: (index % 5) * 0.04,
          w: 0.95,
        },
        startAtIteration: index,
      };
    }),
  };
}

describe('performance memory guards', () => {
  it(
    'stays stable across repeated high-volume d20 throws',
    async () => {
      const rounds = 8;
      const dicePerRound = 100;

      const engine = new PhysicsEngine() as unknown as {
        simulate: (params: ThrowParams) => Promise<{
          frames: { bodyIds: string[] };
          results: Array<{ id: string; value: number }>;
        }>;
        destroy: () => void;
        diceBodies: Map<string, unknown>;
        colliderToDiceId: Map<number, string>;
      };

      try {
        for (let i = 0; i < rounds; i += 1) {
          const result = await engine.simulate(createHighVolumeD20ThrowParams(dicePerRound, 9000 + i));
          expect(result.frames.bodyIds).toHaveLength(dicePerRound);
          expect(result.results).toHaveLength(dicePerRound);
          expect(engine.diceBodies.size).toBe(dicePerRound);
          expect(engine.colliderToDiceId.size).toBe(dicePerRound);
        }
      } finally {
        engine.destroy();
      }

      expect(engine.diceBodies.size).toBe(0);
      expect(engine.colliderToDiceId.size).toBe(0);
    },
    180_000,
  );

  it(
    'does not leak physics body bookkeeping after repeated rolls',
    async () => {
      const rounds = 15;
      const dicePerRound = 20;

      if (typeof global.gc === 'function') {
        global.gc();
      }
      const beforeHeap = process.memoryUsage().heapUsed;

      const engine = new PhysicsEngine() as unknown as {
        simulate: (params: ReturnType<typeof createPhysicsThrowParams>) => Promise<unknown>;
        destroy: () => void;
        diceBodies: Map<string, unknown>;
        colliderToDiceId: Map<number, string>;
      };

      try {
        for (let i = 0; i < rounds; i += 1) {
          await engine.simulate(createPhysicsThrowParams(dicePerRound, 5000 + i));
          expect(engine.diceBodies.size).toBe(dicePerRound);
          expect(engine.colliderToDiceId.size).toBe(dicePerRound);
        }
      } finally {
        engine.destroy();
      }

      expect(engine.diceBodies.size).toBe(0);
      expect(engine.colliderToDiceId.size).toBe(0);

      if (typeof global.gc === 'function') {
        global.gc();
      }
      const afterHeap = process.memoryUsage().heapUsed;
      const growthMb = (afterHeap - beforeHeap) / (1024 * 1024);

      if (typeof global.gc === 'function') {
        expect(growthMb).toBeLessThan(32);
      }
    },
    120_000,
  );
});
