<script lang="ts">
  interface Option {
    value: string;
    label: string;
  }

  interface Props {
    label: string;
    value: string;
    options: Option[];
    onchange?: (value: string) => void;
  }

  let { label, value = $bindable(), options, onchange }: Props = $props();

  function handleChange(event: Event) {
    const target = event.target as HTMLSelectElement;
    value = target.value;
    onchange?.(value);
  }
</script>

<label class="dt-select">
  <span>{label}</span>
  <select bind:value onchange={handleChange}>
    {#each options as opt}
      <option value={opt.value}>{opt.label}</option>
    {/each}
  </select>
</label>

<style>
  .dt-select {
    display: grid;
    gap: 0.25rem;
    font-size: 0.9rem;
  }

  select {
    width: 100%;
  }
</style>
