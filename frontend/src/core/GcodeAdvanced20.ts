/**
 * @file GcodeAdvanced20.ts
 * @brief Twentieth batch of advanced G-code analysis features for CNC and 3D printing.
 *
 * This module provides 12 additional high-impact features:
 *  1. G-code toolpath speed heatmap generator (Universal) — speed heatmap
 *  2. CNC tool wear progression predictor (CNC) — wear over time
 *  3. Print retraction speed optimizer (3DP) — retraction speed
 *  4. G-code line complexity scorer (Universal) — per-line complexity
 *  5. CNC depth of cut optimizer (CNC) — optimize DOC strategy
 *  6. Print layer fan speed optimizer (3DP) — fan speed per layer
 *  7. G-code circular interpolation detector (Universal) — detect arc opportunities
 *  8. CNC tool path efficiency calculator (CNC) — efficiency metrics
 *  9. Print material usage per layer tracker (3DP) — per-layer material
 * 10. G-code command redundancy remover (Universal) — remove redundant commands
 * 11. CNC cutting strategy advisor (CNC) — cutting strategy advice
 * 12. Print ironing pattern analyzer (3DP) — ironing analysis
 */

// ── 1. G-code Toolpath Speed Heatmap Generator ──

export interface SpeedHeatmapPoint {
  /** X position */
  x: number;
  /** Y position */
  y: number;
  /** Z position */
  z: number;
  /** Speed in mm/min */
  speed: number;
  /** Normalized speed (0-1) */
  normalizedSpeed: number;
  /** Speed category */
  category: 'very_slow' | 'slow' | 'medium' | 'fast' | 'very_fast';
}

export interface SpeedHeatmapResult {
  /** Heatmap data points */
  points: SpeedHeatmapPoint[];
  /** Speed range */
  speedRange: { min: number; max: number };
  /** Speed distribution */
  distribution: { [category: string]: number };
  /** Average speed */
  avgSpeed: number;
  /** Speed variation coefficient */
  variationCoefficient: number;
  /** Heatmap quality score (0-100) */
  heatmapScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Generate speed heatmap data for the toolpath.
 * Maps speed values to positions for visualization.
 *
 * @param lines G-code lines
 */
export function generateSpeedHeatmap(lines: string[]): SpeedHeatmapResult {
  const points: SpeedHeatmapPoint[] = [];
  let prevX = 0, prevY = 0, prevZ = 0;
  let feedRate = 0;
  const speeds: number[] = [];

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

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const z = zMatch ? parseFloat(zMatch[1]) : prevZ;

    if (feedRate > 0) {
      speeds.push(feedRate);
      points.push({ x, y, z, speed: feedRate, normalizedSpeed: 0, category: 'medium' });
    }

    prevX = x; prevY = y; prevZ = z;
  }

  if (points.length === 0) {
    return {
      points: [], speedRange: { min: 0, max: 0 }, distribution: {},
      avgSpeed: 0, variationCoefficient: 0, heatmapScore: 100,
      recommendations: ['No motion data for speed heatmap'],
    };
  }

  const minSpeed = Math.min(...speeds);
  const maxSpeed = Math.max(...speeds);
  const speedRange = maxSpeed - minSpeed || 1;
  const avgSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;

  const distribution: { [category: string]: number } = {
    very_slow: 0, slow: 0, medium: 0, fast: 0, very_fast: 0,
  };

  for (const p of points) {
    p.normalizedSpeed = (p.speed - minSpeed) / speedRange;
    if (p.normalizedSpeed < 0.2) { p.category = 'very_slow'; distribution.very_slow++; }
    else if (p.normalizedSpeed < 0.4) { p.category = 'slow'; distribution.slow++; }
    else if (p.normalizedSpeed < 0.6) { p.category = 'medium'; distribution.medium++; }
    else if (p.normalizedSpeed < 0.8) { p.category = 'fast'; distribution.fast++; }
    else { p.category = 'very_fast'; distribution.very_fast++; }
  }

  const stdDev = Math.sqrt(speeds.reduce((s, sp) => s + (sp - avgSpeed) ** 2, 0) / speeds.length);
  const variationCoefficient = avgSpeed > 0 ? stdDev / avgSpeed : 0;
  const heatmapScore = Math.max(0, 100 - variationCoefficient * 50);

  const recommendations: string[] = [];
  recommendations.push(`${points.length} speed points, range ${minSpeed.toFixed(0)}-${maxSpeed.toFixed(0)}mm/min`);
  if (distribution.very_slow > points.length * 0.3) {
    recommendations.push(`${distribution.very_slow} very slow points — optimize slow segments`);
  }
  if (variationCoefficient > 0.5) {
    recommendations.push(`High speed variation (CV=${variationCoefficient.toFixed(2)}) — stabilize feed rates`);
  }
  if (heatmapScore > 80) {
    recommendations.push('Consistent speed distribution — good for uniform finish');
  }

  return {
    points, speedRange: { min: minSpeed, max: maxSpeed },
    distribution, avgSpeed, variationCoefficient,
    heatmapScore, recommendations,
  };
}

// ── 2. CNC Tool Wear Progression Predictor ──

export interface WearProgressionPoint {
  /** Time in seconds */
  time: number;
  /** Cumulative cutting distance in mm */
  cumulativeDistance: number;
  /** Predicted wear percentage */
  wearPercentage: number;
  /** Wear rate per mm */
  wearRate: number;
  /** Wear stage */
  stage: 'break_in' | 'steady' | 'accelerated' | 'failure';
}

