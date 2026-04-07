import * as RAPIER_MODULE from '@dimforge/rapier3d';

import type { DieShape, DieType } from '../types/dice.js';
import type {
  CollisionEvent,
  CollisionType,
  DiceBodyDef,
  PhysicsConfig,
  PhysicsDieResult,
  RealtimeStepResult,
  SimulationFrames,
  SimulationResult,
  ThrowParams,
  Vec3,
} from '../types/physics.js';
import { DICE_SHAPE_DEFINITIONS, getFaceIndices } from './dice-shape-definitions.js';

type RapierModuleWithInit = typeof import('@dimforge/rapier3d') & {
  init?: () => Promise<void>;
};

const RAPIER = RAPIER_MODULE as RapierModuleWithInit;

const GRAVITY_Z = -9.8 * 800;
const FIXED_TIMESTEP = 1 / 60;
const MAX_SIMULATION_STEPS = 1000;
const MIN_SIMULATION_STEPS = 45;
const SETTLE_REQUIRED_STEPS = 12;
const LINEAR_SETTLE_THRESHOLD = 4;
const ANGULAR_SETTLE_THRESHOLD = 4;
const SPAWN_STAGGER_STEPS = 15;
const SPAWN_STAGGER_JITTER_STEPS = 3;
const COLLISION_DEBOUNCE_STEPS = 2;
const DICE_COLLISION_THRESHOLD = 250;
const SURFACE_COLLISION_THRESHOLD = 100;
const DEFAULT_DIE_SCALE = 50;
const FLOOR_THICKNESS = 8;
const WALL_THICKNESS = 8;
const WALL_HEIGHT = 220;
const BARRIER_SCALE = 0.97;
const DRAG_HANDLE_Z_OFFSET = 150;

type StaticSurface = 'desk' | 'barrier';

