/**
 * @file GcodeAdvanced26.ts
 * @brief Twenty-sixth batch of advanced G-code analysis features for CNC and 3D printing.
 *
 * This module provides 12 additional high-impact features:
 *  1. CNC tool path engagement time per layer calculator (CNC)
 *  2. Print extrusion rate per layer analyzer (3DP)
 *  3. G-code work offset usage analyzer (Universal)
 *  4. CNC tool deflection compensation calculator (CNC)
 *  5. Print bridging speed optimizer (3DP)
 *  6. G-code toolpath overlap detector per layer (Universal)
 *  7. CNC spindle load variance per layer (CNC)
 *  8. Print retraction hop height analyzer (3DP)
 *  9. G-code program complexity score calculator (Universal)
 * 10. CNC arc interpolation quality analyzer (CNC)
 * 11. Print layer height consistency per layer analyzer (3DP)
 * 12. G-code modal state transition analyzer (Universal)
 */

// ── 1. CNC Tool Path Engagement Time Per Layer Calculator ──

export interface LayerEngagementTime {
  /** Layer number */
  layer: number;
  /** Z height */
  zHeight: number;
  /** Engagement time in seconds */
  engagementTime: number;
  /** Cutting distance in mm */
  cuttingDistance: number;
  /** Percentage of total engagement time */
  percentage: number;
}

export interface EngagementTimePerLayerResult {
  /** Per-layer engagement time data */
  layers: LayerEngagementTime[];
  /** Layer count */
  layerCount: number;
  /** Total engagement time in seconds */
  totalEngagementTime: number;
  /** Average engagement time per layer in seconds */
  avgEngagementTime: number;
  /** Layer with max engagement time */
  maxEngagementLayer: number;
  /** Engagement distribution score (0-100) */
  distributionScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Calculate tool engagement time per Z-layer.
 * Shows how cutting time is distributed across depths.
 *
 * @param lines G-code lines
 */
export function calculateEngagementTimePerLayer(
  lines: string[],
): EngagementTimePerLayerResult {
  const layers: LayerEngagementTime[] = [];
  let prevX = 0, prevY = 0, prevZ = 0;
  let feedRate = 0;
  let currentZ = 0;
  let layerNum = 0;
  let layerTime = 0;
  let layerDist = 0;

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

    // Detect layer change
    if (z < currentZ - 0.1 && layerTime > 0) {
      layers.push({
        layer: layerNum, zHeight: currentZ,
        engagementTime: layerTime, cuttingDistance: layerDist,
        percentage: 0,
      });
      layerNum++;
      currentZ = z;
      layerTime = 0;
      layerDist = 0;
    } else if (layerNum === 0 && z < 0) {
      currentZ = z;
      layerNum = 1;
    }

    // Track cutting time and distance
    if (z < 0) {
      const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
      if (dist > 0 && feedRate > 0) {
        layerTime += dist / (feedRate / 60);
        layerDist += dist;
      }
    }

    prevX = x; prevY = y; prevZ = z;
  }

  // Save last layer
  if (layerTime > 0) {
    layers.push({
      layer: layerNum, zHeight: currentZ,
      engagementTime: layerTime, cuttingDistance: layerDist,
      percentage: 0,
    });
  }

  if (layers.length === 0) {
    return {
      layers: [], layerCount: 0, totalEngagementTime: 0,
      avgEngagementTime: 0, maxEngagementLayer: 0,
      distributionScore: 100,
      recommendations: ['No engagement time data for per-layer analysis'],
    };
  }

  const totalEngagementTime = layers.reduce((s, l) => s + l.engagementTime, 0);
  const avgEngagementTime = totalEngagementTime / layers.length;
  const maxLayer = layers.reduce((max, l) =>
    l.engagementTime > max.engagementTime ? l : max, layers[0]);

  for (const l of layers) {
    l.percentage = totalEngagementTime > 0 ? (l.engagementTime / totalEngagementTime) * 100 : 0;
  }

  const times = layers.map(l => l.engagementTime);
  const stdDev = Math.sqrt(times.reduce((s, t) => s + (t - avgEngagementTime) ** 2, 0) / times.length);
  const distributionScore = avgEngagementTime > 0
    ? Math.max(0, 100 - (stdDev / avgEngagementTime) * 100) : 100;

  const recommendations: string[] = [];
  recommendations.push(`${layers.length} layers, total engagement ${totalEngagementTime.toFixed(1)}s`);
  recommendations.push(`Avg per layer: ${avgEngagementTime.toFixed(1)}s, max: layer ${maxLayer.layer} (${maxLayer.engagementTime.toFixed(1)}s)`);
  if (distributionScore < 70) {
    recommendations.push('Uneven engagement distribution — some layers take much longer');
  }
  if (maxLayer.engagementTime > avgEngagementTime * 3) {
    recommendations.push(`Layer ${maxLayer.layer} takes 3x longer than average — optimize toolpath`);
  }
  if (distributionScore > 80) {
    recommendations.push('Even engagement distribution — consistent cutting time');
  }

  return {
    layers, layerCount: layers.length, totalEngagementTime,
    avgEngagementTime, maxEngagementLayer: maxLayer.layer,
    distributionScore, recommendations,
  };
}

// ── 2. Print Extrusion Rate Per Layer Analyzer ──

export interface LayerExtrusionRate {
  /** Layer number */
  layer: number;
  /** Z height */
  zHeight: number;
  /** Extrusion rate in mm³/s */
  extrusionRate: number;
  /** Filament used in mm */
  filamentLength: number;
  /** Print time in seconds */
  printTime: number;
}

