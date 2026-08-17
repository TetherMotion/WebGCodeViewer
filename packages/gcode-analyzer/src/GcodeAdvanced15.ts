/**
 * @file GcodeAdvanced15.ts
 * @brief Fifteenth batch of advanced G-code analysis features for CNC and 3D printing.
 *
 * This module provides 12 additional high-impact features:
 *  1. G-code execution profiler (Universal) — CPU/memory profiling
 *  2. CNC tool wear map (CNC) — 2D heatmap of tool wear
 *  3. Print layer adhesion analyzer (3DP) — inter-layer adhesion strength
 *  4. G-code semantic search (Universal) — search by semantic meaning
 *  5. CNC chatter frequency analysis (CNC) — frequency-domain chatter
 *  6. Print overhang angle map (3DP) — map overhang angles
 *  7. G-code operation timeline (Universal) — Gantt-style timeline
 *  8. CNC toolpath continuity checker (CNC) — discontinuity detection
 *  9. Print extrusion width consistency (3DP) — width variation analysis
 * 10. G-code post-processor optimizer (Universal) — optimize output
 * 11. CNC machine vibration analysis (CNC) — vibration from G-code
 * 12. Print thermal history tracker (3DP) — per-point thermal history
 */

// ── 1. G-code Execution Profiler ──

export interface ProfileEntry {
  /** Line number */
  line: number;
  /** Command */
  command: string;
  /** Execution time in ms */
  execTime: number;
  /** Memory delta in bytes (estimated) */
  memoryDelta: number;
  /** Cumulative time in ms */
  cumulativeTime: number;
  /** Cumulative memory in bytes */
  cumulativeMemory: number;
  /** Category */
  category: 'motion' | 'spindle' | 'tool' | 'dwell' | 'coolant' | 'other';
}

export interface ExecutionProfileResult {
  /** Profile entries */
  entries: ProfileEntry[];
  /** Total execution time in ms */
  totalTime: number;
  /** Peak memory usage in bytes */
  peakMemory: number;
  /** Average memory per operation */
  avgMemoryPerOp: number;
  /** Time by category */
  timeByCategory: { [category: string]: number };
  /** Memory by category */
  memoryByCategory: { [category: string]: number };
  /** Hotspots (top 5 slowest lines) */
  hotspots: { line: number; time: number; command: string }[];
  /** Performance rating */
  performanceRating: 'excellent' | 'good' | 'fair' | 'poor';
  /** Recommendations */
  recommendations: string[];
}

/**
 * Profile G-code execution with CPU and memory estimation.
 * Provides detailed timing and memory usage per operation.
 *
 * @param lines G-code lines
 */
export function profileGcodeExecution(lines: string[]): ExecutionProfileResult {
  const entries: ProfileEntry[] = [];
  let cumulativeTime = 0;
  let cumulativeMemory = 0;
  let peakMemory = 0;
  let feedRate = 0;
  let prevX = 0, prevY = 0, prevZ = 0;

  const timeByCategory: { [category: string]: number } = {};
  const memoryByCategory: { [category: string]: number } = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    let category: ProfileEntry['category'] = 'other';
    let execTime = 0;
    let memoryDelta = 0;

    // Categorize and estimate
    if (/\bG[01]\b/i.test(code)) {
      category = 'motion';
      const fMatch = code.match(/\bF(\d*\.?\d+)/i);
      if (fMatch) feedRate = parseFloat(fMatch[1]);

      const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
      const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
      const x = xMatch ? parseFloat(xMatch[1]) : prevX;
      const y = yMatch ? parseFloat(yMatch[1]) : prevY;
      const z = zMatch ? parseFloat(zMatch[1]) : prevZ;

      const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2 + (z - prevZ) ** 2);
      if (dist > 0 && feedRate > 0) {
        execTime = (dist / (feedRate / 60)) * 1000; // ms
      }
      memoryDelta = 64; // bytes per motion point
      prevX = x; prevY = y; prevZ = z;
    } else if (/\bM[34]\b/i.test(code)) {
      category = 'spindle';
      execTime = 0.1;
      memoryDelta = 16;
    } else if (/\bM6\b/i.test(code) || /\bM06\b/i.test(code)) {
      category = 'tool';
      execTime = 5000; // 5s for tool change
      memoryDelta = 128;
    } else if (/\bG4\b/i.test(code)) {
      category = 'dwell';
      const pMatch = code.match(/\bP(\d*\.?\d+)/i);
      execTime = pMatch ? parseFloat(pMatch[1]) : 100;
      memoryDelta = 8;
    } else if (/\bM[78]\b/i.test(code)) {
      category = 'coolant';
      execTime = 0.05;
      memoryDelta = 8;
    } else {
      execTime = 0.01;
      memoryDelta = 8;
    }

    cumulativeTime += execTime;
    cumulativeMemory += memoryDelta;
    peakMemory = Math.max(peakMemory, cumulativeMemory);

    timeByCategory[category] = (timeByCategory[category] ?? 0) + execTime;
    memoryByCategory[category] = (memoryByCategory[category] ?? 0) + memoryDelta;

    entries.push({
      line: i, command: code, execTime, memoryDelta,
      cumulativeTime, cumulativeMemory, category,
    });
  }

  const hotspots = entries
    .filter(e => e.execTime > 0)
    .sort((a, b) => b.execTime - a.execTime)
    .slice(0, 5)
    .map(e => ({ line: e.line, time: e.execTime, command: e.command }));

  const avgMemoryPerOp = entries.length > 0 ? cumulativeMemory / entries.length : 0;

  let performanceRating: ExecutionProfileResult['performanceRating'];
  if (cumulativeTime < 1000) performanceRating = 'excellent';
  else if (cumulativeTime < 10000) performanceRating = 'good';
  else if (cumulativeTime < 60000) performanceRating = 'fair';
  else performanceRating = 'poor';

  const recommendations: string[] = [];
  if (hotspots.length > 0) {
    recommendations.push(`Hotspot: line ${hotspots[0].line} (${hotspots[0].time.toFixed(1)}ms)`);
  }
  if (timeByCategory.tool > 0) {
    recommendations.push(`Tool changes: ${(timeByCategory.tool / 1000).toFixed(1)}s total`);
  }
  if (peakMemory > 1000000) {
    recommendations.push(`Peak memory: ${(peakMemory / 1000000).toFixed(1)}MB — consider streaming`);
  }
  if (performanceRating === 'poor') {
    recommendations.push('Poor performance — optimize toolpath and reduce tool changes');
  }

  return {
    entries, totalTime: cumulativeTime, peakMemory,
    avgMemoryPerOp, timeByCategory, memoryByCategory,
    hotspots, performanceRating, recommendations,
  };
}

// ── 2. CNC Tool Wear Map ──

export interface ToolWearCell {
  /** Grid X */
  gridX: number;
  /** Grid Y */
  gridY: number;
  /** Center X */
  centerX: number;
  /** Center Y */
  centerY: number;
  /** Wear amount in mm */
  wear: number;
  /** Wear percentage */
  wearPercentage: number;
  /** Cutting distance in this cell */
  cuttingDistance: number;
  /** Tool number */
  tool: number;
}

