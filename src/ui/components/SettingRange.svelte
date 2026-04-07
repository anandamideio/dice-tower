<script lang="ts">
  interface Props {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    onchange?: (value: number) => void;
  }

  let { label, value = $bindable(), min, max, step, onchange }: Props = $props();

  function handleInput(event: Event) {
    const target = event.target as HTMLInputElement;
    value = Number(target.value);
    onchange?.(value);
  }
</script>

<label class="dt-range">
  <span class="dt-range__label">{label}</span>
  <div class="dt-range__row">
    <input type="range" {min} {max} {step} bind:value oninput={handleInput} />
    <span class="dt-range__value">{value}</span>
  </div>
</label>

<style>
  .dt-range {
    display: grid;
    gap: 0.25rem;
    font-size: 0.9rem;
  }

  .dt-range__row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .dt-range__row input {
    flex: 1;
  }

  .dt-range__value {
    min-width: 3ch;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
</style>
