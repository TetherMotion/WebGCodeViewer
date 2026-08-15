/**
 * @file GcodeAdvanced27.ts
 * @brief Twenty-seventh batch of advanced G-code analysis features for CNC and 3D printing.
 *
 * This module provides 12 additional high-impact features:
 *  1. CNC tool path entry strategy analyzer (CNC)
 *  2. Print retraction acceleration analyzer (3DP)
 *  3. G-code coordinate system alignment checker (Universal)
 *  4. CNC tool nose radius compensation validator (CNC)
 *  5. Print infill pattern density per layer analyzer (3DP)
 *  6. G-code toolpath segment classification per layer (Universal)
 *  7. CNC spindle warmup cycle validator (CNC)
 *  8. Print layer fan speed per layer analyzer (3DP)
 *  9. G-code program structure complexity per section (Universal)
 * 10. CNC tool path lead-in/lead-out analyzer (CNC)
 * 11. Print extrusion consistency per layer analyzer (3DP)
 * 12. G-code machine coordinate boundary checker (Universal)
 */

// ── 1. CNC Tool Path Entry Strategy Analyzer ──

export interface EntryStrategyInfo {
  /** Line number */
  line: number;
  /** Entry type */
  type: 'plunge' | 'ramp' | 'helical' | 'arc' | 'unknown';
  /** Entry angle in degrees */
  angle: number;
  /** Entry distance in mm */
  distance: number;
}

export interface EntryStrategyResult {
  /** Entry strategy data */
  entries: EntryStrategyInfo[];
  /** Entry count */
  count: number;
  /** Strategy distribution */
  distribution: { [type: string]: number };
  /** Primary strategy */
  primaryStrategy: string;
  /** Strategy consistency score (0-100) */
  consistencyScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze tool entry strategies.
 * Entry strategy affects tool life and surface finish quality.
 *
 * @param lines G-code lines
 */
export function analyzeEntryStrategy(lines: string[]): EntryStrategyResult {
  const entries: EntryStrategyInfo[] = [];
  let prevX = 0, prevY = 0, prevZ = 0;
  let entryStartZ = 0;
  let entryStartLine = -1;
  let inEntry = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Detect start of entry (Z decreasing into material)
    if (/\bG1\b/i.test(code)) {
      const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
      if (zMatch) {
        const z = parseFloat(zMatch[1]);
        if (z < prevZ - 0.1 && prevZ >= 0 && !inEntry) {
          // Start of entry
          inEntry = true;
          entryStartZ = prevZ;
          entryStartLine = i;
        } else if (z < prevZ - 0.1 && inEntry) {
          // Continue entry
        } else if (z >= prevZ - 0.01 && inEntry) {
          // End of entry
          inEntry = false;
          const entryDist = Math.abs(entryStartZ - prevZ);
          const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
          const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
          const x = xMatch ? parseFloat(xMatch[1]) : prevX;
          const y = yMatch ? parseFloat(yMatch[1]) : prevY;
          const xyDist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);

          // Classify entry type
          let type: EntryStrategyInfo['type'] = 'plunge';
          let angle = 90;
          if (xyDist > entryDist * 0.5) {
            // Has XY movement — ramp or helical
            if (xyDist > entryDist * 2) {
              type = 'ramp';
              angle = Math.atan2(entryDist, xyDist) * 180 / Math.PI;
            } else {
              type = 'helical';
              angle = Math.atan2(entryDist, xyDist) * 180 / Math.PI;
            }
          }

          entries.push({
            line: entryStartLine, type, angle, distance: entryDist,
          });
        }
        prevZ = z;
      }

      const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
      if (xMatch) prevX = parseFloat(xMatch[1]);
      if (yMatch) prevY = parseFloat(yMatch[1]);
    }

    // Detect arc entry
    if (/\bG[23]\b/i.test(code) && inEntry) {
      const lastEntry = entries[entries.length - 1];
      if (lastEntry) {
        lastEntry.type = 'arc';
      }
    }
  }

  if (entries.length === 0) {
    return {
      entries: [], count: 0, distribution: {},
      primaryStrategy: 'none', consistencyScore: 100,
      recommendations: ['No entry strategies detected'],
    };
  }

  const distribution: { [type: string]: number } = {};
  for (const e of entries) {
    distribution[e.type] = (distribution[e.type] ?? 0) + 1;
  }

  let primaryStrategy = 'plunge';
  let maxCount = 0;
  for (const [type, cnt] of Object.entries(distribution)) {
    if (cnt > maxCount) {
      maxCount = cnt;
      primaryStrategy = type;
    }
  }

  const consistencyScore = Math.round((maxCount / entries.length) * 100);

  const recommendations: string[] = [];
  recommendations.push(`${entries.length} entries, primary: ${primaryStrategy} (${consistencyScore}%)`);
  for (const [type, cnt] of Object.entries(distribution)) {
    recommendations.push(`${type}: ${cnt}`);
  }
  if (distribution.plunge > 5) {
    recommendations.push(`${distribution.plunge} plunge entries — consider ramp/helical for tool life`);
  }
  if (consistencyScore > 80) {
    recommendations.push('Consistent entry strategy — uniform cutting conditions');
  }

  return {
    entries, count: entries.length, distribution,
    primaryStrategy, consistencyScore, recommendations,
  };
}

// ── 2. Print Retraction Acceleration Analyzer ──

