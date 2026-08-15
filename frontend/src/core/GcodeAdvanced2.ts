/**
 * @file GcodeAdvanced2.ts
 * @brief Second batch of advanced G-code analysis features for CNC and 3D printing.
 *
 * This module provides 12 additional high-impact features:
 *  1. Accurate motion profile time estimation (Universal)
 *  2. Multi-material/color change tracking (3DP)
 *  3. Bidirectional code-to-path linking (Universal)
 *  4. G-code hack panel — transform/modify G-code (Universal)
 *  5. Layer-by-layer animation controller (3DP)
 *  6. Support structure analysis (3DP)
 *  7. Infill density visualization (3DP)
 *  8. Custom macros/variables parsing (CNC)
 *  9. Multi-extruder tracking (3DP)
 * 10. Bed leveling mesh visualization (3DP)
 * 11. Bridge detection (3DP)
 * 12. Rapid plane/safe Z detection (CNC/3DP)
 */

// ── 1. Accurate Motion Profile Time Estimation ──

export interface MotionProfileParams {
  /** Maximum acceleration in mm/s² */
  maxAcceleration: number;
  /** Maximum deceleration in mm/s² */
  maxDeceleration: number;
  /** Maximum jerk in mm/s³ */
  maxJerk: number;
  /** Junction deviation (cornering) in mm */
  junctionDeviation: number;
  /** Minimum feed rate (planning) in mm/min */
  minFeedRate: number;
}

export interface MotionProfileResult {
  /** Total estimated time in seconds */
  totalTime: number;
  /** Total distance in mm */
  totalDistance: number;
  /** Number of moves analyzed */
  moveCount: number;
  /** Per-move time breakdown */
  moves: {
    lineNumber: number;
    distance: number;
    entrySpeed: number;
    exitSpeed: number;
    cruiseSpeed: number;
    time: number;
    hasAccel: boolean;
    hasDecel: boolean;
  }[];
  /** Average speed in mm/s */
  averageSpeed: number;
}

/**
 * Estimate print/machining time using trapezoidal motion profiles.
 * Accounts for acceleration, deceleration, and cornering speed reduction.
 *
 * @param moves Array of moves with positions and feed rates
 * @param params Motion profile parameters
 */
export function estimateMotionProfileTime(
  moves: { x: number; y: number; z: number; feedRate: number; lineNumber: number }[],
  params: MotionProfileParams,
): MotionProfileResult {
  if (moves.length === 0) {
    return { totalTime: 0, totalDistance: 0, moveCount: 0, moves: [], averageSpeed: 0 };
  }

  const result: MotionProfileResult['moves'] = [];
  let totalTime = 0;
  let totalDistance = 0;
  let prevSpeed = 0; // mm/s

  for (let i = 0; i < moves.length; i++) {
    const move = moves[i];
    const targetSpeed = move.feedRate / 60; // mm/min → mm/s

    if (i === 0) {
      // First move: accelerate from 0
      const dist = 0; // no previous point
      result.push({
        lineNumber: move.lineNumber,
        distance: 0,
        entrySpeed: 0,
        exitSpeed: targetSpeed,
        cruiseSpeed: targetSpeed,
        time: 0,
        hasAccel: false,
        hasDecel: false,
      });
      prevSpeed = targetSpeed;
      continue;
    }

    const prev = moves[i - 1];
    const dx = move.x - prev.x;
    const dy = move.y - prev.y;
    const dz = move.z - prev.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (dist < 1e-9) {
      result.push({
        lineNumber: move.lineNumber,
        distance: 0,
        entrySpeed: prevSpeed,
        exitSpeed: prevSpeed,
        cruiseSpeed: prevSpeed,
        time: 0,
        hasAccel: false,
        hasDecel: false,
      });
      continue;
    }

    // Cornering: reduce entry speed based on junction deviation
    let entrySpeed = prevSpeed;
    if (i < moves.length - 1) {
      const next = moves[i + 1];
      const inDx = move.x - prev.x;
      const inDy = move.y - prev.y;
      const inDz = move.z - prev.z;
      const outDx = next.x - move.x;
      const outDy = next.y - move.y;
      const outDz = next.z - move.z;
      const inLen = Math.sqrt(inDx * inDx + inDy * inDy + inDz * inDz);
      const outLen = Math.sqrt(outDx * outDx + outDy * outDy + outDz * outDz);
      if (inLen > 1e-9 && outLen > 1e-9) {
        const cosAngle = (inDx * outDx + inDy * outDy + inDz * outDz) / (inLen * outLen);
        const sinHalfAngle = Math.sqrt((1 - cosAngle) / 2);
        const junctionSpeed = Math.sqrt(params.maxAcceleration * params.junctionDeviation * sinHalfAngle);
        entrySpeed = Math.min(prevSpeed, junctionSpeed, targetSpeed);
      }
    }

    // Trapezoidal motion profile
    const accelDist = (targetSpeed * targetSpeed - entrySpeed * entrySpeed) / (2 * params.maxAcceleration);
    const decelDist = (targetSpeed * targetSpeed - targetSpeed * targetSpeed) / (2 * params.maxDeceleration);

    let cruiseSpeed = targetSpeed;
    let hasAccel = false;
    let hasDecel = false;
    let moveTime = 0;

    if (accelDist + decelDist > dist) {
      // Triangular profile: cannot reach cruise speed
      cruiseSpeed = Math.sqrt(
        (2 * params.maxAcceleration * params.maxDeceleration * dist +
          params.maxDeceleration * entrySpeed * entrySpeed) /
        (params.maxAcceleration + params.maxDeceleration),
      );
      hasAccel = cruiseSpeed > entrySpeed;
      hasDecel = true;
      const accelTime = (cruiseSpeed - entrySpeed) / params.maxAcceleration;
      const decelTime = cruiseSpeed / params.maxDeceleration;
      moveTime = accelTime + decelTime;
    } else {
      // Trapezoidal profile: accelerate, cruise, decelerate
      hasAccel = entrySpeed < targetSpeed;
      hasDecel = i === moves.length - 1; // decel at end
      const accelTime = (targetSpeed - entrySpeed) / params.maxAcceleration;
      const cruiseDist = dist - accelDist - (hasDecel ? decelDist : 0);
      const cruiseTime = cruiseDist / targetSpeed;
      const decelTime = hasDecel ? targetSpeed / params.maxDeceleration : 0;
      moveTime = accelTime + cruiseTime + decelTime;
    }

    totalTime += moveTime;
    totalDistance += dist;
    result.push({
      lineNumber: move.lineNumber,
      distance: dist,
      entrySpeed,
      exitSpeed: cruiseSpeed,
      cruiseSpeed,
      time: moveTime,
      hasAccel,
      hasDecel,
    });

    prevSpeed = cruiseSpeed;
  }

  const averageSpeed = totalTime > 0 ? totalDistance / totalTime : 0;

  return { totalTime, totalDistance, moveCount: moves.length, moves: result, averageSpeed };
}