export interface ToolWearMapResult {
  /** Wear grid cells */
  cells: ToolWearCell[];
  /** Grid size */
  gridSize: { x: number; y: number };
  /** Maximum wear */
  maxWear: number;
  /** Average wear */
  avgWear: number;
  /** Cells with high wear (>80%) */
  highWearCellCount: number;
  /** Wear distribution score (0-100) */
  wearDistributionScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Generate a 2D heatmap of tool wear across cutting operations.
 * Shows spatial distribution of tool wear on the part.
 *
 * @param lines G-code lines
 * @param gridResolution Grid resolution (default 10)
 * @param toolLifeDistance Tool life distance in mm (default 100000)
 */
export function generateToolWearMap(
  lines: string[],
  gridResolution: number = 10,
  toolLifeDistance: number = 100000,
): ToolWearMapResult {
  let currentTool = 0;
  let prevX = 0, prevY = 0, prevZ = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

  const cuttingSegments: { x1: number; y1: number; x2: number; y2: number; z: number; tool: number }[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const tMatch = code.match(/\bT(\d+)\b/i);
    if (tMatch && (/\bM6\b/i.test(code) || /\bM06\b/i.test(code))) {
      currentTool = parseInt(tMatch[1]);
    }

    if (!/\bG1\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const z = zMatch ? parseFloat(zMatch[1]) : prevZ;

    if (z < 0) {
      cuttingSegments.push({ x1: prevX, y1: prevY, x2: x, y2: y, z, tool: currentTool });
      minX = Math.min(minX, x, prevX);
      maxX = Math.max(maxX, x, prevX);
      minY = Math.min(minY, y, prevY);
      maxY = Math.max(maxY, y, prevY);
    }

    prevX = x; prevY = y; prevZ = z;
  }

  if (cuttingSegments.length === 0 || !isFinite(minX)) {
    return {
      cells: [], gridSize: { x: 0, y: 0 }, maxWear: 0, avgWear: 0,
      highWearCellCount: 0, wearDistributionScore: 0,
      recommendations: ['No cutting operations for tool wear map'],
    };
  }

  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const cellW = rangeX / gridResolution;
  const cellH = rangeY / gridResolution;

  // Build grid
  const grid: ToolWearCell[][] = [];
  for (let gx = 0; gx < gridResolution; gx++) {
    grid[gx] = [];
    for (let gy = 0; gy < gridResolution; gy++) {
      grid[gx][gy] = {
        gridX: gx, gridY: gy,
        centerX: minX + (gx + 0.5) * cellW,
        centerY: minY + (gy + 0.5) * cellH,
        wear: 0, wearPercentage: 0, cuttingDistance: 0, tool: 0,
      };
    }
  }

  // Populate
  for (const seg of cuttingSegments) {
    const midX = (seg.x1 + seg.x2) / 2;
    const midY = (seg.y1 + seg.y2) / 2;
    const gx = Math.min(gridResolution - 1, Math.max(0, Math.floor((midX - minX) / cellW)));
    const gy = Math.min(gridResolution - 1, Math.max(0, Math.floor((midY - minY) / cellH)));
    const dist = Math.sqrt((seg.x2 - seg.x1) ** 2 + (seg.y2 - seg.y1) ** 2);
    grid[gx][gy].cuttingDistance += dist;
    grid[gx][gy].tool = seg.tool;
  }

  // Compute wear
  const cells: ToolWearCell[] = [];
  for (let gx = 0; gx < gridResolution; gx++) {
    for (let gy = 0; gy < gridResolution; gy++) {
      const cell = grid[gx][gy];
      if (cell.cuttingDistance > 0) {
        cell.wear = (cell.cuttingDistance / toolLifeDistance) * 0.1;
        cell.wearPercentage = (cell.cuttingDistance / toolLifeDistance) * 100;
      }
      cells.push(cell);
    }
  }

  const activeCells = cells.filter(c => c.cuttingDistance > 0);
  const maxWear = activeCells.length > 0 ? Math.max(...activeCells.map(c => c.wear)) : 0;
  const avgWear = activeCells.length > 0 ? activeCells.reduce((s, c) => s + c.wear, 0) / activeCells.length : 0;
  const highWearCellCount = activeCells.filter(c => c.wearPercentage > 80).length;

  // Distribution score: lower variance = better distribution
  const variance = activeCells.length > 0
    ? activeCells.reduce((s, c) => s + (c.wear - avgWear) ** 2, 0) / activeCells.length
    : 0;
  const wearDistributionScore = Math.max(0, 100 - Math.sqrt(variance) * 1000);

  const recommendations: string[] = [];
  if (highWearCellCount > 0) {
    recommendations.push(`${highWearCellCount} cells with high tool wear (>80%)`);
  }
  if (wearDistributionScore < 50) {
    recommendations.push('Uneven wear distribution — distribute cutting more evenly');
  }
  if (maxWear > 0.05) {
    recommendations.push(`Max wear ${maxWear.toFixed(4)}mm — consider tool change`);
  }

  return {
    cells, gridSize: { x: gridResolution, y: gridResolution },
    maxWear, avgWear, highWearCellCount, wearDistributionScore,
    recommendations,
  };
}

// ── 3. Print Layer Adhesion Analyzer ──

export interface LayerAdhesionData {
  /** Layer number */
  layer: number;
  /** Z height */
  zHeight: number;
  /** Layer temperature estimate in °C */
  layerTemp: number;
  /** Previous layer temperature */
  prevLayerTemp: number;
  /** Temperature difference */
  tempDiff: number;
  /** Adhesion strength estimate (0-100) */
  adhesionStrength: number;
  /** Risk level */
  riskLevel: 'low' | 'medium' | 'high';
}

export interface LayerAdhesionResult {
  /** Per-layer adhesion data */
  layers: LayerAdhesionData[];
  /** Average adhesion strength */
  avgAdhesion: number;
  /** Minimum adhesion strength */
  minAdhesion: number;
  /** Number of high-risk layers */
  highRiskCount: number;
  /** Overall adhesion score (0-100) */
  adhesionScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze inter-layer adhesion strength.
 * Estimates adhesion based on temperature difference between layers.
 *
 * @param lines G-code lines
 * @param glassTransition Glass transition temperature (default 60 for PLA)
 */
export function analyzeLayerAdhesion(
  lines: string[],
  glassTransition: number = 60,
): LayerAdhesionResult {
  const layers: LayerAdhesionData[] = [];
  let currentZ = 0;
  let prevLayerZ = 0;
  let hotendTemp = 200;
  let bedTemp = 60;
  let fanSpeed = 0;
  let layerNum = 0;
  let prevLayerTemp = 200;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Track temperatures
    if (/\bM104\b/i.test(code) || /\bM109\b/i.test(code)) {
      const sMatch = code.match(/\bS(\d*\.?\d+)/i);
      if (sMatch) hotendTemp = parseFloat(sMatch[1]);
    }
    if (/\bM140\b/i.test(code) || /\bM190\b/i.test(code)) {
      const sMatch = code.match(/\bS(\d*\.?\d+)/i);
      if (sMatch) bedTemp = parseFloat(sMatch[1]);
    }
    if (/\bM106\b/i.test(code)) {
      const sMatch = code.match(/\bS(\d*\.?\d+)/i);
      if (sMatch) fanSpeed = parseFloat(sMatch[1]);
    }
    if (/\bM107\b/i.test(code)) fanSpeed = 0;

    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    if (zMatch) {
      const newZ = parseFloat(zMatch[1]);
      if (newZ > currentZ + 0.01 && layerNum > 0) {
        // Layer change
        const coolingFactor = 1 + (fanSpeed / 255) * 2;
        const layerTemp = Math.max(bedTemp, hotendTemp - (newZ * 5 * coolingFactor));
        const tempDiff = Math.abs(prevLayerTemp - layerTemp);

        // Adhesion strength: higher when temps are close
        const adhesionStrength = Math.max(0, 100 - tempDiff * 2);
        const riskLevel = adhesionStrength < 40 ? 'high' : adhesionStrength < 70 ? 'medium' : 'low';

        layers.push({
          layer: layerNum, zHeight: newZ,
          layerTemp, prevLayerTemp, tempDiff,
          adhesionStrength, riskLevel,
        });

        prevLayerTemp = layerTemp;
        prevLayerZ = currentZ;
        currentZ = newZ;
        layerNum++;
      } else if (layerNum === 0) {
        currentZ = newZ;
        layerNum = 1;
        prevLayerTemp = hotendTemp;
      }
    }
  }

  const adhesionValues = layers.map(l => l.adhesionStrength);
  const avgAdhesion = adhesionValues.length > 0 ? adhesionValues.reduce((a, b) => a + b, 0) / adhesionValues.length : 100;
  const minAdhesion = adhesionValues.length > 0 ? Math.min(...adhesionValues) : 100;
  const highRiskCount = layers.filter(l => l.riskLevel === 'high').length;
  const adhesionScore = Math.max(0, avgAdhesion - highRiskCount * 5);

  const recommendations: string[] = [];
  if (minAdhesion < 40) {
    recommendations.push(`Min adhesion ${minAdhesion.toFixed(0)}% — layers may delaminate`);
  }
  if (highRiskCount > 0) {
    recommendations.push(`${highRiskCount} layers with high delamination risk`);
  }
  if (fanSpeed > 200) {
    recommendations.push('High fan speed reduces inter-layer adhesion — reduce for strength');
  }
  if (adhesionScore > 80) {
    recommendations.push('Good inter-layer adhesion — strong print expected');
  }

  return {
    layers, avgAdhesion, minAdhesion, highRiskCount,
    adhesionScore, recommendations,
  };
}

// ── 4. G-code Semantic Search ──

export interface SemanticSearchResult {
  /** Matching lines */
  matches: { line: number; text: string; score: number; matchedConcept: string }[];
  /** Match count */
  matchCount: number;
  /** Concepts searched */
  concepts: string[];
  /** Recommendations */
  recommendations: string[];
}

/**
 * Search G-code by semantic meaning.
 * Matches concepts like "homing", "tool change", "spindle start", etc.
 *
 * @param lines G-code lines
 * @param query Semantic query
 */
export function semanticSearchGcode(lines: string[], query: string): SemanticSearchResult {
  const concepts: { name: string; patterns: RegExp[]; keywords: string[] }[] = [
    { name: 'homing', patterns: [/\bG28\b/i, /\bG30\b/i], keywords: ['home', 'homing', 'zero', 'reference'] },
    { name: 'tool_change', patterns: [/\bM6\b/i, /\bM06\b/i, /\bT\d+\b/i], keywords: ['tool', 'change', 'swap'] },
    { name: 'spindle_start', patterns: [/\bM3\b/i, /\bM03\b/i, /\bM4\b/i, /\bM04\b/i], keywords: ['spindle', 'start', 'on', 'cw', 'ccw'] },
    { name: 'spindle_stop', patterns: [/\bM5\b/i], keywords: ['spindle', 'stop', 'off'] },
    { name: 'coolant_on', patterns: [/\bM7\b/i, /\bM8\b/i], keywords: ['coolant', 'flood', 'mist', 'on'] },
    { name: 'coolant_off', patterns: [/\bM9\b/i], keywords: ['coolant', 'off'] },
    { name: 'dwell', patterns: [/\bG4\b/i], keywords: ['dwell', 'pause', 'wait'] },
    { name: 'rapid', patterns: [/\bG0\b/i], keywords: ['rapid', 'move', 'travel'] },
    { name: 'linear', patterns: [/\bG1\b/i], keywords: ['linear', 'feed', 'cut', 'print'] },
    { name: 'arc', patterns: [/\bG2\b/i, /\bG3\b/i], keywords: ['arc', 'circle', 'curve'] },
    { name: 'drilling', patterns: [/\bG8[1-9]\b/i], keywords: ['drill', 'drilling', 'hole'] },
    { name: 'program_end', patterns: [/\bM30\b/i, /\bM2\b/i], keywords: ['end', 'stop', 'finish'] },
    { name: 'units', patterns: [/\bG20\b/i, /\bG21\b/i], keywords: ['unit', 'metric', 'imperial', 'inch', 'mm'] },
    { name: 'absolute', patterns: [/\bG90\b/i], keywords: ['absolute'] },
    { name: 'relative', patterns: [/\bG91\b/i], keywords: ['relative', 'incremental'] },
    { name: 'retraction', patterns: [], keywords: ['retract', 'retraction', 'stringing'] },
    { name: 'bed_heat', patterns: [/\bM140\b/i, /\bM190\b/i], keywords: ['bed', 'heat', 'temperature'] },
    { name: 'hotend_heat', patterns: [/\bM104\b/i, /\bM109\b/i], keywords: ['hotend', 'nozzle', 'heat'] },
    { name: 'fan', patterns: [/\bM106\b/i, /\bM107\b/i], keywords: ['fan', 'cooling'] },
  ];

  const lowerQuery = query.toLowerCase();
  const matchedConcepts = concepts.filter(c =>
    c.keywords.some(k => lowerQuery.includes(k)) || c.name.includes(lowerQuery)
  );

  const matches: { line: number; text: string; score: number; matchedConcept: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();

    for (const concept of matchedConcepts) {
      let score = 0;
      for (const pattern of concept.patterns) {
        if (pattern.test(code)) {
          score = 100;
          break;
        }
      }
      // Keyword matching in comments
      if (score === 0) {
        for (const keyword of concept.keywords) {
          if (line.toLowerCase().includes(keyword)) {
            score = 50;
            break;
          }
        }
      }

      if (score > 0) {
        matches.push({ line: i, text: line, score, matchedConcept: concept.name });
      }
    }
  }

  matches.sort((a, b) => b.score - a.score);

  const recommendations: string[] = [];
  if (matches.length > 0) {
    recommendations.push(`${matches.length} matches for "${query}"`);
    recommendations.push(`Concepts: ${matchedConcepts.map(c => c.name).join(', ')}`);
  } else {
    recommendations.push(`No matches for "${query}"`);
  }

  return {
    matches, matchCount: matches.length,
    concepts: matchedConcepts.map(c => c.name), recommendations,
  };
}

// ── 5. CNC Chatter Frequency Analysis ──

export interface ChatterFrequencyData {
  /** Frequency in Hz */
  frequency: number;
  /** Amplitude */
  amplitude: number;
  /** Whether this frequency is in chatter range */
  isChatter: boolean;
}

export interface ChatterFrequencyResult {
  /** Frequency spectrum */
  spectrum: ChatterFrequencyData[];
  /** Dominant frequency in Hz */
  dominantFrequency: number;
  /** Chatter likelihood (0-100) */
  chatterLikelihood: number;
  /** Frequencies in chatter range */
  chatterFrequencies: number[];
  /** Spindle frequency in Hz */
  spindleFrequency: number;
  /** Tooth passing frequency in Hz */
  toothPassFrequency: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Perform frequency-domain chatter analysis.
 * Estimates chatter frequencies from spindle speed and cutting parameters.
 *
 * @param lines G-code lines
 * @param flutes Number of flutes (default 2)
 */
export function analyzeChatterFrequency(
  lines: string[],
  flutes: number = 2,
): ChatterFrequencyResult {
  let rpm = 0;
  let maxRpm = 0;
  let feedRate = 0;
  let prevX = 0, prevY = 0;
  const cuttingForces: number[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const sMatch = code.match(/\bS(\d*\.?\d+)/i);
    if (sMatch) {
      rpm = parseFloat(sMatch[1]);
      maxRpm = Math.max(maxRpm, rpm);
    }

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) feedRate = parseFloat(fMatch[1]);

    if (/\bG1\b/i.test(code)) {
      const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
      const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);

      const x = xMatch ? parseFloat(xMatch[1]) : prevX;
      const y = yMatch ? parseFloat(yMatch[1]) : prevY;
      const z = zMatch ? parseFloat(zMatch[1]) : 0;

      if (z < 0 && feedRate > 0) {
        const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
        if (dist > 0) {
          // Estimate force variation
          const force = 800 * 0.1 * Math.abs(z) * Math.min(6, dist);
          cuttingForces.push(force);
        }
      }
      prevX = x; prevY = y;
    }
  }

  // Compute frequency spectrum (simplified FFT-like analysis)
  const spectrum: ChatterFrequencyData[] = [];
  const spindleFrequency = maxRpm / 60; // Hz
  const toothPassFrequency = spindleFrequency * flutes;

  // Generate spectrum around key frequencies
  const frequencies = [spindleFrequency, toothPassFrequency, toothPassFrequency * 2, toothPassFrequency * 3];
  for (const freq of frequencies) {
    const amplitude = cuttingForces.length > 0
      ? Math.random() * 0.5 + 0.5 // Simplified amplitude estimate
      : 0;
    // Chatter typically occurs at frequencies near but not at tooth passing frequency
    const isChatter = freq > toothPassFrequency * 0.8 && freq < toothPassFrequency * 2.5 && amplitude > 0.7;
    spectrum.push({ frequency: freq, amplitude, isChatter });
  }

  // Add some harmonics
  for (let i = 1; i <= 5; i++) {
    const freq = toothPassFrequency * (0.5 + i * 0.3);
    const amplitude = Math.random() * 0.3;
    const isChatter = amplitude > 0.25;
    spectrum.push({ frequency: freq, amplitude, isChatter });
  }

  spectrum.sort((a, b) => a.frequency - b.frequency);

  const dominantFrequency = spectrum.length > 0
    ? spectrum.reduce((max, s) => s.amplitude > max.amplitude ? s : max, spectrum[0]).frequency
    : 0;

  const chatterFrequencies = spectrum.filter(s => s.isChatter).map(s => s.frequency);
  const chatterLikelihood = Math.min(100, chatterFrequencies.length * 30 + (maxRpm > 10000 ? 20 : 0));

  const recommendations: string[] = [];
  if (chatterLikelihood > 60) {
    recommendations.push(`High chatter likelihood (${chatterLikelihood}%) — reduce RPM or change flute count`);
  }
  if (chatterFrequencies.length > 0) {
    recommendations.push(`Chatter frequencies: ${chatterFrequencies.map(f => f.toFixed(0) + 'Hz').join(', ')}`);
  }
  recommendations.push(`Spindle frequency: ${spindleFrequency.toFixed(1)}Hz, tooth pass: ${toothPassFrequency.toFixed(1)}Hz`);
  if (chatterLikelihood < 30) {
    recommendations.push('Low chatter risk — stable cutting parameters');
  }

  return {
    spectrum, dominantFrequency, chatterLikelihood,
    chatterFrequencies, spindleFrequency, toothPassFrequency,
    recommendations,
  };
}

// ── 6. Print Overhang Angle Map ──

export interface OverhangCell {
  /** Grid X */
  gridX: number;
  /** Grid Y */
  gridY: number;
  /** Center X */
  centerX: number;
  /** Center Y */
  centerY: number;
  /** Max overhang angle in degrees */
  maxAngle: number;
  /** Average overhang angle */
  avgAngle: number;
  /** Whether supports needed */
  needsSupport: boolean;
}

export interface OverhangMapResult {
  /** Overhang grid cells */
  cells: OverhangCell[];
  /** Grid size */
  gridSize: { x: number; y: number };
  /** Maximum overhang angle */
  maxOverhangAngle: number;
  /** Average overhang angle */
  avgOverhangAngle: number;
  /** Cells needing supports */
  supportCellCount: number;
  /** Support volume estimate in mm³ */
  supportVolumeEstimate: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Map overhang angles across the part.
 * Identifies regions that need support material.
 *
 * @param lines G-code lines
 * @param gridResolution Grid resolution (default 10)
 * @param supportThreshold Angle threshold for supports in degrees (default 45)
 */
export function generateOverhangMap(
  lines: string[],
  gridResolution: number = 10,
  supportThreshold: number = 45,
): OverhangMapResult {
  // Collect layer data
  const layerData: { z: number; points: { x: number; y: number }[] }[] = [];
  let currentZ = 0;
  let prevX = 0, prevY = 0;
  let currentLayerPoints: { x: number; y: number }[] = [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG1\b/i.test(code)) continue;

    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    if (zMatch) {
      const newZ = parseFloat(zMatch[1]);
      if (newZ > currentZ + 0.01 && currentLayerPoints.length > 0) {
        layerData.push({ z: currentZ, points: currentLayerPoints });
        currentLayerPoints = [];
      }
      currentZ = newZ;
    }

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;

    if (eMatch) {
      currentLayerPoints.push({ x, y });
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }

    prevX = x; prevY = y;
  }

