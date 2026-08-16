/**
 * Vitest mock for ChartGPU. The real library bundles a large WebGPU module
 * and is not needed in unit tests; WebGPUApp tests only need the import to
 * resolve without throwing.
 */

export interface ChartGPUInstance {
  readonly options: unknown;
  readonly disposed: boolean;
  setOption(_options: unknown): void;
  setZoomRange(_start: number, _end: number, _source?: unknown): void;
  getZoomRange(): { start: number; end: number } | null;
  resize(): void;
  renderFrame(): boolean;
  dispose(): void;
  on(_eventName: string, _callback: (..._args: unknown[]) => void): void;
}

export interface ChartGPUOptions {
  [key: string]: unknown;
}

export interface SeriesConfig {
  [key: string]: unknown;
}

export interface AnnotationConfig {
  [key: string]: unknown;
}

export interface PipelineCache {
  readonly device: GPUDevice;
  clear(): void;
  getStats(): unknown;
}

export function createPipelineCache(_device: GPUDevice): PipelineCache {
  return {
    device: _device,
    clear: () => {},
    getStats: () => ({}),
  };
}

export const ChartGPU = {
  async create(
    _container: HTMLElement,
    _options: unknown,
    _context?: { device?: GPUDevice; adapter?: GPUAdapter; pipelineCache?: PipelineCache }
  ): Promise<ChartGPUInstance> {
    return {
      options: {},
      disposed: false,
      setOption: () => {},
      setZoomRange: () => {},
      getZoomRange: () => null,
      resize: () => {},
      renderFrame: () => false,
      dispose: () => {},
      on: () => {},
    };
  },
};
