/**
 * @file GcodeAdvanced7.ts
 * @brief Seventh batch of advanced G-code analysis features for CNC and 3D printing.
 *
 * This module provides 12 additional high-impact features:
 *  1. Chatter/vibration prediction (CNC) — predict chatter from cutting params
 *  2. G-code macro variable tracking (Universal) — track #100-#999 variables
 *  3. Material waste/scrap analysis (CNC) — stock removal efficiency
 *  4. Coordinate rotation (G68) analysis (Universal) — detect coordinate rotation
 *  5. Per-layer speed limit analysis (3DP) — identify layers needing speed reduction
 *  6. G-code backplot verification (Universal) — verify toolpath within bounds
 *  7. Tool life remaining estimation (CNC) — cumulative wear and remaining life
 *  8. Semantic G-code diff (Universal) — operation-level diff between files
 *  9. Cutter radius compensation verification (CNC) — verify G41/G42 correctness
 * 10. Print time accuracy validation (3DP) — estimated vs actual with correction
 * 11. Travel path optimization suggestions (Universal) — optimal travel reordering
 * 12. G-code line numbering (Universal) — add N-line numbers for debugging
 */

// ── 1. Chatter/Vibration Prediction ──

export interface ChatterRiskPoint {
  /** G-code line number */
  lineNumber: number;
  /** Spindle speed in RPM */
  spindleRpm: number;
  /** Depth of cut in mm */
  depthOfCut: number;
  /** Width of cut in mm */
  widthOfCut: number;
  /** Chatter frequency in Hz */
  chatterFrequency: number;
  /** Stability lobe number */
  lobeNumber: number;
  /** Risk level */
  risk: 'low' | 'medium' | 'high';
  /** Risk score (0-1) */
  riskScore: number;
  /** Recommendation */
  recommendation: string;
}

export interface ChatterPredictionResult {
  /** Chatter risk points */
  riskPoints: ChatterRiskPoint[];
  /** High-risk count */
  highRiskCount: number;
  /** Overall chatter risk (0-1) */
  overallRisk: number;
  /** Recommended stable spindle speeds */
  recommendedSpeeds: number[];
  /** Recommendations */
  recommendations: string[];
}

/**
 * Predict chatter/vibration risk in CNC milling.
 * Chatter occurs when the cutting frequency matches a natural frequency
 * of the system, causing self-excited vibrations.
 *
 * Uses simplified stability lobe theory:
 * - Natural frequency depends on tool stickout and tool diameter
 * - Stability depends on the ratio of cutting frequency to natural frequency
 *
 * @param lines G-code lines
 * @param toolDiameter Tool diameter in mm
 * @param stickout Tool stickout from collet in mm
 * @param naturalFreq System natural frequency in Hz (auto-estimated if 0)
 */
export function predictChatter(
  lines: string[],
  toolDiameter: number = 6,
  stickout: number = 30,
  naturalFreq: number = 0,
): ChatterPredictionResult {
  const riskPoints: ChatterRiskPoint[] = [];
  let prevZ = 0;
  let currentRpm = 0;
  let currentFeedRate = 0;
  let prevX = 0, prevY = 0;

  // Estimate natural frequency if not provided
  // f_n ≈ (1.875)² / (2π * L²) * sqrt(E*I / (ρ*A))
  // Simplified: f_n ≈ 50000 * d / L² (empirical for HSS tools)
  const fn = naturalFreq > 0 ? naturalFreq : Math.max(100, 50000 * toolDiameter / (stickout * stickout));

  // Tool pass frequency = rpm / 60 * numTeeth
  const numTeeth = 4; // assume 4-flute

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

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const z = zMatch ? parseFloat(zMatch[1]) : prevZ;

    const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);

    if (dist > 0.1 && z < 0 && currentRpm > 0) {
      const depthOfCut = Math.abs(z);
      const widthOfCut = toolDiameter * 0.5; // assume 50% radial engagement

      // Tool pass frequency
      const passFreq = (currentRpm / 60) * numTeeth;

      // Chatter occurs when passFreq is near a harmonic of natural frequency
      // Check if passFreq is within 10% of any harmonic
      let minDist = Infinity;
      let bestLobe = 0;
      for (let lobe = 1; lobe <= 5; lobe++) {
        const harmonic = fn * lobe;
        const distToHarmonic = Math.abs(passFreq - harmonic) / harmonic;
        if (distToHarmonic < minDist) {
          minDist = distToHarmonic;
          bestLobe = lobe;
        }
      }

      // Risk increases with depth and width of cut, and proximity to harmonic
      const proximityRisk = Math.max(0, 1 - minDist * 10); // 1 if exactly on harmonic, 0 if 10% away
      const docRisk = Math.min(1, depthOfCut / (toolDiameter * 1.5));
      const wocRisk = Math.min(1, widthOfCut / toolDiameter);
      const riskScore = proximityRisk * 0.5 + docRisk * 0.3 + wocRisk * 0.2;

      let risk: 'low' | 'medium' | 'high';
      if (riskScore > 0.6) risk = 'high';
      else if (riskScore > 0.3) risk = 'medium';
      else risk = 'low';

      let recommendation = '';
      if (risk === 'high') {
        recommendation = `Change spindle speed to avoid chatter (current: ${currentRpm} RPM, natural freq: ${fn.toFixed(0)} Hz)`;
      } else if (risk === 'medium') {
        recommendation = 'Monitor for chatter — consider reducing depth of cut';
      } else {
        recommendation = 'Stable cutting conditions';
      }

      if (risk !== 'low') {
        riskPoints.push({
          lineNumber: i, spindleRpm: currentRpm,
          depthOfCut, widthOfCut,
          chatterFrequency: passFreq, lobeNumber: bestLobe,
          risk, riskScore, recommendation,
        });
      }
    }

    prevX = x; prevY = y; prevZ = z;
  }

  const highRiskCount = riskPoints.filter(p => p.risk === 'high').length;
  const overallRisk = riskPoints.length > 0
    ? Math.min(1, riskPoints.reduce((sum, p) => sum + p.riskScore, 0) / riskPoints.length)
    : 0;

  // Recommend stable speeds (avoiding harmonics)
  const recommendedSpeeds: number[] = [];
  for (let lobe = 1; lobe <= 3; lobe++) {
    // Stable speed: between lobes, at 0.7 * harmonic
    const stableFreq = fn * lobe * 0.7;
    const stableRpm = (stableFreq / numTeeth) * 60;
    if (stableRpm > 100 && stableRpm < 30000) {
      recommendedSpeeds.push(Math.round(stableRpm));
    }
  }

  const recommendations: string[] = [];
  if (highRiskCount > 5) {
    recommendations.push(`${highRiskCount} high-chatter-risk segments — change spindle speed or reduce DOC`);
  }
  if (overallRisk > 0.5) {
    recommendations.push('Overall chatter risk is high — consider a stiffer tool setup');
  }
  if (stickout > toolDiameter * 4) {
    recommendations.push(`Tool stickout (${stickout}mm) is >4x diameter — reduce for higher stiffness`);
  }
  if (recommendedSpeeds.length > 0) {
    recommendations.push(`Recommended stable spindle speeds: ${recommendedSpeeds.slice(0, 3).join(', ')} RPM`);
  }
  if (recommendations.length === 0) {
    recommendations.push('Chatter risk is low — cutting parameters appear stable');
  }

  return { riskPoints, highRiskCount, overallRisk, recommendedSpeeds, recommendations };
}

