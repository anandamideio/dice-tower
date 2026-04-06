import type { DiceNotationData, DieResult } from '../types/dice.js';
import type { RendererBackend } from '../types/rendering.js';
import { DiceBox } from './DiceBox.js';

export interface DiceCountBenchmark {
  diceCount: number;
  elapsedMs: number;
  msPerDie: number;
}

export interface RendererBenchmarkReport {
  backend: RendererBackend;
  startedAt: number;
  completedAt: number;
  samples: DiceCountBenchmark[];
}

export interface RendererStrategyRecommendation {
  preferredBackend: RendererBackend;
  reason: string;
}

export interface BenchmarkOptions {
  counts?: number[];
  dieType?: DieResult['type'];
}

const DEFAULT_COUNTS = [1, 5, 10, 20, 50, 100];

function createSyntheticNotation(count: number, dieType: DieResult['type']): DiceNotationData {
  const dice: DieResult[] = [];

  for (let i = 0; i < count; i += 1) {
    const faces = dieType === 'd100' ? 100 : Number(dieType.slice(1));
    const value = Number.isFinite(faces) && faces > 0
      ? Math.max(1, Math.min(faces, ((i % faces) + 1)))
      : 1;

    dice.push({
      type: dieType,
      result: value,
      resultLabel: String(value),
      vectors: [],
      options: {},
    });
  }

  return {
    throws: [{ dice }],
  };
}

export async function benchmarkDiceBox(
  box: DiceBox,
  options: BenchmarkOptions = {},
): Promise<RendererBenchmarkReport> {
  const counts = options.counts ?? DEFAULT_COUNTS;
  const dieType = options.dieType ?? 'd6';

  const samples: DiceCountBenchmark[] = [];
  const startedAt = Date.now();

  for (const count of counts) {
    const notation = createSyntheticNotation(count, dieType);
    const start = performance.now();
    await box.add(notation);
    const elapsed = performance.now() - start;

    samples.push({
      diceCount: count,
      elapsedMs: elapsed,
      msPerDie: elapsed / Math.max(1, count),
    });
  }

  const completedAt = Date.now();

  return {
    backend: box.backend,
    startedAt,
    completedAt,
    samples,
  };
}

export function recommendRendererStrategy(report: RendererBenchmarkReport): RendererStrategyRecommendation {
  const heavySample = [...report.samples]
    .sort((a, b) => b.diceCount - a.diceCount)[0];

  if (!heavySample) {
    return {
      preferredBackend: report.backend,
      reason: 'No benchmark samples were collected.',
    };
  }

  if (heavySample.msPerDie > 90) {
    return {
      preferredBackend: 'webgl2',
      reason: 'High per-die cost at large counts suggests WebGL2 fallback may be more stable.',
    };
  }

  return {
    preferredBackend: report.backend,
    reason: 'Observed per-die timings are within expected range for the active backend.',
  };
}
