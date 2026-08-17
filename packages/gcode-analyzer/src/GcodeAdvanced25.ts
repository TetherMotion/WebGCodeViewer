/**
 * @file GcodeAdvanced25.ts
 * @brief Twenty-fifth batch of advanced G-code analysis features for CNC and 3D printing.
 *
 * This module provides 12 additional high-impact features:
 *  1. CNC air cutting time calculator (CNC)
 *  2. Print bead width variance analyzer (3DP)
 *  3. G-code parameter range validator (Universal)
 *  4. CNC tool path engagement heatmap per layer (CNC)
 *  5. Print cooling fan duty cycle analyzer (3DP)
 *  6. G-code tool change position optimizer (Universal)
 *  7. CNC spindle speed optimization advisor (CNC)
 *  8. Print first layer height optimizer (3DP)
 *  9. G-code toolpath continuity checker per layer (Universal)
 * 10. CNC tool path minimum clearance calculator (CNC)
 * 11. Print wall thickness consistency analyzer (3DP)
 * 12. G-code execution order optimizer (Universal)
 */

// ── 1. CNC Air Cutting Time Calculator ──

export interface AirCuttingResult {
  /** Total air cutting time in seconds */
  airCuttingTime: number;
  /** Total air cutting distance in mm */
  airCuttingDistance: number;
  /** Total cutting time in seconds */
  cuttingTime: number;
  /** Air cutting percentage */
  airCuttingPercentage: number;
  /** Air cutting segment count */
  airCuttingCount: number;
  /** Longest air cutting segment in mm */
  longestAirCut: number;
  /** Air cutting efficiency score (0-100, higher is better) */
  efficiencyScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Calculate air cutting time (non-cutting G1 moves at cutting height).
 * Air cutting wastes time and can cause rubbing on CNC tools.
 *
 * @param lines G-code lines
 */
export function calculateAirCuttingTime(lines: string[]): AirCuttingResult {
  let prevX = 0, prevY = 0, prevZ = 0;
  let feedRate = 0;
  let airCuttingTime = 0;
  let cuttingTime = 0;
  let airCuttingDistance = 0;
  let airCuttingCount = 0;
  let longestAirCut = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) feedRate = parseFloat(fMatch[1]);

    if (!/\bG1\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const z = zMatch ? parseFloat(zMatch[1]) : prevZ;

    const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2 + (z - prevZ) ** 2);

    if (dist > 0 && feedRate > 0) {
      const time = dist / (feedRate / 60);
      // Air cutting: G1 move at or above Z=0 (not cutting)
      if (z >= 0) {
        airCuttingTime += time;
        airCuttingDistance += dist;
        airCuttingCount++;
        longestAirCut = Math.max(longestAirCut, dist);
      } else {
        cuttingTime += time;
      }
    }

    prevX = x; prevY = y; prevZ = z;
  }

  const totalTime = airCuttingTime + cuttingTime;
  const airCuttingPercentage = totalTime > 0 ? (airCuttingTime / totalTime) * 100 : 0;
  const efficiencyScore = Math.max(0, 100 - airCuttingPercentage);

  const recommendations: string[] = [];
  recommendations.push(`Air cutting: ${airCuttingTime.toFixed(1)}s (${airCuttingPercentage.toFixed(1)}%), ${airCuttingDistance.toFixed(0)}mm`);
  if (airCuttingPercentage > 30) {
    recommendations.push(`High air cutting (${airCuttingPercentage.toFixed(0)}%) — optimize toolpath to reduce wasted moves`);
  }
  if (longestAirCut > 100) {
    recommendations.push(`Longest air cut: ${longestAirCut.toFixed(0)}mm — consider rapid (G0) instead`);
  }
  if (airCuttingCount > 20) {
    recommendations.push(`${airCuttingCount} air cutting segments — minimize for tool life`);
  }
  if (efficiencyScore > 80) {
    recommendations.push('Low air cutting — efficient toolpath');
  }

  return {
    airCuttingTime, airCuttingDistance, cuttingTime,
    airCuttingPercentage, airCuttingCount, longestAirCut,
    efficiencyScore, recommendations,
  };
}

// ── 2. Print Bead Width Variance Analyzer ──

export interface BeadWidthVarianceResult {
  /** Average bead width in mm */
  avgBeadWidth: number;
  /** Bead width standard deviation in mm */
  stdDev: number;
  /** Min bead width in mm */
  minWidth: number;
  /** Max bead width in mm */
  maxWidth: number;
  /** Coefficient of variation (0-1) */
  coefficientOfVariation: number;
  /** Inconsistent segment count */
  inconsistentSegmentCount: number;
  /** Consistency score (0-100) */
  consistencyScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze bead width variance in 3D printing.
 * Inconsistent bead width indicates extrusion or motion issues.
 *
 * @param lines G-code lines
 * @param nozzleDiameter Nozzle diameter in mm (default 0.4)
 */
export function analyzeBeadWidthVariance(
  lines: string[],
  nozzleDiameter: number = 0.4,
): BeadWidthVarianceResult {
  const beadWidths: number[] = [];
  let prevX = 0, prevY = 0, prevE = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG1\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const e = eMatch ? parseFloat(eMatch[1]) : prevE;

    if (e > prevE) {
      const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
      if (dist > 0) {
        // Bead width = extrusion volume / (distance * layer height)
        // Simplified: eDelta / dist * constant
        const eDelta = e - prevE;
        const beadWidth = (eDelta / dist) * nozzleDiameter * 2;
        beadWidths.push(beadWidth);
      }
    }

    prevX = x; prevY = y; prevE = e;
  }

  if (beadWidths.length < 10) {
    return {
      avgBeadWidth: 0, stdDev: 0, minWidth: 0, maxWidth: 0,
      coefficientOfVariation: 0, inconsistentSegmentCount: 0,
      consistencyScore: 100,
      recommendations: ['Insufficient data for bead width variance analysis'],
    };
  }

