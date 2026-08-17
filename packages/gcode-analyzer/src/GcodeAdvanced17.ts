/**
 * @file GcodeAdvanced17.ts
 * @brief Seventeenth batch of advanced G-code analysis features for CNC and 3D printing.
 *
 * This module provides 12 additional high-impact features:
 *  1. G-code idle time analyzer (Universal) — non-productive time analysis
 *  2. CNC tool path overlap quantifier (CNC) — overlap percentage
 *  3. Print flow rate calibration advisor (3DP) — flow rate adjustments
 *  4. G-code memory usage estimator (Universal) — processing memory
 *  5. CNC cutting parameter validator (CNC) — validate against recommendations
 *  6. Print layer shift risk detector (3DP) — layer shift risk
 *  7. G-code execution path optimizer (Universal) — optimize execution order
 *  8. CNC tool nose radius compensation calculator (CNC) — nose radius compensation
 *  9. Print elephant foot compensation analyzer (3DP) — elephant foot analysis
 * 10. G-code comment density analyzer (Universal) — documentation density
 * 11. CNC rapid traverse optimizer (CNC) — optimize rapid traverse
 * 12. Print skirt/brim analyzer (3DP) — skirt and brim analysis
 */

// ── 1. G-code Idle Time Analyzer ──

export interface IdleSegment {
  /** Start line */
  startLine: number;
  /** End line */
  endLine: number;
  /** Duration in seconds */
  duration: number;
  /** Idle type */
  type: 'travel' | 'dwell' | 'tool_change' | 'spindle_wait' | 'heat_wait' | 'other';
  /** Description */
  description: string;
}

export interface IdleTimeResult {
  /** Idle segments */
  segments: IdleSegment[];
  /** Total idle time in seconds */
  totalIdleTime: number;
  /** Total active time in seconds */
  totalActiveTime: number;
  /** Idle percentage */
  idlePercentage: number;
  /** By type */
  byType: { [type: string]: { count: number; duration: number } };
  /** Efficiency score (0-100, higher is better) */
  efficiencyScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze non-productive (idle) time in G-code.
 * Identifies travel, dwell, tool change, and heat wait times.
 *
 * @param lines G-code lines
 */
export function analyzeIdleTime(lines: string[]): IdleTimeResult {
  const segments: IdleSegment[] = [];
  let feedRate = 0;
  let prevX = 0, prevY = 0, prevZ = 0, prevE = 0;
  let currentTime = 0;
  let totalIdleTime = 0;
  let totalActiveTime = 0;
  const byType: { [type: string]: { count: number; duration: number } } = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) feedRate = parseFloat(fMatch[1]);

    let idleType: IdleSegment['type'] | null = null;
    let duration = 0;
    let description = '';

    // Dwell
    if (/\bG4\b/i.test(code)) {
      const pMatch = code.match(/\bP(\d*\.?\d+)/i);
      const sMatch = code.match(/\bS(\d*\.?\d+)/i);
      duration = pMatch ? parseFloat(pMatch[1]) / 1000 : sMatch ? parseFloat(sMatch[1]) : 0;
      idleType = 'dwell';
      description = `Dwell ${duration.toFixed(2)}s`;
    }
    // Tool change
    else if (/\bM6\b/i.test(code) || /\bM06\b/i.test(code)) {
      duration = 30;
      idleType = 'tool_change';
      description = 'Tool change';
    }
    // Heat wait (M109, M190)
    else if (/\bM109\b/i.test(code) || /\bM190\b/i.test(code)) {
      duration = 60;
      idleType = 'heat_wait';
      description = 'Heat wait';
    }
    // Spindle wait
    else if (/\bM03\b/i.test(code) && /\bS(\d+)/i.test(code) && parseInt(code.match(/\bS(\d+)/i)![1]) > 0) {
      duration = 2;
      idleType = 'spindle_wait';
      description = 'Spindle spin-up';
    }
    // Travel move (G0 or G1 without extrusion)
    else if (/\bG[01]\b/i.test(code)) {
      const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
      const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
      const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

      const x = xMatch ? parseFloat(xMatch[1]) : prevX;
      const y = yMatch ? parseFloat(yMatch[1]) : prevY;
      const z = zMatch ? parseFloat(zMatch[1]) : prevZ;
      const e = eMatch ? parseFloat(eMatch[1]) : prevE;

      const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2 + (z - prevZ) ** 2);
      const isExtruding = e > prevE;
      const isRapid = /\bG0\b/i.test(code);

      if (dist > 0 && feedRate > 0) {
        duration = dist / (feedRate / 60);
        if (isRapid || !isExtruding) {
          idleType = 'travel';
          description = `Travel ${dist.toFixed(1)}mm`;
        } else {
          totalActiveTime += duration;
        }
      }

      prevX = x; prevY = y; prevZ = z; prevE = e;
    }

    if (idleType && duration > 0) {
      currentTime += duration;
      totalIdleTime += duration;
      segments.push({
        startLine: i, endLine: i, duration, type: idleType, description,
      });
      if (!byType[idleType]) byType[idleType] = { count: 0, duration: 0 };
      byType[idleType].count++;
      byType[idleType].duration += duration;
    }
  }

  const totalTime = totalIdleTime + totalActiveTime;
  const idlePercentage = totalTime > 0 ? (totalIdleTime / totalTime) * 100 : 0;
  const efficiencyScore = Math.max(0, 100 - idlePercentage);

  const recommendations: string[] = [];
  if (idlePercentage > 50) {
    recommendations.push(`${idlePercentage.toFixed(0)}% idle time — optimize travel and tool changes`);
  }
  if (byType.tool_change && byType.tool_change.duration > 60) {
    recommendations.push(`Tool changes: ${byType.tool_change.duration.toFixed(0)}s — minimize tool count`);
  }
  if (byType.travel && byType.travel.duration > totalActiveTime) {
    recommendations.push(`Travel time exceeds active time — optimize part placement`);
  }
  for (const [type, data] of Object.entries(byType)) {
    recommendations.push(`${type}: ${data.count} events, ${data.duration.toFixed(1)}s`);
  }

  return {
    segments, totalIdleTime, totalActiveTime, idlePercentage,
    byType, efficiencyScore, recommendations,
  };
}

// ── 2. CNC Tool Path Overlap Quantifier ──

export interface OverlapRegion {
  /** Grid X */
  gridX: number;
  /** Grid Y */
  gridY: number;
  /** Pass count */
  passCount: number;
  /** Overlap percentage */
  overlapPercentage: number;
  /** Total cutting distance in cell */
  totalDistance: number;
}

