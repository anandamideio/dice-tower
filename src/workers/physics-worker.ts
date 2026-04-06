/// <reference lib="webworker" />

import type { PhysicsWorkerMessage, PhysicsWorkerResponse } from '../types/physics.js';
import { PhysicsEngine } from '../physics/physics-engine.js';

const engine = new PhysicsEngine();

const workerScope = self as DedicatedWorkerGlobalScope;

async function handleMessage(message: PhysicsWorkerMessage): Promise<void> {
  switch (message.type) {
    case 'init': {
      await engine.init(message.config);
      const response: PhysicsWorkerResponse = { type: 'ready' };
      workerScope.postMessage(response);
      return;
    }

    case 'addDice': {
      engine.addDice(message.dice);
      return;
    }

    case 'simulate': {
      const result = await engine.simulate(message.params);
      const response: PhysicsWorkerResponse = {
        type: 'simulated',
        result,
      };
      workerScope.postMessage(response, engine.getTransferables(result));
      return;
    }

    case 'addConstraint': {
      engine.addConstraint(message.position);
      return;
    }

    case 'moveConstraint': {
      engine.moveConstraint(message.position);
      return;
    }

    case 'removeConstraint': {
      engine.removeConstraint();
      return;
    }

    case 'destroy': {
      engine.destroy();
      workerScope.close();
      return;
    }

    default: {
      const _exhaustive: never = message;
      throw new Error(`Unhandled physics worker message: ${String(_exhaustive)}`);
    }
  }
}

workerScope.addEventListener('message', (event: MessageEvent<PhysicsWorkerMessage>) => {
  void handleMessage(event.data).catch((error: unknown) => {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    // Errors are mirrored via message to simplify debugging from the main thread.
    workerScope.postMessage({ type: 'error', detail });
  });
});
