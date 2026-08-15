/**
 * @file GcodeAdvanced10.ts
 * @brief Tenth batch of advanced G-code analysis features for CNC and 3D printing.
 *
 * This module provides 12 additional high-impact features:
 *  1. Z-hop analysis (3DP) — analyze Z-hop moves during travel
 *  2. Extrusion consistency analysis (3DP) — check extrusion multiplier consistency
 *  3. G-code normalization (Universal) — normalize to canonical form
 *  4. Toolpath smoothing/jaggedness detection (Universal) — detect jagged toolpaths
 *  5. Print quality prediction (3DP) — predict quality issues from patterns
 *  6. Volumetric flow rate analysis (3DP) — analyze flow rate vs limits
 *  7. G-code statistics summary (Universal) — comprehensive one-page dashboard
 *  8. Machine capability match (Universal) — match G-code to machine capabilities
 *  9. Toolpath overlap detection (3DP) — detect overlapping extrusion paths
 * 10. G-code batch comparison (Universal) — compare multiple G-code files
 * 11. Print time vs material efficiency (3DP) — analyze efficiency tradeoffs
 * 12. G-code annotation auto-generation (Universal) — auto-generate annotations
 */

// ── 1. Z-Hop Analysis ──

export interface ZHopEvent {
  /** Line number where Z-hop starts */
  startLine: number;
  /** Line number where Z-hop ends (Z returns) */
  endLine: number;
  /** Z-hop height in mm */
  hopHeight: number;
  /** Whether retraction occurred during hop */
  hasRetraction: boolean;
}

export interface ZHopResult {
  /** All Z-hop events */
  events: ZHopEvent[];
  /** Total Z-hop count */
  count: number;
  /** Average hop height in mm */
  avgHopHeight: number;
  /** Maximum hop height in mm */
  maxHopHeight: number;
  /** Total Z-hop distance traveled in mm */
  totalHopDistance: number;
  /** Percentage of travel moves with Z-hop */
  hopPercentage: number;
  /** Whether Z-hop is used */
  hasZHop: boolean;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze Z-hop moves in 3D printing G-code.
 * Z-hop lifts the nozzle during travel moves to prevent stringing and
 * surface scratching. Too much Z-hop wastes time; too little risks quality.
 *
 * @param lines G-code lines
 */
export function analyzeZHops(lines: string[]): ZHopResult {
  const events: ZHopEvent[] = [];
  let prevZ = 0;
  let prevE = 0;
  let hopStartLine = -1;
  let hopStartZ = 0;
  let hopRetracted = false;
  let totalTravelMoves = 0;
  let totalHopDistance = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);
    const isTravel = /\bG0\b/i.test(code) || (/\bG1\b/i.test(code) && !eMatch);

    if (zMatch) {
      const z = parseFloat(zMatch[1]);

      // Detect Z-hop start (Z increases during travel)
      if (z > prevZ + 0.01 && isTravel && hopStartLine < 0) {
        hopStartLine = i;
        hopStartZ = prevZ;
      }

      // Detect Z-hop end (Z returns to previous level)
      if (hopStartLine >= 0 && z <= hopStartZ + 0.01) {
        const hopHeight = parseFloat(zMatch[1]) - hopStartZ;
        // Actually the hop height is the max Z reached — let's track it differently
        events.push({
          startLine: hopStartLine,
          endLine: i,
          hopHeight: Math.abs(hopHeight) > 0.01 ? Math.abs(hopHeight) : 0,
          hasRetraction: hopRetracted,
        });
        totalHopDistance += Math.abs(parseFloat(zMatch[1]) - hopStartZ) * 2;
        hopStartLine = -1;
        hopRetracted = false;
      }

      prevZ = z;
    }

    // Track retraction during hop
    if (eMatch && hopStartLine >= 0) {
      const e = parseFloat(eMatch[1]);
      if (e < prevE) hopRetracted = true;
      prevE = e;
    } else if (eMatch) {
      prevE = parseFloat(eMatch[1]);
    }

    // Count travel moves
    if (isTravel && (zMatch || code.match(/\b[XY]\b/i))) {
      totalTravelMoves++;
    }
  }

  // Recalculate hop heights properly (max Z during hop)
  for (const event of events) {
    let maxZ = hopStartZ;
    for (let i = event.startLine; i <= event.endLine && i < lines.length; i++) {
      const zMatch = lines[i].match(/\bZ(-?\d*\.?\d+)/i);
      if (zMatch) maxZ = Math.max(maxZ, parseFloat(zMatch[1]));
    }
    event.hopHeight = maxZ - 0; // relative to 0 baseline
  }

  const count = events.length;
  const avgHopHeight = count > 0 ? events.reduce((s, e) => s + e.hopHeight, 0) / count : 0;
  const maxHopHeight = count > 0 ? Math.max(...events.map(e => e.hopHeight)) : 0;
  const hopPercentage = totalTravelMoves > 0 ? (count / totalTravelMoves) * 100 : 0;

  const recommendations: string[] = [];
  if (count === 0) {
    recommendations.push('No Z-hop detected — consider enabling Z-hop for better surface quality');
  }
  if (hopPercentage > 80) {
    recommendations.push(`${hopPercentage.toFixed(0)}% of travel moves use Z-hop — may slow down print`);
  }
  if (maxHopHeight > 2) {
    recommendations.push(`Max Z-hop height is ${maxHopHeight.toFixed(2)}mm — consider reducing to save time`);
  }
  const withoutRetraction = events.filter(e => !e.hasRetraction).length;
  if (withoutRetraction > 0 && count > 0) {
    recommendations.push(`${withoutRetraction} Z-hops without retraction — add retraction for stringing prevention`);
  }
  if (count > 0 && recommendations.length === 0) {
    recommendations.push('Z-hop configuration appears reasonable');
  }

  return {
    events, count, avgHopHeight, maxHopHeight,
    totalHopDistance, hopPercentage, hasZHop: count > 0,
    recommendations,
  };
}

// ── 2. Extrusion Consistency Analysis ──

