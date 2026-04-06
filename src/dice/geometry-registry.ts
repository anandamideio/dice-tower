import {
  BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Vector3,
} from 'three/webgpu';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import {
  DICE_SHAPE_DEFINITIONS,
  getFaceIndices,
  type DiceShapeDefinition,
} from '../physics/dice-shape-definitions.js';
import type { DieShape } from '../types/dice.js';

export interface FaceUvSlot {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export interface FaceUvLayout {
  faceCount: number;
  columns: number;
  rows: number;
  padding: number;
  slots: FaceUvSlot[];
}

export interface DiceGeometryData {
  geometry: BufferGeometry;
  faceValues: number[];
  layout: FaceUvLayout;
}

export interface GeometryRegistryOptions {
  dracoDecoderPath?: string;
}

interface GeometryLookupOptions {
  modelFile?: string | null;
  expectedFaceCount?: number;
}

export class GeometryRegistry {
  private readonly geometryCache = new Map<string, DiceGeometryData>();
  private readonly gltfGeometryCache = new Map<string, Promise<BufferGeometry | null>>();
  private readonly dracoDecoderPath: string;

  constructor(options: GeometryRegistryOptions = {}) {
    this.dracoDecoderPath = options.dracoDecoderPath ?? 'modules/dice-tower/assets/models/draco/';
  }

  async getGeometry(shape: DieShape, options: GeometryLookupOptions = {}): Promise<DiceGeometryData> {
    const modelFile = options.modelFile ?? null;
    if (modelFile) {
      const cacheKey = `model:${modelFile}`;
      const cached = this.geometryCache.get(cacheKey);
      if (cached) return cached;

      const loadedGeometry = await this.loadGltfGeometry(modelFile);
      if (loadedGeometry) {
        const faceCount = Math.max(1, options.expectedFaceCount ?? DICE_SHAPE_DEFINITIONS[shape].faceValues.length);
        const data: DiceGeometryData = {
          geometry: loadedGeometry,
          faceValues: createFallbackFaceValues(faceCount),
          layout: createFaceUvLayout(faceCount),
        };
        this.geometryCache.set(cacheKey, data);
        return data;
      }
    }

    const cacheKey = `shape:${shape}`;
    const cached = this.geometryCache.get(cacheKey);
    if (cached) return cached;

    const definition = DICE_SHAPE_DEFINITIONS[shape];
    const data = definition.type === 'Cylinder'
      ? this.createCylinderGeometryData(definition)
      : createConvexGeometryData(definition);

    this.geometryCache.set(cacheKey, data);
    return data;
  }

  dispose(): void {
    for (const entry of this.geometryCache.values()) {
      entry.geometry.dispose();
    }
    this.geometryCache.clear();
    this.gltfGeometryCache.clear();
  }

  private createCylinderGeometryData(definition: DiceShapeDefinition): DiceGeometryData {
    if (definition.type !== 'Cylinder') {
      throw new Error('Cylinder geometry requested for non-cylinder shape definition');
    }

    const geometry = new CylinderGeometry(
      definition.radiusTop,
      definition.radiusBottom,
      definition.height,
      Math.max(16, definition.numSegments),
      1,
      false,
    )
      .rotateX(Math.PI / 2)
      .toNonIndexed();

    const positionAttr = geometry.getAttribute('position');
    const normalAttr = geometry.getAttribute('normal');
    const uvAttr = geometry.getAttribute('uv');
    const layout = createFaceUvLayout(2);

    for (let i = 0; i < uvAttr.count; i += 1) {
      const nz = normalAttr.getZ(i);
      const px = positionAttr.getX(i);
      const py = positionAttr.getY(i);

      if (Math.abs(nz) > 0.75) {
        const slot = nz > 0 ? layout.slots[0] : layout.slots[1];
        const radius = Math.max(definition.radiusTop, definition.radiusBottom, 1e-6);
        const u = (px / radius + 1) * 0.5;
        const v = (py / radius + 1) * 0.5;
        uvAttr.setXY(i, lerp(slot.u0, slot.u1, u), lerp(slot.v0, slot.v1, v));
      } else {
        const cylindricalU = (Math.atan2(py, px) + Math.PI) / (Math.PI * 2);
        const cylindricalV = (nz + definition.height * 0.5) / Math.max(definition.height, 1e-6);
        const sideSlot = layout.slots[0];
        uvAttr.setXY(
          i,
          lerp(sideSlot.u0, sideSlot.u1, cylindricalU),
          lerp(sideSlot.v0, sideSlot.v1, cylindricalV),
        );
      }
    }

    uvAttr.needsUpdate = true;

    return {
      geometry,
      faceValues: [1, 2],
      layout,
    };
  }

