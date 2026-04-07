<script lang="ts">
  interface Props {
    label: string;
    value: string;
    onchange?: (value: string) => void;
  }

  let { label, value = $bindable(), onchange }: Props = $props();

  function handleInput(event: Event) {
    const target = event.target as HTMLInputElement;
    value = target.value;
    onchange?.(value);
  }
</script>

<label class="dt-color">
  <span>{label}</span>
  <div class="dt-color__row">
    <input type="color" bind:value oninput={handleInput} />
    <input type="text" bind:value oninput={handleInput} class="dt-color__hex" />
  </div>
</label>

<style>
  .dt-color {
    display: grid;
    gap: 0.25rem;
    font-size: 0.9rem;
  }

  .dt-color__row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .dt-color__row input[type='color'] {
    width: 2rem;
    height: 2rem;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 3px;
    cursor: pointer;
    flex-shrink: 0;
  }

  .dt-color__hex {
    flex: 1;
    font-family: monospace;
    font-size: 0.85rem;
  }
</style>