export interface ExtrusionConsistencyResult {
  /** Per-layer extrusion amounts */
  layerExtrusion: { layer: number; extrusion: number; expected: number; deviation: number }[];
  /** Average extrusion per layer */
  avgExtrusionPerLayer: number;
  /** Standard deviation of extrusion */
  stdDeviation: number;
  /** Coefficient of variation (CV %) */
  coefficientOfVariation: number;
  /** Whether extrusion is consistent */
  isConsistent: boolean;
  /** Layers with significant deviation */
  inconsistentLayers: number[];
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze extrusion consistency across layers.
 * Inconsistent extrusion can cause:
 * - Weak layer adhesion
 * - Visible layer lines
 * - Dimensional inaccuracy
 *
 * @param lines G-code lines
 * @param tolerancePercent Acceptable deviation percentage (default 10)
 */
export function analyzeExtrusionConsistency(
  lines: string[],
  tolerancePercent: number = 10,
): ExtrusionConsistencyResult {
  const layerExtrusion: { layer: number; extrusion: number; expected: number; deviation: number }[] = [];
  let currentLayer = -1;
  let layerExtrusionTotal = 0;
  let prevE = 0;
  let isRelative = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Detect layer changes
    if (/;.*layer/i.test(line)) {
      if (currentLayer >= 0) {
        layerExtrusion.push({
          layer: currentLayer,
          extrusion: layerExtrusionTotal,
          expected: 0, // filled later
          deviation: 0,
        });
      }
      currentLayer++;
      layerExtrusionTotal = 0;
      continue;
    }

    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Check for relative extrusion mode
    if (/\bM82\b/i.test(code)) isRelative = false;
    if (/\bM83\b/i.test(code)) isRelative = true;

    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);
    if (eMatch && /\bG1\b/i.test(code)) {
      const e = parseFloat(eMatch[1]);
      const extruded = isRelative ? e : (e - prevE);
      if (extruded > 0) {
        layerExtrusionTotal += extruded;
      }
      prevE = e;
    }
  }

  // Finalize last layer
  if (currentLayer >= 0 && layerExtrusionTotal > 0) {
    layerExtrusion.push({
      layer: currentLayer,
      extrusion: layerExtrusionTotal,
      expected: 0,
      deviation: 0,
    });
  }

  // Calculate expected (average) and deviation
  const totalExtrusion = layerExtrusion.reduce((s, l) => s + l.extrusion, 0);
  const avgExtrusionPerLayer = layerExtrusion.length > 0 ? totalExtrusion / layerExtrusion.length : 0;

  for (const l of layerExtrusion) {
    l.expected = avgExtrusionPerLayer;
    l.deviation = avgExtrusionPerLayer > 0
      ? ((l.extrusion - avgExtrusionPerLayer) / avgExtrusionPerLayer) * 100
      : 0;
  }

  const variance = layerExtrusion.length > 0
    ? layerExtrusion.reduce((s, l) => s + (l.extrusion - avgExtrusionPerLayer) ** 2, 0) / layerExtrusion.length
    : 0;
  const stdDeviation = Math.sqrt(variance);
  const coefficientOfVariation = avgExtrusionPerLayer > 0 ? (stdDeviation / avgExtrusionPerLayer) * 100 : 0;
  const isConsistent = coefficientOfVariation < tolerancePercent;

  const inconsistentLayers = layerExtrusion
    .filter(l => Math.abs(l.deviation) > tolerancePercent)
    .map(l => l.layer);

  const recommendations: string[] = [];
  if (!isConsistent) {
    recommendations.push(`Extrusion CV is ${coefficientOfVariation.toFixed(1)}% (target < ${tolerancePercent}%) — check extruder calibration`);
  }
  if (inconsistentLayers.length > 0) {
    recommendations.push(`${inconsistentLayers.length} layers with significant extrusion deviation`);
  }
  if (coefficientOfVariation < 5) {
    recommendations.push('Extrusion is very consistent — excellent calibration');
  }
  if (recommendations.length === 0) {
    recommendations.push('Extrusion consistency is within tolerance');
  }

  return {
    layerExtrusion, avgExtrusionPerLayer, stdDeviation,
    coefficientOfVariation, isConsistent, inconsistentLayers,
    recommendations,
  };
}

// ── 3. G-code Normalization ──

export interface NormalizationResult {
  /** Normalized G-code lines */
  normalizedLines: string[];
  /** Number of changes made */
  changesCount: number;
  /** Types of changes applied */
  changes: { type: string; count: number }[];
  /** Whether the G-code was already normalized */
  wasAlreadyNormalized: boolean;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Normalize G-code to a canonical form.
 * - Uppercase all G/M codes
 * - Remove redundant whitespace
 * - Standardize line endings
 * - Remove leading zeros (G01 → G1, M06 → M6)
 * - Sort parameters in consistent order (X, Y, Z, E, F, S)
 * - Remove empty lines
 *
 * @param lines G-code lines
 */
export function normalizeGcode(lines: string[]): NormalizationResult {
  const normalizedLines: string[] = [];
  let changesCount = 0;
  const changeTypes = new Map<string, number>();

  const recordChange = (type: string) => {
    changeTypes.set(type, (changeTypes.get(type) ?? 0) + 1);
    changesCount++;
  };

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const original = line;

    // Skip empty lines
    const trimmed = line.trim();
    if (!trimmed) {
      recordChange('empty_line_removed');
      continue;
    }

    // Preserve comments as-is (but trim)
    if (trimmed.startsWith(';') || trimmed.startsWith('(')) {
      normalizedLines.push(trimmed);
      if (line !== trimmed) recordChange('whitespace_trimmed');
      continue;
    }

    // Split code and comment
    const commentMatch = line.match(/(;.*$|\([^)]*\))/);
    const comment = commentMatch ? commentMatch[0] : '';
    let code = line.replace(/;.*$/, '').replace(/\([^)]*\)/g, '').trim();

    if (!code) {
      if (comment) {
        normalizedLines.push(comment.trim());
      }
      continue;
    }

    // Uppercase
    const upperCode = code.toUpperCase();
    if (upperCode !== code) recordChange('case_normalized');
    code = upperCode;

    // Remove leading zeros: G01 → G1, M06 → M6
    code = code.replace(/\b([GM])0*(\d+)\b/g, (_m, p1, p2) => {
      const num = parseInt(p2);
      return `${p1}${num}`;
    });

    // Normalize whitespace
    code = code.replace(/\s+/g, ' ').trim();

    // Sort parameters in consistent order
    const tokens = code.split(' ').filter(t => t.length > 0);
    const paramOrder = ['X', 'Y', 'Z', 'A', 'B', 'C', 'E', 'F', 'I', 'J', 'K', 'R', 'S', 'T', 'P'];
    const commands: string[] = [];
    const params: string[] = [];

    for (const token of tokens) {
      if (/^[GM]\d+/i.test(token)) {
        commands.push(token);
      } else {
        params.push(token);
      }
    }

    // Sort params by letter order
    params.sort((a, b) => {
      const aIdx = paramOrder.indexOf(a[0]?.toUpperCase() ?? '');
      const bIdx = paramOrder.indexOf(b[0]?.toUpperCase() ?? '');
      return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
    });

    const normalizedCode = [...commands, ...params].join(' ');

    let result = normalizedCode;
    if (comment) result += ' ' + comment.trim();

    if (result !== original) {
      recordChange('parameter_order');
    }

    normalizedLines.push(result);
  }

  const changes = Array.from(changeTypes.entries()).map(([type, count]) => ({ type, count }));
  const wasAlreadyNormalized = changesCount === 0;

  const recommendations: string[] = [];
  if (changesCount > 0) {
    recommendations.push(`${changesCount} normalizations applied`);
  }
  for (const c of changes.slice(0, 3)) {
    recommendations.push(`${c.count} ${c.type.replace(/_/g, ' ')}`);
  }
  if (wasAlreadyNormalized) {
    recommendations.push('G-code is already in canonical form');
  }

  return {
    normalizedLines, changesCount, changes,
    wasAlreadyNormalized, recommendations,
  };
}

// ── 4. Toolpath Smoothing/Jaggedness Detection ──

export interface JaggedSegment {
  /** Start line */
  startLine: number;
  /** End line */
  endLine: number;
  /** Number of segments in jagged region */
  segmentCount: number;
  /** Average angle change in degrees */
  avgAngleChange: number;
  /** Maximum angle change in degrees */
  maxAngleChange: number;
}

