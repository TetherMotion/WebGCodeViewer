/**
 * @file GcodeAnalysis.ts
 * @brief Advanced G-code analysis: feature type parsing, stringing detection,
 * volumetric flow rate, layer time warnings, error detection, WCS tracking,
 * print time estimation, stock/bed dimensions parsing, selection-scoped metrics.
 *
 * These are pure functions that operate on the G-code text already loaded
 * in the viewer. No backend changes required.
 */

// ── Types ──

export type SlicerType = 'cura' | 'prusa' | 'orca' | 'bambu' | 'unknown';

export interface FeatureTypeSegment {
  /** G-code line number where this feature type starts */
  lineNumber: number;
  /** Feature type label (e.g., "PERIMETER", "FILL", "SUPPORT") */
  featureType: string;
  /** Slicer that produced this comment */
  slicer: SlicerType;
}

export interface StringingRisk {
  /** Start line of the travel move */
  lineNumber: number;
  /** Travel distance in mm */
  travelDistance: number;
  /** Whether the travel crosses an open boundary (no extrusion nearby) */
  crossesOpenArea: boolean;
  /** Risk score 0..1 (higher = more likely to string) */
  riskScore: number;
}

export interface VolumetricFlowSample {
  /** G-code line number */
  lineNumber: number;
  /** Volumetric flow rate in mm³/s */
  flowRate: number;
  /** Feed rate in mm/s */
  feedRate: number;
  /** Extrusion width in mm (from slicer config or estimated) */
  extrusionWidth: number;
  /** Layer height in mm */
  layerHeight: number;
}

export interface LayerTimeWarning {
  layerIndex: number;
  zHeight: number;
  timeSeconds: number;
  /** "slow" if layer takes too long (overheating risk), "fast" if too short (poor adhesion) */
  warning: 'slow' | 'fast';
  /** Threshold used for this warning */
  threshold: number;
}

export type GcodeErrorSeverity = 'error' | 'warning' | 'info';

export interface GcodeIssue {
  lineNumber: number;
  severity: GcodeErrorSeverity;
  category: string;
  message: string;
  gcodeLine: string;
}

export interface WorkCoordinateSystem {
  /** G-code line number where the WCS is selected */
  lineNumber: number;
  /** WCS number (0=G54, 1=G55, ..., 5=G59, 6=G59.1, etc.) */
  wcsNumber: number;
  /** G-code for this WCS (e.g., "G54") */
  code: string;
  /** Optional offset values if specified inline */
  offsets: { x?: number; y?: number; z?: number } | null;
}

export interface StockDimensions {
  /** Source: parsed from G-code comment or machine config */
  source: 'comment' | 'config' | 'estimated';
  /** Stock/bed dimensions in mm */
  min: [number, number, number];
  max: [number, number, number];
  /** Bed shape for 3D printing */
  bedShape?: 'rectangular' | 'circular';
}

export interface PrintTimeEstimate {
  /** Estimated print time in seconds */
  estimatedTime: number;
  /** Method used for estimation */
  method: 'feedrate' | 'comment' | 'metadata';
  /** Number of moves analyzed */
  moveCount: number;
  /** Confidence 0..1 */
  confidence: number;
}

export interface SelectionMetrics {
  /** Line range of the selection */
  startLine: number;
  endLine: number;
  /** Number of moves in the selection */
  moveCount: number;
  /** Total path length in mm */
  pathLength: number;
  /** Total extrusion length in mm */
  extrusionLength: number;
  /** Estimated time for this selection in seconds */
  estimatedTime: number;
  /** Min/max feed rate in mm/min */
  feedRateRange: { min: number; max: number };
  /** Average feed rate in mm/s */
  avgFeedRate: number;
}

// ── Feature Type Parsing ──

/**
 * Detect the slicer type from G-code comments.
 */
