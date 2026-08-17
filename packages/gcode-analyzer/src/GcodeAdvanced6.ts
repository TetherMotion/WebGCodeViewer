/**
 * @file GcodeAdvanced6.ts
 * @brief Sixth batch of advanced G-code analysis features for CNC and 3D printing.
 *
 * This module provides 12 additional high-impact features:
 *  1. Cost estimation (Universal) — material + machine time + energy cost
 *  2. Climb vs conventional milling detection (CNC) — cutting direction analysis
 *  3. Acceleration-limited speed estimation (Universal) — jerk/accel limits
 *  4. Energy consumption estimation (Universal) — power usage during operation
 *  5. Work offset / coordinate system analysis (CNC) — G54-G59 work offsets
 *  6. Material parameter recommendations (3DP) — PLA/ABS/PETG/TPU settings
 *  7. G-code pattern recognition (Universal) — detect spirals, zigzags, contours
 *  8. Print difficulty rating (3DP) — overall difficulty score
 *  9. Tool deflection estimation (CNC) — tool deflection from cutting forces
 * 10. G-code compression/optimization (Universal) — remove redundant commands
 * 11. Thermal expansion compensation (CNC) — account for thermal expansion
 * 12. Subprogram expansion (Universal) — expand M98/M99/G65 subprogram calls
 */

// ── 1. Cost Estimation ──

export interface CostEstimate {
  /** Material cost in currency units */
  materialCost: number;
  /** Machine time cost in currency units */
  machineTimeCost: number;
  /** Energy cost in currency units */
  energyCost: number;
  /** Total cost in currency units */
  totalCost: number;
  /** Material weight in grams */
  materialWeight: number;
  /** Material price per kg */
  materialPricePerKg: number;
  /** Machine hourly rate */
  machineHourlyRate: number;
  /** Total time in hours */
  totalTimeHours: number;
  /** Energy used in kWh */
  energyUsed: number;
  /** Energy price per kWh */
  energyPricePerKwh: number;
  /** Cost breakdown percentages */
  breakdown: { material: number; machine: number; energy: number };
}

export interface CostEstimationParams {
  /** Material price per kg */
  materialPricePerKg: number;
  /** Machine hourly rate */
  machineHourlyRate: number;
  /** Energy price per kWh */
  energyPricePerKwh: number;
  /** Average power consumption in Watts */
  averagePowerWatts: number;
  /** Filament density in g/cm³ */
  density: number;
}

/**
 * Estimate total cost of a print/machining job.
 *
 * @param filamentLength Total filament length in mm (3DP) or material volume in mm³ (CNC)
 * @param filamentDiameter Filament diameter in mm (for 3DP)
 * @param totalTimeMinutes Total estimated time in minutes
 * @param params Cost estimation parameters
 */
export function estimateJobCostDetailed(
  filamentLength: number,
  filamentDiameter: number,
  totalTimeMinutes: number,
  params: CostEstimationParams,
): CostEstimate {
  const filamentArea = Math.PI * (filamentDiameter / 2) ** 2;
  const volumeMm3 = filamentLength * filamentArea;
  const volumeCm3 = volumeMm3 / 1000;
  const materialWeight = volumeCm3 * params.density; // grams
  const materialWeightKg = materialWeight / 1000;
  const materialCost = materialWeightKg * params.materialPricePerKg;

  const totalTimeHours = totalTimeMinutes / 60;
  const machineTimeCost = totalTimeHours * params.machineHourlyRate;

  const energyUsed = (params.averagePowerWatts * totalTimeHours) / 1000; // kWh
  const energyCost = energyUsed * params.energyPricePerKwh;

  const totalCost = materialCost + machineTimeCost + energyCost;
  const breakdown = {
    material: totalCost > 0 ? (materialCost / totalCost) * 100 : 0,
    machine: totalCost > 0 ? (machineTimeCost / totalCost) * 100 : 0,
    energy: totalCost > 0 ? (energyCost / totalCost) * 100 : 0,
  };

  return {
    materialCost, machineTimeCost, energyCost, totalCost,
    materialWeight, materialPricePerKg: params.materialPricePerKg,
    machineHourlyRate: params.machineHourlyRate, totalTimeHours,
    energyUsed, energyPricePerKwh: params.energyPricePerKwh,
    breakdown,
  };
}

// ── 2. Climb vs Conventional Milling Detection ──

export interface MillingDirectionSegment {
  /** G-code line number */
  lineNumber: number;
  /** Direction type */
  direction: 'climb' | 'conventional' | 'unknown';
  /** Move direction angle in degrees */
  moveAngle: number;
  /** Tool rotation direction (1=CW, -1=CCW) */
  toolRotation: number;
  /** Position */
  position: { x: number; y: number };
}

export interface MillingDirectionResult {
  /** Per-segment direction analysis */
  segments: MillingDirectionSegment[];
  /** Climb milling count */
  climbCount: number;
  /** Conventional milling count */
  conventionalCount: number;
  /** Unknown count */
  unknownCount: number;
  /** Climb milling percentage */
  climbPercentage: number;
  /** Whether mixed directions are used */
  isMixed: boolean;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Detect climb vs conventional milling direction.
 * Climb milling: feed direction same as tool rotation (better finish, less heat)
 * Conventional: feed direction opposite to tool rotation (safer for older machines)
 *
 * @param lines G-code lines
 * @param toolDiameter Tool diameter in mm
 */
export function detectMillingDirection(
  lines: string[],
  toolDiameter: number = 6,
): MillingDirectionResult {
  const segments: MillingDirectionSegment[] = [];
  let prevX = 0, prevY = 0;
  let toolRotation = 1; // 1=CW (M3), -1=CCW (M4)
  let climbCount = 0, conventionalCount = 0, unknownCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Track spindle direction
    if (/\bM03\b/i.test(code) || /\bM3\b/i.test(code)) toolRotation = 1;
    if (/\bM04\b/i.test(code) || /\bM4\b/i.test(code)) toolRotation = -1;

    if (!/\bG1\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;

    const dx = x - prevX;
    const dy = y - prevY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 0.1) {
      const moveAngle = Math.atan2(dy, dx) * (180 / Math.PI);

      // For a CW-rotating tool (M3):
      // Climb milling: the workpiece feed is in the same direction as the cutting edge
      // at the contact point. For exterior contours traversed CW, it's climb.
      // Simplified: if the tool is moving in a direction where the cutting edge
      // at the bottom is moving in the same direction as the feed → climb.
      //
      // For a right-hand end mill rotating CW (M3):
      // Cutting at the "right" side of the tool → climb if moving right
      // Cutting at the "left" side of the tool → conventional if moving right
      //
      // We use a simplified heuristic: check the cross product of
      // tool tangent and feed direction.
      //
      // For CW rotation (M3), the cutting edge at the right side of the tool
      // moves in the +Y direction when the tool is at origin.
      // If the feed is in +X, the cutting edge at the contact point (right side)
      // moves in +Y, which is perpendicular → we need the offset direction.

      // Simplified: assume the tool is on the left side of the cut for climb,
      // right side for conventional (for CW rotation).
      // We detect based on the curvature of the path:
      // CW path with CW tool = climb
      // CCW path with CW tool = conventional

      // For now, use a simpler heuristic based on move direction and tool rotation
      // This is a simplification — real analysis requires knowing the stock side
      let direction: 'climb' | 'conventional' | 'unknown';

      // If we can determine the path curvature, we use it
      // For linear moves, we use the angle relative to tool rotation
      if (toolRotation === 1) {
        // CW tool: climb if moving in "positive" rotational direction
        // This is a simplification
        const angleNorm = ((moveAngle % 360) + 360) % 360;
        if (angleNorm >= 0 && angleNorm < 180) {
          direction = 'climb';
          climbCount++;
        } else {
          direction = 'conventional';
          conventionalCount++;
        }
      } else if (toolRotation === -1) {
        // CCW tool: reversed
        const angleNorm = ((moveAngle % 360) + 360) % 360;
        if (angleNorm >= 180 && angleNorm < 360) {
          direction = 'climb';
          climbCount++;
        } else {
          direction = 'conventional';
          conventionalCount++;
        }
      } else {
        direction = 'unknown';
        unknownCount++;
      }

      segments.push({
        lineNumber: i, direction, moveAngle, toolRotation,
        position: { x, y },
      });
    }

    prevX = x; prevY = y;
  }

