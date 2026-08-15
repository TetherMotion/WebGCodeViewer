/**
 * @file GcodeAdvanced13.ts
 * @brief Thirteenth batch of advanced G-code analysis features for CNC and 3D printing.
 *
 * This module provides 12 additional high-impact features:
 *  1. G-code execution trace (Universal) — per-line timing and state
 *  2. CNC chip thickness analysis (CNC) — chip thickness and cutting mechanics
 *  3. Print quality heatmap (3DP) — quality heatmap data per region
 *  4. CNC workholding analysis (CNC) — workholding strategy and force distribution
 *  5. Print material flow analysis (3DP) — material flow dynamics during extrusion
 *  6. G-code flow visualization (Universal) — flow diagram data of execution path
 *  7. CNC fixture optimization (CNC) — fixture placement and clamping strategy
 *  8. Print layer visualization data (3DP) — per-layer visualization metadata
 *  9. G-code compression analysis (Universal) — compression opportunities and ratios
 * 10. Tool path aerodynamics analysis (CNC) — air cutting vs material cutting time
 * 11. Print speed adaptive analysis (3DP) — adaptive speed control opportunities
 * 12. G-code dependency graph visualization (Universal) — dependency graph data
 */

// ── 1. G-code Execution Trace ──

export interface TraceEntry {
  /** Line number */
  line: number;
  /** Command */
  command: string;
  /** Execution time in ms */
  execTime: number;
  /** Cumulative time in ms */
  cumulativeTime: number;
  /** Position before */
  positionBefore: { x: number; y: number; z: number };
  /** Position after */
  positionAfter: { x: number; y: number; z: number };
  /** Distance moved */
  distance: number;
  /** Whether cutting */
  isCutting: boolean;
  /** Feed rate */
  feedRate: number;
  /** Spindle RPM */
  rpm: number;
  /** State change description */
  stateChange: string;
}

export interface ExecutionTraceResult {
  /** All trace entries */
  entries: TraceEntry[];
  /** Total execution time in ms */
  totalTime: number;
  /** Total distance */
  totalDistance: number;
  /** Cutting distance */
  cuttingDistance: number;
  /** Travel distance */
  travelDistance: number;
  /** Number of state changes */
  stateChangeCount: number;
  /** Slowest lines (bottlenecks) */
  bottlenecks: { line: number; time: number }[];
  /** Recommendations */
  recommendations: string[];
}

/**
 * Generate a detailed execution trace with per-line timing and state.
 * Useful for profiling and identifying performance bottlenecks.
 *
 * @param lines G-code lines
 */
export function generateExecutionTrace(lines: string[]): ExecutionTraceResult {
  const entries: TraceEntry[] = [];
  let pos = { x: 0, y: 0, z: 0 };
  let feedRate = 0;
  let rpm = 0;
  let cumulativeTime = 0;
  let totalDistance = 0;
  let cuttingDistance = 0;
  let travelDistance = 0;
  let stateChangeCount = 0;
  let prevE = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const posBefore = { ...pos };
    let stateChange = '';
    let isCutting = false;
    let distance = 0;
    let execTime = 0;

    // Track state changes
    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) {
      const newFeed = parseFloat(fMatch[1]);
      if (newFeed !== feedRate) {
        stateChange = `Feed: ${feedRate} → ${newFeed}`;
        feedRate = newFeed;
        stateChangeCount++;
      }
    }

    const sMatch = code.match(/\bS(\d*\.?\d+)/i);
    if (sMatch && /\bM[34]\b/i.test(code)) {
      const newRpm = parseFloat(sMatch[1]);
      if (newRpm !== rpm) {
        stateChange = stateChange ? `${stateChange}; RPM: ${rpm} → ${newRpm}` : `RPM: ${rpm} → ${newRpm}`;
        rpm = newRpm;
        stateChangeCount++;
      }
    }

    if (/\bM5\b/i.test(code) && rpm > 0) {
      stateChange = stateChange ? `${stateChange}; Spindle off` : 'Spindle off';
      rpm = 0;
      stateChangeCount++;
    }

    // Motion
    if (/\bG[01]\b/i.test(code)) {
      const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
      const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
      const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

      const newX = xMatch ? parseFloat(xMatch[1]) : pos.x;
      const newY = yMatch ? parseFloat(yMatch[1]) : pos.y;
      const newZ = zMatch ? parseFloat(zMatch[1]) : pos.z;

      distance = Math.sqrt((newX - pos.x) ** 2 + (newY - pos.y) ** 2 + (newZ - pos.z) ** 2);

      if (eMatch) {
        const e = parseFloat(eMatch[1]);
        if (e > prevE) {
          isCutting = true;
          cuttingDistance += distance;
        }
        prevE = e;
      } else if (/\bG1\b/i.test(code) && newZ < 0) {
        isCutting = true;
        cuttingDistance += distance;
      }

      if (!isCutting) travelDistance += distance;

      if (distance > 0 && feedRate > 0) {
        execTime = (distance / (feedRate / 60)) * 1000; // ms
      }

      pos = { x: newX, y: newY, z: newZ };
      totalDistance += distance;
      cumulativeTime += execTime;
    }

    entries.push({
      line: i, command: code, execTime, cumulativeTime,
      positionBefore: posBefore, positionAfter: { ...pos },
      distance, isCutting, feedRate, rpm, stateChange,
    });
  }

  // Find bottlenecks (top 5 slowest lines)
  const bottlenecks = entries
    .filter(e => e.execTime > 0)
    .sort((a, b) => b.execTime - a.execTime)
    .slice(0, 5)
    .map(e => ({ line: e.line, time: e.execTime }));

  const recommendations: string[] = [];
  if (bottlenecks.length > 0) {
    recommendations.push(`Slowest line: ${bottlenecks[0].line} (${bottlenecks[0].time.toFixed(1)}ms)`);
  }
  if (stateChangeCount > 20) {
    recommendations.push(`${stateChangeCount} state changes — consider reducing for smoother execution`);
  }
  if (travelDistance > cuttingDistance * 2) {
    recommendations.push('High travel-to-cutting ratio — optimize travel paths');
  }
  if (entries.length === 0) {
    recommendations.push('No executable lines found');
  }

  return {
    entries, totalTime: cumulativeTime, totalDistance,
    cuttingDistance, travelDistance, stateChangeCount,
    bottlenecks, recommendations,
  };
}

// ── 2. CNC Chip Thickness Analysis ──

export interface ChipThicknessPoint {
  /** Line number */
  line: number;
  /** Chip thickness in mm */
  chipThickness: number;
  /** Radial depth of cut in mm */
  radialDOC: number;
  /** Axial depth of cut in mm */
  axialDOC: number;
  /** Feed per tooth in mm */
  feedPerTooth: number;
  /** Tool diameter in mm */
  toolDiameter: number;
  /** Engagement angle in degrees */
  engagementAngle: number;
  /** Whether chip thickness is in recommended range */
  inRange: boolean;
}

