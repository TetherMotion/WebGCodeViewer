/**
 * @file GcodeAdvanced24.ts
 * @brief Twenty-fourth batch of advanced G-code analysis features for CNC and 3D printing.
 *
 * This module provides 12 additional high-impact features:
 *  1. CNC tool engagement angle per segment calculator (CNC)
 *  2. Print first layer speed optimizer (3DP)
 *  3. G-code rapid travel efficiency analyzer (Universal)
 *  4. CNC plunge rate analyzer (CNC)
 *  5. Print material consumption per extruder calculator (3DP)
 *  6. CNC climb vs conventional milling per pass classifier (CNC)
 *  7. Print layer cooling time analyzer (3DP)
 *  8. G-code toolpath reversal point analyzer (Universal)
 *  9. CNC tool path cutting mode consistency analyzer (CNC)
 * 10. Print extrusion start/stop point quality analyzer (3DP)
 * 11. G-code program flow structure analyzer (Universal)
 * 12. CNC material removal rate per layer calculator (CNC)
 */

// ── 1. CNC Tool Engagement Angle Per Segment Calculator ──

export interface EngagementAngleSegment {
  /** Segment index */
  index: number;
  /** Line number */
  line: number;
  /** Engagement angle in degrees */
  angle: number;
  /** Engagement category */
  category: 'light' | 'moderate' | 'heavy' | 'full';
}

export interface EngagementAngleResult {
  /** Per-segment engagement angles */
  segments: EngagementAngleSegment[];
  /** Average engagement angle */
  avgAngle: number;
  /** Max engagement angle */
  maxAngle: number;
  /** Full engagement count (180°) */
  fullEngagementCount: number;
  /** Angle distribution */
  distribution: { [category: string]: number };
  /** Engagement consistency score (0-100) */
  consistencyScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Calculate tool engagement angle for each cutting segment.
 * The engagement angle determines cutting force and heat generation.
 *
 * @param lines G-code lines
 * @param toolDiameter Tool diameter in mm (default 6)
 */
export function calculateEngagementAnglePerSegment(
  lines: string[],
  toolDiameter: number = 6,
): EngagementAngleResult {
  const segments: EngagementAngleSegment[] = [];
  let prevX = 0, prevY = 0, prevZ = 0;
  let segIdx = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG1\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const z = zMatch ? parseFloat(zMatch[1]) : prevZ;

    if (z < 0) {
      // Estimate engagement angle from stepover
      const stepover = Math.abs(y - prevY);
      let angle = 0;
      if (stepover > 0 && stepover <= toolDiameter) {
        // Engagement angle = 2 * acos(1 - stepover/toolRadius)
        // Simplified: for full width, angle = 180
        const toolRadius = toolDiameter / 2;
        const ratio = stepover / toolDiameter;
        angle = ratio >= 1 ? 180 : Math.acos(1 - ratio) * 2 * 180 / Math.PI;
      } else if (stepover === 0) {
        // Slotting — full engagement
        angle = 180;
      }

      const category: EngagementAngleSegment['category'] =
        angle < 30 ? 'light'
        : angle < 90 ? 'moderate'
        : angle < 170 ? 'heavy' : 'full';

      segments.push({ index: segIdx++, line: i, angle, category });
    }

    prevX = x; prevY = y; prevZ = z;
  }

  if (segments.length === 0) {
    return {
      segments: [], avgAngle: 0, maxAngle: 0,
      fullEngagementCount: 0, distribution: {},
      consistencyScore: 100,
      recommendations: ['No cutting segments for engagement angle analysis'],
    };
  }

  const angles = segments.map(s => s.angle);
  const avgAngle = angles.reduce((a, b) => a + b, 0) / angles.length;
  const maxAngle = Math.max(...angles);
  const fullEngagementCount = segments.filter(s => s.category === 'full').length;

  const distribution: { [category: string]: number } = {};
  for (const s of segments) {
    distribution[s.category] = (distribution[s.category] ?? 0) + 1;
  }

  const stdDev = Math.sqrt(angles.reduce((s, a) => s + (a - avgAngle) ** 2, 0) / angles.length);
  const consistencyScore = Math.max(0, 100 - (stdDev / 180) * 100);

  const recommendations: string[] = [];
  recommendations.push(`${segments.length} segments, avg engagement ${avgAngle.toFixed(0)}°, max ${maxAngle.toFixed(0)}°`);
  if (fullEngagementCount > 10) {
    recommendations.push(`${fullEngagementCount} full engagement segments — high cutting force`);
  }
  if (avgAngle > 120) {
    recommendations.push('High average engagement — reduce stepover or depth');
  }
  for (const [cat, count] of Object.entries(distribution)) {
    recommendations.push(`${cat}: ${count} segments`);
  }
  if (consistencyScore > 80) {
    recommendations.push('Consistent engagement — uniform cutting conditions');
  }

  return {
    segments, avgAngle, maxAngle, fullEngagementCount,
    distribution, consistencyScore, recommendations,
  };
}

// ── 2. Print First Layer Speed Optimizer ──