export interface OverlapQuantifierResult {
  /** Overlap regions */
  regions: OverlapRegion[];
  /** Grid size */
  gridSize: { x: number; y: number };
  /** Average overlap percentage */
  avgOverlap: number;
  /** Max overlap percentage */
  maxOverlap: number;
  /** Total overlapping distance in mm */
  totalOverlapDistance: number;
  /** Overlap efficiency score (0-100, higher is better) */
  overlapScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Quantify tool path overlap percentage.
 * Shows how much the toolpath overlaps itself, indicating redundant cutting.
 *
 * @param lines G-code lines
 * @param gridResolution Grid resolution (default 10)
 * @param toolDiameter Tool diameter in mm (default 6)
 */
export function quantifyToolpathOverlap(
  lines: string[],
  gridResolution: number = 10,
  toolDiameter: number = 6,
): OverlapQuantifierResult {
  let prevX = 0, prevY = 0, prevZ = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const segments: { x1: number; y1: number; x2: number; y2: number; dist: number }[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG1\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const z = zMatch ? parseFloat(zMatch[1]) : prevZ;

    if (z < 0) {
      const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
      if (dist > 0.01) {
        segments.push({ x1: prevX, y1: prevY, x2: x, y2: y, dist });
        minX = Math.min(minX, x, prevX);
        maxX = Math.max(maxX, x, prevX);
        minY = Math.min(minY, y, prevY);
        maxY = Math.max(maxY, y, prevY);
      }
    }

    prevX = x; prevY = y; prevZ = z;
  }

  if (segments.length === 0 || !isFinite(minX)) {
    return {
      regions: [], gridSize: { x: 0, y: 0 }, avgOverlap: 0, maxOverlap: 0,
      totalOverlapDistance: 0, overlapScore: 100,
      recommendations: ['No cutting operations for overlap analysis'],
    };
  }

  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const cellW = rangeX / gridResolution;
  const cellH = rangeY / gridResolution;

  const grid: OverlapRegion[][] = [];
  for (let gx = 0; gx < gridResolution; gx++) {
    grid[gx] = [];
    for (let gy = 0; gy < gridResolution; gy++) {
      grid[gx][gy] = { gridX: gx, gridY: gy, passCount: 0, overlapPercentage: 0, totalDistance: 0 };
    }
  }

  for (const seg of segments) {
    const midX = (seg.x1 + seg.x2) / 2;
    const midY = (seg.y1 + seg.y2) / 2;
    const gx = Math.min(gridResolution - 1, Math.max(0, Math.floor((midX - minX) / cellW)));
    const gy = Math.min(gridResolution - 1, Math.max(0, Math.floor((midY - minY) / cellH)));
    grid[gx][gy].passCount++;
    grid[gx][gy].totalDistance += seg.dist;
  }

  const regions: OverlapRegion[] = [];
  for (let gx = 0; gx < gridResolution; gx++) {
    for (let gy = 0; gy < gridResolution; gy++) {
      const cell = grid[gx][gy];
      // Overlap percentage: if passCount > 1, there's overlap
      // Expected distance per pass = cell diagonal
      const expectedDist = Math.sqrt(cellW ** 2 + cellH ** 2);
      cell.overlapPercentage = cell.passCount > 1
        ? Math.min(100, ((cell.totalDistance - expectedDist) / cell.totalDistance) * 100)
        : 0;
      regions.push(cell);
    }
  }

  const activeRegions = regions.filter(r => r.passCount > 0);
  const avgOverlap = activeRegions.length > 0
    ? activeRegions.reduce((s, r) => s + r.overlapPercentage, 0) / activeRegions.length : 0;
  const maxOverlap = activeRegions.length > 0 ? Math.max(...activeRegions.map(r => r.overlapPercentage)) : 0;
  const totalOverlapDistance = activeRegions.reduce((s, r) => s + (r.totalDistance * r.overlapPercentage / 100), 0);
  const overlapScore = Math.max(0, 100 - avgOverlap);

  const recommendations: string[] = [];
  if (avgOverlap > 30) {
    recommendations.push(`High overlap (${avgOverlap.toFixed(0)}%) — optimize toolpath strategy`);
  }
  if (maxOverlap > 80) {
    recommendations.push(`Max overlap ${maxOverlap.toFixed(0)}% — redundant cutting detected`);
  }
  if (totalOverlapDistance > 100) {
    recommendations.push(`${totalOverlapDistance.toFixed(0)}mm of overlapping toolpath — reduce for efficiency`);
  }
  if (overlapScore > 80) {
    recommendations.push('Low overlap — efficient toolpath');
  }

  return {
    regions, gridSize: { x: gridResolution, y: gridResolution },
    avgOverlap, maxOverlap, totalOverlapDistance, overlapScore, recommendations,
  };
}

// ── 3. Print Flow Rate Calibration Advisor ──

export interface FlowRateAdvice {
  /** Current flow rate percentage */
  currentFlowRate: number;
  /** Recommended flow rate percentage */
  recommendedFlowRate: number;
  /** Adjustment needed */
  adjustment: number;
  /** Reason */
  reason: string;
  /** Confidence (0-100) */
  confidence: number;
}

export interface FlowRateCalibrationResult {
  /** Advice */
  advice: FlowRateAdvice;
  /** Estimated extrusion width */
  estimatedWidth: number;
  /** Expected width */
  expectedWidth: number;
  /** Width deviation percentage */
  widthDeviation: number;
  /** Over-extrusion indicator */
  overExtrusion: boolean;
  /** Under-extrusion indicator */
  underExtrusion: boolean;
  /** Calibration score (0-100) */
  calibrationScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Advise flow rate adjustments based on extrusion analysis.
 *
 * @param lines G-code lines
 * @param nozzleDiameter Nozzle diameter in mm (default 0.4)
 * @param filamentDiameter Filament diameter in mm (default 1.75)
 */
export function adviseFlowRateCalibration(
  lines: string[],
  nozzleDiameter: number = 0.4,
  filamentDiameter: number = 1.75,
): FlowRateCalibrationResult {
  let prevX = 0, prevY = 0, prevZ = 0, prevE = 0;
  let currentZ = 0;
  const filamentArea = Math.PI * (filamentDiameter / 2) ** 2;
  const widths: number[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG1\b/i.test(code)) continue;

    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    if (zMatch) currentZ = parseFloat(zMatch[1]);

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const e = eMatch ? parseFloat(eMatch[1]) : prevE;

    if (e > prevE && currentZ > 0) {
      const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
      const eDelta = e - prevE;
      const volume = eDelta * filamentArea;
      if (dist > 0) {
        const width = volume / (dist * currentZ);
        widths.push(width);
      }
    }

    prevX = x; prevY = y; prevZ = currentZ; prevE = e;
  }

