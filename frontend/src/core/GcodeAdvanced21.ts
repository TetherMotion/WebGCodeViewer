/**
 * @file GcodeAdvanced21.ts
 * @brief Twenty-first batch of advanced G-code analysis features for CNC and 3D printing.
 *
 * This module provides 12 additional high-impact features:
 *  1. G-code toolpath bounding box per layer (Universal) — per-layer bounds
 *  2. CNC tool engagement time calculator (CNC) — active cutting time
 *  3. Print retraction frequency analyzer (3DP) — retraction patterns
 *  4. G-code spindle load profile estimator (Universal) — load over time
 *  5. CNC tool path direction change counter (CNC) — count direction changes
 *  6. Print bed adhesion area calculator (3DP) — first layer adhesion
 *  7. G-code coordinate system rotation detector (Universal) — detect rotations
 *  8. CNC tool wear rate calculator (CNC) — wear per cutting distance
 *  9. Print flow rate consistency analyzer (3DP) — flow consistency
 * 10. G-code command sequence validator (Universal) — validate sequences
 * 11. CNC feed rate harmonics analyzer (CNC) — feed rate harmonics
 * 12. Print layer height variance analyzer (3DP) — layer height variance
 */

// ── 1. G-code Toolpath Bounding Box Per Layer ──

export interface LayerBounds {
  /** Layer number */
  layer: number;
  /** Z height */
  zHeight: number;
  /** Bounds */
  bounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
  /** Width (X extent) */
  width: number;
  /** Depth (Y extent) */
  depth: number;
  /** Height (Z extent) */
  height: number;
  /** Footprint area in mm² */
  footprintArea: number;
  /** Volume in mm³ */
  volume: number;
}

export interface PerLayerBoundsResult {
  /** Per-layer bounds */
  layers: LayerBounds[];
  /** Layer count */
  layerCount: number;
  /** Overall bounds */
  overallBounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
  /** Overall footprint area */
  overallFootprintArea: number;
  /** Layer with largest footprint */
  largestLayer: LayerBounds | null;
  /** Footprint stability score (0-100) */
  stabilityScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Calculate bounding box for each layer.
 * Useful for detecting part size changes, overhangs, and print stability.
 *
 * @param lines G-code lines
 */
export function calculatePerLayerBounds(lines: string[]): PerLayerBoundsResult {
  const layers: LayerBounds[] = [];
  let prevX = 0, prevY = 0, prevZ = 0;
  let firstZ = 0;
  let layerNum = 0;
  let currentBounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  let currentZ = 0;

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
    if (z > currentZ + 0.01 && layerNum > 0) {
      // Layer change — save current bounds
      const width = currentBounds.maxX - currentBounds.minX;
      const depth = currentBounds.maxY - currentBounds.minY;
      const height = currentBounds.maxZ - currentBounds.minZ;
      layers.push({
        layer: layerNum, zHeight: currentZ,
        bounds: { ...currentBounds },
        width: isFinite(width) ? width : 0,
        depth: isFinite(depth) ? depth : 0,
        height: isFinite(height) ? height : 0,
        footprintArea: isFinite(width) && isFinite(depth) ? width * depth : 0,
        volume: isFinite(width) && isFinite(depth) && isFinite(height) ? width * depth * height : 0,
      });
      layerNum++;
      currentZ = z;
      currentBounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
    } else if (layerNum === 0) {
      currentZ = z;
      layerNum = 1;
    }

    currentBounds.minX = Math.min(currentBounds.minX, x);
    currentBounds.maxX = Math.max(currentBounds.maxX, x);
    currentBounds.minY = Math.min(currentBounds.minY, y);
    currentBounds.maxY = Math.max(currentBounds.maxY, y);
    currentBounds.minZ = Math.min(currentBounds.minZ, z);
    currentBounds.maxZ = Math.max(currentBounds.maxZ, z);

    prevX = x; prevY = y; prevZ = z;
  }

  // Save last layer
  if (layerNum > 0 && isFinite(currentBounds.minX)) {
    const width = currentBounds.maxX - currentBounds.minX;
    const depth = currentBounds.maxY - currentBounds.minY;
    const height = currentBounds.maxZ - currentBounds.minZ;
    layers.push({
      layer: layerNum, zHeight: currentZ,
      bounds: { ...currentBounds },
      width, depth, height,
      footprintArea: width * depth,
      volume: width * depth * height,
    });
  }

  if (layers.length === 0) {
    return {
      layers: [], layerCount: 0,
      overallBounds: { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 },
      overallFootprintArea: 0, largestLayer: null, stabilityScore: 100,
      recommendations: ['No layers detected for bounds analysis'],
    };
  }

  const overallBounds = {
    minX: Math.min(...layers.map(l => l.bounds.minX)),
    maxX: Math.max(...layers.map(l => l.bounds.maxX)),
    minY: Math.min(...layers.map(l => l.bounds.minY)),
    maxY: Math.max(...layers.map(l => l.bounds.maxY)),
    minZ: Math.min(...layers.map(l => l.bounds.minZ)),
    maxZ: Math.max(...layers.map(l => l.bounds.maxZ)),
  };
  const overallFootprintArea = (overallBounds.maxX - overallBounds.minX) * (overallBounds.maxY - overallBounds.minY);

  const largestLayer = layers.reduce((max, l) => l.footprintArea > max.footprintArea ? l : max, layers[0]);

  // Stability: how consistent footprints are
  const areas = layers.map(l => l.footprintArea);
  const avgArea = areas.reduce((a, b) => a + b, 0) / areas.length;
  const areaVariance = areas.reduce((s, a) => s + (a - avgArea) ** 2, 0) / areas.length;
  const cv = avgArea > 0 ? Math.sqrt(areaVariance) / avgArea : 0;
  const stabilityScore = Math.max(0, 100 - cv * 100);

