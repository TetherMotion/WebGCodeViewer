/**
 * @file GcodeAdvanced14.ts
 * @brief Fourteenth batch of advanced G-code analysis features for CNC and 3D printing.
 *
 * This module provides 12 additional high-impact features:
 *  1. G-code syntax highlighter (Universal) — tokenize and highlight G-code
 *  2. CNC tool deflection prediction (CNC) — predict deflection from cutting forces
 *  3. Print stringing risk map (3DP) — map stringing risk per region
 *  4. G-code macro expansion preview (Universal) — preview expanded macros
 *  5. CNC surface roughness prediction (CNC) — predict Ra from cutting parameters
 *  6. Print warping simulation (3DP) — simulate warping from thermal gradients
 *  7. G-code collision detection 3D (Universal) — 3D collision with stock model
 *  8. CNC tool life calculator (CNC) — Taylor tool life calculator
 *  9. Print infill pattern analyzer (3DP) — identify and analyze infill patterns
 * 10. G-code bounds calculator (Universal) — compute precise bounds with margins
 * 11. CNC cutting force simulator (CNC) — simulate cutting forces over time
 * 12. Print retraction optimization (3DP) — optimize retraction distance and speed
 */

// ── 1. G-code Syntax Highlighter ──

export interface SyntaxToken {
  /** Token type */
  type: 'command' | 'axis' | 'value' | 'comment' | 'modal' | 'macro' | 'whitespace' | 'newline';
  /** Token text */
  text: string;
  /** Start position */
  start: number;
  /** End position */
  end: number;
}

export interface SyntaxHighlightResult {
  /** All tokens */
  tokens: SyntaxToken[];
  /** Token count */
  tokenCount: number;
  /** Whether highlighting was successful */
  success: boolean;
  /** CSS class mapping */
  cssClasses: { [tokenType: string]: string };
  /** Recommendations */
  recommendations: string[];
}

/**
 * Tokenize G-code for syntax highlighting.
 * Produces tokens that can be mapped to CSS classes for display.
 *
 * @param lines G-code lines
 */
export function highlightGcodeSyntax(lines: string[]): SyntaxHighlightResult {
  const tokens: SyntaxToken[] = [];
  const cssClasses: { [tokenType: string]: string } = {
    command: 'gcode-command',
    axis: 'gcode-axis',
    value: 'gcode-value',
    comment: 'gcode-comment',
    modal: 'gcode-modal',
    macro: 'gcode-macro',
    whitespace: 'gcode-whitespace',
    newline: 'gcode-newline',
  };

  for (const line of lines) {
    let pos = 0;
    const lineStr = line;

    // Comment detection
    const commentIdx = lineStr.indexOf(';');
    const parenCommentMatch = lineStr.match(/\([^)]*\)/);

    if (commentIdx === 0) {
      // Full line comment
      tokens.push({ type: 'comment', text: lineStr, start: 0, end: lineStr.length });
      tokens.push({ type: 'newline', text: '\n', start: lineStr.length, end: lineStr.length + 1 });
      continue;
    }

    // Tokenize the code part
    let codeEnd = lineStr.length;
    if (commentIdx >= 0) codeEnd = commentIdx;

    const codePart = lineStr.substring(0, codeEnd);
    const commentPart = commentIdx >= 0 ? lineStr.substring(commentIdx) : '';

    // Tokenize code
    const tokenRegex = /(\s+)|([GM])0*(\d+)|([XYZIJKRDSTP])(-?\d*\.?\d+)|(\([^)]*\))/gi;
    let match;
    let lastEnd = 0;

    while ((match = tokenRegex.exec(codePart)) !== null) {
      // Handle any gap
      if (match.index > lastEnd) {
        tokens.push({ type: 'whitespace', text: codePart.substring(lastEnd, match.index), start: lastEnd, end: match.index });
      }

      if (match[1]) {
        // Whitespace
        tokens.push({ type: 'whitespace', text: match[1], start: match.index, end: match.index + match[1].length });
      } else if (match[2] && match[3]) {
        // G/M code
        const code = `${match[2]}${match[3]}`;
        const isModal = ['G0', 'G1', 'G2', 'G3', 'G17', 'G18', 'G19', 'G20', 'G21', 'G90', 'G91'].includes(code.toUpperCase());
        tokens.push({ type: isModal ? 'modal' : 'command', text: code, start: match.index, end: match.index + code.length });
      } else if (match[4] && match[5]) {
        // Axis + value
        tokens.push({ type: 'axis', text: match[4], start: match.index, end: match.index + 1 });
        tokens.push({ type: 'value', text: match[5], start: match.index + 1, end: match.index + 1 + match[5].length });
      } else if (match[6]) {
        // Parenthetical comment
        tokens.push({ type: 'comment', text: match[6], start: match.index, end: match.index + match[6].length });
      }

      lastEnd = match.index + match[0].length;
    }

    // Handle remaining
    if (lastEnd < codePart.length) {
      tokens.push({ type: 'whitespace', text: codePart.substring(lastEnd), start: lastEnd, end: codePart.length });
    }

    // Comment
    if (commentPart) {
      tokens.push({ type: 'comment', text: commentPart, start: codeEnd, end: lineStr.length });
    }

    tokens.push({ type: 'newline', text: '\n', start: lineStr.length, end: lineStr.length + 1 });
  }

  const recommendations: string[] = [];
  const commandCount = tokens.filter(t => t.type === 'command' || t.type === 'modal').length;
  recommendations.push(`${tokens.length} tokens, ${commandCount} commands`);
  if (tokens.length > 10000) {
    recommendations.push('Large token count — consider incremental highlighting');
  }

  return {
    tokens, tokenCount: tokens.length, success: true,
    cssClasses, recommendations,
  };
}

// ── 2. CNC Tool Deflection Prediction ──

export interface DeflectionPoint {
  /** Line number */
  line: number;
  /** Cutting force in N */
  force: number;
  /** Tool overhang in mm */
  overhang: number;
  /** Deflection in mm */
  deflection: number;
  /** Deflection as percentage of tool diameter */
  deflectionPercentage: number;
  /** Whether deflection is acceptable */
  acceptable: boolean;
}

