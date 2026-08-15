/**
 * @file webgpu-mock.ts
 * @brief Mock WebGPU API for unit testing renderers in jsdom.
 * Provides stub implementations of GPUDevice, GPUBuffer, GPUShaderModule,
 * GPURenderPipeline, GPUBindGroup, GPUCommandEncoder, and GPURenderPassEncoder.
 */

// ── GPU Constants ──
// These are normally provided by the browser; define them for jsdom.
const GPU_CONSTANTS = {
  // Buffer usage flags
  MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8,
  INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128,
  INDIRECT: 256, QUERY_RESOLVE: 512,

  // Texture usage flags
  TEXTURE_COPY_SRC: 1, TEXTURE_COPY_DST: 2,
  TEXTURE_BINDING: 4, STORAGE_BINDING: 8,
  RENDER_ATTACHMENT: 16,

  // Map mode
  READ: 1, WRITE: 2,

  // Color writes
  COLOR_WRITE_RED: 1, COLOR_WRITE_GREEN: 2,
  COLOR_WRITE_BLUE: 4, COLOR_WRITE_ALPHA: 8,
};

// Install GPU constants on globalThis if not already present
function installGPUConstants() {
  const targets = [
    'GPUBufferUsage', 'GPUTextureUsage', 'GPUMapMode',
    'GPUColorWrite', 'GPUShaderStage',
  ];
  for (const name of targets) {
    if (!(globalThis as any)[name]) {
      (globalThis as any)[name] = GPU_CONSTANTS;
    }
  }
}

installGPUConstants();

// ── Mock HTMLCanvasElement.prototype.getContext ──
// jsdom doesn't implement canvas getContext by default. We provide mock
// implementations for 'webgpu' and '2d' contexts so renderers that create
// their own internal canvases (e.g. GridLabelRenderer's text atlas) work.
const originalGetContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (type: string, ...args: any[]): any {
  if (type === 'webgpu') {
    return {
      configure: (_config: unknown) => {},
      unconfigure: () => {},
      getCurrentTexture: () => new MockGPUTexture({
        size: { width: (this as HTMLCanvasElement).width || 100, height: (this as HTMLCanvasElement).height || 100 },
        format: 'bgra8unorm',
        usage: 16,
      }),
    };
  }
  if (type === '2d') {
    return {
      fillStyle: '', font: '', textAlign: '', textBaseline: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1,
      fillRect: () => {}, strokeRect: () => {}, clearRect: () => {},
      fillText: () => {}, strokeText: () => {},
      measureText: () => ({ width: 10, actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 0 }),
      drawImage: () => {},
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4), width: w, height: h,
      }),
      putImageData: () => {},
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      beginPath: () => {}, closePath: () => {},
      moveTo: () => {}, lineTo: () => {},
      stroke: () => {}, fill: () => {}, arc: () => {}, rect: () => {},
      save: () => {}, restore: () => {},
      translate: () => {}, rotate: () => {}, scale: () => {},
      setTransform: () => {}, transform: () => {},
      clip: () => {},
      createLinearGradient: () => ({ addColorStop: () => {} }),
      createRadialGradient: () => ({ addColorStop: () => {} }),
    };
  }
  // Fall back to original for any other context types
  if (originalGetContext) {
    return originalGetContext.call(this, type as any, ...args);
  }
  return null;
} as any;

export class MockGPUBuffer implements GPUBuffer {
  size: number;
  usage: GPUBufferUsageFlags;
  mapState: 'unmapped' | 'pending' | 'mapped' = 'unmapped';
  label: string = '';
  private data: ArrayBuffer;

  constructor(descriptor: GPUBufferDescriptor) {
    this.size = descriptor.size;
    this.usage = descriptor.usage;
    this.data = new ArrayBuffer(this.size);
  }

  getMappedRange(offset: number = 0, size?: number): ArrayBuffer {
    return this.data.slice(offset, size ? offset + size : undefined);
  }

  mapAsync(_mode: GPUMapModeFlags, _offset: number = 0, _size?: number): Promise<void> {
    this.mapState = 'mapped';
    return Promise.resolve();
  }

  unmap(): void {
    this.mapState = 'unmapped';
  }

  destroy(): void {
    this.data = new ArrayBuffer(0);
  }
}

export class MockGPUShaderModule implements GPUShaderModule {
  label: string = '';
  compilationInfo(): Promise<GPUCompilationInfo> {
    return Promise.resolve({ messages: [] });
  }
}

