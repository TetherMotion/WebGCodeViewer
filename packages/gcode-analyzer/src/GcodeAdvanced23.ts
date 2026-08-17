/**
 * @file GcodeAdvanced23.ts
 * @brief Twenty-third batch of advanced G-code analysis features for CNC and 3D printing.
 *
 * This module provides 12 additional high-impact features:
 *  1. CNC scallop height calculator (CNC) — scallop between passes
 *  2. Print filament diameter variance detector (3DP) — detect filament issues
 *  3. G-code coordinate system scale detector (Universal) — detect G51 scaling
 *  4. CNC chip thinning calculator (CNC) — radial chip thinning
 *  5. Print infill pattern angle analyzer (3DP) — analyze infill angles
 *  6. G-code toolpath segment length distribution (Universal) — move length stats
 *  7. CNC tool path stepover calculator (CNC) — stepover between passes
 *  8. Print extrusion multiplier calibrator (3DP) — calibrate extrusion multiplier
 *  9. G-code toolpath symmetry detector (Universal) — detect symmetric patterns
 * 10. CNC tool path retract plane optimizer (CNC) — optimize retract height
 * 11. Print skirt/brim gap analyzer (3DP) — gap between skirt/brim and part
 * 12. G-code program execution time estimator (Universal) — detailed time estimate
 */

// ── 1. CNC Scallop Height Calculator ──

export interface ScallopHeightResult {
  /** Scallop height in mm */
  scallopHeight: number;
  /** Stepover distance in mm */
  stepover: number;
  /** Tool radius in mm */
  toolRadius: number;
  /** Surface roughness Ra estimate in µm */
  estimatedRa: number;
  /** Surface roughness rating */
  roughnessRating: 'very_smooth' | 'smooth' | 'moderate' | 'rough' | 'very_rough';
  /** Pass count */
  passCount: number;
  /** Scallop height score (0-100, higher is smoother) */
  smoothnessScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Calculate scallop height between adjacent passes.
 * Scallop height determines surface finish quality after ball-end milling.
 *
 * @param lines G-code lines
 * @param toolDiameter Tool diameter in mm (default 6)
 */
export function calculateScallopHeight(
  lines: string[],
  toolDiameter: number = 6,
): ScallopHeightResult {
  const toolRadius = toolDiameter / 2;
  let prevY = 0;
  const yPositions: number[] = [];
  let passCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG1\b/i.test(code)) continue;

    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    if (yMatch) {
      const y = parseFloat(yMatch[1]);
      if (yPositions.length === 0 || Math.abs(y - yPositions[yPositions.length - 1]) > 0.01) {
        yPositions.push(y);
      }
      prevY = y;
    }
  }

  // Calculate stepover from Y positions
  const stepovers: number[] = [];
  for (let i = 1; i < yPositions.length; i++) {
    const step = Math.abs(yPositions[i] - yPositions[i - 1]);
    if (step > 0.1 && step < toolDiameter * 2) {
      stepovers.push(step);
    }
  }

  const stepover = stepovers.length > 0
    ? stepovers.reduce((a, b) => a + b, 0) / stepovers.length : 0;
  passCount = stepovers.length + 1;

  // Scallop height formula for ball-end mill: h = r - sqrt(r² - (s/2)²)
  let scallopHeight = 0;
  if (stepover > 0 && stepover <= toolDiameter) {
    scallopHeight = toolRadius - Math.sqrt(toolRadius * toolRadius - (stepover / 2) ** 2);
  }

  // Estimate Ra (roughness average) from scallop height
  const estimatedRa = scallopHeight * 1000 * 0.25; // convert to µm with factor

  const roughnessRating: ScallopHeightResult['roughnessRating'] =
    estimatedRa < 0.4 ? 'very_smooth'
    : estimatedRa < 1.6 ? 'smooth'
    : estimatedRa < 6.3 ? 'moderate'
    : estimatedRa < 25 ? 'rough' : 'very_rough';

  const smoothnessScore = Math.max(0, 100 - estimatedRa * 5);

  const recommendations: string[] = [];
  recommendations.push(`Scallop height: ${scallopHeight.toFixed(4)}mm, Ra: ${estimatedRa.toFixed(2)}µm (${roughnessRating})`);
  recommendations.push(`Stepover: ${stepover.toFixed(2)}mm, passes: ${passCount}`);
  if (estimatedRa > 6.3) {
    recommendations.push(`Rough surface — reduce stepover to ${toolRadius * 0.5}mm for better finish`);
  }
  if (stepover > toolRadius) {
    recommendations.push(`Stepover > tool radius — scallops will be large`);
  }
  if (smoothnessScore > 85) {
    recommendations.push('Very smooth surface — excellent finish expected');
  }

  return {
    scallopHeight, stepover, toolRadius, estimatedRa,
    roughnessRating, passCount, smoothnessScore, recommendations,
  };
}

// ── 2. Print Filament Diameter Variance Detector ──

