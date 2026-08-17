/**
 * @file GcodeAdvanced19.ts
 * @brief Nineteenth batch of advanced G-code analysis features for CNC and 3D printing.
 *
 * This module provides 12 additional high-impact features:
 *  1. G-code arc length calculator (Universal) — total arc length from G2/G3
 *  2. CNC tool entry/exit angle analyzer (CNC) — entry and exit angles
 *  3. Print retraction distance optimizer (3DP) — optimize retraction distances
 *  4. G-code block structure analyzer (Universal) — code block structure
 *  5. CNC feed per revolution calculator (CNC) — feed per revolution
 *  6. Print thin wall analyzer (3DP) — thin wall printability
 *  7. G-code variable usage tracker (Universal) — variable usage tracking
 *  8. CNC tool path segment classifier (CNC) — classify toolpath segments
 *  9. Print infill density variance analyzer (3DP) — infill density variance
 * 10. G-code error pattern detector (Universal) — detect common error patterns
 * 11. CNC surface speed calculator (CNC) — calculate surface speed
 * 12. Print layer time variance analyzer (3DP) — layer time variance
 */

// ── 1. G-code Arc Length Calculator ──

export interface ArcData {
  /** Line number */
  line: number;
  /** Arc type: CW or CCW */
  direction: 'CW' | 'CCW';
  /** Start point */
  start: { x: number; y: number };
  /** End point */
  end: { x: number; y: number };
  /** Center point */
  center: { x: number; y: number };
  /** Radius in mm */
  radius: number;
  /** Arc length in mm */
  arcLength: number;
  /** Sweep angle in degrees */
  sweepAngle: number;
}

export interface ArcLengthResult {
  /** All arcs */
  arcs: ArcData[];
  /** Total arc length in mm */
  totalArcLength: number;
  /** Arc count */
  arcCount: number;
  /** Average arc length */
  avgArcLength: number;
  /** Max arc length */
  maxArcLength: number;
  /** CW vs CCW count */
  directionCount: { CW: number; CCW: number };
  /** Total linear distance for comparison */
  totalLinearDistance: number;
  /** Arc percentage of total path */
  arcPercentage: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Calculate total arc length from G2/G3 commands.
 * Parses arc parameters (I, J, R) and computes arc length.
 *
 * @param lines G-code lines
 */
export function calculateArcLength(lines: string[]): ArcLengthResult {
  const arcs: ArcData[] = [];
  let prevX = 0, prevY = 0;
  let totalLinearDistance = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Linear move for comparison
    if (/\bG1\b/i.test(code)) {
      const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
      const x = xMatch ? parseFloat(xMatch[1]) : prevX;
      const y = yMatch ? parseFloat(yMatch[1]) : prevY;
      totalLinearDistance += Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
      prevX = x; prevY = y;
    }

    // Arc move
    const isCW = /\bG2\b/i.test(code);
    const isCCW = /\bG3\b/i.test(code);
    if (!isCW && !isCCW) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const iMatch = code.match(/\bI(-?\d*\.?\d+)/i);
    const jMatch = code.match(/\bJ(-?\d*\.?\d+)/i);
    const rMatch = code.match(/\bR(-?\d*\.?\d+)/i);

    const endX = xMatch ? parseFloat(xMatch[1]) : prevX;
    const endY = yMatch ? parseFloat(yMatch[1]) : prevY;

    let centerX: number, centerY: number, radius: number;

    if (iMatch && jMatch) {
      // I/J relative to start
      centerX = prevX + parseFloat(iMatch[1]);
      centerY = prevY + parseFloat(jMatch[1]);
      radius = Math.sqrt((centerX - prevX) ** 2 + (centerY - prevY) ** 2);
    } else if (rMatch) {
      // R format
      radius = Math.abs(parseFloat(rMatch[1]));
      // Calculate center from radius (simplified — midpoint perpendicular)
      const midX = (prevX + endX) / 2;
      const midY = (prevY + endY) / 2;
      const dx = endX - prevX;
      const dy = endY - prevY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 0 && radius > dist / 2) {
        const h = Math.sqrt(radius * radius - (dist / 2) ** 2);
        const sign = isCW ? 1 : -1;
        centerX = midX + sign * (-dy / dist) * h;
        centerY = midY + sign * (dx / dist) * h;
      } else {
        centerX = midX;
        centerY = midY;
      }
    } else {
      continue; // No arc parameters
    }

    // Calculate sweep angle
    const startAngle = Math.atan2(prevY - centerY, prevX - centerX);
    const endAngle = Math.atan2(endY - centerY, endX - centerX);

    let sweepAngle: number;
    if (isCW) {
      sweepAngle = startAngle - endAngle;
      if (sweepAngle <= 0) sweepAngle += 2 * Math.PI;
    } else {
      sweepAngle = endAngle - startAngle;
      if (sweepAngle <= 0) sweepAngle += 2 * Math.PI;
    }

    const arcLength = radius * sweepAngle;
    const sweepDeg = sweepAngle * 180 / Math.PI;

    arcs.push({
      line: i, direction: isCW ? 'CW' : 'CCW',
      start: { x: prevX, y: prevY }, end: { x: endX, y: endY },
      center: { x: centerX, y: centerY },
      radius, arcLength, sweepAngle: sweepDeg,
    });

    prevX = endX; prevY = endY;
  }

  const totalArcLength = arcs.reduce((s, a) => s + a.arcLength, 0);
  const arcCount = arcs.length;
  const avgArcLength = arcCount > 0 ? totalArcLength / arcCount : 0;
  const maxArcLength = arcCount > 0 ? Math.max(...arcs.map(a => a.arcLength)) : 0;
  const directionCount = {
    CW: arcs.filter(a => a.direction === 'CW').length,
    CCW: arcs.filter(a => a.direction === 'CCW').length,
  };

  const totalPath = totalArcLength + totalLinearDistance;
  const arcPercentage = totalPath > 0 ? (totalArcLength / totalPath) * 100 : 0;

  const recommendations: string[] = [];
  recommendations.push(`${arcCount} arcs, ${totalArcLength.toFixed(1)}mm total arc length`);
  if (arcPercentage > 50) {
    recommendations.push(`${arcPercentage.toFixed(0)}% of path is arcs — good for smooth contours`);
  }
  if (directionCount.CW > directionCount.CCW * 2) {
    recommendations.push(`More CW (${directionCount.CW}) than CCW (${directionCount.CCW}) — check climb vs conventional milling`);
  }
  if (arcCount === 0) {
    recommendations.push('No arc commands (G2/G3) — use arcs for smoother finishes');
  }

  return {
    arcs, totalArcLength, arcCount, avgArcLength, maxArcLength,
    directionCount, totalLinearDistance, arcPercentage, recommendations,
  };
}

