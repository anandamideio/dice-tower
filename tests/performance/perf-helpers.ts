import type { DieShape, DieType } from '../../src/types/dice.js';
import type { ThrowParams } from '../../src/types/physics.js';

const TYPE_SEQUENCE: Array<{ type: DieType; shape: DieShape }> = [
  { type: 'd6', shape: 'd6' },
  { type: 'd8', shape: 'd8' },
  { type: 'd10', shape: 'd10' },
  { type: 'd12', shape: 'd12' },
  { type: 'd20', shape: 'd20' },
];

export function createPhysicsThrowParams(diceCount: number, seed = 777): ThrowParams {
  return {
    seed,
    config: {
      width: 1200,
      height: 800,
      margin: 80,
      muteSoundSecretRolls: false,
    },
    bodies: Array.from({ length: diceCount }, (_, index) => {
      const typeSpec = TYPE_SEQUENCE[index % TYPE_SEQUENCE.length] ?? TYPE_SEQUENCE[0];
      const column = index % 10;
      const row = Math.floor(index / 10);

      return {
        id: `perf-${index + 1}`,
        type: typeSpec.type,
        shape: typeSpec.shape,
        mass: 300,
        inertia: 13,
        position: {
          x: -350 + column * 75,
          y: 250 - row * 60,
          z: 360 + (index % 5) * 24,
        },
        velocity: {
          x: 120 - (index % 6) * 12,
          y: -55 + (index % 5) * 14,
          z: 0,
        },
        angularVelocity: {
          x: 3 + (index % 4),
          y: 4 + (index % 5),
          z: 5 + (index % 3),
        },
        rotation: {
          x: ((index % 7) * 0.06),
          y: ((index % 5) * 0.07),
          z: ((index % 3) * 0.05),
          w: 0.96,
        },
        startAtIteration: index,
      };
    }),
  };
}
