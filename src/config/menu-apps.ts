import { MODULE_ID } from './constants.js';

interface FormDataObject {
  [key: string]: unknown;
}

export class DiceConfigMenuApp extends FormApplication<FormDataObject> {
  static override get defaultOptions(): ApplicationOptions {
    return {
      id: `${MODULE_ID}-config`,
      title: 'DICETOWER.Menu.DiceConfig.Title',
      template: 'modules/dice-tower/assets/templates/dice-config.hbs',
      width: 720,
      height: 'auto',
      closeOnSubmit: true,
      submitOnChange: false,
      submitOnClose: true,
    };
  }

  override getData(): Record<string, unknown> {
    return {
      message: game.i18n.localize('DICETOWER.Menu.DiceConfig.Placeholder'),
    };
  }

  protected override _updateObject(_event: Event, _formData: FormDataObject): void {
    void _event;
    void _formData;
    // Phase 4 will implement full form persistence.
  }
}

export class RollableAreaConfigMenuApp extends FormApplication<FormDataObject> {
  static override get defaultOptions(): ApplicationOptions {
    return {
      id: `${MODULE_ID}-rollable-area-config`,
      title: 'DICETOWER.Menu.RollableAreaConfig.Title',
      template: 'modules/dice-tower/assets/templates/rollable-area-config.hbs',
      width: 520,
      height: 'auto',
      closeOnSubmit: true,
      submitOnChange: false,
      submitOnClose: true,
    };
  }

  override getData(): Record<string, unknown> {
    return {
      message: game.i18n.localize('DICETOWER.Menu.RollableAreaConfig.Placeholder'),
    };
  }

  protected override _updateObject(_event: Event, _formData: FormDataObject): void {
    void _event;
    void _formData;
    // Phase 4 will implement full form persistence.
  }
}
