/**
 * @file GcodeAdvanced18.ts
 * @brief Eighteenth batch of advanced G-code analysis features for CNC and 3D printing.
 *
 * This module provides 12 additional high-impact features:
 *  1. G-code toolpath length per tool (CNC) — per-tool cutting distance
 *  2. Print ooze prevention analyzer (3DP) — ooze prevention measures
 *  3. G-code coordinate system analyzer (Universal) — G54-G59 analysis
 *  4. CNC spindle speed variation analyzer (CNC) — spindle speed tracking
 *  5. Print bridge quality predictor (3DP) — bridge quality prediction
 *  6. G-code modal group analyzer (Universal) — modal state analysis
 *  7. CNC feed rate override simulator (CNC) — override effect simulation
 *  8. Print cooling fan curve analyzer (3DP) — fan speed curve
 *  9. G-code subprogram complexity analyzer (Universal) — subprogram complexity
 * 10. CNC tool path direction reversal counter (CNC) — reversal counting
 * 11. Print Z-seam alignment optimizer (3DP) — Z-seam optimization
 * 12. G-code execution risk assessment (Universal) — overall risk
 */

// ── 1. G-code Toolpath Length Per Tool ──

export interface ToolPathData {
  /** Tool number */
  tool: number;
  /** Total distance in mm */
  totalDistance: number;
  /** Cutting distance in mm */
  cuttingDistance: number;
  /** Travel distance in mm */
  travelDistance: number;
  /** Estimated time in seconds */
  estimatedTime: number;
  /** Number of operations */
  operationCount: number;
  /** Max depth of cut */
  maxDepth: number;
  /** Average feed rate */
  avgFeedRate: number;
}

export interface PerToolPathResult {
  /** Per-tool data */
  tools: ToolPathData[];
  /** Total distance across all tools */
  totalDistance: number;
  /** Tool with most cutting */
  busiestTool: ToolPathData | null;
  /** Tool count */
  toolCount: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Track cutting distance per individual tool.
 * Useful for tool wear estimation and tool life planning.
 *
 * @param lines G-code lines
 */
export function analyzePerToolPathLength(lines: string[]): PerToolPathResult {
  const toolMap = new Map<number, ToolPathData>();
  let currentTool = 0;
  let prevX = 0, prevY = 0, prevZ = 0;
  let feedRate = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Track tool changes
    const tMatch = code.match(/\bT(\d+)\b/i);
    if (tMatch && (/\bM6\b/i.test(code) || /\bM06\b/i.test(code))) {
      currentTool = parseInt(tMatch[1]);
      if (!toolMap.has(currentTool)) {
        toolMap.set(currentTool, {
          tool: currentTool, totalDistance: 0, cuttingDistance: 0,
          travelDistance: 0, estimatedTime: 0, operationCount: 0,
          maxDepth: 0, avgFeedRate: 0,
        });
      }
    }

    if (!/\bG[01]\b/i.test(code)) continue;

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) feedRate = parseFloat(fMatch[1]);

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const z = zMatch ? parseFloat(zMatch[1]) : prevZ;

    const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2 + (z - prevZ) ** 2);
    if (dist > 0) {
      const tool = toolMap.get(currentTool);
      if (tool) {
        tool.totalDistance += dist;
        tool.operationCount++;
        if (z < 0) {
          tool.cuttingDistance += dist;
          tool.maxDepth = Math.max(tool.maxDepth, Math.abs(z));
        } else {
          tool.travelDistance += dist;
        }
        if (feedRate > 0) {
          tool.estimatedTime += dist / (feedRate / 60);
          tool.avgFeedRate = (tool.avgFeedRate * (tool.operationCount - 1) + feedRate) / tool.operationCount;
        }
      }
    }

    prevX = x; prevY = y; prevZ = z;
  }

  const tools = Array.from(toolMap.values()).sort((a, b) => a.tool - b.tool);
  const totalDistance = tools.reduce((s, t) => s + t.totalDistance, 0);
  const busiestTool = tools.length > 0
    ? tools.reduce((max, t) => t.cuttingDistance > max.cuttingDistance ? t : max, tools[0])
    : null;

  const recommendations: string[] = [];
  for (const t of tools) {
    recommendations.push(`T${t.tool}: ${t.cuttingDistance.toFixed(0)}mm cutting, ${t.travelDistance.toFixed(0)}mm travel, ${t.estimatedTime.toFixed(0)}s`);
  }
  if (busiestTool) {
    recommendations.push(`Busiest tool: T${busiestTool.tool} (${busiestTool.cuttingDistance.toFixed(0)}mm cutting)`);
  }
  if (tools.length === 0) {
    recommendations.push('No tool changes detected — all operations use default tool');
  }

  return { tools, totalDistance, busiestTool, toolCount: tools.length, recommendations };
}

// ── 2. Print Ooze Prevention Analyzer ──