export interface WearProgressionResult {
  /** Wear progression data */
  points: WearProgressionPoint[];
  /** Total cutting distance */
  totalCuttingDistance: number;
  /** Final wear percentage */
  finalWearPercentage: number;
  /** Estimated tool life remaining in mm */
  estimatedLifeRemaining: number;
  /** Current wear stage */
  currentStage: WearProgressionPoint['stage'];
  /** Tool wear risk score (0-100, lower is better) */
  wearRiskScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Predict tool wear progression over time.
 * Models wear using break-in, steady, and accelerated wear phases.
 *
 * @param lines G-code lines
 * @param toolDiameter Tool diameter in mm (default 6)
 * @param material Material type (default 'aluminum')
 */
export function predictToolWearProgression(
  lines: string[],
  toolDiameter: number = 6,
  material: string = 'aluminum',
): WearProgressionResult {
  // Wear rates by material (percentage per mm of cutting)
  const wearRates: { [material: string]: number } = {
    aluminum: 0.001,
    steel: 0.005,
    stainless: 0.008,
    wood: 0.0005,
    plastic: 0.0003,
    brass: 0.002,
  };

  const baseWearRate = wearRates[material] ?? wearRates.aluminum;
  let prevX = 0, prevY = 0, prevZ = 0;
  let feedRate = 0;
  let currentTime = 0;
  let cumulativeDistance = 0;
  const points: WearProgressionPoint[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG1\b/i.test(code)) continue;

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) feedRate = parseFloat(fMatch[1]);

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const z = zMatch ? parseFloat(zMatch[1]) : prevZ;

    if (z < 0) {
      const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
      if (dist > 0) {
        cumulativeDistance += dist;
        if (feedRate > 0) currentTime += dist / (feedRate / 60);

        // Wear model: break-in (0-10%), steady (10-70%), accelerated (70-100%)
        let wearPercentage = 0;
        let stage: WearProgressionPoint['stage'] = 'break_in';
        let wearRate = baseWearRate;

        if (cumulativeDistance < 100) {
          // Break-in phase: faster initial wear
          wearPercentage = cumulativeDistance * baseWearRate * 2;
          stage = 'break_in';
          wearRate = baseWearRate * 2;
        } else if (wearPercentage < 70) {
          // Steady phase
          wearPercentage = 20 + (cumulativeDistance - 100) * baseWearRate;
          stage = 'steady';
          wearRate = baseWearRate;
        } else if (wearPercentage < 90) {
          // Accelerated phase
          wearPercentage += baseWearRate * 3;
          stage = 'accelerated';
          wearRate = baseWearRate * 3;
        } else {
          wearPercentage = Math.min(100, wearPercentage + baseWearRate * 5);
          stage = 'failure';
          wearRate = baseWearRate * 5;
        }

        // Factor in tool diameter (smaller tools wear faster)
        const diameterFactor = 6 / Math.max(1, toolDiameter);
        wearPercentage *= diameterFactor;

        points.push({
          time: currentTime, cumulativeDistance,
          wearPercentage: Math.min(100, wearPercentage),
          wearRate, stage,
        });
      }
    }

    prevX = x; prevY = y; prevZ = z;
  }

  const totalCuttingDistance = cumulativeDistance;
  const finalWearPercentage = points.length > 0 ? points[points.length - 1].wearPercentage : 0;
  const estimatedLifeRemaining = finalWearPercentage < 100
    ? (100 - finalWearPercentage) / baseWearRate
    : 0;
  const currentStage = points.length > 0 ? points[points.length - 1].stage : 'break_in';
  const wearRiskScore = Math.min(100, finalWearPercentage);

  const recommendations: string[] = [];
  if (finalWearPercentage > 80) {
    recommendations.push(`Tool wear at ${finalWearPercentage.toFixed(0)}% — replace tool soon`);
  }
  if (currentStage === 'accelerated') {
    recommendations.push('Tool in accelerated wear phase — monitor closely');
  }
  if (currentStage === 'failure') {
    recommendations.push('Tool at failure stage — replace immediately');
  }
  recommendations.push(`Cutting distance: ${totalCuttingDistance.toFixed(0)}mm, life remaining: ${estimatedLifeRemaining.toFixed(0)}mm`);
  if (finalWearPercentage < 30) {
    recommendations.push('Tool wear is low — tool in good condition');
  }

  return {
    points, totalCuttingDistance, finalWearPercentage,
    estimatedLifeRemaining, currentStage, wearRiskScore, recommendations,
  };
}

// ── 3. Print Retraction Speed Optimizer ──

export interface RetractionSpeedResult {
  /** Current retraction speed in mm/s */
  currentSpeed: number;
  /** Recommended retraction speed in mm/s */
  recommendedSpeed: number;
  /** Extruder type */
  extruderType: 'direct' | 'bowden' | 'unknown';
  /** Filament slip risk (0-100) */
  slipRisk: number;
  /** Stringing risk (0-100) */
  stringingRisk: number;
  /** Optimal speed score (0-100) */
  speedScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Optimize retraction speed settings.
 * Too fast can cause filament slip, too slow can cause stringing.
 *
 * @param lines G-code lines
 * @param filamentDiameter Filament diameter in mm (default 1.75)
 * @param extruderType Extruder type (default 'unknown')
 */
export function optimizeRetractionSpeed(
  lines: string[],
  filamentDiameter: number = 1.75,
  extruderType: 'direct' | 'bowden' | 'unknown' = 'unknown',
): RetractionSpeedResult {
  // Detect extruder type from retraction distances
  let totalRetractionDist = 0;
  let retractionCount = 0;
  let prevE = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG[01]\b/i.test(code)) continue;

    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);
    if (!eMatch) continue;

    const e = parseFloat(eMatch[1]);
    if (e < prevE) {
      retractionCount++;
      totalRetractionDist += prevE - e;
    }
    prevE = e;
  }

  const avgRetractionDist = retractionCount > 0 ? totalRetractionDist / retractionCount : 0;

  // Determine extruder type
  let detectedType = extruderType;
  if (extruderType === 'unknown') {
    if (avgRetractionDist > 3) detectedType = 'bowden';
    else if (avgRetractionDist > 0) detectedType = 'direct';
  }

  // Recommended speeds by extruder type (mm/s)
  const recommendedSpeed = detectedType === 'bowden' ? 25 : 35;

  // Estimate current speed from feed rate during retraction
  let currentSpeed = recommendedSpeed;
  for (const line of lines) {
    const trimmed = line.trim();
    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG[01]\b/i.test(code)) continue;
    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);
    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (eMatch && fMatch) {
      const e = parseFloat(eMatch[1]);
      if (e < prevE) {
        currentSpeed = parseFloat(fMatch[1]) / 60; // mm/min to mm/s
        break;
      }
    }
  }

  // Risk assessment
  const slipRisk = currentSpeed > 40 ? Math.min(100, (currentSpeed - 40) * 5) : 0;
  const stringingRisk = currentSpeed < 20 ? Math.min(100, (20 - currentSpeed) * 5) : 0;
  const speedScore = Math.max(0, 100 - slipRisk - stringingRisk);

  const recommendations: string[] = [];
  recommendations.push(`${detectedType} extruder: current ${currentSpeed.toFixed(0)}mm/s, recommended ${recommendedSpeed}mm/s`);
  if (slipRisk > 50) {
    recommendations.push(`High slip risk (${slipRisk}%) — reduce retraction speed`);
  }
  if (stringingRisk > 50) {
    recommendations.push(`High stringing risk (${stringingRisk}%) — increase retraction speed`);
  }
  if (retractionCount === 0) {
    recommendations.push('No retractions detected — enable retraction for better quality');
  }
  if (speedScore > 80) {
    recommendations.push('Optimal retraction speed — low risk of slip and stringing');
  }

  return {
    currentSpeed, recommendedSpeed, extruderType: detectedType,
    slipRisk, stringingRisk, speedScore, recommendations,
  };
}