export class MockGPUPipelineLayout implements GPUPipelineLayout {
  label: string = '';
}

export class MockGPUBindGroupLayout implements GPUBindGroupLayout {
  label: string = '';
  entries: GPUBindGroupLayoutEntry[];

  constructor(entries: GPUBindGroupLayoutEntry[]) {
    this.entries = entries;
  }
}

export class MockGPUBindGroup implements GPUBindGroup {
  label: string = '';
}

export class MockGPURenderPipeline implements GPURenderPipeline {
  label: string = '';
  private bindGroupLayouts: MockGPUBindGroupLayout[];

  constructor(bindGroupLayouts: MockGPUBindGroupLayout[] = []) {
    this.bindGroupLayouts = bindGroupLayouts;
  }

  getBindGroupLayout(index: number): GPUBindGroupLayout {
    return this.bindGroupLayouts[index] ?? new MockGPUBindGroupLayout([]);
  }
}

export class MockGPUSampler implements GPUSampler {
  label: string = '';
}

export class MockGPUTexture implements GPUTexture {
  width: number;
  height: number;
  depthOrArrayLayers: number;
  mipLevelCount: number;
  sampleCount: number;
  dimension: GPUTextureDimension;
  format: GPUTextureFormat;
  usage: GPUTextureUsageFlags;
  label: string = '';

  constructor(descriptor: GPUTextureDescriptor) {
    this.width = descriptor.size instanceof Array ? descriptor.size[0] : (descriptor.size as GPUExtentObject).width;
    this.height = descriptor.size instanceof Array ? descriptor.size[1] : (descriptor.size as GPUExtentObject).height;
    this.depthOrArrayLayers = descriptor.size instanceof Array ? descriptor.size[2] : (descriptor.size as GPUExtentObject).depthOrArrayLayers ?? 1;
    this.mipLevelCount = descriptor.mipLevelCount ?? 1;
    this.sampleCount = descriptor.sampleCount ?? 1;
    this.dimension = descriptor.dimension ?? '2d';
    this.format = descriptor.format;
    this.usage = descriptor.usage;
  }

  createView(_descriptor?: GPUTextureViewDescriptor): GPUTextureView {
    return new MockGPUTextureView();
  }

  destroy(): void {}
}

export class MockGPUTextureView implements GPUTextureView {
  label: string = '';
}

export class MockGPURenderPassEncoder implements GPURenderPassEncoder {
  label: string = '';
  private vertexBuffers: Map<number, GPUBuffer> = new Map();
  private bindGroups: Map<number, GPUBindGroup> = new Map();
  private drawCalls: { vertexCount: number; instanceCount: number; firstVertex: number; firstInstance: number }[] = [];
  private indexedDrawCalls: { indexCount: number; instanceCount: number; firstIndex: number; baseVertex: number; firstInstance: number }[] = [];
  private pipelines: GPURenderPipeline[] = [];

  setPipeline(pipeline: GPURenderPipeline): void {
    this.pipelines.push(pipeline);
  }

  setBindGroup(index: number, bindGroup: GPUBindGroup, _dynamicOffsets?: number[]): void {
    this.bindGroups.set(index, bindGroup);
  }

  setVertexBuffer(slot: number, buffer: GPUBuffer, _offset?: number): void {
    this.vertexBuffers.set(slot, buffer);
  }

  draw(vertexCount: number, instanceCount: number = 1, firstVertex: number = 0, firstInstance: number = 0): void {
    this.drawCalls.push({ vertexCount, instanceCount, firstVertex, firstInstance });
  }

  drawIndexed(indexCount: number, instanceCount: number = 1, firstIndex: number = 0, baseVertex: number = 0, firstInstance: number = 0): void {
    this.indexedDrawCalls.push({ indexCount, instanceCount, firstIndex, baseVertex, firstInstance });
    // Also record as a regular draw call so getDrawCalls() captures it
    this.drawCalls.push({ vertexCount: indexCount, instanceCount, firstVertex: firstIndex, firstInstance });
  }

  setIndexBuffer(_buffer: GPUBuffer, _indexFormat: GPUIndexFormat, _offset?: number, _size?: number): void {}

  setViewport(_x: number, _y: number, _width: number, _height: number, _minDepth: number, _maxDepth: number): void {}
  setScissorRect(_x: number, _y: number, _width: number, _height: number): void {}
  setBlendConstant(_color: GPUColor): void {}
  setStencilReference(_ref: number): void {}

