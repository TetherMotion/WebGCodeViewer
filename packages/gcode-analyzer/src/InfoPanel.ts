/**
 * @file InfoPanel.ts
 * @brief Side panel displaying G-code metadata, analysis statistics,
 * material usage, speed stats, and layer time info.
 *
 * Populated after G-code is loaded and metadata is parsed.
 */

import { GcodeMetadata, computeSpeedStats, computeLayerTimes, formatTime } from "./GcodeMetadata";
import { MiniplotData } from "@tether/viewer-core";
import { type AnalysisSection } from "@tether/viewer-core/generated";
import {
  detectStringingRisk,
  detectLayerTimeWarnings,
  detectGcodeErrors,
  computeVolumetricFlow,
  getFlowStats,
  parseFeatureTypes,
  parseWorkCoordinateSystems,
  parseStockDimensions,
  estimatePrintTime,
} from "./GcodeAnalysis";
import {
  detectOverhangs,
  detectZSeams,
  analyzeZSeamConsistency,
  parseDrillingCycles,
  parseCutterCompensation,
  checkMachineLimits,
  computeFeatureTimeBreakdown,
  analyzePathOptimization,
  checkOverTravel,
  parseProbeEvents,
  parseSubprograms,
  estimateJobCost,
  MachineLimits,
} from "./GcodeAdvanced";
import {
  parseColorChanges,
  analyzeSupportStructure,
  parseInfillDensity,
  parseMacros,
  trackMultiExtruder,
  parseBedLevelingMesh,
  detectBridges,
  detectRapidPlanes,
} from "./GcodeAdvanced2";
import {
  parseRotaryAxes,
  simulateThermal,
  predictWarping,
  buildPrintTimeGraph,
  estimateSpindleLoad,
  estimateToolWear,
  checkCollisions,
  createStockModel,
  parseToolDefinitions,
} from "./GcodeAdvanced3";
import {
  analyzeRetractions,
  checkLayerHeightConsistency,
  analyzeFlowRate,
  analyzeFirstLayer,
  predictStringing,
  analyzeCoolingFan,
  analyzePrintSpeeds,
} from "./GcodeAdvanced4";
import {
  lintGcode,
  analyzeToolpathOptimization,
  trackFilamentPerLayer,
  analyzePressureAdvance,
  profileGcode,
} from "./GcodeAdvanced5";
import {
  detectMillingDirection,
  estimateAccelerationLimitedTime,
  estimateEnergyConsumption,
  analyzeWorkOffsets,
  recognizePatterns,
  estimateToolDeflection,
} from "./GcodeAdvanced6";
import {
  predictChatter,
  trackMacroVariables,
  analyzeCoordinateRotation,
  estimateToolLife,
  verifyCutterCompensation,
  suggestTravelOptimization,
} from "./GcodeAdvanced7";
import {
  trackModalStates,
  analyzeDwellTime,
  check3DPSafety,
  analyzeCurvature,
  recognizeFeatures,
  analyzeSpindlePower,
  analyzeMultiPart,
  analyzeBedAdhesion,
  optimizeCycleTime,
  checkGcodeCompatibility,
} from "./GcodeAdvanced8";
import {
  detectSelfIntersections,
  analyzeCommandFrequency,
  optimizeToolChanges,
  analyzeLayerTimes,
  extractComments,
  analyzeToolpathLength,
  analyzeMCodes,
  analyzeSpindleWarmup,
  generateFeedRateHistogram,
  analyzeToolpathDirection,
  parseWithRecovery,
} from "./GcodeAdvanced9";
import {
  analyzeZHops,
  analyzeExtrusionConsistency,
  analyzeToolpathSmoothing,
  predictPrintQuality,
  analyzeVolumetricFlowRate,
  generateStatisticsSummary,
  analyzePrintEfficiency,
  autoGenerateAnnotations,
} from "./GcodeAdvanced10";
import {
  trackToolWearProgression,
  generateOptimizationReport,
  analyzeBedThermalMap,
  analyzeCoolingEffectiveness,
  predictPrintFailure,
  auditGcodeSecurity,
} from "./GcodeAdvanced11";
import {
  reverseEngineerGcode,
  analyzeMachiningStrategy,
  analyzeBedLevelingQuality,
  validateGcodeRules,
} from "./GcodeAdvanced12";
import {
  analyzeChipThickness,
  analyzeAerodynamics,
  analyzeAdaptiveSpeed,
  analyzeMaterialFlow,
} from "./GcodeAdvanced13";
import {
  predictToolDeflectionAdvanced,
  predictSurfaceRoughness,
  simulateWarping,
  detectCollisions3D,
  calculateToolLife,
  analyzeInfillPattern,
  computeBounds,
  optimizeRetractions,
} from "./GcodeAdvanced14";
import {
  analyzeLayerAdhesion,
  generateOverhangMap,
  checkToolpathContinuity,
  analyzeExtrusionWidthConsistency,
  analyzeMachineVibration,
  trackThermalHistory,
} from "./GcodeAdvanced15";
import {
  calculateChipLoad,
  estimateSpoolUsage,
  suggestErrorRecovery,
  calculateMRR,
  analyzeFirstLayerSquish,
} from "./GcodeAdvanced16";
import {
  analyzeIdleTime,
  validateCuttingParameters,
  detectLayerShiftRisk,
  analyzeElephantFoot,
  analyzeCommentDensity,
  analyzeSkirtBrim,
} from "./GcodeAdvanced17";
import {
  analyzePerToolPathLength,
  analyzeOozePrevention,
  analyzeSpindleSpeedVariation,
  analyzeModalGroups,
  analyzeFanCurve,
  countDirectionReversals,
  assessExecutionRisk,
} from "./GcodeAdvanced18";
import {
  calculateArcLength,
  analyzeEntryExitAngles,
  optimizeRetractionDistance,
  calculateFeedPerRevolution,
  analyzeThinWalls,
  classifyToolpathSegments,
  detectErrorPatterns,
  calculateSurfaceSpeed,
  analyzeLayerTimeVariance,
} from "./GcodeAdvanced19";
import {
  generateSpeedHeatmap,
  predictToolWearProgression,
  optimizeRetractionSpeed,
  optimizeDepthOfCut,
  calculateToolpathEfficiency,
  removeCommandRedundancy,
  adviseCuttingStrategy,
  analyzeIroningPattern,
} from "./GcodeAdvanced20";
import {
  calculatePerLayerBounds,
  calculateEngagementTime,
  analyzeRetractionFrequency,
  countDirectionChanges,
  calculateBedAdhesionArea,
  calculateWearRate,
  analyzeFlowRateConsistency,
  validateCommandSequence,
  analyzeLayerHeightVariance,
} from "./GcodeAdvanced21";
import {
  analyzeAccelerationProfile,
  optimizePressureAdvance,
  mapCoordinateOrigins,
  analyzeExtrusionWidthPerLayer,
  optimizeSpindleWarmup,
  optimizeSupportStructure,
  optimizeFileSize,
  generateCurvatureHeatmap,
  predictLayerAdhesionStrength,
  calculateCorneringSpeed,
} from "./GcodeAdvanced22";
import {
  calculateScallopHeight,
  detectFilamentDiameterVariance,
  detectCoordinateScaling,
  calculateChipThinning,
  analyzeSegmentLengthDistribution,
  calculateStepover,
  calibrateExtrusionMultiplier,
  detectToolpathSymmetry,
  optimizeRetractPlane,
  analyzeSkirtBrimGap,
  estimateExecutionTime,
} from "./GcodeAdvanced23";
import {
  calculateEngagementAnglePerSegment,
  optimizeFirstLayerSpeed,
  analyzeRapidTravelEfficiency,
  analyzePlungeRate,
  calculateMaterialPerExtruder,
  analyzeLayerCoolingTime,
  analyzeReversalPoints,
  analyzeExtrusionStartStopQuality,
  analyzeProgramFlowStructure,
  calculateMRRPerLayer,
} from "./GcodeAdvanced24";
import {
  calculateAirCuttingTime,
  analyzeBeadWidthVariance,
  validateParameterRanges,
  generateEngagementHeatmapPerLayer,
  analyzeFanDutyCycle,
  optimizeToolChangePositions,
  adviseSpindleSpeed,
  optimizeFirstLayerHeight,
  checkContinuityPerLayer,
  calculateMinimumClearance,
  analyzeWallThicknessConsistency,
  optimizeExecutionOrder,
} from "./GcodeAdvanced25";
import {
  calculateEngagementTimePerLayer,
  analyzeExtrusionRatePerLayer,
  analyzeWorkOffsetUsage,
  calculateDeflectionCompensation,
  optimizeBridgingSpeed,
  detectOverlapsPerLayer,
  analyzeSpindleLoadPerLayer,
  analyzeRetractionHopHeight,
  calculateProgramComplexity,
  analyzeArcInterpolationQuality,
  analyzeLayerHeightConsistencyPerLayer,
  analyzeModalStateTransitions,
} from "./GcodeAdvanced26";
import {
  analyzeEntryStrategy,
  analyzeRetractionAcceleration,
  checkCoordinateSystemAlignment,
  validateNoseRadiusCompensation,
  analyzeInfillDensityPerLayer,
  classifySegmentsPerLayer,
  validateSpindleWarmupCycle,
  analyzeFanSpeedPerLayer,
  analyzeStructureComplexityPerSection,
  analyzeLeadInOut,
  analyzeExtrusionConsistencyPerLayer,
  checkMachineCoordinateBoundary,
} from "./GcodeAdvanced27";

export class InfoPanel {
  private element: HTMLElement;
  private contentEl: HTMLElement;
  private visibleFlag = true;

  get visible(): boolean { return this.visibleFlag; }
  set visible(v: boolean) {
    this.visibleFlag = v;
    this.element.style.display = v ? '' : 'none';
  }

  constructor(container: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'info-panel';
    container.appendChild(this.element);

    const header = document.createElement('div');
    header.className = 'info-panel-header';
    header.textContent = 'Analysis';
    this.element.appendChild(header);

    this.contentEl = document.createElement('div');
    this.contentEl.className = 'info-panel-content';
    this.element.appendChild(this.contentEl);
  }

