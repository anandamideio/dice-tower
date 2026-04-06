import type {
  DiceBodyDef,
  PhysicsConfig,
  RealtimeStepResult,
  PhysicsWorkerMessage,
  PhysicsWorkerResponse,
  SimulationResult,
  ThrowParams,
  Vec3,
} from '../types/physics.js';

interface PhysicsWorkerError {
  type: 'error';
  detail: string;
}

export class PhysicsWorkerClient {
  private readonly worker: Worker;

  private initialized = false;

  private pendingInit:
    | { resolve: () => void; reject: (reason?: unknown) => void }
    | null = null;

  private pendingSimulate:
    | { resolve: (result: SimulationResult) => void; reject: (reason?: unknown) => void }
    | null = null;

  private pendingStep:
    | { resolve: (result: RealtimeStepResult) => void; reject: (reason?: unknown) => void }
    | null = null;

  private destroyed = false;

  constructor() {
    this.worker = new Worker(new URL('../workers/physics-worker.ts', import.meta.url), {
      type: 'module',
      name: 'dice-tower-physics',
    });

    this.worker.addEventListener('message', this.handleMessage);
    this.worker.addEventListener('error', this.handleWorkerError);
    this.worker.addEventListener('messageerror', this.handleWorkerMessageError);
  }

  async init(config: PhysicsConfig): Promise<void> {
    if (this.initialized) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.pendingInit = { resolve, reject };
      this.postMessage({ type: 'init', config });
    });

    this.initialized = true;
  }

  addDice(dice: DiceBodyDef[]): void {
    this.postMessage({ type: 'addDice', dice });
  }

  simulate(params: ThrowParams): Promise<SimulationResult> {
    if (this.pendingSimulate) {
      return Promise.reject(new Error('A simulation is already in progress.'));
    }

    return new Promise<SimulationResult>((resolve, reject) => {
      this.pendingSimulate = { resolve, reject };
      this.postMessage({ type: 'simulate', params });
    });
  }

  playStep(deltaSeconds: number): Promise<RealtimeStepResult> {
    if (this.pendingStep) {
      return Promise.reject(new Error('A real-time physics step is already in progress.'));
    }

    return new Promise<RealtimeStepResult>((resolve, reject) => {
      this.pendingStep = { resolve, reject };
      this.postMessage({ type: 'playStep', deltaSeconds });
    });
  }

  addConstraint(position: Vec3): void {
    this.postMessage({ type: 'addConstraint', position });
  }

  moveConstraint(position: Vec3): void {
    this.postMessage({ type: 'moveConstraint', position });
  }

  removeConstraint(): void {
    this.postMessage({ type: 'removeConstraint' });
  }

  destroy(): void {
    this.destroyed = true;

    if (this.initialized) {
      this.postMessage({ type: 'destroy' });
    }

    this.rejectPending(new Error('Physics worker was destroyed.'));

    this.worker.removeEventListener('message', this.handleMessage);
    this.worker.removeEventListener('error', this.handleWorkerError);
    this.worker.removeEventListener('messageerror', this.handleWorkerMessageError);
    this.worker.terminate();

    this.initialized = false;
  }

  private postMessage(message: PhysicsWorkerMessage): void {
    this.worker.postMessage(message);
  }

  private handleMessage = (event: MessageEvent<PhysicsWorkerResponse | PhysicsWorkerError>): void => {
    const message = event.data;

    if (message.type === 'error') {
      this.rejectPending(new Error(message.detail));
      return;
    }

    switch (message.type) {
      case 'ready': {
        if (this.pendingInit) {
          this.pendingInit.resolve();
          this.pendingInit = null;
        }
        break;
      }

      case 'simulated': {
        if (this.pendingSimulate) {
          this.pendingSimulate.resolve(message.result);
          this.pendingSimulate = null;
        }
        break;
      }

      case 'step': {
        if (this.pendingStep) {
          this.pendingStep.resolve(message.result);
          this.pendingStep = null;
        }
        break;
      }

      default: {
        const _exhaustive: never = message;
        throw new Error(`Unhandled worker response: ${String(_exhaustive)}`);
      }
    }
  };

  private handleWorkerError = (event: ErrorEvent): void => {
    if (this.destroyed) {
      return;
    }

    const details: string[] = [];
    if (event.message && event.message.length > 0) {
      details.push(event.message);
    }

    if (event.filename && event.filename.length > 0) {
      const line = Number.isFinite(event.lineno) ? String(event.lineno) : '?';
      const column = Number.isFinite(event.colno) ? String(event.colno) : '?';
      details.push(`${event.filename}:${line}:${column}`);
    }

    const nested = event.error as unknown;
    if (nested instanceof Error) {
      if (nested.message && nested.message.length > 0) {
        details.push(nested.message);
      }
      if (nested.stack && nested.stack.length > 0) {
        details.push(nested.stack);
      }
    }

    const message = details.length > 0
      ? `Physics worker startup error: ${details.join(' | ')}`
      : 'Physics worker startup error: Unknown worker error.';

    this.rejectPending(new Error(message));
  };

  private handleWorkerMessageError = (): void => {
    if (this.destroyed) {
      return;
    }

    this.rejectPending(new Error('Physics worker emitted an unreadable message.'));
  };

  private rejectPending(reason: Error): void {
    if (this.pendingInit) {
      this.pendingInit.reject(reason);
      this.pendingInit = null;
    }

    if (this.pendingSimulate) {
      this.pendingSimulate.reject(reason);
      this.pendingSimulate = null;
    }

    if (this.pendingStep) {
      this.pendingStep.reject(reason);
      this.pendingStep = null;
    }
  }
}