  const total = climbCount + conventionalCount + unknownCount;
  const climbPercentage = total > 0 ? (climbCount / total) * 100 : 0;
  const isMixed = climbCount > 0 && conventionalCount > 0;

  const recommendations: string[] = [];
  if (isMixed) {
    recommendations.push('Mixed climb and conventional milling detected — ensure consistent direction for uniform finish');
  }
  if (climbPercentage < 20 && conventionalCount > 10) {
    recommendations.push('Mostly conventional milling — consider switching to climb for better surface finish on rigid machines');
  }
  if (climbPercentage > 80 && climbCount > 10) {
    recommendations.push('Mostly climb milling — ensure machine rigidity to avoid chatter');
  }
  if (recommendations.length === 0) {
    recommendations.push('Milling direction appears consistent');
  }

  return {
    segments, climbCount, conventionalCount, unknownCount,
    climbPercentage, isMixed, recommendations,
  };
}

// ── 3. Acceleration-Limited Speed Estimation ──

export interface AccelerationLimitedResult {
  /** Estimated time with acceleration limits in seconds */
  limitedTime: number;
  /** Estimated time without acceleration limits in seconds */
  unlimitedTime: number;
  /** Time overhead from acceleration/deceleration in seconds */
  accelerationOverhead: number;
  /** Overhead percentage */
  overheadPercentage: number;
  /** Number of direction changes */
  directionChanges: number;
  /** Number of stops (full decelerations) */
  stops: number;
  /** Average acceleration-limited speed in mm/min */
  avgLimitedSpeed: number;
  /** Per-segment time data (sampled) */
  segments: { lineNumber: number; unlimitedTime: number; limitedTime: number; isAccelLimited: boolean }[];
}

/**
 * Estimate print/machining time accounting for acceleration and jerk limits.
 * Real machines cannot instantly reach target speeds — they must accelerate
 * and decelerate, adding time especially for short moves and direction changes.
 *
 * @param lines G-code lines
 * @param maxAcceleration Max acceleration in mm/s² (default 3000)
 * @param maxJerk Max jerk in mm/s³ (default 500)
 * @param sampleInterval Sample every N lines
 */
export function estimateAccelerationLimitedTime(
  lines: string[],
  maxAcceleration: number = 3000,
  maxJerk: number = 500,
  sampleInterval: number = 100,
): AccelerationLimitedResult {
  let prevX = 0, prevY = 0, prevZ = 0;
  let prevSpeed = 0; // mm/s
  let currentFeedRate = 0; // mm/min
  let unlimitedTime = 0;
  let limitedTime = 0;
  let directionChanges = 0;
  let stops = 0;
  let totalDistance = 0;
  const segments: AccelerationLimitedResult['segments'] = [];
  let prevDirX = 0, prevDirY = 0, prevDirZ = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG[01]\b/i.test(code)) continue;

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) currentFeedRate = parseFloat(fMatch[1]);

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const z = zMatch ? parseFloat(zMatch[1]) : prevZ;

    const dx = x - prevX, dy = y - prevY, dz = z - prevZ;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (dist > 0.001 && currentFeedRate > 0) {
      const targetSpeed = currentFeedRate / 60; // mm/s
      const unlimitedSegTime = dist / targetSpeed;
      unlimitedTime += unlimitedSegTime;

      // Check for direction change
      const dirLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const dirX = dx / dirLen, dirY = dy / dirLen, dirZ = dz / dirLen;
      const dotProduct = prevDirX * dirX + prevDirY * dirY + prevDirZ * dirZ;
      if (dotProduct < 0.5 && (prevDirX !== 0 || prevDirY !== 0 || prevDirZ !== 0)) {
        directionChanges++;
        // Direction change requires full deceleration + re-acceleration
        prevSpeed = 0;
      }

      // Compute acceleration-limited time
      // Time to accelerate from prevSpeed to targetSpeed
      const speedDelta = Math.abs(targetSpeed - prevSpeed);
      const accelTime = speedDelta / maxAcceleration;
      const accelDistance = prevSpeed * accelTime + 0.5 * maxAcceleration * accelTime * accelTime;

      let limitedSegTime: number;
      if (accelDistance >= dist) {
        // Never reaches target speed — entire move is acceleration/deceleration
        // For triangular profile: dist = 0.5 * a * t² → t = sqrt(2*dist/a)
        limitedSegTime = Math.sqrt(2 * dist / maxAcceleration);
        stops++;
      } else {
        // Trapezoidal profile: accel + cruise + decel
        const cruiseDistance = dist - accelDistance;
        const cruiseTime = cruiseDistance / targetSpeed;
        limitedSegTime = accelTime + cruiseTime + accelTime; // accel + cruise + decel
      }

      limitedTime += limitedSegTime;
      totalDistance += dist;
      prevSpeed = targetSpeed;

      if (i % sampleInterval === 0) {
        segments.push({
          lineNumber: i,
          unlimitedTime: unlimitedSegTime,
          limitedTime: limitedSegTime,
          isAccelLimited: limitedSegTime > unlimitedSegTime * 1.1,
        });
      }

      prevDirX = dirX; prevDirY = dirY; prevDirZ = dirZ;
    }

    prevX = x; prevY = y; prevZ = z;
  }

  const accelerationOverhead = limitedTime - unlimitedTime;
  const overheadPercentage = unlimitedTime > 0 ? (accelerationOverhead / unlimitedTime) * 100 : 0;
  const avgLimitedSpeed = limitedTime > 0 ? (totalDistance / limitedTime) * 60 : 0;

  return {
    limitedTime, unlimitedTime, accelerationOverhead,
    overheadPercentage, directionChanges, stops,
    avgLimitedSpeed, segments,
  };
}

// ── 4. Energy Consumption Estimation ──

export interface EnergySegment {
  /** Operation type */
  operation: 'idle' | 'heating' | 'printing' | 'travel' | 'spindle' | 'tool_change';
  /** Duration in seconds */
  duration: number;
  /** Power in Watts */
  power: number;
  /** Energy in Wh */
  energy: number;
}

export interface EnergyResult {
  /** Per-segment energy data */
  segments: EnergySegment[];
  /** Total energy in Wh */
  totalEnergy: number;
  /** Total energy in kWh */
  totalEnergyKwh: number;
  /** Average power in Watts */
  avgPower: number;
  /** Peak power in Watts */
  peakPower: number;
  /** Energy breakdown by operation */
  breakdown: { operation: string; energy: number; percentage: number }[];
  /** Estimated cost at given rate */
  estimatedCost: number;
}

/**
 * Estimate energy consumption for a G-code job.
 * Models power usage for different operations (heating, printing, travel, spindle).
 *
 * @param lines G-code lines
 * @param energyPricePerKwh Energy price per kWh (default 0.15)
 * @param machineType Machine type ('3dp' | 'cnc')
 */
