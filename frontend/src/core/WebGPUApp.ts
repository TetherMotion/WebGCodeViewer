/**
 * @file WebGPUApp.ts
 * @brief Main WebGPU application orchestrating renderers, camera, and UI.
 */

import { Camera } from './Camera';
import { RpcClient } from './RpcClient';
import { ColorMap } from './ColorMap';
import { parseTTHR, TTHRData } from './TthrParser';
import { ToolpathRenderer, ColorAttribute } from '../renderers/ToolpathRenderer';
import { GridRenderer } from '../renderers/GridRenderer';
import { CrossSectionRenderer } from '../renderers/CrossSectionRenderer';
import { PointCloudRenderer } from '../renderers/PointCloudRenderer';
import { OverlayRenderer } from '../renderers/OverlayRenderer';
import { Toolbar } from '../ui/Toolbar';
import { TimeSlider } from '../ui/TimeSlider';
import { AttributePanel } from '../ui/AttributePanel';
import { SegmentList } from '../ui/SegmentList';
import { StatsPanel } from '../ui/StatsPanel';
import { FilterPanel } from '../ui/FilterPanel';
import { CutPlanePanel } from '../ui/CutPlanePanel';
import { MeasureTool } from '../ui/MeasureTool';
import { ComparisonPanel } from '../ui/ComparisonPanel';
import { ZLayerPanel } from '../ui/ZLayerPanel';

export class WebGPUApp {
  private canvas: HTMLCanvasElement;
  private device: GPUDevice | null = null;
  private context: GPUCanvasContext | null = null;
  private format: GPUTextureFormat = 'bgra8unorm';
  private depthTexture: GPUTexture | null = null;

  private camera: Camera;
  private rpcClient: RpcClient;

  private toolpathRenderer: ToolpathRenderer | null = null;
  private gridRenderer: GridRenderer | null = null;
  private crossSectionRenderer: CrossSectionRenderer | null = null;
  private pointCloudRenderer: PointCloudRenderer | null = null;
  private overlayRenderer: OverlayRenderer | null = null;

  private toolbar: Toolbar;
  private timeSlider: TimeSlider;
  private attributePanel: AttributePanel;
  private segmentList: SegmentList;
  private statsPanel: StatsPanel;
  private filterPanel: FilterPanel;
  private cutPlanePanel: CutPlanePanel;
  private measureTool: MeasureTool;
  private comparisonPanel: ComparisonPanel;
  private zLayerPanel: ZLayerPanel;

  private currentJobId: string | null = null;
  private currentData: TTHRData | null = null;
  private animationId: number | null = null;
  private lastFrameTime = 0;