// ── 4. G-code Line Complexity Scorer ──

export interface LineComplexityData {
  /** Line number */
  line: number;
  /** Complexity score (0-100) */
  complexity: number;
  /** Factors */
  factors: string[];
  /** Complexity level */
  level: 'simple' | 'moderate' | 'complex' | 'very_complex';
}

export interface LineComplexityResult {
  /** Per-line complexity data */
  lines: LineComplexityData[];
  /** Average complexity */
  avgComplexity: number;
  /** Max complexity */
  maxComplexity: number;
  /** Distribution by level */
  distribution: { [level: string]: number };
  /** Overall complexity score (0-100) */
  overallScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Score complexity of each G-code line.
 * Complexity is based on number of parameters, modal changes, and command type.
 *
 * @param lines G-code lines
 */
export function scoreLineComplexity(lines: string[]): LineComplexityResult {
  const lineData: LineComplexityData[] = [];
  let totalComplexity = 0;
  let maxComplexity = 0;
  const distribution: { [level: string]: number } = {
    simple: 0, moderate: 0, complex: 0, very_complex: 0,
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    let complexity = 0;
    const factors: string[] = [];

    // Base complexity per command
    if (/\bG[23]\b/i.test(code)) {
      complexity += 30;
      factors.push('arc_move');
    } else if (/\bG1\b/i.test(code)) {
      complexity += 10;
      factors.push('linear_move');
    } else if (/\bG0\b/i.test(code)) {
      complexity += 5;
      factors.push('rapid_move');
    } else if (/\bM\d+\b/i.test(code)) {
      complexity += 15;
      factors.push('misc_command');
    }

    // Parameter complexity
    const params = code.match(/\b[XYZEFIJKRST][-]?\d/g) || [];
    complexity += params.length * 5;
    if (params.length > 4) factors.push('many_params');

    // Comment complexity
    if (line.includes(';') && !line.startsWith(';')) {
      complexity += 2;
      factors.push('inline_comment');
    }

    // Multiple commands
    const commands = code.match(/\b[GM]\d+/gi) || [];
    if (commands.length > 2) {
      complexity += 10;
      factors.push('multiple_commands');
    }

    complexity = Math.min(100, complexity);
    const level = complexity < 20 ? 'simple' : complexity < 40 ? 'moderate'
      : complexity < 70 ? 'complex' : 'very_complex';

    lineData.push({ line: i, complexity, factors, level });
    totalComplexity += complexity;
    maxComplexity = Math.max(maxComplexity, complexity);
    distribution[level]++;
  }

  const avgComplexity = lineData.length > 0 ? totalComplexity / lineData.length : 0;
  const overallScore = Math.min(100, avgComplexity);

  const recommendations: string[] = [];
  if (distribution.very_complex > 10) {
    recommendations.push(`${distribution.very_complex} very complex lines — consider simplifying`);
  }
  if (maxComplexity === 100) {
    recommendations.push('Max complexity reached — some lines may be hard to debug');
  }
  recommendations.push(`${lineData.length} lines, avg complexity ${avgComplexity.toFixed(0)}/100`);
  if (overallScore < 30) {
    recommendations.push('Low overall complexity — easy to read and debug');
  }

  return {
    lines: lineData, avgComplexity, maxComplexity,
    distribution, overallScore, recommendations,
  };
}

// ── 5. CNC Depth of Cut Optimizer ──

export interface DOCOptimizationPoint {
  /** Current depth of cut */
  currentDOC: number;
  /** Recommended depth of cut */
  recommendedDOC: number;
  /** Reason */
  reason: string;
  /** Material removal efficiency */
  efficiency: number;
}

export interface DOCOptimizerResult {
  /** Optimization points */
  points: DOCOptimizationPoint[];
  /** Current max DOC */
  currentMaxDOC: number;
  /** Recommended max DOC */
  recommendedMaxDOC: number;
  /** Material */
  material: string;
  /** Tool diameter */
  toolDiameter: number;
  /** Optimization score (0-100) */
  optimizationScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Optimize depth of cut strategy.
 * Recommends optimal DOC based on material, tool diameter, and current usage.
 *
 * @param lines G-code lines
 * @param toolDiameter Tool diameter in mm (default 6)
 * @param material Material type (default 'aluminum')
 */
export function optimizeDepthOfCut(
  lines: string[],
  toolDiameter: number = 6,
  material: string = 'aluminum',
): DOCOptimizerResult {
  // Recommended DOC ranges by material (as fraction of tool diameter)
  const docRanges: { [material: string]: { min: number; max: number } } = {
    aluminum: { min: 0.5, max: 1.0 },
    steel: { min: 0.2, max: 0.5 },
    stainless: { min: 0.1, max: 0.3 },
    wood: { min: 1.0, max: 2.0 },
    plastic: { min: 0.5, max: 1.5 },
  };

  const range = docRanges[material] ?? docRanges.aluminum;
  const recommendedMaxDOC = toolDiameter * range.max;

  const points: DOCOptimizationPoint[] = [];
  let prevZ = 0;
  let currentMaxDOC = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG1\b/i.test(code)) continue;

    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    if (zMatch) {
      const z = parseFloat(zMatch[1]);
      if (z < 0) {
        const doc = Math.abs(z);
        currentMaxDOC = Math.max(currentMaxDOC, doc);

        const recommendedDOC = Math.min(recommendedMaxDOC, doc);
        const efficiency = (recommendedDOC / doc) * 100;
        const reason = doc > recommendedMaxDOC
          ? 'DOC exceeds recommended — reduce for tool life'
          : doc < toolDiameter * range.min
          ? 'DOC below optimal — increase for efficiency'
          : 'DOC is optimal';

        points.push({ currentDOC: doc, recommendedDOC, reason, efficiency });
      }
      prevZ = z;
    }
  }