export function estimateEnergyConsumption(
  lines: string[],
  energyPricePerKwh: number = 0.15,
  machineType: '3dp' | 'cnc' = '3dp',
): EnergyResult {
  const segments: EnergySegment[] = [];
  let prevX = 0, prevY = 0, prevZ = 0, prevE = 0;
  let currentFeedRate = 0;
  let spindleRpm = 0;
  let hotendTemp = 0;
  let bedTemp = 0;
  let peakPower = 0;

  // Power model constants (Watts)
  const IDLE_POWER = 50;
  const HEATER_POWER_PER_DEG = 2; // 2W per degree above ambient
  const MOTOR_POWER = 40;
  const EXTRUDER_POWER = 30;
  const SPINDLE_BASE_POWER = 100;
  const SPINDLE_POWER_PER_RPM = 0.01;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Track temperatures
    const m104Match = code.match(/M104\s+S(\d+)/i);
    if (m104Match) hotendTemp = parseInt(m104Match[1]);
    const m140Match = code.match(/M140\s+S(\d+)/i);
    if (m140Match) bedTemp = parseInt(m140Match[1]);

    // Track spindle
    const sMatch = code.match(/\bS(\d*\.?\d+)/i);
    if (sMatch && /\bM[034]\b/i.test(code)) spindleRpm = parseFloat(sMatch[1]);

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) currentFeedRate = parseFloat(fMatch[1]);

    if (!/\bG[01]\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const z = zMatch ? parseFloat(zMatch[1]) : prevZ;

    const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2 + (z - prevZ) ** 2);
    const isExtruding = eMatch ? parseFloat(eMatch[1]) > prevE : false;

    if (dist > 0 && currentFeedRate > 0) {
      const time = dist / (currentFeedRate / 60); // seconds

      let power = IDLE_POWER;
      let operation: EnergySegment['operation'];

      if (machineType === '3dp') {
        // Heating power
        power += hotendTemp * HEATER_POWER_PER_DEG;
        power += bedTemp * HEATER_POWER_PER_DEG * 0.5; // bed is less efficient
        // Motor power
        power += MOTOR_POWER;
        if (isExtruding) {
          power += EXTRUDER_POWER;
          operation = 'printing';
        } else {
          operation = 'travel';
        }
      } else {
        // CNC
        power += SPINDLE_BASE_POWER + spindleRpm * SPINDLE_POWER_PER_RPM;
        power += MOTOR_POWER;
        operation = isExtruding ? 'printing' : 'spindle';
      }

      const energy = (power * time) / 3600; // Wh
      segments.push({ operation, duration: time, power, energy });

      if (power > peakPower) peakPower = power;
    }

    if (eMatch) prevE = parseFloat(eMatch[1]);
    prevX = x; prevY = y; prevZ = z;
  }

  const totalEnergy = segments.reduce((sum, s) => sum + s.energy, 0);
  const totalEnergyKwh = totalEnergy / 1000;
  const totalDuration = segments.reduce((sum, s) => sum + s.duration, 0);
  const avgPower = totalDuration > 0 ? (totalEnergy * 3600) / totalDuration : 0;

  // Breakdown by operation
  const opMap = new Map<string, number>();
  for (const seg of segments) {
    opMap.set(seg.operation, (opMap.get(seg.operation) ?? 0) + seg.energy);
  }
  const breakdown = Array.from(opMap.entries())
    .map(([op, energy]) => ({
      operation: op,
      energy,
      percentage: totalEnergy > 0 ? (energy / totalEnergy) * 100 : 0,
    }))
    .sort((a, b) => b.energy - a.energy);

  const estimatedCost = totalEnergyKwh * energyPricePerKwh;

  return {
    segments, totalEnergy, totalEnergyKwh, avgPower, peakPower,
    breakdown, estimatedCost,
  };
}

// ── 5. Work Offset / Coordinate System Analysis ──

export interface WorkOffset {
  /** Offset name (G54, G55, etc.) */
  name: string;
  /** G-code line where activated */
  lineNumber: number;
  /** X offset */
  x: number;
  /** Y offset */
  y: number;
  /** Z offset */
  z: number;
  /** Whether this offset is active */
  isActive: boolean;
}

export interface WorkOffsetResult {
  /** All work offsets found */
  offsets: WorkOffset[];
  /** Currently active offset */
  activeOffset: string | null;
  /** Number of offset changes */
  offsetChanges: number;
  /** Whether multiple offsets are used */
  usesMultipleOffsets: boolean;
  /** Offset values set via G10 */
  g10Commands: { lineNumber: number; offset: string; x: number; y: number; z: number }[];
}

/**
 * Analyze work offset / coordinate system usage in G-code.
 * Tracks G54-G59 work coordinate systems and G10 parameter setting.
 *
 * @param lines G-code lines
 */
export function analyzeWorkOffsets(lines: string[]): WorkOffsetResult {
  const offsets: WorkOffset[] = [];
  const g10Commands: WorkOffsetResult['g10Commands'] = [];
  let activeOffset: string | null = null;
  let offsetChanges = 0;

  const offsetNames = ['G54', 'G55', 'G56', 'G57', 'G58', 'G59'];
  const offsetMap = new Map<string, WorkOffset>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Check for G54-G59
    for (const name of offsetNames) {
      if (new RegExp(`\\b${name}\\b`, 'i').test(code)) {
        if (activeOffset !== name) {
          activeOffset = name;
          offsetChanges++;
        }
        if (!offsetMap.has(name)) {
          offsetMap.set(name, {
            name, lineNumber: i, x: 0, y: 0, z: 0, isActive: true,
          });
        }
        break;
      }
    }

    // Check for G10 L2 (set work offset)
    if (/\bG10\b/i.test(code) && /\bL2\b/i.test(code)) {
      const pMatch = code.match(/\bP(\d+)/i);
      const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
      const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);

      if (pMatch) {
        const pNum = parseInt(pMatch[1]);
        const offsetName = pNum <= 6 ? offsetNames[pNum - 1] : `G59.${pNum - 6}`;
        const x = xMatch ? parseFloat(xMatch[1]) : 0;
        const y = yMatch ? parseFloat(yMatch[1]) : 0;
        const z = zMatch ? parseFloat(zMatch[1]) : 0;

        g10Commands.push({ lineNumber: i, offset: offsetName, x, y, z });

        offsetMap.set(offsetName, {
          name: offsetName, lineNumber: i, x, y, z, isActive: activeOffset === offsetName,
        });
      }
    }
  }

  // Mark active offset
  for (const offset of offsetMap.values()) {
    offset.isActive = offset.name === activeOffset;
  }

  const offsetsList = Array.from(offsetMap.values());
  const usesMultipleOffsets = offsetsList.length > 1;

  return {
    offsets: offsetsList,
    activeOffset,
    offsetChanges,
    usesMultipleOffsets,
    g10Commands,
  };
}

// ── 6. Material Parameter Recommendations ──

export interface MaterialParams {
  /** Material name */
  name: string;
  /** Recommended hotend temperature in °C */
  hotendTemp: { min: number; max: number };
  /** Recommended bed temperature in °C */
  bedTemp: { min: number; max: number };
  /** Recommended fan speed (0-255) */
  fanSpeed: { min: number; max: number };
  /** Recommended print speed in mm/s */
  printSpeed: { min: number; max: number };
  /** Recommended layer height in mm */
  layerHeight: { min: number; max: number };
  /** Recommended retraction distance in mm */
  retractionDistance: { min: number; max: number };
  /** Material density in g/cm³ */
  density: number;
  /** Bed adhesion type */
  bedAdhesion: 'none' | 'brim' | 'raft' | 'skirt';
  /** Whether cooling fan is needed */
  needsCooling: boolean;
  /** Whether enclosure is recommended */
  needsEnclosure: boolean;
  /** Known issues */
  knownIssues: string[];
  /** Tips */
  tips: string[];
}

