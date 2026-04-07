# Extension API

Dice Tower exposes a Dice So Nice-compatible API at `game.dice3d`.

## Public Surface

The runtime contract is defined in [src/api/dice3d.ts](src/api/dice3d.ts).

Primary methods:

- `showForRoll(roll, user?, synchronize?, users?, blind?, messageID?, speaker?, options?)`
- `renderRolls(chatMessage, rolls)`
- `addSystem(system, mode?)`
- `addDicePreset(dice, shape?)`
- `addColorset(colorset, mode?)`
- `addTexture(textureID, textureData)`
- `addSFXTrigger(id, name, results)`
- `addSFXMode(sfxClass)`
- `addSFX(sfxClass)`
- `getSFXModes()`
- `loadSaveFile(name)`
- `getLoadedDiceSystems()`

Accessors:

- `DiceFactory`
- `box`
- `canInteract`
- `exports`

## Hook Compatibility

Dice Tower emits both native and legacy hook names.

| Native | Legacy Alias | Purpose |
|---|---|---|
| `diceTowerInit` | `diceSoNiceInit` | API initialization |
| `diceTowerReady` | `diceSoNiceReady` | Runtime ready |
| `diceTowerRollStart` | `diceSoNiceRollStart` | Roll lifecycle start |
| `diceTowerRollComplete` | `diceSoNiceRollComplete` | Roll lifecycle end |
| `diceTowerMessageProcessed` | `diceSoNiceMessageProcessed` | Chat message roll interception |

Hook bridge implementation: [src/config/hook-bridge.ts](src/config/hook-bridge.ts)

Hook name constants: [src/config/constants.ts](src/config/constants.ts)

## Registering A Dice System

```ts
class MySystem extends DiceSystem {
  constructor() {
    super('my-system', 'My System');
  }

  processMaterial(dieType, material, appearance) {
    // Return modified material object or mutate in-place.
    return material;
  }
}

game.dice3d.addSystem(new MySystem(), 'preferred');
```

## Registering SFX

```ts
class MySFX extends DiceSFX {
  static id = 'my-sfx';
  static specialEffectName = 'MYMODULE.SFX.MySFX';

  async play() {
    // custom animation/sound logic
  }
}

game.dice3d.addSFXMode(MySFX);
```

## Deterministic Sync Notes

When world setting `enableDeterministicSync` is enabled, Dice Tower sends compact throw payloads and remote clients replay matching simulations from shared initial conditions.

Relevant runtime flow:

- Compression/expansion logic: [src/api/dice3d-runtime.ts](src/api/dice3d-runtime.ts)
- Socket protocol types: [src/types/network.ts](src/types/network.ts)