export interface FilamentVarianceResult {
  /** Estimated filament diameter variance in mm */
  diameterVariance: number;
  /** Estimated avg diameter in mm */
  avgDiameter: number;
  /** Flow consistency indicator */
  flowConsistency: number;
  /** Variance episodes count */
  varianceEpisodes: number;
  /** Max variance spike in mm */
  maxVarianceSpike: number;
  /** Filament quality score (0-100) */
  qualityScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Detect filament diameter variance from extrusion patterns.
 * Inconsistent extrusion can indicate filament diameter variations.
 *
 * @param lines G-code lines
 * @param nominalDiameter Nominal filament diameter in mm (default 1.75)
 */
export function detectFilamentDiameterVariance(
  lines: string[],
  nominalDiameter: number = 1.75,
): FilamentVarianceResult {
  const flowRates: number[] = [];
  let prevX = 0, prevY = 0, prevE = 0;
  let feedRate = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG1\b/i.test(code)) continue;

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) feedRate = parseFloat(fMatch[1]);

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const e = eMatch ? parseFloat(eMatch[1]) : prevE;

    if (e > prevE && feedRate > 0) {
      const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
      if (dist > 0) {
        const eDelta = e - prevE;
        const flowRate = eDelta / dist;
        flowRates.push(flowRate);
      }
    }

    prevX = x; prevY = y; prevE = e;
  }

  if (flowRates.length < 10) {
    return {
      diameterVariance: 0, avgDiameter: nominalDiameter,
      flowConsistency: 100, varianceEpisodes: 0,
      maxVarianceSpike: 0, qualityScore: 100,
      recommendations: ['Insufficient data for filament variance analysis'],
    };
  }

  const avgFlow = flowRates.reduce((a, b) => a + b, 0) / flowRates.length;
  const stdDev = Math.sqrt(flowRates.reduce((s, f) => s + (f - avgFlow) ** 2, 0) / flowRates.length);
  const cv = avgFlow > 0 ? stdDev / avgFlow : 0;

  // Estimate diameter variance from flow variance
  const diameterVariance = cv * nominalDiameter;
  const avgDiameter = nominalDiameter; // nominal
  const flowConsistency = Math.max(0, 100 - cv * 100);

  // Detect variance episodes (consecutive outliers)
  let varianceEpisodes = 0;
  let inEpisode = false;
  let maxVarianceSpike = 0;
  for (const f of flowRates) {
    const deviation = Math.abs(f - avgFlow);
    const spike = (deviation / avgFlow) * nominalDiameter;
    maxVarianceSpike = Math.max(maxVarianceSpike, spike);
    if (deviation > 2 * stdDev) {
      if (!inEpisode) {
        varianceEpisodes++;
        inEpisode = true;
      }
    } else {
      inEpisode = false;
    }
  }

  const qualityScore = Math.max(0, 100 - diameterVariance * 50 - varianceEpisodes * 2);

  const recommendations: string[] = [];
  recommendations.push(`Estimated diameter variance: ±${diameterVariance.toFixed(4)}mm (nominal ${nominalDiameter}mm)`);
  if (diameterVariance > 0.05) {
    recommendations.push(`High diameter variance — check filament quality`);
  }
  if (varianceEpisodes > 5) {
    recommendations.push(`${varianceEpisodes} variance episodes — filament may be inconsistent`);
  }
  if (maxVarianceSpike > 0.1) {
    recommendations.push(`Max variance spike ${maxVarianceSpike.toFixed(3)}mm — possible filament defect`);
  }
  if (qualityScore > 85) {
    recommendations.push('Consistent filament — good print quality expected');
  }

  return {
    diameterVariance, avgDiameter, flowConsistency,
    varianceEpisodes, maxVarianceSpike, qualityScore,
    recommendations,
  };
}

// ── 3. G-code Coordinate System Scale Detector ──

export interface ScaleEvent {
  /** Line number */
  line: number;
  /** Scale type */
  type: 'G51' | 'G50';
  /** X scale factor */
  xScale: number;
  /** Y scale factor */
  yScale: number;
  /** Z scale factor */
  zScale: number;
}

export interface ScaleDetectionResult {
  /** All scale events */
  events: ScaleEvent[];
  /** Event count */
  count: number;
  /** Active scales */
  activeScales: { x: number; y: number; z: number };
  /** Is scaling active at end */
  activeAtEnd: boolean;
  /** Max scale factor */
  maxScale: number;
  /** Min scale factor */
  minScale: number;
  /** Scale complexity score (0-100) */
  complexityScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Detect coordinate system scaling commands.
 * Identifies G51 (scale) and G50 (cancel scale) commands.
 *
 * @param lines G-code lines
 */
export function detectCoordinateScaling(lines: string[]): ScaleDetectionResult {
  const events: ScaleEvent[] = [];
  let activeScales = { x: 1, y: 1, z: 1 };
  let activeAtEnd = false;
  let maxScale = 1;
  let minScale = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    if (/\bG51\b/i.test(code)) {
      const xMatch = code.match(/\b[IX](-?\d*\.?\d+)/i);
      const yMatch = code.match(/\b[JY](-?\d*\.?\d+)/i);
      const zMatch = code.match(/\b[KZ](-?\d*\.?\d+)/i);

      const xScale = xMatch ? parseFloat(xMatch[1]) : 1;
      const yScale = yMatch ? parseFloat(yMatch[1]) : 1;
      const zScale = zMatch ? parseFloat(zMatch[1]) : 1;

      events.push({ line: i, type: 'G51', xScale, yScale, zScale });
      activeScales = { x: xScale, y: yScale, z: zScale };
      activeAtEnd = true;
      maxScale = Math.max(maxScale, xScale, yScale, zScale);
      minScale = Math.min(minScale, xScale, yScale, zScale);
    }

    if (/\bG50\b/i.test(code)) {
      events.push({ line: i, type: 'G50', xScale: 1, yScale: 1, zScale: 1 });
      activeScales = { x: 1, y: 1, z: 1 };
      activeAtEnd = false;
    }
  }

  const count = events.length;
  const scaleRange = maxScale - minScale;
  const complexityScore = Math.min(100, count * 15 + scaleRange * 20);

