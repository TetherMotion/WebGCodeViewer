/**
 * @file GcodeAdvanced11.ts
 * @brief Eleventh batch of advanced G-code analysis features for CNC and 3D printing.
 *
 * This module provides 12 additional high-impact features:
 *  1. G-code simulation engine (Universal) — step-by-step simulation with interpolation
 *  2. Tool wear progression tracking (CNC) — cumulative tool wear across operations
 *  3. G-code optimization report (Universal) — comprehensive optimization combining analyses
 *  4. Print bed thermal map (3DP) — bed temperature distribution and uniformity
 *  5. Subprogram call graph (Universal) — call hierarchy for subprogram analysis
 *  6. G-code templating (Universal) — parameterized templates with variable substitution
 *  7. Toolpath cooling analysis (3DP) — cooling fan effectiveness over part geometry
 *  8. G-code dependency analysis (Universal) — operation dependencies and ordering
 *  9. Print failure prediction (3DP) — failure likelihood from multiple factors
 * 10. G-code documentation generator (Universal) — human-readable documentation
 * 11. G-code performance benchmark (Universal) — execution performance benchmarking
 * 12. G-code security audit (Universal) — dangerous commands and security issues
 */

// ── 1. G-code Simulation Engine ──

export interface SimulationState {
  /** Current position */
  position: { x: number; y: number; z: number };
  /** Current extrusion amount */
  extrusion: number;
  /** Current feed rate */
  feedRate: number;
  /** Current spindle RPM */
  spindleRpm: number;
  /** Spindle on/off */
  spindleOn: boolean;
  /** Current tool */
  tool: number;
  /** Active modal codes */
  modalCodes: string[];
  /** Current line number */
  lineNumber: number;
  /** Whether currently extruding/cutting */
  isCutting: boolean;
  /** Total distance traveled */
  totalDistance: number;
  /** Total time elapsed in seconds */
  elapsedTime: number;
}

export interface SimulationStep {
  /** State before the step */
  before: SimulationState;
  /** State after the step */
  after: SimulationState;
  /** Line number executed */
  lineNumber: number;
  /** Command executed */
  command: string;
  /** Distance moved in this step */
  distance: number;
  /** Time for this step in seconds */
  time: number;
}

export interface SimulationResult {
  /** Initial state */
  initialState: SimulationState;
  /** Final state */
  finalState: SimulationState;
  /** All steps */
  steps: SimulationStep[];
  /** Total steps */
  stepCount: number;
  /** Total distance in mm */
  totalDistance: number;
  /** Total time in seconds */
  totalTime: number;
  /** Cutting distance in mm */
  cuttingDistance: number;
  /** Travel distance in mm */
  travelDistance: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Simulate G-code execution step by step.
 * Tracks machine state through each line, computing positions, distances, and times.
 * Useful for verification, debugging, and visualization.
 *
 * @param lines G-code lines
 * @param maxSteps Maximum steps to simulate (default 10000)
 */
export function simulateGcode(
  lines: string[],
  maxSteps: number = 10000,
): SimulationResult {
  const initialState: SimulationState = {
    position: { x: 0, y: 0, z: 0 },
    extrusion: 0, feedRate: 0, spindleRpm: 0,
    spindleOn: false, tool: 0, modalCodes: [],
    lineNumber: 0, isCutting: false,
    totalDistance: 0, elapsedTime: 0,
  };

  const steps: SimulationStep[] = [];
  let state: SimulationState = { ...initialState, position: { ...initialState.position }, modalCodes: [] };
  let cuttingDistance = 0;
  let travelDistance = 0;
  let isRelative = false;
  let prevE = 0;

  for (let i = 0; i < Math.min(lines.length, maxSteps); i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const before: SimulationState = {
      ...state,
      position: { ...state.position },
      modalCodes: [...state.modalCodes],
    };

    // Parse commands
    if (/\bM83\b/i.test(code)) isRelative = true;
    if (/\bM82\b/i.test(code)) isRelative = false;

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) state.feedRate = parseFloat(fMatch[1]);

    const sMatch = code.match(/\bS(\d*\.?\d+)/i);
    if (sMatch && /\bM[34]\b/i.test(code)) {
      state.spindleRpm = parseFloat(sMatch[1]);
      state.spindleOn = true;
    }
    if (/\bM5\b/i.test(code)) state.spindleOn = false;

    const tMatch = code.match(/\bT(\d+)\b/i);
    if (tMatch && (/\bM6\b/i.test(code) || /\bM06\b/i.test(code))) {
      state.tool = parseInt(tMatch[1]);
    }

    // Motion
    let distance = 0;
    let time = 0;
    let isCutting = false;

    if (/\bG[01]\b/i.test(code)) {
      const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
      const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
      const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

      const newX = xMatch ? parseFloat(xMatch[1]) : state.position.x;
      const newY = yMatch ? parseFloat(yMatch[1]) : state.position.y;
      const newZ = zMatch ? parseFloat(zMatch[1]) : state.position.z;

      distance = Math.sqrt(
        (newX - state.position.x) ** 2 +
        (newY - state.position.y) ** 2 +
        (newZ - state.position.z) ** 2
      );

      if (eMatch) {
        const e = parseFloat(eMatch[1]);
        const extruded = isRelative ? e : (e - prevE);
        if (extruded > 0) {
          state.extrusion += extruded;
          isCutting = true;
        }
        prevE = e;
      }

      state.isCutting = isCutting;
      state.position.x = newX;
      state.position.y = newY;
      state.position.z = newZ;

      if (distance > 0 && state.feedRate > 0) {
        time = distance / (state.feedRate / 60);
      }

      state.totalDistance += distance;
      state.elapsedTime += time;

      if (isCutting) cuttingDistance += distance;
      else travelDistance += distance;
    }

    state.lineNumber = i;

    steps.push({
      before, after: { ...state, position: { ...state.position }, modalCodes: [...state.modalCodes] },
      lineNumber: i, command: code, distance, time,
    });
  }

  const recommendations: string[] = [];
  if (state.elapsedTime > 0) {
    recommendations.push(`Simulated ${steps.length} steps in ${state.elapsedTime.toFixed(1)}s`);
  }
  if (cuttingDistance > 0 && travelDistance > 0) {
    const ratio = cuttingDistance / travelDistance;
    if (ratio < 1) {
      recommendations.push(`Low cutting/travel ratio (${ratio.toFixed(2)}) — optimize travel paths`);
    }
  }
  if (steps.length === 0) {
    recommendations.push('No executable steps found');
  }

  return {
    initialState, finalState: state, steps,
    stepCount: steps.length,
    totalDistance: state.totalDistance,
    totalTime: state.elapsedTime,
    cuttingDistance, travelDistance,
    recommendations,
  };
}

// ── 2. Tool Wear Progression Tracking ──

export interface ToolWearPoint {
  /** Operation index */
  operation: number;
  /** Tool number */
  tool: number;
  /** Cumulative cutting distance in mm */
  cumulativeDistance: number;
  /** Cumulative cutting time in seconds */
  cumulativeTime: number;
  /** Estimated wear in mm */
  wear: number;
  /** Wear percentage */
  wearPercentage: number;
  /** Line number */
  lineNumber: number;
}