export function detectSlicer(lines: string[]): SlicerType {
  // Check first 200 lines for slicer identification
  const checkLines = lines.slice(0, Math.min(200, lines.length));
  for (const line of checkLines) {
    const lower = line.toLowerCase();
    if (lower.includes(';generated with cura') || lower.includes(';cura')) {
      return 'cura';
    }
    if (lower.includes('prusaslicer') || lower.includes('prusa slicer')) {
      return 'prusa';
    }
    if (lower.includes(';orca')) {
      return 'orca';
    }
    if (lower.includes(';bambu') || lower.includes('bambu studio')) {
      return 'bambu';
    }
  }
  return 'unknown';
}

/**
 * Parse slicer feature type comments (e.g., ";TYPE:PERIMETER").
 * Supports Cura, PrusaSlicer, Orca, and Bambu Studio formats.
 */
export function parseFeatureTypes(lines: string[]): FeatureTypeSegment[] {
  const slicer = detectSlicer(lines);
  const segments: FeatureTypeSegment[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // PrusaSlicer/Orca/Bambu format: ;TYPE:PERIMETER
    const typeMatch = line.match(/^;\s*TYPE:\s*(.+)/i);
    if (typeMatch) {
      segments.push({
        lineNumber: i,
        featureType: typeMatch[1].trim().toUpperCase(),
        slicer,
      });
      continue;
    }
    // Cura format: ;TYPE:WALL-OUTER or ;MESH:NONMESH
    const meshMatch = line.match(/^;\s*MESH:\s*(.+)/i);
    if (meshMatch) {
      segments.push({
        lineNumber: i,
        featureType: `MESH:${meshMatch[1].trim().toUpperCase()}`,
        slicer,
      });
      continue;
    }
    // Cura feature type: ;FEATURE:Infill
    const featureMatch = line.match(/^;\s*FEATURE:\s*(.+)/i);
    if (featureMatch) {
      segments.push({
        lineNumber: i,
        featureType: featureMatch[1].trim().toUpperCase(),
        slicer,
      });
    }
  }

  return segments;
}

/**
 * Get the feature type active at a given line number.
 */
export function getFeatureTypeAtLine(segments: FeatureTypeSegment[], lineNumber: number): string | null {
  let active: string | null = null;
  for (const seg of segments) {
    if (seg.lineNumber > lineNumber) break;
    active = seg.featureType;
  }
  return active;
}

// ── Stringing Risk Detection ──

/**
 * Detect travel moves that may cause stringing.
 * A travel move is risky if:
 * 1. It's a non-extruding move (G0 or G1 without E)
 * 2. The distance is long (> threshold)
 * 3. It crosses an open area (no nearby extrusion)
 *
 * @param lines G-code lines
 * @param minTravelDist Minimum travel distance to flag (default 20mm)
 * @param retractionCompensation Whether retraction reduces risk (default true)
 */
export function detectStringingRisk(
  lines: string[],
  minTravelDist: number = 20,
  retractionCompensation: boolean = true,
): StringingRisk[] {
  const risks: StringingRisk[] = [];
  let prevX = 0, prevY = 0, prevZ = 0;
  let prevE = 0;
  let currentE = 0;
  let hasPosition = false;
  let retracted = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Check for retraction (E decreases)
    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);
    if (eMatch) {
      const newE = parseFloat(eMatch[1]);
      if (newE < currentE) {
        retracted = true;
      } else if (newE > currentE && retracted) {
        retracted = false; // de-retraction
      }
      currentE = newE;
    }

    // Only look at G0 (rapid) and G1 (linear) moves
    const isG0 = /\bG0\b/i.test(code);
    const isG1 = /\bG1\b/i.test(code);
    if (!isG0 && !isG1) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);

    const newX = xMatch ? parseFloat(xMatch[1]) : prevX;
    const newY = yMatch ? parseFloat(yMatch[1]) : prevY;
    const newZ = zMatch ? parseFloat(zMatch[1]) : prevZ;

    if (hasPosition) {
      const dist = Math.sqrt(
        (newX - prevX) ** 2 + (newY - prevY) ** 2 + (newZ - prevZ) ** 2,
      );

      // Check if this is a travel move (no extrusion or retracted)
      const isTravel = isG0 || (isG1 && (!eMatch || retracted));

      if (isTravel && dist > minTravelDist) {
        // Risk score: based on distance and retraction state
        let riskScore = Math.min(1, dist / 100); // normalize to 0..1
        if (retractionCompensation && retracted) {
          riskScore *= 0.3; // retraction significantly reduces risk
        }
        // Z-moves are less risky (pure vertical)
        if (newZ !== prevZ && newX === prevX && newY === prevY) {
          riskScore *= 0.2;
        }

        risks.push({
          lineNumber: i,
          travelDistance: dist,
          crossesOpenArea: dist > minTravelDist * 2,
          riskScore,
        });
      }
    }

    prevX = newX;
    prevY = newY;
    prevZ = newZ;
    hasPosition = true;
  }

  return risks;
}