  const avgEfficiency = points.length > 0
    ? points.reduce((s, p) => s + p.efficiency, 0) / points.length : 100;
  const optimizationScore = Math.min(100, avgEfficiency);

  const recommendations: string[] = [];
  if (currentMaxDOC > recommendedMaxDOC) {
    recommendations.push(`Max DOC ${currentMaxDOC.toFixed(1)}mm exceeds recommended ${recommendedMaxDOC.toFixed(1)}mm for ${material}`);
  }
  if (currentMaxDOC < toolDiameter * range.min) {
    recommendations.push(`DOC below optimal — increase to ${toolDiameter * range.min}mm for better efficiency`);
  }
  recommendations.push(`Recommended DOC for ${toolDiameter}mm tool in ${material}: ${range.min}-${range.max}× diameter`);
  if (optimizationScore > 80) {
    recommendations.push('DOC is well-optimized for material and tool');
  }

  return {
    points, currentMaxDOC, recommendedMaxDOC, material,
    toolDiameter, optimizationScore, recommendations,
  };
}

// ── 6. Print Layer Fan Speed Optimizer ──

export interface LayerFanAdvice {
  /** Layer number */
  layer: number;
  /** Current fan speed */
  currentFanSpeed: number;
  /** Recommended fan speed */
  recommendedFanSpeed: number;
  /** Reason */
  reason: string;
}

export interface LayerFanOptimizerResult {
  /** Per-layer fan advice */
  advice: LayerFanAdvice[];
  /** Layer count */
  layerCount: number;
  /** First layer fan-off recommendation */
  firstLayerFanOff: boolean;
  /** Recommended fan ramp-up layers */
  rampUpLayers: number;
  /** Overall fan optimization score (0-100) */
  fanOptScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Optimize fan speed per layer.
 * Recommends fan-off for first layers and gradual ramp-up.
 *
 * @param lines G-code lines
 * @param firstLayerCount Number of first layers to keep fan off (default 3)
 */
export function optimizeLayerFanSpeed(
  lines: string[],
  firstLayerCount: number = 3,
): LayerFanOptimizerResult {
  const advice: LayerFanAdvice[] = [];
  let currentZ = 0;
  let firstZ = 0;
  let layerNum = 0;
  let fanSpeed = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Track fan
    if (/\bM106\b/i.test(code)) {
      const sMatch = code.match(/\bS(\d*\.?\d+)/i);
      fanSpeed = sMatch ? parseFloat(sMatch[1]) : 255;
    }
    if (/\bM107\b/i.test(code)) fanSpeed = 0;

    // Track layers
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    if (zMatch) {
      const z = parseFloat(zMatch[1]);
      if (firstZ === 0) firstZ = z;
      if (z > currentZ + 0.01) {
        layerNum++;
        currentZ = z;

        let recommendedFanSpeed: number;
        let reason: string;

        if (layerNum <= firstLayerCount) {
          recommendedFanSpeed = 0;
          reason = 'First layers: fan off for bed adhesion';
        } else if (layerNum <= firstLayerCount + 3) {
          recommendedFanSpeed = 128;
          reason = 'Ramp-up: partial cooling';
        } else {
          recommendedFanSpeed = 255;
          reason = 'Full cooling for overhangs and detail';
        }

        advice.push({
          layer: layerNum, currentFanSpeed: fanSpeed,
          recommendedFanSpeed, reason,
        });
      }
    }
  }

  const layerCount = advice.length;
  const firstLayerFanOff = advice.length > 0 && advice[0].recommendedFanSpeed === 0;
  const rampUpLayers = 3;

  // Score: how well current fan matches recommendations
  const matchCount = advice.filter(a => Math.abs(a.currentFanSpeed - a.recommendedFanSpeed) < 50).length;
  const fanOptScore = layerCount > 0 ? (matchCount / layerCount) * 100 : 100;

  const recommendations: string[] = [];
  if (layerCount > 0 && advice[0].currentFanSpeed > 0) {
    recommendations.push(`Fan on at layer 1 — disable for first ${firstLayerCount} layers for adhesion`);
  }
  if (fanOptScore < 50) {
    recommendations.push(`Fan speed often mismatches recommendations — adjust fan settings`);
  }
  recommendations.push(`Recommended: fan off for ${firstLayerCount} layers, ramp up over ${rampUpLayers} layers`);
  if (fanOptScore > 80) {
    recommendations.push('Fan speed well-optimized — matches recommendations');
  }

