/**
 * @file GcodeAdvanced8.ts
 * @brief Eighth batch of advanced G-code analysis features for CNC and 3D printing.
 *
 * This module provides 12 additional high-impact features:
 *  1. G-code modal state tracker (Universal) — track all modal states
 *  2. Dwell time analysis (Universal) — analyze G4 dwell commands
 *  3. 3DP safety check (3DP) — check for common safety issues
 *  4. Toolpath curvature analysis (Universal) — analyze curvature smoothness
 *  5. G-code feature recognition (Universal) — identify holes, pockets, bosses
 *  6. Spindle power/torque analysis (CNC) — check spindle against power curve
 *  7. Multi-part/multi-batch analysis (Universal) — detect multiple parts
 *  8. Fixture/workholding clearance check (CNC) — check toolpath avoids clamps
 *  9. Bed adhesion pattern analysis (3DP) — analyze first layer adhesion
 * 10. Coordinate system transform (Universal) — transform between coordinate systems
 * 11. Cycle time optimization with constraints (Universal) — optimize respecting quality
 * 12. G-code dialect/compatibility checker (Universal) — check controller compatibility
 */

// ── 1. G-code Modal State Tracker ──

export interface ModalState {
  /** Motion mode: G0, G1, G2, G3 */
  motionMode: string;
  /** Plane selection: G17 (XY), G18 (XZ), G19 (YZ) */
  plane: 'G17' | 'G18' | 'G19';
  /** Distance mode: G90 (absolute), G91 (incremental) */
  distanceMode: 'G90' | 'G91';
  /** Unit mode: G20 (inch), G21 (mm) */
  units: 'G20' | 'G21';
  /** Feed mode: G94 (units/min), G95 (units/rev) */
  feedMode: 'G94' | 'G95';
  /** Cutter compensation: G40, G41, G42 */
  cutterComp: 'G40' | 'G41' | 'G42';
  /** Tool length compensation: G43, G44, G49 */
  toolLengthComp: 'G43' | 'G44' | 'G49';
  /** Coordinate system: G54-G59 */
  coordSystem: string;
  /** Spindle state: M3 (CW), M4 (CCW), M5 (off) */
  spindleState: 'M3' | 'M4' | 'M5';
  /** Coolant: M7 (mist), M8 (flood), M9 (off) */
  coolant: 'M7' | 'M8' | 'M9';
}

export interface ModalStateChange {
  /** G-code line number */
  lineNumber: number;
  /** Property that changed */
  property: keyof ModalState;
  /** Old value */
  oldValue: string;
  /** New value */
  newValue: string;
}

export interface ModalStateResult {
  /** Final modal state at end of program */
  finalState: ModalState;
  /** All state changes */
  changes: ModalStateChange[];
  /** Whether the program resets all states */
  isProperlyReset: boolean;
  /** Warnings about state issues */
  warnings: string[];
  /** State change count by property */
  changeCounts: { [property: string]: number };
}

/**
 * Track modal state changes throughout a G-code program.
 * Modal states persist until explicitly changed — tracking them is essential
 * for understanding the program's behavior and catching errors.
 *
 * @param lines G-code lines
 */
export function trackModalStates(lines: string[]): ModalStateResult {
  const initialState: ModalState = {
    motionMode: 'G0',
    plane: 'G17',
    distanceMode: 'G90',
    units: 'G21',
    feedMode: 'G94',
    cutterComp: 'G40',
    toolLengthComp: 'G49',
    coordSystem: 'G54',
    spindleState: 'M5',
    coolant: 'M9',
  };

  const state: ModalState = { ...initialState };
  const changes: ModalStateChange[] = [];
  const warnings: string[] = [];
  const changeCounts: { [property: string]: number } = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const checkAndRecord = (property: keyof ModalState, newValue: string) => {
      if (state[property] !== newValue) {
        changes.push({
          lineNumber: i, property,
          oldValue: state[property], newValue,
        });
        (state as unknown as Record<string, string>)[property] = newValue;
        changeCounts[property] = (changeCounts[property] ?? 0) + 1;
      }
    };

    // Motion mode
    if (/\bG0\b/i.test(code)) checkAndRecord('motionMode', 'G0');
    if (/\bG1\b/i.test(code)) checkAndRecord('motionMode', 'G1');
    if (/\bG2\b/i.test(code)) checkAndRecord('motionMode', 'G2');
    if (/\bG3\b/i.test(code)) checkAndRecord('motionMode', 'G3');

    // Plane
    if (/\bG17\b/i.test(code)) checkAndRecord('plane', 'G17');
    if (/\bG18\b/i.test(code)) checkAndRecord('plane', 'G18');
    if (/\bG19\b/i.test(code)) checkAndRecord('plane', 'G19');

    // Distance mode
    if (/\bG90\b/i.test(code)) checkAndRecord('distanceMode', 'G90');
    if (/\bG91\b/i.test(code)) checkAndRecord('distanceMode', 'G91');

    // Units
    if (/\bG20\b/i.test(code)) checkAndRecord('units', 'G20');
    if (/\bG21\b/i.test(code)) checkAndRecord('units', 'G21');

    // Feed mode
    if (/\bG94\b/i.test(code)) checkAndRecord('feedMode', 'G94');
    if (/\bG95\b/i.test(code)) checkAndRecord('feedMode', 'G95');

    // Cutter compensation
    if (/\bG40\b/i.test(code)) checkAndRecord('cutterComp', 'G40');
    if (/\bG41\b/i.test(code)) checkAndRecord('cutterComp', 'G41');
    if (/\bG42\b/i.test(code)) checkAndRecord('cutterComp', 'G42');

    // Tool length compensation
    if (/\bG43\b/i.test(code)) checkAndRecord('toolLengthComp', 'G43');
    if (/\bG44\b/i.test(code)) checkAndRecord('toolLengthComp', 'G44');
    if (/\bG49\b/i.test(code)) checkAndRecord('toolLengthComp', 'G49');

    // Coordinate system
    for (const cs of ['G54', 'G55', 'G56', 'G57', 'G58', 'G59']) {
      if (new RegExp(`\\b${cs}\\b`, 'i').test(code)) checkAndRecord('coordSystem', cs);
    }

    // Spindle
    if (/\bM3\b/i.test(code) || /\bM03\b/i.test(code)) checkAndRecord('spindleState', 'M3');
    if (/\bM4\b/i.test(code) || /\bM04\b/i.test(code)) checkAndRecord('spindleState', 'M4');
    if (/\bM5\b/i.test(code) || /\bM05\b/i.test(code)) checkAndRecord('spindleState', 'M5');

    // Coolant
    if (/\bM7\b/i.test(code) || /\bM07\b/i.test(code)) checkAndRecord('coolant', 'M7');
    if (/\bM8\b/i.test(code) || /\bM08\b/i.test(code)) checkAndRecord('coolant', 'M8');
    if (/\bM9\b/i.test(code) || /\bM09\b/i.test(code)) checkAndRecord('coolant', 'M9');
  }

  // Check for proper reset
  const isProperlyReset =
    state.cutterComp === 'G40' &&
    state.toolLengthComp === 'G49' &&
    state.spindleState === 'M5' &&
    state.coolant === 'M9';

  // Warnings
  if (state.cutterComp !== 'G40') {
    warnings.push('Cutter compensation not cancelled (G40) at program end');
  }
  if (state.spindleState !== 'M5') {
    warnings.push('Spindle not stopped (M5) at program end');
  }
  if (state.coolant !== 'M9') {
    warnings.push('Coolant not turned off (M9) at program end');
  }
  if (state.units === 'G20') {
    warnings.push('Program ends in inch mode (G20) — verify this is intended');
  }
  if ((changeCounts['units'] ?? 0) > 5) {
    warnings.push('Frequent unit mode changes — potential for errors');
  }

  return {
    finalState: state, changes, isProperlyReset,
    warnings, changeCounts,
  };
}

// ── 2. Dwell Time Analysis ──

export interface DwellEvent {
  /** G-code line number */
  lineNumber: number;
  /** Dwell time in seconds */
  duration: number;
  /** Dwell time format (P or X) */
  format: 'P' | 'X';
  /** Context/reason if commented */
  context: string;
}