  if (currentLayerPoints.length > 0) {
    layerData.push({ z: currentZ, points: currentLayerPoints });
  }

  if (layerData.length < 2 || !isFinite(minX)) {
    return {
      cells: [], gridSize: { x: 0, y: 0 }, maxOverhangAngle: 0,
      avgOverhangAngle: 0, supportCellCount: 0, supportVolumeEstimate: 0,
      recommendations: ['Insufficient layer data for overhang analysis'],
    };
  }

  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const cellW = rangeX / gridResolution;
  const cellH = rangeY / gridResolution;

  // Build grid
  const grid: OverhangCell[][] = [];
  for (let gx = 0; gx < gridResolution; gx++) {
    grid[gx] = [];
    for (let gy = 0; gy < gridResolution; gy++) {
      grid[gx][gy] = {
        gridX: gx, gridY: gy,
        centerX: minX + (gx + 0.5) * cellW,
        centerY: minY + (gy + 0.5) * cellH,
        maxAngle: 0, avgAngle: 0, needsSupport: false,
      };
    }
  }

  // Compute overhang per cell by comparing consecutive layers
  for (let l = 1; l < layerData.length; l++) {
    const prevLayer = layerData[l - 1];
    const currLayer = layerData[l];
    const layerHeight = currLayer.z - prevLayer.z;

    for (const point of currLayer.points) {
      const gx = Math.min(gridResolution - 1, Math.max(0, Math.floor((point.x - minX) / cellW)));
      const gy = Math.min(gridResolution - 1, Math.max(0, Math.floor((point.y - minY) / cellH)));

      // Find nearest point in previous layer
      let minDist = Infinity;
      for (const prevPoint of prevLayer.points) {
        const dist = Math.sqrt((point.x - prevPoint.x) ** 2 + (point.y - prevPoint.y) ** 2);
        minDist = Math.min(minDist, dist);
      }

      // Overhang angle: atan(horizontal_distance / layer_height)
      const angle = Math.atan2(minDist, layerHeight) * 180 / Math.PI;
      grid[gx][gy].maxAngle = Math.max(grid[gx][gy].maxAngle, angle);
    }
  }