export interface ChipThicknessResult {
  /** Per-point chip thickness data */
  points: ChipThicknessPoint[];
  /** Average chip thickness */
  avgChipThickness: number;
  /** Maximum chip thickness */
  maxChipThickness: number;
  /** Minimum chip thickness */
  minChipThickness: number;
  /** Percentage of points in recommended range */
  inRangePercentage: number;
  /** Recommended chip thickness range */
  recommendedRange: { min: number; max: number };
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze chip thickness for CNC milling operations.
 * Chip thickness affects:
 * - Tool life
 * - Surface finish
 * - Cutting forces
 * - Heat generation
 *
 * Chip thickness = feedPerTooth * sin(engagementAngle)
 *
 * @param lines G-code lines
 * @param toolDiameter Tool diameter in mm (default 6mm)
 * @param flutes Number of flutes (default 2)
 * @param recommendedMin Recommended minimum chip thickness (default 0.05)
 * @param recommendedMax Recommended maximum chip thickness (default 0.15)
 */
export function analyzeChipThickness(
  lines: string[],
  toolDiameter: number = 6,
  flutes: number = 2,
  recommendedMin: number = 0.05,
  recommendedMax: number = 0.15,
): ChipThicknessResult {
  const points: ChipThicknessPoint[] = [];
  let feedRate = 0;
  let rpm = 0;
  let prevX = 0, prevY = 0, prevZ = 0;
  let zMin = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) feedRate = parseFloat(fMatch[1]);

    const sMatch = code.match(/\bS(\d*\.?\d+)/i);
    if (sMatch) rpm = parseFloat(sMatch[1]);

    if (!/\bG1\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const z = zMatch ? parseFloat(zMatch[1]) : prevZ;

    if (z < 0) {
      const distance = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
      if (distance > 0.01 && rpm > 0 && feedRate > 0) {
        const feedPerTooth = feedRate / (rpm * flutes);
        const radialDOC = Math.min(toolDiameter, Math.abs(x - prevX) + Math.abs(y - prevY));
        const axialDOC = Math.abs(z - zMin);
        const engagementAngle = Math.asin(Math.min(1, radialDOC / toolDiameter)) * 180 / Math.PI;
        const chipThickness = feedPerTooth * Math.sin(engagementAngle * Math.PI / 180);
        const inRange = chipThickness >= recommendedMin && chipThickness <= recommendedMax;

        points.push({
          line: i, chipThickness, radialDOC, axialDOC,
          feedPerTooth, toolDiameter, engagementAngle, inRange,
        });
      }
      zMin = Math.min(zMin, z);
    }

    prevX = x; prevY = y; prevZ = z;
  }

  const thicknesses = points.map(p => p.chipThickness);
  const avgChipThickness = thicknesses.length > 0 ? thicknesses.reduce((a, b) => a + b, 0) / thicknesses.length : 0;
  const maxChipThickness = thicknesses.length > 0 ? Math.max(...thicknesses) : 0;
  const minChipThickness = thicknesses.length > 0 ? Math.min(...thicknesses) : 0;
  const inRangeCount = points.filter(p => p.inRange).length;
  const inRangePercentage = points.length > 0 ? (inRangeCount / points.length) * 100 : 0;

  const recommendations: string[] = [];
  if (maxChipThickness > recommendedMax) {
    recommendations.push(`Max chip thickness ${maxChipThickness.toFixed(3)}mm exceeds recommended ${recommendedMax}mm — reduce feed or increase RPM`);
  }
  if (minChipThickness < recommendedMin && minChipThickness > 0) {
    recommendations.push(`Min chip thickness ${minChipThickness.toFixed(3)}mm below recommended ${recommendedMin}mm — increase feed or reduce RPM`);
  }
  if (inRangePercentage < 50) {
    recommendations.push(`Only ${inRangePercentage.toFixed(0)}% of cuts in recommended chip thickness range`);
  }
  if (points.length === 0) {
    recommendations.push('No cutting operations detected for chip thickness analysis');
  }

  return {
    points, avgChipThickness, maxChipThickness, minChipThickness,
    inRangePercentage, recommendedRange: { min: recommendedMin, max: recommendedMax },
    recommendations,
  };
}

// ── 3. Print Quality Heatmap ──

export interface HeatmapCell {
  /** Grid X index */
  gridX: number;
  /** Grid Y index */
  gridY: number;
  /** Center X */
  centerX: number;
  /** Center Y */
  centerY: number;
  /** Quality score (0-100) */
  qualityScore: number;
  /** Number of segments in this cell */
  segmentCount: number;
  /** Issues in this cell */
  issues: string[];
}

export interface QualityHeatmapResult {
  /** Heatmap grid cells */
  cells: HeatmapCell[];
  /** Grid dimensions */
  gridSize: { x: number; y: number };
  /** Overall quality score */
  overallScore: number;
  /** Best region */
  bestRegion: { x: number; y: number; score: number };
  /** Worst region */
  worstRegion: { x: number; y: number; score: number };
  /** Issue distribution */
  issueDistribution: { [issue: string]: number };
  /** Recommendations */
  recommendations: string[];
}

/**
 * Generate a print quality heatmap.
 * Divides the print bed into a grid and assesses quality per region.
 *
 * @param lines G-code lines
 * @param gridResolution Grid resolution (cells per axis, default 10)
 */
