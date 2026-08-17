/**
 * @file GcodeAdvanced22.ts
 * @brief Twenty-second batch of advanced G-code analysis features for CNC and 3D printing.
 *
 * This module provides 12 additional high-impact features:
 *  1. G-code toolpath acceleration profile analyzer (Universal) — accel/decel profile
 *  2. CNC tool cutting force spectrum analyzer (CNC) — FFT of cutting forces
 *  3. Print filament pressure advance optimizer (3DP) — optimize PA settings
 *  4. G-code coordinate system origin mapper (Universal) — map origin offsets
 *  5. CNC tool path loop detector (CNC) — detect repeated loops
 *  6. Print extrusion width per layer analyzer (3DP) — per-layer width
 *  7. CNC spindle warmup time optimizer (CNC) — optimize warmup duration
 *  8. Print support structure optimizer (3DP) — optimize support settings
 *  9. G-code file size optimizer (Universal) — reduce file size
 * 10. CNC tool path curvature heatmap generator (CNC) — curvature heatmap
 * 11. Print layer adhesion strength predictor (3DP) — predict adhesion strength
 * 12. G-code toolpath cornering speed calculator (Universal) — cornering speed
 */

// ── 1. G-code Toolpath Acceleration Profile Analyzer ──

export interface AccelerationPoint {
  /** Line number */
  line: number;
  /** Acceleration in mm/s² */
  acceleration: number;
  /** Type */
  type: 'acceleration' | 'deceleration' | 'steady' | 'jerk';
  /** Magnitude category */
  magnitude: 'low' | 'medium' | 'high' | 'extreme';
}

export interface AccelerationProfileResult {
  /** Acceleration data points */
  points: AccelerationPoint[];
  /** Average acceleration */
  avgAcceleration: number;
  /** Max acceleration */
  maxAcceleration: number;
  /** Acceleration count */
  accelerationCount: number;
  /** Deceleration count */
  decelerationCount: number;
  /** Jerk count (sudden changes) */
  jerkCount: number;
  /** Acceleration smoothness score (0-100) */
  smoothnessScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze acceleration profile of the toolpath.
 * Detects acceleration, deceleration, and jerk events.
 *
 * @param lines G-code lines
 * @param maxAccel Machine max acceleration in mm/s² (default 1000)
 */
export function analyzeAccelerationProfile(
  lines: string[],
  maxAccel: number = 1000,
): AccelerationProfileResult {
  const points: AccelerationPoint[] = [];
  let prevSpeed = 0;
  let prevX = 0, prevY = 0;
  let feedRate = 0;
  let prevTime = 0;
  let totalAcceleration = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG[01]\b/i.test(code)) continue;

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) feedRate = parseFloat(fMatch[1]);

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;

    const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
    if (dist > 0 && feedRate > 0) {
      const currentSpeed = feedRate / 60; // mm/s
      const time = dist / currentSpeed;
      const speedDelta = currentSpeed - prevSpeed;
      const acceleration = time > 0 ? speedDelta / time : 0;

      let type: AccelerationPoint['type'];
      if (Math.abs(acceleration) > maxAccel * 0.8) type = 'jerk';
      else if (acceleration > 10) type = 'acceleration';
      else if (acceleration < -10) type = 'deceleration';
      else type = 'steady';

      const magnitude: AccelerationPoint['magnitude'] =
        Math.abs(acceleration) < 100 ? 'low'
        : Math.abs(acceleration) < 500 ? 'medium'
        : Math.abs(acceleration) < maxAccel ? 'high' : 'extreme';

      points.push({ line: i, acceleration, type, magnitude });
      totalAcceleration += Math.abs(acceleration);
      prevSpeed = currentSpeed;
      prevTime += time;
    }

    prevX = x; prevY = y;
  }

  const avgAcceleration = points.length > 0 ? totalAcceleration / points.length : 0;
  const maxAcceleration = points.length > 0 ? Math.max(...points.map(p => Math.abs(p.acceleration))) : 0;
  const accelerationCount = points.filter(p => p.type === 'acceleration').length;
  const decelerationCount = points.filter(p => p.type === 'deceleration').length;
  const jerkCount = points.filter(p => p.type === 'jerk').length;

  const smoothnessScore = Math.max(0, 100 - (jerkCount * 5 + (maxAcceleration / maxAccel) * 30));

  const recommendations: string[] = [];
  recommendations.push(`${points.length} accel points, avg ${avgAcceleration.toFixed(0)}mm/s², max ${maxAcceleration.toFixed(0)}mm/s²`);
  if (jerkCount > 10) {
    recommendations.push(`${jerkCount} jerk events — reduce acceleration for smoother motion`);
  }
  if (maxAcceleration > maxAccel * 0.9) {
    recommendations.push(`Max accel ${maxAcceleration.toFixed(0)} near machine limit (${maxAccel})`);
  }
  if (smoothnessScore > 80) {
    recommendations.push('Smooth acceleration profile — good motion control');
  }

  return {
    points, avgAcceleration, maxAcceleration,
    accelerationCount, decelerationCount, jerkCount,
    smoothnessScore, recommendations,
  };
}

// ── 2. CNC Tool Cutting Force Spectrum Analyzer ──

export interface ForceSpectrumPoint {
  /** Frequency in Hz */
  frequency: number;
  /** Amplitude in N */
  amplitude: number;
  /** Is resonance frequency */
  isResonance: boolean;
}

export interface ForceSpectrumResult {
  /** Spectrum data points */
  spectrum: ForceSpectrumPoint[];
  /** Dominant frequency in Hz */
  dominantFrequency: number;
  /** Peak force in N */
  peakForce: number;
  /** Average force in N */
  avgForce: number;
  /** Resonance risk (0-100) */
  resonanceRisk: number;
  /** Spectrum complexity score (0-100) */
  complexityScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze cutting force spectrum.
 * Performs simplified frequency analysis of cutting forces.
 *
 * @param lines G-code lines
 * @param flutes Number of flutes (default 2)
 */
export function analyzeCuttingForceSpectrum(
  lines: string[],
  flutes: number = 2,
): ForceSpectrumResult {
  const forces: number[] = [];
  let prevX = 0, prevY = 0, prevZ = 0;
  let feedRate = 0;
  let rpm = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const sMatch = code.match(/\bS(\d*\.?\d+)/i);
    if (sMatch) rpm = parseFloat(sMatch[1]);

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) feedRate = parseFloat(fMatch[1]);