  return {
    advice, layerCount, firstLayerFanOff, rampUpLayers,
    fanOptScore, recommendations,
  };
}

// ── 7. G-code Circular Interpolation Detector ──

export interface ArcOpportunity {
  /** Start line */
  startLine: number;
  /** End line */
  endLine: number;
  /** Number of segments that could be an arc */
  segmentCount: number;
  /** Estimated radius in mm */
  estimatedRadius: number;
  /** Fit error in mm */
  fitError: number;
  /** Potential savings (lines saved) */
  linesSaved: number;
}

export interface CircularInterpolationResult {
  /** Detected arc opportunities */
  opportunities: ArcOpportunity[];
  /** Opportunity count */
  opportunityCount: number;
  /** Total lines that could be saved */
  totalLinesSaved: number;
  /** Total segments analyzed */
  totalSegments: number;
  /** Conversion potential score (0-100) */
  conversionScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Detect opportunities for circular interpolation.
 * Finds sequences of linear moves that could be replaced with G2/G3 arcs.
 *
 * @param lines G-code lines
 * @param tolerance Fit tolerance in mm (default 0.01)
 * @param minSegments Minimum segments to consider (default 5)
 */
export function detectCircularInterpolation(
  lines: string[],
  tolerance: number = 0.01,
  minSegments: number = 5,
): CircularInterpolationResult {
  const opportunities: ArcOpportunity[] = [];
  let prevX = 0, prevY = 0;
  const segments: { line: number; x: number; y: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG1\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;

    segments.push({ line: i, x, y });
    prevX = x; prevY = y;
  }

  // Look for arc opportunities in sliding windows
  for (let i = 0; i < segments.length - minSegments; i++) {
    const window = segments.slice(i, i + minSegments + 5);
    if (window.length < minSegments) continue;

    // Try to fit a circle to the points
    const points = window.map(s => ({ x: s.x, y: s.y }));

    // Simple circle fit: use first, middle, and last points
    const p1 = points[0];
    const p2 = points[Math.floor(points.length / 2)];
    const p3 = points[points.length - 1];

    // Calculate circle from 3 points
    const ax = p1.x, ay = p1.y;
    const bx = p2.x, by = p2.y;
    const cx = p3.x, cy = p3.y;

    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(d) < 0.001) continue;

    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
    const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;

    const centerX = ux;
    const centerY = uy;
    const radius = Math.sqrt((ax - centerX) ** 2 + (ay - centerY) ** 2);

    // Check fit error
    let maxError = 0;
    for (const p of points) {
      const dist = Math.sqrt((p.x - centerX) ** 2 + (p.y - centerY) ** 2);
      const error = Math.abs(dist - radius);
      maxError = Math.max(maxError, error);
    }

    if (maxError < tolerance) {
      opportunities.push({
        startLine: window[0].line,
        endLine: window[window.length - 1].line,
        segmentCount: window.length,
        estimatedRadius: radius,
        fitError: maxError,
        linesSaved: window.length - 1, // One G2/G3 replaces all
      });
      i += window.length - 1; // Skip ahead
    }
  }

  const opportunityCount = opportunities.length;
  const totalLinesSaved = opportunities.reduce((s, o) => s + o.linesSaved, 0);
  const totalSegments = segments.length;
  const conversionScore = totalSegments > 0 ? (totalLinesSaved / totalSegments) * 100 : 0;

  const recommendations: string[] = [];
  if (opportunityCount > 0) {
    recommendations.push(`${opportunityCount} arc opportunities — convert to G2/G3 for smaller files`);
  }
  if (totalLinesSaved > 50) {
    recommendations.push(`${totalLinesSaved} lines could be saved — significant file size reduction`);
  }
  for (const opp of opportunities.slice(0, 3)) {
    recommendations.push(`Lines ${opp.startLine}-${opp.endLine}: ${opp.segmentCount} segments, r=${opp.estimatedRadius.toFixed(2)}mm`);
  }
  if (opportunityCount === 0) {
    recommendations.push('No arc conversion opportunities — toolpath already optimized');
  }

  return {
    opportunities, opportunityCount, totalLinesSaved,
    totalSegments, conversionScore, recommendations,
  };
}

// ── 8. CNC Tool Path Efficiency Calculator ──

export interface EfficiencyMetrics {
  /** Cutting distance in mm */
  cuttingDistance: number;
  /** Travel distance in mm */
  travelDistance: number;
  /** Total distance in mm */
  totalDistance: number;
  /** Cutting time in seconds */
  cuttingTime: number;
  /** Travel time in seconds */
  travelTime: number;
  /** Total time in seconds */
  totalTime: number;
  /** Cutting ratio (cutting / total distance) */
  cuttingRatio: number;
  /** Engagement ratio (cutting time / total time) */
  engagementRatio: number;
}

export interface ToolpathEfficiencyResult {
  /** Efficiency metrics */
  metrics: EfficiencyMetrics;
  /** Efficiency score (0-100) */
  efficiencyScore: number;
  /** Wasted travel percentage */
  wastedTravelPercentage: number;
  /** Optimization potential */
  optimizationPotential: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Calculate toolpath efficiency metrics.
 * Measures cutting vs travel ratio and engagement time.
 *
 * @param lines G-code lines
 */
export function calculateToolpathEfficiency(lines: string[]): ToolpathEfficiencyResult {
  let prevX = 0, prevY = 0, prevZ = 0;
  let feedRate = 0;
  let cuttingDistance = 0;
  let travelDistance = 0;
  let cuttingTime = 0;
  let travelTime = 0;

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

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const z = zMatch ? parseFloat(zMatch[1]) : prevZ;

    const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2 + (z - prevZ) ** 2);
    const isRapid = /\bG0\b/i.test(code);
    const isCutting = z < 0 && !isRapid;

    if (dist > 0 && feedRate > 0) {
      const time = dist / (feedRate / 60);
      if (isCutting) {
        cuttingDistance += dist;
        cuttingTime += time;
      } else {
        travelDistance += dist;
        travelTime += time;
      }
    }