export function generateQualityHeatmap(
  lines: string[],
  gridResolution: number = 10,
): QualityHeatmapResult {
  // Collect all motion points with quality indicators
  const points: { x: number; y: number; feedRate: number; z: number; isExtruding: boolean; isRetracting: boolean }[] = [];
  let prevX = 0, prevY = 0, prevZ = 0, prevE = 0;
  let feedRate = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG[01]\b/i.test(code)) continue;

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) feedRate = parseFloat(fMatch[1]);

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const z = zMatch ? parseFloat(zMatch[1]) : prevZ;
    const e = eMatch ? parseFloat(eMatch[1]) : prevE;

    const isExtruding = e > prevE;
    const isRetracting = e < prevE;

    if (isExtruding) {
      points.push({ x, y, feedRate, z, isExtruding, isRetracting });
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }

    prevX = x; prevY = y; prevZ = z; prevE = e;
  }

  if (points.length === 0 || !isFinite(minX)) {
    return {
      cells: [], gridSize: { x: 0, y: 0 }, overallScore: 100,
      bestRegion: { x: 0, y: 0, score: 100 },
      worstRegion: { x: 0, y: 0, score: 100 },
      issueDistribution: {},
      recommendations: ['No extrusion points found for heatmap'],
    };
  }

  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const cellWidth = rangeX / gridResolution;
  const cellHeight = rangeY / gridResolution;

  // Build grid
  const grid: HeatmapCell[][] = [];
  for (let gx = 0; gx < gridResolution; gx++) {
    grid[gx] = [];
    for (let gy = 0; gy < gridResolution; gy++) {
      grid[gx][gy] = {
        gridX: gx, gridY: gy,
        centerX: minX + (gx + 0.5) * cellWidth,
        centerY: minY + (gy + 0.5) * cellHeight,
        qualityScore: 100, segmentCount: 0, issues: [],
      };
    }
  }

  // Populate grid
  for (const p of points) {
    const gx = Math.min(gridResolution - 1, Math.max(0, Math.floor((p.x - minX) / cellWidth)));
    const gy = Math.min(gridResolution - 1, Math.max(0, Math.floor((p.y - minY) / cellHeight)));
    const cell = grid[gx][gy];
    cell.segmentCount++;

    // Deduct points for quality issues
    if (p.feedRate > 5000) {
      cell.qualityScore -= 5;
      if (!cell.issues.includes('high_feed')) cell.issues.push('high_feed');
    }
    if (p.feedRate > 0 && p.feedRate < 500) {
      cell.qualityScore -= 3;
      if (!cell.issues.includes('low_feed')) cell.issues.push('low_feed');
    }
    if (p.isRetracting) {
      cell.qualityScore -= 2;
      if (!cell.issues.includes('retraction')) cell.issues.push('retraction');
    }
  }

  // Normalize scores
  const cells: HeatmapCell[] = [];
  for (let gx = 0; gx < gridResolution; gx++) {
    for (let gy = 0; gy < gridResolution; gy++) {
      const cell = grid[gx][gy];
      cell.qualityScore = Math.max(0, Math.min(100, cell.qualityScore));
      cells.push(cell);
    }
  }

  const scoredCells = cells.filter(c => c.segmentCount > 0);
  const overallScore = scoredCells.length > 0
    ? scoredCells.reduce((s, c) => s + c.qualityScore, 0) / scoredCells.length
    : 100;

  const best = scoredCells.reduce((best, c) => c.qualityScore > best.qualityScore ? c : best, scoredCells[0] ?? { gridX: 0, gridY: 0, centerX: 0, centerY: 0, qualityScore: 100, segmentCount: 0, issues: [] });
  const worst = scoredCells.reduce((worst, c) => c.qualityScore < worst.qualityScore ? c : worst, scoredCells[0] ?? { gridX: 0, gridY: 0, centerX: 0, centerY: 0, qualityScore: 100, segmentCount: 0, issues: [] });

  const issueDistribution: { [issue: string]: number } = {};
  for (const c of cells) {
    for (const issue of c.issues) {
      issueDistribution[issue] = (issueDistribution[issue] ?? 0) + 1;
    }
  }

  const recommendations: string[] = [];
  if (worst && worst.qualityScore < 70) {
    recommendations.push(`Worst region at (${worst.centerX.toFixed(0)}, ${worst.centerY.toFixed(0)}) — score ${worst.qualityScore}`);
  }
  for (const [issue, count] of Object.entries(issueDistribution)) {
    recommendations.push(`${count} cells with ${issue}`);
  }
  if (overallScore > 90) {
    recommendations.push('Overall print quality is excellent');
  }

  return {
    cells, gridSize: { x: gridResolution, y: gridResolution },
    overallScore,
    bestRegion: { x: best.centerX, y: best.centerY, score: best.qualityScore },
    worstRegion: { x: worst.centerX, y: worst.centerY, score: worst.qualityScore },
    issueDistribution, recommendations,
  };
}

// ── 4. CNC Workholding Analysis ──

export interface WorkholdingPoint {
  /** Clamp position X */
  x: number;
  /** Clamp position Y */
  y: number;
  /** Clamp force in N (estimated) */
  force: number;
  /** Clamp type */
  type: 'vise' | 'clamp' | 'vacuum' | 'magnetic' | 'custom';
}

export interface WorkholdingResult {
  /** Detected workholding points */
  points: WorkholdingPoint[];
  /** Workholding type */
  type: WorkholdingPoint['type'] | 'unknown';
  /** Estimated total clamping force in N */
  totalForce: number;
  /** Force distribution score (0-100) */
  forceDistributionScore: number;
  /** Whether workholding is adequate */
  isAdequate: boolean;
  /** Cutting force estimate in N */
  cuttingForceEstimate: number;
  /** Safety factor */
  safetyFactor: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze workholding strategy and force distribution.
 * Estimates cutting forces and compares with clamping forces.
 *
 * @param lines G-code lines
 * @param workholdingPoints Optional manual workholding points
 */
export function analyzeWorkholding(
  lines: string[],
  workholdingPoints: WorkholdingPoint[] = [],
): WorkholdingResult {
  // If no manual points, try to detect from comments
  const points = [...workholdingPoints];

  if (points.length === 0) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].toLowerCase();
      if (line.includes('vise') || line.includes('vice')) {
        points.push({ x: 0, y: 0, force: 5000, type: 'vise' });
        break;
      }
      if (line.includes('clamp')) {
        points.push({ x: 0, y: 0, force: 2000, type: 'clamp' });
        break;
      }
      if (line.includes('vacuum')) {
        points.push({ x: 0, y: 0, force: 1000, type: 'vacuum' });
        break;
      }
      if (line.includes('magnetic')) {
        points.push({ x: 0, y: 0, force: 3000, type: 'magnetic' });
        break;
      }
    }
  }

  // Estimate cutting forces from G-code
  let maxCuttingForce = 0;
  let rpm = 0;
  let feedRate = 0;
  let prevX = 0, prevY = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const sMatch = code.match(/\bS(\d*\.?\d+)/i);
    if (sMatch) rpm = parseFloat(sMatch[1]);

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) feedRate = parseFloat(fMatch[1]);

    if (/\bG1\b/i.test(code)) {
      const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
      const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);

      const x = xMatch ? parseFloat(xMatch[1]) : prevX;
      const y = yMatch ? parseFloat(yMatch[1]) : prevY;
      const z = zMatch ? parseFloat(zMatch[1]) : 0;

      if (z < 0 && feedRate > 0) {
        // Rough cutting force estimate: F = k * feedPerTooth * depth * width
        // k ≈ 2000 N/mm² for steel, 800 for aluminum
        const depth = Math.abs(z);
        const width = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
        const feedPerTooth = rpm > 0 ? feedRate / (rpm * 2) : 0.1;
        const force = 800 * feedPerTooth * depth * Math.min(width, 6);
        maxCuttingForce = Math.max(maxCuttingForce, force);
      }

      prevX = x; prevY = y;
    }
  }

  const totalForce = points.reduce((s, p) => s + p.force, 0);
  const type = points.length > 0 ? points[0].type : 'unknown';

  // Force distribution score: based on number of points and spread
  let forceDistributionScore = 50;
  if (points.length >= 4) forceDistributionScore = 90;
  else if (points.length >= 2) forceDistributionScore = 70;
  else if (points.length >= 1) forceDistributionScore = 40;

  const safetyFactor = maxCuttingForce > 0 ? totalForce / maxCuttingForce : 0;
  const isAdequate = safetyFactor >= 2.0; // Minimum safety factor of 2

  const recommendations: string[] = [];
  if (points.length === 0) {
    recommendations.push('No workholding detected — specify clamping method');
  }
  if (safetyFactor < 2.0 && safetyFactor > 0) {
    recommendations.push(`Safety factor ${safetyFactor.toFixed(1)} is below 2.0 — increase clamping force`);
  }
  if (points.length < 2) {
    recommendations.push('Consider adding more clamping points for better force distribution');
  }
  if (isAdequate) {
    recommendations.push(`Workholding is adequate (safety factor: ${safetyFactor.toFixed(1)})`);
  }

  return {
    points, type, totalForce, forceDistributionScore,
    isAdequate, cuttingForceEstimate: maxCuttingForce,
    safetyFactor, recommendations,
  };
}

// ── 5. Print Material Flow Analysis ──