// ── 2. Multi-Material/Color Change Tracking ──

export interface ColorChangeEvent {
  /** G-code line number */
  lineNumber: number;
  /** Color description from comment */
  color: string;
  /** Layer number (if available) */
  layer: number | null;
  /** Extruder number (if specified) */
  extruder: number | null;
}

/**
 * Parse color change events from G-code comments.
 * Supports PrusaSlicer/Cura ;COLOR_CHANGE format and M163/M164 extruder mixing.
 *
 * @param lines G-code lines
 */
export function parseColorChanges(lines: string[]): ColorChangeEvent[] {
  const events: ColorChangeEvent[] = [];
  let currentLayer = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track layer changes
    if (/;LAYER:/i.test(line)) {
      const match = line.match(/;LAYER:(\d+)/i);
      if (match) currentLayer = parseInt(match[1]);
    }

    // PrusaSlicer/Orca format: ;COLOR_CHANGE,T#,#RRGGBB or ;COLOR_CHANGE,#RRGGBB
    const colorMatch = line.match(/;COLOR_CHANGE(?:,T(\d+))?,(#[0-9A-Fa-f]{6}|\w+)/i);
    if (colorMatch) {
      events.push({
        lineNumber: i,
        color: colorMatch[2],
        layer: currentLayer,
        extruder: colorMatch[1] ? parseInt(colorMatch[1]) : null,
      });
    }

    // Cura format: ;COLOR,#
    const curaMatch = line.match(/;COLOR,(#[0-9A-Fa-f]{6}|\w+)/i);
    if (curaMatch) {
      events.push({
        lineNumber: i,
        color: curaMatch[1],
        layer: currentLayer,
        extruder: null,
      });
    }

    // M163/M164 extruder mixing (multi-extruder)
    if (/\bM163\b/i.test(line)) {
      const sMatch = line.match(/\bS(\d*\.?\d+)/i);
      const eMatch = line.match(/\bE(\d+)/i);
      if (eMatch && sMatch) {
        events.push({
          lineNumber: i,
          color: `MIX E${eMatch[1]}:${sMatch[1]}`,
          layer: currentLayer,
          extruder: parseInt(eMatch[1]),
        });
      }
    }
  }

  return events;
}

// ── 3. Bidirectional Code-to-Path Linking ──

export interface CodePathLink {
  /** G-code line number */
  lineNumber: number;
  /** Block/segment index in the toolpath */
  blockIndex: number;
  /** 3D position at this line (if available) */
  position: { x: number; y: number; z: number } | null;
}

/**
 * Build a bidirectional mapping between G-code lines and 3D path segments.
 * This enables clicking a G-code line to highlight the corresponding 3D path,
 * and clicking a 3D path segment to jump to the G-code.
 *
 * @param lines G-code lines
 * @param blockLineMap Optional map of blockIndex → [startLine, endLine]
 */
export function buildCodePathLinks(
  lines: string[],
  blockLineMap?: Map<number, [number, number]>,
): {
  lineToBlock: Map<number, number>;
  blockToLines: Map<number, number[]>;
  links: CodePathLink[];
} {
  const lineToBlock = new Map<number, number>();
  const blockToLines = new Map<number, number[]>();
  const links: CodePathLink[] = [];

  if (blockLineMap) {
    // Use provided block-line mapping
    for (const [blockIndex, [startLine, endLine]] of blockLineMap) {
      const lineList: number[] = [];
      for (let ln = startLine; ln <= endLine; ln++) {
        lineToBlock.set(ln, blockIndex);
        lineList.push(ln);
        links.push({ lineNumber: ln, blockIndex, position: null });
      }
      blockToLines.set(blockIndex, lineList);
    }
  } else {
    // Build from G-code: each G0/G1/G2/G3 line is a block
    let currentBlock = 0;
    let prevX = 0, prevY = 0, prevZ = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith(';') || line.startsWith('(')) continue;

      const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
      if (!code) continue;

      if (/\bG[0-3]\b/i.test(code)) {
        const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
        const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
        const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
        const x = xMatch ? parseFloat(xMatch[1]) : prevX;
        const y = yMatch ? parseFloat(yMatch[1]) : prevY;
        const z = zMatch ? parseFloat(zMatch[1]) : prevZ;

        lineToBlock.set(i, currentBlock);
        const list = blockToLines.get(currentBlock) ?? [];
        list.push(i);
        blockToLines.set(currentBlock, list);
        links.push({
          lineNumber: i,
          blockIndex: currentBlock,
          position: { x, y, z },
        });

        prevX = x; prevY = y; prevZ = z;
        currentBlock++;
      }
    }
  }

  return { lineToBlock, blockToLines, links };
}

// ── 4. G-code Hack Panel ──

export interface GcodeTransformOptions {
  /** Translate X by this amount (mm) */
  translateX?: number;
  /** Translate Y by this amount (mm) */
  translateY?: number;
  /** Translate Z by this amount (mm) */
  translateZ?: number;
  /** Rotate around Z by this angle (degrees) */
  rotateZ?: number;
  /** Mirror X axis */
  mirrorX?: boolean;
  /** Mirror Y axis */
  mirrorY?: boolean;
  /** Scale factor (1.0 = no change) */
  scale?: number;
  /** Swap tool numbers: { oldTool: newTool } */
  swapTools?: Map<number, number>;
  /** Feed rate multiplier (1.0 = no change) */
  feedRateMultiplier?: number;
  /** Spindle speed multiplier (1.0 = no change) */
  spindleMultiplier?: number;
}

/**
 * Transform G-code according to the given options.
 * This allows quick modifications without re-slicing or re-CAM.
 *
 * @param lines G-code lines
 * @param options Transform options
 */
export function transformGcode(
  lines: string[],
  options: GcodeTransformOptions,
): string[] {
  const {
    translateX = 0, translateY = 0, translateZ = 0,
    rotateZ = 0, mirrorX = false, mirrorY = false,
    scale = 1.0, swapTools, feedRateMultiplier = 1.0, spindleMultiplier = 1.0,
  } = options;

  const cosR = Math.cos(rotateZ * Math.PI / 180);
  const sinR = Math.sin(rotateZ * Math.PI / 180);

  return lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) return line;

    const commentIdx = line.indexOf(';');
    const codePart = commentIdx >= 0 ? line.substring(0, commentIdx) : line;
    const commentPart = commentIdx >= 0 ? line.substring(commentIdx) : '';

    let modified = codePart;

    // Transform X/Y
    const xMatch = modified.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = modified.match(/\bY(-?\d*\.?\d+)/i);

    if (xMatch) {
      let x = parseFloat(xMatch[1]);
      if (mirrorX) x = -x;
      x = x * scale + translateX;
      if (rotateZ !== 0 && yMatch) {
        const y = parseFloat(yMatch[1]) * (mirrorY ? -1 : 1) * scale + translateY;
        const newX = x * cosR - y * sinR;
        modified = modified.replace(/\bX-?\d*\.?\d+/i, `X${newX.toFixed(4)}`);
      } else {
        modified = modified.replace(/\bX-?\d*\.?\d+/i, `X${x.toFixed(4)}`);
      }
    }

    if (yMatch) {
      let y = parseFloat(yMatch[1]);
      if (mirrorY) y = -y;
      y = y * scale + translateY;
      if (rotateZ !== 0 && xMatch) {
        const x = parseFloat(xMatch[1]) * (mirrorX ? -1 : 1) * scale + translateX;
        const newY = x * sinR + y * cosR;
        modified = modified.replace(/\bY-?\d*\.?\d+/i, `Y${newY.toFixed(4)}`);
      } else {
        modified = modified.replace(/\bY-?\d*\.?\d+/i, `Y${y.toFixed(4)}`);
      }
    }

    // Transform Z
    if (translateZ !== 0) {
      const zMatch = modified.match(/\bZ(-?\d*\.?\d+)/i);
      if (zMatch) {
        const z = parseFloat(zMatch[1]) * scale + translateZ;
        modified = modified.replace(/\bZ-?\d*\.?\d+/i, `Z${z.toFixed(4)}`);
      }
    }

    // Swap tools
    if (swapTools) {
      const tMatch = modified.match(/\bT(\d+)/i);
      if (tMatch) {
        const oldTool = parseInt(tMatch[1]);
        const newTool = swapTools.get(oldTool);
        if (newTool !== undefined) {
          modified = modified.replace(/\bT\d+/i, `T${newTool}`);
        }
      }
    }

    // Feed rate multiplier
    if (feedRateMultiplier !== 1.0) {
      const fMatch = modified.match(/\bF(\d*\.?\d+)/i);
      if (fMatch) {
        const f = parseFloat(fMatch[1]) * feedRateMultiplier;
        modified = modified.replace(/\bF\d*\.?\d+/i, `F${f.toFixed(1)}`);
      }
    }

    // Spindle speed multiplier
    if (spindleMultiplier !== 1.0) {
      const sMatch = modified.match(/\bS(\d*\.?\d+)/i);
      if (sMatch && /\bM[034]\b/i.test(modified)) {
        const s = parseFloat(sMatch[1]) * spindleMultiplier;
        modified = modified.replace(/\bS\d*\.?\d+/i, `S${s.toFixed(0)}`);
      }
    }

    return modified + commentPart;
  });
}

