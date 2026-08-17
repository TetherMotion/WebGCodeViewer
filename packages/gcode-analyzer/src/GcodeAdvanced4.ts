/**
 * @file GcodeAdvanced4.ts
 * @brief Fourth batch of advanced G-code analysis features for CNC and 3D printing.
 *
 * This module provides 12 additional high-impact features:
 *  1. G-code playback controller (Universal) — step through execution state
 *  2. Retraction analysis & optimization (3DP) — analyze and tune retractions
 *  3. Layer height consistency check (3DP) — detect inconsistent layer heights
 *  4. Flow rate calibration (3DP) — analyze extrusion flow rate consistency
 *  5. First layer quality analysis (3DP) — check first layer adhesion parameters
 *  6. CNC feed rate optimization (CNC) — suggest feed rate changes for efficiency
 *  7. Stringing prediction (3DP) — predict stringing from travel moves
 *  8. Voxel-based material removal simulation (CNC) — simplified stock removal
 *  9. Print head collision with part (3DP) — check print head vs printed geometry
 * 10. G-code annotation/labeling (Universal) — user annotations on G-code lines
 * 11. Cooling fan analysis (3DP) — track fan speed and cooling effectiveness
 * 12. Print speed analysis by feature (3DP) — speed optimization per feature type
 */

// ── 1. G-code Playback Controller ──

export interface PlaybackState {
  /** Current line number being executed */
  currentLine: number;
  /** Current X position */
  x: number;
  /** Current Y position */
  y: number;
  /** Current Z position */
  z: number;
  /** Current E (extruder) position */
  e: number;
  /** Current feed rate */
  feedRate: number;
  /** Current spindle speed (CNC) */
  spindleRpm: number;
  /** Current tool number */
  tool: number;
  /** Whether currently extruding/cutting */
  isExtruding: boolean;
  /** Whether currently in a rapid move */
  isRapid: boolean;
  /** Current motion mode: G0, G1, G2, G3 */
  motionMode: string;
  /** Absolute/relative positioning mode */
  absoluteMode: boolean;
  /** Absolute/relative extrusion mode */
  absoluteEMode: boolean;
  /** Units (mm or inch) */
  units: 'mm' | 'inch';
  /** Cumulative time in seconds */
  elapsedTime: number;
  /** Cumulative distance traveled */
  distanceTraveled: number;
}

/**
 * Create the initial playback state.
 */
export function createInitialState(): PlaybackState {
  return {
    currentLine: 0, x: 0, y: 0, z: 0, e: 0,
    feedRate: 0, spindleRpm: 0, tool: 0,
    isExtruding: false, isRapid: false,
    motionMode: 'G0', absoluteMode: true, absoluteEMode: true,
    units: 'mm', elapsedTime: 0, distanceTraveled: 0,
  };
}

/**
 * Execute a single G-code line and update the playback state.
 * Returns the new state after executing the line.
 *
 * @param state Current playback state
 * @param line G-code line to execute
 * @param lineNumber Line number in the source
 */
export function executeGcodeLine(state: PlaybackState, line: string, lineNumber: number): PlaybackState {
  const newState: PlaybackState = { ...state, currentLine: lineNumber };
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) return newState;

  const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
  if (!code) return newState;

  const unitMatch = code.match(/\bG20\b/i);
  if (unitMatch) { newState.units = 'inch'; return newState; }
  const unitMatch2 = code.match(/\bG21\b/i);
  if (unitMatch2) { newState.units = 'mm'; return newState; }

  const absMatch = code.match(/\bG90\b/i);
  if (absMatch) { newState.absoluteMode = true; return newState; }
  const relMatch = code.match(/\bG91\b/i);
  if (relMatch) { newState.absoluteMode = false; return newState; }

  const m82Match = code.match(/\bM82\b/i);
  if (m82Match) { newState.absoluteEMode = true; return newState; }
  const m83Match = code.match(/\bM83\b/i);
  if (m83Match) { newState.absoluteEMode = false; return newState; }

  // Spindle control
  const sMatch = code.match(/\bS(\d*\.?\d+)/i);
  if (sMatch && /\bM[034]\b/i.test(code)) {
    newState.spindleRpm = parseFloat(sMatch[1]);
  }

  // Tool change
  const tMatch = code.match(/\bT(\d+)\b/i);
  if (tMatch) newState.tool = parseInt(tMatch[1]);

  // Motion mode
  if (/\bG0\b/i.test(code)) { newState.motionMode = 'G0'; newState.isRapid = true; }
  else if (/\bG1\b/i.test(code)) { newState.motionMode = 'G1'; newState.isRapid = false; }
  else if (/\bG2\b/i.test(code)) { newState.motionMode = 'G2'; newState.isRapid = false; }
  else if (/\bG3\b/i.test(code)) { newState.motionMode = 'G3'; newState.isRapid = false; }

  // Parse coordinates
  const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
  const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
  const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
  const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);
  const fMatch = code.match(/\bF(\d*\.?\d+)/i);

  if (fMatch) newState.feedRate = parseFloat(fMatch[1]);

  const unitScale = newState.units === 'inch' ? 25.4 : 1;
  const oldX = newState.x, oldY = newState.y, oldZ = newState.z, oldE = newState.e;

  if (xMatch) {
    const val = parseFloat(xMatch[1]) * unitScale;
    newState.x = newState.absoluteMode ? val : newState.x + val;
  }
  if (yMatch) {
    const val = parseFloat(yMatch[1]) * unitScale;
    newState.y = newState.absoluteMode ? val : newState.y + val;
  }
  if (zMatch) {
    const val = parseFloat(zMatch[1]) * unitScale;
    newState.z = newState.absoluteMode ? val : newState.z + val;
  }

  if (eMatch) {
    const val = parseFloat(eMatch[1]) * unitScale;
    const newE = newState.absoluteEMode ? val : newState.e + val;
    newState.isExtruding = newE > oldE;
    newState.e = newE;
  } else {
    newState.isExtruding = false;
  }

  // Compute time and distance
  if (newState.motionMode === 'G1' || newState.motionMode === 'G0') {
    const dist = Math.sqrt(
      (newState.x - oldX) ** 2 +
      (newState.y - oldY) ** 2 +
      (newState.z - oldZ) ** 2,
    );
    newState.distanceTraveled += dist;
    if (newState.feedRate > 0 && !newState.isRapid) {
      newState.elapsedTime += dist / (newState.feedRate / 60);
    } else if (newState.isRapid && newState.feedRate > 0) {
      newState.elapsedTime += dist / (newState.feedRate / 60);
    }
  }

  return newState;
}

/**
 * Step the playback state forward by N lines.
 *
 * @param lines G-code lines
 * @param state Current state
 * @param steps Number of lines to step forward
 */