    if (!/\bG1\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const z = zMatch ? parseFloat(zMatch[1]) : prevZ;

    if (z < 0 && feedRate > 0) {
      const depth = Math.abs(z);
      const chipLoad = feedRate / (rpm * flutes);
      // Simplified cutting force: Kc * chipLoad * depth
      const Kc = 800; // N/mm² for aluminum
      const force = Kc * chipLoad * depth;
      forces.push(force);
    }

    prevX = x; prevY = y; prevZ = z;
  }

  if (forces.length < 10) {
    return {
      spectrum: [], dominantFrequency: 0, peakForce: 0,
      avgForce: forces.length > 0 ? forces[0] : 0,
      resonanceRisk: 0, complexityScore: 0,
      recommendations: ['Insufficient data for force spectrum analysis'],
    };
  }

  const avgForce = forces.reduce((a, b) => a + b, 0) / forces.length;
  const peakForce = Math.max(...forces);

  // Simplified spectrum: sample forces and detect periodic patterns
  const sampleSize = Math.min(64, forces.length);
  const sampled = forces.filter((_, i) => i % Math.floor(forces.length / sampleSize) === 0).slice(0, sampleSize);

  const spectrum: ForceSpectrumPoint[] = [];
  for (let freq = 1; freq <= 20; freq++) {
    let amplitude = 0;
    for (let i = 0; i < sampled.length; i++) {
      amplitude += sampled[i] * Math.cos(2 * Math.PI * freq * i / sampled.length);
    }
    amplitude = Math.abs(amplitude / sampled.length);
    const isResonance = amplitude > avgForce * 0.3;
    spectrum.push({ frequency: freq, amplitude, isResonance });
  }

  spectrum.sort((a, b) => b.amplitude - a.amplitude);
  const dominantFrequency = spectrum[0].frequency;
  const resonanceCount = spectrum.filter(s => s.isResonance).length;
  const resonanceRisk = Math.min(100, resonanceCount * 20);
  const complexityScore = Math.min(100, spectrum.filter(s => s.amplitude > avgForce * 0.1).length * 10);

  const recommendations: string[] = [];
  recommendations.push(`Peak force: ${peakForce.toFixed(0)}N, avg: ${avgForce.toFixed(0)}N`);
  if (resonanceRisk > 50) {
    recommendations.push(`High resonance risk — ${resonanceCount} resonance frequencies detected`);
  }
  recommendations.push(`Dominant frequency: ${dominantFrequency}Hz`);
  if (peakForce > 500) {
    recommendations.push(`High cutting force (${peakForce.toFixed(0)}N) — reduce depth or feed`);
  }
  if (resonanceRisk < 30) {
    recommendations.push('Low resonance risk — stable cutting conditions');
  }

  return {
    spectrum: spectrum.slice(0, 10), dominantFrequency, peakForce,
    avgForce, resonanceRisk, complexityScore, recommendations,
  };
}

// ── 3. Print Filament Pressure Advance Optimizer ──

export interface PAOptimizationResult {
  /** Current PA value */
  currentPA: number;
  /** Recommended PA value */
  recommendedPA: number;
  /** Extruder type */
  extruderType: 'direct' | 'bowden' | 'unknown';
  /** Filament type */
  filamentType: string;
  /** Pressure consistency score (0-100) */
  consistencyScore: number;
  /** Ooze risk (0-100) */
  oozeRisk: number;
  /** Under-extrusion risk (0-100) */
  underExtrusionRisk: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Optimize pressure advance settings.
 * Recommends PA based on extruder type, filament, and retraction patterns.
 *
 * @param lines G-code lines
 * @param filamentType Filament type (default 'PLA')
 * @param extruderType Extruder type (default 'unknown')
 */
export function optimizePressureAdvance(
  lines: string[],
  filamentType: string = 'PLA',
  extruderType: 'direct' | 'bowden' | 'unknown' = 'unknown',
): PAOptimizationResult {
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

  let detectedType = extruderType;
  if (extruderType === 'unknown') {
    if (avgRetractionDist > 3) detectedType = 'bowden';
    else if (avgRetractionDist > 0) detectedType = 'direct';
  }

  // Recommended PA by extruder type and filament
  const paRanges: { [filament: string]: { direct: number; bowden: number } } = {
    PLA: { direct: 0.04, bowden: 0.6 },
    ABS: { direct: 0.05, bowden: 0.7 },
    PETG: { direct: 0.06, bowden: 0.8 },
    TPU: { direct: 0.02, bowden: 0.3 },
    Nylon: { direct: 0.05, bowden: 0.7 },
  };

  const paRange = paRanges[filamentType] ?? paRanges.PLA;
  const recommendedPA = detectedType === 'bowden' ? paRange.bowden : paRange.direct;

  // Estimate current PA from comments or settings
  let currentPA = recommendedPA;
  for (const line of lines) {
    if (/pressure.?advance/i.test(line)) {
      const match = line.match(/(\d+\.?\d*)/);
      if (match) {
        currentPA = parseFloat(match[1]);
        break;
      }
    }
  }

  const paDelta = Math.abs(currentPA - recommendedPA);
  const consistencyScore = Math.max(0, 100 - paDelta * 50);
  const oozeRisk = currentPA < recommendedPA ? Math.min(100, (recommendedPA - currentPA) * 100) : 0;
  const underExtrusionRisk = currentPA > recommendedPA ? Math.min(100, (currentPA - recommendedPA) * 100) : 0;

  const recommendations: string[] = [];
  recommendations.push(`${detectedType} extruder, ${filamentType}: current PA ${currentPA.toFixed(3)}, recommended ${recommendedPA.toFixed(3)}`);
  if (oozeRisk > 30) {
    recommendations.push(`High ooze risk (${oozeRisk.toFixed(0)}%) — increase PA`);
  }
  if (underExtrusionRisk > 30) {
    recommendations.push(`High under-extrusion risk (${underExtrusionRisk.toFixed(0)}%) — decrease PA`);
  }
  if (retractionCount === 0) {
    recommendations.push('No retractions detected — PA may not be needed');
  }
  if (consistencyScore > 80) {
    recommendations.push('PA is well-tuned — good pressure control');
  }

  return {
    currentPA, recommendedPA, extruderType: detectedType,
    filamentType, consistencyScore, oozeRisk,
    underExtrusionRisk, recommendations,
  };
}

// ── 4. G-code Coordinate System Origin Mapper ──

export interface OriginOffset {
  /** Work coordinate system */
  wcs: string;
  /** Line number */
  line: number;
  /** Origin offset */
  offset: { x: number; y: number; z: number };
  /** Source */
  source: 'G54' | 'G55' | 'G56' | 'G57' | 'G58' | 'G59' | 'G92';
}

export interface OriginMapperResult {
  /** All origin offsets */
  origins: OriginOffset[];
  /** Unique WCS count */
  wcsCount: number;
  /** WCS list */
  wcsList: string[];
  /** Total offset range */
  offsetRange: { minX: number; maxX: number; minY: number; maxY: number };
  /** Origin complexity score (0-100) */
  complexityScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Map all coordinate system origins.
 * Identifies G54-G59 and G92 origin offset commands.
 *
 * @param lines G-code lines
 */
export function mapCoordinateOrigins(lines: string[]): OriginMapperResult {
  const origins: OriginOffset[] = [];
  const wcsSet = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Detect WCS selection and offsets
    const wcsMatch = code.match(/\b(G5[4-9])\b/i);
    const g92Match = code.match(/\bG92\b/i);

    if (wcsMatch || g92Match) {
      const wcs = wcsMatch ? wcsMatch[1].toUpperCase() : 'G92';
      const source = wcs as OriginOffset['source'];

      const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
      const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);

      origins.push({
        wcs, line: i, source,
        offset: {
          x: xMatch ? parseFloat(xMatch[1]) : 0,
          y: yMatch ? parseFloat(yMatch[1]) : 0,
          z: zMatch ? parseFloat(zMatch[1]) : 0,
        },
      });
      wcsSet.add(wcs);
    }
  }