/**
 * Get recommended printing parameters for common 3D printing materials.
 */
export function getMaterialRecommendations(): { [key: string]: MaterialParams } {
  return {
    PLA: {
      name: 'PLA',
      hotendTemp: { min: 190, max: 220 },
      bedTemp: { min: 50, max: 70 },
      fanSpeed: { min: 100, max: 255 },
      printSpeed: { min: 40, max: 100 },
      layerHeight: { min: 0.1, max: 0.3 },
      retractionDistance: { min: 1, max: 3 },
      density: 1.24,
      bedAdhesion: 'skirt',
      needsCooling: true,
      needsEnclosure: false,
      knownIssues: ['Brittle', 'Low heat resistance', 'Not suitable for outdoor use'],
      tips: ['Easy to print', 'Good for beginners', 'Biodegradable'],
    },
    ABS: {
      name: 'ABS',
      hotendTemp: { min: 230, max: 260 },
      bedTemp: { min: 90, max: 110 },
      fanSpeed: { min: 0, max: 100 },
      printSpeed: { min: 30, max: 60 },
      layerHeight: { min: 0.15, max: 0.3 },
      retractionDistance: { min: 2, max: 5 },
      density: 1.04,
      bedAdhesion: 'brim',
      needsCooling: false,
      needsEnclosure: true,
      knownIssues: ['Warping', 'Fumes', 'Requires enclosure'],
      tips: ['Strong and durable', 'Can be smoothed with acetone', 'Heat resistant'],
    },
    PETG: {
      name: 'PETG',
      hotendTemp: { min: 220, max: 250 },
      bedTemp: { min: 70, max: 90 },
      fanSpeed: { min: 50, max: 150 },
      printSpeed: { min: 30, max: 80 },
      layerHeight: { min: 0.12, max: 0.3 },
      retractionDistance: { min: 2, max: 6 },
      density: 1.27,
      bedAdhesion: 'brim',
      needsCooling: true,
      needsEnclosure: false,
      knownIssues: ['Stringing', 'Poor bridging', 'Sticks to nozzle'],
      tips: ['Good layer adhesion', 'Chemical resistant', 'Food safe variants available'],
    },
    TPU: {
      name: 'TPU',
      hotendTemp: { min: 210, max: 240 },
      bedTemp: { min: 30, max: 60 },
      fanSpeed: { min: 0, max: 100 },
      printSpeed: { min: 15, max: 40 },
      layerHeight: { min: 0.15, max: 0.3 },
      retractionDistance: { min: 0, max: 2 },
      density: 1.21,
      bedAdhesion: 'brim',
      needsCooling: false,
      needsEnclosure: false,
      knownIssues: ['Stringing', 'Requires slow print speed', 'Difficult to retract'],
      tips: ['Flexible', 'Impact resistant', 'Good for gaskets and seals'],
    },
    NYLON: {
      name: 'Nylon',
      hotendTemp: { min: 240, max: 280 },
      bedTemp: { min: 70, max: 100 },
      fanSpeed: { min: 0, max: 80 },
      printSpeed: { min: 30, max: 60 },
      layerHeight: { min: 0.15, max: 0.3 },
      retractionDistance: { min: 2, max: 5 },
      density: 1.14,
      bedAdhesion: 'raft',
      needsCooling: false,
      needsEnclosure: true,
      knownIssues: ['Moisture absorption', 'Warping', 'Requires dry storage'],
      tips: ['Extremely strong', 'Wear resistant', 'Good for gears and mechanical parts'],
    },
    PC: {
      name: 'Polycarbonate',
      hotendTemp: { min: 260, max: 310 },
      bedTemp: { min: 90, max: 120 },
      fanSpeed: { min: 0, max: 80 },
      printSpeed: { min: 20, max: 50 },
      layerHeight: { min: 0.15, max: 0.3 },
      retractionDistance: { min: 2, max: 5 },
      density: 1.20,
      bedAdhesion: 'raft',
      needsCooling: false,
      needsEnclosure: true,
      knownIssues: ['Very high temperatures needed', 'Warping', 'Requires enclosure'],
      tips: ['Extremely strong', 'Heat resistant', 'Impact resistant'],
    },
  };
}

/**
 * Compare actual G-code parameters against material recommendations.
 *
 * @param lines G-code lines
 * @param material Material name (e.g., 'PLA', 'ABS')
 */
export function compareMaterialParameters(
  lines: string[],
  material: string,
): {
  material: MaterialParams | null;
  actual: { hotendTemp: number; bedTemp: number; fanSpeed: number; printSpeed: number };
  issues: { parameter: string; actual: number; recommended: string; severity: 'warning' | 'error' }[];
  recommendations: string[];
} {
  const materials = getMaterialRecommendations();
  const mat = materials[material.toUpperCase()] ?? null;

  // Extract actual values from G-code
  let hotendTemp = 0, bedTemp = 0, fanSpeed = 0, printSpeed = 0;
  for (const line of lines) {
    const m104Match = line.match(/M104\s+S(\d+)/i);
    if (m104Match) hotendTemp = parseInt(m104Match[1]);
    const m140Match = line.match(/M140\s+S(\d+)/i);
    if (m140Match) bedTemp = parseInt(m140Match[1]);
    const m106Match = line.match(/M106\s+S(\d+)/i);
    if (m106Match) fanSpeed = parseInt(m106Match[1]);
    const fMatch = line.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) printSpeed = parseFloat(fMatch[1]);
  }

  const issues: { parameter: string; actual: number; recommended: string; severity: 'warning' | 'error' }[] = [];
  const recommendations: string[] = [];

  if (mat) {
    if (hotendTemp > 0 && (hotendTemp < mat.hotendTemp.min || hotendTemp > mat.hotendTemp.max)) {
      issues.push({
        parameter: 'Hotend Temperature',
        actual: hotendTemp,
        recommended: `${mat.hotendTemp.min}-${mat.hotendTemp.max}°C`,
        severity: hotendTemp < mat.hotendTemp.min - 20 ? 'error' : 'warning',
      });
    }
    if (bedTemp > 0 && (bedTemp < mat.bedTemp.min || bedTemp > mat.bedTemp.max)) {
      issues.push({
        parameter: 'Bed Temperature',
        actual: bedTemp,
        recommended: `${mat.bedTemp.min}-${mat.bedTemp.max}°C`,
        severity: 'warning',
      });
    }
    if (fanSpeed > 0 && mat.needsCooling && fanSpeed < mat.fanSpeed.min) {
      issues.push({
        parameter: 'Fan Speed',
        actual: fanSpeed,
        recommended: `${mat.fanSpeed.min}-${mat.fanSpeed.max}`,
        severity: 'warning',
      });
    }
    if (mat.needsEnclosure) {
      recommendations.push(`${material} requires an enclosure for best results`);
    }
    for (const issue of mat.knownIssues) {
      recommendations.push(`${material} note: ${issue}`);
    }
  } else {
    recommendations.push(`Unknown material: ${material}`);
  }

  return {
    material: mat,
    actual: { hotendTemp, bedTemp, fanSpeed, printSpeed },
    issues,
    recommendations,
  };
}

// ── 7. G-code Pattern Recognition ──

