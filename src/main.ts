const MODULE_ID = 'dice-tower';

Hooks.once('init', () => {
  console.info(`${MODULE_ID} | Initializing module shell.`);
});

Hooks.once('ready', () => {
  console.info(`${MODULE_ID} | Ready.`);
});