  const expectedWidth = nozzleDiameter * 1.2;
  const estimatedWidth = widths.length > 0 ? widths.reduce((a, b) => a + b, 0) / widths.length : expectedWidth;
  const widthDeviation = expectedWidth > 0 ? ((estimatedWidth - expectedWidth) / expectedWidth) * 100 : 0;
  const overExtrusion = widthDeviation > 5;
  const underExtrusion = widthDeviation < -5;

  const currentFlowRate = 100;
  const recommendedFlowRate = Math.max(80, Math.min(120, 100 - widthDeviation));
  const adjustment = recommendedFlowRate - currentFlowRate;

  const reason = overExtrusion
    ? `Over-extrusion detected: width ${estimatedWidth.toFixed(3)}mm vs expected ${expectedWidth.toFixed(3)}mm`
    : underExtrusion
    ? `Under-extrusion detected: width ${estimatedWidth.toFixed(3)}mm vs expected ${expectedWidth.toFixed(3)}mm`
    : 'Flow rate is well-calibrated';

  const confidence = Math.min(100, Math.abs(widthDeviation) * 10 + 50);
  const calibrationScore = Math.max(0, 100 - Math.abs(widthDeviation) * 2);

  const advice: FlowRateAdvice = {
    currentFlowRate, recommendedFlowRate, adjustment, reason, confidence,
  };

  const recommendations: string[] = [];
  if (overExtrusion) {
    recommendations.push(`Reduce flow rate by ${Math.abs(adjustment).toFixed(0)}% (to ${recommendedFlowRate.toFixed(0)}%)`);
  }
  if (underExtrusion) {
    recommendations.push(`Increase flow rate by ${Math.abs(adjustment).toFixed(0)}% (to ${recommendedFlowRate.toFixed(0)}%)`);
  }
  if (!overExtrusion && !underExtrusion) {
    recommendations.push('Flow rate is well-calibrated — no adjustment needed');
  }
  recommendations.push(`Width deviation: ${widthDeviation.toFixed(1)}%`);

  return {
    advice, estimatedWidth, expectedWidth, widthDeviation,
    overExtrusion, underExtrusion, calibrationScore, recommendations,
  };
}

// ── 4. G-code Memory Usage Estimator ──

export interface MemoryEstimateResult {
  /** Estimated memory for toolpath in bytes */
  toolpathMemory: number;
  /** Estimated memory for state tracking in bytes */
  stateMemory: number;
  /** Estimated memory for annotations in bytes */
  annotationMemory: number;
  /** Total estimated memory in bytes */
  totalMemory: number;
  /** Total estimated memory in MB */
  totalMemoryMB: number;
  /** Memory category breakdown */
  breakdown: { [category: string]: number };
  /** Memory pressure level */
  pressureLevel: 'low' | 'medium' | 'high';
  /** Recommendations */
  recommendations: string[];
}

/**
 * Estimate memory needed to process G-code.
 * Useful for determining if streaming processing is needed.
 *
 * @param lines G-code lines
 */
export function estimateMemoryUsage(lines: string[]): MemoryEstimateResult {
  let motionCount = 0;
  let commentCount = 0;
  let toolChangeCount = 0;
  let stateVarCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith(';') || trimmed.startsWith('(')) {
      commentCount++;
      continue;
    }

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    if (/\bG[01]\b/i.test(code)) {
      motionCount++;
    }
    if (/\bM6\b/i.test(code) || /\bM06\b/i.test(code)) {
      toolChangeCount++;
    }
    // Count state variables (modal state, offsets, etc.)
    if (/\b[GM]\d+/i.test(code)) {
      stateVarCount++;
    }
  }

  // Memory estimates (bytes per item)
  const MOTION_BYTES = 64; // x, y, z, e, f, flags
  const COMMENT_BYTES = 128; // text + metadata
  const TOOL_CHANGE_BYTES = 256; // tool info + state
  const STATE_BYTES = 32; // modal state per command

  const toolpathMemory = motionCount * MOTION_BYTES;
  const annotationMemory = commentCount * COMMENT_BYTES;
  const stateMemory = stateVarCount * STATE_BYTES + toolChangeCount * TOOL_CHANGE_BYTES;
  const totalMemory = toolpathMemory + annotationMemory + stateMemory;
  const totalMemoryMB = totalMemory / (1024 * 1024);

  const breakdown = {
    toolpath: toolpathMemory,
    annotations: annotationMemory,
    state: stateMemory,
  };

  let pressureLevel: MemoryEstimateResult['pressureLevel'];
  if (totalMemoryMB < 10) pressureLevel = 'low';
  else if (totalMemoryMB < 100) pressureLevel = 'medium';
  else pressureLevel = 'high';

  const recommendations: string[] = [];
  recommendations.push(`Estimated memory: ${totalMemoryMB.toFixed(2)}MB for ${lines.length} lines`);
  if (pressureLevel === 'high') {
    recommendations.push('High memory pressure — consider streaming processing');
  }
  if (motionCount > 100000) {
    recommendations.push(`${motionCount} motion points — use chunked rendering`);
  }
  if (pressureLevel === 'low') {
    recommendations.push('Low memory usage — safe for in-memory processing');
  }

  return {
    toolpathMemory, stateMemory, annotationMemory,
    totalMemory, totalMemoryMB, breakdown, pressureLevel,
    recommendations,
  };
}

// ── 5. CNC Cutting Parameter Validator ──

export interface ParameterViolation {
  /** Parameter name */
  parameter: string;
  /** Current value */
  current: number;
  /** Recommended range */
  recommended: { min: number; max: number };
  /** Violation type */
  type: 'too_high' | 'too_low';
  /** Severity */
  severity: 'low' | 'medium' | 'high';
  /** Suggestion */
  suggestion: string;
}

