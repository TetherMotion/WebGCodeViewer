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
import { NurbsRenderer, NurbsColorAttribute } from '../renderers/NurbsRenderer';
import { MiniplotRenderer, MiniplotAxis, MiniplotData } from '../renderers/MiniplotRenderer';
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
  private depthReadbackBuffer: GPUBuffer | null = null;
  private depthData: Float32Array | null = null;  // previous frame's depth values
  private depthReadbackPending = false;
  private depthBufferSize: [number, number] = [0, 0];  // [width, height]
  private depthPaddedRowFloats: number = 0;  // padded bytesPerRow / 4
  private depthReadbackGen = 0;  // incremented on resize to invalidate stale mapAsync callbacks

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
  private miniplotRenderer: MiniplotRenderer | null = null;
  private miniplotContainer: HTMLElement | null = null;
  private miniplotLabel: HTMLElement | null = null;
  private miniplotVisible: boolean = false;
  private miniplotData: MiniplotData | null = null;

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
  private zLayers: { layerIndex: number; zHeight: number; pieceStart: number; pieceEnd: number; pieceCount: number }[] = [];
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

    // Get miniplot DOM elements early (before init) so toggle works even if WebGPU fails
    this.miniplotContainer = document.getElementById('miniplot-container');
    this.miniplotLabel = document.getElementById('miniplot-label');

    this.setupEventHandlers();

    // Register global keyboard shortcuts early (before WebGPU init)
    // so they work even if WebGPU is not available
    window.addEventListener('keydown', (e) => this.handleKeyDown(e));
  }

  private setupEventHandlers(): void {
    this.controlPanel.on('uploadFile', (file) => this.handleUpload(file));
    this.controlPanel.on('colorAttributeChanged', (attr) => {
      // Map ToolpathRenderer color attributes to NurbsRenderer attributes
      const nurbsAttrMap: Record<string, NurbsColorAttribute> = {
        'deviation': 'deviation',
        'zHeight': 'zHeight',
        'extruderSpeed': 'extruderSpeed',
        'motion': 'motion',
        'solid': 'solid',
        'velocity': 'pieceIndex',    // NBP has no per-piece velocity
        'acceleration': 'pieceIndex',
        'jerk': 'pieceIndex',
        'curvature': 'pieceIndex',
        'segment': 'pieceIndex',
      };
      const nurbsAttr = nurbsAttrMap[attr] || 'pieceIndex';

      if (this.toolpathRenderer) {
        this.toolpathRenderer.options.colorAttribute = attr as ColorAttribute;
        if (this.currentData) this.toolpathRenderer.updateData(this.currentData);
      }
      if (this.nurbsRenderer) {
        this.nurbsRenderer.options.colorAttribute = nurbsAttr;
        if (this.currentNBP) this.nurbsRenderer.updateData(this.currentNBP);
      }
    });
    this.controlPanel.on('colorMapChanged', (map) => {
      if (this.toolpathRenderer) {
        this.toolpathRenderer.options.colorMap = new ColorMap(map as any);
        if (this.currentData) this.toolpathRenderer.updateData(this.currentData);
      }
      if (this.nurbsRenderer) {
        this.nurbsRenderer.options.colorMap = new ColorMap(map as any);
        if (this.currentNBP) this.nurbsRenderer.updateData(this.currentNBP);
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
    // Feature #1: Toggle travel move visibility
    this.controlPanel.on('toggleTravels', () => {
      if (this.nurbsRenderer) {
        this.nurbsRenderer.options.showTravels = !this.nurbsRenderer.options.showTravels;
        if (this.currentNBP) this.nurbsRenderer.updateData(this.currentNBP);
      }
    });
    // Feature #2: Line width adjustment
    this.controlPanel.on('lineWidthChanged', (width) => {
      if (this.nurbsRenderer) this.nurbsRenderer.options.lineWidth = width;
      if (this.toolpathRenderer) this.toolpathRenderer.options.lineWidth = width;
    });
    this.controlPanel.on('toggleCrossSection', () => {
      if (this.crossSectionRenderer) {
        this.crossSectionRenderer.visible = !this.crossSectionRenderer.visible;
        if (this.crossSectionRenderer.visible) {
          this.updateCrossSection();
        }
      }
    });
    this.controlPanel.on('crossSectionZChanged', (frac) => {
      if (this.crossSectionRenderer) {
        // Map 0..1 fraction to Z range of current data
        const bounds = this.getCurrentBounds();
        if (bounds) {
          this.crossSectionRenderer.planeZ = bounds.zMin + frac * (bounds.zMax - bounds.zMin);
          this.updateCrossSection();
        }
      }
    });
    this.controlPanel.on('exportImage', () => {
      this.exportImage();
    });
    this.controlPanel.on('toggleMiniplot', () => {
      this.toggleMiniplot();
    });
    this.controlPanel.on('miniplotAxisChanged', (axisName) => {
      const axisMap: Record<string, MiniplotAxis> = {
        'Extruder': 'speedE',
        'X': 'speedX',
        'Y': 'speedY',
        'Z': 'speedZ',
        'Linear': 'speedLinear',
      };
      const axis = axisMap[axisName] || 'speedE';
      if (this.miniplotRenderer) {
        this.miniplotRenderer.setAxis(axis);
        this.updateMiniplotLabel();
      }
    });

    // G-code viewer → highlight toolpath
    this.gcodeViewer.on('blockSelected', (blockIndex) => {
      if (this.toolpathRenderer && this.currentData) {
        this.toolpathRenderer.setHighlight(new Set([blockIndex]), this.currentData);
      }
    });
    this.gcodeViewer.on('lineSelected', (line) => {
      // Update miniplot highlight
      if (this.miniplotRenderer) {
        this.miniplotRenderer.setSelectedLine(line);
        this.updateMiniplotLabel();
      }
    });
    this.gcodeViewer.on('isolateZLayer', (lineNum) => {
      this.isolateZLayerForLine(lineNum);
    });
    this.gcodeViewer.on('highlightMotion', (blockIndex) => {
      if (this.toolpathRenderer && this.currentData) {
        this.toolpathRenderer.setHighlight(new Set([blockIndex]), this.currentData);
      }
      // Also highlight in NURBS renderer if we have piece data
      // (NurbsRenderer doesn't have per-piece highlighting yet, but we can
      // at least focus the camera on the block's piece)
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

    // Miniplot renderer (separate WebGPU canvas for speed plot)
    const miniplotCanvas = document.getElementById('miniplot-canvas') as HTMLCanvasElement | null;
    if (miniplotCanvas && this.device) {
      this.miniplotRenderer = new MiniplotRenderer(miniplotCanvas, this.device);
      await this.miniplotRenderer.init();
      this.setupMiniplotInteraction(miniplotCanvas);
    }

    this.setupInputHandlers();
    this.startRenderLoop();
  }

  private setupInputHandlers(): void {
    let isDragging = false;
    let isPanning = false;
    let lastX = 0, lastY = 0;

    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 2) {
        // Right-click → pan
        isPanning = true;
        isDragging = false;
      } else if (e.button === 0) {
        // Left-click → orbit (or pan with shift)
        isDragging = true;
        isPanning = false;
      }
      lastX = e.clientX;
      lastY = e.clientY;
    });

    this.canvas.addEventListener('mousemove', (e) => {
      if (!isDragging && !isPanning) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      if (isPanning || e.shiftKey) {
        this.camera.pan(dx, dy);
      } else {
        this.camera.orbit(-dx * 0.01, dy * 0.01);
      }
    });

    this.canvas.addEventListener('mouseup', (e) => {
      if (e.button === 2) isPanning = false;
      else isDragging = false;
    });
    this.canvas.addEventListener('mouseleave', () => { isDragging = false; isPanning = false; });

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.1 : 0.9;
      this.camera.zoom(factor);
    });

    // Click on canvas → pick nearest toolpath sample → highlight gcode line
    this.canvas.addEventListener('click', (e) => {
      if (isDragging || isPanning) return;
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
        format: 'depth32float',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });

      // Create/recreate depth readback buffer (4 bytes per pixel for f32)
      // WebGPU requires bytesPerRow to be a multiple of 256 for copyTextureToBuffer.
      // Pad the row stride and size the buffer accordingly.
      this.depthReadbackBuffer?.destroy();
      this.depthReadbackGen++;  // invalidate any in-flight mapAsync callbacks
      const unpaddedBytesPerRow = w * 4;
      const paddedBytesPerRow = Math.ceil(unpaddedBytesPerRow / 256) * 256;
      this.depthPaddedRowFloats = paddedBytesPerRow / 4;
      this.depthReadbackBuffer = this.device.createBuffer({
        size: paddedBytesPerRow * h,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });
      this.depthData = null;
      this.depthReadbackPending = false;
      this.depthBufferSize = [w, h];
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

      // Render miniplot (separate WebGPU context)
      if (this.miniplotVisible && this.miniplotRenderer) {
        this.miniplotRenderer.resize();
        this.miniplotRenderer.render();
      }

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
        clearValue: { r: 0.18, g: 0.18, b: 0.2, a: 1 },
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

    // Copy depth texture to readback buffer for label visibility checks
    if (this.depthReadbackBuffer && !this.depthReadbackPending) {
      const [w, h] = this.depthBufferSize;
      const paddedBytesPerRow = this.depthPaddedRowFloats * 4;
      encoder.copyTextureToBuffer(
        { texture: this.depthTexture, mipLevel: 0, origin: { x: 0, y: 0, z: 0 } },
        { buffer: this.depthReadbackBuffer, offset: 0, bytesPerRow: paddedBytesPerRow, rowsPerImage: h },
        { width: w, height: h, depthOrArrayLayers: 1 },
      );
    }

    this.device.queue.submit([encoder.finish()]);

    // Start async readback of previous frame's depth buffer
    if (this.depthReadbackBuffer && !this.depthReadbackPending) {
      this.depthReadbackPending = true;
      const gen = this.depthReadbackGen;
      const buf = this.depthReadbackBuffer;
      buf.mapAsync(GPUMapMode.READ).then(() => {
        // Stale callback: buffer was replaced by resize, ignore
        if (gen !== this.depthReadbackGen) return;
        const [w, h] = this.depthBufferSize;
        const stride = this.depthPaddedRowFloats;
        const mapped = new Float32Array(buf.getMappedRange());
        // Unpack: copy row by row, skipping padding bytes at end of each row
        const compact = new Float32Array(w * h);
        for (let row = 0; row < h; row++) {
          compact.set(mapped.subarray(row * stride, row * stride + w), row * w);
        }
        this.depthData = compact;
        buf.unmap();
        this.depthReadbackPending = false;
      }).catch(() => {
        // Stale callback: buffer was replaced by resize, don't touch pending
        if (gen !== this.depthReadbackGen) return;
        this.depthReadbackPending = false;
      });
    }

    // Render navigation gizmo (separate canvas, uses camera rotation only)
    this.navGizmo?.render(this.camera.viewRotationMatrix);

    // Render direction cubes (separate canvas)
    this.dirCubeRenderer?.render();

    // Render grid labels overlay (2D canvas, projects 3D ticks to screen)
    // Uses previous frame's depth buffer to cull occluded labels
    if (this.gridLabels && this.gridRenderer) {
      this.gridLabels.render(
        this.gridRenderer.ticks,
        viewProj,
        this.canvas.clientWidth,
        this.canvas.clientHeight,
        this.depthData,
        this.depthBufferSize,
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

  // ── Miniplot ─────────────────────────────────────────────────────────────

  private setupMiniplotInteraction(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      if (this.miniplotRenderer) {
        this.miniplotRenderer.handleWheel(e.deltaY, mouseX);
        this.updateMiniplotLabel();
      }
    });

    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      if (this.miniplotRenderer) {
        this.miniplotRenderer.startDrag(mouseX);
      }
    });

    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      if (this.miniplotRenderer) {
        const wasDragging = this.miniplotRenderer.dragging;
        this.miniplotRenderer.updateDrag(mouseX);
        if (wasDragging) this.updateMiniplotLabel();
      }
    });

    canvas.addEventListener('mouseup', () => {
      this.miniplotRenderer?.endDrag();
    });

    canvas.addEventListener('mouseleave', () => {
      this.miniplotRenderer?.endDrag();
    });

    canvas.addEventListener('dblclick', () => {
      this.miniplotRenderer?.resetZoom();
      this.updateMiniplotLabel();
    });
  }

  private toggleMiniplot(): void {
    this.miniplotVisible = !this.miniplotVisible;
    if (this.miniplotContainer) {
      this.miniplotContainer.style.display = this.miniplotVisible ? 'block' : 'none';
    }
    if (this.miniplotVisible) {
      // Resize after becoming visible
      requestAnimationFrame(() => {
        this.miniplotRenderer?.resize();
        if (this.miniplotData) {
          this.miniplotRenderer?.setData(this.miniplotData!);
        }
        this.updateMiniplotLabel();
      });
      // Fetch data if not yet loaded
      if (!this.miniplotData && this.currentJobId) {
        this.fetchMiniplotData(this.currentJobId);
      }
    }
  }

  private async fetchMiniplotData(jobId: string): Promise<void> {
    try {
      const url = `${this.rpcClient.httpBaseUrl}/api/trajectory/${jobId}/speeds`;
      const resp = await fetch(url);
      if (!resp.ok) return;
      const json = await resp.json();
      this.miniplotData = json as MiniplotData;
      if (this.miniplotRenderer) {
        this.miniplotRenderer.setData(this.miniplotData);
        this.updateMiniplotLabel();
      }
    } catch (e) {
      // Silently fail — miniplot is optional
    }
  }

  private updateMiniplotLabel(): void {
    if (!this.miniplotLabel || !this.miniplotRenderer) return;
    const label = this.miniplotRenderer.getAxisLabel();
    const view = this.miniplotRenderer.getViewRange();
    this.miniplotLabel.textContent = `${label}  |  t: ${view.tMin.toFixed(3)}s – ${view.tMax.toFixed(3)}s  |  scroll=zoom, drag=pan, dblclick=reset`;
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

      // Initialize cross-section plane to midpoint of Z range
      if (this.crossSectionRenderer) {
        this.crossSectionRenderer.planeZ = (h.boundsMin[2] + h.boundsMax[2]) / 2;
        if (this.crossSectionRenderer.visible) {
          this.crossSectionRenderer.updateFromNurbs(this.currentNBP);
        }
      }
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

    // Load Z-layers for layer navigation (via HTTP — more reliable than WS)
    try {
      const layersResp = await this.rpcClient.getZLayersHttp(jobId);
      this.zLayers = layersResp.layers;
      this.controlPanel.updateLayersFromHttp(layersResp);
    } catch (e) { console.error('Failed to load Z-layers:', e); }

    // Load miniplot speed data (if miniplot is visible)
    if (this.miniplotVisible) {
      this.fetchMiniplotData(jobId);
    }

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
    if (layerIdx < 0) {
      // Show all layers — reset NBP and TTHR data
      if (this.currentNBP) {
        this.nurbsRenderer?.updateData(this.currentNBP);
      }
      if (this.fullData) {
        this.currentData = this.fullData;
        this.toolpathRenderer?.updateData(this.currentData);
        this.crossSectionRenderer?.updateData(this.currentData);
      }
      this.updatePlayPosition();
      return;
    }

    // Use actual Z-layer data from the server
    if (layerIdx < this.zLayers.length) {
      const layer = this.zLayers[layerIdx];
      const zHeight = layer.zHeight;

      // Filter NBP pieces to only this layer's piece range
      if (this.currentNBP) {
        const filteredNBP: NBPData = {
          header: { ...this.currentNBP.header, pieceCount: layer.pieceCount },
          pieces: this.currentNBP.pieces.slice(layer.pieceStart, layer.pieceEnd + 1),
          blocks: this.currentNBP.blocks,
        };
        this.nurbsRenderer?.updateData(filteredNBP);
      }

      // Also filter TTHR data if available
      if (this.fullData) {
        const zTol = 0.02; // 20µm tolerance
        this.currentData = extractZLayer(this.fullData, zHeight - zTol, zHeight + zTol);
        this.toolpathRenderer?.updateData(this.currentData);
        this.crossSectionRenderer?.updateData(this.currentData);
      }
      this.updatePlayPosition();
      return;
    }

    // Fallback: old estimation method
    if (!this.fullData) return;
    const h = this.fullData.header;
    const zMin = h.boundsMin[2];
    const zMax = h.boundsMax[2];
    const totalLayers = Math.max(1, this.zLayers.length || Math.ceil((zMax - zMin) / 0.2));
    const layerHeight = (zMax - zMin) / totalLayers;
    const layerZMin = zMin + layerIdx * layerHeight;
    const layerZMax = layerZMin + layerHeight;
    this.currentData = extractZLayer(this.fullData, layerZMin, layerZMax);
    this.toolpathRenderer?.updateData(this.currentData);
    this.crossSectionRenderer?.updateData(this.currentData);
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
    this.depthReadbackGen++;  // invalidate any in-flight mapAsync callbacks
    this.depthReadbackBuffer?.destroy();
    this.depthReadbackBuffer = null;
    this.depthData = null;
  }

  /**
   * Isolate the Z-layer for a given G-code line number.
   * Switches to orthographic + top view, then filters to the Z-layer
   * that contains the block associated with this line.
   */
  private isolateZLayerForLine(lineNum: number): void {
    // 1. Switch to orthographic + top view
    this.camera.setProjectionMode('orthographic');
    this.setViewDirection('top');

    // 2. Find the block for this line
    // The GcodeViewer has lineToBlock mapping, but we need it here.
    // We can find the block from the NBP blocks or TTHR blockIndex.
    // Use NBP blocks if available, otherwise estimate from Z-layers.

    // 3. Find which Z-layer contains this line's block
    // Approximate: block index ≈ piece index (since both are sequential)
    // Find which Z-layer's piece range contains this block
    if (this.currentNBP && this.currentNBP.blocks.length > 0) {
      // Find the block for this line
      let blockIdx = -1;
      for (const blk of this.currentNBP.blocks) {
        if (blk.lineNumber === lineNum) {
          blockIdx = blk.blockIndex;
          break;
        }
      }
      if (blockIdx < 0) return;

      // Find which Z-layer contains this piece index (approximate: blockIdx ≈ pieceIdx)
      for (const layer of this.zLayers) {
        if (blockIdx >= layer.pieceStart && blockIdx <= layer.pieceEnd) {
          this.applyLayerFilter(layer.layerIndex);
          // Update the layer slider UI
          this.controlPanel.setLayerValue(layer.layerIndex);
          return;
        }
      }
    }

    // Fallback: if no NBP blocks, try to find Z from TTHR data
    if (this.fullData && this.fullData.blockIndex) {
      // Find the sample for this block
      // This is less precise but works for TTHR-only mode
      const n = this.fullData.header.sampleCount;
      const axes = this.fullData.header.axisCount;
      // Find first sample with this block
      // We don't have line→block mapping here, so use the layer slider approach
      // Just switch to top view and let user pick a layer
      return;
    }
  }

  /**
   * Get the current Z bounds from NBP or TTHR data.
   */
  private getCurrentBounds(): { zMin: number; zMax: number } | null {
    if (this.currentNBP) {
      const h = this.currentNBP.header;
      return { zMin: h.boundsMin[2], zMax: h.boundsMax[2] };
    }
    if (this.fullData) {
      const h = this.fullData.header;
      return { zMin: h.boundsMin[2], zMax: h.boundsMax[2] };
    }
    return null;
  }

  /**
   * Update the cross-section renderer from current data (NBP or TTHR).
   */
  private updateCrossSection(): void {
    if (!this.crossSectionRenderer) return;
    if (this.currentNBP) {
      this.crossSectionRenderer.updateFromNurbs(this.currentNBP);
    } else if (this.currentData) {
      this.crossSectionRenderer.updateData(this.currentData);
    }
  }
}