export interface SmoothingResult {
  /** Detected jagged regions */
  jaggedRegions: JaggedSegment[];
  /** Number of jagged regions */
  jaggedRegionCount: number;
  /** Total segments in jagged regions */
  totalJaggedSegments: number;
  /** Average segment length in mm */
  avgSegmentLength: number;
  /** Smoothing score (0-100, higher is smoother) */
  smoothnessScore: number;
  /** Arc fitting candidates */
  arcFittingCandidates: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Detect jagged toolpath segments that could benefit from smoothing.
 * Jagged toolpaths cause:
 * - Vibration and chatter (CNC)
 * - Visible surface artifacts (3DP)
 * - Slower execution due to frequent direction changes
 *
 * @param lines G-code lines
 * @param angleThreshold Angle change in degrees to consider jagged (default 30)
 * @param minSegments Minimum consecutive segments to form a jagged region (default 3)
 */
export function analyzeToolpathSmoothing(
  lines: string[],
  angleThreshold: number = 30,
  minSegments: number = 3,
): SmoothingResult {
  const segments: { x: number; y: number; angle: number; line: number; length: number }[] = [];
  let prevX = 0, prevY = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG[01]\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;

    const dx = x - prevX;
    const dy = y - prevY;
    const length = Math.sqrt(dx * dx + dy * dy);

    if (length > 0.1) {
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;
      segments.push({ x, y, angle, line: i, length });
    }

    prevX = x; prevY = y;
  }

  // Find jagged regions
  const jaggedRegions: JaggedSegment[] = [];
  let regionStart = -1;
  let regionSegments = 0;
  let regionAngles: number[] = [];

  for (let i = 1; i < segments.length; i++) {
    let angleDiff = Math.abs(segments[i].angle - segments[i - 1].angle);
    if (angleDiff > 180) angleDiff = 360 - angleDiff;

    if (angleDiff > angleThreshold) {
      if (regionStart < 0) {
        regionStart = i - 1;
        regionSegments = 2;
        regionAngles = [angleDiff];
      } else {
        regionSegments++;
        regionAngles.push(angleDiff);
      }
    } else {
      if (regionStart >= 0 && regionSegments >= minSegments) {
        jaggedRegions.push({
          startLine: segments[regionStart].line,
          endLine: segments[i - 1].line,
          segmentCount: regionSegments,
          avgAngleChange: regionAngles.reduce((a, b) => a + b, 0) / regionAngles.length,
          maxAngleChange: Math.max(...regionAngles),
        });
      }
      regionStart = -1;
      regionSegments = 0;
      regionAngles = [];
    }
  }

  // Finalize last region
  if (regionStart >= 0 && regionSegments >= minSegments) {
    jaggedRegions.push({
      startLine: segments[regionStart].line,
      endLine: segments[segments.length - 1].line,
      segmentCount: regionSegments,
      avgAngleChange: regionAngles.reduce((a, b) => a + b, 0) / regionAngles.length,
      maxAngleChange: Math.max(...regionAngles),
    });
  }

  const totalJaggedSegments = jaggedRegions.reduce((s, r) => s + r.segmentCount, 0);
  const avgSegmentLength = segments.length > 0
    ? segments.reduce((s, seg) => s + seg.length, 0) / segments.length
    : 0;

  // Smoothness score: based on jagged segment ratio
  const jaggedRatio = segments.length > 0 ? totalJaggedSegments / segments.length : 0;
  const smoothnessScore = Math.max(0, Math.min(100, 100 - jaggedRatio * 100));

  // Arc fitting candidates: regions with many short segments
  const arcFittingCandidates = jaggedRegions.filter(r =>
    r.segmentCount >= 5 && avgSegmentLength < 2
  ).length;

  const recommendations: string[] = [];
  if (jaggedRegions.length > 0) {
    recommendations.push(`${jaggedRegions.length} jagged regions detected — consider arc fitting or spline smoothing`);
  }
  if (arcFittingCandidates > 0) {
    recommendations.push(`${arcFittingCandidates} regions are good arc fitting candidates`);
  }
  if (smoothnessScore < 50) {
    recommendations.push(`Low smoothness score (${smoothnessScore.toFixed(0)}/100) — toolpath needs smoothing`);
  }
  if (avgSegmentLength < 0.5 && segments.length > 10) {
    recommendations.push('Very short segments — use arc fitting (G2/G3) for smoother motion');
  }
  if (jaggedRegions.length === 0) {
    recommendations.push('Toolpath is smooth — no jagged regions detected');
  }

  return {
    jaggedRegions, jaggedRegionCount: jaggedRegions.length,
    totalJaggedSegments, avgSegmentLength, smoothnessScore,
    arcFittingCandidates, recommendations,
  };
}

// ── 5. Print Quality Prediction ──

export interface QualityIssue {
  /** Issue type */
  type: string;
  /** Severity */
  severity: 'low' | 'medium' | 'high';
  /** Description */
  description: string;
  /** Affected layers (if applicable) */
  affectedLayers?: number[];
  /** Estimated impact on quality (0-100) */
  impact: number;
}

export interface QualityPredictionResult {
  /** Predicted quality score (0-100) */
  qualityScore: number;
  /** Predicted issues */
  issues: QualityIssue[];
  /** Issue count by severity */
  severityCounts: { low: number; medium: number; high: number };
  /** Overall quality grade */
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  /** Recommendations */
  recommendations: string[];
}

/**
 * Predict print quality from G-code analysis.
 * Combines multiple indicators to predict overall print quality:
 * - Layer height consistency
 * - Speed consistency
 * - Retraction quality
 * - Cooling adequacy
 * - Flow rate consistency
 *
 * @param lines G-code lines
 */