    prevX = x; prevY = y; prevZ = z;
  }

  const totalDistance = cuttingDistance + travelDistance;
  const totalTime = cuttingTime + travelTime;
  const cuttingRatio = totalDistance > 0 ? cuttingDistance / totalDistance : 0;
  const engagementRatio = totalTime > 0 ? cuttingTime / totalTime : 0;
  const efficiencyScore = Math.round(engagementRatio * 100);
  const wastedTravelPercentage = (1 - cuttingRatio) * 100;
  const optimizationPotential = Math.max(0, wastedTravelPercentage - 20); // 20% travel is normal

  const metrics: EfficiencyMetrics = {
    cuttingDistance, travelDistance, totalDistance,
    cuttingTime, travelTime, totalTime,
    cuttingRatio, engagementRatio,
  };

  const recommendations: string[] = [];
  if (wastedTravelPercentage > 50) {
    recommendations.push(`${wastedTravelPercentage.toFixed(0)}% travel — optimize part placement`);
  }
  if (engagementRatio < 0.5) {
    recommendations.push(`Low engagement (${(engagementRatio * 100).toFixed(0)}%) — more travel than cutting`);
  }
  recommendations.push(`Cutting: ${cuttingDistance.toFixed(0)}mm, Travel: ${travelDistance.toFixed(0)}mm`);
  if (efficiencyScore > 80) {
    recommendations.push('High efficiency — minimal travel waste');
  }

  return {
    metrics, efficiencyScore, wastedTravelPercentage,
    optimizationPotential, recommendations,
  };
}

// ── 9. Print Material Usage Per Layer Tracker ──

export interface LayerMaterialData {
  /** Layer number */
  layer: number;
  /** Z height */
  zHeight: number;
  /** Filament used in mm */
  filamentMm: number;
  /** Filament weight in grams */
  filamentG: number;
  /** Percentage of total */
  percentage: number;
  /** Cumulative filament in mm */
  cumulativeMm: number;
}

export interface MaterialPerLayerResult {
  /** Per-layer material data */
  layers: LayerMaterialData[];
  /** Total filament in mm */
  totalFilamentMm: number;
  /** Total filament in grams */
  totalFilamentG: number;
  /** Average filament per layer in mm */
  avgPerLayer: number;
  /** Max filament layer */
  maxLayer: LayerMaterialData | null;
  /** Layer count */
  layerCount: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Track material usage per layer.
 * Shows filament consumption distribution across layers.
 *
 * @param lines G-code lines
 * @param filamentDiameter Filament diameter in mm (default 1.75)
 * @param filamentDensity Filament density in g/cm³ (default 1.24)
 */
export function trackMaterialPerLayer(
  lines: string[],
  filamentDiameter: number = 1.75,
  filamentDensity: number = 1.24,
): MaterialPerLayerResult {
  const layers: LayerMaterialData[] = [];
  let prevE = 0;
  let currentZ = 0;
  let firstZ = 0;
  let layerNum = 0;
  let layerFilament = 0;
  let cumulativeMm = 0;
  const filamentArea = Math.PI * (filamentDiameter / 2) ** 2;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    if (zMatch) {
      const z = parseFloat(zMatch[1]);
      if (firstZ === 0) firstZ = z;
      if (z > currentZ + 0.01 && layerNum > 0) {
        // Layer change
        const filamentG = (layerFilament * filamentArea / 1000) * filamentDensity;
        layers.push({
          layer: layerNum, zHeight: currentZ,
          filamentMm: layerFilament, filamentG,
          percentage: 0, cumulativeMm,
        });
        cumulativeMm += layerFilament;
        layerNum++;
        currentZ = z;
        layerFilament = 0;
      } else if (layerNum === 0) {
        currentZ = z;
        layerNum = 1;
      }
    }

    if (/\bG1\b/i.test(code)) {
      const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);
      if (eMatch) {
        const e = parseFloat(eMatch[1]);
        if (e > prevE) {
          layerFilament += e - prevE;
        }
        prevE = e;
      }
    }
  }

  // Record last layer
  if (layerFilament > 0) {
    const filamentG = (layerFilament * filamentArea / 1000) * filamentDensity;
    layers.push({
      layer: layerNum, zHeight: currentZ,
      filamentMm: layerFilament, filamentG,
      percentage: 0, cumulativeMm,
    });
    cumulativeMm += layerFilament;
  }

  const totalFilamentMm = cumulativeMm;
  const totalFilamentG = layers.reduce((s, l) => s + l.filamentG, 0);

  // Compute percentages
  for (const l of layers) {
    l.percentage = totalFilamentMm > 0 ? (l.filamentMm / totalFilamentMm) * 100 : 0;
    l.cumulativeMm = layers.slice(0, l.layer).reduce((s, ll) => s + ll.filamentMm, 0);
  }

  const layerCount = layers.length;
  const avgPerLayer = layerCount > 0 ? totalFilamentMm / layerCount : 0;
  const maxLayer = layerCount > 0
    ? layers.reduce((max, l) => l.filamentMm > max.filamentMm ? l : max, layers[0])
    : null;

  const recommendations: string[] = [];
  if (maxLayer) {
    recommendations.push(`Most material: layer ${maxLayer.layer} (${maxLayer.filamentMm.toFixed(1)}mm)`);
  }
  if (layerCount > 0) {
    recommendations.push(`${layerCount} layers, ${totalFilamentMm.toFixed(1)}mm total, avg ${avgPerLayer.toFixed(1)}mm/layer`);
  }
  if (maxLayer && maxLayer.filamentMm > avgPerLayer * 3) {
    recommendations.push(`Layer ${maxLayer.layer} uses 3× average — check for solid layers`);
  }
  if (layerCount === 0) {
    recommendations.push('No layers detected — check G-code');
  }

  return {
    layers, totalFilamentMm, totalFilamentG, avgPerLayer,
    maxLayer, layerCount, recommendations,
  };
}

