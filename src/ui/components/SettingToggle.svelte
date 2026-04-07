<script lang="ts">
  interface Props {
    label: string;
    checked: boolean;
    onchange?: (value: boolean) => void;
  }

  let { label, checked = $bindable(), onchange }: Props = $props();

  function handleChange(event: Event) {
    const target = event.target as HTMLInputElement;
    checked = target.checked;
    onchange?.(checked);
  }
</script>

<label class="dt-toggle">
  <input type="checkbox" bind:checked onchange={handleChange} />
  <span>{label}</span>
</label>

<style>
  .dt-toggle {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.9rem;
    cursor: pointer;
  }

  .dt-toggle input {
    margin: 0;
    flex-shrink: 0;
  }
</style>