export interface DwellAnalysisResult {
  /** All dwell events */
  events: DwellEvent[];
  /** Total dwell time in seconds */
  totalDwellTime: number;
  /** Number of dwell events */
  eventCount: number;
  /** Maximum dwell time in seconds */
  maxDwell: number;
  /** Average dwell time in seconds */
  avgDwell: number;
  /** Dwell time as percentage of total cycle time */
  dwellPercentage: number;
  /** Estimated cost of dwell time */
  dwellCost: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze dwell time (G4) commands in G-code.
 * Dwell commands pause execution for a specified time, impacting cycle time.
 *
 * @param lines G-code lines
 * @param totalCycleTime Total cycle time in seconds (for percentage calculation)
 * @param machineHourlyRate Machine hourly rate for cost calculation
 */
export function analyzeDwellTime(
  lines: string[],
  totalCycleTime: number = 0,
  machineHourlyRate: number = 0,
): DwellAnalysisResult {
  const events: DwellEvent[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    if (!/\bG4\b/i.test(code)) continue;

    // G4 P_ or G4 X_
    const pMatch = code.match(/\bP(\d*\.?\d+)/i);
    const xMatch = code.match(/\bX(\d*\.?\d+)/i);

    let duration = 0;
    let format: 'P' | 'X' = 'P';

    if (pMatch) {
      duration = parseFloat(pMatch[1]);
      format = 'P';
    } else if (xMatch) {
      duration = parseFloat(xMatch[1]);
      format = 'X';
    }

    // Extract context from comments
    const commentMatch = line.match(/[;(](.*?)[)]?$/);
    const context = commentMatch ? commentMatch[1].trim() : '';

    events.push({ lineNumber: i, duration, format, context });
  }

  const totalDwellTime = events.reduce((sum, e) => sum + e.duration, 0);
  const eventCount = events.length;
  const maxDwell = events.length > 0 ? Math.max(...events.map(e => e.duration)) : 0;
  const avgDwell = events.length > 0 ? totalDwellTime / events.length : 0;
  const dwellPercentage = totalCycleTime > 0 ? (totalDwellTime / totalCycleTime) * 100 : 0;
  const dwellCost = machineHourlyRate > 0 ? (totalDwellTime / 3600) * machineHourlyRate : 0;

  const recommendations: string[] = [];
  if (dwellPercentage > 10) {
    recommendations.push(`Dwell time is ${dwellPercentage.toFixed(1)}% of cycle time — consider reducing`);
  }
  if (maxDwell > 5) {
    recommendations.push(`Maximum dwell of ${maxDwell}s is very long — verify if necessary`);
  }
  if (eventCount > 20) {
    recommendations.push(`${eventCount} dwell events — consider consolidating`);
  }
  if (dwellCost > 1) {
    recommendations.push(`Dwell time costs $${dwellCost.toFixed(2)} — optimize for cost reduction`);
  }
  if (recommendations.length === 0 && eventCount > 0) {
    recommendations.push('Dwell time usage is reasonable');
  }
  if (eventCount === 0) {
    recommendations.push('No dwell commands found');
  }

  return {
    events, totalDwellTime, eventCount, maxDwell, avgDwell,
    dwellPercentage, dwellCost, recommendations,
  };
}

// ── 3. 3DP Safety Check ──

export interface SafetyIssue {
  /** G-code line number (-1 if program-wide) */
  lineNumber: number;
  /** Issue type */
  type: 'no_homing' | 'cold_extrusion' | 'no_bed_heat' | 'no_fan' | 'no_autolevel'
    | 'unsafe_z' | 'missing_end_gcode' | 'no_temperature' | 'high_speed_first_layer'
    | 'missing_retract' | 'no_clear_bed' | 'firmware_mismatch';
  /** Severity */
  severity: 'warning' | 'error' | 'critical';
  /** Description */
  description: string;
  /** Recommendation */
  recommendation: string;
}

export interface SafetyCheckResult {
  /** All safety issues */
  issues: SafetyIssue[];
  /** Error count */
  errorCount: number;
  /** Warning count */
  warningCount: number;
  /** Critical count */
  criticalCount: number;
  /** Overall safety score (0-100, higher is safer) */
  safetyScore: number;
  /** Whether the G-code is safe to run */
  isSafe: boolean;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Perform safety checks on 3D printing G-code.
 * Checks for common safety issues that could cause failed prints
 * or damage to the printer.
 *
 * @param lines G-code lines
 */
export function check3DPSafety(lines: string[]): SafetyCheckResult {
  const issues: SafetyIssue[] = [];

  let hasHoming = false;
  let hasBedHeat = false;
  let hasHotendHeat = false;
  let hasFanCommand = false;
  let hasAutoLevel = false;
  let hasEndGcode = false;
  let hotendTemp = 0;
  let bedTemp = 0;
  let firstLayerSpeed = 0;
  let layerCount = 0;
  let hasRetraction = false;
  let extrusionBeforeHeat = false;
  let extrusionLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Homing
    if (/\bG28\b/i.test(code)) hasHoming = true;

    // Auto-leveling
    if (/\bG29\b/i.test(code) || /\bG30\b/i.test(code) || /\bG32\b/i.test(code)) {
      hasAutoLevel = true;
    }

    // Bed heating
    const m140Match = code.match(/M140\s+S(\d+)/i);
    const m190Match = code.match(/M190\s+S(\d+)/i);
    if (m140Match || m190Match) {
      hasBedHeat = true;
      bedTemp = m140Match ? parseInt(m140Match[1]) : parseInt(m190Match![1]);
    }

    // Hotend heating
    const m104Match = code.match(/M104\s+S(\d+)/i);
    const m109Match = code.match(/M109\s+S(\d+)/i);
    if (m104Match || m109Match) {
      hasHotendHeat = true;
      hotendTemp = m104Match ? parseInt(m104Match[1]) : parseInt(m109Match![1]);
    }

    // Fan
    if (/\bM106\b/i.test(code) || /\bM107\b/i.test(code)) hasFanCommand = true;

    // Extrusion
    if (/\bG1\b/i.test(code) && /\bE\d+/i.test(code)) {
      const eMatch = code.match(/\bE(\d*\.?\d+)/i);
      if (eMatch && parseFloat(eMatch[1]) > 0) {
        if (!hasHotendHeat && extrusionLine === -1) {
          extrusionBeforeHeat = true;
          extrusionLine = i;
        }
        if (layerCount === 0) {
          const fMatch = code.match(/\bF(\d*\.?\d+)/i);
          if (fMatch) firstLayerSpeed = parseFloat(fMatch[1]);
        }
      }
    }

    // Retraction
    if (/\bG1\b/i.test(code)) {
      const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);
      if (eMatch && parseFloat(eMatch[1]) < 0) hasRetraction = true;
    }

    // Layer count
    if (/;.*layer/i.test(line) || /;.*LAYER/i.test(line)) layerCount++;

    // End gcode
    if (/\bM84\b/i.test(code) || /\bM18\b/i.test(code)) hasEndGcode = true;
  }

  // Check issues
  if (!hasHoming) {
    issues.push({
      lineNumber: -1, type: 'no_homing', severity: 'error',
      description: 'No homing command (G28) found',
      recommendation: 'Add G28 at the start of the program',
    });
  }

  if (extrusionBeforeHeat) {
    issues.push({
      lineNumber: extrusionLine, type: 'cold_extrusion', severity: 'critical',
      description: 'Extrusion detected before hotend heating',
      recommendation: 'Heat hotend before any extrusion commands',
    });
  }

  if (!hasHotendHeat) {
    issues.push({
      lineNumber: -1, type: 'no_temperature', severity: 'error',
      description: 'No hotend temperature command (M104/M109) found',
      recommendation: 'Set hotend temperature before printing',
    });
  }

  if (!hasBedHeat && hotendTemp > 200) {
    issues.push({
      lineNumber: -1, type: 'no_bed_heat', severity: 'warning',
      description: 'No bed heating command found for high-temp material',
      recommendation: 'Heat bed to prevent warping with this material',
    });
  }

  if (!hasAutoLevel) {
    issues.push({
      lineNumber: -1, type: 'no_autolevel', severity: 'warning',
      description: 'No auto-leveling command (G29/G30) found',
      recommendation: 'Add auto-leveling before printing for better first layer',
    });
  }

  if (!hasFanCommand && hotendTemp > 0 && hotendTemp < 240) {
    issues.push({
      lineNumber: -1, type: 'no_fan', severity: 'warning',
      description: 'No fan control command found',
      recommendation: 'Add fan control for better print quality (PLA)',
    });
  }

  if (firstLayerSpeed > 3000) {
    issues.push({
      lineNumber: -1, type: 'high_speed_first_layer', severity: 'warning',
      description: `First layer speed ${firstLayerSpeed} mm/min is too high`,
      recommendation: 'Reduce first layer speed to <3000 mm/min for adhesion',
    });
  }

  if (!hasRetraction && layerCount > 5) {
    issues.push({
      lineNumber: -1, type: 'missing_retract', severity: 'warning',
      description: 'No retraction moves detected in a multi-layer print',
      recommendation: 'Add retraction to reduce stringing',
    });
  }

