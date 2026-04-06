/// <reference lib="webworker" />

import type { PhysicsWorkerMessage, PhysicsWorkerResponse } from '../types/physics.js';

let enginePromise: Promise<import('../physics/physics-engine.js').PhysicsEngine> | null = null;

async function getEngine(): Promise<import('../physics/physics-engine.js').PhysicsEngine> {
  if (!enginePromise) {
    enginePromise = import('../physics/physics-engine.js').then(({ PhysicsEngine }) => new PhysicsEngine());
  }

  return enginePromise;
}

const workerScope = self as DedicatedWorkerGlobalScope;

async function handleMessage(message: PhysicsWorkerMessage): Promise<void> {
  if (message.type === 'destroy') {
    if (enginePromise) {
      const engine = await enginePromise;
      engine.destroy();
    }
    workerScope.close();
    return;
  }

  const engine = await getEngine();

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

    case 'playStep': {
      const result = engine.playStep(message.deltaSeconds);
      const response: PhysicsWorkerResponse = {
        type: 'step',
        result,
      };
      workerScope.postMessage(response, engine.getStepTransferables(result));
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