export function stepForward(lines: string[], state: PlaybackState, steps: number = 1): PlaybackState {
  let s = state;
  for (let i = 0; i < steps; i++) {
    const lineIdx = s.currentLine + 1;
    if (lineIdx >= lines.length) break;
    s = executeGcodeLine(s, lines[lineIdx], lineIdx);
  }
  return s;
}

/**
 * Step the playback state backward by N lines.
 * This re-executes from the beginning to the target line.
 *
 * @param lines G-code lines
 * @param state Current state
 * @param steps Number of lines to step backward
 */
export function stepBackward(lines: string[], state: PlaybackState, steps: number = 1): PlaybackState {
  const targetLine = Math.max(0, state.currentLine - steps);
  let s = createInitialState();
  for (let i = 0; i <= targetLine && i < lines.length; i++) {
    s = executeGcodeLine(s, lines[i], i);
  }
  return s;
}

/**
 * Seek to a specific line number.
 *
 * @param lines G-code lines
 * @param lineNumber Target line number
 */
export function seekToLine(lines: string[], lineNumber: number): PlaybackState {
  let s = createInitialState();
  const target = Math.max(0, Math.min(lineNumber, lines.length - 1));
  for (let i = 0; i <= target; i++) {
    s = executeGcodeLine(s, lines[i], i);
  }
  return s;
}

// ── 2. Retraction Analysis & Optimization ──

export interface RetractionEvent {
  /** G-code line number */
  lineNumber: number;
  /** Retraction distance in mm */
  distance: number;
  /** Retraction speed in mm/min */
  speed: number;
  /** Z-hop during retraction in mm */
  zHop: number;
  /** Position where retraction occurs */
  position: { x: number; y: number; z: number };
  /** Whether this is a deretraction (positive E) */
  isDeretraction: boolean;
}

export interface RetractionAnalysisResult {
  /** All retraction events */
  events: RetractionEvent[];
  /** Total retraction count */
  count: number;
  /** Average retraction distance */
  avgDistance: number;
  /** Min/max retraction distance */
  minDistance: number;
  maxDistance: number;
  /** Average retraction speed */
  avgSpeed: number;
  /** Total time spent on retractions in seconds */
  totalRetractionTime: number;
  /** Z-hop usage count */
  zHopCount: number;
  /** Recommendations */
  recommendations: string[];
  /** Unique retraction distances used */
  uniqueDistances: number[];
  /** Unique retraction speeds used */
  uniqueSpeeds: number[];
}

/**
 * Analyze retraction events in G-code and provide optimization recommendations.
 *
 * @param lines G-code lines
 */
export function analyzeRetractions(lines: string[]): RetractionAnalysisResult {
  const events: RetractionEvent[] = [];
  let prevE = 0;
  let prevX = 0, prevY = 0, prevZ = 0;
  let currentFeedRate = 0;
  let zBeforeHop = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) currentFeedRate = parseFloat(fMatch[1]);

    if (!/\bG1\b/i.test(code) && !/\bG0\b/i.test(code)) continue;

    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);
    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);

    if (xMatch) prevX = parseFloat(xMatch[1]);
    if (yMatch) prevY = parseFloat(yMatch[1]);
    if (zMatch) {
      const newZ = parseFloat(zMatch[1]);
      // Detect Z-hop: Z change without X/Y change and with retraction
      if (!xMatch && !yMatch && eMatch) {
        zBeforeHop = prevZ;
      }
      prevZ = newZ;
    }

    if (eMatch) {
      const newE = parseFloat(eMatch[1]);
      const eDelta = newE - prevE;

      // Retraction: negative E delta
      if (eDelta < -0.001) {
        events.push({
          lineNumber: i,
          distance: Math.abs(eDelta),
          speed: currentFeedRate,
          zHop: Math.abs(prevZ - zBeforeHop),
          position: { x: prevX, y: prevY, z: prevZ },
          isDeretraction: false,
        });
      }
      // Deretraction: positive E after a retraction (no X/Y move)
      else if (eDelta > 0.001 && !xMatch && !yMatch && events.length > 0) {
        const lastRetract = events[events.length - 1];
        if (!lastRetract.isDeretraction) {
          events.push({
            lineNumber: i,
            distance: eDelta,
            speed: currentFeedRate,
            zHop: 0,
            position: { x: prevX, y: prevY, z: prevZ },
            isDeretraction: true,
          });
        }
      }

      prevE = newE;
    }
  }

  const retractions = events.filter(e => !e.isDeretraction);
  const count = retractions.length;
  const distances = retractions.map(e => e.distance);
  const speeds = retractions.map(e => e.speed);
  const zHops = retractions.filter(e => e.zHop > 0.01);

  const avgDistance = distances.length > 0 ? distances.reduce((a, b) => a + b, 0) / distances.length : 0;
  const minDistance = distances.length > 0 ? Math.min(...distances) : 0;
  const maxDistance = distances.length > 0 ? Math.max(...distances) : 0;
  const avgSpeed = speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;

  // Total retraction time = sum of (distance / speed * 2) for retract + deretract
  let totalRetractionTime = 0;
  for (const r of retractions) {
    if (r.speed > 0) {
      totalRetractionTime += (r.distance / (r.speed / 60)) * 2; // retract + deretract
    }
  }

  const uniqueDistances = Array.from(new Set(distances.map(d => Math.round(d * 100) / 100))).sort((a, b) => a - b);
  const uniqueSpeeds = Array.from(new Set(speeds.map(s => Math.round(s)))).sort((a, b) => a - b);

  const recommendations: string[] = [];
  if (count > 100) recommendations.push('High retraction count — consider tuning retraction distance to reduce print time');
  if (maxDistance > 5) recommendations.push('Large retraction distance detected — may cause filament grinding, consider reducing');
  if (avgDistance < 0.5 && count > 50) recommendations.push('Very small retraction distance — may be insufficient, check for stringing');
  if (zHops.length === 0 && count > 20) recommendations.push('No Z-hop detected — consider enabling Z-hop to reduce nozzle marks on travel moves');
  if (uniqueDistances.length > 3) recommendations.push('Multiple retraction distances used — consider standardizing for consistency');
  if (totalRetractionTime > 300) recommendations.push(`Retractions take ${Math.round(totalRetractionTime / 60)} min — significant time impact, consider optimizing travel moves`);
  if (recommendations.length === 0) recommendations.push('Retraction settings appear reasonable');

  return {
    events, count, avgDistance, minDistance, maxDistance,
    avgSpeed, totalRetractionTime, zHopCount: zHops.length,
    recommendations, uniqueDistances, uniqueSpeeds,
  };
}

// ── 3. Layer Height Consistency Check ──