// ── 10. G-code Command Redundancy Remover ──

export interface RedundancyItem {
  /** Line number */
  line: number;
  /** Command */
  command: string;
  /** Redundancy type */
  type: 'repeated_modal' | 'repeated_feed' | 'repeated_spindle' | 'repeated_units' | 'empty_line';
  /** Description */
  description: string;
}

export interface RedundancyRemoverResult {
  /** All redundant items */
  items: RedundancyItem[];
  /** Redundancy count */
  count: number;
  /** Lines that can be removed */
  removableLines: number;
  /** Estimated file size reduction in bytes */
  sizeReduction: number;
  /** Redundancy percentage */
  redundancyPercentage: number;
  /** Cleanup score (0-100, higher is better) */
  cleanupScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Identify and remove redundant G-code commands.
 * Finds repeated modal commands, feed rates, and empty lines.
 *
 * @param lines G-code lines
 */
export function removeCommandRedundancy(lines: string[]): RedundancyRemoverResult {
  const items: RedundancyItem[] = [];
  let prevFeedRate = 0;
  let prevRpm = 0;
  let prevUnits = '';
  let prevModal = '';
  let emptyLineCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Empty lines
    if (!trimmed) {
      emptyLineCount++;
      items.push({ line: i, command: '', type: 'empty_line', description: 'Empty line' });
      continue;
    }

    if (trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Repeated feed rate
    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) {
      const feedRate = parseFloat(fMatch[1]);
      if (feedRate === prevFeedRate && prevFeedRate > 0) {
        items.push({
          line: i, command: code, type: 'repeated_feed',
          description: `Repeated feed rate F${feedRate}`,
        });
      }
      prevFeedRate = feedRate;
    }

    // Repeated spindle
    const sMatch = code.match(/\bS(\d*\.?\d+)/i);
    if (sMatch) {
      const rpm = parseFloat(sMatch[1]);
      if (rpm === prevRpm && prevRpm > 0) {
        items.push({
          line: i, command: code, type: 'repeated_spindle',
          description: `Repeated spindle S${rpm}`,
        });
      }
      prevRpm = rpm;
    }

    // Repeated units
    if (/\bG2[01]\b/i.test(code)) {
      const units = /\bG21\b/i.test(code) ? 'G21' : 'G20';
      if (units === prevUnits && prevUnits) {
        items.push({
          line: i, command: code, type: 'repeated_units',
          description: `Repeated units ${units}`,
        });
      }
      prevUnits = units;
    }

    // Repeated modal (G0/G1)
    if (/\bG[01]\b/i.test(code)) {
      const modal = /\bG0\b/i.test(code) ? 'G0' : 'G1';
      if (modal === prevModal && prevModal) {
        items.push({
          line: i, command: code, type: 'repeated_modal',
          description: `Repeated modal ${modal}`,
        });
      }
      prevModal = modal;
    }
  }

  const count = items.length;
  const removableLines = count;
  const sizeReduction = items.reduce((s, item) => s + (lines[item.line]?.length ?? 0) + 1, 0);
  const redundancyPercentage = lines.length > 0 ? (count / lines.length) * 100 : 0;
  const cleanupScore = Math.max(0, 100 - redundancyPercentage);

  const recommendations: string[] = [];
  if (removableLines > 50) {
    recommendations.push(`${removableLines} redundant lines can be removed — saves ~${sizeReduction} bytes`);
  }
  if (emptyLineCount > 20) {
    recommendations.push(`${emptyLineCount} empty lines — remove for smaller file`);
  }
  const repeatedFeedCount = items.filter(i => i.type === 'repeated_feed').length;
  if (repeatedFeedCount > 10) {
    recommendations.push(`${repeatedFeedCount} repeated feed rates — modal F is sticky`);
  }
  if (cleanupScore > 90) {
    recommendations.push('Clean G-code — minimal redundancy');
  }

  return {
    items, count, removableLines, sizeReduction,
    redundancyPercentage, cleanupScore, recommendations,
  };
}

// ── 11. CNC Cutting Strategy Advisor ──

export interface StrategyAdvice {
  /** Strategy type */
  strategy: 'climb' | 'conventional' | 'mixed';
  /** Recommended strategy */
  recommended: 'climb' | 'conventional';
  /** Reason */
  reason: string;
  /** Confidence (0-100) */
  confidence: number;
}

