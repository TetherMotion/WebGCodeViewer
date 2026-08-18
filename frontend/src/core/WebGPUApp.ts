import { InfoPanel } from '@tether/gcode-analyzer';
import { formatTime } from '@tether/gcode-analyzer/GcodeMetadata';
import {
  type GetGcodeMetadataResponse,
  type GetFeatureTypesResponse,
  type GetProbeEventsResponse,
  type GetDrillingCyclesResponse,
  type GetJobSummaryResponse,
  type FeatureTypeSegment,
} from '@tether/viewer-core/generated';
/**
 * @file WebGPUApp.ts
 * @brief Main WebGPU application orchestrating renderers, camera, and UI.
 */

import { Camera } from "@tether/viewer-core";
import { RpcClient } from './RpcClient';
import { ColorMap } from "@tether/viewer-core";
import { parseTTHR, TTHRData, extractZLayer } from "@tether/viewer-core";
import { parseNBP, NBPData } from "@tether/viewer-core";
import { type AnalysisSection } from "@tether/viewer-core/generated";
import { parseTWSF, WssGpuData, wssToTrnp } from "@tether/viewer-core";
import { parseTRNP, TRNPData, parseTRNPPa, TRNPPaData } from "@tether/viewer-core";
import { ToolpathRenderer, ColorAttribute } from '../renderers/ToolpathRenderer';
import { GridRenderer } from "@tether/ground-grid";
import { CrossSectionRenderer } from "@tether/cross-section";
import { PointCloudRenderer } from "@tether/compare";
import { OverlayRenderer } from "@tether/scene-decorators";
import { NavigationGizmo } from "@tether/nav-overlay";
import { PrintHeadMarker } from "@tether/scene-decorators";
import { PrinterFrameRenderer } from "@tether/scene-decorators";
import { DirectionCubeRenderer } from "@tether/nav-overlay";
import { NurbsRenderer, NurbsColorAttribute } from "@tether/nurbs-renderer";
import { GpuPlot, PlotSeries } from "@tether/pa-plot";
import { PaControls, PaAlgorithmId } from "@tether/pa-plot";
import { MiniplotRenderer } from "@tether/miniplot"
import type { MiniplotData } from "@tether/viewer-core";
import { ComputeMiniplotRenderer } from "@tether/miniplot";
import { WssMiniplotRenderer, type WssPlotQuantity } from "@tether/miniplot";
import { GridLabels } from "@tether/ground-grid";
import { GridLabelRenderer } from "@tether/ground-grid";
import { ToolChangeMarkerRenderer } from "@tether/scene-decorators";
import { ControlPanel } from '../ui/ControlPanel';
import { GcodeViewer } from "@tether/gcode-viewer";
import { NavigationCube, ViewDirection } from "@tether/nav-overlay";
import { PositionOverlay } from '../ui/PositionOverlay';
import { ComparisonPanel } from "@tether/compare";
import { DiffPanel } from "@tether/compare";
import { BookmarkManager } from "@tether/gcode-viewer";
import { degToRad } from "@tether/viewer-core";

export class WebGPUApp {
  private canvas: HTMLCanvasElement;
  private adapter: GPUAdapter | null = null;
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
  private printerFrameRenderer: PrinterFrameRenderer | null = null;
  private toolChangeMarkerRenderer: ToolChangeMarkerRenderer | null = null;
  private dirCubeRenderer: DirectionCubeRenderer | null = null;
  private nurbsRenderer: NurbsRenderer | null = null;
  private gridLabels: GridLabels | null = null;
  private gridLabelRenderer: GridLabelRenderer | null = null;
  private miniplotRenderer: WssMiniplotRenderer | ComputeMiniplotRenderer | MiniplotRenderer | null = null;
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
  private currentTRNP: TRNPData | null = null;
  private currentWss: WssGpuData | null = null;
  private currentPaData: TRNPPaData | null = null;
  private gpuPlot: GpuPlot | null = null;
  private paControls: PaControls | null = null;
  private plotCanvas: HTMLCanvasElement | null = null;
  private plotOverlayCanvas: HTMLCanvasElement | null = null;
  private plotContainer: HTMLDivElement | null = null;
  private currentFilename: string = '';
  private zLayers: { layerIndex: number; zHeight: number; pieceStart: number; pieceEnd: number; pieceCount: number }[] = [];
  private animationId: number | null = null;
  private lastFrameTime = 0;

  // Playback state
  private playing = false;
  private playProgress = 1.0;  // 0..1
  private playSpeed = 0.1;     // fraction per second
  private currentFeatureType: string | undefined = undefined;
  private featureTypeSegments: FeatureTypeSegment[] = [];

  // Printer mode state
  // 'realtime': simulated printer feed advances automatically, auto Z-layer tracking
  // 'simulation': user controls playback (play/pause/speed/direction/scrub)
  private printerMode: 'realtime' | 'simulation' = 'realtime';
  private printerSpeed: number = 1;     // speed multiplier
  private printerDirection: 'forward' | 'backward' = 'forward';
  private autoLayerTracking: boolean = false; // auto-shift Z layer in realtime mode (gated by UI checkbox)
  private lastAutoLayerIdx: number = -1;     // last auto-selected layer (to avoid redundant updates)

  // Analysis features
  private infoPanel: InfoPanel | null = null;
  private positionOverlay: PositionOverlay | null = null;
  private comparisonPanel: ComparisonPanel | null = null;
  private diffPanel: DiffPanel | null = null;
  private remoteAnalysisSections: AnalysisSection[] = [];
  private remoteAnalysisAbort: AbortController | null = null;
  // Advanced visualization state
  private overhangHighlight = false;
  private zSeamVisible = false;
  private probeMarkersVisible = false;
  private drillMarkersVisible = false;
  private hackPanelVisible = false;
  private bridgesVisible = false;
  private supportVisible = false;
  private bookmarkManager: BookmarkManager | null = null;
  private gcodeMetadata: GetGcodeMetadataResponse | null = null;
  private jobSummary: GetJobSummaryResponse | null = null;
  private probeEvents: GetProbeEventsResponse | null = null;
  private drillingCycles: GetDrillingCyclesResponse | null = null;
  private totalDuration: number = 0;

  // Cached block state maps derived from server gcodeMetadata
  private blockFeedRates: Map<number, number> = new Map();
  private blockTools: Map<number, number> = new Map();
  private blockSpindleRpms: Map<number, number> = new Map();

  // Feature #66: Theme state
  private lightTheme = false;

  // Feature #120: Render statistics
  private showStats = false;
  private statsEl: HTMLElement | null = null;
  private frameCount = 0;
  private lastFpsTime = 0;
  private currentFps = 0;

  // Feature #48: Bounding box display
  private showBBox = false;
  private bboxEl: HTMLElement | null = null;

  // Feature #128: Layer count display
  private showLayerCount = false;
  private layerCountEl: HTMLElement | null = null;

  // BUG 3 FIX: Pending camera params from URL — applied after job data loads
  // (because loadJobData calls fitCameraToBounds which would override them)
  private pendingCamParams: { angle: number; elevation: number; distance: number } | null = null;