export interface ParameterValidationResult {
  /** All violations */
  violations: ParameterViolation[];
  /** Violation count */
  count: number;
  /** By severity */
  bySeverity: { low: number; medium: number; high: number };
  /** Validation score (0-100, higher is better) */
  validationScore: number;
  /** Material detected */
  material: string;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Validate cutting parameters against material-specific recommendations.
 *
 * @param lines G-code lines
 * @param material Material type (default 'aluminum')
 * @param toolDiameter Tool diameter in mm (default 6)
 * @param flutes Number of flutes (default 2)
 */
export function validateCuttingParameters(
  lines: string[],
  material: string = 'aluminum',
  toolDiameter: number = 6,
  flutes: number = 2,
): ParameterValidationResult {
  // Recommended parameter ranges by material
  const ranges: { [material: string]: {
    rpm: { min: number; max: number };
    feed: { min: number; max: number };
    doc: { min: number; max: number };
    chipLoad: { min: number; max: number };
  } } = {
    aluminum: { rpm: { min: 5000, max: 20000 }, feed: { min: 500, max: 5000 }, doc: { min: 0.5, max: 6 }, chipLoad: { min: 0.05, max: 0.15 } },
    steel: { rpm: { min: 1000, max: 5000 }, feed: { min: 100, max: 1000 }, doc: { min: 0.2, max: 2 }, chipLoad: { min: 0.03, max: 0.08 } },
    stainless: { rpm: { min: 800, max: 4000 }, feed: { min: 80, max: 800 }, doc: { min: 0.1, max: 1.5 }, chipLoad: { min: 0.02, max: 0.06 } },
    wood: { rpm: { min: 10000, max: 24000 }, feed: { min: 1000, max: 8000 }, doc: { min: 1, max: 10 }, chipLoad: { min: 0.1, max: 0.3 } },
    plastic: { rpm: { min: 5000, max: 15000 }, feed: { min: 500, max: 4000 }, doc: { min: 0.5, max: 5 }, chipLoad: { min: 0.1, max: 0.25 } },
  };

  const range = ranges[material] ?? ranges.aluminum;
  const violations: ParameterViolation[] = [];
  let rpm = 0;
  let feedRate = 0;
  let maxDOC = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const sMatch = code.match(/\bS(\d*\.?\d+)/i);
    if (sMatch) rpm = parseFloat(sMatch[1]);

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) feedRate = parseFloat(fMatch[1]);

    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    if (zMatch) {
      const z = parseFloat(zMatch[1]);
      if (z < 0) maxDOC = Math.max(maxDOC, Math.abs(z));
    }
  }

  // Validate RPM
  if (rpm > 0) {
    if (rpm > range.rpm.max) {
      violations.push({
        parameter: 'RPM', current: rpm, recommended: range.rpm,
        type: 'too_high', severity: 'high',
        suggestion: `Reduce RPM to ${range.rpm.min}-${range.rpm.max} for ${material}`,
      });
    } else if (rpm < range.rpm.min) {
      violations.push({
        parameter: 'RPM', current: rpm, recommended: range.rpm,
        type: 'too_low', severity: 'medium',
        suggestion: `Increase RPM to ${range.rpm.min}-${range.rpm.max} for ${material}`,
      });
    }
  }

  // Validate feed rate
  if (feedRate > 0) {
    if (feedRate > range.feed.max) {
      violations.push({
        parameter: 'Feed Rate', current: feedRate, recommended: range.feed,
        type: 'too_high', severity: 'high',
        suggestion: `Reduce feed to ${range.feed.min}-${range.feed.max} mm/min for ${material}`,
      });
    } else if (feedRate < range.feed.min) {
      violations.push({
        parameter: 'Feed Rate', current: feedRate, recommended: range.feed,
        type: 'too_low', severity: 'medium',
        suggestion: `Increase feed to ${range.feed.min}-${range.feed.max} mm/min for ${material}`,
      });
    }
  }

  // Validate DOC
  if (maxDOC > 0) {
    if (maxDOC > range.doc.max) {
      violations.push({
        parameter: 'Depth of Cut', current: maxDOC, recommended: range.doc,
        type: 'too_high', severity: 'high',
        suggestion: `Reduce DOC to ${range.doc.min}-${range.doc.max}mm for ${material}`,
      });
    }
  }

  // Validate chip load
  if (rpm > 0 && feedRate > 0) {
    const chipLoad = feedRate / (rpm * flutes);
    if (chipLoad > range.chipLoad.max) {
      violations.push({
        parameter: 'Chip Load', current: chipLoad, recommended: range.chipLoad,
        type: 'too_high', severity: 'medium',
        suggestion: `Reduce chip load to ${range.chipLoad.min}-${range.chipLoad.max} mm/tooth`,
      });
    } else if (chipLoad < range.chipLoad.min) {
      violations.push({
        parameter: 'Chip Load', current: chipLoad, recommended: range.chipLoad,
        type: 'too_low', severity: 'medium',
        suggestion: `Increase chip load to ${range.chipLoad.min}-${range.chipLoad.max} mm/tooth`,
      });
    }
  }

  const bySeverity = {
    low: violations.filter(v => v.severity === 'low').length,
    medium: violations.filter(v => v.severity === 'medium').length,
    high: violations.filter(v => v.severity === 'high').length,
  };

  const count = violations.length;
  const validationScore = Math.max(0, 100 - bySeverity.high * 25 - bySeverity.medium * 10 - bySeverity.low * 5);

  const recommendations: string[] = [];
  for (const v of violations) {
    recommendations.push(`${v.parameter}: ${v.suggestion}`);
  }
  if (count === 0) {
    recommendations.push(`All parameters within recommended range for ${material}`);
  }

  return {
    violations, count, bySeverity, validationScore, material, recommendations,
  };
}

// ── 6. Print Layer Shift Risk Detector ──

export interface LayerShiftRisk {
  /** Layer number */
  layer: number;
  /** Z height */
  zHeight: number;
  /** Risk level */
  riskLevel: 'low' | 'medium' | 'high';
  /** Risk factors */
  factors: string[];
  /** Risk score (0-100) */
  riskScore: number;
}

export interface LayerShiftResult {
  /** Per-layer risk data */
  layers: LayerShiftRisk[];
  /** High-risk layer count */
  highRiskCount: number;
  /** Average risk score */
  avgRiskScore: number;
  /** Overall shift risk level */
  overallRisk: 'low' | 'medium' | 'high';
  /** Recommendations */
  recommendations: string[];
}

/**
 * Detect potential layer shift risks.
 * Layer shifts occur from collisions, high speeds, and mechanical issues.
 *
 * @param lines G-code lines
 */