export interface CuttingStrategyResult {
  /** Strategy advice */
  advice: StrategyAdvice;
  /** Climb milling percentage */
  climbPercentage: number;
  /** Conventional milling percentage */
  conventionalPercentage: number;
  /** Direction changes at boundaries */
  boundaryChanges: number;
  /** Strategy consistency score (0-100) */
  consistencyScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Advise on cutting strategy.
 * Analyzes climb vs conventional milling patterns.
 *
 * @param lines G-code lines
 * @param toolDiameter Tool diameter in mm (default 6)
 */
export function adviseCuttingStrategy(
  lines: string[],
  toolDiameter: number = 6,
): CuttingStrategyResult {
  let prevX = 0, prevY = 0, prevZ = 0;
  let climbCount = 0;
  let conventionalCount = 0;
  let boundaryChanges = 0;
  let prevDirection: 'climb' | 'conventional' | null = null;

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
      // Determine direction: simplified climb vs conventional detection
      const dx = x - prevX;
      const dy = y - prevY;

      if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
        // Simplified: positive X movement = climb, negative = conventional
        // In reality, this depends on spindle rotation and tool offset
        const direction: 'climb' | 'conventional' = dx > 0 ? 'climb' : 'conventional';

        if (direction === 'climb') climbCount++;
        else conventionalCount++;

        if (prevDirection && direction !== prevDirection) {
          boundaryChanges++;
        }
        prevDirection = direction;
      }
    }

    prevX = x; prevY = y; prevZ = z;
  }

  const total = climbCount + conventionalCount;
  const climbPercentage = total > 0 ? (climbCount / total) * 100 : 0;
  const conventionalPercentage = total > 0 ? (conventionalCount / total) * 100 : 0;

  const strategy: StrategyAdvice['strategy'] =
    climbPercentage > 70 ? 'climb' : conventionalPercentage > 70 ? 'conventional' : 'mixed';

  const recommended: StrategyAdvice['recommended'] = 'climb'; // Climb generally preferred
  const reason = strategy === 'climb'
    ? 'Climb milling detected — better surface finish and tool life'
    : strategy === 'conventional'
    ? 'Conventional milling detected — consider climb for better finish'
    : 'Mixed strategy — standardize for consistent results';

  const confidence = Math.max(climbPercentage, conventionalPercentage);
  const consistencyScore = 100 - Math.abs(climbPercentage - conventionalPercentage);

  const advice: StrategyAdvice = { strategy, recommended, reason, confidence };

  const recommendations: string[] = [];
  recommendations.push(`Climb: ${climbPercentage.toFixed(0)}%, Conventional: ${conventionalPercentage.toFixed(0)}%`);
  if (strategy === 'conventional') {
    recommendations.push('Consider climb milling for better surface finish');
  }
  if (boundaryChanges > 20) {
    recommendations.push(`${boundaryChanges} direction changes — standardize strategy`);
  }
  if (strategy === 'climb') {
    recommendations.push('Good strategy — climb milling provides better finish');
  }
  if (consistencyScore > 80) {
    recommendations.push('Consistent strategy — uniform cutting direction');
  }

  return {
    advice, climbPercentage, conventionalPercentage,
    boundaryChanges, consistencyScore, recommendations,
  };
}

// ── 12. Print Ironing Pattern Analyzer ──

export interface IroningData {
  /** Layer number */
  layer: number;
  /** Ironing pass count */
  passCount: number;
  /** Ironing distance in mm */
  distance: number;
  /** Ironing flow rate percentage */
  flowRate: number;
}

export interface IroningResult {
  /** Per-layer ironing data */
  layers: IroningData[];
  /** Whether ironing is detected */
  detected: boolean;
  /** Ironed layer count */
  ironedLayerCount: number;
  /** Total ironing distance in mm */
  totalDistance: number;
  /** Average flow rate */
  avgFlowRate: number;
  /** Ironing quality score (0-100) */
  ironingScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze ironing patterns.
 * Ironing is a post-extrusion pass that smooths top surfaces.
 *
 * @param lines G-code lines
 */
export function analyzeIroningPattern(lines: string[]): IroningResult {
  const layers: IroningData[] = [];
  let prevX = 0, prevY = 0, prevE = 0;
  let currentZ = 0;
  let firstZ = 0;
  let layerNum = 0;
  let passCount = 0;
  let layerDistance = 0;
  let layerFlowSum = 0;
  let layerFlowCount = 0;
  let isIroning = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check for ironing comments (before skipping comment lines)
    if (/;.*iron/i.test(trimmed) || /\(.*iron/i.test(trimmed)) {
      isIroning = true;
    }

    if (trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    if (zMatch) {
      const z = parseFloat(zMatch[1]);
      if (firstZ === 0) firstZ = z;
      if (z > currentZ + 0.01 && layerNum > 0) {
        // Layer change
        if (passCount > 0) {
          layers.push({
            layer: layerNum, passCount,
            distance: layerDistance,
            flowRate: layerFlowCount > 0 ? layerFlowSum / layerFlowCount : 0,
          });
        }
        layerNum++;
        currentZ = z;
        passCount = 0;
        layerDistance = 0;
        layerFlowSum = 0;
        layerFlowCount = 0;
        isIroning = false;
      } else if (layerNum === 0) {
        currentZ = z;
        layerNum = 1;
      }
    }

    if (/\bG1\b/i.test(code)) {
      const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
      const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

      const x = xMatch ? parseFloat(xMatch[1]) : prevX;
      const y = yMatch ? parseFloat(yMatch[1]) : prevY;
      const e = eMatch ? parseFloat(eMatch[1]) : prevE;

      // Ironing: small extrusion while moving on same Z
      if (e > prevE && isIroning) {
        const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
        if (dist > 0) {
          passCount++;
          layerDistance += dist;
          const flowRate = ((e - prevE) / dist) * 100;
          layerFlowSum += flowRate;
          layerFlowCount++;
        }
      }

      prevX = x; prevY = y; prevE = e;
    }
  }

  // Record last layer
  if (passCount > 0) {
    layers.push({
      layer: layerNum, passCount,
      distance: layerDistance,
      flowRate: layerFlowCount > 0 ? layerFlowSum / layerFlowCount : 0,
    });
  }

  const detected = layers.length > 0;
  const ironedLayerCount = layers.length;
  const totalDistance = layers.reduce((s, l) => s + l.distance, 0);
  const avgFlowRate = layers.length > 0 ? layers.reduce((s, l) => s + l.flowRate, 0) / layers.length : 0;
  const ironingScore = detected ? Math.min(100, ironedLayerCount * 10 + 50) : 0;

  const recommendations: string[] = [];
  if (!detected) {
    recommendations.push('No ironing detected — enable ironing for smoother top surfaces');
  }
  if (detected) {
    recommendations.push(`${ironedLayerCount} ironed layers, ${totalDistance.toFixed(0)}mm total`);
  }
  if (avgFlowRate > 0 && avgFlowRate < 10) {
    recommendations.push(`Low ironing flow (${avgFlowRate.toFixed(1)}%) — good for surface finish`);
  }
  if (avgFlowRate > 20) {
    recommendations.push(`High ironing flow (${avgFlowRate.toFixed(1)}%) — may over-extrude`);
  }
  if (detected && ironingScore > 70) {
    recommendations.push('Good ironing coverage — smooth top surfaces expected');
  }

  return {
    layers, detected, ironedLayerCount, totalDistance,
    avgFlowRate, ironingScore, recommendations,
  };
}