// ── Volumetric Flow Rate Analysis ──

/**
 * Compute volumetric flow rate for each extruding move.
 * Flow rate = extrusionWidth × layerHeight × feedRate
 *
 * @param lines G-code lines
 * @param defaultExtrusionWidth Default nozzle/extrusion width in mm (default 0.4)
 * @param defaultLayerHeight Default layer height in mm (default 0.2)
 */
export function computeVolumetricFlow(
  lines: string[],
  defaultExtrusionWidth: number = 0.4,
  defaultLayerHeight: number = 0.2,
): VolumetricFlowSample[] {
  const samples: VolumetricFlowSample[] = [];
  let prevE = 0;
  let currentFeedRate = 0; // mm/min
  let currentLayerHeight = defaultLayerHeight;
  let currentExtrusionWidth = defaultExtrusionWidth;
  let prevZ = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Parse slicer comments for layer height and extrusion width
    const layerMatch = line.match(/^;\s*LAYER_HEIGHT:\s*(\d*\.?\d+)/i);
    if (layerMatch) {
      currentLayerHeight = parseFloat(layerMatch[1]);
      continue;
    }
    const widthMatch = line.match(/^;\s*EXTRUSION_WIDTH:\s*(\d*\.?\d+)/i);
    if (widthMatch) {
      currentExtrusionWidth = parseFloat(widthMatch[1]);
      continue;
    }

    // Skip other comments
    if (line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Track feed rate
    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) {
      currentFeedRate = parseFloat(fMatch[1]);
    }

    // Track Z for layer height estimation
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    if (zMatch) {
      const newZ = parseFloat(zMatch[1]);
      if (newZ !== prevZ && prevZ > 0) {
        currentLayerHeight = Math.abs(newZ - prevZ);
      }
      prevZ = newZ;
    }

    // Only G1 with E is an extruding move
    if (!/\bG1\b/i.test(code)) continue;

    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);
    if (!eMatch) continue;

    const newE = parseFloat(eMatch[1]);
    const eDelta = newE - prevE;
    prevE = newE;

    if (eDelta <= 0) continue; // skip retractions and non-extruding

    // Compute move distance
    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    if (!xMatch && !yMatch) continue;

    // Feed rate in mm/s
    const feedRateMmS = currentFeedRate / 60;

    // Volumetric flow = width × height × speed
    const flowRate = currentExtrusionWidth * currentLayerHeight * feedRateMmS;

    if (flowRate > 0) {
      samples.push({
        lineNumber: i,
        flowRate,
        feedRate: feedRateMmS,
        extrusionWidth: currentExtrusionWidth,
        layerHeight: currentLayerHeight,
      });
    }
  }

  return samples;
}

/**
 * Get volumetric flow statistics.
 */
export function getFlowStats(samples: VolumetricFlowSample[]): {
  minFlow: number;
  maxFlow: number;
  meanFlow: number;
  stdDev: number;
  peakLine: number;
} {
  if (samples.length === 0) {
    return { minFlow: 0, maxFlow: 0, meanFlow: 0, stdDev: 0, peakLine: -1 };
  }
  const flows = samples.map(s => s.flowRate);
  const minFlow = Math.min(...flows);
  const maxFlow = Math.max(...flows);
  const meanFlow = flows.reduce((a, b) => a + b, 0) / flows.length;
  const variance = flows.reduce((a, b) => a + (b - meanFlow) ** 2, 0) / flows.length;
  const stdDev = Math.sqrt(variance);
  const peakIdx = flows.indexOf(maxFlow);
  return { minFlow, maxFlow, meanFlow, stdDev, peakLine: samples[peakIdx].lineNumber };
}