export interface PatternMatch {
  /** Pattern type */
  type: 'spiral' | 'zigzag' | 'contour' | 'raster' | 'circle' | 'line';
  /** Start line number */
  startLine: number;
  /** End line number */
  endLine: number;
  /** Number of moves in pattern */
  moveCount: number;
  /** Confidence (0-1) */
  confidence: number;
  /** Description */
  description: string;
}

export interface PatternRecognitionResult {
  /** Detected patterns */
  patterns: PatternMatch[];
  /** Pattern counts by type */
  counts: { [type: string]: number };
  /** Most common pattern */
  dominantPattern: string | null;
}

/**
 * Recognize common toolpath patterns in G-code.
 * Detects spirals, zigzags, contours, rasters, circles, and linear patterns.
 *
 * @param lines G-code lines
 * @param windowSize Number of moves to analyze per window (default 20)
 */
export function recognizePatterns(
  lines: string[],
  windowSize: number = 20,
): PatternRecognitionResult {
  const patterns: PatternMatch[] = [];
  const points: { x: number; y: number; line: number }[] = [];
  let prevX = 0, prevY = 0;

  // Collect G1 XY points
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG1\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);

    if (xMatch && yMatch) {
      const x = parseFloat(xMatch[1]);
      const y = parseFloat(yMatch[1]);
      points.push({ x, y, line: i });
      prevX = x; prevY = y;
    } else if (xMatch) {
      prevX = parseFloat(xMatch[1]);
      points.push({ x: prevX, y: prevY, line: i });
    } else if (yMatch) {
      prevY = parseFloat(yMatch[1]);
      points.push({ x: prevX, y: prevY, line: i });
    }
  }

  // Analyze windows
  let i = 0;
  while (i < points.length - windowSize) {
    const window = points.slice(i, i + windowSize);
    const pattern = classifyPattern(window);
    if (pattern && pattern.confidence > 0.6) {
      patterns.push(pattern);
      i += windowSize;
    } else {
      i++;
    }
  }

  // Count patterns by type
  const counts: { [type: string]: number } = {};
  for (const p of patterns) {
    counts[p.type] = (counts[p.type] ?? 0) + 1;
  }

  // Find dominant pattern
  let dominantPattern: string | null = null;
  let maxCount = 0;
  for (const [type, count] of Object.entries(counts)) {
    if (count > maxCount) {
      maxCount = count;
      dominantPattern = type;
    }
  }

  return { patterns, counts, dominantPattern };
}

function fitCircleForPattern(p1: { x: number; y: number }, p2: { x: number; y: number }, p3: { x: number; y: number }):
  { centerX: number; centerY: number; radius: number } | null {
  const ax = p1.x, ay = p1.y;
  const bx = p2.x, by = p2.y;
  const cx = p3.x, cy = p3.y;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-10) return null;
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
  const radius = Math.sqrt((ax - ux) ** 2 + (ay - uy) ** 2);
  return { centerX: ux, centerY: uy, radius };
}

function classifyPattern(points: { x: number; y: number; line: number }[]): PatternMatch | null {
  if (points.length < 5) return null;

  // Compute distances and angles
  const distances: number[] = [];
  const angles: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    distances.push(Math.sqrt(dx * dx + dy * dy));
    angles.push(Math.atan2(dy, dx));
  }

  // Check for spiral: continuously changing angle and consistent distance from center
  const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;
  const radii = points.map(p => Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2));
  const radiusVariance = radii.reduce((sum, r) => sum + (r - radii[0]) ** 2, 0) / radii.length;
  const angleChanges = angles.slice(1).map((a, i) => {
    let diff = a - angles[i];
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    return diff;
  });
  const consistentAngleChange = angleChanges.every(c => Math.abs(c - angleChanges[0]) < 0.3);

  if (consistentAngleChange && Math.abs(angleChanges[0]) > 0.1 && radiusVariance < radii[0] * radii[0] * 0.1) {
    return {
      type: 'spiral', startLine: points[0].line, endLine: points[points.length - 1].line,
      moveCount: points.length, confidence: 0.8,
      description: 'Spiral toolpath detected',
    };
  }

  // Check for zigzag: alternating direction changes
  let zigzagCount = 0;
  for (let i = 1; i < angles.length; i++) {
    const diff = Math.abs(angles[i] - angles[i - 1]);
    if (diff > Math.PI * 0.8 && diff < Math.PI * 1.2) zigzagCount++;
  }
  if (zigzagCount > points.length * 0.3) {
    return {
      type: 'zigzag', startLine: points[0].line, endLine: points[points.length - 1].line,
      moveCount: points.length, confidence: 0.7,
      description: 'Zigzag raster pattern detected',
    };
  }

  // Check for circle: try fitting a circle through 3 points and verify all points match
  {
    const p1 = points[0];
    const p2 = points[Math.floor(points.length / 2)];
    const p3 = points[points.length - 1];
    const fit = fitCircleForPattern(p1, p2, p3);
    if (fit && fit.radius > 1) {
      // Check all points against fitted circle
      let maxErr = 0;
      for (const p of points) {
        const dist = Math.sqrt((p.x - fit.centerX) ** 2 + (p.y - fit.centerY) ** 2);
        const err = Math.abs(dist - fit.radius);
        if (err > maxErr) maxErr = err;
      }
      if (maxErr < fit.radius * 0.05) {
        return {
          type: 'circle', startLine: points[0].line, endLine: points[points.length - 1].line,
          moveCount: points.length, confidence: 0.85,
          description: 'Circular contour detected',
        };
      }
    }
  }

  // Check for contour: smooth angle changes
  const totalAngleChange = angleChanges.reduce((sum, c) => sum + Math.abs(c), 0);
  if (totalAngleChange > Math.PI * 0.5 && totalAngleChange < Math.PI * 4) {
    return {
      type: 'contour', startLine: points[0].line, endLine: points[points.length - 1].line,
      moveCount: points.length, confidence: 0.6,
      description: 'Contour toolpath detected',
    };
  }

  // Check for raster: mostly parallel lines with periodic jumps
  if (zigzagCount > 0 && zigzagCount < points.length * 0.2) {
    return {
      type: 'raster', startLine: points[0].line, endLine: points[points.length - 1].line,
      moveCount: points.length, confidence: 0.65,
      description: 'Raster infill pattern detected',
    };
  }

  // Default: line
  if (distances.every(d => d > 0)) {
    const avgDist = distances.reduce((a, b) => a + b, 0) / distances.length;
    const distVariance = distances.reduce((sum, d) => sum + (d - avgDist) ** 2, 0) / distances.length;
    if (distVariance < avgDist * avgDist * 0.1) {
      return {
        type: 'line', startLine: points[0].line, endLine: points[points.length - 1].line,
        moveCount: points.length, confidence: 0.7,
        description: 'Linear toolpath detected',
      };
    }
  }

  return null;
}

// ── 8. Print Difficulty Rating ──

export interface DifficultyFactor {
  /** Factor name */
  name: string;
  /** Score for this factor (0-1, higher = harder) */
  score: number;
  /** Weight of this factor */
  weight: number;
  /** Description */
  description: string;
}

export interface DifficultyResult {
  /** Overall difficulty (0-1) */
  overallDifficulty: number;
  /** Difficulty rating */
  rating: 'easy' | 'medium' | 'hard' | 'very_hard' | 'expert';
  /** Individual factors */
  factors: DifficultyFactor[];
  /** Recommendations */
  recommendations: string[];
}