export interface OozePreventionResult {
  /** Retraction count */
  retractionCount: number;
  /** Average retraction distance */
  avgRetractionDistance: number;
  /** Z-hop count */
  zHopCount: number;
  /** Wipe count (travel after retraction) */
  wipeCount: number;
  /** Coasting detected */
  coastingDetected: boolean;
  /** Ooze prevention score (0-100) */
  preventionScore: number;
  /** Ooze risk level */
  riskLevel: 'low' | 'medium' | 'high';
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze ooze prevention measures.
 * Ooze prevention includes retraction, Z-hop, wiping, and coasting.
 *
 * @param lines G-code lines
 */
export function analyzeOozePrevention(lines: string[]): OozePreventionResult {
  let retractionCount = 0;
  let totalRetractionDist = 0;
  let zHopCount = 0;
  let wipeCount = 0;
  let coastingDetected = false;
  let prevE = 0;
  let prevZ = 0;
  let hadRetraction = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG[01]\b/i.test(code)) continue;

    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);

    const e = eMatch ? parseFloat(eMatch[1]) : prevE;
    const z = zMatch ? parseFloat(zMatch[1]) : prevZ;

    // Detect retraction
    if (e < prevE) {
      retractionCount++;
      totalRetractionDist += prevE - e;
      hadRetraction = true;
    }

    // Detect Z-hop (Z increase right after retraction)
    if (hadRetraction && z > prevZ + 0.05) {
      zHopCount++;
    }

    // Detect wipe (travel move after retraction without extrusion)
    if (hadRetraction && e <= prevE) {
      const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
      if (xMatch || yMatch) {
        wipeCount++;
      }
    }

    // Detect coasting (slight extrusion reduction before stop)
    if (e > prevE && e - prevE < 0.05) {
      coastingDetected = true;
    }

    if (e > prevE) hadRetraction = false;
    prevE = e;
    prevZ = z;
  }

  const avgRetractionDistance = retractionCount > 0 ? totalRetractionDist / retractionCount : 0;

  // Compute prevention score
  let score = 0;
  if (retractionCount > 0) score += 30;
  if (avgRetractionDistance >= 0.5) score += 15;
  if (zHopCount > 0) score += 20;
  if (wipeCount > 0) score += 20;
  if (coastingDetected) score += 15;
  const preventionScore = Math.min(100, score);

  const riskLevel = preventionScore > 70 ? 'low' : preventionScore > 40 ? 'medium' : 'high';

  const recommendations: string[] = [];
  if (retractionCount === 0) {
    recommendations.push('No retraction detected — enable retraction to prevent ooze');
  }
  if (zHopCount === 0 && retractionCount > 0) {
    recommendations.push('No Z-hop detected — enable Z-hop for better ooze prevention');
  }
  if (wipeCount === 0 && retractionCount > 0) {
    recommendations.push('No wipe moves — add wipe to clean nozzle after retraction');
  }
  if (!coastingDetected) {
    recommendations.push('No coasting detected — enable coasting for cleaner stops');
  }
  if (riskLevel === 'low') {
    recommendations.push('Good ooze prevention — multiple measures in place');
  }

  return {
    retractionCount, avgRetractionDistance, zHopCount, wipeCount,
    coastingDetected, preventionScore, riskLevel, recommendations,
  };
}

// ── 3. G-code Coordinate System Analyzer ──

export interface CoordinateSystemInfo {
  /** Work coordinate system (G54-G59) */
  system: string;
  /** Offset values */
  offsets: { x?: number; y?: number; z?: number };
  /** Usage count */
  usageCount: number;
  /** First use line */
  firstUseLine: number;
}

export interface CoordinateSystemResult {
  /** All coordinate systems used */
  systems: CoordinateSystemInfo[];
  /** Currently active system */
  activeSystem: string;
  /** Number of system changes */
  systemChanges: number;
  /** Whether homing was performed */
  hasHoming: boolean;
  /** Homing line */
  homingLine: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze coordinate systems used in G-code.
 * Tracks G54-G59 work coordinate systems and homing operations.
 *
 * @param lines G-code lines
 */
export function analyzeCoordinateSystems(lines: string[]): CoordinateSystemResult {
  const systemMap = new Map<string, CoordinateSystemInfo>();
  let activeSystem = 'G54';
  let systemChanges = 0;
  let hasHoming = false;
  let homingLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Homing
    if (/\bG28\b/i.test(code)) {
      hasHoming = true;
      homingLine = i;
    }

    // Work coordinate systems
    const wcsMatch = code.match(/\bG(5[4-9])\b/i);
    if (wcsMatch) {
      const system = `G${wcsMatch[1]}`;
      if (system !== activeSystem) {
        systemChanges++;
        activeSystem = system;
      }
      if (!systemMap.has(system)) {
        systemMap.set(system, {
          system, offsets: {}, usageCount: 0, firstUseLine: i,
        });
      }
      const info = systemMap.get(system)!;
      info.usageCount++;

      // Parse offsets (G10 L2 P1 X.. Y.. Z..)
      const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
      const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
      if (xMatch) info.offsets.x = parseFloat(xMatch[1]);
      if (yMatch) info.offsets.y = parseFloat(yMatch[1]);
      if (zMatch) info.offsets.z = parseFloat(zMatch[1]);
    }

    // G10 offset setting
    if (/\bG10\b/i.test(code)) {
      const pMatch = code.match(/\bP(\d+)\b/i);
      if (pMatch) {
        const systemNum = parseInt(pMatch[1]);
        const system = `G5${3 + systemNum}`;
        if (!systemMap.has(system)) {
          systemMap.set(system, { system, offsets: {}, usageCount: 0, firstUseLine: i });
        }
        const info = systemMap.get(system)!;
        const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
        const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
        const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
        if (xMatch) info.offsets.x = parseFloat(xMatch[1]);
        if (yMatch) info.offsets.y = parseFloat(yMatch[1]);
        if (zMatch) info.offsets.z = parseFloat(zMatch[1]);
      }
    }
  }

  const systems = Array.from(systemMap.values()).sort((a, b) => a.system.localeCompare(b.system));

  const recommendations: string[] = [];
  if (!hasHoming) {
    recommendations.push('No homing (G28) detected — add homing before using work offsets');
  }
  if (systemChanges > 5) {
    recommendations.push(`${systemChanges} coordinate system changes — verify offsets are correct`);
  }
  for (const s of systems) {
    const offsetStr = [s.offsets.x, s.offsets.y, s.offsets.z]
      .filter(v => v !== undefined).map(v => v!.toFixed(1)).join(', ');
    recommendations.push(`${s.system}: ${s.usageCount} uses, offsets: ${offsetStr || 'none'}`);
  }
  if (systems.length === 0) {
    recommendations.push('No work coordinate systems (G54-G59) used — default G54 assumed');
  }