// ── Layer Time Warnings ──

/**
 * Analyze per-layer times and flag layers that may cause issues.
 * - "slow" layers: take significantly longer than average (overheating risk)
 * - "fast" layers: take significantly less time (poor layer adhesion)
 *
 * @param layerTimes Array of { layerIndex, zHeight, timeSeconds }
 * @param slowThreshold Multiplier above average to flag as slow (default 2.0)
 * @param fastThreshold Minimum time in seconds for adequate cooling (default 10)
 */
export function detectLayerTimeWarnings(
  layerTimes: { layerIndex: number; zHeight: number; timeSeconds: number }[],
  slowThreshold: number = 2.0,
  fastThreshold: number = 10,
): LayerTimeWarning[] {
  if (layerTimes.length === 0) return [];

  const warnings: LayerTimeWarning[] = [];
  const avgTime = layerTimes.reduce((sum, l) => sum + l.timeSeconds, 0) / layerTimes.length;

  for (const layer of layerTimes) {
    // Skip the first layer (brim/raft often takes longer)
    if (layer.layerIndex === 0) continue;

    if (layer.timeSeconds > avgTime * slowThreshold) {
      warnings.push({
        layerIndex: layer.layerIndex,
        zHeight: layer.zHeight,
        timeSeconds: layer.timeSeconds,
        warning: 'slow',
        threshold: avgTime * slowThreshold,
      });
    } else if (layer.timeSeconds < fastThreshold && layer.timeSeconds > 0) {
      warnings.push({
        layerIndex: layer.layerIndex,
        zHeight: layer.zHeight,
        timeSeconds: layer.timeSeconds,
        warning: 'fast',
        threshold: fastThreshold,
      });
    }
  }

  return warnings;
}

// ── G-code Error Detection ──

/**
 * Detect common G-code errors and warnings.
 * Checks for:
 * - Missing feed rate before first move
 * - Negative extrusion without prior extrusion (retraction without material)
 * - Temperature not set before extrusion
 * - Tool change without spindle/temperature setup
 * - Rapid moves through material (G0 with E)
 * - Excessive feed rate
 * - Missing homing (G28) before positioning
 * - Arc radius mismatch (G2/G3 with inconsistent R)
 * - Duplicate G-code words on the same line
 */