export interface LayerHeightIssue {
  /** Layer index */
  layerIndex: number;
  /** Expected layer height */
  expectedHeight: number;
  /** Actual layer height */
  actualHeight: number;
  /** Deviation percentage */
  deviation: number;
  /** Z position */
  zPosition: number;
  /** Severity */
  severity: 'minor' | 'moderate' | 'severe';
}

export interface LayerHeightConsistencyResult {
  /** All layer heights */
  layerHeights: { layerIndex: number; zHeight: number; height: number }[];
  /** Detected issues */
  issues: LayerHeightIssue[];
  /** Average layer height */
  avgHeight: number;
  /** Standard deviation of layer heights */
  stdDev: number;
  /** Whether adaptive layer heights are used */
  isAdaptive: boolean;
  /** Consistency score (0-1, higher = more consistent) */
  consistencyScore: number;
}

/**
 * Check layer height consistency in a 3D print.
 * Detects inconsistent layer heights that may indicate slicing issues.
 *
 * @param zLayers Array of Z-layer info
 */
export function checkLayerHeightConsistency(
  zLayers: { layerIndex: number; zHeight: number }[],
): LayerHeightConsistencyResult {
  if (zLayers.length < 2) {
    return { layerHeights: [], issues: [], avgHeight: 0, stdDev: 0, isAdaptive: false, consistencyScore: 1 };
  }

  const sortedLayers = [...zLayers].sort((a, b) => a.zHeight - b.zHeight);
  const layerHeights: { layerIndex: number; zHeight: number; height: number }[] = [];

  for (let i = 1; i < sortedLayers.length; i++) {
    const height = sortedLayers[i].zHeight - sortedLayers[i - 1].zHeight;
    layerHeights.push({
      layerIndex: sortedLayers[i].layerIndex,
      zHeight: sortedLayers[i].zHeight,
      height,
    });
  }

  const heights = layerHeights.map(l => l.height);
  const avgHeight = heights.reduce((a, b) => a + b, 0) / heights.length;
  const variance = heights.reduce((sum, h) => sum + (h - avgHeight) ** 2, 0) / heights.length;
  const stdDev = Math.sqrt(variance);

  // Check if adaptive (variation > 10% of average)
  const isAdaptive = stdDev > avgHeight * 0.1;

  // Find issues
  const issues: LayerHeightIssue[] = [];
  for (const lh of layerHeights) {
    const deviation = Math.abs((lh.height - avgHeight) / avgHeight) * 100;
    if (deviation > 5) {
      let severity: 'minor' | 'moderate' | 'severe';
      if (deviation > 25) severity = 'severe';
      else if (deviation > 10) severity = 'moderate';
      else severity = 'minor';

      issues.push({
        layerIndex: lh.layerIndex,
        expectedHeight: avgHeight,
        actualHeight: lh.height,
        deviation,
        zPosition: lh.zHeight,
        severity,
      });
    }
  }

  // Consistency score: 1 - (stdDev / avgHeight), clamped to [0, 1]
  const consistencyScore = Math.max(0, Math.min(1, 1 - (stdDev / Math.max(0.001, avgHeight))));

  return { layerHeights, issues, avgHeight, stdDev, isAdaptive, consistencyScore };
}

// ── 4. Flow Rate Calibration ──

export interface FlowRateSegment {
  /** G-code line number */
  lineNumber: number;
  /** Extrusion amount (E delta) */
  extrusion: number;
  /** Move distance */
  moveDistance: number;
  /** Flow rate (extrusion / distance) */
  flowRate: number;
  /** Expected flow rate based on layer height and width */
  expectedFlowRate: number;
  /** Deviation percentage */
  deviation: number;
  /** Feature type */
  featureType: string | null;
}

export interface FlowRateAnalysisResult {
  /** Per-segment flow rate data */
  segments: FlowRateSegment[];
  /** Average flow rate */
  avgFlowRate: number;
  /** Flow rate standard deviation */
  flowRateStdDev: number;
  /** Overall flow rate consistency (0-1) */
  consistency: number;
  /** Recommended flow rate adjustment (percentage, negative = reduce) */
  recommendedAdjustment: number;
  /** Segments with significant deviation */
  outliers: FlowRateSegment[];
}

/**
 * Analyze extrusion flow rate consistency.
 * Computes the ratio of extrusion to move distance and identifies outliers.
 *
 * @param lines G-code lines
 * @param layerHeight Layer height in mm (default 0.2)
 * @param extrusionWidth Extrusion width in mm (default 0.4)
 * @param filamentDiameter Filament diameter in mm (default 1.75)
 */
export function analyzeFlowRate(
  lines: string[],
  layerHeight: number = 0.2,
  extrusionWidth: number = 0.4,
  filamentDiameter: number = 1.75,
): FlowRateAnalysisResult {
  const segments: FlowRateSegment[] = [];
  let prevX = 0, prevY = 0, prevZ = 0, prevE = 0;
  let currentFeatureType: string | null = null;

  // Expected flow rate = (layerHeight * extrusionWidth) / (π * (filamentDiameter/2)²)
  const filamentArea = Math.PI * (filamentDiameter / 2) ** 2;
  const expectedFlowRate = (layerHeight * extrusionWidth) / filamentArea;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    const typeMatch = line.match(/;TYPE:(.+)/i);
    if (typeMatch) {
      currentFeatureType = typeMatch[1].trim();
      continue;
    }

    if (!line.startsWith('G1') && !line.startsWith('g1')) continue;

    const code = line.replace(/;.*$/, '').trim();
    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const z = zMatch ? parseFloat(zMatch[1]) : prevZ;

    if (eMatch) {
      const newE = parseFloat(eMatch[1]);
      const eDelta = newE - prevE;
      const moveDist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);

      if (eDelta > 0 && moveDist > 0.1) {
        const flowRate = eDelta / moveDist;
        const deviation = ((flowRate - expectedFlowRate) / expectedFlowRate) * 100;

        segments.push({
          lineNumber: i,
          extrusion: eDelta,
          moveDistance: moveDist,
          flowRate,
          expectedFlowRate,
          deviation,
          featureType: currentFeatureType,
        });
      }

      prevE = newE;
    }

    prevX = x; prevY = y; prevZ = z;
  }

  if (segments.length === 0) {
    return { segments: [], avgFlowRate: 0, flowRateStdDev: 0, consistency: 1, recommendedAdjustment: 0, outliers: [] };
  }

  const flowRates = segments.map(s => s.flowRate);
  const avgFlowRate = flowRates.reduce((a, b) => a + b, 0) / flowRates.length;
  const variance = flowRates.reduce((sum, f) => sum + (f - avgFlowRate) ** 2, 0) / flowRates.length;
  const flowRateStdDev = Math.sqrt(variance);

  const consistency = Math.max(0, Math.min(1, 1 - (flowRateStdDev / Math.max(0.001, avgFlowRate))));

  // Outliers: deviation > 20%
  const outliers = segments.filter(s => Math.abs(s.deviation) > 20);

  // Recommended adjustment: based on average deviation
  const avgDeviation = segments.reduce((sum, s) => sum + s.deviation, 0) / segments.length;
  const recommendedAdjustment = -avgDeviation; // negative of deviation to correct it

  return {
    segments, avgFlowRate, flowRateStdDev, consistency,
    recommendedAdjustment, outliers,
  };
}