export interface RetractionAccelResult {
  /** Retraction count */
  count: number;
  /** Average retraction speed in mm/s */
  avgRetractSpeed: number;
  /** Max retraction speed in mm/s */
  maxRetractSpeed: number;
  /** Average retraction acceleration in mm/s² */
  avgAcceleration: number;
  /** Max retraction acceleration in mm/s² */
  maxAcceleration: number;
  /** High acceleration count */
  highAccelCount: number;
  /** Acceleration quality score (0-100) */
  qualityScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze retraction acceleration.
 * High retraction acceleration can cause extruder skipping and filament damage.
 *
 * @param lines G-code lines
 * @param maxRecommendedAccel Max recommended acceleration in mm/s² (default 3000)
 */
export function analyzeRetractionAcceleration(
  lines: string[],
  maxRecommendedAccel: number = 3000,
): RetractionAccelResult {
  const retractSpeeds: number[] = [];
  let prevE = 0;
  let feedRate = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG1\b/i.test(code)) continue;

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) feedRate = parseFloat(fMatch[1]);

    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);
    if (eMatch) {
      const e = parseFloat(eMatch[1]);
      if (e < prevE && feedRate > 0) {
        // Retraction detected
        const retractDist = prevE - e;
        const retractSpeed = feedRate / 60; // mm/s
        retractSpeeds.push(retractSpeed);
      }
      prevE = e;
    }
  }

  if (retractSpeeds.length === 0) {
    return {
      count: 0, avgRetractSpeed: 0, maxRetractSpeed: 0,
      avgAcceleration: 0, maxAcceleration: 0, highAccelCount: 0,
      qualityScore: 100,
      recommendations: ['No retractions detected'],
    };
  }

  const count = retractSpeeds.length;
  const avgRetractSpeed = retractSpeeds.reduce((a, b) => a + b, 0) / count;
  const maxRetractSpeed = Math.max(...retractSpeeds);

  // Estimate acceleration from speed changes
  const accelerations = retractSpeeds.map(s => s * 10); // simplified estimate
  const avgAcceleration = accelerations.reduce((a, b) => a + b, 0) / accelerations.length;
  const maxAcceleration = Math.max(...accelerations);
  const highAccelCount = accelerations.filter(a => a > maxRecommendedAccel).length;
  const qualityScore = Math.max(0, 100 - highAccelCount * 5 - (maxAcceleration / maxRecommendedAccel - 1) * 30);

  const recommendations: string[] = [];
  recommendations.push(`${count} retractions, avg speed ${avgRetractSpeed.toFixed(1)}mm/s`);
  recommendations.push(`Avg acceleration: ${avgAcceleration.toFixed(0)}mm/s2, max: ${maxAcceleration.toFixed(0)}mm/s2`);
  if (highAccelCount > 5) {
    recommendations.push(`${highAccelCount} high-acceleration retractions — reduce retraction speed`);
  }
  if (maxAcceleration > maxRecommendedAccel * 1.5) {
    recommendations.push(`Max acceleration exceeds recommended — risk of extruder skipping`);
  }
  if (qualityScore > 85) {
    recommendations.push('Good retraction acceleration — minimal stress on extruder');
  }

  return {
    count, avgRetractSpeed, maxRetractSpeed,
    avgAcceleration, maxAcceleration, highAccelCount,
    qualityScore, recommendations,
  };
}

// ── 3. G-code Coordinate System Alignment Checker ──

export interface CoordAlignmentResult {
  /** WCS count */
  wcsCount: number;
  /** Alignment issues */
  issues: { line: number; type: string; description: string }[];
  /** Issue count */
  issueCount: number;
  /** Alignment score (0-100) */
  alignmentScore: number;
  /** Is aligned */
  isAligned: boolean;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Check coordinate system alignment.
 * Misaligned coordinate systems can cause machining errors.
 *
 * @param lines G-code lines
 */
export function checkCoordinateSystemAlignment(lines: string[]): CoordAlignmentResult {
  const issues: { line: number; type: string; description: string }[] = [];
  const wcsSet = new Set<string>();
  let currentWCS = '';
  let hasHoming = false;
  let hasProbe = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Check for homing
    if (/\bG28\b/i.test(code)) hasHoming = true;

    // Check for probing
    if (/\bG38\b/i.test(code)) hasProbe = true;

    // Track WCS changes
    const wcsMatch = code.match(/\bG(5[4-9])\b/i);
    if (wcsMatch) {
      const wcs = `G${wcsMatch[1]}`;
      wcsSet.add(wcs);
      if (currentWCS && currentWCS !== wcs) {
        // Check if there's a G28 between WCS changes
        issues.push({
          line: i, type: 'wcs_change',
          description: `WCS changed from ${currentWCS} to ${wcs} without homing`,
        });
      }
      currentWCS = wcs;
    }

    // Check for G53 (machine coordinates)
    if (/\bG53\b/i.test(code)) {
      issues.push({
        line: i, type: 'machine_coords',
        description: 'G53 machine coordinates used — verify alignment',
      });
    }
  }

  const wcsCount = wcsSet.size;
  const issueCount = issues.length;

  if (!hasHoming && wcsCount > 0) {
    issues.push({
      line: 0, type: 'no_homing',
      description: 'No G28 homing detected before WCS usage',
    });
  }

  if (!hasProbe && wcsCount > 1) {
    issues.push({
      line: 0, type: 'no_probe',
      description: 'Multiple WCS without probing — verify alignment',
    });
  }

  const alignmentScore = Math.max(0, 100 - issues.length * 15);
  const isAligned = issues.length === 0;