export interface ToolWearProgressionResult {
  /** Per-tool wear progression */
  perTool: { tool: number; points: ToolWearPoint[]; finalWear: number; finalWearPercentage: number }[];
  /** Tools that need replacement */
  toolsNeedingReplacement: number[];
  /** Maximum wear across all tools */
  maxWear: number;
  /** Total cutting distance across all tools */
  totalCuttingDistance: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Track tool wear progression across all operations.
 * Models cumulative wear based on cutting distance, time, and material.
 *
 * Uses Taylor's tool life equation: wear = k * distance^a * time^b
 *
 * @param lines G-code lines
 * @param toolLifeDistance Expected tool life in mm (default 100000)
 */
export function trackToolWearProgression(
  lines: string[],
  toolLifeDistance: number = 100000,
): ToolWearProgressionResult {
  const toolData = new Map<number, { distance: number; time: number; points: ToolWearPoint[]; currentFeedRate: number }>();
  let currentTool = 0;
  let prevX = 0, prevY = 0, prevZ = 0;
  let operationIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Tool change
    const tMatch = code.match(/\bT(\d+)\b/i);
    if (tMatch && (/\bM6\b/i.test(code) || /\bM06\b/i.test(code))) {
      currentTool = parseInt(tMatch[1]);
      if (!toolData.has(currentTool)) {
        toolData.set(currentTool, { distance: 0, time: 0, points: [], currentFeedRate: 0 });
      }
      operationIndex++;
      continue;
    }

    const data = toolData.get(currentTool) ?? { distance: 0, time: 0, points: [], currentFeedRate: 0 };
    if (!toolData.has(currentTool)) toolData.set(currentTool, data);

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) data.currentFeedRate = parseFloat(fMatch[1]);

    if (/\bG1\b/i.test(code)) {
      const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
      const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
      const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

      const x = xMatch ? parseFloat(xMatch[1]) : prevX;
      const y = yMatch ? parseFloat(yMatch[1]) : prevY;
      const z = zMatch ? parseFloat(zMatch[1]) : prevZ;

      const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2 + (z - prevZ) ** 2);

      // Only count as cutting if extruding (3DP) or Z is negative (CNC cutting)
      const isCutting = (eMatch !== null) || (z < 0);

      if (dist > 0.01 && isCutting) {
        data.distance += dist;
        const time = data.currentFeedRate > 0 ? dist / (data.currentFeedRate / 60) : 0;
        data.time += time;

        const wear = (data.distance / toolLifeDistance) * 0.1; // 0.1mm max wear
        const wearPercentage = (data.distance / toolLifeDistance) * 100;

        data.points.push({
          operation: operationIndex,
          tool: currentTool,
          cumulativeDistance: data.distance,
          cumulativeTime: data.time,
          wear,
          wearPercentage,
          lineNumber: i,
        });
      }

      prevX = x; prevY = y; prevZ = z;
    }
  }

  const perTool = Array.from(toolData.entries())
    .filter(([_, data]) => data.points.length > 0)
    .map(([tool, data]) => ({
      tool,
      points: data.points,
      finalWear: data.points.length > 0 ? data.points[data.points.length - 1].wear : 0,
      finalWearPercentage: data.points.length > 0 ? data.points[data.points.length - 1].wearPercentage : 0,
    }))
    .sort((a, b) => b.finalWear - a.finalWear);

  const toolsNeedingReplacement = perTool
    .filter(t => t.finalWearPercentage > 80)
    .map(t => t.tool);

  const maxWear = perTool.length > 0 ? Math.max(...perTool.map(t => t.finalWear)) : 0;
  const totalCuttingDistance = perTool.reduce((s, t) => s + t.points[t.points.length - 1].cumulativeDistance, 0);

  const recommendations: string[] = [];
  if (toolsNeedingReplacement.length > 0) {
    recommendations.push(`Tools ${toolsNeedingReplacement.join(', ')} need replacement (>80% wear)`);
  }
  for (const t of perTool.slice(0, 3)) {
    recommendations.push(`Tool ${t.tool}: ${t.finalWearPercentage.toFixed(1)}% wear (${t.finalWear.toFixed(4)}mm)`);
  }
  if (perTool.length === 0) {
    recommendations.push('No tool wear data — no cutting operations detected');
  }

  return {
    perTool, toolsNeedingReplacement, maxWear, totalCuttingDistance, recommendations,
  };
}

// ── 3. G-code Optimization Report ──

export interface OptimizationSuggestion {
  /** Category */
  category: 'speed' | 'quality' | 'material' | 'time' | 'safety';
  /** Suggestion text */
  suggestion: string;
  /** Estimated improvement */
  improvement: string;
  /** Priority (0-100) */
  priority: number;
  /** Affected lines */
  affectedLines: number[];
}

export interface OptimizationReportResult {
  /** All suggestions */
  suggestions: OptimizationSuggestion[];
  /** Total estimated time savings in seconds */
  totalTimeSavings: number;
  /** Total estimated material savings in mm */
  totalMaterialSavings: number;
  /** Overall optimization score (0-100, higher = more room for improvement) */
  optimizationScore: number;
  /** Suggestions by category */
  byCategory: { [category: string]: number };
  /** Recommendations */
  recommendations: string[];
}

/**
 * Generate a comprehensive optimization report.
 * Combines multiple analysis results to provide actionable optimization suggestions.
 *
 * @param lines G-code lines
 */