  const recommendations: string[] = [];
  recommendations.push(`${layers.length} layers, overall footprint ${overallFootprintArea.toFixed(0)}mm²`);
  if (largestLayer) {
    recommendations.push(`Largest footprint: layer ${largestLayer.layer} (${largestLayer.footprintArea.toFixed(0)}mm²)`);
  }
  if (stabilityScore < 70) {
    recommendations.push(`Low footprint stability (${stabilityScore.toFixed(0)}%) — significant size variation between layers`);
  }
  if (stabilityScore > 90) {
    recommendations.push('Consistent footprint — stable part geometry');
  }

  return {
    layers, layerCount: layers.length, overallBounds,
    overallFootprintArea, largestLayer, stabilityScore,
    recommendations,
  };
}

// ── 2. CNC Tool Engagement Time Calculator ──

export interface EngagementTimeResult {
  /** Total engagement time in seconds */
  totalEngagementTime: number;
  /** Total non-cutting time in seconds */
  totalNonCuttingTime: number;
  /** Total time in seconds */
  totalTime: number;
  /** Engagement ratio (0-1) */
  engagementRatio: number;
  /** Per-tool engagement */
  perToolEngagement: { tool: number; time: number; distance: number }[];
  /** Engagement by depth */
  engagementByDepth: { depth: number; time: number }[];
  /** Average engagement per cutting pass */
  avgEngagementPerPass: number;
  /** Engagement score (0-100) */
  engagementScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Calculate tool engagement time.
 * Measures time spent actively cutting vs non-cutting moves.
 *
 * @param lines G-code lines
 */
export function calculateEngagementTime(lines: string[]): EngagementTimeResult {
  let prevX = 0, prevY = 0, prevZ = 0;
  let feedRate = 0;
  let currentTool = 0;
  let totalEngagementTime = 0;
  let totalNonCuttingTime = 0;
  const perToolMap = new Map<number, { time: number; distance: number }>();
  const depthMap = new Map<number, number>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Track tool
    const tMatch = code.match(/\bT(\d+)/i);
    if (tMatch) currentTool = parseInt(tMatch[1]);

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
    const isCutting = z < 0 && !isRapid;

    if (dist > 0 && feedRate > 0) {
      const time = dist / (feedRate / 60);
      if (isCutting) {
        totalEngagementTime += time;
        const toolData = perToolMap.get(currentTool) ?? { time: 0, distance: 0 };
        toolData.time += time;
        toolData.distance += dist;
        perToolMap.set(currentTool, toolData);

        const depthKey = Math.round(Math.abs(z));
        depthMap.set(depthKey, (depthMap.get(depthKey) ?? 0) + time);
      } else {
        totalNonCuttingTime += time;
      }
    }

    prevX = x; prevY = y; prevZ = z;
  }

  const totalTime = totalEngagementTime + totalNonCuttingTime;
  const engagementRatio = totalTime > 0 ? totalEngagementTime / totalTime : 0;
  const perToolEngagement = Array.from(perToolMap.entries())
    .map(([tool, data]) => ({ tool, time: data.time, distance: data.distance }))
    .sort((a, b) => b.time - a.time);
  const engagementByDepth = Array.from(depthMap.entries())
    .map(([depth, time]) => ({ depth, time }))
    .sort((a, b) => a.depth - b.depth);
  const avgEngagementPerPass = perToolEngagement.length > 0
    ? totalEngagementTime / perToolEngagement.length : 0;
  const engagementScore = Math.round(engagementRatio * 100);

  const recommendations: string[] = [];
  recommendations.push(`Engagement: ${totalEngagementTime.toFixed(1)}s cutting, ${totalNonCuttingTime.toFixed(1)}s non-cutting`);
  if (engagementRatio < 0.5) {
    recommendations.push(`Low engagement (${(engagementRatio * 100).toFixed(0)}%) — optimize travel moves`);
  }
  for (const te of perToolEngagement.slice(0, 3)) {
    recommendations.push(`Tool T${te.tool}: ${te.time.toFixed(1)}s cutting, ${te.distance.toFixed(0)}mm`);
  }
  if (engagementScore > 70) {
    recommendations.push('High engagement — efficient toolpath');
  }

  return {
    totalEngagementTime, totalNonCuttingTime, totalTime,
    engagementRatio, perToolEngagement, engagementByDepth,
    avgEngagementPerPass, engagementScore, recommendations,
  };
}

// ── 3. Print Retraction Frequency Analyzer ──