export interface ExtrusionRatePerLayerResult {
  /** Per-layer extrusion rate data */
  layers: LayerExtrusionRate[];
  /** Layer count */
  layerCount: number;
  /** Average extrusion rate in mm³/s */
  avgExtrusionRate: number;
  /** Max extrusion rate in mm³/s */
  maxExtrusionRate: number;
  /** Rate consistency score (0-100) */
  consistencyScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze extrusion rate per layer.
 * Inconsistent extrusion rates can cause under/over-extrusion.
 *
 * @param lines G-code lines
 * @param filamentDiameter Filament diameter in mm (default 1.75)
 */
export function analyzeExtrusionRatePerLayer(
  lines: string[],
  filamentDiameter: number = 1.75,
): ExtrusionRatePerLayerResult {
  const layers: LayerExtrusionRate[] = [];
  let prevX = 0, prevY = 0, prevZ = 0, prevE = 0;
  let feedRate = 0;
  let firstZ = 0;
  let currentZ = 0;
  let layerNum = 0;
  let layerFilament = 0;
  let layerTime = 0;

  const crossSection = Math.PI * (filamentDiameter / 2) ** 2;

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
    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const z = zMatch ? parseFloat(zMatch[1]) : prevZ;
    const e = eMatch ? parseFloat(eMatch[1]) : prevE;

    if (firstZ === 0) firstZ = z;

    // Detect layer change
    if (z > currentZ + 0.01 && layerNum > 0) {
      const rate = layerTime > 0 ? (layerFilament * crossSection) / layerTime : 0;
      layers.push({
        layer: layerNum, zHeight: currentZ,
        extrusionRate: rate, filamentLength: layerFilament,
        printTime: layerTime,
      });
      layerNum++;
      currentZ = z;
      layerFilament = 0;
      layerTime = 0;
    } else if (layerNum === 0) {
      currentZ = z;
      layerNum = 1;
    }

    // Track filament and time
    if (e > prevE) {
      layerFilament += e - prevE;
    }
    const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
    if (dist > 0 && feedRate > 0) {
      layerTime += dist / (feedRate / 60);
    }

    prevX = x; prevY = y; prevZ = z; prevE = e;
  }

  // Save last layer
  if (layerFilament > 0 || layerTime > 0) {
    const rate = layerTime > 0 ? (layerFilament * crossSection) / layerTime : 0;
    layers.push({
      layer: layerNum, zHeight: currentZ,
      extrusionRate: rate, filamentLength: layerFilament,
      printTime: layerTime,
    });
  }

  if (layers.length === 0) {
    return {
      layers: [], layerCount: 0, avgExtrusionRate: 0,
      maxExtrusionRate: 0, consistencyScore: 100,
      recommendations: ['No extrusion rate data for per-layer analysis'],
    };
  }

  const rates = layers.map(l => l.extrusionRate).filter(r => r > 0);
  if (rates.length === 0) {
    return {
      layers, layerCount: layers.length, avgExtrusionRate: 0,
      maxExtrusionRate: 0, consistencyScore: 100,
      recommendations: ['No extrusion detected in any layer'],
    };
  }

  const avgExtrusionRate = rates.reduce((a, b) => a + b, 0) / rates.length;
  const maxExtrusionRate = Math.max(...rates);
  const stdDev = Math.sqrt(rates.reduce((s, r) => s + (r - avgExtrusionRate) ** 2, 0) / rates.length);
  const consistencyScore = avgExtrusionRate > 0
    ? Math.max(0, 100 - (stdDev / avgExtrusionRate) * 100) : 100;

  const recommendations: string[] = [];
  recommendations.push(`${layers.length} layers, avg extrusion rate ${avgExtrusionRate.toFixed(2)}mm3/s`);
  if (maxExtrusionRate > avgExtrusionRate * 1.5) {
    recommendations.push(`Max rate ${maxExtrusionRate.toFixed(2)}mm3/s is 1.5x average — inconsistent extrusion`);
  }
  if (consistencyScore < 70) {
    recommendations.push('Inconsistent extrusion rates — check print speed settings');
  }
  if (consistencyScore > 85) {
    recommendations.push('Consistent extrusion rates — good print quality expected');
  }

  return {
    layers, layerCount: layers.length, avgExtrusionRate,
    maxExtrusionRate, consistencyScore, recommendations,
  };
}

// ── 3. G-code Work Offset Usage Analyzer ──

export interface WorkOffsetInfo {
  /** Offset name (G54-G59) */
  name: string;
  /** Activation count */
  count: number;
  /** First line */
  firstLine: number;
  /** Last line */
  lastLine: number;
}

export interface WorkOffsetResult {
  /** Work offset usage data */
  offsets: WorkOffsetInfo[];
  /** Active offset count */
  activeCount: number;
  /** Total activations */
  totalActivations: number;
  /** Primary offset */
  primaryOffset: string;
  /** Offset complexity score (0-100) */
  complexityScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze work offset (G54-G59) usage patterns.
 * Multiple work offsets can indicate complex setups.
 *
 * @param lines G-code lines
 */
export function analyzeWorkOffsetUsage(lines: string[]): WorkOffsetResult {
  const offsetMap = new Map<string, WorkOffsetInfo>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Detect G54-G59.3
    const offsetMatch = code.match(/\bG(5[4-9])(\.\d)?\b/i);
    if (offsetMatch) {
      const name = `G${offsetMatch[1]}${offsetMatch[2] ?? ''}`;
      const existing = offsetMap.get(name);
      if (existing) {
        existing.count++;
        existing.lastLine = i;
      } else {
        offsetMap.set(name, { name, count: 1, firstLine: i, lastLine: i });
      }
    }
  }

  if (offsetMap.size === 0) {
    return {
      offsets: [], activeCount: 0, totalActivations: 0,
      primaryOffset: 'none', complexityScore: 100,
      recommendations: ['No work offsets (G54-G59) detected'],
    };
  }

  const offsets = Array.from(offsetMap.values()).sort((a, b) => a.firstLine - b.firstLine);
  const activeCount = offsets.length;
  const totalActivations = offsets.reduce((s, o) => s + o.count, 0);
  const primaryOffset = offsets.reduce((max, o) => o.count > max.count ? o : max, offsets[0]).name;
  const complexityScore = Math.max(0, 100 - activeCount * 15 - totalActivations * 2);

  const recommendations: string[] = [];
  recommendations.push(`${activeCount} work offsets, ${totalActivations} activations`);
  for (const o of offsets) {
    recommendations.push(`${o.name}: ${o.count} activations (lines ${o.firstLine}-${o.lastLine})`);
  }
  if (activeCount > 3) {
    recommendations.push(`${activeCount} work offsets — complex setup, verify alignment`);
  }
  if (complexityScore > 85) {
    recommendations.push('Simple offset usage — straightforward setup');
  }

  return {
    offsets, activeCount, totalActivations,
    primaryOffset, complexityScore, recommendations,
  };
}

// ── 4. CNC Tool Deflection Compensation Calculator ──