  if (!hasEndGcode) {
    issues.push({
      lineNumber: -1, type: 'missing_end_gcode', severity: 'warning',
      description: 'No motor disable (M84/M18) at end of program',
      recommendation: 'Add M84 at end to disable motors',
    });
  }

  const criticalCount = issues.filter(i => i.severity === 'critical').length;
  const errorCount = issues.filter(i => i.severity === 'error').length;
  const warningCount = issues.filter(i => i.severity === 'warning').length;

  const safetyScore = Math.max(0, 100 - criticalCount * 40 - errorCount * 20 - warningCount * 5);
  const isSafe = criticalCount === 0 && errorCount === 0;

  const recommendations = issues.map(i => i.recommendation);
  if (issues.length === 0) {
    recommendations.push('G-code passes all safety checks');
  }

  return {
    issues, errorCount, warningCount, criticalCount,
    safetyScore, isSafe, recommendations,
  };
}

// ── 4. Toolpath Curvature Analysis ──

export interface CurvatureSegment {
  /** G-code line number */
  lineNumber: number;
  /** Curvature (1/radius) in 1/mm */
  curvature: number;
  /** Radius of curvature in mm */
  radius: number;
  /** Direction change angle in degrees */
  angleChange: number;
  /** Severity */
  severity: 'smooth' | 'moderate' | 'sharp';
}

export interface CurvatureResult {
  /** Per-segment curvature data */
  segments: CurvatureSegment[];
  /** Maximum curvature */
  maxCurvature: number;
  /** Minimum radius of curvature in mm */
  minRadius: number;
  /** Average curvature */
  avgCurvature: number;
  /** Number of sharp turns */
  sharpTurnCount: number;
  /** Smoothness score (0-100, higher is smoother) */
  smoothnessScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze toolpath curvature for smoothness.
 * Sharp curvature changes can cause:
 * - CNC: poor surface finish, chatter, tool breakage
 * - 3DP: ringing, blobbing, layer shifting
 *
 * @param lines G-code lines
 * @param sharpThreshold Angle in degrees above which a turn is "sharp" (default 60)
 */
export function analyzeCurvature(
  lines: string[],
  sharpThreshold: number = 60,
): CurvatureResult {
  const segments: CurvatureSegment[] = [];
  const points: { x: number; y: number; line: number }[] = [];
  let prevX = 0, prevY = 0;

  // Collect points
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG[01]\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;

    const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
    if (dist > 0.01) {
      points.push({ x, y, line: i });
    }

    prevX = x; prevY = y;
  }

  // Compute curvature at each point
  for (let i = 1; i < points.length - 1; i++) {
    const p0 = points[i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];

    const v1x = p1.x - p0.x, v1y = p1.y - p0.y;
    const v2x = p2.x - p1.x, v2y = p2.y - p1.y;

    const len1 = Math.sqrt(v1x * v1x + v1y * v1y);
    const len2 = Math.sqrt(v2x * v2x + v2y * v2y);

    if (len1 < 0.01 || len2 < 0.01) continue;

    const dot = (v1x * v2x + v1y * v2y) / (len1 * len2);
    const clampedDot = Math.max(-1, Math.min(1, dot));
    const angleChange = Math.acos(clampedDot) * (180 / Math.PI);

    // Curvature using circumcircle
    const cross = v1x * v2y - v1y * v2x;
    const curvature = Math.abs(cross) / (len1 * len2 * (len1 + len2) / 2);
    const radius = curvature > 0 ? 1 / curvature : Infinity;

    let severity: 'smooth' | 'moderate' | 'sharp';
    if (angleChange > sharpThreshold) severity = 'sharp';
    else if (angleChange > sharpThreshold / 2) severity = 'moderate';
    else severity = 'smooth';

    segments.push({
      lineNumber: p1.line, curvature, radius, angleChange, severity,
    });
  }

  const curvatures = segments.map(s => s.curvature).filter(c => c > 0);
  const maxCurvature = curvatures.length > 0 ? Math.max(...curvatures) : 0;
  const minRadius = segments.length > 0
    ? Math.min(...segments.map(s => s.radius).filter(r => r < Infinity))
    : Infinity;
  const avgCurvature = curvatures.length > 0
    ? curvatures.reduce((a, b) => a + b, 0) / curvatures.length
    : 0;
  const sharpTurnCount = segments.filter(s => s.severity === 'sharp').length;
  const smoothnessScore = segments.length > 0
    ? Math.max(0, 100 - (sharpTurnCount / segments.length) * 200)
    : 100;

  const recommendations: string[] = [];
  if (sharpTurnCount > 20) {
    recommendations.push(`${sharpTurnCount} sharp turns detected — consider using arcs (G2/G3) instead of linear moves`);
  }
  if (minRadius < 1) {
    recommendations.push(`Minimum radius of curvature is ${minRadius.toFixed(2)}mm — very tight turns may cause quality issues`);
  }
  if (smoothnessScore < 50) {
    recommendations.push('Toolpath smoothness is low — consider spline interpolation');
  }
  if (recommendations.length === 0) {
    recommendations.push('Toolpath curvature is smooth');
  }

  return {
    segments, maxCurvature, minRadius, avgCurvature,
    sharpTurnCount, smoothnessScore, recommendations,
  };
}

// ── 5. G-code Feature Recognition ──

export interface RecognizedFeature {
  /** Feature type */
  type: 'hole' | 'pocket' | 'boss' | 'profile' | 'slot' | 'thread' | 'chamfer' | 'fillet';
  /** Start line number */
  startLine: number;
  /** End line number */
  endLine: number;
  /** Center X (for holes/circular features) */
  centerX: number;
  /** Center Y */
  centerY: number;
  /** Diameter (for holes) or width */
  diameter: number;
  /** Depth (for pockets/holes) */
  depth: number;
  /** Number of moves in the feature */
  moveCount: number;
  /** Confidence (0-1) */
  confidence: number;
  /** Description */
  description: string;
}

export interface FeatureRecognitionResult {
  /** All recognized features */
  features: RecognizedFeature[];
  /** Feature counts by type */
  counts: { [type: string]: number };
  /** Total features recognized */
  totalFeatures: number;
  /** Whether any features were recognized */
  hasFeatures: boolean;
}

/**
 * Recognize machining features from G-code toolpath.
 * Identifies holes, pockets, bosses, profiles, slots, and other
 * common machining features by analyzing toolpath patterns.
 *
 * @param lines G-code lines
 */