export interface FirstLayerSpeedResult {
  /** Current first layer speed in mm/min */
  currentSpeed: number;
  /** Recommended first layer speed in mm/min */
  recommendedSpeed: number;
  /** Speed variation on first layer */
  speedVariation: number;
  /** First layer segment count */
  segmentCount: number;
  /** Adhesion impact score (0-100) */
  adhesionImpactScore: number;
  /** Is speed optimal */
  isOptimal: boolean;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Optimize first layer print speed for better adhesion.
 * First layer speed is critical for print success.
 *
 * @param lines G-code lines
 * @param material Material type (default 'PLA')
 */
export function optimizeFirstLayerSpeed(
  lines: string[],
  material: string = 'PLA',
): FirstLayerSpeedResult {
  const speeds: number[] = [];
  let firstZ = 0;
  let isOnFirstLayer = true;
  let feedRate = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    if (zMatch) {
      const z = parseFloat(zMatch[1]);
      if (firstZ === 0) firstZ = z;
      if (z > firstZ + 0.01) isOnFirstLayer = false;
    }

    if (!isOnFirstLayer || !/\bG1\b/i.test(code)) continue;

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) {
      feedRate = parseFloat(fMatch[1]);
      speeds.push(feedRate);
    }
  }

  if (speeds.length === 0) {
    return {
      currentSpeed: 0, recommendedSpeed: 0, speedVariation: 0,
      segmentCount: 0, adhesionImpactScore: 100, isOptimal: true,
      recommendations: ['No first layer speed data detected'],
    };
  }

  const currentSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  const minSpeed = Math.min(...speeds);
  const maxSpeed = Math.max(...speeds);
  const speedVariation = maxSpeed - minSpeed;

  // Recommended first layer speeds by material
  const recommendedSpeeds: { [material: string]: number } = {
    PLA: 1200, ABS: 900, PETG: 900, Nylon: 600, TPU: 300, ASA: 900,
  };
  const recommendedSpeed = recommendedSpeeds[material] ?? 1200;

  const speedDelta = Math.abs(currentSpeed - recommendedSpeed);
  const adhesionImpactScore = Math.max(0, 100 - speedDelta / 10);
  const isOptimal = speedDelta < 100;

  const recommendations: string[] = [];
  recommendations.push(`Current first layer speed: ${currentSpeed.toFixed(0)}mm/min, recommended: ${recommendedSpeed}mm/min`);
  if (currentSpeed > recommendedSpeed + 200) {
    recommendations.push(`First layer too fast — reduce to ${recommendedSpeed}mm/min for better adhesion`);
  }
  if (speedVariation > 500) {
    recommendations.push(`High speed variation (${speedVariation.toFixed(0)}mm/min) — use consistent first layer speed`);
  }
  if (isOptimal) {
    recommendations.push('Optimal first layer speed — good adhesion expected');
  }
  if (adhesionImpactScore > 85) {
    recommendations.push('Excellent speed for first layer adhesion');
  }

  return {
    currentSpeed, recommendedSpeed, speedVariation,
    segmentCount: speeds.length, adhesionImpactScore,
    isOptimal, recommendations,
  };
}

// ── 3. G-code Rapid Travel Efficiency Analyzer ──

export interface RapidTravelResult {
  /** Total rapid travel distance in mm */
  rapidDistance: number;
  /** Total cutting distance in mm */
  cuttingDistance: number;
  /** Total distance in mm */
  totalDistance: number;
  /** Rapid travel percentage */
  rapidPercentage: number;
  /** Rapid travel count */
  rapidCount: number;
  /** Average rapid length in mm */
  avgRapidLength: number;
  /** Longest rapid travel in mm */
  longestRapid: number;
  /** Travel efficiency score (0-100, higher is better) */
  efficiencyScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze rapid travel efficiency.
 * High rapid travel indicates inefficient toolpath layout.
 *
 * @param lines G-code lines
 */
export function analyzeRapidTravelEfficiency(lines: string[]): RapidTravelResult {
  let rapidDistance = 0;
  let cuttingDistance = 0;
  let rapidCount = 0;
  let longestRapid = 0;
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
    const isRapid = /\bG0\b/i.test(code);

    if (dist > 0) {
      if (isRapid) {
        rapidDistance += dist;
        rapidCount++;
        longestRapid = Math.max(longestRapid, dist);
      } else {
        cuttingDistance += dist;
      }
    }

    prevX = x; prevY = y; prevZ = z;
  }

  const totalDistance = rapidDistance + cuttingDistance;
  const rapidPercentage = totalDistance > 0 ? (rapidDistance / totalDistance) * 100 : 0;
  const avgRapidLength = rapidCount > 0 ? rapidDistance / rapidCount : 0;
  const efficiencyScore = Math.max(0, 100 - rapidPercentage * 0.8);

  const recommendations: string[] = [];
  recommendations.push(`Rapid: ${rapidDistance.toFixed(0)}mm (${rapidPercentage.toFixed(1)}%), cutting: ${cuttingDistance.toFixed(0)}mm`);
  if (rapidPercentage > 40) {
    recommendations.push(`High rapid travel (${rapidPercentage.toFixed(0)}%) — optimize toolpath order`);
  }
  if (longestRapid > 200) {
    recommendations.push(`Longest rapid: ${longestRapid.toFixed(0)}mm — consider reordering operations`);
  }
  if (rapidCount > 50) {
    recommendations.push(`${rapidCount} rapid moves — minimize for faster cycle time`);
  }
  if (efficiencyScore > 80) {
    recommendations.push('Efficient toolpath — minimal rapid travel');
  }

  return {
    rapidDistance, cuttingDistance, totalDistance,
    rapidPercentage, rapidCount, avgRapidLength,
    longestRapid, efficiencyScore, recommendations,
  };
}

// ── 4. CNC Plunge Rate Analyzer ──

export interface PlungeRateResult {
  /** Average plunge rate in mm/min */
  avgPlungeRate: number;
  /** Max plunge rate in mm/min */
  maxPlungeRate: number;
  /** Min plunge rate in mm/min */
  minPlungeRate: number;
  /** Plunge count */
  plungeCount: number;
  /** Total plunge distance in mm */
  totalPlungeDistance: number;
  /** Plunge time in seconds */
  plungeTime: number;
  /** Plunge safety score (0-100) */
  safetyScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze Z-axis plunge rates.
 * Excessive plunge rates can break tools; too slow wastes cycle time.
 *
 * @param lines G-code lines
 * @param maxRecommendedPlunge Max recommended plunge rate in mm/min (default 100)
 */
export function analyzePlungeRate(
  lines: string[],
  maxRecommendedPlunge: number = 100,
): PlungeRateResult {
  const plungeRates: number[] = [];
  let prevZ = 0;
  let feedRate = 0;
  let totalPlungeDistance = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || line.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) feedRate = parseFloat(fMatch[1]);