export interface DeflectionCompensationResult {
  /** Estimated deflection in mm */
  estimatedDeflection: number;
  /** Tool overhang length in mm */
  overhangLength: number;
  /** Tool diameter in mm */
  toolDiameter: number;
  /** Cutting force in N */
  cuttingForce: number;
  /** Recommended compensation in mm */
  recommendedCompensation: number;
  /** Deflection severity */
  severity: 'minimal' | 'low' | 'moderate' | 'high' | 'severe';
  /** Accuracy impact score (0-100) */
  accuracyImpactScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Calculate tool deflection compensation.
 * Tool deflection causes dimensional inaccuracies in CNC milling.
 *
 * @param lines G-code lines
 * @param toolDiameter Tool diameter in mm (default 6)
 * @param overhangLength Tool overhang in mm (default 30)
 * @param cuttingForce Cutting force in N (default 50)
 */
export function calculateDeflectionCompensation(
  lines: string[],
  toolDiameter: number = 6,
  overhangLength: number = 30,
  cuttingForce: number = 50,
): DeflectionCompensationResult {
  // Estimate cutting force from feed rate if available
  let maxFeedRate = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;
    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) {
      maxFeedRate = Math.max(maxFeedRate, parseFloat(fMatch[1]));
    }
  }

  // Adjust cutting force based on feed rate
  const adjustedForce = maxFeedRate > 0 ? cuttingForce * (maxFeedRate / 500) : cuttingForce;

  // Young's modulus for HSS tool steel: ~200 GPa
  // Moment of inertia for circular cross-section: I = pi * d^4 / 64
  const E = 200000; // N/mm²
  const I = (Math.PI * toolDiameter ** 4) / 64;

  // Deflection = F * L^3 / (3 * E * I)
  const estimatedDeflection = (adjustedForce * overhangLength ** 3) / (3 * E * I);
  const recommendedCompensation = estimatedDeflection * 0.8; // 80% compensation

  const severity: DeflectionCompensationResult['severity'] =
    estimatedDeflection < 0.001 ? 'minimal'
    : estimatedDeflection < 0.01 ? 'low'
    : estimatedDeflection < 0.05 ? 'moderate'
    : estimatedDeflection < 0.1 ? 'high' : 'severe';

  const accuracyImpactScore = Math.max(0, 100 - estimatedDeflection * 1000);

  const recommendations: string[] = [];
  recommendations.push(`Estimated deflection: ${estimatedDeflection.toFixed(4)}mm at ${adjustedForce.toFixed(0)}N force`);
  recommendations.push(`Recommended compensation: ${recommendedCompensation.toFixed(4)}mm`);
  if (severity === 'high' || severity === 'severe') {
    recommendations.push(`${severity} deflection — reduce overhang or use larger tool`);
  }
  if (overhangLength > toolDiameter * 5) {
    recommendations.push(`Overhang ${overhangLength}mm is >5x tool diameter — high deflection risk`);
  }
  if (accuracyImpactScore > 90) {
    recommendations.push('Minimal deflection — good dimensional accuracy expected');
  }

  return {
    estimatedDeflection, overhangLength, toolDiameter,
    cuttingForce: adjustedForce, recommendedCompensation,
    severity, accuracyImpactScore, recommendations,
  };
}

// ── 5. Print Bridging Speed Optimizer ──

export interface BridgingSpeedResult {
  /** Bridge segment count */
  bridgeCount: number;
  /** Current bridge speed in mm/min */
  currentSpeed: number;
  /** Recommended bridge speed in mm/min */
  recommendedSpeed: number;
  /** Total bridge distance in mm */
  totalBridgeDistance: number;
  /** Longest bridge in mm */
  longestBridge: number;
  /** Bridge quality score (0-100) */
  qualityScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Optimize print speed for bridging operations.
 * Bridges need specific speed settings to prevent sagging.
 *
 * @param lines G-code lines
 * @param material Material type (default 'PLA')
 */
export function optimizeBridgingSpeed(
  lines: string[],
  material: string = 'PLA',
): BridgingSpeedResult {
  let bridgeCount = 0;
  let totalBridgeDistance = 0;
  let longestBridge = 0;
  let currentSpeed = 0;
  let isBridge = false;
  let prevX = 0, prevY = 0;

  // Material-specific bridge speed recommendations
  const bridgeSpeeds: { [material: string]: number } = {
    PLA: 1500, ABS: 1200, PETG: 1000, Nylon: 800, TPU: 600, ASA: 1200,
  };
  const recommendedSpeed = bridgeSpeeds[material] ?? 1500;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Detect bridge sections from comments
    if (/;.*bridge/i.test(trimmed)) {
      isBridge = true;
    } else if (/;.*layer/i.test(trimmed) || /;.*perimeter/i.test(trimmed) || /;.*infill/i.test(trimmed)) {
      isBridge = false;
    }

    if (trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG1\b/i.test(code)) continue;

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) currentSpeed = parseFloat(fMatch[1]);

    if (isBridge) {
      const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
      const x = xMatch ? parseFloat(xMatch[1]) : prevX;
      const y = yMatch ? parseFloat(yMatch[1]) : prevY;
      const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
      if (dist > 0) {
        bridgeCount++;
        totalBridgeDistance += dist;
        longestBridge = Math.max(longestBridge, dist);
      }
      prevX = x; prevY = y;
    } else {
      const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
      prevX = xMatch ? parseFloat(xMatch[1]) : prevX;
      prevY = yMatch ? parseFloat(yMatch[1]) : prevY;
    }
  }

  if (bridgeCount === 0) {
    return {
      bridgeCount: 0, currentSpeed: 0, recommendedSpeed,
      totalBridgeDistance: 0, longestBridge: 0, qualityScore: 100,
      recommendations: ['No bridge segments detected'],
    };
  }

  const speedDelta = Math.abs(currentSpeed - recommendedSpeed);
  const qualityScore = Math.max(0, 100 - speedDelta / 10);

  const recommendations: string[] = [];
  recommendations.push(`${bridgeCount} bridge segments, ${totalBridgeDistance.toFixed(0)}mm total`);
  recommendations.push(`Current speed: ${currentSpeed.toFixed(0)}mm/min, recommended: ${recommendedSpeed}mm/min`);
  if (currentSpeed > recommendedSpeed + 200) {
    recommendations.push(`Bridge speed too high — reduce to ${recommendedSpeed}mm/min to prevent sagging`);
  }
  if (longestBridge > 50) {
    recommendations.push(`Longest bridge: ${longestBridge.toFixed(0)}mm — consider adding supports`);
  }
  if (qualityScore > 85) {
    recommendations.push('Optimal bridge speed — minimal sagging expected');
  }

  return {
    bridgeCount, currentSpeed, recommendedSpeed,
    totalBridgeDistance, longestBridge, qualityScore,
    recommendations,
  };
}