export interface RetractionFrequencyResult {
  /** Total retraction count */
  retractionCount: number;
  /** Total lines analyzed */
  totalLines: number;
  /** Retractions per 100 lines */
  retractionsPer100Lines: number;
  /** Average distance between retractions in mm */
  avgDistanceBetweenRetractions: number;
  /** Retraction clusters (multiple retractions close together) */
  clusterCount: number;
  /** Max consecutive retractions */
  maxConsecutiveRetractions: number;
  /** Frequency score (0-100, higher is better) */
  frequencyScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze retraction frequency patterns.
 * Frequent retractions can indicate travel-heavy toolpaths or stringing risk.
 *
 * @param lines G-code lines
 */
export function analyzeRetractionFrequency(lines: string[]): RetractionFrequencyResult {
  let prevE = 0;
  let prevX = 0, prevY = 0;
  let retractionCount = 0;
  let distanceSinceLastRetraction = 0;
  const distances: number[] = [];
  let consecutiveRetractions = 0;
  let maxConsecutiveRetractions = 0;
  let clusterCount = 0;
  let inCluster = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG[01]\b/i.test(code)) continue;

    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);
    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;

    if (eMatch) {
      const e = parseFloat(eMatch[1]);
      if (e < prevE) {
        retractionCount++;
        if (distanceSinceLastRetraction > 0) {
          distances.push(distanceSinceLastRetraction);
        }
        distanceSinceLastRetraction = 0;

        consecutiveRetractions++;
        maxConsecutiveRetractions = Math.max(maxConsecutiveRetractions, consecutiveRetractions);
        if (consecutiveRetractions > 2 && !inCluster) {
          clusterCount++;
          inCluster = true;
        }
      } else {
        consecutiveRetractions = 0;
        inCluster = false;
      }
      prevE = e;
    }

    const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
    distanceSinceLastRetraction += dist;
    prevX = x; prevY = y;
  }

  const totalLines = lines.length;
  const retractionsPer100Lines = totalLines > 0 ? (retractionCount / totalLines) * 100 : 0;
  const avgDistanceBetweenRetractions = distances.length > 0
    ? distances.reduce((a, b) => a + b, 0) / distances.length : 0;

  // Score: fewer clusters and reasonable frequency = better
  let frequencyScore = 100;
  if (retractionsPer100Lines > 10) frequencyScore -= 20;
  if (clusterCount > 5) frequencyScore -= 20;
  if (maxConsecutiveRetractions > 3) frequencyScore -= 15;
  if (avgDistanceBetweenRetractions < 5 && retractionCount > 10) frequencyScore -= 20;
  frequencyScore = Math.max(0, frequencyScore);

  const recommendations: string[] = [];
  recommendations.push(`${retractionCount} retractions in ${totalLines} lines (${retractionsPer100Lines.toFixed(1)}/100 lines)`);
  if (retractionsPer100Lines > 10) {
    recommendations.push('High retraction frequency — may indicate excessive travel');
  }
  if (clusterCount > 5) {
    recommendations.push(`${clusterCount} retraction clusters — check for stringing areas`);
  }
  if (maxConsecutiveRetractions > 3) {
    recommendations.push(`${maxConsecutiveRetractions} consecutive retractions — possible combing issue`);
  }
  if (retractionCount === 0) {
    recommendations.push('No retractions detected — enable for better print quality');
  }
  if (frequencyScore > 80) {
    recommendations.push('Good retraction frequency — balanced travel and printing');
  }

  return {
    retractionCount, totalLines, retractionsPer100Lines,
    avgDistanceBetweenRetractions, clusterCount, maxConsecutiveRetractions,
    frequencyScore, recommendations,
  };
}

// ── 4. G-code Spindle Load Profile Estimator ──

export interface SpindleLoadPoint {
  /** Time in seconds */
  time: number;
  /** Estimated load percentage (0-100) */
  load: number;
  /** Load category */
  category: 'idle' | 'light' | 'moderate' | 'heavy' | 'overload';
}

export interface SpindleLoadProfileResult {
  /** Load profile data points */
  points: SpindleLoadPoint[];
  /** Average load */
  avgLoad: number;
  /** Peak load */
  peakLoad: number;
  /** Load distribution */
  distribution: { [category: string]: number };
  /** Total time in seconds */
  totalTime: number;
  /** Overload count */
  overloadCount: number;
  /** Load consistency score (0-100) */
  loadScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Estimate spindle load profile over time.
 * Models load based on cutting parameters (feed, depth, RPM).
 *
 * @param lines G-code lines
 * @param maxSpindlePowerKW Max spindle power in kW (default 5)
 */
export function estimateSpindleLoadProfile(
  lines: string[],
  maxSpindlePowerKW: number = 5,
): SpindleLoadProfileResult {
  const points: SpindleLoadPoint[] = [];
  let prevX = 0, prevY = 0, prevZ = 0;
  let feedRate = 0;
  let rpm = 0;
  let currentTime = 0;

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

    const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2 + (z - prevZ) ** 2);
    if (dist > 0 && feedRate > 0) {
      const time = dist / (feedRate / 60);
      currentTime += time;

      // Estimate load: based on depth, feed rate, and RPM
      const depth = Math.abs(z);
      const materialRemovalRate = feedRate * depth * dist / time; // simplified MRR
      const powerEstimate = (materialRemovalRate / 1000) * 0.5; // kW estimate
      const load = Math.min(100, (powerEstimate / maxSpindlePowerKW) * 100);

      const category: SpindleLoadPoint['category'] =
        load < 10 ? 'idle' : load < 30 ? 'light' : load < 60 ? 'moderate' : load < 85 ? 'heavy' : 'overload';

      points.push({ time: currentTime, load, category });
    }