  const recommendations: string[] = [];
  recommendations.push(`${wcsCount} work coordinate systems, ${issues.length} alignment issues`);
  if (!hasHoming) {
    recommendations.push('No homing (G28) detected — add homing before WCS usage');
  }
  if (!hasProbe && wcsCount > 1) {
    recommendations.push('Multiple WCS without probing — verify alignment');
  }
  for (const issue of issues.slice(0, 3)) {
    recommendations.push(`Line ${issue.line}: ${issue.description}`);
  }
  if (isAligned) {
    recommendations.push('Coordinate systems properly aligned');
  }

  return {
    wcsCount, issues, issueCount, alignmentScore,
    isAligned, recommendations,
  };
}

// ── 4. CNC Tool Nose Radius Compensation Validator ──

export interface CompensationInfo {
  /** Line number */
  line: number;
  /** Compensation mode */
  mode: 'left' | 'right' | 'cancel';
  /** Compensation code */
  code: string;
  /** D value */
  dValue: number;
}

export interface NoseRadiusCompensationResult {
  /** Compensation events */
  events: CompensationInfo[];
  /** Event count */
  count: number;
  /** Left compensation count */
  leftCount: number;
  /** Right compensation count */
  rightCount: number;
  /** Cancel count */
  cancelCount: number;
  /** Uncancelled compensation */
  hasUncancelled: boolean;
  /** Validation score (0-100) */
  validationScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Validate tool nose radius compensation (G41/G42/G40).
 * Improper compensation can cause dimensional errors.
 *
 * @param lines G-code lines
 */
export function validateNoseRadiusCompensation(
  lines: string[],
): NoseRadiusCompensationResult {
  const events: CompensationInfo[] = [];
  let isCompensating = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    let mode: CompensationInfo['mode'] | null = null;
    let compCode = '';

    if (/\bG41\b/i.test(code)) {
      mode = 'left';
      compCode = 'G41';
      isCompensating = true;
    } else if (/\bG42\b/i.test(code)) {
      mode = 'right';
      compCode = 'G42';
      isCompensating = true;
    } else if (/\bG40\b/i.test(code)) {
      mode = 'cancel';
      compCode = 'G40';
      isCompensating = false;
    }

    if (mode) {
      const dMatch = code.match(/\bD(\d+)/i);
      events.push({
        line: i, mode, code: compCode,
        dValue: dMatch ? parseInt(dMatch[1]) : 0,
      });
    }
  }

  if (events.length === 0) {
    return {
      events: [], count: 0, leftCount: 0, rightCount: 0,
      cancelCount: 0, hasUncancelled: false, validationScore: 100,
      recommendations: ['No tool nose radius compensation detected'],
    };
  }

  const count = events.length;
  const leftCount = events.filter(e => e.mode === 'left').length;
  const rightCount = events.filter(e => e.mode === 'right').length;
  const cancelCount = events.filter(e => e.mode === 'cancel').length;
  const hasUncancelled = isCompensating;

  // Check for issues
  let issues = 0;
  if (hasUncancelled) issues++;
  if (leftCount + rightCount > cancelCount + 1) issues++;
  if (leftCount + rightCount === 0 && cancelCount > 0) issues++;

  const validationScore = Math.max(0, 100 - issues * 25);

  const recommendations: string[] = [];
  recommendations.push(`${count} compensation events: ${leftCount} left, ${rightCount} right, ${cancelCount} cancel`);
  if (hasUncancelled) {
    recommendations.push('Compensation not cancelled at end — add G40 before program end');
  }
  if (leftCount + rightCount > cancelCount + 1) {
    recommendations.push('More compensations than cancellations — verify G40 usage');
  }
  if (validationScore > 85) {
    recommendations.push('Proper compensation management — all cancellations in place');
  }

  return {
    events, count, leftCount, rightCount, cancelCount,
    hasUncancelled, validationScore, recommendations,
  };
}

// ── 5. Print Infill Pattern Density Per Layer Analyzer ──

export interface LayerInfillDensity {
  /** Layer number */
  layer: number;
  /** Z height */
  zHeight: number;
  /** Infill density percentage */
  density: number;
  /** Infill distance in mm */
  infillDistance: number;
  /** Total distance in mm */
  totalDistance: number;
}

export interface InfillDensityPerLayerResult {
  /** Per-layer infill density data */
  layers: LayerInfillDensity[];
  /** Layer count */
  layerCount: number;
  /** Average infill density */
  avgDensity: number;
  /** Density variance */
  densityVariance: number;
  /** Consistency score (0-100) */
  consistencyScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze infill pattern density per layer.
 * Inconsistent infill density affects part strength and weight.
 *
 * @param lines G-code lines
 */
export function analyzeInfillDensityPerLayer(
  lines: string[],
): InfillDensityPerLayerResult {
  const layers: LayerInfillDensity[] = [];
  let prevX = 0, prevY = 0, prevZ = 0;
  let firstZ = 0;
  let currentZ = 0;
  let layerNum = 0;
  let layerInfillDist = 0;
  let layerTotalDist = 0;
  let isInfill = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Detect infill sections from comments
    if (/;.*infill/i.test(trimmed)) {
      isInfill = true;
    } else if (/;.*perimeter/i.test(trimmed) || /;.*wall/i.test(trimmed) || /;.*layer/i.test(trimmed)) {
      isInfill = false;
    }

    if (trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

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
      const density = layerTotalDist > 0 ? (layerInfillDist / layerTotalDist) * 100 : 0;
      layers.push({
        layer: layerNum, zHeight: currentZ,
        density, infillDistance: layerInfillDist,
        totalDistance: layerTotalDist,
      });
      layerNum++;
      currentZ = z;
      layerInfillDist = 0;
      layerTotalDist = 0;
    } else if (layerNum === 0) {
      currentZ = z;
      layerNum = 1;
    }

    // Track distances
    const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
    if (dist > 0) {
      layerTotalDist += dist;
      if (isInfill) {
        layerInfillDist += dist;
      }
    }

    prevX = x; prevY = y; prevZ = z;
  }