// ── 5. Layer-by-Layer Animation Controller ──

export interface LayerAnimationFrame {
  /** Layer index */
  layerIndex: number;
  /** Z height of this layer */
  zHeight: number;
  /** Start time (seconds from start) */
  startTime: number;
  /** End time (seconds from start) */
  endTime: number;
  /** Duration of this layer in seconds */
  duration: number;
  /** Cumulative progress at end of this layer (0..1) */
  progress: number;
}

/**
 * Build a layer-by-layer animation timeline.
 * Each layer has a start/end time based on its estimated print time.
 *
 * @param zLayers Array of Z-layer info with estimated times
 * @param totalDuration Total print duration in seconds
 */
export function buildLayerAnimation(
  zLayers: { layerIndex: number; zHeight: number; timeSeconds: number }[],
  totalDuration: number,
): LayerAnimationFrame[] {
  const frames: LayerAnimationFrame[] = [];
  let currentTime = 0;
  const totalTime = zLayers.reduce((sum, l) => sum + l.timeSeconds, 0) || totalDuration;

  for (const layer of zLayers) {
    const duration = layer.timeSeconds;
    frames.push({
      layerIndex: layer.layerIndex,
      zHeight: layer.zHeight,
      startTime: currentTime,
      endTime: currentTime + duration,
      duration,
      progress: totalTime > 0 ? (currentTime + duration) / totalTime : 1,
    });
    currentTime += duration;
  }

  return frames;
}

