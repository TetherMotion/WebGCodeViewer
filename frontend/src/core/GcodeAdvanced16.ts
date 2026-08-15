/**
 * @file GcodeAdvanced16.ts
 * @brief Sixteenth batch of advanced G-code analysis features for CNC and 3D printing.
 *
 * This module provides 12 additional high-impact features:
 *  1. G-code line statistics analyzer (Universal) — per-line statistics
 *  2. CNC tool engagement angle map (CNC) — engagement angle heatmap
 *  3. Print bed mesh visualizer (3DP) — bed mesh leveling visualization
 *  4. G-code command flow diagram (Universal) — Sankey-style flow
 *  5. CNC chip load calculator (CNC) — chip load per tooth
 *  6. Print filament spool estimator (3DP) — spool usage and remaining
 *  7. G-code error recovery suggestions (Universal) — suggest fixes
 *  8. CNC MRR calculator (CNC) — material removal rate over time
 *  9. Print coasting analysis (3DP) — coasting settings analysis
 * 10. G-code performance bottleneck analyzer (Universal) — bottleneck ID
 * 11. CNC tool pull-off distance calculator (CNC) — optimal pull-off
 * 12. Print first layer squish analyzer (3DP) — squish ratio analysis
 */

// ── 1. G-code Line Statistics Analyzer ──

export interface LineStats {
  /** Line number */
  line: number;
  /** Command */
  command: string;
  /** Distance traveled in mm */
  distance: number;
  /** Estimated time in seconds */
  time: number;
  /** Extrusion amount in mm */
  extrusion: number;
  /** Feed rate in mm/min */
  feedRate: number;
  /** Is rapid move */
  isRapid: boolean;
  /** Is extruding */
  isExtruding: boolean;
  /** Is cutting (CNC) */
  isCutting: boolean;
  /** Cumulative distance */
  cumulativeDistance: number;
  /** Cumulative time */
  cumulativeTime: number;
}

export interface LineStatsResult {
  /** Per-line statistics */
  lines: LineStats[];
  /** Total distance */
  totalDistance: number;
  /** Total cutting/extrusion distance */
  totalActiveDistance: number;
  /** Total travel distance */
  totalTravelDistance: number;
  /** Total time in seconds */
  totalTime: number;
  /** Total extrusion in mm */
  totalExtrusion: number;
  /** Average feed rate */
  avgFeedRate: number;
  /** Max feed rate */
  maxFeedRate: number;
  /** Line count */
  lineCount: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Compute per-line statistics for G-code.
 * Provides distance, time, extrusion, and cumulative metrics per line.
 *
 * @param lines G-code lines
 */
export function analyzeLineStatistics(lines: string[]): LineStatsResult {
  const stats: LineStats[] = [];
  let prevX = 0, prevY = 0, prevZ = 0, prevE = 0;
  let feedRate = 0;
  let cumulativeDistance = 0;
  let cumulativeTime = 0;
  let totalExtrusion = 0;
  let totalActiveDistance = 0;
  let totalTravelDistance = 0;
  let maxFeedRate = 0;
  let feedRateSum = 0;
  let feedRateCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG[01]\b/i.test(code)) continue;

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) {
      feedRate = parseFloat(fMatch[1]);
      maxFeedRate = Math.max(maxFeedRate, feedRate);
      feedRateSum += feedRate;
      feedRateCount++;
    }

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const z = zMatch ? parseFloat(zMatch[1]) : prevZ;
    const e = eMatch ? parseFloat(eMatch[1]) : prevE;

    const distance = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2 + (z - prevZ) ** 2);
    const isRapid = /\bG0\b/i.test(code);
    const isExtruding = e > prevE;
    const isCutting = z < 0 && !isRapid;
    const extrusion = e > prevE ? e - prevE : 0;
    const time = feedRate > 0 ? distance / (feedRate / 60) : 0;

    cumulativeDistance += distance;
    cumulativeTime += time;
    totalExtrusion += extrusion;

    if (isRapid) {
      totalTravelDistance += distance;
    } else {
      totalActiveDistance += distance;
    }

    stats.push({
      line: i, command: code, distance, time, extrusion,
      feedRate, isRapid, isExtruding, isCutting,
      cumulativeDistance, cumulativeTime,
    });

    prevX = x; prevY = y; prevZ = z; prevE = e;
  }

  const avgFeedRate = feedRateCount > 0 ? feedRateSum / feedRateCount : 0;
  const recommendations: string[] = [];
  recommendations.push(`${stats.length} motion lines, ${cumulativeDistance.toFixed(1)}mm total`);
  if (totalTravelDistance > totalActiveDistance) {
    recommendations.push(`Travel > active: ${totalTravelDistance.toFixed(0)}mm vs ${totalActiveDistance.toFixed(0)}mm — optimize travel`);
  }
  if (maxFeedRate > 5000) {
    recommendations.push(`Max feed rate ${maxFeedRate.toFixed(0)}mm/min — check machine limits`);
  }

  return {
    lines: stats, totalDistance: cumulativeDistance,
    totalActiveDistance, totalTravelDistance,
    totalTime: cumulativeTime, totalExtrusion,
    avgFeedRate, maxFeedRate, lineCount: stats.length,
    recommendations,
  };
}

// ── 2. CNC Tool Engagement Angle Map ──

export interface EngagementCell {
  /** Grid X */
  gridX: number;
  /** Grid Y */
  gridY: number;
  /** Center X */
  centerX: number;
  /** Center Y */
  centerY: number;
  /** Max engagement angle in degrees */
  maxEngagementAngle: number;
  /** Average engagement angle */
  avgEngagementAngle: number;
  /** Engagement count */
  engagementCount: number;
  /** Whether engagement is high */
  highEngagement: boolean;
}

export interface EngagementMapResult {
  /** Engagement grid cells */
  cells: EngagementCell[];
  /** Grid size */
  gridSize: { x: number; y: number };
  /** Maximum engagement angle */
  maxEngagementAngle: number;
  /** Average engagement angle */
  avgEngagementAngle: number;
  /** Cells with high engagement */
  highEngagementCount: number;
  /** Engagement uniformity score (0-100) */
  uniformityScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Map tool engagement angles across cutting operations.
 * Shows spatial distribution of tool engagement for optimizing cutting strategy.
 *
 * @param lines G-code lines
 * @param gridResolution Grid resolution (default 10)
 * @param toolDiameter Tool diameter in mm (default 6)
 * @param highEngagementThreshold Threshold in degrees (default 90)
 */
export function generateEngagementMap(
  lines: string[],
  gridResolution: number = 10,
  toolDiameter: number = 6,
  highEngagementThreshold: number = 90,
): EngagementMapResult {
  let prevX = 0, prevY = 0, prevZ = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const segments: { x1: number; y1: number; x2: number; y2: number; z: number }[] = [];

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
      segments.push({ x1: prevX, y1: prevY, x2: x, y2: y, z });
      minX = Math.min(minX, x, prevX);
      maxX = Math.max(maxX, x, prevX);
      minY = Math.min(minY, y, prevY);
      maxY = Math.max(maxY, y, prevY);
    }