// ── 5. First Layer Quality Analysis ──

export interface FirstLayerAnalysisResult {
  /** First layer Z height */
  zHeight: number;
  /** First layer feed rate */
  feedRate: number;
  /** First layer extrusion amount */
  totalExtrusion: number;
  /** First layer move count */
  moveCount: number;
  /** First layer travel distance */
  travelDistance: number;
  /** Bed temperature */
  bedTemp: number;
  /** Hotend temperature */
  hotendTemp: number;
  /** Fan speed during first layer (0-255) */
  fanSpeed: number;
  /** Number of lines in first layer */
  lineCount: number;
  /** Issues found */
  issues: { type: string; description: string; severity: 'warning' | 'error' }[];
  /** Quality score (0-1, higher = better) */
  qualityScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze first layer quality parameters.
 * Checks temperatures, feed rate, fan speed, and extrusion for optimal adhesion.
 *
 * @param lines G-code lines
 */
export function analyzeFirstLayer(lines: string[]): FirstLayerAnalysisResult {
  let firstLayerStart = -1;
  let firstLayerEnd = -1;
  let currentLayer = -1;
  let bedTemp = 0;
  let hotendTemp = 0;
  let fanSpeed = 0;

  // Find first layer boundaries and temperatures
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Track temperatures
    const m140Match = line.match(/M140\s+S(\d+)/i);
    if (m140Match) bedTemp = parseInt(m140Match[1]);
    const m190Match = line.match(/M190\s+S(\d+)/i);
    if (m190Match) bedTemp = parseInt(m190Match[1]);
    const m104Match = line.match(/M104\s+S(\d+)/i);
    if (m104Match) hotendTemp = parseInt(m104Match[1]);
    const m109Match = line.match(/M109\s+S(\d+)/i);
    if (m109Match) hotendTemp = parseInt(m109Match[1]);
    const m106Match = line.match(/M106\s+S(\d+)/i);
    if (m106Match) fanSpeed = parseInt(m106Match[1]);
    const m107Match = /\bM107\b/i.test(line);
    if (m107Match) fanSpeed = 0;

    const layerMatch = line.match(/;LAYER:(\d+)/i);
    if (layerMatch) {
      currentLayer = parseInt(layerMatch[1]);
      if (currentLayer === 0 && firstLayerStart < 0) {
        firstLayerStart = i;
      } else if (currentLayer === 1 && firstLayerEnd < 0) {
        firstLayerEnd = i;
        break;
      }
    }
  }

  // If no layer markers, use Z=0 or first G1 moves
  if (firstLayerStart < 0) {
    for (let i = 0; i < lines.length; i++) {
      if (/^G1\b/i.test(lines[i]) && /\bE\b/i.test(lines[i])) {
        firstLayerStart = i;
        break;
      }
    }
    if (firstLayerStart < 0) firstLayerStart = 0;
    // Find end: first Z change
    let prevZ = 0;
    for (let i = firstLayerStart + 1; i < lines.length; i++) {
      const zMatch = lines[i].match(/\bZ(-?\d*\.?\d+)/i);
      if (zMatch) {
        const z = parseFloat(zMatch[1]);
        if (Math.abs(z - prevZ) > 0.05 && prevZ > 0) {
          firstLayerEnd = i;
          break;
        }
        prevZ = z;
      }
    }
  }

  if (firstLayerEnd < 0) firstLayerEnd = Math.min(firstLayerStart + 200, lines.length);

  // Analyze first layer moves
  let prevX = 0, prevY = 0, prevZ = 0, prevE = 0;
  let currentFeedRate = 0;
  let totalExtrusion = 0;
  let moveCount = 0;
  let travelDistance = 0;
  let extrudingDistance = 0;

  for (let i = firstLayerStart; i < firstLayerEnd && i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';')) continue;
    if (!/^G1\b/i.test(line)) continue;

    const code = line.replace(/;.*$/, '').trim();
    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) currentFeedRate = parseFloat(fMatch[1]);

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const z = zMatch ? parseFloat(zMatch[1]) : prevZ;

    const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
    travelDistance += dist;
    moveCount++;

    if (eMatch) {
      const newE = parseFloat(eMatch[1]);
      const eDelta = newE - prevE;
      if (eDelta > 0) {
        totalExtrusion += eDelta;
        extrudingDistance += dist;
      }
      prevE = newE;
    }

    prevX = x; prevY = y; prevZ = z;
  }

  // Analyze issues
  const issues: FirstLayerAnalysisResult['issues'] = [];
  const recommendations: string[] = [];

  if (bedTemp < 50 && bedTemp > 0) {
    issues.push({ type: 'bed_temp', description: `Bed temperature (${bedTemp}°C) may be too low for good adhesion`, severity: 'warning' });
    recommendations.push('Increase bed temperature to 60-70°C for better first layer adhesion');
  }
  if (hotendTemp < 180 && hotendTemp > 0) {
    issues.push({ type: 'hotend_temp', description: `Hotend temperature (${hotendTemp}°C) may be too low`, severity: 'warning' });
    recommendations.push('Increase hotend temperature for better filament flow');
  }
  if (fanSpeed > 50) {
    issues.push({ type: 'fan_speed', description: `Fan speed (${fanSpeed}/255) is high for first layer — may reduce adhesion`, severity: 'warning' });
    recommendations.push('Disable or reduce cooling fan for first layer for better adhesion');
  }
  if (currentFeedRate > 3000) {
    issues.push({ type: 'feed_rate', description: `First layer feed rate (${currentFeedRate} mm/min) is high — may cause poor adhesion`, severity: 'warning' });
    recommendations.push('Reduce first layer print speed to 20-30 mm/s for better adhesion');
  }
  if (totalExtrusion === 0) {
    issues.push({ type: 'no_extrusion', description: 'No extrusion detected in first layer', severity: 'error' });
  }

  // Quality score
  let qualityScore = 1;
  for (const issue of issues) {
    qualityScore -= issue.severity === 'error' ? 0.5 : 0.15;
  }
  qualityScore = Math.max(0, qualityScore);

  if (recommendations.length === 0) {
    recommendations.push('First layer parameters look good');
  }

  return {
    zHeight: prevZ,
    feedRate: currentFeedRate,
    totalExtrusion,
    moveCount,
    travelDistance,
    bedTemp,
    hotendTemp,
    fanSpeed,
    lineCount: firstLayerEnd - firstLayerStart,
    issues,
    qualityScore,
    recommendations,
  };
}