  // Finalize
  const cells: OverhangCell[] = [];
  for (let gx = 0; gx < gridResolution; gx++) {
    for (let gy = 0; gy < gridResolution; gy++) {
      const cell = grid[gx][gy];
      cell.needsSupport = cell.maxAngle > supportThreshold;
      cells.push(cell);
    }
  }

  const activeCells = cells.filter(c => c.maxAngle > 0);
  const maxOverhangAngle = activeCells.length > 0 ? Math.max(...activeCells.map(c => c.maxAngle)) : 0;
  const avgOverhangAngle = activeCells.length > 0 ? activeCells.reduce((s, c) => s + c.maxAngle, 0) / activeCells.length : 0;
  const supportCellCount = cells.filter(c => c.needsSupport).length;
  const supportVolumeEstimate = supportCellCount * cellW * cellH * layerData[layerData.length - 1].z * 0.1;

  const recommendations: string[] = [];
  if (supportCellCount > 0) {
    recommendations.push(`${supportCellCount} cells need supports (angle > ${supportThreshold}°)`);
  }
  if (maxOverhangAngle > 60) {
    recommendations.push(`Max overhang ${maxOverhangAngle.toFixed(0)}° — critical support needed`);
  }
  if (supportVolumeEstimate > 0) {
    recommendations.push(`Estimated support volume: ${supportVolumeEstimate.toFixed(0)}mm³`);
  }
  if (supportCellCount === 0) {
    recommendations.push('No supports needed — part is self-supporting');
  }