    // Track Z from both G0 and G1 moves
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    if (zMatch && /\bG[01]\b/i.test(code)) {
      const z = parseFloat(zMatch[1]);
      const zDelta = z - prevZ;
      // Only count plunges on G1 (cutting) moves
      if (zDelta < -0.1 && feedRate > 0 && /\bG1\b/i.test(code)) {
        const plungeDist = Math.abs(zDelta);
        totalPlungeDistance += plungeDist;
        plungeRates.push(feedRate);
      }
      prevZ = z;
    }
  }

  if (plungeRates.length === 0) {
    return {
      avgPlungeRate: 0, maxPlungeRate: 0, minPlungeRate: 0,
      plungeCount: 0, totalPlungeDistance: 0, plungeTime: 0,
      safetyScore: 100,
      recommendations: ['No plunge moves detected'],
    };
  }

  const avgPlungeRate = plungeRates.reduce((a, b) => a + b, 0) / plungeRates.length;
  const maxPlungeRate = Math.max(...plungeRates);
  const minPlungeRate = Math.min(...plungeRates);
  const plungeCount = plungeRates.length;
  const plungeTime = totalPlungeDistance / (avgPlungeRate / 60);

  const overRateCount = plungeRates.filter(r => r > maxRecommendedPlunge).length;
  const safetyScore = Math.max(0, 100 - overRateCount * 10 - (maxPlungeRate / maxRecommendedPlunge - 1) * 50);

  const recommendations: string[] = [];
  recommendations.push(`${plungeCount} plunges, avg ${avgPlungeRate.toFixed(0)}mm/min, max ${maxPlungeRate.toFixed(0)}mm/min`);
  if (maxPlungeRate > maxRecommendedPlunge) {
    recommendations.push(`Max plunge rate ${maxPlungeRate.toFixed(0)} exceeds recommended ${maxRecommendedPlunge}mm/min — risk of tool breakage`);
  }
  if (overRateCount > 5) {
    recommendations.push(`${overRateCount} plunges exceed recommended rate — reduce plunge feed`);
  }
  if (plungeTime > 10) {
    recommendations.push(`Plunge time: ${plungeTime.toFixed(1)}s — consider peck drilling for deep holes`);
  }
  if (safetyScore > 85) {
    recommendations.push('Safe plunge rates — good tool protection');
  }

  return {
    avgPlungeRate, maxPlungeRate, minPlungeRate,
    plungeCount, totalPlungeDistance, plungeTime,
    safetyScore, recommendations,
  };
}

// ── 5. Print Material Consumption Per Extruder Calculator ──

export interface ExtruderMaterial {
  /** Extruder index */
  extruder: number;
  /** Filament length in mm */
  filamentLength: number;
  /** Filament volume in mm³ */
  volume: number;
  /** Filament weight in grams */
  weight: number;
  /** Percentage of total */
  percentage: number;
}

export interface MaterialPerExtruderResult {
  /** Per-extruder material data */
  extruders: ExtruderMaterial[];
  /** Extruder count */
  extruderCount: number;
  /** Total filament length in mm */
  totalFilament: number;
  /** Total weight in grams */
  totalWeight: number;
  /** Balance score (0-100) */
  balanceScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Calculate material consumption per extruder.
 * Useful for multi-extruder setups to balance material usage.
 *
 * @param lines G-code lines
 * @param filamentDiameter Filament diameter in mm (default 1.75)
 * @param density Material density in g/cm³ (default 1.24 for PLA)
 */
export function calculateMaterialPerExtruder(
  lines: string[],
  filamentDiameter: number = 1.75,
  density: number = 1.24,
): MaterialPerExtruderResult {
  const extruderMap = new Map<number, number>();
  let currentExtruder = 0;
  let prevE = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Track tool/extruder changes
    const tMatch = code.match(/\bT(\d+)/i);
    if (tMatch) {
      currentExtruder = parseInt(tMatch[1]);
      prevE = 0; // Reset E for new extruder
    }

    if (!/\bG1\b/i.test(code)) continue;

    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);
    if (eMatch) {
      const e = parseFloat(eMatch[1]);
      if (e > prevE) {
        const delta = e - prevE;
        extruderMap.set(currentExtruder, (extruderMap.get(currentExtruder) ?? 0) + delta);
      }
      prevE = e;
    }
  }

  if (extruderMap.size === 0) {
    return {
      extruders: [], extruderCount: 0, totalFilament: 0,
      totalWeight: 0, balanceScore: 100,
      recommendations: ['No extrusion data detected'],
    };
  }

  const totalFilament = Array.from(extruderMap.values()).reduce((a, b) => a + b, 0);
  const crossSection = Math.PI * (filamentDiameter / 2) ** 2;

  const extruders: ExtruderMaterial[] = Array.from(extruderMap.entries())
    .map(([ext, length]) => {
      const volume = length * crossSection;
      const weight = (volume / 1000) * density;
      const percentage = totalFilament > 0 ? (length / totalFilament) * 100 : 0;
      return { extruder: ext, filamentLength: length, volume, weight, percentage };
    })
    .sort((a, b) => a.extruder - b.extruder);

  const totalWeight = extruders.reduce((s, e) => s + e.weight, 0);
  const extruderCount = extruders.length;

  // Balance: how evenly distributed
  const percentages = extruders.map(e => e.percentage);
  const expectedPct = 100 / extruderCount;
  const balanceDeviation = percentages.reduce((s, p) => s + Math.abs(p - expectedPct), 0) / extruderCount;
  const balanceScore = Math.max(0, 100 - balanceDeviation);

  const recommendations: string[] = [];
  recommendations.push(`${extruderCount} extruders, ${totalFilament.toFixed(0)}mm total, ${totalWeight.toFixed(1)}g`);
  for (const e of extruders) {
    recommendations.push(`T${e.extruder}: ${e.filamentLength.toFixed(0)}mm (${e.percentage.toFixed(1)}%, ${e.weight.toFixed(1)}g)`);
  }
  if (balanceScore < 60 && extruderCount > 1) {
    recommendations.push(`Unbalanced material usage — extruders have very different consumption`);
  }
  if (extruderCount === 1) {
    recommendations.push('Single extruder — no balancing needed');
  }

  return {
    extruders, extruderCount, totalFilament, totalWeight,
    balanceScore, recommendations,
  };
}