  // Save last layer
  if (layerNum > 0 && layerTotalDist > 0) {
    const density = (layerInfillDist / layerTotalDist) * 100;
    layers.push({
      layer: layerNum, zHeight: currentZ,
      density, infillDistance: layerInfillDist,
      totalDistance: layerTotalDist,
    });
  }

  if (layers.length === 0) {
    return {
      layers: [], layerCount: 0, avgDensity: 0,
      densityVariance: 0, consistencyScore: 100,
      recommendations: ['No infill density data for per-layer analysis'],
    };
  }

  const densities = layers.map(l => l.density);
  const avgDensity = densities.reduce((a, b) => a + b, 0) / densities.length;
  const densityVariance = densities.reduce((s, d) => s + (d - avgDensity) ** 2, 0) / densities.length;
  const consistencyScore = avgDensity > 0
    ? Math.max(0, 100 - (Math.sqrt(densityVariance) / avgDensity) * 100) : 100;

  const recommendations: string[] = [];
  recommendations.push(`${layers.length} layers, avg infill density ${avgDensity.toFixed(1)}%`);
  if (densityVariance > 100) {
    recommendations.push('High infill density variance — inconsistent part strength');
  }
  if (consistencyScore > 85) {
    recommendations.push('Consistent infill density — uniform part strength');
  }

  return {
    layers, layerCount: layers.length, avgDensity,
    densityVariance, consistencyScore, recommendations,
  };
}

// ── 6. G-code Toolpath Segment Classification Per Layer ──

export interface LayerSegmentTypes {
  /** Layer number */
  layer: number;
  /** Z height */
  zHeight: number;
  /** Segment type counts */
  types: { [type: string]: number };
  /** Total segments */
  totalSegments: number;
  /** Dominant type */
  dominantType: string;
}

export interface SegmentClassificationPerLayerResult {
  /** Per-layer segment classification */
  layers: LayerSegmentTypes[];
  /** Layer count */
  layerCount: number;
  /** Overall segment distribution */
  overallDistribution: { [type: string]: number };
  /** Classification consistency score (0-100) */
  consistencyScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Classify toolpath segments per layer.
 * Shows what types of moves dominate each layer.
 *
 * @param lines G-code lines
 */
export function classifySegmentsPerLayer(
  lines: string[],
): SegmentClassificationPerLayerResult {
  const layers: LayerSegmentTypes[] = [];
  let prevZ = 0;
  let currentZ = 0;
  let layerNum = 0;
  let layerTypes: { [type: string]: number } = {};
  let layerTotal = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    if (zMatch && /\bG1\b/i.test(code)) {
      const z = parseFloat(zMatch[1]);
      if (z > currentZ + 0.01 && layerNum > 0) {
        // Save layer
        const dominantType = Object.entries(layerTypes)
          .reduce((max, [t, c]) => c > max[1] ? [t, c] : max, ['', 0])[0];
        layers.push({
          layer: layerNum, zHeight: currentZ,
          types: layerTypes, totalSegments: layerTotal,
          dominantType,
        });
        layerNum++;
        currentZ = z;
        layerTypes = {};
        layerTotal = 0;
      } else if (layerNum === 0) {
        currentZ = z;
        layerNum = 1;
      }
    }

    // Classify segment
    let segType = 'unknown';
    if (/\bG0\b/i.test(code)) segType = 'rapid';
    else if (/\bG1\b/i.test(code)) segType = 'linear';
    else if (/\bG2\b/i.test(code)) segType = 'arc_cw';
    else if (/\bG3\b/i.test(code)) segType = 'arc_ccw';

    if (segType !== 'unknown') {
      layerTypes[segType] = (layerTypes[segType] ?? 0) + 1;
      layerTotal++;
    }
  }

  // Save last layer
  if (layerNum > 0 && layerTotal > 0) {
    const dominantType = Object.entries(layerTypes)
      .reduce((max, [t, c]) => c > max[1] ? [t, c] : max, ['', 0])[0];
    layers.push({
      layer: layerNum, zHeight: currentZ,
      types: layerTypes, totalSegments: layerTotal,
      dominantType,
    });
  }

  if (layers.length === 0) {
    return {
      layers: [], layerCount: 0, overallDistribution: {},
      consistencyScore: 100,
      recommendations: ['No segment classification data for per-layer analysis'],
    };
  }

  // Calculate overall distribution
  const overallDistribution: { [type: string]: number } = {};
  for (const l of layers) {
    for (const [type, count] of Object.entries(l.types)) {
      overallDistribution[type] = (overallDistribution[type] ?? 0) + count;
    }
  }

  // Consistency: how similar are the layer distributions
  const dominantTypes = layers.map(l => l.dominantType);
  const sameDominant = dominantTypes.every(t => t === dominantTypes[0]);
  const consistencyScore = sameDominant ? 100 : Math.round(
    (dominantTypes.filter(t => t === dominantTypes[0]).length / dominantTypes.length) * 100
  );

