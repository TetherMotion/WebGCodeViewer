/**
 * @file GcodeAdvanced9.ts
 * @brief Ninth batch of advanced G-code analysis features for CNC and 3D printing.
 *
 * This module provides 12 additional high-impact features:
 *  1. Toolpath self-intersection detection (Universal) — detect crossing toolpaths
 *  2. G-code command frequency analysis (Universal) — command usage statistics
 *  3. Tool change optimization (CNC) — minimize tool changes by reordering
 *  4. Print layer time analysis (3DP) — time per layer, identify problematic layers
 *  5. G-code comment extraction (Universal) — extract structured comments
 *  6. Toolpath length analysis (Universal) — cutting vs travel distance breakdown
 *  7. G-code M-code analysis (Universal) — analyze all M-code usage
 *  8. Spindle warmup analysis (CNC) — check for proper spindle warmup
 *  9. G-code feed rate histogram (Universal) — distribution of feed rates
 * 10. G-code safety zone analysis (Universal) — define and check safety zones
 * 11. Toolpath direction analysis (Universal) — predominant direction of cuts
 * 12. G-code parsing error recovery (Universal) — recover from syntax errors
 */

// ── 1. Toolpath Self-Intersection Detection ──

export interface SelfIntersection {
  /** First segment line number */
  line1: number;
  /** Second segment line number */
  line2: number;
  /** Intersection point */
  point: { x: number; y: number };
  /** Whether this is a rapid move intersection */
  isRapid: boolean;
  /** Severity */
  severity: 'warning' | 'error';
}

export interface SelfIntersectionResult {
  /** All intersections found */
  intersections: SelfIntersection[];
  /** Intersection count */
  count: number;
  /** Whether any cutting move intersections exist */
  hasCuttingIntersections: boolean;
  /** Whether any rapid move intersections exist */
  hasRapidIntersections: boolean;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Detect self-intersections in the toolpath.
 * Self-intersections can cause:
 * - CNC: gouging (cutting into already-machined surface)
 * - 3DP: crossing perimeters (stringing, collision)
 *
 * Uses segment-segment intersection test.
 *
 * @param lines G-code lines
 * @param zThreshold Only check segments at similar Z (within threshold)
 */
export function detectSelfIntersections(
  lines: string[],
  zThreshold: number = 0.5,
): SelfIntersectionResult {
  const intersections: SelfIntersection[] = [];
  const segments: {
    x1: number; y1: number; z1: number;
    x2: number; y2: number; z2: number;
    line: number; isRapid: boolean;
  }[] = [];

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

    const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
    if (dist > 0.1) {
      const isRapid = /\bG0\b/i.test(code);
      segments.push({
        x1: prevX, y1: prevY, z1: prevZ,
        x2: x, y2: y, z2: z,
        line: i, isRapid,
      });
    }

    prevX = x; prevY = y; prevZ = z;
  }

  // Check all segment pairs (O(n²) — limited to reasonable sizes)
  const maxSegments = Math.min(segments.length, 500);
  for (let i = 0; i < maxSegments; i++) {
    for (let j = i + 2; j < maxSegments; j++) {
      const s1 = segments[i];
      const s2 = segments[j];

      // Skip if Z values are too different
      if (Math.abs(s1.z1 - s2.z1) > zThreshold && Math.abs(s1.z2 - s2.z2) > zThreshold) continue;

      // Segment-segment intersection test
      const intersection = segmentIntersection(
        s1.x1, s1.y1, s1.x2, s1.y2,
        s2.x1, s2.y1, s2.x2, s2.y2,
      );

      if (intersection) {
        const isRapid = s1.isRapid || s2.isRapid;
        intersections.push({
          line1: s1.line, line2: s2.line,
          point: intersection, isRapid,
          severity: isRapid ? 'warning' : 'error',
        });
      }
    }
  }

  const hasCuttingIntersections = intersections.some(i => !i.isRapid);
  const hasRapidIntersections = intersections.some(i => i.isRapid);

  const recommendations: string[] = [];
  if (intersections.filter(i => !i.isRapid).length > 0) {
    recommendations.push(`${intersections.filter(i => !i.isRapid).length} cutting move self-intersections — check for gouging`);
  }
  if (hasRapidIntersections) {
    recommendations.push('Rapid move intersections detected — verify safe Z clearance');
  }
  if (recommendations.length === 0) {
    recommendations.push('No self-intersections detected');
  }

  return {
    intersections, count: intersections.length,
    hasCuttingIntersections, hasRapidIntersections,
    recommendations,
  };
}

function segmentIntersection(
  x1: number, y1: number, x2: number, y2: number,
  x3: number, y3: number, x4: number, y4: number,
): { x: number; y: number } | null {
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-10) return null; // parallel

  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;

  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return {
      x: x1 + t * (x2 - x1),
      y: y1 + t * (y2 - y1),
    };
  }
  return null;
}

// ── 2. G-code Command Frequency Analysis ──

export interface CommandFrequency {
  /** Command (e.g., G1, M3, G0) */
  command: string;
  /** Occurrence count */
  count: number;
  /** Percentage of total commands */
  percentage: number;
  /** Category */
  category: 'motion' | 'spindle' | 'coolant' | 'tool' | 'misc' | 'modal' | 'cycle';
}