export interface MaterialFlowSegment {
  /** Line number */
  line: number;
  /** Extrusion rate in mm³/s */
  extrusionRate: number;
  /** Volumetric flow in mm³/s */
  volumetricFlow: number;
  /** Linear speed in mm/s */
  linearSpeed: number;
  /** Layer height in mm */
  layerHeight: number;
  /** Extrusion width in mm */
  extrusionWidth: number;
  /** Whether flow is consistent */
  isConsistent: boolean;
}

export interface MaterialFlowResult {
  /** Per-segment flow data */
  segments: MaterialFlowSegment[];
  /** Average volumetric flow */
  avgVolumetricFlow: number;
  /** Max volumetric flow */
  maxVolumetricFlow: number;
  /** Flow consistency score (0-100) */
  consistencyScore: number;
  /** Flow variation (coefficient of variation) */
  flowVariation: number;
  /** Estimated extrusion width */
  estimatedWidth: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze material flow dynamics during extrusion.
 * Computes volumetric flow rates and consistency.
 *
 * @param lines G-code lines
 * @param nozzleDiameter Nozzle diameter in mm (default 0.4)
 * @param filamentDiameter Filament diameter in mm (default 1.75)
 */
export function analyzeMaterialFlow(
  lines: string[],
  nozzleDiameter: number = 0.4,
  filamentDiameter: number = 1.75,
): MaterialFlowResult {
  const segments: MaterialFlowSegment[] = [];
  let feedRate = 0;
  let prevX = 0, prevY = 0, prevZ = 0, prevE = 0;
  const filamentArea = Math.PI * (filamentDiameter / 2) ** 2;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG1\b/i.test(code)) continue;

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) feedRate = parseFloat(fMatch[1]);

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const z = zMatch ? parseFloat(zMatch[1]) : prevZ;
    const e = eMatch ? parseFloat(eMatch[1]) : prevE;

    const eDelta = e - prevE;
    const distance = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);

    if (eDelta > 0 && distance > 0 && feedRate > 0) {
      const linearSpeed = feedRate / 60; // mm/s
      const extrusionRate = eDelta * filamentArea; // mm³
      const volumetricFlow = (eDelta / distance) * filamentArea * linearSpeed; // mm³/s
      const layerHeight = Math.abs(z - prevZ) > 0.01 ? Math.abs(z - prevZ) : 0.2;
      const extrusionWidth = distance > 0 ? (eDelta * filamentArea) / (distance * layerHeight) : nozzleDiameter;
      const expectedFlow = nozzleDiameter * layerHeight * linearSpeed;
      const isConsistent = Math.abs(volumetricFlow - expectedFlow) < expectedFlow * 0.2;

      segments.push({
        line: i, extrusionRate, volumetricFlow, linearSpeed,
        layerHeight, extrusionWidth, isConsistent,
      });
    }

    prevX = x; prevY = y; prevZ = z; prevE = e;
  }

  const flows = segments.map(s => s.volumetricFlow);
  const avgVolumetricFlow = flows.length > 0 ? flows.reduce((a, b) => a + b, 0) / flows.length : 0;
  const maxVolumetricFlow = flows.length > 0 ? Math.max(...flows) : 0;

  const stdDev = flows.length > 0
    ? Math.sqrt(flows.reduce((s, f) => s + (f - avgVolumetricFlow) ** 2, 0) / flows.length)
    : 0;
  const flowVariation = avgVolumetricFlow > 0 ? stdDev / avgVolumetricFlow : 0;

  const consistentCount = segments.filter(s => s.isConsistent).length;
  const consistencyScore = segments.length > 0 ? (consistentCount / segments.length) * 100 : 100;

  const estimatedWidth = segments.length > 0
    ? segments.reduce((s, seg) => s + seg.extrusionWidth, 0) / segments.length
    : nozzleDiameter;

  const recommendations: string[] = [];
  if (flowVariation > 0.3) {
    recommendations.push(`High flow variation (CV=${flowVariation.toFixed(2)}) — check extruder consistency`);
  }
  if (consistencyScore < 70) {
    recommendations.push(`Flow consistency ${consistencyScore.toFixed(0)}% — consider pressure advance tuning`);
  }
  if (estimatedWidth > nozzleDiameter * 1.2) {
    recommendations.push(`Extrusion width ${estimatedWidth.toFixed(2)}mm exceeds nozzle ${nozzleDiameter}mm — possible over-extrusion`);
  }
  if (segments.length === 0) {
    recommendations.push('No extrusion segments found for flow analysis');
  }

  return {
    segments, avgVolumetricFlow, maxVolumetricFlow,
    consistencyScore, flowVariation, estimatedWidth, recommendations,
  };
}

// ── 6. G-code Flow Visualization ──

export interface FlowNode {
  /** Node ID */
  id: string;
  /** Node type */
  type: 'start' | 'motion' | 'tool_change' | 'spindle' | 'dwell' | 'end' | 'branch';
  /** Line number */
  line: number;
  /** Label */
  label: string;
  /** Position in flow (for rendering) */
  level: number;
}

export interface FlowEdge {
  /** Source node ID */
  source: string;
  /** Target node ID */
  target: string;
  /** Edge label */
  label: string;
}

