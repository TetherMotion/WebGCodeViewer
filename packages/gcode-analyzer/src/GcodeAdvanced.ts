/**
 * @file GcodeAdvanced.ts
 * @brief Advanced G-code analysis features for CNC and 3D printing.
 *
 * This module provides 12 high-impact features:
 *  1. Overhang detection (3DP) — unsupported overhang analysis
 *  2. Z-seam detection (3DP) — layer start point tracking
 *  3. Drilling cycle expansion (CNC) — G81/G82/G83 canned cycle parsing
 *  4. Cutter radius compensation (CNC) — G41/G42 offset calculation
 *  5. Machine limits checking (Universal) — velocity/accel/jerk violations
 *  6. Feature-based time breakdown (3DP) — time per slicer feature type
 *  7. Path optimization analysis (Universal) — air cut and redundancy detection
 *  8. Over-travel detection (CNC) — machine envelope violation
 *  9. Probe point tracking (CNC) — G38.x probing positions
 * 10. Subprogram call tracing (CNC) — M98/M99 call stack
 * 11. Cost estimation (Universal) — material + machine time cost
 * 12. G-code diff (Universal) — structural comparison of two files
 */

import { parseFeatureTypes, getFeatureTypeAtLine, estimatePrintTime } from './GcodeAnalysis';

// ── 1. Overhang Detection (3DP) ──

export interface OverhangRegion {
  /** Start line of the overhang */
  startLine: number;
  /** End line of the overhang */
  endLine: number;
  /** Z height where overhang starts */
  zHeight: number;
  /** Overhang angle in degrees (0 = horizontal, 90 = vertical) */
  angle: number;
  /** Overhang distance in mm (how far the layer extends beyond previous) */
  distance: number;
  /** Severity: 'minor' (<30°), 'moderate' (30-45°), 'severe' (>45°) */
  severity: 'minor' | 'moderate' | 'severe';
}

/**
 * Detect overhangs by comparing each layer's XY bounds to the previous layer.
 * An overhang occurs when a layer extends significantly beyond the layer below.
 *
 * @param layers Array of layers with their XY bounds and Z heights
 * @param angleThreshold Minor threshold in degrees (default 30)
 * @param severeThreshold Severe threshold in degrees (default 45)
 */
export function detectOverhangs(
  layers: {
    layerIndex: number;
    zHeight: number;
    layerHeight: number;
    bounds: { minX: number; maxX: number; minY: number; maxY: number };
    startLine: number;
    endLine: number;
  }[],
  minorThreshold: number = 30,
  severeThreshold: number = 45,
): OverhangRegion[] {
  const overhangs: OverhangRegion[] = [];

  for (let i = 1; i < layers.length; i++) {
    const prev = layers[i - 1];
    const curr = layers[i];

    // Check each direction for overhang
    const overhangLeft = prev.bounds.minX - curr.bounds.minX; // positive = curr extends left
    const overhangRight = curr.bounds.maxX - prev.bounds.maxX; // positive = curr extends right
    const overhangFront = prev.bounds.minY - curr.bounds.minY;
    const overhangBack = curr.bounds.maxY - prev.bounds.maxY;

    const maxOverhang = Math.max(overhangLeft, overhangRight, overhangFront, overhangBack);

    if (maxOverhang > 0.1) { // ignore tiny overhangs (< 0.1mm)
      // Angle = atan(overhang / layerHeight)
      const angle = Math.atan2(maxOverhang, curr.layerHeight) * (180 / Math.PI);

      let severity: 'minor' | 'moderate' | 'severe';
      if (angle >= severeThreshold) severity = 'severe';
      else if (angle >= minorThreshold) severity = 'moderate';
      else severity = 'minor';

      // Only report moderate and severe (minor overhangs are everywhere)
      if (severity !== 'minor') {
        overhangs.push({
          startLine: curr.startLine,
          endLine: curr.endLine,
          zHeight: curr.zHeight,
          angle,
          distance: maxOverhang,
          severity,
        });
      }
    }
  }

  return overhangs;
}

// ── 2. Z-Seam Detection (3DP) ──

export interface ZSeamInfo {
  /** Layer index */
  layerIndex: number;
  /** Z height of the layer */
  zHeight: number;
  /** G-code line number where the layer starts */
  lineNumber: number;
  /** Starting X position */
  x: number;
  /** Starting Y position */
  y: number;
  /** Whether this seam is aligned with the previous layer's seam */
  aligned: boolean;
}

/**
 * Detect Z-seam positions by finding where each layer starts extruding.
 * The seam is the point where each layer begins, which affects surface quality.
 *
 * @param lines G-code lines
 * @param zLayers Array of Z-layer info with start/end line numbers
 */