    prevX = x; prevY = y; prevZ = z;
  }

  if (segments.length === 0 || !isFinite(minX)) {
    return {
      cells: [], gridSize: { x: 0, y: 0 }, maxEngagementAngle: 0,
      avgEngagementAngle: 0, highEngagementCount: 0, uniformityScore: 0,
      recommendations: ['No cutting operations for engagement map'],
    };
  }

  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const cellW = rangeX / gridResolution;
  const cellH = rangeY / gridResolution;

  const grid: EngagementCell[][] = [];
  for (let gx = 0; gx < gridResolution; gx++) {
    grid[gx] = [];
    for (let gy = 0; gy < gridResolution; gy++) {
      grid[gx][gy] = {
        gridX: gx, gridY: gy,
        centerX: minX + (gx + 0.5) * cellW,
        centerY: minY + (gy + 0.5) * cellH,
        maxEngagementAngle: 0, avgEngagementAngle: 0,
        engagementCount: 0, highEngagement: false,
      };
    }
  }

  for (const seg of segments) {
    const midX = (seg.x1 + seg.x2) / 2;
    const midY = (seg.y1 + seg.y2) / 2;
    const gx = Math.min(gridResolution - 1, Math.max(0, Math.floor((midX - minX) / cellW)));
    const gy = Math.min(gridResolution - 1, Math.max(0, Math.floor((midY - minY) / cellH)));

    // Estimate engagement angle from cut width
    const cutWidth = Math.sqrt((seg.x2 - seg.x1) ** 2 + (seg.y2 - seg.y1) ** 2);
    const engagementRatio = Math.min(1, cutWidth / toolDiameter);
    const engagementAngle = engagementRatio * 180; // 0-180 degrees

    grid[gx][gy].maxEngagementAngle = Math.max(grid[gx][gy].maxEngagementAngle, engagementAngle);
    grid[gx][gy].engagementCount++;
  }

  const cells: EngagementCell[] = [];
  for (let gx = 0; gx < gridResolution; gx++) {
    for (let gy = 0; gy < gridResolution; gy++) {
      const cell = grid[gx][gy];
      if (cell.engagementCount > 0) {
        cell.avgEngagementAngle = cell.maxEngagementAngle / cell.engagementCount;
      }
      cell.highEngagement = cell.maxEngagementAngle > highEngagementThreshold;
      cells.push(cell);
    }
  }

  const activeCells = cells.filter(c => c.engagementCount > 0);
  const maxEngagementAngle = activeCells.length > 0 ? Math.max(...activeCells.map(c => c.maxEngagementAngle)) : 0;
  const avgEngagementAngle = activeCells.length > 0 ? activeCells.reduce((s, c) => s + c.maxEngagementAngle, 0) / activeCells.length : 0;
  const highEngagementCount = activeCells.filter(c => c.highEngagement).length;

  const variance = activeCells.length > 0
    ? activeCells.reduce((s, c) => s + (c.maxEngagementAngle - avgEngagementAngle) ** 2, 0) / activeCells.length
    : 0;
  const uniformityScore = Math.max(0, 100 - Math.sqrt(variance) / 2);

  const recommendations: string[] = [];
  if (highEngagementCount > 0) {
    recommendations.push(`${highEngagementCount} cells with high engagement (>${highEngagementThreshold}°)`);
  }
  if (maxEngagementAngle > 150) {
    recommendations.push(`Max engagement ${maxEngagementAngle.toFixed(0)}° — full-width cut, high load`);
  }
  if (uniformityScore < 50) {
    recommendations.push('Uneven engagement — vary toolpath direction for even wear');
  }

  return {
    cells, gridSize: { x: gridResolution, y: gridResolution },
    maxEngagementAngle, avgEngagementAngle, highEngagementCount,
    uniformityScore, recommendations,
  };
}

// ── 3. Print Bed Mesh Visualizer ──

export interface BedMeshPoint {
  /** Grid X index */
  gridX: number;
  /** Grid Y index */
  gridY: number;
  /** X position in mm */
  x: number;
  /** Y position in mm */
  y: number;
  /** Z offset in mm */
  zOffset: number;
  /** Deviation from average */
  deviation: number;
}

export interface BedMeshResult {
  /** Mesh points */
  points: BedMeshPoint[];
  /** Grid dimensions */
  gridDimensions: { x: number; y: number };
  /** Average Z offset */
  avgZOffset: number;
  /** Max Z offset */
  maxZOffset: number;
  /** Min Z offset */
  minZOffset: number;
  /** Z range */
  zRange: number;
  /** Flatness score (0-100) */
  flatnessScore: number;
  /** Whether bed mesh was found */
  hasMesh: boolean;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Visualize bed mesh leveling data.
 * Parses G42, G30, or custom bed leveling commands.
 *
 * @param lines G-code lines
 */
export function visualizeBedMesh(lines: string[]): BedMeshResult {
  const points: BedMeshPoint[] = [];
  let gridX = 0, gridY = 0;

  // Parse G30 probe points or M420 mesh data
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();

    // G30 probe point: G30 X10 Y10 Z-0.5
    const g30Match = code.match(/\bG30\b/i) && code.match(/\bX(-?\d*\.?\d+)\b/i) && code.match(/\bY(-?\d*\.?\d+)\b/i);
    if (g30Match) {
      const x = parseFloat(code.match(/\bX(-?\d*\.?\d+)/i)![1]);
      const y = parseFloat(code.match(/\bY(-?\d*\.?\d+)/i)![1]);
      const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
      const z = zMatch ? parseFloat(zMatch[1]) : 0;
      points.push({ gridX, gridY, x, y, zOffset: z, deviation: 0 });
      gridX++;
    }

    // G42 bed mesh point selection: G42 I1 J2
    const g42Match = code.match(/\bG42\b/i) && code.match(/\bI(\d+)\b/i) && code.match(/\bJ(\d+)\b/i);
    if (g42Match) {
      gridX = parseInt(code.match(/\bI(\d+)/i)![1]);
      gridY = parseInt(code.match(/\bJ(\d+)/i)![1]);
    }

    // M420 S1 (load mesh) — just flag presence
    // Custom: ; bed_mesh: x,y,z
    const meshComment = trimmed.match(/bed_mesh.*?X(-?\d*\.?\d+).*?Y(-?\d*\.?\d+).*?Z(-?\d*\.?\d+)/i);
    if (meshComment) {
      const x = parseFloat(meshComment[1]);
      const y = parseFloat(meshComment[2]);
      const z = parseFloat(meshComment[3]);
      points.push({ gridX, gridY, x, y, zOffset: z, deviation: 0 });
      gridX++;
    }
  }