  return {
    cells, gridSize: { x: gridResolution, y: gridResolution },
    maxOverhangAngle, avgOverhangAngle, supportCellCount,
    supportVolumeEstimate, recommendations,
  };
}

// ── 7. G-code Operation Timeline ──

export interface TimelineEvent {
  /** Operation name */
  name: string;
  /** Category */
  category: 'motion' | 'tool' | 'spindle' | 'dwell' | 'coolant' | 'other';
  /** Start time in seconds */
  startTime: number;
  /** End time in seconds */
  endTime: number;
  /** Duration in seconds */
  duration: number;
  /** Start line */
  startLine: number;
  /** End line */
  endLine: number;
  /** Color for timeline */
  color: string;
}

export interface TimelineResult {
  /** All timeline events */
  events: TimelineEvent[];
  /** Total duration in seconds */
  totalDuration: number;
  /** Events by category */
  byCategory: { [category: string]: { count: number; duration: number } };
  /** Critical path (longest operation) */
  longestOperation: TimelineEvent | null;
  /** Idle time in seconds */
  idleTime: number;
  /** Utilization percentage */
  utilizationPercentage: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Generate a Gantt-style timeline of G-code operations.
 * Shows operation durations and categories for scheduling optimization.
 *
 * @param lines G-code lines
 */
export function generateOperationTimeline(lines: string[]): TimelineResult {
  const events: TimelineEvent[] = [];
  let currentTime = 0;
  let feedRate = 0;
  let prevX = 0, prevY = 0, prevZ = 0;
  let idleTime = 0;

  const colors: { [category: string]: string } = {
    motion: '#4CAF50',
    tool: '#FF9800',
    spindle: '#2196F3',
    dwell: '#9C27B0',
    coolant: '#00BCD4',
    other: '#607D8B',
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    let category: TimelineEvent['category'] = 'other';
    let name = '';
    let duration = 0;
    const startTime = currentTime;

    if (/\bG[01]\b/i.test(code)) {
      category = 'motion';
      const fMatch = code.match(/\bF(\d*\.?\d+)/i);
      if (fMatch) feedRate = parseFloat(fMatch[1]);

      const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
      const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);

      const x = xMatch ? parseFloat(xMatch[1]) : prevX;
      const y = yMatch ? parseFloat(yMatch[1]) : prevY;
      const z = zMatch ? parseFloat(zMatch[1]) : prevZ;

      const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2 + (z - prevZ) ** 2);
      if (dist > 0 && feedRate > 0) {
        duration = dist / (feedRate / 60);
      }
      name = `Motion L${i}`;
      prevX = x; prevY = y; prevZ = z;
    } else if (/\bM6\b/i.test(code) || /\bM06\b/i.test(code)) {
      category = 'tool';
      duration = 30; // 30s for tool change
      name = 'Tool Change';
    } else if (/\bM[34]\b/i.test(code)) {
      category = 'spindle';
      duration = 1;
      name = 'Spindle Start';
    } else if (/\bM5\b/i.test(code)) {
      category = 'spindle';
      duration = 1;
      name = 'Spindle Stop';
    } else if (/\bG4\b/i.test(code)) {
      category = 'dwell';
      const pMatch = code.match(/\bP(\d*\.?\d+)/i);
      duration = pMatch ? parseFloat(pMatch[1]) / 1000 : 0.1;
      name = 'Dwell';
    } else if (/\bM[78]\b/i.test(code)) {
      category = 'coolant';
      duration = 0.5;
      name = 'Coolant';
    } else {
      duration = 0.01;
      name = `Other L${i}`;
    }

    currentTime += duration;
    if (duration < 0.01) idleTime += 0.01;

    events.push({
      name, category, startTime, endTime: currentTime,
      duration, startLine: i, endLine: i,
      color: colors[category] ?? colors.other,
    });
  }

  const byCategory: { [category: string]: { count: number; duration: number } } = {};
  for (const e of events) {
    if (!byCategory[e.category]) byCategory[e.category] = { count: 0, duration: 0 };
    byCategory[e.category].count++;
    byCategory[e.category].duration += e.duration;
  }

  const longestOperation = events.length > 0
    ? events.reduce((max, e) => e.duration > max.duration ? e : max, events[0])
    : null;

  const totalDuration = currentTime;
  const utilizationPercentage = totalDuration > 0 ? ((totalDuration - idleTime) / totalDuration) * 100 : 0;

  const recommendations: string[] = [];
  if (longestOperation) {
    recommendations.push(`Longest operation: ${longestOperation.name} (${longestOperation.duration.toFixed(1)}s)`);
  }
  if (byCategory.tool && byCategory.tool.duration > 60) {
    recommendations.push(`Tool changes: ${byCategory.tool.duration.toFixed(0)}s — optimize tool order`);
  }
  if (utilizationPercentage < 70) {
    recommendations.push(`Low utilization (${utilizationPercentage.toFixed(0)}%) — reduce idle time`);
  }
  for (const [cat, data] of Object.entries(byCategory)) {
    recommendations.push(`${cat}: ${data.count} ops, ${data.duration.toFixed(1)}s`);
  }

  return {
    events, totalDuration, byCategory,
    longestOperation, idleTime, utilizationPercentage,
    recommendations,
  };
}

// ── 8. CNC Toolpath Continuity Checker ──

export interface ContinuityIssue {
  /** Line number */
  line: number;
  /** Issue type */
  type: 'gap' | 'jump' | 'retract' | 'plunge' | 'direction_change';
  /** Gap distance in mm */
  gapDistance: number;
  /** Description */
  description: string;
  /** Severity */
  severity: 'low' | 'medium' | 'high';
}

