import {
  CanvasTexture,
  LinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three/webgpu';

import type { TextureDefinition } from '../types/appearance.js';
import { normalizeCompositeOperation } from './textures.js';

interface AtlasFrameRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface AtlasFrame {
  frame: AtlasFrameRect;
}

interface AtlasResource {
  image: HTMLImageElement;
  frames: Record<string, AtlasFrame>;
}

export interface ComposeTextureRequest {
  cacheKey: string;
  baseColor: string;
  texture: TextureDefinition | null;
  labelAtlas: HTMLCanvasElement;
}

export interface CompositedTextures {
  map: Texture;
  bumpMap: Texture | null;
}

export interface TextureCompositorOptions {
  anisotropy?: number;
}

export class TextureCompositor {
  private readonly anisotropy: number;
  private readonly atlasCache = new Map<string, Promise<AtlasResource | null>>();
  private readonly imageCache = new Map<string, Promise<HTMLImageElement | null>>();
  private readonly textureCache = new Map<string, CompositedTextures>();

  constructor(options: TextureCompositorOptions = {}) {
    this.anisotropy = Math.max(1, options.anisotropy ?? 1);
  }

  async compose(request: ComposeTextureRequest): Promise<CompositedTextures> {
    const cached = this.textureCache.get(request.cacheKey);
    if (cached) return cached;

    const { canvas, context } = createCanvas(request.labelAtlas.width, request.labelAtlas.height);
    context.fillStyle = request.baseColor || '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);

    if (request.texture) {
      await this.drawTextureLayer(context, request.texture, canvas.width, canvas.height);
    }

    context.globalCompositeOperation = 'source-over';
    context.drawImage(request.labelAtlas, 0, 0, canvas.width, canvas.height);

    const map = new CanvasTexture(canvas);
    map.colorSpace = SRGBColorSpace;
    map.wrapS = RepeatWrapping;
    map.wrapT = RepeatWrapping;
    map.magFilter = LinearFilter;
    map.minFilter = LinearFilter;
    map.anisotropy = this.anisotropy;
    map.needsUpdate = true;

    let bumpMap: Texture | null = null;
    if (request.texture?.bump) {
      bumpMap = await this.createBumpMap(request.texture, canvas.width, canvas.height);
    }

    const composed: CompositedTextures = { map, bumpMap };
    this.textureCache.set(request.cacheKey, composed);
    return composed;
  }

  dispose(): void {
    for (const entry of this.textureCache.values()) {
      entry.map.dispose();
      entry.bumpMap?.dispose();
    }
    this.textureCache.clear();
    this.atlasCache.clear();
    this.imageCache.clear();
  }

  private async drawTextureLayer(
    context: CanvasRenderingContext2D,
    texture: TextureDefinition,
    width: number,
    height: number,
  ): Promise<void> {
    const source = texture.source;
    if (!source) return;

    context.globalCompositeOperation = normalizeCompositeOperation(texture.composite);

    if (texture.atlas) {
      const atlas = await this.loadAtlas(texture.atlas);
      if (atlas) {
        const frame = atlas.frames[source]?.frame;
        if (frame) {
          context.drawImage(
            atlas.image,
            frame.x,
            frame.y,
            frame.w,
            frame.h,
            0,
            0,
            width,
            height,
          );
          return;
        }
      }
    }

    const image = await this.loadImage(source);
    if (image) {
      context.drawImage(image, 0, 0, width, height);
    }
  }

  private async createBumpMap(
    texture: TextureDefinition,
    width: number,
    height: number,
  ): Promise<Texture | null> {
    const bumpSource = texture.bump;
    if (!bumpSource) return null;

    const { canvas, context } = createCanvas(width, height);

    if (texture.atlas) {
      const atlas = await this.loadAtlas(texture.atlas);
      const frame = atlas?.frames[bumpSource]?.frame;
      if (atlas && frame) {
        context.drawImage(
          atlas.image,
          frame.x,
          frame.y,
          frame.w,
          frame.h,
          0,
          0,
          width,
          height,
        );
      }
    }

    if (!hasNonTransparentPixels(context, width, height)) {
      const image = await this.loadImage(bumpSource);
      if (image) {
        context.drawImage(image, 0, 0, width, height);
      }
    }

    if (!hasNonTransparentPixels(context, width, height)) {
      return null;
    }

    const bumpMap = new CanvasTexture(canvas);
    bumpMap.wrapS = RepeatWrapping;
    bumpMap.wrapT = RepeatWrapping;
    bumpMap.magFilter = LinearFilter;
    bumpMap.minFilter = LinearFilter;
    bumpMap.anisotropy = this.anisotropy;
    bumpMap.needsUpdate = true;
    return bumpMap;
  }

  private async loadAtlas(url: string): Promise<AtlasResource | null> {
    if (!this.atlasCache.has(url)) {
      this.atlasCache.set(url, this.readAtlas(url));
    }
    return this.atlasCache.get(url) as Promise<AtlasResource | null>;
  }

  private async readAtlas(url: string): Promise<AtlasResource | null> {
    try {
      const response = await fetch(url);
      if (!response.ok) return null;

      const data = (await response.json()) as {
        frames?: Record<string, AtlasFrame>;
        meta?: { image?: string };
      };

      const frames = data.frames ?? {};
      const imagePath = data.meta?.image;
      if (!imagePath) return null;

      const imageUrl = resolveRelativeUrl(url, imagePath);
      const image = await this.loadImage(imageUrl);
      if (!image) return null;

      return { image, frames };
    } catch {
      return null;
    }
  }

  private async loadImage(url: string): Promise<HTMLImageElement | null> {
    if (!this.imageCache.has(url)) {
      this.imageCache.set(url, readImage(url));
    }
    return this.imageCache.get(url) as Promise<HTMLImageElement | null>;
  }
}

function createCanvas(width: number, height: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Failed to create 2D context for texture composition');
  }

  return { canvas, context };
}

async function readImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

function resolveRelativeUrl(base: string, relative: string): string {
  if (/^(https?:|data:|blob:|modules\/)/i.test(relative)) {
    return relative;
  }
  const idx = base.lastIndexOf('/');
  if (idx === -1) return relative;
  return `${base.slice(0, idx + 1)}${relative}`;
}

function hasNonTransparentPixels(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
): boolean {
  const data = context.getImageData(0, 0, width, height).data;
  for (let i = 3; i < data.length; i += 4) {
    if ((data[i] ?? 0) > 0) return true;
  }
  return false;
}