    prevX = x; prevY = y; prevZ = z;
  }

  if (points.length === 0) {
    return {
      points: [], avgLoad: 0, peakLoad: 0, distribution: {},
      totalTime: 0, overloadCount: 0, loadScore: 100,
      recommendations: ['No cutting data for load estimation'],
    };
  }

  const loads = points.map(p => p.load);
  const avgLoad = loads.reduce((a, b) => a + b, 0) / loads.length;
  const peakLoad = Math.max(...loads);
  const totalTime = points[points.length - 1].time;
  const overloadCount = points.filter(p => p.category === 'overload').length;

  const distribution: { [category: string]: number } = {};
  for (const p of points) {
    distribution[p.category] = (distribution[p.category] ?? 0) + 1;
  }

  const stdDev = Math.sqrt(loads.reduce((s, l) => s + (l - avgLoad) ** 2, 0) / loads.length);
  const loadScore = Math.max(0, 100 - stdDev - overloadCount * 5);

  const recommendations: string[] = [];
  recommendations.push(`Avg load: ${avgLoad.toFixed(0)}%, peak: ${peakLoad.toFixed(0)}%`);
  if (peakLoad > 85) {
    recommendations.push(`Peak load ${peakLoad.toFixed(0)}% — risk of spindle overload`);
  }
  if (overloadCount > 0) {
    recommendations.push(`${overloadCount} overload points — reduce feed or depth`);
  }
  if (avgLoad < 20) {
    recommendations.push('Low average load — could increase material removal rate');
  }
  if (loadScore > 80) {
    recommendations.push('Consistent spindle load — good cutting parameters');
  }

  return {
    points, avgLoad, peakLoad, distribution,
    totalTime, overloadCount, loadScore, recommendations,
  };
}

// ── 5. CNC Tool Path Direction Change Counter ──

export interface DirectionChangeResult {
  /** Total direction changes */
  totalChanges: number;
  /** Changes per 100mm of travel */
  changesPer100mm: number;
  /** Sharp changes (>90°) */
  sharpChanges: number;
  /** Smooth changes (<30°) */
  smoothChanges: number;
  /** Average angle change in degrees */
  avgAngleChange: number;
  /** Max angle change in degrees */
  maxAngleChange: number;
  /** Direction change score (0-100, higher is smoother) */
  smoothnessScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Count tool path direction changes.
 * Frequent sharp changes indicate jagged toolpaths and may cause chatter.
 *
 * @param lines G-code lines
 */
export function countDirectionChanges(lines: string[]): DirectionChangeResult {
  let prevX = 0, prevY = 0;
  let prevAngle: number | null = null;
  let totalChanges = 0;
  let sharpChanges = 0;
  let smoothChanges = 0;
  let totalAngleChange = 0;
  let maxAngleChange = 0;
  let totalDistance = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG1\b/i.test(code)) continue;

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

        if (angleDeg > 1) {
          totalChanges++;
          totalAngleChange += angleDeg;
          maxAngleChange = Math.max(maxAngleChange, angleDeg);
          if (angleDeg > 90) sharpChanges++;
          else if (angleDeg < 30) smoothChanges++;
        }
      }
      prevAngle = angle;
    }

    prevX = x; prevY = y;
  }

  const changesPer100mm = totalDistance > 0 ? (totalChanges / totalDistance) * 100 : 0;
  const avgAngleChange = totalChanges > 0 ? totalAngleChange / totalChanges : 0;
  const smoothnessScore = Math.max(0, 100 - (sharpChanges * 5 + changesPer100mm * 2));

  const recommendations: string[] = [];
  recommendations.push(`${totalChanges} direction changes over ${totalDistance.toFixed(0)}mm`);
  if (sharpChanges > 10) {
    recommendations.push(`${sharpChanges} sharp changes (>90°) — may cause chatter`);
  }
  if (changesPer100mm > 10) {
    recommendations.push(`${changesPer100mm.toFixed(1)} changes/100mm — jagged toolpath`);
  }
  if (maxAngleChange > 150) {
    recommendations.push(`Max angle change ${maxAngleChange.toFixed(0)}° — near reversal`);
  }
  if (smoothnessScore > 80) {
    recommendations.push('Smooth toolpath — minimal direction changes');
  }

  return {
    totalChanges, changesPer100mm, sharpChanges, smoothChanges,
    avgAngleChange, maxAngleChange, smoothnessScore, recommendations,
  };
}

// ── 6. Print Bed Adhesion Area Calculator ──

