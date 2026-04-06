import { Dice3DRuntime } from './api/dice3d-runtime.js';
import {
  emitDiceInit,
  emitDiceReady,
  migrateDiceTowerSettings,
  MODULE_ID,
  registerDiceTowerSettings,
} from './config/index.js';

Hooks.once('init', () => {
  registerDiceTowerSettings();
  console.info(`${MODULE_ID} | Settings registered.`);
});

Hooks.once('ready', () => {
  void (async () => {
    try {
      await migrateDiceTowerSettings();

      const runtime = await Dice3DRuntime.create();
      game.dice3d = runtime;

      emitDiceInit(runtime);
      emitDiceReady(runtime);

      console.info(`${MODULE_ID} | Runtime ready.`);
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to initialize runtime.`, error);
    }
  })();
});