  /**
   * Update the panel with all available data.
   * Optional gcodeLines enables advanced analysis (stringing, errors, flow, etc.)
   */
  update(data: {
    metadata: GcodeMetadata;
    miniplotData: MiniplotData | null;
    zLayers: { layerIndex: number; zHeight: number; pieceStart: number; pieceEnd: number }[];
    totalDuration: number;
    pathLength: number;
    bounds: { min: [number, number, number]; max: [number, number, number] };
    sampleCount: number;
    pieceCount: number;
    gcodeLines?: string[];
    materialUsage?: { extrusionLength: number; volume: number; weight: number };
    remoteSections?: AnalysisSection[];
  }): void {
    const { metadata, miniplotData, zLayers, totalDuration, pathLength, bounds, sampleCount, pieceCount, gcodeLines, materialUsage, remoteSections } = data;

    const speedStats = miniplotData
      ? computeSpeedStats(miniplotData.segments)
      : { minSpeed: 0, maxSpeed: 0, meanSpeed: 0, medianSpeed: 0 };

    const layerTimes = miniplotData
      ? computeLayerTimes(zLayers, miniplotData.segments)
      : [];

    const totalLayerTime = layerTimes.reduce((sum, l) => sum + l.timeSeconds, 0);
    const maxLayerTime = layerTimes.reduce((max, l) => Math.max(max, l.timeSeconds), 0);
    const avgLayerTime = layerTimes.length > 0 ? totalLayerTime / layerTimes.length : 0;

    const dims = {
      x: bounds.max[0] - bounds.min[0],
      y: bounds.max[1] - bounds.min[1],
      z: bounds.max[2] - bounds.min[2],
    };

    let html = '';

    // ── Print/CNC Info ──
    html += '<div class="info-section"><h4>Job Info</h4>';
    html += `<div class="info-row"><span>Duration</span><span>${formatTime(totalDuration)}</span></div>`;
    html += `<div class="info-row"><span>Path Length</span><span>${pathLength.toFixed(1)} mm</span></div>`;
    html += `<div class="info-row"><span>Pieces</span><span>${pieceCount}</span></div>`;
    html += `<div class="info-row"><span>Samples</span><span>${sampleCount}</span></div>`;
    html += '</div>';

    // ── Dimensions ──
    html += '<div class="info-section"><h4>Dimensions</h4>';
    html += `<div class="info-row"><span>X</span><span>${dims.x.toFixed(2)} mm</span></div>`;
    html += `<div class="info-row"><span>Y</span><span>${dims.y.toFixed(2)} mm</span></div>`;
    html += `<div class="info-row"><span>Z</span><span>${dims.z.toFixed(2)} mm</span></div>`;
    html += '</div>';

    // ── Speed Statistics ──
    html += '<div class="info-section"><h4>Speed Stats</h4>';
    html += `<div class="info-row"><span>Min Feed</span><span>${speedStats.minSpeed.toFixed(1)} mm/s</span></div>`;
    html += `<div class="info-row"><span>Max Feed</span><span>${speedStats.maxSpeed.toFixed(1)} mm/s</span></div>`;
    html += `<div class="info-row"><span>Mean Feed</span><span>${speedStats.meanSpeed.toFixed(1)} mm/s</span></div>`;
    html += `<div class="info-row"><span>Median Feed</span><span>${speedStats.medianSpeed.toFixed(1)} mm/s</span></div>`;
    if (metadata.feedRateRange.max > 0) {
      html += `<div class="info-row"><span>F Range</span><span>${metadata.feedRateRange.min.toFixed(0)}–${metadata.feedRateRange.max.toFixed(0)} mm/min</span></div>`;
    }
    html += '</div>';

    // ── Layer Analysis ──
    if (layerTimes.length > 0) {
      html += '<div class="info-section"><h4>Layers</h4>';
      html += `<div class="info-row"><span>Count</span><span>${layerTimes.length}</span></div>`;
      html += `<div class="info-row"><span>Avg Time</span><span>${formatTime(avgLayerTime)}</span></div>`;
      html += `<div class="info-row"><span>Max Time</span><span>${formatTime(maxLayerTime)}</span></div>`;
      // Show slowest 3 layers
      const sorted = [...layerTimes].sort((a, b) => b.timeSeconds - a.timeSeconds).slice(0, 3);
      html += '<div class="info-sublabel">Slowest layers:</div>';
      for (const l of sorted) {
        html += `<div class="info-row"><span>Layer ${l.layerIndex} (Z=${l.zHeight.toFixed(2)})</span><span>${formatTime(l.timeSeconds)}</span></div>`;
      }
      html += '</div>';
    }

    // ── Tools (CNC) ──
    if (metadata.tools.length > 0) {
      html += '<div class="info-section"><h4>Tools</h4>';
      html += `<div class="info-row"><span>Tool Count</span><span>${metadata.tools.length}</span></div>`;
      html += `<div class="info-row"><span>Tools</span><span>${metadata.tools.join(', ')}</span></div>`;
      html += `<div class="info-row"><span>Changes</span><span>${metadata.toolChanges.length}</span></div>`;
      html += '</div>';
    }

    // ── Spindle (CNC) ──
    if (metadata.maxSpindleRpm > 0) {
      html += '<div class="info-section"><h4>Spindle</h4>';
      html += `<div class="info-row"><span>Max RPM</span><span>${metadata.maxSpindleRpm}</span></div>`;
      html += `<div class="info-row"><span>Events</span><span>${metadata.spindleEvents.length}</span></div>`;
      html += '</div>';
    }

    // ── Temperature (3DP) ──
    if (metadata.maxHotendTemp > 0 || metadata.maxBedTemp > 0) {
      html += '<div class="info-section"><h4>Temperature</h4>';
      if (metadata.maxHotendTemp > 0) {
        html += `<div class="info-row"><span>Max Hotend</span><span>${metadata.maxHotendTemp}°C</span></div>`;
      }
      if (metadata.maxBedTemp > 0) {
        html += `<div class="info-row"><span>Max Bed</span><span>${metadata.maxBedTemp}°C</span></div>`;
      }
      html += '</div>';
    }

    // ── Fan (3DP) ──
    if (metadata.fanEvents.length > 0) {
      html += '<div class="info-section"><h4>Fan</h4>';
      html += `<div class="info-row"><span>Max Speed</span><span>${metadata.maxFanSpeed}</span></div>`;
      html += `<div class="info-row"><span>Events</span><span>${metadata.fanEvents.length}</span></div>`;
      html += '</div>';
    }

    // ── Coolant (CNC) ──
    if (metadata.coolantEvents.length > 0) {
      html += '<div class="info-section"><h4>Coolant</h4>';
      html += `<div class="info-row"><span>Events</span><span>${metadata.coolantEvents.length}</span></div>`;
      html += '</div>';
    }

    // ── Material Usage (3DP) ──
    if (materialUsage && materialUsage.extrusionLength > 0) {
      html += '<div class="info-section"><h4>Material Usage</h4>';
      html += `<div class="info-row"><span>Extrusion</span><span>${materialUsage.extrusionLength.toFixed(1)} mm</span></div>`;
      html += `<div class="info-row"><span>Volume</span><span>${(materialUsage.volume / 1000).toFixed(2)} cm³</span></div>`;
      html += `<div class="info-row"><span>Weight</span><span>${materialUsage.weight.toFixed(1)} g</span></div>`;
      html += '</div>';
    }

    // ── Advanced Analysis (requires G-code text) ──
    if (gcodeLines && gcodeLines.length > 0) {
      // Print time estimate
      const timeEst = estimatePrintTime(gcodeLines);
      if (timeEst.estimatedTime > 0) {
        html += '<div class="info-section"><h4>Time Estimate</h4>';
        html += `<div class="info-row"><span>Estimated</span><span>${formatTime(timeEst.estimatedTime)}</span></div>`;
        html += `<div class="info-row"><span>Moves</span><span>${timeEst.moveCount}</span></div>`;
        html += `<div class="info-row"><span>Method</span><span>${timeEst.method}</span></div>`;
        html += '</div>';
      }

      // Volumetric flow
      const flowSamples = computeVolumetricFlow(gcodeLines);
      if (flowSamples.length > 0) {
        const flowStats = getFlowStats(flowSamples);
        html += '<div class="info-section"><h4>Volumetric Flow</h4>';
        html += `<div class="info-row"><span>Min</span><span>${flowStats.minFlow.toFixed(2)} mm³/s</span></div>`;
        html += `<div class="info-row"><span>Max</span><span>${flowStats.maxFlow.toFixed(2)} mm³/s</span></div>`;
        html += `<div class="info-row"><span>Mean</span><span>${flowStats.meanFlow.toFixed(2)} mm³/s</span></div>`;
        html += `<div class="info-row"><span>Std Dev</span><span>${flowStats.stdDev.toFixed(2)} mm³/s</span></div>`;
        html += '</div>';
      }

      // Stringing risk
      const stringingRisks = detectStringingRisk(gcodeLines);
      if (stringingRisks.length > 0) {
        const highRisk = stringingRisks.filter(r => r.riskScore > 0.5);
        html += '<div class="info-section"><h4>Stringing Risk</h4>';
        html += `<div class="info-row"><span>Total Travels</span><span>${stringingRisks.length}</span></div>`;
        html += `<div class="info-row"><span>High Risk</span><span>${highRisk.length}</span></div>`;
        if (highRisk.length > 0) {
          html += '<div class="info-sublabel">High-risk travels:</div>';
          for (const r of highRisk.slice(0, 5)) {
            html += `<div class="info-row"><span>Line ${r.lineNumber + 1}</span><span>${r.travelDistance.toFixed(1)} mm (risk: ${(r.riskScore * 100).toFixed(0)}%)</span></div>`;
          }
        }
        html += '</div>';
      }

      // G-code issues
      const issues = detectGcodeErrors(gcodeLines);
      if (issues.length > 0) {
        const errors = issues.filter(i => i.severity === 'error');
        const warnings = issues.filter(i => i.severity === 'warning');
        const infos = issues.filter(i => i.severity === 'info');
        html += '<div class="info-section"><h4>G-code Issues</h4>';
        if (errors.length > 0) {
          html += `<div class="info-row info-error"><span>Errors</span><span>${errors.length}</span></div>`;
          for (const e of errors.slice(0, 5)) {
            html += `<div class="info-row info-error"><span>Line ${e.lineNumber + 1}</span><span>${e.message}</span></div>`;
          }
        }
        if (warnings.length > 0) {
          html += `<div class="info-row info-warning"><span>Warnings</span><span>${warnings.length}</span></div>`;
          if (warnings.length <= 5) {
            for (const w of warnings) {
              html += `<div class="info-row info-warning"><span>Line ${w.lineNumber + 1}</span><span>${w.message}</span></div>`;
            }
          }
        }
        if (infos.length > 0) {
          html += `<div class="info-row info-info"><span>Info</span><span>${infos.length}</span></div>`;
        }
        html += '</div>';
      }

      // Feature types (slicer)
      const featureTypes = parseFeatureTypes(gcodeLines);
      if (featureTypes.length > 0) {
        const typeCounts = new Map<string, number>();
        for (const ft of featureTypes) {
          typeCounts.set(ft.featureType, (typeCounts.get(ft.featureType) ?? 0) + 1);
        }
        html += '<div class="info-section"><h4>Feature Types</h4>';
        html += `<div class="info-row"><span>Slicer</span><span>${featureTypes[0].slicer}</span></div>`;
        for (const [type, count] of typeCounts) {
          html += `<div class="info-row"><span>${type}</span><span>${count}</span></div>`;
        }
        html += '</div>';
      }

      // Work coordinate systems (CNC)
      const wcs = parseWorkCoordinateSystems(gcodeLines);
      if (wcs.length > 0) {
        html += '<div class="info-section"><h4>Work Coordinates</h4>';
        html += `<div class="info-row"><span>Changes</span><span>${wcs.length}</span></div>`;
        const uniqueWCS = new Set(wcs.map(w => w.code));
        html += `<div class="info-row"><span>Systems</span><span>${Array.from(uniqueWCS).join(', ')}</span></div>`;
        html += '</div>';
      }

      // Stock/bed dimensions
      const stock = parseStockDimensions(gcodeLines);
      if (stock) {
        html += '<div class="info-section"><h4>Stock/Bed</h4>';
        const w = stock.max[0] - stock.min[0];
        const h = stock.max[1] - stock.min[1];
        const d = stock.max[2] - stock.min[2];
        html += `<div class="info-row"><span>Width</span><span>${w.toFixed(1)} mm</span></div>`;
        html += `<div class="info-row"><span>Depth</span><span>${h.toFixed(1)} mm</span></div>`;
        if (d > 0) html += `<div class="info-row"><span>Height</span><span>${d.toFixed(1)} mm</span></div>`;
        html += '</div>';
      }

      // Layer time warnings
      if (layerTimes.length > 0) {
        const layerWarnings = detectLayerTimeWarnings(layerTimes);
        if (layerWarnings.length > 0) {
          const slow = layerWarnings.filter(w => w.warning === 'slow');
          const fast = layerWarnings.filter(w => w.warning === 'fast');
          html += '<div class="info-section"><h4>Layer Warnings</h4>';
          if (slow.length > 0) {
            html += `<div class="info-row info-warning"><span>Slow Layers</span><span>${slow.length}</span></div>`;
            for (const w of slow.slice(0, 3)) {
              html += `<div class="info-row info-warning"><span>Layer ${w.layerIndex} (Z=${w.zHeight.toFixed(2)})</span><span>${formatTime(w.timeSeconds)}</span></div>`;
            }
          }
          if (fast.length > 0) {
            html += `<div class="info-row info-warning"><span>Fast Layers</span><span>${fast.length}</span></div>`;
            for (const w of fast.slice(0, 3)) {
              html += `<div class="info-row info-warning"><span>Layer ${w.layerIndex} (Z=${w.zHeight.toFixed(2)})</span><span>${formatTime(w.timeSeconds)}</span></div>`;
            }
          }
          html += '</div>';
        }
      }

      // ── Advanced CNC/3DP Analysis (from GcodeAdvanced) ──

      // Overhang detection (3DP)
      if (zLayers.length > 1) {
        const overhangLayers = zLayers.map(l => ({
          layerIndex: l.layerIndex,
          zHeight: l.zHeight,
          layerHeight: 0.2, // default
          bounds: { minX: bounds.min[0], maxX: bounds.max[0], minY: bounds.min[1], maxY: bounds.max[1] },
          startLine: l.pieceStart,
          endLine: l.pieceEnd,
        }));
        const overhangs = detectOverhangs(overhangLayers);
        if (overhangs.length > 0) {
          const severe = overhangs.filter(o => o.severity === 'severe');
          const moderate = overhangs.filter(o => o.severity === 'moderate');
          html += '<div class="info-section"><h4>Overhangs</h4>';
          html += `<div class="info-row"><span>Total</span><span>${overhangs.length}</span></div>`;
          if (moderate.length > 0) html += `<div class="info-row info-warning"><span>Moderate (30-45°)</span><span>${moderate.length}</span></div>`;
          if (severe.length > 0) html += `<div class="info-row info-error"><span>Severe (>45°)</span><span>${severe.length}</span></div>`;
          html += '</div>';
        }
      }

      // Z-seam analysis (3DP)
      if (zLayers.length > 0) {
        const seamLayers = zLayers.map(l => ({
          layerIndex: l.layerIndex,
          zHeight: l.zHeight,
          startLine: l.pieceStart,
          endLine: l.pieceEnd,
        }));
        const seams = detectZSeams(gcodeLines, seamLayers);
        if (seams.length > 0) {
          const seamAnalysis = analyzeZSeamConsistency(seams);
          html += '<div class="info-section"><h4>Z-Seam</h4>';
          html += `<div class="info-row"><span>Layers</span><span>${seamAnalysis.totalLayers}</span></div>`;
          html += `<div class="info-row"><span>Aligned</span><span>${seamAnalysis.alignedCount} (${(seamAnalysis.alignmentScore * 100).toFixed(0)}%)</span></div>`;
          html += `<div class="info-row"><span>Avg Distance</span><span>${seamAnalysis.averageSeamDistance.toFixed(2)} mm</span></div>`;
          html += '</div>';
        }
      }

      // Drilling cycles (CNC)
      const drillCycles = parseDrillingCycles(gcodeLines);
      if (drillCycles.length > 0) {
        html += '<div class="info-section"><h4>Drilling Cycles</h4>';
        html += `<div class="info-row"><span>Total Holes</span><span>${drillCycles.length}</span></div>`;
        const types = new Set(drillCycles.map(c => c.cycleType));
        for (const t of types) {
          const count = drillCycles.filter(c => c.cycleType === t).length;
          html += `<div class="info-row"><span>${t}</span><span>${count}</span></div>`;
        }
        html += '</div>';
      }

      // Cutter compensation (CNC)
      const compInfo = parseCutterCompensation(gcodeLines);
      if (compInfo.length > 0) {
        html += '<div class="info-section"><h4>Cutter Compensation</h4>';
        for (const c of compInfo) {
          html += `<div class="info-row"><span>Line ${c.lineNumber + 1}</span><span>${c.mode} D${c.dRegister}</span></div>`;
        }
        html += '</div>';
      }

      // Machine limits checking
      const defaultLimits: MachineLimits = {
        maxFeedRate: 15000, maxAcceleration: 3000, maxJerk: 100000,
        minX: 0, maxX: 300, minY: 0, maxY: 300, minZ: -200, maxZ: 300,
      };
      const limitViolations = checkMachineLimits(gcodeLines, defaultLimits);
      if (limitViolations.length > 0) {
        const errors = limitViolations.filter(v => v.severity === 'error');
        const warnings = limitViolations.filter(v => v.severity === 'warning');
        html += '<div class="info-section"><h4>Machine Limits</h4>';
        if (errors.length > 0) html += `<div class="info-row info-error"><span>Limit Errors</span><span>${errors.length}</span></div>`;
        if (warnings.length > 0) html += `<div class="info-row info-warning"><span>Limit Warnings</span><span>${warnings.length}</span></div>`;
        html += '</div>';
      }

      // Feature time breakdown (3DP)
      const featureTimes = computeFeatureTimeBreakdown(gcodeLines);
      if (featureTimes.length > 0) {
        html += '<div class="info-section"><h4>Feature Time Breakdown</h4>';
        for (const ft of featureTimes.slice(0, 6)) {
          html += `<div class="info-row"><span>${ft.featureType}</span><span>${formatTime(ft.totalTime)} (${ft.percentage.toFixed(1)}%)</span></div>`;
        }
        html += '</div>';
      }

      // Path optimization
      const optIssues = analyzePathOptimization(gcodeLines);
      if (optIssues.length > 0) {
        const totalWaste = optIssues.reduce((sum, i) => sum + i.waste, 0);
        html += '<div class="info-section"><h4>Optimization</h4>';
        html += `<div class="info-row"><span>Issues</span><span>${optIssues.length}</span></div>`;
        if (totalWaste > 0) html += `<div class="info-row info-warning"><span>Est. Waste</span><span>${formatTime(totalWaste)}</span></div>`;
        const categories = new Set(optIssues.map(i => i.category));
        for (const cat of categories) {
          const count = optIssues.filter(i => i.category === cat).length;
          html += `<div class="info-row"><span>${cat}</span><span>${count}</span></div>`;
        }
        html += '</div>';
      }

      // Over-travel detection (CNC)
      const overTravel = checkOverTravel(gcodeLines, {
        minX: 0, maxX: 300, minY: 0, maxY: 300, minZ: -200, maxZ: 300,
      });
      if (overTravel.length > 0) {
        html += '<div class="info-section"><h4>Over-Travel</h4>';
        html += `<div class="info-row info-error"><span>Violations</span><span>${overTravel.length}</span></div>`;
        for (const v of overTravel.slice(0, 5)) {
          html += `<div class="info-row info-error"><span>Line ${v.lineNumber + 1} ${v.axis}</span><span>${v.message}</span></div>`;
        }
        html += '</div>';
      }

      // Probe events (CNC)
      const probes = parseProbeEvents(gcodeLines);
      if (probes.length > 0) {
        html += '<div class="info-section"><h4>Probing</h4>';
        html += `<div class="info-row"><span>Probe Events</span><span>${probes.length}</span></div>`;
        for (const p of probes.slice(0, 5)) {
          html += `<div class="info-row"><span>Line ${p.lineNumber + 1} (${p.probeType})</span><span>${p.axis} at F${p.feedRate}</span></div>`;
        }
        html += '</div>';
      }

      // Subprogram calls (CNC)
      const { calls: subCalls, definitions: subDefs } = parseSubprograms(gcodeLines);
      if (subCalls.length > 0 || subDefs.length > 0) {
        html += '<div class="info-section"><h4>Subprograms</h4>';
        if (subDefs.length > 0) html += `<div class="info-row"><span>Definitions</span><span>${subDefs.length}</span></div>`;
        if (subCalls.length > 0) html += `<div class="info-row"><span>Calls</span><span>${subCalls.length}</span></div>`;
        html += '</div>';
      }

      // Cost estimation
      if (materialUsage && materialUsage.weight > 0) {
        const timeEst = estimatePrintTime(gcodeLines);
        if (timeEst.estimatedTime > 0) {
          const cost = estimateJobCost(timeEst.estimatedTime, materialUsage.weight);
          html += '<div class="info-section"><h4>Cost Estimate</h4>';
          html += `<div class="info-row"><span>Material</span><span>$${cost.materialCost.toFixed(2)}</span></div>`;
          html += `<div class="info-row"><span>Machine Time</span><span>$${cost.machineCost.toFixed(2)}</span></div>`;
          html += `<div class="info-row"><span>Overhead</span><span>$${cost.details.overheadCost.toFixed(2)}</span></div>`;
          html += `<div class="info-row info-warning"><span>Total</span><span>$${cost.totalCost.toFixed(2)}</span></div>`;
          html += '</div>';
        }
      }

      // ── Batch 2 Advanced Analysis (from GcodeAdvanced2) ──

      // Color changes (3DP)
      const colorChanges = parseColorChanges(gcodeLines);
      if (colorChanges.length > 0) {
        html += '<div class="info-section"><h4>Color Changes</h4>';
        html += `<div class="info-row"><span>Total</span><span>${colorChanges.length}</span></div>`;
        for (const cc of colorChanges.slice(0, 5)) {
          const layerStr = cc.layer !== null ? `Layer ${cc.layer}` : `Line ${cc.lineNumber + 1}`;
          html += `<div class="info-row"><span>${layerStr}</span><span>${cc.color}</span></div>`;
        }
        html += '</div>';
      }

      // Support structure analysis (3DP)
      const support = analyzeSupportStructure(gcodeLines, materialUsage?.extrusionLength ?? 0);
      if (support.segmentCount > 0) {
        html += '<div class="info-section"><h4>Support Structure</h4>';
        html += `<div class="info-row"><span>Segments</span><span>${support.segmentCount}</span></div>`;
        html += `<div class="info-row"><span>Filament</span><span>${support.totalLength.toFixed(1)} mm</span></div>`;
        html += `<div class="info-row"><span>Volume</span><span>${support.totalVolume.toFixed(1)} mm³</span></div>`;
        if (support.supportPercentage > 0) {
          html += `<div class="info-row info-warning"><span>Support %</span><span>${support.supportPercentage.toFixed(1)}%</span></div>`;
        }
        html += '</div>';
      }

      // Infill density (3DP)
      const infillInfos = parseInfillDensity(gcodeLines);
      if (infillInfos.length > 0) {
        html += '<div class="info-section"><h4>Infill Density</h4>';
        for (const inf of infillInfos.slice(0, 5)) {
          html += `<div class="info-row"><span>Layer ${inf.layer}</span><span>${inf.density.toFixed(1)}% (${inf.pattern})</span></div>`;
        }
        html += '</div>';
      }

      // Multi-extruder tracking (3DP)
      const extruders = trackMultiExtruder(gcodeLines);
      if (extruders.length > 1 || (extruders.length === 1 && extruders[0].filamentLength > 0)) {
        html += '<div class="info-section"><h4>Extruders</h4>';
        for (const ext of extruders) {
          if (ext.filamentLength > 0) {
            html += `<div class="info-row"><span>Extruder ${ext.extruder}</span><span>${ext.filamentLength.toFixed(1)} mm (${ext.weight.toFixed(2)} g)</span></div>`;
          }
        }
        html += '</div>';
      }

      // Bed leveling mesh (3DP)
      const mesh = parseBedLevelingMesh(gcodeLines);
      if (mesh) {
        html += '<div class="info-section"><h4>Bed Leveling Mesh</h4>';
        html += `<div class="info-row"><span>Grid</span><span>${mesh.rows}×${mesh.cols}</span></div>`;
        html += `<div class="info-row"><span>Z Range</span><span>${mesh.zRange.min.toFixed(3)} to ${mesh.zRange.max.toFixed(3)} mm</span></div>`;
        html += `<div class="info-row"><span>Avg Z</span><span>${mesh.averageZ.toFixed(4)} mm</span></div>`;
        html += '</div>';
      }

      // Bridge detection (3DP)
      if (zLayers.length > 1) {
        const seamLayers = zLayers.map(l => ({
          layerIndex: l.layerIndex, zHeight: l.zHeight,
          startLine: l.pieceStart, endLine: l.pieceEnd,
        }));
        const bridges = detectBridges(gcodeLines, seamLayers);
        if (bridges.length > 0) {
          const longBridges = bridges.filter(b => b.severity === 'long');
          const mediumBridges = bridges.filter(b => b.severity === 'medium');
          html += '<div class="info-section"><h4>Bridges</h4>';
          html += `<div class="info-row"><span>Total</span><span>${bridges.length}</span></div>`;
          if (mediumBridges.length > 0) html += `<div class="info-row info-warning"><span>Medium (5-20mm)</span><span>${mediumBridges.length}</span></div>`;
          if (longBridges.length > 0) html += `<div class="info-row info-error"><span>Long (>20mm)</span><span>${longBridges.length}</span></div>`;
          html += '</div>';
        }
      }

      // Rapid planes (CNC/3DP)
      const rapidPlanes = detectRapidPlanes(gcodeLines);
      if (rapidPlanes.length > 0) {
        html += '<div class="info-section"><h4>Safe Z Planes</h4>';
        for (const plane of rapidPlanes.slice(0, 5)) {
          const label = plane.isPrimary ? 'Primary' : 'Secondary';
          html += `<div class="info-row"><span>Z=${plane.zHeight.toFixed(2)} (${label})</span><span>${plane.rapidCount} rapids</span></div>`;
        }
        html += '</div>';
      }

      // Macros/variables (CNC)
      const { variables: macroVars, calls: macroCalls } = parseMacros(gcodeLines);
      if (macroVars.length > 0 || macroCalls.length > 0) {
        html += '<div class="info-section"><h4>Macros & Variables</h4>';
        if (macroVars.length > 0) html += `<div class="info-row"><span>Variables</span><span>${macroVars.length}</span></div>`;
        if (macroCalls.length > 0) html += `<div class="info-row"><span>Macro Calls</span><span>${macroCalls.length}</span></div>`;
        html += '</div>';
      }

      // ── Batch 3 Advanced Analysis (from GcodeAdvanced3) ──

      // 5-axis rotary movements (CNC)
      const rotary = parseRotaryAxes(gcodeLines);
      if (rotary.moves.length > 0) {
        html += '<div class="info-section"><h4>5-Axis Rotary</h4>';
        html += `<div class="info-row"><span>Total Moves</span><span>${rotary.moves.length}</span></div>`;
        const aMoves = rotary.moves.filter(m => m.axis === 'A').length;
        const bMoves = rotary.moves.filter(m => m.axis === 'B').length;
        const cMoves = rotary.moves.filter(m => m.axis === 'C').length;
        if (aMoves > 0) html += `<div class="info-row"><span>A axis</span><span>${aMoves} (final: ${rotary.finalState.a.toFixed(1)}°)</span></div>`;
        if (bMoves > 0) html += `<div class="info-row"><span>B axis</span><span>${bMoves} (final: ${rotary.finalState.b.toFixed(1)}°)</span></div>`;
        if (cMoves > 0) html += `<div class="info-row"><span>C axis</span><span>${cMoves} (final: ${rotary.finalState.c.toFixed(1)}°)</span></div>`;
        html += '</div>';
      }

      // Thermal simulation (3DP)
      const thermal = simulateThermal(gcodeLines);
      if (thermal.points.length > 0) {
        html += '<div class="info-section"><h4>Thermal Simulation</h4>';
        html += `<div class="info-row"><span>Max Temp</span><span>${thermal.maxTemp.toFixed(1)} °C</span></div>`;
        html += `<div class="info-row"><span>Min Temp</span><span>${thermal.minTemp.toFixed(1)} °C</span></div>`;
        html += `<div class="info-row"><span>Avg Temp</span><span>${thermal.avgTemp.toFixed(1)} °C</span></div>`;
        if (thermal.hotZones.length > 0) {
          html += `<div class="info-row info-warning"><span>Hot Zones</span><span>${thermal.hotZones.length}</span></div>`;
        }
        html += '</div>';
      }

      // Warp prediction (3DP)
      if (thermal.points.length > 0 && bounds) {
        const warpBounds = {
          minX: bounds.min[0], maxX: bounds.max[0],
          minY: bounds.min[1], maxY: bounds.max[1],
          minZ: bounds.min[2], maxZ: bounds.max[2],
        };
        const warp = predictWarping(thermal, warpBounds, 0.2);
        html += '<div class="info-section"><h4>Warp Prediction</h4>';
        const levelClass = warp.level === 'severe' ? 'info-error' :
                           warp.level === 'high' ? 'info-warning' : '';
        html += `<div class="info-row ${levelClass}"><span>Risk Level</span><span>${warp.level}</span></div>`;
        html += `<div class="info-row"><span>Risk Score</span><span>${(warp.riskScore * 100).toFixed(1)}%</span></div>`;
        for (const rec of warp.recommendations.slice(0, 3)) {
          html += `<div class="info-row"><span>•</span><span>${rec}</span></div>`;
        }
        html += '</div>';
      }

      // Print time graph (3DP)
      if (zLayers.length > 0) {
        const graph = buildPrintTimeGraph(gcodeLines, zLayers.map(l => ({
          layerIndex: l.layerIndex, zHeight: l.zHeight,
          startLine: l.pieceStart, endLine: l.pieceEnd,
        })));
        if (graph.totalTime > 0) {
          html += '<div class="info-section"><h4>Print Time Graph</h4>';
          html += `<div class="info-row"><span>Total Time</span><span>${(graph.totalTime / 60).toFixed(1)} min</span></div>`;
          html += `<div class="info-row"><span>Layers</span><span>${graph.layerTimes.length}</span></div>`;
          if (graph.featureTimes.length > 0) {
            html += '<div class="info-row"><span>Features</span><span></span></div>';
            for (const ft of graph.featureTimes.slice(0, 5)) {
              html += `<div class="info-row"><span>${ft.feature}</span><span>${ft.percentage.toFixed(1)}%</span></div>`;
            }
          }
          html += '</div>';
        }
      }

      // Spindle load (CNC)
      const spindleLoad = estimateSpindleLoad(gcodeLines);
      if (spindleLoad.length > 0) {
        const maxLoad = Math.max(...spindleLoad.map(s => s.load));
        const avgLoadPct = spindleLoad.reduce((a, b) => a + b.loadPercentage, 0) / spindleLoad.length;
        html += '<div class="info-section"><h4>Spindle Load</h4>';
        html += `<div class="info-row"><span>Max Load</span><span>${maxLoad.toFixed(2)} kW</span></div>`;
        html += `<div class="info-row"><span>Avg Load</span><span>${avgLoadPct.toFixed(1)}%</span></div>`;
        html += `<div class="info-row"><span>Cutting Moves</span><span>${spindleLoad.length}</span></div>`;
        html += '</div>';
      }

      // Tool wear (CNC)
      const toolWear = estimateToolWear(gcodeLines);
      if (toolWear.length > 0) {
        html += '<div class="info-section"><h4>Tool Wear</h4>';
        for (const tw of toolWear) {
          const wearClass = tw.wear > 0.6 ? 'info-error' : tw.wear > 0.3 ? 'info-warning' : '';
          html += `<div class="info-row ${wearClass}"><span>Tool ${tw.toolNumber}</span><span>${tw.lifeRemaining.toFixed(1)}% life</span></div>`;
        }
        html += '</div>';
      }

      // Tool definitions (CNC)
      const parsedTools = parseToolDefinitions(gcodeLines);
      if (parsedTools.length > 0) {
        html += '<div class="info-section"><h4>Tool Library</h4>';
        for (const tool of parsedTools) {
          html += `<div class="info-row"><span>T${tool.toolNumber}</span><span>${tool.name} Ø${tool.diameter}mm</span></div>`;
        }
        html += '</div>';
      }

      // Collision detection (CNC)
      if (bounds) {
        const stock = createStockModel('block',
          bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2],
          bounds.min[0], bounds.min[1], bounds.min[2], true);
        const collisions = checkCollisions(gcodeLines, stock);
        if (collisions.length > 0) {
          const errors = collisions.filter(c => c.severity === 'error').length;
          const warnings = collisions.filter(c => c.severity === 'warning').length;
          html += '<div class="info-section"><h4>Collision Check</h4>';
          if (errors > 0) html += `<div class="info-row info-error"><span>Errors</span><span>${errors}</span></div>`;
          if (warnings > 0) html += `<div class="info-row info-warning"><span>Warnings</span><span>${warnings}</span></div>`;
          for (const c of collisions.slice(0, 5)) {
            html += `<div class="info-row"><span>Line ${c.lineNumber + 1}</span><span>${c.description}</span></div>`;
          }
          html += '</div>';
        }
      }

      // ── Batch 4 Advanced Analysis (from GcodeAdvanced4) ──

      // Retraction analysis (3DP)
      const retractionAnalysis = analyzeRetractions(gcodeLines);
      if (retractionAnalysis.count > 0) {
        html += '<div class="info-section"><h4>Retraction Analysis</h4>';
        html += `<div class="info-row"><span>Count</span><span>${retractionAnalysis.count}</span></div>`;
        html += `<div class="info-row"><span>Avg Distance</span><span>${retractionAnalysis.avgDistance.toFixed(2)} mm</span></div>`;
        html += `<div class="info-row"><span>Max Distance</span><span>${retractionAnalysis.maxDistance.toFixed(2)} mm</span></div>`;
        if (retractionAnalysis.zHopCount > 0) html += `<div class="info-row"><span>Z-Hops</span><span>${retractionAnalysis.zHopCount}</span></div>`;
        if (retractionAnalysis.totalRetractionTime > 60) {
          html += `<div class="info-row info-warning"><span>Retract Time</span><span>${(retractionAnalysis.totalRetractionTime / 60).toFixed(1)} min</span></div>`;
        }
        for (const rec of retractionAnalysis.recommendations.slice(0, 2)) {
          html += `<div class="info-row"><span>•</span><span>${rec}</span></div>`;
        }
        html += '</div>';
      }

      // Layer height consistency (3DP)
      if (zLayers.length > 1) {
        const consistency = checkLayerHeightConsistency(zLayers);
        if (consistency.layerHeights.length > 0) {
          html += '<div class="info-section"><h4>Layer Height Consistency</h4>';
          html += `<div class="info-row"><span>Avg Height</span><span>${consistency.avgHeight.toFixed(3)} mm</span></div>`;
          html += `<div class="info-row"><span>Std Dev</span><span>${consistency.stdDev.toFixed(4)} mm</span></div>`;
          const scoreClass = consistency.consistencyScore < 0.8 ? 'info-warning' : '';
          html += `<div class="info-row ${scoreClass}"><span>Consistency</span><span>${(consistency.consistencyScore * 100).toFixed(1)}%</span></div>`;
          if (consistency.isAdaptive) html += `<div class="info-row"><span>Mode</span><span>Adaptive</span></div>`;
          if (consistency.issues.length > 0) {
            html += `<div class="info-row info-warning"><span>Issues</span><span>${consistency.issues.length}</span></div>`;
          }
          html += '</div>';
        }
      }

      // Flow rate calibration (3DP)
      const flowRate = analyzeFlowRate(gcodeLines);
      if (flowRate.segments.length > 0) {
        html += '<div class="info-section"><h4>Flow Rate Calibration</h4>';
        html += `<div class="info-row"><span>Avg Flow</span><span>${flowRate.avgFlowRate.toFixed(4)}</span></div>`;
        html += `<div class="info-row"><span>Std Dev</span><span>${flowRate.flowRateStdDev.toFixed(4)}</span></div>`;
        const flowClass = flowRate.consistency < 0.8 ? 'info-warning' : '';
        html += `<div class="info-row ${flowClass}"><span>Consistency</span><span>${(flowRate.consistency * 100).toFixed(1)}%</span></div>`;
        if (flowRate.outliers.length > 0) {
          html += `<div class="info-row info-warning"><span>Outliers</span><span>${flowRate.outliers.length}</span></div>`;
        }
        if (Math.abs(flowRate.recommendedAdjustment) > 2) {
          html += `<div class="info-row"><span>Adjustment</span><span>${flowRate.recommendedAdjustment.toFixed(1)}%</span></div>`;
        }
        html += '</div>';
      }

      // First layer quality (3DP)
      const firstLayer = analyzeFirstLayer(gcodeLines);
      if (firstLayer.moveCount > 0) {
        html += '<div class="info-section"><h4>First Layer Quality</h4>';
        if (firstLayer.bedTemp > 0) html += `<div class="info-row"><span>Bed Temp</span><span>${firstLayer.bedTemp} °C</span></div>`;
        if (firstLayer.hotendTemp > 0) html += `<div class="info-row"><span>Hotend Temp</span><span>${firstLayer.hotendTemp} °C</span></div>`;
        html += `<div class="info-row"><span>Fan Speed</span><span>${firstLayer.fanSpeed}/255</span></div>`;
        const qualityClass = firstLayer.qualityScore < 0.5 ? 'info-error' : firstLayer.qualityScore < 0.8 ? 'info-warning' : '';
        html += `<div class="info-row ${qualityClass}"><span>Quality Score</span><span>${(firstLayer.qualityScore * 100).toFixed(0)}%</span></div>`;
        for (const rec of firstLayer.recommendations.slice(0, 2)) {
          html += `<div class="info-row"><span>•</span><span>${rec}</span></div>`;
        }
        html += '</div>';
      }

      // Stringing prediction (3DP)
      const stringing = predictStringing(gcodeLines);
      if (stringing.riskPoints.length > 0) {
        html += '<div class="info-section"><h4>Stringing Risk</h4>';
        html += `<div class="info-row"><span>Risk Points</span><span>${stringing.riskPoints.length}</span></div>`;
        if (stringing.highRiskCount > 0) html += `<div class="info-row info-error"><span>High Risk</span><span>${stringing.highRiskCount}</span></div>`;
        const riskClass = stringing.overallRisk > 0.5 ? 'info-warning' : '';
        html += `<div class="info-row ${riskClass}"><span>Overall Risk</span><span>${(stringing.overallRisk * 100).toFixed(0)}%</span></div>`;
        html += '</div>';
      }

      // Cooling fan analysis (3DP)
      const fanAnalysis = analyzeCoolingFan(gcodeLines);
      if (fanAnalysis.events.length > 0) {
        html += '<div class="info-section"><h4>Cooling Fan</h4>';
        html += `<div class="info-row"><span>Speed Changes</span><span>${fanAnalysis.changeCount}</span></div>`;
        html += `<div class="info-row"><span>Max Speed</span><span>${fanAnalysis.maxSpeed}/255</span></div>`;
        html += `<div class="info-row"><span>Avg Speed</span><span>${fanAnalysis.avgSpeed.toFixed(0)}/255</span></div>`;
        if (fanAnalysis.firstLayerSpeed > 0) {
          html += `<div class="info-row info-warning"><span>First Layer</span><span>${fanAnalysis.firstLayerSpeed}/255</span></div>`;
        }
        html += '</div>';
      }

      // Print speed analysis (3DP)
      const speedAnalysis = analyzePrintSpeeds(gcodeLines);
      if (speedAnalysis.features.length > 0) {
        html += '<div class="info-section"><h4>Print Speed Analysis</h4>';
        for (const f of speedAnalysis.features.slice(0, 5)) {
          const speedClass = f.isOptimal ? '' : 'info-warning';
          html += `<div class="info-row ${speedClass}"><span>${f.featureType}</span><span>${f.avgSpeed.toFixed(0)} mm/min (${f.timePercentage.toFixed(1)}%)</span></div>`;
        }
        if (speedAnalysis.suboptimalCount > 0) {
          html += `<div class="info-row info-warning"><span>Suboptimal</span><span>${speedAnalysis.suboptimalCount} features</span></div>`;
        }
        html += '</div>';
      }

      // ── Batch 5 Advanced Analysis (from GcodeAdvanced5) ──

      // G-code linting (Universal)
      const lint = lintGcode(gcodeLines);
      if (lint.issues.length > 0) {
        html += '<div class="info-section"><h4>G-code Linting</h4>';
        const lintClass = lint.errorCount > 0 ? 'info-error' : lint.warningCount > 0 ? 'info-warning' : '';
        html += `<div class="info-row ${lintClass}"><span>Quality Score</span><span>${(lint.qualityScore * 100).toFixed(0)}%</span></div>`;
        if (lint.errorCount > 0) html += `<div class="info-row info-error"><span>Errors</span><span>${lint.errorCount}</span></div>`;
        if (lint.warningCount > 0) html += `<div class="info-row info-warning"><span>Warnings</span><span>${lint.warningCount}</span></div>`;
        if (lint.infoCount > 0) html += `<div class="info-row"><span>Info</span><span>${lint.infoCount}</span></div>`;
        for (const issue of lint.issues.filter(i => i.severity === 'error').slice(0, 3)) {
          html += `<div class="info-row info-error"><span>Line ${issue.lineNumber + 1}</span><span>${issue.message}</span></div>`;
        }
        html += '</div>';
      }

      // Toolpath optimization (Universal)
      const toolpathOpt = analyzeToolpathOptimization(gcodeLines);
      if (toolpathOpt.cuttingDistance > 0 || toolpathOpt.travelDistance > 0) {
        html += '<div class="info-section"><h4>Toolpath Optimization</h4>';
        html += `<div class="info-row"><span>Cutting</span><span>${toolpathOpt.cuttingDistance.toFixed(0)} mm</span></div>`;
        html += `<div class="info-row"><span>Travel</span><span>${toolpathOpt.travelDistance.toFixed(0)} mm</span></div>`;
        const effClass = toolpathOpt.efficiencyScore < 0.5 ? 'info-warning' : '';
        html += `<div class="info-row ${effClass}"><span>Efficiency</span><span>${(toolpathOpt.efficiencyScore * 100).toFixed(0)}%</span></div>`;
        if (toolpathOpt.travelTime > 60) {
          html += `<div class="info-row"><span>Travel Time</span><span>${(toolpathOpt.travelTime / 60).toFixed(1)} min</span></div>`;
        }
        html += '</div>';
      }

      // Filament per layer (3DP)
      if (zLayers.length > 0) {
        const filamentPerLayer = trackFilamentPerLayer(gcodeLines, zLayers.map(l => ({
          layerIndex: l.layerIndex, zHeight: l.zHeight,
          startLine: l.pieceStart, endLine: l.pieceEnd,
        })));
        if (filamentPerLayer.layers.length > 0) {
          html += '<div class="info-section"><h4>Filament Per Layer</h4>';
          html += `<div class="info-row"><span>Total</span><span>${filamentPerLayer.totalLength.toFixed(1)} mm</span></div>`;
          html += `<div class="info-row"><span>Avg/Layer</span><span>${filamentPerLayer.avgPerLayer.toFixed(1)} mm</span></div>`;
          html += `<div class="info-row"><span>Max Layer</span><span>Layer ${filamentPerLayer.maxLayer}</span></div>`;
          html += '</div>';
        }
      }

      // Pressure advance (3DP)
      const pressureAdvance = analyzePressureAdvance(gcodeLines);
      if (pressureAdvance.commandCount > 0 || pressureAdvance.recommendations.length > 0) {
        html += '<div class="info-section"><h4>Pressure Advance</h4>';
        if (pressureAdvance.enabled) {
          html += `<div class="info-row"><span>Enabled</span><span>${pressureAdvance.value.toFixed(4)}s</span></div>`;
        } else {
          html += `<div class="info-row info-warning"><span>Status</span><span>Not configured</span></div>`;
        }
        for (const rec of pressureAdvance.recommendations.slice(0, 2)) {
          html += `<div class="info-row"><span>•</span><span>${rec}</span></div>`;
        }
        html += '</div>';
      }

      // Performance profiling (Universal)
      const profiling = profileGcode(gcodeLines, 500);
      if (profiling.totalTime > 0) {
        html += '<div class="info-section"><h4>Performance Profile</h4>';
        html += `<div class="info-row"><span>Total Time</span><span>${(profiling.totalTime / 60).toFixed(1)} min</span></div>`;
        for (const tbo of profiling.timeByOperation.slice(0, 3)) {
          html += `<div class="info-row"><span>${tbo.operation}</span><span>${tbo.percentage.toFixed(1)}%</span></div>`;
        }
        if (profiling.bottlenecks.length > 0) {
          html += `<div class="info-row info-warning"><span>Bottlenecks</span><span>${profiling.bottlenecks.length}</span></div>`;
        }
        html += '</div>';
      }

      // ── Batch 6 Advanced Analysis (from GcodeAdvanced6) ──

      // Acceleration-limited time (Universal)
      const accelTime = estimateAccelerationLimitedTime(gcodeLines);
      if (accelTime.unlimitedTime > 0) {
        html += '<div class="info-section"><h4>Acceleration-Limited Time</h4>';
        html += `<div class="info-row"><span>Ideal Time</span><span>${(accelTime.unlimitedTime / 60).toFixed(1)} min</span></div>`;
        html += `<div class="info-row"><span>Real Time</span><span>${(accelTime.limitedTime / 60).toFixed(1)} min</span></div>`;
        const overheadClass = accelTime.overheadPercentage > 20 ? 'info-warning' : '';
        html += `<div class="info-row ${overheadClass}"><span>Overhead</span><span>${accelTime.overheadPercentage.toFixed(1)}%</span></div>`;
        html += `<div class="info-row"><span>Direction Changes</span><span>${accelTime.directionChanges}</span></div>`;
        html += '</div>';
      }

      // Energy consumption (Universal)
      const energy = estimateEnergyConsumption(gcodeLines);
      if (energy.totalEnergy > 0) {
        html += '<div class="info-section"><h4>Energy Consumption</h4>';
        html += `<div class="info-row"><span>Total</span><span>${energy.totalEnergy.toFixed(1)} Wh</span></div>`;
        html += `<div class="info-row"><span>Avg Power</span><span>${energy.avgPower.toFixed(0)} W</span></div>`;
        html += `<div class="info-row"><span>Peak Power</span><span>${energy.peakPower.toFixed(0)} W</span></div>`;
        html += `<div class="info-row"><span>Cost</span><span>$${energy.estimatedCost.toFixed(2)}</span></div>`;
        html += '</div>';
      }

      // Work offsets (CNC)
      const workOffsets = analyzeWorkOffsets(gcodeLines);
      if (workOffsets.offsets.length > 0) {
        html += '<div class="info-section"><h4>Work Offsets</h4>';
        html += `<div class="info-row"><span>Active</span><span>${workOffsets.activeOffset ?? 'None'}</span></div>`;
        html += `<div class="info-row"><span>Changes</span><span>${workOffsets.offsetChanges}</span></div>`;
        if (workOffsets.usesMultipleOffsets) {
          html += `<div class="info-row info-warning"><span>Multiple</span><span>${workOffsets.offsets.length} offsets</span></div>`;
        }
        html += '</div>';
      }

      // Pattern recognition (Universal)
      const patterns = recognizePatterns(gcodeLines);
      if (patterns.patterns.length > 0) {
        html += '<div class="info-section"><h4>Pattern Recognition</h4>';
        if (patterns.dominantPattern) {
          html += `<div class="info-row"><span>Dominant</span><span>${patterns.dominantPattern}</span></div>`;
        }
        for (const [type, count] of Object.entries(patterns.counts)) {
          html += `<div class="info-row"><span>${type}</span><span>${count} segments</span></div>`;
        }
        html += '</div>';
      }

      // Milling direction (CNC)
      const millingDir = detectMillingDirection(gcodeLines);
      if (millingDir.segments.length > 0) {
        html += '<div class="info-section"><h4>Milling Direction</h4>';
        html += `<div class="info-row"><span>Climb</span><span>${millingDir.climbCount} moves</span></div>`;
        html += `<div class="info-row"><span>Conventional</span><span>${millingDir.conventionalCount} moves</span></div>`;
        html += `<div class="info-row"><span>Climb %</span><span>${millingDir.climbPercentage.toFixed(1)}%</span></div>`;
        if (millingDir.isMixed) {
          html += `<div class="info-row info-warning"><span>Mixed</span><span>Yes</span></div>`;
        }
        html += '</div>';
      }

      // Tool deflection (CNC)
      const toolDeflection = estimateToolDeflection(gcodeLines);
      if (toolDeflection.segments.length > 0) {
        html += '<div class="info-section"><h4>Tool Deflection</h4>';
        html += `<div class="info-row"><span>Max</span><span>${toolDeflection.maxDeflection.toFixed(4)} mm</span></div>`;
        html += `<div class="info-row"><span>Avg</span><span>${toolDeflection.avgDeflection.toFixed(4)} mm</span></div>`;
        const deflClass = !toolDeflection.isAcceptable ? 'info-warning' : '';
        html += `<div class="info-row ${deflClass}"><span>Acceptable</span><span>${toolDeflection.isAcceptable ? 'Yes' : 'No'}</span></div>`;
        if (toolDeflection.highDeflectionCount > 0) {
          html += `<div class="info-row info-warning"><span>High Risk</span><span>${toolDeflection.highDeflectionCount} segments</span></div>`;
        }
        html += '</div>';
      }

      // ── Batch 7 Advanced Analysis (from GcodeAdvanced7) ──

      // Chatter prediction (CNC)
      const chatter = predictChatter(gcodeLines);
      if (chatter.riskPoints.length > 0) {
        html += '<div class="info-section"><h4>Chatter Risk</h4>';
        html += `<div class="info-row"><span>Risk Points</span><span>${chatter.riskPoints.length}</span></div>`;
        if (chatter.highRiskCount > 0) html += `<div class="info-row info-error"><span>High Risk</span><span>${chatter.highRiskCount}</span></div>`;
        const chatClass = chatter.overallRisk > 0.5 ? 'info-warning' : '';
        html += `<div class="info-row ${chatClass}"><span>Overall Risk</span><span>${(chatter.overallRisk * 100).toFixed(0)}%</span></div>`;
        if (chatter.recommendedSpeeds.length > 0) {
          html += `<div class="info-row"><span>Stable Speeds</span><span>${chatter.recommendedSpeeds.slice(0, 3).join(', ')} RPM</span></div>`;
        }
        html += '</div>';
      }

      // Macro variables (Universal)
      const macros = trackMacroVariables(gcodeLines);
      if (macros.uniqueCount > 0) {
        html += '<div class="info-section"><h4>Macro Variables</h4>';
        html += `<div class="info-row"><span>Variables</span><span>${macros.uniqueCount}</span></div>`;
        html += `<div class="info-row"><span>Assignments</span><span>${macros.totalAssignments}</span></div>`;
        html += `<div class="info-row"><span>Usages</span><span>${macros.usages.length}</span></div>`;
        html += '</div>';
      }

      // Coordinate rotation (Universal)
      const rotation = analyzeCoordinateRotation(gcodeLines);
      if (rotation.hasRotation) {
        html += '<div class="info-section"><h4>Coordinate Rotation</h4>';
        html += `<div class="info-row"><span>Events</span><span>${rotation.eventCount}</span></div>`;
        html += `<div class="info-row"><span>Max Angle</span><span>${rotation.maxAngle.toFixed(1)}°</span></div>`;
        if (!rotation.events.some(e => !e.activated)) {
          html += `<div class="info-row info-warning"><span>Status</span><span>Not cancelled</span></div>`;
        }
        html += '</div>';
      }

      // Tool life estimation (CNC)
      const toolLife = estimateToolLife(gcodeLines);
      if (toolLife.tools.length > 0) {
        html += '<div class="info-section"><h4>Tool Life</h4>';
        for (const tool of toolLife.tools.slice(0, 5)) {
          const toolClass = tool.status === 'replace' ? 'info-error' : tool.status === 'critical' ? 'info-warning' : '';
          html += `<div class="info-row ${toolClass}"><span>T${tool.toolNumber}</span><span>${tool.remainingLife.toFixed(0)}% remaining</span></div>`;
        }
        if (toolLife.toolsToReplace > 0) {
          html += `<div class="info-row info-error"><span>Replace</span><span>${toolLife.toolsToReplace} tools</span></div>`;
        }
        html += '</div>';
      }

      // Cutter compensation verification (CNC)
      const comp = verifyCutterCompensation(gcodeLines);
      if (comp.hasCompensation) {
        html += '<div class="info-section"><h4>Cutter Compensation</h4>';
        html += `<div class="info-row"><span>Direction</span><span>${comp.direction}</span></div>`;
        html += `<div class="info-row"><span>Offset</span><span>D${comp.offsetRegister}</span></div>`;
        const compClass = !comp.isCancelled ? 'info-error' : '';
        html += `<div class="info-row ${compClass}"><span>Cancelled</span><span>${comp.isCancelled ? 'Yes' : 'No'}</span></div>`;
        if (comp.issues.length > 0) {
          html += `<div class="info-row info-warning"><span>Issues</span><span>${comp.issues.length}</span></div>`;
        }
        html += '</div>';
      }

      // Travel path optimization (Universal)
      const travelOpt = suggestTravelOptimization(gcodeLines);
      if (travelOpt.suggestions.length > 0) {
        html += '<div class="info-section"><h4>Travel Optimization</h4>';
        html += `<div class="info-row"><span>Suggestions</span><span>${travelOpt.suggestions.length}</span></div>`;
        const optClass = travelOpt.savingsPercentage > 20 ? 'info-warning' : '';
        html += `<div class="info-row ${optClass}"><span>Savings</span><span>${travelOpt.savingsPercentage.toFixed(1)}%</span></div>`;
        if (travelOpt.timeSavings > 60) {
          html += `<div class="info-row"><span>Time Saved</span><span>${(travelOpt.timeSavings / 60).toFixed(1)} min</span></div>`;
        }
        html += '</div>';
      }

      // ── Batch 8 Advanced Analysis (from GcodeAdvanced8) ──

      // Modal state tracker (Universal)
      const modalStates = trackModalStates(gcodeLines);
      if (modalStates.changes.length > 0 || modalStates.warnings.length > 0) {
        html += '<div class="info-section"><h4>Modal State</h4>';
        html += `<div class="info-row"><span>Changes</span><span>${modalStates.changes.length}</span></div>`;
        const resetClass = !modalStates.isProperlyReset ? 'info-warning' : '';
        html += `<div class="info-row ${resetClass}"><span>Proper Reset</span><span>${modalStates.isProperlyReset ? 'Yes' : 'No'}</span></div>`;
        if (modalStates.warnings.length > 0) {
          html += `<div class="info-row info-warning"><span>Warnings</span><span>${modalStates.warnings.length}</span></div>`;
        }
        html += '</div>';
      }

      // Dwell time analysis (Universal)
      const dwell = analyzeDwellTime(gcodeLines);
      if (dwell.eventCount > 0) {
        html += '<div class="info-section"><h4>Dwell Time</h4>';
        html += `<div class="info-row"><span>Events</span><span>${dwell.eventCount}</span></div>`;
        html += `<div class="info-row"><span>Total</span><span>${dwell.totalDwellTime.toFixed(2)}s</span></div>`;
        if (dwell.maxDwell > 0) {
          html += `<div class="info-row"><span>Max</span><span>${dwell.maxDwell.toFixed(2)}s</span></div>`;
        }
        html += '</div>';
      }

      // 3DP safety check (3DP)
      const safety = check3DPSafety(gcodeLines);
      html += '<div class="info-section"><h4>Safety Check</h4>';
      const scoreClass = safety.safetyScore < 50 ? 'info-error' : safety.safetyScore < 80 ? 'info-warning' : '';
      html += `<div class="info-row ${scoreClass}"><span>Score</span><span>${safety.safetyScore}/100</span></div>`;
      if (safety.criticalCount > 0) {
        html += `<div class="info-row info-error"><span>Critical</span><span>${safety.criticalCount}</span></div>`;
      }
      if (safety.errorCount > 0) {
        html += `<div class="info-row info-error"><span>Errors</span><span>${safety.errorCount}</span></div>`;
      }
      if (safety.warningCount > 0) {
        html += `<div class="info-row info-warning"><span>Warnings</span><span>${safety.warningCount}</span></div>`;
      }
      html += '</div>';

      // Toolpath curvature (Universal)
      const curvature = analyzeCurvature(gcodeLines);
      if (curvature.segments.length > 0) {
        html += '<div class="info-section"><h4>Curvature</h4>';
        html += `<div class="info-row"><span>Segments</span><span>${curvature.segments.length}</span></div>`;
        if (curvature.sharpTurnCount > 0) {
          html += `<div class="info-row info-warning"><span>Sharp Turns</span><span>${curvature.sharpTurnCount}</span></div>`;
        }
        const smoothClass = curvature.smoothnessScore < 50 ? 'info-warning' : '';
        html += `<div class="info-row ${smoothClass}"><span>Smoothness</span><span>${curvature.smoothnessScore.toFixed(0)}/100</span></div>`;
        html += '</div>';
      }

      // Feature recognition (Universal)
      const features = recognizeFeatures(gcodeLines);
      if (features.hasFeatures) {
        html += '<div class="info-section"><h4>Recognized Features</h4>';
        for (const [type, count] of Object.entries(features.counts)) {
          html += `<div class="info-row"><span>${type}</span><span>${count}</span></div>`;
        }
        html += '</div>';
      }

      // Spindle power (CNC)
      const spindlePower = analyzeSpindlePower(gcodeLines);
      if (spindlePower.segments.length > 0) {
        html += '<div class="info-section"><h4>Spindle Power</h4>';
        html += `<div class="info-row"><span>Avg Util</span><span>${spindlePower.avgPowerUtilization.toFixed(0)}%</span></div>`;
        html += `<div class="info-row"><span>Max Util</span><span>${spindlePower.maxPowerUtilization.toFixed(0)}%</span></div>`;
        if (spindlePower.overloadCount > 0) {
          html += `<div class="info-row info-error"><span>Overloads</span><span>${spindlePower.overloadCount}</span></div>`;
        }
        html += '</div>';
      }

      // Multi-part analysis (Universal)
      const multiPart = analyzeMultiPart(gcodeLines);
      if (multiPart.isMultiPart) {
        html += '<div class="info-section"><h4>Multi-Part</h4>';
        html += `<div class="info-row"><span>Parts</span><span>${multiPart.partCount}</span></div>`;
        html += `<div class="info-row"><span>Total Time</span><span>${(multiPart.totalTime / 60).toFixed(1)} min</span></div>`;
        if (multiPart.partSpacing > 0) {
          html += `<div class="info-row"><span>Spacing</span><span>${multiPart.partSpacing.toFixed(1)}mm</span></div>`;
        }
        html += '</div>';
      }

      // Bed adhesion (3DP)
      const adhesion = analyzeBedAdhesion(gcodeLines);
      html += '<div class="info-section"><h4>Bed Adhesion</h4>';
      html += `<div class="info-row"><span>Pattern</span><span>${adhesion.pattern}</span></div>`;
      const adhClass = adhesion.adhesionScore < 50 ? 'info-warning' : '';
      html += `<div class="info-row ${adhClass}"><span>Score</span><span>${adhesion.adhesionScore}/100</span></div>`;
      if (adhesion.coveragePercentage > 0) {
        html += `<div class="info-row"><span>Coverage</span><span>${adhesion.coveragePercentage.toFixed(1)}%</span></div>`;
      }
      html += '</div>';

      // Cycle time optimization (Universal)
      const cycleOpt = optimizeCycleTime(gcodeLines, {
        maxFeedRate: 6000, minQualityFeedRate: 1800,
        maxAcceleration: 3000, optimizeTravels: true,
        reduceDwells: true, maxDwellTime: 1, qualityPriority: 0.3,
      });
      if (cycleOpt.suggestions.length > 0) {
        html += '<div class="info-section"><h4>Cycle Time Optimization</h4>';
        html += `<div class="info-row"><span>Suggestions</span><span>${cycleOpt.suggestions.length}</span></div>`;
        if (cycleOpt.totalTimeSavings > 0) {
          html += `<div class="info-row"><span>Time Savings</span><span>${cycleOpt.totalTimeSavings.toFixed(1)}s</span></div>`;
        }
        if (cycleOpt.savingsPercentage > 0) {
          html += `<div class="info-row"><span>Savings</span><span>${cycleOpt.savingsPercentage.toFixed(1)}%</span></div>`;
        }
        html += '</div>';
      }

      // G-code compatibility (Universal)
      const compat = checkGcodeCompatibility(gcodeLines, 'fanuc');
      if (compat.issues.length > 0 || compat.compatibilityScore < 100) {
        html += '<div class="info-section"><h4>Compatibility (Fanuc)</h4>';
        const compatClass = compat.compatibilityScore < 50 ? 'info-error' : compat.compatibilityScore < 80 ? 'info-warning' : '';
        html += `<div class="info-row ${compatClass}"><span>Score</span><span>${compat.compatibilityScore}/100</span></div>`;
        if (compat.unsupportedFeatures.length > 0) {
          html += `<div class="info-row info-warning"><span>Unsupported</span><span>${compat.unsupportedFeatures.join(', ')}</span></div>`;
        }
        html += '</div>';
      }

      // ── Batch 9 Advanced Analysis (from GcodeAdvanced9) ──

      // Self-intersection detection (Universal)
      const selfInt = detectSelfIntersections(gcodeLines);
      if (selfInt.count > 0) {
        html += '<div class="info-section"><h4>Self-Intersection</h4>';
        const intClass = selfInt.hasCuttingIntersections ? 'info-error' : 'info-warning';
        html += `<div class="info-row ${intClass}"><span>Count</span><span>${selfInt.count}</span></div>`;
        if (selfInt.hasCuttingIntersections) {
          html += `<div class="info-row info-error"><span>Cutting</span><span>Yes</span></div>`;
        }
        if (selfInt.hasRapidIntersections) {
          html += `<div class="info-row info-warning"><span>Rapid</span><span>Yes</span></div>`;
        }
        html += '</div>';
      }

      // Command frequency (Universal)
      const cmdFreq = analyzeCommandFrequency(gcodeLines);
      if (cmdFreq.totalCommands > 0) {
        html += '<div class="info-section"><h4>Command Frequency</h4>';
        html += `<div class="info-row"><span>Total</span><span>${cmdFreq.totalCommands}</span></div>`;
        html += `<div class="info-row"><span>Unique</span><span>${cmdFreq.uniqueCommands}</span></div>`;
        html += `<div class="info-row"><span>Most Common</span><span>${cmdFreq.mostCommon}</span></div>`;
        // Show top 3
        const top3 = cmdFreq.frequencies.slice(0, 3);
        for (const f of top3) {
          html += `<div class="info-row"><span>${f.command}</span><span>${f.count} (${f.percentage.toFixed(1)}%)</span></div>`;
        }
        html += '</div>';
      }

      // Tool change optimization (CNC)
      const toolOpt = optimizeToolChanges(gcodeLines);
      if (toolOpt.currentChanges > 0 || toolOpt.toolUsage.length > 0) {
        html += '<div class="info-section"><h4>Tool Changes</h4>';
        html += `<div class="info-row"><span>Current</span><span>${toolOpt.currentChanges}</span></div>`;
        html += `<div class="info-row"><span>Optimized</span><span>${toolOpt.optimizedChanges}</span></div>`;
        if (toolOpt.changeSavings > 0) {
          html += `<div class="info-row info-warning"><span>Savings</span><span>${toolOpt.changeSavings}</span></div>`;
        }
        if (toolOpt.toolChangeTime > 0) {
          html += `<div class="info-row"><span>Change Time</span><span>${(toolOpt.toolChangeTime / 60).toFixed(1)} min</span></div>`;
        }
        html += '</div>';
      }

      // Layer time analysis (3DP)
      const layerTimes9 = analyzeLayerTimes(gcodeLines);
      if (layerTimes9.layers.length > 0) {
        html += '<div class="info-section"><h4>Layer Times</h4>';
        html += `<div class="info-row"><span>Layers</span><span>${layerTimes9.layers.length}</span></div>`;
        html += `<div class="info-row"><span>Avg Time</span><span>${layerTimes9.avgLayerTime.toFixed(1)}s</span></div>`;
        if (layerTimes9.fastLayerCount > 0) {
          html += `<div class="info-row info-warning"><span>Fast Layers</span><span>${layerTimes9.fastLayerCount}</span></div>`;
        }
        if (layerTimes9.slowLayerCount > 0) {
          html += `<div class="info-row info-warning"><span>Slow Layers</span><span>${layerTimes9.slowLayerCount}</span></div>`;
        }
        html += '</div>';
      }

      // Comment extraction (Universal)
      const comments = extractComments(gcodeLines);
      if (comments.count > 0) {
        html += '<div class="info-section"><h4>Comments</h4>';
        html += `<div class="info-row"><span>Count</span><span>${comments.count}</span></div>`;
        const metaKeys = Object.keys(comments.parsedMetadata);
        if (metaKeys.length > 0) {
          html += `<div class="info-row"><span>Metadata</span><span>${metaKeys.length} keys</span></div>`;
        }
        html += '</div>';
      }

      // Toolpath length (Universal)
      const length = analyzeToolpathLength(gcodeLines);
      if (length.totalDistance > 0) {
        html += '<div class="info-section"><h4>Path Length</h4>';
        html += `<div class="info-row"><span>Cutting</span><span>${length.cuttingDistance.toFixed(1)}mm (${length.cuttingPercentage.toFixed(1)}%)</span></div>`;
        html += `<div class="info-row"><span>Travel</span><span>${length.travelDistance.toFixed(1)}mm (${length.travelPercentage.toFixed(1)}%)</span></div>`;
        if (length.arcDistance > 0) {
          html += `<div class="info-row"><span>Arc</span><span>${length.arcDistance.toFixed(1)}mm</span></div>`;
        }
        html += `<div class="info-row"><span>Efficiency</span><span>${length.efficiencyRatio.toFixed(2)}</span></div>`;
        html += '</div>';
      }

      // M-code analysis (Universal)
      const mCodes = analyzeMCodes(gcodeLines);
      if (mCodes.codes.length > 0) {
        html += '<div class="info-section"><h4>M-Codes</h4>';
        html += `<div class="info-row"><span>Total</span><span>${mCodes.totalCount}</span></div>`;
        html += `<div class="info-row"><span>Unique</span><span>${mCodes.uniqueCount}</span></div>`;
        if (mCodes.nonStandardCount > 0) {
          html += `<div class="info-row info-warning"><span>Non-Standard</span><span>${mCodes.nonStandardCount}</span></div>`;
        }
        // Show top 3
        const top3m = mCodes.codes.slice(0, 3);
        for (const m of top3m) {
          html += `<div class="info-row"><span>${m.code}</span><span>${m.count}</span></div>`;
        }
        html += '</div>';
      }

      // Spindle warmup (CNC)
      const warmup = analyzeSpindleWarmup(gcodeLines);
      if (warmup.hasWarmup || warmup.recommendations.length > 0) {
        html += '<div class="info-section"><h4>Spindle Warmup</h4>';
        const warmClass = !warmup.hasWarmup ? 'info-warning' : '';
        html += `<div class="info-row ${warmClass}"><span>Present</span><span>${warmup.hasWarmup ? 'Yes' : 'No'}</span></div>`;
        if (warmup.hasWarmup) {
          html += `<div class="info-row"><span>Duration</span><span>${warmup.duration.toFixed(0)}s</span></div>`;
          html += `<div class="info-row"><span>Progressive</span><span>${warmup.isProgressive ? 'Yes' : 'No'}</span></div>`;
          html += `<div class="info-row"><span>Steps</span><span>${warmup.speedSteps}</span></div>`;
        }
        html += '</div>';
      }

      // Feed rate histogram (Universal)
      const histogram = generateFeedRateHistogram(gcodeLines);
      if (histogram.totalMoves > 0) {
        html += '<div class="info-section"><h4>Feed Rate Distribution</h4>';
        html += `<div class="info-row"><span>Min</span><span>${histogram.minFeedRate.toFixed(0)} mm/min</span></div>`;
        html += `<div class="info-row"><span>Max</span><span>${histogram.maxFeedRate.toFixed(0)} mm/min</span></div>`;
        html += `<div class="info-row"><span>Avg</span><span>${histogram.avgFeedRate.toFixed(0)} mm/min</span></div>`;
        html += `<div class="info-row"><span>Median</span><span>${histogram.medianFeedRate.toFixed(0)} mm/min</span></div>`;
        html += `<div class="info-row"><span>Common</span><span>${histogram.mostCommonRange} mm/min</span></div>`;
        html += '</div>';
      }

      // Toolpath direction (Universal)
      const direction = analyzeToolpathDirection(gcodeLines);
      if (direction.xDistance + direction.yDistance + direction.diagonalDistance > 0) {
        html += '<div class="info-section"><h4>Direction</h4>';
        html += `<div class="info-row"><span>Predominant</span><span>${direction.predominantDirection}</span></div>`;
        html += `<div class="info-row"><span>X</span><span>${direction.xPercentage.toFixed(1)}%</span></div>`;
        html += `<div class="info-row"><span>Y</span><span>${direction.yPercentage.toFixed(1)}%</span></div>`;
        html += `<div class="info-row"><span>Diagonal</span><span>${direction.diagonalPercentage.toFixed(1)}%</span></div>`;
        html += `<div class="info-row"><span>Dir Changes</span><span>${direction.directionChanges}</span></div>`;
        html += '</div>';
      }

      // Parse errors (Universal)
      const parseErrors = parseWithRecovery(gcodeLines);
      if (parseErrors.errorCount > 0) {
        html += '<div class="info-section"><h4>Parse Errors</h4>';
        const errClass = parseErrors.errorCount > 10 ? 'info-error' : 'info-warning';
        html += `<div class="info-row ${errClass}"><span>Errors</span><span>${parseErrors.errorCount}</span></div>`;
        html += `<div class="info-row"><span>Lines</span><span>${parseErrors.linesWithErrors}</span></div>`;
        html += `<div class="info-row"><span>Recovered</span><span>${parseErrors.recoveredCount}</span></div>`;
        html += '</div>';
      }

      // ── Batch 10 Advanced Analysis (from GcodeAdvanced10) ──

      // Z-hop analysis (3DP)
      const zHops = analyzeZHops(gcodeLines);
      html += '<div class="info-section"><h4>Z-Hop</h4>';
      html += `<div class="info-row"><span>Used</span><span>${zHops.hasZHop ? 'Yes' : 'No'}</span></div>`;
      if (zHops.count > 0) {
        html += `<div class="info-row"><span>Count</span><span>${zHops.count}</span></div>`;
        html += `<div class="info-row"><span>Avg Height</span><span>${zHops.avgHopHeight.toFixed(2)}mm</span></div>`;
        html += `<div class="info-row"><span>Max Height</span><span>${zHops.maxHopHeight.toFixed(2)}mm</span></div>`;
        html += `<div class="info-row"><span>Percentage</span><span>${zHops.hopPercentage.toFixed(1)}%</span></div>`;
      }
      html += '</div>';

      // Extrusion consistency (3DP)
      const extrusionCons = analyzeExtrusionConsistency(gcodeLines);
      if (extrusionCons.layerExtrusion.length > 0) {
        html += '<div class="info-section"><h4>Extrusion Consistency</h4>';
        const consClass = !extrusionCons.isConsistent ? 'info-warning' : '';
        html += `<div class="info-row ${consClass}"><span>CV</span><span>${extrusionCons.coefficientOfVariation.toFixed(1)}%</span></div>`;
        html += `<div class="info-row"><span>Std Dev</span><span>${extrusionCons.stdDeviation.toFixed(2)}</span></div>`;
        if (extrusionCons.inconsistentLayers.length > 0) {
          html += `<div class="info-row info-warning"><span>Inconsistent</span><span>${extrusionCons.inconsistentLayers.length} layers</span></div>`;
        }
        html += '</div>';
      }

      // Toolpath smoothing (Universal)
      const smoothing = analyzeToolpathSmoothing(gcodeLines);
      if (smoothing.jaggedRegionCount > 0 || smoothing.smoothnessScore < 100) {
        html += '<div class="info-section"><h4>Smoothing</h4>';
        const smoothClass = smoothing.smoothnessScore < 50 ? 'info-warning' : '';
        html += `<div class="info-row ${smoothClass}"><span>Score</span><span>${smoothing.smoothnessScore.toFixed(0)}/100</span></div>`;
        if (smoothing.jaggedRegionCount > 0) {
          html += `<div class="info-row info-warning"><span>Jagged Regions</span><span>${smoothing.jaggedRegionCount}</span></div>`;
        }
        if (smoothing.arcFittingCandidates > 0) {
          html += `<div class="info-row"><span>Arc Candidates</span><span>${smoothing.arcFittingCandidates}</span></div>`;
        }
        html += '</div>';
      }

      // Print quality prediction (3DP)
      const quality = predictPrintQuality(gcodeLines);
      html += '<div class="info-section"><h4>Quality Prediction</h4>';
      const qClass = quality.qualityScore < 50 ? 'info-error' : quality.qualityScore < 80 ? 'info-warning' : '';
      html += `<div class="info-row ${qClass}"><span>Score</span><span>${quality.qualityScore}/100 (${quality.grade})</span></div>`;
      if (quality.severityCounts.high > 0) {
        html += `<div class="info-row info-error"><span>High Issues</span><span>${quality.severityCounts.high}</span></div>`;
      }
      if (quality.severityCounts.medium > 0) {
        html += `<div class="info-row info-warning"><span>Medium Issues</span><span>${quality.severityCounts.medium}</span></div>`;
      }
      html += '</div>';

      // Volumetric flow rate (3DP)
      const volFlowRate = analyzeVolumetricFlowRate(gcodeLines);
      if (volFlowRate.segments.length > 0) {
        html += '<div class="info-section"><h4>Flow Rate</h4>';
        html += `<div class="info-row"><span>Avg</span><span>${volFlowRate.avgFlowRate.toFixed(2)} mm³/s</span></div>`;
        html += `<div class="info-row"><span>Max</span><span>${volFlowRate.maxFlowRate.toFixed(2)} mm³/s</span></div>`;
        html += `<div class="info-row"><span>Limit</span><span>${volFlowRate.extruderLimit} mm³/s</span></div>`;
        if (volFlowRate.exceedingSegments > 0) {
          html += `<div class="info-row info-error"><span>Exceeding</span><span>${volFlowRate.exceedingSegments} (${volFlowRate.exceedingPercentage.toFixed(1)}%)</span></div>`;
        }
        html += '</div>';
      }

      // Statistics summary (Universal)
      const stats = generateStatisticsSummary(gcodeLines);
      html += '<div class="info-section"><h4>Statistics</h4>';
      html += `<div class="info-row"><span>Code Lines</span><span>${stats.codeLines}</span></div>`;
      html += `<div class="info-row"><span>Comments</span><span>${stats.commentLines}</span></div>`;
      html += `<div class="info-row"><span>Motion</span><span>${stats.motionCommands}</span></div>`;
      html += `<div class="info-row"><span>Rapid</span><span>${stats.rapidCommands}</span></div>`;
      html += `<div class="info-row"><span>Complexity</span><span>${stats.complexityScore.toFixed(0)}/100</span></div>`;
      html += '</div>';

      // Print efficiency (3DP)
      const efficiency = analyzePrintEfficiency(gcodeLines);
      if (efficiency.materialUsed > 0) {
        html += '<div class="info-section"><h4>Efficiency</h4>';
        const effClass = efficiency.overallScore < 50 ? 'info-warning' : '';
        html += `<div class="info-row ${effClass}"><span>Score</span><span>${efficiency.overallScore.toFixed(0)}/100 (${efficiency.grade})</span></div>`;
        html += `<div class="info-row"><span>Material</span><span>${efficiency.materialUsed.toFixed(1)}mm</span></div>`;
        html += `<div class="info-row"><span>Volume</span><span>${efficiency.materialVolume.toFixed(1)}mm³</span></div>`;
        html += `<div class="info-row"><span>Efficiency</span><span>${efficiency.materialEfficiency.toFixed(2)}mm³/s</span></div>`;
        html += '</div>';
      }

      // Auto-generated annotations (Universal)
      const autoAnnos = autoGenerateAnnotations(gcodeLines);
      if (autoAnnos.count > 0) {
        html += '<div class="info-section"><h4>Auto Annotations</h4>';
        html += `<div class="info-row"><span>Total</span><span>${autoAnnos.count}</span></div>`;
        if (autoAnnos.byCategory.warning > 0) {
          html += `<div class="info-row info-warning"><span>Warnings</span><span>${autoAnnos.byCategory.warning}</span></div>`;
        }
        html += '</div>';
      }

      // ── Batch 11 Advanced Analysis (from GcodeAdvanced11) ──

      // Tool wear progression (CNC)
      const toolWearProg = trackToolWearProgression(gcodeLines);
      if (toolWearProg.perTool.length > 0) {
        html += '<div class="info-section"><h4>Tool Wear</h4>';
        for (const t of toolWearProg.perTool.slice(0, 3)) {
          const wearClass = t.finalWearPercentage > 80 ? 'info-error' : t.finalWearPercentage > 50 ? 'info-warning' : '';
          html += `<div class="info-row ${wearClass}"><span>T${t.tool}</span><span>${t.finalWearPercentage.toFixed(1)}%</span></div>`;
        }
        if (toolWearProg.toolsNeedingReplacement.length > 0) {
          html += `<div class="info-row info-error"><span>Replace</span><span>T${toolWearProg.toolsNeedingReplacement.join(', T')}</span></div>`;
        }
        html += '</div>';
      }

      // Optimization report (Universal)
      const optReport = generateOptimizationReport(gcodeLines);
      if (optReport.suggestions.length > 0) {
        html += '<div class="info-section"><h4>Optimization</h4>';
        html += `<div class="info-row"><span>Suggestions</span><span>${optReport.suggestions.length}</span></div>`;
        if (optReport.totalTimeSavings > 0) {
          html += `<div class="info-row"><span>Time Savings</span><span>${(optReport.totalTimeSavings / 60).toFixed(1)} min</span></div>`;
        }
        const optClass = optReport.optimizationScore > 60 ? 'info-warning' : '';
        html += `<div class="info-row ${optClass}"><span>Score</span><span>${optReport.optimizationScore.toFixed(0)}/100</span></div>`;
        html += '</div>';
      }

      // Bed thermal map (3DP)
      const bedThermal = analyzeBedThermalMap(gcodeLines);
      if (bedThermal.hasBedHeating) {
        html += '<div class="info-section"><h4>Bed Thermal</h4>';
        html += `<div class="info-row"><span>Max Temp</span><span>${bedThermal.maxTemp}°C</span></div>`;
        html += `<div class="info-row"><span>Avg Temp</span><span>${bedThermal.avgTemp.toFixed(1)}°C</span></div>`;
        const stabClass = bedThermal.temperatureStability > 10 ? 'info-warning' : '';
        html += `<div class="info-row ${stabClass}"><span>Stability</span><span>±${bedThermal.temperatureStability.toFixed(1)}°C</span></div>`;
        html += '</div>';
      }

      // Cooling effectiveness (3DP)
      const cooling = analyzeCoolingEffectiveness(gcodeLines);
      if (cooling.segments.length > 0) {
        html += '<div class="info-section"><h4>Cooling</h4>';
        html += `<div class="info-row"><span>Avg Fan</span><span>${cooling.avgFanSpeed.toFixed(0)}/255</span></div>`;
        html += `<div class="info-row"><span>Max Fan</span><span>${cooling.maxFanSpeed}/255</span></div>`;
        const coolClass = cooling.coolingScore < 50 ? 'info-warning' : '';
        html += `<div class="info-row ${coolClass}"><span>Score</span><span>${cooling.coolingScore.toFixed(0)}/100</span></div>`;
        if (cooling.inadequateCoolingCount > 0) {
          html += `<div class="info-row info-warning"><span>Inadequate</span><span>${cooling.inadequateCoolingCount}</span></div>`;
        }
        html += '</div>';
      }

      // Failure prediction (3DP)
      const failure = predictPrintFailure(gcodeLines);
      html += '<div class="info-section"><h4>Failure Risk</h4>';
      const failClass = failure.failureProbability > 50 ? 'info-error' : failure.failureProbability > 25 ? 'info-warning' : '';
      html += `<div class="info-row ${failClass}"><span>Probability</span><span>${failure.failureProbability.toFixed(0)}%</span></div>`;
      html += `<div class="info-row"><span>Likely Success</span><span>${failure.likelyToSucceed ? 'Yes' : 'No'}</span></div>`;
      if (failure.riskCounts.high > 0) {
        html += `<div class="info-row info-error"><span>High Risks</span><span>${failure.riskCounts.high}</span></div>`;
      }
      html += '</div>';

      // Security audit (Universal)
      const security = auditGcodeSecurity(gcodeLines);
      html += '<div class="info-section"><h4>Security Audit</h4>';
      const secClass = security.securityScore < 50 ? 'info-error' : security.securityScore < 80 ? 'info-warning' : '';
      html += `<div class="info-row ${secClass}"><span>Score</span><span>${security.securityScore}/100</span></div>`;
      html += `<div class="info-row"><span>Safe</span><span>${security.isSafe ? 'Yes' : 'No'}</span></div>`;
      if (security.bySeverity.critical > 0) {
        html += `<div class="info-row info-error"><span>Critical</span><span>${security.bySeverity.critical}</span></div>`;
      }
      if (security.bySeverity.high > 0) {
        html += `<div class="info-row info-error"><span>High</span><span>${security.bySeverity.high}</span></div>`;
      }
      html += '</div>';

      // ── Batch 12 Advanced Analysis (from GcodeAdvanced12) ──

      // Reverse engineering (Universal)
      const reverseEng = reverseEngineerGcode(gcodeLines);
      if (reverseEng.hasFeatures) {
        html += '<div class="info-section"><h4>Reverse Engineering</h4>';
        html += `<div class="info-row"><span>Features</span><span>${reverseEng.totalFeatures}</span></div>`;
        html += `<div class="info-row"><span>Avg Confidence</span><span>${reverseEng.avgConfidence.toFixed(0)}%</span></div>`;
        for (const [type, count] of Object.entries(reverseEng.byType).slice(0, 3)) {
          html += `<div class="info-row"><span>${type}</span><span>${count}</span></div>`;
        }
        html += '</div>';
      }

      // Machining strategy (CNC)
      const strategy = analyzeMachiningStrategy(gcodeLines);
      if (strategy.strategies.length > 0) {
        html += '<div class="info-section"><h4>Machining Strategy</h4>';
        html += `<div class="info-row"><span>Operations</span><span>${strategy.strategies.length}</span></div>`;
        if (strategy.hasRoughing) {
          html += `<div class="info-row"><span>Roughing</span><span>Yes</span></div>`;
        }
        if (strategy.hasFinishing) {
          html += `<div class="info-row"><span>Finishing</span><span>Yes</span></div>`;
        }
        if (strategy.totalTime > 0) {
          html += `<div class="info-row"><span>Est. Time</span><span>${(strategy.totalTime / 60).toFixed(1)} min</span></div>`;
        }
        html += '</div>';
      }

      // Bed leveling quality (3DP)
      const bedLeveling = analyzeBedLevelingQuality(gcodeLines);
      html += '<div class="info-section"><h4>Bed Leveling</h4>';
      html += `<div class="info-row"><span>Present</span><span>${bedLeveling.hasLeveling ? 'Yes' : 'No'}</span></div>`;
      if (bedLeveling.hasLeveling) {
        html += `<div class="info-row"><span>Type</span><span>${bedLeveling.levelingType}</span></div>`;
        html += `<div class="info-row"><span>Mesh Points</span><span>${bedLeveling.meshPoints.length}</span></div>`;
        const flatClass = bedLeveling.flatnessScore < 50 ? 'info-warning' : '';
        html += `<div class="info-row ${flatClass}"><span>Flatness</span><span>${bedLeveling.flatnessScore.toFixed(0)}/100</span></div>`;
      }
      html += '</div>';

      // Validation rules (Universal)
      const validation = validateGcodeRules(gcodeLines);
      html += '<div class="info-section"><h4>Validation</h4>';
      const valClass = validation.bySeverity.error > 0 ? 'info-error' : validation.bySeverity.warning > 0 ? 'info-warning' : '';
      html += `<div class="info-row ${valClass}"><span>Score</span><span>${validation.validationScore}/100</span></div>`;
      if (validation.bySeverity.error > 0) {
        html += `<div class="info-row info-error"><span>Errors</span><span>${validation.bySeverity.error}</span></div>`;
      }
      if (validation.bySeverity.warning > 0) {
        html += `<div class="info-row info-warning"><span>Warnings</span><span>${validation.bySeverity.warning}</span></div>`;
      }
      html += `<div class="info-row"><span>Rules</span><span>${validation.rulesChecked}</span></div>`;
      html += '</div>';

      // ── Batch 13 Advanced Analysis (from GcodeAdvanced13) ──

      // Chip thickness (CNC)
      const chipThickness = analyzeChipThickness(gcodeLines);
      if (chipThickness.points.length > 0) {
        html += '<div class="info-section"><h4>Chip Thickness</h4>';
        html += `<div class="info-row"><span>Avg</span><span>${chipThickness.avgChipThickness.toFixed(3)}mm</span></div>`;
        html += `<div class="info-row"><span>Max</span><span>${chipThickness.maxChipThickness.toFixed(3)}mm</span></div>`;
        const ctClass = chipThickness.inRangePercentage < 50 ? 'info-warning' : '';
        html += `<div class="info-row ${ctClass}"><span>In Range</span><span>${chipThickness.inRangePercentage.toFixed(0)}%</span></div>`;
        html += '</div>';
      }

      // Aerodynamics (CNC)
      const aero = analyzeAerodynamics(gcodeLines);
      if (aero.airCuttingTime > 0 || aero.materialCuttingTime > 0) {
        html += '<div class="info-section"><h4>Aerodynamics</h4>';
        html += `<div class="info-row"><span>Air Time</span><span>${(aero.airCuttingTime / 60).toFixed(1)} min</span></div>`;
        html += `<div class="info-row"><span>Cut Time</span><span>${(aero.materialCuttingTime / 60).toFixed(1)} min</span></div>`;
        const aeroClass = aero.airCuttingPercentage > 50 ? 'info-warning' : '';
        html += `<div class="info-row ${aeroClass}"><span>Air %</span><span>${aero.airCuttingPercentage.toFixed(0)}%</span></div>`;
        html += '</div>';
      }

      // Material flow (3DP)
      const matFlow = analyzeMaterialFlow(gcodeLines);
      if (matFlow.segments.length > 0) {
        html += '<div class="info-section"><h4>Material Flow</h4>';
        html += `<div class="info-row"><span>Avg Flow</span><span>${matFlow.avgVolumetricFlow.toFixed(2)}mm³/s</span></div>`;
        html += `<div class="info-row"><span>Max Flow</span><span>${matFlow.maxVolumetricFlow.toFixed(2)}mm³/s</span></div>`;
        const flowClass = matFlow.consistencyScore < 70 ? 'info-warning' : '';
        html += `<div class="info-row ${flowClass}"><span>Consistency</span><span>${matFlow.consistencyScore.toFixed(0)}%</span></div>`;
        html += '</div>';
      }

      // Adaptive speed (3DP)
      const adaptiveSpeed = analyzeAdaptiveSpeed(gcodeLines);
      if (adaptiveSpeed.recommendationCount > 0) {
        html += '<div class="info-section"><h4>Adaptive Speed</h4>';
        html += `<div class="info-row"><span>Opportunities</span><span>${adaptiveSpeed.recommendationCount}</span></div>`;
        html += `<div class="info-row"><span>Score</span><span>${adaptiveSpeed.optimizationScore}/100</span></div>`;
        html += '</div>';
      }

      // ── Batch 14 Advanced Analysis (from GcodeAdvanced14) ──

      // Bounds (Universal)
      const partBounds = computeBounds(gcodeLines);
      if (partBounds.valid) {
        html += '<div class="info-section"><h4>Bounds</h4>';
        html += `<div class="info-row"><span>Size</span><span>${partBounds.dimensions.width.toFixed(1)}×${partBounds.dimensions.depth.toFixed(1)}×${partBounds.dimensions.height.toFixed(1)}</span></div>`;
        html += `<div class="info-row"><span>Center</span><span>(${partBounds.center.x.toFixed(1)}, ${partBounds.center.y.toFixed(1)})</span></div>`;
        html += '</div>';
      }

      // Tool deflection (CNC)
      const deflection = predictToolDeflectionAdvanced(gcodeLines);
      if (deflection.points.length > 0) {
        html += '<div class="info-section"><h4>Tool Deflection</h4>';
        html += `<div class="info-row"><span>Max</span><span>${deflection.maxDeflection.toFixed(4)}mm</span></div>`;
        const deflClass = deflection.deflectionScore < 70 ? 'info-warning' : '';
        html += `<div class="info-row ${deflClass}"><span>Score</span><span>${deflection.deflectionScore.toFixed(0)}/100</span></div>`;
        html += '</div>';
      }

      // Surface roughness (CNC)
      const roughness = predictSurfaceRoughness(gcodeLines);
      if (roughness.points.length > 0) {
        html += '<div class="info-section"><h4>Surface Roughness</h4>';
        html += `<div class="info-row"><span>Avg Ra</span><span>${roughness.avgRa.toFixed(2)}μm</span></div>`;
        html += `<div class="info-row"><span>Max Ra</span><span>${roughness.maxRa.toFixed(2)}μm</span></div>`;
        html += '</div>';
      }

      // Warping simulation (3DP)
      const warping = simulateWarping(gcodeLines);
      if (warping.points.length > 0) {
        html += '<div class="info-section"><h4>Warping Sim</h4>';
        html += `<div class="info-row"><span>Max</span><span>${warping.maxWarping.toFixed(2)}mm</span></div>`;
        const warpClass = warping.warpingScore < 70 ? 'info-warning' : '';
        html += `<div class="info-row ${warpClass}"><span>Score</span><span>${warping.warpingScore.toFixed(0)}/100</span></div>`;
        html += '</div>';
      }

      // Collision detection (Universal)
      const collisions = detectCollisions3D(gcodeLines);
      if (collisions.collisionCount > 0) {
        html += '<div class="info-section"><h4>Collisions</h4>';
        html += `<div class="info-row info-error"><span>Count</span><span>${collisions.collisionCount}</span></div>`;
        html += `<div class="info-row"><span>Safety</span><span>${collisions.safetyScore}/100</span></div>`;
        html += '</div>';
      }

      // Tool life (CNC)
      const toolLifeCalc = calculateToolLife(gcodeLines);
      if (toolLifeCalc.tools.length > 0) {
        html += '<div class="info-section"><h4>Tool Life</h4>';
        for (const t of toolLifeCalc.tools.slice(0, 3)) {
          html += `<div class="info-row"><span>T${t.tool}</span><span>${t.toolLifeMinutes.toFixed(0)} min</span></div>`;
        }
        html += '</div>';
      }

      // Infill pattern (3DP)
      const infill = analyzeInfillPattern(gcodeLines);
      if (infill.hasInfill) {
        html += '<div class="info-section"><h4>Infill</h4>';
        html += `<div class="info-row"><span>Pattern</span><span>${infill.pattern.pattern}</span></div>`;
        html += `<div class="info-row"><span>Density</span><span>${infill.pattern.density.toFixed(0)}%</span></div>`;
        html += '</div>';
      }

      // Retraction optimization (3DP)
      const retraction = optimizeRetractions(gcodeLines);
      if (retraction.retractionCount > 0) {
        html += '<div class="info-section"><h4>Retraction</h4>';
        html += `<div class="info-row"><span>Count</span><span>${retraction.retractionCount}</span></div>`;
        html += `<div class="info-row"><span>Avg Dist</span><span>${retraction.avgRetractionDistance.toFixed(2)}mm</span></div>`;
        const retClass = retraction.optimizationScore < 70 ? 'info-warning' : '';
        html += `<div class="info-row ${retClass}"><span>Score</span><span>${retraction.optimizationScore}/100</span></div>`;
        html += '</div>';
      }

      // ── Batch 15 Advanced Analysis (from GcodeAdvanced15) ──

      // Layer adhesion (3DP)
      const layerAdhesion = analyzeLayerAdhesion(gcodeLines);
      if (layerAdhesion.layers.length > 0) {
        html += '<div class="info-section"><h4>Layer Adhesion</h4>';
        html += `<div class="info-row"><span>Avg</span><span>${layerAdhesion.avgAdhesion.toFixed(0)}%</span></div>`;
        html += `<div class="info-row"><span>Min</span><span>${layerAdhesion.minAdhesion.toFixed(0)}%</span></div>`;
        const adhClass = layerAdhesion.adhesionScore < 70 ? 'info-warning' : '';
        html += `<div class="info-row ${adhClass}"><span>Score</span><span>${layerAdhesion.adhesionScore.toFixed(0)}/100</span></div>`;
        html += '</div>';
      }

      // Overhang map (3DP)
      const overhang = generateOverhangMap(gcodeLines, 5);
      if (overhang.cells.length > 0) {
        html += '<div class="info-section"><h4>Overhang</h4>';
        html += `<div class="info-row"><span>Max Angle</span><span>${overhang.maxOverhangAngle.toFixed(0)}°</span></div>`;
        const ovClass = overhang.supportCellCount > 0 ? 'info-warning' : '';
        html += `<div class="info-row ${ovClass}"><span>Supports</span><span>${overhang.supportCellCount} cells</span></div>`;
        html += '</div>';
      }

      // Toolpath continuity (Universal)
      const continuity = checkToolpathContinuity(gcodeLines);
      if (continuity.issueCount > 0) {
        html += '<div class="info-section"><h4>Continuity</h4>';
        html += `<div class="info-row"><span>Issues</span><span>${continuity.issueCount}</span></div>`;
        const contClass = continuity.continuityScore < 70 ? 'info-warning' : '';
        html += `<div class="info-row ${contClass}"><span>Score</span><span>${continuity.continuityScore}/100</span></div>`;
        html += '</div>';
      }

      // Extrusion width consistency (3DP)
      const extrusionWidth = analyzeExtrusionWidthConsistency(gcodeLines);
      if (extrusionWidth.points.length > 0) {
        html += '<div class="info-section"><h4>Extrusion Width</h4>';
        html += `<div class="info-row"><span>Avg Width</span><span>${extrusionWidth.avgWidth.toFixed(3)}mm</span></div>`;
        const ewClass = extrusionWidth.consistencyScore < 80 ? 'info-warning' : '';
        html += `<div class="info-row ${ewClass}"><span>Consistency</span><span>${extrusionWidth.consistencyScore.toFixed(0)}%</span></div>`;
        html += '</div>';
      }

      // Machine vibration (CNC)
      const vibration = analyzeMachineVibration(gcodeLines);
      if (vibration.points.length > 0) {
        html += '<div class="info-section"><h4>Vibration</h4>';
        html += `<div class="info-row"><span>Max Amp</span><span>${vibration.maxAmplitude.toFixed(4)}mm</span></div>`;
        html += `<div class="info-row"><span>Freq</span><span>${vibration.dominantFrequency.toFixed(0)}Hz</span></div>`;
        html += '</div>';
      }

      // Thermal history (3DP)
      const thermalHistory = trackThermalHistory(gcodeLines);
      if (thermalHistory.points.length > 0) {
        html += '<div class="info-section"><h4>Thermal History</h4>';
        html += `<div class="info-row"><span>Avg Temp</span><span>${thermalHistory.avgCurrentTemp.toFixed(0)}°C</span></div>`;
        const thClass = thermalHistory.uniformityScore < 70 ? 'info-warning' : '';
        html += `<div class="info-row ${thClass}"><span>Uniformity</span><span>${thermalHistory.uniformityScore.toFixed(0)}%</span></div>`;
        html += '</div>';
      }

      // ── Batch 16 Advanced Analysis (from GcodeAdvanced16) ──

      // Chip load (CNC)
      const chipLoad = calculateChipLoad(gcodeLines);
      if (chipLoad.points.length > 0) {
        html += '<div class="info-section"><h4>Chip Load</h4>';
        html += `<div class="info-row"><span>Avg</span><span>${chipLoad.avgChipLoad.toFixed(3)}mm/tooth</span></div>`;
        const clClass = chipLoad.chipLoadScore < 70 ? 'info-warning' : '';
        html += `<div class="info-row ${clClass}"><span>In Range</span><span>${chipLoad.inRangePercentage.toFixed(0)}%</span></div>`;
        html += '</div>';
      }

      // Spool estimator (3DP)
      const spool = estimateSpoolUsage(gcodeLines);
      if (spool.filamentUsedMm > 0) {
        html += '<div class="info-section"><h4>Filament</h4>';
        html += `<div class="info-row"><span>Used</span><span>${spool.filamentUsedM.toFixed(2)}m (${spool.filamentWeightG.toFixed(0)}g)</span></div>`;
        html += `<div class="info-row"><span>Remaining</span><span>${spool.remainingPercentage.toFixed(0)}%</span></div>`;
        html += '</div>';
      }

      // Error recovery (Universal)
      const errorRecovery = suggestErrorRecovery(gcodeLines);
      if (errorRecovery.hasErrors) {
        html += '<div class="info-section"><h4>Error Recovery</h4>';
        html += `<div class="info-row info-error"><span>Errors</span><span>${errorRecovery.count}</span></div>`;
        html += `<div class="info-row"><span>Score</span><span>${errorRecovery.recoveryScore}/100</span></div>`;
        html += '</div>';
      }

      // MRR (CNC)
      const mrr = calculateMRR(gcodeLines);
      if (mrr.points.length > 0) {
        html += '<div class="info-section"><h4>MRR</h4>';
        html += `<div class="info-row"><span>Avg</span><span>${mrr.avgMRR.toFixed(2)}cm³/min</span></div>`;
        html += `<div class="info-row"><span>Max</span><span>${mrr.maxMRR.toFixed(2)}cm³/min</span></div>`;
        html += '</div>';
      }

      // First layer squish (3DP)
      const squish = analyzeFirstLayerSquish(gcodeLines);
      if (squish.points.length > 0) {
        html += '<div class="info-section"><h4>First Layer Squish</h4>';
        html += `<div class="info-row"><span>Avg Ratio</span><span>${squish.avgSquishRatio.toFixed(2)}</span></div>`;
        const sqClass = squish.squishScore < 70 ? 'info-warning' : '';
        html += `<div class="info-row ${sqClass}"><span>Optimal</span><span>${squish.optimalPercentage.toFixed(0)}%</span></div>`;
        html += '</div>';
      }

      // ── Batch 17 Advanced Analysis (from GcodeAdvanced17) ──

      // Idle time (Universal)
      const idleTime = analyzeIdleTime(gcodeLines);
      if (idleTime.totalIdleTime > 0) {
        html += '<div class="info-section"><h4>Idle Time</h4>';
        html += `<div class="info-row"><span>Total</span><span>${idleTime.totalIdleTime.toFixed(1)}s</span></div>`;
        const idleClass = idleTime.idlePercentage > 50 ? 'info-warning' : '';
        html += `<div class="info-row ${idleClass}"><span>Idle %</span><span>${idleTime.idlePercentage.toFixed(0)}%</span></div>`;
        html += '</div>';
      }

      // Parameter validation (CNC)
      const paramValidation = validateCuttingParameters(gcodeLines);
      if (paramValidation.count > 0) {
        html += '<div class="info-section"><h4>Param Validation</h4>';
        html += `<div class="info-row info-error"><span>Violations</span><span>${paramValidation.count}</span></div>`;
        html += `<div class="info-row"><span>Score</span><span>${paramValidation.validationScore}/100</span></div>`;
        html += '</div>';
      }

      // Layer shift risk (3DP)
      const shiftRisk = detectLayerShiftRisk(gcodeLines);
      if (shiftRisk.layers.length > 0) {
        html += '<div class="info-section"><h4>Shift Risk</h4>';
        const riskClass = shiftRisk.overallRisk === 'high' ? 'info-error' : shiftRisk.overallRisk === 'medium' ? 'info-warning' : '';
        html += `<div class="info-row ${riskClass}"><span>Risk</span><span>${shiftRisk.overallRisk}</span></div>`;
        html += `<div class="info-row"><span>High Risk</span><span>${shiftRisk.highRiskCount} layers</span></div>`;
        html += '</div>';
      }

      // Elephant foot (3DP)
      const elephantFoot = analyzeElephantFoot(gcodeLines);
      if (elephantFoot.firstLayerZ > 0) {
        html += '<div class="info-section"><h4>Elephant Foot</h4>';
        html += `<div class="info-row"><span>Squish</span><span>${elephantFoot.squishRatio.toFixed(2)}</span></div>`;
        const efClass = elephantFoot.severity === 'severe' ? 'info-error' : elephantFoot.severity === 'moderate' ? 'info-warning' : '';
        html += `<div class="info-row ${efClass}"><span>Severity</span><span>${elephantFoot.severity}</span></div>`;
        html += '</div>';
      }

      // Comment density (Universal)
      const commentDensity = analyzeCommentDensity(gcodeLines);
      html += '<div class="info-section"><h4>Documentation</h4>';
      html += `<div class="info-row"><span>Comments</span><span>${commentDensity.densityPercentage.toFixed(0)}%</span></div>`;
      html += `<div class="info-row"><span>Score</span><span>${commentDensity.documentationScore.toFixed(0)}/100</span></div>`;
      html += '</div>';

      // Skirt/brim (3DP)
      const skirtBrim = analyzeSkirtBrim(gcodeLines);
      if (skirtBrim.detected) {
        html += '<div class="info-section"><h4>Skirt/Brim</h4>';
        html += `<div class="info-row"><span>Type</span><span>${skirtBrim.data.type}</span></div>`;
        html += `<div class="info-row"><span>Lines</span><span>${skirtBrim.data.lineCount}</span></div>`;
        html += '</div>';
      }

      // ── Batch 18 Advanced Analysis (from GcodeAdvanced18) ──

      // Per-tool path length (CNC)
      const perTool = analyzePerToolPathLength(gcodeLines);
      if (perTool.toolCount > 0) {
        html += '<div class="info-section"><h4>Per-Tool Paths</h4>';
        html += `<div class="info-row"><span>Tools</span><span>${perTool.toolCount}</span></div>`;
        if (perTool.busiestTool) {
          html += `<div class="info-row"><span>Busiest</span><span>T${perTool.busiestTool.tool}</span></div>`;
        }
        html += '</div>';
      }

      // Ooze prevention (3DP)
      const ooze = analyzeOozePrevention(gcodeLines);
      if (ooze.retractionCount > 0 || ooze.riskLevel === 'high') {
        html += '<div class="info-section"><h4>Ooze Prevention</h4>';
        html += `<div class="info-row"><span>Retractions</span><span>${ooze.retractionCount}</span></div>`;
        const oozeClass = ooze.riskLevel === 'high' ? 'info-error' : ooze.riskLevel === 'medium' ? 'info-warning' : '';
        html += `<div class="info-row ${oozeClass}"><span>Risk</span><span>${ooze.riskLevel}</span></div>`;
        html += '</div>';
      }

      // Spindle variation (CNC)
      const spindleVar = analyzeSpindleSpeedVariation(gcodeLines);
      if (spindleVar.changeCount > 0) {
        html += '<div class="info-section"><h4>Spindle Variation</h4>';
        html += `<div class="info-row"><span>Changes</span><span>${spindleVar.changeCount}</span></div>`;
        html += `<div class="info-row"><span>Consistency</span><span>${spindleVar.consistencyScore.toFixed(0)}%</span></div>`;
        html += '</div>';
      }

      // Modal groups (Universal)
      const modal = analyzeModalGroups(gcodeLines);
      html += '<div class="info-section"><h4>Modal Groups</h4>';
      html += `<div class="info-row"><span>Changes</span><span>${modal.totalChanges}</span></div>`;
      html += `<div class="info-row"><span>Redundant</span><span>${modal.redundantCommands}</span></div>`;
      html += '</div>';

      // Fan curve (3DP)
      const fanCurve = analyzeFanCurve(gcodeLines);
      if (fanCurve.points.length > 0) {
        html += '<div class="info-section"><h4>Fan Curve</h4>';
        html += `<div class="info-row"><span>Changes</span><span>${fanCurve.changeCount}</span></div>`;
        html += `<div class="info-row"><span>Avg Speed</span><span>${fanCurve.avgFanSpeed.toFixed(0)}/255</span></div>`;
        html += '</div>';
      }

      // Direction reversals (CNC)
      const reversals = countDirectionReversals(gcodeLines);
      if (reversals.reversalCount > 0) {
        html += '<div class="info-section"><h4>Reversals</h4>';
        html += `<div class="info-row"><span>Count</span><span>${reversals.reversalCount}</span></div>`;
        html += `<div class="info-row"><span>Smoothness</span><span>${reversals.smoothnessScore.toFixed(0)}%</span></div>`;
        html += '</div>';
      }

      // Execution risk (Universal)
      const risk = assessExecutionRisk(gcodeLines);
      html += '<div class="info-section"><h4>Execution Risk</h4>';
      const riskClass = risk.riskLevel === 'high' ? 'info-error' : risk.riskLevel === 'medium' ? 'info-warning' : '';
      html += `<div class="info-row ${riskClass}"><span>Level</span><span>${risk.riskLevel}</span></div>`;
      html += `<div class="info-row"><span>Score</span><span>${risk.overallRiskScore}/100</span></div>`;
      html += '</div>';

      // ── Batch 19 Advanced Analysis (from GcodeAdvanced19) ──

      // Arc length (Universal)
      const arcs = calculateArcLength(gcodeLines);
      if (arcs.arcCount > 0) {
        html += '<div class="info-section"><h4>Arcs</h4>';
        html += `<div class="info-row"><span>Count</span><span>${arcs.arcCount}</span></div>`;
        html += `<div class="info-row"><span>Total Length</span><span>${arcs.totalArcLength.toFixed(1)}mm</span></div>`;
        html += '</div>';
      }

      // Entry/exit angles (CNC)
      const entryExit = analyzeEntryExitAngles(gcodeLines);
      if (entryExit.count > 0) {
        html += '<div class="info-section"><h4>Entry/Exit</h4>';
        html += `<div class="info-row"><span>Avg Angle</span><span>${entryExit.avgEntryAngle.toFixed(0)}°</span></div>`;
        const eeClass = entryExit.highSeverityCount > 0 ? 'info-warning' : '';
        html += `<div class="info-row ${eeClass}"><span>Plunges</span><span>${entryExit.plungeCount}</span></div>`;
        html += '</div>';
      }

      // Retraction optimizer (3DP)
      const retractionOpt = optimizeRetractionDistance(gcodeLines);
      if (retractionOpt.retractionCount > 0) {
        html += '<div class="info-section"><h4>Retraction Opt</h4>';
        html += `<div class="info-row"><span>Current</span><span>${retractionOpt.currentAvgDistance.toFixed(2)}mm</span></div>`;
        html += `<div class="info-row"><span>Recommended</span><span>${retractionOpt.optimization.recommendedDistance.toFixed(2)}mm</span></div>`;
        html += '</div>';
      }

      // Feed per revolution (CNC)
      const feedPerRev = calculateFeedPerRevolution(gcodeLines);
      if (feedPerRev.points.length > 0) {
        html += '<div class="info-section"><h4>Feed/Rev</h4>';
        html += `<div class="info-row"><span>Avg</span><span>${feedPerRev.avgFeedPerRev.toFixed(3)}mm/rev</span></div>`;
        html += `<div class="info-row"><span>In Range</span><span>${feedPerRev.inRangePercentage.toFixed(0)}%</span></div>`;
        html += '</div>';
      }

      // Thin walls (3DP)
      const thinWalls = analyzeThinWalls(gcodeLines);
      if (thinWalls.wallCount > 0) {
        html += '<div class="info-section"><h4>Thin Walls</h4>';
        html += `<div class="info-row"><span>Count</span><span>${thinWalls.wallCount}</span></div>`;
        const twClass = thinWalls.thinWallCount > 0 ? 'info-warning' : '';
        html += `<div class="info-row ${twClass}"><span>Thin</span><span>${thinWalls.thinWallCount}</span></div>`;
        html += '</div>';
      }

      // Segment classifier (CNC)
      const segments = classifyToolpathSegments(gcodeLines);
      if (segments.totalSegments > 0) {
        html += '<div class="info-section"><h4>Segments</h4>';
        html += `<div class="info-row"><span>Dominant</span><span>${segments.dominantType}</span></div>`;
        html += `<div class="info-row"><span>Types</span><span>${segments.totalSegments}</span></div>`;
        html += '</div>';
      }

      // Error patterns (Universal)
      const errorPatterns = detectErrorPatterns(gcodeLines);
      if (errorPatterns.patternCount > 0) {
        html += '<div class="info-section"><h4>Error Patterns</h4>';
        html += `<div class="info-row info-error"><span>Patterns</span><span>${errorPatterns.patternCount}</span></div>`;
        html += `<div class="info-row"><span>Score</span><span>${errorPatterns.errorFreeScore}/100</span></div>`;
        html += '</div>';
      }

      // Surface speed (CNC)
      const surfaceSpeed = calculateSurfaceSpeed(gcodeLines);
      if (surfaceSpeed.points.length > 0) {
        html += '<div class="info-section"><h4>Surface Speed</h4>';
        html += `<div class="info-row"><span>Avg</span><span>${surfaceSpeed.avgSurfaceSpeed.toFixed(0)}m/min</span></div>`;
        html += `<div class="info-row"><span>In Range</span><span>${surfaceSpeed.inRangePercentage.toFixed(0)}%</span></div>`;
        html += '</div>';
      }

      // Layer time variance (3DP)
      const layerTimeVar = analyzeLayerTimeVariance(gcodeLines);
      if (layerTimeVar.layerCount > 0) {
        html += '<div class="info-section"><h4>Layer Time Var</h4>';
        html += `<div class="info-row"><span>Avg Time</span><span>${layerTimeVar.avgLayerTime.toFixed(1)}s</span></div>`;
        html += `<div class="info-row"><span>Consistency</span><span>${layerTimeVar.consistencyScore.toFixed(0)}%</span></div>`;
        html += '</div>';
      }

      // ── Batch 20 Advanced Analysis (from GcodeAdvanced20) ──

      // Speed heatmap (Universal)
      const speedHeatmap = generateSpeedHeatmap(gcodeLines);
      if (speedHeatmap.points.length > 0) {
        html += '<div class="info-section"><h4>Speed Heatmap</h4>';
        html += `<div class="info-row"><span>Avg Speed</span><span>${speedHeatmap.avgSpeed.toFixed(0)}mm/min</span></div>`;
        html += `<div class="info-row"><span>Range</span><span>${speedHeatmap.speedRange.min.toFixed(0)}-${speedHeatmap.speedRange.max.toFixed(0)}</span></div>`;
        html += '</div>';
      }

      // Tool wear progression (CNC)
      const wearProgression = predictToolWearProgression(gcodeLines);
      if (wearProgression.points.length > 0) {
        html += '<div class="info-section"><h4>Wear Progression</h4>';
        html += `<div class="info-row"><span>Final Wear</span><span>${wearProgression.finalWearPercentage.toFixed(0)}%</span></div>`;
        const wearClass = wearProgression.wearRiskScore > 70 ? 'info-warning' : '';
        html += `<div class="info-row ${wearClass}"><span>Stage</span><span>${wearProgression.currentStage}</span></div>`;
        html += '</div>';
      }

      // Retraction speed (3DP)
      const retractionSpeed = optimizeRetractionSpeed(gcodeLines);
      if (retractionSpeed.currentSpeed > 0) {
        html += '<div class="info-section"><h4>Retraction Speed</h4>';
        html += `<div class="info-row"><span>Current</span><span>${retractionSpeed.currentSpeed.toFixed(0)}mm/s</span></div>`;
        html += `<div class="info-row"><span>Recommended</span><span>${retractionSpeed.recommendedSpeed}mm/s</span></div>`;
        html += '</div>';
      }

      // Depth of cut optimizer (CNC)
      const docOpt = optimizeDepthOfCut(gcodeLines);
      if (docOpt.points.length > 0) {
        html += '<div class="info-section"><h4>DOC Optimizer</h4>';
        html += `<div class="info-row"><span>Max DOC</span><span>${docOpt.currentMaxDOC.toFixed(1)}mm</span></div>`;
        html += `<div class="info-row"><span>Recommended</span><span>${docOpt.recommendedMaxDOC.toFixed(1)}mm</span></div>`;
        html += '</div>';
      }

      // Toolpath efficiency (CNC)
      const tpEfficiency = calculateToolpathEfficiency(gcodeLines);
      if (tpEfficiency.metrics.totalDistance > 0) {
        html += '<div class="info-section"><h4>Efficiency</h4>';
        html += `<div class="info-row"><span>Score</span><span>${tpEfficiency.efficiencyScore}/100</span></div>`;
        html += `<div class="info-row"><span>Cutting</span><span>${(tpEfficiency.metrics.cuttingRatio * 100).toFixed(0)}%</span></div>`;
        html += '</div>';
      }

      // Command redundancy (Universal)
      const redundancy = removeCommandRedundancy(gcodeLines);
      if (redundancy.count > 0) {
        html += '<div class="info-section"><h4>Redundancy</h4>';
        html += `<div class="info-row"><span>Redundant</span><span>${redundancy.count}</span></div>`;
        html += `<div class="info-row"><span>Cleanup</span><span>${redundancy.cleanupScore.toFixed(0)}/100</span></div>`;
        html += '</div>';
      }

      // Cutting strategy (CNC)
      const cutStrategy = adviseCuttingStrategy(gcodeLines);
      if (cutStrategy.advice.confidence > 0) {
        html += '<div class="info-section"><h4>Cutting Strategy</h4>';
        html += `<div class="info-row"><span>Strategy</span><span>${cutStrategy.advice.strategy}</span></div>`;
        html += `<div class="info-row"><span>Climb %</span><span>${cutStrategy.climbPercentage.toFixed(0)}%</span></div>`;
        html += '</div>';
      }

      // Ironing (3DP)
      const ironing = analyzeIroningPattern(gcodeLines);
      if (ironing.detected) {
        html += '<div class="info-section"><h4>Ironing</h4>';
        html += `<div class="info-row"><span>Layers</span><span>${ironing.ironedLayerCount}</span></div>`;
        html += `<div class="info-row"><span>Distance</span><span>${ironing.totalDistance.toFixed(0)}mm</span></div>`;
        html += '</div>';
      }

      // ── Batch 21 Advanced Analysis (from GcodeAdvanced21) ──

      // Per-layer bounds (Universal)
      const layerBounds = calculatePerLayerBounds(gcodeLines);
      if (layerBounds.layerCount > 0) {
        html += '<div class="info-section"><h4>Layer Bounds</h4>';
        html += `<div class="info-row"><span>Layers</span><span>${layerBounds.layerCount}</span></div>`;
        html += `<div class="info-row"><span>Footprint</span><span>${layerBounds.overallFootprintArea.toFixed(0)}mm²</span></div>`;
        html += '</div>';
      }

      // Engagement time (CNC)
      const engagement = calculateEngagementTime(gcodeLines);
      if (engagement.totalTime > 0) {
        html += '<div class="info-section"><h4>Engagement</h4>';
        html += `<div class="info-row"><span>Score</span><span>${engagement.engagementScore}/100</span></div>`;
        html += `<div class="info-row"><span>Ratio</span><span>${(engagement.engagementRatio * 100).toFixed(0)}%</span></div>`;
        html += '</div>';
      }

      // Retraction frequency (3DP)
      const retractionFreq = analyzeRetractionFrequency(gcodeLines);
      if (retractionFreq.retractionCount > 0) {
        html += '<div class="info-section"><h4>Retraction Freq</h4>';
        html += `<div class="info-row"><span>Count</span><span>${retractionFreq.retractionCount}</span></div>`;
        html += `<div class="info-row"><span>Per 100 lines</span><span>${retractionFreq.retractionsPer100Lines.toFixed(1)}</span></div>`;
        html += '</div>';
      }

      // Direction changes (CNC)
      const dirChanges = countDirectionChanges(gcodeLines);
      if (dirChanges.totalChanges > 0) {
        html += '<div class="info-section"><h4>Direction Changes</h4>';
        html += `<div class="info-row"><span>Total</span><span>${dirChanges.totalChanges}</span></div>`;
        const dcClass = dirChanges.sharpChanges > 10 ? 'info-warning' : '';
        html += `<div class="info-row ${dcClass}"><span>Sharp</span><span>${dirChanges.sharpChanges}</span></div>`;
        html += '</div>';
      }

      // Bed adhesion (3DP)
      const bedAdhesion = calculateBedAdhesionArea(gcodeLines);
      if (bedAdhesion.totalAdhesionArea > 0) {
        html += '<div class="info-section"><h4>Bed Adhesion</h4>';
        html += `<div class="info-row"><span>Area</span><span>${bedAdhesion.totalAdhesionArea.toFixed(0)}mm²</span></div>`;
        const baClass = bedAdhesion.adhesionScore < 30 ? 'info-warning' : '';
        html += `<div class="info-row ${baClass}"><span>Score</span><span>${bedAdhesion.adhesionScore.toFixed(0)}/100</span></div>`;
        html += '</div>';
      }

      // Wear rate (CNC)
      const wearRate = calculateWearRate(gcodeLines);
      if (wearRate.totalCuttingDistance > 0) {
        html += '<div class="info-section"><h4>Wear Rate</h4>';
        html += `<div class="info-row"><span>Per 100mm</span><span>${wearRate.wearPer100mm.toFixed(4)}%</span></div>`;
        html += `<div class="info-row"><span>Category</span><span>${wearRate.wearRateCategory}</span></div>`;
        html += '</div>';
      }

      // Flow rate consistency (3DP)
      const flowConsistency = analyzeFlowRateConsistency(gcodeLines);
      if (flowConsistency.avgFlowRate > 0) {
        html += '<div class="info-section"><h4>Flow Consistency</h4>';
        html += `<div class="info-row"><span>Avg</span><span>${flowConsistency.avgFlowRate.toFixed(2)}</span></div>`;
        html += `<div class="info-row"><span>Score</span><span>${flowConsistency.consistencyScore.toFixed(0)}%</span></div>`;
        html += '</div>';
      }

      // Command sequence validation (Universal)
      const seqValidation = validateCommandSequence(gcodeLines);
      if (seqValidation.count > 0) {
        html += '<div class="info-section"><h4>Seq Validation</h4>';
        const svClass = seqValidation.errorCount > 0 ? 'info-error' : 'info-warning';
        html += `<div class="info-row ${svClass}"><span>Violations</span><span>${seqValidation.count}</span></div>`;
        html += `<div class="info-row"><span>Score</span><span>${seqValidation.validationScore}/100</span></div>`;
        html += '</div>';
      }

      // Layer height variance (3DP)
      const layerHeightVar = analyzeLayerHeightVariance(gcodeLines);
      if (layerHeightVar.layerCount > 0) {
        html += '<div class="info-section"><h4>Layer Height Var</h4>';
        html += `<div class="info-row"><span>Avg Height</span><span>${layerHeightVar.avgLayerHeight.toFixed(3)}mm</span></div>`;
        html += `<div class="info-row"><span>Consistency</span><span>${layerHeightVar.consistencyScore.toFixed(0)}%</span></div>`;
        html += '</div>';
      }

      // ── Batch 22 Advanced Analysis (from GcodeAdvanced22) ──

      // Acceleration profile (Universal)
      const accelProfile = analyzeAccelerationProfile(gcodeLines);
      if (accelProfile.points.length > 0) {
        html += '<div class="info-section"><h4>Accel Profile</h4>';
        html += `<div class="info-row"><span>Max Accel</span><span>${accelProfile.maxAcceleration.toFixed(0)}mm/s²</span></div>`;
        const apClass = accelProfile.jerkCount > 10 ? 'info-warning' : '';
        html += `<div class="info-row ${apClass}"><span>Jerk Events</span><span>${accelProfile.jerkCount}</span></div>`;
        html += '</div>';
      }

      // Pressure advance (3DP)
      const paOpt = optimizePressureAdvance(gcodeLines);
      if (paOpt.recommendedPA > 0) {
        html += '<div class="info-section"><h4>Pressure Advance</h4>';
        html += `<div class="info-row"><span>Current</span><span>${paOpt.currentPA.toFixed(3)}</span></div>`;
        html += `<div class="info-row"><span>Recommended</span><span>${paOpt.recommendedPA.toFixed(3)}</span></div>`;
        html += '</div>';
      }

      // Coordinate origins (Universal)
      const origins = mapCoordinateOrigins(gcodeLines);
      if (origins.origins.length > 0) {
        html += '<div class="info-section"><h4>Origins</h4>';
        html += `<div class="info-row"><span>WCS Count</span><span>${origins.wcsCount}</span></div>`;
        html += `<div class="info-row"><span>Offsets</span><span>${origins.origins.length}</span></div>`;
        html += '</div>';
      }

      // Extrusion width per layer (3DP)
      const widthPerLayer = analyzeExtrusionWidthPerLayer(gcodeLines);
      if (widthPerLayer.layerCount > 0) {
        html += '<div class="info-section"><h4>Width/Layer</h4>';
        html += `<div class="info-row"><span>Avg Width</span><span>${widthPerLayer.overallAvgWidth.toFixed(3)}mm</span></div>`;
        html += `<div class="info-row"><span>Consistency</span><span>${widthPerLayer.overallConsistency.toFixed(0)}%</span></div>`;
        html += '</div>';
      }

      // Spindle warmup (CNC)
      const warmupOpt = optimizeSpindleWarmup(gcodeLines);
      if (warmupOpt.targetRPM > 0) {
        html += '<div class="info-section"><h4>Warmup Opt</h4>';
        html += `<div class="info-row"><span>Current</span><span>${warmupOpt.currentWarmupTime.toFixed(0)}s</span></div>`;
        html += `<div class="info-row"><span>Recommended</span><span>${warmupOpt.recommendedWarmupTime}s</span></div>`;
        html += '</div>';
      }

      // Support structure (3DP)
      const supportOpt = optimizeSupportStructure(gcodeLines);
      if (supportOpt.supportVolume > 0) {
        html += '<div class="info-section"><h4>Support Opt</h4>';
        html += `<div class="info-row"><span>Volume</span><span>${supportOpt.supportVolume.toFixed(0)}mm³</span></div>`;
        html += `<div class="info-row"><span>Density</span><span>${supportOpt.recommendedDensity}%</span></div>`;
        html += '</div>';
      }

      // File size (Universal)
      const fileSize = optimizeFileSize(gcodeLines);
      html += '<div class="info-section"><h4>File Size</h4>';
      html += `<div class="info-row"><span>Current</span><span>${fileSize.currentSize}B</span></div>`;
      html += `<div class="info-row"><span>Reduction</span><span>${fileSize.reductionPercentage.toFixed(1)}%</span></div>`;
      html += '</div>';

      // Curvature heatmap (CNC)
      const curvatureHeatmap = generateCurvatureHeatmap(gcodeLines);
      if (curvatureHeatmap.points.length > 0) {
        html += '<div class="info-section"><h4>Curvature</h4>';
        html += `<div class="info-row"><span>Sharp Corners</span><span>${curvatureHeatmap.sharpCornerCount}</span></div>`;
        html += `<div class="info-row"><span>Smoothness</span><span>${curvatureHeatmap.smoothnessScore.toFixed(0)}%</span></div>`;
        html += '</div>';
      }

      // Adhesion strength (3DP)
      const adhesionStrength = predictLayerAdhesionStrength(gcodeLines);
      if (adhesionStrength.predictedStrength > 0) {
        html += '<div class="info-section"><h4>Adhesion</h4>';
        html += `<div class="info-row"><span>Strength</span><span>${adhesionStrength.predictedStrength.toFixed(1)}MPa</span></div>`;
        html += `<div class="info-row"><span>Rating</span><span>${adhesionStrength.rating}</span></div>`;
        html += '</div>';
      }

      // Cornering speed (Universal)
      const corneringSpeed = calculateCorneringSpeed(gcodeLines);
      if (corneringSpeed.cornerCount > 0) {
        html += '<div class="info-section"><h4>Cornering</h4>';
        html += `<div class="info-row"><span>Corners</span><span>${corneringSpeed.cornerCount}</span></div>`;
        const csClass = corneringSpeed.overspeedCount > 10 ? 'info-warning' : '';
        html += `<div class="info-row ${csClass}"><span>Overspeed</span><span>${corneringSpeed.overspeedCount}</span></div>`;
        html += '</div>';
      }

      // ── Batch 23 Advanced Analysis (from GcodeAdvanced23) ──

      // Scallop height (CNC)
      const scallop = calculateScallopHeight(gcodeLines);
      if (scallop.stepover > 0) {
        html += '<div class="info-section"><h4>Scallop Height</h4>';
        html += `<div class="info-row"><span>Height</span><span>${scallop.scallopHeight.toFixed(4)}mm</span></div>`;
        html += `<div class="info-row"><span>Ra</span><span>${scallop.estimatedRa.toFixed(2)}µm</span></div>`;
        html += '</div>';
      }

      // Filament diameter variance (3DP)
      const filamentVar = detectFilamentDiameterVariance(gcodeLines);
      if (filamentVar.diameterVariance > 0) {
        html += '<div class="info-section"><h4>Filament Var</h4>';
        html += `<div class="info-row"><span>Variance</span><span>±${filamentVar.diameterVariance.toFixed(4)}mm</span></div>`;
        const fvClass = filamentVar.qualityScore < 70 ? 'info-warning' : '';
        html += `<div class="info-row ${fvClass}"><span>Quality</span><span>${filamentVar.qualityScore.toFixed(0)}/100</span></div>`;
        html += '</div>';
      }

      // Coordinate scaling (Universal)
      const scaling = detectCoordinateScaling(gcodeLines);
      if (scaling.count > 0) {
        html += '<div class="info-section"><h4>Scaling</h4>';
        html += `<div class="info-row"><span>Events</span><span>${scaling.count}</span></div>`;
        html += `<div class="info-row"><span>Range</span><span>${scaling.minScale.toFixed(2)}× - ${scaling.maxScale.toFixed(2)}×</span></div>`;
        html += '</div>';
      }

      // Chip thinning (CNC)
      const chipThinning = calculateChipThinning(gcodeLines);
      if (chipThinning.nominalChipLoad > 0) {
        html += '<div class="info-section"><h4>Chip Thinning</h4>';
        html += `<div class="info-row"><span>Factor</span><span>${chipThinning.thinningFactor.toFixed(2)}x</span></div>`;
        html += `<div class="info-row"><span>Opt Potential</span><span>${chipThinning.optimizationPotential.toFixed(0)}%</span></div>`;
        html += '</div>';
      }

      // Segment length distribution (Universal)
      const segDist = analyzeSegmentLengthDistribution(gcodeLines);
      if (segDist.totalSegments > 0) {
        html += '<div class="info-section"><h4>Segment Dist</h4>';
        html += `<div class="info-row"><span>Segments</span><span>${segDist.totalSegments}</span></div>`;
        html += `<div class="info-row"><span>Avg Length</span><span>${segDist.avgLength.toFixed(2)}mm</span></div>`;
        html += '</div>';
      }

      // Stepover (CNC)
      const stepover = calculateStepover(gcodeLines);
      if (stepover.avgStepover > 0) {
        html += '<div class="info-section"><h4>Stepover</h4>';
        html += `<div class="info-row"><span>Avg</span><span>${stepover.avgStepover.toFixed(3)}mm</span></div>`;
        html += `<div class="info-row"><span>% of Tool</span><span>${stepover.stepoverPercentage.toFixed(1)}%</span></div>`;
        html += '</div>';
      }

      // Extrusion multiplier (3DP)
      const extrusionMult = calibrateExtrusionMultiplier(gcodeLines);
      if (extrusionMult.flowDeviation !== 0) {
        html += '<div class="info-section"><h4>Extrusion Mult</h4>';
        html += `<div class="info-row"><span>Current</span><span>${extrusionMult.currentMultiplier.toFixed(3)}</span></div>`;
        html += `<div class="info-row"><span>Recommended</span><span>${extrusionMult.recommendedMultiplier.toFixed(3)}</span></div>`;
        html += '</div>';
      }

      // Symmetry (Universal)
      const symmetry = detectToolpathSymmetry(gcodeLines);
      if (symmetry.isSymmetric) {
        html += '<div class="info-section"><h4>Symmetry</h4>';
        html += `<div class="info-row"><span>Type</span><span>${symmetry.symmetryType}</span></div>`;
        html += `<div class="info-row"><span>Score</span><span>${symmetry.symmetryScore}/100</span></div>`;
        html += '</div>';
      }

      // Retract plane (CNC)
      const retractPlane = optimizeRetractPlane(gcodeLines);
      if (retractPlane.retractCount > 0) {
        html += '<div class="info-section"><h4>Retract Plane</h4>';
        html += `<div class="info-row"><span>Current</span><span>${retractPlane.currentRetractHeight.toFixed(1)}mm</span></div>`;
        html += `<div class="info-row"><span>Recommended</span><span>${retractPlane.recommendedRetractHeight.toFixed(1)}mm</span></div>`;
        html += '</div>';
      }

      // Skirt/brim gap (3DP)
      const skirtBrimGap = analyzeSkirtBrimGap(gcodeLines);
      if (skirtBrimGap.type !== 'none') {
        html += '<div class="info-section"><h4>Skirt/Brim</h4>';
        html += `<div class="info-row"><span>Type</span><span>${skirtBrimGap.type}</span></div>`;
        html += `<div class="info-row"><span>Gap</span><span>${skirtBrimGap.gap.toFixed(2)}mm</span></div>`;
        html += '</div>';
      }

      // Execution time (Universal)
      const execTime = estimateExecutionTime(gcodeLines);
      if (execTime.totalTime > 0) {
        html += '<div class="info-section"><h4>Exec Time</h4>';
        const mins = Math.floor(execTime.totalTime / 60);
        const secs = Math.round(execTime.totalTime % 60);
        html += `<div class="info-row"><span>Total</span><span>${mins}m ${secs}s</span></div>`;
        html += `<div class="info-row"><span>Efficiency</span><span>${execTime.efficiency.toFixed(0)}%</span></div>`;
        html += '</div>';
      }

      // ── Batch 24 Advanced Analysis (from GcodeAdvanced24) ──

      // Engagement angle (CNC)
      const engagementAngles = calculateEngagementAnglePerSegment(gcodeLines);
      if (engagementAngles.segments.length > 0) {
        html += '<div class="info-section"><h4>Engagement Angle</h4>';
        html += `<div class="info-row"><span>Avg</span><span>${engagementAngles.avgAngle.toFixed(0)}deg</span></div>`;
        html += `<div class="info-row"><span>Full Eng</span><span>${engagementAngles.fullEngagementCount}</span></div>`;
        html += '</div>';
      }

      // First layer speed (3DP)
      const firstLayerSpeed = optimizeFirstLayerSpeed(gcodeLines);
      if (firstLayerSpeed.currentSpeed > 0) {
        html += '<div class="info-section"><h4>First Layer Speed</h4>';
        html += `<div class="info-row"><span>Current</span><span>${firstLayerSpeed.currentSpeed.toFixed(0)}mm/min</span></div>`;
        html += `<div class="info-row"><span>Recommended</span><span>${firstLayerSpeed.recommendedSpeed}mm/min</span></div>`;
        html += '</div>';
      }

      // Rapid travel (Universal)
      const rapidTravel = analyzeRapidTravelEfficiency(gcodeLines);
      if (rapidTravel.totalDistance > 0) {
        html += '<div class="info-section"><h4>Rapid Travel</h4>';
        html += `<div class="info-row"><span>Rapid %</span><span>${rapidTravel.rapidPercentage.toFixed(1)}%</span></div>`;
        html += `<div class="info-row"><span>Score</span><span>${rapidTravel.efficiencyScore.toFixed(0)}/100</span></div>`;
        html += '</div>';
      }

      // Plunge rate (CNC)
      const plungeRate = analyzePlungeRate(gcodeLines);
      if (plungeRate.plungeCount > 0) {
        html += '<div class="info-section"><h4>Plunge Rate</h4>';
        html += `<div class="info-row"><span>Avg</span><span>${plungeRate.avgPlungeRate.toFixed(0)}mm/min</span></div>`;
        const prClass = plungeRate.safetyScore < 70 ? 'info-warning' : '';
        html += `<div class="info-row ${prClass}"><span>Safety</span><span>${plungeRate.safetyScore.toFixed(0)}/100</span></div>`;
        html += '</div>';
      }

      // Material per extruder (3DP)
      const materialPerExt = calculateMaterialPerExtruder(gcodeLines);
      if (materialPerExt.extruders.length > 0) {
        html += '<div class="info-section"><h4>Material/Extruder</h4>';
        html += `<div class="info-row"><span>Extruders</span><span>${materialPerExt.extruderCount}</span></div>`;
        html += `<div class="info-row"><span>Total</span><span>${materialPerExt.totalWeight.toFixed(1)}g</span></div>`;
        html += '</div>';
      }

      // Layer cooling time (3DP)
      const layerCooling = analyzeLayerCoolingTime(gcodeLines);
      if (layerCooling.layerCount > 0) {
        html += '<div class="info-section"><h4>Layer Cooling</h4>';
        html += `<div class="info-row"><span>Avg</span><span>${layerCooling.avgCoolingTime.toFixed(1)}s</span></div>`;
        html += `<div class="info-row"><span>Consistency</span><span>${layerCooling.consistencyScore.toFixed(0)}%</span></div>`;
        html += '</div>';
      }

      // Reversal points (Universal)
      const reversalPoints = analyzeReversalPoints(gcodeLines);
      if (reversalPoints.count > 0) {
        html += '<div class="info-section"><h4>Reversals</h4>';
        html += `<div class="info-row"><span>Count</span><span>${reversalPoints.count}</span></div>`;
        html += `<div class="info-row"><span>U-turns</span><span>${reversalPoints.uTurnCount}</span></div>`;
        html += '</div>';
      }

      // Start/stop quality (3DP)
      const startStopQuality = analyzeExtrusionStartStopQuality(gcodeLines);
      if (startStopQuality.startCount > 0 || startStopQuality.stopCount > 0) {
        html += '<div class="info-section"><h4>Start/Stop Quality</h4>';
        html += `<div class="info-row"><span>Issues</span><span>${startStopQuality.issueCount}</span></div>`;
        html += `<div class="info-row"><span>Score</span><span>${startStopQuality.qualityScore.toFixed(0)}/100</span></div>`;
        html += '</div>';
      }

      // Program flow (Universal)
      const programFlow = analyzeProgramFlowStructure(gcodeLines);
      if (programFlow.sectionCount > 0) {
        html += '<div class="info-section"><h4>Program Flow</h4>';
        html += `<div class="info-row"><span>Sections</span><span>${programFlow.sectionCount}</span></div>`;
        html += `<div class="info-row"><span>Score</span><span>${programFlow.structureScore}/100</span></div>`;
        html += '</div>';
      }

      // MRR per layer (CNC)
      const mrrPerLayer = calculateMRRPerLayer(gcodeLines);
      if (mrrPerLayer.layerCount > 0) {
        html += '<div class="info-section"><h4>MRR/Layer</h4>';
        html += `<div class="info-row"><span>Avg MRR</span><span>${mrrPerLayer.avgMRR.toFixed(2)}cm3/min</span></div>`;
        html += `<div class="info-row"><span>Volume</span><span>${mrrPerLayer.totalVolume.toFixed(0)}mm3</span></div>`;
        html += '</div>';
      }

      // ── Batch 25 Advanced Analysis (from GcodeAdvanced25) ──

      // Air cutting time (CNC)
      const airCutting = calculateAirCuttingTime(gcodeLines);
      if (airCutting.airCuttingCount > 0) {
        html += '<div class="info-section"><h4>Air Cutting</h4>';
        html += `<div class="info-row"><span>Time</span><span>${airCutting.airCuttingTime.toFixed(1)}s</span></div>`;
        html += `<div class="info-row"><span>Pct</span><span>${airCutting.airCuttingPercentage.toFixed(1)}%</span></div>`;
        html += '</div>';
      }

      // Bead width variance (3DP)
      const beadWidth = analyzeBeadWidthVariance(gcodeLines);
      if (beadWidth.avgBeadWidth > 0) {
        html += '<div class="info-section"><h4>Bead Width</h4>';
        html += `<div class="info-row"><span>Avg</span><span>${beadWidth.avgBeadWidth.toFixed(4)}mm</span></div>`;
        html += `<div class="info-row"><span>CV</span><span>${(beadWidth.coefficientOfVariation * 100).toFixed(1)}%</span></div>`;
        html += '</div>';
      }

      // Parameter ranges (Universal)
      const paramRanges = validateParameterRanges(gcodeLines);
      if (paramRanges.parametersChecked > 0) {
        html += '<div class="info-section"><h4>Param Ranges</h4>';
        html += `<div class="info-row"><span>Checked</span><span>${paramRanges.parametersChecked}</span></div>`;
        const prClass = paramRanges.errorCount > 0 ? 'info-warning' : '';
        html += `<div class="info-row ${prClass}"><span>Violations</span><span>${paramRanges.count}</span></div>`;
        html += '</div>';
      }

      // Engagement heatmap per layer (CNC)
      const engagementHeatmap = generateEngagementHeatmapPerLayer(gcodeLines);
      if (engagementHeatmap.layerCount > 0) {
        html += '<div class="info-section"><h4>Engagement Map</h4>';
        html += `<div class="info-row"><span>Layers</span><span>${engagementHeatmap.layerCount}</span></div>`;
        html += `<div class="info-row"><span>Avg Eng</span><span>${engagementHeatmap.overallAvgEngagement.toFixed(0)}deg</span></div>`;
        html += '</div>';
      }

      // Fan duty cycle (3DP)
      const fanDuty = analyzeFanDutyCycle(gcodeLines);
      if (fanDuty.totalTime > 0) {
        html += '<div class="info-section"><h4>Fan Duty</h4>';
        html += `<div class="info-row"><span>Avg</span><span>${fanDuty.avgDutyCycle.toFixed(0)}%</span></div>`;
        html += `<div class="info-row"><span>Cycles</span><span>${fanDuty.cycleCount}</span></div>`;
        html += '</div>';
      }

      // Tool change positions (Universal)
      const toolChangePos = optimizeToolChangePositions(gcodeLines);
      if (toolChangePos.count > 0) {
        html += '<div class="info-section"><h4>Tool Changes</h4>';
        html += `<div class="info-row"><span>Count</span><span>${toolChangePos.count}</span></div>`;
        html += `<div class="info-row"><span>Travel</span><span>${toolChangePos.totalTravel.toFixed(0)}mm</span></div>`;
        html += '</div>';
      }

      // Spindle speed advisor (CNC)
      const spindleAdvice = adviseSpindleSpeed(gcodeLines);
      if (spindleAdvice.currentSpeed > 0 || spindleAdvice.recommendedSpeed > 0) {
        html += '<div class="info-section"><h4>Spindle Speed</h4>';
        html += `<div class="info-row"><span>Current</span><span>${spindleAdvice.currentSpeed} RPM</span></div>`;
        html += `<div class="info-row"><span>Recommended</span><span>${spindleAdvice.recommendedSpeed} RPM</span></div>`;
        html += '</div>';
      }

      // First layer height (3DP)
      const firstLayerHeight = optimizeFirstLayerHeight(gcodeLines);
      if (firstLayerHeight.currentHeight > 0) {
        html += '<div class="info-section"><h4>First Layer H</h4>';
        html += `<div class="info-row"><span>Current</span><span>${firstLayerHeight.currentHeight.toFixed(3)}mm</span></div>`;
        html += `<div class="info-row"><span>Recommended</span><span>${firstLayerHeight.recommendedHeight.toFixed(3)}mm</span></div>`;
        html += '</div>';
      }

      // Continuity per layer (Universal)
      const continuityPerLayer = checkContinuityPerLayer(gcodeLines);
      if (continuityPerLayer.layerCount > 0) {
        html += '<div class="info-section"><h4>Continuity</h4>';
        html += `<div class="info-row"><span>Layers</span><span>${continuityPerLayer.layerCount}</span></div>`;
        html += `<div class="info-row"><span>Gaps</span><span>${continuityPerLayer.totalGaps}</span></div>`;
        html += '</div>';
      }

      // Minimum clearance (CNC)
      const minClearance = calculateMinimumClearance(gcodeLines);
      if (minClearance.minClearance > 0 || minClearance.violationCount > 0) {
        html += '<div class="info-section"><h4>Clearance</h4>';
        html += `<div class="info-row"><span>Min</span><span>${minClearance.minClearance.toFixed(2)}mm</span></div>`;
        const clClass = minClearance.safetyScore < 70 ? 'info-warning' : '';
        html += `<div class="info-row ${clClass}"><span>Safety</span><span>${minClearance.safetyScore.toFixed(0)}/100</span></div>`;
        html += '</div>';
      }

      // Wall thickness consistency (3DP)
      const wallThickness = analyzeWallThicknessConsistency(gcodeLines);
      if (wallThickness.avgWallThickness > 0) {
        html += '<div class="info-section"><h4>Wall Thickness</h4>';
        html += `<div class="info-row"><span>Avg</span><span>${wallThickness.avgWallThickness.toFixed(3)}mm</span></div>`;
        html += `<div class="info-row"><span>Score</span><span>${wallThickness.consistencyScore.toFixed(0)}/100</span></div>`;
        html += '</div>';
      }

      // Execution order (Universal)
      const execOrder = optimizeExecutionOrder(gcodeLines);
      if (execOrder.operationCount > 0) {
        html += '<div class="info-section"><h4>Exec Order</h4>';
        html += `<div class="info-row"><span>Ops</span><span>${execOrder.operationCount}</span></div>`;
        html += `<div class="info-row"><span>Save</span><span>${execOrder.estimatedTimeSavings.toFixed(0)}s</span></div>`;
        html += '</div>';
      }

      // ── Batch 26 Advanced Analysis (from GcodeAdvanced26) ──

      // Engagement time per layer (CNC)
      const engTimePerLayer = calculateEngagementTimePerLayer(gcodeLines);
      if (engTimePerLayer.layerCount > 0) {
        html += '<div class="info-section"><h4>Eng Time/Layer</h4>';
        html += `<div class="info-row"><span>Layers</span><span>${engTimePerLayer.layerCount}</span></div>`;
        html += `<div class="info-row"><span>Total</span><span>${engTimePerLayer.totalEngagementTime.toFixed(1)}s</span></div>`;
        html += '</div>';
      }

      // Extrusion rate per layer (3DP)
      const extRatePerLayer = analyzeExtrusionRatePerLayer(gcodeLines);
      if (extRatePerLayer.layerCount > 0) {
        html += '<div class="info-section"><h4>Ext Rate/Layer</h4>';
        html += `<div class="info-row"><span>Avg</span><span>${extRatePerLayer.avgExtrusionRate.toFixed(2)}mm3/s</span></div>`;
        html += `<div class="info-row"><span>Score</span><span>${extRatePerLayer.consistencyScore.toFixed(0)}/100</span></div>`;
        html += '</div>';
      }

      // Work offset usage (Universal)
      const workOffsetUsage = analyzeWorkOffsetUsage(gcodeLines);
      if (workOffsetUsage.activeCount > 0) {
        html += '<div class="info-section"><h4>Work Offsets</h4>';
        html += `<div class="info-row"><span>Count</span><span>${workOffsetUsage.activeCount}</span></div>`;
        html += `<div class="info-row"><span>Primary</span><span>${workOffsetUsage.primaryOffset}</span></div>`;
        html += '</div>';
      }

      // Tool deflection (CNC)
      const deflectionComp = calculateDeflectionCompensation(gcodeLines);
      if (deflectionComp.estimatedDeflection > 0) {
        html += '<div class="info-section"><h4>Deflection</h4>';
        html += `<div class="info-row"><span>Est.</span><span>${deflectionComp.estimatedDeflection.toFixed(4)}mm</span></div>`;
        html += `<div class="info-row"><span>Severity</span><span>${deflectionComp.severity}</span></div>`;
        html += '</div>';
      }

      // Bridging speed (3DP)
      const bridging = optimizeBridgingSpeed(gcodeLines);
      if (bridging.bridgeCount > 0) {
        html += '<div class="info-section"><h4>Bridging</h4>';
        html += `<div class="info-row"><span>Count</span><span>${bridging.bridgeCount}</span></div>`;
        html += `<div class="info-row"><span>Score</span><span>${bridging.qualityScore.toFixed(0)}/100</span></div>`;
        html += '</div>';
      }

      // Overlaps per layer (Universal)
      const overlapsPerLayer = detectOverlapsPerLayer(gcodeLines);
      if (overlapsPerLayer.layerCount > 0) {
        html += '<div class="info-section"><h4>Overlaps/Layer</h4>';
        html += `<div class="info-row"><span>Total</span><span>${overlapsPerLayer.totalOverlaps}</span></div>`;
        html += `<div class="info-row"><span>Severity</span><span>${overlapsPerLayer.severityScore.toFixed(0)}/100</span></div>`;
        html += '</div>';
      }

      // Spindle load per layer (CNC)
      const spindleLoadLayer = analyzeSpindleLoadPerLayer(gcodeLines);
      if (spindleLoadLayer.layerCount > 0) {
        html += '<div class="info-section"><h4>Spindle Load/L</h4>';
        html += `<div class="info-row"><span>Avg</span><span>${spindleLoadLayer.overallAvgLoad.toFixed(1)}%</span></div>`;
        html += `<div class="info-row"><span>Stability</span><span>${spindleLoadLayer.stabilityScore.toFixed(0)}/100</span></div>`;
        html += '</div>';
      }

      // Retraction hop height (3DP)
      const retractionHop = analyzeRetractionHopHeight(gcodeLines);
      if (retractionHop.hopCount > 0) {
        html += '<div class="info-section"><h4>Retract Hop</h4>';
        html += `<div class="info-row"><span>Count</span><span>${retractionHop.hopCount}</span></div>`;
        html += `<div class="info-row"><span>Avg H</span><span>${retractionHop.avgHopHeight.toFixed(3)}mm</span></div>`;
        html += '</div>';
      }

      // Program complexity (Universal)
      const complexity = calculateProgramComplexity(gcodeLines);
      if (complexity.lineCount > 0) {
        html += '<div class="info-section"><h4>Complexity</h4>';
        html += `<div class="info-row"><span>Score</span><span>${complexity.complexityScore}/100</span></div>`;
        html += `<div class="info-row"><span>Rating</span><span>${complexity.rating}</span></div>`;
        html += '</div>';
      }

      // Arc quality (CNC)
      const arcQuality = analyzeArcInterpolationQuality(gcodeLines);
      if (arcQuality.count > 0) {
        html += '<div class="info-section"><h4>Arc Quality</h4>';
        html += `<div class="info-row"><span>Count</span><span>${arcQuality.count}</span></div>`;
        html += `<div class="info-row"><span>Score</span><span>${arcQuality.qualityScore.toFixed(0)}/100</span></div>`;
        html += '</div>';
      }

      // Layer height consistency (3DP)
      const layerHeightCons = analyzeLayerHeightConsistencyPerLayer(gcodeLines);
      if (layerHeightCons.layerCount > 0) {
        html += '<div class="info-section"><h4>Layer H Cons</h4>';
        html += `<div class="info-row"><span>Nominal</span><span>${layerHeightCons.nominalHeight.toFixed(3)}mm</span></div>`;
        html += `<div class="info-row"><span>Score</span><span>${layerHeightCons.consistencyScore.toFixed(0)}/100</span></div>`;
        html += '</div>';
      }

      // Modal state transitions (Universal)
      const modalTransitions = analyzeModalStateTransitions(gcodeLines);
      if (modalTransitions.count > 0) {
        html += '<div class="info-section"><h4>Modal Trans</h4>';
        html += `<div class="info-row"><span>Count</span><span>${modalTransitions.count}</span></div>`;
        html += `<div class="info-row"><span>Stability</span><span>${modalTransitions.stabilityScore.toFixed(0)}/100</span></div>`;
        html += '</div>';
      }

      // ── Batch 27 Advanced Analysis (from GcodeAdvanced27) ──

      // Entry strategy (CNC)
      const entryStrategy = analyzeEntryStrategy(gcodeLines);
      if (entryStrategy.count > 0) {
        html += '<div class="info-section"><h4>Entry Strategy</h4>';
        html += `<div class="info-row"><span>Primary</span><span>${entryStrategy.primaryStrategy}</span></div>`;
        html += `<div class="info-row"><span>Count</span><span>${entryStrategy.count}</span></div>`;
        html += '</div>';
      }

      // Retraction acceleration (3DP)
      const retractAccel = analyzeRetractionAcceleration(gcodeLines);
      if (retractAccel.count > 0) {
        html += '<div class="info-section"><h4>Retract Accel</h4>';
        html += `<div class="info-row"><span>Count</span><span>${retractAccel.count}</span></div>`;
        html += `<div class="info-row"><span>Quality</span><span>${retractAccel.qualityScore.toFixed(0)}/100</span></div>`;
        html += '</div>';
      }

      // Coordinate alignment (Universal)
      const coordAlignment = checkCoordinateSystemAlignment(gcodeLines);
      if (coordAlignment.wcsCount > 0) {
        html += '<div class="info-section"><h4>Coord Align</h4>';
        html += `<div class="info-row"><span>WCS</span><span>${coordAlignment.wcsCount}</span></div>`;
        const caClass = coordAlignment.issueCount > 0 ? 'info-warning' : '';
        html += `<div class="info-row ${caClass}"><span>Issues</span><span>${coordAlignment.issueCount}</span></div>`;
        html += '</div>';
      }

      // Nose radius compensation (CNC)
      const noseRadius = validateNoseRadiusCompensation(gcodeLines);
      if (noseRadius.count > 0) {
        html += '<div class="info-section"><h4>Nose Radius</h4>';
        html += `<div class="info-row"><span>Events</span><span>${noseRadius.count}</span></div>`;
        const nrClass = noseRadius.hasUncancelled ? 'info-warning' : '';
        html += `<div class="info-row ${nrClass}"><span>Score</span><span>${noseRadius.validationScore}/100</span></div>`;
        html += '</div>';
      }

      // Infill density per layer (3DP)
      const infillDensityLayer = analyzeInfillDensityPerLayer(gcodeLines);
      if (infillDensityLayer.layerCount > 0) {
        html += '<div class="info-section"><h4>Infill/Layer</h4>';
        html += `<div class="info-row"><span>Avg</span><span>${infillDensityLayer.avgDensity.toFixed(1)}%</span></div>`;
        html += `<div class="info-row"><span>Score</span><span>${infillDensityLayer.consistencyScore.toFixed(0)}/100</span></div>`;
        html += '</div>';
      }

      // Segment classification per layer (Universal)
      const segClassPerLayer = classifySegmentsPerLayer(gcodeLines);
      if (segClassPerLayer.layerCount > 0) {
        html += '<div class="info-section"><h4>Seg Class/L</h4>';
        html += `<div class="info-row"><span>Layers</span><span>${segClassPerLayer.layerCount}</span></div>`;
        html += `<div class="info-row"><span>Score</span><span>${segClassPerLayer.consistencyScore}/100</span></div>`;
        html += '</div>';
      }

      // Spindle warmup (CNC)
      const spindleWarmup = validateSpindleWarmupCycle(gcodeLines);
      if (spindleWarmup.hasWarmup || spindleWarmup.warmupSpeed > 0) {
        html += '<div class="info-section"><h4>Spindle Warmup</h4>';
        html += `<div class="info-row"><span>Duration</span><span>${spindleWarmup.warmupDuration.toFixed(0)}s</span></div>`;
        html += `<div class="info-row"><span>Score</span><span>${spindleWarmup.validationScore.toFixed(0)}/100</span></div>`;
        html += '</div>';
      }

      // Fan speed per layer (3DP)
      const fanSpeedLayer = analyzeFanSpeedPerLayer(gcodeLines);
      if (fanSpeedLayer.layerCount > 0) {
        html += '<div class="info-section"><h4>Fan/Layer</h4>';
        html += `<div class="info-row"><span>Avg</span><span>${fanSpeedLayer.avgFanSpeed.toFixed(0)}/255</span></div>`;
        html += `<div class="info-row"><span>Score</span><span>${fanSpeedLayer.consistencyScore.toFixed(0)}/100</span></div>`;
        html += '</div>';
      }

      // Structure complexity per section (Universal)
      const structComplexity = analyzeStructureComplexityPerSection(gcodeLines);
      if (structComplexity.sectionCount > 0) {
        html += '<div class="info-section"><h4>Struct Complexity</h4>';
        html += `<div class="info-row"><span>Sections</span><span>${structComplexity.sectionCount}</span></div>`;
        html += `<div class="info-row"><span>Most Complex</span><span>${structComplexity.mostComplexSection}</span></div>`;
        html += '</div>';
      }

      // Lead-in/out (CNC)
      const leadInOut = analyzeLeadInOut(gcodeLines);
      if (leadInOut.leadInCount + leadInOut.leadOutCount > 0) {
        html += '<div class="info-section"><h4>Lead In/Out</h4>';
        html += `<div class="info-row"><span>In/Out</span><span>${leadInOut.leadInCount}/${leadInOut.leadOutCount}</span></div>`;
        html += `<div class="info-row"><span>Score</span><span>${leadInOut.qualityScore.toFixed(0)}/100</span></div>`;
        html += '</div>';
      }

      // Extrusion consistency per layer (3DP)
      const extConsPerLayer = analyzeExtrusionConsistencyPerLayer(gcodeLines);
      if (extConsPerLayer.layerCount > 0) {
        html += '<div class="info-section"><h4>Ext Cons/L</h4>';
        html += `<div class="info-row"><span>Layers</span><span>${extConsPerLayer.layerCount}</span></div>`;
        html += `<div class="info-row"><span>Score</span><span>${extConsPerLayer.overallConsistencyScore.toFixed(0)}/100</span></div>`;
        html += '</div>';
      }

      // Machine coordinate boundary (Universal)
      const machineBoundary = checkMachineCoordinateBoundary(gcodeLines);
      if (machineBoundary.violationCount > 0 || machineBoundary.isWithinBounds) {
        html += '<div class="info-section"><h4>Machine Bounds</h4>';
        const mbClass = machineBoundary.violationCount > 0 ? 'info-warning' : '';
        html += `<div class="info-row ${mbClass}"><span>Violations</span><span>${machineBoundary.violationCount}</span></div>`;
        html += `<div class="info-row"><span>Safety</span><span>${machineBoundary.safetyScore.toFixed(0)}/100</span></div>`;
        html += '</div>';
      }
    }

