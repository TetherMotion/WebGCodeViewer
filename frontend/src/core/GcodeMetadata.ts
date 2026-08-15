/**
 * @file GcodeMetadata.ts
 * @brief Parses G-code text to extract CNC/3DP metadata: tool changes,
 * spindle speeds, temperatures, feed rates, coolant states, fan speeds.
 *
 * This runs entirely on the frontend using the G-code text already loaded
 * in the GcodeViewer. No backend changes required.
 */

export interface ToolChange {
  lineNumber: number;
  toolNumber: number;
  gcodeLine: string;
}

export interface SpindleEvent {
  lineNumber: number;
  rpm: number;
  direction: 'cw' | 'ccw' | 'off';
  gcodeLine: string;
}

export interface TemperatureEvent {
  lineNumber: number;
  hotend: number | null;   // °C, null = no change
  bed: number | null;      // °C, null = no change
  chamber: number | null;  // °C, null = no change
  gcodeLine: string;
}

export interface FanEvent {
  lineNumber: number;
  speed: number;  // 0-255 or 0-1 normalized
  gcodeLine: string;
}

export interface CoolantEvent {
  lineNumber: number;
  state: 'mist' | 'flood' | 'off';
  gcodeLine: string;
}

export interface FeedRateChange {
  lineNumber: number;
  feedRate: number;  // mm/min
  gcodeLine: string;
}

export interface GcodeMetadata {
  toolChanges: ToolChange[];
  spindleEvents: SpindleEvent[];
  temperatureEvents: TemperatureEvent[];
  fanEvents: FanEvent[];
  coolantEvents: CoolantEvent[];
  feedRateChanges: FeedRateChange[];
  // Summary
  tools: number[];              // unique tool numbers used
  maxSpindleRpm: number;
  maxHotendTemp: number;
  maxBedTemp: number;
  maxFanSpeed: number;
  feedRateRange: { min: number; max: number };
  // Per-block feed rate (indexed by block index)
  blockFeedRates: Map<number, number>;
  // Per-block tool number (indexed by block index)
  blockTools: Map<number, number>;
  // Per-block spindle speed (indexed by block index)
  blockSpindleRpm: Map<number, number>;
}

/**
 * Parse G-code text to extract metadata.
 * @param lines Array of G-code lines (0-indexed)
 * @param blockLineMap Optional map of blockIndex → [startLine, endLine]
 */