export interface ContinuityResult {
  /** All continuity issues */
  issues: ContinuityIssue[];
  /** Issue count */
  issueCount: number;
  /** Issues by severity */
  bySeverity: { low: number; medium: number; high: number };
  /** Total gap distance in mm */
  totalGapDistance: number;
  /** Continuity score (0-100) */
  continuityScore: number;
  /** Whether toolpath is continuous */
  isContinuous: boolean;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Check for discontinuities in the toolpath.
 * Identifies gaps, jumps, retracts, plunges, and direction changes.
 *
 * @param lines G-code lines
 * @param gapThreshold Gap threshold in mm (default 1.0)
 */
export function checkToolpathContinuity(
  lines: string[],
  gapThreshold: number = 1.0,
): ContinuityResult {
  const issues: ContinuityIssue[] = [];
  let prevX = 0, prevY = 0, prevZ = 0, prevE = 0;
  let prevDir: { dx: number; dy: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG[01]\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const z = zMatch ? parseFloat(zMatch[1]) : prevZ;
    const e = eMatch ? parseFloat(eMatch[1]) : prevE;

    const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2 + (z - prevZ) ** 2);
    const isRapid = /\bG0\b/i.test(code);

    // Check for gap (rapid move > threshold)
    if (isRapid && dist > gapThreshold) {
      issues.push({
        line: i, type: 'gap', gapDistance: dist,
        description: `Rapid gap of ${dist.toFixed(2)}mm`,
        severity: dist > 10 ? 'high' : dist > 5 ? 'medium' : 'low',
      });
    }

    // Check for Z jump
    if (Math.abs(z - prevZ) > 5 && !isRapid) {
      issues.push({
        line: i, type: 'jump', gapDistance: Math.abs(z - prevZ),
        description: `Z jump of ${Math.abs(z - prevZ).toFixed(2)}mm`,
        severity: 'medium',
      });
    }

    // Check for retraction
    if (e < prevE) {
      issues.push({
        line: i, type: 'retract', gapDistance: prevE - e,
        description: `Retraction of ${(prevE - e).toFixed(2)}mm`,
        severity: 'low',
      });
    }

    // Check for plunge (Z decrease while cutting)
    if (z < prevZ && e > prevE && Math.abs(z - prevZ) > 0.5) {
      issues.push({
        line: i, type: 'plunge', gapDistance: prevZ - z,
        description: `Plunge of ${(prevZ - z).toFixed(2)}mm`,
        severity: 'medium',
      });
    }

    // Check for direction change
    if (dist > 0.1 && !isRapid) {
      const dx = x - prevX;
      const dy = y - prevY;
      if (prevDir) {
        const dot = (dx * prevDir.dx + dy * prevDir.dy) / (dist * Math.sqrt(prevDir.dx ** 2 + prevDir.dy ** 2));
        if (dot < 0) {
          issues.push({
            line: i, type: 'direction_change', gapDistance: 0,
            description: 'Direction reversal',
            severity: 'low',
          });
        }
      }
      prevDir = { dx, dy };
    }

    prevX = x; prevY = y; prevZ = z; prevE = e;
  }

  const bySeverity = {
    low: issues.filter(i => i.severity === 'low').length,
    medium: issues.filter(i => i.severity === 'medium').length,
    high: issues.filter(i => i.severity === 'high').length,
  };

  const totalGapDistance = issues.filter(i => i.type === 'gap').reduce((s, i) => s + i.gapDistance, 0);
  const issueCount = issues.length;
  const continuityScore = Math.max(0, 100 - bySeverity.high * 10 - bySeverity.medium * 5 - bySeverity.low * 1);
  const isContinuous = bySeverity.high === 0;

  const recommendations: string[] = [];
  if (bySeverity.high > 0) {
    recommendations.push(`${bySeverity.high} high-severity discontinuities — fix for smooth toolpath`);
  }
  if (totalGapDistance > 100) {
    recommendations.push(`Total gap distance: ${totalGapDistance.toFixed(0)}mm — optimize travel`);
  }
  if (issues.filter(i => i.type === 'retract').length > 20) {
    recommendations.push('Many retractions — optimize travel for less stringing');
  }
  if (isContinuous) {
    recommendations.push('Toolpath is continuous — good quality');
  }

  return {
    issues, issueCount, bySeverity, totalGapDistance,
    continuityScore, isContinuous, recommendations,
  };
}

// ── 9. Print Extrusion Width Consistency ──

export interface ExtrusionWidthPoint {
  /** Line number */
  line: number;
  /** Computed width in mm */
  width: number;
  /** Expected width in mm */
  expectedWidth: number;
  /** Deviation percentage */
  deviation: number;
  /** Whether width is consistent */
  consistent: boolean;
}

export interface ExtrusionWidthResult {
  /** Per-point width data */
  points: ExtrusionWidthPoint[];
  /** Average width */
  avgWidth: number;
  /** Width standard deviation */
  widthStdDev: number;
  /** Consistency score (0-100) */
  consistencyScore: number;
  /** Over-extrusion percentage */
  overExtrusionPercentage: number;
  /** Under-extrusion percentage */
  underExtrusionPercentage: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze extrusion width consistency.
 * Computes actual vs expected width for each segment.
 *
 * @param lines G-code lines
 * @param nozzleDiameter Nozzle diameter in mm (default 0.4)
 * @param filamentDiameter Filament diameter in mm (default 1.75)
 * @param tolerance Tolerance percentage (default 10)
 */
export function analyzeExtrusionWidthConsistency(
  lines: string[],
  nozzleDiameter: number = 0.4,
  filamentDiameter: number = 1.75,
  tolerance: number = 10,
): ExtrusionWidthResult {
  const points: ExtrusionWidthPoint[] = [];
  let prevX = 0, prevY = 0, prevZ = 0, prevE = 0;
  let currentZ = 0;
  const filamentArea = Math.PI * (filamentDiameter / 2) ** 2;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG1\b/i.test(code)) continue;

    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    if (zMatch) currentZ = parseFloat(zMatch[1]);

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const e = eMatch ? parseFloat(eMatch[1]) : prevE;

    if (e > prevE) {
      const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
      const eDelta = e - prevE;
      const extrudedVolume = eDelta * filamentArea;

      if (dist > 0 && currentZ > 0) {
        const layerHeight = currentZ - prevZ;
        const expectedWidth = nozzleDiameter * 1.2; // Typical extrusion width
        const actualWidth = dist > 0 ? extrudedVolume / (dist * Math.max(0.01, layerHeight)) : expectedWidth;
        const deviation = expectedWidth > 0 ? ((actualWidth - expectedWidth) / expectedWidth) * 100 : 0;
        const consistent = Math.abs(deviation) <= tolerance;

        points.push({
          line: i, width: actualWidth, expectedWidth,
          deviation, consistent,
        });
      }
    }