export function predictPrintQuality(lines: string[]): QualityPredictionResult {
  const issues: QualityIssue[] = [];
  let score = 100;

  // Check for retraction issues
  let retractionCount = 0;
  let minRetraction = Infinity;
  let maxRetraction = 0;
  let prevE = 0;

  // Check for speed consistency
  const feedRates: number[] = [];
  let currentFeed = 0;

  // Check for cooling
  let fanSpeeds: number[] = [];
  let hasFanControl = false;

  // Check for layer height
  const zHeights: number[] = [];
  let prevZ = 0;

  // Check for temperature
  let hotendTemp = 0;
  let bedTemp = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Retraction
    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);
    if (eMatch && /\bG1\b/i.test(code)) {
      const e = parseFloat(eMatch[1]);
      const retraction = e - prevE;
      if (retraction < -0.01) {
        retractionCount++;
        minRetraction = Math.min(minRetraction, Math.abs(retraction));
        maxRetraction = Math.max(maxRetraction, Math.abs(retraction));
      }
      prevE = e;
    }

    // Feed rate
    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) {
      currentFeed = parseFloat(fMatch[1]);
      if (/\bG1\b/i.test(code) && eMatch) {
        feedRates.push(currentFeed);
      }
    }

    // Fan
    const sMatch = code.match(/\bS(\d*\.?\d+)/i);
    if (/\bM106\b/i.test(code) && sMatch) {
      fanSpeeds.push(parseFloat(sMatch[1]));
      hasFanControl = true;
    }

    // Z height
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    if (zMatch) {
      const z = parseFloat(zMatch[1]);
      if (z > prevZ) {
        zHeights.push(z - prevZ);
        prevZ = z;
      }
    }

    // Temperatures
    if (/\bM104\b/i.test(code) && sMatch) hotendTemp = parseFloat(sMatch[1]);
    if (/\bM140\b/i.test(code) && sMatch) bedTemp = parseFloat(sMatch[1]);
  }

  // Analyze retraction
  if (retractionCount === 0) {
    issues.push({
      type: 'no_retraction', severity: 'high',
      description: 'No retraction detected — likely stringing',
      impact: 15,
    });
    score -= 15;
  } else if (maxRetraction - minRetraction > 2) {
    issues.push({
      type: 'inconsistent_retraction', severity: 'medium',
      description: `Inconsistent retraction (${minRetraction.toFixed(2)}-${maxRetraction.toFixed(2)}mm)`,
      impact: 8,
    });
    score -= 8;
  }

  // Analyze speed consistency
  if (feedRates.length > 0) {
    const avgFeed = feedRates.reduce((a, b) => a + b, 0) / feedRates.length;
    const maxFeed = Math.max(...feedRates);
    const minFeed = Math.min(...feedRates);
    if (maxFeed > avgFeed * 3) {
      issues.push({
        type: 'speed_variation', severity: 'medium',
        description: `Large speed variation (${minFeed.toFixed(0)}-${maxFeed.toFixed(0)} mm/min)`,
        impact: 10,
      });
      score -= 10;
    }
    if (avgFeed > 6000) {
      issues.push({
        type: 'high_speed', severity: 'low',
        description: `High average speed (${avgFeed.toFixed(0)} mm/min) may cause ringing`,
        impact: 5,
      });
      score -= 5;
    }
  }

  // Analyze cooling
  if (!hasFanControl) {
    issues.push({
      type: 'no_fan_control', severity: 'medium',
      description: 'No fan control — cooling may be inadequate for overhangs',
      impact: 8,
    });
    score -= 8;
  }

  // Analyze layer height
  if (zHeights.length > 1) {
    const avgHeight = zHeights.reduce((a, b) => a + b, 0) / zHeights.length;
    const heightVariation = Math.max(...zHeights) - Math.min(...zHeights);
    if (heightVariation > avgHeight * 0.2) {
      issues.push({
        type: 'layer_height_variation', severity: 'medium',
        description: `Layer height varies by ${heightVariation.toFixed(3)}mm`,
        impact: 7,
      });
      score -= 7;
    }
  }

  // Temperature checks
  if (hotendTemp === 0) {
    issues.push({
      type: 'no_temp_set', severity: 'high',
      description: 'No hotend temperature set',
      impact: 20,
    });
    score -= 20;
  }
  if (bedTemp === 0) {
    issues.push({
      type: 'no_bed_temp', severity: 'low',
      description: 'No bed temperature set — may cause warping',
      impact: 5,
    });
    score -= 5;
  }

  score = Math.max(0, Math.min(100, score));

  const severityCounts = {
    low: issues.filter(i => i.severity === 'low').length,
    medium: issues.filter(i => i.severity === 'medium').length,
    high: issues.filter(i => i.severity === 'high').length,
  };

  let grade: QualityPredictionResult['grade'];
  if (score >= 90) grade = 'A';
  else if (score >= 80) grade = 'B';
  else if (score >= 70) grade = 'C';
  else if (score >= 60) grade = 'D';
  else grade = 'F';

  const recommendations: string[] = [];
  for (const issue of issues.sort((a, b) => b.impact - a.impact).slice(0, 3)) {
    recommendations.push(`[${issue.severity.toUpperCase()}] ${issue.description}`);
  }
  if (issues.length === 0) {
    recommendations.push('No quality issues predicted — excellent G-code');
  }

  return {
    qualityScore: score, issues, severityCounts, grade, recommendations,
  };
}

// ── 6. Volumetric Flow Rate Analysis ──

export interface FlowRateSegment {
  /** Line number */
  line: number;
  /** Volumetric flow rate in mm³/s */
  flowRate: number;
  /** Feed rate in mm/min */
  feedRate: number;
  /** Extrusion width in mm */
  extrusionWidth: number;
  /** Layer height in mm */
  layerHeight: number;
  /** Whether flow rate exceeds limit */
  exceedsLimit: boolean;
}

export interface FlowRateResult {
  /** Per-segment flow rate data */
  segments: FlowRateSegment[];
  /** Average flow rate in mm³/s */
  avgFlowRate: number;
  /** Maximum flow rate in mm³/s */
  maxFlowRate: number;
  /** Extruder volumetric limit in mm³/s */
  extruderLimit: number;
  /** Number of segments exceeding limit */
  exceedingSegments: number;
  /** Percentage of segments exceeding limit */
  exceedingPercentage: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze volumetric flow rate in 3D printing.
 * Volumetric flow rate = extrusion width × layer height × feed rate
 * Exceeding the extruder's volumetric limit causes under-extrusion.
 *
 * @param lines G-code lines
 * @param extruderLimitVolumetric Extruder volumetric limit in mm³/s (default 11)
 * @param nozzleDiameter Nozzle diameter in mm (default 0.4)
 * @param defaultLayerHeight Default layer height in mm (default 0.2)
 */
export function analyzeVolumetricFlowRate(
  lines: string[],
  extruderLimitVolumetric: number = 11,
  nozzleDiameter: number = 0.4,
  defaultLayerHeight: number = 0.2,
): FlowRateResult {
  const segments: FlowRateSegment[] = [];
  let currentFeedRate = 0;
  let prevE = 0;
  let currentLayerHeight = defaultLayerHeight;
  let prevZ = 0;
  let isRelative = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    if (/\bM83\b/i.test(code)) isRelative = true;
    if (/\bM82\b/i.test(code)) isRelative = false;

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) currentFeedRate = parseFloat(fMatch[1]);

    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    if (zMatch) {
      const z = parseFloat(zMatch[1]);
      if (z > prevZ) {
        currentLayerHeight = z - prevZ;
        prevZ = z;
      }
    }