// ── 2. G-code Macro Variable Tracking ──

export interface MacroVariable {
  /** Variable number (e.g., 100 for #100) */
  number: number;
  /** Current value */
  value: number;
  /** Line where last set */
  lastSetLine: number;
  /** Number of times set */
  setCount: number;
  /** History of values */
  history: { lineNumber: number; value: number }[];
}

export interface MacroVariableResult {
  /** All tracked variables */
  variables: Map<number, MacroVariable>;
  /** Variable assignments sorted by line */
  assignments: { lineNumber: number; variable: number; value: number; expression: string }[];
  /** Variables used in expressions */
  usages: { lineNumber: number; variable: number; context: string }[];
  /** Count of unique variables */
  uniqueCount: number;
  /** Total assignments */
  totalAssignments: number;
}

/**
 * Track macro variable (#100-#999) definitions and usages in G-code.
 * Supports Fanuc-style macro variables: #100 = 1.0, #101 = #100 + 5, etc.
 *
 * @param lines G-code lines
 */
export function trackMacroVariables(lines: string[]): MacroVariableResult {
  const variables = new Map<number, MacroVariable>();
  const assignments: MacroVariableResult['assignments'] = [];
  const usages: MacroVariableResult['usages'] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('(') || line.startsWith(';')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Check for variable assignment: #100 = expression
    const assignMatch = code.match(/#(\d+)\s*=\s*(.+)/i);
    if (assignMatch) {
      const varNum = parseInt(assignMatch[1]);
      const expression = assignMatch[2].trim();

      // Evaluate expression (simplified — handles basic arithmetic and variable refs)
      const value = evaluateMacroExpression(expression, variables);

      assignments.push({ lineNumber: i, variable: varNum, value, expression });

      // Track variable usages in the expression
      const varRefs = expression.match(/#(\d+)/g);
      if (varRefs) {
        for (const ref of varRefs) {
          const refNum = parseInt(ref.substring(1));
          usages.push({ lineNumber: i, variable: refNum, context: 'assignment' });
        }
      }

      // Update variable tracking
      const existing = variables.get(varNum);
      if (existing) {
        existing.value = value;
        existing.lastSetLine = i;
        existing.setCount++;
        existing.history.push({ lineNumber: i, value });
      } else {
        variables.set(varNum, {
          number: varNum, value, lastSetLine: i,
          setCount: 1, history: [{ lineNumber: i, value }],
        });
      }
      continue;
    }

    // Check for variable usage in G-code: G1 X#100 Y#101
    const usageMatches = code.matchAll(/#(\d+)/g);
    for (const m of usageMatches) {
      const varNum = parseInt(m[1]);
      usages.push({ lineNumber: i, variable: varNum, context: code.substring(0, 30) });
    }
  }

  return {
    variables, assignments, usages,
    uniqueCount: variables.size,
    totalAssignments: assignments.length,
  };
}

function evaluateMacroExpression(expr: string, variables: Map<number, MacroVariable>): number {
  // Replace variable references with their values
  let resolved = expr.replace(/#(\d+)/g, (_, num) => {
    const v = variables.get(parseInt(num));
    return v ? v.value.toString() : '0';
  });

  // Remove comments
  resolved = resolved.replace(/\([^)]*\)/g, '').trim();

  // Simple safe evaluation: only allow numbers, operators, and parentheses
  if (!/^[\d+\-*/().\s]+$/.test(resolved)) {
    return 0; // unsupported expression
  }

  try {
    // eslint-disable-next-line no-new-func
    const result = new Function(`return (${resolved})`)();
    return typeof result === 'number' && isFinite(result) ? result : 0;
  } catch {
    return 0;
  }
}

// ── 3. Material Waste/Scrap Analysis ──