export interface BedAdhesionResult {
  /** Total adhesion area in mm² */
  totalAdhesionArea: number;
  /** Number of adhesion segments */
  segmentCount: number;
  /** Average segment length in mm */
  avgSegmentLength: number;
  /** Max segment length in mm */
  maxSegmentLength: number;
  /** Adhesion perimeter in mm */
  perimeter: number;
  /** Area-to-perimeter ratio */
  areaToPerimeterRatio: number;
  /** Adhesion score (0-100) */
  adhesionScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Calculate first layer bed adhesion area.
 * Measures the contact area between the first layer and the bed.
 *
 * @param lines G-code lines
 * @param extrusionWidth Extrusion width in mm (default 0.4)
 */
export function calculateBedAdhesionArea(
  lines: string[],
  extrusionWidth: number = 0.4,
): BedAdhesionResult {
  let prevX = 0, prevY = 0, prevE = 0;
  let firstZ = 0;
  let isOnFirstLayer = true;
  let totalAdhesionArea = 0;
  let segmentCount = 0;
  const segmentLengths: number[] = [];
  let perimeter = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    if (zMatch) {
      const z = parseFloat(zMatch[1]);
      if (firstZ === 0) firstZ = z;
      if (z > firstZ + 0.01) {
        isOnFirstLayer = false;
      }
    }

    if (!isOnFirstLayer || !/\bG1\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const e = eMatch ? parseFloat(eMatch[1]) : prevE;

    if (e > prevE) {
      const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
      if (dist > 0) {
        totalAdhesionArea += dist * extrusionWidth;
        segmentCount++;
        segmentLengths.push(dist);
        perimeter += dist;
      }
    }

    prevX = x; prevY = y; prevE = e;
  }

  const avgSegmentLength = segmentLengths.length > 0
    ? segmentLengths.reduce((a, b) => a + b, 0) / segmentLengths.length : 0;
  const maxSegmentLength = segmentLengths.length > 0 ? Math.max(...segmentLengths) : 0;
  const areaToPerimeterRatio = perimeter > 0 ? totalAdhesionArea / perimeter : 0;
  const adhesionScore = Math.min(100, totalAdhesionArea / 100);

  const recommendations: string[] = [];
  recommendations.push(`Adhesion area: ${totalAdhesionArea.toFixed(0)}mm², perimeter: ${perimeter.toFixed(0)}mm`);
  if (totalAdhesionArea < 100) {
    recommendations.push('Small adhesion area — risk of print detachment');
  }
  if (maxSegmentLength > 100) {
    recommendations.push(`Long segment (${maxSegmentLength.toFixed(0)}mm) — may warp at ends`);
  }
  if (areaToPerimeterRatio < 0.3) {
    recommendations.push('Low area-to-perimeter ratio — consider brim for better adhesion');
  }
  if (adhesionScore > 70) {
    recommendations.push('Good adhesion area — print should stick well');
  }

  return {
    totalAdhesionArea, segmentCount, avgSegmentLength,
    maxSegmentLength, perimeter, areaToPerimeterRatio,
    adhesionScore, recommendations,
  };
}

// ── 7. G-code Coordinate System Rotation Detector ──

export interface RotationEvent {
  /** Line number */
  line: number;
  /** Rotation type */
  type: 'G68' | 'G69' | 'coordinate_rotation';
  /** Rotation angle in degrees (if detected) */
  angle: number;
  /** Rotation center */
  center: { x: number; y: number } | null;
}

export interface RotationDetectionResult {
  /** All rotation events */
  events: RotationEvent[];
  /** Event count */
  count: number;
  /** Total rotation applied in degrees */
  totalRotation: number;
  /** Max rotation angle */
  maxRotation: number;
  /** Active rotation at end of program */
  activeRotationAtEnd: boolean;
  /** Rotation complexity score (0-100) */
  complexityScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Detect coordinate system rotations in G-code.
 * Identifies G68 (rotation) and G69 (cancel rotation) commands.
 *
 * @param lines G-code lines
 */
export function detectCoordinateRotations(lines: string[]): RotationDetectionResult {
  const events: RotationEvent[] = [];
  let activeRotation = false;
  let totalRotation = 0;
  let maxRotation = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // G68: Coordinate rotation
    if (/\bG68\b/i.test(code)) {
      const rMatch = code.match(/\bR(-?\d*\.?\d+)/i);
      const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
      const angle = rMatch ? parseFloat(rMatch[1]) : 0;
      const center = (xMatch && yMatch)
        ? { x: parseFloat(xMatch[1]), y: parseFloat(yMatch[1]) }
        : null;

      events.push({ line: i, type: 'G68', angle, center });
      activeRotation = true;
      totalRotation += Math.abs(angle);
      maxRotation = Math.max(maxRotation, Math.abs(angle));
    }

    // G69: Cancel rotation
    if (/\bG69\b/i.test(code)) {
      events.push({ line: i, type: 'G69', angle: 0, center: null });
      activeRotation = false;
    }
  }

  const count = events.length;
  const complexityScore = Math.min(100, count * 20 + maxRotation / 2);

  const recommendations: string[] = [];
  if (count > 0) {
    recommendations.push(`${count} rotation events, total ${totalRotation.toFixed(1)}°`);
  }
  if (activeRotation) {
    recommendations.push('Rotation still active at end of program — add G69 to cancel');
  }
  if (maxRotation > 45) {
    recommendations.push(`Large rotation (${maxRotation.toFixed(0)}°) — verify part orientation`);
  }
  if (count === 0) {
    recommendations.push('No coordinate rotations detected');
  }
  if (complexityScore > 60) {
    recommendations.push('Complex rotation usage — verify coordinate transformations');
  }

  return {
    events, count, totalRotation, maxRotation,
    activeRotationAtEnd: activeRotation, complexityScore,
    recommendations,
  };
}

// ── 8. CNC Tool Wear Rate Calculator ──

export interface WearRateResult {
  /** Total cutting distance in mm */
  totalCuttingDistance: number;
  /** Wear per 100mm (percentage) */
  wearPer100mm: number;
  /** Wear rate category */
  wearRateCategory: 'very_low' | 'low' | 'moderate' | 'high' | 'very_high';
  /** Estimated tool life in mm */
  estimatedToolLife: number;
  /** Current wear estimate (percentage) */
  currentWearEstimate: number;
  /** Wear rate trend */
  trend: 'increasing' | 'stable' | 'decreasing';
  /** Wear rate score (0-100, higher is better) */
  wearRateScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Calculate tool wear rate per cutting distance.
 * Estimates wear based on cutting parameters and material.
 *
 * @param lines G-code lines
 * @param toolDiameter Tool diameter in mm (default 6)
 * @param material Material type (default 'aluminum')
 */
export function calculateWearRate(
  lines: string[],
  toolDiameter: number = 6,
  material: string = 'aluminum',
): WearRateResult {
  // Base wear rates per mm of cutting (percentage)
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
  let totalCuttingDistance = 0;
  const wearPerSegment: number[] = [];

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
        totalCuttingDistance += dist;
        // Wear increases with higher feed rate and deeper cuts
        const feedFactor = feedRate > 0 ? feedRate / 1000 : 1;
        const depthFactor = Math.abs(z) / toolDiameter;
        const segmentWear = dist * baseWearRate * feedFactor * (1 + depthFactor);
        wearPerSegment.push(segmentWear);
      }
    }