export function detectZSeams(
  lines: string[],
  zLayers: { layerIndex: number; zHeight: number; startLine: number; endLine: number }[],
): ZSeamInfo[] {
  const seams: ZSeamInfo[] = [];
  let prevX = 0, prevY = 0;
  let prevSeam: { x: number; y: number } | null = null;
  const seamTolerance = 2.0; // mm — seams within this distance are "aligned"

  for (const layer of zLayers) {
    let seamX = 0, seamY = 0;
    let foundSeam = false;

    // Find the first extruding move in this layer
    for (let i = layer.startLine; i <= Math.min(layer.endLine, lines.length - 1); i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith(';') || line.startsWith('(')) continue;

      const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
      if (!code || !/\bG1\b/i.test(code)) continue;

      const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);
      if (!eMatch) continue;
      const eVal = parseFloat(eMatch[1]);
      if (eVal <= 0) continue; // not extruding

      const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
      if (xMatch) seamX = parseFloat(xMatch[1]);
      if (yMatch) seamY = parseFloat(yMatch[1]);
      foundSeam = true;
      break;
    }

    if (foundSeam) {
      let aligned = false;
      if (prevSeam) {
        const dist = Math.sqrt(
          (seamX - prevSeam.x) ** 2 + (seamY - prevSeam.y) ** 2,
        );
        aligned = dist < seamTolerance;
      }

      seams.push({
        layerIndex: layer.layerIndex,
        zHeight: layer.zHeight,
        lineNumber: layer.startLine,
        x: seamX,
        y: seamY,
        aligned,
      });

      prevSeam = { x: seamX, y: seamY };
    }

    prevX = seamX;
    prevY = seamY;
  }

  return seams;
}

/**
 * Analyze Z-seam consistency.
 */
export function analyzeZSeamConsistency(seams: ZSeamInfo[]): {
  totalLayers: number;
  alignedCount: number;
  alignmentScore: number; // 0..1, higher = more consistent
  averageSeamDistance: number;
  maxSeamDistance: number;
} {
  if (seams.length === 0) {
    return { totalLayers: 0, alignedCount: 0, alignmentScore: 0, averageSeamDistance: 0, maxSeamDistance: 0 };
  }

  const alignedCount = seams.filter(s => s.aligned).length;
  const alignmentScore = alignedCount / seams.length;

  let totalDist = 0;
  let maxDist = 0;
  let count = 0;
  for (let i = 1; i < seams.length; i++) {
    const dist = Math.sqrt(
      (seams[i].x - seams[i - 1].x) ** 2 + (seams[i].y - seams[i - 1].y) ** 2,
    );
    totalDist += dist;
    if (dist > maxDist) maxDist = dist;
    count++;
  }

  return {
    totalLayers: seams.length,
    alignedCount,
    alignmentScore,
    averageSeamDistance: count > 0 ? totalDist / count : 0,
    maxSeamDistance: maxDist,
  };
}

// ── 3. Drilling Cycle Expansion (CNC) ──

export interface DrillingCycle {
  /** G-code line number where the cycle is called */
  lineNumber: number;
  /** Cycle type: G81 (drill), G82 (drill with dwell), G83 (peck drill) */
  cycleType: 'G81' | 'G82' | 'G83';
  /** Hole X position */
  x: number;
  /** Hole Y position */
  y: number;
  /** Z depth of the hole (bottom) */
  zDepth: number;
  /** Retract Z height between holes/pecks */
  retractZ: number;
  /** Initial Z height (R plane) */
  rPlane: number;
  /** Feed rate in mm/min */
  feedRate: number;
  /** Dwell time in seconds (G82 only) */
  dwell?: number;
  /** Peck depth for G83 (Q value) */
  peckDepth?: number;
  /** Expanded moves for this cycle */
  expandedMoves: { x: number; y: number; z: number; feedRate: number; type: string }[];
}

/**
 * Parse and expand drilling canned cycles (G81, G82, G83).
 * These cycles define a pattern of moves that repeat at each X/Y position
 * until G80 cancels the cycle.
 *
 * @param lines G-code lines
 */
export function parseDrillingCycles(lines: string[]): DrillingCycle[] {
  const cycles: DrillingCycle[] = [];
  let inCycle = false;
  let cycleType: 'G81' | 'G82' | 'G83' | null = null;
  let rPlane = 0;
  let zDepth = 0;
  let feedRate = 0;
  let dwell = 0;
  let peckDepth = 0;
  let currentX = 0, currentY = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Check for cycle start
    const g81Match = code.match(/\bG81\b/i);
    const g82Match = code.match(/\bG82\b/i);
    const g83Match = code.match(/\bG83\b/i);

    if (g81Match || g82Match || g83Match) {
      inCycle = true;
      cycleType = g81Match ? 'G81' : g82Match ? 'G82' : 'G83';

      // Parse R, Z, F, P (dwell), Q (peck)
      const rMatch = code.match(/\bR(-?\d*\.?\d+)/i);
      const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
      const fMatch = code.match(/\bF(\d*\.?\d+)/i);
      const pMatch = code.match(/\bP(\d*\.?\d+)/i);
      const qMatch = code.match(/\bQ(-?\d*\.?\d+)/i);
      const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);

      rPlane = rMatch ? parseFloat(rMatch[1]) : rPlane;
      zDepth = zMatch ? parseFloat(zMatch[1]) : zDepth;
      feedRate = fMatch ? parseFloat(fMatch[1]) : feedRate;
      dwell = pMatch ? parseFloat(pMatch[1]) : 0;
      peckDepth = qMatch ? parseFloat(qMatch[1]) : 0;
      if (xMatch) currentX = parseFloat(xMatch[1]);
      if (yMatch) currentY = parseFloat(yMatch[1]);

      // Expand the first hole
      const expanded = expandCycle(cycleType, currentX, currentY, rPlane, zDepth, feedRate, dwell, peckDepth);
      cycles.push({
        lineNumber: i,
        cycleType,
        x: currentX,
        y: currentY,
        zDepth,
        retractZ: rPlane,
        rPlane,
        feedRate,
        dwell: dwell > 0 ? dwell : undefined,
        peckDepth: peckDepth > 0 ? peckDepth : undefined,
        expandedMoves: expanded,
      });
      continue;
    }

    // Check for cycle cancel
    if (/\bG80\b/i.test(code)) {
      inCycle = false;
      cycleType = null;
      continue;
    }

    // If in cycle, each X/Y position is a new hole
    if (inCycle && cycleType) {
      const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);

      if (xMatch || yMatch) {
        if (xMatch) currentX = parseFloat(xMatch[1]);
        if (yMatch) currentY = parseFloat(yMatch[1]);

        // Check for updated Z, R, F
        const rMatch = code.match(/\bR(-?\d*\.?\d+)/i);
        const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
        const fMatch = code.match(/\bF(\d*\.?\d+)/i);
        if (rMatch) rPlane = parseFloat(rMatch[1]);
        if (zMatch) zDepth = parseFloat(zMatch[1]);
        if (fMatch) feedRate = parseFloat(fMatch[1]);

        const expanded = expandCycle(cycleType, currentX, currentY, rPlane, zDepth, feedRate, dwell, peckDepth);
        cycles.push({
          lineNumber: i,
          cycleType,
          x: currentX,
          y: currentY,
          zDepth,
          retractZ: rPlane,
          rPlane,
          feedRate,
          dwell: dwell > 0 ? dwell : undefined,
          peckDepth: peckDepth > 0 ? peckDepth : undefined,
          expandedMoves: expanded,
        });
      }
    }
  }

  return cycles;
}