export interface MaterialWasteResult {
  /** Stock volume in mm³ */
  stockVolume: number;
  /** Part volume (final) in mm³ */
  partVolume: number;
  /** Removed material volume in mm³ */
  removedVolume: number;
  /** Waste/scrap volume in mm³ */
  wasteVolume: number;
  /** Material utilization percentage */
  utilizationPercentage: number;
  /** Scrap percentage */
  scrapPercentage: number;
  /** Estimated material cost wasted */
  wasteCost: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze material waste and scrap for CNC operations.
 * Computes the difference between stock volume and final part volume.
 *
 * @param stockLength Stock X dimension in mm
 * @param stockWidth Stock Y dimension in mm
 * @param stockHeight Stock Z dimension in mm
 * @param partLength Part X dimension in mm
 * @param partWidth Part Y dimension in mm
 * @param partHeight Part Z dimension in mm
 * @param materialPricePerKg Material price per kg
 * @param density Material density in g/cm³
 */
export function analyzeMaterialWaste(
  stockLength: number,
  stockWidth: number,
  stockHeight: number,
  partLength: number,
  partWidth: number,
  partHeight: number,
  materialPricePerKg: number = 10,
  density: number = 2.7, // aluminum
): MaterialWasteResult {
  const stockVolume = stockLength * stockWidth * stockHeight;
  const partVolume = partLength * partWidth * partHeight;
  const removedVolume = Math.max(0, stockVolume - partVolume);
  const wasteVolume = removedVolume; // all removed material is waste/scrap

  const utilizationPercentage = stockVolume > 0 ? (partVolume / stockVolume) * 100 : 0;
  const scrapPercentage = stockVolume > 0 ? (wasteVolume / stockVolume) * 100 : 0;

  // Waste cost
  const wasteWeightKg = (wasteVolume / 1000 * density) / 1000; // mm³→cm³→g→kg
  const wasteCost = wasteWeightKg * materialPricePerKg;

  const recommendations: string[] = [];
  if (utilizationPercentage < 20) {
    recommendations.push(`Very low material utilization (${utilizationPercentage.toFixed(1)}%) — consider nesting or smaller stock`);
  } else if (utilizationPercentage < 40) {
    recommendations.push(`Low material utilization (${utilizationPercentage.toFixed(1)}%) — consider optimizing stock size`);
  }
  if (wasteCost > 5) {
    recommendations.push(`Material waste cost is $${wasteCost.toFixed(2)} — consider recycling scrap`);
  }
  if (scrapPercentage > 80) {
    recommendations.push('High scrap percentage — consider additive manufacturing or casting instead');
  }
  if (recommendations.length === 0) {
    recommendations.push('Material utilization is reasonable');
  }

  return {
    stockVolume, partVolume, removedVolume, wasteVolume,
    utilizationPercentage, scrapPercentage, wasteCost, recommendations,
  };
}

// ── 4. Coordinate Rotation (G68) Analysis ──

export interface RotationEvent {
  /** G-code line number */
  lineNumber: number;
  /** Rotation angle in degrees */
  angle: number;
  /** Rotation center X */
  centerX: number;
  /** Rotation center Y */
  centerY: number;
  /** Whether rotation is activated or cancelled */
  activated: boolean;
}

export interface CoordinateRotationResult {
  /** Rotation events */
  events: RotationEvent[];
  /** Whether G68 rotation is used */
  hasRotation: boolean;
  /** Total rotation events */
  eventCount: number;
  /** Maximum rotation angle used */
  maxAngle: number;
  /** Unique rotation angles */
  uniqueAngles: number[];
  /** Recommendations */
  recommendations: string[];
}

/**
 * Detect and analyze coordinate system rotation (G68) in G-code.
 * G68 rotates the coordinate system around a specified center point.
 *
 * @param lines G-code lines
 */
export function analyzeCoordinateRotation(lines: string[]): CoordinateRotationResult {
  const events: RotationEvent[] = [];
  let maxAngle = 0;
  const angleSet = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // G68 X_ Y_ R_ — activate coordinate rotation
    if (/\bG68\b/i.test(code)) {
      const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
      const rMatch = code.match(/\bR(-?\d*\.?\d+)/i);

      const angle = rMatch ? parseFloat(rMatch[1]) : 0;
      const centerX = xMatch ? parseFloat(xMatch[1]) : 0;
      const centerY = yMatch ? parseFloat(yMatch[1]) : 0;

      events.push({
        lineNumber: i, angle, centerX, centerY, activated: true,
      });

      if (Math.abs(angle) > maxAngle) maxAngle = Math.abs(angle);
      angleSet.add(Math.round(angle * 100) / 100);
    }

    // G69 — cancel coordinate rotation
    if (/\bG69\b/i.test(code)) {
      events.push({
        lineNumber: i, angle: 0, centerX: 0, centerY: 0, activated: false,
      });
    }
  }

  const uniqueAngles = Array.from(angleSet).sort((a, b) => a - b);
  const hasRotation = events.length > 0;

  const recommendations: string[] = [];
  if (maxAngle > 45) {
    recommendations.push(`Large rotation angle (${maxAngle.toFixed(1)}°) — verify part orientation`);
  }
  if (events.filter(e => e.activated).length > 5) {
    recommendations.push('Multiple rotation events — ensure all are properly cancelled with G69');
  }
  if (hasRotation && !events.some(e => !e.activated)) {
    recommendations.push('Warning: G68 rotation activated but never cancelled with G69');
  }
  if (recommendations.length === 0 && hasRotation) {
    recommendations.push('Coordinate rotation usage appears correct');
  }

  return {
    events, hasRotation, eventCount: events.length,
    maxAngle, uniqueAngles, recommendations,
  };
}

// ── 5. Per-Layer Speed Limit Analysis ──

export interface LayerSpeedLimit {
  /** Layer index */
  layer: number;
  /** Z height */
  zHeight: number;
  /** Current average speed in mm/min */
  currentSpeed: number;
  /** Recommended max speed in mm/min */
  recommendedMaxSpeed: number;
  /** Reason for speed limit */
  reason: string;
  /** Whether speed should be reduced */
  shouldReduce: boolean;
  /** Reduction percentage */
  reductionPercentage: number;
}

export interface PerLayerSpeedResult {
  /** Per-layer speed recommendations */
  layers: LayerSpeedLimit[];
  /** Number of layers needing speed reduction */
  layersToReduce: number;
  /** Estimated time impact of speed reductions in seconds */
  timeImpact: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze per-layer print speeds and recommend speed limits.
 * Identifies layers where speed should be reduced for quality:
 * - First few layers (adhesion)
 * - Overhang layers
 - Small feature layers
 * - Bridge layers
 *
 * @param lines G-code lines
 * @param zLayers Z-layer info
 * @param overhangLayers Array of layer indices with overhangs
 * @param bridgeLayers Array of layer indices with bridges
 */
export function analyzePerLayerSpeedLimits(
  lines: string[],
  zLayers: { layerIndex: number; zHeight: number; startLine: number; endLine: number }[],
  overhangLayers: number[] = [],
  bridgeLayers: number[] = [],
): PerLayerSpeedResult {
  const layerSpeeds: LayerSpeedLimit[] = [];
  let timeImpact = 0;

  for (const zLayer of zLayers) {
    // Compute average speed for this layer
    let totalSpeed = 0;
    let speedCount = 0;
    let prevE = 0;

    // Find E at layer start
    for (let i = 0; i < zLayer.startLine && i < lines.length; i++) {
      const eMatch = lines[i].match(/\bE(-?\d*\.?\d+)/i);
      if (eMatch) prevE = parseFloat(eMatch[1]);
    }

    for (let i = zLayer.startLine; i <= Math.min(zLayer.endLine, lines.length - 1); i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith(';')) continue;
      if (!/^G1\b/i.test(line)) continue;

      const code = line.replace(/;.*$/, '').trim();
      const fMatch = code.match(/\bF(\d*\.?\d+)/i);
      const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

      if (fMatch && eMatch) {
        const newE = parseFloat(eMatch[1]);
        if (newE > prevE) { // extruding
          totalSpeed += parseFloat(fMatch[1]);
          speedCount++;
        }
        prevE = newE;
      }
    }

    const currentSpeed = speedCount > 0 ? totalSpeed / speedCount : 0;

    // Determine recommended max speed
    let recommendedMaxSpeed = currentSpeed;
    let reason = '';
    let shouldReduce = false;

    if (zLayer.layerIndex < 3) {
      recommendedMaxSpeed = 1200; // 20 mm/s for first layers
      reason = 'First layers — reduce speed for adhesion';
      shouldReduce = currentSpeed > recommendedMaxSpeed;
    } else if (bridgeLayers.includes(zLayer.layerIndex)) {
      recommendedMaxSpeed = 600; // 10 mm/s for bridges
      reason = 'Bridge layer — reduce speed for bridging quality';
      shouldReduce = currentSpeed > recommendedMaxSpeed;
    } else if (overhangLayers.includes(zLayer.layerIndex)) {
      recommendedMaxSpeed = 1200; // 20 mm/s for overhangs
      reason = 'Overhang layer — reduce speed for overhang quality';
      shouldReduce = currentSpeed > recommendedMaxSpeed;
    } else if (zLayer.layerIndex > zLayers.length * 0.9) {
      recommendedMaxSpeed = 2400; // reduce near top for stability
      reason = 'Near top — reduce speed for stability';
      shouldReduce = currentSpeed > recommendedMaxSpeed;
    }

    const reductionPercentage = shouldReduce && currentSpeed > 0
      ? ((currentSpeed - recommendedMaxSpeed) / currentSpeed) * 100
      : 0;

    // Estimate time impact
    if (shouldReduce) {
      // Time increase = distance * (1/newSpeed - 1/oldSpeed)
      // Simplified: assume 100mm of extrusion per layer
      const timeIncrease = 100 * (1 / (recommendedMaxSpeed / 60) - 1 / (currentSpeed / 60));
      timeImpact += Math.max(0, timeIncrease);
    }

    layerSpeeds.push({
      layer: zLayer.layerIndex,
      zHeight: zLayer.zHeight,
      currentSpeed,
      recommendedMaxSpeed,
      reason,
      shouldReduce,
      reductionPercentage,
    });
  }