    if (!/\bG1\b/i.test(code)) continue;

    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);
    if (!eMatch) continue;

    const e = parseFloat(eMatch[1]);
    const extruded = isRelative ? e : (e - prevE);

    if (extruded > 0 && currentFeedRate > 0) {
      const feedRateMmPerSec = currentFeedRate / 60;
      const extrusionWidth = nozzleDiameter * 1.2; // typical extrusion width
      const flowRate = extrusionWidth * currentLayerHeight * feedRateMmPerSec;

      segments.push({
        line: i,
        flowRate,
        feedRate: currentFeedRate,
        extrusionWidth,
        layerHeight: currentLayerHeight,
        exceedsLimit: flowRate > extruderLimitVolumetric,
      });
    }

    prevE = e;
  }

  const avgFlowRate = segments.length > 0
    ? segments.reduce((s, seg) => s + seg.flowRate, 0) / segments.length
    : 0;
  const maxFlowRate = segments.length > 0
    ? Math.max(...segments.map(s => s.flowRate))
    : 0;
  const exceedingSegments = segments.filter(s => s.exceedsLimit).length;
  const exceedingPercentage = segments.length > 0
    ? (exceedingSegments / segments.length) * 100
    : 0;

  const recommendations: string[] = [];
  if (exceedingSegments > 0) {
    recommendations.push(`${exceedingSegments} segments exceed volumetric limit (${extruderLimitVolumetric} mm³/s) — reduce feed rate`);
  }
  if (maxFlowRate > extruderLimitVolumetric) {
    recommendations.push(`Max flow rate ${maxFlowRate.toFixed(2)} mm³/s exceeds limit by ${((maxFlowRate / extruderLimitVolumetric - 1) * 100).toFixed(0)}%`);
  }
  if (exceedingPercentage > 20) {
    recommendations.push(`${exceedingPercentage.toFixed(0)}% of segments exceed limit — significant under-extrusion risk`);
  }
  if (exceedingSegments === 0 && segments.length > 0) {
    recommendations.push('All flow rates within extruder capability');
  }

  return {
    segments, avgFlowRate, maxFlowRate, extruderLimit: extruderLimitVolumetric,
    exceedingSegments, exceedingPercentage, recommendations,
  };
}

// ── 7. G-code Statistics Summary ──

export interface StatisticsSummary {
  /** Total lines */
  totalLines: number;
  /** Code lines (non-comment, non-empty) */
  codeLines: number;
  /** Comment lines */
  commentLines: number;
  /** Empty lines */
  emptyLines: number;
  /** Total file size in characters */
  totalCharacters: number;
  /** Average line length */
  avgLineLength: number;
  /** Motion commands count */
  motionCommands: number;
  /** Rapid commands count */
  rapidCommands: number;
  /** Arc commands count */
  arcCommands: number;
  /** Tool changes count */
  toolChanges: number;
  /** Spindle commands count */
  spindleCommands: number;
  /** Coolant commands count */
  coolantCommands: number;
  /** Dwell commands count */
  dwellCommands: number;
  /** Estimated cycle time in seconds */
  estimatedCycleTime: number;
  /** Number of unique tools */
  uniqueTools: number;
  /** Number of layers */
  layerCount: number;
  /** Overall complexity score (0-100) */
  complexityScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Generate a comprehensive statistics summary of G-code.
 * Provides a one-page dashboard view of all key metrics.
 *
 * @param lines G-code lines
 */
export function generateStatisticsSummary(lines: string[]): StatisticsSummary {
  let totalLines = lines.length;
  let codeLines = 0;
  let commentLines = 0;
  let emptyLines = 0;
  let totalCharacters = 0;
  let motionCommands = 0;
  let rapidCommands = 0;
  let arcCommands = 0;
  let toolChanges = 0;
  let spindleCommands = 0;
  let coolantCommands = 0;
  let dwellCommands = 0;
  let layerCount = 0;
  const tools = new Set<number>();
  let totalDistance = 0;
  let currentFeedRate = 0;
  let prevX = 0, prevY = 0;

  for (const line of lines) {
    totalCharacters += line.length;
    const trimmed = line.trim();

    if (!trimmed) {
      emptyLines++;
      continue;
    }

    if (trimmed.startsWith(';') || trimmed.startsWith('(')) {
      commentLines++;
      if (/;.*layer/i.test(trimmed)) layerCount++;
      continue;
    }

    codeLines++;
    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();

    if (/\bG0\b/i.test(code)) rapidCommands++;
    if (/\bG1\b/i.test(code)) motionCommands++;
    if (/\bG[23]\b/i.test(code)) arcCommands++;
    if (/\bG4\b/i.test(code)) dwellCommands++;
    if (/\bM[345]\b/i.test(code)) spindleCommands++;
    if (/\bM[789]\b/i.test(code)) coolantCommands++;
    if (/\bM6\b/i.test(code) || /\bM06\b/i.test(code)) toolChanges++;

    const tMatch = code.match(/\bT(\d+)\b/i);
    if (tMatch) tools.add(parseInt(tMatch[1]));

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) currentFeedRate = parseFloat(fMatch[1]);

    if (/\bG[01]\b/i.test(code)) {
      const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
      const x = xMatch ? parseFloat(xMatch[1]) : prevX;
      const y = yMatch ? parseFloat(yMatch[1]) : prevY;
      totalDistance += Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
      prevX = x; prevY = y;
    }
  }

  const avgLineLength = totalLines > 0 ? totalCharacters / totalLines : 0;
  const estimatedCycleTime = currentFeedRate > 0 ? totalDistance / (currentFeedRate / 60) : 0;

  // Complexity score based on various factors
  const complexityFactors = [
    Math.min(25, motionCommands / 100),
    Math.min(15, arcCommands / 50),
    Math.min(20, toolChanges * 2),
    Math.min(15, tools.size * 3),
    Math.min(15, layerCount / 10),
    Math.min(10, dwellCommands / 10),
  ];
  const complexityScore = Math.min(100, complexityFactors.reduce((a, b) => a + b, 0));

  const recommendations: string[] = [];
  if (commentLines / totalLines < 0.05) {
    recommendations.push('Low comment ratio — add comments for maintainability');
  }
  if (toolChanges > 10) {
    recommendations.push(`${toolChanges} tool changes — consider optimizing tool order`);
  }
  if (complexityScore > 70) {
    recommendations.push(`High complexity score (${complexityScore.toFixed(0)}/100) — verify G-code carefully`);
  }
  if (emptyLines / totalLines > 0.2) {
    recommendations.push(`${emptyLines} empty lines — consider removing for smaller file`);
  }
  if (recommendations.length === 0) {
    recommendations.push('G-code statistics look reasonable');
  }

  return {
    totalLines, codeLines, commentLines, emptyLines,
    totalCharacters, avgLineLength,
    motionCommands, rapidCommands, arcCommands,
    toolChanges, spindleCommands, coolantCommands, dwellCommands,
    estimatedCycleTime, uniqueTools: tools.size, layerCount,
    complexityScore, recommendations,
  };
}

// ── 8. Machine Capability Match ──

export interface MachineCapability {
  /** Machine name */
  name: string;
  /** Work envelope */
  workEnvelope: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
  /** Max feed rate in mm/min */
  maxFeedRate: number;
  /** Max spindle RPM */
  maxSpindleRpm: number;
  /** Number of tools supported */
  maxTools: number;
  /** Supported features */
  features: string[];
  /** Controller type */
  controller: string;
}

export interface CapabilityMatchResult {
  /** Machine capability */
  machine: MachineCapability;
  /** Whether G-code fits within machine capabilities */
  isCompatible: boolean;
  /** Compatibility score (0-100) */
  compatibilityScore: number;
  /** Issues found */
  issues: { type: string; message: string; severity: 'warning' | 'error' }[];
  /** G-code requirements */
  requirements: {
    maxX: number; maxY: number; maxZ: number;
    maxFeedRate: number; maxSpindleRpm: number;
    toolCount: number; usedFeatures: string[];
  };
  /** Recommendations */
  recommendations: string[];
}

/**
 * Match G-code requirements against machine capabilities.
 * Ensures the G-code can run on a specific machine.
 *
 * @param lines G-code lines
 * @param machine Machine capability specification
 */