/**
 * Expand a canned cycle into individual moves.
 */
function expandCycle(
  type: 'G81' | 'G82' | 'G83',
  x: number, y: number,
  rPlane: number, zDepth: number,
  feedRate: number,
  dwell: number, peckDepth: number,
): { x: number; y: number; z: number; feedRate: number; type: string }[] {
  const moves: { x: number; y: number; z: number; feedRate: number; type: string }[] = [];

  // Rapid to R plane
  moves.push({ x, y, z: rPlane, feedRate: 0, type: 'rapid' });

  if (type === 'G81') {
    // Simple drill: feed to depth, rapid out
    moves.push({ x, y, z: zDepth, feedRate, type: 'feed' });
    moves.push({ x, y, z: rPlane, feedRate: 0, type: 'rapid' });
  } else if (type === 'G82') {
    // Drill with dwell: feed to depth, dwell, rapid out
    moves.push({ x, y, z: zDepth, feedRate, type: 'feed' });
    moves.push({ x, y, z: zDepth, feedRate: 0, type: 'dwell' });
    moves.push({ x, y, z: rPlane, feedRate: 0, type: 'rapid' });
  } else if (type === 'G83') {
    // Peck drill: feed in increments, retract between pecks
    let currentZ = rPlane;
    const peck = peckDepth > 0 ? peckDepth : 1.0; // default 1mm peck
    while (currentZ > zDepth) {
      const nextZ = Math.max(zDepth, currentZ - peck);
      moves.push({ x, y, z: nextZ, feedRate, type: 'feed' });
      moves.push({ x, y, z: rPlane, feedRate: 0, type: 'rapid' });
      currentZ = nextZ;
    }
    // Final retract
    moves.push({ x, y, z: rPlane, feedRate: 0, type: 'rapid' });
  }

  return moves;
}

// ── 4. Cutter Radius Compensation (CNC) ──

export interface CompensationInfo {
  /** G-code line number where compensation is enabled/disabled */
  lineNumber: number;
  /** Compensation mode: G41 (left), G42 (right), G40 (cancel) */
  mode: 'G41' | 'G42' | 'G40';
  /** Offset distance (D value) in mm */
  offsetDistance: number;
  /** Tool number (D register) */
  dRegister: number;
}

export interface CompensatedPoint {
  x: number;
  y: number;
  /** Whether this point is on the compensated path */
  compensated: boolean;
}

/**
 * Parse cutter radius compensation commands (G40/G41/G42).
 *
 * @param lines G-code lines
 */
export function parseCutterCompensation(lines: string[]): CompensationInfo[] {
  const infos: CompensationInfo[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const g41Match = code.match(/\bG41\b/i);
    const g42Match = code.match(/\bG42\b/i);
    const g40Match = code.match(/\bG40\b/i);

    if (g41Match || g42Match || g40Match) {
      const mode = g40Match ? 'G40' : g41Match ? 'G41' : 'G42';
      const dMatch = code.match(/\bD(\d+)/i);
      const dRegister = dMatch ? parseInt(dMatch[1]) : 0;

      infos.push({
        lineNumber: i,
        mode,
        offsetDistance: 0, // actual offset comes from tool table
        dRegister,
      });
    }
  }

  return infos;
}

/**
 * Compute the compensated toolpath when G41/G42 is active.
 * Offsets each move perpendicular to the direction of travel.
 *
 * @param moves Array of moves with X/Y coordinates
 * @param offset Offset distance in mm (tool radius)
 * @param direction 'left' for G41, 'right' for G42
 */