  const recommendations: string[] = [];
  if (count > 0) {
    recommendations.push(`${count} scale events, range ${minScale.toFixed(2)}× to ${maxScale.toFixed(2)}×`);
  }
  if (activeAtEnd) {
    recommendations.push(`Scaling active at end — add G50 to cancel`);
  }
  if (maxScale > 2 || minScale < 0.5) {
    recommendations.push(`Extreme scale factor — verify part dimensions`);
  }
  if (count === 0) {
    recommendations.push('No coordinate scaling detected');
  }
  if (complexityScore > 60) {
    recommendations.push('Complex scaling — verify coordinate transformations');
  }

  return {
    events, count, activeScales, activeAtEnd,
    maxScale, minScale, complexityScore, recommendations,
  };
}

// ── 4. CNC Chip Thinning Calculator ──

export interface ChipThinningResult {
  /** Nominal chip load in mm */
  nominalChipLoad: number;
  /** Effective chip thickness in mm */
  effectiveChipThickness: number;
  /** Chip thinning factor */
  thinningFactor: number;
  /** Recommended feed rate in mm/min */
  recommendedFeed: number;
  /** Current feed rate in mm/min */
  currentFeed: number;
  /** Radial engagement percentage */
  radialEngagement: number;
  /** Feed optimization potential percentage */
  optimizationPotential: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Calculate radial chip thinning effect.
 * When radial engagement is less than tool radius, chip thinning occurs
 * and feed rate can be increased to maintain chip load.
 *
 * @param lines G-code lines
 * @param toolDiameter Tool diameter in mm (default 6)
 * @param flutes Number of flutes (default 2)
 */
export function calculateChipThinning(
  lines: string[],
  toolDiameter: number = 6,
  flutes: number = 2,
): ChipThinningResult {
  let feedRate = 0;
  let rpm = 0;
  let prevX = 0, prevY = 0, prevZ = 0;
  let totalRadialEngagement = 0;
  let engagementCount = 0;

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

    // Estimate radial engagement from Y stepover
    const yStep = Math.abs(y - prevY);
    if (z < 0 && yStep > 0 && yStep < toolDiameter) {
      const radialEngagement = (yStep / toolDiameter) * 100;
      totalRadialEngagement += radialEngagement;
      engagementCount++;
    }

    prevX = x; prevY = y; prevZ = z;
  }

  const radialEngagement = engagementCount > 0
    ? totalRadialEngagement / engagementCount : 100;
  const toolRadius = toolDiameter / 2;

  // Nominal chip load
  const nominalChipLoad = rpm > 0 ? feedRate / (rpm * flutes) : 0;

  // Chip thinning factor: when radial engagement < 50%, chip thins
  // CT factor = toolRadius / sqrt(toolRadius * radialDepth)
  const radialDepth = (radialEngagement / 100) * toolDiameter;
  const thinningFactor = radialDepth < toolRadius && radialDepth > 0
    ? toolRadius / Math.sqrt(toolRadius * radialDepth) : 1;

  const effectiveChipThickness = nominalChipLoad / thinningFactor;
  const recommendedFeed = nominalChipLoad > 0
    ? Math.round(feedRate * thinningFactor) : 0;
  const optimizationPotential = feedRate > 0 && recommendedFeed > 0
    ? ((recommendedFeed - feedRate) / feedRate) * 100 : 0;

  const recommendations: string[] = [];
  recommendations.push(`Radial engagement: ${radialEngagement.toFixed(0)}%, thinning factor: ${thinningFactor.toFixed(2)}×`);
  if (radialEngagement < 50) {
    recommendations.push(`Chip thinning active — can increase feed to ${recommendedFeed}mm/min (${optimizationPotential.toFixed(0)}% faster)`);
  }
  if (nominalChipLoad > 0) {
    recommendations.push(`Nominal chip load: ${nominalChipLoad.toFixed(4)}mm, effective: ${effectiveChipThickness.toFixed(4)}mm`);
  }
  if (optimizationPotential > 20) {
    recommendations.push(`Significant feed optimization possible — ${optimizationPotential.toFixed(0)}% increase`);
  }
  if (radialEngagement >= 50) {
    recommendations.push('No chip thinning — full-width cut');
  }

  return {
    nominalChipLoad, effectiveChipThickness, thinningFactor,
    recommendedFeed, currentFeed: feedRate, radialEngagement,
    optimizationPotential, recommendations,
  };
}

// ── 5. Print Infill Pattern Angle Analyzer ──

