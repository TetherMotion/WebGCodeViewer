/**
 * @file WebGPUApp.ts
 * @brief Main WebGPU application orchestrating renderers, camera, and UI.
 */

import { Camera } from './Camera';
import { RpcClient } from './RpcClient';
import { ColorMap } from './ColorMap';
import { parseTTHR, TTHRData, extractZLayer } from './TthrParser';
import { parseNBP, NBPData } from './NurbsParser';
import { parseTSSP, StateProfileData, stateProfileToTrnp } from './StateProfileParser';
import { parseTRNP, TRNPData, parseTRNPPa, TRNPPaData, PaAlgorithmEntry } from './ReNurbsParser';
import { ToolpathRenderer, ColorAttribute } from '../renderers/ToolpathRenderer';
import { GridRenderer } from '../renderers/GridRenderer';
import { CrossSectionRenderer } from '../renderers/CrossSectionRenderer';
import { PointCloudRenderer } from '../renderers/PointCloudRenderer';
import { OverlayRenderer } from '../renderers/OverlayRenderer';
import { NavigationGizmo } from '../renderers/NavigationGizmo';
import { PrintHeadMarker } from '../renderers/PrintHeadMarker';
import { PrinterFrameRenderer } from '../renderers/PrinterFrameRenderer';
import { DirectionCubeRenderer } from '../renderers/DirectionCubeRenderer';
import { NurbsRenderer, NurbsColorAttribute } from '../renderers/NurbsRenderer';
import { GpuPlot, PlotSeries } from '../ui/GpuPlot';
import { PaControls, PaAlgorithmId } from '../ui/PaControls';
import { MiniplotRenderer, MiniplotAxis, MiniplotData } from '../renderers/MiniplotRenderer';
import { GridLabels } from '../ui/GridLabels';
import { GridLabelRenderer } from '../renderers/GridLabelRenderer';
import { ToolChangeMarkerRenderer } from '../renderers/ToolChangeMarkerRenderer';
import { ControlPanel } from '../ui/ControlPanel';
import { GcodeViewer } from '../ui/GcodeViewer';
import { NavigationCube, ViewDirection } from '../ui/NavigationCube';
import { InfoPanel } from '../ui/InfoPanel';
import { PositionOverlay } from '../ui/PositionOverlay';
import { ComparisonPanel } from '../ui/ComparisonPanel';
import { DiffPanel } from '../ui/DiffPanel';
import { BookmarkManager } from '../ui/BookmarkManager';
import { parseGcodeMetadata, GcodeMetadata, computeMaterialUsage, computeSpeedStats, computeLayerTimes, formatTime, getMachineStateAtLine } from './GcodeMetadata';
import {
  detectStringingRisk, detectGcodeErrors, detectLayerTimeWarnings,
  computeVolumetricFlow, getFlowStats, parseFeatureTypes,
  parseWorkCoordinateSystems, parseStockDimensions, estimatePrintTime,
  getFeatureTypeAtLine, FeatureTypeSegment,
} from './GcodeAnalysis';
import {
  parseDrillingCycles, parseCutterCompensation, parseProbeEvents,
  parseSubprograms, analyzePathOptimization, computeFeatureTimeBreakdown,
  estimateJobCost,
} from './GcodeAdvanced';
import {
  parseColorChanges, analyzeSupportStructure, parseInfillDensity,
  parseMacros, trackMultiExtruder, parseBedLevelingMesh,
  detectRapidPlanes,
} from './GcodeAdvanced2';
import {
  parseRotaryAxes, simulateThermal, predictWarping, buildPrintTimeGraph,
  estimateSpindleLoad, estimateToolWear, checkCollisions, createStockModel,
  parseToolDefinitions, getDefaultToolLibrary,
} from './GcodeAdvanced3';
import {
  analyzeRetractions, checkLayerHeightConsistency, analyzeFlowRate,
  analyzeFirstLayer, predictStringing, analyzeCoolingFan, analyzePrintSpeeds,
} from './GcodeAdvanced4';
import {
  lintGcode, analyzeToolpathOptimization,
  analyzePressureAdvance,
  detectArcFittingCandidates, profileGcode, computeBeadGeometry,
} from './GcodeAdvanced5';
import {
  detectMillingDirection, estimateAccelerationLimitedTime,
  estimateEnergyConsumption, analyzeWorkOffsets, recognizePatterns,
  estimateToolDeflection,
  compensateThermalExpansion, expandSubprograms,
} from './GcodeAdvanced6';
import {
  predictChatter, trackMacroVariables,
  analyzeCoordinateRotation, estimateToolLife,
  verifyCutterCompensation,
  suggestTravelOptimization,
} from './GcodeAdvanced7';
import {
  trackModalStates, analyzeDwellTime, check3DPSafety,
  analyzeCurvature, recognizeFeatures, analyzeSpindlePower,
  analyzeMultiPart, analyzeBedAdhesion,
  checkGcodeCompatibility,
} from './GcodeAdvanced8';
import {
  detectSelfIntersections, analyzeCommandFrequency, optimizeToolChanges,
  analyzeLayerTimes, extractComments, analyzeToolpathLength,
  analyzeMCodes, analyzeSpindleWarmup, generateFeedRateHistogram,
  analyzeToolpathDirection, parseWithRecovery,
} from './GcodeAdvanced9';
import {
  analyzeZHops, analyzeExtrusionConsistency,
  analyzeToolpathSmoothing, predictPrintQuality, analyzeVolumetricFlowRate,
  generateStatisticsSummary, detectToolpathOverlaps,
  analyzePrintEfficiency, autoGenerateAnnotations,
} from './GcodeAdvanced10';
import {
  simulateGcode, trackToolWearProgression, generateOptimizationReport,
  analyzeBedThermalMap, buildSubprogramCallGraph,
  analyzeCoolingEffectiveness, analyzeDependencies, predictPrintFailure,
  generateDocumentation, benchmarkGcode, auditGcodeSecurity,
} from './GcodeAdvanced11';
import {
  reverseEngineerGcode, analyzeMachiningStrategy,
  analyzeBedLevelingQuality,
  optimizeToolpathForRendering, validateGcodeRules,
} from './GcodeAdvanced12';
import {
  generateExecutionTrace, analyzeChipThickness, generateQualityHeatmap,
  analyzeWorkholding, analyzeMaterialFlow, generateFlowVisualization,
  optimizeFixturePlacement, generateLayerVisualization,
  analyzeCompressionOpportunities, analyzeAerodynamics,
  analyzeAdaptiveSpeed, generateDependencyGraph,
} from './GcodeAdvanced13';
import {
  highlightGcodeSyntax, predictToolDeflectionAdvanced,
  generateStringingRiskMap, previewMacroExpansion,
  predictSurfaceRoughness, simulateWarping,
  detectCollisions3D, calculateToolLife, analyzeInfillPattern,
  computeBounds, simulateCuttingForces, optimizeRetractions,
} from './GcodeAdvanced14';
import {
  profileGcodeExecution, generateToolWearMap,
  analyzeLayerAdhesion,
  analyzeChatterFrequency, generateOverhangMap,
  generateOperationTimeline, checkToolpathContinuity,
  analyzeExtrusionWidthConsistency, optimizePostProcessorOutput,
  analyzeMachineVibration, trackThermalHistory,
} from './GcodeAdvanced15';
import {
  analyzeLineStatistics, generateEngagementMap,
  visualizeBedMesh, generateCommandFlow,
  calculateChipLoad, estimateSpoolUsage,
  suggestErrorRecovery, calculateMRR,
  analyzeCoasting, identifyBottlenecks,
  calculatePullOffDistance, analyzeFirstLayerSquish,
} from './GcodeAdvanced16';
import {
  analyzeIdleTime, quantifyToolpathOverlap,
  adviseFlowRateCalibration, estimateMemoryUsage,
  validateCuttingParameters, detectLayerShiftRisk,
  optimizeExecutionPath, calculateNoseRadiusCompensation,
  analyzeElephantFoot, analyzeCommentDensity,
  optimizeRapidTraverse, analyzeSkirtBrim,
} from './GcodeAdvanced17';
import {
  analyzePerToolPathLength, analyzeOozePrevention,
  analyzeCoordinateSystems, analyzeSpindleSpeedVariation,
  predictBridgeQuality, analyzeModalGroups,
  simulateFeedRateOverride, analyzeFanCurve,
  analyzeSubprogramComplexity, countDirectionReversals,
  optimizeZSeamAlignment, assessExecutionRisk,
} from './GcodeAdvanced18';
import {
  calculateArcLength, analyzeEntryExitAngles,
  optimizeRetractionDistance, analyzeBlockStructure,
  calculateFeedPerRevolution, analyzeThinWalls,
  trackVariableUsage, classifyToolpathSegments,
  analyzeInfillDensityVariance, detectErrorPatterns,
  calculateSurfaceSpeed, analyzeLayerTimeVariance,
} from './GcodeAdvanced19';
import {
  generateSpeedHeatmap, predictToolWearProgression,
  optimizeRetractionSpeed, scoreLineComplexity,
  optimizeDepthOfCut, optimizeLayerFanSpeed,
  detectCircularInterpolation, calculateToolpathEfficiency,
  trackMaterialPerLayer, removeCommandRedundancy,
  adviseCuttingStrategy, analyzeIroningPattern,
} from './GcodeAdvanced20';
import {
  calculatePerLayerBounds, calculateEngagementTime,
  analyzeRetractionFrequency, estimateSpindleLoadProfile,
  countDirectionChanges, calculateBedAdhesionArea,
  detectCoordinateRotations, calculateWearRate,
  analyzeFlowRateConsistency, validateCommandSequence,
  analyzeFeedRateHarmonics, analyzeLayerHeightVariance,
} from './GcodeAdvanced21';
import {
  analyzeAccelerationProfile, analyzeCuttingForceSpectrum,
  optimizePressureAdvance, mapCoordinateOrigins,
  detectToolpathLoops, analyzeExtrusionWidthPerLayer,
  optimizeSpindleWarmup, optimizeSupportStructure,
  optimizeFileSize, generateCurvatureHeatmap,
  predictLayerAdhesionStrength, calculateCorneringSpeed,
} from './GcodeAdvanced22';
import {
  calculateScallopHeight, detectFilamentDiameterVariance,
  detectCoordinateScaling, calculateChipThinning,
  analyzeInfillAngles, analyzeSegmentLengthDistribution,
  calculateStepover, calibrateExtrusionMultiplier,
  detectToolpathSymmetry, optimizeRetractPlane,
  analyzeSkirtBrimGap, estimateExecutionTime,
} from './GcodeAdvanced23';
import {
  calculateEngagementAnglePerSegment, optimizeFirstLayerSpeed,
  analyzeRapidTravelEfficiency, analyzePlungeRate,
  calculateMaterialPerExtruder, classifyClimbConventionalPerPass,
  analyzeLayerCoolingTime, analyzeReversalPoints,
  analyzeCuttingModeConsistency, analyzeExtrusionStartStopQuality,
  analyzeProgramFlowStructure, calculateMRRPerLayer,
} from './GcodeAdvanced24';
import {
  calculateAirCuttingTime, analyzeBeadWidthVariance,
  validateParameterRanges, generateEngagementHeatmapPerLayer,
  analyzeFanDutyCycle, optimizeToolChangePositions,
  adviseSpindleSpeed, optimizeFirstLayerHeight,
  checkContinuityPerLayer, calculateMinimumClearance,
  analyzeWallThicknessConsistency, optimizeExecutionOrder,
} from './GcodeAdvanced25';
import {
  calculateEngagementTimePerLayer, analyzeExtrusionRatePerLayer,
  analyzeWorkOffsetUsage, calculateDeflectionCompensation,
  optimizeBridgingSpeed, detectOverlapsPerLayer,
  analyzeSpindleLoadPerLayer, analyzeRetractionHopHeight,
  calculateProgramComplexity, analyzeArcInterpolationQuality,
  analyzeLayerHeightConsistencyPerLayer, analyzeModalStateTransitions,
} from './GcodeAdvanced26';
import {
  analyzeEntryStrategy, analyzeRetractionAcceleration,
  checkCoordinateSystemAlignment, validateNoseRadiusCompensation,
  analyzeInfillDensityPerLayer, classifySegmentsPerLayer,
  validateSpindleWarmupCycle, analyzeFanSpeedPerLayer,
  analyzeStructureComplexityPerSection, analyzeLeadInOut,
  analyzeExtrusionConsistencyPerLayer, checkMachineCoordinateBoundary,
} from './GcodeAdvanced27';
import { degToRad } from './MathUtils';

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
  private currentTRNP: TRNPData | null = null;
  private currentStateProfile: StateProfileData | null = null;
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
  private autoLayerTracking: boolean = true;  // auto-shift Z layer in realtime mode
  private lastAutoLayerIdx: number = -1;     // last auto-selected layer (to avoid redundant updates)

  // Analysis features
  private infoPanel: InfoPanel | null = null;
  private positionOverlay: PositionOverlay | null = null;
  private comparisonPanel: ComparisonPanel | null = null;
  private diffPanel: DiffPanel | null = null;
  // Advanced visualization state
  private overhangHighlight = false;
  private zSeamVisible = false;
  private probeMarkersVisible = false;
  private drillMarkersVisible = false;
  private hackPanelVisible = false;
  private bridgesVisible = false;
  private supportVisible = false;
  private bookmarkManager: BookmarkManager | null = null;
  private gcodeMetadata: GcodeMetadata | null = null;
  private totalDuration: number = 0;

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
  // (because loadJobData calls camera.fitToBounds which would override them)
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
        this.camera.fitToBounds(
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

    // Miniplot renderer (ChartGPU-backed speed plot)
    if (this.miniplotContainer && this.device && this.adapter) {
      this.miniplotRenderer = new MiniplotRenderer(this.miniplotContainer, this.device, this.adapter);
      await this.miniplotRenderer.init();
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
          const text = await file.text();
          const newLines = text.split('\n');
          const oldLines = this.gcodeViewer?.allLines ?? [];
          const oldName = this.gcodeViewer?.filename ?? 'current';
          this.diffPanel?.displayDiff(oldLines, newLines, oldName, file.name);
        } catch (e) {
          console.error('Failed to process diff file:', e);
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
        let machineState: ReturnType<typeof getMachineStateAtLine> | undefined;
        if (this.gcodeMetadata) {
          feedRate = this.gcodeMetadata.blockFeedRates.get(blockIdx);
          toolNumber = this.gcodeMetadata.blockTools.get(blockIdx);
          // Find the line number for this block
          const block = this.currentNBP?.blocks.find(b => b.blockIndex === blockIdx);
          if (block) {
            machineState = getMachineStateAtLine(this.gcodeMetadata, block.lineNumber);
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
      let machineState: ReturnType<typeof getMachineStateAtLine> | undefined;
      if (this.gcodeMetadata && this.gcodeViewer) {
        const blockCount = this.currentNBP?.pieces.length ?? 0;
        if (blockCount > 0) {
          const estBlock = Math.floor(this.playProgress * blockCount);
          feedRate = this.gcodeMetadata.blockFeedRates.get(estBlock);
          toolNumber = this.gcodeMetadata.blockTools.get(estBlock);
        }
        const lineCount = this.gcodeViewer.allLines.length;
        if (lineCount > 0) {
          const estLine = Math.floor(this.playProgress * lineCount);
          machineState = getMachineStateAtLine(this.gcodeMetadata, estLine);
          // Update current feature type from parsed segments
          if (this.featureTypeSegments.length > 0) {
            this.currentFeatureType = getFeatureTypeAtLine(this.featureTypeSegments, estLine) ?? undefined;
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
      // Auto Z-layer tracking in realtime mode
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
      // Enrich miniplot data with event line numbers from metadata
      if (this.gcodeMetadata) {
        this.miniplotData.toolChangeLines = this.gcodeMetadata.toolChanges.map(tc => tc.lineNumber);
        this.miniplotData.tempChangeLines = this.gcodeMetadata.temperatureEvents.map(te => te.lineNumber);
        this.miniplotData.fanChangeLines = this.gcodeMetadata.fanEvents.map(fe => fe.lineNumber);
        this.miniplotData.coolantChangeLines = this.gcodeMetadata.coolantEvents.map(ce => ce.lineNumber);
      }
      if (this.miniplotRenderer) {
        this.miniplotRenderer.setData(this.miniplotData);
        this.updateMiniplotLabel();
      }
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

    // Motion profile series from the sampled WSS state profile.
    const motionTrnp = this.currentStateProfile
      ? stateProfileToTrnp(this.currentStateProfile)
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
    // regardless of any prior zoom/pan. fitToBounds centers the orbit target
    // on the bbox midpoint and sets the orbit distance to fit the object.
    const bounds = this.getCurrentFullBounds();
    if (bounds) {
      this.camera.fitToBounds(
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
    this.currentStateProfile = null;
    this.currentPaData = null;
    this.currentData = null;
    this.fullData = null;
    this.zLayers = [];
    this.miniplotData = null;

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

      // Fetch sampled 1D state profile (TSSP format) — (t, v, a, j) sampled
      // directly from the WSS and resampled to a uniform arc-length grid.
      // This is the preferred data source for kinematic coloring.
      try {
        const stateBinary = await this.rpcClient.getStateProfileHttp(jobId);
        this.currentStateProfile = parseTSSP(stateBinary);
        this.nurbsRenderer?.updateStateProfile(this.currentStateProfile);
        console.info(`State profile loaded: ${this.currentStateProfile.sampleCount} samples, ` +
                     `${stateBinary.byteLength} bytes`);
      } catch (e) {
        // State profile is optional — if it fails, the renderer falls back to
        // ReNURBS or piece-level coloring.
        console.info('State profile not available');
        this.currentStateProfile = null;
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
    this.parseMetadataAndUpdate();

    // Update info panel if visible
    this.updateInfoPanel();

    // BUG 3 FIX: Apply deferred camera params from URL after data has loaded
    // and fitToBounds has been called. This ensures ?cam= is not overridden.
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
   * Uses gcodeMetadata.blockTools to map block indices to tool numbers.
   */
  /** Show probe point markers on the 3D view */
  private showProbeMarkers(): void {
    if (!this.gcodeViewer || !this.currentNBP) return;
    const lines = this.gcodeViewer.allLines;
    const probes = parseProbeEvents(lines);
    if (probes.length === 0) return;
    // Highlight the first probe position in the G-code viewer
    if (probes.length > 0) {
      this.gcodeViewer?.highlightLine(probes[0].lineNumber);
    }
  }

  /** Hide probe point markers */
  private hideProbeMarkers(): void {
    if (!this.gcodeViewer) return;
    this.gcodeViewer.clearHighlight();
  }

  /** Show drilling cycle markers on the 3D view */
  private showDrillMarkers(): void {
    if (!this.gcodeViewer || !this.currentNBP) return;
    const lines = this.gcodeViewer.allLines;
    const cycles = parseDrillingCycles(lines);
    if (cycles.length === 0) return;
    // Highlight the first drilling position in the G-code viewer
    if (cycles.length > 0) {
      this.gcodeViewer?.highlightLine(cycles[0].lineNumber);
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
      return this.gcodeMetadata!.blockTools.get(i) === toolNumber;
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
   * Parse G-code metadata from the loaded G-code text and update
   * tool change markers, feed rates, and other analysis features.
   */
  private parseMetadataAndUpdate(): void {
    if (!this.gcodeViewer || !this.gcodeViewer.allLines) return;

    // Initialize bookmark manager for this file
    this.bookmarkManager = new BookmarkManager(this.gcodeViewer.filename || 'default');

    // Get block line map from GcodeViewer (uses {start, end} format)
    const blockLineRanges = this.gcodeViewer.blockLineRanges;
    // Convert to the format expected by parseGcodeMetadata
    const blockLineMap = new Map<number, [number, number]>();
    for (const [idx, range] of blockLineRanges) {
      blockLineMap.set(idx, [range.start, range.end]);
    }
    this.gcodeMetadata = parseGcodeMetadata(this.gcodeViewer.allLines, blockLineMap);

    // Parse slicer feature types for display during playback
    this.featureTypeSegments = parseFeatureTypes(this.gcodeViewer.allLines);

    // Update tool change markers with 3D positions
    if (this.toolChangeMarkerRenderer && this.nurbsRenderer && this.currentNBP) {
      const markers: { position: [number, number, number]; toolNumber: number }[] = [];
      // Map tool change line numbers to piece positions
      for (const tc of this.gcodeMetadata.toolChanges) {
        // Find the block index for this line
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
    if (this.nurbsRenderer && this.currentNBP && this.gcodeMetadata) {
      const feedRates: number[] = [];
      const spindleRpms: number[] = [];
      const toolNumbers: number[] = [];
      for (let i = 0; i < this.currentNBP.pieces.length; i++) {
        feedRates.push(this.gcodeMetadata.blockFeedRates.get(i) || 0);
        spindleRpms.push(this.gcodeMetadata.blockSpindleRpm.get(i) || 0);
        toolNumbers.push(this.gcodeMetadata.blockTools.get(i) || 0);
      }
      this.nurbsRenderer.setFeedRates(feedRates);
      this.nurbsRenderer.setSpindleRpms(spindleRpms);
      this.nurbsRenderer.setToolNumbers(toolNumbers);
    }

    // Update tool filter dropdown
    if (this.gcodeMetadata.tools.length > 0) {
      this.controlPanel.updateTools(this.gcodeMetadata.tools);
    }

    // Get total duration from miniplot data or job status
    if (this.miniplotData) {
      this.totalDuration = this.miniplotData.totalTime;
    }
  }

  /**
   * Update the info panel with all available analysis data.
   */
  private updateInfoPanel(): void {
    if (!this.infoPanel || !this.infoPanel.visible) return;
    if (!this.gcodeMetadata) return;

    const bounds = this.getCurrentFullBounds();
    if (!bounds) return;

    // Get G-code lines for advanced analysis
    const gcodeLines = this.gcodeViewer?.allLines ?? [];

    // Compute material usage if we have NBP data
    let materialUsage: { extrusionLength: number; volume: number; weight: number } | undefined;
    if (this.currentNBP && this.miniplotData) {
      const segmentTimes = this.miniplotData.segments.map(s => s.duration);
      materialUsage = computeMaterialUsage(this.currentNBP.pieces, segmentTimes);
    }

    this.infoPanel.update({
      metadata: this.gcodeMetadata,
      miniplotData: this.miniplotData,
      zLayers: this.zLayers,
      totalDuration: this.totalDuration,
      pathLength: this.currentNBP?.header.totalLength ?? 0,
      bounds: { min: bounds.min as [number, number, number], max: bounds.max as [number, number, number] },
      sampleCount: this.currentData?.header.sampleCount ?? 0,
      pieceCount: this.currentNBP?.pieces.length ?? 0,
      gcodeLines: gcodeLines.length > 0 ? gcodeLines : undefined,
      materialUsage,
    });
  }

  /**
   * Export a comprehensive analysis report as a JSON file download.
   */
  private exportReport(): void {
    if (!this.gcodeMetadata) {
      this.controlPanel.setStatus('No data loaded');
      return;
    }

    const bounds = this.getCurrentFullBounds();
    const speedStats = this.miniplotData
      ? computeSpeedStats(this.miniplotData.segments)
      : { minSpeed: 0, maxSpeed: 0, meanSpeed: 0, medianSpeed: 0 };

    const layerTimes = this.miniplotData
      ? computeLayerTimes(this.zLayers, this.miniplotData.segments)
      : [];

    const gcodeLines = this.gcodeViewer?.allLines ?? [];
    let materialUsage: { extrusionLength: number; volume: number; weight: number } | undefined;
    if (this.currentNBP && this.miniplotData) {
      const segmentTimes = this.miniplotData.segments.map(s => s.duration);
      materialUsage = computeMaterialUsage(this.currentNBP.pieces, segmentTimes);
    }

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
        minX: bounds.min[0], maxX: bounds.max[0], sizeX: bounds.max[0] - bounds.min[0],
        minY: bounds.min[1], maxY: bounds.max[1], sizeY: bounds.max[1] - bounds.min[1],
        minZ: bounds.min[2], maxZ: bounds.max[2], sizeZ: bounds.max[2] - bounds.min[2],
      } : null,
      speedStats,
      layerCount: this.zLayers.length,
      layerTimes: layerTimes.map(l => ({
        layer: l.layerIndex,
        zHeight: l.zHeight,
        timeSeconds: l.timeSeconds,
        timeFormatted: formatTime(l.timeSeconds),
      })),
      tools: this.gcodeMetadata.tools,
      toolChanges: this.gcodeMetadata.toolChanges,
      spindleEvents: this.gcodeMetadata.spindleEvents,
      temperatureEvents: this.gcodeMetadata.temperatureEvents,
      fanEvents: this.gcodeMetadata.fanEvents,
      coolantEvents: this.gcodeMetadata.coolantEvents,
      feedRateRange: this.gcodeMetadata.feedRateRange,
      // Advanced analysis
      materialUsage: materialUsage ?? null,
      gcodeIssues: gcodeLines.length > 0 ? detectGcodeErrors(gcodeLines) : [],
      stringingRisks: gcodeLines.length > 0 ? detectStringingRisk(gcodeLines) : [],
      layerTimeWarnings: detectLayerTimeWarnings(layerTimes),
      featureTypes: gcodeLines.length > 0 ? parseFeatureTypes(gcodeLines) : [],
      workCoordinateSystems: gcodeLines.length > 0 ? parseWorkCoordinateSystems(gcodeLines) : [],
      stockDimensions: gcodeLines.length > 0 ? parseStockDimensions(gcodeLines) : null,
      printTimeEstimate: gcodeLines.length > 0 ? estimatePrintTime(gcodeLines) : null,
      volumetricFlowStats: gcodeLines.length > 0
        ? getFlowStats(computeVolumetricFlow(gcodeLines))
        : null,
      // Advanced CNC/3DP analysis
      drillingCycles: gcodeLines.length > 0 ? parseDrillingCycles(gcodeLines) : [],
      cutterCompensation: gcodeLines.length > 0 ? parseCutterCompensation(gcodeLines) : [],
      probeEvents: gcodeLines.length > 0 ? parseProbeEvents(gcodeLines) : [],
      subprograms: gcodeLines.length > 0 ? parseSubprograms(gcodeLines) : { calls: [], definitions: [] },
      pathOptimization: gcodeLines.length > 0 ? analyzePathOptimization(gcodeLines) : [],
      featureTimeBreakdown: gcodeLines.length > 0 ? computeFeatureTimeBreakdown(gcodeLines) : [],
      costEstimate: (materialUsage && gcodeLines.length > 0)
        ? estimateJobCost(
            estimatePrintTime(gcodeLines).estimatedTime,
            materialUsage.weight,
          )
        : null,
      // Batch 2 advanced analysis
      colorChanges: gcodeLines.length > 0 ? parseColorChanges(gcodeLines) : [],
      supportStructure: gcodeLines.length > 0
        ? analyzeSupportStructure(gcodeLines, materialUsage?.extrusionLength ?? 0)
        : null,
      infillDensity: gcodeLines.length > 0 ? parseInfillDensity(gcodeLines) : [],
      multiExtruder: gcodeLines.length > 0 ? trackMultiExtruder(gcodeLines) : [],
      bedLevelingMesh: gcodeLines.length > 0 ? parseBedLevelingMesh(gcodeLines) : null,
      macros: gcodeLines.length > 0 ? parseMacros(gcodeLines) : { variables: [], calls: [] },
      rapidPlanes: gcodeLines.length > 0 ? detectRapidPlanes(gcodeLines) : [],
      // Batch 3 advanced analysis
      rotaryAxes: gcodeLines.length > 0 ? parseRotaryAxes(gcodeLines) : { moves: [], finalState: { a: 0, b: 0, c: 0, x: 0, y: 0, z: 0 } },
      thermalSimulation: gcodeLines.length > 0 ? simulateThermal(gcodeLines) : null,
      warpPrediction: gcodeLines.length > 0 && bounds
        ? predictWarping(simulateThermal(gcodeLines), {
            minX: bounds.min[0], maxX: bounds.max[0],
            minY: bounds.min[1], maxY: bounds.max[1],
            minZ: bounds.min[2], maxZ: bounds.max[2],
          }, 0.2)
        : null,
      printTimeGraph: gcodeLines.length > 0 ? buildPrintTimeGraph(gcodeLines, []) : null,
      spindleLoad: gcodeLines.length > 0 ? estimateSpindleLoad(gcodeLines) : [],
      toolWear: gcodeLines.length > 0 ? estimateToolWear(gcodeLines) : [],
      toolDefinitions: gcodeLines.length > 0 ? parseToolDefinitions(gcodeLines) : getDefaultToolLibrary(),
      collisions: gcodeLines.length > 0 && bounds
        ? checkCollisions(gcodeLines, createStockModel('block',
            bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2],
            bounds.min[0], bounds.min[1], bounds.min[2], true))
        : [],
      // Batch 4 advanced analysis
      retractionAnalysis: gcodeLines.length > 0 ? analyzeRetractions(gcodeLines) : null,
      layerHeightConsistency: gcodeLines.length > 0 ? checkLayerHeightConsistency([]) : null,
      flowRateAnalysis: gcodeLines.length > 0 ? analyzeFlowRate(gcodeLines) : null,
      firstLayerAnalysis: gcodeLines.length > 0 ? analyzeFirstLayer(gcodeLines) : null,
      stringingPrediction: gcodeLines.length > 0 ? predictStringing(gcodeLines) : null,
      coolingFanAnalysis: gcodeLines.length > 0 ? analyzeCoolingFan(gcodeLines) : null,
      printSpeedAnalysis: gcodeLines.length > 0 ? analyzePrintSpeeds(gcodeLines) : null,
      // Batch 5 advanced analysis
      lintResult: gcodeLines.length > 0 ? lintGcode(gcodeLines) : null,
      toolpathOptimization: gcodeLines.length > 0 ? analyzeToolpathOptimization(gcodeLines) : null,
      pressureAdvance: gcodeLines.length > 0 ? analyzePressureAdvance(gcodeLines) : null,
      arcFittingCandidates: gcodeLines.length > 0 ? detectArcFittingCandidates(gcodeLines) : null,
      performanceProfile: gcodeLines.length > 0 ? profileGcode(gcodeLines) : null,
      beadGeometry: computeBeadGeometry(0.2, 0.4, 1.75),
      // Batch 6 advanced analysis
      millingDirection: gcodeLines.length > 0 ? detectMillingDirection(gcodeLines) : null,
      accelerationLimitedTime: gcodeLines.length > 0 ? estimateAccelerationLimitedTime(gcodeLines) : null,
      energyConsumption: gcodeLines.length > 0 ? estimateEnergyConsumption(gcodeLines) : null,
      workOffsets: gcodeLines.length > 0 ? analyzeWorkOffsets(gcodeLines) : null,
      patternRecognition: gcodeLines.length > 0 ? recognizePatterns(gcodeLines) : null,
      toolDeflection: gcodeLines.length > 0 ? estimateToolDeflection(gcodeLines) : null,
      subprogramExpansion: gcodeLines.length > 0 ? expandSubprograms(gcodeLines) : null,
      // Batch 7 advanced analysis
      chatterPrediction: gcodeLines.length > 0 ? predictChatter(gcodeLines) : null,
      macroVariables: gcodeLines.length > 0 ? trackMacroVariables(gcodeLines) : null,
      coordinateRotation: gcodeLines.length > 0 ? analyzeCoordinateRotation(gcodeLines) : null,
      toolLifeEstimation: gcodeLines.length > 0 ? estimateToolLife(gcodeLines) : null,
      cutterCompensationVerification: gcodeLines.length > 0 ? verifyCutterCompensation(gcodeLines) : null,
      travelOptimization: gcodeLines.length > 0 ? suggestTravelOptimization(gcodeLines) : null,
      // Batch 8 advanced analysis
      modalStates: gcodeLines.length > 0 ? trackModalStates(gcodeLines) : null,
      dwellAnalysis: gcodeLines.length > 0 ? analyzeDwellTime(gcodeLines) : null,
      safetyCheck: gcodeLines.length > 0 ? check3DPSafety(gcodeLines) : null,
      curvatureAnalysis: gcodeLines.length > 0 ? analyzeCurvature(gcodeLines) : null,
      recognizedFeatures: gcodeLines.length > 0 ? recognizeFeatures(gcodeLines) : null,
      spindlePowerAnalysis: gcodeLines.length > 0 ? analyzeSpindlePower(gcodeLines) : null,
      multiPartAnalysis: gcodeLines.length > 0 ? analyzeMultiPart(gcodeLines) : null,
      bedAdhesionAnalysis: gcodeLines.length > 0 ? analyzeBedAdhesion(gcodeLines) : null,
      compatibilityCheck: gcodeLines.length > 0 ? checkGcodeCompatibility(gcodeLines, 'fanuc') : null,

      // Batch 9
      selfIntersections: gcodeLines.length > 0 ? detectSelfIntersections(gcodeLines) : null,
      commandFrequency: gcodeLines.length > 0 ? analyzeCommandFrequency(gcodeLines) : null,
      toolChangeOptimization: gcodeLines.length > 0 ? optimizeToolChanges(gcodeLines) : null,
      layerTimeAnalysis: gcodeLines.length > 0 ? analyzeLayerTimes(gcodeLines) : null,
      commentExtraction: gcodeLines.length > 0 ? extractComments(gcodeLines) : null,
      toolpathLengthAnalysis: gcodeLines.length > 0 ? analyzeToolpathLength(gcodeLines) : null,
      mCodeAnalysis: gcodeLines.length > 0 ? analyzeMCodes(gcodeLines) : null,
      spindleWarmup: gcodeLines.length > 0 ? analyzeSpindleWarmup(gcodeLines) : null,
      feedRateHistogram: gcodeLines.length > 0 ? generateFeedRateHistogram(gcodeLines) : null,
      toolpathDirection: gcodeLines.length > 0 ? analyzeToolpathDirection(gcodeLines) : null,
      parseErrors: gcodeLines.length > 0 ? parseWithRecovery(gcodeLines) : null,

      // Batch 10
      zHopAnalysis: gcodeLines.length > 0 ? analyzeZHops(gcodeLines) : null,
      extrusionConsistency: gcodeLines.length > 0 ? analyzeExtrusionConsistency(gcodeLines) : null,
      toolpathSmoothing: gcodeLines.length > 0 ? analyzeToolpathSmoothing(gcodeLines) : null,
      qualityPrediction: gcodeLines.length > 0 ? predictPrintQuality(gcodeLines) : null,
      volumetricFlowRate: gcodeLines.length > 0 ? analyzeVolumetricFlowRate(gcodeLines) : null,
      statisticsSummary: gcodeLines.length > 0 ? generateStatisticsSummary(gcodeLines) : null,
      toolpathOverlaps: gcodeLines.length > 0 ? detectToolpathOverlaps(gcodeLines) : null,
      printEfficiency: gcodeLines.length > 0 ? analyzePrintEfficiency(gcodeLines) : null,
      autoAnnotations: gcodeLines.length > 0 ? autoGenerateAnnotations(gcodeLines) : null,

      // Batch 11
      simulation: gcodeLines.length > 0 ? simulateGcode(gcodeLines) : null,
      toolWearProgression: gcodeLines.length > 0 ? trackToolWearProgression(gcodeLines) : null,
      optimizationReport: gcodeLines.length > 0 ? generateOptimizationReport(gcodeLines) : null,
      bedThermalMap: gcodeLines.length > 0 ? analyzeBedThermalMap(gcodeLines) : null,
      subprogramCallGraph: gcodeLines.length > 0 ? buildSubprogramCallGraph(gcodeLines) : null,
      coolingEffectiveness: gcodeLines.length > 0 ? analyzeCoolingEffectiveness(gcodeLines) : null,
      dependencyAnalysis: gcodeLines.length > 0 ? analyzeDependencies(gcodeLines) : null,
      failurePrediction: gcodeLines.length > 0 ? predictPrintFailure(gcodeLines) : null,
      documentation: gcodeLines.length > 0 ? generateDocumentation(gcodeLines) : null,
      benchmark: gcodeLines.length > 0 ? benchmarkGcode(gcodeLines) : null,
      securityAudit: gcodeLines.length > 0 ? auditGcodeSecurity(gcodeLines) : null,

      // Batch 12
      reverseEngineering: gcodeLines.length > 0 ? reverseEngineerGcode(gcodeLines) : null,
      machiningStrategy: gcodeLines.length > 0 ? analyzeMachiningStrategy(gcodeLines) : null,
      bedLevelingQuality: gcodeLines.length > 0 ? analyzeBedLevelingQuality(gcodeLines) : null,
      renderingOptimization: gcodeLines.length > 0 ? optimizeToolpathForRendering(gcodeLines) : null,
      validationRules: gcodeLines.length > 0 ? validateGcodeRules(gcodeLines) : null,

      // Batch 13
      executionTrace: gcodeLines.length > 0 ? generateExecutionTrace(gcodeLines) : null,
      chipThickness: gcodeLines.length > 0 ? analyzeChipThickness(gcodeLines) : null,
      qualityHeatmap: gcodeLines.length > 0 ? generateQualityHeatmap(gcodeLines) : null,
      workholding: gcodeLines.length > 0 ? analyzeWorkholding(gcodeLines) : null,
      materialFlow: gcodeLines.length > 0 ? analyzeMaterialFlow(gcodeLines) : null,
      flowVisualization: gcodeLines.length > 0 ? generateFlowVisualization(gcodeLines) : null,
      fixtureOptimization: gcodeLines.length > 0 ? optimizeFixturePlacement(gcodeLines) : null,
      layerVisualization: gcodeLines.length > 0 ? generateLayerVisualization(gcodeLines) : null,
      compressionAnalysis: gcodeLines.length > 0 ? analyzeCompressionOpportunities(gcodeLines) : null,
      aerodynamics: gcodeLines.length > 0 ? analyzeAerodynamics(gcodeLines) : null,
      adaptiveSpeed: gcodeLines.length > 0 ? analyzeAdaptiveSpeed(gcodeLines) : null,
      dependencyGraph: gcodeLines.length > 0 ? generateDependencyGraph(gcodeLines) : null,

      // Batch 14
      syntaxHighlight: gcodeLines.length > 0 ? highlightGcodeSyntax(gcodeLines) : null,
      toolDeflectionAdv: gcodeLines.length > 0 ? predictToolDeflectionAdvanced(gcodeLines) : null,
      stringingRiskMap: gcodeLines.length > 0 ? generateStringingRiskMap(gcodeLines) : null,
      macroExpansion: gcodeLines.length > 0 ? previewMacroExpansion(gcodeLines) : null,
      surfaceRoughness: gcodeLines.length > 0 ? predictSurfaceRoughness(gcodeLines) : null,
      warpingSimulation: gcodeLines.length > 0 ? simulateWarping(gcodeLines) : null,
      collisionDetection: gcodeLines.length > 0 ? detectCollisions3D(gcodeLines) : null,
      toolLife: gcodeLines.length > 0 ? calculateToolLife(gcodeLines) : null,
      infillPattern: gcodeLines.length > 0 ? analyzeInfillPattern(gcodeLines) : null,
      partBounds: gcodeLines.length > 0 ? computeBounds(gcodeLines) : null,
      cuttingForces: gcodeLines.length > 0 ? simulateCuttingForces(gcodeLines) : null,
      retractionOptimization: gcodeLines.length > 0 ? optimizeRetractions(gcodeLines) : null,

      // Batch 15
      executionProfile: gcodeLines.length > 0 ? profileGcodeExecution(gcodeLines) : null,
      toolWearMap: gcodeLines.length > 0 ? generateToolWearMap(gcodeLines) : null,
      layerAdhesion: gcodeLines.length > 0 ? analyzeLayerAdhesion(gcodeLines) : null,
      overhangMap: gcodeLines.length > 0 ? generateOverhangMap(gcodeLines) : null,
      operationTimeline: gcodeLines.length > 0 ? generateOperationTimeline(gcodeLines) : null,
      toolpathContinuity: gcodeLines.length > 0 ? checkToolpathContinuity(gcodeLines) : null,
      extrusionWidthConsistency: gcodeLines.length > 0 ? analyzeExtrusionWidthConsistency(gcodeLines) : null,
      postProcessorOptimization: gcodeLines.length > 0 ? optimizePostProcessorOutput(gcodeLines) : null,
      machineVibration: gcodeLines.length > 0 ? analyzeMachineVibration(gcodeLines) : null,
      thermalHistory: gcodeLines.length > 0 ? trackThermalHistory(gcodeLines) : null,

      // Batch 16
      lineStatistics: gcodeLines.length > 0 ? analyzeLineStatistics(gcodeLines) : null,
      engagementMap: gcodeLines.length > 0 ? generateEngagementMap(gcodeLines) : null,
      bedMesh: gcodeLines.length > 0 ? visualizeBedMesh(gcodeLines) : null,
      commandFlow: gcodeLines.length > 0 ? generateCommandFlow(gcodeLines) : null,
      chipLoad: gcodeLines.length > 0 ? calculateChipLoad(gcodeLines) : null,
      spoolEstimate: gcodeLines.length > 0 ? estimateSpoolUsage(gcodeLines) : null,
      errorRecovery: gcodeLines.length > 0 ? suggestErrorRecovery(gcodeLines) : null,
      mrr: gcodeLines.length > 0 ? calculateMRR(gcodeLines) : null,
      coasting: gcodeLines.length > 0 ? analyzeCoasting(gcodeLines) : null,
      bottlenecks: gcodeLines.length > 0 ? identifyBottlenecks(gcodeLines) : null,
      pullOff: gcodeLines.length > 0 ? calculatePullOffDistance(gcodeLines) : null,
      firstLayerSquish: gcodeLines.length > 0 ? analyzeFirstLayerSquish(gcodeLines) : null,

      // Batch 17
      idleTime: gcodeLines.length > 0 ? analyzeIdleTime(gcodeLines) : null,
      toolpathOverlap: gcodeLines.length > 0 ? quantifyToolpathOverlap(gcodeLines) : null,
      flowRateCalibration: gcodeLines.length > 0 ? adviseFlowRateCalibration(gcodeLines) : null,
      memoryEstimate: gcodeLines.length > 0 ? estimateMemoryUsage(gcodeLines) : null,
      parameterValidation: gcodeLines.length > 0 ? validateCuttingParameters(gcodeLines) : null,
      layerShiftRisk: gcodeLines.length > 0 ? detectLayerShiftRisk(gcodeLines) : null,
      executionPathOpt: gcodeLines.length > 0 ? optimizeExecutionPath(gcodeLines) : null,
      noseRadiusComp: gcodeLines.length > 0 ? calculateNoseRadiusCompensation(gcodeLines) : null,
      elephantFoot: gcodeLines.length > 0 ? analyzeElephantFoot(gcodeLines) : null,
      commentDensity: gcodeLines.length > 0 ? analyzeCommentDensity(gcodeLines) : null,
      rapidTraverseOpt: gcodeLines.length > 0 ? optimizeRapidTraverse(gcodeLines) : null,
      skirtBrim: gcodeLines.length > 0 ? analyzeSkirtBrim(gcodeLines) : null,

      // Batch 18
      perToolPathLength: gcodeLines.length > 0 ? analyzePerToolPathLength(gcodeLines) : null,
      oozePrevention: gcodeLines.length > 0 ? analyzeOozePrevention(gcodeLines) : null,
      coordinateSystems: gcodeLines.length > 0 ? analyzeCoordinateSystems(gcodeLines) : null,
      spindleSpeedVariation: gcodeLines.length > 0 ? analyzeSpindleSpeedVariation(gcodeLines) : null,
      bridgeQuality: gcodeLines.length > 0 ? predictBridgeQuality(gcodeLines) : null,
      modalGroups: gcodeLines.length > 0 ? analyzeModalGroups(gcodeLines) : null,
      feedRateOverride: gcodeLines.length > 0 ? simulateFeedRateOverride(gcodeLines) : null,
      fanCurve: gcodeLines.length > 0 ? analyzeFanCurve(gcodeLines) : null,
      subprogramComplexity: gcodeLines.length > 0 ? analyzeSubprogramComplexity(gcodeLines) : null,
      directionReversals: gcodeLines.length > 0 ? countDirectionReversals(gcodeLines) : null,
      zSeamAlignment: gcodeLines.length > 0 ? optimizeZSeamAlignment(gcodeLines) : null,
      executionRisk: gcodeLines.length > 0 ? assessExecutionRisk(gcodeLines) : null,

      // Batch 19
      arcLength: gcodeLines.length > 0 ? calculateArcLength(gcodeLines) : null,
      entryExitAngles: gcodeLines.length > 0 ? analyzeEntryExitAngles(gcodeLines) : null,
      retractionOptimizer: gcodeLines.length > 0 ? optimizeRetractionDistance(gcodeLines) : null,
      blockStructure: gcodeLines.length > 0 ? analyzeBlockStructure(gcodeLines) : null,
      feedPerRevolution: gcodeLines.length > 0 ? calculateFeedPerRevolution(gcodeLines) : null,
      thinWalls: gcodeLines.length > 0 ? analyzeThinWalls(gcodeLines) : null,
      variableUsage: gcodeLines.length > 0 ? trackVariableUsage(gcodeLines) : null,
      segmentClassifier: gcodeLines.length > 0 ? classifyToolpathSegments(gcodeLines) : null,
      infillDensityVariance: gcodeLines.length > 0 ? analyzeInfillDensityVariance(gcodeLines) : null,
      errorPatterns: gcodeLines.length > 0 ? detectErrorPatterns(gcodeLines) : null,
      surfaceSpeed: gcodeLines.length > 0 ? calculateSurfaceSpeed(gcodeLines) : null,
      layerTimeVariance: gcodeLines.length > 0 ? analyzeLayerTimeVariance(gcodeLines) : null,

      // Batch 20
      speedHeatmap: gcodeLines.length > 0 ? generateSpeedHeatmap(gcodeLines) : null,
      toolWearPrediction: gcodeLines.length > 0 ? predictToolWearProgression(gcodeLines) : null,
      retractionSpeedOpt: gcodeLines.length > 0 ? optimizeRetractionSpeed(gcodeLines) : null,
      lineComplexity: gcodeLines.length > 0 ? scoreLineComplexity(gcodeLines) : null,
      docOptimizer: gcodeLines.length > 0 ? optimizeDepthOfCut(gcodeLines) : null,
      layerFanOptimizer: gcodeLines.length > 0 ? optimizeLayerFanSpeed(gcodeLines) : null,
      circularInterpolation: gcodeLines.length > 0 ? detectCircularInterpolation(gcodeLines) : null,
      toolpathEfficiency: gcodeLines.length > 0 ? calculateToolpathEfficiency(gcodeLines) : null,
      materialPerLayer: gcodeLines.length > 0 ? trackMaterialPerLayer(gcodeLines) : null,
      commandRedundancy: gcodeLines.length > 0 ? removeCommandRedundancy(gcodeLines) : null,
      cuttingStrategy: gcodeLines.length > 0 ? adviseCuttingStrategy(gcodeLines) : null,
      ironingPattern: gcodeLines.length > 0 ? analyzeIroningPattern(gcodeLines) : null,

      // Previously unintegrated analysis functions
      chatterFrequencyAnalysis: gcodeLines.length > 0 ? analyzeChatterFrequency(gcodeLines) : null,
      thermalExpansionCompensation: gcodeLines.length > 0 ? compensateThermalExpansion(gcodeLines) : null,

      // Batch 21
      perLayerBounds: gcodeLines.length > 0 ? calculatePerLayerBounds(gcodeLines) : null,
      engagementTime: gcodeLines.length > 0 ? calculateEngagementTime(gcodeLines) : null,
      retractionFrequency: gcodeLines.length > 0 ? analyzeRetractionFrequency(gcodeLines) : null,
      spindleLoadProfile: gcodeLines.length > 0 ? estimateSpindleLoadProfile(gcodeLines) : null,
      directionChanges: gcodeLines.length > 0 ? countDirectionChanges(gcodeLines) : null,
      bedAdhesionArea: gcodeLines.length > 0 ? calculateBedAdhesionArea(gcodeLines) : null,
      coordinateRotations: gcodeLines.length > 0 ? detectCoordinateRotations(gcodeLines) : null,
      wearRate: gcodeLines.length > 0 ? calculateWearRate(gcodeLines) : null,
      flowRateConsistency: gcodeLines.length > 0 ? analyzeFlowRateConsistency(gcodeLines) : null,
      commandSequenceValidation: gcodeLines.length > 0 ? validateCommandSequence(gcodeLines) : null,
      feedRateHarmonics: gcodeLines.length > 0 ? analyzeFeedRateHarmonics(gcodeLines) : null,
      layerHeightVariance: gcodeLines.length > 0 ? analyzeLayerHeightVariance(gcodeLines) : null,

      // Batch 22
      accelerationProfile: gcodeLines.length > 0 ? analyzeAccelerationProfile(gcodeLines) : null,
      cuttingForceSpectrum: gcodeLines.length > 0 ? analyzeCuttingForceSpectrum(gcodeLines) : null,
      pressureAdvanceOpt: gcodeLines.length > 0 ? optimizePressureAdvance(gcodeLines) : null,
      coordinateOrigins: gcodeLines.length > 0 ? mapCoordinateOrigins(gcodeLines) : null,
      toolpathLoops: gcodeLines.length > 0 ? detectToolpathLoops(gcodeLines) : null,
      extrusionWidthPerLayer: gcodeLines.length > 0 ? analyzeExtrusionWidthPerLayer(gcodeLines) : null,
      spindleWarmupOpt: gcodeLines.length > 0 ? optimizeSpindleWarmup(gcodeLines) : null,
      supportStructureOpt: gcodeLines.length > 0 ? optimizeSupportStructure(gcodeLines) : null,
      fileSizeOpt: gcodeLines.length > 0 ? optimizeFileSize(gcodeLines) : null,
      curvatureHeatmap: gcodeLines.length > 0 ? generateCurvatureHeatmap(gcodeLines) : null,
      layerAdhesionStrength: gcodeLines.length > 0 ? predictLayerAdhesionStrength(gcodeLines) : null,
      corneringSpeed: gcodeLines.length > 0 ? calculateCorneringSpeed(gcodeLines) : null,

      // Batch 23
      scallopHeight: gcodeLines.length > 0 ? calculateScallopHeight(gcodeLines) : null,
      filamentDiameterVariance: gcodeLines.length > 0 ? detectFilamentDiameterVariance(gcodeLines) : null,
      coordinateScaling: gcodeLines.length > 0 ? detectCoordinateScaling(gcodeLines) : null,
      chipThinning: gcodeLines.length > 0 ? calculateChipThinning(gcodeLines) : null,
      infillAngles: gcodeLines.length > 0 ? analyzeInfillAngles(gcodeLines) : null,
      segmentLengthDistribution: gcodeLines.length > 0 ? analyzeSegmentLengthDistribution(gcodeLines) : null,
      stepover: gcodeLines.length > 0 ? calculateStepover(gcodeLines) : null,
      extrusionMultiplier: gcodeLines.length > 0 ? calibrateExtrusionMultiplier(gcodeLines) : null,
      toolpathSymmetry: gcodeLines.length > 0 ? detectToolpathSymmetry(gcodeLines) : null,
      retractPlaneOpt: gcodeLines.length > 0 ? optimizeRetractPlane(gcodeLines) : null,
      skirtBrimGap: gcodeLines.length > 0 ? analyzeSkirtBrimGap(gcodeLines) : null,
      executionTime: gcodeLines.length > 0 ? estimateExecutionTime(gcodeLines) : null,

      // Batch 24
      engagementAnglePerSegment: gcodeLines.length > 0 ? calculateEngagementAnglePerSegment(gcodeLines) : null,
      firstLayerSpeedOpt: gcodeLines.length > 0 ? optimizeFirstLayerSpeed(gcodeLines) : null,
      rapidTravelEfficiency: gcodeLines.length > 0 ? analyzeRapidTravelEfficiency(gcodeLines) : null,
      plungeRateAnalysis: gcodeLines.length > 0 ? analyzePlungeRate(gcodeLines) : null,
      materialPerExtruder: gcodeLines.length > 0 ? calculateMaterialPerExtruder(gcodeLines) : null,
      climbConventionalPerPass: gcodeLines.length > 0 ? classifyClimbConventionalPerPass(gcodeLines) : null,
      layerCoolingTime: gcodeLines.length > 0 ? analyzeLayerCoolingTime(gcodeLines) : null,
      reversalPoints: gcodeLines.length > 0 ? analyzeReversalPoints(gcodeLines) : null,
      cuttingModeConsistency: gcodeLines.length > 0 ? analyzeCuttingModeConsistency(gcodeLines) : null,
      extrusionStartStopQuality: gcodeLines.length > 0 ? analyzeExtrusionStartStopQuality(gcodeLines) : null,
      programFlowStructure: gcodeLines.length > 0 ? analyzeProgramFlowStructure(gcodeLines) : null,
      mrrPerLayer: gcodeLines.length > 0 ? calculateMRRPerLayer(gcodeLines) : null,

      // Batch 25
      airCuttingTime: gcodeLines.length > 0 ? calculateAirCuttingTime(gcodeLines) : null,
      beadWidthVariance: gcodeLines.length > 0 ? analyzeBeadWidthVariance(gcodeLines) : null,
      parameterRanges: gcodeLines.length > 0 ? validateParameterRanges(gcodeLines) : null,
      engagementHeatmapPerLayer: gcodeLines.length > 0 ? generateEngagementHeatmapPerLayer(gcodeLines) : null,
      fanDutyCycle: gcodeLines.length > 0 ? analyzeFanDutyCycle(gcodeLines) : null,
      toolChangePositions: gcodeLines.length > 0 ? optimizeToolChangePositions(gcodeLines) : null,
      spindleSpeedAdvice: gcodeLines.length > 0 ? adviseSpindleSpeed(gcodeLines) : null,
      firstLayerHeightOpt: gcodeLines.length > 0 ? optimizeFirstLayerHeight(gcodeLines) : null,
      continuityPerLayer: gcodeLines.length > 0 ? checkContinuityPerLayer(gcodeLines) : null,
      minimumClearance: gcodeLines.length > 0 ? calculateMinimumClearance(gcodeLines) : null,
      wallThicknessConsistency: gcodeLines.length > 0 ? analyzeWallThicknessConsistency(gcodeLines) : null,
      executionOrder: gcodeLines.length > 0 ? optimizeExecutionOrder(gcodeLines) : null,

      // Batch 26
      engagementTimePerLayer: gcodeLines.length > 0 ? calculateEngagementTimePerLayer(gcodeLines) : null,
      extrusionRatePerLayer: gcodeLines.length > 0 ? analyzeExtrusionRatePerLayer(gcodeLines) : null,
      workOffsetUsage: gcodeLines.length > 0 ? analyzeWorkOffsetUsage(gcodeLines) : null,
      deflectionCompensation: gcodeLines.length > 0 ? calculateDeflectionCompensation(gcodeLines) : null,
      bridgingSpeedOpt: gcodeLines.length > 0 ? optimizeBridgingSpeed(gcodeLines) : null,
      overlapsPerLayer: gcodeLines.length > 0 ? detectOverlapsPerLayer(gcodeLines) : null,
      spindleLoadPerLayer: gcodeLines.length > 0 ? analyzeSpindleLoadPerLayer(gcodeLines) : null,
      retractionHopHeight: gcodeLines.length > 0 ? analyzeRetractionHopHeight(gcodeLines) : null,
      programComplexity: gcodeLines.length > 0 ? calculateProgramComplexity(gcodeLines) : null,
      arcInterpolationQuality: gcodeLines.length > 0 ? analyzeArcInterpolationQuality(gcodeLines) : null,
      layerHeightConsistencyPerLayer: gcodeLines.length > 0 ? analyzeLayerHeightConsistencyPerLayer(gcodeLines) : null,
      modalStateTransitions: gcodeLines.length > 0 ? analyzeModalStateTransitions(gcodeLines) : null,

      // Batch 27
      entryStrategy: gcodeLines.length > 0 ? analyzeEntryStrategy(gcodeLines) : null,
      retractionAcceleration: gcodeLines.length > 0 ? analyzeRetractionAcceleration(gcodeLines) : null,
      coordinateSystemAlignment: gcodeLines.length > 0 ? checkCoordinateSystemAlignment(gcodeLines) : null,
      noseRadiusCompensation: gcodeLines.length > 0 ? validateNoseRadiusCompensation(gcodeLines) : null,
      infillDensityPerLayer: gcodeLines.length > 0 ? analyzeInfillDensityPerLayer(gcodeLines) : null,
      segmentClassificationPerLayer: gcodeLines.length > 0 ? classifySegmentsPerLayer(gcodeLines) : null,
      spindleWarmupValidation: gcodeLines.length > 0 ? validateSpindleWarmupCycle(gcodeLines) : null,
      fanSpeedPerLayer: gcodeLines.length > 0 ? analyzeFanSpeedPerLayer(gcodeLines) : null,
      structureComplexityPerSection: gcodeLines.length > 0 ? analyzeStructureComplexityPerSection(gcodeLines) : null,
      leadInOut: gcodeLines.length > 0 ? analyzeLeadInOut(gcodeLines) : null,
      extrusionConsistencyPerLayer: gcodeLines.length > 0 ? analyzeExtrusionConsistencyPerLayer(gcodeLines) : null,
      machineCoordinateBoundary: gcodeLines.length > 0 ? checkMachineCoordinateBoundary(gcodeLines) : null,
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
   * camera.fitToBounds() which would override the URL camera params.
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