export function detectLayerShiftRisk(lines: string[]): LayerShiftResult {
  const layers: LayerShiftRisk[] = [];
  let currentZ = 0;
  let prevZ = 0;
  let layerNum = 0;
  let maxFeedRate = 0;
  let travelCount = 0;
  let rapidCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    if (zMatch) {
      const newZ = parseFloat(zMatch[1]);
      if (newZ > currentZ + 0.01 && layerNum > 0) {
        // Layer change — assess risk
        const factors: string[] = [];
        let riskScore = 0;

        if (maxFeedRate > 3000) {
          factors.push(`High feed rate (${maxFeedRate}mm/min)`);
          riskScore += 30;
        }
        if (rapidCount > 10) {
          factors.push(`${rapidCount} rapid moves in layer`);
          riskScore += 20;
        }
        if (travelCount > 20) {
          factors.push(`${travelCount} travel moves — collision risk`);
          riskScore += 25;
        }
        const layerHeight = newZ - prevZ;
        if (layerHeight > 0.4) {
          factors.push(`Thick layer (${layerHeight.toFixed(2)}mm)`);
          riskScore += 15;
        }

        riskScore = Math.min(100, riskScore);
        const riskLevel = riskScore > 60 ? 'high' : riskScore > 30 ? 'medium' : 'low';

        layers.push({ layer: layerNum, zHeight: newZ, riskLevel, factors, riskScore });

        prevZ = currentZ;
        currentZ = newZ;
        layerNum++;
        maxFeedRate = 0;
        travelCount = 0;
        rapidCount = 0;
      } else if (layerNum === 0) {
        currentZ = newZ;
        layerNum = 1;
      }
    }

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) maxFeedRate = Math.max(maxFeedRate, parseFloat(fMatch[1]));

    if (/\bG0\b/i.test(code)) {
      rapidCount++;
      travelCount++;
    } else if (/\bG1\b/i.test(code)) {
      const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);
      if (!eMatch) travelCount++;
    }
  }

  const highRiskCount = layers.filter(l => l.riskLevel === 'high').length;
  const avgRiskScore = layers.length > 0 ? layers.reduce((s, l) => s + l.riskScore, 0) / layers.length : 0;
  const overallRisk = avgRiskScore > 50 ? 'high' : avgRiskScore > 25 ? 'medium' : 'low';

  const recommendations: string[] = [];
  if (highRiskCount > 0) {
    recommendations.push(`${highRiskCount} layers with high shift risk — reduce speed or travel`);
  }
  if (overallRisk === 'high') {
    recommendations.push('High overall layer shift risk — check printer mechanics');
  }
  for (const l of layers.filter(l => l.riskLevel === 'high').slice(0, 3)) {
    recommendations.push(`Layer ${l.layer}: ${l.factors.join(', ')}`);
  }
  if (overallRisk === 'low') {
    recommendations.push('Low layer shift risk — stable print expected');
  }

  return {
    layers, highRiskCount, avgRiskScore, overallRisk, recommendations,
  };
}

// ── 7. G-code Execution Path Optimizer ──

export interface PathOptimization {
  /** Optimization type */
  type: string;
  /** Lines affected */
  linesAffected: number;
  /** Time saved in seconds */
  timeSaved: number;
  /** Description */
  description: string;
}

export interface ExecutionPathResult {
  /** Optimizations */
  optimizations: PathOptimization[];
  /** Original execution time in seconds */
  originalTime: number;
  /** Optimized execution time in seconds */
  optimizedTime: number;
  /** Total time saved in seconds */
  totalTimeSaved: number;
  /** Optimization percentage */
  optimizationPercentage: number;
  /** Optimization score (0-100) */
  optimizationScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Optimize G-code execution path for performance.
 * Identifies reorderable operations and travel optimizations.
 *
 * @param lines G-code lines
 */
export function optimizeExecutionPath(lines: string[]): ExecutionPathResult {
  const optimizations: PathOptimization[] = [];
  let feedRate = 0;
  let prevX = 0, prevY = 0, prevZ = 0;
  let originalTime = 0;
  let travelTime = 0;
  let dwellTime = 0;
  let toolChangeTime = 0;
  let redundantRapidCount = 0;
  let longTravelCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) feedRate = parseFloat(fMatch[1]);

    if (/\bG[01]\b/i.test(code)) {
      const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
      const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);

      const x = xMatch ? parseFloat(xMatch[1]) : prevX;
      const y = yMatch ? parseFloat(yMatch[1]) : prevY;
      const z = zMatch ? parseFloat(zMatch[1]) : prevZ;

      const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2 + (z - prevZ) ** 2);
      if (dist > 0 && feedRate > 0) {
        const time = dist / (feedRate / 60);
        originalTime += time;
        if (/\bG0\b/i.test(code)) {
          travelTime += time;
          if (dist > 50) longTravelCount++;
        }
      }
      prevX = x; prevY = y; prevZ = z;
    } else if (/\bG4\b/i.test(code)) {
      const pMatch = code.match(/\bP(\d*\.?\d+)/i);
      const dwell = pMatch ? parseFloat(pMatch[1]) / 1000 : 0;
      dwellTime += dwell;
      originalTime += dwell;
    } else if (/\bM6\b/i.test(code) || /\bM06\b/i.test(code)) {
      toolChangeTime += 30;
      originalTime += 30;
    }
  }

  // Identify optimizations
  if (travelTime > originalTime * 0.3) {
    const saved = travelTime * 0.2;
    optimizations.push({
      type: 'travel_optimization', linesAffected: longTravelCount,
      timeSaved: saved,
      description: `Optimize travel paths (${travelTime.toFixed(1)}s → save ~${saved.toFixed(1)}s)`,
    });
  }

  if (dwellTime > 5) {
    optimizations.push({
      type: 'dwell_reduction', linesAffected: 0,
      timeSaved: dwellTime * 0.5,
      description: `Reduce dwell times (${dwellTime.toFixed(1)}s → save ~${(dwellTime * 0.5).toFixed(1)}s)`,
    });
  }

  if (toolChangeTime > 60) {
    optimizations.push({
      type: 'tool_order', linesAffected: 0,
      timeSaved: toolChangeTime * 0.3,
      description: `Optimize tool change order (${toolChangeTime.toFixed(0)}s → save ~${(toolChangeTime * 0.3).toFixed(0)}s)`,
    });
  }

  if (redundantRapidCount > 0) {
    optimizations.push({
      type: 'redundant_rapid', linesAffected: redundantRapidCount,
      timeSaved: redundantRapidCount * 0.5,
      description: `Remove ${redundantRapidCount} redundant rapids`,
    });
  }

  const totalTimeSaved = optimizations.reduce((s, o) => s + o.timeSaved, 0);
  const optimizedTime = originalTime - totalTimeSaved;
  const optimizationPercentage = originalTime > 0 ? (totalTimeSaved / originalTime) * 100 : 0;
  const optimizationScore = Math.min(100, optimizationPercentage * 2);

  const recommendations: string[] = [];
  for (const opt of optimizations) {
    recommendations.push(`${opt.type}: ${opt.description}`);
  }
  recommendations.push(`Total savings: ${totalTimeSaved.toFixed(1)}s (${optimizationPercentage.toFixed(1)}%)`);
  if (optimizations.length === 0) {
    recommendations.push('No execution path optimizations needed');
  }

  return {
    optimizations, originalTime, optimizedTime, totalTimeSaved,
    optimizationPercentage, optimizationScore, recommendations,
  };
}