export interface InfillAngleResult {
  /** Detected infill angles in degrees */
  angles: number[];
  /** Primary angle in degrees */
  primaryAngle: number;
  /** Angle count */
  angleCount: number;
  /** Angle distribution */
  distribution: { [angle: string]: number };
  /** Is multi-angle infill */
  isMultiAngle: boolean;
  /** Angle consistency score (0-100) */
  consistencyScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze infill pattern angles.
 * Detects the primary angles used in infill patterns.
 *
 * @param lines G-code lines
 */
export function analyzeInfillAngles(lines: string[]): InfillAngleResult {
  let prevX = 0, prevY = 0;
  let isInfill = false;
  const angles: number[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check for infill comments
    if (/;.*infill/i.test(trimmed) || /\(.*infill/i.test(trimmed)) {
      isInfill = /;.*infill/i.test(trimmed);
    }

    if (trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG1\b/i.test(code)) continue;

    if (!isInfill) {
      const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
      prevX = xMatch ? parseFloat(xMatch[1]) : prevX;
      prevY = yMatch ? parseFloat(yMatch[1]) : prevY;
      continue;
    }

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;

    const dx = x - prevX;
    const dy = y - prevY;
    if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
      let angle = Math.atan2(dy, dx) * 180 / Math.PI;
      if (angle < 0) angle += 180; // Normalize to 0-180
      angles.push(angle);
    }

    prevX = x; prevY = y;
  }

  if (angles.length === 0) {
    return {
      angles: [], primaryAngle: 0, angleCount: 0,
      distribution: {}, isMultiAngle: false, consistencyScore: 100,
      recommendations: ['No infill angles detected'],
    };
  }

  // Round angles to nearest 5 degrees and count
  const rounded = angles.map(a => Math.round(a / 5) * 5);
  const distribution: { [angle: string]: number } = {};
  for (const a of rounded) {
    const key = `${a}°`;
    distribution[key] = (distribution[key] ?? 0) + 1;
  }

  // Find primary angle
  let primaryAngle = 0;
  let maxCount = 0;
  for (const [key, count] of Object.entries(distribution)) {
    if (count > maxCount) {
      maxCount = count;
      primaryAngle = parseInt(key);
    }
  }

  const angleCount = Object.keys(distribution).length;
  const isMultiAngle = angleCount > 2;
  const consistencyScore = Math.max(0, 100 - (angleCount - 1) * 15);

  const recommendations: string[] = [];
  recommendations.push(`Primary infill angle: ${primaryAngle}°, ${angleCount} unique angles`);
  if (isMultiAngle) {
    recommendations.push('Multi-angle infill — complex pattern detected');
  }
  if (primaryAngle === 45 || primaryAngle === 135) {
    recommendations.push('Diagonal infill — good strength distribution');
  }
  if (primaryAngle === 0 || primaryAngle === 90) {
    recommendations.push('Axis-aligned infill — weaker in shear');
  }
  if (consistencyScore > 80) {
    recommendations.push('Consistent infill angle — uniform strength');
  }

  return {
    angles: rounded, primaryAngle, angleCount,
    distribution, isMultiAngle, consistencyScore,
    recommendations,
  };
}

// ── 6. G-code Toolpath Segment Length Distribution ──

export interface SegmentLengthResult {
  /** Total segments */
  totalSegments: number;
  /** Average segment length in mm */
  avgLength: number;
  /** Min segment length in mm */
  minLength: number;
  /** Max segment length in mm */
  maxLength: number;
  /** Median segment length in mm */
  medianLength: number;
  /** Length distribution by category */
  distribution: { [category: string]: number };
  /** Standard deviation */
  stdDev: number;
  /** Uniformity score (0-100) */
  uniformityScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze distribution of toolpath segment lengths.
 * Helps identify fragmented toolpaths or inconsistent move sizes.
 *
 * @param lines G-code lines
 */
export function analyzeSegmentLengthDistribution(lines: string[]): SegmentLengthResult {
  const lengths: number[] = [];
  let prevX = 0, prevY = 0, prevZ = 0;

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

    const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2 + (z - prevZ) ** 2);
    if (dist > 0.001) {
      lengths.push(dist);
    }

    prevX = x; prevY = y; prevZ = z;
  }

  if (lengths.length === 0) {
    return {
      totalSegments: 0, avgLength: 0, minLength: 0,
      maxLength: 0, medianLength: 0, distribution: {},
      stdDev: 0, uniformityScore: 100,
      recommendations: ['No segments detected for length analysis'],
    };
  }

  const totalSegments = lengths.length;
  const avgLength = lengths.reduce((a, b) => a + b, 0) / totalSegments;
  const minLength = Math.min(...lengths);
  const maxLength = Math.max(...lengths);
  const sorted = [...lengths].sort((a, b) => a - b);
  const medianLength = sorted[Math.floor(sorted.length / 2)];
  const stdDev = Math.sqrt(lengths.reduce((s, l) => s + (l - avgLength) ** 2, 0) / totalSegments);

  // Categorize lengths
  const distribution: { [category: string]: number } = {};
  for (const l of lengths) {
    const category = l < 1 ? 'micro (<1mm)'
      : l < 10 ? 'short (1-10mm)'
      : l < 50 ? 'medium (10-50mm)'
      : l < 100 ? 'long (50-100mm)' : 'very_long (>100mm)';
    distribution[category] = (distribution[category] ?? 0) + 1;
  }

  const cv = avgLength > 0 ? stdDev / avgLength : 0;
  const uniformityScore = Math.max(0, 100 - cv * 50);

  const recommendations: string[] = [];
  recommendations.push(`${totalSegments} segments, avg ${avgLength.toFixed(2)}mm, range ${minLength.toFixed(2)}-${maxLength.toFixed(2)}mm`);
  for (const [cat, count] of Object.entries(distribution)) {
    recommendations.push(`${cat}: ${count} segments`);
  }
  if (distribution['micro (<1mm)'] > totalSegments * 0.5) {
    recommendations.push('Many micro segments — toolpath may be fragmented');
  }
  if (cv > 1) {
    recommendations.push(`High length variation (CV=${cv.toFixed(2)}) — inconsistent move sizes`);
  }
  if (uniformityScore > 80) {
    recommendations.push('Uniform segment lengths — consistent toolpath');
  }

  return {
    totalSegments, avgLength, minLength, maxLength,
    medianLength, distribution, stdDev, uniformityScore,
    recommendations,
  };
}

// ── 7. CNC Tool Path Stepover Calculator ──

