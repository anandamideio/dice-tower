import { Dice3DRuntime } from './api/dice3d-runtime.js';
import { Dice3DDisabledRuntime } from './api/dice3d-disabled-runtime.js';
import {
  emitDiceInit,
  emitDiceReady,
  migrateDiceTowerSettings,
  maybeShowMigrationWelcome,
  MODULE_ID,
  registerDiceTowerChatHooks,
  registerDiceTowerSettings,
  warmDiceTowerAssetsOnInit,
} from './config/index.js';

Hooks.once('init', () => {
  registerDiceTowerSettings();
  registerDiceTowerChatHooks();
  warmDiceTowerAssetsOnInit();
  console.info(`${MODULE_ID} | Settings registered.`);
});

Hooks.once('ready', () => {
  void (async () => {
    try {
      await migrateDiceTowerSettings();

      let runtime: Dice3DRuntime | Dice3DDisabledRuntime;

      try {
        runtime = await Dice3DRuntime.create();
      } catch (error) {
        console.error(`${MODULE_ID} | Failed to initialize rendering runtime, using fallback mode.`, error);
        runtime = new Dice3DDisabledRuntime(error);
      }

      game.dice3d = runtime;

      emitDiceInit(runtime);
      emitDiceReady(runtime);
      maybeShowMigrationWelcome();

      console.info(`${MODULE_ID} | Runtime ready.`);
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to initialize runtime.`, error);
    }
  })();
});