  if (points.length === 0) {
    return {
      points: [], gridDimensions: { x: 0, y: 0 },
      avgZOffset: 0, maxZOffset: 0, minZOffset: 0, zRange: 0,
      flatnessScore: 100, hasMesh: false,
      recommendations: ['No bed mesh data found — add G30 probe points or M420 mesh'],
    };
  }

  const zOffsets = points.map(p => p.zOffset);
  const avgZOffset = zOffsets.reduce((a, b) => a + b, 0) / zOffsets.length;
  const maxZOffset = Math.max(...zOffsets);
  const minZOffset = Math.min(...zOffsets);
  const zRange = maxZOffset - minZOffset;

  // Compute deviations
  for (const p of points) {
    p.deviation = p.zOffset - avgZOffset;
  }

  // Flatness score: lower range = better
  const flatnessScore = Math.max(0, 100 - zRange * 100);

  // Grid dimensions
  const maxGridX = Math.max(...points.map(p => p.gridX));
  const maxGridY = Math.max(...points.map(p => p.gridY));

  const recommendations: string[] = [];
  if (zRange > 0.5) {
    recommendations.push(`Bed variation ${zRange.toFixed(2)}mm — re-level bed`);
  }
  if (flatnessScore < 70) {
    recommendations.push(`Low flatness score (${flatnessScore.toFixed(0)}%) — check bed leveling`);
  }
  if (points.length < 9) {
    recommendations.push(`Only ${points.length} probe points — add more for better mesh`);
  }
  if (flatnessScore > 90) {
    recommendations.push('Good bed flatness — mesh is well-calibrated');
  }

  return {
    points, gridDimensions: { x: maxGridX + 1, y: maxGridY + 1 },
    avgZOffset, maxZOffset, minZOffset, zRange,
    flatnessScore, hasMesh: true, recommendations,
  };
}

// ── 4. G-code Command Flow Diagram ──

export interface FlowNode {
  /** Node ID */
  id: string;
  /** Command type */
  type: string;
  /** Label */
  label: string;
  /** Count */
  count: number;
  /** Total time in seconds */
  totalTime: number;
}

export interface FlowLink {
  /** Source node */
  source: string;
  /** Target node */
  target: string;
  /** Flow count */
  value: number;
}

export interface CommandFlowResult {
  /** Flow nodes */
  nodes: FlowNode[];
  /** Flow links */
  links: FlowLink[];
  /** Total commands */
  totalCommands: number;
  /** Command distribution */
  distribution: { [type: string]: number };
  /** Most common transition */
  mostCommonTransition: { from: string; to: string; count: number } | null;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Generate a Sankey-style flow diagram of G-code commands.
 * Shows transitions between command types.
 *
 * @param lines G-code lines
 */
export function generateCommandFlow(lines: string[]): CommandFlowResult {
  const nodeMap = new Map<string, FlowNode>();
  const linkMap = new Map<string, FlowLink>();
  const distribution: { [type: string]: number } = {};
  let prevType = 'start';
  let totalCommands = 0;

  // Initialize start node
  nodeMap.set('start', { id: 'start', type: 'start', label: 'Start', count: 0, totalTime: 0 });

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    let type = 'other';
    let label = 'Other';

    if (/\bG0\b/i.test(code)) { type = 'rapid'; label = 'Rapid'; }
    else if (/\bG1\b/i.test(code)) { type = 'linear'; label = 'Linear'; }
    else if (/\bG2\b/i.test(code)) { type = 'arc_cw'; label = 'Arc CW'; }
    else if (/\bG3\b/i.test(code)) { type = 'arc_ccw'; label = 'Arc CCW'; }
    else if (/\bG28\b/i.test(code)) { type = 'home'; label = 'Home'; }
    else if (/\bG4\b/i.test(code)) { type = 'dwell'; label = 'Dwell'; }
    else if (/\bM3\b/i.test(code) || /\bM03\b/i.test(code)) { type = 'spindle_on'; label = 'Spindle On'; }
    else if (/\bM5\b/i.test(code)) { type = 'spindle_off'; label = 'Spindle Off'; }
    else if (/\bM6\b/i.test(code) || /\bM06\b/i.test(code)) { type = 'tool_change'; label = 'Tool Change'; }
    else if (/\bM30\b/i.test(code) || /\bM2\b/i.test(code)) { type = 'end'; label = 'End'; }
    else if (/\bM104\b/i.test(code) || /\bM109\b/i.test(code)) { type = 'hotend'; label = 'Hotend'; }
    else if (/\bM140\b/i.test(code) || /\bM190\b/i.test(code)) { type = 'bed'; label = 'Bed'; }
    else if (/\bM106\b/i.test(code)) { type = 'fan_on'; label = 'Fan On'; }
    else if (/\bM107\b/i.test(code)) { type = 'fan_off'; label = 'Fan Off'; }
    else if (/\bG20\b/i.test(code)) { type = 'units_inch'; label = 'Inches'; }
    else if (/\bG21\b/i.test(code)) { type = 'units_mm'; label = 'Millimeters'; }
    else if (/\bG90\b/i.test(code)) { type = 'absolute'; label = 'Absolute'; }
    else if (/\bG91\b/i.test(code)) { type = 'relative'; label = 'Relative'; }

    // Update node
    if (!nodeMap.has(type)) {
      nodeMap.set(type, { id: type, type, label, count: 0, totalTime: 0 });
    }
    const node = nodeMap.get(type)!;
    node.count++;
    totalCommands++;

    distribution[type] = (distribution[type] ?? 0) + 1;

    // Update link
    const linkKey = `${prevType}->${type}`;
    if (!linkMap.has(linkKey)) {
      linkMap.set(linkKey, { source: prevType, target: type, value: 0 });
    }
    linkMap.get(linkKey)!.value++;

    prevType = type;
  }