  const wcsList = Array.from(wcsSet);
  const wcsCount = wcsList.length;

  const offsets = origins.map(o => o.offset);
  const offsetRange = offsets.length > 0 ? {
    minX: Math.min(...offsets.map(o => o.x)),
    maxX: Math.max(...offsets.map(o => o.x)),
    minY: Math.min(...offsets.map(o => o.y)),
    maxY: Math.max(...offsets.map(o => o.y)),
  } : { minX: 0, maxX: 0, minY: 0, maxY: 0 };

  const complexityScore = Math.min(100, wcsCount * 15 + origins.length * 5);

  const recommendations: string[] = [];
  recommendations.push(`${wcsCount} WCS used: ${wcsList.join(', ') || 'none'}`);
  if (origins.length > 0) {
    recommendations.push(`${origins.length} origin offsets, X range: ${offsetRange.minX.toFixed(1)} to ${offsetRange.maxX.toFixed(1)}`);
  }
  if (wcsCount > 3) {
    recommendations.push(`${wcsCount} coordinate systems — verify setup complexity`);
  }
  if (origins.length === 0) {
    recommendations.push('No coordinate system offsets — using machine default');
  }
  if (complexityScore > 60) {
    recommendations.push('Complex origin setup — document WCS assignments');
  }

  return {
    origins, wcsCount, wcsList, offsetRange,
    complexityScore, recommendations,
  };
}

// ── 5. CNC Tool Path Loop Detector ──

export interface LoopInfo {
  /** Start line */
  startLine: number;
  /** End line */
  endLine: number;
  /** Loop count */
  iterations: number;
  /** Loop distance in mm */
  loopDistance: number;
  /** Loop type */
  type: 'pattern' | 'spiral' | 'rectangular' | 'circular';
}

export interface LoopDetectionResult {
  /** Detected loops */
  loops: LoopInfo[];
  /** Loop count */
  loopCount: number;
  /** Total looped distance in mm */
  totalLoopDistance: number;
  /** Max iterations */
  maxIterations: number;
  /** Loop efficiency score (0-100) */
  efficiencyScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Detect repeated loops in toolpath.
 * Identifies patterns where the toolpath repeats the same region.
 *
 * @param lines G-code lines
 * @param tolerance Position tolerance in mm (default 0.1)
 */
export function detectToolpathLoops(
  lines: string[],
  tolerance: number = 0.1,
): LoopDetectionResult {
  const positions: { line: number; x: number; y: number }[] = [];
  let prevX = 0, prevY = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG1\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;

    positions.push({ line: i, x, y });
    prevX = x; prevY = y;
  }

  const loops: LoopInfo[] = [];

  // Detect loops by looking for repeated positions
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 10; j < positions.length; j++) {
      const dx = positions[j].x - positions[i].x;
      const dy = positions[j].y - positions[i].y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < tolerance) {
        // Found a potential loop — count iterations
        const loopLength = j - i;
        let iterations = 1;
        let lastEnd = j;

        for (let k = j + loopLength; k < positions.length; k += loopLength) {
          const idx = i + (k - j);
          if (idx >= positions.length) break;
          const dx2 = positions[k].x - positions[i].x;
          const dy2 = positions[k].y - positions[i].y;
          if (Math.sqrt(dx2 * dx2 + dy2 * dy2) < tolerance) {
            iterations++;
            lastEnd = k;
          } else {
            break;
          }
        }

        if (iterations > 1) {
          // Calculate loop distance
          let loopDist = 0;
          for (let k = i; k < j - 1; k++) {
            const ddx = positions[k + 1].x - positions[k].x;
            const ddy = positions[k + 1].y - positions[k].y;
            loopDist += Math.sqrt(ddx * ddx + ddy * ddy);
          }

          // Classify loop type
          let type: LoopInfo['type'] = 'pattern';
          if (loopDist > 0) {
            const xRange = Math.max(...positions.slice(i, j).map(p => p.x)) - Math.min(...positions.slice(i, j).map(p => p.x));
            const yRange = Math.max(...positions.slice(i, j).map(p => p.y)) - Math.min(...positions.slice(i, j).map(p => p.y));
            if (Math.abs(xRange - yRange) < 5) type = 'circular';
            else if (xRange > 0 && yRange > 0) type = 'rectangular';
            else type = 'spiral';
          }

          loops.push({
            startLine: positions[i].line,
            endLine: positions[lastEnd].line,
            iterations,
            loopDistance: loopDist,
            type,
          });
          i = lastEnd; // Skip ahead
          break;
        }
      }
    }
  }

  const loopCount = loops.length;
  const totalLoopDistance = loops.reduce((s, l) => s + l.loopDistance * l.iterations, 0);
  const maxIterations = loops.length > 0 ? Math.max(...loops.map(l => l.iterations)) : 0;
  const efficiencyScore = Math.max(0, 100 - loopCount * 10);

  const recommendations: string[] = [];
  if (loopCount > 0) {
    recommendations.push(`${loopCount} loops detected, max ${maxIterations} iterations`);
  }
  for (const loop of loops.slice(0, 3)) {
    recommendations.push(`Lines ${loop.startLine}-${loop.endLine}: ${loop.type}, ${loop.iterations}× iterations`);
  }
  if (totalLoopDistance > 1000) {
    recommendations.push(`Total loop distance: ${totalLoopDistance.toFixed(0)}mm — consider subprograms`);
  }
  if (loopCount === 0) {
    recommendations.push('No loops detected — toolpath is unique');
  }

  return {
    loops, loopCount, totalLoopDistance, maxIterations,
    efficiencyScore, recommendations,
  };
}