  private async loadGltfGeometry(modelFile: string): Promise<BufferGeometry | null> {
    if (!this.gltfGeometryCache.has(modelFile)) {
      this.gltfGeometryCache.set(
        modelFile,
        new Promise<BufferGeometry | null>((resolve) => {
          const loader = new GLTFLoader();
          const dracoLoader = new DRACOLoader();
          dracoLoader.setDecoderPath(this.dracoDecoderPath);
          loader.setDRACOLoader(dracoLoader);

          loader.load(
            modelFile,
            (gltf) => {
              let selected: BufferGeometry | null = null;
              gltf.scene.traverse((object) => {
                if (selected) return;
                const candidate = object as { isMesh?: boolean; geometry?: BufferGeometry };
                if (candidate.isMesh && candidate.geometry) {
                  selected = candidate.geometry.clone();
                }
              });

              if (!selected) {
                dracoLoader.dispose();
                resolve(null);
                return;
              }

              normalizeGeometry(selected);
              dracoLoader.dispose();
              resolve(selected);
            },
            undefined,
            () => {
              dracoLoader.dispose();
              resolve(null);
            },
          );
        }),
      );
    }

    return this.gltfGeometryCache.get(modelFile) ?? null;
  }
}

function createConvexGeometryData(definition: Extract<DiceShapeDefinition, { type: 'ConvexPolyhedron' }>): DiceGeometryData {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];

  const faceValues = [...definition.faceValues];
  const layout = createFaceUvLayout(definition.faces.length);

  for (let faceIndex = 0; faceIndex < definition.faces.length; faceIndex += 1) {
    const rawFace = definition.faces[faceIndex] ?? [];
    const vertexIndices = getFaceIndices(rawFace, definition.skipLastFaceIndex);
    if (vertexIndices.length < 3) continue;

    const vertices = vertexIndices.map((index) => toVector3(definition.vertices[index]));
    const faceCenter = new Vector3();
    for (const vertex of vertices) faceCenter.add(vertex);
    faceCenter.multiplyScalar(1 / vertices.length);

    let normal = new Vector3()
      .subVectors(vertices[1] ?? vertices[0], vertices[0])
      .cross(new Vector3().subVectors(vertices[2] ?? vertices[0], vertices[0]))
      .normalize();

    let orderedVertices = vertices;
    if (normal.dot(faceCenter) < 0) {
      orderedVertices = [...vertices].reverse();
      normal = normal.multiplyScalar(-1);
    }

    let tangent = new Vector3().subVectors(orderedVertices[0] ?? faceCenter, faceCenter);
    if (tangent.lengthSq() < 1e-8) {
      tangent = new Vector3(1, 0, 0);
      if (Math.abs(tangent.dot(normal)) > 0.95) {
        tangent.set(0, 1, 0);
      }
    }
    tangent.normalize();

    const bitangent = new Vector3().crossVectors(normal, tangent).normalize();

    const localCoordinates = orderedVertices.map((vertex) => {
      const delta = new Vector3().subVectors(vertex, faceCenter);
      return {
        x: delta.dot(tangent),
        y: delta.dot(bitangent),
      };
    });

    const radius = Math.max(
      1e-6,
      ...localCoordinates.map((coord) => Math.max(Math.abs(coord.x), Math.abs(coord.y))),
    );

    const slot = layout.slots[faceIndex] ?? layout.slots[0];

    for (let i = 1; i < orderedVertices.length - 1; i += 1) {
      const triVerts = [orderedVertices[0], orderedVertices[i], orderedVertices[i + 1]];
      const triLocals = [localCoordinates[0], localCoordinates[i], localCoordinates[i + 1]];

      for (let corner = 0; corner < 3; corner += 1) {
        const vertex = triVerts[corner] ?? orderedVertices[0];
        const local = triLocals[corner] ?? localCoordinates[0];

        positions.push(vertex.x, vertex.y, vertex.z);
        normals.push(normal.x, normal.y, normal.z);

        const nx = local.x / radius;
        const ny = local.y / radius;
        const faceU = clamp01((nx + 1) * 0.5);
        const faceV = clamp01((ny + 1) * 0.5);

        const padding = layout.padding;
        const u = lerp(slot.u0, slot.u1, padding + faceU * (1 - padding * 2));
        const v = lerp(slot.v0, slot.v1, padding + faceV * (1 - padding * 2));
        uvs.push(u, v);
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.computeBoundingSphere();

  return {
    geometry,
    faceValues,
    layout,
  };
}

function createFaceUvLayout(faceCount: number, padding = 0.08): FaceUvLayout {
  const safeFaceCount = Math.max(1, faceCount);
  const columns = Math.ceil(Math.sqrt(safeFaceCount));
  const rows = Math.ceil(safeFaceCount / columns);

  const slots: FaceUvSlot[] = [];
  for (let i = 0; i < safeFaceCount; i += 1) {
    const column = i % columns;
    const row = Math.floor(i / columns);
    const u0 = column / columns;
    const v0 = row / rows;
    const u1 = (column + 1) / columns;
    const v1 = (row + 1) / rows;
    slots.push({ u0, v0, u1, v1 });
  }

  return {
    faceCount: safeFaceCount,
    columns,
    rows,
    padding,
    slots,
  };
}

function toVector3(point: number[] | undefined): Vector3 {
  if (!point) return new Vector3();
  const [x = 0, y = 0, z = 0] = point;
  return new Vector3(x, y, z);
}

function normalizeGeometry(geometry: BufferGeometry): void {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return;

  const size = new Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z, 1e-6);

  const center = new Vector3();
  box.getCenter(center);
  geometry.translate(-center.x, -center.y, -center.z);

  const scale = 2 / maxDim;
  geometry.scale(scale, scale, scale);
  geometry.computeBoundingSphere();
  geometry.computeVertexNormals();
}

function createFallbackFaceValues(faceCount: number): number[] {
  return Array.from({ length: faceCount }, (_, index) => index + 1);
}

function lerp(min: number, max: number, t: number): number {
  return min + (max - min) * t;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