  return { systems, activeSystem, systemChanges, hasHoming, homingLine, recommendations };
}

// ── 4. CNC Spindle Speed Variation Analyzer ──

export interface SpindleVariationPoint {
  /** Line number */
  line: number;
  /** RPM */
  rpm: number;
  /** Change from previous */
  rpmChange: number;
  /** Reason */
  reason: string;
}

export interface SpindleVariationResult {
  /** Variation points */
  points: SpindleVariationPoint[];
  /** Number of speed changes */
  changeCount: number;
  /** Average RPM */
  avgRpm: number;
  /** Max RPM */
  maxRpm: number;
  /** Min RPM */
  minRpm: number;
  /** RPM range */
  rpmRange: number;
  /** Variation coefficient */
  variationCoefficient: number;
  /** Consistency score (0-100) */
  consistencyScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Track spindle speed variations during cutting.
 * Frequent speed changes can indicate poor programming or CSS mode.
 *
 * @param lines G-code lines
 */
export function analyzeSpindleSpeedVariation(lines: string[]): SpindleVariationResult {
  const points: SpindleVariationPoint[] = [];
  let prevRpm = 0;
  const rpms: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const sMatch = code.match(/\bS(\d*\.?\d+)/i);
    if (!sMatch) continue;

    const rpm = parseFloat(sMatch[1]);
    if (rpm === prevRpm) continue;

    const change = rpm - prevRpm;
    let reason = 'Speed change';
    if (/\bM3\b/i.test(code) || /\bM03\b/i.test(code)) reason = 'Spindle start';
    else if (/\bG96\b/i.test(code)) reason = 'CSS mode (constant surface speed)';
    else if (/\bG97\b/i.test(code)) reason = 'RPM mode';
    else if (Math.abs(change) > 1000) reason = 'Large speed change';

    points.push({ line: i, rpm, rpmChange: change, reason });
    rpms.push(rpm);
    prevRpm = rpm;
  }

  const changeCount = points.length;
  const avgRpm = rpms.length > 0 ? rpms.reduce((a, b) => a + b, 0) / rpms.length : 0;
  const maxRpm = rpms.length > 0 ? Math.max(...rpms) : 0;
  const minRpm = rpms.length > 0 ? Math.min(...rpms) : 0;
  const rpmRange = maxRpm - minRpm;

  const stdDev = rpms.length > 0
    ? Math.sqrt(rpms.reduce((s, r) => s + (r - avgRpm) ** 2, 0) / rpms.length)
    : 0;
  const variationCoefficient = avgRpm > 0 ? stdDev / avgRpm : 0;
  const consistencyScore = Math.max(0, 100 - variationCoefficient * 100);

  const recommendations: string[] = [];
  if (changeCount > 10) {
    recommendations.push(`${changeCount} speed changes — consider CSS (G96) for consistent surface speed`);
  }
  if (rpmRange > 10000) {
    recommendations.push(`Large RPM range (${rpmRange.toFixed(0)}) — verify tool ratings`);
  }
  if (variationCoefficient > 0.5) {
    recommendations.push(`High speed variation (CV=${variationCoefficient.toFixed(2)}) — stabilize cutting speed`);
  }
  if (consistencyScore > 90) {
    recommendations.push('Consistent spindle speed — good for surface finish');
  }

  return {
    points, changeCount, avgRpm, maxRpm, minRpm, rpmRange,
    variationCoefficient, consistencyScore, recommendations,
  };
}

// ── 5. Print Bridge Quality Predictor ──

export interface BridgeQualityData {
  /** Bridge start X */
  startX: number;
  /** Bridge start Y */
  startY: number;
  /** Bridge length in mm */
  length: number;
  /** Predicted quality (0-100) */
  qualityScore: number;
  /** Quality rating */
  rating: 'excellent' | 'good' | 'fair' | 'poor';
  /** Issues */
  issues: string[];
}

export interface BridgeQualityResult {
  /** All bridges */
  bridges: BridgeQualityData[];
  /** Bridge count */
  bridgeCount: number;
  /** Average quality score */
  avgQualityScore: number;
  /** Number of poor bridges */
  poorBridgeCount: number;
  /** Overall bridge quality */
  overallQuality: 'excellent' | 'good' | 'fair' | 'poor';
  /** Recommendations */
  recommendations: string[];
}

/**
 * Predict bridge quality from G-code parameters.
 * Bridge quality depends on length, cooling, and feed rate.
 *
 * @param lines G-code lines
 * @param maxBridgeLength Max recommended bridge length in mm (default 10)
 */