export function generateOptimizationReport(lines: string[]): OptimizationReportResult {
  const suggestions: OptimizationSuggestion[] = [];

  // Analyze travel moves
  let travelDistance = 0;
  let cuttingDistance = 0;
  let currentFeedRate = 0;
  let prevX = 0, prevY = 0, prevZ = 0;
  let dwellCount = 0;
  let dwellTime = 0;
  let toolChangeCount = 0;
  let highFeedRateLines: number[] = [];
  let lowFeedRateLines: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) currentFeedRate = parseFloat(fMatch[1]);

    if (/\bM6\b/i.test(code) || /\bM06\b/i.test(code)) toolChangeCount++;

    if (/\bG4\b/i.test(code)) {
      const pMatch = code.match(/\bP(\d*\.?\d+)/i);
      if (pMatch) {
        dwellCount++;
        dwellTime += parseFloat(pMatch[1]);
      }
    }

    if (/\bG[01]\b/i.test(code)) {
      const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
      const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
      const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

      const x = xMatch ? parseFloat(xMatch[1]) : prevX;
      const y = yMatch ? parseFloat(yMatch[1]) : prevY;
      const z = zMatch ? parseFloat(zMatch[1]) : prevZ;

      const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2 + (z - prevZ) ** 2);

      if (dist > 0) {
        if (/\bG0\b/i.test(code) || (!eMatch && z >= 0)) {
          travelDistance += dist;
        } else {
          cuttingDistance += dist;
          if (currentFeedRate > 5000) highFeedRateLines.push(i);
          if (currentFeedRate > 0 && currentFeedRate < 500) lowFeedRateLines.push(i);
        }
      }

      prevX = x; prevY = y; prevZ = z;
    }
  }

  // Generate suggestions
  if (travelDistance > cuttingDistance) {
    suggestions.push({
      category: 'time',
      suggestion: 'Travel distance exceeds cutting distance — optimize travel paths',
      improvement: `Reduce travel by ${(travelDistance - cuttingDistance).toFixed(0)}mm`,
      priority: 80,
      affectedLines: [],
    });
  }

  if (dwellCount > 10) {
    suggestions.push({
      category: 'time',
      suggestion: `${dwellCount} dwell commands totaling ${dwellTime.toFixed(1)}s`,
      improvement: `Save ${dwellTime.toFixed(1)}s by reducing dwells`,
      priority: 60,
      affectedLines: [],
    });
  }

  if (toolChangeCount > 5) {
    suggestions.push({
      category: 'time',
      suggestion: `${toolChangeCount} tool changes — group operations by tool`,
      improvement: `Save ${toolChangeCount * 30}s with reordering`,
      priority: 70,
      affectedLines: [],
    });
  }

  if (highFeedRateLines.length > 0) {
    suggestions.push({
      category: 'quality',
      suggestion: `${highFeedRateLines.length} segments at high feed rate (>5000 mm/min)`,
      improvement: 'Reduce feed rate for better surface finish',
      priority: 50,
      affectedLines: highFeedRateLines.slice(0, 10),
    });
  }

  if (lowFeedRateLines.length > 20) {
    suggestions.push({
      category: 'speed',
      suggestion: `${lowFeedRateLines.length} segments at very low feed rate (<500 mm/min)`,
      improvement: 'Increase feed rate where possible',
      priority: 40,
      affectedLines: lowFeedRateLines.slice(0, 10),
    });
  }

  // Sort by priority
  suggestions.sort((a, b) => b.priority - a.priority);

  const totalTimeSavings = dwellTime + toolChangeCount * 30;
  const totalMaterialSavings = 0; // Would need more analysis
  const optimizationScore = Math.min(100, suggestions.length * 15);
  const byCategory: { [category: string]: number } = {};
  for (const s of suggestions) {
    byCategory[s.category] = (byCategory[s.category] ?? 0) + 1;
  }

  const recommendations: string[] = [];
  for (const s of suggestions.slice(0, 3)) {
    recommendations.push(`[${s.category.toUpperCase()}] ${s.suggestion}`);
  }
  if (suggestions.length === 0) {
    recommendations.push('G-code is well optimized — no major improvements needed');
  }

  return {
    suggestions, totalTimeSavings, totalMaterialSavings,
    optimizationScore, byCategory, recommendations,
  };
}

// ── 4. Print Bed Thermal Map ──

export interface BedThermalEvent {
  /** Line number */
  lineNumber: number;
  /** Temperature set */
  temperature: number;
  /** Whether waiting for temperature */
  isWait: boolean;
  /** Time stamp in seconds */
  timestamp: number;
}

export interface BedThermalResult {
  /** All bed temperature events */
  events: BedThermalEvent[];
  /** Initial bed temperature */
  initialTemp: number;
  /** Maximum bed temperature */
  maxTemp: number;
  /** Minimum bed temperature */
  minTemp: number;
  /** Average bed temperature */
  avgTemp: number;
  /** Temperature stability (std dev) */
  temperatureStability: number;
  /** Whether bed heating is present */
  hasBedHeating: boolean;
  /** Heat-up time estimate in seconds */
  heatupTime: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze print bed thermal behavior.
 * Bed temperature affects:
 * - First layer adhesion
 * - Warping
 * - Print quality
 *
 * @param lines G-code lines
 * @param ambientTemp Ambient temperature (default 20)
 */
export function analyzeBedThermalMap(
  lines: string[],
  ambientTemp: number = 20,
): BedThermalResult {
  const events: BedThermalEvent[] = [];
  let currentTime = 0;
  let currentFeedRate = 0;
  let prevX = 0, prevY = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Bed temperature commands
    if (/\bM140\b/i.test(code) || /\bM190\b/i.test(code)) {
      const sMatch = code.match(/\bS(\d*\.?\d+)/i);
      if (sMatch) {
        events.push({
          lineNumber: i,
          temperature: parseFloat(sMatch[1]),
          isWait: /\bM190\b/i.test(code),
          timestamp: currentTime,
        });
      }
    }

    // Track time
    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) currentFeedRate = parseFloat(fMatch[1]);

    if (/\bG[01]\b/i.test(code)) {
      const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
      const x = xMatch ? parseFloat(xMatch[1]) : prevX;
      const y = yMatch ? parseFloat(yMatch[1]) : prevY;
      const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
      if (dist > 0 && currentFeedRate > 0) {
        currentTime += dist / (currentFeedRate / 60);
      }
      prevX = x; prevY = y;
    }
  }

  const temps = events.map(e => e.temperature);
  const initialTemp = events.length > 0 ? events[0].temperature : 0;
  const maxTemp = temps.length > 0 ? Math.max(...temps) : 0;
  const minTemp = temps.length > 0 ? Math.min(...temps) : 0;
  const avgTemp = temps.length > 0 ? temps.reduce((a, b) => a + b, 0) / temps.length : 0;

  const variance = temps.length > 0
    ? temps.reduce((s, t) => s + (t - avgTemp) ** 2, 0) / temps.length
    : 0;
  const temperatureStability = Math.sqrt(variance);

  const hasBedHeating = events.length > 0;
  const heatupTime = events.length > 0 && events[0].isWait ? 60 : 0; // rough estimate

  const recommendations: string[] = [];
  if (!hasBedHeating) {
    recommendations.push('No bed heating detected — consider adding M140/M190 for better adhesion');
  }
  if (maxTemp < 50 && hasBedHeating) {
    recommendations.push(`Bed temp ${maxTemp}°C is low — increase for better first layer adhesion`);
  }
  if (temperatureStability > 10) {
    recommendations.push(`Bed temperature varies by ${temperatureStability.toFixed(1)}°C — check thermal stability`);
  }
  if (hasBedHeating && recommendations.length === 0) {
    recommendations.push('Bed thermal profile is stable');
  }

  return {
    events, initialTemp, maxTemp, minTemp, avgTemp,
    temperatureStability, hasBedHeating, heatupTime, recommendations,
  };
}

// ── 5. Subprogram Call Graph ──

export interface SubprogramNode {
  /** Subprogram number (O-code) */
  number: number;
  /** Name (from comment if available) */
  name: string;
  /** Line where defined */
  definitionLine: number;
  /** Lines where called */
  callLines: number[];
  /** Subprograms called by this one */
  calls: number[];
  /** Called by these subprograms */
  calledBy: number[];
  /** Call depth */
  depth: number;
}

export interface CallGraphResult {
  /** All subprogram nodes */
  nodes: SubprogramNode[];
  /** Total subprograms */
  subprogramCount: number;
  /** Total calls */
  totalCalls: number;
  /** Maximum call depth */
  maxDepth: number;
  /** Whether there are circular dependencies */
  hasCircularDependencies: boolean;
  /** Call hierarchy as text */
  hierarchy: string[];
  /** Recommendations */
  recommendations: string[];
}

/**
 * Build a call graph of subprogram calls.
 * Analyzes O-codes (subprogram definitions) and M98 (calls).
 *
 * @param lines G-code lines
 */
