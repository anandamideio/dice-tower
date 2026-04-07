# Contributing

## Prerequisites

- Node.js 22+
- pnpm 10+
- FoundryVTT development instance (recommended for smoke validation)

## Setup

```sh
pnpm install
pnpm run typecheck
pnpm run lint
pnpm run test
```

## Development Workflow

1. Create a feature branch from `main`.
2. Keep changes scoped and avoid unrelated refactors.
3. Add or update tests in [tests](tests) for behavior changes.
4. Run the full validation set before opening a PR.

## Validation Checklist

```sh
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run test:perf
pnpm run build
```

If your change affects Foundry integration, perform a smoke pass in a local Foundry world as well.

## Testing Guidance

- Unit tests belong in `tests/unit`.
- Cross-module behavior belongs in `tests/integration`.
- Throughput/startup/memory checks belong in `tests/performance`.
- Prefer deterministic fixtures (fixed seeds, fixed vectors) for physics tests.

## Pull Requests

Include the following in your PR description:

- Problem statement
- Implementation summary
- Test evidence (command list + outcomes)
- Any compatibility or migration notes

## Documentation

Update docs when behavior or public API changes:

- [README.md](README.md)
- [docs/extension-api.md](docs/extension-api.md)
- [docs/performance-comparison.md](docs/performance-comparison.md)
- [docs/browser-compatibility.md](docs/browser-compatibility.md)