/**
 * Rate the overall difficulty of printing/machining a G-code file.
 * Considers overhangs, bridges, thin features, support requirements,
 * temperature requirements, and other factors.
 *
 * @param bounds Part bounds
 * @param zLayerCount Number of Z layers
 * @param overhangCount Number of overhang sections
 * @param bridgeCount Number of bridge sections
 * @param supportRequired Whether support material is required
 * @param maxOverhangAngle Maximum overhang angle in degrees
 * @param minFeatureSize Minimum feature size in mm
 * @param hotendTemp Hotend temperature in °C
 * @param needsEnclosure Whether enclosure is needed
 */
export function ratePrintDifficulty(
  bounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number },
  zLayerCount: number,
  overhangCount: number,
  bridgeCount: number,
  supportRequired: boolean,
  maxOverhangAngle: number,
  minFeatureSize: number,
  hotendTemp: number,
  needsEnclosure: boolean,
): DifficultyResult {
  const factors: DifficultyFactor[] = [];

  // Overhang difficulty
  const overhangScore = Math.min(1, (maxOverhangAngle - 30) / 60);
  factors.push({
    name: 'Overhangs', score: overhangScore, weight: 0.2,
    description: `${overhangCount} overhang sections, max angle ${maxOverhangAngle.toFixed(0)}°`,
  });

  // Bridge difficulty
  const bridgeScore = Math.min(1, bridgeCount / 20);
  factors.push({
    name: 'Bridges', score: bridgeScore, weight: 0.15,
    description: `${bridgeCount} bridge sections`,
  });

  // Support requirement
  factors.push({
    name: 'Support Material', score: supportRequired ? 0.7 : 0, weight: 0.15,
    description: supportRequired ? 'Support material required' : 'No support needed',
  });

  // Part size (larger = harder due to warping)
  const partSize = Math.max(
    bounds.maxX - bounds.minX,
    bounds.maxY - bounds.minY,
  );
  const sizeScore = Math.min(1, partSize / 200);
  factors.push({
    name: 'Part Size', score: sizeScore, weight: 0.1,
    description: `Part size: ${partSize.toFixed(0)}mm`,
  });

  // Layer count (more layers = longer = more chances for failure)
  const layerScore = Math.min(1, zLayerCount / 500);
  factors.push({
    name: 'Print Duration', score: layerScore, weight: 0.1,
    description: `${zLayerCount} layers`,
  });

  // Feature size (smaller = harder)
  const featureScore = Math.min(1, Math.max(0, (1.0 - minFeatureSize) / 1.0));
  factors.push({
    name: 'Feature Detail', score: featureScore, weight: 0.1,
    description: `Min feature: ${minFeatureSize.toFixed(2)}mm`,
  });

  // Temperature requirements (higher = harder)
  const tempScore = Math.min(1, Math.max(0, (hotendTemp - 200) / 120));
  factors.push({
    name: 'Temperature', score: tempScore, weight: 0.1,
    description: `Hotend: ${hotendTemp}°C`,
  });

  // Enclosure requirement
  factors.push({
    name: 'Enclosure', score: needsEnclosure ? 0.6 : 0, weight: 0.1,
    description: needsEnclosure ? 'Enclosure required' : 'No enclosure needed',
  });

  // Compute weighted overall difficulty
  const overallDifficulty = factors.reduce((sum, f) => sum + f.score * f.weight, 0);

  let rating: DifficultyResult['rating'];
  if (overallDifficulty < 0.2) rating = 'easy';
  else if (overallDifficulty < 0.4) rating = 'medium';
  else if (overallDifficulty < 0.6) rating = 'hard';
  else if (overallDifficulty < 0.8) rating = 'very_hard';
  else rating = 'expert';

  const recommendations: string[] = [];
  if (overhangScore > 0.5) recommendations.push('Significant overhangs — use support material');
  if (bridgeScore > 0.3) recommendations.push('Many bridges — ensure proper cooling');
  if (sizeScore > 0.5) recommendations.push('Large part — use brim/raft to prevent warping');
  if (tempScore > 0.5) recommendations.push('High temperature material — ensure proper ventilation');
  if (needsEnclosure) recommendations.push('Enclosure required for this material');
  if (featureScore > 0.5) recommendations.push('Fine details — use smaller nozzle and layer height');
  if (recommendations.length === 0) recommendations.push('This part should be straightforward to print');

  return { overallDifficulty, rating, factors, recommendations };
}

// ── 9. Tool Deflection Estimation ──

export interface ToolDeflectionResult {
  /** G-code line number */
  lineNumber: number;
  /** Deflection in mm */
  deflection: number;
  /** Cutting force in N */
  cuttingForce: number;
  /** Radial depth of cut in mm */
  radialDOC: number;
  /** Axial depth of cut in mm */
  axialDOC: number;
  /** Tool stickout length in mm */
  stickout: number;
  /** Severity */
  severity: 'low' | 'medium' | 'high';
}

export interface ToolDeflectionAnalysis {
  /** Per-segment deflection data */
  segments: ToolDeflectionResult[];
  /** Maximum deflection in mm */
  maxDeflection: number;
  /** Average deflection in mm */
  avgDeflection: number;
  /** Segments with high deflection */
  highDeflectionCount: number;
  /** Whether deflection is within acceptable limits */
  isAcceptable: boolean;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Estimate tool deflection during CNC milling operations.
 * Tool deflection causes dimensional errors and poor surface finish.
 *
 * Uses simplified beam deflection model:
 * δ = F * L³ / (3 * E * I)
 * where F = cutting force, L = stickout, E = Young's modulus, I = moment of inertia
 *
 * @param lines G-code lines
 * @param toolDiameter Tool diameter in mm
 * @param stickout Tool stickout from collet in mm
 * @param feedPerTooth Feed per tooth in mm
 * @param axialDOC Axial depth of cut in mm
 * @param radialDOC Radial depth of cut in mm
 */
export function estimateToolDeflection(
  lines: string[],
  toolDiameter: number = 6,
  stickout: number = 30,
  feedPerTooth: number = 0.05,
  axialDOC: number = 2,
  radialDOC: number = 3,
): ToolDeflectionAnalysis {
  const segments: ToolDeflectionResult[] = [];
  let prevX = 0, prevY = 0, prevZ = 0;
  let currentFeedRate = 0;

  // Tool properties (HSS end mill)
  const E = 200000; // Young's modulus in N/mm² (HSS)
  const toolRadius = toolDiameter / 2;
  const I = Math.PI * toolRadius ** 4 / 4; // Moment of inertia for circular cross-section

  // Material specific cutting force (N/mm²) — steel ~2000, aluminum ~600
  const specificCuttingForce = 800; // aluminum

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG1\b/i.test(code)) continue;

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) currentFeedRate = parseFloat(fMatch[1]);

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const z = zMatch ? parseFloat(zMatch[1]) : prevZ;

    const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);

    if (dist > 0.1 && z < 0 && currentFeedRate > 0) {
      // Estimate cutting force
      const chipThickness = feedPerTooth;
      const cuttingArea = axialDOC * chipThickness;
      const cuttingForce = specificCuttingForce * cuttingArea;

      // Beam deflection: δ = F * L³ / (3 * E * I)
      const deflection = (cuttingForce * stickout ** 3) / (3 * E * I);

      let severity: 'low' | 'medium' | 'high';
      if (deflection > 0.05) severity = 'high';
      else if (deflection > 0.01) severity = 'medium';
      else severity = 'low';

      segments.push({
        lineNumber: i, deflection, cuttingForce,
        radialDOC, axialDOC, stickout, severity,
      });
    }

    prevX = x; prevY = y; prevZ = z;
  }

  const deflections = segments.map(s => s.deflection);
  const maxDeflection = deflections.length > 0 ? Math.max(...deflections) : 0;
  const avgDeflection = deflections.length > 0
    ? deflections.reduce((a, b) => a + b, 0) / deflections.length
    : 0;
  const highDeflectionCount = segments.filter(s => s.severity === 'high').length;
  const isAcceptable = maxDeflection < 0.05;

  const recommendations: string[] = [];
  if (maxDeflection > 0.1) {
    recommendations.push(`Maximum deflection (${maxDeflection.toFixed(3)}mm) is very high — reduce stickout or DOC`);
  }
  if (maxDeflection > 0.05) {
    recommendations.push('High tool deflection — consider reducing axial DOC or using larger tool');
  }
  if (stickout > toolDiameter * 5) {
    recommendations.push(`Tool stickout (${stickout}mm) is >5x tool diameter — reduce for less deflection`);
  }
  if (recommendations.length === 0) {
    recommendations.push('Tool deflection is within acceptable limits');
  }

  return {
    segments, maxDeflection, avgDeflection,
    highDeflectionCount, isAcceptable, recommendations,
  };
}