  const recommendations: string[] = [];
  recommendations.push(`${layers.length} layers classified`);
  for (const [type, count] of Object.entries(overallDistribution)) {
    recommendations.push(`${type}: ${count} segments`);
  }
  if (!sameDominant) {
    recommendations.push('Different dominant segment types across layers');
  }
  if (consistencyScore > 85) {
    recommendations.push('Consistent segment classification across layers');
  }

  return {
    layers, layerCount: layers.length, overallDistribution,
    consistencyScore, recommendations,
  };
}

// ── 7. CNC Spindle Warmup Cycle Validator ──

export interface SpindleWarmupValidationResult {
  /** Has warmup cycle */
  hasWarmup: boolean;
  /** Warmup duration in seconds */
  warmupDuration: number;
  /** Warmup speed in RPM */
  warmupSpeed: number;
  /** Target speed in RPM */
  targetSpeed: number;
  /** Is warmup adequate */
  isAdequate: boolean;
  /** Validation score (0-100) */
  validationScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Validate spindle warmup cycle.
 * Proper warmup extends spindle bearing life and ensures accuracy.
 *
 * @param lines G-code lines
 * @param minWarmupTime Minimum warmup time in seconds (default 300)
 */
export function validateSpindleWarmupCycle(
  lines: string[],
  minWarmupTime: number = 300,
): SpindleWarmupValidationResult {
  let warmupStartLine = -1;
  let warmupEndLine = -1;
  let warmupSpeed = 0;
  let targetSpeed = 0;
  let firstSpindleStart = -1;
  let firstCutLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Detect spindle start
    if (/\bM3\b/i.test(code) || /\bM4\b/i.test(code)) {
      const sMatch = code.match(/\bS(\d*\.?\d+)/i);
      const speed = sMatch ? parseFloat(sMatch[1]) : 0;
      if (firstSpindleStart < 0) {
        firstSpindleStart = i;
        warmupSpeed = speed;
        warmupStartLine = i;
      } else if (speed > warmupSpeed * 1.5) {
        // Speed increase — end of warmup
        targetSpeed = speed;
        warmupEndLine = i;
      }
    }

    // Detect first cutting move
    if (firstCutLine < 0 && /\bG1\b/i.test(code)) {
      const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
      if (zMatch && parseFloat(zMatch[1]) < 0) {
        firstCutLine = i;
        if (warmupEndLine < 0) warmupEndLine = i;
      }
    }
  }

  if (firstSpindleStart < 0) {
    return {
      hasWarmup: false, warmupDuration: 0, warmupSpeed: 0,
      targetSpeed: 0, isAdequate: false, validationScore: 0,
      recommendations: ['No spindle start detected'],
    };
  }

  // Estimate warmup duration from line count (simplified)
  const warmupLineCount = warmupEndLine > 0 ? warmupEndLine - warmupStartLine : 0;
  const warmupDuration = warmupLineCount * 0.5; // estimate 0.5s per line

  const hasWarmup = warmupDuration > 10;
  const isAdequate = warmupDuration >= minWarmupTime;
  const validationScore = Math.min(100, (warmupDuration / minWarmupTime) * 100);

  const recommendations: string[] = [];
  if (!hasWarmup) {
    recommendations.push('No spindle warmup cycle detected — add warmup for bearing life');
  } else {
    recommendations.push(`Warmup: ${warmupDuration.toFixed(0)}s at ${warmupSpeed} RPM`);
  }
  if (hasWarmup && !isAdequate) {
    recommendations.push(`Warmup too short (${warmupDuration.toFixed(0)}s < ${minWarmupTime}s recommended)`);
  }
  if (isAdequate) {
    recommendations.push('Adequate spindle warmup — good for bearing life');
  }

  return {
    hasWarmup, warmupDuration, warmupSpeed,
    targetSpeed, isAdequate, validationScore, recommendations,
  };
}

// ── 8. Print Layer Fan Speed Per Layer Analyzer ──

export interface LayerFanSpeed {
  /** Layer number */
  layer: number;
  /** Z height */
  zHeight: number;
  /** Fan speed (0-255) */
  fanSpeed: number;
  /** Fan duty cycle percentage */
  dutyCycle: number;
}