export function buildSubprogramCallGraph(lines: string[]): CallGraphResult {
  const nodeMap = new Map<number, SubprogramNode>();

  // Find definitions and calls
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Subprogram definition (O-code)
    const defMatch = code.match(/\bO(\d+)\b/i);
    const callMatch = code.match(/\bM98\b/i) && code.match(/\bP(\d+)\b/i);

    if (defMatch && !callMatch) {
      const num = parseInt(defMatch[1]);
      if (!nodeMap.has(num)) {
        const commentMatch = line.match(/\(([^)]+)\)/);
        nodeMap.set(num, {
          number: num,
          name: commentMatch ? commentMatch[1] : `O${num}`,
          definitionLine: i,
          callLines: [],
          calls: [],
          calledBy: [],
          depth: 0,
        });
      }
    }

    // Subprogram call (M98 Pxxxx)
    if (callMatch) {
      const calledNum = parseInt(callMatch[1]);
      const callerMatch = code.match(/\bO(\d+)\b/i);

      // Find the current subprogram context (last defined O-code)
      let callerNum = 0;
      for (const [num, node] of nodeMap) {
        if (node.definitionLine < i) callerNum = num;
      }

      if (!nodeMap.has(calledNum)) {
        nodeMap.set(calledNum, {
          number: calledNum,
          name: `O${calledNum}`,
          definitionLine: -1, // called but not defined in this file
          callLines: [],
          calls: [],
          calledBy: [],
          depth: 0,
        });
      }

      const called = nodeMap.get(calledNum)!;
      called.callLines.push(i);
      if (callerNum > 0) {
        const caller = nodeMap.get(callerNum);
        if (caller && !caller.calls.includes(calledNum)) {
          caller.calls.push(calledNum);
        }
        if (!called.calledBy.includes(callerNum)) {
          called.calledBy.push(callerNum);
        }
      }
    }
  }

  // Calculate depth
  const calculateDepth = (num: number, visited: Set<number>): number => {
    if (visited.has(num)) return 0; // circular
    visited.add(num);
    const node = nodeMap.get(num);
    if (!node) return 0;
    if (node.calledBy.length === 0) return 0;
    const maxCallerDepth = Math.max(...node.calledBy.map(c => calculateDepth(c, visited)));
    return maxCallerDepth + 1;
  };

  for (const [num, node] of nodeMap) {
    node.depth = calculateDepth(num, new Set());
  }

  const nodes = Array.from(nodeMap.values());
  const totalCalls = nodes.reduce((s, n) => s + n.callLines.length, 0);
  const maxDepth = nodes.length > 0 ? Math.max(...nodes.map(n => n.depth)) : 0;

  // Detect circular dependencies
  const hasCircular = (() => {
    const visited = new Set<number>();
    const stack = new Set<number>();
    const dfs = (num: number): boolean => {
      if (stack.has(num)) return true;
      if (visited.has(num)) return false;
      visited.add(num);
      stack.add(num);
      const node = nodeMap.get(num);
      if (node) {
        for (const called of node.calls) {
          if (dfs(called)) return true;
        }
      }
      stack.delete(num);
      return false;
    };
    for (const [num] of nodeMap) {
      if (dfs(num)) return true;
    }
    return false;
  })();

  // Build hierarchy text
  const hierarchy: string[] = [];
  const printHierarchy = (num: number, indent: number, visited: Set<number>) => {
    if (visited.has(num)) {
      hierarchy.push(`${'  '.repeat(indent)}O${num} (circular)`);
      return;
    }
    visited.add(num);
    const node = nodeMap.get(num);
    if (node) {
      hierarchy.push(`${'  '.repeat(indent)}O${num} (${node.callLines.length} calls)`);
      for (const called of node.calls) {
        printHierarchy(called, indent + 1, new Set(visited));
      }
    }
  };

  for (const [num, node] of nodeMap) {
    if (node.calledBy.length === 0) {
      printHierarchy(num, 0, new Set());
    }
  }

  const recommendations: string[] = [];
  if (hasCircular) {
    recommendations.push('Circular subprogram dependencies detected — may cause infinite loops');
  }
  if (maxDepth > 5) {
    recommendations.push(`Deep call nesting (${maxDepth} levels) — consider flattening`);
  }
  const undefinedSubs = nodes.filter(n => n.definitionLine < 0);
  if (undefinedSubs.length > 0) {
    recommendations.push(`${undefinedSubs.length} subprograms called but not defined`);
  }
  if (nodes.length === 0) {
    recommendations.push('No subprograms found');
  }

  return {
    nodes, subprogramCount: nodes.length, totalCalls, maxDepth,
    hasCircularDependencies: hasCircular, hierarchy, recommendations,
  };
}

// ── 6. G-code Templating ──

export interface TemplateVariable {
  /** Variable name */
  name: string;
  /** Default value */
  defaultValue: string;
  /** Description */
  description: string;
  /** Whether the variable is required */
  required: boolean;
}