  // Add end link
  const endLinkKey = `${prevType}->end`;
  if (!linkMap.has(endLinkKey)) {
    linkMap.set(endLinkKey, { source: prevType, target: 'end', value: 1 });
  }
  if (!nodeMap.has('end')) {
    nodeMap.set('end', { id: 'end', type: 'end', label: 'End', count: 0, totalTime: 0 });
  }

  const nodes = Array.from(nodeMap.values());
  const links = Array.from(linkMap.values());

  const mostCommonTransition = links.length > 0
    ? links.reduce((max, l) => l.value > max.value ? l : max, links[0])
    : null;

  const recommendations: string[] = [];
  recommendations.push(`${nodes.length} command types, ${links.length} transitions`);
  if (mostCommonTransition) {
    recommendations.push(`Most common: ${mostCommonTransition.source} → ${mostCommonTransition.target} (${mostCommonTransition.value})`);
  }
  const rapidCount = distribution.rapid ?? 0;
  const linearCount = distribution.linear ?? 0;
  if (rapidCount > linearCount) {
    recommendations.push(`More rapids (${rapidCount}) than linear moves (${linearCount}) — optimize toolpath`);
  }

  return {
    nodes, links, totalCommands, distribution,
    mostCommonTransition: mostCommonTransition
      ? { from: mostCommonTransition.source, to: mostCommonTransition.target, count: mostCommonTransition.value }
      : null,
    recommendations,
  };
}

// ── 5. CNC Chip Load Calculator ──

export interface ChipLoadPoint {
  /** Line number */
  line: number;
  /** Chip load per tooth in mm */
  chipLoad: number;
  /** Recommended chip load range */
  recommendedRange: { min: number; max: number };
  /** Whether chip load is in range */
  inRange: boolean;
  /** Feed rate in mm/min */
  feedRate: number;
  /** RPM */
  rpm: number;
}

export interface ChipLoadResult {
  /** Per-point chip load data */
  points: ChipLoadPoint[];
  /** Average chip load */
  avgChipLoad: number;
  /** Max chip load */
  maxChipLoad: number;
  /** In-range percentage */
  inRangePercentage: number;
  /** Chip load score (0-100) */
  chipLoadScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Calculate chip load per tooth.
 * Chip load = feedRate / (RPM × flutes)
 *
 * @param lines G-code lines
 * @param flutes Number of flutes (default 2)
 * @param material Material type (default 'aluminum')
 */
export function calculateChipLoad(
  lines: string[],
  flutes: number = 2,
  material: string = 'aluminum',
): ChipLoadResult {
  // Recommended chip load ranges by material (mm/tooth)
  const ranges: { [material: string]: { min: number; max: number } } = {
    aluminum: { min: 0.05, max: 0.15 },
    steel: { min: 0.03, max: 0.08 },
    stainless: { min: 0.02, max: 0.06 },
    wood: { min: 0.1, max: 0.3 },
    plastic: { min: 0.1, max: 0.25 },
    brass: { min: 0.05, max: 0.12 },
  };

  const recommendedRange = ranges[material] ?? ranges.aluminum;
  const points: ChipLoadPoint[] = [];
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

    const chipLoad = feedRate / (rpm * flutes);
    const inRange = chipLoad >= recommendedRange.min && chipLoad <= recommendedRange.max;

    points.push({
      line: i, chipLoad, recommendedRange, inRange,
      feedRate, rpm,
    });
  }

  const chipLoads = points.map(p => p.chipLoad);
  const avgChipLoad = chipLoads.length > 0 ? chipLoads.reduce((a, b) => a + b, 0) / chipLoads.length : 0;
  const maxChipLoad = chipLoads.length > 0 ? Math.max(...chipLoads) : 0;
  const inRangeCount = points.filter(p => p.inRange).length;
  const inRangePercentage = points.length > 0 ? (inRangeCount / points.length) * 100 : 0;
  const chipLoadScore = inRangePercentage;

  const recommendations: string[] = [];
  if (maxChipLoad > recommendedRange.max) {
    recommendations.push(`Max chip load ${maxChipLoad.toFixed(3)}mm/tooth exceeds recommended ${recommendedRange.max} — reduce feed or increase RPM`);
  }
  if (avgChipLoad < recommendedRange.min) {
    recommendations.push(`Avg chip load ${avgChipLoad.toFixed(3)}mm/tooth below recommended ${recommendedRange.min} — increase feed or reduce RPM`);
  }
  if (inRangePercentage < 50) {
    recommendations.push(`Only ${inRangePercentage.toFixed(0)}% in range — optimize cutting parameters`);
  }
  if (inRangePercentage > 90) {
    recommendations.push('Chip load is well-optimized for material');
  }

  return {
    points, avgChipLoad, maxChipLoad, inRangePercentage,
    chipLoadScore, recommendations,
  };
}

// ── 6. Print Filament Spool Estimator ──

export interface SpoolEstimateResult {
  /** Total filament used in mm */
  filamentUsedMm: number;
  /** Total filament used in meters */
  filamentUsedM: number;
  /** Total filament weight in grams */
  filamentWeightG: number;
  /** Spool capacity in grams */
  spoolCapacityG: number;
  /** Remaining filament in grams */
  remainingG: number;
  /** Remaining percentage */
  remainingPercentage: number;
  /** Whether spool is sufficient */
  sufficient: boolean;
  /** Cost estimate in USD */
  costEstimate: number;
  /** Number of spools needed */
  spoolsNeeded: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Estimate filament spool usage and remaining filament.
 *
 * @param lines G-code lines
 * @param filamentDiameter Filament diameter in mm (default 1.75)
 * @param filamentDensity Filament density in g/cm³ (default 1.24 for PLA)
 * @param spoolCapacity Spool capacity in grams (default 1000)
 * @param costPerKg Cost per kg in USD (default 20)
 */
export function estimateSpoolUsage(
  lines: string[],
  filamentDiameter: number = 1.75,
  filamentDensity: number = 1.24,
  spoolCapacityG: number = 1000,
  costPerKg: number = 20,
): SpoolEstimateResult {
  let maxE = 0;
  let minE = Infinity;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG1\b/i.test(code)) continue;

    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);
    if (eMatch) {
      const e = parseFloat(eMatch[1]);
      maxE = Math.max(maxE, e);
      minE = Math.min(minE, e);
    }
  }

  if (minE === Infinity) minE = 0;

  const filamentUsedMm = maxE - minE;
  const filamentUsedM = filamentUsedMm / 1000;

  // Volume = π × (d/2)² × length
  const volumeCm3 = Math.PI * (filamentDiameter / 2) ** 2 * filamentUsedMm / 1000;
  const filamentWeightG = volumeCm3 * filamentDensity;

  const remainingG = spoolCapacityG - filamentWeightG;
  const remainingPercentage = spoolCapacityG > 0 ? (remainingG / spoolCapacityG) * 100 : 0;
  const sufficient = remainingG >= 0;
  const spoolsNeeded = Math.ceil(filamentWeightG / spoolCapacityG);
  const costEstimate = (filamentWeightG / 1000) * costPerKg;

  const recommendations: string[] = [];
  recommendations.push(`${filamentUsedM.toFixed(2)}m (${filamentWeightG.toFixed(0)}g) filament needed`);
  if (!sufficient) {
    recommendations.push(`Insufficient filament — need ${Math.abs(remainingG).toFixed(0)}g more`);
  }
  if (spoolsNeeded > 1) {
    recommendations.push(`${spoolsNeeded} spools needed — plan filament swaps`);
  }
  recommendations.push(`Estimated cost: $${costEstimate.toFixed(2)}`);
  if (remainingPercentage < 10) {
    recommendations.push(`Low filament remaining (${remainingPercentage.toFixed(0)}%) — risk of running out`);
  }

  return {
    filamentUsedMm, filamentUsedM, filamentWeightG,
    spoolCapacityG, remainingG, remainingPercentage,
    sufficient, costEstimate, spoolsNeeded, recommendations,
  };
}