export interface FanSpeedPerLayerResult {
  /** Per-layer fan speed data */
  layers: LayerFanSpeed[];
  /** Layer count */
  layerCount: number;
  /** Average fan speed */
  avgFanSpeed: number;
  /** Fan speed variance */
  variance: number;
  /** Consistency score (0-100) */
  consistencyScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze fan speed per layer.
 * Inconsistent fan speeds can cause uneven cooling and warping.
 *
 * @param lines G-code lines
 */
export function analyzeFanSpeedPerLayer(
  lines: string[],
): FanSpeedPerLayerResult {
  const layers: LayerFanSpeed[] = [];
  let fanSpeed = 0;
  let prevZ = 0;
  let currentZ = 0;
  let layerNum = 0;
  let layerFanSpeeds: number[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Track fan speed
    if (/\bM106\b/i.test(code)) {
      const sMatch = code.match(/\bS(\d*\.?\d+)/i);
      fanSpeed = sMatch ? parseFloat(sMatch[1]) : 255;
    }
    if (/\bM107\b/i.test(code)) {
      fanSpeed = 0;
    }

    if (!/\bG1\b/i.test(code)) continue;

    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    if (zMatch) {
      const z = parseFloat(zMatch[1]);
      if (z > currentZ + 0.01 && layerNum > 0) {
        // Save layer
        const avgSpeed = layerFanSpeeds.length > 0
          ? layerFanSpeeds.reduce((a, b) => a + b, 0) / layerFanSpeeds.length : 0;
        layers.push({
          layer: layerNum, zHeight: currentZ,
          fanSpeed: avgSpeed,
          dutyCycle: (avgSpeed / 255) * 100,
        });
        layerNum++;
        currentZ = z;
        layerFanSpeeds = [];
      } else if (layerNum === 0) {
        currentZ = z;
        layerNum = 1;
      }
      layerFanSpeeds.push(fanSpeed);
    }
  }

  // Save last layer
  if (layerNum > 0 && layerFanSpeeds.length > 0) {
    const avgSpeed = layerFanSpeeds.reduce((a, b) => a + b, 0) / layerFanSpeeds.length;
    layers.push({
      layer: layerNum, zHeight: currentZ,
      fanSpeed: avgSpeed,
      dutyCycle: (avgSpeed / 255) * 100,
    });
  }

  if (layers.length === 0) {
    return {
      layers: [], layerCount: 0, avgFanSpeed: 0,
      variance: 0, consistencyScore: 100,
      recommendations: ['No fan speed data for per-layer analysis'],
    };
  }

  const speeds = layers.map(l => l.fanSpeed);
  const avgFanSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  const variance = speeds.reduce((s, sp) => s + (sp - avgFanSpeed) ** 2, 0) / speeds.length;
  const consistencyScore = avgFanSpeed > 0
    ? Math.max(0, 100 - (Math.sqrt(variance) / 255) * 100) : 100;

  const recommendations: string[] = [];
  recommendations.push(`${layers.length} layers, avg fan speed ${avgFanSpeed.toFixed(0)}/255`);
  if (variance > 5000) {
    recommendations.push('High fan speed variance — inconsistent cooling');
  }
  if (consistencyScore > 85) {
    recommendations.push('Consistent fan speed — uniform cooling');
  }

  return {
    layers, layerCount: layers.length, avgFanSpeed,
    variance, consistencyScore, recommendations,
  };
}

// ── 9. G-code Program Structure Complexity Per Section ──

export interface SectionComplexity {
  /** Section name */
  name: string;
  /** Start line */
  startLine: number;
  /** End line */
  endLine: number;
  /** Line count */
  lineCount: number;
  /** Complexity score (0-100) */
  complexityScore: number;
  /** Command count */
  commandCount: number;
  /** Unique commands */
  uniqueCommands: number;
}

export interface StructureComplexityResult {
  /** Per-section complexity data */
  sections: SectionComplexity[];
  /** Section count */
  sectionCount: number;
  /** Most complex section */
  mostComplexSection: string;
  /** Average complexity */
  avgComplexity: number;
  /** Overall structure score (0-100) */
  structureScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze program structure complexity per section.
 * Identifies which sections are most complex.
 *
 * @param lines G-code lines
 */
export function analyzeStructureComplexityPerSection(
  lines: string[],
): StructureComplexityResult {
  const sections: SectionComplexity[] = [];
  let currentSectionStart = 0;
  let currentSectionName = 'init';
  let currentCommands: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();

    // Detect section changes
    let newSection = '';
    if (/\bG28\b/i.test(code)) newSection = 'homing';
    else if (/\bM3\b/i.test(code) || /\bM4\b/i.test(code)) newSection = 'spindle_start';
    else if (/;.*rough/i.test(line)) newSection = 'roughing';
    else if (/;.*finish/i.test(line)) newSection = 'finishing';
    else if (/;.*drill/i.test(line) || /\bG8[1-9]\b/i.test(code)) newSection = 'drilling';
    else if (/\bM5\b/i.test(code)) newSection = 'spindle_stop';
    else if (/\bM30\b/i.test(code) || /\bM2\b/i.test(code)) newSection = 'end';

    if (newSection && newSection !== currentSectionName) {
      // Save previous section
      if (currentCommands.length > 0) {
        const uniqueCmds = new Set(currentCommands).size;
        const complexityScore = Math.min(100,
          currentCommands.length / 10 + uniqueCmds * 5);
        sections.push({
          name: currentSectionName,
          startLine: currentSectionStart,
          endLine: i - 1,
          lineCount: i - currentSectionStart,
          complexityScore: Math.round(complexityScore),
          commandCount: currentCommands.length,
          uniqueCommands: uniqueCmds,
        });
      }
      currentSectionStart = i;
      currentSectionName = newSection;
      currentCommands = [];
    }

    if (code) {
      const gMatch = code.match(/\bG\d+/i);
      const mMatch = code.match(/\bM\d+/i);
      if (gMatch) currentCommands.push(gMatch[0]);
      if (mMatch) currentCommands.push(mMatch[0]);
    }
  }

  // Save last section
  if (currentCommands.length > 0) {
    const uniqueCmds = new Set(currentCommands).size;
    const complexityScore = Math.min(100, currentCommands.length / 10 + uniqueCmds * 5);
    sections.push({
      name: currentSectionName,
      startLine: currentSectionStart,
      endLine: lines.length - 1,
      lineCount: lines.length - currentSectionStart,
      complexityScore: Math.round(complexityScore),
      commandCount: currentCommands.length,
      uniqueCommands: uniqueCmds,
    });
  }

  if (sections.length === 0) {
    return {
      sections: [], sectionCount: 0, mostComplexSection: 'none',
      avgComplexity: 0, structureScore: 100,
      recommendations: ['No sections detected for complexity analysis'],
    };
  }