  const avgBeadWidth = beadWidths.reduce((a, b) => a + b, 0) / beadWidths.length;
  const minWidth = Math.min(...beadWidths);
  const maxWidth = Math.max(...beadWidths);
  const stdDev = Math.sqrt(beadWidths.reduce((s, w) => s + (w - avgBeadWidth) ** 2, 0) / beadWidths.length);
  const coefficientOfVariation = avgBeadWidth > 0 ? stdDev / avgBeadWidth : 0;

  // Count segments where width deviates >20% from average
  const inconsistentSegmentCount = beadWidths.filter(w =>
    Math.abs(w - avgBeadWidth) > avgBeadWidth * 0.2
  ).length;

  const consistencyScore = Math.max(0, 100 - coefficientOfVariation * 100);

  const recommendations: string[] = [];
  recommendations.push(`Avg bead width: ${avgBeadWidth.toFixed(4)}mm, CV: ${(coefficientOfVariation * 100).toFixed(1)}%`);
  if (coefficientOfVariation > 0.2) {
    recommendations.push('High bead width variance — check extrusion consistency');
  }
  if (inconsistentSegmentCount > beadWidths.length * 0.2) {
    recommendations.push(`${inconsistentSegmentCount} inconsistent segments — calibrate flow rate`);
  }
  if (maxWidth > avgBeadWidth * 1.5) {
    recommendations.push(`Max width ${maxWidth.toFixed(4)}mm is 1.5x average — over-extrusion detected`);
  }
  if (consistencyScore > 85) {
    recommendations.push('Consistent bead width — good extrusion quality');
  }

  return {
    avgBeadWidth, stdDev, minWidth, maxWidth,
    coefficientOfVariation, inconsistentSegmentCount,
    consistencyScore, recommendations,
  };
}

// ── 3. G-code Parameter Range Validator ──

export interface ParameterViolation {
  /** Line number */
  line: number;
  /** Parameter name */
  parameter: string;
  /** Value */
  value: number;
  /** Min allowed */
  min: number;
  /** Max allowed */
  max: number;
  /** Severity */
  severity: 'warning' | 'error';
}

export interface ParameterRangeResult {
  /** All violations */
  violations: ParameterViolation[];
  /** Violation count */
  count: number;
  /** Error count */
  errorCount: number;
  /** Warning count */
  warningCount: number;
  /** Parameters checked */
  parametersChecked: number;
  /** Validation score (0-100) */
  validationScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Validate G-code parameter ranges.
 * Checks that feed rates, spindle speeds, and coordinates are within safe ranges.
 *
 * @param lines G-code lines
 * @param limits Optional custom limits
 */
export function validateParameterRanges(
  lines: string[],
  limits?: {
    minFeed?: number; maxFeed?: number;
    minSpindle?: number; maxSpindle?: number;
    minX?: number; maxX?: number;
    minY?: number; maxY?: number;
    minZ?: number; maxZ?: number;
  },
): ParameterRangeResult {
  const minFeed = limits?.minFeed ?? 0;
  const maxFeed = limits?.maxFeed ?? 50000;
  const minSpindle = limits?.minSpindle ?? 0;
  const maxSpindle = limits?.maxSpindle ?? 30000;
  const minX = limits?.minX ?? -1000;
  const maxX = limits?.maxX ?? 1000;
  const minY = limits?.minY ?? -1000;
  const maxY = limits?.maxY ?? 1000;
  const minZ = limits?.minZ ?? -1000;
  const maxZ = limits?.maxZ ?? 1000;

  const violations: ParameterViolation[] = [];
  let parametersChecked = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Check feed rate
    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) {
      parametersChecked++;
      const feed = parseFloat(fMatch[1]);
      if (feed < minFeed || feed > maxFeed) {
        violations.push({
          line: i, parameter: 'F', value: feed,
          min: minFeed, max: maxFeed,
          severity: feed > maxFeed ? 'error' : 'warning',
        });
      }
    }

    // Check spindle speed
    const sMatch = code.match(/\bS(\d*\.?\d+)/i);
    if (sMatch && /\bM[034]\b/i.test(code)) {
      parametersChecked++;
      const spindle = parseFloat(sMatch[1]);
      if (spindle < minSpindle || spindle > maxSpindle) {
        violations.push({
          line: i, parameter: 'S', value: spindle,
          min: minSpindle, max: maxSpindle,
          severity: spindle > maxSpindle ? 'error' : 'warning',
        });
      }
    }

    // Check coordinates
    for (const [axis, min, max] of [
      ['X', minX, maxX], ['Y', minY, maxY], ['Z', minZ, maxZ],
    ] as const) {
      const match = code.match(new RegExp(`\\b${axis}(-?\\d*\\.?\\d+)`, 'i'));
      if (match) {
        parametersChecked++;
        const val = parseFloat(match[1]);
        if (val < min || val > max) {
          violations.push({
            line: i, parameter: axis, value: val,
            min, max, severity: 'warning',
          });
        }
      }
    }
  }

  const count = violations.length;
  const errorCount = violations.filter(v => v.severity === 'error').length;
  const warningCount = violations.filter(v => v.severity === 'warning').length;
  const validationScore = Math.max(0, 100 - errorCount * 25 - warningCount * 5);

  const recommendations: string[] = [];
  if (count > 0) {
    recommendations.push(`${count} parameter violations (${errorCount} errors, ${warningCount} warnings)`);
  }
  for (const v of violations.slice(0, 5)) {
    recommendations.push(`Line ${v.line}: ${v.parameter}=${v.value} outside range [${v.min}, ${v.max}]`);
  }
  if (count === 0) {
    recommendations.push(`All ${parametersChecked} parameters within valid ranges`);
  }
  if (validationScore > 90) {
    recommendations.push('Excellent parameter validation — all values safe');
  }

  return {
    violations, count, errorCount, warningCount,
    parametersChecked, validationScore, recommendations,
  };
}

// ── 4. CNC Tool Path Engagement Heatmap Per Layer ──

export interface LayerEngagement {
  /** Layer number */
  layer: number;
  /** Z height */
  zHeight: number;
  /** Average engagement angle in degrees */
  avgEngagement: number;
  /** Max engagement angle in degrees */
  maxEngagement: number;
  /** Engagement distribution */
  distribution: { [category: string]: number };
  /** Engagement score (0-100) */
  engagementScore: number;
}

