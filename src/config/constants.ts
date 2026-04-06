export const MODULE_ID = 'dice-tower';
export const LEGACY_MODULE_ID = 'dice-so-nice';

export const DATA_FORMAT_VERSION = '4.2';

export const SETTING_KEYS = {
  world: {
    maxDiceNumber: 'maxDiceNumber',
    globalAnimationSpeed: 'globalAnimationSpeed',
    disabledDuringCombat: 'disabledDuringCombat',
    disabledForInitiative: 'disabledForInitiative',
    hide3dDiceOnSecretRolls: 'hide3dDiceOnSecretRolls',
    showGhostDice: 'showGhostDice',
    hideNpcRolls: 'hideNpcRolls',
    animateRollTable: 'animateRollTable',
    animateInlineRoll: 'animateInlineRoll',
    enabledSimultaneousRolls: 'enabledSimultaneousRolls',
    enabledSimultaneousRollForMessage: 'enabledSimultaneousRollForMessage',
    formatVersion: 'formatVersion',
  },
  client: {
    enabled: 'enabled',
    showExtraDice: 'showExtraDice',
    onlyShowOwnDice: 'onlyShowOwnDice',
    hideAfterRoll: 'hideAfterRoll',
    timeBeforeHide: 'timeBeforeHide',
    hideFX: 'hideFX',
    autoscale: 'autoscale',
    scale: 'scale',
    speed: 'speed',
    imageQuality: 'imageQuality',
    shadowQuality: 'shadowQuality',
    bumpMapping: 'bumpMapping',
    sounds: 'sounds',
    soundsSurface: 'soundsSurface',
    soundsVolume: 'soundsVolume',
    canvasZIndex: 'canvasZIndex',
    throwingForce: 'throwingForce',
    useHighDPI: 'useHighDPI',
    antialiasing: 'antialiasing',
    glow: 'glow',
    showOthersSFX: 'showOthersSFX',
    immersiveDarkness: 'immersiveDarkness',
    muteSoundSecretRolls: 'muteSoundSecretRolls',
    enableFlavorColorset: 'enableFlavorColorset',
    rollingArea: 'rollingArea',
  },
  flags: {
    settings: 'settings',
    appearance: 'appearance',
    sfxList: 'sfxList',
    saves: 'saves',
  },
  menus: {
    diceConfig: 'dice-tower',
    rollableArea: 'rollable-area',
  },
} as const;

export const HOOK_NAMES = {
  init: ['diceTowerInit', 'diceSoNiceInit'],
  ready: ['diceTowerReady', 'diceSoNiceReady'],
  rollStart: ['diceTowerRollStart', 'diceSoNiceRollStart'],
  rollComplete: ['diceTowerRollComplete', 'diceSoNiceRollComplete'],
  messageProcessed: ['diceTowerMessageProcessed', 'diceSoNiceMessageProcessed'],
} as const;