export interface CommandFrequencyResult {
  /** Command frequencies sorted by count */
  frequencies: CommandFrequency[];
  /** Total command count */
  totalCommands: number;
  /** Unique commands */
  uniqueCommands: number;
  /** Most common command */
  mostCommon: string;
  /** Category breakdown */
  byCategory: { [category: string]: number };
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze command frequency in G-code.
 * Provides statistics on which commands are used most frequently.
 *
 * @param lines G-code lines
 */
export function analyzeCommandFrequency(lines: string[]): CommandFrequencyResult {
  const counts = new Map<string, number>();
  let totalCommands = 0;

  const categorize = (cmd: string): CommandFrequency['category'] => {
    if (/^G[0-3]$/.test(cmd)) return 'motion';
    if (/^G8[1-9]$/.test(cmd)) return 'cycle';
    if (/^G(?:17|18|19|20|21|90|91|94|95|40|41|42|43|49|54|55|56|57|58|59|28|29|30)$/.test(cmd)) return 'modal';
    if (/^M[345]$/.test(cmd)) return 'spindle';
    if (/^M[789]$/.test(cmd)) return 'coolant';
    if (/^M[06]$/i.test(cmd) || /^T\d+$/i.test(cmd)) return 'tool';
    return 'misc';
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Extract all G and M codes
    const matches = code.matchAll(/\b([GM])(\d+)\b/gi);
    for (const match of matches) {
      const cmd = `${match[1].toUpperCase()}${parseInt(match[2])}`;
      counts.set(cmd, (counts.get(cmd) ?? 0) + 1);
      totalCommands++;
    }

    // Extract T codes
    const tMatches = code.matchAll(/\bT(\d+)\b/gi);
    for (const match of tMatches) {
      const cmd = `T${parseInt(match[1])}`;
      counts.set(cmd, (counts.get(cmd) ?? 0) + 1);
      totalCommands++;
    }
  }

  const frequencies: CommandFrequency[] = Array.from(counts.entries())
    .map(([command, count]) => ({
      command, count,
      percentage: totalCommands > 0 ? (count / totalCommands) * 100 : 0,
      category: categorize(command),
    }))
    .sort((a, b) => b.count - a.count);

  const byCategory: { [category: string]: number } = {};
  for (const f of frequencies) {
    byCategory[f.category] = (byCategory[f.category] ?? 0) + f.count;
  }

  const mostCommon = frequencies.length > 0 ? frequencies[0].command : '';

  const recommendations: string[] = [];
  if (frequencies.find(f => f.command === 'G0' && f.percentage > 50)) {
    recommendations.push('High percentage of rapid moves — optimize travel paths');
  }
  if (frequencies.find(f => f.command.startsWith('M6') && f.count > 10)) {
    recommendations.push(`${frequencies.find(f => f.command === 'M6')?.count} tool changes — consider reducing`);
  }
  if (frequencies.find(f => f.command === 'G4' && f.count > 20)) {
    recommendations.push('Many dwell commands — review if all are necessary');
  }
  if (recommendations.length === 0) {
    recommendations.push('Command distribution appears normal');
  }

  return {
    frequencies, totalCommands, uniqueCommands: counts.size,
    mostCommon, byCategory, recommendations,
  };
}

// ── 3. Tool Change Optimization ──

export interface ToolGroup {
  /** Tool number */
  toolNumber: number;
  /** Start line */
  startLine: number;
  /** End line */
  endLine: number;
  /** Operation count */
  operationCount: number;
  /** Estimated time in seconds */
  estimatedTime: number;
}

export interface ToolChangeResult {
  /** Current tool groups (sequential) */
  currentGroups: ToolGroup[];
  /** Current tool change count */
  currentChanges: number;
  /** Optimized tool change count (if reordered) */
  optimizedChanges: number;
  /** Tool change savings */
  changeSavings: number;
  /** Time cost of tool changes in seconds */
  toolChangeTime: number;
  /** Per-tool usage */
  toolUsage: { tool: number; groups: number; totalTime: number }[];
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze and optimize tool change sequences.
 * Tool changes are expensive — minimizing them by grouping operations
 * by tool can significantly reduce cycle time.
 *
 * @param lines G-code lines
 * @param toolChangeTimeSec Time per tool change in seconds (default 30)
 */
export function optimizeToolChanges(
  lines: string[],
  toolChangeTimeSec: number = 30,
): ToolChangeResult {
  const currentGroups: ToolGroup[] = [];
  let currentTool = 0;
  let groupStart = 0;
  let groupOps = 0;
  let groupDist = 0;
  let currentFeedRate = 0;
  let prevX = 0, prevY = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const tMatch = code.match(/\bT(\d+)\b/i);
    const m6Match = /\bM6\b/i.test(code) || /\bM06\b/i.test(code);

    if (tMatch && m6Match) {
      const newTool = parseInt(tMatch[1]);
      // Finalize current group
      if (groupOps > 0) {
        currentGroups.push({
          toolNumber: currentTool, startLine: groupStart, endLine: i - 1,
          operationCount: groupOps,
          estimatedTime: currentFeedRate > 0 ? groupDist / (currentFeedRate / 60) : 0,
        });
      }
      currentTool = newTool;
      groupStart = i;
      groupOps = 0;
      groupDist = 0;
      continue;
    }

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) currentFeedRate = parseFloat(fMatch[1]);

    if (/\bG[01]\b/i.test(code)) {
      const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
      const x = xMatch ? parseFloat(xMatch[1]) : prevX;
      const y = yMatch ? parseFloat(yMatch[1]) : prevY;
      groupDist += Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
      groupOps++;
      prevX = x; prevY = y;
    }
  }

  // Finalize last group
  if (groupOps > 0) {
    currentGroups.push({
      toolNumber: currentTool, startLine: groupStart, endLine: lines.length - 1,
      operationCount: groupOps,
      estimatedTime: currentFeedRate > 0 ? groupDist / (currentFeedRate / 60) : 0,
    });
  }

  // Count current changes (sequential groups with different tools)
  let currentChanges = 0;
  for (let i = 1; i < currentGroups.length; i++) {
    if (currentGroups[i].toolNumber !== currentGroups[i - 1].toolNumber) {
      currentChanges++;
    }
  }

  // Optimized: group all operations by tool
  const toolGroups = new Map<number, ToolGroup[]>();
  for (const group of currentGroups) {
    const groups = toolGroups.get(group.toolNumber) ?? [];
    groups.push(group);
    toolGroups.set(group.toolNumber, groups);
  }

  // Optimized changes = number of unique tools - 1
  const optimizedChanges = Math.max(0, toolGroups.size - 1);
  const changeSavings = currentChanges - optimizedChanges;
  const toolChangeTime = currentChanges * toolChangeTimeSec;

  // Per-tool usage
  const toolUsage: { tool: number; groups: number; totalTime: number }[] = [];
  for (const [tool, groups] of toolGroups) {
    toolUsage.push({
      tool,
      groups: groups.length,
      totalTime: groups.reduce((sum, g) => sum + g.estimatedTime, 0),
    });
  }
  toolUsage.sort((a, b) => b.totalTime - a.totalTime);

  const recommendations: string[] = [];
  if (changeSavings > 2) {
    recommendations.push(`Reordering operations could save ${changeSavings} tool changes (${(changeSavings * toolChangeTimeSec / 60).toFixed(1)} min)`);
  }
  if (currentChanges > 10) {
    recommendations.push(`${currentChanges} tool changes — consider grouping operations by tool`);
  }
  if (toolUsage.length > 5) {
    recommendations.push(`${toolUsage.length} different tools used — verify all are necessary`);
  }
  if (recommendations.length === 0) {
    recommendations.push('Tool change sequence is already optimized');
  }