// ── 6. CNC Climb vs Conventional Milling Per Pass Classifier ──

export interface PassClassification {
  /** Pass number */
  pass: number;
  /** Start line */
  startLine: number;
  /** Milling mode */
  mode: 'climb' | 'conventional' | 'mixed';
  /** Confidence (0-100) */
  confidence: number;
  /** Direction */
  direction: string;
}

export interface ClimbConventionalResult {
  /** Per-pass classifications */
  passes: PassClassification[];
  /** Pass count */
  passCount: number;
  /** Climb pass count */
  climbCount: number;
  /** Conventional pass count */
  conventionalCount: number;
  /** Mixed pass count */
  mixedCount: number;
  /** Primary mode */
  primaryMode: 'climb' | 'conventional' | 'mixed';
  /** Mode consistency score (0-100) */
  consistencyScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Classify each pass as climb or conventional milling.
 * Climb milling generally produces better surface finish but requires rigid setup.
 *
 * @param lines G-code lines
 * @param spindleDirection Spindle rotation direction (default 'CW')
 */
export function classifyClimbConventionalPerPass(
  lines: string[],
  spindleDirection: 'CW' | 'CCW' = 'CW',
): ClimbConventionalResult {
  const passes: PassClassification[] = [];
  let prevX = 0, prevY = 0;
  let passNum = 0;
  let passStartLine = 0;
  let passYStart = 0;
  let passDir = '';
  let passClimbVotes = 0;
  let passConventionalVotes = 0;
  let inCut = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG1\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;

    const dx = x - prevX;
    const dy = y - prevY;

    // Detect new pass (Y stepover)
    if (Math.abs(dy) > 0.1 && Math.abs(dy) < 10 && inCut) {
      // Save previous pass
      if (passNum > 0 && (passClimbVotes > 0 || passConventionalVotes > 0)) {
        const mode: PassClassification['mode'] =
          passClimbVotes > passConventionalVotes * 2 ? 'climb'
          : passConventionalVotes > passClimbVotes * 2 ? 'conventional' : 'mixed';
        const confidence = Math.round(
          (Math.max(passClimbVotes, passConventionalVotes) /
            (passClimbVotes + passConventionalVotes)) * 100
        );
        passes.push({
          pass: passNum, startLine: passStartLine,
          mode, confidence, direction: passDir,
        });
      }
      passNum++;
      passStartLine = i;
      passYStart = y;
      passClimbVotes = 0;
      passConventionalVotes = 0;
      inCut = true;
    } else if (!inCut && Math.abs(dx) > 0.1) {
      inCut = true;
      passNum++;
      passStartLine = i;
      passYStart = y;
    }

    // Classify direction
    if (inCut && Math.abs(dx) > 0.01) {
      passDir = dx > 0 ? '+X' : '-X';
      // Climb: tool moves in same direction as spindle rotation at cutting point
      // For CW spindle, +X with +Y stepover = climb
      // Simplified: if Y is increasing and X is +, it's climb for CW
      const yStep = y - passYStart;
      if (spindleDirection === 'CW') {
        if (yStep > 0 && dx > 0) passClimbVotes++;
        else if (yStep > 0 && dx < 0) passConventionalVotes++;
        else if (yStep < 0 && dx > 0) passConventionalVotes++;
        else if (yStep < 0 && dx < 0) passClimbVotes++;
      } else {
        if (yStep > 0 && dx > 0) passConventionalVotes++;
        else if (yStep > 0 && dx < 0) passClimbVotes++;
      }
    }

    prevX = x; prevY = y;
  }

  // Save last pass
  if (passNum > 0 && (passClimbVotes > 0 || passConventionalVotes > 0)) {
    const mode: PassClassification['mode'] =
      passClimbVotes > passConventionalVotes * 2 ? 'climb'
      : passConventionalVotes > passClimbVotes * 2 ? 'conventional' : 'mixed';
    const confidence = Math.round(
      (Math.max(passClimbVotes, passConventionalVotes) /
        (passClimbVotes + passConventionalVotes)) * 100
    );
    passes.push({ pass: passNum, startLine: passStartLine, mode, confidence, direction: passDir });
  }

  if (passes.length === 0) {
    return {
      passes: [], passCount: 0, climbCount: 0, conventionalCount: 0,
      mixedCount: 0, primaryMode: 'mixed', consistencyScore: 0,
      recommendations: ['No passes detected for climb/conventional classification'],
    };
  }

  const climbCount = passes.filter(p => p.mode === 'climb').length;
  const conventionalCount = passes.filter(p => p.mode === 'conventional').length;
  const mixedCount = passes.filter(p => p.mode === 'mixed').length;

  const primaryMode: ClimbConventionalResult['primaryMode'] =
    climbCount > conventionalCount && climbCount > mixedCount ? 'climb'
    : conventionalCount > mixedCount ? 'conventional' : 'mixed';

  const consistencyScore = Math.round(
    (Math.max(climbCount, conventionalCount, mixedCount) / passes.length) * 100
  );

  const recommendations: string[] = [];
  recommendations.push(`${passes.length} passes: ${climbCount} climb, ${conventionalCount} conventional, ${mixedCount} mixed`);
  recommendations.push(`Primary mode: ${primaryMode} (${consistencyScore}% consistency)`);
  if (mixedCount > passes.length * 0.3) {
    recommendations.push(`${mixedCount} mixed passes — inconsistent milling strategy`);
  }
  if (primaryMode === 'climb') {
    recommendations.push('Climb milling — better finish, ensure rigid setup');
  }
  if (primaryMode === 'conventional') {
    recommendations.push('Conventional milling — safer but rougher finish');
  }

