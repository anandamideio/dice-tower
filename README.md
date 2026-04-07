# Dice Tower

A modern TypeScript rewrite of Dice So Nice for FoundryVTT.

Dice Tower keeps the familiar extension API while modernizing the engine stack:

- Physics: Rapier WASM worker pipeline
- Rendering: Three.js WebGPU path with WebGL2 fallback
- Tooling: TypeScript + Vite + Vitest
- Compatibility: Dice So Nice hook aliases and API surface

## Features

- 3D dice rendering with configurable quality settings
- Deterministic physics replay support for multiplayer sync
- Rich colorset, texture, material, and SFX customization
- Dice So Nice compatibility hooks and extension APIs
- Graceful runtime fallback mode when renderer initialization fails

## Installation (Development)

```sh
pnpm install
pnpm run build
```

For a local Foundry module link during development:

```sh
pnpm run link:foundry
```

## Development Commands

```sh
pnpm run dev
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run test:perf
pnpm run build
```

## Testing

Vitest coverage is organized by intent:

- Unit tests: parsing, materials, face detection, deterministic physics consistency
- Integration tests: headless roll pipeline, deterministic replay, runtime settings behavior
- Performance tests: simulation benchmarks, repeated-roll memory guard, startup timing

Test sources live under [tests](tests).

## Documentation

- Extension API: [docs/extension-api.md](docs/extension-api.md)
- Browser matrix: [docs/browser-compatibility.md](docs/browser-compatibility.md)
- Contributing guide: [CONTRIBUTING.md](CONTRIBUTING.md)

## License

MIT. See [LICENSE](LICENSE).