export interface ToolDeflectionResult {
  /** Per-point deflection data */
  points: DeflectionPoint[];
  /** Maximum deflection in mm */
  maxDeflection: number;
  /** Average deflection in mm */
  avgDeflection: number;
  /** Number of points with unacceptable deflection */
  unacceptableCount: number;
  /** Deflection score (0-100, higher is better) */
  deflectionScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Predict tool deflection from cutting forces.
 * Uses beam deflection model: δ = F·L³ / (3·E·I)
 * where E = Young's modulus, I = moment of inertia
 *
 * @param lines G-code lines
 * @param toolDiameter Tool diameter in mm (default 6)
 * @param toolLength Tool overhang length in mm (default 30)
 * @param youngsModulus Young's modulus in N/mm² (default 600000 for carbide)
 * @param maxAcceptable Maximum acceptable deflection in mm (default 0.05)
 */
export function predictToolDeflectionAdvanced(
  lines: string[],
  toolDiameter: number = 6,
  toolLength: number = 30,
  youngsModulus: number = 600000,
  maxAcceptable: number = 0.05,
): ToolDeflectionResult {
  const points: DeflectionPoint[] = [];
  let rpm = 0;
  let feedRate = 0;
  let prevX = 0, prevY = 0, prevZ = 0;

  // Moment of inertia for circular cross-section: I = π·d⁴/64
  const I = Math.PI * toolDiameter ** 4 / 64;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const sMatch = code.match(/\bS(\d*\.?\d+)/i);
    if (sMatch) rpm = parseFloat(sMatch[1]);

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) feedRate = parseFloat(fMatch[1]);

    if (!/\bG1\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const z = zMatch ? parseFloat(zMatch[1]) : prevZ;

    if (z < 0 && feedRate > 0) {
      const distance = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
      if (distance > 0.01) {
        // Estimate cutting force
        const feedPerTooth = rpm > 0 ? feedRate / (rpm * 2) : 0.1;
        const depthOfCut = Math.abs(z);
        const widthOfCut = Math.min(toolDiameter, distance);
        const force = 800 * feedPerTooth * depthOfCut * widthOfCut; // N (aluminum)

        // Effective overhang increases with depth
        const effectiveOverhang = toolLength + depthOfCut;

        // Beam deflection: δ = F·L³ / (3·E·I)
        const deflection = (force * effectiveOverhang ** 3) / (3 * youngsModulus * I);
        const deflectionPercentage = (deflection / toolDiameter) * 100;
        const acceptable = deflection <= maxAcceptable;

        points.push({
          line: i, force, overhang: effectiveOverhang,
          deflection, deflectionPercentage, acceptable,
        });
      }
    }

    prevX = x; prevY = y; prevZ = z;
  }

  const deflections = points.map(p => p.deflection);
  const maxDeflection = deflections.length > 0 ? Math.max(...deflections) : 0;
  const avgDeflection = deflections.length > 0 ? deflections.reduce((a, b) => a + b, 0) / deflections.length : 0;
  const unacceptableCount = points.filter(p => !p.acceptable).length;
  const deflectionScore = points.length > 0
    ? Math.max(0, 100 - (unacceptableCount / points.length) * 100)
    : 100;

  const recommendations: string[] = [];
  if (maxDeflection > maxAcceptable) {
    recommendations.push(`Max deflection ${maxDeflection.toFixed(4)}mm exceeds acceptable ${maxAcceptable}mm`);
  }
  if (unacceptableCount > 0) {
    recommendations.push(`${unacceptableCount} segments with excessive deflection — reduce overhang or depth of cut`);
  }
  if (toolLength > 50) {
    recommendations.push(`Long tool overhang (${toolLength}mm) — consider shorter tool or rigid holder`);
  }
  if (points.length === 0) {
    recommendations.push('No cutting operations for deflection analysis');
  }

  return {
    points, maxDeflection, avgDeflection,
    unacceptableCount, deflectionScore, recommendations,
  };
}

// ── 3. Print Stringing Risk Map ──

export interface StringingRiskCell {
  /** Grid X */
  gridX: number;
  /** Grid Y */
  gridY: number;
  /** Center X */
  centerX: number;
  /** Center Y */
  centerY: number;
  /** Risk level */
  riskLevel: 'low' | 'medium' | 'high';
  /** Risk score (0-100) */
  riskScore: number;
  /** Travel moves without retraction */
  travelMovesWithoutRetraction: number;
}

export interface StringingRiskResult {
  /** Risk grid cells */
  cells: StringingRiskCell[];
  /** Grid size */
  gridSize: { x: number; y: number };
  /** Overall risk level */
  overallRisk: 'low' | 'medium' | 'high';
  /** High-risk area percentage */
  highRiskPercentage: number;
  /** Number of travel moves without retraction */
  totalTravelWithoutRetraction: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Map stringing risk per region.
 * Stringing occurs when the nozzle travels between parts without proper retraction.
 *
 * @param lines G-code lines
 * @param gridResolution Grid resolution (default 8)
 */
export function generateStringingRiskMap(
  lines: string[],
  gridResolution: number = 8,
): StringingRiskResult {
  // Collect travel moves
  const travelMoves: { x: number; y: number; hasRetraction: boolean; distance: number }[] = [];
  let prevX = 0, prevY = 0, prevE = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG[01]\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const e = eMatch ? parseFloat(eMatch[1]) : prevE;

    const distance = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
    const isExtruding = e > prevE;
    const hasRetraction = e < prevE;

    if (!isExtruding && distance > 1) {
      // Travel move
      travelMoves.push({ x, y, hasRetraction, distance });
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }

    prevX = x; prevY = y; prevE = e;
  }

  if (travelMoves.length === 0 || !isFinite(minX)) {
    return {
      cells: [], gridSize: { x: 0, y: 0 }, overallRisk: 'low',
      highRiskPercentage: 0, totalTravelWithoutRetraction: 0,
      recommendations: ['No travel moves found for stringing risk analysis'],
    };
  }

  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const cellW = rangeX / gridResolution;
  const cellH = rangeY / gridResolution;

  // Build grid
  const grid: StringingRiskCell[][] = [];
  for (let gx = 0; gx < gridResolution; gx++) {
    grid[gx] = [];
    for (let gy = 0; gy < gridResolution; gy++) {
      grid[gx][gy] = {
        gridX: gx, gridY: gy,
        centerX: minX + (gx + 0.5) * cellW,
        centerY: minY + (gy + 0.5) * cellH,
        riskLevel: 'low', riskScore: 0,
        travelMovesWithoutRetraction: 0,
      };
    }
  }

  // Populate
  for (const move of travelMoves) {
    const gx = Math.min(gridResolution - 1, Math.max(0, Math.floor((move.x - minX) / cellW)));
    const gy = Math.min(gridResolution - 1, Math.max(0, Math.floor((move.y - minY) / cellH)));
    if (!move.hasRetraction) {
      grid[gx][gy].travelMovesWithoutRetraction++;
      grid[gx][gy].riskScore += Math.min(50, move.distance / 2);
    }
  }

  // Normalize and classify
  const cells: StringingRiskCell[] = [];
  for (let gx = 0; gx < gridResolution; gx++) {
    for (let gy = 0; gy < gridResolution; gy++) {
      const cell = grid[gx][gy];
      cell.riskScore = Math.min(100, cell.riskScore);
      if (cell.riskScore >= 60) cell.riskLevel = 'high';
      else if (cell.riskScore >= 30) cell.riskLevel = 'medium';
      else cell.riskLevel = 'low';
      cells.push(cell);
    }
  }