  const avgComplexity = sections.reduce((s, sec) => s + sec.complexityScore, 0) / sections.length;
  const mostComplex = sections.reduce((max, s) =>
    s.complexityScore > max.complexityScore ? s : max, sections[0]);
  const structureScore = Math.round(100 - Math.abs(avgComplexity - 50) * 2);

  const recommendations: string[] = [];
  recommendations.push(`${sections.length} sections, avg complexity ${avgComplexity.toFixed(0)}`);
  recommendations.push(`Most complex: ${mostComplex.name} (${mostComplex.complexityScore})`);
  if (mostComplex.complexityScore > 80) {
    recommendations.push(`Section '${mostComplex.name}' is very complex — consider splitting`);
  }
  if (structureScore > 80) {
    recommendations.push('Well-balanced structure — even complexity distribution');
  }

  return {
    sections, sectionCount: sections.length,
    mostComplexSection: mostComplex.name, avgComplexity,
    structureScore, recommendations,
  };
}

// ── 10. CNC Tool Path Lead-In/Lead-Out Analyzer ──

export interface LeadInOutInfo {
  /** Line number */
  line: number;
  /** Type */
  type: 'lead_in' | 'lead_out';
  /** Distance in mm */
  distance: number;
  /** Angle in degrees */
  angle: number;
}

export interface LeadInOutResult {
  /** Lead-in/out data */
  entries: LeadInOutInfo[];
  /** Lead-in count */
  leadInCount: number;
  /** Lead-out count */
  leadOutCount: number;
  /** Average lead distance in mm */
  avgLeadDistance: number;
  /** Lead-in/out quality score (0-100) */
  qualityScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze tool path lead-in/lead-out moves.
 * Proper lead-in/out improves surface finish at entry/exit points.
 *
 * @param lines G-code lines
 */
export function analyzeLeadInOut(lines: string[]): LeadInOutResult {
  const entries: LeadInOutInfo[] = [];
  let prevX = 0, prevY = 0, prevZ = 0;
  let wasCutting = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG[01]\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const z = zMatch ? parseFloat(zMatch[1]) : prevZ;

    const isCutting = z < 0;
    const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);

    // Detect lead-in (rapid to cutting transition)
    if (!wasCutting && isCutting && dist > 0) {
      const angle = Math.atan2(y - prevY, x - prevX) * 180 / Math.PI;
      entries.push({
        line: i, type: 'lead_in', distance: dist, angle,
      });
    }

    // Detect lead-out (cutting to rapid transition)
    if (wasCutting && !isCutting && dist > 0) {
      const angle = Math.atan2(y - prevY, x - prevX) * 180 / Math.PI;
      entries.push({
        line: i, type: 'lead_out', distance: dist, angle,
      });
    }

    wasCutting = isCutting;
    prevX = x; prevY = y; prevZ = z;
  }

  if (entries.length === 0) {
    return {
      entries: [], leadInCount: 0, leadOutCount: 0,
      avgLeadDistance: 0, qualityScore: 100,
      recommendations: ['No lead-in/lead-out moves detected'],
    };
  }

  const leadInCount = entries.filter(e => e.type === 'lead_in').length;
  const leadOutCount = entries.filter(e => e.type === 'lead_out').length;
  const avgLeadDistance = entries.reduce((s, e) => s + e.distance, 0) / entries.length;
  const qualityScore = Math.max(0, 100 - Math.abs(leadInCount - leadOutCount) * 5);

  const recommendations: string[] = [];
  recommendations.push(`${leadInCount} lead-ins, ${leadOutCount} lead-outs, avg ${avgLeadDistance.toFixed(2)}mm`);
  if (leadInCount !== leadOutCount) {
    recommendations.push(`Mismatched lead-in/out (${leadInCount} vs ${leadOutCount}) — verify toolpath`);
  }
  if (avgLeadDistance < 1) {
    recommendations.push('Short lead distances — may cause entry marks');
  }
  if (qualityScore > 85) {
    recommendations.push('Good lead-in/out balance — clean entry/exit');
  }

  return {
    entries, leadInCount, leadOutCount,
    avgLeadDistance, qualityScore, recommendations,
  };
}

// ── 11. Print Extrusion Consistency Per Layer Analyzer ──

export interface LayerExtrusionConsistency {
  /** Layer number */
  layer: number;
  /** Z height */
  zHeight: number;
  /** Average extrusion per mm */
  avgExtrusionPerMm: number;
  /** Coefficient of variation */
  cv: number;
  /** Is consistent */
  isConsistent: boolean;
}