export interface EngagementHeatmapPerLayerResult {
  /** Per-layer engagement data */
  layers: LayerEngagement[];
  /** Layer count */
  layerCount: number;
  /** Overall avg engagement */
  overallAvgEngagement: number;
  /** Layer with highest engagement */
  highestEngagementLayer: number;
  /** Engagement consistency score (0-100) */
  consistencyScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Generate engagement heatmap per Z-layer.
 * Shows how engagement varies across different depths.
 *
 * @param lines G-code lines
 * @param toolDiameter Tool diameter in mm (default 6)
 */
export function generateEngagementHeatmapPerLayer(
  lines: string[],
  toolDiameter: number = 6,
): EngagementHeatmapPerLayerResult {
  const layers: LayerEngagement[] = [];
  let prevX = 0, prevY = 0, prevZ = 0;
  let currentZ = 0;
  let layerNum = 0;
  const layerAngles: number[] = [];

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

    // Detect layer change
    if (z < currentZ - 0.1 && layerAngles.length > 0) {
      const avgEngagement = layerAngles.reduce((a, b) => a + b, 0) / layerAngles.length;
      const maxEngagement = Math.max(...layerAngles);
      const distribution: { [category: string]: number } = {};
      for (const a of layerAngles) {
        const cat = a < 30 ? 'light' : a < 90 ? 'moderate' : a < 170 ? 'heavy' : 'full';
        distribution[cat] = (distribution[cat] ?? 0) + 1;
      }
      const engagementScore = Math.max(0, 100 - avgEngagement / 2);
      layers.push({
        layer: layerNum, zHeight: currentZ,
        avgEngagement, maxEngagement, distribution, engagementScore,
      });
      layerNum++;
      layerAngles.length = 0;
    }

    // Calculate engagement angle
    if (z < 0) {
      const stepover = Math.abs(y - prevY);
      let angle = 0;
      if (stepover > 0 && stepover <= toolDiameter) {
        const ratio = stepover / toolDiameter;
        angle = ratio >= 1 ? 180 : Math.acos(1 - ratio) * 2 * 180 / Math.PI;
      } else if (stepover === 0) {
        angle = 180;
      }
      layerAngles.push(angle);
    }

    currentZ = z;
    prevX = x; prevY = y; prevZ = z;
  }

  // Save last layer
  if (layerAngles.length > 0) {
    const avgEngagement = layerAngles.reduce((a, b) => a + b, 0) / layerAngles.length;
    const maxEngagement = Math.max(...layerAngles);
    const distribution: { [category: string]: number } = {};
    for (const a of layerAngles) {
      const cat = a < 30 ? 'light' : a < 90 ? 'moderate' : a < 170 ? 'heavy' : 'full';
      distribution[cat] = (distribution[cat] ?? 0) + 1;
    }
    const engagementScore = Math.max(0, 100 - avgEngagement / 2);
    layers.push({
      layer: layerNum, zHeight: currentZ,
      avgEngagement, maxEngagement, distribution, engagementScore,
    });
  }

  if (layers.length === 0) {
    return {
      layers: [], layerCount: 0, overallAvgEngagement: 0,
      highestEngagementLayer: 0, consistencyScore: 100,
      recommendations: ['No engagement data for heatmap per layer'],
    };
  }

  const overallAvgEngagement = layers.reduce((s, l) => s + l.avgEngagement, 0) / layers.length;
  const highestEngagementLayer = layers.reduce((max, l) =>
    l.maxEngagement > max.maxEngagement ? l : max, layers[0]).layer;

  const engagements = layers.map(l => l.avgEngagement);
  const stdDev = Math.sqrt(engagements.reduce((s, e) => s + (e - overallAvgEngagement) ** 2, 0) / engagements.length);
  const consistencyScore = overallAvgEngagement > 0
    ? Math.max(0, 100 - (stdDev / overallAvgEngagement) * 100) : 100;

  const recommendations: string[] = [];
  recommendations.push(`${layers.length} layers, avg engagement ${overallAvgEngagement.toFixed(0)}deg`);
  recommendations.push(`Highest engagement: layer ${highestEngagementLayer}`);
  if (consistencyScore < 70) {
    recommendations.push(`Inconsistent engagement across layers — optimize per-layer parameters`);
  }
  if (overallAvgEngagement > 120) {
    recommendations.push('High average engagement — reduce stepover or depth');
  }
  if (consistencyScore > 80) {
    recommendations.push('Consistent engagement across layers — uniform cutting');
  }

  return {
    layers, layerCount: layers.length, overallAvgEngagement,
    highestEngagementLayer, consistencyScore, recommendations,
  };
}

// ── 5. Print Cooling Fan Duty Cycle Analyzer ──

export interface FanDutyCyclePoint {
  /** Time in seconds */
  time: number;
  /** Fan speed (0-255) */
  fanSpeed: number;
  /** Duty cycle percentage (0-100) */
  dutyCycle: number;
}

export interface FanDutyCycleResult {
  /** Fan duty cycle data points */
  points: FanDutyCyclePoint[];
  /** Average duty cycle percentage */
  avgDutyCycle: number;
  /** Max duty cycle percentage */
  maxDutyCycle: number;
  /** Fan on/off cycle count */
  cycleCount: number;
  /** Total fan on time in seconds */
  fanOnTime: number;
  /** Total time in seconds */
  totalTime: number;
  /** Fan consistency score (0-100) */
  consistencyScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze cooling fan duty cycle patterns.
 * Inconsistent fan duty can cause uneven cooling and warping.
 *
 * @param lines G-code lines
 */
export function analyzeFanDutyCycle(lines: string[]): FanDutyCycleResult {
  const points: FanDutyCyclePoint[] = [];
  let fanSpeed = 0;
  let currentTime = 0;
  let prevX = 0, prevY = 0;
  let feedRate = 0;
  let cycleCount = 0;
  let wasFanOn = false;
  let fanOnTime = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Track fan commands
    if (/\bM106\b/i.test(code)) {
      const sMatch = code.match(/\bS(\d*\.?\d+)/i);
      const newSpeed = sMatch ? parseFloat(sMatch[1]) : 255;
      if (wasFanOn && newSpeed === 0) {
        cycleCount++;
        wasFanOn = false;
      } else if (!wasFanOn && newSpeed > 0) {
        wasFanOn = true;
      }
      fanSpeed = newSpeed;
    }
    if (/\bM107\b/i.test(code)) {
      if (wasFanOn) cycleCount++;
      wasFanOn = false;
      fanSpeed = 0;
    }

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) feedRate = parseFloat(fMatch[1]);