export interface StepoverResult {
  /** Average stepover in mm */
  avgStepover: number;
  /** Min stepover in mm */
  minStepover: number;
  /** Max stepover in mm */
  maxStepover: number;
  /** Stepover as percentage of tool diameter */
  stepoverPercentage: number;
  /** Pass count */
  passCount: number;
  /** Stepover consistency score (0-100) */
  consistencyScore: number;
  /** Stepover type */
  stepoverType: 'constant' | 'variable' | 'adaptive';
  /** Recommendations */
  recommendations: string[];
}

/**
 * Calculate stepover between adjacent passes.
 * Stepover determines surface finish and machining time.
 *
 * @param lines G-code lines
 * @param toolDiameter Tool diameter in mm (default 6)
 */
export function calculateStepover(
  lines: string[],
  toolDiameter: number = 6,
): StepoverResult {
  let prevY = 0;
  const stepovers: number[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG1\b/i.test(code)) continue;

    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    if (yMatch) {
      const y = parseFloat(yMatch[1]);
      const step = Math.abs(y - prevY);
      if (step > 0.01 && step < toolDiameter * 2) {
        stepovers.push(step);
      }
      prevY = y;
    }
  }

  if (stepovers.length === 0) {
    return {
      avgStepover: 0, minStepover: 0, maxStepover: 0,
      stepoverPercentage: 0, passCount: 0, consistencyScore: 100,
      stepoverType: 'constant',
      recommendations: ['No stepover data detected'],
    };
  }

  const avgStepover = stepovers.reduce((a, b) => a + b, 0) / stepovers.length;
  const minStepover = Math.min(...stepovers);
  const maxStepover = Math.max(...stepovers);
  const stepoverPercentage = (avgStepover / toolDiameter) * 100;
  const passCount = stepovers.length + 1;

  // Determine consistency
  const stdDev = Math.sqrt(stepovers.reduce((s, st) => s + (st - avgStepover) ** 2, 0) / stepovers.length);
  const cv = avgStepover > 0 ? stdDev / avgStepover : 0;
  const consistencyScore = Math.max(0, 100 - cv * 100);

  const stepoverType: StepoverResult['stepoverType'] =
    cv < 0.05 ? 'constant' : cv < 0.3 ? 'variable' : 'adaptive';

  const recommendations: string[] = [];
  recommendations.push(`Avg stepover: ${avgStepover.toFixed(3)}mm (${stepoverPercentage.toFixed(1)}% of tool), ${passCount} passes`);
  if (stepoverPercentage > 75) {
    recommendations.push(`Large stepover (${stepoverPercentage.toFixed(0)}%) — rough finish expected`);
  }
  if (stepoverPercentage < 20) {
    recommendations.push(`Small stepover (${stepoverPercentage.toFixed(0)}%) — fine finish but slow`);
  }
  if (stepoverType === 'adaptive') {
    recommendations.push('Adaptive stepover — varies between passes');
  }
  if (consistencyScore > 90) {
    recommendations.push('Consistent stepover — uniform surface finish');
  }

  return {
    avgStepover, minStepover, maxStepover, stepoverPercentage,
    passCount, consistencyScore, stepoverType, recommendations,
  };
}

// ── 8. Print Extrusion Multiplier Calibrator ──

export interface ExtrusionMultiplierResult {
  /** Current extrusion multiplier */
  currentMultiplier: number;
  /** Recommended extrusion multiplier */
  recommendedMultiplier: number;
  /** Flow rate deviation percentage */
  flowDeviation: number;
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
 * Calibrate extrusion multiplier.
 * Recommends multiplier adjustment based on flow rate analysis.
 *
 * @param lines G-code lines
 * @param nominalMultiplier Current nominal multiplier (default 1.0)
 */
export function calibrateExtrusionMultiplier(
  lines: string[],
  nominalMultiplier: number = 1.0,
): ExtrusionMultiplierResult {
  const flowRates: number[] = [];
  let prevX = 0, prevY = 0, prevE = 0;
  let feedRate = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG1\b/i.test(code)) continue;

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
        const expectedFlow = dist * 0.4; // expected for 0.4mm nozzle
        const actualFlow = (e - prevE) * 0.4;
        const ratio = expectedFlow > 0 ? actualFlow / expectedFlow : 1;
        flowRates.push(ratio);
      }
    }

    prevX = x; prevY = y; prevE = e;
  }

  if (flowRates.length < 10) {
    return {
      currentMultiplier: nominalMultiplier,
      recommendedMultiplier: nominalMultiplier,
      flowDeviation: 0, overExtrusion: false, underExtrusion: false,
      calibrationScore: 100,
      recommendations: ['Insufficient data for extrusion calibration'],
    };
  }

  const avgRatio = flowRates.reduce((a, b) => a + b, 0) / flowRates.length;
  const flowDeviation = (avgRatio - 1) * 100;
  const currentMultiplier = nominalMultiplier;
  const recommendedMultiplier = nominalMultiplier / avgRatio;

  const overExtrusion = flowDeviation > 5;
  const underExtrusion = flowDeviation < -5;
  const calibrationScore = Math.max(0, 100 - Math.abs(flowDeviation) * 2);

  const recommendations: string[] = [];
  recommendations.push(`Flow deviation: ${flowDeviation.toFixed(1)}%, recommended multiplier: ${recommendedMultiplier.toFixed(3)}`);
  if (overExtrusion) {
    recommendations.push(`Over-extrusion detected — reduce multiplier to ${recommendedMultiplier.toFixed(3)}`);
  }
  if (underExtrusion) {
    recommendations.push(`Under-extrusion detected — increase multiplier to ${recommendedMultiplier.toFixed(3)}`);
  }
  if (Math.abs(flowDeviation) < 3) {
    recommendations.push('Well-calibrated extrusion — minimal adjustment needed');
  }
  if (calibrationScore > 90) {
    recommendations.push('Excellent extrusion calibration — good flow rate');
  }

  return {
    currentMultiplier, recommendedMultiplier, flowDeviation,
    overExtrusion, underExtrusion, calibrationScore,
    recommendations,
  };
}