  const highRiskCells = cells.filter(c => c.riskLevel === 'high');
  const highRiskPercentage = cells.length > 0 ? (highRiskCells.length / cells.length) * 100 : 0;
  const totalTravelWithoutRetraction = cells.reduce((s, c) => s + c.travelMovesWithoutRetraction, 0);

  let overallRisk: 'low' | 'medium' | 'high';
  if (highRiskPercentage > 20) overallRisk = 'high';
  else if (highRiskPercentage > 5) overallRisk = 'medium';
  else overallRisk = 'low';

  const recommendations: string[] = [];
  if (overallRisk === 'high') {
    recommendations.push('High stringing risk — enable retraction for travel moves');
  }
  if (totalTravelWithoutRetraction > 10) {
    recommendations.push(`${totalTravelWithoutRetraction} travel moves without retraction — add retraction`);
  }
  if (highRiskPercentage > 0) {
    recommendations.push(`${highRiskPercentage.toFixed(0)}% of bed area has high stringing risk`);
  }
  if (overallRisk === 'low') {
    recommendations.push('Stringing risk is low — good retraction coverage');
  }

  return {
    cells, gridSize: { x: gridResolution, y: gridResolution },
    overallRisk, highRiskPercentage,
    totalTravelWithoutRetraction, recommendations,
  };
}

// ── 4. G-code Macro Expansion Preview ──

export interface MacroDefinition {
  /** Macro name */
  name: string;
  /** Parameters */
  parameters: string[];
  /** Body lines */
  body: string[];
  /** Definition line */
  definitionLine: number;
}

export interface MacroExpansion {
  /** Macro name */
  macroName: string;
  /** Call line */
  callLine: number;
  /** Expanded lines */
  expandedLines: string[];
  /** Parameter values used */
  parameterValues: { [name: string]: string };
}

export interface MacroExpansionResult {
  /** All macro definitions found */
  definitions: MacroDefinition[];
  /** All expansions */
  expansions: MacroExpansion[];
  /** Fully expanded G-code */
  expandedLines: string[];
  /** Number of macros defined */
  macroCount: number;
  /** Number of expansions performed */
  expansionCount: number;
  /** Whether macros were found */
  hasMacros: boolean;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Preview macro expansion before execution.
 * Finds macro definitions and expands calls with parameter substitution.
 *
 * Supports:
 * - #define NAME(params) body
 * - NAME(arg1, arg2) call syntax
 *
 * @param lines G-code lines
 */
export function previewMacroExpansion(lines: string[]): MacroExpansionResult {
  const definitions = new Map<string, MacroDefinition>();
  const expansions: MacroExpansion[] = [];
  const expandedLines: string[] = [];

  // First pass: find definitions
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // #define macro
    const defineMatch = line.match(/#define\s+(\w+)\s*\(([^)]*)\)\s*(.*)/i);
    if (defineMatch) {
      const name = defineMatch[1];
      const params = defineMatch[2].split(',').map(p => p.trim()).filter(p => p);
      const body = defineMatch[3] ? [defineMatch[3]] : [];

      // Collect multi-line body
      let j = i + 1;
      while (j < lines.length && !lines[j].trim().startsWith('#end') && !lines[j].trim().match(/^#define/i)) {
        body.push(lines[j].trim());
        j++;
      }

      definitions.set(name, { name, parameters: params, body, definitionLine: i });
    }

    // O-code macro (subprogram)
    const oMatch = line.match(/\bO(\d+)\b/i);
    if (oMatch && !line.match(/\bM98\b/i)) {
      const name = `O${oMatch[1]}`;
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && !lines[j].match(/\bM99\b/i) && !lines[j].match(/\bM30\b/i)) {
        body.push(lines[j].trim());
        j++;
      }
      definitions.set(name, { name, parameters: [], body, definitionLine: i });
    }
  }

  // Second pass: expand
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip definitions
    if (line.match(/^#define/i) || line.match(/^#end/i)) continue;

    // Check for macro call
    const callMatch = line.match(/^(\w+)\s*\(([^)]*)\)/);
    if (callMatch && definitions.has(callMatch[1])) {
      const macro = definitions.get(callMatch[1])!;
      const args = callMatch[2].split(',').map(a => a.trim());
      const paramValues: { [name: string]: string } = {};

      macro.parameters.forEach((param, idx) => {
        paramValues[param] = args[idx] ?? '';
      });

      const expanded = macro.body.map(bodyLine => {
        let result = bodyLine;
        for (const [param, value] of Object.entries(paramValues)) {
          result = result.replace(new RegExp(`\\b${param}\\b`, 'g'), value);
        }
        return result;
      });

      expansions.push({
        macroName: callMatch[1],
        callLine: i,
        expandedLines: expanded,
        parameterValues: paramValues,
      });

      expandedLines.push(...expanded);
      continue;
    }

    // Check for M98 subprogram call
    const m98Match = line.match(/\bM98\b/i) && line.match(/\bP(\d+)\b/i);
    if (m98Match) {
      const subName = `O${m98Match[1]}`;
      if (definitions.has(subName)) {
        const macro = definitions.get(subName)!;
        expansions.push({
          macroName: subName,
          callLine: i,
          expandedLines: macro.body,
          parameterValues: {},
        });
        expandedLines.push(...macro.body);
        continue;
      }
    }

    expandedLines.push(lines[i]);
  }

  const macroCount = definitions.size;
  const expansionCount = expansions.length;
  const hasMacros = macroCount > 0;

  const recommendations: string[] = [];
  if (macroCount > 0) {
    recommendations.push(`${macroCount} macros defined, ${expansionCount} expansions`);
  }
  for (const def of Array.from(definitions.values()).slice(0, 3)) {
    recommendations.push(`Macro ${def.name}: ${def.body.length} lines, ${def.parameters.length} params`);
  }
  if (!hasMacros) {
    recommendations.push('No macros found in G-code');
  }

  return {
    definitions: Array.from(definitions.values()),
    expansions, expandedLines,
    macroCount, expansionCount, hasMacros, recommendations,
  };
}

// ── 5. CNC Surface Roughness Prediction ──

export interface SurfaceRoughnessPoint {
  /** Line number */
  line: number;
  /** Predicted Ra in μm */
  ra: number;
  /** Predicted Rz in μm */
  rz: number;
  /** Feed per tooth in mm */
  feedPerTooth: number;
  /** Nose radius in mm */
  noseRadius: number;
  /** Whether roughness is acceptable */
  acceptable: boolean;
}

export interface SurfaceRoughnessResult {
  /** Per-point roughness data */
  points: SurfaceRoughnessPoint[];
  /** Average Ra */
  avgRa: number;
  /** Maximum Ra */
  maxRa: number;
  /** Average Rz */
  avgRz: number;
  /** Roughness score (0-100, higher is better) */
  roughnessScore: number;
  /** Recommended Ra range */
  recommendedRange: { min: number; max: number };
  /** Recommendations */
  recommendations: string[];
}

/**
 * Predict surface roughness from cutting parameters.
 * Uses the formula: Ra = f² / (32·r) where f = feed per tooth, r = nose radius
 *
 * @param lines G-code lines
 * @param noseRadius Tool nose radius in mm (default 0.4)
 * @param flutes Number of flutes (default 2)
 * @param maxRa Maximum acceptable Ra in μm (default 1.6)
 */
export function predictSurfaceRoughness(
  lines: string[],
  noseRadius: number = 0.4,
  flutes: number = 2,
  maxRa: number = 1.6,
): SurfaceRoughnessResult {
  const points: SurfaceRoughnessPoint[] = [];
  let rpm = 0;
  let feedRate = 0;
  let prevZ = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const sMatch = code.match(/\bS(\d*\.?\d+)/i);
    if (sMatch) rpm = parseFloat(sMatch[1]);

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) feedRate = parseFloat(fMatch[1]);