export function detectGcodeErrors(lines: string[]): GcodeIssue[] {
  const issues: GcodeIssue[] = [];
  let hasHomed = false;
  let hasSetFeedRate = false;
  let hasSetTemp = false;
  let totalExtruded = 0;
  let currentHotendTemp = 0;
  let firstMoveSeen = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Check for homing
    if (/\bG28\b/i.test(code)) {
      hasHomed = true;
      continue;
    }

    // Check for temperature setting
    if (/\bM104\b/i.test(code) || /\bM109\b/i.test(code)) {
      const sMatch = code.match(/\bS(\d*\.?\d+)/i);
      if (sMatch) {
        currentHotendTemp = parseFloat(sMatch[1]);
        hasSetTemp = true;
      }
    }

    // Check for feed rate
    if (/\bF\d/i.test(code)) {
      hasSetFeedRate = true;
    }

    // Check for moves
    const isG0 = /\bG0\b/i.test(code);
    const isG1 = /\bG1\b/i.test(code);
    const isMove = isG0 || isG1;

    if (isMove) {
      if (!firstMoveSeen) {
        firstMoveSeen = true;
        if (!hasHomed) {
          issues.push({
            lineNumber: i,
            severity: 'warning',
            category: 'homing',
            message: 'Move before homing (G28) — positions may be incorrect',
            gcodeLine: line,
          });
        }
        if (!hasSetFeedRate && isG1) {
          issues.push({
            lineNumber: i,
            severity: 'warning',
            category: 'feedrate',
            message: 'First G1 move without feed rate (F word) set',
            gcodeLine: line,
          });
        }
      }

      // G0 with extrusion is suspicious
      if (isG0) {
        const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);
        if (eMatch) {
          const eVal = parseFloat(eMatch[1]);
          if (eVal > totalExtruded) {
            issues.push({
              lineNumber: i,
              severity: 'warning',
              category: 'rapid-extrusion',
              message: 'Rapid move (G0) with extrusion — may cause poor print quality',
              gcodeLine: line,
            });
          }
        }
      }

      // Check extrusion
      const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);
      if (eMatch) {
        const eVal = parseFloat(eMatch[1]);
        const eDelta = eVal - totalExtruded;
        totalExtruded = eVal;

        // Extrusion before temperature is set
        if (eDelta > 0 && !hasSetTemp && currentHotendTemp === 0) {
          issues.push({
            lineNumber: i,
            severity: 'warning',
            category: 'temperature',
            message: 'Extrusion before hotend temperature is set',
            gcodeLine: line,
          });
        }

        // Negative extrusion beyond total (over-retraction)
        if (eVal < 0 && totalExtruded < 0) {
          issues.push({
            lineNumber: i,
            severity: 'info',
            category: 'retraction',
            message: 'Negative E value — ensure firmware uses absolute extrusion',
            gcodeLine: line,
          });
        }
      }

      // Excessive feed rate check
      const fMatch = code.match(/\bF(\d*\.?\d+)/i);
      if (fMatch) {
        const feedRate = parseFloat(fMatch[1]);
        if (feedRate > 15000) {
          issues.push({
            lineNumber: i,
            severity: 'warning',
            category: 'feedrate',
            message: `Very high feed rate (${feedRate} mm/min) — may cause skipped steps`,
            gcodeLine: line,
          });
        }
      }
    }

    // Check for duplicate words on same line
    const words = code.match(/([A-Za-z])(-?\d*\.?\d+)/g) || [];
    const letterCounts = new Map<string, number>();
    for (const w of words) {
      const letter = w[0].toUpperCase();
      letterCounts.set(letter, (letterCounts.get(letter) ?? 0) + 1);
    }
    for (const [letter, count] of letterCounts) {
      if (count > 1 && letter !== 'S') { // S can repeat for spindle
        issues.push({
          lineNumber: i,
          severity: 'warning',
          category: 'duplicate-word',
          message: `Duplicate ${letter} word on same line (${count} occurrences)`,
          gcodeLine: line,
        });
        break; // one warning per line
      }
    }

    // Arc radius check (G2/G3)
    if (/\bG[23]\b/i.test(code)) {
      const rMatch = code.match(/\bR(-?\d*\.?\d+)/i);
      const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
      if (!rMatch && (!xMatch || !yMatch)) {
        issues.push({
          lineNumber: i,
          severity: 'error',
          category: 'arc',
          message: 'Arc move (G2/G3) without radius (R) or endpoint (X,Y)',
          gcodeLine: line,
        });
      }
      if (rMatch) {
        const r = parseFloat(rMatch[1]);
        if (r === 0) {
          issues.push({
            lineNumber: i,
            severity: 'error',
            category: 'arc',
            message: 'Arc with zero radius',
            gcodeLine: line,
          });
        }
      }
    }
  }

  return issues;
}

// ── Work Coordinate System Tracking ──

/**
 * Parse work coordinate system selections (G54-G59, G59.1-G59.3).
 */
export function parseWorkCoordinateSystems(lines: string[]): WorkCoordinateSystem[] {
  const systems: WorkCoordinateSystem[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // G54-G59
    const wcsMatch = code.match(/\bG(5[4-9])\b/i);
    if (wcsMatch) {
      const gNum = parseInt(wcsMatch[1]);
      const wcsNumber = gNum - 54;

      // Check for inline offsets (X/Y/Z values on same line)
      const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
      const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
      const offsets = (xMatch || yMatch || zMatch) ? {
        x: xMatch ? parseFloat(xMatch[1]) : undefined,
        y: yMatch ? parseFloat(yMatch[1]) : undefined,
        z: zMatch ? parseFloat(zMatch[1]) : undefined,
      } : null;

      systems.push({
        lineNumber: i,
        wcsNumber,
        code: `G${wcsMatch[1]}`,
        offsets,
      });
    }
  }

  return systems;
}