// ── 6. Print Extrusion Width Per Layer Analyzer ──

export interface LayerExtrusionWidth {
  /** Layer number */
  layer: number;
  /** Z height */
  zHeight: number;
  /** Average extrusion width in mm */
  avgWidth: number;
  /** Min width */
  minWidth: number;
  /** Max width */
  maxWidth: number;
  /** Width variance */
  variance: number;
  /** Consistency score (0-100) */
  consistencyScore: number;
}

export interface ExtrusionWidthPerLayerResult {
  /** Per-layer width data */
  layers: LayerExtrusionWidth[];
  /** Layer count */
  layerCount: number;
  /** Overall avg width */
  overallAvgWidth: number;
  /** Overall consistency */
  overallConsistency: number;
  /** Layers with inconsistent width */
  inconsistentLayerCount: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze extrusion width per layer.
 * Detects layers with inconsistent extrusion width.
 *
 * @param lines G-code lines
 * @param nozzleDiameter Nozzle diameter in mm (default 0.4)
 */
export function analyzeExtrusionWidthPerLayer(
  lines: string[],
  nozzleDiameter: number = 0.4,
): ExtrusionWidthPerLayerResult {
  const layers: LayerExtrusionWidth[] = [];
  let prevX = 0, prevY = 0, prevE = 0;
  let currentZ = 0;
  let firstZ = 0;
  let layerNum = 0;
  const layerWidths: number[] = [];

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
        // Layer change — save widths
        if (layerWidths.length > 0) {
          const avgWidth = layerWidths.reduce((a, b) => a + b, 0) / layerWidths.length;
          const minWidth = Math.min(...layerWidths);
          const maxWidth = Math.max(...layerWidths);
          const variance = layerWidths.reduce((s, w) => s + (w - avgWidth) ** 2, 0) / layerWidths.length;
          const consistencyScore = Math.max(0, 100 - Math.sqrt(variance) / nozzleDiameter * 100);
          layers.push({
            layer: layerNum, zHeight: currentZ,
            avgWidth, minWidth, maxWidth, variance, consistencyScore,
          });
        }
        layerNum++;
        currentZ = z;
        layerWidths.length = 0;
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

      if (e > prevE) {
        const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
        if (dist > 0) {
          // Estimate width from extrusion amount and distance
          const eDelta = e - prevE;
          const width = (eDelta / dist) * nozzleDiameter * 2;
          layerWidths.push(width);
        }
      }

      prevX = x; prevY = y; prevE = e;
    }
  }

  // Save last layer
  if (layerWidths.length > 0) {
    const avgWidth = layerWidths.reduce((a, b) => a + b, 0) / layerWidths.length;
    const minWidth = Math.min(...layerWidths);
    const maxWidth = Math.max(...layerWidths);
    const variance = layerWidths.reduce((s, w) => s + (w - avgWidth) ** 2, 0) / layerWidths.length;
    const consistencyScore = Math.max(0, 100 - Math.sqrt(variance) / nozzleDiameter * 100);
    layers.push({
      layer: layerNum, zHeight: currentZ,
      avgWidth, minWidth, maxWidth, variance, consistencyScore,
    });
  }

  const layerCount = layers.length;
  const overallAvgWidth = layerCount > 0 ? layers.reduce((s, l) => s + l.avgWidth, 0) / layerCount : 0;
  const overallConsistency = layerCount > 0 ? layers.reduce((s, l) => s + l.consistencyScore, 0) / layerCount : 100;
  const inconsistentLayerCount = layers.filter(l => l.consistencyScore < 70).length;

  const recommendations: string[] = [];
  recommendations.push(`${layerCount} layers, avg width ${overallAvgWidth.toFixed(3)}mm (nozzle ${nozzleDiameter}mm)`);
  if (inconsistentLayerCount > 0) {
    recommendations.push(`${inconsistentLayerCount} layers with inconsistent width — check flow rate`);
  }
  if (overallConsistency < 70) {
    recommendations.push(`Low overall consistency (${overallConsistency.toFixed(0)}%) — calibrate extrusion`);
  }
  if (overallConsistency > 85) {
    recommendations.push('Consistent extrusion width — good print quality expected');
  }

  return {
    layers, layerCount, overallAvgWidth, overallConsistency,
    inconsistentLayerCount, recommendations,
  };
}

// ── 7. CNC Spindle Warmup Time Optimizer ──