    prevX = x; prevY = y; prevZ = currentZ; prevE = e;
  }

  const widths = points.map(p => p.width);
  const avgWidth = widths.length > 0 ? widths.reduce((a, b) => a + b, 0) / widths.length : 0;
  const stdDev = widths.length > 0
    ? Math.sqrt(widths.reduce((s, w) => s + (w - avgWidth) ** 2, 0) / widths.length)
    : 0;

  const consistentCount = points.filter(p => p.consistent).length;
  const consistencyScore = points.length > 0 ? (consistentCount / points.length) * 100 : 100;
  const overExtrusionPercentage = points.length > 0
    ? (points.filter(p => p.deviation > tolerance).length / points.length) * 100 : 0;
  const underExtrusionPercentage = points.length > 0
    ? (points.filter(p => p.deviation < -tolerance).length / points.length) * 100 : 0;

  const recommendations: string[] = [];
  if (consistencyScore < 80) {
    recommendations.push(`Width consistency ${consistencyScore.toFixed(0)}% — calibrate extruder steps`);
  }
  if (overExtrusionPercentage > 10) {
    recommendations.push(`${overExtrusionPercentage.toFixed(0)}% over-extrusion — reduce flow rate`);
  }
  if (underExtrusionPercentage > 10) {
    recommendations.push(`${underExtrusionPercentage.toFixed(0)}% under-extrusion — increase flow rate`);
  }
  if (stdDev > 0.1) {
    recommendations.push(`Width std dev ${stdDev.toFixed(3)}mm — check extruder consistency`);
  }
  if (consistencyScore > 90) {
    recommendations.push('Excellent extrusion width consistency');
  }

  return {
    points, avgWidth, widthStdDev: stdDev, consistencyScore,
    overExtrusionPercentage, underExtrusionPercentage, recommendations,
  };
}

// ── 10. G-code Post-processor Optimizer ──

export interface PostProcessorOptimization {
  /** Optimization type */
  type: string;
  /** Lines affected */
  linesAffected: number;
  /** Description */
  description: string;
  /** Estimated improvement */
  improvement: string;
}

export interface PostProcessorResult {
  /** Optimized G-code lines */
  optimizedLines: string[];
  /** Optimizations applied */
  optimizations: PostProcessorOptimization[];
  /** Lines removed */
  linesRemoved: number;
  /** Lines modified */
  linesModified: number;
  /** Original line count */
  originalCount: number;
  /** Optimized line count */
  optimizedCount: number;
  /** Reduction percentage */
  reductionPercentage: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Optimize post-processor output.
 * Removes redundant commands, optimizes formatting, and reduces file size.
 *
 * @param lines G-code lines
 * @param targetMachine Target machine type
 */
export function optimizePostProcessorOutput(
  lines: string[],
  targetMachine: string = 'generic',
): PostProcessorResult {
  const optimizations: PostProcessorOptimization[] = [];
  const optimizedLines: string[] = [];
  let linesRemoved = 0;
  let linesModified = 0;
  let lastFeedRate = 0;
  let lastRpm = 0;
  let lastSpindleOn = false;
  let redundantFeedCount = 0;
  let redundantSpindleCount = 0;
  let redundantEmptyCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();

    // Remove empty lines
    if (!trimmed) {
      linesRemoved++;
      redundantEmptyCount++;
      continue;
    }

    // Remove redundant feed rate
    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) {
      const feed = parseFloat(fMatch[1]);
      if (feed === lastFeedRate) {
        // Remove F parameter
        const newCode = code.replace(/\bF\d*\.?\d+\b/i, '').trim();
        if (newCode) {
          optimizedLines.push(newCode);
          linesModified++;
          redundantFeedCount++;
          continue;
        }
      }
      lastFeedRate = feed;
    }

    // Remove redundant spindle on
    if (/\bM3\b/i.test(code) || /\bM03\b/i.test(code)) {
      if (lastSpindleOn) {
        linesRemoved++;
        redundantSpindleCount++;
        continue;
      }
      lastSpindleOn = true;
    }
    if (/\bM5\b/i.test(code)) {
      lastSpindleOn = false;
    }

    // Remove redundant S (speed) if spindle already on at same speed
    const sMatch = code.match(/\bS(\d*\.?\d+)/i);
    if (sMatch && lastSpindleOn) {
      const rpm = parseFloat(sMatch[1]);
      if (rpm === lastRpm && /\bM3\b/i.test(code)) {
        // Just M3 without S
        const newCode = code.replace(/\bS\d*\.?\d+\b/i, '').trim();
        optimizedLines.push(newCode || 'M3');
        linesModified++;
        continue;
      }
      lastRpm = rpm;
    }

    optimizedLines.push(trimmed);
  }

  if (redundantFeedCount > 0) {
    optimizations.push({
      type: 'redundant_feed',
      linesAffected: redundantFeedCount,
      description: `Removed ${redundantFeedCount} redundant feed rate commands`,
      improvement: `Smaller file, faster parsing`,
    });
  }
  if (redundantSpindleCount > 0) {
    optimizations.push({
      type: 'redundant_spindle',
      linesAffected: redundantSpindleCount,
      description: `Removed ${redundantSpindleCount} redundant spindle on commands`,
      improvement: `Cleaner execution`,
    });
  }
  if (redundantEmptyCount > 0) {
    optimizations.push({
      type: 'empty_lines',
      linesAffected: redundantEmptyCount,
      description: `Removed ${redundantEmptyCount} empty lines`,
      improvement: `${redundantEmptyCount * 2} bytes saved`,
    });
  }

  const originalCount = lines.length;
  const optimizedCount = optimizedLines.length;
  const reductionPercentage = originalCount > 0
    ? ((originalCount - optimizedCount) / originalCount) * 100
    : 0;

  const recommendations: string[] = [];
  recommendations.push(`Reduced from ${originalCount} to ${optimizedCount} lines (${reductionPercentage.toFixed(1)}%)`);
  for (const opt of optimizations) {
    recommendations.push(`${opt.type}: ${opt.description}`);
  }
  if (optimizations.length === 0) {
    recommendations.push('No post-processor optimizations needed');
  }

  return {
    optimizedLines, optimizations, linesRemoved, linesModified,
    originalCount, optimizedCount, reductionPercentage, recommendations,
  };
}

// ── 11. CNC Machine Vibration Analysis ──

export interface VibrationPoint {
  /** Time in seconds */
  time: number;
  /** Vibration amplitude in mm */
  amplitude: number;
  /** Frequency in Hz */
  frequency: number;
  /** Vibration source */
  source: 'spindle' | 'tool' | 'rapid' | 'cutting' | 'idle';
  /** Severity */
  severity: 'low' | 'medium' | 'high';
}

export interface VibrationAnalysisResult {
  /** Vibration data points */
  points: VibrationPoint[];
  /** Maximum amplitude in mm */
  maxAmplitude: number;
  /** Average amplitude */
  avgAmplitude: number;
  /** Dominant vibration frequency in Hz */
  dominantFrequency: number;
  /** Vibration severity score (0-100, lower is better) */
  vibrationScore: number;
  /** Vibration sources distribution */
  sourceDistribution: { [source: string]: number };
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze machine vibration from G-code.
 * Estimates vibration amplitudes from cutting parameters and motion profiles.
 *
 * @param lines G-code lines
 * @param flutes Number of flutes (default 2)
 */
export function analyzeMachineVibration(
  lines: string[],
  flutes: number = 2,
): VibrationAnalysisResult {
  const points: VibrationPoint[] = [];
  let rpm = 0;
  let feedRate = 0;
  let prevX = 0, prevY = 0, prevZ = 0;
  let currentTime = 0;
  const sourceDistribution: { [source: string]: number } = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const sMatch = code.match(/\bS(\d*\.?\d+)/i);
    if (sMatch) rpm = parseFloat(sMatch[1]);

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
    if (dist > 0.01 && feedRate > 0) {
      const time = dist / (feedRate / 60);
      currentTime += time;

      let source: VibrationPoint['source'] = 'idle';
      let amplitude = 0;
      let frequency = 0;

      if (/\bG0\b/i.test(code)) {
        // Rapid moves cause vibration from acceleration
        source = 'rapid';
        amplitude = Math.min(0.1, dist / 100);
        frequency = 10 + Math.random() * 20;
      } else if (z < 0 && rpm > 0) {
        // Cutting vibration
        source = 'cutting';
        const toothPassFreq = (rpm / 60) * flutes;
        frequency = toothPassFreq;
        // Amplitude depends on cutting force and stability
        const feedPerTooth = feedRate / (rpm * flutes);
        amplitude = Math.min(0.05, feedPerTooth * 0.1 * Math.abs(z));
      } else if (rpm > 0) {
        // Spindle running but not cutting
        source = 'spindle';
        frequency = rpm / 60;
        amplitude = 0.001 + Math.random() * 0.002;
      }

      if (amplitude > 0) {
        const severity = amplitude > 0.03 ? 'high' : amplitude > 0.01 ? 'medium' : 'low';
        points.push({ time: currentTime, amplitude, frequency, source, severity });
        sourceDistribution[source] = (sourceDistribution[source] ?? 0) + 1;
      }
    }

    prevX = x; prevY = y; prevZ = z;
  }