export interface FlowVisualizationResult {
  /** All nodes */
  nodes: FlowNode[];
  /** All edges */
  edges: FlowEdge[];
  /** Node count */
  nodeCount: number;
  /** Edge count */
  edgeCount: number;
  /** Maximum depth */
  maxDepth: number;
  /** Flow summary */
  summary: string;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Generate flow visualization data for G-code execution path.
 * Creates a directed graph of the execution flow.
 *
 * @param lines G-code lines
 * @param maxNodes Maximum nodes to generate (default 100)
 */
export function generateFlowVisualization(
  lines: string[],
  maxNodes: number = 100,
): FlowVisualizationResult {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  let level = 0;
  let prevNodeId: string | null = null;

  // Start node
  nodes.push({ id: 'start', type: 'start', line: 0, label: 'Start', level: 0 });
  prevNodeId = 'start';
  let nodeIdx = 0;

  for (let i = 0; i < lines.length && nodes.length < maxNodes; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    let type: FlowNode['type'] | null = null;
    let label = '';

    if (/\bG28\b/i.test(code)) {
      type = 'motion'; label = 'Homing'; level++;
    } else if (/\bM6\b/i.test(code) || /\bM06\b/i.test(code)) {
      type = 'tool_change'; label = `Tool change`;
      const tMatch = code.match(/\bT(\d+)\b/i);
      if (tMatch) label += ` T${tMatch[1]}`;
      level++;
    } else if (/\bM[34]\b/i.test(code)) {
      type = 'spindle'; label = 'Spindle on';
      level++;
    } else if (/\bM5\b/i.test(code)) {
      type = 'spindle'; label = 'Spindle off';
      level++;
    } else if (/\bG4\b/i.test(code)) {
      type = 'dwell'; label = 'Dwell';
    } else if (/\bM30\b/i.test(code) || /\bM2\b/i.test(code)) {
      type = 'end'; label = 'Program end'; level++;
    } else if (/\bG1\b/i.test(code)) {
      // Only add significant motion nodes (every Nth to limit count)
      if (nodeIdx % 10 === 0) {
        type = 'motion'; label = `Motion L${i}`;
      }
      nodeIdx++;
    }

    if (type) {
      const nodeId = `node_${nodes.length}`;
      nodes.push({ id: nodeId, type, line: i, label, level });
      if (prevNodeId) {
        edges.push({ source: prevNodeId, target: nodeId, label: '' });
      }
      prevNodeId = nodeId;
    }
  }

  // End node if not already present
  if (prevNodeId && nodes[nodes.length - 1].type !== 'end') {
    const endId = 'end';
    nodes.push({ id: endId, type: 'end', line: lines.length - 1, label: 'End', level: level + 1 });
    edges.push({ source: prevNodeId, target: endId, label: '' });
  }

  const maxDepth = Math.max(...nodes.map(n => n.level));
  const summary = `${nodes.length} nodes, ${edges.length} edges, depth ${maxDepth}`;

  const recommendations: string[] = [];
  if (nodes.length >= maxNodes) {
    recommendations.push(`Flow visualization truncated at ${maxNodes} nodes — increase limit for full view`);
  }
  const toolChanges = nodes.filter(n => n.type === 'tool_change').length;
  if (toolChanges > 0) {
    recommendations.push(`${toolChanges} tool changes in flow`);
  }
  if (maxDepth > 20) {
    recommendations.push(`Deep flow (${maxDepth} levels) — consider simplifying`);
  }

  return {
    nodes, edges, nodeCount: nodes.length, edgeCount: edges.length,
    maxDepth, summary, recommendations,
  };
}

// ── 7. CNC Fixture Optimization ──

export interface FixtureRecommendation {
  /** Fixture type */
  type: 'vise' | 'clamp' | 'vacuum' | 'magnetic';
  /** Position X */
  x: number;
  /** Position Y */
  y: number;
  /** Reason */
  reason: string;
  /** Priority (1 = highest) */
  priority: number;
}

export interface FixtureOptimizationResult {
  /** Recommended fixtures */
  recommendations: FixtureRecommendation[];
  /** Part bounds */
  partBounds: { minX: number; maxX: number; minY: number; maxY: number };
  /** Part area in mm² */
  partArea: number;
  /** Number of fixtures recommended */
  fixtureCount: number;
  /** Estimated clamping force needed in N */
  estimatedForce: number;
  /** Clearance check */
  hasClearance: boolean;
  /** Text recommendations */
  advice: string[];
}

/**
 * Optimize fixture placement and clamping strategy.
 * Analyzes part geometry and cutting forces to recommend fixture positions.
 *
 * @param lines G-code lines
 * @param machineBedSize Machine bed size { x, y } in mm
 */
export function optimizeFixturePlacement(
  lines: string[],
  machineBedSize: { x: number; y: number } = { x: 200, y: 200 },
): FixtureOptimizationResult {
  // Find part bounds
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let prevX = 0, prevY = 0;
  let maxCuttingForce = 0;
  let feedRate = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) feedRate = parseFloat(fMatch[1]);

    if (/\bG[01]\b/i.test(code)) {
      const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
      const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);

      const x = xMatch ? parseFloat(xMatch[1]) : prevX;
      const y = yMatch ? parseFloat(yMatch[1]) : prevY;
      const z = zMatch ? parseFloat(zMatch[1]) : 0;

      if (z < 0) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        if (feedRate > 0) {
          maxCuttingForce = Math.max(maxCuttingForce, 800 * 0.1 * Math.abs(z) * 3);
        }
      }

      prevX = x; prevY = y;
    }
  }

  if (!isFinite(minX)) {
    return {
      recommendations: [], partBounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
      partArea: 0, fixtureCount: 0, estimatedForce: 0,
      hasClearance: false,
      advice: ['No part geometry found for fixture optimization'],
    };
  }

  const partWidth = maxX - minX;
  const partHeight = maxY - minY;
  const partArea = partWidth * partHeight;

  // Recommend fixtures at corners
  const fixtureRecs: FixtureRecommendation[] = [];
  const corners = [
    { x: minX - 10, y: minY - 10, label: 'bottom-left' },
    { x: maxX + 10, y: minY - 10, label: 'bottom-right' },
    { x: minX - 10, y: maxY + 10, label: 'top-left' },
    { x: maxX + 10, y: maxY + 10, label: 'top-right' },
  ];

  for (let i = 0; i < corners.length; i++) {
    const c = corners[i];
    const inBed = c.x >= 0 && c.x <= machineBedSize.x && c.y >= 0 && c.y <= machineBedSize.y;
    fixtureRecs.push({
      type: 'clamp',
      x: c.x, y: c.y,
      reason: `Corner ${c.label}${inBed ? '' : ' (outside bed!)'}`,
      priority: i + 1,
    });
  }

  // For small parts, recommend vise
  if (partArea < 1000) {
    fixtureRecs.unshift({
      type: 'vise', x: minX, y: minY,
      reason: 'Small part — use vise',
      priority: 1,
    });
  }

  // For large flat parts, recommend vacuum
  if (partArea > 10000 && partHeight < 10) {
    fixtureRecs.unshift({
      type: 'vacuum', x: (minX + maxX) / 2, y: (minY + maxY) / 2,
      reason: 'Large flat part — use vacuum table',
      priority: 1,
    });
  }

  const estimatedForce = maxCuttingForce * 2; // Safety factor 2
  const hasClearance = (minX > 10 && minY > 10 &&
    maxX < machineBedSize.x - 10 && maxY < machineBedSize.y - 10);

  const recommendations: string[] = [];
  if (!hasClearance) {
    recommendations.push('Part extends near bed edges — ensure fixture clearance');
  }
  recommendations.push(`Part size: ${partWidth.toFixed(0)}x${partHeight.toFixed(0)}mm`);
  recommendations.push(`Estimated clamping force needed: ${estimatedForce.toFixed(0)}N`);
  for (const r of fixtureRecs.slice(0, 2)) {
    recommendations.push(`${r.type} at (${r.x.toFixed(0)}, ${r.y.toFixed(0)}): ${r.reason}`);
  }

  return {
    recommendations: fixtureRecs,
    partBounds: { minX, maxX, minY, maxY },
    partArea, fixtureCount: fixtureRecs.length,
    estimatedForce, hasClearance, advice: recommendations,
  };
}

// ── 8. Print Layer Visualization Data ──

export interface LayerVisualizationData {
  /** Layer number */
  layer: number;
  /** Start line */
  startLine: number;
  /** End line */
  endLine: number;
  /** Z height */
  zHeight: number;
  /** Layer time in seconds */
  layerTime: number;
  /** Distance in mm */
  distance: number;
  /** Extrusion amount */
  extrusion: number;
  /** Average feed rate */
  avgFeedRate: number;
  /** Bounding box */
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  /** Color (for visualization) */
  color: string;
}

export interface LayerVisualizationResult {
  /** Per-layer data */
  layers: LayerVisualizationData[];
  /** Total layers */
  layerCount: number;
  /** Total time */
  totalTime: number;
  /** Total distance */
  totalDistance: number;
  /** Total extrusion */
  totalExtrusion: number;
  /** Average layer time */
  avgLayerTime: number;
  /** Color palette */
  colorPalette: string[];
  /** Recommendations */
  recommendations: string[];
}