export function computeCompensatedPath(
  moves: { x: number; y: number; lineNumber: number }[],
  offset: number,
  direction: 'left' | 'right',
): CompensatedPoint[] {
  if (moves.length === 0) return [];
  const result: CompensatedPoint[] = [];
  const sign = direction === 'left' ? 1 : -1;

  for (let i = 0; i < moves.length; i++) {
    if (i === 0) {
      // First point: offset based on direction to next point
      if (moves.length > 1) {
        const dx = moves[1].x - moves[0].x;
        const dy = moves[1].y - moves[0].y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 1e-9) {
          // Perpendicular vector (rotated 90°)
          const nx = -dy / len * sign;
          const ny = dx / len * sign;
          result.push({ x: moves[0].x + nx * offset, y: moves[0].y + ny * offset, compensated: true });
        } else {
          result.push({ x: moves[0].x, y: moves[0].y, compensated: false });
        }
      } else {
        result.push({ x: moves[0].x, y: moves[0].y, compensated: false });
      }
      continue;
    }

    // For each point, compute the offset based on the bisector of incoming/outgoing directions
    const prev = moves[i - 1];
    const curr = moves[i];
    const next = moves[i + 1];

    const inDx = curr.x - prev.x;
    const inDy = curr.y - prev.y;
    const inLen = Math.sqrt(inDx * inDx + inDy * inDy);

    if (inLen < 1e-9) {
      result.push({ x: curr.x, y: curr.y, compensated: false });
      continue;
    }

    // Incoming perpendicular
    const inNx = -inDy / inLen * sign;
    const inNy = inDx / inLen * sign;

    if (!next) {
      // Last point: use incoming direction only
      result.push({ x: curr.x + inNx * offset, y: curr.y + inNy * offset, compensated: true });
      continue;
    }

    // Outgoing direction
    const outDx = next.x - curr.x;
    const outDy = next.y - curr.y;
    const outLen = Math.sqrt(outDx * outDx + outDy * outDy);

    if (outLen < 1e-9) {
      result.push({ x: curr.x + inNx * offset, y: curr.y + inNy * offset, compensated: true });
      continue;
    }

    // Outgoing perpendicular
    const outNx = -outDy / outLen * sign;
    const outNy = outDx / outLen * sign;

    // Bisector of the two perpendiculars
    const bisectX = (inNx + outNx) / 2;
    const bisectY = (inNy + outNy) / 2;
    const bisectLen = Math.sqrt(bisectX * bisectX + bisectY * bisectY);

    if (bisectLen > 1e-9) {
      // Scale to maintain offset distance at corners
      const cosHalfAngle = (inDx * outDx + inDy * outDy) / (inLen * outLen);
      const scale = cosHalfAngle > 1e-6 ? 1 / cosHalfAngle : 1;
      result.push({
        x: curr.x + (bisectX / bisectLen) * offset * scale,
        y: curr.y + (bisectY / bisectLen) * offset * scale,
        compensated: true,
      });
    } else {
      result.push({ x: curr.x + inNx * offset, y: curr.y + inNy * offset, compensated: true });
    }
  }

  return result;
}

// ── 5. Machine Limits Checking (Universal) ──

export interface MachineLimits {
  maxFeedRate: number;       // mm/min
  maxAcceleration: number;   // mm/s²
  maxJerk: number;           // mm/s³
  minX: number; maxX: number;
  minY: number; maxY: number;
  minZ: number; maxZ: number;
}

export interface LimitViolation {
  lineNumber: number;
  category: 'feedrate' | 'acceleration' | 'jerk' | 'travel';
  actual: number;
  limit: number;
  message: string;
  severity: 'warning' | 'error';
}

/**
 * Check G-code for machine limit violations.
 * Detects excessive feed rates, accelerations, jerks, and out-of-bounds moves.
 *
 * @param lines G-code lines
 * @param limits Machine limits
 */
export function checkMachineLimits(
  lines: string[],
  limits: MachineLimits,
): LimitViolation[] {
  const violations: LimitViolation[] = [];
  let prevX = 0, prevY = 0, prevZ = 0;
  let currentFeedRate = 0; // mm/min
  let prevFeedRate = 0;
  let hasPosition = false;
  let prevSpeed = 0; // mm/s
  let prevTime = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const isG0 = /\bG0\b/i.test(code);
    const isG1 = /\bG1\b/i.test(code);
    if (!isG0 && !isG1) continue;

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) currentFeedRate = parseFloat(fMatch[1]);

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);

    const newX = xMatch ? parseFloat(xMatch[1]) : prevX;
    const newY = yMatch ? parseFloat(yMatch[1]) : prevY;
    const newZ = zMatch ? parseFloat(zMatch[1]) : prevZ;

    // Check travel limits
    if (xMatch) {
      if (newX < limits.minX || newX > limits.maxX) {
        violations.push({
          lineNumber: i,
          category: 'travel',
          actual: newX,
          limit: newX < limits.minX ? limits.minX : limits.maxX,
          message: `X${newX.toFixed(2)} exceeds machine limit [${limits.minX}, ${limits.maxX}]`,
          severity: 'error',
        });
      }
    }
    if (yMatch) {
      if (newY < limits.minY || newY > limits.maxY) {
        violations.push({
          lineNumber: i,
          category: 'travel',
          actual: newY,
          limit: newY < limits.minY ? limits.minY : limits.maxY,
          message: `Y${newY.toFixed(2)} exceeds machine limit [${limits.minY}, ${limits.maxY}]`,
          severity: 'error',
        });
      }
    }
    if (zMatch) {
      if (newZ < limits.minZ || newZ > limits.maxZ) {
        violations.push({
          lineNumber: i,
          category: 'travel',
          actual: newZ,
          limit: newZ < limits.minZ ? limits.minZ : limits.maxZ,
          message: `Z${newZ.toFixed(2)} exceeds machine limit [${limits.minZ}, ${limits.maxZ}]`,
          severity: 'error',
        });
      }
    }

    // Check feed rate
    if (currentFeedRate > limits.maxFeedRate) {
      violations.push({
        lineNumber: i,
        category: 'feedrate',
        actual: currentFeedRate,
        limit: limits.maxFeedRate,
        message: `Feed rate ${currentFeedRate} mm/min exceeds machine max ${limits.maxFeedRate} mm/min`,
        severity: 'warning',
      });
    }

    // Check acceleration and jerk
    if (hasPosition && currentFeedRate > 0) {
      const dist = Math.sqrt(
        (newX - prevX) ** 2 + (newY - prevY) ** 2 + (newZ - prevZ) ** 2,
      );
      if (dist > 0) {
        const speedMmS = currentFeedRate / 60;
        const moveTime = dist / speedMmS;

        // Acceleration = change in speed / change in time
        const accel = Math.abs(speedMmS - prevSpeed) / Math.max(moveTime, 1e-9);
        if (accel > limits.maxAcceleration) {
          violations.push({
            lineNumber: i,
            category: 'acceleration',
            actual: accel,
            limit: limits.maxAcceleration,
            message: `Acceleration ${accel.toFixed(0)} mm/s² exceeds machine max ${limits.maxAcceleration} mm/s²`,
            severity: 'warning',
          });
        }

        // Jerk = change in acceleration / change in time
        if (prevTime > 0) {
          const prevAccel = prevSpeed > 0 ? Math.abs(prevSpeed - 0) / prevTime : 0;
          const jerk = Math.abs(accel - prevAccel) / Math.max(moveTime, 1e-9);
          if (jerk > limits.maxJerk) {
            violations.push({
              lineNumber: i,
              category: 'jerk',
              actual: jerk,
              limit: limits.maxJerk,
              message: `Jerk ${jerk.toFixed(0)} mm/s³ exceeds machine max ${limits.maxJerk} mm/s³`,
              severity: 'warning',
            });
          }
        }

        prevTime = moveTime;
        prevSpeed = speedMmS;
      }
    }

    prevFeedRate = currentFeedRate;
    prevX = newX;
    prevY = newY;
    prevZ = newZ;
    hasPosition = true;
  }

  return violations;
}