  return {
    currentGroups, currentChanges, optimizedChanges,
    changeSavings, toolChangeTime, toolUsage, recommendations,
  };
}

// ── 4. Print Layer Time Analysis ──

export interface LayerTimeInfo {
  /** Layer index */
  layer: number;
  /** Z height */
  zHeight: number;
  /** Time in seconds */
  time: number;
  /** Is this layer too fast? */
  tooFast: boolean;
  /** Is this layer too slow? */
  tooSlow: boolean;
  /** Recommendation */
  recommendation: string;
}

export interface LayerTimeResult {
  /** Per-layer time data */
  layers: LayerTimeInfo[];
  /** Total print time in seconds */
  totalTime: number;
  /** Average layer time in seconds */
  avgLayerTime: number;
  /** Minimum layer time in seconds */
  minLayerTime: number;
  /** Maximum layer time in seconds */
  maxLayerTime: number;
  /** Number of layers that are too fast */
  fastLayerCount: number;
  /** Number of layers that are too slow */
  slowLayerCount: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze time per layer in 3D printing.
 * Identifies layers that are too fast (quality issues) or too slow (stringing).
 *
 * @param lines G-code lines
 * @param minLayerTimeSec Minimum recommended layer time in seconds (default 5)
 * @param maxLayerTimeSec Maximum recommended layer time in seconds (default 600)
 */
export function analyzeLayerTimes(
  lines: string[],
  minLayerTimeSec: number = 5,
  maxLayerTimeSec: number = 600,
): LayerTimeResult {
  const layers: LayerTimeInfo[] = [];
  let currentFeedRate = 0;
  let layerStartLine = 0;
  let layerIndex = -1;
  let layerDist = 0;
  let prevX = 0, prevY = 0;

  const finalizeLayer = (endLine: number) => {
    if (layerIndex >= 0) {
      const time = currentFeedRate > 0 ? layerDist / (currentFeedRate / 60) : 0;
      const tooFast = time < minLayerTimeSec && time > 0;
      const tooSlow = time > maxLayerTimeSec;

      let recommendation = '';
      if (tooFast) recommendation = `Layer too fast (${time.toFixed(1)}s) — slow down for cooling`;
      else if (tooSlow) recommendation = `Layer very slow (${time.toFixed(1)}s) — check for issues`;
      else recommendation = 'Layer time is acceptable';

      layers.push({
        layer: layerIndex,
        zHeight: 0, // Would need Z tracking
        time,
        tooFast, tooSlow,
        recommendation,
      });
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Detect layer change
    if (/;.*layer/i.test(line) || /;.*LAYER/i.test(line)) {
      finalizeLayer(i);
      layerIndex++;
      layerStartLine = i;
      layerDist = 0;
      continue;
    }

    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG1\b/i.test(code)) continue;

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) currentFeedRate = parseFloat(fMatch[1]);

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;

    layerDist += Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
    prevX = x; prevY = y;
  }

  finalizeLayer(lines.length - 1);

  const totalTime = layers.reduce((sum, l) => sum + l.time, 0);
  const avgLayerTime = layers.length > 0 ? totalTime / layers.length : 0;
  const minLayerTime = layers.length > 0 ? Math.min(...layers.map(l => l.time).filter(t => t > 0)) : 0;
  const maxLayerTime = layers.length > 0 ? Math.max(...layers.map(l => l.time)) : 0;
  const fastLayerCount = layers.filter(l => l.tooFast).length;
  const slowLayerCount = layers.filter(l => l.tooSlow).length;

  const recommendations: string[] = [];
  if (fastLayerCount > 5) {
    recommendations.push(`${fastLayerCount} layers are too fast — enable minimum layer time in slicer`);
  }
  if (slowLayerCount > 0) {
    recommendations.push(`${slowLayerCount} layers are very slow — check for sparse infill or issues`);
  }
  if (minLayerTime > 0 && minLayerTime < 2) {
    recommendations.push(`Minimum layer time is ${minLayerTime.toFixed(1)}s — may cause cooling issues`);
  }
  if (recommendations.length === 0 && layers.length > 0) {
    recommendations.push('Layer times are within acceptable range');
  }

  return {
    layers, totalTime, avgLayerTime, minLayerTime, maxLayerTime,
    fastLayerCount, slowLayerCount, recommendations,
  };
}

// ── 5. G-code Comment Extraction ──

export interface GcodeComment {
  /** Line number */
  lineNumber: number;
  /** Comment text */
  text: string;
  /** Comment type */
  type: 'inline' | 'parenthesis' | 'full_line';
  /** Parsed key-value pair (if applicable) */
  parsed?: { key: string; value: string };
}

export interface CommentExtractionResult {
  /** All comments */
  comments: GcodeComment[];
  /** Total comment count */
  count: number;
  /** Parsed key-value pairs */
  parsedMetadata: { [key: string]: string };
  /** Comments by category */
  byCategory: { [category: string]: number };
  /** Recommendations */
  recommendations: string[];
}

/**
 * Extract and parse comments from G-code.
 * Comments can contain useful metadata like:
 * ; PRINT TIME: 2:30:00
 * ; FILAMENT: PLA
 * ; LAYER: 42
 *
 * @param lines G-code lines
 */