export interface WarmupOptimizationResult {
  /** Current warmup time in seconds */
  currentWarmupTime: number;
  /** Recommended warmup time in seconds */
  recommendedWarmupTime: number;
  /** Spindle RPM during warmup */
  warmupRPM: number;
  /** Target RPM */
  targetRPM: number;
  /** Thermal stability score (0-100) */
  thermalStabilityScore: number;
  /** Bearing wear risk (0-100) */
  bearingWearRisk: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Optimize spindle warmup time.
 * Recommends warmup duration based on spindle speed and temperature.
 *
 * @param lines G-code lines
 * @param spindleType Spindle type (default 'standard')
 */
export function optimizeSpindleWarmup(
  lines: string[],
  spindleType: string = 'standard',
): WarmupOptimizationResult {
  let warmupStartTime = -1;
  let warmupEndTime = -1;
  let warmupRPM = 0;
  let targetRPM = 0;
  let firstCutTime = -1;
  let currentTime = 0;
  let rpm = 0;
  let feedRate = 0;
  let prevX = 0, prevY = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const sMatch = code.match(/\bS(\d*\.?\d+)/i);
    if (sMatch) {
      rpm = parseFloat(sMatch[1]);
      if (warmupStartTime < 0 && rpm > 0) {
        warmupStartTime = currentTime;
        warmupRPM = rpm;
      }
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
        currentTime += dist / (feedRate / 60);
      }

      // Detect first cutting move
      if (firstCutTime < 0 && rpm > 0) {
        firstCutTime = currentTime;
        targetRPM = rpm;
        if (warmupEndTime < 0) warmupEndTime = currentTime;
      }
      prevX = x; prevY = y;
    }
  }

  const currentWarmupTime = warmupStartTime >= 0 && warmupEndTime >= 0
    ? warmupEndTime - warmupStartTime : 0;

  // Recommended warmup based on RPM and spindle type
  const warmupRatios: { [type: string]: number } = {
    standard: 0.01, // 0.01s per RPM
    high_speed: 0.015,
    heavy_duty: 0.02,
    ceramic: 0.005,
  };
  const ratio = warmupRatios[spindleType] ?? warmupRatios.standard;
  const recommendedWarmupTime = Math.round(targetRPM * ratio);

  const thermalStabilityScore = Math.min(100, (currentWarmupTime / recommendedWarmupTime) * 100);
  const bearingWearRisk = currentWarmupTime < recommendedWarmupTime * 0.5
    ? Math.min(100, (recommendedWarmupTime - currentWarmupTime) * 2) : 0;

  const recommendations: string[] = [];
  recommendations.push(`Current warmup: ${currentWarmupTime.toFixed(0)}s, recommended: ${recommendedWarmupTime}s`);
  if (currentWarmupTime < recommendedWarmupTime * 0.5) {
    recommendations.push(`Insufficient warmup — increase to ${recommendedWarmupTime}s for thermal stability`);
  }
  if (bearingWearRisk > 50) {
    recommendations.push(`High bearing wear risk (${bearingWearRisk.toFixed(0)}%) — warm up spindle before cutting`);
  }
  if (targetRPM > 10000) {
    recommendations.push(`High RPM (${targetRPM}) — extended warmup recommended`);
  }
  if (thermalStabilityScore > 80) {
    recommendations.push('Good warmup — spindle thermally stable');
  }

  return {
    currentWarmupTime, recommendedWarmupTime, warmupRPM,
    targetRPM, thermalStabilityScore, bearingWearRisk,
    recommendations,
  };
}

// ── 8. Print Support Structure Optimizer ──

export interface SupportOptimizationResult {
  /** Support volume estimate in mm³ */
  supportVolume: number;
  /** Support area in mm² */
  supportArea: number;
  /** Recommended support density percentage */
  recommendedDensity: number;
  /** Recommended pattern */
  recommendedPattern: string;
  /** Support removal difficulty (0-100) */
  removalDifficulty: number;
  /** Material waste percentage */
  materialWastePercentage: number;
  /** Optimization score (0-100) */
  optimizationScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Optimize support structure settings.
 * Recommends density, pattern, and estimates waste.
 *
 * @param lines G-code lines
 * @param totalMaterialMm Total filament used in mm
 */
export function optimizeSupportStructure(
  lines: string[],
  totalMaterialMm: number = 0,
): SupportOptimizationResult {
  let supportMaterialMm = 0;
  let supportArea = 0;
  let prevE = 0;
  let prevX = 0, prevY = 0;
  let isSupport = false;
  let supportSegments = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check for support comments
    if (/;.*support/i.test(trimmed) || /\(.*support/i.test(trimmed)) {
      isSupport = /;.*support/i.test(trimmed);
    }

    if (trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG1\b/i.test(code)) continue;

    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);
    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;

    if (eMatch) {
      const e = parseFloat(eMatch[1]);
      if (e > prevE && isSupport) {
        const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
        if (dist > 0) {
          supportMaterialMm += e - prevE;
          supportArea += dist * 0.4; // approximate width
          supportSegments++;
        }
      }
      prevE = e;
    }

    prevX = x; prevY = y;
  }

  const supportVolume = supportMaterialMm * Math.PI * (1.75 / 2) ** 2;
  const materialWastePercentage = totalMaterialMm > 0 ? (supportMaterialMm / totalMaterialMm) * 100 : 0;

  // Recommend density based on support volume
  const recommendedDensity = supportVolume > 1000 ? 25 : supportVolume > 100 ? 15 : 10;
  const recommendedPattern = supportArea > 500 ? 'tree' : 'linear';

  const removalDifficulty = Math.min(100, supportArea / 10);
  const optimizationScore = Math.max(0, 100 - materialWastePercentage - removalDifficulty * 0.3);

  const recommendations: string[] = [];
  if (supportMaterialMm > 0) {
    recommendations.push(`Support material: ${supportMaterialMm.toFixed(0)}mm (${materialWastePercentage.toFixed(1)}% of total)`);
  }
  recommendations.push(`Recommended density: ${recommendedDensity}%, pattern: ${recommendedPattern}`);
  if (removalDifficulty > 60) {
    recommendations.push(`High removal difficulty (${removalDifficulty.toFixed(0)}%) — use tree supports`);
  }
  if (materialWastePercentage > 30) {
    recommendations.push(`High material waste (${materialWastePercentage.toFixed(0)}%) — reduce support area`);
  }
  if (supportMaterialMm === 0) {
    recommendations.push('No supports detected — may need supports for overhangs');
  }
  if (optimizationScore > 70) {
    recommendations.push('Well-optimized supports — minimal waste');
  }

  return {
    supportVolume, supportArea, recommendedDensity,
    recommendedPattern, removalDifficulty,
    materialWastePercentage, optimizationScore,
    recommendations,
  };
}

// ── 9. G-code File Size Optimizer ──