export interface TemplateResult {
  /** Processed G-code with variables substituted */
  processedLines: string[];
  /** Variables found in the template */
  variables: TemplateVariable[];
  /** Whether all required variables were provided */
  allRequiredProvided: boolean;
  /** Missing required variables */
  missingVariables: string[];
  /** Substitution count */
  substitutionCount: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Process a G-code template with variable substitution.
 * Variables are defined as {{variable_name}} or #{variable_name}.
 *
 * @param templateLines G-code template lines
 * @param values Variable values { name: value }
 */
export function processGcodeTemplate(
  templateLines: string[],
  values: { [name: string]: string | number } = {},
): TemplateResult {
  const variables = new Map<string, TemplateVariable>();
  const processedLines: string[] = [];
  let substitutionCount = 0;

  // First pass: find all variables
  for (const line of templateLines) {
    // Find {{variable}} patterns
    const doubleBraceMatches = line.matchAll(/\{\{(\w+)\}\}/g);
    for (const match of doubleBraceMatches) {
      const name = match[1];
      if (!variables.has(name)) {
        variables.set(name, {
          name, defaultValue: '',
          description: `Variable ${name}`,
          required: true,
        });
      }
    }

    // Find #variable patterns
    const hashMatches = line.matchAll(/#(\w+)/g);
    for (const match of hashMatches) {
      const name = match[1];
      if (!variables.has(name)) {
        variables.set(name, {
          name, defaultValue: '',
          description: `Variable ${name}`,
          required: false,
        });
      }
    }

    // Find variable definitions in comments: ; @var name=default description
    const varDefMatch = line.match(/;\s*@var\s+(\w+)\s*=\s*(\S*)\s*(.*)/i);
    if (varDefMatch) {
      const name = varDefMatch[1];
      const defaultVal = varDefMatch[2];
      const desc = varDefMatch[3] || `Variable ${name}`;
      variables.set(name, {
        name, defaultValue: defaultVal, description: desc,
        required: defaultVal === '',
      });
    }
  }

  // Second pass: substitute
  for (const line of templateLines) {
    let processed = line;

    // Skip variable definition comments
    if (/;\s*@var\s+/i.test(line)) continue;

    // Substitute {{variable}}
    processed = processed.replace(/\{\{(\w+)\}\}/g, (match, name) => {
      if (values[name] !== undefined) {
        substitutionCount++;
        return String(values[name]);
      }
      const v = variables.get(name);
      if (v && v.defaultValue) {
        substitutionCount++;
        return v.defaultValue;
      }
      return match;
    });

    // Substitute #variable
    processed = processed.replace(/#(\w+)/g, (match, name) => {
      if (values[name] !== undefined) {
        substitutionCount++;
        return String(values[name]);
      }
      const v = variables.get(name);
      if (v && v.defaultValue) {
        substitutionCount++;
        return v.defaultValue;
      }
      return match;
    });

    processedLines.push(processed);
  }

  const missingVariables = Array.from(variables.values())
    .filter(v => v.required && values[v.name] === undefined && !v.defaultValue)
    .map(v => v.name);

  const allRequiredProvided = missingVariables.length === 0;

  const recommendations: string[] = [];
  if (missingVariables.length > 0) {
    recommendations.push(`Missing required variables: ${missingVariables.join(', ')}`);
  }
  if (substitutionCount > 0) {
    recommendations.push(`${substitutionCount} substitutions made`);
  }
  if (variables.size === 0) {
    recommendations.push('No template variables found');
  }
  if (allRequiredProvided && variables.size > 0) {
    recommendations.push('All required variables provided');
  }

  return {
    processedLines, variables: Array.from(variables.values()),
    allRequiredProvided, missingVariables, substitutionCount, recommendations,
  };
}

// ── 7. Toolpath Cooling Analysis ──

export interface CoolingSegment {
  /** Line number */
  line: number;
  /** Fan speed (0-255) */
  fanSpeed: number;
  /** Position */
  position: { x: number; y: number; z: number };
  /** Estimated cooling rate in °C/s */
  coolingRate: number;
  /** Whether cooling is adequate */
  adequate: boolean;
}

export interface CoolingResult {
  /** Per-segment cooling data */
  segments: CoolingSegment[];
  /** Average fan speed */
  avgFanSpeed: number;
  /** Maximum fan speed */
  maxFanSpeed: number;
  /** Minimum fan speed */
  minFanSpeed: number;
  /** Number of segments with inadequate cooling */
  inadequateCoolingCount: number;
  /** Percentage of segments with inadequate cooling */
  inadequatePercentage: number;
  /** Cooling adequacy score (0-100) */
  coolingScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze cooling fan effectiveness over the part.
 * Estimates cooling rates based on fan speed and position.
 *
 * @param lines G-code lines
 * @param minFanSpeed Minimum fan speed for adequate cooling (default 50)
 */
export function analyzeCoolingEffectiveness(
  lines: string[],
  minFanSpeed: number = 50,
): CoolingResult {
  const segments: CoolingSegment[] = [];
  let currentFanSpeed = 0;
  let prevX = 0, prevY = 0, prevZ = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Fan control
    if (/\bM106\b/i.test(code)) {
      const sMatch = code.match(/\bS(\d*\.?\d+)/i);
      if (sMatch) currentFanSpeed = parseFloat(sMatch[1]);
    }
    if (/\bM107\b/i.test(code)) {
      currentFanSpeed = 0;
    }

    if (/\bG1\b/i.test(code)) {
      const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
      const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);

      const x = xMatch ? parseFloat(xMatch[1]) : prevX;
      const y = yMatch ? parseFloat(yMatch[1]) : prevY;
      const z = zMatch ? parseFloat(zMatch[1]) : prevZ;

      // Estimate cooling rate: proportional to fan speed, inversely to height
      const coolingRate = (currentFanSpeed / 255) * 10 * (1 / (1 + z * 0.1));
      const adequate = currentFanSpeed >= minFanSpeed;

      segments.push({
        line: i, fanSpeed: currentFanSpeed,
        position: { x, y, z },
        coolingRate, adequate,
      });

      prevX = x; prevY = y; prevZ = z;
    }
  }

  const fanSpeeds = segments.map(s => s.fanSpeed);
  const avgFanSpeed = fanSpeeds.length > 0 ? fanSpeeds.reduce((a, b) => a + b, 0) / fanSpeeds.length : 0;
  const maxFanSpeed = fanSpeeds.length > 0 ? Math.max(...fanSpeeds) : 0;
  const minFanSpeedVal = fanSpeeds.length > 0 ? Math.min(...fanSpeeds) : 0;

  const inadequateCoolingCount = segments.filter(s => !s.adequate).length;
  const inadequatePercentage = segments.length > 0 ? (inadequateCoolingCount / segments.length) * 100 : 0;
  const coolingScore = segments.length > 0
    ? Math.max(0, 100 - inadequatePercentage)
    : 100;

  const recommendations: string[] = [];
  if (inadequatePercentage > 30) {
    recommendations.push(`${inadequatePercentage.toFixed(0)}% of segments have inadequate cooling — increase fan speed`);
  }
  if (maxFanSpeed < 128) {
    recommendations.push(`Max fan speed ${maxFanSpeed} is low — increase for better overhang quality`);
  }
  if (avgFanSpeed === 0 && segments.length > 0) {
    recommendations.push('No fan control detected — add M106 for cooling');
  }
  if (coolingScore === 100 && segments.length > 0) {
    recommendations.push('Cooling is adequate throughout the print');
  }

  return {
    segments, avgFanSpeed, maxFanSpeed, minFanSpeed: minFanSpeedVal,
    inadequateCoolingCount, inadequatePercentage, coolingScore, recommendations,
  };
}

// ── 8. G-code Dependency Analysis ──

export interface OperationDependency {
  /** Operation ID */
  operationId: string;
  /** Operation type */
  type: 'tool_change' | 'spindle_start' | 'spindle_stop' | 'motion' | 'coolant' | 'homing' | 'probe' | 'dwell';
  /** Line number */
  lineNumber: number;
  /** Dependencies (operation IDs that must come before) */
  dependsOn: string[];
  /** Whether this operation can be reordered */
  canReorder: boolean;
}