export function predictBridgeQuality(
  lines: string[],
  maxBridgeLength: number = 10,
): BridgeQualityResult {
  const bridges: BridgeQualityData[] = [];
  let prevX = 0, prevY = 0, prevZ = 0, prevE = 0;
  let currentZ = 0;
  let fanSpeed = 0;
  let feedRate = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Track fan
    if (/\bM106\b/i.test(code)) {
      const sMatch = code.match(/\bS(\d*\.?\d+)/i);
      if (sMatch) fanSpeed = parseFloat(sMatch[1]);
    }
    if (/\bM107\b/i.test(code)) fanSpeed = 0;

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) feedRate = parseFloat(fMatch[1]);

    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    if (zMatch) currentZ = parseFloat(zMatch[1]);

    if (!/\bG1\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const e = eMatch ? parseFloat(eMatch[1]) : prevE;

    // Detect bridge: extruding in air (Z significantly above previous layer)
    if (e > prevE && currentZ > 0) {
      const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
      if (dist > 2) {
        // Check if this is a bridge (no support below)
        // Simplified: assume bridges are long extrusion moves
        if (dist > 3) {
          let qualityScore = 100;
          const issues: string[] = [];

          // Length factor
          if (dist > maxBridgeLength) {
            qualityScore -= (dist - maxBridgeLength) * 5;
            issues.push(`Long bridge (${dist.toFixed(1)}mm > ${maxBridgeLength}mm)`);
          }

          // Fan factor
          if (fanSpeed < 128) {
            qualityScore -= 20;
            issues.push('Low fan speed for bridging');
          }

          // Feed rate factor
          if (feedRate > 3000) {
            qualityScore -= 15;
            issues.push('High feed rate for bridging');
          }

          qualityScore = Math.max(0, Math.min(100, qualityScore));
          const rating = qualityScore > 80 ? 'excellent' : qualityScore > 60 ? 'good'
            : qualityScore > 40 ? 'fair' : 'poor';

          bridges.push({
            startX: prevX, startY: prevY, length: dist,
            qualityScore, rating, issues,
          });
        }
      }
    }

    prevX = x; prevY = y; prevZ = currentZ; prevE = e;
  }

  const bridgeCount = bridges.length;
  const avgQualityScore = bridgeCount > 0
    ? bridges.reduce((s, b) => s + b.qualityScore, 0) / bridgeCount : 100;
  const poorBridgeCount = bridges.filter(b => b.rating === 'poor').length;
  const overallQuality = avgQualityScore > 80 ? 'excellent' : avgQualityScore > 60 ? 'good'
    : avgQualityScore > 40 ? 'fair' : 'poor';

  const recommendations: string[] = [];
  if (poorBridgeCount > 0) {
    recommendations.push(`${poorBridgeCount} poor-quality bridges — add supports or enable cooling`);
  }
  if (bridgeCount > 0) {
    recommendations.push(`${bridgeCount} bridges detected, avg quality ${avgQualityScore.toFixed(0)}/100`);
  }
  for (const b of bridges.filter(b => b.rating === 'poor').slice(0, 3)) {
    recommendations.push(`Bridge at (${b.startX.toFixed(0)}, ${b.startY.toFixed(0)}): ${b.length.toFixed(1)}mm, ${b.issues.join(', ')}`);
  }
  if (bridgeCount === 0) {
    recommendations.push('No bridges detected — good part orientation');
  }

  return { bridges, bridgeCount, avgQualityScore, poorBridgeCount, overallQuality, recommendations };
}

// ── 6. G-code Modal Group Analyzer ──

export interface ModalGroupState {
  /** Group name */
  group: string;
  /** Current state */
  state: string;
  /** Change count */
  changeCount: number;
  /** Last change line */
  lastChangeLine: number;
}

export interface ModalGroupResult {
  /** Modal group states */
  groups: ModalGroupState[];
  /** Total modal changes */
  totalChanges: number;
  /** Redundant modal commands */
  redundantCommands: number;
  /** Modal efficiency score (0-100) */
  modalScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze modal group states and transitions.
 * Modal groups in G-code include motion, plane, units, distance mode, etc.
 *
 * @param lines G-code lines
 */
export function analyzeModalGroups(lines: string[]): ModalGroupResult {
  const groups = new Map<string, ModalGroupState>();
  let redundantCommands = 0;

  // Initialize default states
  const defaults: { [group: string]: string } = {
    motion: 'G1',
    plane: 'G17',
    units: 'G21',
    distance: 'G90',
    feed_mode: 'G94',
    spindle_mode: 'G97',
    coolant: 'off',
    tool_length: 'G43',
  };

  for (const [group, state] of Object.entries(defaults)) {
    groups.set(group, { group, state, changeCount: 0, lastChangeLine: -1 });
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Motion group
    for (const [g, group] of [['G0', 'motion'], ['G1', 'motion'], ['G2', 'motion'], ['G3', 'motion'], ['G80', 'motion']] as [string, string][]) {
      if (new RegExp(`\\b${g}\\b`, 'i').test(code)) {
        const state = groups.get(group)!;
        if (state.state === g) {
          redundantCommands++;
        } else {
          state.state = g;
          state.changeCount++;
          state.lastChangeLine = i;
        }
      }
    }

    // Plane group
    for (const [g, group] of [['G17', 'plane'], ['G18', 'plane'], ['G19', 'plane']] as [string, string][]) {
      if (new RegExp(`\\b${g}\\b`, 'i').test(code)) {
        const state = groups.get(group)!;
        if (state.state === g) redundantCommands++;
        else { state.state = g; state.changeCount++; state.lastChangeLine = i; }
      }
    }

    // Units group
    for (const [g, group] of [['G20', 'units'], ['G21', 'units']] as [string, string][]) {
      if (new RegExp(`\\b${g}\\b`, 'i').test(code)) {
        const state = groups.get(group)!;
        if (state.state === g) redundantCommands++;
        else { state.state = g; state.changeCount++; state.lastChangeLine = i; }
      }
    }

    // Distance mode
    for (const [g, group] of [['G90', 'distance'], ['G91', 'distance']] as [string, string][]) {
      if (new RegExp(`\\b${g}\\b`, 'i').test(code)) {
        const state = groups.get(group)!;
        if (state.state === g) redundantCommands++;
        else { state.state = g; state.changeCount++; state.lastChangeLine = i; }
      }
    }

    // Coolant
    if (/\bM7\b/i.test(code) || /\bM8\b/i.test(code)) {
      const state = groups.get('coolant')!;
      if (state.state === 'on') redundantCommands++;
      else { state.state = 'on'; state.changeCount++; state.lastChangeLine = i; }
    }
    if (/\bM9\b/i.test(code)) {
      const state = groups.get('coolant')!;
      if (state.state === 'off') redundantCommands++;
      else { state.state = 'off'; state.changeCount++; state.lastChangeLine = i; }
    }
  }

  const groupList = Array.from(groups.values());
  const totalChanges = groupList.reduce((s, g) => s + g.changeCount, 0);
  const modalScore = Math.max(0, 100 - redundantCommands * 2);

  const recommendations: string[] = [];
  if (redundantCommands > 10) {
    recommendations.push(`${redundantCommands} redundant modal commands — remove for cleaner code`);
  }
  for (const g of groupList) {
    if (g.changeCount > 0) {
      recommendations.push(`${g.group}: ${g.state} (${g.changeCount} changes)`);
    }
  }
  if (modalScore > 90) {
    recommendations.push('Efficient modal usage — minimal redundant commands');
  }

  return { groups: groupList, totalChanges, redundantCommands, modalScore, recommendations };
}

// ── 7. CNC Feed Rate Override Simulator ──

export interface FeedOverrideResult {
  /** Original feed rate */
  originalFeedRate: number;
  /** Override percentage */
  overridePercentage: number;
  /** Adjusted feed rate */
  adjustedFeedRate: number;
  /** Original time in seconds */
  originalTime: number;
  /** Adjusted time in seconds */
  adjustedTime: number;
  /** Time saved in seconds */
  timeSaved: number;
  /** Time saved percentage */
  timeSavedPercentage: number;
  /** Quality impact score (0-100, lower is better) */
  qualityImpact: number;
  /** Whether override is safe */
  safe: boolean;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Simulate feed rate override effects.
 * Shows how a feed rate override affects time and quality.
 *
 * @param lines G-code lines
 * @param overridePercentage Override percentage (default 120 = 20% faster)
 * @param maxSafeOverride Maximum safe override percentage (default 150)
 */
export function simulateFeedRateOverride(
  lines: string[],
  overridePercentage: number = 120,
  maxSafeOverride: number = 150,
): FeedOverrideResult {
  let feedRate = 0;
  let prevX = 0, prevY = 0, prevZ = 0;
  let originalTime = 0;
  let cuttingDistance = 0;
  let travelDistance = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

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
    if (dist > 0 && feedRate > 0) {
      originalTime += dist / (feedRate / 60);
      if (z < 0) cuttingDistance += dist;
      else travelDistance += dist;
    }

    prevX = x; prevY = y; prevZ = z;
  }

