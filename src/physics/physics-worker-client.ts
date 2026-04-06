import type {
  DiceBodyDef,
  PhysicsConfig,
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

  constructor() {
    this.worker = new Worker(new URL('../workers/physics-worker.ts', import.meta.url), {
      type: 'module',
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

      default: {
        const _exhaustive: never = message;
        throw new Error(`Unhandled worker response: ${String(_exhaustive)}`);
      }
    }
  };

  private handleWorkerError = (event: ErrorEvent): void => {
    this.rejectPending(new Error(event.message || 'Unknown worker error.'));
  };

  private handleWorkerMessageError = (): void => {
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
  }
}