// ── 2. CNC Tool Entry/Exit Angle Analyzer ──

export interface EntryExitAngle {
  /** Line number */
  line: number;
  /** Entry angle in degrees */
  entryAngle: number;
  /** Exit angle in degrees */
  exitAngle: number;
  /** Entry type */
  entryType: 'plunge' | 'ramp' | 'lateral' | 'arc';
  /** Severity */
  severity: 'low' | 'medium' | 'high';
  /** Tool wear risk */
  toolWearRisk: number;
}

export interface EntryExitResult {
  /** All entry/exit events */
  events: EntryExitAngle[];
  /** Event count */
  count: number;
  /** Average entry angle */
  avgEntryAngle: number;
  /** Plunge entry count */
  plungeCount: number;
  /** High-severity count */
  highSeverityCount: number;
  /** Average tool wear risk */
  avgToolWearRisk: number;
  /** Entry quality score (0-100) */
  entryQualityScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze tool entry and exit angles.
 * Plunge entries are harder on tools than ramp or arc entries.
 *
 * @param lines G-code lines
 */
export function analyzeEntryExitAngles(lines: string[]): EntryExitResult {
  const events: EntryExitAngle[] = [];
  let prevX = 0, prevY = 0, prevZ = 0;
  let wasCutting = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG[0123]\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const z = zMatch ? parseFloat(zMatch[1]) : prevZ;

    const isCutting = z < 0;
    const isArc = /\bG[23]\b/i.test(code);

    // Detect entry (transition from non-cutting to cutting)
    if (!wasCutting && isCutting) {
      const dx = x - prevX;
      const dy = y - prevY;
      const dz = z - prevZ;
      const lateralDist = Math.sqrt(dx * dx + dy * dy);
      const verticalDist = Math.abs(dz);

      let entryAngle: number;
      let entryType: EntryExitAngle['entryType'];

      if (lateralDist < 0.1 && verticalDist > 0.1) {
        entryAngle = 90; // Pure plunge
        entryType = 'plunge';
      } else if (lateralDist > 0 && verticalDist > 0) {
        entryAngle = Math.atan2(verticalDist, lateralDist) * 180 / Math.PI;
        entryType = entryAngle > 60 ? 'plunge' : 'ramp';
      } else if (isArc) {
        entryAngle = 0;
        entryType = 'arc';
      } else {
        entryAngle = 0;
        entryType = 'lateral';
      }

      const severity = entryAngle > 60 ? 'high' : entryAngle > 30 ? 'medium' : 'low';
      const toolWearRisk = Math.min(100, entryAngle * 1.1);

      events.push({
        line: i, entryAngle, exitAngle: 0,
        entryType, severity, toolWearRisk,
      });
    }

    // Detect exit (transition from cutting to non-cutting)
    if (wasCutting && !isCutting && events.length > 0) {
      const lastEvent = events[events.length - 1];
      const dx = x - prevX;
      const dy = y - prevY;
      const dz = z - prevZ;
      const lateralDist = Math.sqrt(dx * dx + dy * dy);
      const verticalDist = Math.abs(dz);

      if (lateralDist < 0.1 && verticalDist > 0.1) {
        lastEvent.exitAngle = 90;
      } else if (lateralDist > 0 && verticalDist > 0) {
        lastEvent.exitAngle = Math.atan2(verticalDist, lateralDist) * 180 / Math.PI;
      } else {
        lastEvent.exitAngle = 0;
      }
    }

    wasCutting = isCutting;
    prevX = x; prevY = y; prevZ = z;
  }

  const count = events.length;
  const avgEntryAngle = count > 0 ? events.reduce((s, e) => s + e.entryAngle, 0) / count : 0;
  const plungeCount = events.filter(e => e.entryType === 'plunge').length;
  const highSeverityCount = events.filter(e => e.severity === 'high').length;
  const avgToolWearRisk = count > 0 ? events.reduce((s, e) => s + e.toolWearRisk, 0) / count : 0;
  const entryQualityScore = Math.max(0, 100 - avgToolWearRisk);

  const recommendations: string[] = [];
  if (plungeCount > 0) {
    recommendations.push(`${plungeCount} plunge entries — use ramp or arc entry to reduce tool wear`);
  }
  if (highSeverityCount > 0) {
    recommendations.push(`${highSeverityCount} high-severity entries — high tool wear risk`);
  }
  if (avgEntryAngle > 45) {
    recommendations.push(`Average entry angle ${avgEntryAngle.toFixed(0)}° — steep entries increase wear`);
  }
  if (entryQualityScore > 80) {
    recommendations.push('Good entry strategy — low tool wear risk');
  }
  if (count === 0) {
    recommendations.push('No entry/exit events detected');
  }

  return {
    events, count, avgEntryAngle, plungeCount, highSeverityCount,
    avgToolWearRisk, entryQualityScore, recommendations,
  };
}

// ── 3. Print Retraction Distance Optimizer ──

export interface RetractionOptimization {
  /** Current retraction distance */
  currentDistance: number;
  /** Recommended retraction distance */
  recommendedDistance: number;
  /** Reason */
  reason: string;
  /** Expected improvement */
  improvement: string;
}