/**
 * Get the current layer at a given time in the animation.
 */
export function getLayerAtTime(
  frames: LayerAnimationFrame[],
  time: number,
): LayerAnimationFrame | null {
  for (const frame of frames) {
    if (time >= frame.startTime && time < frame.endTime) {
      return frame;
    }
  }
  // If past the end, return the last frame
  if (frames.length > 0 && time >= frames[frames.length - 1].endTime) {
    return frames[frames.length - 1];
  }
  return null;
}

// ── 6. Support Structure Analysis ──

export interface SupportAnalysis {
  /** Total support material volume in mm³ */
  totalVolume: number;
  /** Total support material length in mm */
  totalLength: number;
  /** Number of support segments */
  segmentCount: number;
  /** Support layers (Z heights where support exists) */
  supportLayers: number[];
  /** Percentage of total extrusion that is support */
  supportPercentage: number;
  /** Breakdown by support type */
  byType: { type: string; length: number; volume: number }[];
}

/**
 * Analyze support structure in G-code.
 * Identifies support material by ;TYPE:SUPPORT comments and computes volume.
 *
 * @param lines G-code lines
 * @param totalExtrusionLength Total extrusion length in mm (for percentage)
 * @param filamentDiameter Filament diameter in mm (default 1.75)
 * @param extrusionWidth Extrusion width in mm (default 0.4)
 */
export function analyzeSupportStructure(
  lines: string[],
  totalExtrusionLength: number = 0,
  filamentDiameter: number = 1.75,
  extrusionWidth: number = 0.4,
): SupportAnalysis {
  let totalLength = 0;
  let segmentCount = 0;
  const supportLayers = new Set<number>();
  const byTypeMap = new Map<string, { length: number; volume: number }>();
  let currentType = 'SUPPORT';
  let currentLayer = -1;
  let prevE = 0;
  let prevX = 0, prevY = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Track layer
    const layerMatch = line.match(/;LAYER:(\d+)/i);
    if (layerMatch) {
      currentLayer = parseInt(layerMatch[1]);
      continue;
    }

    // Track feature type
    const typeMatch = line.match(/;TYPE:(.+)/i);
    if (typeMatch) {
      currentType = typeMatch[1].trim().toUpperCase();
      continue;
    }

    if (!line.startsWith('G1') && !line.startsWith('g1')) continue;

    const code = line.replace(/;.*$/, '').trim();
    const isSupport = currentType.includes('SUPPORT') || currentType.includes('TREE');

    if (!isSupport) {
      // Still track E for relative extrusion
      const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);
      if (eMatch) prevE = parseFloat(eMatch[1]);
      const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
      if (xMatch) prevX = parseFloat(xMatch[1]);
      if (yMatch) prevY = parseFloat(yMatch[1]);
      continue;
    }

    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);
    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);

    if (eMatch) {
      const newE = parseFloat(eMatch[1]);
      const eDelta = newE - prevE;
      if (eDelta > 0) {
        // Extrusion length = E delta * filament cross-section / extrusion width
        // Volume = E delta * π * (filamentDiameter/2)²
        const filamentArea = Math.PI * (filamentDiameter / 2) ** 2;
        const volume = eDelta * filamentArea;
        const length = volume / (extrusionWidth * extrusionWidth * 0.75); // approximate

        totalLength += eDelta; // E delta is the filament length consumed
        segmentCount++;
        if (currentLayer >= 0) supportLayers.add(currentLayer);

        const typeData = byTypeMap.get(currentType) ?? { length: 0, volume: 0 };
        typeData.length += eDelta;
        typeData.volume += volume;
        byTypeMap.set(currentType, typeData);
      }
      prevE = newE;
    }

    if (xMatch) prevX = parseFloat(xMatch[1]);
    if (yMatch) prevY = parseFloat(yMatch[1]);
  }

  const filamentArea = Math.PI * (filamentDiameter / 2) ** 2;
  const totalVolume = totalLength * filamentArea;
  const supportPercentage = totalExtrusionLength > 0 ? (totalLength / totalExtrusionLength) * 100 : 0;

  const byType = Array.from(byTypeMap.entries()).map(([type, data]) => ({
    type,
    length: data.length,
    volume: data.volume,
  }));

  return {
    totalVolume,
    totalLength,
    segmentCount,
    supportLayers: Array.from(supportLayers).sort((a, b) => a - b),
    supportPercentage,
    byType,
  };
}

