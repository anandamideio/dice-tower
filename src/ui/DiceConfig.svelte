<script lang="ts">
  import TabBar from './components/TabBar.svelte';
  import SettingToggle from './components/SettingToggle.svelte';
  import SettingSelect from './components/SettingSelect.svelte';
  import SettingRange from './components/SettingRange.svelte';
  import ColorPicker from './components/ColorPicker.svelte';
  import type { ClientSettings, WorldSettings } from '../types/settings.js';
  import type { DiceAppearance } from '../types/appearance.js';
  import type { SFXLine } from '../types/dice.js';

  interface AppearanceScope {
    id: string;
    enabled: boolean;
    colorset: string;
    texture: string;
    material: string;
    system: string;
    labelColor: string;
    diceColor: string;
    outlineColor: string;
    edgeColor: string;
  }

  interface SelectOption {
    value: string;
    label: string;
  }

  interface Props {
    isGM: boolean;
    clientSettings: ClientSettings;
    worldSettings: WorldSettings;
    globalAppearance: DiceAppearance;
    appearanceScopes: AppearanceScope[];
    sfxRows: Array<{
      index: number;
      diceType: string;
      onResult: string;
      specialEffect: string;
      isGlobal: boolean;
    }>;
    colorsets: SelectOption[];
    textures: SelectOption[];
    materials: SelectOption[];
    sfxModeOptions: SelectOption[];
    hideFxOptions: SelectOption[];
    imageQualityOptions: SelectOption[];
    shadowQualityOptions: SelectOption[];
    antialiasingOptions: SelectOption[];
    soundsSurfaceOptions: SelectOption[];
    canvasZIndexOptions: SelectOption[];
    throwingForceOptions: SelectOption[];
    worldSpeedOptions: SelectOption[];
    ghostModeOptions: SelectOption[];
    previewFormula?: string;
    onpreview?: (formula: string, appearance: DiceAppearance) => void;
    onsave?: (data: {
      clientSettings: Partial<ClientSettings>;
      worldSettings: Partial<WorldSettings>;
      appearance: Record<string, unknown>;
      sfxRows: SFXLine[];
    }) => void;
  }

  let {
    isGM,
    clientSettings,
    worldSettings,
    globalAppearance,
    appearanceScopes,
    sfxRows,
    colorsets,
    textures,
    materials,
    sfxModeOptions,
    hideFxOptions,
    imageQualityOptions,
    shadowQualityOptions,
    antialiasingOptions,
    soundsSurfaceOptions,
    canvasZIndexOptions,
    throwingForceOptions,
    worldSpeedOptions,
    ghostModeOptions,
    previewFormula = '1d20',
    onpreview,
    onsave,
  }: Props = $props();

  const tabs = $derived([
    { id: 'general', label: 'General', icon: 'fas fa-dice-d20' },
    { id: 'preferences', label: 'Preferences', icon: 'fas fa-sliders-h' },
    { id: 'sfx', label: 'SFX', icon: 'fas fa-magic' },
    { id: 'performance', label: 'Performance', icon: 'fas fa-tachometer-alt' },
    { id: 'backup', label: 'Backup', icon: 'fas fa-save' },
  ]);

  let activeTab = $state('general');
  let formula = $state(previewFormula);

  // Mutable copies of settings for two-way binding
  let cs = $state({ ...clientSettings });
  let ws = $state({ ...worldSettings });
  let ga = $state({ ...globalAppearance });
  let scopes = $state(appearanceScopes.map((s) => ({ ...s })));
  // eslint-disable-next-line -- intentionally capturing initial value from prop
  let sfx = $state(structuredClone(sfxRows));

  function handlePreview() {
    onpreview?.(formula, ga);
  }

  function handleSave() {
    const sfxLines: SFXLine[] = sfx
      .filter((r) => r.diceType && r.specialEffect && r.onResult)
      .map((r) => ({
        diceType: r.diceType,
        onResult: r.onResult.split(/[\s,]+/).filter((v) => v.length > 0),
        specialEffect: r.specialEffect,
        options: r.isGlobal ? { isGlobal: true } : undefined,
      }));

    const appearanceMap: Record<string, unknown> = { global: ga };
    for (const scope of scopes) {
      if (scope.enabled) {
        const { id: _id, enabled: _enabled, ...rest } = scope;
        appearanceMap[scope.id] = rest;
      }
    }

    onsave?.({
      clientSettings: cs,
      worldSettings: ws,
      appearance: appearanceMap,
      sfxRows: sfxLines,
    });
  }

  function addSfxRow() {
    sfx = [
      ...sfx,
      {
        index: sfx.length,
        diceType: '',
        onResult: '',
        specialEffect: '',
        isGlobal: false,
      },
    ];
  }

  function removeSfxRow(index: number) {
    sfx = sfx.filter((_, i) => i !== index);
  }