// ── 10. G-code Compression/Optimization ──

export interface CompressionResult {
  /** Original line count */
  originalLines: number;
  /** Compressed line count */
  compressedLines: number;
  /** Original size in bytes */
  originalSize: number;
  /** Compressed size in bytes */
  compressedSize: number;
  /** Compression ratio */
  compressionRatio: number;
  /** Space savings percentage */
  savingsPercentage: number;
  /** Compressed G-code lines */
  compressedLines_: string[];
  /** Optimization actions taken */
  actions: { type: string; count: number }[];
}

/**
 * Compress and optimize G-code by removing redundant commands.
 * - Removes consecutive duplicate feed rate commands
 * - Removes redundant modal G-codes
 * - Strips unnecessary whitespace
 * - Combines rapid moves
 * - Removes empty lines and comment-only lines (optional)
 *
 * @param lines G-code lines
 * @param stripComments Whether to strip comments (default false)
 */
export function compressGcode(
  lines: string[],
  stripComments: boolean = false,
): CompressionResult {
  const result: string[] = [];
  const actions: { type: string; count: number }[] = [];
  let removedEmpty = 0, removedDupFeed = 0, removedDupModal = 0, strippedComments = 0;
  let lastFeedRate = '';
  let lastMotionMode = '';

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Strip comments if configured
    if (stripComments) {
      const before = line;
      line = line.replace(/;.*$/, '').replace(/\([^)]*\)/g, '').trim();
      if (before !== line) strippedComments++;
    }

    // Skip empty lines
    if (!line.trim()) {
      removedEmpty++;
      continue;
    }

    // Skip comment-only lines (if not stripping)
    if (!stripComments && (line.trim().startsWith(';') || line.trim().startsWith('('))) {
      result.push(line);
      continue;
    }

    const code = line.replace(/;.*$/, '').replace(/\([^)]*\)/g, '').trim();
    if (!code) {
      if (!stripComments) result.push(line);
      continue;
    }

    // Check for duplicate feed rate
    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) {
      const feedStr = fMatch[1];
      if (feedStr === lastFeedRate) {
        // Remove duplicate feed rate from the line
        line = line.replace(/\bF\d*\.?\d+/i, '').trim();
        removedDupFeed++;
        if (!line.replace(/;.*$/, '').trim()) continue;
      } else {
        lastFeedRate = feedStr;
      }
    }

    // Check for duplicate modal G-codes (G0/G1)
    const motionMatch = code.match(/\bG([01])\b/i);
    if (motionMatch) {
      const motionMode = `G${motionMatch[1]}`;
      if (motionMode === lastMotionMode) {
        // Remove redundant modal G-code
        line = line.replace(/\bG[01]\b/i, '').trim();
        removedDupModal++;
        if (!line.replace(/;.*$/, '').trim()) continue;
      } else {
        lastMotionMode = motionMode;
      }
    }

    // Normalize whitespace
    line = line.replace(/\s+/g, ' ').trim();

    if (line) result.push(line);
  }

  actions.push({ type: 'Removed empty lines', count: removedEmpty });
  actions.push({ type: 'Removed duplicate feed rates', count: removedDupFeed });
  actions.push({ type: 'Removed duplicate modal G-codes', count: removedDupModal });
  if (stripComments) actions.push({ type: 'Stripped comments', count: strippedComments });

  const originalSize = lines.join('\n').length;
  const compressedSize = result.join('\n').length;
  const compressionRatio = compressedSize > 0 ? originalSize / compressedSize : 1;
  const savingsPercentage = originalSize > 0 ? ((originalSize - compressedSize) / originalSize) * 100 : 0;

  return {
    originalLines: lines.length,
    compressedLines: result.length,
    originalSize, compressedSize,
    compressionRatio, savingsPercentage,
    compressedLines_: result, actions,
  };
}

// ── 11. Thermal Expansion Compensation ──

export interface ThermalExpansionResult {
  /** Original position */
  original: { x: number; y: number; z: number };
  /** Compensated position */
  compensated: { x: number; y: number; z: number };
  /** Expansion in X (mm) */
  expansionX: number;
  /** Expansion in Y (mm) */
  expansionY: number;
  /** Expansion in Z (mm) */
  expansionZ: number;
  /** Temperature difference (°C) */
  deltaT: number;
}

export interface ThermalExpansionAnalysis {
  /** Per-line compensation data (sampled) */
  compensations: ThermalExpansionResult[];
  /** Maximum expansion in mm */
  maxExpansion: number;
  /** Average expansion in mm */
  avgExpansion: number;
  /** Whether compensation is significant */
  isSignificant: boolean;
  /** Compensated G-code lines */
  compensatedLines: string[];
  /** Recommendations */
  recommendations: string[];
}

/**
 * Calculate thermal expansion compensation for CNC operations.
 * As the machine/spindle heats up, the tool and workpiece expand,
 * causing dimensional errors.
 *
 * Uses linear expansion formula: ΔL = α * L * ΔT
 * where α is the coefficient of thermal expansion (CTE)
 *
 * @param lines G-code lines
 * @param ambientTemp Ambient temperature in °C (default 20)
 * @param operatingTemp Operating temperature in °C (default 30)
 * @param materialCTE Coefficient of thermal expansion in µm/m·°C (default 23 for aluminum)
 * @param partLength Part length in X (mm)
 * @param partWidth Part width in Y (mm)
 * @param partHeight Part height in Z (mm)
 */