  const layersToReduce = layerSpeeds.filter(l => l.shouldReduce).length;

  const recommendations: string[] = [];
  if (layersToReduce > 10) {
    recommendations.push(`${layersToReduce} layers would benefit from speed reduction`);
  }
  if (layerSpeeds.filter(l => l.shouldReduce && l.reason.includes('First')).length > 0) {
    recommendations.push('Reduce first layer speed for better adhesion');
  }
  if (layerSpeeds.filter(l => l.shouldReduce && l.reason.includes('Bridge')).length > 0) {
    recommendations.push('Reduce speed on bridge layers for better quality');
  }
  if (timeImpact > 60) {
    recommendations.push(`Speed reductions would add ${Math.round(timeImpact / 60)} min to print time`);
  }
  if (recommendations.length === 0) {
    recommendations.push('Layer speeds appear appropriate');
  }

  return { layers: layerSpeeds, layersToReduce, timeImpact, recommendations };
}

// ── 6. G-code Backplot Verification ──

export interface BackplotViolation {
  /** G-code line number */
  lineNumber: number;
  /** Type of violation */
  type: 'out_of_bounds' | 'rapid_through_material' | 'plunge_too_fast' | 'negative_z_without_stock';
  /** Description */
  description: string;
  /** Position */
  position: { x: number; y: number; z: number };
  /** Severity */
  severity: 'warning' | 'error';
}

export interface BackplotVerificationResult {
  /** Violations found */
  violations: BackplotViolation[];
  /** Whether the toolpath is valid */
  isValid: boolean;
  /** Error count */
  errorCount: number;
  /** Warning count */
  warningCount: number;
  /** Toolpath bounds */
  toolpathBounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
  /** Whether toolpath exceeds expected bounds */
  exceedsBounds: boolean;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Verify G-code backplot against expected bounds and constraints.
 * Checks for:
 * - Toolpath exceeding machine/stock bounds
 * - Rapid moves through material
 * - Excessive plunge rates
 * - Negative Z without stock
 *
 * @param lines G-code lines
 * @param expectedBounds Expected toolpath bounds
 * @param maxPlungeRate Maximum plunge rate in mm/min
 */
export function verifyBackplot(
  lines: string[],
  expectedBounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number },
  maxPlungeRate: number = 500,
): BackplotVerificationResult {
  const violations: BackplotViolation[] = [];
  let prevX = 0, prevY = 0, prevZ = 0;
  let currentFeedRate = 0;
  let isRapid = false;

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    isRapid = /\bG0\b/i.test(code);

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) currentFeedRate = parseFloat(fMatch[1]);

    if (!/\bG[01]\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const z = zMatch ? parseFloat(zMatch[1]) : prevZ;

    // Update bounds
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;

    // Check bounds
    if (x < expectedBounds.minX || x > expectedBounds.maxX ||
        y < expectedBounds.minY || y > expectedBounds.maxY) {
      violations.push({
        lineNumber: i, type: 'out_of_bounds',
        description: `XY position (${x.toFixed(1)}, ${y.toFixed(1)}) exceeds expected bounds`,
        position: { x, y, z }, severity: 'warning',
      });
    }

    if (z < expectedBounds.minZ) {
      violations.push({
        lineNumber: i, type: 'negative_z_without_stock',
        description: `Z${z.toFixed(1)} below expected minimum Z${expectedBounds.minZ}`,
        position: { x, y, z }, severity: 'error',
      });
    }

    // Check rapid through material (G0 with Z below 0)
    if (isRapid && z < 0) {
      violations.push({
        lineNumber: i, type: 'rapid_through_material',
        description: 'Rapid move (G0) at negative Z — may crash into material',
        position: { x, y, z }, severity: 'error',
      });
    }

    // Check plunge rate
    if (!isRapid && zMatch && currentFeedRate > 0) {
      const zDelta = z - prevZ;
      if (zDelta < -0.1 && currentFeedRate > maxPlungeRate) {
        violations.push({
          lineNumber: i, type: 'plunge_too_fast',
          description: `Plunge rate ${currentFeedRate} mm/min exceeds max ${maxPlungeRate} mm/min`,
          position: { x, y, z }, severity: 'warning',
        });
      }
    }

    prevX = x; prevY = y; prevZ = z;
  }

  // Handle empty toolpath
  if (minX === Infinity) {
    minX = 0; maxX = 0; minY = 0; maxY = 0; minZ = 0; maxZ = 0;
  }

  const errorCount = violations.filter(v => v.severity === 'error').length;
  const warningCount = violations.filter(v => v.severity === 'warning').length;
  const isValid = errorCount === 0;
  const exceedsBounds =
    minX < expectedBounds.minX || maxX > expectedBounds.maxX ||
    minY < expectedBounds.minY || maxY > expectedBounds.maxY ||
    minZ < expectedBounds.minZ || maxZ > expectedBounds.maxZ;

  const recommendations: string[] = [];
  if (errorCount > 0) {
    recommendations.push(`${errorCount} errors found — fix before running`);
  }
  if (violations.some(v => v.type === 'rapid_through_material')) {
    recommendations.push('Rapid moves through material detected — add safe Z retract');
  }
  if (violations.some(v => v.type === 'plunge_too_fast')) {
    recommendations.push(`Reduce plunge rate to max ${maxPlungeRate} mm/min`);
  }
  if (exceedsBounds) {
    recommendations.push('Toolpath exceeds expected bounds — verify stock size and origin');
  }
  if (recommendations.length === 0) {
    recommendations.push('Backplot verification passed — no issues found');
  }

  return {
    violations, isValid, errorCount, warningCount,
    toolpathBounds: { minX, maxX, minY, maxY, minZ, maxZ },
    exceedsBounds, recommendations,
  };
}