</script>

<div class="dt-config">
  <!-- Toolbar -->
  <div class="dt-config__toolbar">
    <label class="dt-config__formula">
      Formula
      <input type="text" bind:value={formula} placeholder="1d20" />
    </label>
    <button type="button" onclick={handlePreview}>
      <i class="fas fa-dice"></i> Preview
    </button>
    <button type="button" onclick={handleSave}>
      <i class="fas fa-save"></i> Save
    </button>
  </div>

  <TabBar {tabs} bind:active={activeTab} />

  <!-- General Tab -->
  {#if activeTab === 'general'}
    <section class="dt-panel">
      <h3>Appearance</h3>
      <div class="dt-grid dt-grid--3col">
        <SettingSelect label="Colorset" bind:value={ga.colorset} options={colorsets} />
        <SettingSelect label="Texture" bind:value={ga.texture} options={textures} />
        <SettingSelect label="Material" bind:value={ga.material} options={materials} />
        <ColorPicker label="Label Color" bind:value={ga.labelColor} />
        <ColorPicker label="Dice Color" bind:value={ga.diceColor} />
        <ColorPicker label="Outline Color" bind:value={ga.outlineColor} />
        <ColorPicker label="Edge Color" bind:value={ga.edgeColor} />
      </div>
    </section>

    <section class="dt-panel">
      <h3>Per-Die Overrides</h3>
      <div class="dt-table dt-table--appearance">
        <div class="dt-table__header">
          <span>Die</span>
          <span>On</span>
          <span>Colorset</span>
          <span>Texture</span>
          <span>Material</span>
          <span>Dice Color</span>
          <span>Label Color</span>
        </div>
        {#each scopes as scope, i}
          <div class="dt-table__row">
            <span class="dt-table__die">{scope.id}</span>
            <span><input type="checkbox" bind:checked={scopes[i].enabled} /></span>
            <span>
              <select bind:value={scopes[i].colorset} disabled={!scope.enabled}>
                {#each colorsets as opt}<option value={opt.value}>{opt.label}</option>{/each}
              </select>
            </span>
            <span>
              <select bind:value={scopes[i].texture} disabled={!scope.enabled}>
                {#each textures as opt}<option value={opt.value}>{opt.label}</option>{/each}
              </select>
            </span>
            <span>
              <select bind:value={scopes[i].material} disabled={!scope.enabled}>
                {#each materials as opt}<option value={opt.value}>{opt.label}</option>{/each}
              </select>
            </span>
            <span>
              <input type="color" bind:value={scopes[i].diceColor} disabled={!scope.enabled} />
            </span>
            <span>
              <input type="color" bind:value={scopes[i].labelColor} disabled={!scope.enabled} />
            </span>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  <!-- Preferences Tab -->
  {#if activeTab === 'preferences'}
    <section class="dt-panel">
      <h3>Client Settings</h3>
      <div class="dt-grid">
        <SettingToggle label="Enable 3D Dice" bind:checked={cs.enabled} />
        <SettingToggle label="Show Extra Dice" bind:checked={cs.showExtraDice} />
        <SettingToggle label="Only Show Own Dice" bind:checked={cs.onlyShowOwnDice} />
        <SettingToggle label="Hide After Roll" bind:checked={cs.hideAfterRoll} />
        <SettingRange label="Time Before Hide (ms)" bind:value={cs.timeBeforeHide} min={0} max={20000} step={100} />
        <SettingSelect label="Hide Effect" bind:value={cs.hideFX} options={hideFxOptions} />
        <SettingToggle label="Autoscale" bind:checked={cs.autoscale} />
        <SettingRange label="Scale (%)" bind:value={cs.scale} min={10} max={200} step={1} />
        <SettingRange label="Speed" bind:value={cs.speed} min={0.5} max={3} step={0.1} />
        <SettingToggle label="Sounds" bind:checked={cs.sounds} />
        <SettingSelect label="Sound Surface" bind:value={cs.soundsSurface} options={soundsSurfaceOptions} />
        <SettingRange label="Sound Volume" bind:value={cs.soundsVolume} min={0} max={1} step={0.01} />
        <SettingSelect label="Canvas Z-Index" bind:value={cs.canvasZIndex} options={canvasZIndexOptions} />
        <SettingSelect label="Throwing Force" bind:value={cs.throwingForce} options={throwingForceOptions} />
        <SettingToggle label="Show Others' SFX" bind:checked={cs.showOthersSFX} />
        <SettingToggle label="Immersive Darkness" bind:checked={cs.immersiveDarkness} />
        <SettingToggle label="Mute Sound on Secret Rolls" bind:checked={cs.muteSoundSecretRolls} />
        <SettingToggle label="Flavor Colorset" bind:checked={cs.enableFlavorColorset} />
      </div>
    </section>

    {#if isGM}
      <section class="dt-panel">
        <h3>World Settings (GM Only)</h3>
        <div class="dt-grid">
          <SettingRange label="Max Dice" bind:value={ws.maxDiceNumber} min={1} max={1000} step={1} />
          <SettingSelect label="Global Speed" bind:value={ws.globalAnimationSpeed} options={worldSpeedOptions} />
          <SettingToggle label="Disabled During Combat" bind:checked={ws.disabledDuringCombat} />
          <SettingToggle label="Disabled for Initiative" bind:checked={ws.disabledForInitiative} />
          <SettingToggle label="Hide 3D on Secret Rolls" bind:checked={ws.hide3dDiceOnSecretRolls} />
          <SettingSelect label="Ghost Dice" bind:value={ws.showGhostDice} options={ghostModeOptions} />
          <SettingToggle label="Hide NPC Rolls" bind:checked={ws.hideNpcRolls} />
          <SettingToggle label="Animate Roll Table" bind:checked={ws.animateRollTable} />
          <SettingToggle label="Animate Inline Roll" bind:checked={ws.animateInlineRoll} />
          <SettingToggle label="Simultaneous Rolls" bind:checked={ws.enabledSimultaneousRolls} />
          <SettingToggle label="Merge Per-Message" bind:checked={ws.enabledSimultaneousRollForMessage} />
          <SettingToggle label="Deterministic Sync" bind:checked={ws.enableDeterministicSync} />
          <SettingToggle label="Allow Interactivity" bind:checked={ws.allowInteractivity} />
          <SettingToggle label="Dice Can Be Flipped" bind:checked={ws.diceCanBeFlipped} />
          <SettingToggle label="Show Chat Immediately" bind:checked={ws.immediatelyDisplayChatMessages} />
          <SettingToggle label="Force Owner Dice for Initiative" bind:checked={ws.forceCharacterOwnerAppearanceForInitiative} />
        </div>
      </section>
    {/if}
  {/if}

  <!-- SFX Tab -->
  {#if activeTab === 'sfx'}
    <section class="dt-panel">
      <h3>Special Effects</h3>
      <div class="dt-table dt-table--sfx">
        <div class="dt-table__header">
          <span>Dice Type</span>
          <span>On Result</span>
          <span>Effect</span>
          <span>Global</span>
          <span></span>
        </div>
        {#each sfx as row, i}
          <div class="dt-table__row">
            <span><input type="text" bind:value={sfx[i].diceType} placeholder="d20" /></span>
            <span><input type="text" bind:value={sfx[i].onResult} placeholder="20" /></span>
            <span>
              <select bind:value={sfx[i].specialEffect}>
                <option value="">-- None --</option>
                {#each sfxModeOptions as opt}<option value={opt.value}>{opt.label}</option>{/each}
              </select>
            </span>
            <span><input type="checkbox" bind:checked={sfx[i].isGlobal} /></span>
            <span>
              <button type="button" class="dt-btn--icon" onclick={() => removeSfxRow(i)} title="Remove">
                <i class="fas fa-trash"></i>
              </button>
            </span>
          </div>
        {/each}
      </div>
      <button type="button" class="dt-btn--add" onclick={addSfxRow}>
        <i class="fas fa-plus"></i> Add Effect
      </button>
    </section>
  {/if}

  <!-- Performance Tab -->
  {#if activeTab === 'performance'}
    <section class="dt-panel">
      <h3>Rendering Quality</h3>
      <div class="dt-grid">
        <SettingSelect label="Image Quality" bind:value={cs.imageQuality} options={imageQualityOptions} />
        <SettingSelect label="Shadow Quality" bind:value={cs.shadowQuality} options={shadowQualityOptions} />
        <SettingSelect label="Antialiasing" bind:value={cs.antialiasing} options={antialiasingOptions} />
        <SettingToggle label="Bump Mapping" bind:checked={cs.bumpMapping} />
        <SettingToggle label="Glow (Bloom)" bind:checked={cs.glow} />
        <SettingToggle label="High DPI" bind:checked={cs.useHighDPI} />
      </div>
    </section>
  {/if}

  <!-- Backup Tab -->
  {#if activeTab === 'backup'}
    <section class="dt-panel">
      <h3>Backup &amp; Restore</h3>
      <p class="dt-hint">Export your settings and appearance as JSON, or import from a previous backup.</p>
      <div class="dt-grid dt-grid--2col">
        <button type="button" onclick={() => { /* TODO: export */ }}>
          <i class="fas fa-download"></i> Export Settings
        </button>
        <button type="button" onclick={() => { /* TODO: import */ }}>
          <i class="fas fa-upload"></i> Import Settings
        </button>
      </div>
    </section>
  {/if}
</div>

<style>
  .dt-config {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    font-family: var(--font-primary, Signika, sans-serif);
  }

  .dt-config__toolbar {
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: 0.5rem;
    align-items: end;
    margin-bottom: 0.5rem;
  }

  .dt-config__formula {
    display: grid;
    gap: 0.25rem;
    font-size: 0.9rem;
  }

  .dt-panel {
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.2);
    padding: 0.75rem;
  }

  .dt-panel h3 {
    margin: 0 0 0.6rem;
    font-size: 1rem;
  }

  .dt-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 0.5rem 0.75rem;
  }

  .dt-grid--2col {
    grid-template-columns: repeat(2, 1fr);
  }

  .dt-grid--3col {
    grid-template-columns: repeat(3, 1fr);
  }

  .dt-table {
    display: grid;
    gap: 0.3rem;
    overflow-x: auto;
  }

  .dt-table__header,
  .dt-table__row {
    display: grid;
    gap: 0.4rem;
    align-items: center;
  }

  .dt-table__header {
    font-weight: 600;
    opacity: 0.85;
    font-size: 0.85rem;
  }

  .dt-table--appearance .dt-table__header,
  .dt-table--appearance .dt-table__row {
    grid-template-columns: 55px 40px 1fr 1fr 1fr 50px 50px;
  }

  .dt-table--sfx .dt-table__header,
  .dt-table--sfx .dt-table__row {
    grid-template-columns: 100px 1fr 1fr 60px 40px;
  }

  .dt-table__die {
    font-weight: 600;
    font-size: 0.85rem;
  }

  .dt-table__row select,
  .dt-table__row input[type='text'] {
    width: 100%;
  }

  .dt-table__row input[type='color'] {
    width: 2rem;
    height: 1.5rem;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.2);
    cursor: pointer;
  }

  .dt-btn--icon {
    background: transparent;
    border: none;
    color: inherit;
    cursor: pointer;
    opacity: 0.6;
    padding: 0.25rem;
  }

  .dt-btn--icon:hover {
    opacity: 1;
    color: #e74c3c;
  }

  .dt-btn--add {
    margin-top: 0.5rem;
    align-self: start;
  }

  .dt-hint {
    margin: 0 0 0.5rem;
    font-size: 0.85rem;
    opacity: 0.75;
  }

  @media (max-width: 900px) {
    .dt-config__toolbar {
      grid-template-columns: 1fr;
    }

    .dt-grid--3col {
      grid-template-columns: repeat(2, 1fr);
    }

    .dt-table--appearance .dt-table__header,
    .dt-table--appearance .dt-table__row {
      grid-template-columns: repeat(2, 1fr);
    }

    .dt-table__header {
      display: none;
    }
  }
</style>