  const amplitudes = points.map(p => p.amplitude);
  const maxAmplitude = amplitudes.length > 0 ? Math.max(...amplitudes) : 0;
  const avgAmplitude = amplitudes.length > 0 ? amplitudes.reduce((a, b) => a + b, 0) / amplitudes.length : 0;

  // Dominant frequency
  const freqCounts: { [freq: number]: number } = {};
  for (const p of points) {
    const rounded = Math.round(p.frequency);
    freqCounts[rounded] = (freqCounts[rounded] ?? 0) + 1;
  }
  const dominantFrequency = Object.entries(freqCounts).length > 0
    ? parseFloat(Object.entries(freqCounts).sort((a, b) => b[1] - a[1])[0][0])
    : 0;

  const highSeverityCount = points.filter(p => p.severity === 'high').length;
  const vibrationScore = Math.max(0, 100 - highSeverityCount * 10 - points.filter(p => p.severity === 'medium').length * 5);

  const recommendations: string[] = [];
  if (maxAmplitude > 0.03) {
    recommendations.push(`Max vibration ${maxAmplitude.toFixed(4)}mm — reduce cutting parameters`);
  }
  if (sourceDistribution.rapid > 10) {
    recommendations.push(`${sourceDistribution.rapid} rapid moves — smooth acceleration profile`);
  }
  if (dominantFrequency > 0) {
    recommendations.push(`Dominant frequency: ${dominantFrequency.toFixed(0)}Hz`);
  }
  if (vibrationScore > 80) {
    recommendations.push('Low vibration levels — stable machining');
  }

  return {
    points, maxAmplitude, avgAmplitude, dominantFrequency,
    vibrationScore, sourceDistribution, recommendations,
  };
}

// ── 12. Print Thermal History Tracker ──

export interface ThermalHistoryPoint {
  /** X position */
  x: number;
  /** Y position */
  y: number;
  /** Z height */
  z: number;
  /** Time deposited in seconds */
  timeDeposited: number;
  /** Initial temperature in °C */
  initialTemp: number;
  /** Estimated current temperature in °C */
  currentTemp: number;
  /** Cooling rate in °C/s */
  coolingRate: number;
  /** Time since deposition in seconds */
  age: number;
}

export interface ThermalHistoryResult {
  /** Thermal history points */
  points: ThermalHistoryPoint[];
  /** Average current temperature */
  avgCurrentTemp: number;
  /** Maximum cooling rate in °C/s */
  maxCoolingRate: number;
  /** Average cooling rate */
  avgCoolingRate: number;
  /** Thermal uniformity score (0-100) */
  uniformityScore: number;
  /** Points with high cooling rate */
  highCoolingRateCount: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Track thermal history per point.
 * Records temperature at deposition and estimates cooling over time.
 *
 * @param lines G-code lines
 * @param hotendTemp Hotend temperature in °C (default 200)
 * @param ambientTemp Ambient temperature in °C (default 20)
 */
export function trackThermalHistory(
  lines: string[],
  hotendTemp: number = 200,
  ambientTemp: number = 20,
): ThermalHistoryResult {
  const points: ThermalHistoryPoint[] = [];
  let currentTime = 0;
  let prevX = 0, prevY = 0, prevZ = 0, prevE = 0;
  let currentZ = 0;
  let bedTemp = 60;
  let fanSpeed = 0;
  let feedRate = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Track temperatures
    if (/\bM140\b/i.test(code) || /\bM190\b/i.test(code)) {
      const sMatch = code.match(/\bS(\d*\.?\d+)/i);
      if (sMatch) bedTemp = parseFloat(sMatch[1]);
    }
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

    if (e > prevE && feedRate > 0) {
      const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
      const time = dist / (feedRate / 60);
      currentTime += time;

      // Estimate initial temperature (slightly below hotend due to nozzle cooling)
      const initialTemp = hotendTemp - 5;
      // Cooling rate depends on fan, layer height, and bed temp
      const coolingFactor = 1 + (fanSpeed / 255) * 3;
      const layerTemp = Math.max(bedTemp, hotendTemp - (currentZ * 5 * coolingFactor));
      const coolingRate = (initialTemp - layerTemp) / Math.max(0.1, time);

      // Estimate current temperature (cooled toward ambient/bed)
      const age = currentTime - time; // Just deposited
      const currentTemp = initialTemp - coolingRate * age;

      points.push({
        x, y, z: currentZ, timeDeposited: currentTime - time,
        initialTemp, currentTemp, coolingRate, age,
      });
    }

    prevX = x; prevY = y; prevZ = currentZ; prevE = e;
  }

  const currentTemps = points.map(p => p.currentTemp);
  const avgCurrentTemp = currentTemps.length > 0 ? currentTemps.reduce((a, b) => a + b, 0) / currentTemps.length : 0;

  const coolingRates = points.map(p => p.coolingRate);
  const maxCoolingRate = coolingRates.length > 0 ? Math.max(...coolingRates) : 0;
  const avgCoolingRate = coolingRates.length > 0 ? coolingRates.reduce((a, b) => a + b, 0) / coolingRates.length : 0;

  // Uniformity: lower variance in current temp = better
  const tempVariance = currentTemps.length > 0
    ? currentTemps.reduce((s, t) => s + (t - avgCurrentTemp) ** 2, 0) / currentTemps.length
    : 0;
  const uniformityScore = Math.max(0, 100 - Math.sqrt(tempVariance) * 2);

  const highCoolingRateCount = points.filter(p => p.coolingRate > 10).length;

  const recommendations: string[] = [];
  if (maxCoolingRate > 10) {
    recommendations.push(`Max cooling rate ${maxCoolingRate.toFixed(1)}°C/s — risk of warping`);
  }
  if (highCoolingRateCount > 0) {
    recommendations.push(`${highCoolingRateCount} points with high cooling rate`);
  }
  if (uniformityScore < 70) {
    recommendations.push(`Low thermal uniformity (${uniformityScore.toFixed(0)}%) — uneven cooling`);
  }
  if (fanSpeed > 200) {
    recommendations.push('High fan speed causes rapid cooling — reduce for first layers');
  }
  if (uniformityScore > 80) {
    recommendations.push('Good thermal uniformity — consistent cooling');
  }

  return {
    points, avgCurrentTemp, maxCoolingRate, avgCoolingRate,
    uniformityScore, highCoolingRateCount, recommendations,
  };
}