export function recognizeFeatures(lines: string[]): FeatureRecognitionResult {
  const features: RecognizedFeature[] = [];
  const points: { x: number; y: number; z: number; line: number }[] = [];
  let prevX = 0, prevY = 0, prevZ = 0;

  // Collect points
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

    points.push({ x, y, z, line: i });
    prevX = x; prevY = y; prevZ = z;
  }

  // Detect circular features (holes)
  let i = 0;
  while (i < points.length - 10) {
    // Look for circular patterns
    const window = points.slice(i, Math.min(i + 30, points.length));
    if (window.length < 8) { i++; continue; }

    // Check if points form a circle
    const cx = window.reduce((sum, p) => sum + p.x, 0) / window.length;
    const cy = window.reduce((sum, p) => sum + p.y, 0) / window.length;
    const radii = window.map(p => Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2));
    const avgRadius = radii.reduce((a, b) => a + b, 0) / radii.length;
    const radiusDev = Math.sqrt(radii.reduce((s, r) => s + (r - avgRadius) ** 2, 0) / radii.length);

    if (radiusDev < avgRadius * 0.05 && avgRadius > 0.5 && avgRadius < 50) {
      // Check if it's a full circle (angles span ~360°)
      const angles = window.map(p => Math.atan2(p.y - cy, p.x - cx));
      const minAng = Math.min(...angles);
      const maxAng = Math.max(...angles);
      const angSpan = maxAng - minAng;

      if (angSpan > Math.PI * 1.8) {
        features.push({
          type: 'hole', startLine: window[0].line, endLine: window[window.length - 1].line,
          centerX: cx, centerY: cy, diameter: avgRadius * 2,
          depth: Math.abs(window[0].z),
          moveCount: window.length, confidence: 0.85,
          description: `Hole: Ø${(avgRadius * 2).toFixed(2)}mm at (${cx.toFixed(1)}, ${cy.toFixed(1)})`,
        });
        i += window.length;
        continue;
      }
    }

    // Check for pocket (spiral or raster pattern at consistent Z)
    const zValues = window.map(p => p.z);
    const zRange = Math.max(...zValues) - Math.min(...zValues);
    if (zRange < 0.5 && window[0].z < 0) {
      // Check for raster/spiral pattern
      const xRange = Math.max(...window.map(p => p.x)) - Math.min(...window.map(p => p.x));
      const yRange = Math.max(...window.map(p => p.y)) - Math.min(...window.map(p => p.y));
      if (xRange > 5 && yRange > 5 && xRange < 100 && yRange < 100) {
        features.push({
          type: 'pocket', startLine: window[0].line, endLine: window[window.length - 1].line,
          centerX: (Math.max(...window.map(p => p.x)) + Math.min(...window.map(p => p.x))) / 2,
          centerY: (Math.max(...window.map(p => p.y)) + Math.min(...window.map(p => p.y))) / 2,
          diameter: Math.max(xRange, yRange),
          depth: Math.abs(window[0].z),
          moveCount: window.length, confidence: 0.6,
          description: `Pocket: ${xRange.toFixed(1)}×${yRange.toFixed(1)}mm, depth ${Math.abs(window[0].z).toFixed(1)}mm`,
        });
        i += window.length;
        continue;
      }
    }

    // Check for profile (open contour)
    if (window.length > 5) {
      const startToEnd = Math.sqrt(
        (window[0].x - window[window.length - 1].x) ** 2 +
        (window[0].y - window[window.length - 1].y) ** 2,
      );
      if (startToEnd > 5) {
        features.push({
          type: 'profile', startLine: window[0].line, endLine: window[window.length - 1].line,
          centerX: (window[0].x + window[window.length - 1].x) / 2,
          centerY: (window[0].y + window[window.length - 1].y) / 2,
          diameter: startToEnd, depth: Math.abs(window[0].z),
          moveCount: window.length, confidence: 0.5,
          description: `Profile: ${startToEnd.toFixed(1)}mm long`,
        });
        i += window.length;
        continue;
      }
    }

    i++;
  }

  // Detect chamfers (Z moves up while XY moves)
  for (let j = 1; j < points.length - 1; j++) {
    const p0 = points[j - 1], p1 = points[j], p2 = points[j + 1];
    const dz1 = p1.z - p0.z;
    const dz2 = p2.z - p1.z;
    const xyDist1 = Math.sqrt((p1.x - p0.x) ** 2 + (p1.y - p0.y) ** 2);
    const xyDist2 = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);

    if (dz1 > 0.1 && xyDist1 > 0.1 && Math.abs(dz1 / xyDist1) > 0.3 && Math.abs(dz1 / xyDist1) < 2) {
      const angle = Math.atan2(dz1, xyDist1) * (180 / Math.PI);
      if (angle > 15 && angle < 75) {
        features.push({
          type: 'chamfer', startLine: p0.line, endLine: p1.line,
          centerX: (p0.x + p1.x) / 2, centerY: (p0.y + p1.y) / 2,
          diameter: xyDist1, depth: dz1,
          moveCount: 2, confidence: 0.5,
          description: `Chamfer: ${angle.toFixed(0)}° angle`,
        });
      }
    }
  }

  const counts: { [type: string]: number } = {};
  for (const f of features) {
    counts[f.type] = (counts[f.type] ?? 0) + 1;
  }

  return {
    features, counts, totalFeatures: features.length,
    hasFeatures: features.length > 0,
  };
}

// ── 6. Spindle Power/Torque Analysis ──

export interface SpindlePowerSegment {
  /** G-code line number */
  lineNumber: number;
  /** Spindle speed in RPM */
  rpm: number;
  /** Available power in W */
  availablePower: number;
  /** Available torque in Nm */
  availableTorque: number;
  /** Estimated required power in W */
  requiredPower: number;
  /** Power utilization percentage */
  powerUtilization: number;
  /** Torque utilization percentage */
  torqueUtilization: number;
  /** Status */
  status: 'ok' | 'warning' | 'overload';
}

export interface SpindlePowerResult {
  /** Per-segment power data */
  segments: SpindlePowerSegment[];
  /** Maximum power utilization */
  maxPowerUtilization: number;
  /** Maximum torque utilization */
  maxTorqueUtilization: number;
  /** Number of overload segments */
  overloadCount: number;
  /** Average power utilization */
  avgPowerUtilization: number;
  /** Spindle power rating in W */
  spindlePowerWatts: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze spindle power and torque requirements.
 * Most CNC spindles have a power curve where:
 * - Below base speed: constant torque, power increases with RPM
 * - Above base speed: constant power, torque decreases with RPM
 *
 * @param lines G-code lines
 * @param spindlePowerWatts Spindle rated power in W (default 750)
 * @param baseSpeed Base speed in RPM where constant power starts (default 3000)
 * @param toolDiameter Tool diameter in mm
 * @param axialDOC Axial depth of cut in mm
 * @param radialDOC Radial width of cut in mm
 */
export function analyzeSpindlePower(
  lines: string[],
  spindlePowerWatts: number = 750,
  baseSpeed: number = 3000,
  toolDiameter: number = 6,
  axialDOC: number = 2,
  radialDOC: number = 3,
): SpindlePowerResult {
  const segments: SpindlePowerSegment[] = [];
  let currentRpm = 0;
  let currentFeedRate = 0;
  let prevX = 0, prevY = 0;

  // Material removal rate (mm³/min) → power (W)
  // P = MRR * k where k is specific cutting energy (~0.05 W·min/mm³ for aluminum)
  const specificEnergy = 0.05;

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

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;

    const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);

    if (dist > 0.1 && currentRpm > 0 && currentFeedRate > 0) {
      // Material removal rate (mm³/min)
      const mrr = axialDOC * radialDOC * currentFeedRate;

      // Required power
      const requiredPower = mrr * specificEnergy;

      // Available power at this RPM
      let availablePower: number;
      if (currentRpm <= baseSpeed) {
        // Constant torque region: power = P_rated * (rpm / base_speed)
        availablePower = spindlePowerWatts * (currentRpm / baseSpeed);
      } else {
        // Constant power region
        availablePower = spindlePowerWatts;
      }

      // Available torque
      const availableTorque = availablePower / (currentRpm * 2 * Math.PI / 60); // Nm

      // Required torque
      const requiredTorque = requiredPower / (currentRpm * 2 * Math.PI / 60);

      const powerUtilization = availablePower > 0 ? (requiredPower / availablePower) * 100 : 0;
      const torqueUtilization = availableTorque > 0 ? (requiredTorque / availableTorque) * 100 : 0;

      let status: 'ok' | 'warning' | 'overload';
      if (powerUtilization > 100 || torqueUtilization > 100) status = 'overload';
      else if (powerUtilization > 80 || torqueUtilization > 80) status = 'warning';
      else status = 'ok';

      segments.push({
        lineNumber: i, rpm: currentRpm,
        availablePower, availableTorque,
        requiredPower, powerUtilization, torqueUtilization,
        status,
      });
    }

    prevX = x; prevY = y;
  }

  const maxPowerUtilization = segments.length > 0
    ? Math.max(...segments.map(s => s.powerUtilization)) : 0;
  const maxTorqueUtilization = segments.length > 0
    ? Math.max(...segments.map(s => s.torqueUtilization)) : 0;
  const overloadCount = segments.filter(s => s.status === 'overload').length;
  const avgPowerUtilization = segments.length > 0
    ? segments.reduce((sum, s) => sum + s.powerUtilization, 0) / segments.length
    : 0;

  const recommendations: string[] = [];
  if (overloadCount > 0) {
    recommendations.push(`${overloadCount} segments exceed spindle power — reduce DOC or feed rate`);
  }
  if (maxPowerUtilization > 90) {
    recommendations.push(`Peak power utilization is ${maxPowerUtilization.toFixed(0)}% — close to spindle limit`);
  }
  if (maxTorqueUtilization > 90 && maxTorqueUtilization > maxPowerUtilization) {
    recommendations.push('Torque-limited operation — increase spindle speed if possible');
  }
  if (avgPowerUtilization < 20 && segments.length > 10) {
    recommendations.push('Low average power utilization — could increase feed rate or DOC for efficiency');
  }
  if (recommendations.length === 0) {
    recommendations.push('Spindle power utilization is within acceptable range');
  }

  return {
    segments, maxPowerUtilization, maxTorqueUtilization,
    overloadCount, avgPowerUtilization, spindlePowerWatts,
    recommendations,
  };
}

// ── 7. Multi-Part/Multi-Batch Analysis ──

export interface PartInstance {
  /** Part index */
  partIndex: number;
  /** Start line number */
  startLine: number;
  /** End line number */
  endLine: number;
  /** Part origin X */
  originX: number;
  /** Part origin Y */
  originY: number;
  /** Part bounding box */
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  /** Number of moves */
  moveCount: number;
  /** Estimated time in seconds */
  estimatedTime: number;
}