  return {
    passes, passCount: passes.length, climbCount,
    conventionalCount, mixedCount, primaryMode,
    consistencyScore, recommendations,
  };
}

// ── 7. Print Layer Cooling Time Analyzer ──

export interface LayerCoolingTime {
  /** Layer number */
  layer: number;
  /** Z height */
  zHeight: number;
  /** Cooling time in seconds */
  coolingTime: number;
  /** Is minimum cooling */
  isMinimum: boolean;
}

export interface LayerCoolingResult {
  /** Per-layer cooling data */
  layers: LayerCoolingTime[];
  /** Layer count */
  layerCount: number;
  /** Average cooling time in seconds */
  avgCoolingTime: number;
  /** Min cooling time in seconds */
  minCoolingTime: number;
  /** Max cooling time in seconds */
  maxCoolingTime: number;
  /** Cooling consistency score (0-100) */
  consistencyScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze cooling time between layers.
 * Insufficient cooling can cause deformation; excessive cooling wastes time.
 *
 * @param lines G-code lines
 * @param minRecommendedCooling Minimum recommended cooling in seconds (default 5)
 */
export function analyzeLayerCoolingTime(
  lines: string[],
  minRecommendedCooling: number = 5,
): LayerCoolingResult {
  const layers: LayerCoolingTime[] = [];
  let prevZ = 0;
  let firstZ = 0;
  let layerNum = 0;
  let layerEndTime = 0;
  let currentTime = 0;
  let feedRate = 0;
  let prevX = 0, prevY = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Track dwell time
    if (/\bG4\b/i.test(code)) {
      const pMatch = code.match(/\bP(\d*\.?\d+)/i);
      if (pMatch) currentTime += parseFloat(pMatch[1]) / 1000;
    }

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) feedRate = parseFloat(fMatch[1]);

    if (!/\bG1\b/i.test(code)) continue;

    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    if (zMatch) {
      const z = parseFloat(zMatch[1]);
      if (firstZ === 0) firstZ = z;
      if (z > prevZ + 0.01 && layerNum > 0) {
        // Layer change — calculate cooling time
        const coolingTime = currentTime - layerEndTime;
        layers.push({
          layer: layerNum, zHeight: prevZ,
          coolingTime: Math.max(0, coolingTime),
          isMinimum: coolingTime < minRecommendedCooling,
        });
        layerNum++;
        prevZ = z;
        layerEndTime = currentTime;
      } else if (layerNum === 0) {
        prevZ = z;
        layerNum = 1;
        layerEndTime = currentTime;
      }
    }

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
    if (dist > 0 && feedRate > 0) {
      currentTime += dist / (feedRate / 60);
    }
    prevX = x; prevY = y;
  }

  if (layers.length === 0) {
    return {
      layers: [], layerCount: 0, avgCoolingTime: 0,
      minCoolingTime: 0, maxCoolingTime: 0, consistencyScore: 100,
      recommendations: ['No layer cooling data detected'],
    };
  }

  const coolingTimes = layers.map(l => l.coolingTime);
  const avgCoolingTime = coolingTimes.reduce((a, b) => a + b, 0) / coolingTimes.length;
  const minCoolingTime = Math.min(...coolingTimes);
  const maxCoolingTime = Math.max(...coolingTimes);
  const stdDev = Math.sqrt(coolingTimes.reduce((s, t) => s + (t - avgCoolingTime) ** 2, 0) / coolingTimes.length);
  const consistencyScore = avgCoolingTime > 0
    ? Math.max(0, 100 - (stdDev / avgCoolingTime) * 100) : 100;

  const underCoolingCount = layers.filter(l => l.isMinimum).length;

  const recommendations: string[] = [];
  recommendations.push(`${layers.length} layers, avg cooling ${avgCoolingTime.toFixed(1)}s, range ${minCoolingTime.toFixed(1)}-${maxCoolingTime.toFixed(1)}s`);
  if (underCoolingCount > 0) {
    recommendations.push(`${underCoolingCount} layers with insufficient cooling (<${minRecommendedCooling}s)`);
  }
  if (maxCoolingTime > avgCoolingTime * 3) {
    recommendations.push(`Inconsistent cooling — max ${maxCoolingTime.toFixed(1)}s is 3× average`);
  }
  if (avgCoolingTime < minRecommendedCooling) {
    recommendations.push(`Average cooling below recommended — increase to ${minRecommendedCooling}s`);
  }
  if (consistencyScore > 80) {
    recommendations.push('Consistent cooling — uniform layer temperatures');
  }

  return {
    layers, layerCount: layers.length, avgCoolingTime,
    minCoolingTime, maxCoolingTime, consistencyScore,
    recommendations,
  };
}

// ── 8. G-code Toolpath Reversal Point Analyzer ──

export interface ReversalPoint {
  /** Line number */
  line: number;
  /** Position */
  position: { x: number; y: number };
  /** Reversal angle in degrees */
  angle: number;
  /** Reversal type */
  type: 'U-turn' | 'sharp_reversal' | 'gentle_reversal';
  /** Speed at reversal */
  speed: number;
}