/**
 * Generate per-layer visualization metadata.
 * Useful for layer-by-layer visualization and analysis.
 *
 * @param lines G-code lines
 */
export function generateLayerVisualization(lines: string[]): LayerVisualizationResult {
  const layers: LayerVisualizationData[] = [];
  let currentZ = 0;
  let prevZ = 0;
  let layerStartLine = 0;
  let layerStartTime = 0;
  let layerDistance = 0;
  let layerExtrusion = 0;
  let layerFeedRates: number[] = [];
  let layerMinX = Infinity, layerMaxX = -Infinity, layerMinY = Infinity, layerMaxY = -Infinity;
  let prevX = 0, prevY = 0, prevE = 0;
  let feedRate = 0;
  let totalTime = 0;
  let layerNum = 0;

  // Color palette (gradient from blue to red)
  const colorPalette: string[] = [];
  for (let i = 0; i < 256; i++) {
    const r = Math.round((i / 255) * 255);
    const b = Math.round((1 - i / 255) * 255);
    colorPalette.push(`rgb(${r},0,${b})`);
  }

  const finalizeLayer = (endLine: number) => {
    if (layerDistance > 0 || layerExtrusion > 0) {
      const avgFeedRate = layerFeedRates.length > 0
        ? layerFeedRates.reduce((a, b) => a + b, 0) / layerFeedRates.length
        : 0;
      const colorIdx = Math.min(255, Math.floor((layerNum / Math.max(1, layers.length + 1)) * 255));

      layers.push({
        layer: layerNum,
        startLine: layerStartLine,
        endLine,
        zHeight: currentZ,
        layerTime: totalTime - layerStartTime,
        distance: layerDistance,
        extrusion: layerExtrusion,
        avgFeedRate,
        bounds: {
          minX: isFinite(layerMinX) ? layerMinX : 0,
          maxX: isFinite(layerMaxX) ? layerMaxX : 0,
          minY: isFinite(layerMinY) ? layerMinY : 0,
          maxY: isFinite(layerMaxY) ? layerMaxY : 0,
        },
        color: colorPalette[colorIdx],
      });
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    if (zMatch) {
      const newZ = parseFloat(zMatch[1]);
      if (newZ > currentZ + 0.01) {
        // Layer change
        finalizeLayer(i);
        layerNum++;
        layerStartLine = i;
        layerStartTime = totalTime;
        layerDistance = 0;
        layerExtrusion = 0;
        layerFeedRates = [];
        layerMinX = Infinity; layerMaxX = -Infinity;
        layerMinY = Infinity; layerMaxY = -Infinity;
        prevZ = currentZ;
        currentZ = newZ;
      }
    }

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) feedRate = parseFloat(fMatch[1]);

    if (/\bG1\b/i.test(code)) {
      const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
      const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

      const x = xMatch ? parseFloat(xMatch[1]) : prevX;
      const y = yMatch ? parseFloat(yMatch[1]) : prevY;
      const e = eMatch ? parseFloat(eMatch[1]) : prevE;

      const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
      layerDistance += dist;

      if (e > prevE) {
        layerExtrusion += e - prevE;
        layerMinX = Math.min(layerMinX, x);
        layerMaxX = Math.max(layerMaxX, x);
        layerMinY = Math.min(layerMinY, y);
        layerMaxY = Math.max(layerMaxY, y);
      }

      if (feedRate > 0 && dist > 0) {
        totalTime += dist / (feedRate / 60);
        layerFeedRates.push(feedRate);
      }

      prevX = x; prevY = y; prevE = e;
    }
  }

  finalizeLayer(lines.length - 1);

  const totalDistance = layers.reduce((s, l) => s + l.distance, 0);
  const totalExtrusion = layers.reduce((s, l) => s + l.extrusion, 0);
  const avgLayerTime = layers.length > 0 ? totalTime / layers.length : 0;

  const recommendations: string[] = [];
  if (layers.length > 0) {
    recommendations.push(`${layers.length} layers, total time ${(totalTime / 60).toFixed(1)} min`);
  }
  const slowLayers = layers.filter(l => l.layerTime > avgLayerTime * 2);
  if (slowLayers.length > 0) {
    recommendations.push(`${slowLayers.length} layers significantly slower than average`);
  }
  const thinLayers = layers.filter(l => l.zHeight - (layers[l.layer - 1]?.zHeight ?? 0) > 0.3);
  if (thinLayers.length > 0) {
    recommendations.push(`${thinLayers.length} layers with thick Z height (>0.3mm)`);
  }
  if (layers.length === 0) {
    recommendations.push('No layers detected — check Z movements');
  }

  return {
    layers, layerCount: layers.length, totalTime,
    totalDistance, totalExtrusion, avgLayerTime,
    colorPalette, recommendations,
  };
}

// ── 9. G-code Compression Analysis ──

export interface CompressionAnalysisResult {
  /** Original size in bytes */
  originalSize: number;
  /** Estimated compressed size in bytes */
  compressedSize: number;
  /** Compression ratio */
  compressionRatio: number;
  /** Space savings percentage */
  spaceSavings: number;
  /** Redundancy score (0-100) */
  redundancyScore: number;
  /** Optimization opportunities */
  opportunities: { type: string; potentialSavings: number; description: string }[];
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze G-code compression opportunities.
 * Identifies redundant data and estimates compression potential.
 *
 * @param lines G-code lines
 */
export function analyzeCompressionOpportunities(lines: string[]): CompressionAnalysisResult {
  const originalSize = lines.join('\n').length;

  // Count redundancy
  const lineCounts = new Map<string, number>();
  let commentSize = 0;
  let whitespaceSize = 0;
  let duplicateCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();

    if (trimmed.startsWith(';') || trimmed.startsWith('(')) {
      commentSize += line.length;
    }

    whitespaceSize += line.length - trimmed.length;

    if (code) {
      const count = lineCounts.get(code) ?? 0;
      if (count > 0) duplicateCount++;
      lineCounts.set(code, count + 1);
    }
  }

  // Estimate compressed size (rough estimate)
  // G-code typically compresses to 30-50% of original with gzip
  const estimatedCompressedSize = Math.round(originalSize * 0.35);
  const compressionRatio = originalSize / Math.max(1, estimatedCompressedSize);
  const spaceSavings = ((originalSize - estimatedCompressedSize) / originalSize) * 100;

  const redundancyScore = Math.min(100, (duplicateCount / Math.max(1, lines.length)) * 100);

  const opportunities: { type: string; potentialSavings: number; description: string }[] = [];

  if (commentSize > originalSize * 0.1) {
    opportunities.push({
      type: 'comments', potentialSavings: commentSize,
      description: `${commentSize} bytes in comments — strip for smaller file`,
    });
  }

  if (whitespaceSize > 0) {
    opportunities.push({
      type: 'whitespace', potentialSavings: whitespaceSize,
      description: `${whitespaceSize} bytes in whitespace — minimize spacing`,
    });
  }

  if (duplicateCount > 10) {
    opportunities.push({
      type: 'duplicates', potentialSavings: duplicateCount * 20,
      description: `${duplicateCount} duplicate commands — use subprograms`,
    });
  }