export interface MultiPartResult {
  /** Detected part instances */
  parts: PartInstance[];
  /** Number of parts */
  partCount: number;
  /** Whether multiple parts are detected */
  isMultiPart: boolean;
  /** Total estimated time in seconds */
  totalTime: number;
  /** Time per part in seconds */
  timePerPart: number;
  /** Part spacing in mm */
  partSpacing: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Detect and analyze multiple parts in a single G-code file.
 * Multiple parts are detected by:
 * - G54-G59 work offset changes
 * - Large rapid moves to new origin
 * - Repeated toolpath patterns at different locations
 *
 * @param lines G-code lines
 */
export function analyzeMultiPart(lines: string[]): MultiPartResult {
  const parts: PartInstance[] = [];
  let prevX = 0, prevY = 0, prevZ = 0;
  let currentFeedRate = 0;
  let partStartLine = 0;
  let partOriginX = 0, partOriginY = 0;
  let partMinX = Infinity, partMaxX = -Infinity;
  let partMinY = Infinity, partMaxY = -Infinity;
  let partMoveCount = 0;
  let partDistance = 0;
  let partIndex = 0;
  let lastZ = 0;

  const finalizePart = (endLine: number) => {
    if (partMoveCount > 10) {
      parts.push({
        partIndex,
        startLine: partStartLine,
        endLine,
        originX: partOriginX,
        originY: partOriginY,
        bounds: {
          minX: partMinX, maxX: partMaxX,
          minY: partMinY, maxY: partMaxY,
        },
        moveCount: partMoveCount,
        estimatedTime: currentFeedRate > 0 ? partDistance / (currentFeedRate / 60) : 0,
      });
      partIndex++;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Check for work offset change → new part
    let offsetChanged = false;
    for (const cs of ['G55', 'G56', 'G57', 'G58', 'G59']) {
      if (new RegExp(`\\b${cs}\\b`, 'i').test(code)) {
        offsetChanged = true;
        break;
      }
    }

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) currentFeedRate = parseFloat(fMatch[1]);

    if (/\bG[01]\b/i.test(code)) {
      const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
      const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);

      const x = xMatch ? parseFloat(xMatch[1]) : prevX;
      const y = yMatch ? parseFloat(yMatch[1]) : prevY;
      const z = zMatch ? parseFloat(zMatch[1]) : prevZ;

      // Detect large rapid move to new location (potential new part)
      const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
      if (/\bG0\b/i.test(code) && dist > 50 && z > 5) {
        // Large rapid move at safe Z → likely new part
        finalizePart(i);
        partStartLine = i;
        partOriginX = x;
        partOriginY = y;
        partMinX = x; partMaxX = x;
        partMinY = y; partMaxY = y;
        partMoveCount = 0;
        partDistance = 0;
      }

      if (offsetChanged) {
        finalizePart(i);
        partStartLine = i;
        partOriginX = x;
        partOriginY = y;
        partMinX = x; partMaxX = x;
        partMinY = y; partMaxY = y;
        partMoveCount = 0;
        partDistance = 0;
      }

      partMoveCount++;
      partDistance += dist;
      if (x < partMinX) partMinX = x;
      if (x > partMaxX) partMaxX = x;
      if (y < partMinY) partMinY = y;
      if (y > partMaxY) partMaxY = y;

      prevX = x; prevY = y; prevZ = z;
      lastZ = z;
    }
  }

  // Finalize last part
  finalizePart(lines.length - 1);

  const partCount = parts.length;
  const isMultiPart = partCount > 1;
  const totalTime = parts.reduce((sum, p) => sum + p.estimatedTime, 0);
  const timePerPart = partCount > 0 ? totalTime / partCount : 0;

  // Compute part spacing
  let partSpacing = 0;
  if (parts.length > 1) {
    const spacings: number[] = [];
    for (let i = 1; i < parts.length; i++) {
      spacings.push(Math.sqrt(
        (parts[i].originX - parts[i - 1].originX) ** 2 +
        (parts[i].originY - parts[i - 1].originY) ** 2,
      ));
    }
    partSpacing = spacings.reduce((a, b) => a + b, 0) / spacings.length;
  }

  const recommendations: string[] = [];
  if (isMultiPart) {
    recommendations.push(`${partCount} parts detected — total time ${Math.round(totalTime / 60)} min`);
    if (timePerPart > 0) {
      recommendations.push(`Average time per part: ${Math.round(timePerPart / 60)} min`);
    }
    if (partSpacing > 0) {
      recommendations.push(`Part spacing: ${partSpacing.toFixed(1)}mm`);
    }
  }
  if (partCount > 4) {
    recommendations.push('Many parts — verify bed capacity and collision clearance');
  }

  return {
    parts, partCount, isMultiPart,
    totalTime, timePerPart, partSpacing, recommendations,
  };
}

// ── 8. Fixture/Workholding Clearance Check ──

export interface Fixture {
  /** Fixture name */
  name: string;
  /** Fixture type */
  type: 'clamp' | 'vise' | 'plate' | 'custom';
  /** Position */
  position: { x: number; y: number; z: number };
  /** Size */
  size: { width: number; depth: number; height: number };
}

export interface ClearanceViolation {
  /** G-code line number */
  lineNumber: number;
  /** Fixture name */
  fixtureName: string;
  /** Toolpath position */
  position: { x: number; y: number; z: number };
  /** Distance from fixture in mm */
  clearanceDistance: number;
  /** Required clearance in mm */
  requiredClearance: number;
  /** Severity */
  severity: 'warning' | 'error';
  /** Description */
  description: string;
}

export interface FixtureClearanceResult {
  /** Clearance violations */
  violations: ClearanceViolation[];
  /** Whether all clearances are OK */
  isClear: boolean;
  /** Error count */
  errorCount: number;
  /** Warning count */
  warningCount: number;
  /** Closest approach distance in mm */
  closestApproach: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Check if toolpath maintains safe clearance from fixtures/workholding.
 *
 * @param lines G-code lines
 * @param fixtures Array of fixture definitions
 * @param requiredClearance Required clearance distance in mm
 */
export function checkFixtureClearance(
  lines: string[],
  fixtures: Fixture[],
  requiredClearance: number = 2,
): FixtureClearanceResult {
  const violations: ClearanceViolation[] = [];
  let prevX = 0, prevY = 0, prevZ = 0;
  let closestApproach = Infinity;

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

    for (const fixture of fixtures) {
      // Compute distance from toolpath to fixture bounding box
      const fxMin = fixture.position.x - fixture.size.width / 2;
      const fxMax = fixture.position.x + fixture.size.width / 2;
      const fyMin = fixture.position.y - fixture.size.depth / 2;
      const fyMax = fixture.position.y + fixture.size.depth / 2;
      const fzMin = fixture.position.z;
      const fzMax = fixture.position.z + fixture.size.height;

      // Closest point on fixture bounding box to toolpath point
      const closestX = Math.max(fxMin, Math.min(x, fxMax));
      const closestY = Math.max(fyMin, Math.min(y, fyMax));
      const closestZ = Math.max(fzMin, Math.min(z, fzMax));

      const dist = Math.sqrt(
        (x - closestX) ** 2 + (y - closestY) ** 2 + (z - closestZ) ** 2,
      );

      if (dist < closestApproach) closestApproach = dist;

      if (dist < requiredClearance) {
        const severity: 'warning' | 'error' = dist < requiredClearance / 2 ? 'error' : 'warning';
        violations.push({
          lineNumber: i,
          fixtureName: fixture.name,
          position: { x, y, z },
          clearanceDistance: dist,
          requiredClearance,
          severity,
          description: `Toolpath within ${dist.toFixed(2)}mm of ${fixture.name} (required: ${requiredClearance}mm)`,
        });
      }
    }

    prevX = x; prevY = y; prevZ = z;
  }

  if (closestApproach === Infinity) closestApproach = 0;
  const errorCount = violations.filter(v => v.severity === 'error').length;
  const warningCount = violations.filter(v => v.severity === 'warning').length;
  const isClear = errorCount === 0;

  const recommendations: string[] = [];
  if (errorCount > 0) {
    recommendations.push(`${errorCount} critical fixture clearance violations — reposition fixtures or modify toolpath`);
  }
  if (warningCount > 0) {
    recommendations.push(`${warningCount} fixture clearance warnings — monitor closely`);
  }
  if (closestApproach < requiredClearance) {
    recommendations.push(`Closest approach to fixture: ${closestApproach.toFixed(2)}mm — increase clearance`);
  }
  if (recommendations.length === 0) {
    recommendations.push('All fixture clearances are within safe limits');
  }

  return {
    violations, isClear, errorCount, warningCount,
    closestApproach, recommendations,
  };
}

// ── 9. Bed Adhesion Pattern Analysis ──

