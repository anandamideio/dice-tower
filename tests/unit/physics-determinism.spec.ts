import { describe, expect, it } from 'vitest';

import { PhysicsEngine } from '../../src/physics/physics-engine.js';
import type { ThrowParams } from '../../src/types/physics.js';

function createThrowParams(): ThrowParams {
  return {
    seed: 424242,
    config: {
      width: 900,
      height: 600,
      margin: 70,
      muteSoundSecretRolls: false,
    },
    bodies: [
      {
        id: 'die-1',
        type: 'd6',
        shape: 'd6',
        mass: 300,
        inertia: 13,
        position: { x: -140, y: 120, z: 350 },
        velocity: { x: 120, y: -45, z: 0 },
        angularVelocity: { x: 8, y: 5, z: 3 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
      },
      {
        id: 'die-2',
        type: 'd8',
        shape: 'd8',
        mass: 300,
        inertia: 13,
        position: { x: 20, y: 40, z: 380 },
        velocity: { x: 90, y: -25, z: 0 },
        angularVelocity: { x: 6, y: 7, z: 4 },
        rotation: { x: 0.18, y: 0.22, z: 0, w: 0.96 },
        startAtIteration: 10,
      },
      {
        id: 'die-3',
        type: 'd20',
        shape: 'd20',
        mass: 300,
        inertia: 13,
        position: { x: 140, y: -70, z: 420 },
        velocity: { x: 75, y: 15, z: 0 },
        angularVelocity: { x: 4, y: 10, z: 8 },
        rotation: { x: 0.25, y: 0.1, z: 0.2, w: 0.94 },
        startAtIteration: 24,
      },
    ],
  };
}

async function simulate(params: ThrowParams) {
  const engine = new PhysicsEngine();
  try {
    return await engine.simulate(params);
  } finally {
    engine.destroy();
  }
}

describe('PhysicsEngine determinism', () => {
  it(
    'produces identical frames, results, and collisions for identical throw params',
    async () => {
      const params = createThrowParams();

      const first = await simulate(params);
      const second = await simulate(params);

      expect(second.results).toEqual(first.results);
      expect(second.collisions).toEqual(first.collisions);

      expect(second.frames.frameCount).toBe(first.frames.frameCount);
      expect(second.frames.bodyIds).toEqual(first.frames.bodyIds);
      expect(Array.from(second.frames.positions)).toEqual(Array.from(first.frames.positions));
      expect(Array.from(second.frames.rotations)).toEqual(Array.from(first.frames.rotations));
    },
    30_000,
  );
});