export interface RetractionOptimizerResult {
  /** Optimization advice */
  optimization: RetractionOptimization;
  /** Current retraction count */
  retractionCount: number;
  /** Current average distance */
  currentAvgDistance: number;
  /** Direct drive vs Bowden recommendation */
  extruderType: 'direct' | 'bowden' | 'unknown';
  /** Total retraction time in seconds */
  totalRetractionTime: number;
  /** Stringing risk reduction percentage */
  stringingRiskReduction: number;
  /** Optimization score (0-100) */
  optimizationScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Optimize retraction distances based on analysis.
 * Recommends optimal retraction distance based on extruder type and patterns.
 *
 * @param lines G-code lines
 * @param extruderType Extruder type (default 'unknown')
 */
export function optimizeRetractionDistance(
  lines: string[],
  extruderType: 'direct' | 'bowden' | 'unknown' = 'unknown',
): RetractionOptimizerResult {
  let retractionCount = 0;
  let totalRetractionDist = 0;
  const distances: number[] = [];
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
      const dist = prevE - e;
      totalRetractionDist += dist;
      distances.push(dist);
    }
    prevE = e;
  }

  const currentAvgDistance = distances.length > 0 ? totalRetractionDist / distances.length : 0;

  // Determine extruder type if unknown
  let detectedType = extruderType;
  if (extruderType === 'unknown') {
    if (currentAvgDistance > 3) detectedType = 'bowden';
    else if (currentAvgDistance > 0) detectedType = 'direct';
  }

  // Recommended distances by extruder type
  const recommendedDistance = detectedType === 'bowden' ? 4.0 : 0.8;

  const reason = detectedType === 'bowden'
    ? `Bowden extruder: recommend ${recommendedDistance}mm retraction`
    : `Direct drive: recommend ${recommendedDistance}mm retraction`;

  const improvement = currentAvgDistance > recommendedDistance
    ? `Reduce by ${(currentAvgDistance - recommendedDistance).toFixed(2)}mm to speed up prints`
    : currentAvgDistance < recommendedDistance
    ? `Increase by ${(recommendedDistance - currentAvgDistance).toFixed(2)}mm to reduce stringing`
    : 'Retraction distance is optimal';

  const totalRetractionTime = retractionCount * (currentAvgDistance / 25) * 2; // ~25mm/s
  const stringingRiskReduction = Math.min(100, Math.abs(currentAvgDistance - recommendedDistance) * 20);
  const optimizationScore = Math.max(0, 100 - Math.abs(currentAvgDistance - recommendedDistance) * 25);

  const optimization: RetractionOptimization = {
    currentDistance: currentAvgDistance, recommendedDistance, reason, improvement,
  };

  const recommendations: string[] = [];
  recommendations.push(`${detectedType} extruder: current ${currentAvgDistance.toFixed(2)}mm, recommended ${recommendedDistance}mm`);
  if (currentAvgDistance > recommendedDistance + 1) {
    recommendations.push(`Reduce retraction to speed up prints by ${(totalRetractionTime * 0.3).toFixed(1)}s`);
  }
  if (currentAvgDistance < recommendedDistance - 0.5) {
    recommendations.push(`Increase retraction to reduce stringing by ${stringingRiskReduction.toFixed(0)}%`);
  }
  if (retractionCount === 0) {
    recommendations.push('No retractions detected — enable retraction for better print quality');
  }
  if (optimizationScore > 80) {
    recommendations.push('Retraction distance is well-optimized');
  }

  return {
    optimization, retractionCount, currentAvgDistance,
    extruderType: detectedType, totalRetractionTime,
    stringingRiskReduction, optimizationScore, recommendations,
  };
}

// ── 4. G-code Block Structure Analyzer ──

export interface BlockInfo {
  /** Block start line */
  startLine: number;
  /** Block end line */
  endLine: number;
  /** Block type */
  type: 'header' | 'setup' | 'operation' | 'tool_change' | 'footer' | 'comment';
  /** Line count */
  lineCount: number;
  /** Description */
  description: string;
}

export interface BlockStructureResult {
  /** All blocks */
  blocks: BlockInfo[];
  /** Block count */
  blockCount: number;
  /** Total lines */
  totalLines: number;
  /** Block type distribution */
  typeDistribution: { [type: string]: number };
  /** Structure score (0-100) */
  structureScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze G-code block structure.
 * Identifies logical blocks: header, setup, operations, tool changes, footer.
 *
 * @param lines G-code lines
 */
export function analyzeBlockStructure(lines: string[]): BlockStructureResult {
  const blocks: BlockInfo[] = [];
  let currentBlockStart = 0;
  let currentBlockType: BlockInfo['type'] = 'header';
  let currentBlockDesc = 'Header';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    let newType: BlockInfo['type'] | null = null;
    let newDesc = '';

    // Detect block transitions
    if (line.startsWith(';') || line.startsWith('(')) {
      const comment = line.replace(/^[;(]/, '').replace(/[)]$/, '').trim();
      if (/^(setup|init|start)/i.test(comment)) {
        newType = 'setup'; newDesc = 'Setup';
      } else if (/^(operation|op |cut|mill|drill)/i.test(comment)) {
        newType = 'operation'; newDesc = comment.substring(0, 30);
      } else if (/^(tool|t\d+)/i.test(comment)) {
        newType = 'tool_change'; newDesc = 'Tool Change';
      } else if (/^(end|footer|finish)/i.test(comment)) {
        newType = 'footer'; newDesc = 'Footer';
      }
    }

    // Detect tool change
    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (/\bM6\b/i.test(code) || /\bM06\b/i.test(code)) {
      newType = 'tool_change'; newDesc = 'Tool Change';
    }

    // Detect end
    if (/\bM30\b/i.test(code) || /\bM2\b/i.test(code)) {
      newType = 'footer'; newDesc = 'Program End';
    }

    if (newType && newType !== currentBlockType) {
      // Close current block
      if (i > currentBlockStart) {
        blocks.push({
          startLine: currentBlockStart, endLine: i - 1,
          type: currentBlockType, lineCount: i - currentBlockStart,
          description: currentBlockDesc,
        });
      }
      currentBlockStart = i;
      currentBlockType = newType;
      currentBlockDesc = newDesc;
    }
  }

  // Close final block
  if (lines.length > currentBlockStart) {
    blocks.push({
      startLine: currentBlockStart, endLine: lines.length - 1,
      type: currentBlockType, lineCount: lines.length - currentBlockStart,
      description: currentBlockDesc,
    });
  }

  const blockCount = blocks.length;
  const totalLines = lines.length;
  const typeDistribution: { [type: string]: number } = {};
  for (const b of blocks) {
    typeDistribution[b.type] = (typeDistribution[b.type] ?? 0) + 1;
  }

  // Structure score: more blocks = better organization
  const structureScore = Math.min(100, blockCount * 10 + (typeDistribution.operation ?? 0) * 5);