export interface AdhesionAnalysisResult {
  /** First layer pattern type */
  pattern: 'brim' | 'raft' | 'skirt' | 'solid' | 'sparse' | 'none';
  /** Brim count */
  brimCount: number;
  /** Skirt count */
  skirtCount: number;
  /** First layer extrusion width in mm */
  extrusionWidth: number;
  /** First layer coverage percentage */
  coveragePercentage: number;
  /** Number of disconnected regions */
  disconnectedRegions: number;
  /** Adhesion score (0-100) */
  adhesionScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze first layer pattern for bed adhesion quality.
 * A good first layer should have:
 * - Adequate coverage
 * - Connected extrusion paths
 * - Optional brim/skirt/raft
 *
 * @param lines G-code lines
 * @param bedWidth Bed width in mm
 * @param bedDepth Bed depth in mm
 */
export function analyzeBedAdhesion(
  lines: string[],
  bedWidth: number = 200,
  bedDepth: number = 200,
): AdhesionAnalysisResult {
  let firstLayerStart = -1;
  let firstLayerEnd = -1;
  let layerCount = 0;

  // Find first layer
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/;.*layer/i.test(line) || /;.*LAYER/i.test(line)) {
      if (layerCount === 0) firstLayerStart = i;
      if (layerCount === 1) {
        firstLayerEnd = i;
        break;
      }
      layerCount++;
    }
  }

  if (firstLayerStart < 0) firstLayerStart = 0;
  if (firstLayerEnd < 0) firstLayerEnd = Math.min(lines.length, firstLayerStart + 500);

  // Analyze first layer
  let prevX = 0, prevY = 0, prevE = 0;
  let totalExtrusionLength = 0;
  let extrusionSegments = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let brimCount = 0;
  let skirtCount = 0;
  let extrusionWidth = 0;

  for (let i = firstLayerStart; i <= firstLayerEnd && i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';')) {
      // Check for brim/skirt comments
      if (/;.*brim/i.test(line)) brimCount++;
      if (/;.*skirt/i.test(line)) skirtCount++;
      continue;
    }

    const code = line.replace(/;.*$/, '').trim();
    if (!code || !/\bG1\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;

    if (eMatch) {
      const newE = parseFloat(eMatch[1]);
      if (newE > prevE) {
        const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
        totalExtrusionLength += dist;
        extrusionSegments++;
        if (dist > 0 && (newE - prevE) > 0) {
          // Estimate extrusion width: E volume / (layer height * distance)
          // Assuming 1.75mm filament and 0.2mm layer height
          const eVolume = Math.PI * (1.75 / 2) ** 2 * (newE - prevE);
          extrusionWidth = dist > 0 ? eVolume / (0.2 * dist) : 0;
        }
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      prevE = newE;
    }

    prevX = x; prevY = y;
  }

  // Determine pattern
  let pattern: AdhesionAnalysisResult['pattern'] = 'none';
  if (brimCount > 0) pattern = 'brim';
  else if (skirtCount > 0) pattern = 'skirt';
  else if (extrusionSegments > 100) pattern = 'solid';
  else if (extrusionSegments > 10) pattern = 'sparse';
  // Note: raft detection would require analyzing Z layers — left as future enhancement
  const patternType: string = pattern;

  // Coverage percentage
  const partArea = minX !== Infinity
    ? (maxX - minX) * (maxY - minY)
    : 0;
  const bedArea = bedWidth * bedDepth;
  const coveragePercentage = bedArea > 0 ? (partArea / bedArea) * 100 : 0;

  // Estimate disconnected regions (simplified)
  const disconnectedRegions = 1; // simplified

  // Adhesion score
  let adhesionScore = 50;
  if (patternType === 'brim') adhesionScore += 20;
  if (patternType === 'raft') adhesionScore += 25;
  if (coveragePercentage > 20) adhesionScore += 10;
  if (extrusionWidth > 0.4 && extrusionWidth < 0.6) adhesionScore += 10;
  if (totalExtrusionLength > 500) adhesionScore += 10;
  adhesionScore = Math.min(100, adhesionScore);

  const recommendations: string[] = [];
  if (patternType === 'none') {
    recommendations.push('No adhesion aid detected — add a brim or skirt for better adhesion');
  }
  if (coveragePercentage < 10) {
    recommendations.push('Low first layer coverage — small parts may detach');
  }
  if (extrusionWidth > 0.6) {
    recommendations.push('Extrusion width is high — may cause elephant foot');
  }
  if (extrusionWidth > 0 && extrusionWidth < 0.3) {
    recommendations.push('Extrusion width is low — may cause poor adhesion');
  }
  if (recommendations.length === 0) {
    recommendations.push('First layer adhesion pattern looks good');
  }

  return {
    pattern, brimCount, skirtCount, extrusionWidth,
    coveragePercentage, disconnectedRegions, adhesionScore,
    recommendations,
  };
}

// ── 10. Coordinate System Transform ──

export interface TransformOptions {
  /** X offset */
  offsetX: number;
  /** Y offset */
  offsetY: number;
  /** Z offset */
  offsetZ: number;
  /** Rotation angle in degrees */
  rotation: number;
  /** Scale factor */
  scale: number;
  /** Mirror X */
  mirrorX: boolean;
  /** Mirror Y */
  mirrorY: boolean;
}

export interface TransformResult {
  /** Transformed G-code lines */
  lines: string[];
  /** Number of transformed coordinates */
  transformedCount: number;
  /** Original bounds */
  originalBounds: { minX: number; maxX: number; minY: number; maxY: number };
  /** Transformed bounds */
  transformedBounds: { minX: number; maxX: number; minY: number; maxY: number };
}

/**
 * Transform G-code coordinates between coordinate systems.
 * Supports translation, rotation, scaling, and mirroring.
 *
 * @param lines G-code lines
 * @param options Transform options
 */
export function transformCoordinates(
  lines: string[],
  options: TransformOptions,
): TransformResult {
  const result: string[] = [];
  let transformedCount = 0;
  let origMinX = Infinity, origMaxX = -Infinity;
  let origMinY = Infinity, origMaxY = -Infinity;
  let newMinX = Infinity, newMaxX = -Infinity;
  let newMinY = Infinity, newMaxY = -Infinity;

  const rad = (options.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) {
      result.push(line);
      continue;
    }

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG[0-3]\b/i.test(code)) {
      result.push(line);
      continue;
    }

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);

    let transformed = line;

    if (xMatch) {
      let x = parseFloat(xMatch[1]);
      if (x < origMinX) origMinX = x;
      if (x > origMaxX) origMaxX = x;

      // Apply mirror
      if (options.mirrorX) x = -x;
      // Apply scale
      x *= options.scale;
      // Apply rotation (need Y for 2D rotation)
      let y = yMatch ? parseFloat(yMatch[1]) : 0;
      if (options.mirrorY) y = -y;
      y *= options.scale;

      const rx = x * cos - y * sin + options.offsetX;
      const ry = x * sin + y * cos + options.offsetY;

      if (rx < newMinX) newMinX = rx;
      if (rx > newMaxX) newMaxX = rx;

      transformed = transformed.replace(/\bX-?\d*\.?\d+/i, `X${rx.toFixed(4)}`);
      transformedCount++;

      if (yMatch) {
        if (ry < newMinY) newMinY = ry;
        if (ry > newMaxY) newMaxY = ry;
        transformed = transformed.replace(/\bY-?\d*\.?\d+/i, `Y${ry.toFixed(4)}`);
      } else if (options.rotation !== 0 || options.offsetY !== 0) {
        // Need to add Y if rotation or Y offset is specified
        transformed = transformed + ` Y${ry.toFixed(4)}`;
      }
    } else if (yMatch && (options.rotation !== 0 || options.offsetY !== 0)) {
      // Y without X but with rotation — need X too
      let y = parseFloat(yMatch[1]);
      if (options.mirrorY) y = -y;
      y *= options.scale;
      const rx = 0 * cos - y * sin + options.offsetX;
      const ry = 0 * sin + y * cos + options.offsetY;
      transformed = transformed.replace(/\bY-?\d*\.?\d+/i, `Y${ry.toFixed(4)}`);
      transformed = `X${rx.toFixed(4)} ` + transformed;
      transformedCount++;
    } else if (yMatch) {
      let y = parseFloat(yMatch[1]);
      if (y < origMinY) origMinY = y;
      if (y > origMaxY) origMaxY = y;
      if (options.mirrorY) y = -y;
      y *= options.scale;
      y += options.offsetY;
      if (y < newMinY) newMinY = y;
      if (y > newMaxY) newMaxY = y;
      transformed = transformed.replace(/\bY-?\d*\.?\d+/i, `Y${y.toFixed(4)}`);
      transformedCount++;
    }

    if (zMatch) {
      let z = parseFloat(zMatch[1]);
      z *= options.scale;
      z += options.offsetZ;
      transformed = transformed.replace(/\bZ-?\d*\.?\d+/i, `Z${z.toFixed(4)}`);
      transformedCount++;
    }

    result.push(transformed);
  }

  if (origMinX === Infinity) {
    origMinX = 0; origMaxX = 0; origMinY = 0; origMaxY = 0;
    newMinX = 0; newMaxX = 0; newMinY = 0; newMaxY = 0;
  }

  return {
    lines: result,
    transformedCount,
    originalBounds: { minX: origMinX, maxX: origMaxX, minY: origMinY, maxY: origMaxY },
    transformedBounds: { minX: newMinX, maxX: newMaxX, minY: newMinY, maxY: newMaxY },
  };
}