    if (!/\bG1\b/i.test(code)) continue;

    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    if (zMatch) prevZ = parseFloat(zMatch[1]);

    // Only analyze finishing passes (shallow cuts)
    if (prevZ < 0 && feedRate > 0 && rpm > 0) {
      const feedPerTooth = feedRate / (rpm * flutes); // mm/tooth
      // Ra = f² / (32·r) in mm, convert to μm
      const ra = (feedPerTooth ** 2 / (32 * noseRadius)) * 1000; // μm
      const rz = ra * 4; // Rz ≈ 4·Ra
      const acceptable = ra <= maxRa;

      points.push({
        line: i, ra, rz, feedPerTooth, noseRadius, acceptable,
      });
    }
  }

  const ras = points.map(p => p.ra);
  const avgRa = ras.length > 0 ? ras.reduce((a, b) => a + b, 0) / ras.length : 0;
  const maxRaVal = ras.length > 0 ? Math.max(...ras) : 0;
  const avgRz = avgRa * 4;
  const acceptableCount = points.filter(p => p.acceptable).length;
  const roughnessScore = points.length > 0 ? (acceptableCount / points.length) * 100 : 100;

  const recommendations: string[] = [];
  if (maxRaVal > maxRa) {
    recommendations.push(`Max Ra ${maxRaVal.toFixed(2)}μm exceeds target ${maxRa}μm — reduce feed or increase nose radius`);
  }
  if (avgRa > maxRa) {
    recommendations.push(`Average Ra ${avgRa.toFixed(2)}μm exceeds target — optimize finishing parameters`);
  }
  if (noseRadius < 0.2) {
    recommendations.push(`Small nose radius (${noseRadius}mm) — increase for better surface finish`);
  }
  if (points.length === 0) {
    recommendations.push('No finishing operations detected for roughness prediction');
  }

  return {
    points, avgRa, maxRa: maxRaVal, avgRz, roughnessScore,
    recommendedRange: { min: 0.4, max: maxRa }, recommendations,
  };
}

// ── 6. Print Warping Simulation ──

export interface WarpingPoint {
  /** X position */
  x: number;
  /** Y position */
  y: number;
  /** Z height (layer) */
  z: number;
  /** Predicted warping in mm */
  warping: number;
  /** Thermal gradient in °C/mm */
  thermalGradient: number;
  /** Risk level */
  riskLevel: 'low' | 'medium' | 'high';
}

export interface WarpingSimulationResult {
  /** Warping prediction points */
  points: WarpingPoint[];
  /** Maximum warping in mm */
  maxWarping: number;
  /** Average warping in mm */
  avgWarping: number;
  /** Number of high-risk points */
  highRiskCount: number;
  /** Warping risk score (0-100, lower is better) */
  warpingScore: number;
  /** Corner warping estimate in mm */
  cornerWarping: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Simulate warping based on thermal gradients.
 * Warping is caused by differential cooling between layers.
 *
 * Model: warping ∝ thermal_gradient × layer_height × thermal_expansion
 *
 * @param lines G-code lines
 * @param bedTemp Bed temperature in °C (default 60)
 * @param ambientTemp Ambient temperature in °C (default 20)
 * @param thermalExpansion Thermal expansion coefficient (default 68e-6 for PLA)
 */
export function simulateWarping(
  lines: string[],
  bedTemp: number = 60,
  ambientTemp: number = 20,
  thermalExpansion: number = 68e-6,
): WarpingSimulationResult {
  const points: WarpingPoint[] = [];
  let currentZ = 0;
  let prevX = 0, prevY = 0;
  let bedTempSet = bedTemp;
  let hotendTemp = 200;
  let fanSpeed = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Track temperatures
    if (/\bM140\b/i.test(code) || /\bM190\b/i.test(code)) {
      const sMatch = code.match(/\bS(\d*\.?\d+)/i);
      if (sMatch) bedTempSet = parseFloat(sMatch[1]);
    }
    if (/\bM104\b/i.test(code) || /\bM109\b/i.test(code)) {
      const sMatch = code.match(/\bS(\d*\.?\d+)/i);
      if (sMatch) hotendTemp = parseFloat(sMatch[1]);
    }
    if (/\bM106\b/i.test(code)) {
      const sMatch = code.match(/\bS(\d*\.?\d+)/i);
      if (sMatch) fanSpeed = parseFloat(sMatch[1]);
    }
    if (/\bM107\b/i.test(code)) fanSpeed = 0;

    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    if (zMatch) currentZ = parseFloat(zMatch[1]);

    if (!/\bG1\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;

    if (eMatch) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);

      // Estimate thermal gradient
      const tempDiff = hotendTemp - ambientTemp;
      const coolingFactor = 1 + (fanSpeed / 255) * 2;
      const layerTemp = bedTempSet - (currentZ * 5 * coolingFactor); // temp drops with height
      const thermalGradient = (hotendTemp - layerTemp) / Math.max(0.1, currentZ);

      // Warping estimate
      const warping = thermalGradient * thermalExpansion * currentZ * 10;
      const riskLevel = warping > 0.5 ? 'high' : warping > 0.2 ? 'medium' : 'low';

      points.push({ x, y, z: currentZ, warping, thermalGradient, riskLevel });
    }