    if (/\bG1\b/i.test(code)) {
      const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
      const x = xMatch ? parseFloat(xMatch[1]) : prevX;
      const y = yMatch ? parseFloat(yMatch[1]) : prevY;
      const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
      if (dist > 0 && feedRate > 0) {
        const time = dist / (feedRate / 60);
        currentTime += time;
        if (fanSpeed > 0) fanOnTime += time;
        const dutyCycle = (fanSpeed / 255) * 100;
        points.push({ time: currentTime, fanSpeed, dutyCycle });
      }
      prevX = x; prevY = y;
    }
  }

  if (points.length === 0) {
    return {
      points: [], avgDutyCycle: 0, maxDutyCycle: 0,
      cycleCount: 0, fanOnTime: 0, totalTime: 0, consistencyScore: 100,
      recommendations: ['No fan duty cycle data detected'],
    };
  }

  const dutyCycles = points.map(p => p.dutyCycle);
  const avgDutyCycle = dutyCycles.reduce((a, b) => a + b, 0) / dutyCycles.length;
  const maxDutyCycle = Math.max(...dutyCycles);
  const totalTime = points[points.length - 1].time;

  const stdDev = Math.sqrt(dutyCycles.reduce((s, d) => s + (d - avgDutyCycle) ** 2, 0) / dutyCycles.length);
  const consistencyScore = Math.max(0, 100 - stdDev);

  const recommendations: string[] = [];
  recommendations.push(`Avg fan duty: ${avgDutyCycle.toFixed(0)}%, max: ${maxDutyCycle.toFixed(0)}%`);
  recommendations.push(`${cycleCount} on/off cycles, fan on for ${fanOnTime.toFixed(0)}s of ${totalTime.toFixed(0)}s`);
  if (cycleCount > 10) {
    recommendations.push(`${cycleCount} fan cycles — frequent on/off may cause uneven cooling`);
  }
  if (avgDutyCycle > 80) {
    recommendations.push('High fan duty — may cause poor layer adhesion');
  }
  if (avgDutyCycle < 10 && totalTime > 60) {
    recommendations.push('Low fan duty — may cause overheating and stringing');
  }
  if (consistencyScore > 80) {
    recommendations.push('Consistent fan duty — uniform cooling');
  }

  return {
    points, avgDutyCycle, maxDutyCycle, cycleCount,
    fanOnTime, totalTime, consistencyScore, recommendations,
  };
}

// ── 6. G-code Tool Change Position Optimizer ──

export interface ToolChangePosition {
  /** Line number */
  line: number;
  /** Tool number */
  tool: number;
  /** Position */
  position: { x: number; y: number; z: number };
  /** Distance from previous operation in mm */
  distanceFromPrevOp: number;
}

export interface ToolChangePositionResult {
  /** Tool change positions */
  positions: ToolChangePosition[];
  /** Tool change count */
  count: number;
  /** Total travel for tool changes in mm */
  totalTravel: number;
  /** Average travel per tool change in mm */
  avgTravel: number;
  /** Recommended position */
  recommendedPosition: { x: number; y: number; z: number };
  /** Optimization potential in mm */
  optimizationPotential: number;
  /** Optimization score (0-100) */
  optimizationScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Optimize tool change positions.
 * Reduces travel distance to and from tool change locations.
 *
 * @param lines G-code lines
 */
export function optimizeToolChangePositions(
  lines: string[],
): ToolChangePositionResult {
  const positions: ToolChangePosition[] = [];
  let prevX = 0, prevY = 0, prevZ = 0;
  let lastOpX = 0, lastOpY = 0, lastOpZ = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Detect tool change
    if (/\bM6\b/i.test(code) || /\bT\d+\b/i.test(code)) {
      const tMatch = code.match(/\bT(\d+)/i);
      const tool = tMatch ? parseInt(tMatch[1]) : 0;
      const distFromPrev = Math.sqrt(
        (prevX - lastOpX) ** 2 + (prevY - lastOpY) ** 2 + (prevZ - lastOpZ) ** 2
      );
      positions.push({
        line: i, tool,
        position: { x: prevX, y: prevY, z: prevZ },
        distanceFromPrevOp: distFromPrev,
      });
    }

    if (/\bG[01]\b/i.test(code)) {
      const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
      const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
      prevX = xMatch ? parseFloat(xMatch[1]) : prevX;
      prevY = yMatch ? parseFloat(yMatch[1]) : prevY;
      prevZ = zMatch ? parseFloat(zMatch[1]) : prevZ;
      lastOpX = prevX; lastOpY = prevY; lastOpZ = prevZ;
    }
  }

  if (positions.length === 0) {
    return {
      positions: [], count: 0, totalTravel: 0, avgTravel: 0,
      recommendedPosition: { x: 0, y: 0, z: 50 },
      optimizationPotential: 0, optimizationScore: 100,
      recommendations: ['No tool changes detected'],
    };
  }

  const totalTravel = positions.reduce((s, p) => s + p.distanceFromPrevOp, 0);
  const avgTravel = totalTravel / positions.length;

  // Recommended: centroid of all tool change positions
  const cx = positions.reduce((s, p) => s + p.position.x, 0) / positions.length;
  const cy = positions.reduce((s, p) => s + p.position.y, 0) / positions.length;
  const recommendedPosition = { x: cx, y: cy, z: 50 };

  // Optimization potential: if all changes happened at recommended position
  const optimizedTravel = positions.reduce((s, p) =>
    s + Math.sqrt((p.position.x - cx) ** 2 + (p.position.y - cy) ** 2), 0);
  const optimizationPotential = Math.max(0, totalTravel - optimizedTravel);
  const optimizationScore = totalTravel > 0
    ? Math.max(0, 100 - (optimizationPotential / totalTravel) * 100) : 100;