  constructor(canvas: HTMLCanvasElement, rpcClient: RpcClient, uiContainer: HTMLElement) {
    this.canvas = canvas;
    this.rpcClient = rpcClient;
    this.camera = new Camera();

    // Build UI
    this.toolbar = new Toolbar(uiContainer);
    this.timeSlider = new TimeSlider(uiContainer);
    this.statsPanel = new StatsPanel(uiContainer);
    this.attributePanel = new AttributePanel(uiContainer);
    this.segmentList = new SegmentList(uiContainer);
    this.filterPanel = new FilterPanel(uiContainer);
    this.cutPlanePanel = new CutPlanePanel(uiContainer);
    this.measureTool = new MeasureTool(uiContainer);
    this.comparisonPanel = new ComparisonPanel(uiContainer);
    this.zLayerPanel = new ZLayerPanel(uiContainer);

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.toolbar.on('uploadFile', (file) => this.handleUpload(file));
    this.toolbar.on('colorAttributeChanged', (attr) => {
      if (this.toolpathRenderer) {
        this.toolpathRenderer.options.colorAttribute = attr as ColorAttribute;
        if (this.currentData) this.toolpathRenderer.updateData(this.currentData);
      }
    });
    this.toolbar.on('colorMapChanged', (map) => {
      if (this.toolpathRenderer) {
        this.toolpathRenderer.options.colorMap = new ColorMap(map as any);
        if (this.currentData) this.toolpathRenderer.updateData(this.currentData);
      }
    });
    this.toolbar.on('resetView', () => {
      if (this.currentData) {
        const h = this.currentData.header;
        this.camera.fitToBounds(
          { x: h.boundsMin[0], y: h.boundsMin[1], z: h.boundsMin[2] },
          { x: h.boundsMax[0], y: h.boundsMax[1], z: h.boundsMax[2] },
        );
      }
    });
    this.toolbar.on('toggleGrid', () => {
      if (this.gridRenderer) this.gridRenderer.visible = !this.gridRenderer.visible;
    });
    this.toolbar.on('toggleCrossSection', () => {
      if (this.crossSectionRenderer) this.crossSectionRenderer.visible = !this.crossSectionRenderer.visible;
    });

    this.cutPlanePanel.on('planeZChanged', (z) => {
      if (this.crossSectionRenderer) {
        this.crossSectionRenderer.planeZ = z;
        if (this.currentData) this.crossSectionRenderer.updateData(this.currentData);
      }
    });
    this.cutPlanePanel.on('visibleChanged', (v) => {
      if (this.crossSectionRenderer) this.crossSectionRenderer.visible = v;
    });

    this.zLayerPanel.on('layerSelected', (idx) => {
      this.loadZLayer(idx);
    });
    this.zLayerPanel.on('zToleranceChanged', () => {
      if (this.currentJobId) this.refreshZLayers();
    });
    this.zLayerPanel.on('showAllLayers', () => {
      if (this.currentJobId) this.loadFullData();
    });
  }