// ── 6. G-code Toolpath Overlap Detector Per Layer ──

export interface LayerOverlap {
  /** Layer number */
  layer: number;
  /** Z height */
  zHeight: number;
  /** Overlap count */
  overlapCount: number;
  /** Overlap area in mm² */
  overlapArea: number;
  /** Overlap percentage */
  overlapPercentage: number;
}

export interface OverlapPerLayerResult {
  /** Per-layer overlap data */
  layers: LayerOverlap[];
  /** Layer count */
  layerCount: number;
  /** Total overlaps */
  totalOverlaps: number;
  /** Total overlap area in mm² */
  totalOverlapArea: number;
  /** Layer with most overlaps */
  worstLayer: number;
  /** Overlap severity score (0-100, higher is worse) */
  severityScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Detect toolpath overlaps per layer.
 * Overlaps indicate redundant cutting or printing paths.
 *
 * @param lines G-code lines
 * @param gridSize Grid size for overlap detection in mm (default 2)
 */
export function detectOverlapsPerLayer(
  lines: string[],
  gridSize: number = 2,
): OverlapPerLayerResult {
  const layers: LayerOverlap[] = [];
  let prevX = 0, prevY = 0, prevZ = 0;
  let firstZ = 0;
  let currentZ = 0;
  let layerNum = 0;
  let layerGrid = new Set<string>();
  let layerOverlapCount = 0;
  let layerOverlapArea = 0;
  let layerCellCount = 0;

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

    if (firstZ === 0) firstZ = z;

    // Detect layer change
    if (z > currentZ + 0.01 && layerNum > 0) {
      const overlapPercentage = layerCellCount > 0 ? (layerOverlapCount / layerCellCount) * 100 : 0;
      layers.push({
        layer: layerNum, zHeight: currentZ,
        overlapCount: layerOverlapCount,
        overlapArea: layerOverlapArea,
        overlapPercentage,
      });
      layerNum++;
      currentZ = z;
      layerGrid = new Set<string>();
      layerOverlapCount = 0;
      layerOverlapArea = 0;
      layerCellCount = 0;
    } else if (layerNum === 0) {
      currentZ = z;
      layerNum = 1;
    }

    // Track cells visited
    if (layerNum > 0) {
      const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
      if (dist > 0) {
        const steps = Math.max(1, Math.ceil(dist / gridSize));
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const px = prevX + (x - prevX) * t;
          const py = prevY + (y - prevY) * t;
          const cellKey = `${Math.floor(px / gridSize)}_${Math.floor(py / gridSize)}`;
          if (layerGrid.has(cellKey)) {
            layerOverlapCount++;
            layerOverlapArea += gridSize * gridSize;
          } else {
            layerGrid.add(cellKey);
            layerCellCount++;
          }
        }
      }
    }

    prevX = x; prevY = y; prevZ = z;
  }

  // Save last layer
  if (layerNum > 0 && layerCellCount > 0) {
    const overlapPercentage = (layerOverlapCount / layerCellCount) * 100;
    layers.push({
      layer: layerNum, zHeight: currentZ,
      overlapCount: layerOverlapCount,
      overlapArea: layerOverlapArea,
      overlapPercentage,
    });
  }

  if (layers.length === 0) {
    return {
      layers: [], layerCount: 0, totalOverlaps: 0,
      totalOverlapArea: 0, worstLayer: 0, severityScore: 0,
      recommendations: ['No overlap data for per-layer analysis'],
    };
  }

  const totalOverlaps = layers.reduce((s, l) => s + l.overlapCount, 0);
  const totalOverlapArea = layers.reduce((s, l) => s + l.overlapArea, 0);
  const worstLayer = layers.reduce((max, l) =>
    l.overlapCount > max.overlapCount ? l : max, layers[0]).layer;
  const severityScore = Math.min(100, totalOverlaps / 10);

  const recommendations: string[] = [];
  recommendations.push(`${layers.length} layers, ${totalOverlaps} total overlaps (${totalOverlapArea.toFixed(0)}mm2)`);
  if (totalOverlaps > 50) {
    recommendations.push(`${totalOverlaps} overlaps — significant redundant toolpath`);
  }
  if (worstLayer >= 0) {
    const worst = layers.find(l => l.layer === worstLayer);
    if (worst) {
      recommendations.push(`Worst layer: ${worstLayer} with ${worst.overlapCount} overlaps`);
    }
  }
  if (severityScore > 50) {
    recommendations.push('High overlap severity — optimize toolpath to reduce redundancy');
  }
  if (severityScore < 10) {
    recommendations.push('Low overlap — efficient toolpath');
  }

  return {
    layers, layerCount: layers.length, totalOverlaps,
    totalOverlapArea, worstLayer, severityScore,
    recommendations,
  };
}

// ── 7. CNC Spindle Load Variance Per Layer ──

export interface LayerSpindleLoad {
  /** Layer number */
  layer: number;
  /** Z height */
  zHeight: number;
  /** Average load percentage */
  avgLoad: number;
  /** Max load percentage */
  maxLoad: number;
  /** Load variance */
  variance: number;
}