  const recommendations: string[] = [];
  recommendations.push(`${blockCount} blocks detected across ${totalLines} lines`);
  for (const [type, count] of Object.entries(typeDistribution)) {
    recommendations.push(`${type}: ${count} blocks`);
  }
  if (blockCount < 3 && totalLines > 100) {
    recommendations.push('Few blocks detected — add section comments for readability');
  }
  if (!typeDistribution.setup) {
    recommendations.push('No setup block — add initialization section');
  }
  if (!typeDistribution.footer) {
    recommendations.push('No footer block — add program end (M30)');
  }
  if (structureScore > 70) {
    recommendations.push('Well-structured G-code — clear block organization');
  }

  return {
    blocks, blockCount, totalLines, typeDistribution,
    structureScore, recommendations,
  };
}

// ── 5. CNC Feed Per Revolution Calculator ──

export interface FeedPerRevolutionPoint {
  /** Line number */
  line: number;
  /** Feed rate in mm/min */
  feedRate: number;
  /** RPM */
  rpm: number;
  /** Feed per revolution in mm/rev */
  feedPerRev: number;
  /** Recommended range */
  recommendedRange: { min: number; max: number };
  /** In range */
  inRange: boolean;
}

export interface FeedPerRevolutionResult {
  /** Per-point data */
  points: FeedPerRevolutionPoint[];
  /** Average feed per revolution */
  avgFeedPerRev: number;
  /** Max feed per revolution */
  maxFeedPerRev: number;
  /** In-range percentage */
  inRangePercentage: number;
  /** Feed per rev score (0-100) */
  feedPerRevScore: number;
  /** Material */
  material: string;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Calculate feed per revolution.
 * Feed per rev = feedRate / RPM
 *
 * @param lines G-code lines
 * @param material Material type (default 'aluminum')
 */
export function calculateFeedPerRevolution(
  lines: string[],
  material: string = 'aluminum',
): FeedPerRevolutionResult {
  const ranges: { [material: string]: { min: number; max: number } } = {
    aluminum: { min: 0.1, max: 0.3 },
    steel: { min: 0.05, max: 0.15 },
    stainless: { min: 0.04, max: 0.12 },
    wood: { min: 0.2, max: 0.5 },
    plastic: { min: 0.2, max: 0.4 },
  };

  const recommendedRange = ranges[material] ?? ranges.aluminum;
  const points: FeedPerRevolutionPoint[] = [];
  let rpm = 0;
  let feedRate = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const sMatch = code.match(/\bS(\d*\.?\d+)/i);
    if (sMatch) rpm = parseFloat(sMatch[1]);

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) feedRate = parseFloat(fMatch[1]);

    if (!/\bG1\b/i.test(code) || rpm === 0) continue;

    const feedPerRev = feedRate / rpm;
    const inRange = feedPerRev >= recommendedRange.min && feedPerRev <= recommendedRange.max;

    points.push({ line: i, feedRate, rpm, feedPerRev, recommendedRange, inRange });
  }

  const feedPerRevs = points.map(p => p.feedPerRev);
  const avgFeedPerRev = feedPerRevs.length > 0 ? feedPerRevs.reduce((a, b) => a + b, 0) / feedPerRevs.length : 0;
  const maxFeedPerRev = feedPerRevs.length > 0 ? Math.max(...feedPerRevs) : 0;
  const inRangeCount = points.filter(p => p.inRange).length;
  const inRangePercentage = points.length > 0 ? (inRangeCount / points.length) * 100 : 0;
  const feedPerRevScore = inRangePercentage;

  const recommendations: string[] = [];
  if (maxFeedPerRev > recommendedRange.max) {
    recommendations.push(`Max feed/rev ${maxFeedPerRev.toFixed(3)}mm exceeds recommended ${recommendedRange.max} — reduce feed or increase RPM`);
  }
  if (avgFeedPerRev < recommendedRange.min) {
    recommendations.push(`Avg feed/rev ${avgFeedPerRev.toFixed(3)}mm below recommended ${recommendedRange.min} — increase feed or reduce RPM`);
  }
  if (inRangePercentage < 50) {
    recommendations.push(`Only ${inRangePercentage.toFixed(0)}% in range — optimize feed/RPM ratio`);
  }
  if (inRangePercentage > 90) {
    recommendations.push('Feed per revolution is well-optimized');
  }

  return {
    points, avgFeedPerRev, maxFeedPerRev, inRangePercentage,
    feedPerRevScore, material, recommendations,
  };
}

// ── 6. Print Thin Wall Analyzer ──

export interface ThinWallInfo {
  /** Wall start X */
  startX: number;
  /** Wall start Y */
  startY: number;
  /** Wall end X */
  endX: number;
  /** Wall end Y */
  endY: number;
  /** Wall length in mm */
  length: number;
  /** Wall thickness estimate in mm */
  thickness: number;
  /** Printability */
  printable: boolean;
  /** Issues */
  issues: string[];
}

export interface ThinWallResult {
  /** All thin walls */
  walls: ThinWallInfo[];
  /** Wall count */
  wallCount: number;
  /** Thin wall count (below threshold) */
  thinWallCount: number;
  /** Average wall thickness */
  avgThickness: number;
  /** Min wall thickness */
  minThickness: number;
  /** Printability score (0-100) */
  printabilityScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze thin wall printability.
 * Thin walls may not print correctly if thinner than nozzle diameter.
 *
 * @param lines G-code lines
 * @param nozzleDiameter Nozzle diameter in mm (default 0.4)
 */
export function analyzeThinWalls(
  lines: string[],
  nozzleDiameter: number = 0.4,
): ThinWallResult {
  const walls: ThinWallInfo[] = [];
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
      if (dist > 0.5) {
        // Estimate thickness from extrusion amount
        const eDelta = e - prevE;
        const thickness = eDelta / dist; // Simplified

        const issues: string[] = [];
        let printable = true;

        if (thickness < nozzleDiameter * 0.5) {
          issues.push(`Too thin (${thickness.toFixed(3)}mm < ${nozzleDiameter * 0.5}mm)`);
          printable = false;
        }
        if (dist > 50 && thickness < nozzleDiameter) {
          issues.push(`Long thin wall (${dist.toFixed(0)}mm) may sag`);
          printable = false;
        }

        walls.push({
          startX: prevX, startY: prevY, endX: x, endY: y,
          length: dist, thickness, printable, issues,
        });
      }
    }