export function parseGcodeMetadata(
  lines: string[],
  blockLineMap?: Map<number, [number, number]>,
): GcodeMetadata {
  const toolChanges: ToolChange[] = [];
  const spindleEvents: SpindleEvent[] = [];
  const temperatureEvents: TemperatureEvent[] = [];
  const fanEvents: FanEvent[] = [];
  const coolantEvents: CoolantEvent[] = [];
  const feedRateChanges: FeedRateChange[] = [];

  const tools = new Set<number>();
  let maxSpindleRpm = 0;
  let maxHotendTemp = 0;
  let maxBedTemp = 0;
  let maxFanSpeed = 0;
  let minFeedRate = Infinity;
  let maxFeedRate = 0;

  // State tracking
  let currentTool = 0;
  let currentFeedRate = 0;
  let currentSpindleRpm = 0;
  let currentHotend = 0;
  let currentBed = 0;
  let currentChamber = 0;
  let pendingTool = -1;

  // Per-block state
  const blockFeedRates = new Map<number, number>();
  const blockTools = new Map<number, number>();
  const blockSpindleRpm = new Map<number, number>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    // Strip inline comments
    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Parse words: letter+number pairs
    const words = code.match(/([A-Za-z])(-?\d*\.?\d+)/g) || [];
    const wordMap = new Map<string, number>();
    for (const w of words) {
      const letter = w[0].toUpperCase();
      const value = parseFloat(w.slice(1));
      if (!isNaN(value)) wordMap.set(letter, value);
    }

    // Tool selection (T word)
    if (wordMap.has('T')) {
      pendingTool = Math.round(wordMap.get('T')!);
    }

    // Tool change (M6)
    if (/\bM6\b/i.test(code)) {
      const tool = pendingTool >= 0 ? pendingTool : currentTool;
      toolChanges.push({
        lineNumber: i,
        toolNumber: tool,
        gcodeLine: line,
      });
      tools.add(tool);
      currentTool = tool;
      pendingTool = -1;
    }

    // Spindle control
    if (/\bM3\b/i.test(code) || /\bM03\b/i.test(code)) {
      const rpm = wordMap.get('S') ?? currentSpindleRpm;
      spindleEvents.push({
        lineNumber: i,
        rpm,
        direction: 'cw',
        gcodeLine: line,
      });
      currentSpindleRpm = rpm;
      if (rpm > maxSpindleRpm) maxSpindleRpm = rpm;
    } else if (/\bM4\b/i.test(code) || /\bM04\b/i.test(code)) {
      const rpm = wordMap.get('S') ?? currentSpindleRpm;
      spindleEvents.push({
        lineNumber: i,
        rpm,
        direction: 'ccw',
        gcodeLine: line,
      });
      currentSpindleRpm = rpm;
      if (rpm > maxSpindleRpm) maxSpindleRpm = rpm;
    } else if (/\bM5\b/i.test(code) || /\bM05\b/i.test(code)) {
      spindleEvents.push({
        lineNumber: i,
        rpm: 0,
        direction: 'off',
        gcodeLine: line,
      });
      currentSpindleRpm = 0;
    }

    // Temperature (3DP)
    let hotend: number | null = null;
    let bed: number | null = null;
    let chamber: number | null = null;
    let hasTemp = false;

    if (/\bM104\b/i.test(code) || /\bM109\b/i.test(code)) {
      hotend = wordMap.get('S') ?? null;
      if (hotend !== null) {
        currentHotend = hotend;
        if (hotend > maxHotendTemp) maxHotendTemp = hotend;
      }
      hasTemp = true;
    }
    if (/\bM140\b/i.test(code) || /\bM190\b/i.test(code)) {
      bed = wordMap.get('S') ?? null;
      if (bed !== null) {
        currentBed = bed;
        if (bed > maxBedTemp) maxBedTemp = bed;
      }
      hasTemp = true;
    }
    if (/\bM141\b/i.test(code) || /\bM191\b/i.test(code)) {
      chamber = wordMap.get('S') ?? null;
      if (chamber !== null) currentChamber = chamber;
      hasTemp = true;
    }
    if (hasTemp) {
      temperatureEvents.push({
        lineNumber: i,
        hotend,
        bed,
        chamber,
        gcodeLine: line,
      });
    }

    // Fan speed (3DP)
    if (/\bM106\b/i.test(code)) {
      const speed = wordMap.get('S') ?? 255;
      fanEvents.push({ lineNumber: i, speed, gcodeLine: line });
      if (speed > maxFanSpeed) maxFanSpeed = speed;
    } else if (/\bM107\b/i.test(code)) {
      fanEvents.push({ lineNumber: i, speed: 0, gcodeLine: line });
    }

    // Coolant (CNC)
    if (/\bM7\b/i.test(code) || /\bM07\b/i.test(code)) {
      coolantEvents.push({ lineNumber: i, state: 'mist', gcodeLine: line });
    } else if (/\bM8\b/i.test(code) || /\bM08\b/i.test(code)) {
      coolantEvents.push({ lineNumber: i, state: 'flood', gcodeLine: line });
    } else if (/\bM9\b/i.test(code) || /\bM09\b/i.test(code)) {
      coolantEvents.push({ lineNumber: i, state: 'off', gcodeLine: line });
    }

    // Feed rate (F word)
    if (wordMap.has('F')) {
      const f = wordMap.get('F')!;
      currentFeedRate = f;
      feedRateChanges.push({
        lineNumber: i,
        feedRate: f,
        gcodeLine: line,
      });
      if (f < minFeedRate) minFeedRate = f;
      if (f > maxFeedRate) maxFeedRate = f;
    }

    // Map current state to block index if we have a block line map
    if (blockLineMap) {
      for (const [blockIdx, [start, end]] of blockLineMap) {
        if (i >= start && i <= end) {
          if (currentFeedRate > 0) blockFeedRates.set(blockIdx, currentFeedRate);
          blockTools.set(blockIdx, currentTool);
          if (currentSpindleRpm > 0) blockSpindleRpm.set(blockIdx, currentSpindleRpm);
          break;
        }
      }
    }
  }

  return {
    toolChanges,
    spindleEvents,
    temperatureEvents,
    fanEvents,
    coolantEvents,
    feedRateChanges,
    tools: Array.from(tools).sort((a, b) => a - b),
    maxSpindleRpm,
    maxHotendTemp,
    maxBedTemp,
    maxFanSpeed,
    feedRateRange: {
      min: minFeedRate === Infinity ? 0 : minFeedRate,
      max: maxFeedRate,
    },
    blockFeedRates,
    blockTools,
    blockSpindleRpm,
  };
}

/**
 * Compute material usage from NBP data.
 * For 3D printing: extrusion length = sum of |E delta| per piece.
 * Volume = length × π × (filament_diameter/2)²
 * Weight = volume × density
 */