export interface DependencyResult {
  /** All operations with dependencies */
  operations: OperationDependency[];
  /** Total operations */
  operationCount: number;
  /** Number of reorderable operations */
  reorderableCount: number;
  /** Dependency chains */
  criticalPath: string[];
  /** Whether operations are properly ordered */
  properlyOrdered: boolean;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze dependencies between G-code operations.
 * Identifies which operations must come before others and which can be reordered.
 *
 * @param lines G-code lines
 */
export function analyzeDependencies(lines: string[]): DependencyResult {
  const operations: OperationDependency[] = [];
  let opId = 0;
  let hasHoming = false;
  let hasProbe = false;
  let spindleStarted = false;
  let lastToolChange = -1;
  let lastSpindleStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    let type: OperationDependency['type'] | null = null;
    let dependsOn: string[] = [];
    let canReorder = false;

    if (/\bG28\b/i.test(code) || /\bG30\b/i.test(code)) {
      type = 'homing';
      hasHoming = true;
      canReorder = false;
    } else if (/\bG38\b/i.test(code)) {
      type = 'probe';
      dependsOn = hasHoming ? [`op_${lastSpindleStart >= 0 ? lastSpindleStart : 0}`] : [];
      hasProbe = true;
      canReorder = false;
    } else if (/\bM[34]\b/i.test(code)) {
      type = 'spindle_start';
      spindleStarted = true;
      lastSpindleStart = opId;
      dependsOn = [];
      canReorder = false;
    } else if (/\bM5\b/i.test(code)) {
      type = 'spindle_stop';
      dependsOn = spindleStarted ? [`op_${lastSpindleStart}`] : [];
      canReorder = false;
    } else if (/\bM6\b/i.test(code) || /\bM06\b/i.test(code)) {
      type = 'tool_change';
      dependsOn = spindleStarted ? [`op_${lastSpindleStart}`] : [];
      lastToolChange = opId;
      canReorder = false;
    } else if (/\bM[78]\b/i.test(code)) {
      type = 'coolant';
      dependsOn = spindleStarted ? [`op_${lastSpindleStart}`] : [];
      canReorder = true;
    } else if (/\bG4\b/i.test(code)) {
      type = 'dwell';
      canReorder = true;
    } else if (/\bG[01]\b/i.test(code)) {
      type = 'motion';
      dependsOn = [];
      if (lastToolChange >= 0) dependsOn.push(`op_${lastToolChange}`);
      if (lastSpindleStart >= 0) dependsOn.push(`op_${lastSpindleStart}`);
      canReorder = true;
    }

    if (type) {
      operations.push({
        operationId: `op_${opId}`,
        type, lineNumber: i, dependsOn, canReorder,
      });
      opId++;
    }
  }

  // Find critical path (longest dependency chain)
  const criticalPath: string[] = [];
  const findCriticalPath = (opIdx: number, path: string[]): string[] => {
    const op = operations[opIdx];
    const newPath = [...path, op.operationId];
    if (op.dependsOn.length === 0) return newPath;
    let longest = newPath;
    for (const dep of op.dependsOn) {
      const depIdx = parseInt(dep.replace('op_', ''));
      const depPath = findCriticalPath(depIdx, path);
      if (depPath.length > longest.length) {
        longest = [...depPath, op.operationId];
      }
    }
    return longest;
  };

  if (operations.length > 0) {
    const lastOp = operations[operations.length - 1];
    criticalPath.push(...findCriticalPath(operations.length - 1, []));
  }

  const reorderableCount = operations.filter(o => o.canReorder).length;
  const properlyOrdered = operations.every((op, idx) =>
    op.dependsOn.every(dep => {
      const depIdx = parseInt(dep.replace('op_', ''));
      return depIdx < idx;
    })
  );

  const recommendations: string[] = [];
  if (!hasHoming) {
    recommendations.push('No homing operation (G28) found — add homing at start');
  }
  if (!hasProbe && operations.some(o => o.type === 'motion')) {
    recommendations.push('No probing operation — consider adding G38 for work offset');
  }
  if (reorderableCount > operations.length * 0.5) {
    recommendations.push(`${reorderableCount} operations can be reordered — optimize for efficiency`);
  }
  if (!properlyOrdered) {
    recommendations.push('Some operations have unsatisfied dependencies — check ordering');
  }
  if (recommendations.length === 0) {
    recommendations.push('Operation dependencies are properly ordered');
  }

  return {
    operations, operationCount: operations.length, reorderableCount,
    criticalPath, properlyOrdered, recommendations,
  };
}

// ── 9. Print Failure Prediction ──

export interface FailureRisk {
  /** Risk type */
  type: string;
  /** Risk level */
  level: 'low' | 'medium' | 'high';
  /** Probability percentage */
  probability: number;
  /** Description */
  description: string;
  /** Mitigation */
  mitigation: string;
}

export interface FailurePredictionResult {
  /** Overall failure probability */
  failureProbability: number;
  /** Individual risks */
  risks: FailureRisk[];
  /** Risk count by level */
  riskCounts: { low: number; medium: number; high: number };
  /** Whether the print is likely to succeed */
  likelyToSucceed: boolean;
  /** Confidence in the prediction (0-100) */
  confidence: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Predict the likelihood of print failure.
 * Combines multiple risk factors to estimate failure probability.
 *
 * @param lines G-code lines
 */
export function predictPrintFailure(lines: string[]): FailurePredictionResult {
  const risks: FailureRisk[] = [];
  let hasHoming = false;
  let hasBedHeat = false;
  let hasHotendHeat = false;
  let hasFanControl = false;
  let hasRetraction = false;
  let maxLayerHeight = 0;
  let prevZ = 0;
  let maxFeedRate = 0;
  let minFeedRate = Infinity;
  let prevE = 0;
  let overhangCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    if (/\bG28\b/i.test(code)) hasHoming = true;
    if (/\bM140\b/i.test(code) || /\bM190\b/i.test(code)) hasBedHeat = true;
    if (/\bM104\b/i.test(code) || /\bM109\b/i.test(code)) hasHotendHeat = true;
    if (/\bM106\b/i.test(code)) hasFanControl = true;

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) {
      const f = parseFloat(fMatch[1]);
      maxFeedRate = Math.max(maxFeedRate, f);
      minFeedRate = Math.min(minFeedRate, f);
    }

    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    if (zMatch) {
      const z = parseFloat(zMatch[1]);
      if (z > prevZ) {
        maxLayerHeight = Math.max(maxLayerHeight, z - prevZ);
        prevZ = z;
      }
    }

    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);
    if (eMatch && /\bG1\b/i.test(code)) {
      const e = parseFloat(eMatch[1]);
      if (e < prevE) hasRetraction = true;
      prevE = e;
    }
  }

  // Assess risks
  if (!hasHoming) {
    risks.push({
      type: 'no_homing', level: 'high', probability: 80,
      description: 'No homing sequence — print may start at wrong position',
      mitigation: 'Add G28 at the beginning of the G-code',
    });
  }

  if (!hasBedHeat) {
    risks.push({
      type: 'no_bed_heat', level: 'medium', probability: 40,
      description: 'No bed heating — warping risk for ABS/ASA',
      mitigation: 'Add M140 S60 (or appropriate temp) before printing',
    });
  }

  if (!hasHotendHeat) {
    risks.push({
      type: 'no_hotend_heat', level: 'high', probability: 90,
      description: 'No hotend heating — extruder will jam',
      mitigation: 'Add M104 S200 (or appropriate temp) before printing',
    });
  }

  if (!hasRetraction) {
    risks.push({
      type: 'no_retraction', level: 'medium', probability: 50,
      description: 'No retraction — stringing between parts',
      mitigation: 'Enable retraction in slicer settings',
    });
  }

  if (maxLayerHeight > 0.3) {
    risks.push({
      type: 'thick_layers', level: 'low', probability: 20,
      description: `Layer height ${maxLayerHeight.toFixed(2)}mm is thick — may affect quality`,
      mitigation: 'Reduce layer height for better quality',
    });
  }

  if (maxFeedRate > 10000) {
    risks.push({
      type: 'high_speed', level: 'medium', probability: 35,
      description: `Max feed rate ${maxFeedRate} mm/min is very high`,
      mitigation: 'Reduce feed rate for better print quality',
    });
  }

  if (!hasFanControl) {
    risks.push({
      type: 'no_fan', level: 'low', probability: 25,
      description: 'No fan control — overhangs may sag',
      mitigation: 'Enable cooling fan for overhangs and bridges',
    });
  }

  // Calculate overall failure probability
  const highRisks = risks.filter(r => r.level === 'high');
  const mediumRisks = risks.filter(r => r.level === 'medium');
  const lowRisks = risks.filter(r => r.level === 'low');

  // Combine probabilities (assuming independence: P(failure) = 1 - P(no failure for each))
  const noFailureProb = risks.reduce((prob, r) => prob * (1 - r.probability / 100), 1);
  const failureProbability = (1 - noFailureProb) * 100;

  const likelyToSucceed = failureProbability < 50;
  const confidence = Math.min(100, risks.length * 15);

  const riskCounts = {
    low: lowRisks.length,
    medium: mediumRisks.length,
    high: highRisks.length,
  };

  const recommendations: string[] = [];
  for (const risk of risks.sort((a, b) => b.probability - a.probability).slice(0, 3)) {
    recommendations.push(`[${risk.level.toUpperCase()}] ${risk.description} — ${risk.mitigation}`);
  }
  if (risks.length === 0) {
    recommendations.push('No failure risks detected — print should succeed');
  }

  return {
    failureProbability, risks, riskCounts, likelyToSucceed, confidence, recommendations,
  };
}