    prevX = x; prevY = y; prevE = e;
  }

  const wallCount = walls.length;
  const thinWallCount = walls.filter(w => !w.printable).length;
  const thicknesses = walls.map(w => w.thickness);
  const avgThickness = thicknesses.length > 0 ? thicknesses.reduce((a, b) => a + b, 0) / thicknesses.length : 0;
  const minThickness = thicknesses.length > 0 ? Math.min(...thicknesses) : 0;
  const printabilityScore = wallCount > 0 ? ((wallCount - thinWallCount) / wallCount) * 100 : 100;

  const recommendations: string[] = [];
  if (thinWallCount > 0) {
    recommendations.push(`${thinWallCount} thin walls may not print correctly — increase wall thickness`);
  }
  if (minThickness < nozzleDiameter * 0.5) {
    recommendations.push(`Min wall thickness ${minThickness.toFixed(3)}mm — below nozzle diameter (${nozzleDiameter}mm)`);
  }
  if (wallCount > 0) {
    recommendations.push(`${wallCount} walls, avg thickness ${avgThickness.toFixed(3)}mm`);
  }
  if (printabilityScore > 90) {
    recommendations.push('Good wall printability — all walls above minimum thickness');
  }

  return {
    walls, wallCount, thinWallCount, avgThickness,
    minThickness, printabilityScore, recommendations,
  };
}

// ── 7. G-code Variable Usage Tracker ──

export interface VariableInfo {
  /** Variable name */
  name: string;
  /** Value */
  value: number | string;
  /** Usage count */
  usageCount: number;
  /** Definition line */
  definitionLine: number;
  /** Is a parameter */
  isParameter: boolean;
}