// ── 9. G-code Toolpath Symmetry Detector ──

export interface SymmetryResult {
  /** Is symmetric */
  isSymmetric: boolean;
  /** Symmetry type */
  symmetryType: 'none' | 'mirror_x' | 'mirror_y' | 'rotational' | 'bilateral';
  /** Symmetry score (0-100) */
  symmetryScore: number;
  /** Symmetry axis or center */
  symmetryAxis: { x: number } | { y: number } | null;
  /** Matched points percentage */
  matchedPercentage: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Detect symmetric patterns in the toolpath.
 * Identifies mirror or rotational symmetry.
 *
 * @param lines G-code lines
 * @param tolerance Position tolerance in mm (default 0.5)
 */
export function detectToolpathSymmetry(
  lines: string[],
  tolerance: number = 0.5,
): SymmetryResult {
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

  if (positions.length < 20) {
    return {
      isSymmetric: false, symmetryType: 'none', symmetryScore: 0,
      symmetryAxis: null, matchedPercentage: 0,
      recommendations: ['Insufficient points for symmetry analysis'],
    };
  }

  // Calculate bounding box center
  const xs = positions.map(p => p.x);
  const ys = positions.map(p => p.y);
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;

  // Check X-axis mirror symmetry
  let xMirrorMatches = 0;
  for (const p of positions) {
    const mirror = { x: 2 * centerX - p.x, y: p.y };
    if (positions.some(p2 => Math.abs(p2.x - mirror.x) < tolerance && Math.abs(p2.y - mirror.y) < tolerance)) {
      xMirrorMatches++;
    }
  }
  const xMirrorPercentage = (xMirrorMatches / positions.length) * 100;

  // Check Y-axis mirror symmetry
  let yMirrorMatches = 0;
  for (const p of positions) {
    const mirror = { x: p.x, y: 2 * centerY - p.y };
    if (positions.some(p2 => Math.abs(p2.x - mirror.x) < tolerance && Math.abs(p2.y - mirror.y) < tolerance)) {
      yMirrorMatches++;
    }
  }
  const yMirrorPercentage = (yMirrorMatches / positions.length) * 100;

  // Determine best symmetry
  let symmetryType: SymmetryResult['symmetryType'] = 'none';
  let matchedPercentage = 0;
  let symmetryAxis: { x: number } | { y: number } | null = null;

  if (xMirrorPercentage > 70) {
    symmetryType = 'mirror_x';
    matchedPercentage = xMirrorPercentage;
    symmetryAxis = { x: centerX };
  } else if (yMirrorPercentage > 70) {
    symmetryType = 'mirror_y';
    matchedPercentage = yMirrorPercentage;
    symmetryAxis = { y: centerY };
  } else if (xMirrorPercentage > 50 && yMirrorPercentage > 50) {
    symmetryType = 'bilateral';
    matchedPercentage = (xMirrorPercentage + yMirrorPercentage) / 2;
  }

  const isSymmetric = matchedPercentage > 70;
  const symmetryScore = Math.round(matchedPercentage);

  const recommendations: string[] = [];
  if (isSymmetric) {
    recommendations.push(`${symmetryType} symmetry detected (${matchedPercentage.toFixed(0)}% match)`);
    if (symmetryAxis && 'x' in symmetryAxis) {
      recommendations.push(`Symmetry axis at X=${symmetryAxis.x.toFixed(2)}`);
    } else if (symmetryAxis && 'y' in symmetryAxis) {
      recommendations.push(`Symmetry axis at Y=${symmetryAxis.y.toFixed(2)}`);
    }
    recommendations.push('Symmetric part — can use subprograms for mirrored operations');
  } else {
    recommendations.push(`No significant symmetry detected (best match: ${matchedPercentage.toFixed(0)}%)`);
  }
  if (symmetryType === 'bilateral') {
    recommendations.push('Bilateral symmetry — part is symmetric in both X and Y');
  }

  return {
    isSymmetric, symmetryType, symmetryScore,
    symmetryAxis, matchedPercentage, recommendations,
  };
}

// ── 10. CNC Tool Path Retract Plane Optimizer ──

export interface RetractPlaneResult {
  /** Current retract height in mm */
  currentRetractHeight: number;
  /** Recommended retract height in mm */
  recommendedRetractHeight: number;
  /** Retract count */
  retractCount: number;
  /** Total retract distance in mm */
  totalRetractDistance: number;
  /** Time spent on retracts in seconds */
  retractTime: number;
  /** Safety margin in mm */
  safetyMargin: number;
  /** Optimization score (0-100) */
  optimizationScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Optimize retract plane height.
 * Reduces unnecessary Z-axis travel while maintaining safety.
 *
 * @param lines G-code lines
 * @param maxPartHeight Maximum part height in mm (default 50)
 */
export function optimizeRetractPlane(
  lines: string[],
  maxPartHeight: number = 50,
): RetractPlaneResult {
  let prevZ = 0;
  let retractCount = 0;
  let totalRetractDistance = 0;
  let retractHeights: number[] = [];
  let feedRate = 0;
  let retractTime = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) feedRate = parseFloat(fMatch[1]);