// ── 7. Tool Life Remaining Estimation ──

export interface ToolLifeEstimate {
  /** Tool number */
  toolNumber: number;
  /** Total cutting distance in mm */
  cuttingDistance: number;
  /** Total cutting time in seconds */
  cuttingTime: number;
  /** Estimated wear percentage (0-100) */
  wearPercentage: number;
  /** Estimated remaining life percentage (0-100) */
  remainingLife: number;
  /** Estimated remaining cutting time in seconds */
  remainingTime: number;
  /** Tool life status */
  status: 'good' | 'worn' | 'critical' | 'replace';
  /** Recommendation */
  recommendation: string;
}

export interface ToolLifeResult {
  /** Per-tool life estimates */
  tools: ToolLifeEstimate[];
  /** Tools needing replacement */
  toolsToReplace: number;
  /** Total cutting time across all tools in seconds */
  totalCuttingTime: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Estimate remaining tool life based on cumulative cutting time and distance.
 * Uses a simplified tool wear model based on Taylor's tool life equation.
 *
 * @param lines G-code lines
 * @param toolLifeMinutes Expected tool life in minutes (per tool)
 * @param toolDiameter Tool diameter in mm (affects wear rate)
 */
export function estimateToolLife(
  lines: string[],
  toolLifeMinutes: number = 60,
  toolDiameter: number = 6,
): ToolLifeResult {
  const toolData = new Map<number, { cuttingDistance: number; cuttingTime: number }>();
  let currentTool = 0;
  let prevX = 0, prevY = 0, prevZ = 0, prevE = 0;
  let currentFeedRate = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const tMatch = code.match(/\bT(\d+)\b/i);
    if (tMatch) currentTool = parseInt(tMatch[1]);

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

    const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2 + (z - prevZ) ** 2);
    const isCutting = (eMatch ? parseFloat(eMatch[1]) > prevE : false) || (z < 0 && dist > 0.1);

    if (isCutting && dist > 0.1) {
      const time = currentFeedRate > 0 ? dist / (currentFeedRate / 60) : 0;
      const data = toolData.get(currentTool) ?? { cuttingDistance: 0, cuttingTime: 0 };
      data.cuttingDistance += dist;
      data.cuttingTime += time;
      toolData.set(currentTool, data);
    }

    if (eMatch) prevE = parseFloat(eMatch[1]);
    prevX = x; prevY = y; prevZ = z;
  }

  const toolLifeSeconds = toolLifeMinutes * 60;
  const tools: ToolLifeEstimate[] = [];
  let toolsToReplace = 0;
  let totalCuttingTime = 0;

  for (const [toolNum, data] of toolData) {
    const wearPercentage = Math.min(100, (data.cuttingTime / toolLifeSeconds) * 100);
    const remainingLife = Math.max(0, 100 - wearPercentage);
    const remainingTime = Math.max(0, toolLifeSeconds - data.cuttingTime);

    let status: ToolLifeEstimate['status'];
    let recommendation = '';
    if (wearPercentage >= 90) {
      status = 'replace';
      recommendation = 'Tool needs immediate replacement';
      toolsToReplace++;
    } else if (wearPercentage >= 75) {
      status = 'critical';
      recommendation = 'Tool is critically worn — replace soon';
    } else if (wearPercentage >= 50) {
      status = 'worn';
      recommendation = 'Tool is worn — monitor for quality degradation';
    } else {
      status = 'good';
      recommendation = 'Tool is in good condition';
    }

    tools.push({
      toolNumber: toolNum,
      cuttingDistance: data.cuttingDistance,
      cuttingTime: data.cuttingTime,
      wearPercentage, remainingLife, remainingTime,
      status, recommendation,
    });

    totalCuttingTime += data.cuttingTime;
  }

  tools.sort((a, b) => b.wearPercentage - a.wearPercentage);

  const recommendations: string[] = [];
  if (toolsToReplace > 0) {
    recommendations.push(`${toolsToReplace} tool(s) need replacement`);
  }
  const criticalTools = tools.filter(t => t.status === 'critical');
  if (criticalTools.length > 0) {
    recommendations.push(`${criticalTools.length} tool(s) are critically worn`);
  }
  if (recommendations.length === 0) {
    recommendations.push('All tools are in acceptable condition');
  }

  return { tools, toolsToReplace, totalCuttingTime, recommendations };
}

// ── 8. Semantic G-code Diff ──

export interface SemanticDiffEntry {
  /** Operation type */
  type: 'added' | 'removed' | 'modified' | 'reordered';
  /** Operation category */
  category: 'motion' | 'speed' | 'tool' | 'spindle' | 'temperature' | 'comment' | 'other';
  /** Line in old file (-1 if added) */
  oldLine: number;
  /** Line in new file (-1 if removed) */
  newLine: number;
  /** Description */
  description: string;
  /** Old value (if modified) */
  oldValue: string;
  /** New value (if modified) */
  newValue: string;
}

export interface SemanticDiffResult {
  /** Diff entries */
  entries: SemanticDiffEntry[];
  /** Summary counts */
  summary: {
    added: number;
    removed: number;
    modified: number;
    reordered: number;
    total: number;
  };
  /** Category breakdown */
  byCategory: { [category: string]: number };
  /** Whether the files are semantically identical */
  isIdentical: boolean;
  /** Impact assessment */
  impact: 'none' | 'minor' | 'moderate' | 'major';
}

/**
 * Generate a semantic diff between two G-code files.
 * Instead of line-by-line diff, this compares operations at a semantic level:
 * - Motion changes (position, speed)
 * - Tool changes
 * - Temperature changes
 * - Spindle changes
 *
 * @param oldLines Old G-code lines
 * @param newLines New G-code lines
 */