// ── 8. CNC Tool Nose Radius Compensation Calculator ──

export interface NoseCompensationPoint {
  /** Line number */
  line: number;
  /** Original X */
  originalX: number;
  /** Original Y */
  originalY: number;
  /** Compensated X */
  compensatedX: number;
  /** Compensated Y */
  compensatedY: number;
  /** Compensation direction */
  direction: 'left' | 'right';
  /** Compensation amount */
  amount: number;
}

export interface NoseCompensationResult {
  /** Compensation points */
  points: NoseCompensationPoint[];
  /** Nose radius used */
  noseRadius: number;
  /** Compensation direction */
  direction: 'left' | 'right';
  /** Total compensation distance */
  totalCompensation: number;
  /** Point count */
  pointCount: number;
  /** Compensation score (0-100) */
  compensationScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Calculate tool nose radius compensation.
 * Adjusts toolpath for the tool's nose radius to achieve accurate dimensions.
 *
 * @param lines G-code lines
 * @param noseRadius Tool nose radius in mm (default 0.4)
 * @param direction Compensation direction (default 'left')
 */
export function calculateNoseRadiusCompensation(
  lines: string[],
  noseRadius: number = 0.4,
  direction: 'left' | 'right' = 'left',
): NoseCompensationResult {
  const points: NoseCompensationPoint[] = [];
  let prevX = 0, prevY = 0;
  let totalCompensation = 0;

  // Check for G41/G42 (cutter compensation)
  let activeDirection: 'left' | 'right' | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Check for compensation activation
    if (/\bG41\b/i.test(code)) activeDirection = 'left';
    if (/\bG42\b/i.test(code)) activeDirection = 'right';
    if (/\bG40\b/i.test(code)) activeDirection = null;

    if (!/\bG1\b/i.test(code) || activeDirection === null) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;

    // Calculate compensation
    const dx = x - prevX;
    const dy = y - prevY;
    const len = Math.sqrt(dx * dx + dy * dy);

    if (len > 0) {
      // Perpendicular vector
      const perpX = -dy / len;
      const perpY = dx / len;

      // Apply compensation in the appropriate direction
      const sign = activeDirection === 'left' ? 1 : -1;
      const compX = x + perpX * noseRadius * sign;
      const compY = y + perpY * noseRadius * sign;

      points.push({
        line: i, originalX: x, originalY: y,
        compensatedX: compX, compensatedY: compY,
        direction: activeDirection, amount: noseRadius,
      });
      totalCompensation += noseRadius;
    }

    prevX = x; prevY = y;
  }

  const pointCount = points.length;
  const compensationScore = pointCount > 0 ? Math.min(100, 50 + pointCount) : 100;

  const recommendations: string[] = [];
  if (pointCount === 0) {
    recommendations.push('No cutter compensation (G41/G42) detected — add for accurate dimensions');
  } else {
    recommendations.push(`${pointCount} points compensated with ${noseRadius}mm nose radius (${direction})`);
  }
  if (noseRadius > 0.8) {
    recommendations.push(`Large nose radius (${noseRadius}mm) — ensure program accounts for it`);
  }
  if (totalCompensation > 100) {
    recommendations.push(`Total compensation: ${totalCompensation.toFixed(1)}mm`);
  }

  return {
    points, noseRadius, direction, totalCompensation,
    pointCount, compensationScore, recommendations,
  };
}

// ── 9. Print Elephant Foot Compensation Analyzer ──

export interface ElephantFootResult {
  /** First layer Z height */
  firstLayerZ: number;
  /** First layer extrusion width */
  firstLayerWidth: number;
  /** Expected width */
  expectedWidth: number;
  /** Squish ratio */
  squishRatio: number;
  /** Elephant foot severity */
  severity: 'none' | 'minor' | 'moderate' | 'severe';
  /** Recommended XY compensation in mm */
  recommendedCompensation: number;
  /** Recommended Z offset in mm */
  recommendedZOffset: number;
  /** Compensation score (0-100, higher is better) */
  compensationScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze elephant foot effect and recommend compensation.
 * Elephant foot occurs when the first layer is squished too much,
 * causing it to bulge outward.
 *
 * @param lines G-code lines
 * @param nozzleDiameter Nozzle diameter in mm (default 0.4)
 * @param filamentDiameter Filament diameter in mm (default 1.75)
 */
export function analyzeElephantFoot(
  lines: string[],
  nozzleDiameter: number = 0.4,
  filamentDiameter: number = 1.75,
): ElephantFootResult {
  let prevX = 0, prevY = 0, prevE = 0;
  let firstLayerZ = 0;
  let isFirstLayer = true;
  const firstLayerWidths: number[] = [];
  const filamentArea = Math.PI * (filamentDiameter / 2) ** 2;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || line.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG1\b/i.test(code)) continue;

    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    if (zMatch) {
      const z = parseFloat(zMatch[1]);
      if (firstLayerZ === 0) firstLayerZ = z;
      if (z > firstLayerZ + 0.3) isFirstLayer = false;
    }

    if (!isFirstLayer) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const e = eMatch ? parseFloat(eMatch[1]) : prevE;

    if (e > prevE && firstLayerZ > 0) {
      const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
      const eDelta = e - prevE;
      const volume = eDelta * filamentArea;
      if (dist > 0) {
        const width = volume / (dist * firstLayerZ);
        firstLayerWidths.push(width);
      }
    }

