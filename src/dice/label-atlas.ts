import type { FaceUvLayout } from './geometry-registry.js';

export interface LabelAtlasRequest {
  key: string;
  labels: (string | string[])[];
  faceValues: number[];
  layout: FaceUvLayout;
  fontFamily: string;
  foreground: string;
  outline: string;
  cellSize?: number;
}

export class LabelAtlasBuilder {
  private readonly cache = new Map<string, Promise<HTMLCanvasElement>>();

  async build(request: LabelAtlasRequest): Promise<HTMLCanvasElement> {
    if (!this.cache.has(request.key)) {
      this.cache.set(request.key, this.renderAtlas(request));
    }
    return this.cache.get(request.key) as Promise<HTMLCanvasElement>;
  }

  clear(): void {
    this.cache.clear();
  }

  private async renderAtlas(request: LabelAtlasRequest): Promise<HTMLCanvasElement> {
    const cellSize = request.cellSize ?? 256;
    const width = request.layout.columns * cellSize;
    const height = request.layout.rows * cellSize;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Failed to create 2D context for label atlas');
    }

    context.clearRect(0, 0, width, height);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineJoin = 'round';

    await this.preloadFont(request.fontFamily, cellSize);

    const faceCount = request.layout.faceCount;
    for (let faceIndex = 0; faceIndex < faceCount; faceIndex += 1) {
      const col = faceIndex % request.layout.columns;
      const row = Math.floor(faceIndex / request.layout.columns);
      const x = col * cellSize;
      const y = row * cellSize;

      const label = this.pickLabel(request.labels, request.faceValues, faceIndex);
      if (!label) continue;

      if (looksLikeImagePath(label)) {
        const drewImage = await this.drawImageLabel(context, label, x, y, cellSize);
        if (drewImage) continue;
      }

      this.drawTextLabel(context, label, x, y, cellSize, request.foreground, request.outline, request.fontFamily);
    }

    return canvas;
  }

  private pickLabel(labels: (string | string[])[], faceValues: number[], faceIndex: number): string {
    const direct = labels[faceIndex];
    if (Array.isArray(direct)) {
      return direct.find((entry) => typeof entry === 'string' && entry.length > 0) ?? '';
    }
    if (typeof direct === 'string' && direct.length > 0) {
      return direct;
    }

    const faceValue = faceValues[faceIndex] ?? faceIndex + 1;
    return String(faceValue);
  }

  private async drawImageLabel(
    context: CanvasRenderingContext2D,
    source: string,
    x: number,
    y: number,
    cellSize: number,
  ): Promise<boolean> {
    const image = await loadImage(source);
    if (!image) return false;

    const inset = Math.floor(cellSize * 0.12);
    const size = cellSize - inset * 2;
    context.drawImage(image, x + inset, y + inset, size, size);
    return true;
  }

  private drawTextLabel(
    context: CanvasRenderingContext2D,
    label: string,
    x: number,
    y: number,
    cellSize: number,
    foreground: string,
    outline: string,
    fontFamily: string,
  ): void {
    const fontSize = Math.floor(cellSize * 0.58);
    context.font = `700 ${fontSize}px ${fontFamily}`;

    if (outline && outline !== 'none') {
      context.strokeStyle = outline;
      context.lineWidth = Math.max(3, Math.floor(cellSize * 0.055));
      context.strokeText(label, x + cellSize / 2, y + cellSize / 2);
    }

    context.fillStyle = foreground || '#ffffff';
    context.fillText(label, x + cellSize / 2, y + cellSize / 2);
  }

  private async preloadFont(fontFamily: string, cellSize: number): Promise<void> {
    if (!('fonts' in document)) return;
    try {
      await document.fonts.load(`700 ${Math.floor(cellSize * 0.58)}px ${fontFamily}`);
    } catch {
      // Ignore font loading failures and draw using fallback font.
    }
  }
}

function looksLikeImagePath(label: string): boolean {
  if (label.startsWith('data:image/')) return true;
  return /\.(webp|png|jpg|jpeg|gif|svg)$/i.test(label);
}

async function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}
