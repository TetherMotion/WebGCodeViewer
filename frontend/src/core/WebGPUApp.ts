/**
 * @file WebGPUApp.ts
 * @brief Main WebGPU application orchestrating renderers, camera, and UI.
 */

import { Camera } from './Camera';
import { RpcClient } from './RpcClient';
import { ColorMap } from './ColorMap';
import { parseTTHR, TTHRData, extractZLayer } from './TthrParser';
import { parseNBP, NBPData } from './NurbsParser';
import { ToolpathRenderer, ColorAttribute } from '../renderers/ToolpathRenderer';
import { GridRenderer } from '../renderers/GridRenderer';
import { CrossSectionRenderer } from '../renderers/CrossSectionRenderer';
import { PointCloudRenderer } from '../renderers/PointCloudRenderer';
import { OverlayRenderer } from '../renderers/OverlayRenderer';
import { NavigationGizmo } from '../renderers/NavigationGizmo';
import { PrintHeadMarker } from '../renderers/PrintHeadMarker';
import { DirectionCubeRenderer } from '../renderers/DirectionCubeRenderer';
import { NurbsRenderer } from '../renderers/NurbsRenderer';
import { GridLabels } from '../ui/GridLabels';
import { ControlPanel } from '../ui/ControlPanel';
import { GcodeViewer } from '../ui/GcodeViewer';
import { NavigationCube, ViewDirection } from '../ui/NavigationCube';
import { degToRad } from './MathUtils';

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
  private navGizmo: NavigationGizmo | null = null;
  private printHeadMarker: PrintHeadMarker | null = null;
  private dirCubeRenderer: DirectionCubeRenderer | null = null;
  private nurbsRenderer: NurbsRenderer | null = null;
  private gridLabels: GridLabels | null = null;

  private resizeObserver: ResizeObserver | null = null;
  private gizmoResizeObserver: ResizeObserver | null = null;
  private dirCubeResizeObserver: ResizeObserver | null = null;

  private controlPanel: ControlPanel;
  private gcodeViewer: GcodeViewer;
  private navCube: NavigationCube;

  private currentJobId: string | null = null;
  private currentData: TTHRData | null = null;
  private fullData: TTHRData | null = null;  // unfiltered data (for layer reset)
  private currentNBP: NBPData | null = null;
  private currentFilename: string = '';
  private animationId: number | null = null;
  private lastFrameTime = 0;

  // Playback state
  private playing = false;
  private playProgress = 1.0;  // 0..1
  private playSpeed = 0.1;     // fraction per second

  constructor(
    canvas: HTMLCanvasElement,
    rpcClient: RpcClient,
    bottomPanel: HTMLElement,
    gcodePanel: HTMLElement,
    navCubeContainer: HTMLElement,
  ) {
    this.canvas = canvas;
    this.rpcClient = rpcClient;
    this.camera = new Camera();

    // Build UI — control panel at bottom, gcode viewer on right, nav cube overlay
    this.controlPanel = new ControlPanel(bottomPanel);
    this.gcodeViewer = new GcodeViewer(gcodePanel);
    this.navCube = new NavigationCube(navCubeContainer);

    this.setupEventHandlers();

    // Register global keyboard shortcuts early (before WebGPU init)
    // so they work even if WebGPU is not available
    window.addEventListener('keydown', (e) => this.handleKeyDown(e));
  }

  private setupEventHandlers(): void {
    this.controlPanel.on('uploadFile', (file) => this.handleUpload(file));
    this.controlPanel.on('colorAttributeChanged', (attr) => {
      if (this.toolpathRenderer) {
        this.toolpathRenderer.options.colorAttribute = attr as ColorAttribute;
        if (this.currentData) this.toolpathRenderer.updateData(this.currentData);
      }
    });
    this.controlPanel.on('colorMapChanged', (map) => {
      if (this.toolpathRenderer) {
        this.toolpathRenderer.options.colorMap = new ColorMap(map as any);
        if (this.currentData) this.toolpathRenderer.updateData(this.currentData);
      }
    });
    this.controlPanel.on('resetView', () => {
      if (this.currentData) {
        const h = this.currentData.header;
        this.camera.fitToBounds(
          { x: h.boundsMin[0], y: h.boundsMin[1], z: h.boundsMin[2] },
          { x: h.boundsMax[0], y: h.boundsMax[1], z: h.boundsMax[2] },
        );
      }
    });
    this.controlPanel.on('toggleGrid', () => {
      if (this.gridRenderer) this.gridRenderer.visible = !this.gridRenderer.visible;
    });
    this.controlPanel.on('toggleCrossSection', () => {
      if (this.crossSectionRenderer) this.crossSectionRenderer.visible = !this.crossSectionRenderer.visible;
    });
    this.controlPanel.on('exportImage', () => {
      this.exportImage();
    });

    // G-code viewer → highlight toolpath
    this.gcodeViewer.on('blockSelected', (blockIndex) => {
      if (this.toolpathRenderer && this.currentData) {
        this.toolpathRenderer.setHighlight(new Set([blockIndex]), this.currentData);
      }
    });
    this.gcodeViewer.on('lineSelected', (_line) => {
      // Line selection is handled via blockSelected above
    });

    // Navigation cube → direction selection
    this.navCube.on('directionSelected', (dir) => {
      this.setViewDirection(dir);
    });

    // Navigation cube → projection mode toggle
    this.navCube.on('projectionChanged', (mode) => {
      this.camera.setProjectionMode(mode);
    });

    // Layer slider → filter toolpath by Z-layer
    this.controlPanel.on('layerChanged', (layerIdx) => {
      this.applyLayerFilter(layerIdx);
    });

    // Time slider → set playback position
    this.controlPanel.on('timeChanged', (frac) => {
      this.playProgress = frac;
      this.playing = false;
      this.controlPanel.setPlaying(false);
      this.updatePlayPosition();
    });

    // Play/pause button
    this.controlPanel.on('playStateChanged', (playing) => {
      this.playing = playing;
      if (playing && this.playProgress >= 1.0) {
        this.playProgress = 0;
      }
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

    // Navigation gizmo — uses the same device but a separate canvas
    this.navGizmo = new NavigationGizmo(this.device, this.navCube.gizmoCanvas);
    await this.navGizmo.init();

    // Print head marker
    this.printHeadMarker = new PrintHeadMarker(this.device);
    await this.printHeadMarker.init(this.format);

    // Direction cube renderer (WebGPU-rendered 3D cube buttons)
    this.dirCubeRenderer = new DirectionCubeRenderer(this.device, this.navCube.dirCanvas);
    await this.dirCubeRenderer.init();

    // NURBS renderer (replaces ToolpathRenderer for large files)
    this.nurbsRenderer = new NurbsRenderer(this.device);
    await this.nurbsRenderer.init(this.format);

    // Grid labels overlay (2D canvas for numeric tick labels)
    const gridLabelsCanvas = document.getElementById('grid-labels-canvas') as HTMLCanvasElement | null;
    if (gridLabelsCanvas) {
      this.gridLabels = new GridLabels(gridLabelsCanvas);
    }

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
        this.camera.orbit(-dx * 0.01, dy * 0.01);
      }
    });

    this.canvas.addEventListener('mouseup', () => { isDragging = false; });
    this.canvas.addEventListener('mouseleave', () => { isDragging = false; });

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.1 : 0.9;
      this.camera.zoom(factor);
    });

    // Click on canvas → pick nearest toolpath sample → highlight gcode line
    this.canvas.addEventListener('click', (e) => {
      if (isDragging) return;
      this.handleCanvasClick(e);
    });

    // Resize handling
    this.resizeObserver = new ResizeObserver(() => {
      if (document.body.contains(this.canvas)) this.resize();
    });
    this.resizeObserver.observe(this.canvas);
    // Also observe the gizmo canvas for size changes
    this.gizmoResizeObserver = new ResizeObserver(() => {
      this.navGizmo?.resize();
    });
    this.gizmoResizeObserver.observe(this.navCube.gizmoCanvas);
    // Observe the direction cube canvas for size changes
    this.dirCubeResizeObserver = new ResizeObserver(() => {
      this.dirCubeRenderer?.resize();
    });
    this.dirCubeResizeObserver.observe(this.navCube.dirCanvas);
    this.resize();
    this.navGizmo?.resize();
    this.dirCubeRenderer?.resize();
  }

  private handleKeyDown(e: KeyboardEvent): void {
    // Ctrl+F → G-code search
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      if (this.gcodeViewer.isSearchVisible()) {
        this.gcodeViewer.hideSearch();
      } else {
        this.gcodeViewer.showSearch();
      }
      return;
    }

    // Escape → close search if open
    if (e.key === 'Escape' && this.gcodeViewer.isSearchVisible()) {
      this.gcodeViewer.hideSearch();
      return;
    }
  }

  /**
   * Handle canvas click — raycast to find nearest toolpath sample,
   * then highlight the corresponding G-code block.
   */
  private handleCanvasClick(e: MouseEvent): void {
    if (!this.currentData || !this.currentData.blockIndex) return;

    const rect = this.canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    // Simple approach: find the nearest sample by projecting all positions
    // to screen space and finding the closest one to the click point.
    // This is not a true raycast but works well enough for line strips.
    const n = this.currentData.header.sampleCount;
    const axes = this.currentData.header.axisCount;
    const positions = this.currentData.positions;
    if (!positions) return;

    const viewProj = this.camera.viewProjectionMatrix;
    let bestIdx = -1;
    let bestDist = Infinity;
    const maxDist = 0.05; // 5% of screen space

    for (let i = 0; i < n; i++) {
      const px = positions[i * axes];
      const py = positions[i * axes + 1];
      const pz = positions[i * axes + 2];

      // Transform to clip space
      const clipX = viewProj[0] * px + viewProj[4] * py + viewProj[8] * pz + viewProj[12];
      const clipY = viewProj[1] * px + viewProj[5] * py + viewProj[9] * pz + viewProj[13];
      const clipZ = viewProj[2] * px + viewProj[6] * py + viewProj[10] * pz + viewProj[14];
      const clipW = viewProj[3] * px + viewProj[7] * py + viewProj[11] * pz + viewProj[15];

      if (clipW <= 0) continue;

      const ndcX = clipX / clipW;
      const ndcY = clipY / clipW;
      const dist = Math.sqrt((ndcX - x) ** 2 + (ndcY - y) ** 2);

      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0 && bestDist < maxDist) {
      const blockIdx = this.currentData.blockIndex[bestIdx];
      this.gcodeViewer.highlightBlock(blockIdx);
      if (this.toolpathRenderer) {
        this.toolpathRenderer.setHighlight(new Set([blockIdx]), this.currentData);
      }
    } else {
      // Click away from toolpath — clear highlight
      this.gcodeViewer.clearHighlight();
      if (this.toolpathRenderer) this.toolpathRenderer.clearHighlight();
    }
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

      // Playback animation
      if (this.playing) {
        this.playProgress += dt * this.playSpeed;
        if (this.playProgress >= 1.0) {
          this.playProgress = 1.0;
          this.playing = false;
          this.controlPanel.setPlaying(false);
        }
        this.controlPanel.setTimePosition(this.playProgress);
        this.updatePlayPosition();
      }

      this.render();
      this.animationId = requestAnimationFrame(frame);
    };
    this.lastFrameTime = performance.now();
    this.animationId = requestAnimationFrame(frame);
  }

  private updatePlayPosition(): void {
    if (this.toolpathRenderer && this.currentData) {
      this.toolpathRenderer.setProgress(this.playProgress);
      // Update print head marker position
      const pos = this.toolpathRenderer.getPositionAt(this.playProgress, this.currentData);
      if (pos && this.printHeadMarker) {
        this.printHeadMarker.setPosition(pos[0], pos[1], pos[2]);
        this.printHeadMarker.visible = this.playProgress < 1.0;
      }
    }
  }

  private render(): void {
    if (!this.device || !this.context || !this.depthTexture) return;
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: { r: 0.1, g: 0.1, b: 0.12, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: this.depthTexture.createView(),
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    const viewProj = this.camera.viewProjectionMatrix;
    this.gridRenderer?.render(pass, viewProj);
    this.nurbsRenderer?.render(pass, viewProj);
    this.toolpathRenderer?.render(pass, viewProj);
    this.crossSectionRenderer?.render(pass, viewProj);
    this.pointCloudRenderer?.render(pass, viewProj);
    this.printHeadMarker?.render(pass, viewProj);
    this.overlayRenderer?.render(pass, viewProj);

    pass.end();
    this.device.queue.submit([encoder.finish()]);

    // Render navigation gizmo (separate canvas, uses camera rotation only)
    this.navGizmo?.render(this.camera.viewRotationMatrix);

    // Render direction cubes (separate canvas)
    this.dirCubeRenderer?.render();

    // Render grid labels overlay (2D canvas, projects 3D ticks to screen)
    if (this.gridLabels && this.gridRenderer) {
      this.gridLabels.render(
        this.gridRenderer.ticks,
        viewProj,
        this.canvas.clientWidth,
        this.canvas.clientHeight,
      );
    }
  }

  private exportImage(): void {
    const url = this.canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `tether-viewer-${Date.now()}.png`;
    a.click();
  }

  /**
   * Set the camera to a standard view direction.
   * The orbit distance is preserved from the current camera state.
   */
  private setViewDirection(dir: ViewDirection): void {
    // Standard view angles (angle, elevation)
    // angle is measured in the XY plane, elevation is Z
    const presets: Record<ViewDirection, { angle: number; elevation: number }> = {
      iso:    { angle: degToRad(35),   elevation: degToRad(30) },
      top:    { angle: degToRad(0),    elevation: degToRad(89) },
      bottom: { angle: degToRad(0),    elevation: degToRad(-89) },
      front:  { angle: degToRad(0),    elevation: degToRad(0) },
      back:   { angle: degToRad(180),  elevation: degToRad(0) },
      right:  { angle: degToRad(90),   elevation: degToRad(0) },
      left:   { angle: degToRad(-90),  elevation: degToRad(0) },
    };

    const preset = presets[dir];
    this.camera.setOrbit(preset.angle, preset.elevation, this.camera.orbitDistanceVal);
  }

  private async handleUpload(file: File): Promise<void> {
    this.currentFilename = file.name;
    this.controlPanel.setStatus('Uploading...');

    // Load raw G-code text into the viewer immediately (for the G-code panel)
    const text = await file.text();
    this.gcodeViewer.loadGcodeText(text, file.name);

    // Upload via HTTP (bypasses protobuf 2GB limit for large G-code files)
    const uploadResp = await this.rpcClient.uploadGcodeHttp(file);
    this.currentJobId = uploadResp.jobId;
    await this.rpcClient.processJob(uploadResp.jobId);
    await this.pollJobStatus(uploadResp.jobId);
  }

  private async pollJobStatus(jobId: string): Promise<void> {
    const poll = async (): Promise<void> => {
      const status = await this.rpcClient.getJobStatus(jobId);
      this.controlPanel.updateJobStatus(status);
      if (status.state === 'ready') {
        await this.loadJobData(jobId);
      } else if (status.state === 'processing') {
        setTimeout(poll, 500);
      } else if (status.state === 'failed') {
        console.error('Job failed:', status.errorMessage);
        this.controlPanel.setStatus(`Failed: ${status.errorMessage}`);
      }
    };
    await poll();
  }

  private async loadJobData(jobId: string): Promise<void> {
    // Fetch NURBS path data — compact curve representation (typically <1MB
    // even for huge G-code files, vs 2GB+ for sampled trajectory data)
    try {
      const nbpBinary = await this.rpcClient.getNurbsPathHttp(jobId);
      this.currentNBP = parseNBP(nbpBinary);
      this.nurbsRenderer?.updateData(this.currentNBP);
      console.info(`NURBS data loaded: ${this.currentNBP.header.pieceCount} pieces, ` +
                   `${this.currentNBP.header.totalControlPoints} control points, ` +
                   `${nbpBinary.byteLength} bytes`);

      // Fit camera to NURBS bounds
      const h = this.currentNBP.header;
      this.camera.fitToBounds(
        { x: h.boundsMin[0], y: h.boundsMin[1], z: h.boundsMin[2] },
        { x: h.boundsMax[0], y: h.boundsMax[1], z: h.boundsMax[2] },
      );
    } catch (e) {
      console.error('Failed to load NURBS data, falling back to TTHR:', e);
      // Fallback to TTHR (sampled data) if NURBS conversion fails
      const binaryData = await this.rpcClient.getBinaryHttp(jobId);
      this.currentData = parseTTHR(binaryData);
      this.fullData = this.currentData;
      this.toolpathRenderer?.updateData(this.currentData!);
      this.crossSectionRenderer?.updateData(this.currentData!);

      const h = this.currentData!.header;
      this.camera.fitToBounds(
        { x: h.boundsMin[0], y: h.boundsMin[1], z: h.boundsMin[2] },
        { x: h.boundsMax[0], y: h.boundsMax[1], z: h.boundsMax[2] },
      );
    }

    // Load blocks (G-code metadata with line numbers)
    try {
      const blocks = await this.rpcClient.getBlocks(jobId);
      this.gcodeViewer.updateBlocks(blocks);
    } catch (e) { console.error('Failed to load blocks:', e); }

    // Load Z-layers for layer navigation
    try {
      const layers = await this.rpcClient.getZLayers(jobId);
      this.controlPanel.updateLayers(layers);
    } catch (e) { console.error('Failed to load Z-layers:', e); }

    // Reset playback
    this.playProgress = 1.0;
    this.playing = false;
    this.controlPanel.setPlaying(false);
    this.updatePlayPosition();
  }

  /**
   * Filter the toolpath to show only a specific Z-layer.
   * Pass -1 to show all layers.
   */
  private applyLayerFilter(layerIdx: number): void {
    if (!this.fullData) return;

    if (layerIdx < 0) {
      // Show all layers
      this.currentData = this.fullData;
    } else {
      // Extract the specific Z-layer
      // Compute Z range for the layer using the layer height
      const h = this.fullData.header;
      const zMin = h.boundsMin[2];
      const zMax = h.boundsMax[2];
      const totalLayers = Math.max(1, Math.ceil((zMax - zMin) / 0.2)); // estimate 0.2mm layers
      const layerHeight = (zMax - zMin) / totalLayers;
      const layerZMin = zMin + layerIdx * layerHeight;
      const layerZMax = layerZMin + layerHeight;
      this.currentData = extractZLayer(this.fullData, layerZMin, layerZMax);
    }

    this.toolpathRenderer?.updateData(this.currentData!);
    this.crossSectionRenderer?.updateData(this.currentData!);
    this.updatePlayPosition();
  }

  destroy(): void {
    if (this.animationId !== null) cancelAnimationFrame(this.animationId);
    this.resizeObserver?.disconnect();
    this.gizmoResizeObserver?.disconnect();
    this.dirCubeResizeObserver?.disconnect();
    this.resizeObserver = null;
    this.gizmoResizeObserver = null;
    this.dirCubeResizeObserver = null;
    this.toolpathRenderer?.destroy();
    this.nurbsRenderer?.destroy();
    this.gridRenderer?.destroy();
    this.crossSectionRenderer?.destroy();
    this.pointCloudRenderer?.destroy();
    this.overlayRenderer?.destroy();
    this.navGizmo?.destroy();
    this.printHeadMarker?.destroy();
    this.dirCubeRenderer?.destroy();
    this.depthTexture?.destroy();
    this.depthTexture = null;
  }
}