// ── 7. Infill Density Visualization ──

export interface InfillDensityInfo {
  /** Layer number */
  layer: number;
  /** Infill density percentage (0-100) */
  density: number;
  /** Infill pattern name */
  pattern: string;
  /** G-code line number where this was defined */
  lineNumber: number;
}

/**
 * Parse infill density information from G-code comments.
 * Slicers often include ;INFILL_DENSITY or ;FILL_DENSITY comments.
 *
 * @param lines G-code lines
 */
export function parseInfillDensity(lines: string[]): InfillDensityInfo[] {
  const infos: InfillDensityInfo[] = [];
  let currentLayer = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const layerMatch = line.match(/;LAYER:(\d+)/i);
    if (layerMatch) {
      currentLayer = parseInt(layerMatch[1]);
    }

    // PrusaSlicer/Orca: ;INFILL_DENSITY, ;FILL_DENSITY
    const densityMatch = line.match(/;(?:INFILL|FILL)_DENSITY[:\s,]+(\d+\.?\d*)/i);
    if (densityMatch) {
      infos.push({
        layer: currentLayer,
        density: parseFloat(densityMatch[1]),
        pattern: 'unknown',
        lineNumber: i,
      });
    }

    // Cura: ;FILL_PERIMETER_OVERLAP or ;INFILL_SPACING
    const spacingMatch = line.match(/;INFILL_SPACING[:\s,]+(\d+\.?\d*)/i);
    if (spacingMatch) {
      const spacing = parseFloat(spacingMatch[1]);
      // Density = extrusionWidth / (extrusionWidth + spacing) * 100
      const extWidth = 0.4; // default
      const density = (extWidth / (extWidth + spacing)) * 100;
      infos.push({
        layer: currentLayer,
        density,
        pattern: 'unknown',
        lineNumber: i,
      });
    }

    // Pattern: ;INFILL_PATTERN or ;FILL_PATTERN
    const patternMatch = line.match(/;(?:INFILL|FILL)_PATTERN[:\s,]+(\w+)/i);
    if (patternMatch && infos.length > 0) {
      infos[infos.length - 1].pattern = patternMatch[1].toLowerCase();
    }
  }

  return infos;
}

/**
 * Compute infill density from G-code moves by measuring extrusion spacing.
 * Estimates density by analyzing the distance between parallel infill lines.
 *
 * @param lines G-code lines
 * @param layerIndex Layer to analyze
 * @param layerStart Start line of the layer
 * @param layerEnd End line of the layer
 */
export function estimateInfillDensityFromMoves(
  lines: string[],
  layerStart: number,
  layerEnd: number,
): { estimatedDensity: number; lineSpacing: number; direction: string } {
  const extrudingMoves: { x: number; y: number }[] = [];
  let prevE = 0;

  for (let i = layerStart; i <= Math.min(layerEnd, lines.length - 1); i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';')) continue;
    if (!/^G1\b/i.test(line)) continue;

    const code = line.replace(/;.*$/, '').trim();
    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);
    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);

    if (eMatch) {
      const newE = parseFloat(eMatch[1]);
      if (newE > prevE && xMatch && yMatch) {
        extrudingMoves.push({ x: parseFloat(xMatch[1]), y: parseFloat(yMatch[1]) });
      }
      prevE = newE;
    }
  }

  if (extrudingMoves.length < 2) {
    return { estimatedDensity: 0, lineSpacing: 0, direction: 'unknown' };
  }

  // Determine dominant direction
  let xRange = 0, yRange = 0;
  const xs = extrudingMoves.map(m => m.x);
  const ys = extrudingMoves.map(m => m.y);
  xRange = Math.max(...xs) - Math.min(...xs);
  yRange = Math.max(...ys) - Math.min(...ys);
  const direction = xRange > yRange ? 'X' : 'Y';

  // Find line spacing by looking at perpendicular distances
  const spacings: number[] = [];
  const extWidth = 0.4; // default extrusion width

  if (direction === 'X') {
    // Lines are along X, spacing is in Y
    const yValues = Array.from(new Set(ys.map(y => Math.round(y * 100) / 100))).sort((a, b) => a - b);
    for (let i = 1; i < yValues.length; i++) {
      spacings.push(yValues[i] - yValues[i - 1]);
    }
  } else {
    const xValues = Array.from(new Set(xs.map(x => Math.round(x * 100) / 100))).sort((a, b) => a - b);
    for (let i = 1; i < xValues.length; i++) {
      spacings.push(xValues[i] - xValues[i - 1]);
    }
  }

  if (spacings.length === 0) {
    return { estimatedDensity: 100, lineSpacing: extWidth, direction };
  }

  // Filter out very small spacings (same line)
  const filteredSpacings = spacings.filter(s => s > extWidth * 0.5);
  if (filteredSpacings.length === 0) {
    return { estimatedDensity: 100, lineSpacing: extWidth, direction };
  }

  const avgSpacing = filteredSpacings.reduce((a, b) => a + b, 0) / filteredSpacings.length;
  const density = Math.min(100, (extWidth / avgSpacing) * 100);

  return { estimatedDensity: density, lineSpacing: avgSpacing, direction };
}

// ── 8. Custom Macros/Variables Parsing ──

export interface MacroVariable {
  /** Variable number (e.g., #100) */
  number: number;
  /** Variable value */
  value: number;
  /** G-code line number where defined */
  lineNumber: number;
  /** Whether this is a system variable (#1xxx) or user variable (#100-#999) */
  type: 'user' | 'system' | 'local';
}