    prevX = x; prevY = y; prevE = e;
  }

  const expectedWidth = nozzleDiameter * 1.2;
  const firstLayerWidth = firstLayerWidths.length > 0
    ? firstLayerWidths.reduce((a, b) => a + b, 0) / firstLayerWidths.length
    : expectedWidth;
  const squishRatio = firstLayerWidth / nozzleDiameter;

  let severity: ElephantFootResult['severity'];
  if (squishRatio < 1.1) severity = 'none';
  else if (squishRatio < 1.3) severity = 'minor';
  else if (squishRatio < 1.5) severity = 'moderate';
  else severity = 'severe';

  // Recommended XY compensation (inward) to counteract bulge
  const recommendedCompensation = squishRatio > 1.2
    ? (squishRatio - 1.2) * nozzleDiameter * 0.5
    : 0;

  // Recommended Z offset to raise first layer
  const recommendedZOffset = squishRatio > 1.3 ? 0.05 : 0;

  const compensationScore = Math.max(0, 100 - (squishRatio - 1) * 100);

  const recommendations: string[] = [];
  if (severity === 'severe') {
    recommendations.push(`Severe elephant foot (squish ${squishRatio.toFixed(2)}) — raise Z by ${recommendedZOffset}mm`);
  }
  if (severity === 'moderate') {
    recommendations.push(`Moderate elephant foot — apply ${recommendedCompensation.toFixed(3)}mm XY compensation`);
  }
  if (severity === 'minor') {
    recommendations.push('Minor elephant foot — acceptable for most prints');
  }
  if (severity === 'none') {
    recommendations.push('No elephant foot detected — good first layer height');
  }
  if (firstLayerZ < 0.15) {
    recommendations.push(`Low first layer Z (${firstLayerZ}mm) — increase to reduce squish`);
  }

  return {
    firstLayerZ, firstLayerWidth, expectedWidth, squishRatio,
    severity, recommendedCompensation, recommendedZOffset,
    compensationScore, recommendations,
  };
}

// ── 10. G-code Comment Density Analyzer ──

export interface CommentDensityResult {
  /** Total lines */
  totalLines: number;
  /** Comment lines */
  commentLines: number;
  /** Inline comments */
  inlineComments: number;
  /** Comment density percentage */
  densityPercentage: number;
  /** Section headers detected */
  sectionHeaders: number;
  /** Tool change comments */
  toolChangeComments: number;
  /** Layer comments */
  layerComments: number;
  /** Documentation score (0-100) */
  documentationScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze documentation density in G-code.
 * Measures how well the G-code is documented with comments.
 *
 * @param lines G-code lines
 */
export function analyzeCommentDensity(lines: string[]): CommentDensityResult {
  let commentLines = 0;
  let inlineComments = 0;
  let sectionHeaders = 0;
  let toolChangeComments = 0;
  let layerComments = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    // Full line comment
    if (trimmed.startsWith(';') || trimmed.startsWith('(')) {
      commentLines++;
      // Check for section headers (e.g., ; --- SECTION ---)
      if (/^;[\s\-=_*]+/.test(trimmed) || /^;\s*SECTION/i.test(trimmed)) {
        sectionHeaders++;
      }
      // Check for tool change comments
      if (/;.*T\d+|;.*tool/i.test(trimmed)) {
        toolChangeComments++;
      }
      // Check for layer comments
      if (/;.*LAYER|;.*layer/i.test(trimmed)) {
        layerComments++;
      }
    }

    // Inline comment
    const codePart = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (codePart && (trimmed.includes(';') || trimmed.includes('('))) {
      inlineComments++;
    }
  }

  const totalLines = lines.length;
  const densityPercentage = totalLines > 0 ? ((commentLines + inlineComments) / totalLines) * 100 : 0;
  const documentationScore = Math.min(100, densityPercentage * 2 + sectionHeaders * 5 + toolChangeComments * 2 + layerComments * 2);

  const recommendations: string[] = [];
  if (densityPercentage < 5) {
    recommendations.push(`Low comment density (${densityPercentage.toFixed(0)}%) — add documentation`);
  }
  if (sectionHeaders === 0 && totalLines > 100) {
    recommendations.push('No section headers — add ; --- SECTION --- comments for readability');
  }
  if (toolChangeComments === 0) {
    recommendations.push('No tool change comments — add ; T1: 6mm end mill comments');
  }
  if (layerComments === 0 && totalLines > 50) {
    recommendations.push('No layer comments — add ; LAYER 1 comments for debugging');
  }
  if (documentationScore > 70) {
    recommendations.push('Good documentation — easy to debug and maintain');
  }

  return {
    totalLines, commentLines, inlineComments, densityPercentage,
    sectionHeaders, toolChangeComments, layerComments,
    documentationScore, recommendations,
  };
}

// ── 11. CNC Rapid Traverse Optimizer ──

export interface RapidOptimization {
  /** Line number */
  line: number;
  /** Original distance */
  originalDistance: number;
  /** Optimized distance */
  optimizedDistance: number;
  /** Distance saved */
  distanceSaved: number;
  /** Description */
  description: string;
}

export interface RapidTraverseResult {
  /** Optimizations */
  optimizations: RapidOptimization[];
  /** Total rapid distance */
  totalRapidDistance: number;
  /** Optimized rapid distance */
  optimizedRapidDistance: number;
  /** Total distance saved */
  totalDistanceSaved: number;
  /** Savings percentage */
  savingsPercentage: number;
  /** Optimization score (0-100) */
  optimizationScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Optimize rapid traverse paths.
 * Identifies opportunities to reduce rapid travel distance.
 *
 * @param lines G-code lines
 */
export function optimizeRapidTraverse(lines: string[]): RapidTraverseResult {
  const optimizations: RapidOptimization[] = [];
  let prevX = 0, prevY = 0, prevZ = 0;
  let totalRapidDistance = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG0\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const z = zMatch ? parseFloat(zMatch[1]) : prevZ;

    const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2 + (z - prevZ) ** 2);
    totalRapidDistance += dist;

    // Identify optimization: if Z is changing significantly with XY,
    // could split into Z-first then XY (or vice versa) for safety
    const xyDist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
    const zDist = Math.abs(z - prevZ);