export function extractComments(lines: string[]): CommentExtractionResult {
  const comments: GcodeComment[] = [];
  const parsedMetadata: { [key: string]: string } = {};
  const byCategory: { [category: string]: number } = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Full-line comment
    const fullLineMatch = line.match(/^\s*;\s*(.+)$/);
    if (fullLineMatch) {
      const text = fullLineMatch[1].trim();
      const parsed = parseCommentKeyValue(text);
      comments.push({ lineNumber: i, text, type: 'full_line', parsed });
      if (parsed) parsedMetadata[parsed.key] = parsed.value;
      const cat = categorizeComment(text);
      byCategory[cat] = (byCategory[cat] ?? 0) + 1;
      continue;
    }

    // Parenthesis comment
    const parenMatch = line.match(/\(([^)]+)\)/);
    if (parenMatch) {
      const text = parenMatch[1].trim();
      comments.push({ lineNumber: i, text, type: 'parenthesis' });
      const cat = categorizeComment(text);
      byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    }

    // Inline comment
    const inlineMatch = line.match(/;\s*(.+)$/);
    if (inlineMatch) {
      const text = inlineMatch[1].trim();
      const parsed = parseCommentKeyValue(text);
      comments.push({ lineNumber: i, text, type: 'inline', parsed });
      if (parsed && !parsedMetadata[parsed.key]) parsedMetadata[parsed.key] = parsed.value;
      const cat = categorizeComment(text);
      byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    }
  }

  const recommendations: string[] = [];
  if (parsedMetadata['PRINT TIME'] || parsedMetadata['print_time']) {
    recommendations.push(`Slicer-estimated print time: ${parsedMetadata['PRINT TIME'] ?? parsedMetadata['print_time']}`);
  }
  if (parsedMetadata['FILAMENT'] || parsedMetadata['filament']) {
    recommendations.push(`Material: ${parsedMetadata['FILAMENT'] ?? parsedMetadata['filament']}`);
  }
  if (comments.length === 0) {
    recommendations.push('No comments found — add comments for better traceability');
  }
  if (byCategory['layer'] > 0) {
    recommendations.push(`${byCategory['layer']} layer markers found`);
  }

  return {
    comments, count: comments.length,
    parsedMetadata, byCategory, recommendations,
  };
}

function parseCommentKeyValue(text: string): { key: string; value: string } | undefined {
  // Match patterns like "KEY: VALUE" or "KEY = VALUE"
  const match = text.match(/^([A-Z_][A-Z_\s]*?)\s*[:=]\s*(.+)$/i);
  if (match) {
    return { key: match[1].trim().toUpperCase(), value: match[2].trim() };
  }
  return undefined;
}

function categorizeComment(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('layer')) return 'layer';
  if (lower.includes('time')) return 'time';
  if (lower.includes('filament') || lower.includes('material')) return 'material';
  if (lower.includes('tool')) return 'tool';
  if (lower.includes('begin') || lower.includes('end')) return 'section';
  if (lower.includes('width') || lower.includes('height') || lower.includes('speed')) return 'parameter';
  return 'other';
}

// ── 6. Toolpath Length Analysis ──

export interface ToolpathLengthResult {
  /** Total cutting distance in mm */
  cuttingDistance: number;
  /** Total travel (rapid) distance in mm */
  travelDistance: number;
  /** Total arc distance in mm */
  arcDistance: number;
  /** Total distance in mm */
  totalDistance: number;
  /** Cutting percentage */
  cuttingPercentage: number;
  /** Travel percentage */
  travelPercentage: number;
  /** Estimated cutting time in seconds */
  cuttingTime: number;
  /** Estimated travel time in seconds */
  travelTime: number;
  /** Ratio of cutting to travel */
  efficiencyRatio: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze toolpath length breakdown.
 * Separates cutting moves (G1 with extrusion/CNC cutting) from travel moves (G0).
 *
 * @param lines G-code lines
 */
export function analyzeToolpathLength(lines: string[]): ToolpathLengthResult {
  let cuttingDistance = 0;
  let travelDistance = 0;
  let arcDistance = 0;
  let cuttingTime = 0;
  let travelTime = 0;
  let prevX = 0, prevY = 0, prevZ = 0, prevE = 0;
  let currentFeedRate = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) currentFeedRate = parseFloat(fMatch[1]);

    if (!/\bG[0-3]\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const z = zMatch ? parseFloat(zMatch[1]) : prevZ;

    const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2 + (z - prevZ) ** 2);

    if (dist > 0) {
      const isRapid = /\bG0\b/i.test(code);
      const isArc = /\bG[23]\b/i.test(code);
      const isExtruding = eMatch ? parseFloat(eMatch[1]) > prevE : false;

      if (isArc) {
        arcDistance += dist;
      } else if (isRapid) {
        travelDistance += dist;
        if (currentFeedRate > 0) travelTime += dist / (currentFeedRate / 60);
      } else if (isExtruding || (!isRapid && !eMatch && z < 0)) {
        // Cutting move (3DP extrusion or CNC Z<0)
        cuttingDistance += dist;
        if (currentFeedRate > 0) cuttingTime += dist / (currentFeedRate / 60);
      } else {
        // Non-cutting feed move
        travelDistance += dist;
        if (currentFeedRate > 0) travelTime += dist / (currentFeedRate / 60);
      }
    }

    if (eMatch) prevE = parseFloat(eMatch[1]);
    prevX = x; prevY = y; prevZ = z;
  }

  const totalDistance = cuttingDistance + travelDistance + arcDistance;
  const cuttingPercentage = totalDistance > 0 ? (cuttingDistance / totalDistance) * 100 : 0;
  const travelPercentage = totalDistance > 0 ? (travelDistance / totalDistance) * 100 : 0;
  const efficiencyRatio = travelDistance > 0 ? cuttingDistance / travelDistance : 0;

  const recommendations: string[] = [];
  if (travelPercentage > 50) {
    recommendations.push(`Travel moves are ${travelPercentage.toFixed(1)}% of total — optimize travel paths`);
  }
  if (efficiencyRatio < 1 && totalDistance > 100) {
    recommendations.push('Low cutting-to-travel ratio — consider reordering operations');
  }
  if (arcDistance > 0) {
    recommendations.push(`${arcDistance.toFixed(1)}mm of arc moves detected`);
  }
  if (recommendations.length === 0) {
    recommendations.push('Toolpath length distribution is reasonable');
  }

  return {
    cuttingDistance, travelDistance, arcDistance, totalDistance,
    cuttingPercentage, travelPercentage,
    cuttingTime, travelTime, efficiencyRatio,
    recommendations,
  };
}

// ── 7. G-code M-code Analysis ──

export interface MCodeInfo {
  /** M-code (e.g., M3, M104) */
  code: string;
  /** Description */
  description: string;
  /** Occurrence count */
  count: number;
  /** Line numbers where used */
  lineNumbers: number[];
  /** Whether this M-code is standard */
  isStandard: boolean;
  /** Category */
  category: 'spindle' | 'coolant' | 'tool' | 'program' | 'auxiliary' | 'heater' | 'fan' | 'other';
}

