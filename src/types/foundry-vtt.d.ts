interface FoundryHookApi {
  once(hook: string, callback: (...args: unknown[]) => void): void;
  on(hook: string, callback: (...args: unknown[]) => void): void;
  callAll(hook: string, ...args: unknown[]): void;
}

declare const Hooks: FoundryHookApi;