    if (xyDist > 20 && zDist > 5) {
      // Combined move could be split for safety
      const optimizedDist = Math.max(xyDist, zDist); // Sequential is max, not sum
      const saved = dist - optimizedDist;
      if (saved > 1) {
        optimizations.push({
          line: i, originalDistance: dist,
          optimizedDistance: optimizedDist, distanceSaved: saved,
          description: `Split combined rapid into Z then XY`,
        });
      }
    }

    // Long rapid that could use a more direct path
    if (dist > 100) {
      optimizations.push({
        line: i, originalDistance: dist,
        optimizedDistance: dist * 0.9, distanceSaved: dist * 0.1,
        description: `Long rapid (${dist.toFixed(0)}mm) — optimize part placement`,
      });
    }

    prevX = x; prevY = y; prevZ = z;
  }

  const totalDistanceSaved = optimizations.reduce((s, o) => s + o.distanceSaved, 0);
  const optimizedRapidDistance = totalRapidDistance - totalDistanceSaved;
  const savingsPercentage = totalRapidDistance > 0 ? (totalDistanceSaved / totalRapidDistance) * 100 : 0;
  const optimizationScore = Math.min(100, savingsPercentage * 3);

  const recommendations: string[] = [];
  if (savingsPercentage > 10) {
    recommendations.push(`${savingsPercentage.toFixed(1)}% rapid distance savings possible`);
  }
  if (totalRapidDistance > 1000) {
    recommendations.push(`Total rapid: ${totalRapidDistance.toFixed(0)}mm — optimize part placement`);
  }
  for (const opt of optimizations.slice(0, 3)) {
    recommendations.push(`Line ${opt.line}: ${opt.description} (save ${opt.distanceSaved.toFixed(1)}mm)`);
  }
  if (optimizations.length === 0) {
    recommendations.push('Rapid traverse is already optimized');
  }

  return {
    optimizations, totalRapidDistance, optimizedRapidDistance,
    totalDistanceSaved, savingsPercentage, optimizationScore, recommendations,
  };
}

// ── 12. Print Skirt/Brim Analyzer ──

export interface SkirtBrimData {
  /** Type */
  type: 'skirt' | 'brim' | 'none';
  /** Line count */
  lineCount: number;
  /** Total distance in mm */
  totalDistance: number;
  /** Number of outlines */
  outlineCount: number;
  /** Offset from part in mm */
  offset: number;
  /** Extrusion amount in mm */
  extrusionAmount: number;
}

export interface SkirtBrimResult {
  /** Skirt/brim data */
  data: SkirtBrimData;
  /** Whether skirt/brim was detected */
  detected: boolean;
  /** Adhesion benefit score (0-100) */
  adhesionBenefitScore: number;
  /** Material waste in grams */
  materialWasteG: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze skirt and brim patterns.
 * Detects skirt/brim and evaluates their effectiveness.
 *
 * @param lines G-code lines
 * @param filamentDiameter Filament diameter in mm (default 1.75)
 * @param filamentDensity Filament density in g/cm³ (default 1.24)
 */
export function analyzeSkirtBrim(
  lines: string[],
  filamentDiameter: number = 1.75,
  filamentDensity: number = 1.24,
): SkirtBrimResult {
  let prevX = 0, prevY = 0, prevE = 0;
  let currentZ = 0;
  let firstZ = 0;
  let lineCount = 0;
  let totalDistance = 0;
  let extrusionAmount = 0;
  let outlineCount = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let partMinX = Infinity, partMaxX = -Infinity, partMinY = Infinity, partMaxY = -Infinity;
  let isBeforePart = true;
  const filamentArea = Math.PI * (filamentDiameter / 2) ** 2;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG1\b/i.test(code)) continue;

    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    if (zMatch) {
      currentZ = parseFloat(zMatch[1]);
      if (firstZ === 0) firstZ = currentZ;
    }

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const e = eMatch ? parseFloat(eMatch[1]) : prevE;

    if (e > prevE) {
      const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
      if (isBeforePart && currentZ <= firstZ) {
        // Could be skirt/brim
        lineCount++;
        totalDistance += dist;
        extrusionAmount += e - prevE;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      } else {
        // Part geometry
        isBeforePart = false;
        partMinX = Math.min(partMinX, x); partMaxX = Math.max(partMaxX, x);
        partMinY = Math.min(partMinY, y); partMaxY = Math.max(partMaxY, y);
      }
    }

    prevX = x; prevY = y; prevE = e;
  }

  // Determine if it's skirt or brim
  let type: SkirtBrimData['type'] = 'none';
  let offset = 0;

  if (lineCount > 0 && isFinite(partMinX)) {
    const skirtBounds = { minX, maxX, minY, maxY };
    const partBounds = { minX: partMinX, maxX: partMaxX, minY: partMinY, maxY: partMaxY };

    // Check if skirt is adjacent to part (brim) or offset (skirt)
    const gapX = Math.min(
      Math.abs(skirtBounds.maxX - partBounds.minX),
      Math.abs(partBounds.maxX - skirtBounds.minX),
    );
    const gapY = Math.min(
      Math.abs(skirtBounds.maxY - partBounds.minY),
      Math.abs(partBounds.maxY - skirtBounds.minY),
    );
    const gap = Math.min(gapX, gapY);

    if (gap < 1) {
      type = 'brim';
      offset = 0;
    } else {
      type = 'skirt';
      offset = gap;
    }

    // Estimate outline count from line count
    outlineCount = Math.max(1, Math.floor(lineCount / 4));
  }

  const detected = type !== 'none';
  const materialWasteG = (extrusionAmount * filamentArea / 1000) * filamentDensity;
  const adhesionBenefitScore = type === 'brim' ? 80 : type === 'skirt' ? 50 : 0;

  const data: SkirtBrimData = {
    type, lineCount, totalDistance, outlineCount, offset, extrusionAmount,
  };

  const recommendations: string[] = [];
  if (type === 'none') {
    recommendations.push('No skirt or brim detected — add brim for better adhesion');
  }
  if (type === 'skirt') {
    recommendations.push(`Skirt detected: ${lineCount} lines, ${outlineCount} outlines, ${offset.toFixed(1)}mm offset`);
    recommendations.push('Consider adding a brim for better adhesion');
  }
  if (type === 'brim') {
    recommendations.push(`Brim detected: ${lineCount} lines — good adhesion support`);
  }
  if (materialWasteG > 5) {
    recommendations.push(`Material waste: ${materialWasteG.toFixed(1)}g — reduce outlines if needed`);
  }

  return {
    data, detected, adhesionBenefitScore, materialWasteG, recommendations,
  };
}