  beginOcclusionQuery(_queryIndex: number): void {}
  endOcclusionQuery(): void {}

  executeBundles(_bundles: GPURenderBundle[]): void {}

  end(): void {}

  // Getters for test assertions
  getDrawCalls() { return this.drawCalls; }
  getIndexedDrawCalls() { return this.indexedDrawCalls; }
  getVertexBuffers() { return this.vertexBuffers; }
  getBindGroups() { return this.bindGroups; }
  getPipelines() { return this.pipelines; }
}

export class MockGPUCommandEncoder implements GPUCommandEncoder {
  label: string = '';

  beginRenderPass(descriptor: GPURenderPassDescriptor): GPURenderPassEncoder {
    return new MockGPURenderPassEncoder();
  }

  beginComputePass(_descriptor?: GPUComputePassDescriptor): GPUComputePassEncoder {
    return new MockGPUComputePassEncoder();
  }

  copyBufferToBuffer(source: GPUBuffer, sourceOffset: number, destination: GPUBuffer, destinationOffset: number, size: number): void {}
  copyBufferToTexture(_source: GPUImageCopyBuffer, _destination: GPUImageCopyTexture, _copySize: GPUExtent3D): void {}
  copyTextureToBuffer(_source: GPUImageCopyTexture, _destination: GPUImageCopyBuffer, _copySize: GPUExtent3D): void {}
  copyTextureToTexture(_source: GPUImageCopyTexture, _destination: GPUImageCopyTexture, _copySize: GPUExtent3D): void {}

  clearBuffer(_buffer: GPUBuffer, _offset?: number, _size?: number): void {}

  resolveQuerySet(_querySet: GPUQuerySet, _firstQuery: number, _queryCount: number, _destination: GPUBuffer, _destinationOffset: number): void {}

  finish(_descriptor?: GPUCommandBufferDescriptor): GPUCommandBuffer {
    return new MockGPUCommandBuffer();
  }

  pushDebugGroup(_groupLabel: string): void {}
  popDebugGroup(): void {}
  insertDebugMarker(_markerLabel: string): void {}
}

export class MockGPUComputePassEncoder implements GPUComputePassEncoder {
  label: string = '';
  setPipeline(_pipeline: GPUComputePipeline): void {}
  setBindGroup(_index: number, _bindGroup: GPUBindGroup, _dynamicOffsets?: number[]): void {}
  dispatchWorkgroups(_x: number, _y?: number, _z?: number): void {}
  dispatchWorkgroupsIndirect(_indirectBuffer: GPUBuffer, _indirectOffset: number): void {}
  end(): void {}
  pushDebugGroup(_groupLabel: string): void {}
  popDebugGroup(): void {}
  insertDebugMarker(_markerLabel: string): void {}
}

export class MockGPUCommandBuffer implements GPUCommandBuffer {
  label: string = '';
}

export class MockGPUQueue implements GPUQueue {
  label: string = '';
  submitted: GPUCommandBuffer[] = [];

  submit(commandBuffers: GPUCommandBuffer[]): void {
    this.submitted.push(...commandBuffers);
  }

  writeBuffer(buffer: GPUBuffer, offset: number, data: BufferSource, dataOffset?: number, size?: number): void {
    // No-op: just record that data was written
    if (buffer instanceof MockGPUBuffer) {
      const arr = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      // Simulate write
      void arr; void offset; void dataOffset; void size;
    }
  }

  copyTextureToTexture(_source: GPUImageCopyTexture, _destination: GPUImageCopyTexture, _copySize: GPUExtent3D): void {}

  copyExternalImageToTexture(_source: unknown, _destination: GPUImageCopyTexture, _copySize: GPUExtent3D): void {}

  writeTexture(_destination: GPUImageCopyTexture, _data: BufferSource, _dataLayout: GPUImageDataLayout, _size: GPUExtent3D): void {}

  onSubmittedWorkDone(): Promise<void> {
    return Promise.resolve();
  }
}

export class MockGPUDevice implements GPUDevice {
  queue: MockGPUQueue = new MockGPUQueue();
  label: string = '';
  lost: Promise<GPUDeviceLostInfo> = Promise.resolve({ message: '', reason: 'unknown' } as GPUDeviceLostInfo);
  pushErrorScope(_filter: GPUErrorFilter): void {}
  popErrorScope(): Promise<GPUError | null> { return Promise.resolve(null); }
  features: GPUSupportedFeatures = new Set() as GPUSupportedFeatures;
  limits: GPUSupportedLimits = {} as GPUSupportedLimits;
  adapterInfo: GPUAdapterInfo = {} as GPUAdapterInfo;