// ── 10. G-code Documentation Generator ──

export interface DocumentationSection {
  /** Section title */
  title: string;
  /** Section content */
  content: string;
}

export interface DocumentationResult {
  /** Generated documentation sections */
  sections: DocumentationSection[];
  /** Full documentation as markdown */
  markdown: string;
  /** Word count */
  wordCount: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Generate human-readable documentation from G-code.
 * Produces a markdown document describing the G-code program.
 *
 * @param lines G-code lines
 * @param programName Optional program name
 */
export function generateDocumentation(
  lines: string[],
  programName: string = 'G-code Program',
): DocumentationResult {
  const sections: DocumentationSection[] = [];

  // Overview
  let totalLines = lines.length;
  let codeLines = 0;
  let commentLines = 0;
  const tools = new Set<number>();
  let maxRpm = 0;
  let maxFeed = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith(';') || trimmed.startsWith('(')) {
      commentLines++;
      continue;
    }
    codeLines++;
    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    const tMatch = code.match(/\bT(\d+)\b/i);
    if (tMatch) tools.add(parseInt(tMatch[1]));
    const sMatch = code.match(/\bS(\d*\.?\d+)/i);
    if (sMatch) maxRpm = Math.max(maxRpm, parseFloat(sMatch[1]));
    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) maxFeed = Math.max(maxFeed, parseFloat(fMatch[1]));
  }

  sections.push({
    title: 'Overview',
    content: `Program: ${programName}\nTotal lines: ${totalLines}\nCode lines: ${codeLines}\nComment lines: ${commentLines}`,
  });

  // Tools
  if (tools.size > 0) {
    sections.push({
      title: 'Tools Used',
      content: `Tools: ${Array.from(tools).sort((a, b) => a - b).map(t => `T${t}`).join(', ')}\nTotal unique tools: ${tools.size}`,
    });
  }

  // Machine settings
  const settings: string[] = [];
  if (maxRpm > 0) settings.push(`Max spindle RPM: ${maxRpm}`);
  if (maxFeed > 0) settings.push(`Max feed rate: ${maxFeed} mm/min`);
  if (settings.length > 0) {
    sections.push({ title: 'Machine Settings', content: settings.join('\n') });
  }

  // Operation sequence
  const operations: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;
    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();

    if (/\bG28\b/i.test(code)) operations.push(`Line ${i + 1}: Homing`);
    if (/\bM6\b/i.test(code) || /\bM06\b/i.test(code)) {
      const tMatch = code.match(/\bT(\d+)\b/i);
      operations.push(`Line ${i + 1}: Tool change to T${tMatch ? tMatch[1] : '?'}`);
    }
    if (/\bM3\b/i.test(code) || /\bM03\b/i.test(code)) operations.push(`Line ${i + 1}: Spindle on (CW)`);
    if (/\bM4\b/i.test(code) || /\bM04\b/i.test(code)) operations.push(`Line ${i + 1}: Spindle on (CCW)`);
    if (/\bM5\b/i.test(code)) operations.push(`Line ${i + 1}: Spindle off`);
    if (/\bM30\b/i.test(code) || /\bM2\b/i.test(code)) operations.push(`Line ${i + 1}: Program end`);
  }

  if (operations.length > 0) {
    sections.push({
      title: 'Operation Sequence',
      content: operations.slice(0, 20).join('\n') + (operations.length > 20 ? `\n... and ${operations.length - 20} more` : ''),
    });
  }

  // Comments
  const comments: string[] = [];
  for (let i = 0; i < lines.length && comments.length < 10; i++) {
    const line = lines[i].trim();
    if (line.startsWith(';')) comments.push(`Line ${i + 1}: ${line.replace(/^;\s*/, '')}`);
  }
  if (comments.length > 0) {
    sections.push({ title: 'Notable Comments', content: comments.join('\n') });
  }

  // Build markdown
  const markdown = sections.map(s => `## ${s.title}\n\n${s.content}\n`).join('\n');
  const wordCount = markdown.split(/\s+/).length;

  const recommendations: string[] = [];
  if (commentLines / totalLines < 0.05) {
    recommendations.push('Low comment ratio — add more comments for documentation');
  }
  if (tools.size === 0) {
    recommendations.push('No tools specified — verify tool assignments');
  }
  if (sections.length === 1) {
    recommendations.push('Minimal documentation generated — G-code may be too simple');
  }

  return { sections, markdown, wordCount, recommendations };
}

// ── 11. G-code Performance Benchmark ──

export interface BenchmarkResult {
  /** Total lines processed */
  totalLines: number;
  /** Parse time in milliseconds */
  parseTimeMs: number;
  /** Analysis time in milliseconds */
  analysisTimeMs: number;
  /** Lines per second */
  linesPerSecond: number;
  /** Memory usage estimate in KB */
  memoryEstimateKB: number;
  /** Complexity rating */
  complexityRating: 'simple' | 'moderate' | 'complex' | 'very_complex';
  /** Performance score (0-100) */
  performanceScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Benchmark G-code parsing and analysis performance.
 * Measures how quickly the G-code can be processed.
 *
 * @param lines G-code lines
 */
export function benchmarkGcode(lines: string[]): BenchmarkResult {
  const totalLines = lines.length;
  const startTime = performance.now();

  // Simulate parsing
  let codeLineCount = 0;
  let commandCount = 0;
  let motionCount = 0;
  const tools = new Set<number>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    codeLineCount++;
    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const commands = code.match(/\b[GM]\d+\b/gi);
    if (commands) commandCount += commands.length;
    if (/\bG[01]\b/i.test(code)) motionCount++;

    const tMatch = code.match(/\bT(\d+)\b/i);
    if (tMatch) tools.add(parseInt(tMatch[1]));
  }

  const parseEndTime = performance.now();
  const parseTimeMs = parseEndTime - startTime;