// ── 7. G-code Error Recovery Suggestions ──

export interface ErrorSuggestion {
  /** Line number */
  line: number;
  /** Error type */
  errorType: string;
  /** Error description */
  description: string;
  /** Suggested fix */
  suggestedFix: string;
  /** Severity */
  severity: 'low' | 'medium' | 'high';
  /** Confidence (0-100) */
  confidence: number;
}

export interface ErrorRecoveryResult {
  /** All error suggestions */
  suggestions: ErrorSuggestion[];
  /** Suggestion count */
  count: number;
  /** By severity */
  bySeverity: { low: number; medium: number; high: number };
  /** Whether errors were found */
  hasErrors: boolean;
  /** Recovery score (0-100, higher is better) */
  recoveryScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Suggest fixes for common G-code errors.
 * Detects and provides recovery suggestions for typical mistakes.
 *
 * @param lines G-code lines
 */
export function suggestErrorRecovery(lines: string[]): ErrorRecoveryResult {
  const suggestions: ErrorSuggestion[] = [];
  let prevZ = 0;
  let hasHomed = false;
  let hasSpindleOn = false;
  let hasToolChange = false;
  let currentTool = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Check for homing
    if (/\bG28\b/i.test(code)) hasHomed = true;

    // Check for spindle
    if (/\bM3\b/i.test(code) || /\bM03\b/i.test(code)) hasSpindleOn = true;
    if (/\bM5\b/i.test(code)) hasSpindleOn = false;

    // Check for tool change
    const tMatch = code.match(/\bT(\d+)\b/i);
    if (tMatch && (/\bM6\b/i.test(code) || /\bM06\b/i.test(code))) {
      hasToolChange = true;
      currentTool = parseInt(tMatch[1]);
    }

    // Check for motion before homing
    if (/\bG[01]\b/i.test(code) && !hasHomed) {
      suggestions.push({
        line: i, errorType: 'no_homing',
        description: 'Motion before homing (G28)',
        suggestedFix: 'Add G28 at the start of the program',
        severity: 'high', confidence: 90,
      });
      hasHomed = true; // Don't repeat
    }

    // Check for cutting without spindle
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    if (zMatch) prevZ = parseFloat(zMatch[1]);
    if (/\bG1\b/i.test(code) && prevZ < 0 && !hasSpindleOn) {
      suggestions.push({
        line: i, errorType: 'no_spindle',
        description: 'Cutting without spindle on (M3)',
        suggestedFix: 'Add M3 S<rpm> before cutting',
        severity: 'high', confidence: 85,
      });
      hasSpindleOn = true; // Don't repeat
    }

    // Check for missing tool change
    if (/\bG1\b/i.test(code) && prevZ < 0 && !hasToolChange && currentTool === 0) {
      suggestions.push({
        line: i, errorType: 'no_tool',
        description: 'Cutting without tool selected',
        suggestedFix: 'Add T1 M6 to select a tool',
        severity: 'medium', confidence: 70,
      });
      hasToolChange = true;
    }

    // Check for rapid into material
    if (/\bG0\b/i.test(code) && prevZ < 0) {
      suggestions.push({
        line: i, errorType: 'rapid_in_material',
        description: 'Rapid move below Z=0',
        suggestedFix: 'Raise Z above 0 before rapid moves',
        severity: 'medium', confidence: 80,
      });
    }

    // Check for missing units
    if (i === 0 && !/\bG2[01]\b/i.test(code)) {
      suggestions.push({
        line: i, errorType: 'no_units',
        description: 'No units specified (G20/G21)',
        suggestedFix: 'Add G21 (mm) or G20 (inches) at the start',
        severity: 'low', confidence: 60,
      });
    }

    // Check for missing absolute/relative
    if (i === 0 && !/\bG9[01]\b/i.test(code)) {
      suggestions.push({
        line: i, errorType: 'no_positioning_mode',
        description: 'No positioning mode (G90/G91)',
        suggestedFix: 'Add G90 (absolute) or G91 (relative) at the start',
        severity: 'low', confidence: 50,
      });
    }
  }

  const bySeverity = {
    low: suggestions.filter(s => s.severity === 'low').length,
    medium: suggestions.filter(s => s.severity === 'medium').length,
    high: suggestions.filter(s => s.severity === 'high').length,
  };

  const count = suggestions.length;
  const hasErrors = count > 0;
  const recoveryScore = Math.max(0, 100 - bySeverity.high * 25 - bySeverity.medium * 10 - bySeverity.low * 5);

  const recommendations: string[] = [];
  if (bySeverity.high > 0) {
    recommendations.push(`${bySeverity.high} high-severity errors — fix before running`);
  }
  for (const s of suggestions.filter(s => s.severity === 'high').slice(0, 3)) {
    recommendations.push(`Line ${s.line}: ${s.description} → ${s.suggestedFix}`);
  }
  if (!hasErrors) {
    recommendations.push('No common errors detected — G-code looks good');
  }

  return {
    suggestions, count, bySeverity, hasErrors, recoveryScore,
    recommendations,
  };
}

// ── 8. CNC MRR (Material Removal Rate) Calculator ──