    prevX = x; prevY = y; prevZ = z;
  }

  const wearPer100mm = totalCuttingDistance > 0
    ? (wearPerSegment.reduce((a, b) => a + b, 0) / totalCuttingDistance) * 100 : 0;
  const currentWearEstimate = wearPerSegment.reduce((a, b) => a + b, 0);
  const estimatedToolLife = currentWearEstimate < 100 && wearPer100mm > 0
    ? (100 - currentWearEstimate) / wearPer100mm * 100 : 0;

  const wearRateCategory: WearRateResult['wearRateCategory'] =
    wearPer100mm < 0.05 ? 'very_low' : wearPer100mm < 0.2 ? 'low'
    : wearPer100mm < 0.5 ? 'moderate' : wearPer100mm < 1.0 ? 'high' : 'very_high';

  // Trend: compare first half vs second half
  const halfIdx = Math.floor(wearPerSegment.length / 2);
  const firstHalfAvg = halfIdx > 0
    ? wearPerSegment.slice(0, halfIdx).reduce((a, b) => a + b, 0) / halfIdx : 0;
  const secondHalfAvg = wearPerSegment.length - halfIdx > 0
    ? wearPerSegment.slice(halfIdx).reduce((a, b) => a + b, 0) / (wearPerSegment.length - halfIdx) : 0;
  const trend: WearRateResult['trend'] =
    secondHalfAvg > firstHalfAvg * 1.2 ? 'increasing'
    : secondHalfAvg < firstHalfAvg * 0.8 ? 'decreasing' : 'stable';

  const wearRateScore = Math.max(0, 100 - wearPer100mm * 50);

  const recommendations: string[] = [];
  recommendations.push(`Wear rate: ${wearPer100mm.toFixed(4)}%/100mm (${wearRateCategory})`);
  if (wearRateCategory === 'very_high') {
    recommendations.push('Very high wear rate — reduce feed or use harder tool');
  }
  if (trend === 'increasing') {
    recommendations.push('Wear rate increasing — tool may be approaching end of life');
  }
  recommendations.push(`Estimated tool life: ${estimatedToolLife.toFixed(0)}mm remaining`);
  if (wearRateScore > 80) {
    recommendations.push('Low wear rate — tool in good condition');
  }

  return {
    totalCuttingDistance, wearPer100mm, wearRateCategory,
    estimatedToolLife, currentWearEstimate, trend,
    wearRateScore, recommendations,
  };
}

// ── 9. Print Flow Rate Consistency Analyzer ──

export interface FlowRateConsistencyResult {
  /** Average flow rate */
  avgFlowRate: number;
  /** Flow rate standard deviation */
  stdDev: number;
  /** Coefficient of variation (0-1) */
  coefficientOfVariation: number;
  /** Min flow rate */
  minFlowRate: number;
  /** Max flow rate */
  maxFlowRate: number;
  /** Consistency score (0-100) */
  consistencyScore: number;
  /** Outlier count */
  outlierCount: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze flow rate consistency.
 * Inconsistent flow rates can cause under-extrusion or over-extrusion.
 *
 * @param lines G-code lines
 */
export function analyzeFlowRateConsistency(lines: string[]): FlowRateConsistencyResult {
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
        // Flow rate = extrusion amount / distance * feed rate
        const eDelta = e - prevE;
        const flowRate = (eDelta / dist) * feedRate;
        flowRates.push(flowRate);
      }
    }

    prevX = x; prevY = y; prevE = e;
  }

  if (flowRates.length === 0) {
    return {
      avgFlowRate: 0, stdDev: 0, coefficientOfVariation: 0,
      minFlowRate: 0, maxFlowRate: 0, consistencyScore: 100,
      outlierCount: 0,
      recommendations: ['No extrusion data for flow rate analysis'],
    };
  }

  const avgFlowRate = flowRates.reduce((a, b) => a + b, 0) / flowRates.length;
  const minFlowRate = Math.min(...flowRates);
  const maxFlowRate = Math.max(...flowRates);
  const stdDev = Math.sqrt(flowRates.reduce((s, f) => s + (f - avgFlowRate) ** 2, 0) / flowRates.length);
  const coefficientOfVariation = avgFlowRate > 0 ? stdDev / avgFlowRate : 0;

  // Outliers: >2 standard deviations from mean
  const outlierCount = flowRates.filter(f => Math.abs(f - avgFlowRate) > 2 * stdDev).length;
  const consistencyScore = Math.max(0, 100 - coefficientOfVariation * 100);

  const recommendations: string[] = [];
  recommendations.push(`Avg flow rate: ${avgFlowRate.toFixed(2)}, CV: ${(coefficientOfVariation * 100).toFixed(1)}%`);
  if (coefficientOfVariation > 0.3) {
    recommendations.push('High flow rate variation — check extrusion settings');
  }
  if (outlierCount > 5) {
    recommendations.push(`${outlierCount} flow rate outliers — inconsistent extrusion`);
  }
  if (maxFlowRate > avgFlowRate * 2) {
    recommendations.push(`Max flow ${maxFlowRate.toFixed(2)} is 2× average — possible over-extrusion`);
  }
  if (consistencyScore > 85) {
    recommendations.push('Consistent flow rate — good extrusion quality');
  }

  return {
    avgFlowRate, stdDev, coefficientOfVariation,
    minFlowRate, maxFlowRate, consistencyScore,
    outlierCount, recommendations,
  };
}

// ── 10. G-code Command Sequence Validator ──

export interface SequenceViolation {
  /** Line number */
  line: number;
  /** Violation type */
  type: 'missing_init' | 'unsafe_order' | 'missing_cancel' | 'redundant_code' | 'missing_end';
  /** Description */
  description: string;
  /** Severity */
  severity: 'warning' | 'error';
}