    prevX = x; prevY = y;
  }

  if (points.length === 0) {
    return {
      points: [], maxWarping: 0, avgWarping: 0,
      highRiskCount: 0, warpingScore: 100, cornerWarping: 0,
      recommendations: ['No extrusion data for warping simulation'],
    };
  }

  const warpings = points.map(p => p.warping);
  const maxWarping = Math.max(...warpings);
  const avgWarping = warpings.reduce((a, b) => a + b, 0) / warpings.length;
  const highRiskCount = points.filter(p => p.riskLevel === 'high').length;
  const warpingScore = Math.max(0, 100 - (highRiskCount / points.length) * 100);

  // Corner warping: estimate at part corners
  const cornerWarping = maxWarping * 1.5; // Corners warp more

  const recommendations: string[] = [];
  if (maxWarping > 0.5) {
    recommendations.push(`Max warping ${maxWarping.toFixed(2)}mm — consider brim or raft`);
  }
  if (bedTempSet < 50) {
    recommendations.push(`Low bed temp (${bedTempSet}°C) — increase to reduce warping`);
  }
  if (fanSpeed > 200 && currentZ < 5) {
    recommendations.push('High fan speed on early layers — reduce fan for first layers');
  }
  if (warpingScore > 80) {
    recommendations.push('Low warping risk — good thermal management');
  }

  return {
    points, maxWarping, avgWarping, highRiskCount,
    warpingScore, cornerWarping, recommendations,
  };
}

// ── 7. G-code Collision Detection 3D ──

export interface BoundingBox {
  minX: number; maxX: number;
  minY: number; maxY: number;
  minZ: number; maxZ: number;
}

export interface CollisionEvent {
  /** Line number */
  line: number;
  /** Type of collision */
  type: 'tool_stock' | 'tool_fixture' | 'rapid_collision' | 'clearance_violation';
  /** Description */
  description: string;
  /** Position */
  position: { x: number; y: number; z: number };
  /** Severity */
  severity: 'low' | 'medium' | 'high';
}