export interface MRRPoint {
  /** Time in seconds */
  time: number;
  /** MRR in cm³/min */
  mrr: number;
  /** Line number */
  line: number;
  /** Depth of cut in mm */
  depthOfCut: number;
  /** Width of cut in mm */
  widthOfCut: number;
  /** Feed rate in mm/min */
  feedRate: number;
}

export interface MRRResult {
  /** Per-point MRR data */
  points: MRRPoint[];
  /** Average MRR in cm³/min */
  avgMRR: number;
  /** Maximum MRR in cm³/min */
  maxMRR: number;
  /** Total volume removed in cm³ */
  totalVolume: number;
  /** MRR efficiency score (0-100) */
  mrrScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Calculate Material Removal Rate over time.
 * MRR = (depth × width × feed) / 1000 (cm³/min)
 *
 * @param lines G-code lines
 * @param toolDiameter Tool diameter in mm (default 6)
 */
export function calculateMRR(
  lines: string[],
  toolDiameter: number = 6,
): MRRResult {
  const points: MRRPoint[] = [];
  let feedRate = 0;
  let prevX = 0, prevY = 0, prevZ = 0;
  let currentTime = 0;
  let totalVolume = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
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

    if (z < 0 && feedRate > 0) {
      const distance = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
      if (distance > 0.01) {
        const time = distance / (feedRate / 60);
        currentTime += time;

        const depthOfCut = Math.abs(z);
        const widthOfCut = Math.min(toolDiameter, distance);
        const mrr = (depthOfCut * widthOfCut * feedRate) / 1000; // cm³/min
        const volume = (depthOfCut * widthOfCut * distance) / 1000; // cm³
        totalVolume += volume;

        points.push({
          time: currentTime, mrr, line: i,
          depthOfCut, widthOfCut, feedRate,
        });
      }
    }

    prevX = x; prevY = y; prevZ = z;
  }

  const mrrs = points.map(p => p.mrr);
  const avgMRR = mrrs.length > 0 ? mrrs.reduce((a, b) => a + b, 0) / mrrs.length : 0;
  const maxMRR = mrrs.length > 0 ? Math.max(...mrrs) : 0;

  // MRR score: higher average MRR with lower variance = better
  const variance = mrrs.length > 0
    ? mrrs.reduce((s, m) => s + (m - avgMRR) ** 2, 0) / mrrs.length
    : 0;
  const mrrScore = Math.min(100, avgMRR * 10 + Math.max(0, 50 - Math.sqrt(variance) * 5));

  const recommendations: string[] = [];
  if (maxMRR > 50) {
    recommendations.push(`Max MRR ${maxMRR.toFixed(1)}cm³/min — check spindle power`);
  }
  if (avgMRR < 1) {
    recommendations.push(`Low avg MRR (${avgMRR.toFixed(2)}cm³/min) — increase DOC or feed`);
  }
  recommendations.push(`Total volume removed: ${totalVolume.toFixed(2)}cm³`);
  if (mrrScore > 70) {
    recommendations.push('Good MRR efficiency');
  }

  return {
    points, avgMRR, maxMRR, totalVolume, mrrScore, recommendations,
  };
}

// ── 9. Print Coasting Analysis ──

export interface CoastingPoint {
  /** Line number */
  line: number;
  /** Whether coasting is detected */
  hasCoasting: boolean;
  /** Coasting distance in mm */
  coastingDistance: number;
  /** Extrusion before stop in mm */
  extrusionBefore: number;
  /** Travel after stop in mm */
  travelAfter: number;
}

export interface CoastingResult {
  /** Per-point coasting data */
  points: CoastingPoint[];
  /** Coasting count */
  coastingCount: number;
  /** Average coasting distance */
  avgCoastingDistance: number;
  /** Points without coasting */
  withoutCoastingCount: number;
  /** Coasting effectiveness score (0-100) */
  coastingScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze coasting settings for cleaner stops.
 * Coasting extrudes slightly less at the end of a move to relieve pressure.
 *
 * @param lines G-code lines
 * @param expectedCoastDistance Expected coast distance in mm (default 0.2)
 */
export function analyzeCoasting(
  lines: string[],
  expectedCoastDistance: number = 0.2,
): CoastingResult {
  const points: CoastingPoint[] = [];
  let prevE = 0;
  let prevExtruding = false;
  let extrusionBefore = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG[01]\b/i.test(code)) continue;

    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);
    const isRapid = /\bG0\b/i.test(code);
    const e = eMatch ? parseFloat(eMatch[1]) : prevE;
    const isExtruding = e > prevE;

    if (prevExtruding && (isRapid || !isExtruding)) {
      // Transition from extruding to non-extruding
      const coastingDistance = prevE - (eMatch ? e : prevE);
      const hasCoasting = coastingDistance > 0.01 && coastingDistance < 1;

      // Check travel after
      let travelAfter = 0;
      if (isRapid) {
        const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
        const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
        if (xMatch || yMatch) travelAfter = 1; // Has travel
      }

      points.push({
        line: i, hasCoasting, coastingDistance: Math.abs(coastingDistance),
        extrusionBefore, travelAfter,
      });
    }

    if (isExtruding) {
      extrusionBefore = e - prevE;
    } else {
      extrusionBefore = 0;
    }

    prevE = e;
    prevExtruding = isExtruding;
  }

  const coastingPoints = points.filter(p => p.hasCoasting);
  const coastingCount = coastingPoints.length;
  const withoutCoastingCount = points.length - coastingCount;
  const avgCoastingDistance = coastingPoints.length > 0
    ? coastingPoints.reduce((s, p) => s + p.coastingDistance, 0) / coastingPoints.length
    : 0;

  // Coasting score: higher percentage of transitions with coasting
  const coastingScore = points.length > 0 ? (coastingCount / points.length) * 100 : 0;

  const recommendations: string[] = [];
  if (coastingCount === 0) {
    recommendations.push('No coasting detected — enable coasting in slicer for cleaner stops');
  }
  if (withoutCoastingCount > coastingCount) {
    recommendations.push(`${withoutCoastingCount} transitions without coasting — enable coasting`);
  }
  if (avgCoastingDistance > 0 && Math.abs(avgCoastingDistance - expectedCoastDistance) > 0.1) {
    recommendations.push(`Avg coast ${avgCoastingDistance.toFixed(3)}mm vs expected ${expectedCoastDistance}mm — adjust coasting distance`);
  }
  if (coastingScore > 80) {
    recommendations.push('Good coasting coverage — clean stops expected');
  }

  return {
    points, coastingCount, avgCoastingDistance,
    withoutCoastingCount, coastingScore, recommendations,
  };
}