export interface SpindleLoadPerLayerResult {
  /** Per-layer spindle load data */
  layers: LayerSpindleLoad[];
  /** Layer count */
  layerCount: number;
  /** Overall average load */
  overallAvgLoad: number;
  /** Layer with highest load */
  highestLoadLayer: number;
  /** Load stability score (0-100) */
  stabilityScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze spindle load variance per Z-layer.
 * High load variance indicates inconsistent cutting conditions.
 *
 * @param lines G-code lines
 * @param maxSpindlePower Max spindle power in kW (default 5)
 */
export function analyzeSpindleLoadPerLayer(
  lines: string[],
  maxSpindlePower: number = 5,
): SpindleLoadPerLayerResult {
  const layers: LayerSpindleLoad[] = [];
  let prevX = 0, prevY = 0, prevZ = 0;
  let feedRate = 0;
  let spindleSpeed = 0;
  let currentZ = 0;
  let layerNum = 0;
  let layerLoads: number[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) feedRate = parseFloat(fMatch[1]);

    const sMatch = code.match(/\bS(\d*\.?\d+)/i);
    if (sMatch) spindleSpeed = parseFloat(sMatch[1]);

    if (!/\bG1\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const z = zMatch ? parseFloat(zMatch[1]) : prevZ;

    // Detect layer change
    if (z < currentZ - 0.1 && layerLoads.length > 0) {
      const avgLoad = layerLoads.reduce((a, b) => a + b, 0) / layerLoads.length;
      const maxLoad = Math.max(...layerLoads);
      const variance = layerLoads.reduce((s, l) => s + (l - avgLoad) ** 2, 0) / layerLoads.length;
      layers.push({
        layer: layerNum, zHeight: currentZ,
        avgLoad, maxLoad, variance,
      });
      layerNum++;
      currentZ = z;
      layerLoads = [];
    } else if (layerNum === 0 && z < 0) {
      currentZ = z;
      layerNum = 1;
    }

    // Estimate spindle load from feed rate and spindle speed
    if (z < 0 && feedRate > 0 && spindleSpeed > 0) {
      // Simplified load estimate: proportional to feed rate
      const load = Math.min(100, (feedRate / 1000) * 20);
      layerLoads.push(load);
    }

    prevX = x; prevY = y; prevZ = z;
  }

  // Save last layer
  if (layerLoads.length > 0) {
    const avgLoad = layerLoads.reduce((a, b) => a + b, 0) / layerLoads.length;
    const maxLoad = Math.max(...layerLoads);
    const variance = layerLoads.reduce((s, l) => s + (l - avgLoad) ** 2, 0) / layerLoads.length;
    layers.push({
      layer: layerNum, zHeight: currentZ,
      avgLoad, maxLoad, variance,
    });
  }

  if (layers.length === 0) {
    return {
      layers: [], layerCount: 0, overallAvgLoad: 0,
      highestLoadLayer: 0, stabilityScore: 100,
      recommendations: ['No spindle load data for per-layer analysis'],
    };
  }

  const overallAvgLoad = layers.reduce((s, l) => s + l.avgLoad, 0) / layers.length;
  const highestLoad = layers.reduce((max, l) =>
    l.maxLoad > max.maxLoad ? l : max, layers[0]);

  const variances = layers.map(l => l.variance);
  const avgVariance = variances.reduce((a, b) => a + b, 0) / variances.length;
  const stabilityScore = Math.max(0, 100 - avgVariance * 2);

  const recommendations: string[] = [];
  recommendations.push(`${layers.length} layers, avg load ${overallAvgLoad.toFixed(1)}%`);
  recommendations.push(`Highest load: layer ${highestLoad.layer} at ${highestLoad.maxLoad.toFixed(1)}%`);
  if (highestLoad.maxLoad > 80) {
    recommendations.push(`Layer ${highestLoad.layer} at ${highestLoad.maxLoad.toFixed(0)}% load — risk of overload`);
  }
  if (stabilityScore < 70) {
    recommendations.push('Unstable spindle load — inconsistent cutting conditions');
  }
  if (stabilityScore > 85) {
    recommendations.push('Stable spindle load — consistent cutting');
  }

  return {
    layers, layerCount: layers.length, overallAvgLoad,
    highestLoadLayer: highestLoad.layer, stabilityScore,
    recommendations,
  };
}

// ── 8. Print Retraction Hop Height Analyzer ──

export interface RetractionHopResult {
  /** Total Z-hop count */
  hopCount: number;
  /** Average hop height in mm */
  avgHopHeight: number;
  /** Max hop height in mm */
  maxHopHeight: number;
  /** Total hop distance in mm */
  totalHopDistance: number;
  /** Hop time in seconds */
  hopTime: number;
  /** Hop efficiency score (0-100) */
  efficiencyScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze Z-hop (hop height) during retraction moves.
 * Excessive Z-hop wastes time and can cause Z-axis wear.
 *
 * @param lines G-code lines
 */
export function analyzeRetractionHopHeight(lines: string[]): RetractionHopResult {
  let hopCount = 0;
  let totalHopHeight = 0;
  let maxHopHeight = 0;
  let totalHopDistance = 0;
  let prevZ = 0;
  let baseZ = 0;
  let feedRate = 0;
  let isRetracting = false;
  let hopStartTime = 0;
  let totalHopTime = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) feedRate = parseFloat(fMatch[1]);

    if (!/\bG1\b/i.test(code)) continue;

    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

    if (eMatch) {
      const e = parseFloat(eMatch[1]);
      // Detect retraction (E decreasing)
      isRetracting = e < 0 || (code.match(/\bE(-?\d*\.?\d+)/i)?.[1]?.startsWith('-') ?? false);
    }

    if (zMatch) {
      const z = parseFloat(zMatch[1]);
      const zDelta = z - prevZ;

      // Detect Z-hop (Z increases during travel/retraction)
      if (zDelta > 0.01 && (isRetracting || /\bG0\b/i.test(code))) {
        if (baseZ === 0) baseZ = prevZ;
        hopCount++;
        totalHopHeight += zDelta;
        maxHopHeight = Math.max(maxHopHeight, zDelta);
        if (feedRate > 0) {
          totalHopTime += zDelta / (feedRate / 60);
        }
      }
      // Detect return from hop
      if (zDelta < -0.01 && baseZ > 0) {
        if (feedRate > 0) {
          totalHopTime += Math.abs(zDelta) / (feedRate / 60);
        }
        if (Math.abs(z - baseZ) < 0.01) {
          baseZ = 0;
        }
      }
      prevZ = z;
    }
  }

  if (hopCount === 0) {
    return {
      hopCount: 0, avgHopHeight: 0, maxHopHeight: 0,
      totalHopDistance: 0, hopTime: 0, efficiencyScore: 100,
      recommendations: ['No Z-hop during retraction detected'],
    };
  }

