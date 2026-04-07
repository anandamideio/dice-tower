# Browser Compatibility Matrix

Dice Tower targets a WebGPU-first renderer and automatically falls back to WebGL2 where needed.

## Backend Selection

- Preferred backend: WebGPU
- Fallback backend: WebGL2
- Runtime backend detection and fallback live in [src/rendering/DiceBox.ts](src/rendering/DiceBox.ts)

## Compatibility Matrix

| Browser Family | WebGPU Path | WebGL2 Fallback | Notes |
|---|---|---|---|
| Chromium (Chrome/Edge) | Yes on supported GPU/OS | Yes | Best baseline for full feature set |
| Firefox | Limited/experimental (varies by build/flags) | Yes | Expect WebGL2 in most default setups |
| Safari | Available on modern Safari builds with compatible hardware | Yes | Behavior depends on OS/GPU generation |
| Linux desktop browsers | Depends on browser + GPU driver support | Yes | WebGPU availability is highly driver-dependent |