// ── 6. CNC Feed Rate Optimization ──

export interface FeedRateSuggestion {
  /** G-code line number */
  lineNumber: number;
  /** Current feed rate */
  currentFeedRate: number;
  /** Suggested feed rate */
  suggestedFeedRate: number;
  /** Reason for suggestion */
  reason: string;
  /** Expected time savings in seconds */
  timeSavings: number;
  /** Cut depth at this point */
  cutDepth: number;
  /** Cut width at this point */
  cutWidth: number;
}

export interface FeedRateOptimizationResult {
  /** Feed rate suggestions */
  suggestions: FeedRateSuggestion[];
  /** Total estimated time savings in seconds */
  totalTimeSavings: number;
  /** Current total cutting time in seconds */
  currentTotalTime: number;
  /** Optimized total cutting time in seconds */
  optimizedTotalTime: number;
  /** Time improvement percentage */
  improvementPercentage: number;
}

/**
 * Suggest feed rate optimizations for CNC operations.
 * Analyzes cutting parameters and suggests feed rate changes based on:
 * - Chip load optimization
 * - Reduced feed for deep cuts
 * - Increased feed for shallow cuts
 *
 * @param lines G-code lines
 * @param toolDiameter Tool diameter in mm
 * @param maxFeedRate Maximum machine feed rate in mm/min
 * @param optimalChipLoad Optimal chip load per tooth in mm
 * @param flutes Number of flutes on the tool
 */
export function optimizeFeedRates(
  lines: string[],
  toolDiameter: number = 6,
  maxFeedRate: number = 5000,
  optimalChipLoad: number = 0.05,
  flutes: number = 4,
): FeedRateOptimizationResult {
  const suggestions: FeedRateSuggestion[] = [];
  let prevZ = 0;
  let currentRpm = 0;
  let currentFeedRate = 0;
  let prevE = 0;
  let prevX = 0, prevY = 0;
  let totalTimeSavings = 0;
  let currentTotalTime = 0;
  let optimizedTotalTime = 0;

  // Optimal feed rate = optimalChipLoad * flutes * RPM
  const optimalFeedRate = optimalChipLoad * flutes * currentRpm;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const sMatch = code.match(/\bS(\d*\.?\d+)/i);
    if (sMatch && /\bM[034]\b/i.test(code)) currentRpm = parseFloat(sMatch[1]);

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) currentFeedRate = parseFloat(fMatch[1]);

    if (!/\bG1\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const z = zMatch ? parseFloat(zMatch[1]) : prevZ;

    const isCutting = (eMatch && parseFloat(eMatch[1]) > prevE) || (zMatch && Math.abs(z - prevZ) > 0.01);
    const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2 + (z - prevZ) ** 2);

    if (isCutting && currentFeedRate > 0 && dist > 0) {
      const cutDepth = Math.abs(z - prevZ);
      const effectiveDepth = cutDepth > 0 ? cutDepth : toolDiameter * 0.5;
      const currentTime = dist / (currentFeedRate / 60);
      currentTotalTime += currentTime;

      // Compute optimal feed rate
      const baseOptimal = optimalChipLoad * flutes * currentRpm;
      // Reduce for deep cuts (depth > tool diameter)
      const depthFactor = Math.min(1, toolDiameter / Math.max(toolDiameter, effectiveDepth));
      // Reduce for full-width cuts
      const widthFactor = 0.8; // assume 80% width engagement
      const suggestedFeed = Math.min(maxFeedRate, baseOptimal * depthFactor * widthFactor);

      if (Math.abs(suggestedFeed - currentFeedRate) / currentFeedRate > 0.15) {
        const optimizedTime = dist / (suggestedFeed / 60);
        const timeSavings = currentTime - optimizedTime;

        if (Math.abs(timeSavings) > 0.01) {
          suggestions.push({
            lineNumber: i,
            currentFeedRate,
            suggestedFeedRate: Math.round(suggestedFeed),
            reason: effectiveDepth > toolDiameter
              ? 'Deep cut — reduce feed rate for tool life'
              : currentFeedRate < suggestedFeed * 0.8
                ? 'Shallow cut — can increase feed rate'
                : 'Optimize chip load',
            timeSavings,
            cutDepth: effectiveDepth,
            cutWidth: toolDiameter,
          });

          totalTimeSavings += timeSavings;
          optimizedTotalTime += optimizedTime;
        } else {
          optimizedTotalTime += currentTime;
        }
      } else {
        optimizedTotalTime += currentTime;
      }
    }

    if (eMatch) prevE = parseFloat(eMatch[1]);
    prevX = x; prevY = y; prevZ = z;
  }

  const improvementPercentage = currentTotalTime > 0
    ? ((currentTotalTime - optimizedTotalTime) / currentTotalTime) * 100
    : 0;

  return {
    suggestions,
    totalTimeSavings,
    currentTotalTime,
    optimizedTotalTime,
    improvementPercentage,
  };
}

// ── 7. Stringing Prediction ──

export interface StringingRiskPoint {
  /** G-code line number */
  lineNumber: number;
  /** Travel distance without retraction */
  travelDistance: number;
  /** Z height */
  zHeight: number;
  /** Risk level */
  risk: 'low' | 'medium' | 'high';
  /** Risk score (0-1) */
  riskScore: number;
  /** Start position */
  start: { x: number; y: number };
  /** End position */
  end: { x: number; y: number };
}