  createBuffer(descriptor: GPUBufferDescriptor): MockGPUBuffer {
    return new MockGPUBuffer(descriptor);
  }

  createBufferMapped(_descriptor: GPUBufferDescriptor): [MockGPUBuffer, ArrayBuffer] {
    const buf = new MockGPUBuffer(_descriptor);
    return [buf, buf.getMappedRange()];
  }

  createTexture(descriptor: GPUTextureDescriptor): MockGPUTexture {
    return new MockGPUTexture(descriptor);
  }

  createSampler(_descriptor: GPUSamplerDescriptor): MockGPUSampler {
    return new MockGPUSampler();
  }

  createBindGroupLayout(descriptor: GPUBindGroupLayoutDescriptor): MockGPUBindGroupLayout {
    return new MockGPUBindGroupLayout(descriptor.entries);
  }

  createPipelineLayout(_descriptor: GPUPipelineLayoutDescriptor): MockGPUPipelineLayout {
    return new MockGPUPipelineLayout();
  }

  createBindGroup(_descriptor: GPUBindGroupDescriptor): MockGPUBindGroup {
    return new MockGPUBindGroup();
  }

  createShaderModule(_descriptor: GPUShaderModuleDescriptor): MockGPUShaderModule {
    return new MockGPUShaderModule();
  }

  createRenderPipeline(descriptor: GPURenderPipelineDescriptor): MockGPURenderPipeline {
    const layouts: MockGPUBindGroupLayout[] = [];
    if (descriptor.layout instanceof MockGPUPipelineLayout) {
      // Extract bind group layouts if available
    }
    return new MockGPURenderPipeline(layouts);
  }

  createRenderPipelineAsync(descriptor: GPURenderPipelineDescriptor): Promise<MockGPURenderPipeline> {
    return Promise.resolve(this.createRenderPipeline(descriptor));
  }

  createComputePipeline(_descriptor: GPUComputePipelineDescriptor): GPUComputePipeline {
    return {} as GPUComputePipeline;
  }

  createComputePipelineAsync(_descriptor: GPUComputePipelineDescriptor): Promise<GPUComputePipeline> {
    return Promise.resolve({} as GPUComputePipeline);
  }

  createCommandEncoder(_descriptor?: GPUCommandEncoderDescriptor): MockGPUCommandEncoder {
    return new MockGPUCommandEncoder();
  }

  createQuerySet(_descriptor: GPUQuerySetDescriptor): GPUQuerySet {
    return {} as GPUQuerySet;
  }

  destroy(): void {}
}

export class MockGPUAdapter implements GPUAdapter {
  info: GPUAdapterInfo = {} as GPUAdapterInfo;
  features: GPUSupportedFeatures = new Set() as GPUSupportedFeatures;
  limits: GPUSupportedLimits = {} as GPUSupportedLimits;
  isFallbackAdapter: boolean = false;

  requestDevice(_descriptor?: GPUDeviceDescriptor): Promise<MockGPUDevice> {
    return Promise.resolve(new MockGPUDevice());
  }

  requestAdapterInfo(): Promise<GPUAdapterInfo> {
    return Promise.resolve(this.info);
  }
}

/**
 * Create a mock GPUDevice for testing.
 */
export function createMockDevice(): MockGPUDevice {
  return new MockGPUDevice();
}

/**
 * Create a mock GPURenderPassEncoder for testing render() methods.
 */
export function createMockRenderPass(): MockGPURenderPassEncoder {
  return new MockGPURenderPassEncoder();
}

/**
 * Set up navigator.gpu mock for tests that call navigator.gpu.requestAdapter().
 */
export function setupNavigatorGPU(device?: MockGPUDevice): void {
  const mockDevice = device ?? createMockDevice();
  const mockAdapter = new MockGPUAdapter();
  mockAdapter.requestDevice = () => Promise.resolve(mockDevice);
  Object.defineProperty(navigator, 'gpu', {
    value: {
      requestAdapter: () => Promise.resolve(mockAdapter),
      getPreferredCanvasFormat: () => 'bgra8unorm' as GPUTextureFormat,
    },
    writable: true,
    configurable: true,
  });
}
