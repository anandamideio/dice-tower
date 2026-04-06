import type { DiceAppearance } from '../types/appearance.js';
import type {
  DiceNotationData,
  DiceThrow,
  DieResult,
  SFXLine,
  SFXLineResolved,
} from '../types/dice.js';

const SUPPORTED_FACES = new Set([2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 20, 24, 30, 100]);
const DEFAULT_MAX_DICE = 100;

export interface DiceNotationParserOptions {
  maxDiceNumber?: number;
  enableFlavorColorset?: boolean;
  user?: User;
  appearance?: {
    global?: DiceAppearance;
    [dieType: string]: DiceAppearance | undefined;
  };
  specialEffects?: SFXLine[];
}

export interface QueuedRollCommand {
  notation: DiceNotationData;
  specialEffects?: SFXLine[];
}

function parseResultLabel(die: DiceTerm, value: number): string {
  try {
    return die.getResultLabel({ result: value });
  } catch {
    return String(value);
  }
}

function isSupportedDieTerm(die: DiceTerm): boolean {
  return SUPPORTED_FACES.has(die.faces);
}

function cloneOptions(options: Record<string, unknown>): Record<string, unknown> {
  if (typeof foundry !== 'undefined' && foundry.utils?.duplicate) {
    return foundry.utils.duplicate(options);
  }
  return { ...options };
}

function mergeOptions(
  base: Record<string, unknown>,
  other: Record<string, unknown>,
): Record<string, unknown> {
  if (typeof foundry !== 'undefined' && foundry.utils?.mergeObject) {
    return foundry.utils.mergeObject(base, other, { recursive: true, overwrite: true });
  }
  return { ...base, ...other };
}

function resolveDieType(fvttDie: DiceTerm, isD10Of100: boolean): DieResult['type'] {
  let type = fvttDie.constructor.DENOMINATION;

  if (type === 'd') {
    type += isD10Of100 ? '10' : String(fvttDie.faces);
  } else {
    type = `d${type}`;
  }

  return type as DieResult['type'];
}