export interface StringingPredictionResult {
  /** Risk points */
  riskPoints: StringingRiskPoint[];
  /** High-risk travel count */
  highRiskCount: number;
  /** Total travel distance without retraction */
  totalUnretractedTravel: number;
  /** Overall stringing risk (0-1) */
  overallRisk: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Predict stringing risk from travel moves without retraction.
 * Stringing occurs when the nozzle moves between extrusion points
 * without retracting filament, leaving thin strands.
 *
 * @param lines G-code lines
 * @param retractionThreshold Minimum retraction distance to count as retracted (mm)
 */
export function predictStringing(
  lines: string[],
  retractionThreshold: number = 0.5,
): StringingPredictionResult {
  const riskPoints: StringingRiskPoint[] = [];
  let prevX = 0, prevY = 0, prevZ = 0, prevE = 0;
  let totalUnretractedTravel = 0;
  let lastRetracted = false; // track whether the last E change was a retraction

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    if (!/\bG0\b/i.test(code) && !/\bG1\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const z = zMatch ? parseFloat(zMatch[1]) : prevZ;

    // Track E changes
    if (eMatch) {
      const newE = parseFloat(eMatch[1]);
      const eDelta = newE - prevE;
      // Check if this is a retraction
      if (eDelta < -retractionThreshold) {
        lastRetracted = true;
      } else if (eDelta > retractionThreshold) {
        lastRetracted = false; // deretraction or extrusion
      }
      prevE = newE;
    }

    // Check for travel move (XY movement without extrusion or with insufficient retraction)
    if ((xMatch || yMatch) && !eMatch) {
      // Travel move — check if it was preceded by a retraction
      if (!lastRetracted) {
        const travelDist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
        if (travelDist > 2.0) {
          totalUnretractedTravel += travelDist;

          // Risk factors:
          // - Longer travel = higher risk
          // - Higher Z = higher risk (more surface to string across)
          let riskScore = Math.min(1, travelDist / 50);
          riskScore *= Math.min(1.5, 1 + z / 20);

          let risk: 'low' | 'medium' | 'high';
          if (riskScore > 0.6) risk = 'high';
          else if (riskScore > 0.3) risk = 'medium';
          else risk = 'low';

          if (risk !== 'low') {
            riskPoints.push({
              lineNumber: i,
              travelDistance: travelDist,
              zHeight: z,
              risk,
              riskScore,
              start: { x: prevX, y: prevY },
              end: { x, y },
            });
          }
        }
      }
    }

    prevX = x; prevY = y; prevZ = z;
  }

  const highRiskCount = riskPoints.filter(p => p.risk === 'high').length;
  const overallRisk = riskPoints.length > 0
    ? Math.min(1, riskPoints.reduce((sum, p) => sum + p.riskScore, 0) / riskPoints.length)
    : 0;

  const recommendations: string[] = [];
  if (highRiskCount > 10) recommendations.push('Many high-risk travel moves — increase retraction distance');
  if (totalUnretractedTravel > 500) recommendations.push('Significant unretracted travel — enable retraction or increase distance');
  if (riskPoints.some(p => p.zHeight > 10)) recommendations.push('Stringing risk at high Z — consider enabling Z-hop');
  if (recommendations.length === 0) recommendations.push('Stringing risk is low — retraction settings appear adequate');

  return {
    riskPoints,
    highRiskCount,
    totalUnretractedTravel,
    overallRisk,
    recommendations,
  };
}

// ── 8. Voxel-based Material Removal Simulation ──

export interface VoxelGrid {
  /** Grid resolution in X */
  sizeX: number;
  /** Grid resolution in Y */
  sizeY: number;
  /** Grid resolution in Z */
  sizeZ: number;
  /** Voxel size in mm */
  voxelSize: number;
  /** Voxel data: 1 = material present, 0 = removed */
  data: Uint8Array;
  /** Stock origin X */
  originX: number;
  /** Stock origin Y */
  originY: number;
  /** Stock origin Z */
  originZ: number;
  /** Total voxels removed */
  removedCount: number;
  /** Total voxels remaining */
  remainingCount: number;
  /** Material removal percentage */
  removalPercentage: number;
}

/**
 * Create a voxel grid representing the stock material.
 *
 * @param stockLength Stock X dimension in mm
 * @param stockWidth Stock Y dimension in mm
 * @param stockHeight Stock Z dimension in mm
 * @param voxelSize Voxel size in mm (default 1mm)
 * @param originX Stock origin X
 * @param originY Stock origin Y
 * @param originZ Stock origin Z
 */
export function createVoxelGrid(
  stockLength: number,
  stockWidth: number,
  stockHeight: number,
  voxelSize: number = 1,
  originX: number = 0,
  originY: number = 0,
  originZ: number = 0,
): VoxelGrid {
  const sizeX = Math.ceil(stockLength / voxelSize);
  const sizeY = Math.ceil(stockWidth / voxelSize);
  const sizeZ = Math.ceil(stockHeight / voxelSize);
  const totalVoxels = sizeX * sizeY * sizeZ;
  const data = new Uint8Array(totalVoxels).fill(1);

  return {
    sizeX, sizeY, sizeZ, voxelSize, data,
    originX, originY, originZ,
    removedCount: 0,
    remainingCount: totalVoxels,
    removalPercentage: 0,
  };
}

/**
 * Simulate material removal by a cutting tool moving along a path.
 * Removes voxels that intersect with the tool volume.
 *
 * @param grid Voxel grid to modify
 * @param moves Cutting moves: { x, y, z, isCutting }
 * @param toolRadius Tool radius in mm
 */
export function simulateMaterialRemoval(
  grid: VoxelGrid,
  moves: { x: number; y: number; z: number; isCutting: boolean }[],
  toolRadius: number,
): VoxelGrid {
  const { sizeX, sizeY, sizeZ, voxelSize, originX, originY, originZ } = grid;
  const toolRadiusVoxels = Math.ceil(toolRadius / voxelSize);

  for (let i = 1; i < moves.length; i++) {
    const move = moves[i];
    if (!move.isCutting) continue;

    const prev = moves[i - 1];

    // Convert to voxel coordinates
    const x0 = (prev.x - originX) / voxelSize;
    const y0 = (prev.y - originY) / voxelSize;
    const z0 = (prev.z - originZ) / voxelSize;
    const x1 = (move.x - originX) / voxelSize;
    const y1 = (move.y - originY) / voxelSize;
    const z1 = (move.z - originZ) / voxelSize;

    // Sample along the path and remove voxels
    const pathLength = Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2 + (z1 - z0) ** 2);
    const steps = Math.max(1, Math.ceil(pathLength));

    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const cx = x0 + (x1 - x0) * t;
      const cy = y0 + (y1 - y0) * t;
      const cz = z0 + (z1 - z0) * t;

      // Remove voxels in a cylinder around the tool path
      const minVx = Math.max(0, Math.floor(cx - toolRadiusVoxels));
      const maxVx = Math.min(sizeX - 1, Math.ceil(cx + toolRadiusVoxels));
      const minVy = Math.max(0, Math.floor(cy - toolRadiusVoxels));
      const maxVy = Math.min(sizeY - 1, Math.ceil(cy + toolRadiusVoxels));
      const minVz = Math.max(0, Math.floor(cz - toolRadiusVoxels));
      const maxVz = Math.min(sizeZ - 1, Math.ceil(cz + toolRadiusVoxels));

      for (let vx = minVx; vx <= maxVx; vx++) {
        for (let vy = minVy; vy <= maxVy; vy++) {
          for (let vz = minVz; vz <= maxVz; vz++) {
            const dx = vx - cx;
            const dy = vy - cy;
            const dz = vz - cz;
            const distSq = dx * dx + dy * dy + dz * dz;
            if (distSq <= toolRadiusVoxels * toolRadiusVoxels) {
              const idx = vz * sizeX * sizeY + vy * sizeX + vx;
              if (grid.data[idx] === 1) {
                grid.data[idx] = 0;
                grid.removedCount++;
                grid.remainingCount--;
              }
            }
          }
        }
      }
    }
  }

  const totalVoxels = grid.data.length;
  grid.removalPercentage = totalVoxels > 0 ? (grid.removedCount / totalVoxels) * 100 : 0;

  return grid;
}