export interface SequenceValidationResult {
  /** All violations */
  violations: SequenceViolation[];
  /** Violation count */
  count: number;
  /** Error count */
  errorCount: number;
  /** Warning count */
  warningCount: number;
  /** Validation score (0-100, higher is better) */
  validationScore: number;
  /** Has initialization */
  hasInit: boolean;
  /** Has program end */
  hasEnd: boolean;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Validate G-code command sequences.
 * Checks for proper initialization, safe ordering, and program termination.
 *
 * @param lines G-code lines
 */
export function validateCommandSequence(lines: string[]): SequenceValidationResult {
  const violations: SequenceViolation[] = [];
  let hasG28 = false;
  let hasG20or21 = false;
  let hasG90or91 = false;
  let hasEnd = false;
  let hasSpindleOn = false;
  let hasSpindleOff = false;
  let lineCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;
    lineCount++;

    if (/\bG28\b/i.test(code)) hasG28 = true;
    if (/\bG2[01]\b/i.test(code)) hasG20or21 = true;
    if (/\bG9[01]\b/i.test(code)) hasG90or91 = true;
    if (/\bM3[05]\b/i.test(code) || /\bM3\b/i.test(code) || /\bM4\b/i.test(code)) hasSpindleOn = true;
    if (/\bM5\b/i.test(code)) hasSpindleOff = true;
    if (/\bM30\b/i.test(code) || /\bM2\b/i.test(code)) hasEnd = true;

    // Check for cutting before initialization
    if (lineCount < 5 && /\bG1\b/i.test(code) && !hasG28) {
      violations.push({
        line: i, type: 'missing_init',
        description: 'Cutting move before homing (G28)',
        severity: 'error',
      });
    }

    // Check for spindle off before end
    if (hasEnd && hasSpindleOn && !hasSpindleOff) {
      violations.push({
        line: i, type: 'missing_cancel',
        description: 'Program ends without turning off spindle (M5)',
        severity: 'warning',
      });
      hasSpindleOff = true; // Avoid duplicate
    }
  }

  // Post-scan checks
  if (!hasG28 && lineCount > 10) {
    violations.push({
      line: 0, type: 'missing_init',
      description: 'No homing command (G28) found',
      severity: 'error',
    });
  }
  if (!hasG20or21) {
    violations.push({
      line: 0, type: 'missing_init',
      description: 'No units specified (G20/G21)',
      severity: 'warning',
    });
  }
  if (!hasG90or91) {
    violations.push({
      line: 0, type: 'missing_init',
      description: 'No positioning mode (G90/G91)',
      severity: 'warning',
    });
  }
  if (!hasEnd && lineCount > 10) {
    violations.push({
      line: lines.length - 1, type: 'missing_end',
      description: 'No program end (M30/M2)',
      severity: 'warning',
    });
  }

  const count = violations.length;
  const errorCount = violations.filter(v => v.severity === 'error').length;
  const warningCount = violations.filter(v => v.severity === 'warning').length;
  const validationScore = Math.max(0, 100 - errorCount * 25 - warningCount * 10);

  const recommendations: string[] = [];
  for (const v of violations.slice(0, 5)) {
    recommendations.push(`Line ${v.line}: ${v.description}`);
  }
  if (count === 0) {
    recommendations.push('No sequence violations — well-structured G-code');
  }
  if (errorCount > 0) {
    recommendations.push(`${errorCount} errors — fix before running`);
  }

  return {
    violations, count, errorCount, warningCount,
    validationScore, hasInit: hasG28, hasEnd,
    recommendations,
  };
}

// ── 11. CNC Feed Rate Harmonics Analyzer ──