    if (!/\bG0\b/i.test(code)) continue;

    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    if (zMatch) {
      const z = parseFloat(zMatch[1]);
      if (z > prevZ + 1) {
        retractCount++;
        const retractDist = z - prevZ;
        totalRetractDistance += retractDist;
        retractHeights.push(z);
        if (feedRate > 0) {
          retractTime += retractDist / (feedRate / 60);
        }
      }
      prevZ = z;
    }
  }

  if (retractCount === 0) {
    return {
      currentRetractHeight: 0, recommendedRetractHeight: 5,
      retractCount: 0, totalRetractDistance: 0, retractTime: 0,
      safetyMargin: 5, optimizationScore: 100,
      recommendations: ['No retract moves detected'],
    };
  }

  const currentRetractHeight = retractHeights.reduce((a, b) => a + b, 0) / retractHeights.length;
  const maxRetractHeight = Math.max(...retractHeights);

  // Recommended: minimal safe height above part
  const safetyMargin = 2; // 2mm above part
  const recommendedRetractHeight = Math.min(maxRetractHeight, maxPartHeight + safetyMargin);

  const potentialSavings = (currentRetractHeight - recommendedRetractHeight) * retractCount;
  const optimizationScore = Math.max(0, 100 - (potentialSavings / totalRetractDistance) * 100);

  const recommendations: string[] = [];
  recommendations.push(`Current retract: ${currentRetractHeight.toFixed(1)}mm, recommended: ${recommendedRetractHeight.toFixed(1)}mm`);
  recommendations.push(`${retractCount} retracts, ${totalRetractDistance.toFixed(0)}mm total, ${retractTime.toFixed(1)}s`);
  if (currentRetractHeight > recommendedRetractHeight + 5) {
    recommendations.push(`Reduce retract height by ${(currentRetractHeight - recommendedRetractHeight).toFixed(1)}mm — save ${potentialSavings.toFixed(0)}mm travel`);
  }
  if (retractTime > 30) {
    recommendations.push(`Significant retract time (${retractTime.toFixed(0)}s) — optimize for faster cycle`);
  }
  if (optimizationScore > 85) {
    recommendations.push('Well-optimized retract plane — minimal waste');
  }

  return {
    currentRetractHeight, recommendedRetractHeight,
    retractCount, totalRetractDistance, retractTime,
    safetyMargin, optimizationScore, recommendations,
  };
}

// ── 11. Print Skirt/Brim Gap Analyzer ──

export interface SkirtBrimGapResult {
  /** Gap between skirt/brim and part in mm */
  gap: number;
  /** Skirt/brim type */
  type: 'skirt' | 'brim' | 'none';
  /** Skirt/brim line count */
  lineCount: number;
  /** Skirt/brim distance from part in mm */
  distanceFromPart: number;
  /** Is gap optimal */
  isOptimal: boolean;
  /** Gap quality score (0-100) */
  gapScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze gap between skirt/brim and part.
 * Optimal gap ensures proper priming without interfering with the part.
 *
 * @param lines G-code lines
 */
export function analyzeSkirtBrimGap(lines: string[]): SkirtBrimGapResult {
  let isSkirtBrim = false;
  let type: 'skirt' | 'brim' | 'none' = 'none';
  let prevX = 0, prevY = 0;
  const skirtBrimPositions: { x: number; y: number }[] = [];
  const partPositions: { x: number; y: number }[] = [];
  let lineCount = 0;
  let firstZ = 0;
  let currentZ = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (/;.*skirt/i.test(trimmed)) { isSkirtBrim = true; type = 'skirt'; }
    else if (/;.*brim/i.test(trimmed)) { isSkirtBrim = true; type = 'brim'; }
    else if (/^;\s*(layer|perimeter|infill|solid|outer|inner)/i.test(trimmed)) { isSkirtBrim = false; }

    if (trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG1\b/i.test(code)) continue;

    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    if (zMatch) {
      const z = parseFloat(zMatch[1]);
      if (firstZ === 0) firstZ = z;
      currentZ = z;
      if (z > firstZ + 0.01) isSkirtBrim = false;
    }

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;

    if (isSkirtBrim) {
      skirtBrimPositions.push({ x, y });
      lineCount++;
    } else {
      partPositions.push({ x, y });
    }

    prevX = x; prevY = y;
  }

  if (skirtBrimPositions.length === 0 || partPositions.length === 0) {
    return {
      gap: 0, type: 'none', lineCount: 0, distanceFromPart: 0,
      isOptimal: false, gapScore: 0,
      recommendations: ['No skirt/brim detected for gap analysis'],
    };
  }

  // Calculate minimum distance between skirt/brim and part
  let minDist = Infinity;
  for (const sp of skirtBrimPositions) {
    for (const pp of partPositions) {
      const dist = Math.sqrt((sp.x - pp.x) ** 2 + (sp.y - pp.y) ** 2);
      if (dist < minDist) minDist = dist;
    }
  }

  const gap = minDist === Infinity ? 0 : minDist;
  const distanceFromPart = gap;
  const isOptimal = type === 'brim' ? gap < 1 : gap >= 2 && gap <= 10;
  const gapScore = isOptimal ? 100 : Math.max(0, 100 - Math.abs(gap - (type === 'brim' ? 0 : 5)) * 10);

  const recommendations: string[] = [];
  recommendations.push(`${type} detected, gap: ${gap.toFixed(2)}mm, ${lineCount} segments`);
  if (type === 'skirt' && gap < 2) {
    recommendations.push(`Skirt too close (${gap.toFixed(1)}mm) — increase to 3-5mm`);
  }
  if (type === 'skirt' && gap > 10) {
    recommendations.push(`Skirt too far (${gap.toFixed(1)}mm) — reduce to 3-5mm for better priming`);
  }
  if (type === 'brim' && gap > 1) {
    recommendations.push(`Brim gap too large (${gap.toFixed(1)}mm) — should be connected to part`);
  }
  if (isOptimal) {
    recommendations.push(`Optimal ${type} gap — good adhesion aid`);
  }