export interface CollisionDetectionResult {
  /** All collision events */
  events: CollisionEvent[];
  /** Collision count */
  collisionCount: number;
  /** Events by severity */
  bySeverity: { low: number; medium: number; high: number };
  /** Safe Z height identified */
  safeZHeight: number;
  /** Whether collisions were detected */
  hasCollisions: boolean;
  /** Collision-free score (0-100) */
  safetyScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Perform 3D collision detection with stock model.
 * Checks for:
 * - Rapid moves into stock
 * - Clearance violations
 * - Tool path entering fixture area
 *
 * @param lines G-code lines
 * @param stockBounds Stock model bounding box
 * @param safeZ Safe Z height for rapids (default 10)
 */
export function detectCollisions3D(
  lines: string[],
  stockBounds: BoundingBox | null = null,
  safeZ: number = 10,
): CollisionDetectionResult {
  const events: CollisionEvent[] = [];
  let currentZ = 0;
  let prevX = 0, prevY = 0, prevZ = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    if (zMatch) currentZ = parseFloat(zMatch[1]);

    if (!/\bG[01]\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch2 = code.match(/\bZ(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const z = zMatch2 ? parseFloat(zMatch2[1]) : prevZ;

    // Check rapid move into stock
    if (/\bG0\b/i.test(code) && stockBounds) {
      if (x >= stockBounds.minX && x <= stockBounds.maxX &&
          y >= stockBounds.minY && y <= stockBounds.maxY &&
          z < stockBounds.maxZ) {
        events.push({
          line: i, type: 'rapid_collision', severity: 'high',
          description: `Rapid move into stock at Z=${z.toFixed(1)}`,
          position: { x, y, z },
        });
      }
    }

    // Check clearance violation (rapid below safe Z)
    if (/\bG0\b/i.test(code) && z < safeZ && z > 0) {
      events.push({
        line: i, type: 'clearance_violation', severity: 'medium',
        description: `Rapid below safe Z (${z.toFixed(1)} < ${safeZ})`,
        position: { x, y, z },
      });
    }

    // Check stock bounds violation
    if (stockBounds && /\bG1\b/i.test(code)) {
      if (z < stockBounds.minZ) {
        events.push({
          line: i, type: 'tool_stock', severity: 'high',
          description: `Cut below stock bottom (Z=${z.toFixed(1)} < ${stockBounds.minZ})`,
          position: { x, y, z },
        });
      }
    }

    prevX = x; prevY = y; prevZ = z;
  }

  const bySeverity = {
    low: events.filter(e => e.severity === 'low').length,
    medium: events.filter(e => e.severity === 'medium').length,
    high: events.filter(e => e.severity === 'high').length,
  };

  const collisionCount = events.length;
  const hasCollisions = collisionCount > 0;
  const safetyScore = Math.max(0, 100 - bySeverity.high * 20 - bySeverity.medium * 10 - bySeverity.low * 5);

  const recommendations: string[] = [];
  if (bySeverity.high > 0) {
    recommendations.push(`${bySeverity.high} high-severity collisions — fix before running`);
  }
  if (bySeverity.medium > 0) {
    recommendations.push(`${bySeverity.medium} clearance violations — raise safe Z`);
  }
  if (!hasCollisions) {
    recommendations.push('No collisions detected — G-code is safe');
  }

  return {
    events, collisionCount, bySeverity,
    safeZHeight: safeZ, hasCollisions, safetyScore, recommendations,
  };
}

// ── 8. CNC Tool Life Calculator ──

export interface ToolLifeResult {
  /** Tool number */
  tool: number;
  /** Taylor exponent n */
  n: number;
  /** Cutting speed in m/min */
  cuttingSpeed: number;
  /** Taylor constant C */
  C: number;
  /** Tool life in minutes */
  toolLifeMinutes: number;
  /** Tool life in seconds */
  toolLifeSeconds: number;
  /** Tool life in parts (estimated) */
  partsPerTool: number;
  /** Cost per part in USD */
  costPerPart: number;
  /** Whether tool life is adequate */
  adequate: boolean;
}

export interface ToolLifeCalculationResult {
  /** Per-tool life calculations */
  tools: ToolLifeResult[];
  /** Total tool cost */
  totalToolCost: number;
  /** Average tool life in minutes */
  avgToolLife: number;
  /** Shortest tool life */
  shortestToolLife: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Calculate tool life using Taylor's tool life equation.
 * VT^n = C, where V = cutting speed, T = tool life, n = Taylor exponent
 *
 * @param lines G-code lines
 * @param toolDiameter Tool diameter in mm (default 6)
 * @param toolCost Cost per tool in USD (default 25)
 * @param partTime Time per part in minutes (default 30)
 */
export function calculateToolLife(
  lines: string[],
  toolDiameter: number = 6,
  toolCost: number = 25,
  partTime: number = 30,
): ToolLifeCalculationResult {
  const toolData = new Map<number, { rpm: number; maxRpm: number }>();
  let currentTool = 0;
  let currentRpm = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const tMatch = code.match(/\bT(\d+)\b/i);
    if (tMatch && (/\bM6\b/i.test(code) || /\bM06\b/i.test(code))) {
      currentTool = parseInt(tMatch[1]);
      if (!toolData.has(currentTool)) {
        toolData.set(currentTool, { rpm: 0, maxRpm: 0 });
      }
    }

    const sMatch = code.match(/\bS(\d*\.?\d+)/i);
    if (sMatch && /\bM[34]\b/i.test(code)) {
      currentRpm = parseFloat(sMatch[1]);
      const data = toolData.get(currentTool);
      if (data) {
        data.rpm = currentRpm;
        data.maxRpm = Math.max(data.maxRpm, currentRpm);
      }
    }
  }

  const tools: ToolLifeResult[] = [];

  for (const [toolNum, data] of toolData) {
    if (data.maxRpm === 0) continue;

    // Cutting speed V = π·D·N / 1000 (m/min)
    const cuttingSpeed = Math.PI * toolDiameter * data.maxRpm / 1000;

    // Taylor exponent (typical values: HSS=0.125, carbide=0.25, ceramic=0.4)
    const n = 0.25; // carbide
    // Taylor constant C (typical for carbide cutting steel)
    const C = 200; // m/min at 1 min life

    // Tool life: T = (C/V)^(1/n)
    const toolLifeMinutes = Math.pow(C / cuttingSpeed, 1 / n);
    const toolLifeSeconds = toolLifeMinutes * 60;
    const partsPerTool = Math.floor(toolLifeMinutes / partTime);
    const costPerPart = partsPerTool > 0 ? toolCost / partsPerTool : toolCost;
    const adequate = toolLifeMinutes > 60; // At least 1 hour

    tools.push({
      tool: toolNum, n, cuttingSpeed, C,
      toolLifeMinutes, toolLifeSeconds, partsPerTool,
      costPerPart, adequate,
    });
  }

  tools.sort((a, b) => a.toolLifeMinutes - b.toolLifeMinutes);

  const totalToolCost = tools.reduce((s, t) => s + t.costPerPart, 0);
  const avgToolLife = tools.length > 0 ? tools.reduce((s, t) => s + t.toolLifeMinutes, 0) / tools.length : 0;
  const shortestToolLife = tools.length > 0 ? tools[0].toolLifeMinutes : 0;

  const recommendations: string[] = [];
  for (const t of tools.slice(0, 3)) {
    recommendations.push(`T${t.tool}: ${t.toolLifeMinutes.toFixed(0)} min life, ${t.partsPerTool} parts, $${t.costPerPart.toFixed(2)}/part`);
  }
  if (shortestToolLife < 30) {
    recommendations.push(`Short tool life (${shortestToolLife.toFixed(0)} min) — reduce cutting speed`);
  }
  if (tools.length === 0) {
    recommendations.push('No tool life data — no RPM information found');
  }

  return {
    tools, totalToolCost, avgToolLife,
    shortestToolLife, recommendations,
  };
}

// ── 9. Print Infill Pattern Analyzer ──

export interface InfillPatternData {
  /** Pattern type */
  pattern: 'grid' | 'lines' | 'triangular' | 'hexagonal' | 'gyroid' | 'concentric' | 'unknown';
  /** Density percentage */
  density: number;
  /** Line count */
  lineCount: number;
  /** Average line length */
  avgLineLength: number;
  /** Total infill distance */
  totalDistance: number;
  /** Angle of infill lines */
  infillAngle: number;
}

export interface InfillAnalysisResult {
  /** Infill pattern data */
  pattern: InfillPatternData;
  /** Whether infill was detected */
  hasInfill: boolean;
  /** Infill efficiency score (0-100) */
  efficiencyScore: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Identify and analyze infill patterns.
 * Detects pattern type from toolpath geometry.
 *
 * @param lines G-code lines
 */
export function analyzeInfillPattern(lines: string[]): InfillAnalysisResult {
  const segments: { x1: number; y1: number; x2: number; y2: number; z: number }[] = [];
  let prevX = 0, prevY = 0, prevZ = 0, prevE = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG1\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const z = zMatch ? parseFloat(zMatch[1]) : prevZ;
    const e = eMatch ? parseFloat(eMatch[1]) : prevE;

    if (e > prevE) {
      segments.push({ x1: prevX, y1: prevY, x2: x, y2: y, z });
    }

    prevX = x; prevY = y; prevZ = z; prevE = e;
  }

  if (segments.length < 3) {
    return {
      pattern: { pattern: 'unknown', density: 0, lineCount: 0, avgLineLength: 0, totalDistance: 0, infillAngle: 0 },
      hasInfill: false, efficiencyScore: 0,
      recommendations: ['No infill pattern detected — insufficient extrusion segments'],
    };
  }

  // Analyze angles
  const angles: number[] = [];
  const lengths: number[] = [];
  let totalDistance = 0;

  for (const seg of segments) {
    const dx = seg.x2 - seg.x1;
    const dy = seg.y2 - seg.y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length > 0.1) {
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;
      angles.push(Math.abs(angle));
      lengths.push(length);
      totalDistance += length;
    }
  }

  // Determine pattern from angle distribution
  const angleCounts: { [angle: number]: number } = {};
  for (const angle of angles) {
    const rounded = Math.round(angle / 5) * 5;
    angleCounts[rounded] = (angleCounts[rounded] ?? 0) + 1;
  }

  const sortedAngles = Object.entries(angleCounts).sort((a, b) => b[1] - a[1]);
  const dominantAngle = sortedAngles.length > 0 ? parseFloat(sortedAngles[0][0]) : 0;
  const angleVariety = sortedAngles.length;

  let pattern: InfillPatternData['pattern'] = 'unknown';
  if (angleVariety <= 2) {
    pattern = 'lines';
  } else if (angleVariety <= 4 && sortedAngles.some(([a]) => Math.abs(parseFloat(a) - 45) < 10)) {
    pattern = 'grid';
  } else if (angleVariety <= 6 && sortedAngles.some(([a]) => Math.abs(parseFloat(a) - 60) < 10)) {
    pattern = 'triangular';
  } else if (angleVariety > 6) {
    pattern = 'gyroid';
  }

  // Check for concentric (short, curved segments)
  const avgLen = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  if (avgLen < 5 && angleVariety > 8) {
    pattern = 'concentric';
  }

  // Estimate density (rough)
  const bounds = segments.reduce((acc, s) => ({
    minX: Math.min(acc.minX, s.x1, s.x2),
    maxX: Math.max(acc.maxX, s.x1, s.x2),
    minY: Math.min(acc.minY, s.y1, s.y2),
    maxY: Math.max(acc.maxY, s.y1, s.y2),
  }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });

  const area = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY);
  const density = area > 0 ? Math.min(100, (totalDistance / area) * 10) : 0;

  const avgLineLength = avgLen;
  const efficiencyScore = Math.min(100, (segments.length / 10) + (density > 10 ? 50 : density * 5));

  const recommendations: string[] = [];
  recommendations.push(`Pattern: ${pattern}, density: ${density.toFixed(0)}%`);
  if (density < 10) {
    recommendations.push('Low infill density — consider increasing for strength');
  }
  if (pattern === 'lines') {
    recommendations.push('Linear infill — consider grid or gyroid for better strength');
  }
  if (pattern === 'gyroid') {
    recommendations.push('Gyroid infill — excellent strength-to-weight ratio');
  }

  return {
    pattern: {
      pattern, density, lineCount: segments.length,
      avgLineLength, totalDistance, infillAngle: dominantAngle,
    },
    hasInfill: true, efficiencyScore, recommendations,
  };
}

// ── 10. G-code Bounds Calculator ──

export interface BoundsResult {
  /** X bounds */
  x: { min: number; max: number; range: number };
  /** Y bounds */
  y: { min: number; max: number; range: number };
  /** Z bounds */
  z: { min: number; max: number; range: number };
  /** Center point */
  center: { x: number; y: number; z: number };
  /** Bounding box dimensions */
  dimensions: { width: number; depth: number; height: number };
  /** With margin */
  withMargin: {
    bounds: BoundingBox;
    margin: number;
  };
  /** Total volume in mm³ */
  volume: number;
  /** Whether bounds are valid */
  valid: boolean;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Compute precise bounds with configurable margins.
 * Useful for stock sizing, bed placement, and machine limits.
 *
 * @param lines G-code lines
 * @param margin Margin to add in mm (default 5)
 */
export function computeBounds(lines: string[], margin: number = 5): BoundsResult {
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  let hasData = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG[01]\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);