export interface MCodeAnalysisResult {
  /** All M-codes found */
  codes: MCodeInfo[];
  /** Total M-code count */
  totalCount: number;
  /** Unique M-codes */
  uniqueCount: number;
  /** Non-standard M-codes */
  nonStandardCount: number;
  /** Whether spindle is controlled */
  hasSpindleControl: boolean;
  /** Whether coolant is controlled */
  hasCoolantControl: boolean;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze all M-code usage in G-code.
 * M-codes control machine functions like spindle, coolant, tool changes, etc.
 *
 * @param lines G-code lines
 */
export function analyzeMCodes(lines: string[]): MCodeAnalysisResult {
  const codeMap = new Map<string, MCodeInfo>();
  let totalCount = 0;

  // Standard M-codes
  const standardCodes: { [code: string]: { description: string; category: MCodeInfo['category'] } } = {
    'M0': { description: 'Program stop', category: 'program' },
    'M1': { description: 'Optional stop', category: 'program' },
    'M2': { description: 'Program end', category: 'program' },
    'M3': { description: 'Spindle on (CW)', category: 'spindle' },
    'M4': { description: 'Spindle on (CCW)', category: 'spindle' },
    'M5': { description: 'Spindle off', category: 'spindle' },
    'M6': { description: 'Tool change', category: 'tool' },
    'M7': { description: 'Mist coolant on', category: 'coolant' },
    'M8': { description: 'Flood coolant on', category: 'coolant' },
    'M9': { description: 'Coolant off', category: 'coolant' },
    'M30': { description: 'Program end and reset', category: 'program' },
    'M98': { description: 'Subprogram call', category: 'program' },
    'M99': { description: 'Subprogram return', category: 'program' },
    'M104': { description: 'Set hotend temperature', category: 'heater' },
    'M105': { description: 'Report temperatures', category: 'heater' },
    'M106': { description: 'Fan on', category: 'fan' },
    'M107': { description: 'Fan off', category: 'fan' },
    'M109': { description: 'Wait for hotend temperature', category: 'heater' },
    'M140': { description: 'Set bed temperature', category: 'heater' },
    'M190': { description: 'Wait for bed temperature', category: 'heater' },
    'M84': { description: 'Disable motors', category: 'auxiliary' },
    'M92': { description: 'Set axis steps per unit', category: 'auxiliary' },
    'M203': { description: 'Set max feedrate', category: 'auxiliary' },
    'M204': { description: 'Set acceleration', category: 'auxiliary' },
    'M205': { description: 'Set advanced motion', category: 'auxiliary' },
    'M220': { description: 'Set speed factor', category: 'auxiliary' },
    'M221': { description: 'Set extrude factor', category: 'auxiliary' },
    'M500': { description: 'Save settings', category: 'auxiliary' },
    'M503': { description: 'Report settings', category: 'auxiliary' },
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const matches = code.matchAll(/\bM(\d+)\b/gi);
    for (const match of matches) {
      const mCode = `M${parseInt(match[1])}`;
      totalCount++;

      const existing = codeMap.get(mCode);
      if (existing) {
        existing.count++;
        existing.lineNumbers.push(i);
      } else {
        const standard = standardCodes[mCode];
        codeMap.set(mCode, {
          code: mCode,
          description: standard?.description ?? `Unknown M-code ${mCode}`,
          count: 1,
          lineNumbers: [i],
          isStandard: !!standard,
          category: standard?.category ?? 'other',
        });
      }
    }
  }

  const codes = Array.from(codeMap.values()).sort((a, b) => b.count - a.count);
  const nonStandardCount = codes.filter(c => !c.isStandard).length;
  const hasSpindleControl = codes.some(c => c.category === 'spindle');
  const hasCoolantControl = codes.some(c => c.category === 'coolant');

  const recommendations: string[] = [];
  if (nonStandardCount > 0) {
    recommendations.push(`${nonStandardCount} non-standard M-codes — verify controller compatibility`);
  }
  if (!hasSpindleControl && codes.length > 0) {
    recommendations.push('No spindle control M-codes — verify spindle is controlled externally');
  }
  if (!hasCoolantControl && codes.some(c => c.category === 'spindle')) {
    recommendations.push('No coolant control — consider adding M8/M9 for CNC operations');
  }
  const toolChanges = codes.find(c => c.code === 'M6');
  if (toolChanges && toolChanges.count > 10) {
    recommendations.push(`${toolChanges.count} tool changes — consider optimizing tool order`);
  }
  if (recommendations.length === 0) {
    recommendations.push('M-code usage appears standard and correct');
  }

  return {
    codes, totalCount, uniqueCount: codes.length,
    nonStandardCount, hasSpindleControl, hasCoolantControl,
    recommendations,
  };
}

// ── 8. Spindle Warmup Analysis ──

export interface SpindleWarmupResult {
  /** Whether a warmup routine is present */
  hasWarmup: boolean;
  /** Warmup start line */
  startLine: number;
  /** Warmup end line */
  endLine: number;
  /** Warmup duration in seconds */
  duration: number;
  /** Starting RPM */
  startRpm: number;
  /** Ending RPM */
  endRpm: number;
  /** Whether warmup is progressive (speed ramp) */
  isProgressive: boolean;
  /** Number of speed steps */
  speedSteps: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Check for proper spindle warmup routine in CNC G-code.
 * Spindle warmup is important for:
 * - Bearing lubrication distribution
 * - Thermal stability
 * - Prolonged spindle life
 *
 * A proper warmup gradually increases RPM over several minutes.
 *
 * @param lines G-code lines
 * @param minWarmupDuration Minimum warmup duration in seconds (default 60)
 */
export function analyzeSpindleWarmup(
  lines: string[],
  minWarmupDuration: number = 60,
): SpindleWarmupResult {
  let hasWarmup = false;
  let startLine = -1;
  let endLine = -1;
  let duration = 0;
  let startRpm = 0;
  let endRpm = 0;
  const rpmSteps: { rpm: number; line: number }[] = [];
  let currentRpm = 0;
  let warmupActive = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Check for warmup start/end in comments (before skipping)
    if (/warm.?up/i.test(line) && !warmupActive) {
      warmupActive = true;
      startLine = i;
      continue;
    }
    if (warmupActive && /end.?warm/i.test(line)) {
      endLine = i;
      endRpm = currentRpm;
      hasWarmup = true;
      warmupActive = false;
      continue;
    }

    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Track spindle speed
    const sMatch = code.match(/\bS(\d*\.?\d+)/i);
    if (sMatch && /\bM[034]\b/i.test(code)) {
      currentRpm = parseFloat(sMatch[1]);

      if (warmupActive) {
        if (startRpm === 0) startRpm = currentRpm;
        rpmSteps.push({ rpm: currentRpm, line: i });
      }
    }

    // Check for dwell during warmup
    if (warmupActive && /\bG4\b/i.test(code)) {
      const pMatch = code.match(/\bP(\d*\.?\d+)/i);
      const xMatch = code.match(/\bX(\d*\.?\d+)/i);
      const dwell = pMatch ? parseFloat(pMatch[1]) : (xMatch ? parseFloat(xMatch[1]) : 0);
      duration += dwell;
    }

    // Check for end of warmup (first cutting move after warmup)
    if (warmupActive && /\bG1\b/i.test(code) && rpmSteps.length > 0 && !sMatch) {
      endLine = i;
      endRpm = currentRpm;
      hasWarmup = true;
      warmupActive = false;
    }
  }