export interface ExtrusionConsistencyPerLayerResult {
  /** Per-layer extrusion consistency */
  layers: LayerExtrusionConsistency[];
  /** Layer count */
  layerCount: number;
  /** Overall consistency score (0-100) */
  overallConsistencyScore: number;
  /** Inconsistent layer count */
  inconsistentLayerCount: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze extrusion consistency per layer.
 * Inconsistent extrusion within a layer causes weak spots.
 *
 * @param lines G-code lines
 * @param threshold CV threshold for consistency (default 0.15)
 */
export function analyzeExtrusionConsistencyPerLayer(
  lines: string[],
  threshold: number = 0.15,
): ExtrusionConsistencyPerLayerResult {
  const layers: LayerExtrusionConsistency[] = [];
  let prevX = 0, prevY = 0, prevZ = 0, prevE = 0;
  let currentZ = 0;
  let layerNum = 0;
  let layerExtrusionRates: number[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG1\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const z = zMatch ? parseFloat(zMatch[1]) : prevZ;
    const e = eMatch ? parseFloat(eMatch[1]) : prevE;

    // Detect layer change
    if (z > currentZ + 0.01 && layerNum > 0) {
      if (layerExtrusionRates.length > 0) {
        const avg = layerExtrusionRates.reduce((a, b) => a + b, 0) / layerExtrusionRates.length;
        const stdDev = Math.sqrt(layerExtrusionRates.reduce((s, r) => s + (r - avg) ** 2, 0) / layerExtrusionRates.length);
        const cv = avg > 0 ? stdDev / avg : 0;
        layers.push({
          layer: layerNum, zHeight: currentZ,
          avgExtrusionPerMm: avg, cv,
          isConsistent: cv <= threshold,
        });
      }
      layerNum++;
      currentZ = z;
      layerExtrusionRates = [];
    } else if (layerNum === 0) {
      currentZ = z;
      layerNum = 1;
    }

    // Track extrusion rate
    if (e > prevE) {
      const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
      if (dist > 0) {
        layerExtrusionRates.push((e - prevE) / dist);
      }
    }

    prevX = x; prevY = y; prevZ = z; prevE = e;
  }

  // Save last layer
  if (layerExtrusionRates.length > 0) {
    const avg = layerExtrusionRates.reduce((a, b) => a + b, 0) / layerExtrusionRates.length;
    const stdDev = Math.sqrt(layerExtrusionRates.reduce((s, r) => s + (r - avg) ** 2, 0) / layerExtrusionRates.length);
    const cv = avg > 0 ? stdDev / avg : 0;
    layers.push({
      layer: layerNum, zHeight: currentZ,
      avgExtrusionPerMm: avg, cv,
      isConsistent: cv <= threshold,
    });
  }

  if (layers.length === 0) {
    return {
      layers: [], layerCount: 0, overallConsistencyScore: 100,
      inconsistentLayerCount: 0,
      recommendations: ['No extrusion consistency data for per-layer analysis'],
    };
  }

  const inconsistentLayerCount = layers.filter(l => !l.isConsistent).length;
  const overallConsistencyScore = Math.max(0,
    100 - (inconsistentLayerCount / layers.length) * 100);

  const recommendations: string[] = [];
  recommendations.push(`${layers.length} layers, ${inconsistentLayerCount} inconsistent`);
  if (inconsistentLayerCount > layers.length * 0.3) {
    recommendations.push(`${inconsistentLayerCount} inconsistent layers — check extrusion settings`);
  }
  if (overallConsistencyScore > 85) {
    recommendations.push('Consistent extrusion across all layers');
  }

  return {
    layers, layerCount: layers.length, overallConsistencyScore,
    inconsistentLayerCount, recommendations,
  };
}

// ── 12. G-code Machine Coordinate Boundary Checker ──

export interface MachineBoundaryResult {
  /** Machine boundary */
  boundary: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
  /** Violations */
  violations: { line: number; axis: string; value: number; limit: number }[];
  /** Violation count */
  violationCount: number;
  /** Is within bounds */
  isWithinBounds: boolean;
  /** Safety score (0-100) */
  safetyScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Check if all coordinates are within machine boundaries.
 * Prevents crashes and damage from over-travel.
 *
 * @param lines G-code lines
 * @param machineBounds Machine boundary limits
 */
export function checkMachineCoordinateBoundary(
  lines: string[],
  machineBounds?: {
    minX: number; maxX: number;
    minY: number; maxY: number;
    minZ: number; maxZ: number;
  },
): MachineBoundaryResult {
  const bounds = machineBounds ?? {
    minX: -500, maxX: 500,
    minY: -500, maxY: 500,
    minZ: -500, maxZ: 500,
  };

  const violations: { line: number; axis: string; value: number; limit: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    if (xMatch) {
      const x = parseFloat(xMatch[1]);
      if (x < bounds.minX) violations.push({ line: i, axis: 'X', value: x, limit: bounds.minX });
      if (x > bounds.maxX) violations.push({ line: i, axis: 'X', value: x, limit: bounds.maxX });
    }

    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    if (yMatch) {
      const y = parseFloat(yMatch[1]);
      if (y < bounds.minY) violations.push({ line: i, axis: 'Y', value: y, limit: bounds.minY });
      if (y > bounds.maxY) violations.push({ line: i, axis: 'Y', value: y, limit: bounds.maxY });
    }

    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    if (zMatch) {
      const z = parseFloat(zMatch[1]);
      if (z < bounds.minZ) violations.push({ line: i, axis: 'Z', value: z, limit: bounds.minZ });
      if (z > bounds.maxZ) violations.push({ line: i, axis: 'Z', value: z, limit: bounds.maxZ });
    }
  }

  const violationCount = violations.length;
  const isWithinBounds = violationCount === 0;
  const safetyScore = Math.max(0, 100 - violationCount * 10);

  const recommendations: string[] = [];
  if (violationCount === 0) {
    recommendations.push('All coordinates within machine bounds');
  } else {
    recommendations.push(`${violationCount} boundary violations detected`);
  }
  for (const v of violations.slice(0, 5)) {
    recommendations.push(`Line ${v.line}: ${v.axis}=${v.value} exceeds limit ${v.limit}`);
  }
  if (safetyScore > 90) {
    recommendations.push('Safe coordinates — no over-travel risk');
  }

  return {
    boundary: bounds, violations, violationCount,
    isWithinBounds, safetyScore, recommendations,
  };
}