export function matchMachineCapability(
  lines: string[],
  machine: MachineCapability,
): CapabilityMatchResult {
  let maxX = 0, maxY = 0, maxZ = 0;
  let maxFeedRate = 0;
  let maxSpindleRpm = 0;
  const tools = new Set<number>();
  const usedFeatures = new Set<string>();
  let prevX = 0, prevY = 0, prevZ = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    const sMatch = code.match(/\bS(\d*\.?\d+)/i);
    const tMatch = code.match(/\bT(\d+)\b/i);

    if (xMatch) { const x = Math.abs(parseFloat(xMatch[1])); maxX = Math.max(maxX, x); prevX = x; }
    if (yMatch) { const y = Math.abs(parseFloat(yMatch[1])); maxY = Math.max(maxY, y); prevY = y; }
    if (zMatch) { const z = Math.abs(parseFloat(zMatch[1])); maxZ = Math.max(maxZ, z); prevZ = z; }
    if (fMatch) maxFeedRate = Math.max(maxFeedRate, parseFloat(fMatch[1]));
    if (sMatch) maxSpindleRpm = Math.max(maxSpindleRpm, parseFloat(sMatch[1]));
    if (tMatch) tools.add(parseInt(tMatch[1]));

    // Check features
    if (/\bG[23]\b/i.test(code)) usedFeatures.add('arc');
    if (/\bG4\b/i.test(code)) usedFeatures.add('dwell');
    if (/\bM[78]\b/i.test(code)) usedFeatures.add('coolant');
    if (/\bG8[1-9]\b/i.test(code)) usedFeatures.add('canned_cycles');
    if (/\bG4[12]\b/i.test(code)) usedFeatures.add('cutter_comp');
    if (/\bM3\b/i.test(code) || /\bM4\b/i.test(code)) usedFeatures.add('spindle_control');
  }

  const issues: { type: string; message: string; severity: 'warning' | 'error' }[] = [];

  // Check work envelope
  if (maxX > machine.workEnvelope.maxX) {
    issues.push({ type: 'x_travel', message: `X${maxX.toFixed(1)} exceeds machine max ${machine.workEnvelope.maxX}`, severity: 'error' });
  }
  if (maxY > machine.workEnvelope.maxY) {
    issues.push({ type: 'y_travel', message: `Y${maxY.toFixed(1)} exceeds machine max ${machine.workEnvelope.maxY}`, severity: 'error' });
  }
  if (maxZ > machine.workEnvelope.maxZ) {
    issues.push({ type: 'z_travel', message: `Z${maxZ.toFixed(1)} exceeds machine max ${machine.workEnvelope.maxZ}`, severity: 'error' });
  }

  // Check feed rate
  if (maxFeedRate > machine.maxFeedRate) {
    issues.push({ type: 'feed_rate', message: `Feed ${maxFeedRate.toFixed(0)} exceeds machine max ${machine.maxFeedRate}`, severity: 'error' });
  }

  // Check spindle
  if (maxSpindleRpm > machine.maxSpindleRpm) {
    issues.push({ type: 'spindle_rpm', message: `RPM ${maxSpindleRpm} exceeds machine max ${machine.maxSpindleRpm}`, severity: 'error' });
  }

  // Check tools
  if (tools.size > machine.maxTools) {
    issues.push({ type: 'tool_count', message: `${tools.size} tools needed, machine has ${machine.maxTools}`, severity: 'error' });
  }

  // Check features
  for (const feature of usedFeatures) {
    if (!machine.features.includes(feature)) {
      issues.push({ type: 'feature', message: `Feature '${feature}' not supported by machine`, severity: 'warning' });
    }
  }

  const errors = issues.filter(i => i.severity === 'error').length;
  const warnings = issues.filter(i => i.severity === 'warning').length;
  const compatibilityScore = Math.max(0, 100 - errors * 25 - warnings * 10);
  const isCompatible = errors === 0;

  const recommendations: string[] = [];
  for (const issue of issues.slice(0, 3)) {
    recommendations.push(`[${issue.severity.toUpperCase()}] ${issue.message}`);
  }
  if (isCompatible && warnings === 0) {
    recommendations.push('G-code is fully compatible with machine');
  }

  return {
    machine, isCompatible, compatibilityScore, issues,
    requirements: {
      maxX, maxY, maxZ, maxFeedRate, maxSpindleRpm,
      toolCount: tools.size, usedFeatures: Array.from(usedFeatures),
    },
    recommendations,
  };
}

// ── 9. Toolpath Overlap Detection ──

export interface OverlapRegion {
  /** First path line */
  line1: number;
  /** Second path line */
  line2: number;
  /** Overlap area in mm² */
  area: number;
  /** Overlap percentage */
  percentage: number;
}

export interface OverlapResult {
  /** Detected overlap regions */
  overlaps: OverlapRegion[];
  /** Overlap count */
  count: number;
  /** Total overlap area in mm² */
  totalOverlapArea: number;
  /** Whether significant overlaps exist */
  hasSignificantOverlaps: boolean;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Detect overlapping extrusion paths in 3D printing.
 * Overlapping paths cause over-extrusion, leading to:
 * - Bulging surfaces
 * - Dimensional inaccuracy
 * - Poor surface finish
 *
 * @param lines G-code lines
 * @param extrusionWidth Expected extrusion width in mm (default 0.48)
 * @param tolerance Overlap tolerance percentage (default 20)
 */
export function detectToolpathOverlaps(
  lines: string[],
  extrusionWidth: number = 0.48,
  tolerance: number = 20,
): OverlapResult {
  const segments: { x1: number; y1: number; x2: number; y2: number; line: number }[] = [];
  let prevX = 0, prevY = 0, prevE = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG1\b/i.test(code)) continue;

    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);
    if (!eMatch) continue;

    const e = parseFloat(eMatch[1]);
    if (e <= prevE) { prevE = e; continue; } // retraction

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;

    const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
    if (dist > 0.1) {
      segments.push({ x1: prevX, y1: prevY, x2: x, y2: y, line: i });
    }

    prevX = x; prevY = y; prevE = e;
  }

  // Check for overlapping parallel segments
  const overlaps: OverlapRegion[] = [];
  const maxSegments = Math.min(segments.length, 200);

  for (let i = 0; i < maxSegments; i++) {
    for (let j = i + 1; j < maxSegments; j++) {
      const s1 = segments[i];
      const s2 = segments[j];

      // Check if segments are parallel and close together
      const dx1 = s1.x2 - s1.x1;
      const dy1 = s1.y2 - s1.y1;
      const dx2 = s2.x2 - s2.x1;
      const dy2 = s2.y2 - s2.y1;

      const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
      const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);

      if (len1 < 0.1 || len2 < 0.1) continue;

      // Check parallelism (dot product close to ±1)
      const dot = (dx1 * dx2 + dy1 * dy2) / (len1 * len2);
      if (Math.abs(Math.abs(dot) - 1) > 0.1) continue; // not parallel

      // Check distance between segments
      const midX1 = (s1.x1 + s1.x2) / 2;
      const midY1 = (s1.y1 + s1.y2) / 2;
      const midX2 = (s2.x1 + s2.x2) / 2;
      const midY2 = (s2.y1 + s2.y2) / 2;
      const dist = Math.sqrt((midX1 - midX2) ** 2 + (midY1 - midY2) ** 2);

      // If distance is less than extrusion width, they overlap
      if (dist < extrusionWidth * (1 - tolerance / 100)) {
        const overlapArea = Math.min(len1, len2) * (extrusionWidth - dist);
        const overlapPercentage = (1 - dist / extrusionWidth) * 100;

        overlaps.push({
          line1: s1.line, line2: s2.line,
          area: overlapArea,
          percentage: overlapPercentage,
        });
      }
    }
  }

  const totalOverlapArea = overlaps.reduce((s, o) => s + o.area, 0);
  const hasSignificantOverlaps = overlaps.filter(o => o.percentage > 50).length > 0;

  const recommendations: string[] = [];
  if (overlaps.length > 0) {
    recommendations.push(`${overlaps.length} overlapping paths detected — may cause over-extrusion`);
  }
  if (hasSignificantOverlaps) {
    recommendations.push('Significant overlaps (>50%) — reduce extrusion multiplier or fix toolpath');
  }
  if (totalOverlapArea > 10) {
    recommendations.push(`Total overlap area ${totalOverlapArea.toFixed(1)}mm² — check slicer settings`);
  }
  if (overlaps.length === 0) {
    recommendations.push('No overlapping extrusion paths detected');
  }

  return {
    overlaps, count: overlaps.length, totalOverlapArea,
    hasSignificantOverlaps, recommendations,
  };
}