  const recommendations: string[] = [];
  recommendations.push(`${positions.length} tool changes, ${totalTravel.toFixed(0)}mm total travel`);
  recommendations.push(`Avg travel per change: ${avgTravel.toFixed(0)}mm`);
  if (optimizationPotential > 100) {
    recommendations.push(`Can save ${optimizationPotential.toFixed(0)}mm by consolidating tool change position`);
  }
  recommendations.push(`Recommended tool change position: X${cx.toFixed(1)} Y${cy.toFixed(1)} Z50`);
  if (optimizationScore > 85) {
    recommendations.push('Well-optimized tool changes — minimal travel');
  }

  return {
    positions, count: positions.length, totalTravel, avgTravel,
    recommendedPosition, optimizationPotential, optimizationScore,
    recommendations,
  };
}

// ── 7. CNC Spindle Speed Optimization Advisor ──

export interface SpindleSpeedAdvice {
  /** Current spindle speed */
  currentSpeed: number;
  /** Recommended spindle speed */
  recommendedSpeed: number;
  /** Material */
  material: string;
  /** Operation type */
  operationType: string;
  /** Surface speed in m/min */
  surfaceSpeed: number;
  /** Is speed optimal */
  isOptimal: boolean;
  /** Optimization score (0-100) */
  optimizationScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Advise on spindle speed optimization.
 * Recommends spindle speed based on material and tool diameter.
 *
 * @param lines G-code lines
 * @param toolDiameter Tool diameter in mm (default 6)
 * @param material Material type (default 'aluminum')
 */
export function adviseSpindleSpeed(
  lines: string[],
  toolDiameter: number = 6,
  material: string = 'aluminum',
): SpindleSpeedAdvice {
  // Surface speed recommendations (m/min) by material
  const surfaceSpeeds: { [material: string]: { min: number; max: number } } = {
    aluminum: { min: 200, max: 400 },
    steel: { min: 80, max: 150 },
    stainless: { min: 50, max: 120 },
    brass: { min: 150, max: 300 },
    copper: { min: 150, max: 300 },
    wood: { min: 300, max: 600 },
    plastic: { min: 200, max: 500 },
  };

  const ssRange = surfaceSpeeds[material] ?? surfaceSpeeds.aluminum;
  const targetSurfaceSpeed = (ssRange.min + ssRange.max) / 2;

  // Find current spindle speed
  let currentSpeed = 0;
  let feedRate = 0;
  let operationType = 'unknown';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const sMatch = code.match(/\bS(\d*\.?\d+)/i);
    if (sMatch && /\bM[034]\b/i.test(code)) {
      currentSpeed = parseFloat(sMatch[1]);
    }

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) feedRate = parseFloat(fMatch[1]);

    // Detect operation type from comments
    if (/;.*rough/i.test(line)) operationType = 'roughing';
    else if (/;.*finish/i.test(line)) operationType = 'finishing';
    else if (/;.*drill/i.test(line)) operationType = 'drilling';
  }

  if (operationType === 'unknown') {
    operationType = feedRate > 500 ? 'roughing' : 'finishing';
  }

  // Recommended RPM = (surfaceSpeed * 1000) / (pi * toolDiameter)
  const recommendedSpeed = Math.round((targetSurfaceSpeed * 1000) / (Math.PI * toolDiameter));

  // Actual surface speed at current RPM
  const surfaceSpeed = currentSpeed > 0
    ? (currentSpeed * Math.PI * toolDiameter) / 1000 : 0;

  const speedDelta = Math.abs(currentSpeed - recommendedSpeed);
  const isOptimal = speedDelta < recommendedSpeed * 0.1;
  const optimizationScore = Math.max(0, 100 - (speedDelta / recommendedSpeed) * 100);

  const recommendations: string[] = [];
  recommendations.push(`Current: ${currentSpeed} RPM, recommended: ${recommendedSpeed} RPM for ${material}`);
  recommendations.push(`Surface speed: ${surfaceSpeed.toFixed(0)} m/min (target: ${targetSurfaceSpeed.toFixed(0)})`);
  if (currentSpeed > recommendedSpeed * 1.2) {
    recommendations.push(`Spindle too fast — reduce to ${recommendedSpeed} RPM to prevent tool wear`);
  }
  if (currentSpeed < recommendedSpeed * 0.8 && currentSpeed > 0) {
    recommendations.push(`Spindle too slow — increase to ${recommendedSpeed} RPM for better MRR`);
  }
  if (isOptimal) {
    recommendations.push('Optimal spindle speed — good cutting conditions');
  }
  if (operationType === 'finishing') {
    recommendations.push('Finishing operation — consider higher RPM for better surface finish');
  }

  return {
    currentSpeed, recommendedSpeed, material,
    operationType, surfaceSpeed, isOptimal,
    optimizationScore, recommendations,
  };
}

// ── 8. Print First Layer Height Optimizer ──

export interface FirstLayerHeightResult {
  /** Current first layer height in mm */
  currentHeight: number;
  /** Recommended first layer height in mm */
  recommendedHeight: number;
  /** Nozzle diameter in mm */
  nozzleDiameter: number;
  /** Squish ratio (current height / nozzle diameter) */
  squishRatio: number;
  /** Is height optimal */
  isOptimal: boolean;
  /** Adhesion score (0-100) */
  adhesionScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Optimize first layer height for better adhesion.
 * First layer height is critical for print success.
 *
 * @param lines G-code lines
 * @param nozzleDiameter Nozzle diameter in mm (default 0.4)
 */
export function optimizeFirstLayerHeight(
  lines: string[],
  nozzleDiameter: number = 0.4,
): FirstLayerHeightResult {
  let firstZ = 0;
  let secondZ = 0;
  let foundFirst = false;
  let foundSecond = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    if (zMatch) {
      const z = parseFloat(zMatch[1]);
      if (!foundFirst) {
        firstZ = z;
        foundFirst = true;
      } else if (!foundSecond && z > firstZ + 0.01) {
        secondZ = z;
        foundSecond = true;
        break;
      }
    }
  }