export function compensateThermalExpansion(
  lines: string[],
  ambientTemp: number = 20,
  operatingTemp: number = 30,
  materialCTE: number = 23, // aluminum: 23 µm/m·°C, steel: 12, invar: 1.2
  partLength: number = 100,
  partWidth: number = 100,
  partHeight: number = 50,
): ThermalExpansionAnalysis {
  const deltaT = operatingTemp - ambientTemp;
  const cte = materialCTE * 1e-6; // convert µm/m·°C to mm/mm·°C

  // Expansion per axis
  const expansionX = partLength * cte * deltaT;
  const expansionY = partWidth * cte * deltaT;
  const expansionZ = partHeight * cte * deltaT;

  const compensations: ThermalExpansionResult[] = [];
  const compensatedLines: string[] = [];
  let prevX = 0, prevY = 0, prevZ = 0;
  let maxExpansion = 0;
  let expansionCount = 0;
  let totalExpansion = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) {
      compensatedLines.push(line);
      continue;
    }

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG[01]\b/i.test(code)) {
      compensatedLines.push(line);
      continue;
    }

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);

    let newLine = line;
    let x = prevX, y = prevY, z = prevZ;

    if (xMatch) {
      x = parseFloat(xMatch[1]);
      // Compensate: subtract expansion from position
      const compensatedX = x - expansionX * (x / partLength);
      newLine = newLine.replace(/\bX-?\d*\.?\d+/i, `X${compensatedX.toFixed(4)}`);

      const expansion = Math.abs(expansionX * (x / partLength));
      if (expansion > maxExpansion) maxExpansion = expansion;
      totalExpansion += expansion;
      expansionCount++;
    }

    if (yMatch) {
      y = parseFloat(yMatch[1]);
      const compensatedY = y - expansionY * (y / partWidth);
      newLine = newLine.replace(/\bY-?\d*\.?\d+/i, `Y${compensatedY.toFixed(4)}`);
    }

    if (zMatch) {
      z = parseFloat(zMatch[1]);
      const compensatedZ = z - expansionZ * (z / partHeight);
      newLine = newLine.replace(/\bZ-?\d*\.?\d+/i, `Z${compensatedZ.toFixed(4)}`);
    }

    if (i % 100 === 0 && (xMatch || yMatch || zMatch)) {
      compensations.push({
        original: { x: prevX, y: prevY, z: prevZ },
        compensated: { x, y, z },
        expansionX: xMatch ? expansionX * (x / partLength) : 0,
        expansionY: yMatch ? expansionY * (y / partWidth) : 0,
        expansionZ: zMatch ? expansionZ * (z / partHeight) : 0,
        deltaT,
      });
    }

    compensatedLines.push(newLine);
    prevX = x; prevY = y; prevZ = z;
  }

  const avgExpansion = expansionCount > 0 ? totalExpansion / expansionCount : 0;
  const isSignificant = maxExpansion > 0.01; // 10µm threshold

  const recommendations: string[] = [];
  if (isSignificant) {
    recommendations.push(`Thermal expansion up to ${maxExpansion.toFixed(4)}mm — compensation recommended for precision parts`);
  }
  if (deltaT > 10) {
    recommendations.push(`Large temperature differential (${deltaT}°C) — allow machine to warm up before cutting`);
  }
  if (materialCTE > 20) {
    recommendations.push('High CTE material — consider using steel or invar for better dimensional stability');
  }
  if (recommendations.length === 0) {
    recommendations.push('Thermal expansion is negligible for this application');
  }

  return {
    compensations, maxExpansion, avgExpansion,
    isSignificant, compensatedLines, recommendations,
  };
}

// ── 12. Subprogram Expansion ──

export interface SubprogramCall {
  /** G-code line number */
  lineNumber: number;
  /** Subprogram number */
  programNumber: number;
  /** Call type */
  callType: 'M98' | 'G65' | 'M99';
  /** Number of repetitions */
  repetitions: number;
  /** Arguments passed */
  arguments: { name: string; value: number }[];
}

export interface SubprogramExpansionResult {
  /** Subprogram calls found */
  calls: SubprogramCall[];
  /** Subprogram definitions found */
  definitions: { programNumber: number; startLine: number; endLine: number; lineCount: number }[];
  /** Expanded G-code lines */
  expandedLines: string[];
  /** Original line count */
  originalLineCount: number;
  /** Expanded line count */
  expandedLineCount: number;
  /** Whether subprograms were found */
  hasSubprograms: boolean;
  /** Expansion ratio */
  expansionRatio: number;
}

/**
 * Find and expand subprogram calls in G-code.
 * Supports M98 (subprogram call), M99 (return), and G65 (macro call).
 *
 * @param lines G-code lines
 */
export function expandSubprograms(lines: string[]): SubprogramExpansionResult {
  const calls: SubprogramCall[] = [];
  const definitions: SubprogramExpansionResult['definitions'] = [];

  // Find subprogram definitions (O-codes)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const oMatch = line.match(/^O(\d+)/i);
    if (oMatch) {
      const programNumber = parseInt(oMatch[1]);
      // Find the end (M99 or next O-code)
      let endLine = i;
      for (let j = i + 1; j < lines.length; j++) {
        const innerLine = lines[j].trim();
        if (/\bM99\b/i.test(innerLine) || /^O\d+/i.test(innerLine)) {
          endLine = j;
          break;
        }
      }
      definitions.push({
        programNumber, startLine: i, endLine,
        lineCount: endLine - i + 1,
      });
    }
  }

  // Find subprogram calls
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();

    // M98 P#### L## (call subprogram)
    const m98Match = code.match(/M98\s+P(\d+)(?:\s+L(\d+))?/i);
    if (m98Match) {
      const programNumber = parseInt(m98Match[1]);
      const repetitions = m98Match[2] ? parseInt(m98Match[2]) : 1;
      const args: { name: string; value: number }[] = [];
      // Parse additional arguments
      const argMatches = code.matchAll(/\b([A-Z])(\d+\.?\d*)/gi);
      for (const m of argMatches) {
        const letter = m[1].toUpperCase();
        if (letter !== 'M' && letter !== 'P' && letter !== 'L') {
          args.push({ name: letter, value: parseFloat(m[2]) });
        }
      }
      calls.push({ lineNumber: i, programNumber, callType: 'M98', repetitions, arguments: args });
    }

    // G65 P#### (macro call)
    const g65Match = code.match(/G65\s+P(\d+)(?:\s+L(\d+))?/i);
    if (g65Match) {
      const programNumber = parseInt(g65Match[1]);
      const repetitions = g65Match[2] ? parseInt(g65Match[2]) : 1;
      const args: { name: string; value: number }[] = [];
      const argMatches = code.matchAll(/\b([A-Z])(\d+\.?\d*)/gi);
      for (const m of argMatches) {
        const letter = m[1].toUpperCase();
        if (letter !== 'G' && letter !== 'P' && letter !== 'L') {
          args.push({ name: letter, value: parseFloat(m[2]) });
        }
      }
      calls.push({ lineNumber: i, programNumber, callType: 'G65', repetitions, arguments: args });
    }
  }

  // Expand subprogram calls
  const expandedLines: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();

    // Check if this is a subprogram call
    const m98Match = code.match(/M98\s+P(\d+)(?:\s+L(\d+))?/i);
    const g65Match = code.match(/G65\s+P(\d+)(?:\s+L(\d+))?/i);
    const match = m98Match || g65Match;

    if (match) {
      const programNumber = parseInt(match[1]);
      const repetitions = match[2] ? parseInt(match[2]) : 1;

      // Find the subprogram definition
      const def = definitions.find(d => d.programNumber === programNumber);
      if (def) {
        expandedLines.push(`; --- Expanded subprogram O${programNumber} (${repetitions}x) ---`);
        for (let rep = 0; rep < repetitions; rep++) {
          for (let j = def.startLine + 1; j <= def.endLine; j++) {
            if (j < lines.length) {
              expandedLines.push(lines[j]);
            }
          }
        }
        expandedLines.push(`; --- End subprogram O${programNumber} ---`);
      } else {
        // Keep original if subprogram not found
        expandedLines.push(line);
      }
    } else {
      // Skip subprogram definitions in expanded output
      const oMatch = trimmed.match(/^O(\d+)/i);
      if (oMatch) {
        const programNumber = parseInt(oMatch[1]);
        const def = definitions.find(d => d.programNumber === programNumber);
        if (def && def.startLine === i) {
          // Skip the definition
          i = def.endLine;
          continue;
        }
      }
      expandedLines.push(line);
    }
  }

  const hasSubprograms = calls.length > 0 || definitions.length > 0;
  const expansionRatio = lines.length > 0 ? expandedLines.length / lines.length : 1;

  return {
    calls, definitions, expandedLines,
    originalLineCount: lines.length,
    expandedLineCount: expandedLines.length,
    hasSubprograms, expansionRatio,
  };
}