  // BUG 6 FIX: Track stats-only loop animation ID so it can be cancelled in destroy()
  private statsLoopId: number | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    rpcClient: RpcClient,
    topPanel: HTMLElement,
    gcodePanel: HTMLElement,
    navCubeContainer: HTMLElement,
  ) {
    this.canvas = canvas;
    this.rpcClient = rpcClient;
    this.camera = new Camera();

    // Build UI — control panel at top, gcode viewer on right, nav cube overlay
    this.controlPanel = new ControlPanel(topPanel);
    this.gcodeViewer = new GcodeViewer(gcodePanel);
    this.navCube = new NavigationCube(navCubeContainer);

    // Get miniplot DOM elements early (before init) so toggle works even if WebGPU fails
    this.miniplotContainer = document.getElementById('miniplot-container');
    this.miniplotLabel = document.getElementById('miniplot-label');

    this.setupEventHandlers();

    // Register global keyboard shortcuts early (before WebGPU init)
    // so they work even if WebGPU is not available
    window.addEventListener('keydown', (e) => this.handleKeyDown(e));

    // Feature #86: Drag-and-drop file upload
    this.setupDragAndDrop();
  }

  // Feature #86: Drag-and-drop file upload
  private setupDragAndDrop(): void {
    const dropZone = document.body;

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add('drag-active');
    });

    dropZone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.target === dropZone) {
        dropZone.classList.remove('drag-active');
      }
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('drag-active');

      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        // Find first G-code file
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const name = file.name.toLowerCase();
          if (name.endsWith('.gcode') || name.endsWith('.g') || name.endsWith('.nc') || name.endsWith('.ngc')) {
            this.handleUpload(file);
            break;
          }
        }
      }
    });
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
      // BUG 1 FIX: Check NURBS data first (the common path), then TTHR
      const bounds = this.getCurrentFullBounds();
      if (bounds) {
        this.fitCameraToBounds(
          { x: bounds.min[0], y: bounds.min[1], z: bounds.min[2] },
          { x: bounds.max[0], y: bounds.max[1], z: bounds.max[2] },
        );
      }
    });
    this.controlPanel.on('toggleGrid', () => {
      if (this.gridRenderer) this.gridRenderer.visible = !this.gridRenderer.visible;
      if (this.gridLabelRenderer) this.gridLabelRenderer.visible = this.gridRenderer?.visible ?? true;
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
    // Feature #3: Toggle retraction highlighting
    this.controlPanel.on('toggleRetractions', () => {
      if (this.nurbsRenderer) {
        this.nurbsRenderer.options.highlightRetractions = !this.nurbsRenderer.options.highlightRetractions;
        if (this.currentNBP) this.nurbsRenderer.updateData(this.currentNBP);
      }
    });
    // Feature #66: Toggle dark/light theme
    this.controlPanel.on('toggleTheme', () => {
      this.lightTheme = !this.lightTheme;
      document.documentElement.classList.toggle('light-theme', this.lightTheme);
    });
    // Feature #73: Toggle fullscreen mode
    this.controlPanel.on('toggleFullscreen', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    });
    // Feature #120: Toggle render statistics
    this.controlPanel.on('toggleStats', () => {
      this.showStats = !this.showStats;
      if (this.showStats) {
        if (!this.statsEl) {
          this.statsEl = document.createElement('div');
          this.statsEl.className = 'stats-overlay';
          this.statsEl.style.display = 'none';
          document.body.appendChild(this.statsEl);
        }
        this.statsEl.style.display = 'block';
      } else {
        if (this.statsEl) this.statsEl.style.display = 'none';
      }
    });
    // Feature #48: Toggle bounding box dimensions display
    this.controlPanel.on('toggleBoundingBox', () => {
      this.showBBox = !this.showBBox;
      if (this.showBBox) {
        if (!this.bboxEl) {
          this.bboxEl = document.createElement('div');
          this.bboxEl.className = 'bbox-overlay';
          this.bboxEl.style.display = 'none';
          document.body.appendChild(this.bboxEl);
        }
        this.updateBBoxDisplay();
        this.bboxEl.style.display = 'block';
      } else {
        if (this.bboxEl) this.bboxEl.style.display = 'none';
      }
    });
    // Feature #92: Copy current view URL to clipboard
    this.controlPanel.on('copyViewUrl', () => {
      const url = this.buildViewUrl();
      // BUG 9 FIX: Extract the status restoration logic so both success
      // and fallback paths use the same logic.
      const restoreStatus = () => {
        if (this.currentJobId) {
          this.controlPanel.setStatus(`Ready: ${this.currentFilename}`);
        } else {
          this.controlPanel.setStatus('Ready');
        }
      };
      navigator.clipboard.writeText(url).then(() => {
        this.controlPanel.setStatus('URL copied to clipboard!');
        setTimeout(restoreStatus, 2000);
      }).catch(() => {
        // Fallback: create a temporary input element
        const input = document.createElement('input');
        input.value = url;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
        this.controlPanel.setStatus('URL copied to clipboard!');
        setTimeout(restoreStatus, 2000);  // BUG 9 FIX: same restore logic
      });
    });
    // Feature #128: Toggle layer count display
    this.controlPanel.on('toggleLayerCount', () => {
      this.showLayerCount = !this.showLayerCount;
      if (this.showLayerCount) {
        if (!this.layerCountEl) {
          this.layerCountEl = document.createElement('div');
          this.layerCountEl.className = 'layer-count-overlay';
          this.layerCountEl.style.display = 'none';
          document.body.appendChild(this.layerCountEl);
        }
        this.updateLayerCountDisplay();
        this.layerCountEl.style.display = 'block';
      } else {
        if (this.layerCountEl) this.layerCountEl.style.display = 'none';
      }
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
    this.controlPanel.on('miniplotAxisChanged', (quantityName) => {
      const qMap: Record<string, WssPlotQuantity> = {
        'Velocity': 'velocity',
        'Acceleration': 'acceleration',
        'Jerk': 'jerk',
      };
      const q = qMap[quantityName] || 'velocity';
      if (this.miniplotRenderer instanceof WssMiniplotRenderer) {
        this.miniplotRenderer.setQuantity(q);
        this.updateMiniplotLabel();
      } else if (this.miniplotRenderer) {
        // Fallback: ComputeMiniplotRenderer/MiniplotRenderer use setAxis
        const axisMap: Record<string, string> = {
          'Velocity': 'speedLinear',
          'Acceleration': 'speedLinear',
          'Jerk': 'speedLinear',
        };
        const axis = axisMap[quantityName] || 'speedLinear';
        (this.miniplotRenderer as ComputeMiniplotRenderer).setAxis(axis as any);
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

    // Bookmark toggle from G-code viewer
    this.gcodeViewer.on('bookmarkToggled', (lineNum) => {
      if (this.bookmarkManager) {
        const added = this.bookmarkManager.toggleBookmark(lineNum);
        this.controlPanel.setStatus(added
          ? `Bookmarked line ${lineNum + 1}`
          : `Removed bookmark at line ${lineNum + 1}`);
        this.gcodeViewer.refresh();
      }
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

    // "Show only current Z layer" checkbox → toggle auto-layer-tracking
    this.controlPanel.on('toggleAutoLayerFilter', (enabled) => {
      this.autoLayerTracking = enabled;
      // When re-enabled, reset so auto-tracking resumes from the current
      // position. When disabled, restore the full toolpath.
      this.lastAutoLayerIdx = -1;
      if (!enabled) {
        this.applyLayerFilter(-1);
        this.controlPanel.setLayerValue(-1);
      } else {
        // Immediately apply the auto-layer filter for the current position
        // (updatePlayPosition is only called from the render loop when
        // playing or progress < 1.0, so we must trigger it manually here).
        this.updatePlayPosition();
      }
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

    // Printer mode toggle (realtime ↔ simulation)
    this.controlPanel.on('printerModeChanged', (mode) => {
      this.printerMode = mode;
      if (mode === 'simulation') {
        // In simulation mode, stop auto-advance; user controls playback
        this.lastAutoLayerIdx = -1; // reset so auto-tracking resumes when returning to realtime
      }
    });

    // Printer speed changed
    this.controlPanel.on('printerSpeedChanged', (speed) => {
      this.printerSpeed = speed;
    });

    // Printer direction changed
    this.controlPanel.on('printerDirectionChanged', (dir) => {
      this.printerDirection = dir;
    });

    // Return to realtime view
    this.controlPanel.on('returnToRealtime', () => {
      this.printerMode = 'realtime';
      this.printerDirection = 'forward';
      this.lastAutoLayerIdx = -1;
      this.controlPanel.setRealtimeMode();
    });

    // Analysis: Toggle info panel
    this.controlPanel.on('toggleInfoPanel', () => {
      if (this.infoPanel) {
        this.infoPanel.visible = !this.infoPanel.visible;
        this.updateInfoPanel();
      }
    });

    // Analysis: Export report
    this.controlPanel.on('exportReport', () => {
      this.exportReport();
    });

    // Tool filter: isolate toolpath by tool number
    this.controlPanel.on('toolFilterChanged', (toolNum) => {
      this.applyToolFilter(toolNum);
    });

    // Comparison panel toggle
    this.controlPanel.on('toggleComparison', () => {
      if (this.comparisonPanel) {
        this.comparisonPanel.visible = !this.comparisonPanel.visible;
      }
    });

    // G-code diff panel toggle
    this.controlPanel.on('toggleDiff', () => {
      if (this.diffPanel) {
        if (this.diffPanel.isVisible()) this.diffPanel.hide();
        else this.diffPanel.show();
      }
    });

    // Overhang highlighting toggle
    this.controlPanel.on('toggleOverhang', () => {
      this.overhangHighlight = !this.overhangHighlight;
      this.nurbsRenderer?.setHighlightOverhangs(this.overhangHighlight);
    });

    // Z-seam visualization toggle
    this.controlPanel.on('toggleZSeam', () => {
      this.zSeamVisible = !this.zSeamVisible;
      this.nurbsRenderer?.setZSeamVisible(this.zSeamVisible);
    });

    // Probe markers toggle
    this.controlPanel.on('toggleProbeMarkers', () => {
      this.probeMarkersVisible = !this.probeMarkersVisible;
      if (this.probeMarkersVisible) this.showProbeMarkers();
      else this.hideProbeMarkers();
    });

    // Drilling cycle markers toggle
    this.controlPanel.on('toggleDrillMarkers', () => {
      this.drillMarkersVisible = !this.drillMarkersVisible;
      if (this.drillMarkersVisible) this.showDrillMarkers();
      else this.hideDrillMarkers();
    });

    // G-code hack panel toggle
    this.controlPanel.on('toggleHackPanel', () => {
      this.hackPanelVisible = !this.hackPanelVisible;
      if (this.hackPanelVisible) this.showHackPanel();
      else this.hideHackPanel();
    });

    // Bridge highlighting toggle
    this.controlPanel.on('toggleBridges', () => {
      this.bridgesVisible = !this.bridgesVisible;
      this.nurbsRenderer?.setHighlightBridges(this.bridgesVisible);
    });

    // Support structure highlighting toggle
    this.controlPanel.on('toggleSupport', () => {
      this.supportVisible = !this.supportVisible;
      this.nurbsRenderer?.setHighlightSupport(this.supportVisible);
    });

    // Comparison: load second job as point cloud overlay
    this.comparisonPanel?.on('loadComparison', async (jobId) => {
      try {
        await this.loadComparisonJob(jobId);
      } catch (e) {
        console.error('Failed to load comparison job:', e);
      }
    });

    // Comparison: toggle overlay visibility
    this.comparisonPanel?.on('toggleOverlay', (show) => {
      if (this.pointCloudRenderer) {
        this.pointCloudRenderer.visible = show;
      }
    });

    // Comparison: difference mode (recolor point cloud)
    this.comparisonPanel?.on('differenceMode', (diff) => {
      if (this.pointCloudRenderer) {
        // In difference mode, use red color to highlight differences
        this.pointCloudRenderer.setColor(diff ? [1.0, 0.2, 0.1] : [0.2, 0.8, 1.0]);
      }
    });
  }

  async init(): Promise<void> {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('WebGPU not supported');
    this.adapter = adapter;
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
    // Initially (before any job is loaded) point the camera at the center of
    // the grid plane and orbit around it, rather than the grid's origin corner.
    this.camera.setTarget({ x: this.gridRenderer.centerX, y: this.gridRenderer.centerY, z: 0 });

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

    // Printer frame renderer (full printer stand-in model)
    this.printerFrameRenderer = new PrinterFrameRenderer(this.device);
    await this.printerFrameRenderer.init(this.format);

    // Tool change marker renderer
    this.toolChangeMarkerRenderer = new ToolChangeMarkerRenderer(this.device);
    await this.toolChangeMarkerRenderer.init(this.format);

    // Direction cube renderer (WebGPU-rendered 3D cube buttons)
    this.dirCubeRenderer = new DirectionCubeRenderer(this.device, this.navCube.dirCanvas);
    await this.dirCubeRenderer.init();

    // NURBS renderer (replaces ToolpathRenderer for large files)
    this.nurbsRenderer = new NurbsRenderer(this.device);
    await this.nurbsRenderer.init(this.format);

    // Grid labels: WebGPU 3D text renderer (coplanar with grid)
    this.gridLabelRenderer = new GridLabelRenderer(this.device);
    await this.gridLabelRenderer.init(this.format);
    // Generate initial label geometry from grid ticks
    if (this.gridRenderer) {
      this.gridLabelRenderer.updateLabels(this.gridRenderer.ticks);
    }

    // Miniplot renderer (WSS analytical, fallback to compute-shader resampled)
    if (this.miniplotContainer && this.device) {
      try {
        this.miniplotRenderer = new WssMiniplotRenderer(this.miniplotContainer, this.device);
        await this.miniplotRenderer.init();
      } catch (err) {
        console.warn('WssMiniplotRenderer init failed, falling back to ComputeMiniplotRenderer:', err);
        try {
          this.miniplotRenderer = new ComputeMiniplotRenderer(this.miniplotContainer, this.device);
          await this.miniplotRenderer.init();
        } catch (err2) {
          console.warn('ComputeMiniplotRenderer init failed, falling back to ChartGPU:', err2);
          this.miniplotRenderer = new MiniplotRenderer(this.miniplotContainer, this.device, this.adapter!);
          await this.miniplotRenderer.init();
        }
      }
      this.setupMiniplotInteraction(this.miniplotContainer);
    }

    // Analysis: Info panel and position overlay
    const gcodePanel = document.getElementById('gcode-panel');
    if (gcodePanel) {
      this.infoPanel = new InfoPanel(gcodePanel);
      this.infoPanel.visible = false; // hidden by default
      this.comparisonPanel = new ComparisonPanel(gcodePanel);
      this.comparisonPanel.visible = false; // hidden by default
      // G-code diff panel
      this.diffPanel = new DiffPanel(gcodePanel);
      this.diffPanel.on('fileUploaded', async (file: File) => {
        try {
          const newText = await file.text();
          const oldText = this.gcodeViewer?.allLines.join('\n') ?? '';
          const oldName = this.gcodeViewer?.filename ?? 'current';
          const result = await this.rpcClient.diffGcode(oldText, newText);
          this.diffPanel?.displayDiff(result, oldName, file.name);
        } catch (e) {
          console.error('Failed to diff G-code:', e);
        }
      });
    }
    const canvasContainer = document.getElementById('canvas-container');
    if (canvasContainer) {
      this.positionOverlay = new PositionOverlay(canvasContainer);
    }

    this.setupInputHandlers();
    this.startRenderLoop();
  }

  /**
   * Feature #120: Start a minimal animation loop for stats tracking
   * even when WebGPU is not available.
   */
  startStatsOnlyLoop(): void {
    const frame = (): void => {
      const now = performance.now();
      if (this.showStats) {
        this.frameCount++;
        if (this.lastFpsTime === 0) this.lastFpsTime = now;
        const elapsed = now - this.lastFpsTime;
        if (elapsed >= 500) {
          this.currentFps = Math.round((this.frameCount * 1000) / elapsed);
          this.frameCount = 0;
          this.lastFpsTime = now;
          if (this.statsEl) {
            const pieces = this.currentNBP?.pieces.length ?? 0;
            const samples = this.currentData?.header.sampleCount ?? 0;
            this.statsEl.innerHTML = `
              <div>FPS: <span class="stats-value">${this.currentFps}</span></div>
              <div>Pieces: <span class="stats-value">${pieces}</span></div>
              <div>Samples: <span class="stats-value">${samples}</span></div>
              <div>Canvas: <span class="stats-value">${this.canvas.width}×${this.canvas.height}</span></div>
            `;
          }
        }
      }
      // BUG 6 FIX: Store the animation ID so destroy() can cancel it
      this.statsLoopId = requestAnimationFrame(frame);
    };
    this.statsLoopId = requestAnimationFrame(frame);
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

    // Feature #150: Touch gesture support
    // BUG 8 FIX: touchIsPanning is now properly set when two fingers are used,
    // enabling two-finger pan. Single finger orbits, two-finger pinch zooms,
    // and two-finger drag pans.
    let touchLastX = 0, touchLastY = 0;
    let touchPinchDist = 0;
    let touchIsPanning = false;
    let touchTwoFingerLastX = 0, touchTwoFingerLastY = 0;

    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (e.touches.length === 1) {
        touchLastX = e.touches[0].clientX;
        touchLastY = e.touches[0].clientY;
        touchIsPanning = false;
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        touchPinchDist = Math.sqrt(dx * dx + dy * dy);
        // BUG 8 FIX: Enable panning with two-finger drag
        touchIsPanning = true;
        touchTwoFingerLastX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        touchTwoFingerLastY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      }
    }, { passive: false });

    this.canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (e.touches.length === 1) {
        const dx = e.touches[0].clientX - touchLastX;
        const dy = e.touches[0].clientY - touchLastY;
        touchLastX = e.touches[0].clientX;
        touchLastY = e.touches[0].clientY;
        if (touchIsPanning) {
          this.camera.pan(dx, dy);
        } else {
          this.camera.orbit(-dx * 0.01, dy * 0.01);
        }
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (touchPinchDist > 0) {
          const factor = touchPinchDist / dist;
          this.camera.zoom(factor);
        }
        touchPinchDist = dist;
        // BUG 8 FIX: Two-finger drag pans the camera
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        if (touchIsPanning) {
          const panDx = midX - touchTwoFingerLastX;
          const panDy = midY - touchTwoFingerLastY;
          this.camera.pan(panDx, panDy);
        }
        touchTwoFingerLastX = midX;
        touchTwoFingerLastY = midY;
      }
    }, { passive: false });

    this.canvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      if (e.touches.length === 0) {
        touchPinchDist = 0;
        touchIsPanning = false;
      } else if (e.touches.length === 1) {
        // Went from 2 fingers to 1 — switch back to orbit mode
        touchIsPanning = false;
        touchLastX = e.touches[0].clientX;
        touchLastY = e.touches[0].clientY;
      }
    }, { passive: false });

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

    // Ctrl+G → Go to line
    if ((e.ctrlKey || e.metaKey) && e.key === 'g') {
      e.preventDefault();
      if (this.gcodeViewer.isGotoVisible()) {
        this.gcodeViewer.hideGoto();
      } else {
        this.gcodeViewer.showGoto();
      }
      return;
    }

    // Escape → close search/goto if open, or close help overlay
    if (e.key === 'Escape') {
      if (this.gcodeViewer.isSearchVisible()) {
        this.gcodeViewer.hideSearch();
      }
      if (this.gcodeViewer.isGotoVisible()) {
        this.gcodeViewer.hideGoto();
      }
      this.hideHelpOverlay();
      return;
    }

    // Feature #68: ? → show keyboard shortcuts overlay
    if (e.key === '?' || (e.shiftKey && e.key === '/')) {
      e.preventDefault();
      this.toggleHelpOverlay();
      return;
    }

    // Don't process shortcuts when typing in inputs
    const target = e.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) {
      return;
    }

    // Feature #68: Keyboard shortcuts
    switch (e.key.toLowerCase()) {
      case 'g': {
        const buttons = document.querySelectorAll('#top-panel button');
        buttons.forEach(b => { if (b.textContent === 'Grid') (b as HTMLButtonElement).click(); });
        break;
      }
      case 't': {
        const buttons = document.querySelectorAll('#top-panel button');
        buttons.forEach(b => { if (b.textContent === 'Travels') (b as HTMLButtonElement).click(); });
        break;
      }
      case 'r':
        this.controlPanel.emit('resetView', undefined);
        break;
      case 'e':
        this.controlPanel.emit('exportImage', undefined);
        break;
      case 'i': {
        const buttons = document.querySelectorAll('#top-panel button');
        buttons.forEach(b => { if (b.textContent === 'Info') (b as HTMLButtonElement).click(); });
        break;
      }
      case 'b': {
        const buttons = document.querySelectorAll('#top-panel button');
        buttons.forEach(b => { if (b.textContent === 'BBox') (b as HTMLButtonElement).click(); });
        break;
      }
      case 'l': {
        const buttons = document.querySelectorAll('#top-panel button');
        buttons.forEach(b => { if (b.textContent === 'Layers') (b as HTMLButtonElement).click(); });
        break;
      }
      case 'm': {
        const buttons = document.querySelectorAll('#top-panel button');
        buttons.forEach(b => { if (b.textContent === 'Miniplot') (b as HTMLButtonElement).click(); });
        break;
      }
      case ' ':
        e.preventDefault();
        this.playing = !this.playing;
        this.controlPanel.setPlaying(this.playing);
        break;
    }
  }

  // Feature #68: Help overlay
  private helpOverlay: HTMLElement | null = null;

  private toggleHelpOverlay(): void {
    if (this.helpOverlay && this.helpOverlay.style.display !== 'none') {
      this.hideHelpOverlay();
    } else {
      this.showHelpOverlay();
    }
  }

  private showHelpOverlay(): void {
    if (!this.helpOverlay) {
      this.helpOverlay = document.createElement('div');
      this.helpOverlay.className = 'help-overlay';
      this.helpOverlay.innerHTML = `
        <div class="help-content">
          <h2>Keyboard Shortcuts</h2>
          <table>
            <tr><td><kbd>Ctrl+F</kbd></td><td>Search G-code</td></tr>
            <tr><td><kbd>Ctrl+G</kbd></td><td>Go to line number</td></tr>
            <tr><td><kbd>G</kbd></td><td>Toggle grid</td></tr>
            <tr><td><kbd>T</kbd></td><td>Toggle travel moves</td></tr>
            <tr><td><kbd>R</kbd></td><td>Reset view</td></tr>
            <tr><td><kbd>E</kbd></td><td>Export screenshot</td></tr>
            <tr><td><kbd>I</kbd></td><td>Toggle info/analysis panel</td></tr>
            <tr><td><kbd>B</kbd></td><td>Toggle bounding box</td></tr>
            <tr><td><kbd>L</kbd></td><td>Toggle layer count</td></tr>
            <tr><td><kbd>M</kbd></td><td>Toggle miniplot</td></tr>
            <tr><td><kbd>Space</kbd></td><td>Play/Pause animation</td></tr>
            <tr><td><kbd>?</kbd></td><td>Show this help</td></tr>
            <tr><td><kbd>Esc</kbd></td><td>Close help/search/goto</td></tr>
          </table>
          <p class="help-hint">Press <kbd>?</kbd> or <kbd>Esc</kbd> to close</p>
        </div>
      `;
      this.helpOverlay.style.display = 'none';
      document.body.appendChild(this.helpOverlay);
    }
    this.helpOverlay.style.display = 'flex';
  }

  private hideHelpOverlay(): void {
    if (this.helpOverlay) {
      this.helpOverlay.style.display = 'none';
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
      // Point inspection: show coordinates at clicked sample
      if (this.positionOverlay) {
        const px = positions[bestIdx * axes];
        const py = positions[bestIdx * axes + 1];
        const pz = positions[bestIdx * axes + 2];
        let feedRate: number | undefined;
        let toolNumber: number | undefined;
        let machineState: ReturnType<typeof this.getMachineStateAtLine> | undefined;
        if (this.gcodeMetadata) {
          feedRate = this.blockFeedRates.get(blockIdx);
          toolNumber = this.blockTools.get(blockIdx);
          // Find the line number for this block
          const block = this.currentNBP?.blocks.find(b => b.blockIndex === blockIdx);
          if (block) {
            machineState = this.getMachineStateAtLine(this.gcodeMetadata, block.lineNumber);
          }
        }
        this.positionOverlay.update({
          x: px, y: py, z: pz,
          progress: this.playProgress,
          totalTime: this.totalDuration,
          feedRate,
          toolNumber,
          spindleRpm: machineState?.spindleRpm,
          spindleDir: machineState?.spindleDir,
          hotendTemp: machineState?.hotendTemp,
          bedTemp: machineState?.bedTemp,
          fanSpeed: machineState?.fanSpeed,
          fanSpeedMax: this.gcodeMetadata?.maxFanSpeed,
          coolantState: machineState?.coolantState,
        });
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
        // BUG 16 FIX: Label the buffer so WebGPU validation errors identify it
        label: 'depth-readback',
      });
      this.depthData = null;
      this.depthReadbackPending = false;
      this.depthBufferSize = [w, h];
    }
  }

  private startRenderLoop(): void {
    let firstFrameRendered = false;
    const frame = (): void => {
      const now = performance.now();
      const dt = (now - this.lastFrameTime) / 1000;
      this.lastFrameTime = now;
      this.camera.update(dt);

      // Playback animation — driven by printer mode
      if (this.playing) {
        const baseSpeed = this.playSpeed * this.printerSpeed;
        const delta = dt * baseSpeed * (this.printerDirection === 'forward' ? 1 : -1);
        this.playProgress += delta;

        if (this.printerDirection === 'forward' && this.playProgress >= 1.0) {
          this.playProgress = 1.0;
          this.playing = false;
          this.controlPanel.setPlaying(false);
        } else if (this.printerDirection === 'backward' && this.playProgress <= 0.0) {
          this.playProgress = 0.0;
          this.playing = false;
          this.controlPanel.setPlaying(false);
        }

        this.controlPanel.setTimePosition(this.playProgress);
        this.updatePlayPosition();
      }

      // Realtime mode: auto-advance the print simulation
      if (this.printerMode === 'realtime' && !this.playing && this.playProgress < 1.0) {
        this.playProgress += dt * this.playSpeed * this.printerSpeed;
        if (this.playProgress >= 1.0) {
          this.playProgress = 1.0;
          // Print completed — unless the user opted into "show only current
          // Z layer", restore the full toolpath instead of leaving it
          // filtered to the last auto-tracked layer.
          if (!this.autoLayerTracking && this.lastAutoLayerIdx >= 0) {
            this.lastAutoLayerIdx = -1;
            this.applyLayerFilter(-1);
            this.controlPanel.setLayerValue(-1);
          }
        }
        this.controlPanel.setTimePosition(this.playProgress);
        this.updatePlayPosition();
      }

      this.render();

      // Signal that the first WebGPU frame has been rendered successfully.
      // E2E tests wait for this attribute before taking screenshots.
      if (!firstFrameRendered) {
        firstFrameRendered = true;
        this.canvas.setAttribute('data-ready', 'true');
      }

      // Feature #120: Update render statistics (in animation loop, not render(),
      // so stats work even when WebGPU is unavailable)
      if (this.showStats) {
        this.frameCount++;
        const elapsed = now - this.lastFpsTime;
        if (this.lastFpsTime === 0) this.lastFpsTime = now;
        if (elapsed >= 500) {
          this.currentFps = Math.round((this.frameCount * 1000) / elapsed);
          this.frameCount = 0;
          this.lastFpsTime = now;
          if (this.statsEl) {
            const pieces = this.currentNBP?.pieces.length ?? 0;
            const samples = this.currentData?.header.sampleCount ?? 0;
            this.statsEl.innerHTML = `
              <div>FPS: <span class="stats-value">${this.currentFps}</span></div>
              <div>Pieces: <span class="stats-value">${pieces}</span></div>
              <div>Samples: <span class="stats-value">${samples}</span></div>
              <div>Canvas: <span class="stats-value">${this.canvas.width}×${this.canvas.height}</span></div>
            `;
          }
        }
      }

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
    let pos: [number, number, number] | null = null;

    // Try NURBS renderer first (preferred path for most files)
    if (this.nurbsRenderer) {
      this.nurbsRenderer.setProgress(this.playProgress);
      pos = this.nurbsRenderer.getPositionAt(this.playProgress);
    }

    // Fall back to ToolpathRenderer (TTHR data)
    if (!pos && this.toolpathRenderer && this.currentData) {
      this.toolpathRenderer.setProgress(this.playProgress);
      pos = this.toolpathRenderer.getPositionAt(this.playProgress, this.currentData);
    }

    if (pos) {
      // Compute machine state from metadata for current progress
      let feedRate: number | undefined;
      let toolNumber: number | undefined;
      let machineState: ReturnType<typeof this.getMachineStateAtLine> | undefined;
      if (this.gcodeMetadata && this.gcodeViewer) {
        const blockCount = this.currentNBP?.pieces.length ?? 0;
        if (blockCount > 0) {
          const estBlock = Math.floor(this.playProgress * blockCount);
          feedRate = this.blockFeedRates.get(estBlock);
          toolNumber = this.blockTools.get(estBlock);
        }
        const lineCount = this.gcodeViewer.allLines.length;
        if (lineCount > 0) {
          const estLine = Math.floor(this.playProgress * lineCount);
          machineState = this.getMachineStateAtLine(this.gcodeMetadata, estLine);
          // Update current feature type from parsed segments
          if (this.featureTypeSegments.length > 0) {
            this.currentFeatureType = this.getFeatureTypeAtLine(estLine);
          }
        }
      }

      // Update print head marker
      if (this.printHeadMarker) {
        this.printHeadMarker.setPosition(pos[0], pos[1], pos[2]);
        this.printHeadMarker.visible = this.playProgress < 1.0;
      }
      // Update printer frame extruder position
      if (this.printerFrameRenderer) {
        this.printerFrameRenderer.setExtruderPosition(pos[0], pos[1], pos[2]);
        // Update bed temperature color from machine state
        if (machineState) {
          this.printerFrameRenderer.setBedTemperature(machineState.bedTemp);
        }
      }
      // Auto Z-layer tracking — gated by the "Show only current Z layer"
      // checkbox (default off). When enabled, the toolpath is filtered to
      // the current Z layer as the print head moves. When disabled (default),
      // the entire toolpath stays visible alongside the printer frame.
      if (this.autoLayerTracking && this.printerMode === 'realtime') {
        this.autoUpdateLayer(pos[2]);
      }
      // Update position overlay with live coordinates and machine state
      if (this.positionOverlay) {
        this.positionOverlay.update({
          x: pos[0], y: pos[1], z: pos[2],
          progress: this.playProgress,
          totalTime: this.totalDuration,
          feedRate,
          toolNumber,
          spindleRpm: machineState?.spindleRpm,
          spindleDir: machineState?.spindleDir,
          hotendTemp: machineState?.hotendTemp,
          bedTemp: machineState?.bedTemp,
          chamberTemp: machineState?.chamberTemp,
          fanSpeed: machineState?.fanSpeed,
          fanSpeedMax: this.gcodeMetadata?.maxFanSpeed,
          coolantState: machineState?.coolantState,
          featureType: this.currentFeatureType,
        });
      }
    }
  }

  /**
   * Automatically update the Z-layer filter based on the current Z position.
   * Finds the Z-layer whose height is closest to (but not above) the current
   * print Z, and applies it if it differs from the last auto-selected layer.
   */
  private autoUpdateLayer(currentZ: number): void {
    if (this.zLayers.length === 0) return;

    // Find the layer with the largest zHeight that is <= currentZ
    let bestIdx = -1;
    let bestZ = -Infinity;
    for (const layer of this.zLayers) {
      if (layer.zHeight <= currentZ && layer.zHeight > bestZ) {
        bestZ = layer.zHeight;
        bestIdx = layer.layerIndex;
      }
    }

    // If no layer found (e.g. currentZ is below the first layer), show all
    if (bestIdx < 0) bestIdx = -1;

    if (bestIdx !== this.lastAutoLayerIdx) {
      this.lastAutoLayerIdx = bestIdx;
      if (bestIdx >= 0) {
        this.applyLayerFilter(bestIdx);
        this.controlPanel.setLayerValue(bestIdx);
      }
    }
  }

  private render(): void {
    if (!this.device || !this.context || !this.depthTexture) return;
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: this.lightTheme
          ? { r: 0.94, g: 0.94, b: 0.95, a: 1 }
          : { r: 0.55, g: 0.56, b: 0.60, a: 1 },
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
    this.gridLabelRenderer?.render(pass, viewProj);
    this.nurbsRenderer?.render(pass, viewProj);
    this.toolpathRenderer?.render(pass, viewProj);
    this.crossSectionRenderer?.render(pass, viewProj);
    this.pointCloudRenderer?.render(pass, viewProj);
    this.printerFrameRenderer?.render(pass, viewProj);
    this.toolChangeMarkerRenderer?.render(pass, viewProj);
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
        // BUG 16 FIX: Use try/finally to guarantee unmap() is always called.
        // Previously, if getMappedRange() or the row-unpacking loop threw,
        // unmap() was never called and the buffer stayed mapped forever.
        // The .catch() handler would set depthReadbackPending = false,
        // causing the next frame to copy to a mapped buffer →
        // "Buffer used in submit while mapped" + "Buffer is already mapped".
        try {
          const [w, h] = this.depthBufferSize;
          const stride = this.depthPaddedRowFloats;
          const mapped = new Float32Array(buf.getMappedRange());
          // Unpack: copy row by row, skipping padding bytes at end of each row
          const compact = new Float32Array(w * h);
          for (let row = 0; row < h; row++) {
            compact.set(mapped.subarray(row * stride, row * stride + w), row * w);
          }
          this.depthData = compact;
        } finally {
          buf.unmap();
          this.depthReadbackPending = false;
        }
      }).catch(() => {
        // Stale callback: buffer was replaced by resize, don't touch pending
        if (gen !== this.depthReadbackGen) return;
        // mapAsync rejected (e.g., buffer was destroyed) — buffer is not mapped,
        // so no unmap() needed. Just release the pending flag.
        this.depthReadbackPending = false;
      });
    }

    // Render navigation gizmo (separate canvas, uses camera rotation only)
    this.navGizmo?.render(this.camera.viewRotationMatrix);

    // Render direction cubes (separate canvas)
    this.dirCubeRenderer?.render();
  }

  private exportImage(): void {
    const url = this.canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `tether-viewer-${Date.now()}.png`;
    a.click();
  }

  // ── Miniplot ─────────────────────────────────────────────────────────────

  private setupMiniplotInteraction(container: HTMLElement): void {
    // ChartGPU handles wheel zoom and drag-to-pan internally.
    this.miniplotRenderer?.onViewRangeChange(() => this.updateMiniplotLabel());

    container.addEventListener('dblclick', () => {
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
        this.updateMiniplotData();
        this.updateMiniplotLabel();
      });
      // Fetch segment speeds if not yet loaded (needed for event line numbers
      // and totalDuration even when using WSS analytical rendering)
      if (!this.miniplotData && this.currentJobId) {
        this.fetchMiniplotData(this.currentJobId);
      }
    }
  }

  /**
   * Push the current WSS data (or MiniplotData fallback) to the miniplot renderer.
   * Called when the miniplot becomes visible or when new data arrives.
   */
  private updateMiniplotData(): void {
    if (!this.miniplotRenderer) return;

    if (this.miniplotRenderer instanceof WssMiniplotRenderer) {
      if (this.currentWss) {
        this.miniplotRenderer.setWssData(this.currentWss);
        // Pass event lines and line-to-time map for overlays
        this.miniplotRenderer.setEventLines({
          toolChangeLines: this.miniplotData?.toolChangeLines,
          tempChangeLines: this.miniplotData?.tempChangeLines,
          fanChangeLines: this.miniplotData?.fanChangeLines,
          coolantChangeLines: this.miniplotData?.coolantChangeLines,
        });
        this.miniplotRenderer.setLineToTimeMap(this.buildLineToTimeMap());
      }
    } else if (this.miniplotData) {
      // Fallback: ComputeMiniplotRenderer or MiniplotRenderer
      (this.miniplotRenderer as ComputeMiniplotRenderer | MiniplotRenderer).setData(this.miniplotData);
    }
  }

  /**
   * Build a map from G-code line number to start time, using MiniplotData segments.
   */
  private buildLineToTimeMap(): Map<number, number> {
    const map = new Map<number, number>();
    if (this.miniplotData) {
      for (const s of this.miniplotData.segments) {
        if (!map.has(s.lineNumber)) {
          map.set(s.lineNumber, s.timeStart);
        }
      }
    }
    return map;
  }

  private async fetchMiniplotData(jobId: string): Promise<void> {
    try {
      const url = `${this.rpcClient.httpBaseUrl}/api/trajectory/${jobId}/speeds`;
      const resp = await fetch(url);
      if (!resp.ok) return;
      const json = await resp.json();
      this.miniplotData = json as MiniplotData;
      // Enrich miniplot data with event line numbers from metadata
      if (this.gcodeMetadata) {
        this.miniplotData.toolChangeLines = this.gcodeMetadata.toolChanges.map(tc => tc.lineNumber);
        this.miniplotData.tempChangeLines = this.gcodeMetadata.temperatureEvents.map(te => te.lineNumber);
        this.miniplotData.fanChangeLines = this.gcodeMetadata.fanEvents.map(fe => fe.lineNumber);
        this.miniplotData.coolantChangeLines = this.gcodeMetadata.coolantEvents.map(ce => ce.lineNumber);
      }
      // Update the miniplot renderer with the new data
      this.updateMiniplotData();
      this.updateMiniplotLabel();
      // Update total duration and info panel now that we have speed data
      if (this.miniplotData) {
        this.totalDuration = this.miniplotData.totalTime;
        this.updateInfoPanel();
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

  // ── Pressure Advance Plot ────────────────────────────────────────────────

  /**
   * Set up the PA plot panel with WebGPU canvas, overlay canvas, and controls.
   * Called after PA data is loaded.
   */
  private setupPaPlot(): void {
    if (!this.currentPaData || !this.device) return;

    // Create plot container if not already created
    if (!this.plotContainer) {
      this.plotContainer = document.createElement('div');
      this.plotContainer.style.cssText = `
        position: absolute; bottom: 0; left: 0; right: 0;
        height: 220px; background: rgba(10, 10, 15, 0.95);
        border-top: 1px solid rgba(100, 100, 120, 0.3);
        display: none; z-index: 50;
      `;
      this.canvas.parentElement?.appendChild(this.plotContainer);

      // Create WebGPU canvas for the plot
      this.plotCanvas = document.createElement('canvas');
      this.plotCanvas.width = 800;
      this.plotCanvas.height = 200;
      this.plotCanvas.style.cssText = 'display: block; width: 100%; height: 100%;';
      this.plotContainer.appendChild(this.plotCanvas);

      // Create 2D overlay canvas for grid/axes/text
      this.plotOverlayCanvas = document.createElement('canvas');
      this.plotOverlayCanvas.width = 800;
      this.plotOverlayCanvas.height = 200;
      this.plotOverlayCanvas.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none;';
      this.plotContainer.appendChild(this.plotOverlayCanvas);

      // Create PA controls panel
      this.paControls = new PaControls(this.plotContainer, (state) => {
        this.updatePaPlotSeries();
      });
    }

    // Initialize the GpuPlot
    if (!this.gpuPlot && this.plotCanvas) {
      this.gpuPlot = new GpuPlot(this.device, this.plotCanvas, {
        width: 800, height: 200,
        xLabel: 'Time (s)', yLabel: 'Value',
        title: 'Motion Profile & Pressure Advance',
      });
      this.gpuPlot.init(this.format).then(() => {
        this.updatePaPlotSeries();
        this.renderPaPlot();
      }).catch((e) => {
        console.error('Failed to init PA plot:', e);
      });
    } else if (this.gpuPlot) {
      this.updatePaPlotSeries();
      this.renderPaPlot();
    }

    // Show the plot container
    if (this.plotContainer) {
      this.plotContainer.style.display = 'block';
    }

    // Send PA data to NurbsRenderer for PA color modes
    if (this.nurbsRenderer && this.currentPaData) {
      // Default to first algorithm (Linear) for coloring
      const paEntry = this.currentPaData.paEntries[0];
      if (paEntry) {
        this.nurbsRenderer.updatePaData(paEntry);
      }
    }
  }

  /**
   * Update the plot series based on current PA controls state and TRNP data.
   */
  private updatePaPlotSeries(): void {
    if (!this.gpuPlot || !this.paControls) return;

    const state = this.paControls.getState();
    const series: PlotSeries[] = [];

    // Motion profile series from the analytical WSS (sampled to TRNP for the
    // PA plot; the miniplot at the bottom of the screen uses WssMiniplotRenderer
    // which evaluates the WSS analytically in a compute shader).
    const motionTrnp = this.currentWss
      ? wssToTrnp(this.currentWss)
      : null;
    if (motionTrnp) {
      if (state.showVelocity) {
        series.push({
          name: 'Velocity (mm/s)',
          color: [0.2, 0.8, 1.0],
          visible: true,
          segments: motionTrnp.segments,
          quantityIndex: 1,  // state texel (t, v, a, j) -> index 1 = velocity
          yLabel: 'mm/s',
          normalizeMax: motionTrnp.header.maxVelocity || 1,
        });
      }
      if (state.showAcceleration) {
        series.push({
          name: 'Acceleration (mm/s²)',
          color: [1.0, 0.6, 0.2],
          visible: true,
          segments: motionTrnp.segments,
          quantityIndex: 2,
          yLabel: 'mm/s²',
          normalizeMax: motionTrnp.header.maxAcceleration || 1,
        });
      }
      if (state.showJerk) {
        series.push({
          name: 'Jerk (mm/s³)',
          color: [1.0, 0.3, 0.5],
          visible: true,
          segments: motionTrnp.segments,
          quantityIndex: 3,
          yLabel: 'mm/s³',
          normalizeMax: motionTrnp.header.maxJerk || 1,
        });
      }
    }

    // PA series (from TRNP-PA)
    if (this.currentPaData) {
      const paEntry = this.currentPaData.paEntries.find(
        e => e.algorithmId === state.selectedAlgorithm);
      if (paEntry) {
        if (state.showPostPa) {
          series.push({
            name: `PA Offset - ${paEntry.algorithmName} (mm)`,
            color: [0.4, 1.0, 0.4],
            visible: true,
            segments: paEntry.segments,
            quantityIndex: 0,  // 0 = pressure_offset
            yLabel: 'mm',
            normalizeMax: paEntry.maxOffset || 1,
          });
        }
        if (state.showPrePa) {
          series.push({
            name: `Pre-PA Velocity - ${paEntry.algorithmName} (mm/s)`,
            color: [1.0, 0.8, 0.2],
            visible: true,
            segments: paEntry.segments,
            quantityIndex: 1,  // 1 = extruder_velocity
            yLabel: 'mm/s',
            normalizeMax: paEntry.maxVelocity || 1,
          });
        }
      }
    }

    this.gpuPlot.setSeries(series);
    this.renderPaPlot();
  }

  /**
   * Render the PA plot (GPU + overlay).
   */
  private renderPaPlot(): void {
    if (!this.gpuPlot || !this.plotOverlayCanvas) return;
    this.gpuPlot.render();
    const ctx = this.plotOverlayCanvas.getContext('2d');
    if (ctx) this.gpuPlot.renderOverlay(ctx);
  }

  /**
   * Set the camera to a standard view direction.
   * The camera is re-framed on the loaded object's bounding box so the
   * entire object is visible, then oriented to the requested direction.
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

    // Re-frame on the object's bounding box so the whole object is visible
    // regardless of any prior zoom/pan. fitCameraToBounds centers the orbit
    // target on the bbox midpoint and repositions the grid to match.
    const bounds = this.getCurrentFullBounds();
    if (bounds) {
      this.fitCameraToBounds(
        { x: bounds.min[0], y: bounds.min[1], z: bounds.min[2] },
        { x: bounds.max[0], y: bounds.max[1], z: bounds.max[2] },
      );
    }

    // Orient to the requested direction, keeping the distance just computed.
    const preset = presets[dir];
    this.camera.setOrbit(preset.angle, preset.elevation, this.camera.orbitDistanceVal);
  }

  private async handleUpload(file: File): Promise<void> {
    this.currentFilename = file.name;
    this.controlPanel.setStatus('Uploading...');
    this.controlPanel.setFileInfo(file.name); // Feature #84

    // Load raw G-code text into the viewer immediately (for the G-code panel)
    const text = await file.text();
    this.gcodeViewer.loadGcodeText(text, file.name);

    try {
      // Upload via HTTP (bypasses protobuf 2GB limit for large G-code files)
      const uploadResp = await this.rpcClient.uploadGcodeHttp(file);
      this.currentJobId = uploadResp.jobId;
      console.info(`Uploaded "${file.name}" → job ${uploadResp.jobId}`);
      await this.rpcClient.processJob(uploadResp.jobId);
      console.info(`Processing started for job ${uploadResp.jobId}`);
      await this.pollJobStatus(uploadResp.jobId);
    } catch (e) {
      console.error('Upload/processing failed:', e);
      this.controlPanel.setStatus(`Upload failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  }

  private async pollJobStatus(jobId: string): Promise<void> {
    const maxPolls = 120; // 60 seconds at 500ms intervals
    let pollCount = 0;
    const poll = async (): Promise<void> => {
      pollCount++;
      if (pollCount > maxPolls) {
        console.error(`Polling timeout for job ${jobId} after ${maxPolls} attempts`);
        this.controlPanel.setStatus('Processing timeout', 'error');
        return;
      }
      const status = await this.rpcClient.getJobStatus(jobId);
      console.info(`Job ${jobId} status: ${status.state}`);
      this.controlPanel.updateJobStatus(status);
      if (status.state === 'ready') {
        try {
          await this.loadJobData(jobId);
        } catch (e) {
          console.error('Failed to load job data:', e);
          this.controlPanel.setStatus(`Load failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
        }
      } else if (status.state === 'processing') {
        setTimeout(() => poll().catch((e) => {
          console.error(`Polling error for job ${jobId}:`, e);
          this.controlPanel.setStatus(`Polling failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
        }), 500);
      } else if (status.state === 'failed') {
        const errMsg = status.errorMessage || 'Unknown error';
        // Log full structured error to console for debugging
        console.group('%c[Job Failed]', 'color: #ff4444; font-weight: bold; font-size: 13px');
        console.error('Error:', errMsg);
        console.error('Job ID:', jobId);
        console.error('Full status:', status);
        console.groupEnd();
        this.controlPanel.setStatus(`Failed: ${errMsg}`, 'error');
      }
    };
    await poll();
  }

  private async loadJobData(jobId: string): Promise<void> {
    console.info(`Loading job data for ${jobId}...`);
    // BUG 2 FIX: Clear all stale data from previous job before loading new data.
    // Without this, if file A loaded as NBP and file B falls back to TTHR,
    // currentNBP would still point to file A's data, causing wrong bounds,
    // wrong layer filters, and wrong bbox display.
    this.currentNBP = null;
    this.currentTRNP = null;
    this.currentWss = null;
    this.currentPaData = null;
    this.currentData = null;
    this.fullData = null;
    this.zLayers = [];
    this.miniplotData = null;
    this.remoteAnalysisSections = [];
    if (this.remoteAnalysisAbort) {
      this.remoteAnalysisAbort.abort();
      this.remoteAnalysisAbort = null;
    }

    // Hide PA plot panel
    if (this.plotContainer) {
      this.plotContainer.style.display = 'none';
    }

    // Fetch NURBS path data — compact curve representation (typically <1MB
    // even for huge G-code files, vs 2GB+ for sampled trajectory data)
    try {
      const nbpBinary = await this.rpcClient.getNurbsPathHttp(jobId);
      this.currentNBP = parseNBP(nbpBinary);
      this.nurbsRenderer?.updateData(this.currentNBP);
      console.info(`NURBS data loaded: ${this.currentNBP.header.pieceCount} pieces, ` +
                   `${this.currentNBP.header.totalControlPoints} control points, ` +
                   `${nbpBinary.byteLength} bytes`);

      // Fit camera to NURBS bounds and reposition grid
      const h = this.currentNBP.header;
      this.fitCameraToBounds(
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

      // Fetch the analytical Weighted Switching Structure (TWSF format) —
      // the Pareto-optimal velocity plan as a list of analytically integrable
      // arcs. NO sampling. The WebGPU shaders evaluate v/a/j/t in closed form.
      try {
        const wssBinary = await this.rpcClient.getWssHttp(jobId);
        this.currentWss = parseTWSF(wssBinary);
        this.nurbsRenderer?.updateWss(this.currentWss);
        console.info(`WSS loaded: ${this.currentWss.arcs.length} arcs, ` +
                     `${wssBinary.byteLength} bytes, totalLength=${this.currentWss.totalLength.toFixed(1)}mm`);
        // Update miniplot if visible and using WssMiniplotRenderer
        if (this.miniplotVisible) {
          this.updateMiniplotData();
          this.updateMiniplotLabel();
        }
      } catch (e) {
        // WSS is optional — if it fails, the renderer falls back to
        // ReNURBS or piece-level coloring.
        console.info('WSS not available:', (e as Error).message);
        this.currentWss = null;
      }

      // Fetch pressure advance profiles (TRNP-PA format) — per-algorithm
      // NURBS curves for PA pre/post (Linear, PowerLaw, CrossWLF, LTI, LPV).
      // Selectable in the UI for visualization in the plot and color modes.
      try {
        const paBinary = await this.rpcClient.getPaHttp(jobId);
        this.currentPaData = parseTRNPPa(paBinary);
        console.info(`PA data loaded: ${this.currentPaData.paEntries.length} algorithms, ` +
                     `${paBinary.byteLength} bytes`);
        this.setupPaPlot();
      } catch (e) {
        // PA is optional — if it fails, continue without it.
        console.info('PA data not available');
        this.currentPaData = null;
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
      this.fitCameraToBounds(
        { x: h.boundsMin[0], y: h.boundsMin[1], z: h.boundsMin[2] },
        { x: h.boundsMax[0], y: h.boundsMax[1], z: h.boundsMax[2] },
      );
    }

    // Load blocks (G-code metadata with line numbers)
    try {
      const blocks = await this.rpcClient.getBlocks(jobId);
      this.gcodeViewer.updateBlocks(blocks);
    } catch (e) { console.error('Failed to load blocks:', e); }

    // Load Z-layers for layer navigation via WebSocket
    try {
      const layersResp = await this.rpcClient.getZLayers(jobId);
      // Map WS response (sampleStart/sampleEnd) to the internal format
      // (pieceStart/pieceEnd) used by applyLayerFilter.
      const mappedLayers = layersResp.layers.map(l => ({
        layerIndex: l.layerIndex,
        zHeight: l.zHeight,
        pieceStart: l.sampleStart,
        pieceEnd: l.sampleEnd,
        pieceCount: l.sampleCount,
      }));
      // Filter out travel-only layers: a layer is only useful for navigation
      // if it contains at least one extruding piece. Travel-only layers
      // (e.g., Z-hop moves between print layers) are excluded so the slider
      // only stops on real print layers.
      this.zLayers = this.filterExtrudingLayers(mappedLayers);
      const filteredResp = { layers: this.zLayers, totalLayers: this.zLayers.length };
      this.controlPanel.updateLayersFromHttp(filteredResp);
      if (this.showLayerCount) this.updateLayerCountDisplay(); // Feature #128
    } catch (e) { console.error('Failed to load Z-layers:', e); }

    // Load miniplot speed data (always fetch — needed for analysis even if miniplot is hidden)
    this.fetchMiniplotData(jobId);

    // Start streaming C++ G-code analysis in the background. This is decoupled
    // from trajectory processing so it can run heavy-duty checks in parallel.
    this.startRemoteAnalysis(jobId);

    // Reset playback
    this.playProgress = 1.0;
    this.playing = false;
    this.controlPanel.setPlaying(false);
    this.updatePlayPosition();

    // Set printer frame bounds from the loaded object's bounding box
    const bounds = this.getCurrentFullBounds();
    if (bounds && this.printerFrameRenderer) {
      this.printerFrameRenderer.setBounds(
        [bounds.min[0], bounds.min[1], bounds.min[2]],
        [bounds.max[0], bounds.max[1], bounds.max[2]],
      );
    }

    // Reset to realtime mode on new file load
    this.printerMode = 'realtime';
    this.printerDirection = 'forward';
    this.lastAutoLayerIdx = -1;
    this.controlPanel.setRealtimeMode();

    // Parse G-code metadata for analysis features
    await this.parseMetadataAndUpdate();

    // Update info panel if visible
    this.updateInfoPanel();

    // BUG 3 FIX: Apply deferred camera params from URL after data has loaded
    // and fitCameraToBounds has been called. This ensures ?cam= is not overridden.
    if (this.pendingCamParams) {
      this.camera.setOrbit(
        this.pendingCamParams.angle,
        this.pendingCamParams.elevation,
        this.pendingCamParams.distance,
      );
      console.info(`Deferred camera params applied: angle=${this.pendingCamParams.angle}, elev=${this.pendingCamParams.elevation}, dist=${this.pendingCamParams.distance}`);
      this.pendingCamParams = null;
    }
  }

  /**
   * Stream server-side G-code analysis from the C++ Tether analyzers.
   * Collects sections as they arrive and refreshes the info panel.
   */
  private startRemoteAnalysis(jobId: string): void {
    const abort = new AbortController();
    this.remoteAnalysisAbort = abort;

    (async () => {
      try {
        for await (const msg of this.rpcClient.streamAnalysis(jobId, { detailLevel: 'standard', topEventLimit: 32 }, abort.signal)) {
          const payload = msg.payload;
          if (payload.case === 'section') {
            this.remoteAnalysisSections.push(payload.value);
            this.updateInfoPanel();
          } else if (msg.sections.length > 0) {
            this.remoteAnalysisSections.push(...msg.sections);
            this.updateInfoPanel();
          } else if (payload.case === 'progress') {
            console.info(`[RemoteAnalysis] ${payload.value.status} ${payload.value.progressPercent}%`);
          }

          if (msg.complete) break;
        }
      } catch (e) {
        if (abort.signal.aborted) {
          console.info('[RemoteAnalysis] cancelled');
        } else {
          console.error('[RemoteAnalysis] failed:', e);
        }
      } finally {
        if (this.remoteAnalysisAbort === abort) {
          this.remoteAnalysisAbort = null;
        }
      }
    })();
  }

  /**
   * Filter out travel-only layers from the Z-layer list.
   * A layer is kept only if at least one piece in its [pieceStart, pieceEnd]
   * range has a non-zero extruderSpeed (i.e., it's extruding material).
   * Layers that only contain travel moves (Z-hops, rapid positioning) are
   * excluded so the layer slider only stops on real print layers.
   * Layer indices are re-numbered sequentially after filtering.
   */
  private filterExtrudingLayers(
    layers: { layerIndex: number; zHeight: number; pieceStart: number; pieceEnd: number; pieceCount: number }[],
  ): typeof layers {
    if (!this.currentNBP || layers.length === 0) return layers;

    const pieces = this.currentNBP.pieces;
    const filtered: typeof layers = [];

    for (const layer of layers) {
      let hasExtrusion = false;
      for (let i = layer.pieceStart; i <= layer.pieceEnd && i < pieces.length; i++) {
        if (pieces[i].extruderSpeed > 0 || pieces[i].motionType > 0) {
          hasExtrusion = true;
          break;
        }
      }
      if (hasExtrusion) {
        filtered.push({
          ...layer,
          layerIndex: filtered.length, // re-number sequentially
        });
      }
    }

    if (filtered.length < layers.length) {
      console.info(`Filtered Z-layers: ${layers.length} → ${filtered.length} (removed ${layers.length - filtered.length} travel-only layers)`);
    }

    return filtered.length > 0 ? filtered : layers;
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

  /**
   * Filter the toolpath to show only pieces cut by a specific tool.
   * Uses cached blockTools map derived from server gcodeMetadata.
   */
  /** Show probe point markers on the 3D view */
  private showProbeMarkers(): void {
    if (!this.gcodeViewer || !this.probeEvents) return;
    for (const e of this.probeEvents.events) {
      this.gcodeViewer.highlightLine(e.lineNumber);
    }
  }

  /** Hide probe point markers */
  private hideProbeMarkers(): void {
    if (!this.gcodeViewer) return;
    this.gcodeViewer.clearHighlight();
  }

  /** Show drilling cycle markers on the 3D view */
  private showDrillMarkers(): void {
    if (!this.gcodeViewer || !this.drillingCycles) return;
    for (const c of this.drillingCycles.cycles) {
      this.gcodeViewer.highlightLine(c.lineNumber);
    }
  }

  /** Hide drilling cycle markers */
  private hideDrillMarkers(): void {
    if (!this.gcodeViewer) return;
    this.gcodeViewer.clearHighlight();
  }

  /** Show G-code hack panel for transforming G-code */
  private showHackPanel(): void {
    if (!this.gcodeViewer) return;
    // Apply a simple transform as demonstration (translate X by 10)
    // In a full implementation, this would show a UI panel with transform options
    const lines = this.gcodeViewer.allLines;
    if (lines.length === 0) return;
    // Just trigger a re-render with transform options applied
    // The actual transform UI would be a separate panel
  }

  /** Hide G-code hack panel */
  private hideHackPanel(): void {
    // Nothing to hide (placeholder for UI panel)
  }

  private applyToolFilter(toolNumber: number): void {
    if (!this.currentNBP || !this.gcodeMetadata) return;

    if (toolNumber < 0) {
      // Show all tools — reset to full data
      this.nurbsRenderer?.updateData(this.currentNBP);
      this.updatePlayPosition();
      return;
    }

    // Filter NBP pieces to only those blocks with the selected tool
    const filteredPieces = this.currentNBP.pieces.filter((_, i) => {
      return this.blockTools.get(i) === toolNumber;
    });

    if (filteredPieces.length === 0) {
      this.controlPanel.setStatus(`No pieces for T${toolNumber}`);
      return;
    }

    const filteredNBP: NBPData = {
      header: { ...this.currentNBP.header, pieceCount: filteredPieces.length },
      pieces: filteredPieces,
      blocks: this.currentNBP.blocks,
    };
    this.nurbsRenderer?.updateData(filteredNBP);
    this.updatePlayPosition();
  }

  /**
   * Fetch G-code metadata, feature types, probe events, drilling cycles,
   * and the job summary from the server. Then update markers, color
   * attributes, and cached block-state maps used during playback.
   */
  private async parseMetadataAndUpdate(): Promise<void> {
    if (!this.gcodeViewer || !this.currentJobId) return;

    // Initialize bookmark manager for this file
    this.bookmarkManager = new BookmarkManager(this.gcodeViewer.filename || 'default');

    // Reset cached metadata
    this.gcodeMetadata = null;
    this.jobSummary = null;
    this.probeEvents = null;
    this.drillingCycles = null;
    this.featureTypeSegments = [];
    this.blockFeedRates.clear();
    this.blockTools.clear();
    this.blockSpindleRpms.clear();

    try {
      const [gcodeMetadata, featureTypes, probeEvents, drillingCycles, jobSummary] = await Promise.all([
        this.rpcClient.getGcodeMetadata(this.currentJobId),
        this.rpcClient.getFeatureTypes(this.currentJobId),
        this.rpcClient.getProbeEvents(this.currentJobId),
        this.rpcClient.getDrillingCycles(this.currentJobId),
        this.rpcClient.getJobSummary(this.currentJobId),
      ]);

      this.gcodeMetadata = gcodeMetadata;
      this.featureTypeSegments = featureTypes.segments;
      this.probeEvents = probeEvents;
      this.drillingCycles = drillingCycles;
      this.jobSummary = jobSummary;

      // Cache block states for fast playback / overlay lookups
      for (const s of gcodeMetadata.blockStates) {
        this.blockFeedRates.set(s.blockIndex, s.feedRate);
        this.blockTools.set(s.blockIndex, s.toolNumber);
        this.blockSpindleRpms.set(s.blockIndex, s.spindleRpm);
      }

      // Enrich miniplot data with event line numbers if already loaded
      if (this.miniplotData) {
        this.miniplotData.toolChangeLines = gcodeMetadata.toolChanges.map(tc => tc.lineNumber);
        this.miniplotData.tempChangeLines = gcodeMetadata.temperatureEvents.map(te => te.lineNumber);
        this.miniplotData.fanChangeLines = gcodeMetadata.fanEvents.map(fe => fe.lineNumber);
        this.miniplotData.coolantChangeLines = gcodeMetadata.coolantEvents.map(ce => ce.lineNumber);
        // Update miniplot renderer with enriched event data
        this.updateMiniplotData();
        this.updateMiniplotLabel();
      }

      // Update tool change markers with 3D positions
      if (this.toolChangeMarkerRenderer && this.nurbsRenderer && this.currentNBP) {
        const markers: { position: [number, number, number]; toolNumber: number }[] = [];
        for (const tc of gcodeMetadata.toolChanges) {
          const blockIdx = this.gcodeViewer.lineToBlockMap.get(tc.lineNumber);
          if (blockIdx !== undefined && blockIdx < this.currentNBP.pieces.length) {
            const piece = this.currentNBP.pieces[blockIdx];
            if (piece.controlPoints.length >= 3) {
              markers.push({
                position: [piece.controlPoints[0], piece.controlPoints[1], piece.controlPoints[2]],
                toolNumber: tc.toolNumber,
              });
            }
          }
        }
        this.toolChangeMarkerRenderer.updateMarkers(markers);
      }

      // Update feed rates for the feedRate color attribute
      if (this.nurbsRenderer && this.currentNBP) {
        const feedRates: number[] = [];
        const spindleRpms: number[] = [];
        const toolNumbers: number[] = [];
        for (let i = 0; i < this.currentNBP.pieces.length; i++) {
          feedRates.push(this.blockFeedRates.get(i) || 0);
          spindleRpms.push(this.blockSpindleRpms.get(i) || 0);
          toolNumbers.push(this.blockTools.get(i) || 0);
        }
        this.nurbsRenderer.setFeedRates(feedRates);
        this.nurbsRenderer.setSpindleRpms(spindleRpms);
        this.nurbsRenderer.setToolNumbers(toolNumbers);
      }

      // Update tool filter dropdown
      if (gcodeMetadata.tools.length > 0) {
        this.controlPanel.updateTools(gcodeMetadata.tools);
      }

      // Get total duration from job summary or miniplot data
      if (jobSummary.printTimeEstimate) {
        this.totalDuration = jobSummary.printTimeEstimate.estimatedTime;
      } else if (this.miniplotData) {
        this.totalDuration = this.miniplotData.totalTime;
      }
    } catch (e) {
      console.error('Failed to fetch G-code metadata:', e);
    }
  }

  /**
   * Private helper: get the active machine state at a given 0-indexed line.
   */
  private getMachineStateAtLine(
    gcodeMetadata: GetGcodeMetadataResponse,
    lineNumber: number,
  ): {
    spindleRpm: number;
    spindleDir: 'cw' | 'ccw' | 'off';
    hotendTemp: number;
    bedTemp: number;
    chamberTemp: number;
    fanSpeed: number;
    coolantState: 'mist' | 'flood' | 'off';
  } {
    let spindleRpm = 0;
    let spindleDir: 'cw' | 'ccw' | 'off' = 'off';
    let hotendTemp = 0;
    let bedTemp = 0;
    let chamberTemp = 0;
    let fanSpeed = 0;
    let coolantState: 'mist' | 'flood' | 'off' = 'off';

    for (const e of gcodeMetadata.spindleEvents) {
      if (e.lineNumber > lineNumber) break;
      spindleRpm = e.rpm;
      spindleDir = e.direction as 'cw' | 'ccw' | 'off';
    }
    for (const e of gcodeMetadata.temperatureEvents) {
      if (e.lineNumber > lineNumber) break;
      if (e.hotend !== undefined) hotendTemp = e.hotend;
      if (e.bed !== undefined) bedTemp = e.bed;
      if (e.chamber !== undefined) chamberTemp = e.chamber;
    }
    for (const e of gcodeMetadata.fanEvents) {
      if (e.lineNumber > lineNumber) break;
      fanSpeed = e.speed;
    }
    for (const e of gcodeMetadata.coolantEvents) {
      if (e.lineNumber > lineNumber) break;
      coolantState = e.state as 'mist' | 'flood' | 'off';
    }

    return { spindleRpm, spindleDir, hotendTemp, bedTemp, chamberTemp, fanSpeed, coolantState };
  }

  /**
   * Private helper: get the active feature type at a 0-indexed line.
   */
  private getFeatureTypeAtLine(lineNumber: number): string | undefined {
    let active: string | undefined = undefined;
    for (const seg of this.featureTypeSegments) {
      if (seg.startLine > lineNumber) break;
      active = seg.featureType;
    }
    return active;
  }

  /**
   * Update the info panel with all available analysis data.
   */
  private updateInfoPanel(): void {
    if (!this.infoPanel || !this.infoPanel.visible) return;

    const bounds = this.getCurrentFullBounds();
    if (!bounds) return;

    this.infoPanel.update({
      gcodeMetadata: this.gcodeMetadata ?? undefined,
      jobSummary: this.jobSummary ?? undefined,
      featureTypeSegments: this.featureTypeSegments,
      zLayers: this.zLayers,
      totalDuration: this.totalDuration,
      pathLength: this.currentNBP?.header.totalLength ?? 0,
      bounds: { min: bounds.min as [number, number, number], max: bounds.max as [number, number, number] },
      sampleCount: this.currentData?.header.sampleCount ?? 0,
      pieceCount: this.currentNBP?.pieces.length ?? 0,
      materialUsage: this.jobSummary?.materialUsage,
      remoteSections: this.remoteAnalysisSections,
    });
  }

  /**
   * Export a comprehensive analysis report as a JSON file download.
   */
  private exportReport(): void {
    if (!this.gcodeMetadata || !this.jobSummary) {
      this.controlPanel.setStatus('No data loaded');
      return;
    }

    const bounds = this.getCurrentFullBounds();
    const speedStats = this.jobSummary.speedStats ?? { minSpeed: 0, maxSpeed: 0, meanSpeed: 0, medianSpeed: 0 };
    const layerTimes = this.jobSummary.layerTimes ?? [];
    const materialUsage = this.jobSummary.materialUsage;

    const report = {
      generated: new Date().toISOString(),
      job: {
        filename: this.gcodeViewer?.filename ?? 'unknown',
        pieceCount: this.currentNBP?.pieces.length ?? 0,
        sampleCount: this.currentData?.header.sampleCount ?? 0,
        pathLength: this.currentNBP?.header.totalLength ?? 0,
        duration: this.totalDuration,
        durationFormatted: formatTime(this.totalDuration),
      },
      dimensions: bounds ? {
        min: { x: bounds.min[0], y: bounds.min[1], z: bounds.min[2] },
        max: { x: bounds.max[0], y: bounds.max[1], z: bounds.max[2] },
        size: {
          x: bounds.max[0] - bounds.min[0],
          y: bounds.max[1] - bounds.min[1],
          z: bounds.max[2] - bounds.min[2],
        },
      } : null,
      tools: this.gcodeMetadata.tools,
      toolChanges: this.gcodeMetadata.toolChanges,
      spindleEvents: this.gcodeMetadata.spindleEvents,
      temperatureEvents: this.gcodeMetadata.temperatureEvents,
      fanEvents: this.gcodeMetadata.fanEvents,
      coolantEvents: this.gcodeMetadata.coolantEvents,
      feedRateRange: { min: this.gcodeMetadata.minFeedRate, max: this.gcodeMetadata.maxFeedRate },
      speedStats,
      layerCount: layerTimes.length,
      layerTimes: layerTimes.map(l => ({
        layer: l.layerIndex,
        zHeight: l.zHeight,
        timeSeconds: l.timeSeconds,
        timeFormatted: formatTime(l.timeSeconds),
      })),
      materialUsage: materialUsage ?? null,
      featureTypes: this.featureTypeSegments,
      gcodeMetadata: this.gcodeMetadata,
      jobSummary: this.jobSummary,
      remoteAnalysis: this.remoteAnalysisSections,
    };

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.gcodeViewer?.filename ?? 'report'}.analysis.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.controlPanel.setStatus('Report exported');
  }

  /**
   * Load a comparison job and overlay it as a point cloud.
   */
  private async loadComparisonJob(jobId: string): Promise<void> {
    try {
      this.controlPanel.setStatus('Loading comparison...');
      // Fetch TTHR binary data for the comparison job
      const url = `${this.rpcClient.httpBaseUrl}/api/trajectory/${jobId}/binary?fields=pos&axes=3`;
      const resp = await fetch(url);
      if (!resp.ok) {
        this.controlPanel.setStatus(`Comparison load failed: ${resp.statusText}`);
        return;
      }
      const buf = await resp.arrayBuffer();
      const data = parseTTHR(new Uint8Array(buf));
      if (this.pointCloudRenderer) {
        this.pointCloudRenderer.updateData(data);
        this.pointCloudRenderer.visible = true;
      }
      this.controlPanel.setStatus('Comparison loaded');
    } catch (e) {
      this.controlPanel.setStatus(`Comparison error: ${e}`);
    }
  }

  destroy(): void {
    if (this.animationId !== null) cancelAnimationFrame(this.animationId);
    // BUG 6 FIX: Cancel the stats-only animation loop
    if (this.statsLoopId !== null) {
      cancelAnimationFrame(this.statsLoopId);
      this.statsLoopId = null;
    }
    this.resizeObserver?.disconnect();
    this.gizmoResizeObserver?.disconnect();
    this.dirCubeResizeObserver?.disconnect();
    this.resizeObserver = null;
    this.gizmoResizeObserver = null;
    this.dirCubeResizeObserver = null;
    this.toolpathRenderer?.destroy();
    this.nurbsRenderer?.destroy();
    this.gridRenderer?.destroy();
    this.gridLabelRenderer?.destroy();
    this.gridLabels?.destroy();
    this.crossSectionRenderer?.destroy();
    this.pointCloudRenderer?.destroy();
    this.overlayRenderer?.destroy();
    this.navGizmo?.destroy();
    this.printHeadMarker?.destroy();
    this.printerFrameRenderer?.destroy();
    this.toolChangeMarkerRenderer?.destroy();
    this.dirCubeRenderer?.destroy();
    this.depthTexture?.destroy();
    this.depthTexture = null;
    this.depthReadbackGen++;  // invalidate any in-flight mapAsync callbacks
    this.depthReadbackBuffer?.destroy();
    this.depthReadbackBuffer = null;
    this.depthData = null;
    // BUG 6 FIX: Remove dynamically created DOM elements to prevent leaks
    this.statsEl?.remove();
    this.statsEl = null;
    this.bboxEl?.remove();
    this.bboxEl = null;
    this.layerCountEl?.remove();
    this.layerCountEl = null;
    this.helpOverlay?.remove();
    this.helpOverlay = null;
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
   * Feature #93: Load a job from URL parameter.
   * This allows sharing views via URL with ?job=xxx parameter.
   */
  async loadJobFromUrl(jobId: string): Promise<void> {
    this.currentJobId = jobId;
    try {
      // Poll for job status and load data when ready
      this.controlPanel.setStatus('Loading job...');
      const maxPolls = 120;
      let pollCount = 0;
      const poll = async (): Promise<void> => {
        pollCount++;
        if (pollCount > maxPolls) {
          console.error(`Polling timeout for job ${jobId} after ${maxPolls} attempts`);
          this.controlPanel.setStatus('Loading timeout', 'error');
          return;
        }
        const status = await this.rpcClient.getJobStatus(jobId);
        this.controlPanel.updateJobStatus(status);
        if (status.state === 'ready') {
          try {
            await this.loadJobData(jobId);
            // Update bbox display if visible
            if (this.showBBox) this.updateBBoxDisplay();
          } catch (e) {
            console.error('Failed to load job data:', e);
            this.controlPanel.setStatus(`Load failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
          }
        } else if (status.state === 'processing') {
          setTimeout(() => poll().catch((e) => {
            console.error(`Polling error for job ${jobId}:`, e);
            this.controlPanel.setStatus(`Polling failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
          }), 500);
        } else if (status.state === 'failed') {
          const errMsg = status.errorMessage || 'Unknown error';
          console.group('%c[Job Failed]', 'color: #ff4444; font-weight: bold; font-size: 13px');
          console.error('Error:', errMsg);
          console.error('Job ID:', jobId);
          console.error('Full status:', status);
          console.groupEnd();
          this.controlPanel.setStatus(`Failed: ${errMsg}`, 'error');
        }
      };
      await poll();
    } catch (e) {
      console.error('Failed to load job from URL:', e);
      this.controlPanel.setStatus(`Failed to load job: ${(e as Error).message}`);
    }
  }

  /**
   * Feature #145: Apply camera position from URL parameter.
   * Format: "angle,elevation,distance" (e.g. "0.5,0.3,400")
   * BUG 3 FIX: If a job is being loaded, defer applying the camera until
   * after loadJobData completes, because loadJobData calls
   * fitCameraToBounds() which would override the URL camera params.
   */
  applyCameraFromUrl(camParam: string): void {
    const parts = camParam.split(',').map(parseFloat);
    if (parts.length >= 3 && parts.every(v => !isNaN(v))) {
      const params = { angle: parts[0], elevation: parts[1], distance: parts[2] };
      if (this.currentJobId && !this.currentNBP && !this.fullData) {
        // Job is loading but data not yet available — defer until data loads
        this.pendingCamParams = params;
        console.info(`Camera params deferred until job data loads: angle=${params.angle}, elev=${params.elevation}, dist=${params.distance}`);
      } else {
        // No job loading, or data already loaded — apply immediately
        this.camera.setOrbit(params.angle, params.elevation, params.distance);
        console.info(`Camera applied from URL: angle=${params.angle}, elev=${params.elevation}, dist=${params.distance}`);
      }
    } else {
      console.info('Invalid camera URL parameter:', camParam);
    }
  }

  /**
   * Feature #92: Build a shareable URL with current view state.
   * Includes job ID and camera position parameters.
   */
  buildViewUrl(): string {
    const base = window.location.origin + window.location.pathname;
    const params = new URLSearchParams();
    if (this.currentJobId) {
      params.set('job', this.currentJobId);
    }
    const angle = this.camera.orbitAngleVal.toFixed(4);
    const elev = this.camera.orbitElevationVal.toFixed(4);
    const dist = this.camera.orbitDistanceVal.toFixed(2);
    params.set('cam', `${angle},${elev},${dist}`);
    return `${base}?${params.toString()}`;
  }

  /**
   * Feature #128: Update layer count display.
   */
  private updateLayerCountDisplay(): void {
    if (!this.layerCountEl) return;
    if (this.zLayers.length === 0) {
      this.layerCountEl.innerHTML = '<div class="layer-count-title">No layers loaded</div>';
      return;
    }
    const count = this.zLayers.length;
    const zMin = this.zLayers[0].zHeight.toFixed(2);
    const zMax = this.zLayers[count - 1].zHeight.toFixed(2);
    const avgPieces = (this.zLayers.reduce((s, l) => s + l.pieceCount, 0) / count).toFixed(1);
    this.layerCountEl.innerHTML = `
      <div class="layer-count-title">Layer Info</div>
      <div>Layers: <span class="layer-count-val">${count}</span></div>
      <div>Z range: <span class="layer-count-val">${zMin} → ${zMax} mm</span></div>
      <div>Avg pieces/layer: <span class="layer-count-val">${avgPieces}</span></div>
    `;
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
   * BUG 1 FIX: Get full 3D bounds from NBP or TTHR data.
   * Used by resetView to fit the camera regardless of which data format is loaded.
   */
  private getCurrentFullBounds(): { min: number[]; max: number[] } | null {
    if (this.currentNBP) {
      const h = this.currentNBP.header;
      return { min: h.boundsMin, max: h.boundsMax };
    }
    if (this.fullData) {
      const h = this.fullData.header;
      return { min: h.boundsMin, max: h.boundsMax };
    }
    if (this.currentData) {
      const h = this.currentData.header;
      return { min: h.boundsMin, max: h.boundsMax };
    }
    return null;
  }

  /**
   * Fit the camera to the given bounds AND reposition the grid so its center
   * matches the bounds center. This ensures the camera's orbit target (which
   * fitToBounds sets to the bbox midpoint) is always at the center of the grid.
   */
  private fitCameraToBounds(min: { x: number; y: number; z: number }, max: { x: number; y: number; z: number }): void {
    this.camera.fitToBounds(min, max);
    // Reposition grid to be centered on the bbox midpoint
    const cx = (min.x + max.x) / 2;
    const cy = (min.y + max.y) / 2;
    if (this.gridRenderer) {
      const ticks = this.gridRenderer.setCenter(cx, cy);
      this.gridLabelRenderer?.updateLabels(ticks);
    }
  }

  /**
   * Feature #48: Update bounding box dimensions display.
   */
  private updateBBoxDisplay(): void {
    if (!this.bboxEl) return;
    let bounds: { min: number[]; max: number[] } | null = null;
    if (this.currentNBP) {
      const h = this.currentNBP.header;
      bounds = { min: h.boundsMin, max: h.boundsMax };
    } else if (this.fullData) {
      const h = this.fullData.header;
      bounds = { min: h.boundsMin, max: h.boundsMax };
    }
    if (!bounds) {
      this.bboxEl.innerHTML = '<div class="bbox-title">No data loaded</div>';
      return;
    }
    const dx = (bounds.max[0] - bounds.min[0]).toFixed(2);
    const dy = (bounds.max[1] - bounds.min[1]).toFixed(2);
    const dz = (bounds.max[2] - bounds.min[2]).toFixed(2);
    this.bboxEl.innerHTML = `
      <div class="bbox-title">Bounding Box (mm)</div>
      <div>X: <span class="bbox-val">${bounds.min[0].toFixed(1)} → ${bounds.max[0].toFixed(1)}</span> <span class="bbox-dim">(${dx})</span></div>
      <div>Y: <span class="bbox-val">${bounds.min[1].toFixed(1)} → ${bounds.max[1].toFixed(1)}</span> <span class="bbox-dim">(${dy})</span></div>
      <div>Z: <span class="bbox-val">${bounds.min[2].toFixed(1)} → ${bounds.max[2].toFixed(1)}</span> <span class="bbox-dim">(${dz})</span></div>
    `;
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