// ── 9. Print Head Collision with Part ──

export interface PrintHeadCollision {
  /** G-code line number */
  lineNumber: number;
  /** Position where collision is detected */
  position: { x: number; y: number; z: number };
  /** Type of collision */
  type: 'gantry' | 'extruder' | 'fan' | 'belt';
  /** Description */
  description: string;
  /** Severity */
  severity: 'warning' | 'error';
}

export interface PrintHeadModel {
  /** Print head width in X (mm) */
  width: number;
  /** Print head depth in Y (mm) */
  depth: number;
  /** Print head height in Z (mm) */
  height: number;
  /** Offset from nozzle in X */
  offsetX: number;
  /** Offset from nozzle in Y */
  offsetY: number;
  /** Gantry height above nozzle (mm) */
  gantryHeight: number;
}

/**
 * Check for print head collisions with already-printed geometry.
 * Simulates the print head moving over printed parts and detects
 * where the gantry/extruder would collide.
 *
 * @param lines G-code lines
 * @param printedLayers Already-printed layer Z heights and XY bounds
 * @param headModel Print head geometry
 */
export function checkPrintHeadCollisions(
  lines: string[],
  printedLayers: { zHeight: number; bounds: { minX: number; maxX: number; minY: number; maxY: number } }[],
  headModel: PrintHeadModel,
): PrintHeadCollision[] {
  const collisions: PrintHeadCollision[] = [];
  let prevX = 0, prevY = 0, prevZ = 0;

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

    // Check against all printed layers above current Z (already printed geometry)
    for (const layer of printedLayers) {
      if (layer.zHeight < z) continue; // only check layers above current Z

      // Compute print head bounding box at this position
      const headMinX = x + headModel.offsetX - headModel.width / 2;
      const headMaxX = x + headModel.offsetX + headModel.width / 2;
      const headMinY = y + headModel.offsetY - headModel.depth / 2;
      const headMaxY = y + headModel.offsetY + headModel.depth / 2;

      // Check if print head XY overlaps with printed layer
      if (headMaxX > layer.bounds.minX && headMinX < layer.bounds.maxX &&
          headMaxY > layer.bounds.minY && headMinY < layer.bounds.maxY) {
        // Check if gantry height would collide
        const gantryZ = z + headModel.gantryHeight;
        if (gantryZ < layer.zHeight + 5) { // 5mm safety margin
          collisions.push({
            lineNumber: i,
            position: { x, y, z },
            type: 'gantry',
            description: `Print head gantry at Z${gantryZ.toFixed(1)} may collide with printed geometry at Z${layer.zHeight.toFixed(1)}`,
            severity: 'warning',
          });
        }
      }
    }

    prevX = x; prevY = y; prevZ = z;
  }

  return collisions;
}

// ── 10. G-code Annotation/Labeling ──

export interface GcodeAnnotation {
  /** Line number being annotated */
  lineNumber: number;
  /** Annotation text */
  text: string;
  /** Annotation category */
  category: 'note' | 'warning' | 'error' | 'todo' | 'bookmark';
  /** Timestamp */
  timestamp: string;
  /** Author */
  author: string;
}

/**
 * Add an annotation to a G-code line.
 */
export function createAnnotation(
  lineNumber: number,
  text: string,
  category: GcodeAnnotation['category'] = 'note',
  author: string = 'user',
): GcodeAnnotation {
  return {
    lineNumber,
    text,
    category,
    timestamp: new Date().toISOString(),
    author,
  };
}

/**
 * Export annotations as JSON.
 */
export function exportAnnotations(annotations: GcodeAnnotation[]): string {
  return JSON.stringify({
    version: '1.0',
    exported: new Date().toISOString(),
    annotations,
  }, null, 2);
}

/**
 * Import annotations from JSON.
 */
export function importAnnotations(json: string): GcodeAnnotation[] {
  const data = JSON.parse(json);
  if (data.annotations && Array.isArray(data.annotations)) {
    return data.annotations.map((a: GcodeAnnotation) => ({
      lineNumber: a.lineNumber,
      text: a.text ?? '',
      category: a.category ?? 'note',
      timestamp: a.timestamp ?? new Date().toISOString(),
      author: a.author ?? 'imported',
    }));
  }
  return [];
}

/**
 * Filter annotations by category.
 */
export function filterAnnotations(
  annotations: GcodeAnnotation[],
  category: GcodeAnnotation['category'],
): GcodeAnnotation[] {
  return annotations.filter(a => a.category === category);
}

/**
 * Search annotations by text.
 */
export function searchAnnotations(
  annotations: GcodeAnnotation[],
  query: string,
): GcodeAnnotation[] {
  const lowerQuery = query.toLowerCase();
  return annotations.filter(a => a.text.toLowerCase().includes(lowerQuery));
}

// ── 11. Cooling Fan Analysis ──

export interface FanEvent {
  /** G-code line number */
  lineNumber: number;
  /** Fan speed (0-255) */
  speed: number;
  /** Previous speed */
  previousSpeed: number;
  /** Layer number (if available) */
  layer: number | null;
}

export interface FanAnalysisResult {
  /** Fan speed events */
  events: FanEvent[];
  /** Average fan speed */
  avgSpeed: number;
  /** Max fan speed */
  maxSpeed: number;
  /** Min fan speed (when on) */
  minOnSpeed: number;
  /** Time with fan off (percentage) */
  offPercentage: number;
  /** Number of speed changes */
  changeCount: number;
  /** Fan speed at first layer */
  firstLayerSpeed: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze cooling fan usage in G-code.
 * Tracks fan speed changes and provides recommendations.
 *
 * @param lines G-code lines
 */
export function analyzeCoolingFan(lines: string[]): FanAnalysisResult {
  const events: FanEvent[] = [];
  let currentSpeed = 0;
  let currentLayer: number | null = null;
  let firstLayerSpeed = -1;
  let lineCount = 0;
  let offCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    const layerMatch = line.match(/;LAYER:(\d+)/i);
    if (layerMatch) {
      currentLayer = parseInt(layerMatch[1]);
      continue;
    }

    // M106 S### — set fan speed
    const m106Match = line.match(/M106\s+S(\d+)/i);
    if (m106Match) {
      const newSpeed = parseInt(m106Match[1]);
      events.push({
        lineNumber: i,
        speed: newSpeed,
        previousSpeed: currentSpeed,
        layer: currentLayer,
      });
      if (currentLayer === 0 && firstLayerSpeed < 0) {
        firstLayerSpeed = newSpeed;
      }
      currentSpeed = newSpeed;
    }

    // M107 — fan off
    if (/\bM107\b/i.test(line)) {
      events.push({
        lineNumber: i,
        speed: 0,
        previousSpeed: currentSpeed,
        layer: currentLayer,
      });
      if (currentLayer === 0 && firstLayerSpeed < 0) {
        firstLayerSpeed = 0;
      }
      currentSpeed = 0;
    }

    lineCount++;
    if (currentSpeed === 0) offCount++;
  }