  // If warmup was active but never ended, use last position
  if (warmupActive && rpmSteps.length > 0) {
    endLine = lines.length - 1;
    endRpm = rpmSteps[rpmSteps.length - 1].rpm;
    hasWarmup = true;
  }

  // Check if progressive (multiple increasing speed steps)
  const isProgressive = rpmSteps.length >= 2 &&
    rpmSteps.every((step, idx) => idx === 0 || step.rpm >= rpmSteps[idx - 1].rpm);
  const speedSteps = rpmSteps.length;

  const recommendations: string[] = [];
  if (!hasWarmup) {
    recommendations.push('No spindle warmup routine detected — add warmup for bearing longevity');
  }
  if (hasWarmup && duration < minWarmupDuration) {
    recommendations.push(`Warmup duration (${duration}s) is less than recommended (${minWarmupDuration}s)`);
  }
  if (hasWarmup && !isProgressive) {
    recommendations.push('Warmup is not progressive — gradually increase RPM for better results');
  }
  if (hasWarmup && speedSteps < 3) {
    recommendations.push(`Only ${speedSteps} speed steps — use at least 3 steps for proper warmup`);
  }
  if (hasWarmup && isProgressive && duration >= minWarmupDuration) {
    recommendations.push('Spindle warmup routine is adequate');
  }

  return {
    hasWarmup, startLine, endLine, duration,
    startRpm, endRpm, isProgressive, speedSteps,
    recommendations,
  };
}

// ── 9. G-code Feed Rate Histogram ──

export interface FeedRateBucket {
  /** Feed rate range minimum */
  min: number;
  /** Feed rate range maximum */
  max: number;
  /** Number of moves in this range */
  count: number;
  /** Percentage of total moves */
  percentage: number;
  /** Total distance in this range in mm */
  distance: number;
}

export interface FeedRateHistogramResult {
  /** Feed rate buckets */
  buckets: FeedRateBucket[];
  /** Total moves analyzed */
  totalMoves: number;
  /** Minimum feed rate used */
  minFeedRate: number;
  /** Maximum feed rate used */
  maxFeedRate: number;
  /** Average feed rate */
  avgFeedRate: number;
  /** Median feed rate */
  medianFeedRate: number;
  /** Most common feed rate range */
  mostCommonRange: string;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Generate a histogram of feed rates used in G-code.
 * Shows the distribution of feed rates to identify optimization opportunities.
 *
 * @param lines G-code lines
 * @param bucketCount Number of histogram buckets (default 10)
 */
export function generateFeedRateHistogram(
  lines: string[],
  bucketCount: number = 10,
): FeedRateHistogramResult {
  const feedRates: { rate: number; distance: number }[] = [];
  let prevX = 0, prevY = 0, prevZ = 0;
  let currentFeedRate = 0;

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

    const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2 + (z - prevZ) ** 2);

    if (dist > 0.1 && currentFeedRate > 0) {
      feedRates.push({ rate: currentFeedRate, distance: dist });
    }

    prevX = x; prevY = y; prevZ = z;
  }

  if (feedRates.length === 0) {
    return {
      buckets: [], totalMoves: 0, minFeedRate: 0, maxFeedRate: 0,
      avgFeedRate: 0, medianFeedRate: 0, mostCommonRange: 'N/A',
      recommendations: ['No feed rate data found'],
    };
  }

  const rates = feedRates.map(f => f.rate);
  const minRate = Math.min(...rates);
  const maxRate = Math.max(...rates);
  const avgRate = rates.reduce((a, b) => a + b, 0) / rates.length;

  // Sort for median
  const sortedRates = [...rates].sort((a, b) => a - b);
  const median = sortedRates.length % 2 === 0
    ? (sortedRates[sortedRates.length / 2 - 1] + sortedRates[sortedRates.length / 2]) / 2
    : sortedRates[Math.floor(sortedRates.length / 2)];

  // Create buckets
  const bucketSize = (maxRate - minRate) / bucketCount;
  const buckets: FeedRateBucket[] = [];

  for (let i = 0; i < bucketCount; i++) {
    const min = minRate + i * bucketSize;
    const max = minRate + (i + 1) * bucketSize;
    const inBucket = feedRates.filter(f =>
      (i === 0 ? f.rate >= min : f.rate > min - bucketSize * 0.001) && f.rate <= max
    );
    buckets.push({
      min, max,
      count: inBucket.length,
      percentage: feedRates.length > 0 ? (inBucket.length / feedRates.length) * 100 : 0,
      distance: inBucket.reduce((sum, f) => sum + f.distance, 0),
    });
  }

  const mostCommonBucket = buckets.reduce((max, b) => b.count > max.count ? b : max, buckets[0]);
  const mostCommonRange = `${mostCommonBucket.min.toFixed(0)}-${mostCommonBucket.max.toFixed(0)}`;

  const recommendations: string[] = [];
  if (mostCommonBucket.percentage > 60) {
    recommendations.push(`${mostCommonBucket.percentage.toFixed(0)}% of moves at ${mostCommonRange} mm/min — consider varying feed rates`);
  }
  if (maxRate > minRate * 10) {
    recommendations.push(`Large feed rate range (${minRate.toFixed(0)}-${maxRate.toFixed(0)}) — verify all are intentional`);
  }
  if (avgRate < minRate * 1.5) {
    recommendations.push('Feed rates are clustered at the low end — could increase for efficiency');
  }
  if (recommendations.length === 0) {
    recommendations.push('Feed rate distribution appears reasonable');
  }

  return {
    buckets, totalMoves: feedRates.length,
    minFeedRate: minRate, maxFeedRate: maxRate,
    avgFeedRate: avgRate, medianFeedRate: median,
    mostCommonRange, recommendations,
  };
}