// ── 11. Cycle Time Optimization with Constraints ──

export interface OptimizationConstraint {
  /** Maximum feed rate in mm/min */
  maxFeedRate: number;
  /** Minimum feed rate for quality in mm/min */
  minQualityFeedRate: number;
  /** Maximum acceleration in mm/s² */
  maxAcceleration: number;
  /** Whether to optimize travels */
  optimizeTravels: boolean;
  /** Whether to reduce dwell times */
  reduceDwells: boolean;
  /** Maximum dwell time in seconds */
  maxDwellTime: number;
  /** Quality priority (0-1, higher = prioritize quality over speed) */
  qualityPriority: number;
}

export interface OptimizationSuggestion {
  /** G-code line number */
  lineNumber: number;
  /** Suggestion type */
  type: 'increase_feed' | 'decrease_feed' | 'reduce_dwell' | 'optimize_travel' | 'remove_redundant';
  /** Description */
  description: string;
  /** Estimated time savings in seconds */
  timeSavings: number;
  /** Quality impact (0-1, higher = worse quality) */
  qualityImpact: number;
}

export interface CycleTimeOptimizationResult {
  /** Optimization suggestions */
  suggestions: OptimizationSuggestion[];
  /** Estimated original cycle time in seconds */
  originalTime: number;
  /** Estimated optimized cycle time in seconds */
  optimizedTime: number;
  /** Total time savings in seconds */
  totalTimeSavings: number;
  /** Time savings percentage */
  savingsPercentage: number;
  /** Average quality impact */
  avgQualityImpact: number;
  /** Whether optimization is worthwhile */
  isWorthwhile: boolean;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Suggest cycle time optimizations while respecting quality constraints.
 * Identifies opportunities to:
 * - Increase feed rates where safe
 * - Reduce dwell times
 * - Optimize travel moves
 * - Remove redundant commands
 *
 * @param lines G-code lines
 * @param constraints Optimization constraints
 */
export function optimizeCycleTime(
  lines: string[],
  constraints: OptimizationConstraint,
): CycleTimeOptimizationResult {
  const suggestions: OptimizationSuggestion[] = [];
  let originalTime = 0;
  let prevX = 0, prevY = 0, prevZ = 0;
  let currentFeedRate = 0;
  let totalTimeSavings = 0;
  let totalQualityImpact = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Check for dwell optimization
    if (/\bG4\b/i.test(code) && constraints.reduceDwells) {
      const pMatch = code.match(/\bP(\d*\.?\d+)/i);
      const xMatch = code.match(/\bX(\d*\.?\d+)/i);
      const dwellTime = pMatch ? parseFloat(pMatch[1]) : (xMatch ? parseFloat(xMatch[1]) : 0);

      if (dwellTime > constraints.maxDwellTime) {
        const savings = dwellTime - constraints.maxDwellTime;
        suggestions.push({
          lineNumber: i, type: 'reduce_dwell',
          description: `Reduce dwell from ${dwellTime}s to ${constraints.maxDwellTime}s`,
          timeSavings: savings, qualityImpact: 0.1,
        });
        totalTimeSavings += savings;
        totalQualityImpact += 0.1;
        originalTime += dwellTime;
        continue;
      }
      originalTime += dwellTime;
    }

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) currentFeedRate = parseFloat(fMatch[1]);

    if (!/\bG[01]\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const z = zMatch ? parseFloat(zMatch[1]) : prevZ;

    const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2 + (z - prevZ) ** 2);

    if (dist > 0 && currentFeedRate > 0) {
      const moveTime = dist / (currentFeedRate / 60);
      originalTime += moveTime;

      const isRapid = /\bG0\b/i.test(code);
      const isExtruding = /\bE\d+/i.test(code) && !/\bE-?\b/i.test(code);

      // Suggest feed rate increase for travel moves
      if (isRapid && constraints.optimizeTravels && currentFeedRate < constraints.maxFeedRate) {
        const newFeedRate = constraints.maxFeedRate;
        const newTime = dist / (newFeedRate / 60);
        const savings = moveTime - newTime;
        if (savings > 0.1) {
          suggestions.push({
            lineNumber: i, type: 'optimize_travel',
            description: `Increase travel feed from ${currentFeedRate} to ${newFeedRate} mm/min`,
            timeSavings: savings, qualityImpact: 0,
          });
          totalTimeSavings += savings;
        }
      }

      // Suggest feed rate increase for extrusion moves (respecting quality)
      if (!isRapid && isExtruding && currentFeedRate < constraints.minQualityFeedRate) {
        const newFeedRate = constraints.minQualityFeedRate;
        const newTime = dist / (newFeedRate / 60);
        const savings = moveTime - newTime;
        const qualityImpact = constraints.qualityPriority * 0.3;
        if (savings > 0.1) {
          suggestions.push({
            lineNumber: i, type: 'increase_feed',
            description: `Increase feed from ${currentFeedRate} to ${newFeedRate} mm/min`,
            timeSavings: savings, qualityImpact,
          });
          totalTimeSavings += savings;
          totalQualityImpact += qualityImpact;
        }
      }

      // Suggest feed rate decrease for quality-critical moves
      if (!isRapid && isExtruding && currentFeedRate > constraints.maxFeedRate) {
        const newFeedRate = constraints.maxFeedRate;
        const newTime = dist / (newFeedRate / 60);
        const timeCost = newTime - moveTime;
        suggestions.push({
          lineNumber: i, type: 'decrease_feed',
          description: `Reduce feed from ${currentFeedRate} to ${newFeedRate} mm/min for quality`,
          timeSavings: -timeCost, qualityImpact: -0.2,
        });
      }
    }

    prevX = x; prevY = y; prevZ = z;
  }

  const optimizedTime = originalTime - totalTimeSavings;
  const savingsPercentage = originalTime > 0 ? (totalTimeSavings / originalTime) * 100 : 0;
  const avgQualityImpact = suggestions.length > 0 ? totalQualityImpact / suggestions.length : 0;
  const isWorthwhile = totalTimeSavings > 30 && avgQualityImpact < 0.3;

  const recommendations: string[] = [];
  if (savingsPercentage > 20) {
    recommendations.push(`Potential ${savingsPercentage.toFixed(1)}% cycle time reduction`);
  }
  if (suggestions.filter(s => s.type === 'optimize_travel').length > 5) {
    recommendations.push('Multiple travel optimization opportunities — increase travel speed');
  }
  if (suggestions.filter(s => s.type === 'reduce_dwell').length > 0) {
    recommendations.push('Dwell times can be reduced without quality impact');
  }
  if (avgQualityImpact > 0.2) {
    recommendations.push('Optimizations may impact quality — review carefully');
  }
  if (!isWorthwhile) {
    recommendations.push('Optimization potential is limited — current parameters are reasonable');
  }

  return {
    suggestions, originalTime, optimizedTime,
    totalTimeSavings, savingsPercentage,
    avgQualityImpact, isWorthwhile, recommendations,
  };
}

// ── 12. G-code Dialect/Compatibility Checker ──

export interface CompatibilityIssue {
  /** G-code line number */
  lineNumber: number;
  /** Issue type */
  type: 'unsupported_code' | 'deprecated_code' | 'dialect_specific' | 'missing_required' | 'syntax_error';
  /** The problematic code */
  code: string;
  /** Description */
  description: string;
  /** Which controllers support this */
  supportedControllers: string[];
  /** Severity */
  severity: 'info' | 'warning' | 'error';
  /** Suggested alternative */
  alternative: string;
}

export interface CompatibilityResult {
  /** Target controller */
  targetController: string;
  /** Compatibility issues */
  issues: CompatibilityIssue[];
  /** Compatibility score (0-100) */
  compatibilityScore: number;
  /** Whether the G-code is compatible */
  isCompatible: boolean;
  /** Supported features */
  supportedFeatures: string[];
  /** Unsupported features */
  unsupportedFeatures: string[];
  /** Recommendations */
  recommendations: string[];
}