  const overrideFactor = overridePercentage / 100;
  const adjustedFeedRate = feedRate * overrideFactor;
  const adjustedTime = originalTime / overrideFactor;
  const timeSaved = originalTime - adjustedTime;
  const timeSavedPercentage = originalTime > 0 ? (timeSaved / originalTime) * 100 : 0;

  // Quality impact: higher override = more impact
  const qualityImpact = Math.max(0, (overridePercentage - 100) * 1.5);
  const safe = overridePercentage <= maxSafeOverride && qualityImpact < 75;

  const recommendations: string[] = [];
  recommendations.push(`${overridePercentage}% feed override: ${timeSaved.toFixed(1)}s saved (${timeSavedPercentage.toFixed(1)}%)`);
  if (!safe) {
    recommendations.push(`Override exceeds safe limit (${maxSafeOverride}%) — quality at risk`);
  }
  if (qualityImpact > 50) {
    recommendations.push(`High quality impact (${qualityImpact.toFixed(0)}/100) — reduce override`);
  }
  if (cuttingDistance > 0 && overridePercentage > 130) {
    recommendations.push('High override on cutting moves — surface finish may degrade');
  }
  if (safe && qualityImpact < 30) {
    recommendations.push('Safe override — minimal quality impact');
  }

  return {
    originalFeedRate: feedRate, overridePercentage, adjustedFeedRate,
    originalTime, adjustedTime, timeSaved, timeSavedPercentage,
    qualityImpact, safe, recommendations,
  };
}

// ── 8. Print Cooling Fan Curve Analyzer ──

export interface FanCurvePoint {
  /** Layer number */
  layer: number;
  /** Z height */
  zHeight: number;
  /** Fan speed (0-255) */
  fanSpeed: number;
  /** Fan percentage */
  fanPercentage: number;
}

export interface FanCurveResult {
  /** Fan curve data points */
  points: FanCurvePoint[];
  /** Number of fan speed changes */
  changeCount: number;
  /** Max fan speed */
  maxFanSpeed: number;
  /** Average fan speed */
  avgFanSpeed: number;
  /** Fan-off layer count (first layers) */
  fanOffLayers: number;
  /** Fan curve smoothness score (0-100) */
  smoothnessScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze cooling fan speed curve over layers.
 * Tracks fan speed changes and evaluates curve quality.
 *
 * @param lines G-code lines
 */
export function analyzeFanCurve(lines: string[]): FanCurveResult {
  const points: FanCurvePoint[] = [];
  let fanSpeed = 0;
  let currentZ = 0;
  let layerNum = 0;
  let firstZ = 0;
  let changeCount = 0;
  let prevFanSpeed = 0;
  let fanOffLayers = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Track fan
    if (/\bM106\b/i.test(code)) {
      const sMatch = code.match(/\bS(\d*\.?\d+)/i);
      const newSpeed = sMatch ? parseFloat(sMatch[1]) : 255;
      if (newSpeed !== prevFanSpeed) {
        changeCount++;
        prevFanSpeed = newSpeed;
      }
      fanSpeed = newSpeed;
    }
    if (/\bM107\b/i.test(code)) {
      if (prevFanSpeed !== 0) {
        changeCount++;
        prevFanSpeed = 0;
      }
      fanSpeed = 0;
    }

    // Track layers
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    if (zMatch) {
      const z = parseFloat(zMatch[1]);
      if (firstZ === 0) firstZ = z;
      if (z > currentZ + 0.01) {
        layerNum++;
        currentZ = z;
        const fanPercentage = (fanSpeed / 255) * 100;
        points.push({ layer: layerNum, zHeight: z, fanSpeed, fanPercentage });
        if (fanSpeed === 0) fanOffLayers++;
      }
    }
  }