interface Margin {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

interface NormalizedPhysicsConfig {
  width: number;
  height: number;
  margin: Margin;
  muteSoundSecretRolls: boolean;
}

interface DiceBodyState {
  id: string;
  type: DieType;
  shape: DieShape;
  secretRoll: boolean;
  body: import('@dimforge/rapier3d').RigidBody;
  collider: import('@dimforge/rapier3d').Collider;
  spawnStep: number;
  activated: boolean;
}

interface PendingActivation {
  id: string;
  activateAtStep: number;
}

interface ShapeFaceNormal {
  value: number;
  normal: Vec3;
}

interface ClassifiedCollision {
  type: CollisionType;
  bodyA: string;
  bodyB: string;
}

class Mulberry32 {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state += 0x6d2b79f5;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  nextInt(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }
}

function vecLength(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

function normalize(v: Vec3): Vec3 {
  const mag = vecLength(v);
  if (mag === 0) {
    return { x: 0, y: 0, z: 0 };
  }
  return {
    x: v.x / mag,
    y: v.y / mag,
    z: v.z / mag,
  };
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function rotateVectorByQuat(v: Vec3, q: { x: number; y: number; z: number; w: number }): Vec3 {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);

  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

function rotateVectorByInverseQuat(v: Vec3, q: { x: number; y: number; z: number; w: number }): Vec3 {
  return rotateVectorByQuat(v, { x: -q.x, y: -q.y, z: -q.z, w: q.w });
}

function normalizeConfig(config: PhysicsConfig): NormalizedPhysicsConfig {
  const margin = config.margin;
  const baseMargin: Margin = typeof margin === 'number'
    ? {
        top: margin,
        bottom: margin,
        left: margin,
        right: margin,
      }
    : {
        top: margin.top,
        bottom: margin.bottom,
        left: margin.left,
        right: margin.right,
      };

  return {
    width: config.width,
    height: config.height,
    margin: {
      top: Math.max(0, baseMargin.top),
      bottom: Math.max(0, baseMargin.bottom),
      left: Math.max(0, baseMargin.left),
      right: Math.max(0, baseMargin.right),
    },
    muteSoundSecretRolls: config.muteSoundSecretRolls,
  };
}

function configEquals(a: NormalizedPhysicsConfig, b: NormalizedPhysicsConfig): boolean {
  return (
    a.width === b.width &&
    a.height === b.height &&
    a.margin.top === b.margin.top &&
    a.margin.bottom === b.margin.bottom &&
    a.margin.left === b.margin.left &&
    a.margin.right === b.margin.right &&
    a.muteSoundSecretRolls === b.muteSoundSecretRolls
  );
}

export class PhysicsEngine {
  private initialized = false;

  private world: import('@dimforge/rapier3d').World | null = null;

  private eventQueue: import('@dimforge/rapier3d').EventQueue | null = null;

  private config: NormalizedPhysicsConfig | null = null;

  private diceBodies = new Map<string, DiceBodyState>();

  private pendingActivations: PendingActivation[] = [];

  private colliderToDiceId = new Map<number, string>();

  private staticColliderTypes = new Map<number, StaticSurface>();

  private faceNormalCache = new Map<DieShape, ShapeFaceNormal[]>();

  private dragHandleBody: import('@dimforge/rapier3d').RigidBody | null = null;

  private dragJoint: import('@dimforge/rapier3d').ImpulseJoint | null = null;

  private activeConstraintDieId: string | null = null;

  private lastCollisionFrame = -1000;

  private lastCollisionType: CollisionType | null = null;

  private realtimeFrame = 0;

  async init(config: PhysicsConfig): Promise<void> {
    if (!this.initialized) {
      if (typeof RAPIER.init === 'function') {
        await RAPIER.init();
      }
      this.initialized = true;
    }

    const normalized = normalizeConfig(config);

    if (this.config && this.world && configEquals(this.config, normalized)) {
      return;
    }

    this.config = normalized;
    this.createWorld();
  }

  destroy(): void {
    if (this.world && this.dragJoint) {
      this.world.removeImpulseJoint(this.dragJoint, true);
    }

    this.dragJoint = null;
    this.dragHandleBody = null;
    this.activeConstraintDieId = null;

    if (this.eventQueue) {
      this.eventQueue.free();
    }

    if (this.world) {
      this.world.free();
    }

    this.world = null;
    this.eventQueue = null;
    this.diceBodies.clear();
    this.pendingActivations = [];
    this.colliderToDiceId.clear();
    this.staticColliderTypes.clear();
    this.lastCollisionFrame = -1000;
    this.lastCollisionType = null;
    this.realtimeFrame = 0;
  }

  addDice(dice: DiceBodyDef[]): void {
    this.ensureReady();
    this.removeAllDiceBodies();
    this.realtimeFrame = 0;

    for (const bodyDef of dice) {
      const spawnStep =
        typeof bodyDef.startAtIteration === 'number' ? bodyDef.startAtIteration : 0;
      this.createDieBody(bodyDef, spawnStep);
    }
  }

  addConstraint(position: Vec3): void {
    this.ensureReady();

    const closest = this.findClosestActiveBody(position);
    if (!closest || !this.dragHandleBody || !this.world) {
      return;
    }

    this.removeConstraint();

    const bodyPos = closest.body.translation();
    const bodyRot = closest.body.rotation();
    const worldDelta = {
      x: position.x - bodyPos.x,
      y: position.y - bodyPos.y,
      z: position.z - bodyPos.z,
    };
    const localAnchor = rotateVectorByInverseQuat(worldDelta, bodyRot);

    this.dragHandleBody.setNextKinematicTranslation({
      x: position.x,
      y: position.y,
      z: position.z + DRAG_HANDLE_Z_OFFSET,
    });

    this.dragJoint = this.world.createImpulseJoint(
      RAPIER.JointData.spherical(localAnchor, { x: 0, y: 0, z: 0 }),
      closest.body,
      this.dragHandleBody,
      true,
    );
    this.activeConstraintDieId = closest.id;
  }

  moveConstraint(position: Vec3): void {
    if (!this.dragHandleBody) {
      return;
    }

    this.dragHandleBody.setNextKinematicTranslation({
      x: position.x,
      y: position.y,
      z: position.z + DRAG_HANDLE_Z_OFFSET,
    });
  }

  removeConstraint(): void {
    if (!this.world || !this.dragJoint) {
      this.dragJoint = null;
      this.activeConstraintDieId = null;
      return;
    }

    this.world.removeImpulseJoint(this.dragJoint, true);
    this.dragJoint = null;
    this.activeConstraintDieId = null;
  }

  async simulate(params: ThrowParams): Promise<SimulationResult> {
    await this.init(params.config);
    this.ensureReady();

    this.removeAllDiceBodies();
    this.removeConstraint();

    const rng = new Mulberry32(params.seed);

    for (let index = 0; index < params.bodies.length; index += 1) {
      const bodyDef = params.bodies[index];
      const stagger =
        typeof bodyDef.startAtIteration === 'number'
          ? bodyDef.startAtIteration
          : index * SPAWN_STAGGER_STEPS + rng.nextInt(SPAWN_STAGGER_JITTER_STEPS);
      this.createDieBody(bodyDef, stagger);
    }

    const orderedIds = params.bodies.map((body) => body.id);
    const bodyCount = orderedIds.length;

    const maxPositions = bodyCount * MAX_SIMULATION_STEPS * 3;
    const maxRotations = bodyCount * MAX_SIMULATION_STEPS * 4;
    const positions = new Float32Array(maxPositions);
    const rotations = new Float32Array(maxRotations);
    const collisions: CollisionEvent[] = [];

    this.lastCollisionFrame = -1000;
    this.lastCollisionType = null;
    this.realtimeFrame = 0;

    let settleSteps = 0;
    let finalStep = 0;

    this.captureFrame(orderedIds, 0, positions, rotations);

    for (let step = 1; step < MAX_SIMULATION_STEPS; step += 1) {
      this.activatePendingBodies(step);
      this.world!.step(this.eventQueue!);
      this.collectCollisionEvents(step, collisions);
      this.captureFrame(orderedIds, step, positions, rotations);
      finalStep = step;

      if (step >= MIN_SIMULATION_STEPS && this.allBodiesSettled(step)) {
        settleSteps += 1;
      } else {
        settleSteps = 0;
      }

      if (settleSteps >= SETTLE_REQUIRED_STEPS) {
        break;
      }
    }

    const frameCount = finalStep + 1;
    const usedPositions = new Float32Array(bodyCount * frameCount * 3);
    const usedRotations = new Float32Array(bodyCount * frameCount * 4);

    for (let bodyIndex = 0; bodyIndex < bodyCount; bodyIndex += 1) {
      for (let frame = 0; frame < frameCount; frame += 1) {
        const sourcePosOffset = bodyIndex * MAX_SIMULATION_STEPS * 3 + frame * 3;
        const sourceRotOffset = bodyIndex * MAX_SIMULATION_STEPS * 4 + frame * 4;

        const packedPosOffset = (bodyIndex * frameCount + frame) * 3;
        const packedRotOffset = (bodyIndex * frameCount + frame) * 4;

        usedPositions[packedPosOffset] = positions[sourcePosOffset];
        usedPositions[packedPosOffset + 1] = positions[sourcePosOffset + 1];
        usedPositions[packedPosOffset + 2] = positions[sourcePosOffset + 2];

        usedRotations[packedRotOffset] = rotations[sourceRotOffset];
        usedRotations[packedRotOffset + 1] = rotations[sourceRotOffset + 1];
        usedRotations[packedRotOffset + 2] = rotations[sourceRotOffset + 2];
        usedRotations[packedRotOffset + 3] = rotations[sourceRotOffset + 3];
      }
    }

    const frames: SimulationFrames = {
      frameCount,
      bodyIds: orderedIds,
      positions: usedPositions,
      rotations: usedRotations,
    };

    return {
      frames,
      results: this.computeResults(orderedIds),
      collisions,
    };
  }

  playStep(deltaSeconds: number): RealtimeStepResult {
    this.ensureReady();

    const safeDelta = Number.isFinite(deltaSeconds) && deltaSeconds > 0
      ? deltaSeconds
      : FIXED_TIMESTEP;
    const stepCount = Math.max(1, Math.min(30, Math.floor(safeDelta / FIXED_TIMESTEP)));

    const collisions: CollisionEvent[] = [];

    for (let i = 0; i < stepCount; i += 1) {
      this.realtimeFrame += 1;
      this.world!.step(this.eventQueue!);
      this.collectCollisionEvents(this.realtimeFrame, collisions);
    }

    const bodyIds = Array.from(this.diceBodies.keys());
    const positions = new Float32Array(bodyIds.length * 3);
    const rotations = new Float32Array(bodyIds.length * 4);

    let worldAsleep = bodyIds.length > 0;

    for (let i = 0; i < bodyIds.length; i += 1) {
      const state = this.diceBodies.get(bodyIds[i]);
      if (!state) {
        continue;
      }

      const position = state.body.translation();
      const rotation = state.body.rotation();

      const posOffset = i * 3;
      const rotOffset = i * 4;

      positions[posOffset] = position.x;
      positions[posOffset + 1] = position.y;
      positions[posOffset + 2] = position.z;

      rotations[rotOffset] = rotation.x;
      rotations[rotOffset + 1] = rotation.y;
      rotations[rotOffset + 2] = rotation.z;
      rotations[rotOffset + 3] = rotation.w;

      if (!state.body.isSleeping()) {
        worldAsleep = false;
      }
    }

    if (bodyIds.length === 0) {
      worldAsleep = true;
    }

    return {
      bodyIds,
      positions,
      rotations,
      collisions,
      worldAsleep,
    };
  }

  getTransferables(result: SimulationResult): Transferable[] {
    return [result.frames.positions.buffer, result.frames.rotations.buffer];
  }

  getStepTransferables(result: RealtimeStepResult): Transferable[] {
    return [result.positions.buffer, result.rotations.buffer];
  }

  private ensureReady(): void {
    if (!this.world || !this.eventQueue || !this.config) {
      throw new Error('Physics world is not initialized. Call init() first.');
    }
  }

  private createWorld(): void {
    this.destroy();

    this.world = new RAPIER.World({ x: 0, y: 0, z: GRAVITY_Z });
    this.world.timestep = FIXED_TIMESTEP;

    this.eventQueue = new RAPIER.EventQueue(true);

    this.diceBodies = new Map();
    this.pendingActivations = [];
    this.colliderToDiceId = new Map();
    this.staticColliderTypes = new Map();

    this.addStaticEnvironment();
    this.createDragHandle();
  }

  private addStaticEnvironment(): void {
    const config = this.config!;
    const world = this.world!;

    const floorBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, -FLOOR_THICKNESS),
    );
    const floorCollider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(config.width * 2, config.height * 2, FLOOR_THICKNESS)
        .setFriction(0.01)
        .setRestitution(0.5),
      floorBody,
    );
    this.staticColliderTypes.set(floorCollider.handle, 'desk');

    const topY = (config.height - config.margin.top * 2) * BARRIER_SCALE;
    const bottomY = (-config.height + config.margin.bottom * 2) * BARRIER_SCALE;
    const rightX = (config.width - config.margin.right * 2) * BARRIER_SCALE;
    const leftX = (-config.width + config.margin.left * 2) * BARRIER_SCALE;

    const makeBarrier = (x: number, y: number, hx: number, hy: number): void => {
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, 0));
      const collider = world.createCollider(
        RAPIER.ColliderDesc.cuboid(hx, hy, WALL_HEIGHT)
          .setFriction(0)
          .setRestitution(0.95),
        body,
      );
      this.staticColliderTypes.set(collider.handle, 'barrier');
    };

    makeBarrier(0, topY, config.width * 2, WALL_THICKNESS);
    makeBarrier(0, bottomY, config.width * 2, WALL_THICKNESS);
    makeBarrier(rightX, 0, WALL_THICKNESS, config.height * 2);
    makeBarrier(leftX, 0, WALL_THICKNESS, config.height * 2);
  }

  private createDragHandle(): void {
    const world = this.world!;

    this.dragHandleBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0, DRAG_HANDLE_Z_OFFSET),
    );
    this.dragHandleBody.setEnabled(true);
  }

  private createDieBody(bodyDef: DiceBodyDef, spawnStep: number): void {
    const world = this.world!;
    const shapeDef = DICE_SHAPE_DEFINITIONS[bodyDef.shape];

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(bodyDef.position.x, bodyDef.position.y, bodyDef.position.z)
      .setRotation(bodyDef.rotation)
      .setLinvel(bodyDef.velocity.x, bodyDef.velocity.y, bodyDef.velocity.z)
      .setAngvel(bodyDef.angularVelocity)
      .setLinearDamping(0.1)
      .setAngularDamping(0.1)
      .setCanSleep(true)
      .setEnabled(spawnStep <= 0);

    if (bodyDef.mass > 0) {
      bodyDesc.setAdditionalMass(bodyDef.mass);
    }

    const body = world.createRigidBody(bodyDesc);

    let colliderDesc: import('@dimforge/rapier3d').ColliderDesc;

    if (shapeDef.type === 'Cylinder') {
      const radius = DEFAULT_DIE_SCALE;
      const halfHeight = (shapeDef.height * DEFAULT_DIE_SCALE) / 2;
      colliderDesc = RAPIER.ColliderDesc.cylinder(halfHeight, radius);
    } else {
      const points = new Float32Array(shapeDef.vertices.length * 3);
      for (let i = 0; i < shapeDef.vertices.length; i += 1) {
        const [vx, vy, vz] = shapeDef.vertices[i];
        const base = i * 3;
        points[base] = vx * DEFAULT_DIE_SCALE;
        points[base + 1] = vy * DEFAULT_DIE_SCALE;
        points[base + 2] = vz * DEFAULT_DIE_SCALE;
      }

      const hull = RAPIER.ColliderDesc.convexHull(points);
      if (!hull) {
        throw new Error(`Unable to create convex hull for shape: ${bodyDef.shape}`);
      }
      colliderDesc = hull;
    }

    colliderDesc
      .setFriction(0.01)
      .setRestitution(0.7)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(0);

    const collider = world.createCollider(colliderDesc, body);

    const state: DiceBodyState = {
      id: bodyDef.id,
      type: bodyDef.type,
      shape: bodyDef.shape,
      secretRoll: bodyDef.secretRoll === true,
      body,
      collider,
      spawnStep,
      activated: spawnStep <= 0,
    };

    this.diceBodies.set(bodyDef.id, state);
    this.colliderToDiceId.set(collider.handle, bodyDef.id);

    if (spawnStep > 0) {
      this.pendingActivations.push({
        id: bodyDef.id,
        activateAtStep: spawnStep,
      });
    }
  }

  private removeAllDiceBodies(): void {
    if (!this.world) {
      return;
    }

    for (const state of this.diceBodies.values()) {
      this.world.removeRigidBody(state.body);
    }

    this.diceBodies.clear();
    this.pendingActivations = [];
    this.colliderToDiceId.clear();
    this.activeConstraintDieId = null;
  }

  private activatePendingBodies(step: number): void {
    const stillPending: PendingActivation[] = [];

    for (const pending of this.pendingActivations) {
      if (pending.activateAtStep > step) {
        stillPending.push(pending);
        continue;
      }

      const state = this.diceBodies.get(pending.id);
      if (!state) continue;

      state.body.setEnabled(true);
      state.body.wakeUp();
      state.activated = true;
    }

    this.pendingActivations = stillPending;
  }

  private captureFrame(
    orderedIds: string[],
    frame: number,
    positions: Float32Array,
    rotations: Float32Array,
  ): void {
    const frameStridePos = MAX_SIMULATION_STEPS * 3;
    const frameStrideRot = MAX_SIMULATION_STEPS * 4;

    for (let bodyIndex = 0; bodyIndex < orderedIds.length; bodyIndex += 1) {
      const state = this.diceBodies.get(orderedIds[bodyIndex]);
      if (!state) continue;

      const position = state.body.translation();
      const rotation = state.body.rotation();

      const posOffset = bodyIndex * frameStridePos + frame * 3;
      const rotOffset = bodyIndex * frameStrideRot + frame * 4;

      positions[posOffset] = position.x;
      positions[posOffset + 1] = position.y;
      positions[posOffset + 2] = position.z;

      rotations[rotOffset] = rotation.x;
      rotations[rotOffset + 1] = rotation.y;
      rotations[rotOffset + 2] = rotation.z;
      rotations[rotOffset + 3] = rotation.w;
    }
  }

  private allBodiesSettled(step: number): boolean {
    for (const state of this.diceBodies.values()) {
      if (!state.activated && step < state.spawnStep) {
        return false;
      }

      const linearVelocity = state.body.linvel();
      const angularVelocity = state.body.angvel();

      const linearMag = Math.sqrt(
        linearVelocity.x * linearVelocity.x +
          linearVelocity.y * linearVelocity.y +
          linearVelocity.z * linearVelocity.z,
      );
      const angularMag = Math.sqrt(
        angularVelocity.x * angularVelocity.x +
          angularVelocity.y * angularVelocity.y +
          angularVelocity.z * angularVelocity.z,
      );

      if (!state.body.isSleeping()) {
        if (linearMag > LINEAR_SETTLE_THRESHOLD || angularMag > ANGULAR_SETTLE_THRESHOLD) {
          return false;
        }
      }
    }

    return true;
  }

  private classifyCollision(colliderHandleA: number, colliderHandleB: number): ClassifiedCollision | null {
    const dieA = this.colliderToDiceId.get(colliderHandleA);
    const dieB = this.colliderToDiceId.get(colliderHandleB);
    const staticA = this.staticColliderTypes.get(colliderHandleA);
    const staticB = this.staticColliderTypes.get(colliderHandleB);

    if (dieA && dieB) {
      return {
        type: 'die-die',
        bodyA: dieA,
        bodyB: dieB,
      };
    }

    if (dieA && staticB) {
      return {
        type: staticB === 'desk' ? 'die-desk' : 'die-barrier',
        bodyA: dieA,
        bodyB: '',
      };
    }

    if (dieB && staticA) {
      return {
        type: staticA === 'desk' ? 'die-desk' : 'die-barrier',
        bodyA: dieB,
        bodyB: '',
      };
    }

    return null;
  }

  private shouldEmitCollision(
    frame: number,
    type: CollisionType,
    impulse: number,
    bodyA: string,
    bodyB: string,
  ): { emit: boolean; impulse: number } {
    if (type === 'die-die') {
      if (impulse < DICE_COLLISION_THRESHOLD) {
        return { emit: false, impulse };
      }
    } else if (impulse < SURFACE_COLLISION_THRESHOLD) {
      return { emit: false, impulse };
    }

    if (frame - this.lastCollisionFrame < COLLISION_DEBOUNCE_STEPS) {
      if (this.lastCollisionType === 'die-die' || this.lastCollisionType === type) {
        return { emit: false, impulse };
      }
    }

    let finalImpulse = impulse;
    if (this.config?.muteSoundSecretRolls) {
      const secretA = this.diceBodies.get(bodyA)?.secretRoll ?? false;
      const secretB = bodyB ? this.diceBodies.get(bodyB)?.secretRoll ?? false : false;
      if (secretA || secretB) {
        finalImpulse = 0;
      }
    }

    return { emit: true, impulse: finalImpulse };
  }

  private getContactPoint(colliderHandleA: number, colliderHandleB: number): Vec3 {
    const colliderA = this.world!.getCollider(colliderHandleA);
    const colliderB = this.world!.getCollider(colliderHandleB);

    let point: Vec3 | null = null;

    this.world!.contactPair(colliderA, colliderB, (manifold) => {
      if (point) return;

      if (manifold.numSolverContacts() > 0) {
        const p = manifold.solverContactPoint(0);
        point = { x: p.x, y: p.y, z: p.z };
      }
    });

    if (point) {
      return point;
    }

    const posA = colliderA.translation();
    const posB = colliderB.translation();

    return {
      x: (posA.x + posB.x) / 2,
      y: (posA.y + posB.y) / 2,
      z: (posA.z + posB.z) / 2,
    };
  }

  private collectCollisionEvents(frame: number, collisions: CollisionEvent[]): void {
    this.eventQueue!.drainContactForceEvents((event) => {
      const colliderA = event.collider1();
      const colliderB = event.collider2();
      const classified = this.classifyCollision(colliderA, colliderB);
      if (!classified) return;

      const thresholded = this.shouldEmitCollision(
        frame,
        classified.type,
        event.totalForceMagnitude(),
        classified.bodyA,
        classified.bodyB,
      );
      if (!thresholded.emit) return;

      collisions.push({
        frame,
        type: classified.type,
        bodyA: classified.bodyA,
        bodyB: classified.bodyB,
        contactPoint: this.getContactPoint(colliderA, colliderB),
        impulse: thresholded.impulse,
      });

      this.lastCollisionFrame = frame;
      this.lastCollisionType = classified.type;
    });
  }

  private computeResults(orderedIds: string[]): PhysicsDieResult[] {
    const results: PhysicsDieResult[] = [];

    for (const id of orderedIds) {
      const state = this.diceBodies.get(id);
      if (!state) continue;

      const value = this.resolveFaceValue(state);
      results.push({
        id,
        type: state.type,
        value,
      });
    }

    return results;
  }

  private resolveFaceValue(state: DiceBodyState): number {
    if (state.shape === 'd2') {
      const axis = rotateVectorByQuat({ x: 0, y: 1, z: 0 }, state.body.rotation());
      return axis.z >= 0 ? 2 : 1;
    }

    const normals = this.getFaceNormals(state.shape);
    if (normals.length === 0) {
      return 0;
    }

    const desiredDirection = state.shape === 'd4'
      ? { x: 0, y: 0, z: -1 }
      : { x: 0, y: 0, z: 1 };

    let bestValue = normals[0].value;
    let bestDot = -Number.MAX_VALUE;

    const rotation = state.body.rotation();

    for (const face of normals) {
      const worldNormal = rotateVectorByQuat(face.normal, rotation);
      const score = dot(worldNormal, desiredDirection);
      if (score > bestDot) {
        bestDot = score;
        bestValue = face.value;
      }
    }

    if (state.type === 'd100') {
      if (bestValue === 10) {
        return 0;
      }
      return bestValue * 10;
    }

    return bestValue;
  }

  private getFaceNormals(shape: DieShape): ShapeFaceNormal[] {
    const cached = this.faceNormalCache.get(shape);
    if (cached) {
      return cached;
    }

    const definition = DICE_SHAPE_DEFINITIONS[shape];
    if (definition.type !== 'ConvexPolyhedron') {
      this.faceNormalCache.set(shape, []);
      return [];
    }

    const normals: ShapeFaceNormal[] = [];

    for (let faceIndex = 0; faceIndex < definition.faces.length; faceIndex += 1) {
      const value = definition.faceValues[faceIndex] ?? 0;
      if (value === 0) continue;

      const indices = getFaceIndices(definition.faces[faceIndex], definition.skipLastFaceIndex);
      if (indices.length < 3) continue;

      const aTuple = definition.vertices[indices[0]];
      const bTuple = definition.vertices[indices[1]];
      const cTuple = definition.vertices[indices[2]];

      const a = { x: aTuple[0], y: aTuple[1], z: aTuple[2] };
      const b = { x: bTuple[0], y: bTuple[1], z: bTuple[2] };
      const c = { x: cTuple[0], y: cTuple[1], z: cTuple[2] };

      const normal = normalize(cross(subtract(b, a), subtract(c, a)));
      normals.push({ value, normal });
    }

    this.faceNormalCache.set(shape, normals);
    return normals;
  }

  private findClosestActiveBody(position: Vec3): DiceBodyState | null {
    let closest: DiceBodyState | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const state of this.diceBodies.values()) {
      if (!state.body.isEnabled()) {
        continue;
      }

      const bodyPos = state.body.translation();
      const dx = bodyPos.x - position.x;
      const dy = bodyPos.y - position.y;
      const dz = bodyPos.z - position.z;
      const distance = dx * dx + dy * dy + dz * dz;

      if (distance < bestDistance) {
        bestDistance = distance;
        closest = state;
      }
    }

    return closest;
  }
}
