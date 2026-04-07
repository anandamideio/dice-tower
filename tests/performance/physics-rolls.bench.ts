import { bench, describe } from 'vitest';

import { PhysicsEngine } from '../../src/physics/physics-engine.js';
import { createPhysicsThrowParams } from './perf-helpers.js';

const COUNTS = [1, 5, 10, 20, 50, 100] as const;

describe('physics roll timings', () => {
  for (const count of COUNTS) {
    bench(
      `simulate ${count} dice`,
      async () => {
        const engine = new PhysicsEngine();
        try {
          await engine.simulate(createPhysicsThrowParams(count, 1000 + count));
        } finally {
          engine.destroy();
        }
      },
      {
        iterations: 1,
        warmupIterations: 0,
      },
    );
  }
});