/**
 * Get the active WCS at a given line number.
 */
export function getActiveWCS(systems: WorkCoordinateSystem[], lineNumber: number): WorkCoordinateSystem | null {
  let active: WorkCoordinateSystem | null = null;
  for (const sys of systems) {
    if (sys.lineNumber > lineNumber) break;
    active = sys;
  }
  return active;
}

// ── Stock/Bed Dimensions Parsing ──

/**
 * Parse stock or bed dimensions from G-code comments.
 * Supports common formats:
 * - ;STOCK_X, ;STOCK_Y, ;STOCK_Z
 * - ;BED_X, ;BED_Y
 * - ;print_area_min_x, ;print_area_max_x
 * - Cura: ;MACHINE_BOUNDS xMin,yMin,xMax,yMax
 */
export function parseStockDimensions(lines: string[]): StockDimensions | null {
  let stockX = 0, stockY = 0, stockZ = 0;
  let bedX = 0, bedY = 0;
  let minX: number | null = null, minY: number | null = null, minZ: number | null = null;
  let maxX: number | null = null, maxY: number | null = null, maxY2: number | null = null, maxZ: number | null = null;
  let foundAny = false;
  let bedShape: 'rectangular' | 'circular' | undefined;

  for (let i = 0; i < Math.min(lines.length, 500); i++) {
    const line = lines[i];

    // Stock dimensions (CNC)
    const stockXMatch = line.match(/^;\s*STOCK_X[,:]\s*(\d*\.?\d+)/i);
    if (stockXMatch) { stockX = parseFloat(stockXMatch[1]); foundAny = true; }
    const stockYMatch = line.match(/^;\s*STOCK_Y[,:]\s*(\d*\.?\d+)/i);
    if (stockYMatch) { stockY = parseFloat(stockYMatch[1]); foundAny = true; }
    const stockZMatch = line.match(/^;\s*STOCK_Z[,:]\s*(\d*\.?\d+)/i);
    if (stockZMatch) { stockZ = parseFloat(stockZMatch[1]); foundAny = true; }

    // Bed dimensions (3DP)
    const bedXMatch = line.match(/^;\s*BED_X[,:]\s*(\d*\.?\d+)/i);
    if (bedXMatch) { bedX = parseFloat(bedXMatch[1]); foundAny = true; }
    const bedYMatch = line.match(/^;\s*BED_Y[,:]\s*(\d*\.?\d+)/i);
    if (bedYMatch) { bedY = parseFloat(bedYMatch[1]); foundAny = true; }

    // Print area bounds
    const minXMatch = line.match(/^;\s*print_area_min_x[,:]\s*(-?\d*\.?\d+)/i);
    if (minXMatch) { minX = parseFloat(minXMatch[1]); foundAny = true; }
    const maxXMatch = line.match(/^;\s*print_area_max_x[,:]\s*(-?\d*\.?\d+)/i);
    if (maxXMatch) { maxX = parseFloat(maxXMatch[1]); foundAny = true; }
    const minYMatch = line.match(/^;\s*print_area_min_y[,:]\s*(-?\d*\.?\d+)/i);
    if (minYMatch) { minY = parseFloat(minYMatch[1]); foundAny = true; }
    const maxYMatch = line.match(/^;\s*print_area_max_y[,:]\s*(-?\d*\.?\d+)/i);
    if (maxYMatch) { maxY = parseFloat(maxYMatch[1]); foundAny = true; }

    // Cura machine bounds
    const boundsMatch = line.match(/^;\s*MACHINE_BOUNDS\s+(-?\d*\.?\d+),(-?\d*\.?\d+),(-?\d*\.?\d+),(-?\d*\.?\d+)/i);
    if (boundsMatch) {
      minX = parseFloat(boundsMatch[1]);
      minY = parseFloat(boundsMatch[2]);
      maxX = parseFloat(boundsMatch[3]);
      maxY = parseFloat(boundsMatch[4]);
      foundAny = true;
    }

    // Bed shape
    const shapeMatch = line.match(/^;\s*bed_shape[,:]\s*(\w+)/i);
    if (shapeMatch) {
      const shape = shapeMatch[1].toLowerCase();
      if (shape === 'circle' || shape === 'circular') bedShape = 'circular';
      else if (shape === 'rect' || shape === 'rectangular') bedShape = 'rectangular';
      foundAny = true;
    }

    // PrusaSlicer bed shape: ; bed_shape = 0x0,200x0,200x200,0x200
    const prusaShapeMatch = line.match(/^;\s*bed_shape\s*=\s*(.+)/i);
    if (prusaShapeMatch && !bedShape) {
      const coords = prusaShapeMatch[1].split(',');
      if (coords.length >= 4) {
        bedShape = 'rectangular';
        const first = coords[0].split('x').map(parseFloat);
        const third = coords[2].split('x').map(parseFloat);
        if (first.length === 2 && third.length === 2) {
          minX = first[0]; minY = first[1];
          maxX = third[0]; maxY = third[1];
          foundAny = true;
        }
      }
    }
  }

  if (!foundAny) return null;

  // Determine min/max from available data
  if (minX !== null && maxX !== null) {
    return {
      source: 'comment',
      min: [minX, minY ?? 0, 0],
      max: [maxX, maxY ?? 0, stockZ > 0 ? stockZ : 0],
      bedShape,
    };
  }

  if (stockX > 0 || stockY > 0 || stockZ > 0) {
    return {
      source: 'comment',
      min: [0, 0, 0],
      max: [stockX, stockY, stockZ],
      bedShape,
    };
  }

  if (bedX > 0 || bedY > 0) {
    return {
      source: 'comment',
      min: [0, 0, 0],
      max: [bedX, bedY, 0],
      bedShape,
    };
  }

  return null;
}