// ── 6. Feature-Based Time Breakdown (3DP) ──

export interface FeatureTimeBreakdown {
  featureType: string;
  totalTime: number;   // seconds
  percentage: number;  // 0..100
  moveCount: number;
  pathLength: number;  // mm
}

/**
 * Compute time breakdown by slicer feature type.
 * Uses ;TYPE: comments to segment the G-code and estimate time per feature.
 *
 * @param lines G-code lines
 */
export function computeFeatureTimeBreakdown(lines: string[]): FeatureTimeBreakdown[] {
  const segments = parseFeatureTypes(lines);
  if (segments.length === 0) return [];

  const breakdowns: Map<string, { time: number; moves: number; path: number }> = new Map();
  let prevX = 0, prevY = 0, prevZ = 0;
  let currentFeedRate = 0;
  let hasPosition = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const isMove = /\bG[01]\b/i.test(code);
    if (!isMove) continue;

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) currentFeedRate = parseFloat(fMatch[1]);

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);

    const newX = xMatch ? parseFloat(xMatch[1]) : prevX;
    const newY = yMatch ? parseFloat(yMatch[1]) : prevY;
    const newZ = zMatch ? parseFloat(zMatch[1]) : prevZ;

    if (hasPosition && currentFeedRate > 0) {
      const dist = Math.sqrt(
        (newX - prevX) ** 2 + (newY - prevY) ** 2 + (newZ - prevZ) ** 2,
      );
      if (dist > 0) {
        const time = dist / (currentFeedRate / 60);
        const featureType = getFeatureTypeAtLine(segments, i) ?? 'UNKNOWN';

        const existing = breakdowns.get(featureType) ?? { time: 0, moves: 0, path: 0 };
        existing.time += time;
        existing.moves++;
        existing.path += dist;
        breakdowns.set(featureType, existing);
      }
    }

    prevX = newX;
    prevY = newY;
    prevZ = newZ;
    hasPosition = true;
  }

  const totalTime = Array.from(breakdowns.values()).reduce((sum, b) => sum + b.time, 0);
  const result: FeatureTimeBreakdown[] = [];
  for (const [featureType, data] of breakdowns) {
    result.push({
      featureType,
      totalTime: data.time,
      percentage: totalTime > 0 ? (data.time / totalTime) * 100 : 0,
      moveCount: data.moves,
      pathLength: data.path,
    });
  }

  // Sort by time descending
  result.sort((a, b) => b.totalTime - a.totalTime);
  return result;
}

// ── 7. Path Optimization Analysis (Universal) ──

export interface OptimizationIssue {
  lineNumber: number;
  category: 'air-cut' | 'redundant-travel' | 'excessive-retraction' | 'slow-feed' | 'unnecessary-dwell';
  message: string;
  waste: number; // estimated wasted time in seconds
  severity: 'info' | 'warning';
}

/**
 * Analyze G-code for path optimization opportunities.
 * Identifies:
 * - Air cuts (non-cutting moves with feed rate instead of rapid)
 * - Redundant travels (long travel moves that could be shortened)
 * - Excessive retractions (too many retraction events)
 * - Slow feed rates (feed rates well below the average)
 * - Unnecessary dwells (G4 with long dwell times)
 *
 * @param lines G-code lines
 */