  return {
    gap, type, lineCount, distanceFromPart,
    isOptimal, gapScore, recommendations,
  };
}

// ── 12. G-code Program Execution Time Estimator ──

export interface ExecutionTimeResult {
  /** Total estimated time in seconds */
  totalTime: number;
  /** Cutting/extrusion time in seconds */
  cuttingTime: number;
  /** Travel time in seconds */
  travelTime: number;
  /** Dwell time in seconds */
  dwellTime: number;
  /** Tool change time in seconds */
  toolChangeTime: number;
  /** Time breakdown by category */
  breakdown: { [category: string]: number };
  /** Time per layer (3DP) */
  timePerLayer: { layer: number; time: number }[];
  /** Efficiency percentage */
  efficiency: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Estimate detailed program execution time.
 * Breaks down time by cutting, travel, dwell, and tool changes.
 *
 * @param lines G-code lines
 * @param toolChangeTimePerChange Time per tool change in seconds (default 10)
 */
export function estimateExecutionTime(
  lines: string[],
  toolChangeTimePerChange: number = 10,
): ExecutionTimeResult {
  let prevX = 0, prevY = 0, prevZ = 0;
  let feedRate = 0;
  let cuttingTime = 0;
  let travelTime = 0;
  let dwellTime = 0;
  let toolChanges = 0;
  let currentTool = -1;
  let firstZ = 0;
  let currentZ = 0;
  let layerNum = 0;
  let layerStartTime = 0;
  let currentTime = 0;
  const timePerLayer: { layer: number; time: number }[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Tool change
    const tMatch = code.match(/\bT(\d+)/i);
    if (tMatch) {
      const tool = parseInt(tMatch[1]);
      if (currentTool >= 0 && tool !== currentTool) {
        toolChanges++;
      }
      currentTool = tool;
    }

    // M6 tool change
    if (/\bM6\b/i.test(code)) {
      // tool change time already counted above
    }

    // Dwell
    const dwellMatch = code.match(/\bG4\b/i);
    if (dwellMatch) {
      const pMatch = code.match(/\bP(\d*\.?\d+)/i);
      const sMatch = code.match(/\bS(\d*\.?\d+)/i);
      if (pMatch) dwellTime += parseFloat(pMatch[1]) / 1000;
      else if (sMatch) dwellTime += parseFloat(sMatch[1]);
    }

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) feedRate = parseFloat(fMatch[1]);

    if (!/\bG[01]\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const z = zMatch ? parseFloat(zMatch[1]) : prevZ;

    const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2 + (z - prevZ) ** 2);
    const isRapid = /\bG0\b/i.test(code);

    if (dist > 0 && feedRate > 0) {
      const time = dist / (feedRate / 60);
      currentTime += time;
      if (isRapid) {
        travelTime += time;
      } else {
        cuttingTime += time;
      }

      // Layer tracking
      if (firstZ === 0) firstZ = z;
      if (z > currentZ + 0.01 && layerNum > 0) {
        timePerLayer.push({ layer: layerNum, time: currentTime - layerStartTime });
        layerNum++;
        currentZ = z;
        layerStartTime = currentTime;
      } else if (layerNum === 0) {
        currentZ = z;
        layerNum = 1;
        layerStartTime = currentTime;
      }
    }

    prevX = x; prevY = y; prevZ = z;
  }

  // Save last layer
  if (layerNum > 0) {
    timePerLayer.push({ layer: layerNum, time: currentTime - layerStartTime });
  }

  const toolChangeTime = toolChanges * toolChangeTimePerChange;
  const totalTime = cuttingTime + travelTime + dwellTime + toolChangeTime;

  const breakdown: { [category: string]: number } = {
    cutting: cuttingTime,
    travel: travelTime,
    dwell: dwellTime,
    tool_change: toolChangeTime,
  };

  const efficiency = totalTime > 0 ? (cuttingTime / totalTime) * 100 : 0;

  const recommendations: string[] = [];
  const formatTime = (s: number) => {
    const min = Math.floor(s / 60);
    const sec = Math.round(s % 60);
    return `${min}m ${sec}s`;
  };
  recommendations.push(`Total: ${formatTime(totalTime)} (cutting ${formatTime(cuttingTime)}, travel ${formatTime(travelTime)})`);
  if (dwellTime > 0) {
    recommendations.push(`Dwell: ${formatTime(dwellTime)}`);
  }
  if (toolChanges > 0) {
    recommendations.push(`${toolChanges} tool changes: ${formatTime(toolChangeTime)}`);
  }
  if (efficiency < 50) {
    recommendations.push(`Low efficiency (${efficiency.toFixed(0)}%) — optimize travel moves`);
  }
  if (efficiency > 80) {
    recommendations.push(`High efficiency (${efficiency.toFixed(0)}%) — minimal non-cutting time`);
  }
  if (timePerLayer.length > 0) {
    const avgLayerTime = timePerLayer.reduce((s, l) => s + l.time, 0) / timePerLayer.length;
    recommendations.push(`${timePerLayer.length} layers, avg ${avgLayerTime.toFixed(1)}s/layer`);
  }

  return {
    totalTime, cuttingTime, travelTime, dwellTime,
    toolChangeTime, breakdown, timePerLayer,
    efficiency, recommendations,
  };
}