  // Check for unnecessary precision
  let highPrecisionCount = 0;
  for (const line of lines) {
    const matches = line.matchAll(/-?\d+\.\d{4,}/g);
    for (const m of matches) highPrecisionCount++;
  }
  if (highPrecisionCount > 50) {
    opportunities.push({
      type: 'precision', potentialSavings: highPrecisionCount * 3,
      description: `${highPrecisionCount} values with >3 decimal places — reduce precision`,
    });
  }

  const recommendations: string[] = [];
  recommendations.push(`Estimated compression: ${spaceSavings.toFixed(0)}% (ratio ${compressionRatio.toFixed(1)}:1)`);
  for (const opp of opportunities.slice(0, 3)) {
    recommendations.push(`${opp.type}: ${opp.description}`);
  }
  if (opportunities.length === 0) {
    recommendations.push('G-code is already well-compressed');
  }

  return {
    originalSize, compressedSize: estimatedCompressedSize,
    compressionRatio, spaceSavings, redundancyScore,
    opportunities, recommendations,
  };
}

// ── 10. Tool Path Aerodynamics Analysis ──

export interface AerodynamicsResult {
  /** Total air cutting time in seconds */
  airCuttingTime: number;
  /** Total material cutting time in seconds */
  materialCuttingTime: number;
  /** Air cutting percentage */
  airCuttingPercentage: number;
  /** Total air cutting distance in mm */
  airCuttingDistance: number;
  /** Total material cutting distance in mm */
  materialCuttingDistance: number;
  /** Air/material ratio */
  airToMaterialRatio: number;
  /** Efficiency score (0-100) */
  efficiencyScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze air cutting vs material cutting time.
 * Air cutting (rapid moves above material) is wasted time.
 *
 * @param lines G-code lines
 */
export function analyzeAerodynamics(lines: string[]): AerodynamicsResult {
  let airCuttingTime = 0;
  let materialCuttingTime = 0;
  let airCuttingDistance = 0;
  let materialCuttingDistance = 0;
  let feedRate = 0;
  let prevX = 0, prevY = 0, prevZ = 0;
  let prevE = 0;
  let currentZ = 0;
  let materialTopZ = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) feedRate = parseFloat(fMatch[1]);

    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    if (zMatch) currentZ = parseFloat(zMatch[1]);

    if (!/\bG[01]\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch2 = code.match(/\bZ(-?\d*\.?\d+)/i);
    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const z = zMatch2 ? parseFloat(zMatch2[1]) : prevZ;
    const e = eMatch ? parseFloat(eMatch[1]) : prevE;

    const distance = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2 + (z - prevZ) ** 2);
    const isRapid = /\bG0\b/i.test(code);
    const isCutting = (e > prevE) || (z < materialTopZ && !isRapid);

    if (distance > 0 && feedRate > 0) {
      const time = distance / (feedRate / 60);
      if (isCutting) {
        materialCuttingTime += time;
        materialCuttingDistance += distance;
      } else {
        airCuttingTime += time;
        airCuttingDistance += distance;
      }
    } else if (isRapid && distance > 0) {
      // Rapid moves: estimate at max speed (e.g., 5000 mm/min)
      const rapidTime = distance / (5000 / 60);
      airCuttingTime += rapidTime;
      airCuttingDistance += distance;
    }

    prevX = x; prevY = y; prevZ = z; prevE = e;
  }

  const totalTime = airCuttingTime + materialCuttingTime;
  const airCuttingPercentage = totalTime > 0 ? (airCuttingTime / totalTime) * 100 : 0;
  const airToMaterialRatio = materialCuttingTime > 0 ? airCuttingTime / materialCuttingTime : 0;
  const efficiencyScore = Math.max(0, 100 - airCuttingPercentage);

  const recommendations: string[] = [];
  if (airCuttingPercentage > 50) {
    recommendations.push(`${airCuttingPercentage.toFixed(0)}% air cutting — optimize toolpath to reduce wasted time`);
  }
  if (airToMaterialRatio > 1) {
    recommendations.push(`Air/material ratio ${airToMaterialRatio.toFixed(1)} — more time in air than cutting`);
  }
  if (airCuttingDistance > materialCuttingDistance * 2) {
    recommendations.push('Air cutting distance is 2x material cutting — optimize travel moves');
  }
  if (efficiencyScore > 80) {
    recommendations.push('Good aerodynamic efficiency — minimal air cutting');
  }

  return {
    airCuttingTime, materialCuttingTime, airCuttingPercentage,
    airCuttingDistance, materialCuttingDistance,
    airToMaterialRatio, efficiencyScore, recommendations,
  };
}

// ── 11. Print Speed Adaptive Analysis ──

export interface AdaptiveSpeedSegment {
  /** Line number */
  line: number;
  /** Current feed rate */
  currentFeedRate: number;
  /** Recommended feed rate */
  recommendedFeedRate: number;
  /** Reason for recommendation */
  reason: string;
  /** Potential time savings in seconds */
  timeSavings: number;
}

export interface AdaptiveSpeedResult {
  /** Per-segment speed recommendations */
  segments: AdaptiveSpeedSegment[];
  /** Total potential time savings in seconds */
  totalTimeSavings: number;
  /** Average current speed */
  avgCurrentSpeed: number;
  /** Average recommended speed */
  avgRecommendedSpeed: number;
  /** Speed optimization score (0-100) */
  optimizationScore: number;
  /** Number of segments with recommendations */
  recommendationCount: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze adaptive speed control opportunities.
 * Identifies segments where speed could be increased or decreased
 * for optimal print quality and time.
 *
 * @param lines G-code lines
 */
export function analyzeAdaptiveSpeed(lines: string[]): AdaptiveSpeedResult {
  const segments: AdaptiveSpeedSegment[] = [];
  let feedRate = 0;
  let prevX = 0, prevY = 0, prevZ = 0;
  let currentZ = 0;
  let layerStartZ = 0;
  let isFirstLayer = true;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    if (zMatch) {
      const newZ = parseFloat(zMatch[1]);
      if (newZ > currentZ + 0.01) {
        // Layer change
        if (currentZ > 0) isFirstLayer = false;
        layerStartZ = newZ;
        currentZ = newZ;
      }
    }

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) feedRate = parseFloat(fMatch[1]);

    if (!/\bG1\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;

    if (eMatch && feedRate > 0) {
      const distance = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
      let recommendedFeedRate = feedRate;
      let reason = '';
      let timeSavings = 0;

      // First layer: slower for adhesion
      if (isFirstLayer && feedRate > 1200) {
        recommendedFeedRate = 1200;
        reason = 'First layer — reduce speed for adhesion';
        timeSavings = distance / (feedRate / 60) - distance / (recommendedFeedRate / 60);
      }

      // Short segments: could speed up
      if (distance < 1 && feedRate < 3000) {
        recommendedFeedRate = Math.min(3600, feedRate * 1.5);
        reason = 'Short segment — increase speed';
        timeSavings = distance / (feedRate / 60) - distance / (recommendedFeedRate / 60);
      }

      // Long straight segments: could speed up
      if (distance > 50 && feedRate < 3000) {
        recommendedFeedRate = Math.min(3600, feedRate * 1.2);
        reason = 'Long straight segment — increase speed';
        timeSavings = distance / (feedRate / 60) - distance / (recommendedFeedRate / 60);
      }

      if (reason) {
        segments.push({
          line: i, currentFeedRate: feedRate,
          recommendedFeedRate, reason, timeSavings,
        });
      }
    }

    prevX = x; prevY = y; prevZ = currentZ;
  }