export interface FileSizeOptimizationResult {
  /** Current file size in bytes */
  currentSize: number;
  /** Estimated optimized size in bytes */
  optimizedSize: number;
  /** Size reduction percentage */
  reductionPercentage: number;
  /** Optimization opportunities */
  opportunities: { type: string; count: number; savingsBytes: number }[];
  /** Redundant comment count */
  redundantComments: number;
  /** Redundant whitespace bytes */
  whitespaceBytes: number;
  /** Optimization score (0-100) */
  optimizationScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze and optimize G-code file size.
 * Identifies redundant comments, whitespace, and commands.
 *
 * @param lines G-code lines
 */
export function optimizeFileSize(lines: string[]): FileSizeOptimizationResult {
  let currentSize = 0;
  let optimizedSize = 0;
  let redundantComments = 0;
  let whitespaceBytes = 0;
  let repeatedFeedCount = 0;
  let repeatedModalCount = 0;
  let emptyLineCount = 0;
  let prevFeed = 0;
  let prevModal = '';

  for (const line of lines) {
    currentSize += line.length + 1; // +1 for newline

    const trimmed = line.trim();

    // Empty lines
    if (!trimmed) {
      emptyLineCount++;
      continue;
    }

    // Comments
    if (trimmed.startsWith(';') || trimmed.startsWith('(')) {
      // Check if comment is useful (not just a separator)
      if (/^;+\s*$/.test(trimmed) || /^\(.*\)$/.test(trimmed) && trimmed.length < 5) {
        redundantComments++;
      } else {
        optimizedSize += line.length + 1;
      }
      continue;
    }

    // Whitespace
    const wsMatch = line.match(/^\s+/);
    if (wsMatch) {
      whitespaceBytes += wsMatch[0].length;
    }
    const trailingWs = line.match(/\s+$/);
    if (trailingWs) {
      whitespaceBytes += trailingWs[0].length;
    }

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Repeated feed rate
    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) {
      const feed = parseFloat(fMatch[1]);
      if (feed === prevFeed && prevFeed > 0) {
        repeatedFeedCount++;
        optimizedSize += code.replace(/\bF\d*\.?\d+/i, '').length + 1;
      } else {
        optimizedSize += code.length + 1;
      }
      prevFeed = feed;
    } else {
      optimizedSize += code.length + 1;
    }

    // Repeated modal
    if (/\bG[01]\b/i.test(code)) {
      const modal = /\bG0\b/i.test(code) ? 'G0' : 'G1';
      if (modal === prevModal && prevModal) {
        repeatedModalCount++;
      }
      prevModal = modal;
    }
  }

  const opportunities: { type: string; count: number; savingsBytes: number }[] = [];
  if (redundantComments > 0) opportunities.push({ type: 'redundant_comments', count: redundantComments, savingsBytes: redundantComments * 20 });
  if (whitespaceBytes > 0) opportunities.push({ type: 'whitespace', count: 1, savingsBytes: whitespaceBytes });
  if (repeatedFeedCount > 0) opportunities.push({ type: 'repeated_feed', count: repeatedFeedCount, savingsBytes: repeatedFeedCount * 8 });
  if (repeatedModalCount > 0) opportunities.push({ type: 'repeated_modal', count: repeatedModalCount, savingsBytes: repeatedModalCount * 3 });
  if (emptyLineCount > 0) opportunities.push({ type: 'empty_lines', count: emptyLineCount, savingsBytes: emptyLineCount });

  const totalSavings = opportunities.reduce((s, o) => s + o.savingsBytes, 0);
  optimizedSize = Math.max(0, currentSize - totalSavings);
  const reductionPercentage = currentSize > 0 ? (totalSavings / currentSize) * 100 : 0;
  const optimizationScore = Math.min(100, reductionPercentage * 2);

  const recommendations: string[] = [];
  recommendations.push(`Current: ${currentSize} bytes, optimized: ${optimizedSize} bytes (${reductionPercentage.toFixed(1)}% reduction)`);
  for (const opp of opportunities) {
    recommendations.push(`${opp.type}: ${opp.count} occurrences, ${opp.savingsBytes} bytes saveable`);
  }
  if (reductionPercentage > 20) {
    recommendations.push(`Significant size reduction possible — ${reductionPercentage.toFixed(0)}% savings`);
  }
  if (reductionPercentage < 5) {
    recommendations.push('File already well-optimized — minimal savings possible');
  }

  return {
    currentSize, optimizedSize, reductionPercentage,
    opportunities, redundantComments, whitespaceBytes,
    optimizationScore, recommendations,
  };
}

// ── 10. CNC Tool Path Curvature Heatmap Generator ──

export interface CurvatureHeatmapPoint {
  /** X position */
  x: number;
  /** Y position */
  y: number;
  /** Curvature value (1/mm) */
  curvature: number;
  /** Curvature category */
  category: 'straight' | 'gentle' | 'moderate' | 'sharp' | 'very_sharp';
}

export interface CurvatureHeatmapResult {
  /** Heatmap data points */
  points: CurvatureHeatmapPoint[];
  /** Average curvature */
  avgCurvature: number;
  /** Max curvature */
  maxCurvature: number;
  /** Distribution by category */
  distribution: { [category: string]: number };
  /** Sharp corner count */
  sharpCornerCount: number;
  /** Curvature smoothness score (0-100) */
  smoothnessScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Generate curvature heatmap for the toolpath.
 * Maps curvature values to positions for visualization.
 *
 * @param lines G-code lines
 */
export function generateCurvatureHeatmap(lines: string[]): CurvatureHeatmapResult {
  const points: CurvatureHeatmapPoint[] = [];
  const positions: { x: number; y: number }[] = [];
  let prevX = 0, prevY = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG1\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;

    positions.push({ x, y });
    prevX = x; prevY = y;
  }

  // Calculate curvature at each point using 3-point method
  for (let i = 1; i < positions.length - 1; i++) {
    const p1 = positions[i - 1];
    const p2 = positions[i];
    const p3 = positions[i + 1];

    const v1x = p2.x - p1.x;
    const v1y = p2.y - p1.y;
    const v2x = p3.x - p2.x;
    const v2y = p3.y - p2.y;

    const cross = v1x * v2y - v1y * v2x;
    const len1 = Math.sqrt(v1x * v1x + v1y * v1y);
    const len2 = Math.sqrt(v2x * v2x + v2y * v2y);

    if (len1 > 0 && len2 > 0) {
      const curvature = Math.abs(cross) / (len1 * len2 * Math.max(len1, len2));
      const category: CurvatureHeatmapPoint['category'] =
        curvature < 0.001 ? 'straight'
        : curvature < 0.01 ? 'gentle'
        : curvature < 0.05 ? 'moderate'
        : curvature < 0.1 ? 'sharp' : 'very_sharp';

      points.push({ x: p2.x, y: p2.y, curvature, category });
    }
  }