  const avgHopHeight = totalHopHeight / hopCount;
  const efficiencyScore = Math.max(0, 100 - hopCount * 2 - avgHopHeight * 50);

  const recommendations: string[] = [];
  recommendations.push(`${hopCount} Z-hops, avg ${avgHopHeight.toFixed(3)}mm, max ${maxHopHeight.toFixed(3)}mm`);
  recommendations.push(`Total hop time: ${totalHopTime.toFixed(1)}s`);
  if (hopCount > 50) {
    recommendations.push(`${hopCount} Z-hops — consider disabling Z-hop for time savings`);
  }
  if (maxHopHeight > 0.5) {
    recommendations.push(`Max hop ${maxHopHeight.toFixed(2)}mm — reduce to minimize Z-axis wear`);
  }
  if (efficiencyScore > 85) {
    recommendations.push('Efficient Z-hop — minimal time wasted');
  }

  return {
    hopCount, avgHopHeight, maxHopHeight,
    totalHopDistance, hopTime: totalHopTime, efficiencyScore,
    recommendations,
  };
}

// ── 9. G-code Program Complexity Score Calculator ──

export interface ProgramComplexityResult {
  /** Overall complexity score (0-100) */
  complexityScore: number;
  /** Complexity rating */
  rating: 'simple' | 'moderate' | 'complex' | 'very_complex';
  /** Line count */
  lineCount: number;
  /** Command variety */
  commandVariety: number;
  /** Unique G-codes count */
  uniqueGCodes: number;
  /** Unique M-codes count */
  uniqueMCodes: number;
  /** Subprogram count */
  subprogramCount: number;
  /** Tool change count */
  toolChangeCount: number;
  /** Coordinate system count */
  coordinateSystemCount: number;
  /** Complexity factors */
  factors: { factor: string; score: number }[];
  /** Recommendations */
  recommendations: string[];
}

/**
 * Calculate overall G-code program complexity score.
 * Higher complexity indicates more difficult to debug and maintain.
 *
 * @param lines G-code lines
 */
export function calculateProgramComplexity(lines: string[]): ProgramComplexityResult {
  const gCodes = new Set<string>();
  const mCodes = new Set<string>();
  let subprogramCount = 0;
  let toolChangeCount = 0;
  let coordSystemCount = 0;
  let lineCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    lineCount++;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Collect G-codes
    const gMatches = code.matchAll(/\bG(\d+\.?\d*)\b/gi);
    for (const m of gMatches) gCodes.add(m[1]);

    // Collect M-codes
    const mMatches = code.matchAll(/\bM(\d+)\b/gi);
    for (const m of mMatches) mCodes.add(m[1]);

    // Count subprograms
    if (/\bM97\b/i.test(code) || /\bM98\b/i.test(code) || /\bO\d+\b/i.test(code)) {
      subprogramCount++;
    }

    // Count tool changes
    if (/\bM6\b/i.test(code) || /\bT\d+\b/i.test(code)) {
      toolChangeCount++;
    }

    // Count coordinate systems
    if (/\bG5[4-9]\b/i.test(code)) {
      coordSystemCount++;
    }
  }

  const commandVariety = gCodes.size + mCodes.size;

  // Calculate complexity factors
  const factors: { factor: string; score: number }[] = [];
  factors.push({ factor: 'Line count', score: Math.min(25, lineCount / 100) });
  factors.push({ factor: 'Command variety', score: Math.min(25, commandVariety * 2) });
  factors.push({ factor: 'Subprograms', score: Math.min(20, subprogramCount * 2) });
  factors.push({ factor: 'Tool changes', score: Math.min(15, toolChangeCount * 3) });
  factors.push({ factor: 'Coord systems', score: Math.min(15, coordSystemCount * 3) });

  const complexityScore = Math.round(factors.reduce((s, f) => s + f.score, 0));

  const rating: ProgramComplexityResult['rating'] =
    complexityScore < 25 ? 'simple'
    : complexityScore < 50 ? 'moderate'
    : complexityScore < 75 ? 'complex' : 'very_complex';

  const recommendations: string[] = [];
  recommendations.push(`Complexity: ${complexityScore}/100 (${rating})`);
  recommendations.push(`${lineCount} lines, ${commandVariety} unique commands, ${subprogramCount} subprograms`);
  if (complexityScore > 75) {
    recommendations.push('Very complex program — consider breaking into subprograms');
  }
  if (toolChangeCount > 5) {
    recommendations.push(`${toolChangeCount} tool changes — complex tool management`);
  }
  if (subprogramCount > 10) {
    recommendations.push(`${subprogramCount} subprogram calls — verify call stack`);
  }
  if (complexityScore < 25) {
    recommendations.push('Simple program — easy to debug and maintain');
  }

  return {
    complexityScore, rating, lineCount, commandVariety,
    uniqueGCodes: gCodes.size, uniqueMCodes: mCodes.size,
    subprogramCount, toolChangeCount, coordinateSystemCount: coordSystemCount,
    factors, recommendations,
  };
}

// ── 10. CNC Arc Interpolation Quality Analyzer ──

export interface ArcQualityInfo {
  /** Line number */
  line: number;
  /** Arc radius in mm */
  radius: number;
  /** Arc angle in degrees */
  angle: number;
  /** Arc length in mm */
  length: number;
  /** Direction */
  direction: 'CW' | 'CCW';
  /** Quality issue */
  hasIssue: boolean;
  /** Issue description */
  issue: string;
}