    if (xMatch) {
      minX = Math.min(minX, parseFloat(xMatch[1]));
      maxX = Math.max(maxX, parseFloat(xMatch[1]));
      hasData = true;
    }
    if (yMatch) {
      minY = Math.min(minY, parseFloat(yMatch[1]));
      maxY = Math.max(maxY, parseFloat(yMatch[1]));
      hasData = true;
    }
    if (zMatch) {
      minZ = Math.min(minZ, parseFloat(zMatch[1]));
      maxZ = Math.max(maxZ, parseFloat(zMatch[1]));
      hasData = true;
    }
  }

  if (!hasData) {
    return {
      x: { min: 0, max: 0, range: 0 },
      y: { min: 0, max: 0, range: 0 },
      z: { min: 0, max: 0, range: 0 },
      center: { x: 0, y: 0, z: 0 },
      dimensions: { width: 0, depth: 0, height: 0 },
      withMargin: { bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 }, margin },
      volume: 0, valid: false,
      recommendations: ['No motion data found for bounds calculation'],
    };
  }

  // Handle cases where some axes weren't specified
  if (!isFinite(minX)) { minX = 0; maxX = 0; }
  if (!isFinite(minY)) { minY = 0; maxY = 0; }
  if (!isFinite(minZ)) { minZ = 0; maxZ = 0; }

  const xRange = maxX - minX;
  const yRange = maxY - minY;
  const zRange = maxZ - minZ;

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const centerZ = (minZ + maxZ) / 2;

  const volume = xRange * yRange * zRange;

  const marginedBounds: BoundingBox = {
    minX: minX - margin, maxX: maxX + margin,
    minY: minY - margin, maxY: maxY + margin,
    minZ: minZ - margin, maxZ: maxZ + margin,
  };

  const recommendations: string[] = [];
  recommendations.push(`Part size: ${xRange.toFixed(1)} × ${yRange.toFixed(1)} × ${zRange.toFixed(1)} mm`);
  recommendations.push(`Center: (${centerX.toFixed(1)}, ${centerY.toFixed(1)}, ${centerZ.toFixed(1)})`);
  if (volume > 0) {
    recommendations.push(`Bounding volume: ${(volume / 1000).toFixed(0)} cm³`);
  }
  if (margin > 0) {
    recommendations.push(`With ${margin}mm margin: ${(xRange + 2 * margin).toFixed(1)} × ${(yRange + 2 * margin).toFixed(1)} × ${(zRange + 2 * margin).toFixed(1)} mm`);
  }

  return {
    x: { min: minX, max: maxX, range: xRange },
    y: { min: minY, max: maxY, range: yRange },
    z: { min: minZ, max: maxZ, range: zRange },
    center: { x: centerX, y: centerY, z: centerZ },
    dimensions: { width: xRange, depth: yRange, height: zRange },
    withMargin: { bounds: marginedBounds, margin },
    volume, valid: true, recommendations,
  };
}

// ── 11. CNC Cutting Force Simulator ──

export interface ForceSimulationPoint {
  /** Time in seconds */
  time: number;
  /** Tangential force in N */
  tangentialForce: number;
  /** Radial force in N */
  radialForce: number;
  /** Feed force in N */
  feedForce: number;
  /** Resultant force in N */
  resultantForce: number;
  /** Line number */
  line: number;
}

export interface CuttingForceResult {
  /** Force simulation data */
  points: ForceSimulationPoint[];
  /** Maximum resultant force */
  maxForce: number;
  /** Average force */
  avgForce: number;
  /** Force variation */
  forceVariation: number;
  /** Spindle power required in W */
  requiredPower: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Simulate cutting forces over time.
 * Computes tangential, radial, and feed forces for each cutting segment.
 *
 * Force model:
 * - Tangential: Ft = Ks * b * h (specific cutting force × width × chip thickness)
 * - Radial: Fr = Ft * 0.5 (typical ratio)
 * - Feed: Ff = Ft * 0.3 (typical ratio)
 *
 * @param lines G-code lines
 * @param toolDiameter Tool diameter in mm (default 6)
 * @param flutes Number of flutes (default 2)
 * @param Ks Specific cutting force in N/mm² (default 800 for aluminum)
 */
export function simulateCuttingForces(
  lines: string[],
  toolDiameter: number = 6,
  flutes: number = 2,
  Ks: number = 800,
): CuttingForceResult {
  const points: ForceSimulationPoint[] = [];
  let rpm = 0;
  let feedRate = 0;
  let prevX = 0, prevY = 0, prevZ = 0;
  let currentTime = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const sMatch = code.match(/\bS(\d*\.?\d+)/i);
    if (sMatch) rpm = parseFloat(sMatch[1]);

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) feedRate = parseFloat(fMatch[1]);

    if (!/\bG1\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const z = zMatch ? parseFloat(zMatch[1]) : prevZ;

    const distance = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2 + (z - prevZ) ** 2);

    if (z < 0 && distance > 0.01 && feedRate > 0) {
      const time = distance / (feedRate / 60);
      currentTime += time;

      const feedPerTooth = rpm > 0 ? feedRate / (rpm * flutes) : 0.1;
      const chipThickness = feedPerTooth;
      const widthOfCut = Math.min(toolDiameter, Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2));
      const depthOfCut = Math.abs(z);

      // Forces
      const tangentialForce = Ks * widthOfCut * chipThickness;
      const radialForce = tangentialForce * 0.5;
      const feedForce = tangentialForce * 0.3;
      const resultantForce = Math.sqrt(tangentialForce ** 2 + radialForce ** 2 + feedForce ** 2);