  if (points.length === 0) {
    return {
      points: [], avgCurvature: 0, maxCurvature: 0,
      distribution: {}, sharpCornerCount: 0, smoothnessScore: 100,
      recommendations: ['No curvature data for heatmap'],
    };
  }

  const curvatures = points.map(p => p.curvature);
  const avgCurvature = curvatures.reduce((a, b) => a + b, 0) / curvatures.length;
  const maxCurvature = Math.max(...curvatures);

  const distribution: { [category: string]: number } = {};
  for (const p of points) {
    distribution[p.category] = (distribution[p.category] ?? 0) + 1;
  }

  const sharpCornerCount = (distribution.sharp ?? 0) + (distribution.very_sharp ?? 0);
  const smoothnessScore = Math.max(0, 100 - sharpCornerCount * 2);

  const recommendations: string[] = [];
  recommendations.push(`${points.length} curvature points, avg ${avgCurvature.toFixed(4)}, max ${maxCurvature.toFixed(4)}`);
  if (sharpCornerCount > 20) {
    recommendations.push(`${sharpCornerCount} sharp corners — may cause chatter or poor finish`);
  }
  if (distribution.straight > points.length * 0.7) {
    recommendations.push(`${distribution.straight} straight segments — mostly linear toolpath`);
  }
  if (smoothnessScore > 80) {
    recommendations.push('Smooth toolpath — minimal sharp curvature');
  }

  return {
    points, avgCurvature, maxCurvature,
    distribution, sharpCornerCount, smoothnessScore,
    recommendations,
  };
}

// ── 11. Print Layer Adhesion Strength Predictor ──

export interface AdhesionStrengthResult {
  /** Predicted adhesion strength in MPa */
  predictedStrength: number;
  /** Strength rating */
  rating: 'weak' | 'adequate' | 'good' | 'strong' | 'excellent';
  /** Layer bonding score (0-100) */
  bondingScore: number;
  /** Temperature factor (0-1) */
  temperatureFactor: number;
  /** Layer height factor (0-1) */
  layerHeightFactor: number;
  /** Cooling factor (0-1) */
  coolingFactor: number;
  /** Weakest layer */
  weakestLayer: number;
  /** Failure risk (0-100) */
  failureRisk: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Predict layer adhesion strength.
 * Estimates bond strength based on temperature, layer height, and cooling.
 *
 * @param lines G-code lines
 * @param material Material type (default 'PLA')
 */
export function predictLayerAdhesionStrength(
  lines: string[],
  material: string = 'PLA',
): AdhesionStrengthResult {
  // Material strength baselines (MPa)
  const strengthBaselines: { [material: string]: number } = {
    PLA: 60, ABS: 40, PETG: 50, Nylon: 70, TPU: 30, ASA: 45,
  };
  const baseStrength = strengthBaselines[material] ?? strengthBaselines.PLA;

  // Optimal temperatures by material
  const optimalTemps: { [material: string]: { min: number; max: number } } = {
    PLA: { min: 200, max: 220 },
    ABS: { min: 230, max: 250 },
    PETG: { min: 230, max: 250 },
    Nylon: { min: 240, max: 260 },
    TPU: { min: 210, max: 230 },
    ASA: { min: 240, max: 260 },
  };
  const optimalTemp = optimalTemps[material] ?? optimalTemps.PLA;

  let hotendTemp = 0;
  let fanSpeed = 0;
  const layerHeights: number[] = [];
  let prevZ = 0;
  let layerNum = 0;
  const layerTemps: { layer: number; temp: number; fan: number }[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Track hotend temperature
    const tempMatch = code.match(/\bS(\d*\.?\d+)\b/i);
    if (/\bM104\b/i.test(code) || /\bM109\b/i.test(code)) {
      if (tempMatch) hotendTemp = parseFloat(tempMatch[1]);
    }

    // Track fan
    if (/\bM106\b/i.test(code)) {
      const sMatch = code.match(/\bS(\d*\.?\d+)/i);
      fanSpeed = sMatch ? parseFloat(sMatch[1]) : 255;
    }
    if (/\bM107\b/i.test(code)) fanSpeed = 0;

    // Track layer height
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    if (zMatch) {
      const z = parseFloat(zMatch[1]);
      if (z > prevZ + 0.01 && layerNum > 0) {
        layerHeights.push(z - prevZ);
        layerTemps.push({ layer: layerNum, temp: hotendTemp, fan: fanSpeed });
        layerNum++;
      }
      prevZ = z;
    }
  }

  // Calculate factors
  const avgTemp = layerTemps.length > 0 ? layerTemps.reduce((s, l) => s + l.temp, 0) / layerTemps.length : hotendTemp;
  const avgFan = layerTemps.length > 0 ? layerTemps.reduce((s, l) => s + l.fan, 0) / layerTemps.length : fanSpeed;
  const avgLayerHeight = layerHeights.length > 0 ? layerHeights.reduce((a, b) => a + b, 0) / layerHeights.length : 0.2;

  // Temperature factor: 1.0 at optimal, decreases away from optimal
  const tempFactor = avgTemp >= optimalTemp.min && avgTemp <= optimalTemp.max
    ? 1.0
    : avgTemp < optimalTemp.min
    ? Math.max(0.3, 1 - (optimalTemp.min - avgTemp) / 50)
    : Math.max(0.7, 1 - (avgTemp - optimalTemp.max) / 50);

  // Layer height factor: thinner layers bond better
  const layerHeightFactor = Math.max(0.5, Math.min(1.0, 0.3 / avgLayerHeight));

  // Cooling factor: too much cooling reduces adhesion
  const coolingFactor = Math.max(0.5, 1 - (avgFan / 255) * 0.4);

  // Predicted strength
  const predictedStrength = baseStrength * tempFactor * layerHeightFactor * coolingFactor;

  const rating: AdhesionStrengthResult['rating'] =
    predictedStrength < baseStrength * 0.4 ? 'weak'
    : predictedStrength < baseStrength * 0.6 ? 'adequate'
    : predictedStrength < baseStrength * 0.8 ? 'good'
    : predictedStrength < baseStrength * 0.95 ? 'strong' : 'excellent';

  const bondingScore = Math.min(100, (predictedStrength / baseStrength) * 100);
  const failureRisk = Math.max(0, 100 - bondingScore);

  // Find weakest layer
  let weakestLayer = 0;
  let weakestScore = 100;
  for (const lt of layerTemps) {
    const layerTempFactor = lt.temp >= optimalTemp.min && lt.temp <= optimalTemp.max
      ? 1.0 : Math.max(0.3, 1 - Math.abs(lt.temp - (optimalTemp.min + optimalTemp.max) / 2) / 50);
    const layerCoolingFactor = Math.max(0.5, 1 - (lt.fan / 255) * 0.4);
    const layerScore = layerTempFactor * layerCoolingFactor * 100;
    if (layerScore < weakestScore) {
      weakestScore = layerScore;
      weakestLayer = lt.layer;
    }
  }

  const recommendations: string[] = [];
  recommendations.push(`Predicted strength: ${predictedStrength.toFixed(1)}MPa (${rating})`);
  if (tempFactor < 0.8) {
    recommendations.push(`Temperature ${avgTemp.toFixed(0)}°C not optimal for ${material} (${optimalTemp.min}-${optimalTemp.max}°C)`);
  }
  if (coolingFactor < 0.7) {
    recommendations.push(`High fan speed reducing adhesion — reduce cooling for better bonding`);
  }
  if (weakestLayer > 0) {
    recommendations.push(`Weakest layer: ${weakestLayer} — check temperature and fan settings`);
  }
  if (bondingScore > 85) {
    recommendations.push('Excellent layer adhesion — strong print expected');
  }

  return {
    predictedStrength, rating, bondingScore,
    temperatureFactor: tempFactor, layerHeightFactor, coolingFactor,
    weakestLayer, failureRisk, recommendations,
  };
}

// ── 12. G-code Toolpath Cornering Speed Calculator ──

export interface CorneringSpeedPoint {
  /** Line number */
  line: number;
  /** Corner angle in degrees */
  cornerAngle: number;
  /** Recommended speed in mm/min */
  recommendedSpeed: number;
  /** Current speed in mm/min */
  currentSpeed: number;
  /** Speed reduction percentage */
  speedReduction: number;
  /** Corner severity */
  severity: 'gentle' | 'moderate' | 'sharp' | 'very_sharp';
}

export interface CorneringSpeedResult {
  /** Cornering speed data points */
  points: CorneringSpeedPoint[];
  /** Corner count */
  cornerCount: number;
  /** Average speed reduction */
  avgSpeedReduction: number;
  /** Max speed reduction */
  maxSpeedReduction: number;
  /** Overspeed count (current > recommended) */
  overspeedCount: number;
  /** Cornering efficiency score (0-100) */
  efficiencyScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Calculate optimal cornering speed.
 * Recommends speed reduction at corners based on angle.
 *
 * @param lines G-code lines
 * @param maxFeedRate Max feed rate in mm/min (default 3000)
 */
export function calculateCorneringSpeed(
  lines: string[],
  maxFeedRate: number = 3000,
): CorneringSpeedResult {
  const points: CorneringSpeedPoint[] = [];
  let prevX = 0, prevY = 0;
  let prevAngle: number | null = null;
  let feedRate = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG1\b/i.test(code)) continue;

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) feedRate = parseFloat(fMatch[1]);

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;