// ── 10. G-code Performance Bottleneck Analyzer ──

export interface Bottleneck {
  /** Line number */
  line: number;
  /** Bottleneck type */
  type: 'slow_feed' | 'excessive_dwell' | 'tool_change' | 'rapid_gap' | 'redundant_code';
  /** Description */
  description: string;
  /** Time impact in seconds */
  timeImpact: number;
  /** Severity */
  severity: 'low' | 'medium' | 'high';
  /** Suggested optimization */
  optimization: string;
}

export interface BottleneckResult {
  /** All bottlenecks */
  bottlenecks: Bottleneck[];
  /** Bottleneck count */
  count: number;
  /** Total time lost in seconds */
  totalTimeLost: number;
  /** By severity */
  bySeverity: { low: number; medium: number; high: number };
  /** Performance score (0-100) */
  performanceScore: number;
  /** Top optimization */
  topOptimization: string | null;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Identify performance bottlenecks in G-code.
 * Finds slow feeds, excessive dwells, tool changes, and rapid gaps.
 *
 * @param lines G-code lines
 * @param minFeedRate Minimum acceptable feed rate (default 100)
 */
export function identifyBottlenecks(
  lines: string[],
  minFeedRate: number = 100,
): BottleneckResult {
  const bottlenecks: Bottleneck[] = [];
  let feedRate = 0;
  let prevX = 0, prevY = 0, prevZ = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) feedRate = parseFloat(fMatch[1]);

    // Slow feed rate
    if (/\bG1\b/i.test(code) && feedRate > 0 && feedRate < minFeedRate) {
      const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
      const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
      const x = xMatch ? parseFloat(xMatch[1]) : prevX;
      const y = yMatch ? parseFloat(yMatch[1]) : prevY;
      const z = zMatch ? parseFloat(zMatch[1]) : prevZ;
      const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2 + (z - prevZ) ** 2);
      const timeImpact = dist / (feedRate / 60);
      bottlenecks.push({
        line: i, type: 'slow_feed',
        description: `Slow feed rate ${feedRate.toFixed(0)}mm/min`,
        timeImpact, severity: timeImpact > 10 ? 'high' : 'medium',
        optimization: `Increase feed rate to ${minFeedRate}mm/min or higher`,
      });
    }

    // Excessive dwell
    if (/\bG4\b/i.test(code)) {
      const pMatch = code.match(/\bP(\d*\.?\d+)/i);
      const dwellMs = pMatch ? parseFloat(pMatch[1]) : 0;
      if (dwellMs > 1000) {
        bottlenecks.push({
          line: i, type: 'excessive_dwell',
          description: `Long dwell ${dwellMs}ms`,
          timeImpact: dwellMs / 1000, severity: 'medium',
          optimization: 'Reduce dwell time or remove if unnecessary',
        });
      }
    }

    // Tool change
    if (/\bM6\b/i.test(code) || /\bM06\b/i.test(code)) {
      bottlenecks.push({
        line: i, type: 'tool_change',
        description: 'Tool change operation',
        timeImpact: 30, severity: 'high',
        optimization: 'Optimize tool order to minimize changes',
      });
    }

    // Rapid gap (long travel)
    if (/\bG0\b/i.test(code)) {
      const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
      const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
      const x = xMatch ? parseFloat(xMatch[1]) : prevX;
      const y = yMatch ? parseFloat(yMatch[1]) : prevY;
      const z = zMatch ? parseFloat(zMatch[1]) : prevZ;
      const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2 + (z - prevZ) ** 2);
      if (dist > 50) {
        bottlenecks.push({
          line: i, type: 'rapid_gap',
          description: `Long rapid travel ${dist.toFixed(0)}mm`,
          timeImpact: dist / 5000, severity: 'medium',
          optimization: 'Optimize part placement to reduce travel',
        });
      }
      prevX = x; prevY = y; prevZ = z;
    }

    if (/\bG1\b/i.test(code)) {
      const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
      const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
      if (xMatch) prevX = parseFloat(xMatch[1]);
      if (yMatch) prevY = parseFloat(yMatch[1]);
      if (zMatch) prevZ = parseFloat(zMatch[1]);
    }
  }

  const bySeverity = {
    low: bottlenecks.filter(b => b.severity === 'low').length,
    medium: bottlenecks.filter(b => b.severity === 'medium').length,
    high: bottlenecks.filter(b => b.severity === 'high').length,
  };

  const totalTimeLost = bottlenecks.reduce((s, b) => s + b.timeImpact, 0);
  const count = bottlenecks.length;
  const performanceScore = Math.max(0, 100 - bySeverity.high * 15 - bySeverity.medium * 5 - bySeverity.low * 1);

  const topOptimization = bottlenecks.length > 0
    ? bottlenecks.sort((a, b) => b.timeImpact - a.timeImpact)[0].optimization
    : null;

  const recommendations: string[] = [];
  if (totalTimeLost > 60) {
    recommendations.push(`${totalTimeLost.toFixed(0)}s lost to bottlenecks — optimize for faster execution`);
  }
  if (bySeverity.high > 0) {
    recommendations.push(`${bySeverity.high} high-impact bottlenecks — address first`);
  }
  if (topOptimization) {
    recommendations.push(`Top optimization: ${topOptimization}`);
  }
  if (count === 0) {
    recommendations.push('No significant bottlenecks detected — good performance');
  }

  return {
    bottlenecks, count, totalTimeLost, bySeverity,
    performanceScore, topOptimization, recommendations,
  };
}

// ── 11. CNC Tool Pull-off Distance Calculator ──

export interface PullOffResult {
  /** Recommended pull-off distance in mm */
  recommendedDistance: number;
  /** Per-operation pull-off data */
  operations: { line: number; depth: number; pullOff: number; reason: string }[];
  /** Average pull-off distance */
  avgPullOff: number;
  /** Max pull-off distance */
  maxPullOff: number;
  /** Total pull-off time in seconds */
  totalPullOffTime: number;
  /** Safety score (0-100) */
  safetyScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Calculate optimal tool pull-off distances.
 * Pull-off is the distance the tool retracts from the wall before moving to the next position.
 *
 * @param lines G-code lines
 * @param toolDiameter Tool diameter in mm (default 6)
 * @param safetyMargin Safety margin multiplier (default 1.5)
 */
export function calculatePullOffDistance(
  lines: string[],
  toolDiameter: number = 6,
  safetyMargin: number = 1.5,
): PullOffResult {
  const operations: { line: number; depth: number; pullOff: number; reason: string }[] = [];
  let prevZ = 0;
  let feedRate = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) feedRate = parseFloat(fMatch[1]);