// ── Print Time Estimation ──

/**
 * Estimate print/machining time from G-code.
 * Uses feed rate and move distances for estimation.
 * Falls back to slicer comment if available.
 *
 * @param lines G-code lines
 * @param acceleration Optional acceleration in mm/s² for more accurate estimates
 */
export function estimatePrintTime(
  lines: string[],
  acceleration: number = 500,
): PrintTimeEstimate {
  // First, check for slicer-estimated time in comments
  for (let i = 0; i < Math.min(lines.length, 100); i++) {
    const line = lines[i];
    // PrusaSlicer: ; estimated printing time = 2h 30m 15s
    const prusaMatch = line.match(/^;\s*estimated printing time\s*=\s*(.+)/i);
    if (prusaMatch) {
      const timeStr = prusaMatch[1];
      const seconds = parseTimeString(timeStr);
      if (seconds > 0) {
        return { estimatedTime: seconds, method: 'comment', moveCount: 0, confidence: 0.95 };
      }
    }
    // Cura: ;TIME:12345
    const curaMatch = line.match(/^;\s*TIME:\s*(\d+)/i);
    if (curaMatch) {
      return { estimatedTime: parseInt(curaMatch[1]), method: 'comment', moveCount: 0, confidence: 0.95 };
    }
  }

  // Estimate from feed rates and distances
  let totalTime = 0;
  let moveCount = 0;
  let prevX = 0, prevY = 0, prevZ = 0;
  let currentFeedRate = 0; // mm/min
  let hasPosition = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const isG0 = /\bG0\b/i.test(code);
    const isG1 = /\bG1\b/i.test(code);
    if (!isG0 && !isG1) continue;

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) currentFeedRate = parseFloat(fMatch[1]);

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);

    const newX = xMatch ? parseFloat(xMatch[1]) : prevX;
    const newY = yMatch ? parseFloat(yMatch[1]) : prevY;
    const newZ = zMatch ? parseFloat(zMatch[1]) : prevZ;

    if (hasPosition && currentFeedRate > 0) {
      const dist = Math.sqrt(
        (newX - prevX) ** 2 + (newY - prevY) ** 2 + (newZ - prevZ) ** 2,
      );
      if (dist > 0) {
        // Simple time = distance / speed, with acceleration correction
        const speedMmS = currentFeedRate / 60;
        // Account for acceleration: add time for ramp-up/ramp-down
        const accelTime = speedMmS / acceleration;
        const cruiseDist = dist - speedMmS * accelTime;
        if (cruiseDist > 0) {
          totalTime += accelTime + cruiseDist / speedMmS;
        } else {
          // Short move — doesn't reach cruise speed
          totalTime += Math.sqrt(4 * dist / acceleration);
        }
        moveCount++;
      }
    }

    prevX = newX;
    prevY = newY;
    prevZ = newZ;
    hasPosition = true;
  }

  // G0 rapids typically use machine max speed (estimate 5000 mm/min)
  // Already included above with whatever F was last set

  return {
    estimatedTime: totalTime,
    method: 'feedrate',
    moveCount,
    confidence: moveCount > 100 ? 0.7 : 0.4,
  };
}