export function semanticDiffGcode(oldLines: string[], newLines: string[]): SemanticDiffResult {
  const entries: SemanticDiffEntry[] = [];

  // Extract operations from both files
  const oldOps = extractOperations(oldLines);
  const newOps = extractOperations(newLines);

  // Compare operations
  const maxLen = Math.max(oldOps.length, newOps.length);
  const usedNew = new Set<number>();

  for (let i = 0; i < oldOps.length; i++) {
    const oldOp = oldOps[i];
    // Find matching new operation
    let matched = false;
    for (let j = 0; j < newOps.length; j++) {
      if (usedNew.has(j)) continue;
      const newOp = newOps[j];
      if (oldOp.category === newOp.category && oldOp.key === newOp.key) {
        usedNew.add(j);
        if (oldOp.value !== newOp.value) {
          entries.push({
            type: 'modified', category: oldOp.category,
            oldLine: oldOp.line, newLine: newOp.line,
            description: `${oldOp.description}: ${oldOp.value} → ${newOp.value}`,
            oldValue: oldOp.value, newValue: newOp.value,
          });
        }
        matched = true;
        break;
      }
    }
    if (!matched) {
      entries.push({
        type: 'removed', category: oldOp.category,
        oldLine: oldOp.line, newLine: -1,
        description: `Removed: ${oldOp.description} (${oldOp.value})`,
        oldValue: oldOp.value, newValue: '',
      });
    }
  }

  // Add remaining new operations
  for (let j = 0; j < newOps.length; j++) {
    if (!usedNew.has(j)) {
      const newOp = newOps[j];
      entries.push({
        type: 'added', category: newOp.category,
        oldLine: -1, newLine: newOp.line,
        description: `Added: ${newOp.description} (${newOp.value})`,
        oldValue: '', newValue: newOp.value,
      });
    }
  }

  const summary = {
    added: entries.filter(e => e.type === 'added').length,
    removed: entries.filter(e => e.type === 'removed').length,
    modified: entries.filter(e => e.type === 'modified').length,
    reordered: entries.filter(e => e.type === 'reordered').length,
    total: entries.length,
  };

  const byCategory: { [category: string]: number } = {};
  for (const entry of entries) {
    byCategory[entry.category] = (byCategory[entry.category] ?? 0) + 1;
  }

  const isIdentical = entries.length === 0;

  let impact: SemanticDiffResult['impact'];
  const motionChanges = byCategory['motion'] ?? 0;
  const toolChanges = byCategory['tool'] ?? 0;
  if (summary.total === 0) impact = 'none';
  else if (motionChanges > 10 || toolChanges > 0 || summary.total > 20) impact = 'major';
  else if (motionChanges > 3 || summary.total > 10) impact = 'moderate';
  else impact = 'minor';

  return { entries, summary, byCategory, isIdentical, impact };
}

interface GcodeOperation {
  line: number;
  category: 'motion' | 'speed' | 'tool' | 'spindle' | 'temperature' | 'comment' | 'other';
  key: string;
  value: string;
  description: string;
}

function extractOperations(lines: string[]): GcodeOperation[] {
  const ops: GcodeOperation[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();

    if (!code) {
      if (line.startsWith(';') || line.startsWith('(')) {
        ops.push({ line: i, category: 'comment', key: `comment_${i}`, value: line, description: 'Comment' });
      }
      continue;
    }

    // Tool change
    const tMatch = code.match(/\bT(\d+)\b/i);
    if (tMatch) {
      ops.push({ line: i, category: 'tool', key: 'tool', value: `T${tMatch[1]}`, description: 'Tool change' });
    }

    // Spindle
    if (/\bM[034]\b/i.test(code)) {
      const sMatch = code.match(/\bS(\d*\.?\d+)/i);
      ops.push({ line: i, category: 'spindle', key: 'spindle', value: sMatch ? `S${sMatch[1]}` : 'M3', description: 'Spindle control' });
    }

    // Temperature
    const m104Match = code.match(/M104\s+S(\d+)/i);
    if (m104Match) {
      ops.push({ line: i, category: 'temperature', key: 'hotend', value: `S${m104Match[1]}`, description: 'Hotend temp' });
    }
    const m140Match = code.match(/M140\s+S(\d+)/i);
    if (m140Match) {
      ops.push({ line: i, category: 'temperature', key: 'bed', value: `S${m140Match[1]}`, description: 'Bed temp' });
    }

    // Motion
    if (/\bG[01]\b/i.test(code)) {
      const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
      const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
      const fMatch = code.match(/\bF(\d*\.?\d+)/i);

      if (xMatch || yMatch || zMatch) {
        const pos = `${xMatch?.[1] ?? ''},${yMatch?.[1] ?? ''},${zMatch?.[1] ?? ''}`;
        ops.push({
          line: i, category: 'motion',
          key: `motion_${i}`,
          value: `XYZ:${pos}${fMatch ? ` F${fMatch[1]}` : ''}`,
          description: 'Motion move',
        });
      } else if (fMatch) {
        ops.push({ line: i, category: 'speed', key: 'feed', value: `F${fMatch[1]}`, description: 'Feed rate' });
      }
    }

    // Other
    if (ops.length === 0 || ops[ops.length - 1].line !== i) {
      if (code.length > 0) {
        ops.push({ line: i, category: 'other', key: `other_${i}`, value: code, description: 'Other command' });
      }
    }
  }

  return ops;
}

// ── 9. Cutter Radius Compensation Verification ──

export interface CompensationIssue {
  /** G-code line number */
  lineNumber: number;
  /** Issue type */
  type: 'missing_cancel' | 'missing_offset' | 'lead_in_too_short' | 'compensation_in_arc' | 'no_compensation_needed';
  /** Description */
  description: string;
  /** Severity */
  severity: 'warning' | 'error';
}

export interface CompensationVerificationResult {
  /** Issues found */
  issues: CompensationIssue[];
  /** Whether G41/G42 is used */
  hasCompensation: boolean;
  /** Compensation direction (left/right) */
  direction: 'left' | 'right' | 'none';
  /** Offset register used */
  offsetRegister: number;
  /** Whether compensation is properly cancelled */
  isCancelled: boolean;
  /** Lead-in distance in mm */
  leadInDistance: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Verify cutter radius compensation (G41/G42) usage in G-code.
 * Checks for common errors:
 * - Missing G40 cancellation
 * - Insufficient lead-in distance
 * - Compensation activated in arc move
 * - Missing tool offset
 *
 * @param lines G-code lines
 * @param minLeadInDistance Minimum lead-in distance in mm
 */
export function verifyCutterCompensation(
  lines: string[],
  minLeadInDistance: number = 2,
): CompensationVerificationResult {
  const issues: CompensationIssue[] = [];
  let hasCompensation = false;
  let direction: 'left' | 'right' | 'none' = 'none';
  let offsetRegister = 0;
  let isCancelled = true;
  let compensationStartLine = -1;
  let compensationStartX = 0, compensationStartY = 0;
  let leadInDistance = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // G41 — compensation left
    if (/\bG41\b/i.test(code)) {
      hasCompensation = true;
      direction = 'left';
      isCancelled = false;
      compensationStartLine = i;
      const dMatch = code.match(/\bD(\d+)/i);
      if (dMatch) offsetRegister = parseInt(dMatch[1]);
      else issues.push({
        lineNumber: i, type: 'missing_offset',
        description: 'G41 activated without D offset register',
        severity: 'warning',
      });

      // Check if activated in arc move
      if (/\bG[23]\b/i.test(code)) {
        issues.push({
          lineNumber: i, type: 'compensation_in_arc',
          description: 'Cutter compensation activated in arc move — use linear move',
          severity: 'error',
        });
      }

      // Track start position for lead-in check
      const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
      if (xMatch) compensationStartX = parseFloat(xMatch[1]);
      if (yMatch) compensationStartY = parseFloat(yMatch[1]);
    }

    // G42 — compensation right
    if (/\bG42\b/i.test(code)) {
      hasCompensation = true;
      direction = 'right';
      isCancelled = false;
      compensationStartLine = i;
      const dMatch = code.match(/\bD(\d+)/i);
      if (dMatch) offsetRegister = parseInt(dMatch[1]);
      else issues.push({
        lineNumber: i, type: 'missing_offset',
        description: 'G42 activated without D offset register',
        severity: 'warning',
      });

      if (/\bG[23]\b/i.test(code)) {
        issues.push({
          lineNumber: i, type: 'compensation_in_arc',
          description: 'Cutter compensation activated in arc move — use linear move',
          severity: 'error',
        });
      }

      const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
      if (xMatch) compensationStartX = parseFloat(xMatch[1]);
      if (yMatch) compensationStartY = parseFloat(yMatch[1]);
    }

    // G40 — cancel compensation
    if (/\bG40\b/i.test(code)) {
      if (!isCancelled) {
        isCancelled = true;
        // Check lead-in distance
        if (compensationStartLine >= 0) {
          const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
          const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
          if (xMatch && yMatch) {
            const endX = parseFloat(xMatch[1]);
            const endY = parseFloat(yMatch[1]);
            leadInDistance = Math.sqrt((endX - compensationStartX) ** 2 + (endY - compensationStartY) ** 2);
            if (leadInDistance < minLeadInDistance) {
              issues.push({
                lineNumber: i, type: 'lead_in_too_short',
                description: `Lead-in distance ${leadInDistance.toFixed(2)}mm is less than minimum ${minLeadInDistance}mm`,
                severity: 'warning',
              });
            }
          }
        }
      }
    }
  }