export function analyzePathOptimization(lines: string[]): OptimizationIssue[] {
  const issues: OptimizationIssue[] = [];
  let prevX = 0, prevY = 0, prevZ = 0;
  let currentFeedRate = 0;
  let hasPosition = false;
  let retractionCount = 0;
  let prevE = 0;
  let totalCuttingTime = 0;
  let totalAirTime = 0;
  let moveCount = 0;
  const feedRates: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Check for dwell (G4)
    if (/\bG4\b/i.test(code)) {
      const pMatch = code.match(/\bP(\d*\.?\d+)/i);
      if (pMatch) {
        const dwellSec = parseFloat(pMatch[1]) / 1000; // P is in ms
        if (dwellSec > 1) {
          issues.push({
            lineNumber: i,
            category: 'unnecessary-dwell',
            message: `Long dwell (${dwellSec.toFixed(1)}s) — consider optimizing`,
            waste: dwellSec,
            severity: 'info',
          });
        }
      }
      continue;
    }

    const isG0 = /\bG0\b/i.test(code);
    const isG1 = /\bG1\b/i.test(code);
    if (!isG0 && !isG1) continue;

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) {
      currentFeedRate = parseFloat(fMatch[1]);
      feedRates.push(currentFeedRate);
    }

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

    const newX = xMatch ? parseFloat(xMatch[1]) : prevX;
    const newY = yMatch ? parseFloat(yMatch[1]) : prevY;
    const newZ = zMatch ? parseFloat(zMatch[1]) : prevZ;

    // Track retractions
    if (eMatch) {
      const newE = parseFloat(eMatch[1]);
      if (newE < prevE) retractionCount++;
      prevE = newE;
    }

    if (hasPosition) {
      const dist = Math.sqrt(
        (newX - prevX) ** 2 + (newY - prevY) ** 2 + (newZ - prevZ) ** 2,
      );

      if (dist > 0 && currentFeedRate > 0) {
        const time = dist / (currentFeedRate / 60);
        moveCount++;

        // Check for air cuts (G1 without extrusion, long distance)
        const isExtruding = eMatch && parseFloat(eMatch[1]) > prevE;
        if (isG1 && !isExtruding && dist > 10) {
          issues.push({
            lineNumber: i,
            category: 'air-cut',
            message: `Air cut: ${dist.toFixed(1)}mm at feed rate instead of rapid (G0)`,
            waste: time,
            severity: 'info',
          });
          totalAirTime += time;
        } else if (isExtruding) {
          totalCuttingTime += time;
        }

        // Check for redundant long travels
        if (isG0 && dist > 100) {
          issues.push({
            lineNumber: i,
            category: 'redundant-travel',
            message: `Long travel: ${dist.toFixed(1)}mm — consider reordering for efficiency`,
            waste: dist / (5000 / 60), // estimate at 5000 mm/min rapid
            severity: 'info',
          });
        }
      }
    }

    prevX = newX;
    prevY = newY;
    prevZ = newZ;
    hasPosition = true;
  }

  // Check for excessive retractions (> 1 per 10 moves)
  if (moveCount > 100 && retractionCount > moveCount / 10) {
    issues.push({
      lineNumber: 0,
      category: 'excessive-retraction',
      message: `${retractionCount} retractions in ${moveCount} moves (${(retractionCount / moveCount * 100).toFixed(1)}%) — consider reducing`,
      waste: retractionCount * 0.1, // estimate 0.1s per retraction
      severity: 'warning',
    });
  }

  // Check for slow feed rates
  if (feedRates.length > 10) {
    const avgFeed = feedRates.reduce((a, b) => a + b, 0) / feedRates.length;
    const slowCount = feedRates.filter(f => f < avgFeed * 0.3).length;
    if (slowCount > feedRates.length * 0.2) {
      issues.push({
        lineNumber: 0,
        category: 'slow-feed',
        message: `${slowCount} moves at <30% of average feed rate — consider optimizing`,
        waste: 0,
        severity: 'info',
      });
    }
  }

  return issues;
}

// ── 8. Over-Travel Detection (CNC) ──

export interface OverTravelViolation {
  lineNumber: number;
  axis: 'X' | 'Y' | 'Z' | 'A' | 'B' | 'C';
  value: number;
  limit: number;
  direction: 'positive' | 'negative';
  message: string;
}

/**
 * Check if any move exceeds the machine's travel envelope.
 * This is a safety-critical check for CNC machines.
 *
 * @param lines G-code lines
 * @param envelope Machine travel limits
 */
export function checkOverTravel(
  lines: string[],
  envelope: {
    minX: number; maxX: number;
    minY: number; maxY: number;
    minZ: number; maxZ: number;
    minA?: number; maxA?: number;
    minB?: number; maxB?: number;
    minC?: number; maxC?: number;
  },
): OverTravelViolation[] {
  const violations: OverTravelViolation[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const checkAxis = (axis: 'X' | 'Y' | 'Z' | 'A' | 'B' | 'C', min: number, max: number) => {
      const regex = new RegExp(`\\b${axis}(-?\\d*\\.?\\d+)`, 'i');
      const match = code.match(regex);
      if (match) {
        const val = parseFloat(match[1]);
        if (val < min) {
          violations.push({
            lineNumber: i, axis, value: val, limit: min, direction: 'negative',
            message: `${axis}${val.toFixed(2)} below machine minimum ${min}`,
          });
        } else if (val > max) {
          violations.push({
            lineNumber: i, axis, value: val, limit: max, direction: 'positive',
            message: `${axis}${val.toFixed(2)} above machine maximum ${max}`,
          });
        }
      }
    };

    checkAxis('X', envelope.minX, envelope.maxX);
    checkAxis('Y', envelope.minY, envelope.maxY);
    checkAxis('Z', envelope.minZ, envelope.maxZ);
    if (envelope.minA !== undefined && envelope.maxA !== undefined) {
      checkAxis('A', envelope.minA, envelope.maxA);
    }
    if (envelope.minB !== undefined && envelope.maxB !== undefined) {
      checkAxis('B', envelope.minB, envelope.maxB);
    }
    if (envelope.minC !== undefined && envelope.maxC !== undefined) {
      checkAxis('C', envelope.minC, envelope.maxC);
    }
  }

  return violations;
}