export interface ReversalPointResult {
  /** Reversal points */
  points: ReversalPoint[];
  /** Reversal count */
  count: number;
  /** U-turn count */
  uTurnCount: number;
  /** Average reversal angle */
  avgAngle: number;
  /** Reversal density per 100mm */
  reversalDensity: number;
  /** Reversal impact score (0-100, lower is better) */
  impactScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze toolpath reversal points.
 * Reversals cause deceleration/acceleration and affect surface finish.
 *
 * @param lines G-code lines
 */
export function analyzeReversalPoints(lines: string[]): ReversalPointResult {
  const points: ReversalPoint[] = [];
  let prevX = 0, prevY = 0;
  let prevAngle: number | null = null;
  let feedRate = 0;
  let totalDistance = 0;

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
      totalDistance += dist;
      const angle = Math.atan2(dy, dx);

      if (prevAngle !== null) {
        let angleChange = Math.abs(angle - prevAngle);
        while (angleChange > Math.PI) angleChange = 2 * Math.PI - angleChange;
        const angleDeg = angleChange * 180 / Math.PI;

        if (angleDeg > 120) {
          const type: ReversalPoint['type'] =
            angleDeg > 170 ? 'U-turn'
            : angleDeg > 150 ? 'sharp_reversal' : 'gentle_reversal';

          points.push({
            line: i, position: { x, y },
            angle: angleDeg, type, speed: feedRate,
          });
        }
      }
      prevAngle = angle;
    }

    prevX = x; prevY = y;
  }

  if (points.length === 0) {
    return {
      points: [], count: 0, uTurnCount: 0, avgAngle: 0,
      reversalDensity: 0, impactScore: 100,
      recommendations: ['No reversal points detected'],
    };
  }

  const count = points.length;
  const uTurnCount = points.filter(p => p.type === 'U-turn').length;
  const avgAngle = points.reduce((s, p) => s + p.angle, 0) / count;
  const reversalDensity = totalDistance > 0 ? (count / totalDistance) * 100 : 0;
  const impactScore = Math.max(0, 100 - count * 2 - uTurnCount * 3);

  const recommendations: string[] = [];
  recommendations.push(`${count} reversals over ${totalDistance.toFixed(0)}mm (${reversalDensity.toFixed(1)}/100mm)`);
  if (uTurnCount > 10) {
    recommendations.push(`${uTurnCount} U-turns — consider smoothing toolpath`);
  }
  if (reversalDensity > 5) {
    recommendations.push(`High reversal density — toolpath has many direction changes`);
  }
  if (avgAngle > 160) {
    recommendations.push(`Average reversal angle ${avgAngle.toFixed(0)}° — near complete reversals`);
  }
  if (impactScore > 80) {
    recommendations.push('Low reversal impact — smooth toolpath');
  }

  return {
    points, count, uTurnCount, avgAngle,
    reversalDensity, impactScore, recommendations,
  };
}

// ── 9. CNC Tool Path Cutting Mode Consistency Analyzer ──

export interface CuttingModeConsistencyResult {
  /** Mode changes count */
  modeChanges: number;
  /** Mode change positions */
  changePositions: { line: number; fromMode: string; toMode: string }[];
  /** Consistency percentage */
  consistencyPercentage: number;
  /** Mode distribution */
  modeDistribution: { climb: number; conventional: number; mixed: number };
  /** Consistency score (0-100) */
  consistencyScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze consistency of cutting mode (climb/conventional).
 * Frequent mode changes can cause inconsistent surface finish.
 *
 * @param lines G-code lines
 */
export function analyzeCuttingModeConsistency(
  lines: string[],
): CuttingModeConsistencyResult {
  // Use the per-pass classifier
  const classification = classifyClimbConventionalPerPass(lines);
  const changePositions: { line: number; fromMode: string; toMode: string }[] = [];
  let modeChanges = 0;

  for (let i = 1; i < classification.passes.length; i++) {
    const prev = classification.passes[i - 1];
    const curr = classification.passes[i];
    if (prev.mode !== curr.mode) {
      modeChanges++;
      changePositions.push({
        line: curr.startLine,
        fromMode: prev.mode,
        toMode: curr.mode,
      });
    }
  }

  const totalPasses = classification.passes.length;
  const consistencyPercentage = totalPasses > 0
    ? ((totalPasses - modeChanges) / totalPasses) * 100 : 100;

  const modeDistribution = {
    climb: classification.climbCount,
    conventional: classification.conventionalCount,
    mixed: classification.mixedCount,
  };

  const consistencyScore = Math.round(consistencyPercentage);

  const recommendations: string[] = [];
  recommendations.push(`${totalPasses} passes, ${modeChanges} mode changes (${consistencyPercentage.toFixed(0)}% consistent)`);
  if (modeChanges > 5) {
    recommendations.push(`${modeChanges} mode changes — inconsistent milling strategy`);
  }
  for (const change of changePositions.slice(0, 3)) {
    recommendations.push(`Line ${change.line}: ${change.fromMode} → ${change.toMode}`);
  }
  if (consistencyScore > 85) {
    recommendations.push('Consistent cutting mode — uniform surface finish');
  }
  if (consistencyScore < 50) {
    recommendations.push('Inconsistent cutting mode — may cause uneven surface finish');
  }

  return {
    modeChanges, changePositions, consistencyPercentage,
    modeDistribution, consistencyScore, recommendations,
  };
}

// ── 10. Print Extrusion Start/Stop Point Quality Analyzer ──

export interface ExtrusionStartStop {
  /** Line number */
  line: number;
  /** Position */
  position: { x: number; y: number };
  /** Type */
  type: 'start' | 'stop';
  /** Speed at transition */
  speed: number;
  /** Quality issue detected */
  hasIssue: boolean;
  /** Issue type */
  issueType: string;
}

export interface StartStopQualityResult {
  /** Start/stop points */
  points: ExtrusionStartStop[];
  /** Start count */
  startCount: number;
  /** Stop count */
  stopCount: number;
  /** Issue count */
  issueCount: number;
  /** Quality score (0-100) */
  qualityScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze quality at extrusion start/stop points.
 * Poor start/stop quality causes blobs, stringing, and gaps.
 *
 * @param lines G-code lines
 */
export function analyzeExtrusionStartStopQuality(
  lines: string[],
): StartStopQualityResult {
  const points: ExtrusionStartStop[] = [];
  let prevE = 0;
  let prevX = 0, prevY = 0;
  let feedRate = 0;
  let wasExtruding = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG1\b/i.test(code)) continue;

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) feedRate = parseFloat(fMatch[1]);

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const e = eMatch ? parseFloat(eMatch[1]) : prevE;