  // Check for missing cancellation
  if (hasCompensation && !isCancelled) {
    issues.push({
      lineNumber: lines.length - 1, type: 'missing_cancel',
      description: 'Cutter compensation (G41/G42) activated but never cancelled with G40',
      severity: 'error',
    });
  }

  const recommendations: string[] = [];
  if (issues.some(i => i.type === 'missing_cancel')) {
    recommendations.push('Add G40 to cancel cutter compensation before program end');
  }
  if (issues.some(i => i.type === 'compensation_in_arc')) {
    recommendations.push('Activate/deactivate compensation in linear moves only, not arcs');
  }
  if (issues.some(i => i.type === 'missing_offset')) {
    recommendations.push('Specify D offset register when using G41/G42');
  }
  if (issues.some(i => i.type === 'lead_in_too_short')) {
    recommendations.push(`Increase lead-in distance to at least ${minLeadInDistance}mm`);
  }
  if (!hasCompensation) {
    recommendations.push('No cutter compensation used — verify if needed for this operation');
  }
  if (recommendations.length === 0) {
    recommendations.push('Cutter compensation usage is correct');
  }

  return {
    issues, hasCompensation, direction, offsetRegister,
    isCancelled, leadInDistance, recommendations,
  };
}

// ── 10. Print Time Accuracy Validation ──

export interface TimeAccuracyResult {
  /** Estimated time in seconds */
  estimatedTime: number;
  /** Actual time in seconds (if provided) */
  actualTime: number;
  /** Accuracy percentage (100 = perfect) */
  accuracy: number;
  /** Error in seconds */
  errorSeconds: number;
  /** Error percentage */
  errorPercentage: number;
  /** Correction factor for future estimates */
  correctionFactor: number;
  /** Breakdown of time components */
  components: { component: string; estimated: number; actual: number; accuracy: number }[];
  /** Recommendations */
  recommendations: string[];
}

/**
 * Validate print time estimation accuracy against actual time.
 * Computes correction factors for future estimates.
 *
 * @param estimatedTime Estimated time in seconds
 * @param actualTime Actual time in seconds
 * @param components Optional per-component breakdown
 */
export function validateTimeAccuracy(
  estimatedTime: number,
  actualTime: number,
  components?: { component: string; estimated: number; actual: number }[],
): TimeAccuracyResult {
  const errorSeconds = actualTime - estimatedTime;
  const errorPercentage = actualTime > 0 ? (errorSeconds / actualTime) * 100 : 0;
  const accuracy = actualTime > 0
    ? Math.max(0, 100 - Math.abs(errorPercentage))
    : 100;
  const correctionFactor = estimatedTime > 0 ? actualTime / estimatedTime : 1;

  const componentResults: TimeAccuracyResult['components'] = [];
  if (components) {
    for (const comp of components) {
      const compError = comp.actual - comp.estimated;
      const compAccuracy = comp.actual > 0
        ? Math.max(0, 100 - Math.abs((compError / comp.actual) * 100))
        : 100;
      componentResults.push({
        component: comp.component,
        estimated: comp.estimated,
        actual: comp.actual,
        accuracy: compAccuracy,
      });
    }
  }

  const recommendations: string[] = [];
  if (Math.abs(errorPercentage) > 20) {
    recommendations.push(`Time estimate is ${Math.abs(errorPercentage).toFixed(1)}% ${errorPercentage > 0 ? 'under' : 'over'} — apply correction factor ${correctionFactor.toFixed(3)}`);
  }
  if (Math.abs(errorPercentage) > 50) {
    recommendations.push('Large time estimation error — review acceleration and travel settings');
  }
  if (correctionFactor > 1.2) {
    recommendations.push('Estimates are consistently too low — increase acceleration overhead');
  } else if (correctionFactor < 0.8) {
    recommendations.push('Estimates are consistently too high — decrease assumed feed rates');
  }

  // Check component accuracy
  for (const comp of componentResults) {
    if (comp.accuracy < 80) {
      recommendations.push(`${comp.component} estimation accuracy is low (${comp.accuracy.toFixed(1)}%)`);
    }
  }

  if (recommendations.length === 0) {
    recommendations.push(`Time estimation accuracy is good (${accuracy.toFixed(1)}%)`);
  }

  return {
    estimatedTime, actualTime, accuracy,
    errorSeconds, errorPercentage, correctionFactor,
    components: componentResults, recommendations,
  };
}

// ── 11. Travel Path Optimization Suggestions ──

export interface TravelOptimizationSuggestion {
  /** Original line number */
  lineNumber: number;
  /** Original travel distance in mm */
  originalDistance: number;
  /** Suggested reorder: array of line numbers */
  suggestedOrder: number[];
  /** Optimized travel distance in mm */
  optimizedDistance: number;
  /** Savings in mm */
  savings: number;
  /** Savings percentage */
  savingsPercentage: number;
}