// ── 9. Probe Point Tracking (CNC) ──

export interface ProbeEvent {
  /** G-code line number */
  lineNumber: number;
  /** Probe type: G38.2 (stop on contact, error if not), G38.3 (stop on contact),
   *              G38.4 (stop on loss of contact), G38.5 (stop on loss, error if not) */
  probeType: 'G38.2' | 'G38.3' | 'G38.4' | 'G38.5';
  /** Target X position */
  x: number;
  /** Target Y position */
  y: number;
  /** Target Z position */
  z: number;
  /** Feed rate for probing */
  feedRate: number;
  /** Axis being probed */
  axis: 'X' | 'Y' | 'Z';
}

/**
 * Parse probing cycles (G38.2-G38.5).
 * These are used for tool setting, work coordinate setting, and part inspection.
 *
 * @param lines G-code lines
 */
export function parseProbeEvents(lines: string[]): ProbeEvent[] {
  const events: ProbeEvent[] = [];
  let prevX = 0, prevY = 0, prevZ = 0;
  let currentFeedRate = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Track feed rate
    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) currentFeedRate = parseFloat(fMatch[1]);

    // Track position
    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    if (xMatch) prevX = parseFloat(xMatch[1]);
    if (yMatch) prevY = parseFloat(yMatch[1]);
    if (zMatch) prevZ = parseFloat(zMatch[1]);

    // Check for probe cycles
    const probeMatch = code.match(/\bG38\.([2-5])\b/i);
    if (probeMatch) {
      const probeNum = probeMatch[1];
      const probeType = `G38.${probeNum}` as 'G38.2' | 'G38.3' | 'G38.4' | 'G38.5';

      // Determine which axis is being probed (the one that changed)
      let axis: 'X' | 'Y' | 'Z' = 'Z'; // default
      if (xMatch && !yMatch && !zMatch) axis = 'X';
      else if (yMatch && !xMatch && !zMatch) axis = 'Y';
      else if (zMatch && !xMatch && !yMatch) axis = 'Z';
      else if (zMatch) axis = 'Z'; // Z is most common

      events.push({
        lineNumber: i,
        probeType,
        x: prevX,
        y: prevY,
        z: prevZ,
        feedRate: currentFeedRate,
        axis,
      });
    }
  }

  return events;
}

// ── 10. Subprogram Call Tracing (CNC) ──

export interface SubprogramCall {
  /** G-code line number where M98 is called */
  lineNumber: number;
  /** Subprogram number (O number or P value) */
  subprogramNumber: number;
  /** Number of times to call (L value, default 1) */
  loopCount: number;
  /** Call depth (0 = top level, 1 = called from within a subprogram) */
  depth: number;
}

export interface SubprogramDefinition {
  /** G-code line number where the subprogram is defined */
  lineNumber: number;
  /** Subprogram number (O number) */
  number: number;
  /** End line number (M99 or M30) */
  endLine: number;
}

/**
 * Parse subprogram calls (M98) and definitions (O numbers).
 * Tracks the call stack depth for nested subprogram calls.
 *
 * @param lines G-code lines
 */
export function parseSubprograms(lines: string[]): {
  calls: SubprogramCall[];
  definitions: SubprogramDefinition[];
} {
  const calls: SubprogramCall[] = [];
  const definitions: SubprogramDefinition[] = [];
  const callStack: number[] = []; // stack of O numbers

  let currentDefStart = -1;
  let currentDefNumber = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Check for subprogram definition (O number)
    const oMatch = code.match(/\bO(\d+)\b/i);
    if (oMatch && currentDefStart < 0) {
      currentDefStart = i;
      currentDefNumber = parseInt(oMatch[1]);
      continue;
    }

    // Check for M98 (call subprogram)
    if (/\bM98\b/i.test(code)) {
      const pMatch = code.match(/\bP(\d+)/i);
      const lMatch = code.match(/\bL(\d+)/i);
      if (pMatch) {
        calls.push({
          lineNumber: i,
          subprogramNumber: parseInt(pMatch[1]),
          loopCount: lMatch ? parseInt(lMatch[1]) : 1,
          depth: callStack.length,
        });
      }
      continue;
    }

    // Check for M99 (return from subprogram) or M30 (end main program)
    if (/\bM99\b/i.test(code)) {
      if (currentDefStart >= 0 && currentDefNumber >= 0) {
        definitions.push({
          lineNumber: currentDefStart,
          number: currentDefNumber,
          endLine: i,
        });
        currentDefStart = -1;
        currentDefNumber = -1;
      }
      continue;
    }

    if (/\bM30\b/i.test(code)) {
      if (currentDefStart >= 0 && currentDefNumber >= 0) {
        definitions.push({
          lineNumber: currentDefStart,
          number: currentDefNumber,
          endLine: i,
        });
        currentDefStart = -1;
        currentDefNumber = -1;
      }
    }
  }

  return { calls, definitions };
}