  const currentHeight = foundSecond ? secondZ - firstZ : firstZ;
  // Recommended: 75% of nozzle diameter for good squish
  const recommendedHeight = nozzleDiameter * 0.75;
  const squishRatio = currentHeight > 0 ? nozzleDiameter / currentHeight : 0;

  const heightDelta = Math.abs(currentHeight - recommendedHeight);
  const isOptimal = heightDelta < 0.05;
  const adhesionScore = Math.max(0, 100 - heightDelta * 200);

  const recommendations: string[] = [];
  recommendations.push(`Current first layer height: ${currentHeight.toFixed(3)}mm, recommended: ${recommendedHeight.toFixed(3)}mm`);
  recommendations.push(`Squish ratio: ${squishRatio.toFixed(2)} (ideal: ~1.33)`);
  if (currentHeight > nozzleDiameter) {
    recommendations.push(`First layer too tall (${currentHeight.toFixed(3)}mm > nozzle ${nozzleDiameter}mm) — poor adhesion`);
  }
  if (currentHeight < nozzleDiameter * 0.5) {
    recommendations.push(`First layer too short — risk of nozzle scraping bed`);
  }
  if (isOptimal) {
    recommendations.push('Optimal first layer height — good adhesion expected');
  }
  if (adhesionScore > 85) {
    recommendations.push('Excellent first layer height for adhesion');
  }

  return {
    currentHeight, recommendedHeight, nozzleDiameter,
    squishRatio, isOptimal, adhesionScore, recommendations,
  };
}

// ── 9. G-code Toolpath Continuity Checker Per Layer ──

export interface LayerContinuity {
  /** Layer number */
  layer: number;
  /** Z height */
  zHeight: number;
  /** Is continuous */
  isContinuous: boolean;
  /** Gap count */
  gapCount: number;
  /** Max gap in mm */
  maxGap: number;
  /** Total gap distance in mm */
  totalGapDistance: number;
}

export interface ContinuityPerLayerResult {
  /** Per-layer continuity data */
  layers: LayerContinuity[];
  /** Layer count */
  layerCount: number;
  /** Continuous layer count */
  continuousLayerCount: number;
  /** Total gaps across all layers */
  totalGaps: number;
  /** Max gap across all layers in mm */
  maxGap: number;
  /** Overall continuity score (0-100) */
  continuityScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Check toolpath continuity per layer.
 * Detects gaps or jumps within each layer that may indicate issues.
 *
 * @param lines G-code lines
 * @param gapThreshold Gap threshold in mm (default 5)
 */
export function checkContinuityPerLayer(
  lines: string[],
  gapThreshold: number = 5,
): ContinuityPerLayerResult {
  const layers: LayerContinuity[] = [];
  let prevX = 0, prevY = 0, prevZ = 0;
  let firstZ = 0;
  let currentZ = 0;
  let layerNum = 0;
  let gapCount = 0;
  let maxGap = 0;
  let totalGapDistance = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG[01]\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const z = zMatch ? parseFloat(zMatch[1]) : prevZ;

    if (firstZ === 0) firstZ = z;

    // Detect layer change
    if (z > currentZ + 0.01 && layerNum > 0) {
      layers.push({
        layer: layerNum, zHeight: currentZ,
        isContinuous: gapCount === 0,
        gapCount, maxGap, totalGapDistance,
      });
      layerNum++;
      currentZ = z;
      gapCount = 0; maxGap = 0; totalGapDistance = 0;
    } else if (layerNum === 0) {
      currentZ = z;
      layerNum = 1;
    }

    // Check for gaps (large jumps within same layer)
    if (layerNum > 0) {
      const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
      if (dist > gapThreshold && /\bG1\b/i.test(code)) {
        gapCount++;
        maxGap = Math.max(maxGap, dist);
        totalGapDistance += dist;
      }
    }

    prevX = x; prevY = y; prevZ = z;
  }

  // Save last layer
  if (layerNum > 0) {
    layers.push({
      layer: layerNum, zHeight: currentZ,
      isContinuous: gapCount === 0,
      gapCount, maxGap, totalGapDistance,
    });
  }

  if (layers.length === 0) {
    return {
      layers: [], layerCount: 0, continuousLayerCount: 0,
      totalGaps: 0, maxGap: 0, continuityScore: 100,
      recommendations: ['No layers for continuity analysis'],
    };
  }

  const continuousLayerCount = layers.filter(l => l.isContinuous).length;
  const totalGaps = layers.reduce((s, l) => s + l.gapCount, 0);
  const maxGapOverall = Math.max(...layers.map(l => l.maxGap));
  const continuityScore = Math.round((continuousLayerCount / layers.length) * 100);

  const recommendations: string[] = [];
  recommendations.push(`${layers.length} layers, ${continuousLayerCount} continuous, ${totalGaps} total gaps`);
  if (totalGaps > 0) {
    recommendations.push(`${totalGaps} gaps detected — check for missing toolpath segments`);
  }
  if (maxGapOverall > 50) {
    recommendations.push(`Max gap: ${maxGapOverall.toFixed(0)}mm — large jump in toolpath`);
  }
  const discontinuousLayers = layers.filter(l => !l.isContinuous);
  for (const l of discontinuousLayers.slice(0, 3)) {
    recommendations.push(`Layer ${l.layer}: ${l.gapCount} gaps, max ${l.maxGap.toFixed(1)}mm`);
  }
  if (continuityScore > 90) {
    recommendations.push('Excellent continuity — no significant gaps');
  }

  return {
    layers, layerCount: layers.length, continuousLayerCount,
    totalGaps, maxGap: maxGapOverall, continuityScore,
    recommendations,
  };
}

// ── 10. CNC Tool Path Minimum Clearance Calculator ──