export interface FeedHarmonicsResult {
  /** Dominant frequencies */
  dominantFrequencies: { frequency: number; amplitude: number }[];
  /** Feed rate variation amplitude */
  variationAmplitude: number;
  /** Average feed rate */
  avgFeedRate: number;
  /** Harmonic complexity (0-100) */
  harmonicComplexity: number;
  /** Resonance risk (0-100) */
  resonanceRisk: number;
  /** Harmonics score (0-100, higher is better) */
  harmonicsScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze feed rate harmonics.
 * Detects periodic patterns in feed rate that may cause resonance.
 *
 * @param lines G-code lines
 */
export function analyzeFeedRateHarmonics(lines: string[]): FeedHarmonicsResult {
  const feedRates: number[] = [];
  let feedRate = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG1\b/i.test(code)) continue;

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) feedRate = parseFloat(fMatch[1]);

    if (feedRate > 0) {
      feedRates.push(feedRate);
    }
  }

  if (feedRates.length < 10) {
    return {
      dominantFrequencies: [], variationAmplitude: 0,
      avgFeedRate: feedRates.length > 0 ? feedRates[0] : 0,
      harmonicComplexity: 0, resonanceRisk: 0, harmonicsScore: 100,
      recommendations: ['Insufficient data for harmonics analysis'],
    };
  }

  const avgFeedRate = feedRates.reduce((a, b) => a + b, 0) / feedRates.length;
  const minFeed = Math.min(...feedRates);
  const maxFeed = Math.max(...feedRates);
  const variationAmplitude = maxFeed - minFeed;

  // Simple frequency analysis: detect periodic patterns
  // Sample the feed rates at regular intervals
  const sampleSize = Math.min(100, feedRates.length);
  const sampled = feedRates.filter((_, i) => i % Math.floor(feedRates.length / sampleSize) === 0);

  // Detect dominant frequencies using autocorrelation
  const dominantFrequencies: { frequency: number; amplitude: number }[] = [];
  for (let period = 2; period <= Math.min(50, sampled.length / 2); period++) {
    let correlation = 0;
    let count = 0;
    for (let i = 0; i < sampled.length - period; i++) {
      correlation += sampled[i] * sampled[i + period];
      count++;
    }
    correlation = count > 0 ? correlation / count : 0;
    const normalizedAmplitude = avgFeedRate > 0 ? correlation / (avgFeedRate * avgFeedRate) : 0;
    if (normalizedAmplitude > 0.5) {
      dominantFrequencies.push({
        frequency: sampled.length / period,
        amplitude: normalizedAmplitude,
      });
    }
  }

  dominantFrequencies.sort((a, b) => b.amplitude - a.amplitude);
  const topFrequencies = dominantFrequencies.slice(0, 5);

  const harmonicComplexity = Math.min(100, topFrequencies.length * 20);
  const resonanceRisk = Math.min(100, variationAmplitude / avgFeedRate * 50);
  const harmonicsScore = Math.max(0, 100 - resonanceRisk - harmonicComplexity * 0.3);

  const recommendations: string[] = [];
  recommendations.push(`Avg feed: ${avgFeedRate.toFixed(0)}, variation: ${variationAmplitude.toFixed(0)}mm/min`);
  if (topFrequencies.length > 0) {
    recommendations.push(`${topFrequencies.length} dominant frequencies — periodic feed pattern`);
  }
  if (resonanceRisk > 50) {
    recommendations.push(`High resonance risk (${resonanceRisk.toFixed(0)}%) — smooth feed rate transitions`);
  }
  if (variationAmplitude > avgFeedRate * 0.5) {
    recommendations.push('Large feed rate variation — may cause surface finish issues');
  }
  if (harmonicsScore > 80) {
    recommendations.push('Smooth feed rate — low resonance risk');
  }

  return {
    dominantFrequencies: topFrequencies, variationAmplitude,
    avgFeedRate, harmonicComplexity, resonanceRisk,
    harmonicsScore, recommendations,
  };
}

// ── 12. Print Layer Height Variance Analyzer ──

export interface LayerHeightData {
  /** Layer number */
  layer: number;
  /** Z height */
  zHeight: number;
  /** Layer height (delta from previous) */
  layerHeight: number;
  /** Deviation from average */
  deviation: number;
  /** Is outlier */
  isOutlier: boolean;
}

export interface LayerHeightVarianceResult {
  /** Per-layer height data */
  layers: LayerHeightData[];
  /** Layer count */
  layerCount: number;
  /** Average layer height */
  avgLayerHeight: number;
  /** Min layer height */
  minLayerHeight: number;
  /** Max layer height */
  maxLayerHeight: number;
  /** Height variance */
  variance: number;
  /** Consistency score (0-100) */
  consistencyScore: number;
  /** Outlier count */
  outlierCount: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze layer height variance.
 * Inconsistent layer heights can cause quality issues and weak layers.
 *
 * @param lines G-code lines
 */
export function analyzeLayerHeightVariance(lines: string[]): LayerHeightVarianceResult {
  const zHeights: number[] = [];
  let prevZ = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    if (zMatch) {
      const z = parseFloat(zMatch[1]);
      if (z > prevZ + 0.01) {
        zHeights.push(z);
        prevZ = z;
      }
    }
  }

  if (zHeights.length < 2) {
    return {
      layers: [], layerCount: 0, avgLayerHeight: 0,
      minLayerHeight: 0, maxLayerHeight: 0, variance: 0,
      consistencyScore: 100, outlierCount: 0,
      recommendations: ['Insufficient layers for height variance analysis'],
    };
  }

  // Calculate layer heights (deltas)
  const layerHeights = zHeights.map((z, i) => i === 0 ? z : z - zHeights[i - 1]);
  const avgLayerHeight = layerHeights.reduce((a, b) => a + b, 0) / layerHeights.length;
  const minLayerHeight = Math.min(...layerHeights);
  const maxLayerHeight = Math.max(...layerHeights);
  const variance = layerHeights.reduce((s, h) => s + (h - avgLayerHeight) ** 2, 0) / layerHeights.length;
  const stdDev = Math.sqrt(variance);

  const layers: LayerHeightData[] = layerHeights.map((height, i) => {
    const deviation = height - avgLayerHeight;
    const isOutlier = Math.abs(deviation) > 2 * stdDev;
    return {
      layer: i + 1, zHeight: zHeights[i],
      layerHeight: height, deviation, isOutlier,
    };
  });

  const outlierCount = layers.filter(l => l.isOutlier).length;
  const consistencyScore = avgLayerHeight > 0
    ? Math.max(0, 100 - (stdDev / avgLayerHeight) * 100)
    : 100;

  const recommendations: string[] = [];
  recommendations.push(`${layers.length} layers, avg height ${avgLayerHeight.toFixed(3)}mm`);
  if (outlierCount > 0) {
    recommendations.push(`${outlierCount} layer height outliers — check Z-axis consistency`);
  }
  if (maxLayerHeight > avgLayerHeight * 1.5) {
    recommendations.push(`Max layer height ${maxLayerHeight.toFixed(3)}mm is 1.5× average`);
  }
  if (consistencyScore < 80) {
    recommendations.push(`Low consistency (${consistencyScore.toFixed(0)}%) — variable layer heights`);
  }
  if (consistencyScore > 90) {
    recommendations.push('Consistent layer heights — uniform print quality expected');
  }

  return {
    layers, layerCount: layers.length, avgLayerHeight,
    minLayerHeight, maxLayerHeight, variance,
    consistencyScore, outlierCount, recommendations,
  };
}