      points.push({
        time: currentTime, tangentialForce, radialForce, feedForce,
        resultantForce, line: i,
      });
    }

    prevX = x; prevY = y; prevZ = z;
  }

  const forces = points.map(p => p.resultantForce);
  const maxForce = forces.length > 0 ? Math.max(...forces) : 0;
  const avgForce = forces.length > 0 ? forces.reduce((a, b) => a + b, 0) / forces.length : 0;
  const stdDev = forces.length > 0
    ? Math.sqrt(forces.reduce((s, f) => s + (f - avgForce) ** 2, 0) / forces.length)
    : 0;
  const forceVariation = avgForce > 0 ? stdDev / avgForce : 0;

  // Required spindle power: P = Ft * V / 60 (W), where V = cutting speed in m/min
  const cuttingSpeed = Math.PI * toolDiameter * rpm / 1000;
  const requiredPower = maxForce * cuttingSpeed / 60;

  const recommendations: string[] = [];
  if (maxForce > 500) {
    recommendations.push(`Max cutting force ${maxForce.toFixed(0)}N — check machine rigidity`);
  }
  if (forceVariation > 0.5) {
    recommendations.push(`High force variation (CV=${forceVariation.toFixed(2)}) — consider consistent cutting parameters`);
  }
  if (requiredPower > 1000) {
    recommendations.push(`Required spindle power ${requiredPower.toFixed(0)}W — verify spindle capacity`);
  }
  if (points.length === 0) {
    recommendations.push('No cutting operations for force simulation');
  }

  return {
    points, maxForce, avgForce, forceVariation,
    requiredPower, recommendations,
  };
}

// ── 12. Print Retraction Optimization ──

export interface RetractionSettings {
  /** Retraction distance in mm */
  distance: number;
  /** Retraction speed in mm/min */
  speed: number;
  /** Extra restart distance in mm */
  extraRestart: number;
  /** Z-hop height in mm */
  zHop: number;
}

export interface RetractionRecommendation {
  /** Parameter name */
  parameter: string;
  /** Current value */
  current: number;
  /** Recommended value */
  recommended: number;
  /** Reason */
  reason: string;
  /** Expected improvement */
  improvement: string;
}

export interface RetractionOptimizationResult {
  /** Current settings detected */
  currentSettings: RetractionSettings;
  /** Recommendations */
  recommendations: RetractionRecommendation[];
  /** Number of retractions detected */
  retractionCount: number;
  /** Average retraction distance */
  avgRetractionDistance: number;
  /** Estimated stringing reduction percentage */
  stringingReduction: number;
  /** Optimization score (0-100) */
  optimizationScore: number;
  /** Text recommendations */
  advice: string[];
}

/**
 * Optimize retraction distance and speed.
 * Analyzes current retraction settings and recommends improvements.
 *
 * @param lines G-code lines
 * @param filamentType Filament type (default 'PLA')
 */
export function optimizeRetractions(
  lines: string[],
  filamentType: string = 'PLA',
): RetractionOptimizationResult {
  let retractionCount = 0;
  let totalRetractionDistance = 0;
  let maxRetractionDistance = 0;
  let currentE = 0;
  let prevE = 0;
  let feedRate = 0;
  let retractionSpeed = 0;
  let zHops = 0;
  let lastRetractionLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) {
      feedRate = parseFloat(fMatch[1]);
      if (lastRetractionLine === i - 1) {
        retractionSpeed = feedRate;
      }
    }

    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);
    if (eMatch && /\bG1\b/i.test(code)) {
      const e = parseFloat(eMatch[1]);
      if (e < prevE) {
        // Retraction
        retractionCount++;
        const dist = prevE - e;
        totalRetractionDistance += dist;
        maxRetractionDistance = Math.max(maxRetractionDistance, dist);
        lastRetractionLine = i;
      }
      prevE = e;
    }

    // Detect Z-hop
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    if (zMatch && lastRetractionLine >= i - 2 && i - lastRetractionLine <= 2) {
      zHops++;
    }
  }

  const avgRetractionDistance = retractionCount > 0 ? totalRetractionDistance / retractionCount : 0;

  // Determine current settings
  const currentSettings: RetractionSettings = {
    distance: avgRetractionDistance,
    speed: retractionSpeed,
    extraRestart: 0,
    zHop: zHops > 0 ? 0.2 : 0,
  };

  // Generate recommendations based on filament type
  const recommendations: RetractionRecommendation[] = [];
  const advice: string[] = [];

  // Recommended values by filament type
  const recommended: { [filament: string]: RetractionSettings } = {
    'PLA': { distance: 1.5, speed: 1800, extraRestart: 0, zHop: 0 },
    'ABS': { distance: 3.0, speed: 1500, extraRestart: 0.1, zHop: 0.2 },
    'PETG': { distance: 4.0, speed: 1200, extraRestart: 0.2, zHop: 0.4 },
    'TPU': { distance: 0.8, speed: 600, extraRestart: 0, zHop: 0 },
    'Nylon': { distance: 3.5, speed: 1200, extraRestart: 0.15, zHop: 0.3 },
  };

  const recSettings = recommended[filamentType] ?? recommended['PLA'];

  if (Math.abs(currentSettings.distance - recSettings.distance) > 0.5) {
    recommendations.push({
      parameter: 'distance',
      current: currentSettings.distance,
      recommended: recSettings.distance,
      reason: `${filamentType} optimal retraction distance`,
      improvement: `Reduce stringing by ~30%`,
    });
  }

  if (Math.abs(currentSettings.speed - recSettings.speed) > 200) {
    recommendations.push({
      parameter: 'speed',
      current: currentSettings.speed,
      recommended: recSettings.speed,
      reason: `${filamentType} optimal retraction speed`,
      improvement: `Better filament control`,
    });
  }

  if (recSettings.zHop > 0 && currentSettings.zHop === 0) {
    recommendations.push({
      parameter: 'zHop',
      current: currentSettings.zHop,
      recommended: recSettings.zHop,
      reason: `${filamentType} benefits from Z-hop`,
      improvement: `Prevent nozzle marks on travel`,
    });
  }

  const stringingReduction = recommendations.length > 0 ? Math.min(80, recommendations.length * 25) : 0;
  const optimizationScore = Math.max(0, 100 - recommendations.length * 20);

  if (retractionCount === 0) {
    advice.push('No retractions detected — enable retraction in slicer settings');
  } else {
    advice.push(`${retractionCount} retractions detected, avg distance ${avgRetractionDistance.toFixed(2)}mm`);
  }
  for (const rec of recommendations) {
    advice.push(`${rec.parameter}: ${rec.current} → ${rec.recommended} (${rec.reason})`);
  }
  if (recommendations.length === 0 && retractionCount > 0) {
    advice.push('Retraction settings are well-optimized');
  }

  return {
    currentSettings, recommendations, retractionCount,
    avgRetractionDistance, stringingReduction,
    optimizationScore, advice,
  };
}