function resolveSpecialEffects(
  die: DieResult,
  specialEffects: SFXLine[],
): SFXLineResolved[] | undefined {
  if (die.discarded || die.options.ghost) {
    return undefined;
  }

  const resolved = specialEffects.filter((sfx) => {
    if (sfx.diceType === 'd100' && typeof die.d100Result === 'number') {
      return sfx.onResult.includes(String(die.d100Result));
    }

    if (sfx.diceType !== die.type) {
      return false;
    }

    if (sfx.onResult.includes('kh')) {
      return Array.isArray(die.options.modifiers) && die.options.modifiers.includes('kh');
    }

    if (sfx.onResult.includes('kl')) {
      return Array.isArray(die.options.modifiers) && die.options.modifiers.includes('kl');
    }

    return sfx.onResult.includes(String(die.result));
  }).map((sfx) => ({
    specialEffect: sfx.specialEffect,
    options: sfx.options,
  }));

  const manual = die.options.sfx;
  if (
    manual &&
    typeof manual === 'object' &&
    typeof (manual as { specialEffect?: unknown }).specialEffect === 'string'
  ) {
    resolved.push({
      specialEffect: (manual as { specialEffect: string }).specialEffect,
      options: (manual as { options?: Record<string, unknown> }).options,
    });
  }

  if (resolved.length === 0) {
    return undefined;
  }

  const deduped: SFXLineResolved[] = [];
  const seen = new Set<string>();
  for (const effect of resolved) {
    const key = `${effect.specialEffect}:${JSON.stringify(effect.options ?? {})}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(effect);
  }

  return deduped;
}

function resolveAppearanceForDie(
  appearance: DiceNotationParserOptions['appearance'],
  dieType: DieResult['type'],
): DiceAppearance | undefined {
  if (!appearance || typeof appearance !== 'object') {
    return undefined;
  }

  const scoped = appearance[dieType];
  if (scoped && typeof scoped === 'object') {
    return scoped;
  }

  const global = appearance.global;
  if (global && typeof global === 'object') {
    return global;
  }

  return undefined;
}

function applyAppearanceOptions(
  die: DieResult,
  appearance: DiceNotationParserOptions['appearance'],
): void {
  const resolved = resolveAppearanceForDie(appearance, die.type);
  if (!resolved) {
    return;
  }

  if (typeof die.options.colorset !== 'string' && typeof resolved.colorset === 'string') {
    die.options.colorset = resolved.colorset;
  }

  if (typeof die.options.texture !== 'string' && typeof resolved.texture === 'string') {
    die.options.texture = resolved.texture;
  }

  if (typeof die.options.material !== 'string' && typeof resolved.material === 'string') {
    die.options.material = resolved.material;
  }

  if (typeof die.options.system !== 'string' && typeof resolved.system === 'string') {
    die.options.system = resolved.system;
  }
}

function addDieToThrow(
  die: DiceTerm,
  index: number,
  target: DiceThrow,
  options: DiceNotationParserOptions,
  rollContext: { ghost: boolean; secret: boolean },
  isD10Of100 = false,
): void {
  const rawResult = die.results[index]?.result;
  if (typeof rawResult !== 'number') {
    return;
  }

  const entry: DieResult = {
    type: resolveDieType(die, isD10Of100),
    result: rawResult,
    resultLabel: parseResultLabel(die, rawResult),
    vectors: [],
    options: cloneOptions(die.options),
  };

  if (die.faces === 100) {
    entry.d100Result = rawResult;

    if (isD10Of100) {
      const unit = rawResult % 10;
      entry.result = unit;
      entry.resultLabel = parseResultLabel(die, unit);
      entry.type = 'd10';
    } else {
      let tens = Math.floor(rawResult / 10);
      if (tens === 10) {
        tens = 0;
      }
      entry.result = tens;
      entry.resultLabel = parseResultLabel(die, tens * 10);
      entry.type = 'd100';
    }
  }

  if (die.results[index]?.discarded) {
    entry.discarded = true;
  }

  const contextOptions: Record<string, unknown> = {};
  if (options.user?.id) {
    contextOptions.owner = options.user.id;
  }

  if (rollContext.ghost) {
    contextOptions.ghost = true;
  }

  if (!rollContext.ghost && rollContext.secret) {
    contextOptions.secret = true;
  }

  if (Array.isArray(die.modifiers) && die.modifiers.length > 0) {
    contextOptions.modifiers = [...die.modifiers];
  }

  entry.options = mergeOptions(entry.options, contextOptions);

  if (
    options.enableFlavorColorset === false &&
    typeof entry.options.flavor === 'string'
  ) {
    delete entry.options.flavor;
  }

  applyAppearanceOptions(entry, options.appearance);

  target.dice.push(entry);
}

export function parseRollToNotation(
  roll: Roll,
  options: DiceNotationParserOptions = {},
): DiceNotationData {
  const maxDice = options.maxDiceNumber ?? DEFAULT_MAX_DICE;

  const throws: DiceThrow[] = [{ dice: [] }];

  for (const die of roll.dice) {
    if (!isSupportedDieTerm(die)) {
      continue;
    }

    let remaining = die.number;
    let extra = 0;
    let throwIndex = 0;

    for (let i = 0; i < die.results.length; i += 1) {
      if (throwIndex >= throws.length) {
        throws.push({ dice: [] });
      }

      const result = die.results[i];
      if (result.exploded || result.rerolled) {
        extra += 1;
      }

      result.indexThrow = throwIndex;

      if (result.hidden && (result.discarded || result.rerolled)) {
        continue;
      }

      remaining -= 1;
      if (remaining <= 0) {
        throwIndex += 1;
        remaining = extra;
        extra = 0;
      }
    }
  }

  let count = 0;

  for (const die of roll.dice) {
    if (!isSupportedDieTerm(die)) {
      continue;
    }

    for (let i = 0; i < die.results.length; i += 1) {
      if (count >= maxDice) {
        return { throws };
      }

      const result = die.results[i];
      if (result.hidden) {
        continue;
      }

      const throwIndex = result.indexThrow ?? 0;
      while (throwIndex >= throws.length) {
        throws.push({ dice: [] });
      }

      const targetThrow = throws[throwIndex];
      addDieToThrow(die, i, targetThrow, options, {
        ghost: roll.ghost === true,
        secret: roll.secret === true,
      }, false);
      count += 1;

      if (die.faces === 100 && count < maxDice) {
        addDieToThrow(die, i, targetThrow, options, {
          ghost: roll.ghost === true,
          secret: roll.secret === true,
        }, true);
        count += 1;
      }
    }
  }

  if (Array.isArray(options.specialEffects) && options.specialEffects.length > 0) {
    for (const throwGroup of throws) {
      for (const die of throwGroup.dice) {
        die.specialEffects = resolveSpecialEffects(die, options.specialEffects);
      }
    }
  }

  return { throws };
}

export function mergeQueuedRollCommands(queue: QueuedRollCommand[]): DiceNotationData {
  const mergedByThrow: DiceThrow[] = [];

  for (const command of queue) {
    for (let throwIndex = 0; throwIndex < command.notation.throws.length; throwIndex += 1) {
      if (!mergedByThrow[throwIndex]) {
        mergedByThrow[throwIndex] = { dice: [] };
      }

      const target = mergedByThrow[throwIndex];
      const source = command.notation.throws[throwIndex];
      target.dice.push(...source.dice);

      if (source.dsnConfig) {
        target.dsnConfig = {
          ...(target.dsnConfig ?? {}),
          ...source.dsnConfig,
        };
      }
    }
  }

  return {
    throws: mergedByThrow,
  };
}