    if (!/\bG1\b/i.test(code)) continue;

    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    if (zMatch) {
      const z = parseFloat(zMatch[1]);
      if (z < 0) {
        const depth = Math.abs(z);
        // Pull-off = tool radius × safety margin + depth factor
        const basePullOff = (toolDiameter / 2) * safetyMargin;
        const depthFactor = Math.min(2, depth / 5);
        const pullOff = basePullOff + depthFactor;
        const reason = depth > 5 ? 'Deep cut — extra clearance needed' : 'Standard pull-off';

        operations.push({ line: i, depth, pullOff, reason });
      }
      prevZ = z;
    }
  }

  const pullOffs = operations.map(o => o.pullOff);
  const avgPullOff = pullOffs.length > 0 ? pullOffs.reduce((a, b) => a + b, 0) / pullOffs.length : 0;
  const maxPullOff = pullOffs.length > 0 ? Math.max(...pullOffs) : 0;
  const recommendedDistance = (toolDiameter / 2) * safetyMargin;
  const totalPullOffTime = pullOffs.reduce((s, p) => s + p / (feedRate / 60 || 100), 0);
  const safetyScore = Math.min(100, 50 + (recommendedDistance / toolDiameter) * 50);

  const recommendations: string[] = [];
  recommendations.push(`Recommended pull-off: ${recommendedDistance.toFixed(2)}mm (${safetyMargin}× tool radius)`);
  if (maxPullOff > recommendedDistance * 2) {
    recommendations.push(`Max pull-off ${maxPullOff.toFixed(2)}mm — deep cuts need extra clearance`);
  }
  if (operations.length === 0) {
    recommendations.push('No cutting operations for pull-off calculation');
  }
  if (safetyScore > 80) {
    recommendations.push('Good pull-off safety margin');
  }

  return {
    recommendedDistance, operations, avgPullOff, maxPullOff,
    totalPullOffTime, safetyScore, recommendations,
  };
}

// ── 12. Print First Layer Squish Analyzer ──

export interface SquishPoint {
  /** Line number */
  line: number;
  /** Nozzle Z height in mm */
  zHeight: number;
  /** Extrusion width in mm */
  extrusionWidth: number;
  /** Squish ratio (width / nozzle diameter) */
  squishRatio: number;
  /** Whether squish is optimal */
  optimal: boolean;
}

export interface SquishResult {
  /** Per-point squish data */
  points: SquishPoint[];
  /** Average squish ratio */
  avgSquishRatio: number;
  /** Max squish ratio */
  maxSquishRatio: number;
  /** Min squish ratio */
  minSquishRatio: number;
  /** Optimal percentage */
  optimalPercentage: number;
  /** Squish score (0-100) */
  squishScore: number;
  /** Z offset recommendation in mm */
  zOffsetRecommendation: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze first layer squish ratio.
 * Squish ratio = extrusion width / nozzle diameter.
 * Optimal ratio is typically 1.0-1.2 for good adhesion.
 *
 * @param lines G-code lines
 * @param nozzleDiameter Nozzle diameter in mm (default 0.4)
 * @param filamentDiameter Filament diameter in mm (default 1.75)
 * @param optimalMin Minimum optimal squish ratio (default 1.0)
 * @param optimalMax Maximum optimal squish ratio (default 1.2)
 */
export function analyzeFirstLayerSquish(
  lines: string[],
  nozzleDiameter: number = 0.4,
  filamentDiameter: number = 1.75,
  optimalMin: number = 1.0,
  optimalMax: number = 1.2,
): SquishResult {
  const points: SquishPoint[] = [];
  let prevX = 0, prevY = 0, prevE = 0;
  let currentZ = 0;
  let firstLayerZ = 0;
  let isFirstLayer = true;
  const filamentArea = Math.PI * (filamentDiameter / 2) ** 2;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG1\b/i.test(code)) continue;

    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    if (zMatch) {
      currentZ = parseFloat(zMatch[1]);
      if (firstLayerZ === 0) firstLayerZ = currentZ;
      if (currentZ > firstLayerZ + 0.3) isFirstLayer = false;
    }

    if (!isFirstLayer) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const e = eMatch ? parseFloat(eMatch[1]) : prevE;

    if (e > prevE && currentZ > 0) {
      const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
      const eDelta = e - prevE;
      const volume = eDelta * filamentArea;

      if (dist > 0 && currentZ > 0) {
        const width = volume / (dist * currentZ);
        const squishRatio = width / nozzleDiameter;
        const optimal = squishRatio >= optimalMin && squishRatio <= optimalMax;

        points.push({
          line: i, zHeight: currentZ, extrusionWidth: width,
          squishRatio, optimal,
        });
      }
    }

    prevX = x; prevY = y; prevE = e;
  }

  const ratios = points.map(p => p.squishRatio);
  const avgSquishRatio = ratios.length > 0 ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 0;
  const maxSquishRatio = ratios.length > 0 ? Math.max(...ratios) : 0;
  const minSquishRatio = ratios.length > 0 ? Math.min(...ratios) : 0;
  const optimalCount = points.filter(p => p.optimal).length;
  const optimalPercentage = points.length > 0 ? (optimalCount / points.length) * 100 : 0;
  const squishScore = optimalPercentage;

  // Z offset recommendation
  let zOffsetRecommendation = 0;
  if (avgSquishRatio > optimalMax) {
    zOffsetRecommendation = 0.05; // Raise Z
  } else if (avgSquishRatio < optimalMin) {
    zOffsetRecommendation = -0.05; // Lower Z
  }

  const recommendations: string[] = [];
  if (avgSquishRatio > optimalMax) {
    recommendations.push(`Squish ratio ${avgSquishRatio.toFixed(2)} too high — raise Z by ${Math.abs(zOffsetRecommendation).toFixed(2)}mm`);
  }
  if (avgSquishRatio < optimalMin) {
    recommendations.push(`Squish ratio ${avgSquishRatio.toFixed(2)} too low — lower Z by ${Math.abs(zOffsetRecommendation).toFixed(2)}mm`);
  }
  if (optimalPercentage > 80) {
    recommendations.push('Good first layer squish — proper adhesion expected');
  }
  if (points.length === 0) {
    recommendations.push('No first layer data for squish analysis');
  }

  return {
    points, avgSquishRatio, maxSquishRatio, minSquishRatio,
    optimalPercentage, squishScore, zOffsetRecommendation,
    recommendations,
  };
}