// ── 10. G-code Safety Zone Analysis ──

export interface SafetyZone {
  /** Zone name */
  name: string;
  /** Zone type */
  type: 'keep_in' | 'keep_out';
  /** Bounds */
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
}

export interface SafetyZoneViolation {
  /** G-code line number */
  lineNumber: number;
  /** Zone name */
  zoneName: string;
  /** Position */
  position: { x: number; y: number };
  /** Violation type */
  type: 'left_keep_in' | 'right_keep_in' | 'top_keep_in' | 'bottom_keep_in' | 'entered_keep_out';
  /** Description */
  description: string;
}

export interface SafetyZoneResult {
  /** All violations */
  violations: SafetyZoneViolation[];
  /** Whether all zones are respected */
  isSafe: boolean;
  /** Violation count */
  violationCount: number;
  /** Zones checked */
  zoneCount: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Check toolpath against defined safety zones.
 * Safety zones can be:
 * - keep_in: toolpath must stay within these bounds
 * - keep_out: toolpath must not enter these bounds
 *
 * @param lines G-code lines
 * @param zones Safety zones to check
 */
export function checkSafetyZones(
  lines: string[],
  zones: SafetyZone[],
): SafetyZoneResult {
  const violations: SafetyZoneViolation[] = [];
  let prevX = 0, prevY = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG[01]\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;

    for (const zone of zones) {
      if (zone.type === 'keep_in') {
        if (x < zone.bounds.minX) {
          violations.push({
            lineNumber: i, zoneName: zone.name,
            position: { x, y }, type: 'left_keep_in',
            description: `X${x.toFixed(1)} is left of keep-in zone ${zone.name} (min: ${zone.bounds.minX})`,
          });
        }
        if (x > zone.bounds.maxX) {
          violations.push({
            lineNumber: i, zoneName: zone.name,
            position: { x, y }, type: 'right_keep_in',
            description: `X${x.toFixed(1)} is right of keep-in zone ${zone.name} (max: ${zone.bounds.maxX})`,
          });
        }
        if (y < zone.bounds.minY) {
          violations.push({
            lineNumber: i, zoneName: zone.name,
            position: { x, y }, type: 'bottom_keep_in',
            description: `Y${y.toFixed(1)} is below keep-in zone ${zone.name} (min: ${zone.bounds.minY})`,
          });
        }
        if (y > zone.bounds.maxY) {
          violations.push({
            lineNumber: i, zoneName: zone.name,
            position: { x, y }, type: 'top_keep_in',
            description: `Y${y.toFixed(1)} is above keep-in zone ${zone.name} (max: ${zone.bounds.maxY})`,
          });
        }
      } else if (zone.type === 'keep_out') {
        if (x >= zone.bounds.minX && x <= zone.bounds.maxX &&
            y >= zone.bounds.minY && y <= zone.bounds.maxY) {
          violations.push({
            lineNumber: i, zoneName: zone.name,
            position: { x, y }, type: 'entered_keep_out',
            description: `Toolpath entered keep-out zone ${zone.name} at (${x.toFixed(1)}, ${y.toFixed(1)})`,
          });
        }
      }
    }

    prevX = x; prevY = y;
  }

  const isSafe = violations.length === 0;

  const recommendations: string[] = [];
  if (violations.length > 0) {
    const keepIn = violations.filter(v => v.type.includes('keep_in')).length;
    const keepOut = violations.filter(v => v.type === 'entered_keep_out').length;
    if (keepIn > 0) {
      recommendations.push(`${keepIn} keep-in zone violations — toolpath leaves safe area`);
    }
    if (keepOut > 0) {
      recommendations.push(`${keepOut} keep-out zone violations — toolpath enters restricted area`);
    }
  }
  if (isSafe) {
    recommendations.push('All safety zones are respected');
  }

  return {
    violations, isSafe, violationCount: violations.length,
    zoneCount: zones.length, recommendations,
  };
}

// ── 11. Toolpath Direction Analysis ──

export interface DirectionAnalysisResult {
  /** Predominant direction */
  predominantDirection: 'X' | 'Y' | 'diagonal' | 'mixed';
  /** X-axis distance in mm */
  xDistance: number;
  /** Y-axis distance in mm */
  yDistance: number;
  /** Diagonal distance in mm */
  diagonalDistance: number;
  /** X-axis percentage */
  xPercentage: number;
  /** Y-axis percentage */
  yPercentage: number;
  /** Diagonal percentage */
  diagonalPercentage: number;
  /** Number of direction changes */
  directionChanges: number;
  /** Average segment length in mm */
  avgSegmentLength: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze predominant direction of toolpath moves.
 * Useful for:
 * - CNC: optimizing workholding orientation
 * - 3DP: identifying infill direction
 * - Both: understanding toolpath characteristics
 *
 * @param lines G-code lines
 */
export function analyzeToolpathDirection(lines: string[]): DirectionAnalysisResult {
  let xDistance = 0, yDistance = 0, diagonalDistance = 0;
  let directionChanges = 0;
  let totalSegments = 0;
  let totalLength = 0;
  let prevX = 0, prevY = 0;
  let prevDirX = 0, prevDirY = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG[01]\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;

    const dx = x - prevX;
    const dy = y - prevY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 0.1) {
      totalSegments++;
      totalLength += dist;

      // Classify direction
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      if (absDx > absDy * 5) {
        xDistance += dist;
      } else if (absDy > absDx * 5) {
        yDistance += dist;
      } else {
        diagonalDistance += dist;
      }

      // Direction change detection
      const dirX = dx / dist;
      const dirY = dy / dist;
      if (prevDirX !== 0 || prevDirY !== 0) {
        const dot = prevDirX * dirX + prevDirY * dirY;
        if (dot < 0) directionChanges++;
      }
      prevDirX = dirX;
      prevDirY = dirY;
    }