export interface ClearanceResult {
  /** Minimum clearance to stock boundary in mm */
  minClearance: number;
  /** Average clearance in mm */
  avgClearance: number;
  /** Clearance violations count */
  violationCount: number;
  /** Minimum clearance position */
  minClearancePosition: { x: number; y: number } | null;
  /** Stock boundary */
  stockBoundary: { minX: number; maxX: number; minY: number; maxY: number };
  /** Safety score (0-100) */
  safetyScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Calculate minimum clearance between toolpath and stock boundary.
 * Ensures the toolpath stays within safe bounds.
 *
 * @param lines G-code lines
 * @param stockMargin Stock boundary margin in mm (default 10)
 */
export function calculateMinimumClearance(
  lines: string[],
  stockMargin: number = 10,
): ClearanceResult {
  const positions: { x: number; y: number }[] = [];
  let prevX = 0, prevY = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG[01]\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;

    positions.push({ x, y });
    prevX = x; prevY = y;
  }

  if (positions.length === 0) {
    return {
      minClearance: 0, avgClearance: 0, violationCount: 0,
      minClearancePosition: null,
      stockBoundary: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
      safetyScore: 100,
      recommendations: ['No positions for clearance analysis'],
    };
  }

  // Calculate stock boundary from toolpath bounds + margin
  const xs = positions.map(p => p.x);
  const ys = positions.map(p => p.y);
  const toolpathBounds = {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minY: Math.min(...ys), maxY: Math.max(...ys),
  };
  const stockBoundary = {
    minX: toolpathBounds.minX - stockMargin,
    maxX: toolpathBounds.maxX + stockMargin,
    minY: toolpathBounds.minY - stockMargin,
    maxY: toolpathBounds.maxY + stockMargin,
  };

  // Calculate clearance for each position
  const clearances: number[] = [];
  let minClearance = Infinity;
  let minClearancePosition: { x: number; y: number } | null = null;
  let violationCount = 0;

  for (const p of positions) {
    const clearanceLeft = p.x - stockBoundary.minX;
    const clearanceRight = stockBoundary.maxX - p.x;
    const clearanceBottom = p.y - stockBoundary.minY;
    const clearanceTop = stockBoundary.maxY - p.y;
    const clearance = Math.min(clearanceLeft, clearanceRight, clearanceBottom, clearanceTop);
    clearances.push(clearance);

    if (clearance < minClearance) {
      minClearance = clearance;
      minClearancePosition = p;
    }
    if (clearance < 0) violationCount++;
  }

  const avgClearance = clearances.reduce((a, b) => a + b, 0) / clearances.length;
  const safetyScore = Math.max(0, 100 - violationCount * 20 - Math.max(0, stockMargin - minClearance) * 5);

  const recommendations: string[] = [];
  recommendations.push(`Min clearance: ${minClearance.toFixed(2)}mm, avg: ${avgClearance.toFixed(2)}mm`);
  if (violationCount > 0) {
    recommendations.push(`${violationCount} positions outside stock boundary — check setup`);
  }
  if (minClearance < 2) {
    recommendations.push(`Very low clearance (${minClearance.toFixed(1)}mm) — risk of collision`);
  }
  if (minClearancePosition) {
    recommendations.push(`Min clearance at X${minClearancePosition.x.toFixed(1)} Y${minClearancePosition.y.toFixed(1)}`);
  }
  if (safetyScore > 85) {
    recommendations.push('Safe clearance — toolpath well within bounds');
  }

  return {
    minClearance, avgClearance, violationCount,
    minClearancePosition, stockBoundary, safetyScore,
    recommendations,
  };
}

// ── 11. Print Wall Thickness Consistency Analyzer ──

export interface WallThicknessResult {
  /** Average wall thickness in mm */
  avgWallThickness: number;
  /** Min wall thickness in mm */
  minWallThickness: number;
  /** Max wall thickness in mm */
  maxWallThickness: number;
  /** Wall thickness variance */
  variance: number;
  /** Inconsistent wall count */
  inconsistentWallCount: number;
  /** Consistency score (0-100) */
  consistencyScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze wall thickness consistency.
 * Inconsistent wall thickness affects part strength and appearance.
 *
 * @param lines G-code lines
 * @param nominalThickness Nominal wall thickness in mm (default 0.8)
 */
export function analyzeWallThicknessConsistency(
  lines: string[],
  nominalThickness: number = 0.8,
): WallThicknessResult {
  const wallThicknesses: number[] = [];
  let prevX = 0, prevY = 0, prevE = 0;
  let feedRate = 0;
  let isWall = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Detect wall sections from comments
    if (/;.*wall/i.test(trimmed) || /;.*perimeter/i.test(trimmed) || /;.*outer/i.test(trimmed)) {
      isWall = true;
    } else if (/;.*infill/i.test(trimmed) || /;.*solid/i.test(trimmed)) {
      isWall = false;
    }

    if (trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG1\b/i.test(code)) continue;

    if (!isWall) {
      const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
      const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);
      prevX = xMatch ? parseFloat(xMatch[1]) : prevX;
      prevY = yMatch ? parseFloat(yMatch[1]) : prevY;
      prevE = eMatch ? parseFloat(eMatch[1]) : prevE;
      continue;
    }

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) feedRate = parseFloat(fMatch[1]);

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const e = eMatch ? parseFloat(eMatch[1]) : prevE;

    if (e > prevE) {
      const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
      if (dist > 0) {
        // Estimate wall thickness from extrusion
        const eDelta = e - prevE;
        const thickness = (eDelta / dist) * 0.4 * 2; // simplified
        wallThicknesses.push(thickness);
      }
    }

    prevX = x; prevY = y; prevE = e;
  }

  if (wallThicknesses.length < 10) {
    return {
      avgWallThickness: 0, minWallThickness: 0, maxWallThickness: 0,
      variance: 0, inconsistentWallCount: 0, consistencyScore: 100,
      recommendations: ['Insufficient wall data for thickness analysis'],
    };
  }

  const avgWallThickness = wallThicknesses.reduce((a, b) => a + b, 0) / wallThicknesses.length;
  const minWallThickness = Math.min(...wallThicknesses);
  const maxWallThickness = Math.max(...wallThicknesses);
  const variance = wallThicknesses.reduce((s, w) => s + (w - avgWallThickness) ** 2, 0) / wallThicknesses.length;
  const inconsistentWallCount = wallThicknesses.filter(w =>
    Math.abs(w - nominalThickness) > nominalThickness * 0.15
  ).length;
  const consistencyScore = Math.max(0, 100 - Math.sqrt(variance) / nominalThickness * 100);

  const recommendations: string[] = [];
  recommendations.push(`Avg wall thickness: ${avgWallThickness.toFixed(3)}mm (nominal: ${nominalThickness}mm)`);
  if (Math.abs(avgWallThickness - nominalThickness) > nominalThickness * 0.1) {
    recommendations.push(`Wall thickness deviates from nominal — calibrate extrusion`);
  }
  if (inconsistentWallCount > wallThicknesses.length * 0.2) {
    recommendations.push(`${inconsistentWallCount} inconsistent walls — check flow rate`);
  }
  if (maxWallThickness > nominalThickness * 1.3) {
    recommendations.push(`Max wall thickness ${maxWallThickness.toFixed(3)}mm — over-extrusion`);
  }
  if (consistencyScore > 85) {
    recommendations.push('Consistent wall thickness — good structural integrity');
  }

  return {
    avgWallThickness, minWallThickness, maxWallThickness,
    variance, inconsistentWallCount, consistencyScore,
    recommendations,
  };
}