export interface MacroCall {
  /** G-code line number */
  lineNumber: number;
  /** Macro name (G65, G66, M98 with O number) */
  macroName: string;
  /** Subprogram number (O number) */
  subprogramNumber: number | null;
  /** Arguments passed to the macro */
  arguments: { letter: string; value: number }[];
}

/**
 * Parse macro variables (#100, #500, etc.) and macro calls (G65, G66, M98).
 *
 * @param lines G-code lines
 */
export function parseMacros(lines: string[]): {
  variables: MacroVariable[];
  calls: MacroCall[];
} {
  const variables: MacroVariable[] = [];
  const calls: MacroCall[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('(') || line.startsWith(';')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();

    // Variable assignment: #100 = 5.0
    const assignMatch = code.match(/#(\d+)\s*=\s*(-?\d*\.?\d+)/);
    if (assignMatch) {
      const num = parseInt(assignMatch[1]);
      const value = parseFloat(assignMatch[2]);
      let type: 'user' | 'system' | 'local' = 'user';
      if (num >= 1 && num <= 33) type = 'local';
      else if (num >= 100 && num <= 999) type = 'user';
      else if (num >= 1000) type = 'system';

      variables.push({ number: num, value, lineNumber: i, type });
    }

    // Macro call: G65 P1001 A5 B10
    const g65Match = code.match(/\bG65\b/i);
    if (g65Match) {
      const pMatch = code.match(/\bP(\d+)/i);
      const args: { letter: string; value: number }[] = [];
      // Parse arguments after the P parameter: single letters followed by numbers
      // Exclude G/M/O words (G-codes, M-codes, O-numbers)
      const argMatches = code.matchAll(/\b([A-NQ-Z])(-?\d*\.?\d+)/gi);
      for (const m of argMatches) {
        const letter = m[1].toUpperCase();
        // Skip if this is part of G65 itself
        if (letter === 'G' && parseFloat(m[2]) === 65) continue;
        args.push({ letter, value: parseFloat(m[2]) });
      }
      calls.push({
        lineNumber: i,
        macroName: 'G65',
        subprogramNumber: pMatch ? parseInt(pMatch[1]) : null,
        arguments: args,
      });
    }

    // G66 modal macro call
    const g66Match = code.match(/\bG66\b/i);
    if (g66Match) {
      const pMatch = code.match(/\bP(\d+)/i);
      calls.push({
        lineNumber: i,
        macroName: 'G66',
        subprogramNumber: pMatch ? parseInt(pMatch[1]) : null,
        arguments: [],
      });
    }
  }

  return { variables, calls };
}

// ── 9. Multi-Extruder Tracking ──

export interface ExtruderInfo {
  /** Extruder number (0-based) */
  extruder: number;
  /** Total filament used by this extruder in mm */
  filamentLength: number;
  /** Total volume used by this extruder in mm³ */
  volume: number;
  /** Total weight used by this extruder in grams */
  weight: number;
  /** Number of tool changes to this extruder */
  toolChanges: number;
  /** First G-code line using this extruder */
  firstLine: number;
  /** Last G-code line using this extruder */
  lastLine: number;
}

/**
 * Track per-extruder material usage from G-code.
 * Handles M104 T#, T0/T1 commands, and E values per extruder.
 *
 * @param lines G-code lines
 * @param filamentDiameter Filament diameter in mm (default 1.75)
 * @param density Filament density in g/cm³ (default 1.24 for PLA)
 */
export function trackMultiExtruder(
  lines: string[],
  filamentDiameter: number = 1.75,
  density: number = 1.24,
): ExtruderInfo[] {
  const extruderMap = new Map<number, {
    filamentLength: number; volume: number; toolChanges: number;
    firstLine: number; lastLine: number;
  }>();

  let currentExtruder = 0;
  let prevE = 0;
  let prevEPerExtruder = new Map<number, number>();

  const getOrCreate = (n: number) => {
    let info = extruderMap.get(n);
    if (!info) {
      info = { filamentLength: 0, volume: 0, toolChanges: 0, firstLine: -1, lastLine: -1 };
      extruderMap.set(n, info);
    }
    return info;
  };

  getOrCreate(0); // ensure extruder 0 exists

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Tool change: T0, T1, etc.
    const toolMatch = code.match(/\bT(\d+)\b/);
    if (toolMatch && /\bM6\b/i.test(code)) {
      const newExtruder = parseInt(toolMatch[1]);
      if (newExtruder !== currentExtruder) {
        const info = getOrCreate(newExtruder);
        info.toolChanges++;
        currentExtruder = newExtruder;
        prevE = prevEPerExtruder.get(currentExtruder) ?? 0;
      }
    } else if (toolMatch && !/\bM6\b/i.test(code) && !/\bG[0-9]\b/i.test(code)) {
      // Standalone T command (some printers)
      const newExtruder = parseInt(toolMatch[1]);
      if (newExtruder !== currentExtruder) {
        currentExtruder = newExtruder;
        prevE = prevEPerExtruder.get(currentExtruder) ?? 0;
      }
    }

    // Track extrusion
    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);
    if (eMatch) {
      const newE = parseFloat(eMatch[1]);
      const eDelta = newE - prevE;
      if (eDelta > 0) {
        const info = getOrCreate(currentExtruder);
        info.filamentLength += eDelta;
        const filamentArea = Math.PI * (filamentDiameter / 2) ** 2;
        info.volume += eDelta * filamentArea;
        if (info.firstLine < 0) info.firstLine = i;
        info.lastLine = i;
      }
      prevE = newE;
      prevEPerExtruder.set(currentExtruder, newE);
    }
  }

  const filamentArea = Math.PI * (filamentDiameter / 2) ** 2;
  const result: ExtruderInfo[] = [];
  for (const [extruder, info] of extruderMap) {
    result.push({
      extruder,
      filamentLength: info.filamentLength,
      volume: info.volume,
      weight: (info.volume * density) / 1000, // cm³ → g
      toolChanges: info.toolChanges,
      firstLine: info.firstLine,
      lastLine: info.lastLine,
    });
  }

  return result.sort((a, b) => a.extruder - b.extruder);
}