  const speeds = events.map(e => e.speed);
  const onSpeeds = speeds.filter(s => s > 0);
  const avgSpeed = speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;
  const maxSpeed = speeds.length > 0 ? Math.max(...speeds) : 0;
  const minOnSpeed = onSpeeds.length > 0 ? Math.min(...onSpeeds) : 0;
  const offPercentage = lineCount > 0 ? (offCount / lineCount) * 100 : 0;
  const changeCount = events.length;

  const recommendations: string[] = [];
  if (firstLayerSpeed > 50) {
    recommendations.push('Fan is on during first layer — consider disabling for better adhesion');
  }
  if (changeCount > 50) {
    recommendations.push('Frequent fan speed changes — may indicate over-complex cooling settings');
  }
  if (maxSpeed === 0) {
    recommendations.push('No cooling fan detected — may cause overheating on small features');
  }
  if (offPercentage > 80) {
    recommendations.push('Fan is off most of the time — consider enabling cooling for better overhangs');
  }
  if (recommendations.length === 0) {
    recommendations.push('Cooling fan settings appear reasonable');
  }

  return {
    events,
    avgSpeed,
    maxSpeed,
    minOnSpeed,
    offPercentage,
    changeCount,
    firstLayerSpeed: firstLayerSpeed < 0 ? 0 : firstLayerSpeed,
    recommendations,
  };
}

// ── 12. Print Speed Analysis by Feature ──

export interface FeatureSpeedAnalysis {
  /** Feature type (e.g., WALL-OUTER, INFILL, SUPPORT) */
  featureType: string;
  /** Average speed for this feature */
  avgSpeed: number;
  /** Min speed */
  minSpeed: number;
  /** Max speed */
  maxSpeed: number;
  /** Total distance for this feature */
  totalDistance: number;
  /** Total time for this feature in seconds */
  totalTime: number;
  /** Percentage of total print time */
  timePercentage: number;
  /** Whether speed is optimal */
  isOptimal: boolean;
  /** Recommendation */
  recommendation: string;
}

export interface PrintSpeedAnalysisResult {
  /** Per-feature speed analysis */
  features: FeatureSpeedAnalysis[];
  /** Overall average speed */
  overallAvgSpeed: number;
  /** Total print time in seconds */
  totalTime: number;
  /** Features with suboptimal speeds */
  suboptimalCount: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze print speeds by feature type and provide optimization recommendations.
 *
 * @param lines G-code lines
 * @param optimalSpeeds Recommended speeds per feature type
 */
export function analyzePrintSpeeds(
  lines: string[],
  optimalSpeeds: { [feature: string]: { min: number; max: number } } = {
    'WALL-OUTER': { min: 1200, max: 2400 },
    'WALL-INNER': { min: 1800, max: 3600 },
    'INFILL': { min: 3000, max: 6000 },
    'SUPPORT': { min: 1800, max: 3600 },
    'BRIDGE': { min: 600, max: 1200 },
    'SKIRT': { min: 1200, max: 2400 },
  },
): PrintSpeedAnalysisResult {
  const featureData = new Map<string, { speeds: number[]; distances: number[]; times: number[] }>();
  let currentFeature = 'UNKNOWN';
  let currentFeedRate = 0;
  let prevX = 0, prevY = 0, prevZ = 0;
  let totalTime = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    const typeMatch = line.match(/;TYPE:(.+)/i);
    if (typeMatch) {
      currentFeature = typeMatch[1].trim().toUpperCase();
      continue;
    }

    if (!line.startsWith('G1') && !line.startsWith('g1')) continue;

    const code = line.replace(/;.*$/, '').trim();
    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) currentFeedRate = parseFloat(fMatch[1]);

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const z = zMatch ? parseFloat(zMatch[1]) : prevZ;

    const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2 + (z - prevZ) ** 2);
    if (dist > 0 && currentFeedRate > 0) {
      const time = dist / (currentFeedRate / 60);
      totalTime += time;

      const data = featureData.get(currentFeature) ?? { speeds: [], distances: [], times: [] };
      data.speeds.push(currentFeedRate);
      data.distances.push(dist);
      data.times.push(time);
      featureData.set(currentFeature, data);
    }

    prevX = x; prevY = y; prevZ = z;
  }

  const features: FeatureSpeedAnalysis[] = [];
  let overallSpeedSum = 0;
  let overallSpeedCount = 0;
  let suboptimalCount = 0;
  const recommendations: string[] = [];

  for (const [featureType, data] of featureData) {
    const avgSpeed = data.speeds.reduce((a, b) => a + b, 0) / data.speeds.length;
    const minSpeed = Math.min(...data.speeds);
    const maxSpeed = Math.max(...data.speeds);
    const totalDistance = data.distances.reduce((a, b) => a + b, 0);
    const featureTime = data.times.reduce((a, b) => a + b, 0);
    const timePercentage = totalTime > 0 ? (featureTime / totalTime) * 100 : 0;

    const optimal = optimalSpeeds[featureType];
    let isOptimal = true;
    let recommendation = 'Speed is within optimal range';

    if (optimal) {
      if (avgSpeed < optimal.min) {
        isOptimal = false;
        recommendation = `Speed too slow (optimal: ${optimal.min}-${optimal.max} mm/min) — can increase for faster printing`;
      } else if (avgSpeed > optimal.max) {
        isOptimal = false;
        recommendation = `Speed too fast (optimal: ${optimal.min}-${optimal.max} mm/min) — reduce for better quality`;
      }
    } else {
      recommendation = 'No optimal speed range defined for this feature';
    }

    if (!isOptimal) {
      suboptimalCount++;
      recommendations.push(`${featureType}: ${recommendation}`);
    }

    features.push({
      featureType,
      avgSpeed,
      minSpeed,
      maxSpeed,
      totalDistance,
      totalTime: featureTime,
      timePercentage,
      isOptimal,
      recommendation,
    });

    overallSpeedSum += avgSpeed * data.speeds.length;
    overallSpeedCount += data.speeds.length;
  }

  const overallAvgSpeed = overallSpeedCount > 0 ? overallSpeedSum / overallSpeedCount : 0;

  features.sort((a, b) => b.totalTime - a.totalTime);

  if (recommendations.length === 0) {
    recommendations.push('All feature speeds are within optimal ranges');
  }

  return {
    features,
    overallAvgSpeed,
    totalTime,
    suboptimalCount,
    recommendations,
  };
}