// ── 12. G-code Execution Order Optimizer ──

export interface ExecutionOrderResult {
  /** Current operation count */
  operationCount: number;
  /** Estimated time savings in seconds */
  estimatedTimeSavings: number;
  /** Reorder opportunities */
  reorderOpportunities: { type: string; count: number; savingsSeconds: number }[];
  /** Current execution score (0-100) */
  currentScore: number;
  /** Optimized execution score (0-100) */
  optimizedScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Optimize execution order of G-code operations.
 * Identifies opportunities to reorder operations for efficiency.
 *
 * @param lines G-code lines
 */
export function optimizeExecutionOrder(lines: string[]): ExecutionOrderResult {
  const operations: { type: string; line: number; z: number; tool: number }[] = [];
  let currentTool = 0;
  let currentZ = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const tMatch = code.match(/\bT(\d+)/i);
    if (tMatch) currentTool = parseInt(tMatch[1]);

    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    if (zMatch) currentZ = parseFloat(zMatch[1]);

    // Detect operation type
    let opType = '';
    if (/\bG81\b/i.test(code)) opType = 'drilling';
    else if (/\bG82\b/i.test(code)) opType = 'drilling_dwell';
    else if (/\bG83\b/i.test(code)) opType = 'peck_drilling';
    else if (/\bG84\b/i.test(code)) opType = 'tapping';
    else if (/\bG85\b/i.test(code)) opType = 'boring';
    else if (/\bG86\b/i.test(code)) opType = 'boring_stop';
    else if (/\bG88\b/i.test(code)) opType = 'manual_boring';
    else if (/\bG89\b/i.test(code)) opType = 'boring_dwell';
    else if (/;.*rough/i.test(line)) opType = 'roughing';
    else if (/;.*finish/i.test(line)) opType = 'finishing';
    else if (/;.*profile/i.test(line)) opType = 'profiling';

    if (opType) {
      operations.push({ type: opType, line: i, z: currentZ, tool: currentTool });
    }
  }

  if (operations.length === 0) {
    return {
      operationCount: 0, estimatedTimeSavings: 0,
      reorderOpportunities: [], currentScore: 100, optimizedScore: 100,
      recommendations: ['No operations detected for order optimization'],
    };
  }

  // Analyze reorder opportunities
  const reorderOpportunities: { type: string; count: number; savingsSeconds: number }[] = [];

  // 1. Tool changes: group by tool
  const toolGroups = new Map<number, number>();
  for (const op of operations) {
    toolGroups.set(op.tool, (toolGroups.get(op.tool) ?? 0) + 1);
  }
  const toolChangeCount = toolGroups.size - 1;
  if (toolChangeCount > 0) {
    reorderOpportunities.push({
      type: 'group_by_tool',
      count: toolChangeCount,
      savingsSeconds: toolChangeCount * 10,
    });
  }

  // 2. Z-level: group by depth
  const zGroups = new Map<number, number>();
  for (const op of operations) {
    const zKey = Math.round(op.z);
    zGroups.set(zKey, (zGroups.get(zKey) ?? 0) + 1);
  }
  const zChangeCount = zGroups.size - 1;
  if (zChangeCount > 3) {
    reorderOpportunities.push({
      type: 'group_by_depth',
      count: zChangeCount,
      savingsSeconds: zChangeCount * 5,
    });
  }

  // 3. Operation type: group similar operations
  const typeGroups = new Map<string, number>();
  for (const op of operations) {
    typeGroups.set(op.type, (typeGroups.get(op.type) ?? 0) + 1);
  }
  const typeChangeCount = typeGroups.size - 1;
  if (typeChangeCount > 2) {
    reorderOpportunities.push({
      type: 'group_by_type',
      count: typeChangeCount,
      savingsSeconds: typeChangeCount * 3,
    });
  }

  const estimatedTimeSavings = reorderOpportunities.reduce((s, o) => s + o.savingsSeconds, 0);
  const currentScore = Math.max(0, 100 - reorderOpportunities.length * 10);
  const optimizedScore = Math.min(100, currentScore + reorderOpportunities.length * 10);

  const recommendations: string[] = [];
  recommendations.push(`${operations.length} operations, ${toolGroups.size} tools, ${zGroups.size} Z-levels`);
  for (const opp of reorderOpportunities) {
    recommendations.push(`${opp.type}: ${opp.count} changes, save ${opp.savingsSeconds}s`);
  }
  if (estimatedTimeSavings > 30) {
    recommendations.push(`Significant time savings possible: ${estimatedTimeSavings}s`);
  }
  if (toolChangeCount > 3) {
    recommendations.push(`${toolChangeCount} tool changes — group operations by tool`);
  }
  if (currentScore > 85) {
    recommendations.push('Well-ordered execution — minimal optimization needed');
  }

  return {
    operationCount: operations.length, estimatedTimeSavings,
    reorderOpportunities, currentScore, optimizedScore,
    recommendations,
  };
}
