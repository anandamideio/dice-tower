import { describe, expect, it } from 'vitest';

import { PhysicsEngine } from '../../src/physics/physics-engine.js';
import { createPhysicsThrowParams } from './perf-helpers.js';

describe('performance memory guards', () => {
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