  async init(): Promise<void> {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('WebGPU not supported');
    this.device = await adapter.requestDevice();
    this.context = this.canvas.getContext('webgpu')!;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: 'premultiplied',
    });

    this.toolpathRenderer = new ToolpathRenderer(this.device);
    await this.toolpathRenderer.init(this.format);

    this.gridRenderer = new GridRenderer(this.device);
    await this.gridRenderer.init(this.format);

    this.crossSectionRenderer = new CrossSectionRenderer(this.device);
    await this.crossSectionRenderer.init(this.format);

    this.pointCloudRenderer = new PointCloudRenderer(this.device);
    await this.pointCloudRenderer.init(this.format);

    this.overlayRenderer = new OverlayRenderer(this.device);
    await this.overlayRenderer.init(this.format);

    this.setupInputHandlers();
    this.startRenderLoop();
  }

  private setupInputHandlers(): void {
    let isDragging = false;
    let lastX = 0, lastY = 0;

    this.canvas.addEventListener('mousedown', (e) => {
      isDragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
    });

    this.canvas.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      if (e.shiftKey) {
        this.camera.pan(dx, dy);
      } else {
        this.camera.orbit(dx * 0.01, dy * 0.01);
      }
    });

    this.canvas.addEventListener('mouseup', () => { isDragging = false; });
    this.canvas.addEventListener('mouseleave', () => { isDragging = false; });

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.1 : 0.9;
      this.camera.zoom(factor);
    });

    // Resize handling
    const resizeObserver = new ResizeObserver(() => {
      this.resize();
    });
    resizeObserver.observe(this.canvas);
    this.resize();
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, this.canvas.clientWidth * dpr);
    const h = Math.max(1, this.canvas.clientHeight * dpr);
    this.canvas.width = w;
    this.canvas.height = h;
    this.camera.setAspect(w / h);
    if (this.device) {
      this.depthTexture?.destroy();
      this.depthTexture = this.device.createTexture({
        size: [w, h],
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
    }
  }

  private startRenderLoop(): void {
    const frame = (): void => {
      const now = performance.now();
      const dt = (now - this.lastFrameTime) / 1000;
      this.lastFrameTime = now;
      this.camera.update(dt);
      this.render();
      this.animationId = requestAnimationFrame(frame);
    };
    this.lastFrameTime = performance.now();
    this.animationId = requestAnimationFrame(frame);
  }

  private render(): void {
    if (!this.device || !this.context) return;
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: { r: 0.1, g: 0.1, b: 0.12, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: this.depthTexture!.createView(),
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    const viewProj = this.camera.viewProjectionMatrix;
    this.gridRenderer?.render(pass, viewProj);
    this.toolpathRenderer?.render(pass, viewProj);
    this.crossSectionRenderer?.render(pass, viewProj);
    this.pointCloudRenderer?.render(pass, viewProj);
    this.overlayRenderer?.render(pass, viewProj);

    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  private async handleUpload(file: File): Promise<void> {
    const text = await file.text();
    const uploadResp = await this.rpcClient.uploadGcode(text, file.name);
    this.currentJobId = uploadResp.jobId;
    await this.rpcClient.processJob(uploadResp.jobId);
    await this.pollJobStatus(uploadResp.jobId);
  }

  private async pollJobStatus(jobId: string): Promise<void> {
    const poll = async (): Promise<void> => {
      const status = await this.rpcClient.getJobStatus(jobId);
      this.statsPanel.updateJobStatus(status);
      if (status.state === 'ready') {
        await this.loadJobData(jobId);
      } else if (status.state === 'processing') {
        setTimeout(poll, 500);
      } else if (status.state === 'failed') {
        console.error('Job failed:', status.errorMessage);
      }
    };
    await poll();
  }

  private async loadJobData(jobId: string): Promise<void> {
    const binaryResp = await this.rpcClient.getBinary(jobId);
    this.currentData = parseTTHR(binaryResp.data);
    this.toolpathRenderer?.updateData(this.currentData!);
    this.crossSectionRenderer?.updateData(this.currentData!);

    // Fit camera
    const h = this.currentData!.header;
    this.camera.fitToBounds(
      { x: h.boundsMin[0], y: h.boundsMin[1], z: h.boundsMin[2] },
      { x: h.boundsMax[0], y: h.boundsMax[1], z: h.boundsMax[2] },
    );
    this.timeSlider.duration = h.timeEnd;

    // Load stats, blocks, segments, Z-layers
    try {
      const stats = await this.rpcClient.getStatistics(jobId);
      this.attributePanel.update(stats);
    } catch (e) { console.error('Failed to load stats:', e); }

    try {
      const blocks = await this.rpcClient.getBlocks(jobId);
      this.segmentList.updateBlocks(blocks);
    } catch (e) { console.error('Failed to load blocks:', e); }

    try {
      const zLayers = await this.rpcClient.getZLayers(jobId);
      this.zLayerPanel.update(zLayers);
    } catch (e) { console.error('Failed to load Z-layers:', e); }
  }

  private async refreshZLayers(): Promise<void> {
    if (!this.currentJobId) return;
    const zLayers = await this.rpcClient.getZLayers(this.currentJobId);
    this.zLayerPanel.update(zLayers);
  }

  private async loadZLayer(layerIndex: number): Promise<void> {
    if (!this.currentJobId) return;
    const resp = await this.rpcClient.getZLayerBinary(this.currentJobId, layerIndex);
    const layerData = parseTTHR(resp.data);
    this.toolpathRenderer?.updateData(layerData);
  }

  private async loadFullData(): Promise<void> {
    if (!this.currentJobId || !this.currentData) return;
    this.toolpathRenderer?.updateData(this.currentData);
  }

  destroy(): void {
    if (this.animationId !== null) cancelAnimationFrame(this.animationId);
    this.toolpathRenderer?.destroy();
    this.gridRenderer?.destroy();
    this.crossSectionRenderer?.destroy();
    this.pointCloudRenderer?.destroy();
    this.overlayRenderer?.destroy();
    this.depthTexture?.destroy();
  }
}