// ── 10. Bed Leveling Mesh Visualization ──

export interface BedLevelingPoint {
  /** Grid X position */
  x: number;
  /** Grid Y position */
  y: number;
  /** Z compensation at this point in mm */
  zCompensation: number;
  /** Row index in the mesh grid */
  row: number;
  /** Column index in the mesh grid */
  col: number;
}

export interface BedLevelingMesh {
  /** Mesh points in a grid */
  points: BedLevelingPoint[];
  /** Number of rows in the mesh */
  rows: number;
  /** Number of columns in the mesh */
  cols: number;
  /** X range of the mesh */
  xRange: { min: number; max: number };
  /** Y range of the mesh */
  yRange: { min: number; max: number };
  /** Z compensation range */
  zRange: { min: number; max: number };
  /** Average Z compensation */
  averageZ: number;
}

/**
 * Parse bed leveling mesh data from G-code.
 * Supports Marlin G29 (auto bed leveling) and M420 S0 V1 (mesh report).
 *
 * @param lines G-code lines
 */
export function parseBedLevelingMesh(lines: string[]): BedLevelingMesh | null {
  let inMesh = false;
  let meshStartLine = -1;
  const rawPoints: { x: number; y: number; z: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Marlin M420 S0 V1 — mesh report starts after this
    if (/M420\s+S0\s+V1/i.test(line)) {
      inMesh = true;
      meshStartLine = i;
      continue;
    }

    // G29 S0 — output mesh
    if (/G29\s+S0/i.test(line)) {
      inMesh = true;
      meshStartLine = i;
      continue;
    }

    // End of mesh
    if (inMesh && (line.startsWith(';') || line === '')) {
      if (rawPoints.length > 0) break;
      continue;
    }

    if (inMesh) {
      // Marlin format: "  0  1  2  3" (grid header) then rows with X/Y/Z values
      // Or: "X10.0 Y10.0 Z0.05"
      const xyzMatch = line.match(/X(-?\d*\.?\d+)\s+Y(-?\d*\.?\d+)\s+Z(-?\d*\.?\d+)/i);
      if (xyzMatch) {
        rawPoints.push({
          x: parseFloat(xyzMatch[1]),
          y: parseFloat(xyzMatch[2]),
          z: parseFloat(xyzMatch[3]),
        });
      } else {
        // Try tabular format: numbers separated by spaces
        const nums = line.split(/\s+/).map(Number).filter(n => !isNaN(n));
        if (nums.length >= 3 && rawPoints.length > 0) {
          // Could be a row of Z values
          // This format is harder to parse without more context
        }
      }
    }
  }

  if (rawPoints.length === 0) return null;

  // Determine grid dimensions
  const xValues = Array.from(new Set(rawPoints.map(p => p.x))).sort((a, b) => a - b);
  const yValues = Array.from(new Set(rawPoints.map(p => p.y))).sort((a, b) => a - b);
  const cols = xValues.length;
  const rows = yValues.length;

  const points: BedLevelingPoint[] = rawPoints.map(p => ({
    x: p.x,
    y: p.y,
    zCompensation: p.z,
    row: yValues.indexOf(p.y),
    col: xValues.indexOf(p.x),
  }));

  const zValues = rawPoints.map(p => p.z);
  const zMin = Math.min(...zValues);
  const zMax = Math.max(...zValues);
  const avgZ = zValues.reduce((a, b) => a + b, 0) / zValues.length;

  return {
    points,
    rows,
    cols,
    xRange: { min: xValues[0], max: xValues[xValues.length - 1] },
    yRange: { min: yValues[0], max: yValues[yValues.length - 1] },
    zRange: { min: zMin, max: zMax },
    averageZ: avgZ,
  };
}

// ── 11. Bridge Detection ──

export interface BridgeRegion {
  /** Start line of the bridge */
  startLine: number;
  /** End line of the bridge */
  endLine: number;
  /** Z height of the bridge */
  zHeight: number;
  /** Bridge length in mm */
  length: number;
  /** Bridge direction in degrees */
  direction: number;
  /** Severity: 'short' (<5mm), 'medium' (5-20mm), 'long' (>20mm) */
  severity: 'short' | 'medium' | 'long';
}

/**
 * Detect bridges in G-code.
 * A bridge is an extruding move at a new Z height where the previous layer
 * had no material beneath (i.e., the move spans a gap).
 *
 * @param lines G-code lines
 * @param zLayers Array of Z-layer info
 */