    prevX = x; prevY = y;
  }

  const total = xDistance + yDistance + diagonalDistance;
  const xPercentage = total > 0 ? (xDistance / total) * 100 : 0;
  const yPercentage = total > 0 ? (yDistance / total) * 100 : 0;
  const diagonalPercentage = total > 0 ? (diagonalDistance / total) * 100 : 0;

  let predominantDirection: DirectionAnalysisResult['predominantDirection'];
  if (xPercentage > 60) predominantDirection = 'X';
  else if (yPercentage > 60) predominantDirection = 'Y';
  else if (diagonalPercentage > 50) predominantDirection = 'diagonal';
  else predominantDirection = 'mixed';

  const avgSegmentLength = totalSegments > 0 ? totalLength / totalSegments : 0;

  const recommendations: string[] = [];
  if (predominantDirection === 'X') {
    recommendations.push('Predominantly X-axis moves — orient workholding along X for rigidity');
  } else if (predominantDirection === 'Y') {
    recommendations.push('Predominantly Y-axis moves — orient workholding along Y for rigidity');
  }
  if (directionChanges > totalSegments * 0.3) {
    recommendations.push('High direction change frequency — consider smoother toolpaths');
  }
  if (avgSegmentLength < 1) {
    recommendations.push('Very short segments — consider arc fitting for smoother motion');
  }
  if (recommendations.length === 0) {
    recommendations.push('Toolpath direction is well distributed');
  }

  return {
    predominantDirection, xDistance, yDistance, diagonalDistance,
    xPercentage, yPercentage, diagonalPercentage,
    directionChanges, avgSegmentLength, recommendations,
  };
}

// ── 12. G-code Parsing Error Recovery ──

export interface ParseError {
  /** Line number */
  lineNumber: number;
  /** Error type */
  type: 'syntax_error' | 'unknown_code' | 'missing_parameter' | 'invalid_value' | 'unexpected_token';
  /** The problematic text */
  text: string;
  /** Error message */
  message: string;
  /** Suggested fix */
  suggestion: string;
}

export interface ParseErrorResult {
  /** All parse errors */
  errors: ParseError[];
  /** Error count */
  errorCount: number;
  /** Lines with errors */
  linesWithErrors: number;
  /** Whether the G-code is parseable */
  isParseable: boolean;
  /** Recovered lines (with fixes applied) */
  recoveredLines: string[];
  /** Number of lines recovered */
  recoveredCount: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Parse G-code with error recovery.
 * Attempts to identify and recover from common syntax errors,
 * producing a cleaned-up version of the G-code.
 *
 * @param lines G-code lines
 */
export function parseWithRecovery(lines: string[]): ParseErrorResult {
  const errors: ParseError[] = [];
  const recoveredLines: string[] = [];
  let recoveredCount = 0;

  // Valid G-codes and M-codes
  const validGCodes = new Set([0, 1, 2, 3, 4, 10, 17, 18, 19, 20, 21, 28, 29, 30, 32, 40, 41, 42, 43, 49, 54, 55, 56, 57, 58, 59, 65, 68, 69, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 94, 95]);
  const validMCodes = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 30, 84, 92, 98, 99, 104, 105, 106, 107, 109, 140, 190, 203, 204, 205, 220, 221, 500, 503]);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Pass through comments and empty lines
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) {
      recoveredLines.push(line);
      continue;
    }

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();

    if (!code) {
      recoveredLines.push(line);
      continue;
    }

    let hasError = false;
    let recoveredCode = code;

    // Check for unknown G-codes
    const gMatches = code.matchAll(/\bG(\d+)\b/gi);
    for (const m of gMatches) {
      const gNum = parseInt(m[1]);
      if (!validGCodes.has(gNum)) {
        errors.push({
          lineNumber: i, type: 'unknown_code', text: m[0],
          message: `Unknown G-code: G${gNum}`,
          suggestion: `Check if G${gNum} is supported by your controller`,
        });
        hasError = true;
      }
    }

    // Check for unknown M-codes
    const mMatches = code.matchAll(/\bM(\d+)\b/gi);
    for (const m of mMatches) {
      const mNum = parseInt(m[1]);
      if (!validMCodes.has(mNum)) {
        errors.push({
          lineNumber: i, type: 'unknown_code', text: m[0],
          message: `Unknown M-code: M${mNum}`,
          suggestion: `Check if M${mNum} is supported by your controller`,
        });
        hasError = true;
      }
    }

    // Check for missing parameters (G1 without coordinates)
    if (/\bG1\b/i.test(code) && !/\b[XYZE]\b/i.test(code)) {
      const fMatch = code.match(/\bF(\d*\.?\d+)/i);
      if (!fMatch) {
        errors.push({
          lineNumber: i, type: 'missing_parameter', text: code,
          message: 'G1 without coordinates or feed rate',
          suggestion: 'Add X, Y, Z, E, or F parameter',
        });
        hasError = true;
      }
    }

    // Check for invalid numeric values
    const numMatches = code.matchAll(/\b([XYZEFIJKRDSTP])(\d*\.?\d*)\b/gi);
    for (const m of numMatches) {
      const value = m[2];
      if (value === '' || value === '.') {
        errors.push({
          lineNumber: i, type: 'invalid_value', text: m[0],
          message: `${m[1]} parameter has no value`,
          suggestion: `Add a numeric value after ${m[1]}`,
        });
        hasError = true;
        // Fix: remove the parameter
        recoveredCode = recoveredCode.replace(new RegExp(`\\b${m[1]}\\s*`, 'i'), '');
      }
    }

    // Check for unexpected characters
    if (/[?!@#$%^&]/.test(code)) {
      errors.push({
        lineNumber: i, type: 'unexpected_token', text: code,
        message: 'Unexpected characters in G-code',
        suggestion: 'Remove special characters',
      });
      hasError = true;
      recoveredCode = recoveredCode.replace(/[?!@#$%^&]/g, '');
    }

    if (hasError) {
      recoveredLines.push(recoveredCode || line);
      recoveredCount++;
    } else {
      recoveredLines.push(line);
    }
  }

  const errorCount = errors.length;
  const linesWithErrors = new Set(errors.map(e => e.lineNumber)).size;
  const isParseable = errorCount === 0;

  const recommendations: string[] = [];
  if (errorCount > 0) {
    recommendations.push(`${errorCount} parse errors found in ${linesWithErrors} lines`);
  }
  const unknownCodes = errors.filter(e => e.type === 'unknown_code').length;
  if (unknownCodes > 0) {
    recommendations.push(`${unknownCodes} unknown codes — verify controller compatibility`);
  }
  const invalidValues = errors.filter(e => e.type === 'invalid_value').length;
  if (invalidValues > 0) {
    recommendations.push(`${invalidValues} invalid values — fix parameter values`);
  }
  if (isParseable) {
    recommendations.push('G-code parses without errors');
  }

  return {
    errors, errorCount, linesWithErrors, isParseable,
    recoveredLines, recoveredCount, recommendations,
  };
}