    // ── Server-side analysis (C++ Tether analyzers) ──
    if (remoteSections && remoteSections.length > 0) {
      html += '<div class="info-section"><h4>Server Analysis</h4>';
      for (const section of remoteSections) {
        const score = Number.isFinite(section.score) ? section.score.toFixed(0) : '–';
        html += `<details class="info-subsection">`;
        html += `<summary><strong>${section.displayName || section.sectionName}</strong> <span style="margin-left:auto">${score}/100</span></summary>`;
        if (section.metrics && section.metrics.length > 0) {
          for (const metric of section.metrics) {
            let valueText: string;
            const v = metric.value;
            switch (v.case) {
              case 'doubleValue':
                valueText = v.value.toFixed(2).replace(/\.?0+$/, '') || '0';
                break;
              case 'int64Value':
                valueText = String(v.value);
                break;
              case 'boolValue':
                valueText = v.value ? 'Yes' : 'No';
                break;
              case 'stringValue':
                valueText = String(v.value);
                break;
              default:
                valueText = '–';
            }
            html += `<div class="info-row"><span>${metric.key}</span><span>${valueText}</span></div>`;
          }
        }
        html += '</details>';
      }
      html += '</div>';
    }

    this.contentEl.innerHTML = html;
  }

  destroy(): void {
    this.element.remove();
  }
}