export function computeMaterialUsage(
  pieces: { extruderSpeed: number; controlPoints: number[] }[],
  segmentTimes: number[],
  filamentDiameter: number = 1.75,
  density: number = 1.24,  // PLA density g/cm³
): { extrusionLength: number; volume: number; weight: number } {
  // E-axis extrusion amount per piece = extruderSpeed * segmentTime
  // But we don't have per-piece segment time directly.
  // Approximate: use extruderSpeed as mm/s and piece length as proxy
  // For a proper calculation we'd need the E delta per piece.
  // Since extruderSpeed is already mm/s and we have total path length,
  // we can approximate extrusion length from the NBP extruderSpeed field
  // combined with segment durations from the miniplot data.

  // Without per-segment time, use a simpler approximation:
  // Sum of |extruderSpeed| * estimated_time per piece.
  // For now, just compute from the miniplot data if available.
  let extrusionLength = 0;
  for (let i = 0; i < pieces.length; i++) {
    const speed = pieces[i].extruderSpeed;
    if (speed <= 0) continue;  // skip retractions and travel
    // Estimate segment time from segment speeds data if available
    const time = segmentTimes[i] ?? 0;
    extrusionLength += speed * time;
  }

  // Volume of filament consumed = length × cross-section area
  const radius = filamentDiameter / 2;  // mm
  const volumeMm3 = extrusionLength * Math.PI * radius * radius;
  const volumeCm3 = volumeMm3 / 1000;
  const weight = volumeCm3 * density;  // grams

  return {
    extrusionLength,
    volume: volumeMm3,
    weight,
  };
}

/**
 * Compute speed statistics from miniplot segment data.
 */
export function computeSpeedStats(segments: { speedLinear: number; duration: number }[]): {
  minSpeed: number;
  maxSpeed: number;
  meanSpeed: number;
  medianSpeed: number;
} {
  if (segments.length === 0) {
    return { minSpeed: 0, maxSpeed: 0, meanSpeed: 0, medianSpeed: 0 };
  }

  const speeds = segments.map(s => s.speedLinear).filter(s => s > 0);
  if (speeds.length === 0) {
    return { minSpeed: 0, maxSpeed: 0, meanSpeed: 0, medianSpeed: 0 };
  }

  const minSpeed = Math.min(...speeds);
  const maxSpeed = Math.max(...speeds);
  const meanSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;

  const sorted = [...speeds].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianSpeed = sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];

  return { minSpeed, maxSpeed, meanSpeed, medianSpeed };
}

/**
 * Compute per-layer time from Z-layer data and segment speeds.
 */
export function computeLayerTimes(
  zLayers: { layerIndex: number; zHeight: number; pieceStart: number; pieceEnd: number }[],
  segmentSpeeds: { timeStart: number; duration: number }[],
): { layerIndex: number; zHeight: number; timeSeconds: number }[] {
  if (zLayers.length === 0 || segmentSpeeds.length === 0) return [];

  const result: { layerIndex: number; zHeight: number; timeSeconds: number }[] = [];

  for (const layer of zLayers) {
    let time = 0;
    const start = Math.min(layer.pieceStart, segmentSpeeds.length - 1);
    const end = Math.min(layer.pieceEnd, segmentSpeeds.length - 1);
    for (let i = start; i <= end && i < segmentSpeeds.length; i++) {
      time += segmentSpeeds[i].duration;
    }
    result.push({
      layerIndex: layer.layerIndex,
      zHeight: layer.zHeight,
      timeSeconds: time,
    });
  }

  return result;
}

/**
 * Format time in seconds to a human-readable string.
 */
export function formatTime(seconds: number): string {
  if (seconds < 0 || !isFinite(seconds)) return '0s';
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (minutes < 60) return `${minutes}m ${secs}s`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m ${secs}s`;
}

/**
 * Get the current machine state at a given progress fraction (0..1).
 * Returns the active spindle, temperature, fan, and coolant state
 * by finding the last event before the given line number.
 */
export function getMachineStateAtLine(
  metadata: GcodeMetadata,
  lineNumber: number,
): {
  spindleRpm: number;
  spindleDir: 'cw' | 'ccw' | 'off';
  hotendTemp: number;
  bedTemp: number;
  chamberTemp: number;
  fanSpeed: number;
  coolantState: 'mist' | 'flood' | 'off';
} {
  let spindleRpm = 0;
  let spindleDir: 'cw' | 'ccw' | 'off' = 'off';
  let hotendTemp = 0;
  let bedTemp = 0;
  let chamberTemp = 0;
  let fanSpeed = 0;
  let coolantState: 'mist' | 'flood' | 'off' = 'off';

  for (const e of metadata.spindleEvents) {
    if (e.lineNumber > lineNumber) break;
    spindleRpm = e.rpm;
    spindleDir = e.direction;
  }
  for (const e of metadata.temperatureEvents) {
    if (e.lineNumber > lineNumber) break;
    if (e.hotend !== null) hotendTemp = e.hotend;
    if (e.bed !== null) bedTemp = e.bed;
    if (e.chamber !== null) chamberTemp = e.chamber;
  }
  for (const e of metadata.fanEvents) {
    if (e.lineNumber > lineNumber) break;
    fanSpeed = e.speed;
  }
  for (const e of metadata.coolantEvents) {
    if (e.lineNumber > lineNumber) break;
    coolantState = e.state;
  }

  return { spindleRpm, spindleDir, hotendTemp, bedTemp, chamberTemp, fanSpeed, coolantState };
}