  const fanSpeeds = points.map(p => p.fanSpeed);
  const maxFanSpeed = fanSpeeds.length > 0 ? Math.max(...fanSpeeds) : 0;
  const avgFanSpeed = fanSpeeds.length > 0 ? fanSpeeds.reduce((a, b) => a + b, 0) / fanSpeeds.length : 0;

  // Smoothness: fewer changes = smoother
  const smoothnessScore = points.length > 0
    ? Math.max(0, 100 - (changeCount / points.length) * 50)
    : 100;

  const recommendations: string[] = [];
  if (fanOffLayers < 2) {
    recommendations.push(`Fan on from layer 1 — disable fan for first 2-3 layers for adhesion`);
  }
  if (changeCount > 20) {
    recommendations.push(`${changeCount} fan speed changes — smooth curve for consistent cooling`);
  }
  if (maxFanSpeed === 255 && avgFanSpeed < 128) {
    recommendations.push('Fan mostly low with max bursts — consider gradual ramping');
  }
  if (smoothnessScore > 80) {
    recommendations.push('Smooth fan curve — consistent cooling');
  }
  if (points.length === 0) {
    recommendations.push('No fan speed changes detected — check cooling settings');
  }

  return {
    points, changeCount, maxFanSpeed, avgFanSpeed,
    fanOffLayers, smoothnessScore, recommendations,
  };
}

// ── 9. G-code Subprogram Complexity Analyzer ──

export interface SubprogramComplexity {
  /** Subprogram name/number */
  name: string;
  /** Line count */
  lineCount: number;
  /** Motion count */
  motionCount: number;
  /** Nesting depth */
  nestingDepth: number;
  /** Call count */
  callCount: number;
  /** Complexity score (0-100) */
  complexityScore: number;
  /** Parameter count */
  parameterCount: number;
}

export interface SubprogramComplexityResult {
  /** All subprograms */
  subprograms: SubprogramComplexity[];
  /** Total subprograms */
  subprogramCount: number;
  /** Most complex subprogram */
  mostComplex: SubprogramComplexity | null;
  /** Average complexity */
  avgComplexity: number;
  /** Total call count */
  totalCalls: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze subprogram complexity.
 * Evaluates O-code subprograms and macros for complexity.
 *
 * @param lines G-code lines
 */
export function analyzeSubprogramComplexity(lines: string[]): SubprogramComplexityResult {
  const subMap = new Map<string, SubprogramComplexity>();
  let currentSub: string | null = null;
  let currentLineCount = 0;
  let currentMotionCount = 0;
  let nestingDepth = 0;
  let maxNesting = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Subprogram definition (O-code)
    const oMatch = code.match(/\bO(\d+)\b/i);
    if (oMatch && !/\bM98\b/i.test(code)) {
      // Start of subprogram
      currentSub = `O${oMatch[1]}`;
      currentLineCount = 0;
      currentMotionCount = 0;
      if (!subMap.has(currentSub)) {
        subMap.set(currentSub, {
          name: currentSub, lineCount: 0, motionCount: 0,
          nestingDepth: 0, callCount: 0, complexityScore: 0, parameterCount: 0,
        });
      }
    }

    // Subprogram call (M98 P..)
    const m98Match = code.match(/\bM98\b/i) && code.match(/\bP(\d+)\b/i);
    if (m98Match) {
      const calledSub = `O${m98Match[1]}`;
      if (!subMap.has(calledSub)) {
        subMap.set(calledSub, {
          name: calledSub, lineCount: 0, motionCount: 0,
          nestingDepth: 0, callCount: 0, complexityScore: 0, parameterCount: 0,
        });
      }
      subMap.get(calledSub)!.callCount++;
      if (currentSub) {
        nestingDepth++;
        maxNesting = Math.max(maxNesting, nestingDepth);
      }
    }

    // Subprogram end (M99)
    if (/\bM99\b/i.test(code)) {
      if (currentSub) {
        const sub = subMap.get(currentSub)!;
        sub.lineCount = currentLineCount;
        sub.motionCount = currentMotionCount;
        sub.nestingDepth = maxNesting;
        sub.complexityScore = Math.min(100,
          currentLineCount * 0.5 + currentMotionCount * 0.3 + maxNesting * 10);
      }
      currentSub = null;
      nestingDepth = 0;
      maxNesting = 0;
    }

    if (currentSub) {
      currentLineCount++;
      if (/\bG[01]\b/i.test(code)) currentMotionCount++;
    }
  }

  const subprograms = Array.from(subMap.values());
  const subprogramCount = subprograms.length;
  const mostComplex = subprograms.length > 0
    ? subprograms.reduce((max, s) => s.complexityScore > max.complexityScore ? s : max, subprograms[0])
    : null;
  const avgComplexity = subprograms.length > 0
    ? subprograms.reduce((s, sub) => s + sub.complexityScore, 0) / subprograms.length : 0;
  const totalCalls = subprograms.reduce((s, sub) => s + sub.callCount, 0);

  const recommendations: string[] = [];
  if (mostComplex) {
    recommendations.push(`Most complex: ${mostComplex.name} (score ${mostComplex.complexityScore.toFixed(0)})`);
  }
  if (totalCalls > 0) {
    recommendations.push(`${totalCalls} subprogram calls across ${subprogramCount} subprograms`);
  }
  for (const s of subprograms.slice(0, 3)) {
    recommendations.push(`${s.name}: ${s.lineCount} lines, ${s.motionCount} moves, ${s.callCount} calls`);
  }
  if (subprogramCount === 0) {
    recommendations.push('No subprograms detected — consider using subprograms for repeated operations');
  }

