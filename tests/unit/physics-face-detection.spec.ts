import { describe, expect, it } from 'vitest';

import { PhysicsEngine } from '../../src/physics/physics-engine.js';
import type { DieShape, DieType } from '../../src/types/dice.js';

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

function normalize(v: Vec3): Vec3 {
  const mag = Math.hypot(v.x, v.y, v.z);
  if (mag === 0) {
    return { x: 0, y: 0, z: 0 };
  }
  return { x: v.x / mag, y: v.y / mag, z: v.z / mag };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function quatFromAxisAngle(axis: Vec3, angle: number): Quat {
  const normalized = normalize(axis);
  const half = angle / 2;
  const sin = Math.sin(half);
  return {
    x: normalized.x * sin,
    y: normalized.y * sin,
    z: normalized.z * sin,
    w: Math.cos(half),
  };
}

function quatFromTo(from: Vec3, to: Vec3): Quat {
  const f = normalize(from);
  const t = normalize(to);
  const d = dot(f, t);

  if (d > 0.999999) {
    return { x: 0, y: 0, z: 0, w: 1 };
  }

  if (d < -0.999999) {
    const orthogonal = Math.abs(f.x) < 0.8
      ? normalize(cross(f, { x: 1, y: 0, z: 0 }))
      : normalize(cross(f, { x: 0, y: 1, z: 0 }));
    return quatFromAxisAngle(orthogonal, Math.PI);
  }

  const c = cross(f, t);
  const q = {
    x: c.x,
    y: c.y,
    z: c.z,
    w: 1 + d,
  };

  const mag = Math.hypot(q.x, q.y, q.z, q.w);
  return {
    x: q.x / mag,
    y: q.y / mag,
    z: q.z / mag,
    w: q.w / mag,
  };
}

function resolveFace(
  resolveFaceValue: (state: unknown) => number,
  shape: DieShape,
  type: DieType,
  rotation: Quat,
): number {
  return resolveFaceValue({
    shape,
    type,
    body: {
      rotation: () => rotation,
    },
  });
}

describe('PhysicsEngine face detection', () => {
  it('resolves both d2 sides from orientation', () => {
    const engine = new PhysicsEngine() as unknown as {
      resolveFaceValue: (state: unknown) => number;
    };

    const top = resolveFace(engine.resolveFaceValue.bind(engine), 'd2', 'd2', {
      x: 0,
      y: 0,
      z: 0,
      w: 1,
    });

    const bottom = resolveFace(
      engine.resolveFaceValue.bind(engine),
      'd2',
      'd2',
      quatFromAxisAngle({ x: 1, y: 0, z: 0 }, -Math.PI / 2),
    );

    expect(top).toBe(2);
    expect(bottom).toBe(1);
  });

  it('maps every convex die face to the expected value', () => {
    const engine = new PhysicsEngine() as unknown as {
      getFaceNormals: (shape: DieShape) => Array<{ value: number; normal: Vec3 }>;
      resolveFaceValue: (state: unknown) => number;
    };

    const cases: Array<{ shape: DieShape; type: DieType }> = [
      { shape: 'd4', type: 'd4' },
      { shape: 'd6', type: 'd6' },
      { shape: 'd8', type: 'd8' },
      { shape: 'd10', type: 'd10' },
      { shape: 'd12', type: 'd12' },
      { shape: 'd14', type: 'd14' },
      { shape: 'd16', type: 'd16' },
      { shape: 'd20', type: 'd20' },
      { shape: 'd24', type: 'd24' },
      { shape: 'd30', type: 'd30' },
      { shape: 'd10', type: 'd100' },
    ];

    for (const dieCase of cases) {
      const normals = engine.getFaceNormals(dieCase.shape);
      expect(normals.length).toBeGreaterThan(0);

      const target = dieCase.shape === 'd4'
        ? { x: 0, y: 0, z: -1 }
        : { x: 0, y: 0, z: 1 };

      for (const face of normals) {
        const rotation = quatFromTo(face.normal, target);
        const value = resolveFace(
          engine.resolveFaceValue.bind(engine),
          dieCase.shape,
          dieCase.type,
          rotation,
        );

        const expected = dieCase.type === 'd100'
          ? (face.value === 10 ? 0 : face.value * 10)
          : face.value;

        expect(value).toBe(expected);
      }
    }
  });
});