export interface TravelOptimizationResult {
  /** Optimization suggestions */
  suggestions: TravelOptimizationSuggestion[];
  /** Total original travel distance in mm */
  totalOriginalDistance: number;
  /** Total optimized travel distance in mm */
  totalOptimizedDistance: number;
  /** Total savings in mm */
  totalSavings: number;
  /** Overall savings percentage */
  savingsPercentage: number;
  /** Estimated time savings in seconds */
  timeSavings: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Suggest travel path optimizations using nearest-neighbor reordering.
 * Identifies groups of travel moves that could be reordered for efficiency.
 *
 * @param lines G-code lines
 * @param travelSpeed Travel speed in mm/min (default 6000)
 * @param groupSize Number of moves to consider per group (default 10)
 */
export function suggestTravelOptimization(
  lines: string[],
  travelSpeed: number = 6000,
  groupSize: number = 10,
): TravelOptimizationResult {
  const suggestions: TravelOptimizationSuggestion[] = [];
  let prevX = 0, prevY = 0, prevZ = 0, prevE = 0;
  let totalOriginalDistance = 0;
  let totalOptimizedDistance = 0;

  // Collect extrusion endpoints (where travels start from and go to)
  const extrusionPoints: { x: number; y: number; line: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG1\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;

    if (eMatch) {
      const newE = parseFloat(eMatch[1]);
      if (newE > prevE) {
        // End of extrusion — potential travel start
        extrusionPoints.push({ x, y, line: i });
      }
      prevE = newE;
    }

    prevX = x; prevY = y;
  }

  // Analyze groups of extrusion points for travel optimization
  for (let i = 0; i < extrusionPoints.length - groupSize; i += groupSize) {
    const group = extrusionPoints.slice(i, i + groupSize);
    if (group.length < 3) continue;

    // Compute original travel distance
    let originalDistance = 0;
    for (let j = 1; j < group.length; j++) {
      originalDistance += Math.sqrt(
        (group[j].x - group[j - 1].x) ** 2 +
        (group[j].y - group[j - 1].y) ** 2,
      );
    }

    // Nearest-neighbor reordering
    const visited = new Set<number>();
    const order: number[] = [0];
    visited.add(0);
    let currentIdx = 0;
    let optimizedDistance = 0;

    while (visited.size < group.length) {
      let nearestIdx = -1;
      let nearestDist = Infinity;
      for (let j = 0; j < group.length; j++) {
        if (visited.has(j)) continue;
        const dist = Math.sqrt(
          (group[j].x - group[currentIdx].x) ** 2 +
          (group[j].y - group[currentIdx].y) ** 2,
        );
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestIdx = j;
        }
      }
      if (nearestIdx >= 0) {
        optimizedDistance += nearestDist;
        visited.add(nearestIdx);
        order.push(nearestIdx);
        currentIdx = nearestIdx;
      }
    }

    const savings = originalDistance - optimizedDistance;
    const savingsPct = originalDistance > 0 ? (savings / originalDistance) * 100 : 0;

    if (savings > 5) {
      suggestions.push({
        lineNumber: group[0].line,
        originalDistance,
        suggestedOrder: order.map(idx => group[idx].line),
        optimizedDistance,
        savings,
        savingsPercentage: savingsPct,
      });
    }

    totalOriginalDistance += originalDistance;
    totalOptimizedDistance += optimizedDistance;
  }

  const totalSavings = totalOriginalDistance - totalOptimizedDistance;
  const savingsPercentage = totalOriginalDistance > 0 ? (totalSavings / totalOriginalDistance) * 100 : 0;
  const timeSavings = travelSpeed > 0 ? (totalSavings / (travelSpeed / 60)) : 0;

  const recommendations: string[] = [];
  if (savingsPercentage > 20) {
    recommendations.push(`Travel optimization could save ${savingsPercentage.toFixed(1)}% of travel distance`);
  }
  if (timeSavings > 60) {
    recommendations.push(`Estimated time savings: ${(timeSavings / 60).toFixed(1)} minutes`);
  }
  if (suggestions.length > 5) {
    recommendations.push(`${suggestions.length} optimization opportunities found — consider reordering travel moves`);
  }
  if (recommendations.length === 0) {
    recommendations.push('Travel path is already reasonably optimized');
  }

  return {
    suggestions, totalOriginalDistance, totalOptimizedDistance,
    totalSavings, savingsPercentage, timeSavings, recommendations,
  };
}

// ── 12. G-code Line Numbering ──

export interface LineNumberingResult {
  /** Numbered G-code lines */
  lines: string[];
  /** Starting line number */
  startNumber: number;
  /** Line number increment */
  increment: number;
  /** Total lines numbered */
  numberedCount: number;
  /** Map of original line index to N-number */
  lineMap: Map<number, number>;
  /** Whether existing line numbers were replaced */
  replacedExisting: boolean;
}

/**
 * Add N-line numbers to G-code for debugging and jump-to-line support.
 * Useful for CNC programs that require line numbers (e.g., Fanuc).
 *
 * @param lines G-code lines
 * @param startNumber Starting line number (default 10)
 * @param increment Line number increment (default 10)
 * @param skipComments Whether to skip numbering comment-only lines (default true)
 * @param replaceExisting Whether to replace existing N-numbers (default true)
 */
export function addLineNumbers(
  lines: string[],
  startNumber: number = 10,
  increment: number = 10,
  skipComments: boolean = true,
  replaceExisting: boolean = true,
): LineNumberingResult {
  const result: string[] = [];
  const lineMap = new Map<number, number>();
  let currentNumber = startNumber;
  let numberedCount = 0;
  let replacedExisting = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const trimmed = line.trim();

    // Check if it's a comment-only line
    const isCommentOnly = trimmed.startsWith(';') || trimmed.startsWith('(') || !trimmed;

    // Remove existing N-number if present
    if (replaceExisting && /^\s*N\d+/.test(line)) {
      line = line.replace(/^\s*N\d+\s*/, '');
      replacedExisting = true;
    }

    if (isCommentOnly && skipComments) {
      result.push(line);
      continue;
    }

    // Add N-number
    const numberedLine = `N${currentNumber} ${line.trimStart()}`;
    result.push(numberedLine);
    lineMap.set(i, currentNumber);
    numberedCount++;
    currentNumber += increment;
  }

  return {
    lines: result, startNumber, increment,
    numberedCount, lineMap, replacedExisting,
  };
}

/**
 * Find the G-code line index for a given N-number.
 *
 * @param lineMap Line map from addLineNumbers
 * @param nNumber N-number to find
 * @returns Line index, or -1 if not found
 */
export function findLineByNumber(lineMap: Map<number, number>, nNumber: number): number {
  for (const [lineIdx, num] of lineMap) {
    if (num === nNumber) return lineIdx;
  }
  return -1;
}