// ── 10. G-code Batch Comparison ──

export interface BatchComparisonEntry {
  /** File name */
  name: string;
  /** Line count */
  lineCount: number;
  /** Estimated time in seconds */
  estimatedTime: number;
  /** Total distance in mm */
  totalDistance: number;
  /** Tool count */
  toolCount: number;
  /** Layer count */
  layerCount: number;
  /** Max feed rate */
  maxFeedRate: number;
  /** Complexity score */
  complexityScore: number;
}

export interface BatchComparisonResult {
  /** Per-file comparison data */
  files: BatchComparisonEntry[];
  /** Best file by time */
  fastestFile: string;
  /** Best file by distance */
  shortestFile: string;
  /** Most efficient file (time/distance ratio) */
  mostEfficientFile: string;
  /** Time difference between fastest and slowest in seconds */
  timeSpread: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Compare multiple G-code files for batch analysis.
 * Useful for comparing different slicer settings, versions, or strategies.
 *
 * @param files Array of { name, lines } objects
 */
export function compareBatchGcode(
  files: { name: string; lines: string[] }[],
): BatchComparisonResult {
  const entries: BatchComparisonEntry[] = [];

  for (const file of files) {
    const summary = generateStatisticsSummary(file.lines);
    let totalDistance = 0;
    let maxFeedRate = 0;
    let prevX = 0, prevY = 0;

    for (const line of file.lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;
      const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
      if (!code || !/\bG[01]\b/i.test(code)) continue;

      const fMatch = code.match(/\bF(\d*\.?\d+)/i);
      if (fMatch) maxFeedRate = Math.max(maxFeedRate, parseFloat(fMatch[1]));

      const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
      const x = xMatch ? parseFloat(xMatch[1]) : prevX;
      const y = yMatch ? parseFloat(yMatch[1]) : prevY;
      totalDistance += Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
      prevX = x; prevY = y;
    }

    entries.push({
      name: file.name,
      lineCount: summary.totalLines,
      estimatedTime: summary.estimatedCycleTime,
      totalDistance,
      toolCount: summary.uniqueTools,
      layerCount: summary.layerCount,
      maxFeedRate,
      complexityScore: summary.complexityScore,
    });
  }

  // Find best files
  const sorted = [...entries].filter(e => e.estimatedTime > 0);
  const fastestFile = sorted.length > 0
    ? sorted.reduce((min, e) => e.estimatedTime < min.estimatedTime ? e : min).name
    : '';
  const shortestFile = sorted.length > 0
    ? sorted.reduce((min, e) => e.totalDistance < min.totalDistance ? e : min).name
    : '';
  const mostEfficientFile = sorted.length > 0
    ? sorted.reduce((best, e) => {
      const ratio = e.estimatedTime / Math.max(0.001, e.totalDistance);
      const bestRatio = best.estimatedTime / Math.max(0.001, best.totalDistance);
      return ratio < bestRatio ? e : best;
    }).name
    : '';

  const times = entries.map(e => e.estimatedTime).filter(t => t > 0);
  const timeSpread = times.length > 0 ? Math.max(...times) - Math.min(...times) : 0;

  const recommendations: string[] = [];
  if (fastestFile) {
    recommendations.push(`Fastest: ${fastestFile}`);
  }
  if (shortestFile) {
    recommendations.push(`Shortest path: ${shortestFile}`);
  }
  if (timeSpread > 60) {
    recommendations.push(`Time spread: ${(timeSpread / 60).toFixed(1)} min between fastest and slowest`);
  }
  if (entries.length > 1) {
    const maxComplexity = Math.max(...entries.map(e => e.complexityScore));
    const minComplexity = Math.min(...entries.map(e => e.complexityScore));
    if (maxComplexity - minComplexity > 20) {
      recommendations.push('Significant complexity difference between files');
    }
  }

  return {
    files: entries, fastestFile, shortestFile,
    mostEfficientFile, timeSpread, recommendations,
  };
}

// ── 11. Print Time vs Material Efficiency ──

export interface EfficiencyResult {
  /** Total print time in seconds */
  printTime: number;
  /** Total material used in mm */
  materialUsed: number;
  /** Total material volume in mm³ */
  materialVolume: number;
  /** Material efficiency (mm³/s) */
  materialEfficiency: number;
  /** Time efficiency score (0-100) */
  timeEfficiencyScore: number;
  /** Material efficiency score (0-100) */
  materialEfficiencyScore: number;
  /** Overall efficiency score (0-100) */
  overallScore: number;
  /** Efficiency grade */
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  /** Trade-off analysis */
  tradeoffs: { factor: string; assessment: string }[];
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze print time vs material efficiency tradeoffs.
 * Helps identify whether the G-code prioritizes speed or material usage,
 * and whether the tradeoff is appropriate.
 *
 * @param lines G-code lines
 * @param filamentDiameter Filament diameter in mm (default 1.75)
 */
export function analyzePrintEfficiency(
  lines: string[],
  filamentDiameter: number = 1.75,
): EfficiencyResult {
  let totalDistance = 0;
  let totalExtrusion = 0;
  let currentFeedRate = 0;
  let prevX = 0, prevY = 0, prevE = 0;
  let isRelative = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    if (/\bM83\b/i.test(code)) isRelative = true;
    if (/\bM82\b/i.test(code)) isRelative = false;

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) currentFeedRate = parseFloat(fMatch[1]);

    if (!/\bG1\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;

    totalDistance += Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);

    if (eMatch) {
      const e = parseFloat(eMatch[1]);
      const extruded = isRelative ? e : (e - prevE);
      if (extruded > 0) totalExtrusion += extruded;
      prevE = e;
    }

    prevX = x; prevY = y;
  }