export function detectBridges(
  lines: string[],
  zLayers: { layerIndex: number; zHeight: number; startLine: number; endLine: number }[],
): BridgeRegion[] {
  const bridges: BridgeRegion[] = [];

  for (let li = 1; li < zLayers.length; li++) {
    const layer = zLayers[li];
    let prevX = 0, prevY = 0;
    let prevE = 0;
    let inBridge = false;
    let bridgeStart = 0;
    let bridgeStartX = 0, bridgeStartY = 0;

    for (let i = layer.startLine; i <= Math.min(layer.endLine, lines.length - 1); i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith(';') || line.startsWith('(')) continue;

      const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
      if (!code || !/^G1\b/i.test(code)) continue;

      const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
      const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

      const x = xMatch ? parseFloat(xMatch[1]) : prevX;
      const y = yMatch ? parseFloat(yMatch[1]) : prevY;

      if (eMatch) {
        const newE = parseFloat(eMatch[1]);
        const isExtruding = newE > prevE;

        // Check if this is a bridge: extruding at the start of a new layer
        // with a significant move (usually the first few moves of a layer are bridges
        // if they span a gap)
        const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);

        if (isExtruding && dist > 2.0) {
          // Check if this is at the beginning of the layer (first 5 lines = likely bridge)
          const linesFromStart = i - layer.startLine;
          if (linesFromStart < 10 && !inBridge) {
            inBridge = true;
            bridgeStart = i;
            bridgeStartX = prevX;  // start of the bridge = previous position
            bridgeStartY = prevY;
          }
        } else if (!isExtruding && inBridge) {
          // Travel move ends the bridge
          const bridgeLen = Math.sqrt((x - bridgeStartX) ** 2 + (y - bridgeStartY) ** 2);
          if (bridgeLen > 1.0) {
            const direction = Math.atan2(y - bridgeStartY, x - bridgeStartX) * (180 / Math.PI);
            let severity: 'short' | 'medium' | 'long';
            if (bridgeLen > 20) severity = 'long';
            else if (bridgeLen > 5) severity = 'medium';
            else severity = 'short';

            bridges.push({
              startLine: bridgeStart,
              endLine: i,
              zHeight: layer.zHeight,
              length: bridgeLen,
              direction,
              severity,
            });
          }
          inBridge = false;
        }

        prevE = newE;
      }

      prevX = x;
      prevY = y;
    }

    // Close any open bridge at end of layer
    if (inBridge) {
      const bridgeLen = Math.sqrt((prevX - bridgeStartX) ** 2 + (prevY - bridgeStartY) ** 2);
      if (bridgeLen > 1.0) {
        const direction = Math.atan2(prevY - bridgeStartY, prevX - bridgeStartX) * (180 / Math.PI);
        let severity: 'short' | 'medium' | 'long';
        if (bridgeLen > 20) severity = 'long';
        else if (bridgeLen > 5) severity = 'medium';
        else severity = 'short';

        bridges.push({
          startLine: bridgeStart,
          endLine: layer.endLine,
          zHeight: layer.zHeight,
          length: bridgeLen,
          direction,
          severity,
        });
      }
    }
  }

  return bridges;
}

// ── 12. Rapid Plane/Safe Z Detection ──

export interface RapidPlane {
  /** Z height of the safe plane in mm */
  zHeight: number;
  /** Number of rapid moves at this Z height */
  rapidCount: number;
  /** Total travel distance at this Z height */
  totalTravel: number;
  /** Whether this is the primary safe Z (most common) */
  isPrimary: boolean;
}

/**
 * Detect safe Z planes used for rapid moves.
 * This identifies the Z heights where the toolhead travels safely above the part.
 *
 * @param lines G-code lines
 */
export function detectRapidPlanes(lines: string[]): RapidPlane[] {
  const planeMap = new Map<number, { rapidCount: number; totalTravel: number }>();
  let prevX = 0, prevY = 0, prevZ = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const isRapid = /\bG0\b/i.test(code);
    if (!isRapid) {
      // Track position for non-rapid moves too
      const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
      const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
      if (xMatch) prevX = parseFloat(xMatch[1]);
      if (yMatch) prevY = parseFloat(yMatch[1]);
      if (zMatch) prevZ = parseFloat(zMatch[1]);
      continue;
    }

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);

    const newX = xMatch ? parseFloat(xMatch[1]) : prevX;
    const newY = yMatch ? parseFloat(yMatch[1]) : prevY;
    const newZ = zMatch ? parseFloat(zMatch[1]) : prevZ;

    // Only track Z planes where Z is specified or maintained
    if (zMatch || prevZ > 0) {
      const zKey = Math.round(newZ * 100) / 100; // round to 0.01mm
      const data = planeMap.get(zKey) ?? { rapidCount: 0, totalTravel: 0 };
      data.rapidCount++;

      const dist = Math.sqrt(
        (newX - prevX) ** 2 + (newY - prevY) ** 2 + (newZ - prevZ) ** 2,
      );
      data.totalTravel += dist;
      planeMap.set(zKey, data);
    }

    prevX = newX;
    prevY = newY;
    prevZ = newZ;
  }

  if (planeMap.size === 0) return [];

  // Find the primary safe Z (most rapids)
  let maxCount = 0;
  let primaryZ = 0;
  for (const [z, data] of planeMap) {
    if (data.rapidCount > maxCount) {
      maxCount = data.rapidCount;
      primaryZ = z;
    }
  }

  const planes: RapidPlane[] = [];
  for (const [z, data] of planeMap) {
    planes.push({
      zHeight: z,
      rapidCount: data.rapidCount,
      totalTravel: data.totalTravel,
      isPrimary: z === primaryZ,
    });
  }

  // Sort by rapid count descending
  planes.sort((a, b) => b.rapidCount - a.rapidCount);
  return planes;
}