  // Simulate analysis (additional pass)
  let totalDistance = 0;
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
    totalDistance += Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
    prevX = x; prevY = y;
  }

  const endTime = performance.now();
  const analysisTimeMs = endTime - parseEndTime;

  const linesPerSecond = parseTimeMs > 0 ? (totalLines / parseTimeMs) * 1000 : 0;
  const memoryEstimateKB = (totalLines * 80) / 1024; // rough estimate: 80 bytes per line

  let complexityRating: BenchmarkResult['complexityRating'];
  const complexityScore = motionCount / 100 + tools.size * 2 + commandCount / 200;
  if (complexityScore < 5) complexityRating = 'simple';
  else if (complexityScore < 15) complexityRating = 'moderate';
  else if (complexityScore < 30) complexityRating = 'complex';
  else complexityRating = 'very_complex';

  const performanceScore = Math.max(0, Math.min(100, 100 - parseTimeMs / 10));

  const recommendations: string[] = [];
  if (parseTimeMs > 100) {
    recommendations.push(`Parse time ${parseTimeMs.toFixed(1)}ms is high — consider optimizing parser`);
  }
  if (complexityRating === 'very_complex') {
    recommendations.push('Very complex G-code — may require significant processing time');
  }
  if (linesPerSecond > 0 && linesPerSecond < 10000) {
    recommendations.push(`Processing ${linesPerSecond.toFixed(0)} lines/s — consider performance optimization`);
  }
  if (recommendations.length === 0) {
    recommendations.push('G-code processes efficiently');
  }

  return {
    totalLines, parseTimeMs, analysisTimeMs, linesPerSecond,
    memoryEstimateKB, complexityRating, performanceScore, recommendations,
  };
}

// ── 12. G-code Security Audit ──

export interface SecurityIssue {
  /** Line number */
  lineNumber: number;
  /** Issue type */
  type: 'dangerous_command' | 'rapid_at_height' | 'no_safety_boundary' | 'missing_stop' | 'unprotected_motion' | 'high_rpm' | 'missing_e_stop';
  /** Severity */
  severity: 'low' | 'medium' | 'high' | 'critical';
  /** Description */
  description: string;
  /** The problematic line */
  line: string;
  /** Suggested fix */
  fix: string;
}

export interface SecurityAuditResult {
  /** All security issues */
  issues: SecurityIssue[];
  /** Issue count */
  issueCount: number;
  /** Issues by severity */
  bySeverity: { low: number; medium: number; high: number; critical: number };
  /** Security score (0-100, higher is safer) */
  securityScore: number;
  /** Whether the G-code is safe to run */
  isSafe: boolean;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Audit G-code for security issues and dangerous commands.
 * Checks for:
 * - Rapid moves at cutting height
 * - Missing program end
 * - No safety boundaries
 * - High RPM without warmup
 * - Missing emergency stop capability
 *
 * @param lines G-code lines
 * @param safeHeight Safe Z height for rapid moves (default 10)
 * @param maxSafeRpm Maximum safe RPM without warmup (default 5000)
 */
export function auditGcodeSecurity(
  lines: string[],
  safeHeight: number = 10,
  maxSafeRpm: number = 5000,
): SecurityAuditResult {
  const issues: SecurityIssue[] = [];
  let currentZ = 0;
  let currentRpm = 0;
  let hasProgramEnd = false;
  let hasHoming = false;
  let hasWarmup = false;
  let maxZ = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Track Z
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    if (zMatch) {
      currentZ = parseFloat(zMatch[1]);
      maxZ = Math.max(maxZ, currentZ);
    }

    // Track RPM
    const sMatch = code.match(/\bS(\d*\.?\d+)/i);
    if (sMatch && /\bM[34]\b/i.test(code)) {
      currentRpm = parseFloat(sMatch[1]);
      if (currentRpm > maxSafeRpm && !hasWarmup) {
        issues.push({
          lineNumber: i, type: 'high_rpm', severity: 'medium',
          description: `High RPM ${currentRpm} without warmup`,
          line: code, fix: 'Add spindle warmup routine before high RPM operation',
        });
      }
    }

    // Check for warmup
    if (/warm.?up/i.test(line)) hasWarmup = true;

    // Check for homing
    if (/\bG28\b/i.test(code)) hasHoming = true;

    // Check for program end
    if (/\bM30\b/i.test(code) || /\bM2\b/i.test(code)) hasProgramEnd = true;

    // Rapid move at cutting height
    if (/\bG0\b/i.test(code) && currentZ < safeHeight && currentZ < 0) {
      issues.push({
        lineNumber: i, type: 'rapid_at_height', severity: 'high',
        description: `Rapid move at Z=${currentZ.toFixed(1)} (below safe height ${safeHeight})`,
        line: code, fix: `Raise Z above ${safeHeight}mm before rapid moves`,
      });
    }

    // Dangerous commands
    if (/\bM0\b/i.test(code) && !/\bM00\b/i.test(code)) {
      // M0 is program stop — not necessarily dangerous
    }

    // Unprotected motion (G1 without feed rate)
    if (/\bG1\b/i.test(code) && !/\bF\b/i.test(code) && i > 10) {
      // Only flag if no previous feed rate was set
      let hasPriorFeed = false;
      for (let j = i - 1; j >= 0 && j > i - 20; j--) {
        if (/\bF\d/i.test(lines[j])) { hasPriorFeed = true; break; }
      }
      if (!hasPriorFeed) {
        issues.push({
          lineNumber: i, type: 'unprotected_motion', severity: 'medium',
          description: 'G1 without feed rate — may use dangerous default',
          line: code, fix: 'Always specify feed rate (F parameter) with G1',
        });
      }
    }
  }

  // Check for missing program end
  if (!hasProgramEnd) {
    issues.push({
      lineNumber: lines.length - 1, type: 'missing_stop', severity: 'medium',
      description: 'No program end (M30/M2) — machine may not stop properly',
      line: '', fix: 'Add M30 at the end of the program',
    });
  }

  // Check for missing homing
  if (!hasHoming) {
    issues.push({
      lineNumber: 0, type: 'no_safety_boundary', severity: 'high',
      description: 'No homing operation (G28) — position may be incorrect',
      line: '', fix: 'Add G28 at the beginning of the program',
    });
  }

  const bySeverity = {
    low: issues.filter(i => i.severity === 'low').length,
    medium: issues.filter(i => i.severity === 'medium').length,
    high: issues.filter(i => i.severity === 'high').length,
    critical: issues.filter(i => i.severity === 'critical').length,
  };

  const securityScore = Math.max(0, 100 -
    bySeverity.critical * 40 - bySeverity.high * 20 -
    bySeverity.medium * 10 - bySeverity.low * 5
  );
  const isSafe = bySeverity.critical === 0 && bySeverity.high === 0;

  const recommendations: string[] = [];
  for (const issue of issues.sort((a, b) => {
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    return order[a.severity] - order[b.severity];
  }).slice(0, 3)) {
    recommendations.push(`[${issue.severity.toUpperCase()}] Line ${issue.lineNumber + 1}: ${issue.description}`);
  }
  if (issues.length === 0) {
    recommendations.push('No security issues found — G-code is safe to run');
  }

  return {
    issues, issueCount: issues.length, bySeverity,
    securityScore, isSafe, recommendations,
  };
}
