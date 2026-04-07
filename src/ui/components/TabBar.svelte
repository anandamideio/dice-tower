<script lang="ts">
  interface Tab {
    id: string;
    label: string;
    icon?: string;
  }

  interface Props {
    tabs: Tab[];
    active: string;
    onselect?: (id: string) => void;
  }

  let { tabs, active = $bindable(), onselect }: Props = $props();

  function select(id: string) {
    active = id;
    onselect?.(id);
  }
</script>

<div class="dt-tabs" role="tablist">
  {#each tabs as tab}
    <button
      class="dt-tabs__tab"
      class:dt-tabs__tab--active={active === tab.id}
      role="tab"
      aria-selected={active === tab.id}
      onclick={() => select(tab.id)}
    >
      {#if tab.icon}<i class={tab.icon}></i>{/if}
      {tab.label}
    </button>
  {/each}
</div>

<style>
  .dt-tabs {
    display: flex;
    gap: 0;
    border-bottom: 2px solid rgba(255, 255, 255, 0.12);
    margin-bottom: 0.75rem;
  }

  .dt-tabs__tab {
    padding: 0.5rem 1rem;
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font-size: 0.9rem;
    opacity: 0.7;
    transition: opacity 0.15s, border-color 0.15s;
    border-bottom: 2px solid transparent;
    margin-bottom: -2px;
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .dt-tabs__tab:hover {
    opacity: 0.9;
  }

  .dt-tabs__tab--active {
    opacity: 1;
    border-bottom-color: var(--color-text-hyperlink, #7b68ee);
    font-weight: 600;
  }
</style>