export interface ArcQualityResult {
  /** Arc information */
  arcs: ArcQualityInfo[];
  /** Arc count */
  count: number;
  /** Average radius in mm */
  avgRadius: number;
  /** Min radius in mm */
  minRadius: number;
  /** Total arc length in mm */
  totalArcLength: number;
  /** Issue count */
  issueCount: number;
  /** Quality score (0-100) */
  qualityScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze G2/G3 arc interpolation quality.
 * Poor arc quality can cause surface finish issues.
 *
 * @param lines G-code lines
 */
export function analyzeArcInterpolationQuality(lines: string[]): ArcQualityResult {
  const arcs: ArcQualityInfo[] = [];
  let prevX = 0, prevY = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const isArc = /\bG[23]\b/i.test(code);
    if (!isArc) {
      // Track position from G0/G1
      if (/\bG[01]\b/i.test(code)) {
        const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
        const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
        prevX = xMatch ? parseFloat(xMatch[1]) : prevX;
        prevY = yMatch ? parseFloat(yMatch[1]) : prevY;
      }
      continue;
    }

    const direction: 'CW' | 'CCW' = /\bG2\b/i.test(code) ? 'CW' : 'CCW';

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const iMatch = code.match(/\bI(-?\d*\.?\d+)/i);
    const jMatch = code.match(/\bJ(-?\d*\.?\d+)/i);
    const rMatch = code.match(/\bR(-?\d*\.?\d+)/i);

    const endX = xMatch ? parseFloat(xMatch[1]) : prevX;
    const endY = yMatch ? parseFloat(yMatch[1]) : prevY;

    let radius = 0;
    let centerX = 0, centerY = 0;

    if (rMatch) {
      radius = Math.abs(parseFloat(rMatch[1]));
    } else if (iMatch || jMatch) {
      const i = iMatch ? parseFloat(iMatch[1]) : 0;
      const j = jMatch ? parseFloat(jMatch[1]) : 0;
      centerX = prevX + i;
      centerY = prevY + j;
      radius = Math.sqrt(i * i + j * j);
    }

    // Calculate arc angle and length
    let angle = 0;
    let length = 0;
    if (radius > 0) {
      const startAngle = Math.atan2(prevY - centerY, prevX - centerX);
      const endAngle = Math.atan2(endY - centerY, endX - centerX);
      let angleDiff = Math.abs(endAngle - startAngle);
      if (direction === 'CW') {
        angleDiff = 2 * Math.PI - angleDiff;
      }
      angle = angleDiff * 180 / Math.PI;
      length = radius * angleDiff;
    }

    // Check for quality issues
    let hasIssue = false;
    let issue = '';
    if (radius < 0.1) {
      hasIssue = true;
      issue = 'very_small_radius';
    } else if (radius > 500) {
      hasIssue = true;
      issue = 'very_large_radius';
    } else if (angle > 350) {
      hasIssue = true;
      issue = 'near_full_circle';
    }

    arcs.push({
      line: i, radius, angle, length,
      direction, hasIssue, issue,
    });

    prevX = endX; prevY = endY;
  }

  if (arcs.length === 0) {
    return {
      arcs: [], count: 0, avgRadius: 0, minRadius: 0,
      totalArcLength: 0, issueCount: 0, qualityScore: 100,
      recommendations: ['No arc interpolation (G2/G3) detected'],
    };
  }

  const radii = arcs.map(a => a.radius).filter(r => r > 0);
  const avgRadius = radii.length > 0 ? radii.reduce((a, b) => a + b, 0) / radii.length : 0;
  const minRadius = radii.length > 0 ? Math.min(...radii) : 0;
  const totalArcLength = arcs.reduce((s, a) => s + a.length, 0);
  const issueCount = arcs.filter(a => a.hasIssue).length;
  const qualityScore = Math.max(0, 100 - issueCount * 10);

  const recommendations: string[] = [];
  recommendations.push(`${arcs.length} arcs, avg radius ${avgRadius.toFixed(2)}mm, total length ${totalArcLength.toFixed(0)}mm`);
  if (issueCount > 0) {
    recommendations.push(`${issueCount} quality issues in arcs`);
  }
  if (minRadius < 0.5) {
    recommendations.push(`Min radius ${minRadius.toFixed(3)}mm — very tight arc, check tool radius`);
  }
  if (qualityScore > 85) {
    recommendations.push('Good arc quality — no significant issues');
  }

  return {
    arcs, count: arcs.length, avgRadius, minRadius,
    totalArcLength, issueCount, qualityScore, recommendations,
  };
}

// ── 11. Print Layer Height Consistency Per Layer Analyzer ──

export interface LayerHeightInfo {
  /** Layer number */
  layer: number;
  /** Z height */
  zHeight: number;
  /** Layer height in mm */
  layerHeight: number;
  /** Deviation from nominal in mm */
  deviation: number;
  /** Is consistent */
  isConsistent: boolean;
}

export interface LayerHeightConsistencyResult {
  /** Per-layer height data */
  layers: LayerHeightInfo[];
  /** Layer count */
  layerCount: number;
  /** Nominal layer height in mm */
  nominalHeight: number;
  /** Average layer height in mm */
  avgHeight: number;
  /** Height standard deviation in mm */
  stdDev: number;
  /** Consistency score (0-100) */
  consistencyScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze layer height consistency per layer.
 * Inconsistent layer heights affect print quality and strength.
 *
 * @param lines G-code lines
 * @param tolerance Height tolerance in mm (default 0.02)
 */
export function analyzeLayerHeightConsistencyPerLayer(
  lines: string[],
  tolerance: number = 0.02,
): LayerHeightConsistencyResult {
  const layers: LayerHeightInfo[] = [];
  const zHeights: number[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG1\b/i.test(code)) continue;

    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    if (zMatch) {
      const z = parseFloat(zMatch[1]);
      if (zHeights.length === 0 || z > zHeights[zHeights.length - 1] + 0.005) {
        zHeights.push(z);
      }
    }
  }

  if (zHeights.length < 2) {
    return {
      layers: [], layerCount: 0, nominalHeight: 0,
      avgHeight: 0, stdDev: 0, consistencyScore: 100,
      recommendations: ['Insufficient layer data for height consistency analysis'],
    };
  }

  // Calculate layer heights
  const heights: number[] = [];
  for (let i = 1; i < zHeights.length; i++) {
    heights.push(zHeights[i] - zHeights[i - 1]);
  }

  const nominalHeight = heights[0];
  const avgHeight = heights.reduce((a, b) => a + b, 0) / heights.length;
  const stdDev = Math.sqrt(heights.reduce((s, h) => s + (h - avgHeight) ** 2, 0) / heights.length);

  for (let i = 0; i < heights.length; i++) {
    const deviation = heights[i] - nominalHeight;
    layers.push({
      layer: i + 1, zHeight: zHeights[i + 1],
      layerHeight: heights[i], deviation,
      isConsistent: Math.abs(deviation) <= tolerance,
    });
  }

  const inconsistentCount = layers.filter(l => !l.isConsistent).length;
  const consistencyScore = Math.max(0, 100 - (inconsistentCount / layers.length) * 100);