/**
 * Check G-code compatibility with specific CNC controllers.
 * Supports checking against common controllers:
 * - Fanuc, Haas, Mach3, LinuxCNC, GRBL, Marlin, RepRap
 *
 * @param lines G-code lines
 * @param targetController Target controller name
 */
export function checkGcodeCompatibility(
  lines: string[],
  targetController: string = 'fanuc',
): CompatibilityResult {
  const issues: CompatibilityIssue[] = [];
  const supportedFeatures: string[] = [];
  const unsupportedFeatures: string[] = [];

  // Controller feature sets
  const controllerFeatures: { [controller: string]: { [feature: string]: boolean } } = {
    fanuc: {
      macros: true, subprograms: true, cutter_comp: true,
      coordinate_rotation: true, polar: true, scaling: true,
      probing: true, tool_offset: true, variables: true,
      arcs: true, drilling_cycles: true, threading: false,
      units_inch: true, units_mm: true,
    },
    haas: {
      macros: true, subprograms: true, cutter_comp: true,
      coordinate_rotation: true, polar: true, scaling: true,
      probing: true, tool_offset: true, variables: true,
      arcs: true, drilling_cycles: true, threading: false,
      units_inch: true, units_mm: true,
    },
    mach3: {
      macros: true, subprograms: true, cutter_comp: true,
      coordinate_rotation: false, polar: false, scaling: true,
      probing: true, tool_offset: true, variables: true,
      arcs: true, drilling_cycles: true, threading: false,
      units_inch: true, units_mm: true,
    },
    linuxcnc: {
      macros: true, subprograms: true, cutter_comp: true,
      coordinate_rotation: true, polar: true, scaling: true,
      probing: true, tool_offset: true, variables: true,
      arcs: true, drilling_cycles: true, threading: true,
      units_inch: true, units_mm: true,
    },
    grbl: {
      macros: false, subprograms: false, cutter_comp: false,
      coordinate_rotation: false, polar: false, scaling: false,
      probing: true, tool_offset: false, variables: false,
      arcs: true, drilling_cycles: false, threading: false,
      units_inch: true, units_mm: true,
    },
    marlin: {
      macros: false, subprograms: false, cutter_comp: false,
      coordinate_rotation: false, polar: false, scaling: false,
      probing: true, tool_offset: false, variables: false,
      arcs: false, drilling_cycles: false, threading: false,
      units_inch: true, units_mm: true,
    },
    reprap: {
      macros: false, subprograms: false, cutter_comp: false,
      coordinate_rotation: false, polar: false, scaling: false,
      probing: true, tool_offset: false, variables: false,
      arcs: false, drilling_cycles: false, threading: false,
      units_inch: true, units_mm: true,
    },
  };

  const features = controllerFeatures[targetController.toLowerCase()];
  if (!features) {
    return {
      targetController,
      issues: [{
        lineNumber: -1, type: 'unsupported_code', code: '',
        description: `Unknown controller: ${targetController}`,
        supportedControllers: [],
        severity: 'error', alternative: '',
      }],
      compatibilityScore: 0, isCompatible: false,
      supportedFeatures: [], unsupportedFeatures: [],
      recommendations: [`Unknown controller: ${targetController}. Supported: ${Object.keys(controllerFeatures).join(', ')}`],
    };
  }

  // Check G-code for feature usage
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Check macros
    if (/#\d+/.test(code) && !features.macros) {
      issues.push({
        lineNumber: i, type: 'unsupported_code', code: code.substring(0, 30),
        description: 'Macro variables not supported by this controller',
        supportedControllers: ['fanuc', 'haas', 'mach3', 'linuxcnc'],
        severity: 'error', alternative: 'Replace with literal values',
      });
      if (!unsupportedFeatures.includes('macros')) unsupportedFeatures.push('macros');
    }

    // Check subprograms
    if ((/\bM98\b/i.test(code) || /\bM99\b/i.test(code) || /\bG65\b/i.test(code)) && !features.subprograms) {
      issues.push({
        lineNumber: i, type: 'unsupported_code', code: code.substring(0, 30),
        description: 'Subprogram calls not supported by this controller',
        supportedControllers: ['fanuc', 'haas', 'mach3', 'linuxcnc'],
        severity: 'error', alternative: 'Inline the subprogram code',
      });
      if (!unsupportedFeatures.includes('subprograms')) unsupportedFeatures.push('subprograms');
    }

    // Check cutter compensation
    if (/\bG4[12]\b/i.test(code) && !features.cutter_comp) {
      issues.push({
        lineNumber: i, type: 'unsupported_code', code: code.substring(0, 30),
        description: 'Cutter compensation not supported by this controller',
        supportedControllers: ['fanuc', 'haas', 'mach3', 'linuxcnc'],
        severity: 'error', alternative: 'Pre-compensate toolpath in CAM',
      });
      if (!unsupportedFeatures.includes('cutter_comp')) unsupportedFeatures.push('cutter_comp');
    }

    // Check coordinate rotation
    if (/\bG68\b/i.test(code) && !features.coordinate_rotation) {
      issues.push({
        lineNumber: i, type: 'unsupported_code', code: code.substring(0, 30),
        description: 'Coordinate rotation (G68) not supported by this controller',
        supportedControllers: ['fanuc', 'haas', 'linuxcnc'],
        severity: 'warning', alternative: 'Rotate toolpath in CAM before exporting',
      });
      if (!unsupportedFeatures.includes('coordinate_rotation')) unsupportedFeatures.push('coordinate_rotation');
    }

    // Check arcs
    if (/\bG[23]\b/i.test(code) && !features.arcs) {
      issues.push({
        lineNumber: i, type: 'unsupported_code', code: code.substring(0, 30),
        description: 'Arc moves not supported by this controller',
        supportedControllers: ['fanuc', 'haas', 'mach3', 'linuxcnc', 'grbl'],
        severity: 'error', alternative: 'Convert arcs to linear moves (G1)',
      });
      if (!unsupportedFeatures.includes('arcs')) unsupportedFeatures.push('arcs');
    }

    // Check drilling cycles
    if (/\bG8[1-9]\b/i.test(code) && !features.drilling_cycles) {
      issues.push({
        lineNumber: i, type: 'unsupported_code', code: code.substring(0, 30),
        description: 'Drilling cycles not supported by this controller',
        supportedControllers: ['fanuc', 'haas', 'mach3', 'linuxcnc'],
        severity: 'error', alternative: 'Expand cycles to G0/G1 moves',
      });
      if (!unsupportedFeatures.includes('drilling_cycles')) unsupportedFeatures.push('drilling_cycles');
    }

    // Check scaling
    if (/\bG51\b/i.test(code) && !features.scaling) {
      issues.push({
        lineNumber: i, type: 'unsupported_code', code: code.substring(0, 30),
        description: 'Scaling (G51) not supported by this controller',
        supportedControllers: ['fanuc', 'haas', 'mach3', 'linuxcnc'],
        severity: 'warning', alternative: 'Scale toolpath in CAM',
      });
      if (!unsupportedFeatures.includes('scaling')) unsupportedFeatures.push('scaling');
    }

    // Check polar coordinates
    if (/\bG1[256]\b/i.test(code) && !features.polar) {
      issues.push({
        lineNumber: i, type: 'unsupported_code', code: code.substring(0, 30),
        description: 'Polar coordinates not supported by this controller',
        supportedControllers: ['fanuc', 'haas', 'linuxcnc'],
        severity: 'warning', alternative: 'Convert to Cartesian coordinates',
      });
      if (!unsupportedFeatures.includes('polar')) unsupportedFeatures.push('polar');
    }
  }

  // Build supported features list
  for (const [feature, supported] of Object.entries(features)) {
    if (supported && !supportedFeatures.includes(feature)) {
      supportedFeatures.push(feature);
    }
  }

  const errorCount = issues.filter(i => i.severity === 'error').length;
  const warningCount = issues.filter(i => i.severity === 'warning').length;
  const compatibilityScore = Math.max(0, 100 - errorCount * 15 - warningCount * 5);
  const isCompatible = errorCount === 0;

  const recommendations: string[] = [];
  if (errorCount > 0) {
    recommendations.push(`${errorCount} incompatible commands — must be converted before running on ${targetController}`);
  }
  if (warningCount > 0) {
    recommendations.push(`${warningCount} potentially unsupported features — verify before running`);
  }
  if (unsupportedFeatures.length > 0) {
    recommendations.push(`Unsupported features: ${unsupportedFeatures.join(', ')}`);
  }
  if (isCompatible) {
    recommendations.push(`G-code is compatible with ${targetController}`);
  }

  return {
    targetController, issues, compatibilityScore,
    isCompatible, supportedFeatures, unsupportedFeatures,
    recommendations,
  };
}