    const isExtruding = e > prevE;

    // Detect start of extrusion
    if (isExtruding && !wasExtruding) {
      let hasIssue = false;
      let issueType = '';
      if (feedRate > 3000) {
        hasIssue = true;
        issueType = 'high_speed_start';
      }
      points.push({
        line: i, position: { x, y }, type: 'start',
        speed: feedRate, hasIssue, issueType,
      });
    }

    // Detect stop of extrusion
    if (!isExtruding && wasExtruding) {
      let hasIssue = false;
      let issueType = '';
      if (feedRate > 3000) {
        hasIssue = true;
        issueType = 'high_speed_stop';
      }
      const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
      if (dist > 5) {
        hasIssue = true;
        issueType = 'long_travel_without_retraction';
      }
      points.push({
        line: i, position: { x, y }, type: 'stop',
        speed: feedRate, hasIssue, issueType,
      });
    }

    wasExtruding = isExtruding;
    prevE = e; prevX = x; prevY = y;
  }

  const startCount = points.filter(p => p.type === 'start').length;
  const stopCount = points.filter(p => p.type === 'stop').length;
  const issueCount = points.filter(p => p.hasIssue).length;
  const qualityScore = points.length > 0
    ? Math.max(0, 100 - (issueCount / points.length) * 100) : 100;

  const recommendations: string[] = [];
  recommendations.push(`${startCount} starts, ${stopCount} stops, ${issueCount} quality issues`);
  if (issueCount > 10) {
    recommendations.push(`${issueCount} start/stop issues — check retraction and coasting settings`);
  }
  const highSpeedIssues = points.filter(p => p.issueType === 'high_speed_start' || p.issueType === 'high_speed_stop').length;
  if (highSpeedIssues > 0) {
    recommendations.push(`${highSpeedIssues} high-speed transitions — reduce speed at extrusion changes`);
  }
  const travelIssues = points.filter(p => p.issueType === 'long_travel_without_retraction').length;
  if (travelIssues > 0) {
    recommendations.push(`${travelIssues} long travels without retraction — enable combing`);
  }
  if (qualityScore > 85) {
    recommendations.push('Good start/stop quality — minimal blobbing expected');
  }

  return {
    points, startCount, stopCount, issueCount,
    qualityScore, recommendations,
  };
}

// ── 11. G-code Program Flow Structure Analyzer ──

export interface ProgramSection {
  /** Section name */
  name: string;
  /** Start line */
  startLine: number;
  /** End line */
  endLine: number;
  /** Line count */
  lineCount: number;
  /** Section type */
  type: 'init' | 'homing' | 'warmup' | 'roughing' | 'finishing' | 'drilling' | 'travel' | 'end' | 'unknown';
}

export interface ProgramFlowResult {
  /** Program sections */
  sections: ProgramSection[];
  /** Section count */
  sectionCount: number;
  /** Total lines */
  totalLines: number;
  /** Has initialization */
  hasInit: boolean;
  /** Has ending */
  hasEnd: boolean;
  /** Structure score (0-100) */
  structureScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze program flow structure.
 * Identifies logical sections of the G-code program.
 *
 * @param lines G-code lines
 */
export function analyzeProgramFlowStructure(lines: string[]): ProgramFlowResult {
  const sections: ProgramSection[] = [];
  let currentSectionStart = 0;
  let currentSectionType: ProgramSection['type'] = 'unknown';
  let currentSectionName = 'Unknown';
  let hasInit = false;
  let hasEnd = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();

    // Detect section changes
    let newType: ProgramSection['type'] | null = null;
    let newName = '';

    if (/\bG28\b/i.test(code)) { newType = 'homing'; newName = 'Homing'; hasInit = true; }
    else if (/\bM3\b/i.test(code) || /\bM4\b/i.test(code)) { newType = 'warmup'; newName = 'Spindle Start'; }
    else if (/\bM5\b/i.test(code)) { newType = 'travel'; newName = 'Spindle Stop'; }
    else if (/\bM30\b/i.test(code) || /\bM2\b/i.test(code)) { newType = 'end'; newName = 'Program End'; hasEnd = true; }
    else if (/;.*rough/i.test(line)) { newType = 'roughing'; newName = 'Roughing'; }
    else if (/;.*finish/i.test(line)) { newType = 'finishing'; newName = 'Finishing'; }
    else if (/;.*drill/i.test(line) || /\bG8[1-9]\b/i.test(code)) { newType = 'drilling'; newName = 'Drilling'; }
    else if (/\bG0\b/i.test(code) && currentSectionType !== 'travel') { newType = 'travel'; newName = 'Travel'; }
    else if (/\bG1\b/i.test(code) && currentSectionType === 'unknown') { newType = 'roughing'; newName = 'Cutting'; }
    else if (/\bG2[01]\b/i.test(code) && currentSectionType === 'unknown') { newType = 'init'; newName = 'Initialization'; hasInit = true; }
    else if (/\bG9[01]\b/i.test(code) && currentSectionType === 'unknown') { newType = 'init'; newName = 'Initialization'; hasInit = true; }

    if (newType && newType !== currentSectionType) {
      // Save previous section
      if (i > currentSectionStart && currentSectionType !== 'unknown') {
        sections.push({
          name: currentSectionName,
          startLine: currentSectionStart,
          endLine: i - 1,
          lineCount: i - currentSectionStart,
          type: currentSectionType,
        });
      }
      currentSectionStart = i;
      currentSectionType = newType;
      currentSectionName = newName;
    }
  }

  // Save last section
  if (lines.length > currentSectionStart && currentSectionType !== 'unknown') {
    sections.push({
      name: currentSectionName,
      startLine: currentSectionStart,
      endLine: lines.length - 1,
      lineCount: lines.length - currentSectionStart,
      type: currentSectionType,
    });
  }