export interface VariableUsageResult {
  /** All variables */
  variables: VariableInfo[];
  /** Variable count */
  variableCount: number;
  /** Parameter count */
  parameterCount: number;
  /** Unused variables */
  unusedVariables: number;
  /** Most used variable */
  mostUsed: VariableInfo | null;
  /** Variable usage score (0-100) */
  usageScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Track variable usage in G-code.
 * Identifies #variables, parameters, and their usage patterns.
 *
 * @param lines G-code lines
 */
export function trackVariableUsage(lines: string[]): VariableUsageResult {
  const varMap = new Map<string, VariableInfo>();
  const usageMap = new Map<string, number>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Variable definition: #1 = 10 or #<name> = 5
    const defMatch = code.match(/#(\d+|<[^>]+>)\s*=\s*(-?\d*\.?\d+)/);
    if (defMatch) {
      const name = defMatch[1];
      const value = parseFloat(defMatch[2]);
      if (!varMap.has(name)) {
        varMap.set(name, {
          name, value, usageCount: 0,
          definitionLine: i, isParameter: /^\d+$/.test(name),
        });
      }
    }

    // Variable usage: #1, #<name>
    const usageMatches = code.match(/#(\d+|<[^>]+>)/g);
    if (usageMatches) {
      for (const match of usageMatches) {
        const name = match.substring(1);
        usageMap.set(name, (usageMap.get(name) ?? 0) + 1);
      }
    }
  }

  // Update usage counts
  for (const [name, count] of usageMap) {
    if (varMap.has(name)) {
      varMap.get(name)!.usageCount = count;
    }
  }

  const variables = Array.from(varMap.values());
  const variableCount = variables.length;
  const parameterCount = variables.filter(v => v.isParameter).length;
  const unusedVariables = variables.filter(v => v.usageCount === 0).length;
  const mostUsed = variables.length > 0
    ? variables.reduce((max, v) => v.usageCount > max.usageCount ? v : max, variables[0])
    : null;
  const usageScore = variableCount > 0
    ? Math.max(0, 100 - (unusedVariables / variableCount) * 100)
    : 100;

  const recommendations: string[] = [];
  if (unusedVariables > 0) {
    recommendations.push(`${unusedVariables} unused variables — remove for cleaner code`);
  }
  if (mostUsed) {
    recommendations.push(`Most used: #${mostUsed.name} (${mostUsed.usageCount} times)`);
  }
  if (parameterCount > 0) {
    recommendations.push(`${parameterCount} numbered parameters, ${variableCount - parameterCount} named variables`);
  }
  if (variableCount === 0) {
    recommendations.push('No variables detected — use variables for parametric programming');
  }
  if (usageScore > 80) {
    recommendations.push('Good variable usage — minimal unused variables');
  }

  return {
    variables, variableCount, parameterCount, unusedVariables,
    mostUsed, usageScore, recommendations,
  };
}

// ── 8. CNC Tool Path Segment Classifier ──

export interface SegmentClass {
  /** Segment type */
  type: 'roughing' | 'finishing' | 'drilling' | 'profiling' | 'facing' | 'contouring' | 'plunging' | 'unknown';
  /** Line count */
  lineCount: number;
  /** Total distance in mm */
  distance: number;
  /** Percentage of total */
  percentage: number;
  /** Average feed rate */
  avgFeedRate: number;
  /** Average depth */
  avgDepth: number;
}

export interface SegmentClassifierResult {
  /** Segment classifications */
  segments: SegmentClass[];
  /** Total segments */
  totalSegments: number;
  /** Dominant segment type */
  dominantType: string;
  /** Classification confidence (0-100) */
  confidence: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Classify toolpath segments by operation type.
 * Identifies roughing, finishing, drilling, profiling, facing, etc.
 *
 * @param lines G-code lines
 */
export function classifyToolpathSegments(lines: string[]): SegmentClassifierResult {
  const segmentMap = new Map<string, SegmentClass>();
  let prevX = 0, prevY = 0, prevZ = 0;
  let feedRate = 0;
  let totalDistance = 0;

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
    if (dist > 0) {
      totalDistance += dist;

      // Classify segment
      let type: SegmentClass['type'] = 'unknown';
      const depth = Math.abs(z);

      if (depth === 0) {
        type = 'facing';
      } else if (feedRate < 100 && depth > 1) {
        type = 'plunging';
      } else if (feedRate > 2000 && depth < 0.5) {
        type = 'finishing';
      } else if (feedRate < 500 && depth > 2) {
        type = 'roughing';
      } else if (depth < 0.5 && dist > 10) {
        type = 'profiling';
      } else if (dist < 1) {
        type = 'drilling';
      } else {
        type = 'contouring';
      }

      if (!segmentMap.has(type)) {
        segmentMap.set(type, {
          type, lineCount: 0, distance: 0, percentage: 0,
          avgFeedRate: 0, avgDepth: 0,
        });
      }
      const seg = segmentMap.get(type)!;
      seg.lineCount++;
      seg.distance += dist;
      seg.avgFeedRate = (seg.avgFeedRate * (seg.lineCount - 1) + feedRate) / seg.lineCount;
      seg.avgDepth = (seg.avgDepth * (seg.lineCount - 1) + depth) / seg.lineCount;
    }

    prevX = x; prevY = y; prevZ = z;
  }

  const segments = Array.from(segmentMap.values());
  for (const seg of segments) {
    seg.percentage = totalDistance > 0 ? (seg.distance / totalDistance) * 100 : 0;
  }
  segments.sort((a, b) => b.distance - a.distance);

  const totalSegments = segments.length;
  const dominantType = segments.length > 0 ? segments[0].type : 'none';
  const confidence = segments.length > 0 ? segments[0].percentage : 0;

  const recommendations: string[] = [];
  for (const seg of segments) {
    recommendations.push(`${seg.type}: ${seg.lineCount} moves, ${seg.distance.toFixed(0)}mm (${seg.percentage.toFixed(0)}%)`);
  }
  if (dominantType !== 'none') {
    recommendations.push(`Dominant: ${dominantType} (${confidence.toFixed(0)}% of path)`);
  }
  if (segments.length === 0) {
    recommendations.push('No cutting segments detected');
  }
  if (segments.some(s => s.type === 'roughing') && !segments.some(s => s.type === 'finishing')) {
    recommendations.push('Roughing detected but no finishing pass — add finishing for better surface finish');
  }

  return {
    segments, totalSegments, dominantType, confidence, recommendations,
  };
}

// ── 9. Print Infill Density Variance Analyzer ──

export interface InfillRegion {
  /** Grid X */
  gridX: number;
  /** Grid Y */
  gridY: number;
  /** Estimated density percentage */
  density: number;
  /** Extrusion distance in region */
  extrusionDistance: number;
  /** Region area */
  area: number;
}

export interface InfillVarianceResult {
  /** Per-region density data */
  regions: InfillRegion[];
  /** Grid size */
  gridSize: { x: number; y: number };
  /** Average density */
  avgDensity: number;
  /** Density variance */
  densityVariance: number;
  /** Density uniformity score (0-100) */
  uniformityScore: number;
  /** Min density */
  minDensity: number;
  /** Max density */
  maxDensity: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze infill density variance across the print.
 * Detects regions with different infill densities.
 *
 * @param lines G-code lines
 * @param gridResolution Grid resolution (default 10)
 */
export function analyzeInfillDensityVariance(
  lines: string[],
  gridResolution: number = 10,
): InfillVarianceResult {
  let prevX = 0, prevY = 0, prevZ = 0, prevE = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const segments: { x: number; y: number; dist: number; e: number }[] = [];

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

    if (e > prevE) {
      const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
      if (dist > 0) {
        segments.push({ x: (x + prevX) / 2, y: (y + prevY) / 2, dist, e: e - prevE });
        minX = Math.min(minX, x, prevX);
        maxX = Math.max(maxX, x, prevX);
        minY = Math.min(minY, y, prevY);
        maxY = Math.max(maxY, y, prevY);
      }
    }

    prevX = x; prevY = y; prevZ = z; prevE = e;
  }

  if (segments.length === 0 || !isFinite(minX)) {
    return {
      regions: [], gridSize: { x: 0, y: 0 }, avgDensity: 0,
      densityVariance: 0, uniformityScore: 100,
      minDensity: 0, maxDensity: 0,
      recommendations: ['No extrusion data for infill analysis'],
    };
  }

  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const cellW = rangeX / gridResolution;
  const cellH = rangeY / gridResolution;

  const grid: InfillRegion[][] = [];
  for (let gx = 0; gx < gridResolution; gx++) {
    grid[gx] = [];
    for (let gy = 0; gy < gridResolution; gy++) {
      grid[gx][gy] = {
        gridX: gx, gridY: gy, density: 0,
        extrusionDistance: 0, area: cellW * cellH,
      };
    }
  }

  for (const seg of segments) {
    const gx = Math.min(gridResolution - 1, Math.max(0, Math.floor((seg.x - minX) / cellW)));
    const gy = Math.min(gridResolution - 1, Math.max(0, Math.floor((seg.y - minY) / cellH)));
    grid[gx][gy].extrusionDistance += seg.dist;
  }

  const regions: InfillRegion[] = [];
  for (let gx = 0; gx < gridResolution; gx++) {
    for (let gy = 0; gy < gridResolution; gy++) {
      const cell = grid[gx][gy];
      // Density = extrusion distance / area
      cell.density = cell.area > 0 ? (cell.extrusionDistance / cell.area) * 100 : 0;
      regions.push(cell);
    }
  }

  const activeRegions = regions.filter(r => r.density > 0);
  const densities = activeRegions.map(r => r.density);
  const avgDensity = densities.length > 0 ? densities.reduce((a, b) => a + b, 0) / densities.length : 0;
  const minDensity = densities.length > 0 ? Math.min(...densities) : 0;
  const maxDensity = densities.length > 0 ? Math.max(...densities) : 0;
  const densityVariance = densities.length > 0
    ? densities.reduce((s, d) => s + (d - avgDensity) ** 2, 0) / densities.length : 0;
  const uniformityScore = Math.max(0, 100 - Math.sqrt(densityVariance) * 2);

  const recommendations: string[] = [];
  if (maxDensity - minDensity > 50) {
    recommendations.push(`Large density variance (${(maxDensity - minDensity).toFixed(0)}) — check infill settings`);
  }
  if (uniformityScore < 50) {
    recommendations.push('Non-uniform infill — some regions may be weaker');
  }
  if (activeRegions.length > 0) {
    recommendations.push(`${activeRegions.length} regions with infill, avg ${avgDensity.toFixed(0)}%`);
  }
  if (uniformityScore > 80) {
    recommendations.push('Uniform infill density — consistent strength');
  }

  return {
    regions, gridSize: { x: gridResolution, y: gridResolution },
    avgDensity, densityVariance, uniformityScore,
    minDensity, maxDensity, recommendations,
  };
}

// ── 10. G-code Error Pattern Detector ──

export interface ErrorPattern {
  /** Pattern name */
  name: string;
  /** Occurrences */
  occurrences: number;
  /** Lines affected */
  lines: number[];
  /** Severity */
  severity: 'low' | 'medium' | 'high';
  /** Description */
  description: string;
  /** Fix suggestion */
  fix: string;
}

export interface ErrorPatternResult {
  /** All detected patterns */
  patterns: ErrorPattern[];
  /** Pattern count */
  patternCount: number;
  /** Total occurrences */
  totalOccurrences: number;
  /** By severity */
  bySeverity: { low: number; medium: number; high: number };
  /** Error-free score (0-100, higher is better) */
  errorFreeScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Detect common error patterns in G-code.
 * Identifies repeated mistakes and provides fixes.
 *
 * @param lines G-code lines
 */
export function detectErrorPatterns(lines: string[]): ErrorPatternResult {
  const patternMap = new Map<string, ErrorPattern>();
  let prevZ = 0;
  let hasG28 = false;
  let hasUnits = false;
  let hasPositioning = false;
  let consecutiveG0 = 0;
  let maxConsecutiveG0 = 0;

  function addPattern(name: string, line: number, severity: ErrorPattern['severity'], desc: string, fix: string) {
    if (!patternMap.has(name)) {
      patternMap.set(name, { name, occurrences: 0, lines: [], severity, description: desc, fix });
    }
    const p = patternMap.get(name)!;
    p.occurrences++;
    p.lines.push(line);
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    if (/\bG28\b/i.test(code)) hasG28 = true;
    if (/\bG2[01]\b/i.test(code)) hasUnits = true;
    if (/\bG9[01]\b/i.test(code)) hasPositioning = true;

    // Missing initialization
    if (i === 5 && !hasG28) {
      addPattern('no_homing', i, 'high', 'No homing in first lines', 'Add G28 at start');
    }
    if (i === 5 && !hasUnits) {
      addPattern('no_units', i, 'low', 'No units specified', 'Add G20/G21 at start');
    }
    if (i === 5 && !hasPositioning) {
      addPattern('no_positioning', i, 'low', 'No positioning mode', 'Add G90/G91 at start');
    }

    // Consecutive rapid moves
    if (/\bG0\b/i.test(code)) {
      consecutiveG0++;
      maxConsecutiveG0 = Math.max(maxConsecutiveG0, consecutiveG0);
    } else {
      consecutiveG0 = 0;
    }

    // Z without move
    if (/\bZ\b/i.test(code) && !/\b[XY]\b/i.test(code) && /\bG1\b/i.test(code)) {
      const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
      if (zMatch) {
        const z = parseFloat(zMatch[1]);
        if (z < prevZ - 5) {
          addPattern('rapid_z_drop', i, 'medium', 'Large Z drop', 'Use G0 for rapid Z moves');
        }
        prevZ = z;
      }
    }

    // Missing feed rate
    if (/\bG1\b/i.test(code) && !/\bF\b/i.test(code)) {
      addPattern('missing_feed', i, 'low', 'G1 without feed rate', 'Specify F value');
    }

    // Negative RPM
    const sMatch = code.match(/\bS(-?\d*\.?\d+)/i);
    if (sMatch && parseFloat(sMatch[1]) < 0) {
      addPattern('negative_rpm', i, 'high', 'Negative RPM', 'Use positive S value');
    }
  }

  if (maxConsecutiveG0 > 10) {
    addPattern('excessive_rapids', 0, 'low', `${maxConsecutiveG0} consecutive rapid moves`, 'Combine rapid moves');
  }

  const patterns = Array.from(patternMap.values());
  const patternCount = patterns.length;
  const totalOccurrences = patterns.reduce((s, p) => s + p.occurrences, 0);
  const bySeverity = {
    low: patterns.filter(p => p.severity === 'low').length,
    medium: patterns.filter(p => p.severity === 'medium').length,
    high: patterns.filter(p => p.severity === 'high').length,
  };
  const errorFreeScore = Math.max(0, 100 - bySeverity.high * 30 - bySeverity.medium * 15 - bySeverity.low * 5);

  const recommendations: string[] = [];
  for (const p of patterns) {
    recommendations.push(`${p.name}: ${p.occurrences} occurrences — ${p.fix}`);
  }
  if (patternCount === 0) {
    recommendations.push('No error patterns detected — clean G-code');
  }
  if (bySeverity.high > 0) {
    recommendations.push(`${bySeverity.high} high-severity patterns — fix before running`);
  }

  return {
    patterns, patternCount, totalOccurrences, bySeverity,
    errorFreeScore, recommendations,
  };
}

// ── 11. CNC Surface Speed Calculator ──

export interface SurfaceSpeedPoint {
  /** Line number */
  line: number;
  /** RPM */
  rpm: number;
  /** Tool diameter in mm */
  toolDiameter: number;
  /** Surface speed in m/min */
  surfaceSpeed: number;
  /** Recommended range */
  recommendedRange: { min: number; max: number };
  /** In range */
  inRange: boolean;
}

export interface SurfaceSpeedResult {
  /** Per-point data */
  points: SurfaceSpeedPoint[];
  /** Average surface speed */
  avgSurfaceSpeed: number;
  /** Max surface speed */
  maxSurfaceSpeed: number;
  /** In-range percentage */
  inRangePercentage: number;
  /** Surface speed score (0-100) */
  surfaceSpeedScore: number;
  /** Material */
  material: string;
  /** Tool diameter used */
  toolDiameter: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Calculate surface speed (cutting speed).
 * Surface speed = π × D × RPM / 1000 (m/min)
 *
 * @param lines G-code lines
 * @param toolDiameter Tool diameter in mm (default 6)
 * @param material Material type (default 'aluminum')
 */
export function calculateSurfaceSpeed(
  lines: string[],
  toolDiameter: number = 6,
  material: string = 'aluminum',
): SurfaceSpeedResult {
  const ranges: { [material: string]: { min: number; max: number } } = {
    aluminum: { min: 200, max: 600 },
    steel: { min: 50, max: 150 },
    stainless: { min: 40, max: 120 },
    wood: { min: 300, max: 800 },
    plastic: { min: 100, max: 400 },
  };

  const recommendedRange = ranges[material] ?? ranges.aluminum;
  const points: SurfaceSpeedPoint[] = [];
  let rpm = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const sMatch = code.match(/\bS(\d*\.?\d+)/i);
    if (sMatch) rpm = parseFloat(sMatch[1]);

    if (!/\bG1\b/i.test(code) || rpm === 0) continue;

    // Surface speed = π × D × RPM / 1000 (m/min)
    const surfaceSpeed = Math.PI * toolDiameter * rpm / 1000;
    const inRange = surfaceSpeed >= recommendedRange.min && surfaceSpeed <= recommendedRange.max;

    points.push({ line: i, rpm, toolDiameter, surfaceSpeed, recommendedRange, inRange });
  }

  const speeds = points.map(p => p.surfaceSpeed);
  const avgSurfaceSpeed = speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;
  const maxSurfaceSpeed = speeds.length > 0 ? Math.max(...speeds) : 0;
  const inRangeCount = points.filter(p => p.inRange).length;
  const inRangePercentage = points.length > 0 ? (inRangeCount / points.length) * 100 : 0;
  const surfaceSpeedScore = inRangePercentage;

  const recommendations: string[] = [];
  if (maxSurfaceSpeed > recommendedRange.max) {
    recommendations.push(`Max surface speed ${maxSurfaceSpeed.toFixed(0)}m/min exceeds ${recommendedRange.max} for ${material} — reduce RPM`);
  }
  if (avgSurfaceSpeed < recommendedRange.min) {
    recommendations.push(`Avg surface speed ${avgSurfaceSpeed.toFixed(0)}m/min below ${recommendedRange.min} for ${material} — increase RPM`);
  }
  if (inRangePercentage < 50) {
    recommendations.push(`Only ${inRangePercentage.toFixed(0)}% in range — adjust RPM for ${material}`);
  }
  if (inRangePercentage > 90) {
    recommendations.push('Surface speed is well-optimized for material');
  }

  return {
    points, avgSurfaceSpeed, maxSurfaceSpeed, inRangePercentage,
    surfaceSpeedScore, material, toolDiameter, recommendations,
  };
}

// ── 12. Print Layer Time Variance Analyzer ──

export interface LayerTimeData {
  /** Layer number */
  layer: number;
  /** Z height */
  zHeight: number;
  /** Layer time in seconds */
  time: number;
  /** Deviation from average */
  deviation: number;
  /** Is outlier */
  isOutlier: boolean;
}

export interface LayerTimeVarianceResult {
  /** Per-layer time data */
  layers: LayerTimeData[];
  /** Layer count */
  layerCount: number;
  /** Average layer time */
  avgLayerTime: number;
  /** Max layer time */
  maxLayerTime: number;
  /** Min layer time */
  minLayerTime: number;
  /** Time variance */
  timeVariance: number;
  /** Consistency score (0-100) */
  consistencyScore: number;
  /** Outlier count */
  outlierCount: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze layer time variance.
 * Large variance can indicate inconsistent cooling and quality issues.
 *
 * @param lines G-code lines
 */
export function analyzeLayerTimeVariance(lines: string[]): LayerTimeVarianceResult {
  const layers: LayerTimeData[] = [];
  let currentZ = 0;
  let firstZ = 0;
  let layerNum = 0;
  let feedRate = 0;
  let prevX = 0, prevY = 0;
  let layerTime = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) feedRate = parseFloat(fMatch[1]);

    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    if (zMatch) {
      const z = parseFloat(zMatch[1]);
      if (firstZ === 0) firstZ = z;
      if (z > currentZ + 0.01 && layerNum > 0) {
        // Layer change
        layers.push({
          layer: layerNum, zHeight: currentZ, time: layerTime,
          deviation: 0, isOutlier: false,
        });
        layerNum++;
        currentZ = z;
        layerTime = 0;
      } else if (layerNum === 0) {
        currentZ = z;
        layerNum = 1;
      }
    }

    if (/\bG1\b/i.test(code)) {
      const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
      const x = xMatch ? parseFloat(xMatch[1]) : prevX;
      const y = yMatch ? parseFloat(yMatch[1]) : prevY;
      const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
      if (dist > 0 && feedRate > 0) {
        layerTime += dist / (feedRate / 60);
      }
      prevX = x; prevY = y;
    }
  }

  // Record last layer
  if (layerTime > 0) {
    layers.push({
      layer: layerNum, zHeight: currentZ, time: layerTime,
      deviation: 0, isOutlier: false,
    });
  }

  const layerCount = layers.length;
  const times = layers.map(l => l.time);
  const avgLayerTime = times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0;
  const maxLayerTime = times.length > 0 ? Math.max(...times) : 0;
  const minLayerTime = times.length > 0 ? Math.min(...times) : 0;

  // Compute variance and deviations
  const timeVariance = times.length > 0
    ? times.reduce((s, t) => s + (t - avgLayerTime) ** 2, 0) / times.length : 0;
  const stdDev = Math.sqrt(timeVariance);

  // Mark outliers (>2 standard deviations from mean)
  let outlierCount = 0;
  for (const l of layers) {
    l.deviation = l.time - avgLayerTime;
    l.isOutlier = Math.abs(l.deviation) > 2 * stdDev;
    if (l.isOutlier) outlierCount++;
  }

  const consistencyScore = avgLayerTime > 0
    ? Math.max(0, 100 - (stdDev / avgLayerTime) * 100)
    : 100;

  const recommendations: string[] = [];
  if (outlierCount > 0) {
    recommendations.push(`${outlierCount} layer time outliers — check for inconsistent speeds`);
  }
  if (maxLayerTime > avgLayerTime * 3) {
    recommendations.push(`Max layer time ${maxLayerTime.toFixed(0)}s is 3× average — long layer detected`);
  }
  if (consistencyScore < 50) {
    recommendations.push(`Low consistency (${consistencyScore.toFixed(0)}%) — large layer time variance`);
  }
  if (layerCount > 0) {
    recommendations.push(`${layerCount} layers, avg ${avgLayerTime.toFixed(1)}s/layer`);
  }
  if (consistencyScore > 80) {
    recommendations.push('Consistent layer times — uniform cooling expected');
  }

  return {
    layers, layerCount, avgLayerTime, maxLayerTime, minLayerTime,
    timeVariance, consistencyScore, outlierCount, recommendations,
  };
}