  const printTime = currentFeedRate > 0 ? totalDistance / (currentFeedRate / 60) : 0;
  const filamentCrossSection = Math.PI * (filamentDiameter / 2) ** 2;
  const materialVolume = totalExtrusion * filamentCrossSection;
  const materialEfficiency = printTime > 0 ? materialVolume / printTime : 0;

  // Score calculation
  // Time efficiency: higher feed rates and less travel = better
  const timeEfficiencyScore = Math.min(100, (totalDistance / Math.max(1, printTime)) / 60 * 10);

  // Material efficiency: more material per unit time = better utilization
  const materialEfficiencyScore = Math.min(100, materialEfficiency * 10);

  const overallScore = (timeEfficiencyScore + materialEfficiencyScore) / 2;

  let grade: EfficiencyResult['grade'];
  if (overallScore >= 80) grade = 'A';
  else if (overallScore >= 70) grade = 'B';
  else if (overallScore >= 60) grade = 'C';
  else if (overallScore >= 50) grade = 'D';
  else grade = 'F';

  const tradeoffs: { factor: string; assessment: string }[] = [];

  if (printTime > 0 && totalDistance > 0) {
    const avgSpeed = totalDistance / printTime;
    if (avgSpeed > 50) {
      tradeoffs.push({ factor: 'Speed', assessment: 'High speed — may sacrifice quality' });
    } else if (avgSpeed < 20) {
      tradeoffs.push({ factor: 'Speed', assessment: 'Low speed — quality focused' });
    } else {
      tradeoffs.push({ factor: 'Speed', assessment: 'Balanced speed' });
    }
  }

  if (materialVolume > 0 && totalDistance > 0) {
    const materialPerMm = materialVolume / totalDistance;
    if (materialPerMm > 0.1) {
      tradeoffs.push({ factor: 'Material', assessment: 'High material usage — strong parts' });
    } else if (materialPerMm < 0.02) {
      tradeoffs.push({ factor: 'Material', assessment: 'Low material usage — may be weak' });
    } else {
      tradeoffs.push({ factor: 'Material', assessment: 'Balanced material usage' });
    }
  }

  const recommendations: string[] = [];
  if (grade === 'F' || grade === 'D') {
    recommendations.push(`Low efficiency grade (${grade}) — review slicer settings`);
  }
  if (printTime > 3600 && materialEfficiency < 1) {
    recommendations.push('Long print time with low material efficiency — increase infill or speed');
  }
  for (const t of tradeoffs) {
    recommendations.push(`${t.factor}: ${t.assessment}`);
  }
  if (recommendations.length === 0) {
    recommendations.push('Print efficiency is well balanced');
  }

  return {
    printTime, materialUsed: totalExtrusion, materialVolume,
    materialEfficiency, timeEfficiencyScore, materialEfficiencyScore,
    overallScore, grade, tradeoffs, recommendations,
  };
}

// ── 12. G-code Annotation Auto-Generation ──

export interface AutoAnnotation {
  /** Line number to annotate */
  lineNumber: number;
  /** Annotation text */
  text: string;
  /** Annotation category */
  category: 'info' | 'warning' | 'error' | 'optimization';
  /** Source analysis */
  source: string;
}

export interface AutoAnnotationResult {
  /** Generated annotations */
  annotations: AutoAnnotation[];
  /** Total annotation count */
  count: number;
  /** Count by category */
  byCategory: { info: number; warning: number; error: number; optimization: number };
  /** Recommendations */
  recommendations: string[];
}

/**
 * Auto-generate annotations for G-code based on analysis.
 * Combines multiple analysis results to produce useful annotations
 * at specific line numbers.
 *
 * @param lines G-code lines
 */
export function autoGenerateAnnotations(lines: string[]): AutoAnnotationResult {
  const annotations: AutoAnnotation[] = [];

  // Tool changes
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Layer change (check comments before skipping)
    if (/;.*layer/i.test(line)) {
      annotations.push({
        lineNumber: i,
        text: `Layer change: ${line.replace(/^.*layer/i, '').trim()}`,
        category: 'info',
        source: 'layer',
      });
      continue;
    }

    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Tool change annotations
    const tMatch = code.match(/\bT(\d+)\b/i);
    const m6Match = /\bM6\b/i.test(code) || /\bM06\b/i.test(code);
    if (tMatch && m6Match) {
      annotations.push({
        lineNumber: i,
        text: `Tool change to T${parseInt(tMatch[1])}`,
        category: 'info',
        source: 'tool_change',
      });
    }

    // Spindle speed change
    const sMatch = code.match(/\bS(\d*\.?\d+)/i);
    if (sMatch && /\bM[345]\b/i.test(code)) {
      const rpm = parseFloat(sMatch[1]);
      annotations.push({
        lineNumber: i,
        text: `Spindle ${/\bM[34]\b/i.test(code) ? 'on' : 'off'} at ${rpm} RPM`,
        category: 'info',
        source: 'spindle',
      });
    }

    // Dwell
    if (/\bG4\b/i.test(code)) {
      const pMatch = code.match(/\bP(\d*\.?\d+)/i);
      const dwell = pMatch ? parseFloat(pMatch[1]) : 0;
      annotations.push({
        lineNumber: i,
        text: `Dwell for ${dwell}s`,
        category: 'info',
        source: 'dwell',
      });
    }

    // High feed rate warning
    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch && /\bG1\b/i.test(code)) {
      const feed = parseFloat(fMatch[1]);
      if (feed > 5000) {
        annotations.push({
          lineNumber: i,
          text: `High feed rate: ${feed} mm/min`,
          category: 'warning',
          source: 'feed_rate',
        });
      }
    }

    // Rapid move
    if (/\bG0\b/i.test(code)) {
      annotations.push({
        lineNumber: i,
        text: 'Rapid move',
        category: 'info',
        source: 'rapid',
      });
    }

    // Arc move
    if (/\bG[23]\b/i.test(code)) {
      annotations.push({
        lineNumber: i,
        text: `Arc move (${/\bG2\b/i.test(code) ? 'CW' : 'CCW'})`,
        category: 'info',
        source: 'arc',
      });
    }

    // Program end
    if (/\bM30\b/i.test(code) || /\bM2\b/i.test(code)) {
      annotations.push({
        lineNumber: i,
        text: 'Program end',
        category: 'info',
        source: 'program',
      });
    }
  }

  const byCategory = {
    info: annotations.filter(a => a.category === 'info').length,
    warning: annotations.filter(a => a.category === 'warning').length,
    error: annotations.filter(a => a.category === 'error').length,
    optimization: annotations.filter(a => a.category === 'optimization').length,
  };

  const recommendations: string[] = [];
  if (annotations.length > 0) {
    recommendations.push(`${annotations.length} annotations generated`);
  }
  if (byCategory.warning > 0) {
    recommendations.push(`${byCategory.warning} warning annotations — review flagged lines`);
  }
  if (annotations.length === 0) {
    recommendations.push('No annotations generated — G-code may be too simple');
  }
  if (byCategory.info > 50) {
    recommendations.push('Many info annotations — consider filtering by category');
  }

  return {
    annotations, count: annotations.length, byCategory, recommendations,
  };
}
