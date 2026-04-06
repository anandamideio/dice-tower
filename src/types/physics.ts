/**
 * Physics engine types — simulation configuration, bodies, results, and collision events.
 *
 * Derived from the Cannon.js-based PhysicsWorker and DiceBox integration.
 * Designed for the Rapier.js replacement.
 */

import type { DieShape, DieType } from './dice.js';

/** 3-component vector. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Quaternion rotation. */
export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** Per-frame transform for a single physics body. */
export interface BodyTransform {
  position: Vec3;
  rotation: Quat;
}

/** Configuration for the physics world initialization. */
export interface PhysicsConfig {
  /** Play area width (pixels, scaled to physics units). */
  width: number;
  /** Play area height (pixels, scaled to physics units). */
  height: number;
  /** Barrier inset margin. */
  margin: number;
  /** Whether to mute sounds for secret rolls. */
  muteSoundSecretRolls: boolean;
}

/** Definition for a single die physics body to be created in the worker. */
export interface DiceBodyDef {
  /** Unique ID for this body. */
  id: string;
  /** Die shape for collider selection. */
  shape: DieShape;
  /** Die type for result determination. */
  type: DieType;
  /** Mass of the die body. */
  mass: number;
  /** Inertia scaling factor. */
  inertia: number;
  /** Initial position. */
  position: Vec3;
  /** Initial linear velocity. */
  velocity: Vec3;
  /** Initial angular velocity. */
  angularVelocity: Vec3;
  /** Initial orientation. */
  rotation: Quat;
}

/**
 * Parameters that fully define a throw for deterministic replay.
 * Transmitting these across clients enables synchronized simulation.
 */
export interface ThrowParams {
  /** Seed for any RNG used during spawning. */
  seed: number;
  /** Dice body definitions with initial conditions. */
  bodies: DiceBodyDef[];
  /** World config snapshot. */
  config: PhysicsConfig;
}

/** Frame data for all dice over the simulation timeline. */
export interface SimulationFrames {
  /** Number of simulation steps recorded. */
  frameCount: number;
  /**
   * Per-body transforms indexed [bodyIndex][frameIndex].
   * Stored as flat typed arrays for efficient transfer.
   */
  positions: Float32Array;
  rotations: Float32Array;
}

/** Final simulation output returned from the physics worker. */
export interface SimulationResult {
  /** Recorded frame data for animation playback. */
  frames: SimulationFrames;
  /** Determined face-up results per die. */
  results: PhysicsDieResult[];
  /** Collision events for sound triggering. */
  collisions: CollisionEvent[];
}

/** Result of physics face-detection for a single die. */
export interface PhysicsDieResult {
  /** Body ID matching the DiceBodyDef. */
  id: string;
  /** Die type. */
  type: DieType;
  /** Simulated face-up value. */
  value: number;
}

/** Classification of what collided. */
export type CollisionType = 'die-desk' | 'die-barrier' | 'die-die';

/** A collision event emitted during simulation for sound triggering. */
export interface CollisionEvent {
  /** Simulation frame index when the collision occurred. */
  frame: number;
  /** Type of collision. */
  type: CollisionType;
  /** Body ID of the first object. */
  bodyA: string;
  /** Body ID of the second object (empty string for static bodies). */
  bodyB: string;
  /** World-space contact point. */
  contactPoint: Vec3;
  /** Impulse magnitude — used for volume scaling. */
  impulse: number;
}

// ── Worker message protocol ──

export type PhysicsWorkerMessage =
  | { type: 'init'; config: PhysicsConfig }
  | { type: 'addDice'; dice: DiceBodyDef[] }
  | { type: 'simulate'; params: ThrowParams }
  | { type: 'addConstraint'; position: Vec3 }
  | { type: 'moveConstraint'; position: Vec3 }
  | { type: 'removeConstraint' }
  | { type: 'destroy' };

export type PhysicsWorkerResponse =
  | { type: 'ready' }
  | { type: 'simulated'; result: SimulationResult };