  return { subprograms, subprogramCount, mostComplex, avgComplexity, totalCalls, recommendations };
}

// ── 10. CNC Tool Path Direction Reversal Counter ──

export interface ReversalPoint {
  /** Line number */
  line: number;
  /** Position */
  position: { x: number; y: number };
  /** Previous direction */
  prevDirection: { dx: number; dy: number };
  /** New direction */
  newDirection: { dx: number; dy: number };
  /** Reversal angle in degrees */
  reversalAngle: number;
}

export interface ReversalResult {
  /** Reversal points */
  points: ReversalPoint[];
  /** Total reversal count */
  reversalCount: number;
  /** Reversals per 100mm */
  reversalsPer100mm: number;
  /** Average reversal angle */
  avgReversalAngle: number;
  /** Max reversal angle */
  maxReversalAngle: number;
  /** Smoothness score (0-100, higher is better) */
  smoothnessScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Count direction reversals in the toolpath.
 * Frequent reversals indicate inefficient toolpath strategy.
 *
 * @param lines G-code lines
 * @param reversalThreshold Angle threshold for reversal in degrees (default 120)
 */
export function countDirectionReversals(
  lines: string[],
  reversalThreshold: number = 120,
): ReversalResult {
  const points: ReversalPoint[] = [];
  let prevX = 0, prevY = 0;
  let prevDir: { dx: number; dy: number } | null = null;
  let totalDistance = 0;

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
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 0.1) {
      totalDistance += dist;
      const newDir = { dx: dx / dist, dy: dy / dist };

      if (prevDir) {
        const dot = prevDir.dx * newDir.dx + prevDir.dy * newDir.dy;
        const angle = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;

        if (angle > reversalThreshold) {
          points.push({
            line: i, position: { x, y },
            prevDirection: prevDir, newDirection: newDir,
            reversalAngle: angle,
          });
        }
      }

      prevDir = newDir;
    }

    prevX = x; prevY = y;
  }

  const reversalCount = points.length;
  const reversalsPer100mm = totalDistance > 0 ? (reversalCount / totalDistance) * 100 : 0;
  const angles = points.map(p => p.reversalAngle);
  const avgReversalAngle = angles.length > 0 ? angles.reduce((a, b) => a + b, 0) / angles.length : 0;
  const maxReversalAngle = angles.length > 0 ? Math.max(...angles) : 0;
  const smoothnessScore = Math.max(0, 100 - reversalsPer100mm * 10);

  const recommendations: string[] = [];
  if (reversalsPer100mm > 5) {
    recommendations.push(`${reversalsPer100mm.toFixed(1)} reversals/100mm — optimize toolpath strategy`);
  }
  if (reversalCount > 50) {
    recommendations.push(`${reversalCount} direction reversals — consider climb milling`);
  }
  if (maxReversalAngle > 170) {
    recommendations.push(`Full reversal (${maxReversalAngle.toFixed(0)}°) detected — high tool wear`);
  }
  if (smoothnessScore > 80) {
    recommendations.push('Smooth toolpath — few direction reversals');
  }

  return {
    points, reversalCount, reversalsPer100mm, avgReversalAngle,
    maxReversalAngle, smoothnessScore, recommendations,
  };
}

// ── 11. Print Z-seam Alignment Optimizer ──

export interface SeamPosition {
  /** Layer number */
  layer: number;
  /** X position */
  x: number;
  /** Y position */
  y: number;
  /** Z height */
  z: number;
}