// ── 11. Cost Estimation (Universal) ──

export interface CostEstimate {
  /** Material cost in currency units */
  materialCost: number;
  /** Machine time cost in currency units */
  machineCost: number;
  /** Total cost */
  totalCost: number;
  /** Estimated time in seconds */
  estimatedTime: number;
  /** Material used in grams */
  materialWeight: number;
  /** Breakdown details */
  details: {
    materialPricePerGram: number;
    machineRatePerHour: number;
    setupTime: number;
    overheadRate: number;
    overheadCost: number;
  };
}

/**
 * Estimate the cost of a print/machining job.
 *
 * @param estimatedTime Estimated time in seconds
 * @param materialWeight Material weight in grams
 * @param materialPricePerGram Material price per gram (default: $0.05/g for PLA)
 * @param machineRatePerHour Machine hourly rate (default: $10/hour)
 * @param setupTime Setup time in seconds (default: 300 = 5 min)
 * @param overheadRate Overhead as fraction of machine cost (default: 0.2 = 20%)
 */
export function estimateJobCost(
  estimatedTime: number,
  materialWeight: number,
  materialPricePerGram: number = 0.05,
  machineRatePerHour: number = 10,
  setupTime: number = 300,
  overheadRate: number = 0.2,
): CostEstimate {
  const materialCost = materialWeight * materialPricePerGram;
  const totalTimeHours = (estimatedTime + setupTime) / 3600;
  const machineCost = totalTimeHours * machineRatePerHour;
  const overheadCost = machineCost * overheadRate;
  const totalCost = materialCost + machineCost + overheadCost;

  return {
    materialCost,
    machineCost,
    totalCost,
    estimatedTime,
    materialWeight,
    details: {
      materialPricePerGram,
      machineRatePerHour,
      setupTime,
      overheadRate,
      overheadCost,
    },
  };
}

// ── 12. G-code Diff (Universal) ──

export interface GcodeDiffResult {
  /** Lines added in the new file (not in old) */
  added: { lineNumber: number; content: string }[];
  /** Lines removed from the old file (not in new) */
  removed: { lineNumber: number; content: string }[];
  /** Lines modified (same position, different content) */
  modified: { oldLineNumber: number; newLineNumber: number; oldContent: string; newContent: string }[];
  /** Lines that are identical */
  unchanged: number;
  /** Summary statistics */
  summary: {
    totalAdded: number;
    totalRemoved: number;
    totalModified: number;
    totalUnchanged: number;
    similarityScore: number; // 0..1
  };
  /** Changed G-code words (semantic diff) */
  wordChanges: { lineNumber: number; word: string; oldValue: string; newValue: string }[];
}

/**
 * Compare two G-code files and produce a structural diff.
 * Uses line-by-line comparison with semantic word-level change detection.
 *
 * @param oldLines Old G-code lines
 * @param newLines New G-code lines
 */
export function diffGcode(oldLines: string[], newLines: string[]): GcodeDiffResult {
  const added: { lineNumber: number; content: string }[] = [];
  const removed: { lineNumber: number; content: string }[] = [];
  const modified: { oldLineNumber: number; newLineNumber: number; oldContent: string; newContent: string }[] = [];
  const wordChanges: { lineNumber: number; word: string; oldValue: string; newValue: string }[] = [];
  let unchanged = 0;

  // Use LCS-based diff for better alignment
  const maxLen = Math.max(oldLines.length, newLines.length);
  const minLen = Math.min(oldLines.length, newLines.length);

  // Simple line-by-line comparison (LCS would be more sophisticated)
  for (let i = 0; i < maxLen; i++) {
    if (i < minLen) {
      const oldLine = oldLines[i].trim();
      const newLine = newLines[i].trim();
      if (oldLine === newLine) {
        unchanged++;
      } else {
        modified.push({
          oldLineNumber: i,
          newLineNumber: i,
          oldContent: oldLines[i],
          newContent: newLines[i],
        });

        // Semantic word-level diff
        const oldWords = oldLine.match(/([A-Za-z])(-?\d*\.?\d+)/g) || [];
        const newWords = newLine.match(/([A-Za-z])(-?\d*\.?\d+)/g) || [];
        const oldMap = new Map<string, string>();
        const newMap = new Map<string, string>();
        for (const w of oldWords) oldMap.set(w[0].toUpperCase(), w);
        for (const w of newWords) newMap.set(w[0].toUpperCase(), w);

        for (const key of new Set([...oldMap.keys(), ...newMap.keys()])) {
          const oldVal = oldMap.get(key);
          const newVal = newMap.get(key);
          if (oldVal !== newVal) {
            wordChanges.push({
              lineNumber: i,
              word: key,
              oldValue: oldVal ?? '(none)',
              newValue: newVal ?? '(none)',
            });
          }
        }
      }
    } else if (i < newLines.length) {
      added.push({ lineNumber: i, content: newLines[i] });
    } else if (i < oldLines.length) {
      removed.push({ lineNumber: i, content: oldLines[i] });
    }
  }

  const totalAdded = added.length;
  const totalRemoved = removed.length;
  const totalModified = modified.length;
  const totalUnchanged = unchanged;
  const totalLines = maxLen;
  const similarityScore = totalLines > 0 ? totalUnchanged / totalLines : 1;

  return {
    added,
    removed,
    modified,
    unchanged,
    summary: {
      totalAdded,
      totalRemoved,
      totalModified,
      totalUnchanged,
      similarityScore,
    },
    wordChanges,
  };
}