  const recommendations: string[] = [];
  recommendations.push(`${layers.length} layers, nominal ${nominalHeight.toFixed(3)}mm, avg ${avgHeight.toFixed(3)}mm`);
  recommendations.push(`Std dev: ${stdDev.toFixed(4)}mm, ${inconsistentCount} inconsistent layers`);
  if (inconsistentCount > layers.length * 0.2) {
    recommendations.push(`${inconsistentCount} inconsistent layers — check Z-axis mechanics`);
  }
  if (stdDev > tolerance * 2) {
    recommendations.push(`High height variance (stdDev ${stdDev.toFixed(4)}mm) — calibrate Z steps`);
  }
  if (consistencyScore > 90) {
    recommendations.push('Consistent layer heights — good print quality');
  }

  return {
    layers, layerCount: layers.length, nominalHeight,
    avgHeight, stdDev, consistencyScore, recommendations,
  };
}

// ── 12. G-code Modal State Transition Analyzer ──

export interface ModalTransition {
  /** Line number */
  line: number;
  /** Modal group */
  group: string;
  /** From state */
  from: string;
  /** To state */
  to: string;
}

export interface ModalStateResult {
  /** Modal transitions */
  transitions: ModalTransition[];
  /** Transition count */
  count: number;
  /** Transitions per group */
  transitionsPerGroup: { [group: string]: number };
  /** Most changed group */
  mostChangedGroup: string;
  /** State stability score (0-100) */
  stabilityScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze modal state transitions.
 * Frequent modal changes can indicate inefficient or error-prone code.
 *
 * @param lines G-code lines
 */
export function analyzeModalStateTransitions(lines: string[]): ModalStateResult {
  const transitions: ModalTransition[] = [];
  const transitionsPerGroup: { [group: string]: number } = {};

  // Track modal states
  const modalStates: { [group: string]: string } = {
    motion: 'G0',
    distance: 'G90',
    units: 'G21',
    feedrate: 'G94',
    plane: 'G17',
    wcs: 'G54',
    compensation: 'G40',
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Check motion group (G0, G1, G2, G3)
    const motionMatch = code.match(/\bG([0-3])\b/i);
    if (motionMatch) {
      const newState = `G${motionMatch[1]}`;
      if (modalStates.motion !== newState) {
        transitions.push({ line: i, group: 'motion', from: modalStates.motion, to: newState });
        transitionsPerGroup.motion = (transitionsPerGroup.motion ?? 0) + 1;
        modalStates.motion = newState;
      }
    }

    // Check distance mode (G90/G91)
    const distMatch = code.match(/\bG(9[01])\b/i);
    if (distMatch) {
      const newState = `G${distMatch[1]}`;
      if (modalStates.distance !== newState) {
        transitions.push({ line: i, group: 'distance', from: modalStates.distance, to: newState });
        transitionsPerGroup.distance = (transitionsPerGroup.distance ?? 0) + 1;
        modalStates.distance = newState;
      }
    }

    // Check units (G20/G21)
    const unitsMatch = code.match(/\bG(2[01])\b/i);
    if (unitsMatch) {
      const newState = `G${unitsMatch[1]}`;
      if (modalStates.units !== newState) {
        transitions.push({ line: i, group: 'units', from: modalStates.units, to: newState });
        transitionsPerGroup.units = (transitionsPerGroup.units ?? 0) + 1;
        modalStates.units = newState;
      }
    }

    // Check plane (G17/G18/G19)
    const planeMatch = code.match(/\bG(1[789])\b/i);
    if (planeMatch) {
      const newState = `G${planeMatch[1]}`;
      if (modalStates.plane !== newState) {
        transitions.push({ line: i, group: 'plane', from: modalStates.plane, to: newState });
        transitionsPerGroup.plane = (transitionsPerGroup.plane ?? 0) + 1;
        modalStates.plane = newState;
      }
    }

    // Check WCS (G54-G59)
    const wcsMatch = code.match(/\bG(5[4-9])\b/i);
    if (wcsMatch) {
      const newState = `G${wcsMatch[1]}`;
      if (modalStates.wcs !== newState) {
        transitions.push({ line: i, group: 'wcs', from: modalStates.wcs, to: newState });
        transitionsPerGroup.wcs = (transitionsPerGroup.wcs ?? 0) + 1;
        modalStates.wcs = newState;
      }
    }

    // Check compensation (G40/G41/G42)
    const compMatch = code.match(/\bG(4[012])\b/i);
    if (compMatch) {
      const newState = `G${compMatch[1]}`;
      if (modalStates.compensation !== newState) {
        transitions.push({ line: i, group: 'compensation', from: modalStates.compensation, to: newState });
        transitionsPerGroup.compensation = (transitionsPerGroup.compensation ?? 0) + 1;
        modalStates.compensation = newState;
      }
    }
  }

  if (transitions.length === 0) {
    return {
      transitions: [], count: 0, transitionsPerGroup: {},
      mostChangedGroup: 'none', stabilityScore: 100,
      recommendations: ['No modal state transitions detected'],
    };
  }

  const count = transitions.length;
  let mostChangedGroup = 'none';
  let maxCount = 0;
  for (const [group, cnt] of Object.entries(transitionsPerGroup)) {
    if (cnt > maxCount) {
      maxCount = cnt;
      mostChangedGroup = group;
    }
  }

  const stabilityScore = Math.max(0, 100 - count * 2);

  const recommendations: string[] = [];
  recommendations.push(`${count} modal transitions across ${Object.keys(transitionsPerGroup).length} groups`);
  recommendations.push(`Most changed: ${mostChangedGroup} (${maxCount} transitions)`);
  if (count > 50) {
    recommendations.push(`${count} modal transitions — frequent state changes, verify correctness`);
  }
  if (transitionsPerGroup.units > 0) {
    recommendations.push('Unit mode changes detected — verify all coordinates use correct units');
  }
  if (transitionsPerGroup.distance > 5) {
    recommendations.push(`${transitionsPerGroup.distance} distance mode changes — error-prone, minimize`);
  }
  if (stabilityScore > 85) {
    recommendations.push('Stable modal states — minimal transitions');
  }

  return {
    transitions, count, transitionsPerGroup,
    mostChangedGroup, stabilityScore, recommendations,
  };
}