export interface SeamOptimizationResult {
  /** Seam positions per layer */
  positions: SeamPosition[];
  /** Alignment consistency score (0-100) */
  alignmentScore: number;
  /** Seam spread in mm */
  seamSpread: number;
  /** Recommended alignment */
  recommendedAlignment: 'aligned' | 'random' | 'back' | 'sharpest';
  /** Seam visibility score (0-100, lower is better) */
  visibilityScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Optimize Z-seam alignment.
 * Analyzes current seam positions and recommends alignment strategy.
 *
 * @param lines G-code lines
 */
export function optimizeZSeamAlignment(lines: string[]): SeamOptimizationResult {
  const positions: SeamPosition[] = [];
  let prevX = 0, prevY = 0, prevE = 0;
  let currentZ = 0;
  let layerNum = 0;
  let firstZ = 0;
  let layerStartPos: { x: number; y: number } | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    if (zMatch) {
      const z = parseFloat(zMatch[1]);
      if (firstZ === 0) firstZ = z;
      if (z > currentZ + 0.01) {
        // Layer change — record seam (last extrusion position of previous layer)
        if (layerStartPos) {
          positions.push({
            layer: layerNum, x: layerStartPos.x, y: layerStartPos.y, z: currentZ,
          });
        }
        layerNum++;
        currentZ = z;
        layerStartPos = null;
      }
    }

    if (!/\bG1\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const e = eMatch ? parseFloat(eMatch[1]) : prevE;

    if (e > prevE && !layerStartPos) {
      layerStartPos = { x, y };
    }

    prevX = x; prevY = y; prevE = e;
  }

  // Record last layer
  if (layerStartPos) {
    positions.push({ layer: layerNum, x: layerStartPos.x, y: layerStartPos.y, z: currentZ });
  }

  // Compute alignment
  const xs = positions.map(p => p.x);
  const ys = positions.map(p => p.y);
  const avgX = xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  const avgY = ys.length > 0 ? ys.reduce((a, b) => a + b, 0) / ys.length : 0;

  const spreads = positions.map(p => Math.sqrt((p.x - avgX) ** 2 + (p.y - avgY) ** 2));
  const seamSpread = spreads.length > 0 ? Math.max(...spreads) : 0;

  // Alignment score: lower spread = better alignment
  const alignmentScore = Math.max(0, 100 - seamSpread * 10);

  // Visibility: aligned seams are more visible but cleaner
  const visibilityScore = Math.min(100, seamSpread * 5);

  let recommendedAlignment: SeamOptimizationResult['recommendedAlignment'];
  if (seamSpread < 2) recommendedAlignment = 'aligned';
  else if (seamSpread < 10) recommendedAlignment = 'back';
  else if (seamSpread < 30) recommendedAlignment = 'sharpest';
  else recommendedAlignment = 'random';

  const recommendations: string[] = [];
  if (seamSpread > 20) {
    recommendations.push(`Seam spread ${seamSpread.toFixed(1)}mm — use ${recommendedAlignment} alignment for cleaner seams`);
  }
  if (alignmentScore > 80) {
    recommendations.push('Well-aligned Z-seam — consistent position across layers');
  }
  if (positions.length > 0) {
    recommendations.push(`${positions.length} seam positions, avg (${avgX.toFixed(1)}, ${avgY.toFixed(1)})`);
  }
  if (positions.length === 0) {
    recommendations.push('No seam positions detected — check layer transitions');
  }

  return {
    positions, alignmentScore, seamSpread,
    recommendedAlignment, visibilityScore, recommendations,
  };
}

// ── 12. G-code Execution Risk Assessment ──

export interface RiskFactor {
  /** Factor name */
  name: string;
  /** Risk level */
  level: 'low' | 'medium' | 'high';
  /** Score contribution */
  score: number;
  /** Description */
  description: string;
}

export interface ExecutionRiskResult {
  /** All risk factors */
  factors: RiskFactor[];
  /** Overall risk score (0-100, lower is better) */
  overallRiskScore: number;
  /** Risk level */
  riskLevel: 'low' | 'medium' | 'high';
  /** High-risk factor count */
  highRiskCount: number;
  /** Safe to execute */
  safeToExecute: boolean;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Perform overall execution risk assessment.
 * Combines multiple risk factors into a comprehensive risk score.
 *
 * @param lines G-code lines
 */
export function assessExecutionRisk(lines: string[]): ExecutionRiskResult {
  const factors: RiskFactor[] = [];
  let hasHoming = false;
  let hasSpindleOn = false;
  let hasToolChange = false;
  let maxZ = 0;
  let minZ = 0;
  let maxFeedRate = 0;
  let maxRpm = 0;
  let rapidIntoMaterial = false;
  let lineCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;
    lineCount++;

    if (/\bG28\b/i.test(code)) hasHoming = true;
    if (/\bM3\b/i.test(code) || /\bM03\b/i.test(code)) hasSpindleOn = true;
    if (/\bM6\b/i.test(code) || /\bM06\b/i.test(code)) hasToolChange = true;

    const sMatch = code.match(/\bS(\d*\.?\d+)/i);
    if (sMatch) maxRpm = Math.max(maxRpm, parseFloat(sMatch[1]));

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) maxFeedRate = Math.max(maxFeedRate, parseFloat(fMatch[1]));

    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    if (zMatch) {
      const z = parseFloat(zMatch[1]);
      maxZ = Math.max(maxZ, z);
      minZ = Math.min(minZ, z);
    }

    // Rapid into material
    if (/\bG0\b/i.test(code) && zMatch && parseFloat(zMatch[1]) < 0) {
      rapidIntoMaterial = true;
    }
  }

  // Evaluate risk factors
  if (!hasHoming) {
    factors.push({ name: 'no_homing', level: 'high', score: 25, description: 'No homing (G28) before motion' });
  }
  if (!hasSpindleOn && minZ < 0) {
    factors.push({ name: 'no_spindle', level: 'high', score: 25, description: 'Cutting without spindle on' });
  }
  if (rapidIntoMaterial) {
    factors.push({ name: 'rapid_into_material', level: 'high', score: 20, description: 'Rapid move into material' });
  }
  if (maxFeedRate > 10000) {
    factors.push({ name: 'high_feed', level: 'medium', score: 10, description: `High feed rate (${maxFeedRate}mm/min)` });
  }
  if (maxRpm > 20000) {
    factors.push({ name: 'high_rpm', level: 'medium', score: 10, description: `High RPM (${maxRpm})` });
  }
  if (Math.abs(minZ) > 50) {
    factors.push({ name: 'deep_cut', level: 'medium', score: 10, description: `Deep cut (Z=${minZ}mm)` });
  }
  if (lineCount > 100000) {
    factors.push({ name: 'large_file', level: 'low', score: 5, description: `Large file (${lineCount} lines)` });
  }
  if (!hasToolChange && minZ < 0) {
    factors.push({ name: 'no_tool', level: 'low', score: 5, description: 'Cutting without tool change' });
  }

  const overallRiskScore = factors.reduce((s, f) => s + f.score, 0);
  const riskLevel = overallRiskScore > 50 ? 'high' : overallRiskScore > 20 ? 'medium' : 'low';
  const highRiskCount = factors.filter(f => f.level === 'high').length;
  const safeToExecute = highRiskCount === 0;

  const recommendations: string[] = [];
  for (const f of factors.filter(f => f.level === 'high')) {
    recommendations.push(`HIGH RISK: ${f.description} — fix before execution`);
  }
  for (const f of factors.filter(f => f.level === 'medium')) {
    recommendations.push(`MEDIUM: ${f.description}`);
  }
  if (safeToExecute) {
    recommendations.push('G-code is safe to execute — no high-risk factors');
  } else {
    recommendations.push(`NOT SAFE — ${highRiskCount} high-risk factors must be resolved`);
  }
  recommendations.push(`Overall risk score: ${overallRiskScore}/100 (${riskLevel})`);

  return {
    factors, overallRiskScore, riskLevel, highRiskCount,
    safeToExecute, recommendations,
  };
}