    const dx = x - prevX;
    const dy = y - prevY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 0.01) {
      const angle = Math.atan2(dy, dx);

      if (prevAngle !== null && feedRate > 0) {
        let angleChange = Math.abs(angle - prevAngle);
        while (angleChange > Math.PI) angleChange = 2 * Math.PI - angleChange;
        const cornerAngle = angleChange * 180 / Math.PI;

        if (cornerAngle > 5) {
          // Recommended speed: reduce based on corner angle
          const speedFactor = Math.max(0.1, 1 - (cornerAngle / 180) * 0.8);
          const recommendedSpeed = Math.round(maxFeedRate * speedFactor);
          const speedReduction = feedRate > 0 ? ((feedRate - recommendedSpeed) / feedRate) * 100 : 0;

          const severity: CorneringSpeedPoint['severity'] =
            cornerAngle < 30 ? 'gentle'
            : cornerAngle < 60 ? 'moderate'
            : cornerAngle < 120 ? 'sharp' : 'very_sharp';

          points.push({
            line: i, cornerAngle, recommendedSpeed,
            currentSpeed: feedRate, speedReduction, severity,
          });
        }
      }
      prevAngle = angle;
    }

    prevX = x; prevY = y;
  }

  const cornerCount = points.length;
  const avgSpeedReduction = cornerCount > 0
    ? points.reduce((s, p) => s + p.speedReduction, 0) / cornerCount : 0;
  const maxSpeedReduction = cornerCount > 0 ? Math.max(...points.map(p => p.speedReduction)) : 0;
  const overspeedCount = points.filter(p => p.currentSpeed > p.recommendedSpeed).length;
  const efficiencyScore = Math.max(0, 100 - overspeedCount * 5 - Math.abs(avgSpeedReduction) * 0.5);

  const recommendations: string[] = [];
  recommendations.push(`${cornerCount} corners, avg speed reduction ${avgSpeedReduction.toFixed(0)}%`);
  if (overspeedCount > 10) {
    recommendations.push(`${overspeedCount} corners with excessive speed — reduce feed at sharp corners`);
  }
  const sharpCorners = points.filter(p => p.severity === 'sharp' || p.severity === 'very_sharp').length;
  if (sharpCorners > 5) {
    recommendations.push(`${sharpCorners} sharp corners — enable cornering control in firmware`);
  }
  if (efficiencyScore > 80) {
    recommendations.push('Good cornering speed control — minimal overshoot');
  }

  return {
    points, cornerCount, avgSpeedReduction, maxSpeedReduction,
    overspeedCount, efficiencyScore, recommendations,
  };
}