  const sectionCount = sections.length;
  const totalLines = lines.length;
  const structureScore = Math.max(0,
    100 - (hasInit ? 0 : 20) - (hasEnd ? 0 : 15) - (sectionCount < 3 ? 20 : 0)
  );

  const recommendations: string[] = [];
  recommendations.push(`${sectionCount} sections in ${totalLines} lines`);
  for (const s of sections.slice(0, 5)) {
    recommendations.push(`${s.name}: lines ${s.startLine}-${s.endLine} (${s.lineCount} lines)`);
  }
  if (!hasInit) {
    recommendations.push('Missing initialization — add G28/G20/G90 at start');
  }
  if (!hasEnd) {
    recommendations.push('Missing program end — add M30/M2 at end');
  }
  if (structureScore > 80) {
    recommendations.push('Well-structured program — clear section organization');
  }

  return {
    sections, sectionCount, totalLines,
    hasInit, hasEnd, structureScore, recommendations,
  };
}

// ── 12. CNC Material Removal Rate Per Layer Calculator ──

export interface LayerMRR {
  /** Layer number */
  layer: number;
  /** Z height */
  zHeight: number;
  /** Material removal rate in cm³/min */
  mrr: number;
  /** Cutting distance in mm */
  cuttingDistance: number;
  /** Cutting time in seconds */
  cuttingTime: number;
  /** Volume removed in mm³ */
  volumeRemoved: number;
}

export interface MRRPerLayerResult {
  /** Per-layer MRR data */
  layers: LayerMRR[];
  /** Layer count */
  layerCount: number;
  /** Average MRR in cm³/min */
  avgMRR: number;
  /** Max MRR in cm³/min */
  maxMRR: number;
  /** Total volume removed in mm³ */
  totalVolume: number;
  /** MRR consistency score (0-100) */
  consistencyScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Calculate material removal rate per Z-layer.
 * MRR per layer helps optimize cutting parameters for each depth.
 *
 * @param lines G-code lines
 * @param toolDiameter Tool diameter in mm (default 6)
 * @param stepover Stepover distance in mm (default 3)
 */
export function calculateMRRPerLayer(
  lines: string[],
  toolDiameter: number = 6,
  stepover: number = 3,
): MRRPerLayerResult {
  const layers: LayerMRR[] = [];
  let prevX = 0, prevY = 0, prevZ = 0;
  let feedRate = 0;
  let firstZ = 0;
  let currentZ = 0;
  let layerNum = 0;
  let layerDistance = 0;
  let layerTime = 0;
  let layerStartZ = 0;

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

    if (firstZ === 0) firstZ = z;

    // Detect layer change
    if (z < currentZ - 0.1 && layerNum > 0) {
      // Z decreased — new cutting layer
      const depthOfCut = Math.abs(currentZ - layerStartZ);
      const volumeRemoved = layerDistance * stepover * depthOfCut;
      const mrr = layerTime > 0 ? (volumeRemoved / 1000) / (layerTime / 60) : 0;
      layers.push({
        layer: layerNum, zHeight: currentZ,
        mrr, cuttingDistance: layerDistance,
        cuttingTime: layerTime, volumeRemoved,
      });
      layerNum++;
      currentZ = z;
      layerStartZ = z;
      layerDistance = 0;
      layerTime = 0;
    } else if (layerNum === 0 && z < 0) {
      currentZ = z;
      layerStartZ = z;
      layerNum = 1;
    }

    // Track cutting distance and time
    if (z < 0) {
      const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
      if (dist > 0 && feedRate > 0) {
        layerDistance += dist;
        layerTime += dist / (feedRate / 60);
      }
    }

    prevX = x; prevY = y; prevZ = z;
  }

  // Save last layer
  if (layerNum > 0 && layerDistance > 0) {
    const depthOfCut = Math.abs(currentZ - layerStartZ);
    const volumeRemoved = layerDistance * stepover * Math.max(depthOfCut, 0.1);
    const mrr = layerTime > 0 ? (volumeRemoved / 1000) / (layerTime / 60) : 0;
    layers.push({
      layer: layerNum, zHeight: currentZ,
      mrr, cuttingDistance: layerDistance,
      cuttingTime: layerTime, volumeRemoved,
    });
  }

  if (layers.length === 0) {
    return {
      layers: [], layerCount: 0, avgMRR: 0, maxMRR: 0,
      totalVolume: 0, consistencyScore: 100,
      recommendations: ['No cutting layers for MRR analysis'],
    };
  }

  const mrrs = layers.map(l => l.mrr);
  const avgMRR = mrrs.reduce((a, b) => a + b, 0) / mrrs.length;
  const maxMRR = Math.max(...mrrs);
  const totalVolume = layers.reduce((s, l) => s + l.volumeRemoved, 0);
  const stdDev = Math.sqrt(mrrs.reduce((s, m) => s + (m - avgMRR) ** 2, 0) / mrrs.length);
  const consistencyScore = avgMRR > 0
    ? Math.max(0, 100 - (stdDev / avgMRR) * 100) : 100;

  const recommendations: string[] = [];
  recommendations.push(`${layers.length} layers, avg MRR ${avgMRR.toFixed(2)}cm³/min, max ${maxMRR.toFixed(2)}cm³/min`);
  recommendations.push(`Total volume removed: ${totalVolume.toFixed(0)}mm³`);
  if (maxMRR > avgMRR * 2) {
    recommendations.push(`MRR variation — max is 2× average, optimize per-layer parameters`);
  }
  if (avgMRR < 1) {
    recommendations.push('Low MRR — increase feed rate or depth of cut');
  }
  if (consistencyScore > 80) {
    recommendations.push('Consistent MRR — uniform material removal');
  }

  return {
    layers, layerCount: layers.length, avgMRR, maxMRR,
    totalVolume, consistencyScore, recommendations,
  };
}
