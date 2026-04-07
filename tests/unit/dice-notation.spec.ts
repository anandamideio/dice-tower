import { describe, expect, it } from 'vitest';

import { mergeQueuedRollCommands, parseRollToNotation } from '../../src/dice/dice-notation.js';
import type { DiceAppearance } from '../../src/types/appearance.js';
import type { SFXLine } from '../../src/types/dice.js';
import { createMockDieTerm, createMockRoll, createMockUser } from '../helpers/roll-helpers.js';

describe('parseRollToNotation', () => {
  it('splits exploded dice into sequential throw groups', () => {
    const explodingDie = createMockDieTerm({
      faces: 6,
      number: 1,
      results: [
        { result: 6, exploded: true },
        { result: 4 },
      ],
    });

    const notation = parseRollToNotation(createMockRoll([explodingDie]), {
      user: createMockUser('roller'),
    });

    expect(notation.throws).toHaveLength(2);
    expect(notation.throws[0]?.dice.map((die) => die.result)).toEqual([6]);
    expect(notation.throws[1]?.dice.map((die) => die.result)).toEqual([4]);
    expect(notation.throws[0]?.dice[0]?.options.owner).toBe('roller');
  });

  it('keeps modifier metadata and resolves kh/kl special effects for kept results', () => {
    const keepHighestTerm = createMockDieTerm({
      faces: 20,
      number: 2,
      modifiers: ['kh'],
      results: [
        { result: 18 },
        { result: 5, discarded: true },
      ],
    });

    const specialEffects: SFXLine[] = [
      {
        diceType: 'd20',
        onResult: ['kh'],
        specialEffect: 'sparkle',
      },
    ];

    const notation = parseRollToNotation(createMockRoll([keepHighestTerm]), {
      user: createMockUser('roller'),
      specialEffects,
    });

    const firstThrow = notation.throws[0];
    expect(firstThrow?.dice).toHaveLength(2);

    const kept = firstThrow?.dice.find((die) => !die.discarded);
    const dropped = firstThrow?.dice.find((die) => die.discarded);

    expect(kept?.options.modifiers).toEqual(['kh']);
    expect(kept?.specialEffects?.map((effect) => effect.specialEffect)).toEqual(['sparkle']);
    expect(dropped?.options.modifiers).toEqual(['kh']);
    expect(dropped?.specialEffects).toBeUndefined();
  });

  it('decomposes d100 results into d100 + d10 display dice', () => {
    const percentile = createMockDieTerm({
      faces: 100,
      number: 1,
      results: [{ result: 100 }],
    });

    const notation = parseRollToNotation(createMockRoll([percentile]));
    const dice = notation.throws[0]?.dice ?? [];

    expect(dice).toHaveLength(2);
    expect(dice[0]?.type).toBe('d100');
    expect(dice[0]?.result).toBe(0);
    expect(dice[0]?.d100Result).toBe(100);

    expect(dice[1]?.type).toBe('d10');
    expect(dice[1]?.result).toBe(0);
    expect(dice[1]?.d100Result).toBe(100);
  });

  it('applies appearance resolution chain: global -> per-die -> explicit die override', () => {
    const d6 = createMockDieTerm({
      faces: 6,
      results: [{ result: 3 }],
    });

    const d20 = createMockDieTerm({
      faces: 20,
      results: [{ result: 19 }],
    });

    const d8Explicit = createMockDieTerm({
      faces: 8,
      results: [{ result: 7 }],
      options: {
        colorset: 'explicit-set',
      },
    });

    const appearance = {
      global: {
        colorset: 'global-set',
        texture: 'none',
        material: 'metal',
      } as DiceAppearance,
      d20: {
        colorset: 'd20-set',
        texture: 'ice',
      } as DiceAppearance,
    };

    const notation = parseRollToNotation(createMockRoll([d6, d20, d8Explicit]), {
      appearance,
    });

    const dice = notation.throws[0]?.dice ?? [];

    const d6Result = dice.find((die) => die.type === 'd6');
    const d20Result = dice.find((die) => die.type === 'd20');
    const d8Result = dice.find((die) => die.type === 'd8');

    expect(d6Result?.options.colorset).toBe('global-set');
    expect(d6Result?.options.material).toBe('metal');

    expect(d20Result?.options.colorset).toBe('d20-set');
    expect(d20Result?.options.texture).toBe('ice');
    expect(d20Result?.options.material).toBe('metal');

    expect(d8Result?.options.colorset).toBe('explicit-set');
  });
});

describe('mergeQueuedRollCommands', () => {
  it('merges throws by index and preserves dsnConfig overlays', () => {
    const merged = mergeQueuedRollCommands([
      {
        notation: {
          throws: [{ dice: [{ type: 'd6', result: 2, resultLabel: '2', vectors: [], options: {} }] }],
        },
      },
      {
        notation: {
          throws: [
            {
              dice: [{ type: 'd20', result: 19, resultLabel: '19', vectors: [], options: {} }],
              dsnConfig: { specialEffects: [], sound: true },
            },
          ],
        },
      },
    ]);

    expect(merged.throws).toHaveLength(1);
    expect(merged.throws[0]?.dice.map((die) => die.type)).toEqual(['d6', 'd20']);
    expect(merged.throws[0]?.dsnConfig).toEqual({ specialEffects: [], sound: true });
  });
});