  const totalTimeSavings = segments.reduce((s, seg) => s + seg.timeSavings, 0);
  const avgCurrentSpeed = segments.length > 0
    ? segments.reduce((s, seg) => s + seg.currentFeedRate, 0) / segments.length
    : 0;
  const avgRecommendedSpeed = segments.length > 0
    ? segments.reduce((s, seg) => s + seg.recommendedFeedRate, 0) / segments.length
    : 0;
  const optimizationScore = Math.min(100, segments.length * 2);
  const recommendationCount = segments.length;

  const recommendations: string[] = [];
  if (totalTimeSavings > 60) {
    recommendations.push(`Potential time savings: ${(totalTimeSavings / 60).toFixed(1)} min`);
  }
  if (segments.length > 0) {
    recommendations.push(`${segments.length} segments with speed optimization opportunities`);
  }
  const firstLayerRecs = segments.filter(s => s.reason.includes('First layer'));
  if (firstLayerRecs.length > 0) {
    recommendations.push(`${firstLayerRecs.length} first-layer segments — slow down for adhesion`);
  }
  if (segments.length === 0) {
    recommendations.push('Speed is well-optimized — no adaptive changes needed');
  }

  return {
    segments, totalTimeSavings, avgCurrentSpeed, avgRecommendedSpeed,
    optimizationScore, recommendationCount, recommendations,
  };
}

// ── 12. G-code Dependency Graph Visualization ──

export interface DependencyGraphNode {
  /** Node ID */
  id: string;
  /** Node label */
  label: string;
  /** Node type */
  type: 'operation' | 'tool' | 'spindle' | 'motion' | 'homing' | 'end';
  /** Line number */
  line: number;
  /** Dependencies (node IDs) */
  dependencies: string[];
  /** Dependents (node IDs that depend on this) */
  dependents: string[];
  /** Critical path member */
  isCriticalPath: boolean;
  /** Level in graph */
  level: number;
}

export interface DependencyGraphResult {
  /** All nodes */
  nodes: DependencyGraphNode[];
  /** Edges (source → target) */
  edges: { source: string; target: string }[];
  /** Critical path */
  criticalPath: string[];
  /** Maximum depth */
  maxDepth: number;
  /** Node count */
  nodeCount: number;
  /** Edge count */
  edgeCount: number;
  /** Parallelizable operations count */
  parallelizableCount: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Generate a dependency graph for G-code operations.
 * Shows which operations depend on others and identifies the critical path.
 *
 * @param lines G-code lines
 */
export function generateDependencyGraph(lines: string[]): DependencyGraphResult {
  const nodes: DependencyGraphNode[] = [];
  const edges: { source: string; target: string }[] = [];
  let nodeIdx = 0;
  let lastHomingId: string | null = null;
  let lastToolChangeId: string | null = null;
  let lastSpindleStartId: string | null = null;
  let lastMotionId: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    let type: DependencyGraphNode['type'] | null = null;
    let label = '';
    let deps: string[] = [];

    if (/\bG28\b/i.test(code)) {
      type = 'homing'; label = 'Homing';
    } else if (/\bM6\b/i.test(code) || /\bM06\b/i.test(code)) {
      type = 'tool'; label = 'Tool change';
      const tMatch = code.match(/\bT(\d+)\b/i);
      if (tMatch) label += ` T${tMatch[1]}`;
      if (lastHomingId) deps.push(lastHomingId);
    } else if (/\bM[34]\b/i.test(code)) {
      type = 'spindle'; label = 'Spindle on';
      if (lastHomingId) deps.push(lastHomingId);
    } else if (/\bM5\b/i.test(code)) {
      type = 'spindle'; label = 'Spindle off';
      if (lastSpindleStartId) deps.push(lastSpindleStartId);
    } else if (/\bG1\b/i.test(code) && i % 20 === 0) {
      type = 'motion'; label = `Motion L${i}`;
      if (lastToolChangeId) deps.push(lastToolChangeId);
      if (lastSpindleStartId) deps.push(lastSpindleStartId);
    } else if (/\bM30\b/i.test(code) || /\bM2\b/i.test(code)) {
      type = 'end'; label = 'Program end';
      if (lastMotionId) deps.push(lastMotionId);
    }

    if (type) {
      const id = `node_${nodeIdx}`;
      const node: DependencyGraphNode = {
        id, label, type, line: i,
        dependencies: deps, dependents: [],
        isCriticalPath: false, level: 0,
      };
      nodes.push(node);

      for (const dep of deps) {
        edges.push({ source: dep, target: id });
        const depNode = nodes.find(n => n.id === dep);
        if (depNode) depNode.dependents.push(id);
      }

      if (type === 'homing') lastHomingId = id;
      if (type === 'tool') lastToolChangeId = id;
      if (type === 'spindle' && label.includes('on')) lastSpindleStartId = id;
      if (type === 'motion') lastMotionId = id;

      nodeIdx++;
    }
  }

  // Calculate levels
  const calculateLevel = (id: string, visited: Set<string>): number => {
    if (visited.has(id)) return 0;
    visited.add(id);
    const node = nodes.find(n => n.id === id);
    if (!node) return 0;
    if (node.dependencies.length === 0) return 0;
    const maxDepLevel = Math.max(...node.dependencies.map(d => calculateLevel(d, visited)));
    return maxDepLevel + 1;
  };

  for (const node of nodes) {
    node.level = calculateLevel(node.id, new Set());
  }

  const maxDepth = nodes.length > 0 ? Math.max(...nodes.map(n => n.level)) : 0;

  // Find critical path (longest path)
  const criticalPath: string[] = [];
  const endNode = nodes.find(n => n.type === 'end');
  if (endNode) {
    let current: DependencyGraphNode | undefined = endNode;
    while (current) {
      criticalPath.unshift(current.id);
      current.isCriticalPath = true;
      // Find the dependency with the highest level
      if (current.dependencies.length > 0) {
        current = nodes.find(n => n.id === current!.dependencies[0]);
      } else {
        current = undefined;
      }
    }
  }

  // Count parallelizable operations (nodes with no dependencies on each other)
  const parallelizableCount = nodes.filter(n => n.dependencies.length === 0).length;

  const recommendations: string[] = [];
  if (criticalPath.length > 0) {
    recommendations.push(`Critical path: ${criticalPath.length} operations`);
  }
  if (parallelizableCount > 1) {
    recommendations.push(`${parallelizableCount} operations could potentially be parallelized`);
  }
  if (maxDepth > 10) {
    recommendations.push(`Deep dependency chain (${maxDepth} levels) — consider simplifying`);
  }
  if (nodes.length === 0) {
    recommendations.push('No operations found for dependency graph');
  }

  return {
    nodes, edges, criticalPath, maxDepth,
    nodeCount: nodes.length, edgeCount: edges.length,
    parallelizableCount, recommendations,
  };
}