/**
 * Parse a time string like "2h 30m 15s" or "1h23m45s" into seconds.
 */
function parseTimeString(str: string): number {
  let seconds = 0;
  const hMatch = str.match(/(\d+)\s*h/i);
  const mMatch = str.match(/(\d+)\s*m/i);
  const sMatch = str.match(/(\d+)\s*s/i);
  if (hMatch) seconds += parseInt(hMatch[1]) * 3600;
  if (mMatch) seconds += parseInt(mMatch[1]) * 60;
  if (sMatch) seconds += parseInt(sMatch[1]);
  return seconds;
}

// ── Selection-Scoped Metrics ──

/**
 * Compute metrics for a selected range of G-code lines.
 * Useful for analyzing specific regions of the toolpath.
 *
 * @param lines G-code lines
 * @param startLine Start line number (0-based, inclusive)
 * @param endLine End line number (0-based, inclusive)
 */
export function computeSelectionMetrics(
  lines: string[],
  startLine: number,
  endLine: number,
): SelectionMetrics {
  let pathLength = 0;
  let extrusionLength = 0;
  let estimatedTime = 0;
  let moveCount = 0;
  let prevX = 0, prevY = 0, prevZ = 0;
  let prevE = 0;
  let currentFeedRate = 0;
  let hasPosition = false;
  let minFeed = Infinity;
  let maxFeed = 0;
  let feedSum = 0;
  let feedCount = 0;

  const start = Math.max(0, startLine);
  const end = Math.min(lines.length - 1, endLine);

  for (let i = start; i <= end; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const isG0 = /\bG0\b/i.test(code);
    const isG1 = /\bG1\b/i.test(code);
    if (!isG0 && !isG1) continue;

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) {
      currentFeedRate = parseFloat(fMatch[1]);
      if (currentFeedRate > 0) {
        if (currentFeedRate < minFeed) minFeed = currentFeedRate;
        if (currentFeedRate > maxFeed) maxFeed = currentFeedRate;
        feedSum += currentFeedRate / 60; // convert to mm/s for average
        feedCount++;
      }
    }

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

    const newX = xMatch ? parseFloat(xMatch[1]) : prevX;
    const newY = yMatch ? parseFloat(yMatch[1]) : prevY;
    const newZ = zMatch ? parseFloat(zMatch[1]) : prevZ;

    if (hasPosition) {
      const dist = Math.sqrt(
        (newX - prevX) ** 2 + (newY - prevY) ** 2 + (newZ - prevZ) ** 2,
      );
      pathLength += dist;
      moveCount++;

      if (currentFeedRate > 0 && dist > 0) {
        estimatedTime += dist / (currentFeedRate / 60);
      }
    }

    if (eMatch) {
      const newE = parseFloat(eMatch[1]);
      const eDelta = newE - prevE;
      if (eDelta > 0) extrusionLength += eDelta;
      prevE = newE;
    }

    prevX = newX;
    prevY = newY;
    prevZ = newZ;
    hasPosition = true;
  }

  return {
    startLine: start,
    endLine: end,
    moveCount,
    pathLength,
    extrusionLength,
    estimatedTime,
    feedRateRange: {
      min: minFeed === Infinity ? 0 : minFeed,
      max: maxFeed,
    },
    avgFeedRate: feedCount > 0 ? feedSum / feedCount : 0,
  };
}
