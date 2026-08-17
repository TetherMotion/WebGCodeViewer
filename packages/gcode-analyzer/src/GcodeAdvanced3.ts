/**
 * @file GcodeAdvanced3.ts
 * @brief Third batch of advanced G-code analysis features for CNC and 3D printing.
 *
 * This module provides 12 additional high-impact features:
 *  1. Stock/fixture visualization (CNC) — stock block and fixture geometry
 *  2. Tool library management (CNC) — tool definitions with geometry
 *  3. 5-axis movement tracking (CNC) — A/B/C rotary axis parsing
 *  4. Simplified thermal simulation (3DP) — temperature distribution estimation
 *  5. Warp prediction (3DP) — warping risk from thermal gradients
 *  6. G-code editing (Universal) — in-place edit and re-preview
 *  7. Print time graph data (3DP) — timeline data for visualization
 *  8. Custom color palettes (Universal) — user-defined color maps
 *  9. Bookmark export/import (Universal) — JSON save/load
 * 10. Spindle load estimation (CNC) — cutting load from parameters
 * 11. Tool wear estimation (CNC) — tool wear from usage
 * 12. Simplified collision detection (CNC) — toolpath vs stock boundaries
 */

// ── 1. Stock/Fixture Visualization ──

export interface StockModel {
  /** Stock type */
  type: 'block' | 'cylinder' | 'plate';
  /** X dimension in mm */
  length: number;
  /** Y dimension in mm */
  width: number;
  /** Z dimension in mm */
  height: number;
  /** Origin X (corner or center) */
  originX: number;
  /** Origin Y */
  originY: number;
  /** Origin Z */
  originZ: number;
  /** Whether origin is at corner (true) or center (false) */
  originAtCorner: boolean;
  /** Material type */
  material: string;
  /** 3D vertices for rendering (8 corners for block, tessellated for cylinder) */
  vertices: number[];
  /** Wireframe edge indices */
  edges: number[];
}

export interface FixtureModel {
  /** Fixture name */
  name: string;
  /** Fixture type */
  type: 'vise' | 'clamp' | 'plate' | 'custom';
  /** Position X */
  x: number;
  /** Position Y */
  y: number;
  /** Position Z */
  z: number;
  /** Width in X */
  width: number;
  /** Depth in Y */
  depth: number;
  /** Height in Z */
  height: number;
  /** 3D vertices for rendering */
  vertices: number[];
  /** Wireframe edge indices */
  edges: number[];
}

/**
 * Create a stock model from dimensions.
 * Generates 3D vertices and wireframe edges for rendering.
 *
 * @param type Stock type
 * @param length X dimension
 * @param width Y dimension
 * @param height Z dimension
 * @param originX Origin X
 * @param originY Origin Y
 * @param originZ Origin Z
 * @param originAtCorner If true, origin is at bottom-left corner; if false, at center
 * @param material Material name
 */
export function createStockModel(
  type: 'block' | 'cylinder' | 'plate' = 'block',
  length: number,
  width: number,
  height: number,
  originX: number = 0,
  originY: number = 0,
  originZ: number = 0,
  originAtCorner: boolean = true,
  material: string = 'aluminum',
): StockModel {
  const ox = originAtCorner ? originX : originX - length / 2;
  const oy = originAtCorner ? originY : originY - width / 2;
  const oz = originAtCorner ? originZ : originZ - height / 2;

  let vertices: number[];
  let edges: number[];

  if (type === 'block' || type === 'plate') {
    // 8 corners of a box
    vertices = [
      ox, oy, oz,              // 0: bottom-front-left
      ox + length, oy, oz,     // 1: bottom-front-right
      ox + length, oy + width, oz,  // 2: bottom-back-right
      ox, oy + width, oz,      // 3: bottom-back-left
      ox, oy, oz + height,     // 4: top-front-left
      ox + length, oy, oz + height,  // 5: top-front-right
      ox + length, oy + width, oz + height,  // 6: top-back-right
      ox, oy + width, oz + height,  // 7: top-back-left
    ];
    // 12 edges of a box
    edges = [
      0, 1, 1, 2, 2, 3, 3, 0,  // bottom
      4, 5, 5, 6, 6, 7, 7, 4,  // top
      0, 4, 1, 5, 2, 6, 3, 7,  // verticals
    ];
  } else {
    // Cylinder: tessellate into 16 segments
    const segments = 16;
    vertices = [];
    const radius = Math.min(length, width) / 2;
    const cx = ox + length / 2;
    const cy = oy + width / 2;

    // Bottom circle
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      vertices.push(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle), oz);
    }
    // Top circle
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      vertices.push(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle), oz + height);
    }

    edges = [];
    // Bottom circle edges
    for (let i = 0; i < segments; i++) {
      edges.push(i, (i + 1) % segments);
    }
    // Top circle edges
    for (let i = 0; i < segments; i++) {
      edges.push(i + segments, ((i + 1) % segments) + segments);
    }
    // Vertical edges
    for (let i = 0; i < segments; i++) {
      edges.push(i, i + segments);
    }
  }

  return { type, length, width, height, originX, originY, originZ, originAtCorner, material, vertices, edges };
}

/**
 * Create a fixture model (vise, clamp, etc.).
 */
export function createFixture(
  name: string,
  type: 'vise' | 'clamp' | 'plate' | 'custom',
  x: number, y: number, z: number,
  width: number, depth: number, height: number,
): FixtureModel {
  const vertices = [
    x, y, z,
    x + width, y, z,
    x + width, y + depth, z,
    x, y + depth, z,
    x, y, z + height,
    x + width, y, z + height,
    x + width, y + depth, z + height,
    x, y + depth, z + height,
  ];
  const edges = [
    0, 1, 1, 2, 2, 3, 3, 0,
    4, 5, 5, 6, 6, 7, 7, 4,
    0, 4, 1, 5, 2, 6, 3, 7,
  ];

  return { name, type, x, y, z, width, depth, height, vertices, edges };
}

// ── 2. Tool Library Management ──

export interface ToolDefinition {
  /** Tool number */
  toolNumber: number;
  /** Tool name */
  name: string;
  /** Tool type */
  type: 'endmill' | 'ballmill' | 'facemill' | 'drill' | 'reamer' | 'tap' | 'vbit' | 'custom';
  /** Diameter in mm */
  diameter: number;
  /** Flute length in mm */
  fluteLength: number;
  /** Overall length in mm */
  overallLength: number;
  /** Number of flutes */
  flutes: number;
  /** Shank diameter in mm */
  shankDiameter: number;
  /** Taper angle in degrees (for V-bits) */
  taperAngle: number;
  /** Corner radius in mm (for bullnose) */
  cornerRadius: number;
  /** Material */
  material: 'hss' | 'carbide' | 'cobalt' | 'ceramic' | 'diamond';
  /** Coating */
  coating: string;
  /** Max spindle RPM */
  maxRpm: number;
  /** Recommended feed per tooth in mm */
  feedPerTooth: number;
}

/**
 * Default tool library with common tools.
 */
export function getDefaultToolLibrary(): ToolDefinition[] {
  return [
    { toolNumber: 1, name: '6mm End Mill', type: 'endmill', diameter: 6, fluteLength: 20, overallLength: 50, flutes: 4, shankDiameter: 6, taperAngle: 0, cornerRadius: 0, material: 'carbide', coating: 'TiAlN', maxRpm: 24000, feedPerTooth: 0.05 },
    { toolNumber: 2, name: '3mm End Mill', type: 'endmill', diameter: 3, fluteLength: 12, overallLength: 40, flutes: 2, shankDiameter: 3, taperAngle: 0, cornerRadius: 0, material: 'carbide', coating: 'TiAlN', maxRpm: 30000, feedPerTooth: 0.03 },
    { toolNumber: 3, name: '6mm Ball Mill', type: 'ballmill', diameter: 6, fluteLength: 20, overallLength: 50, flutes: 2, shankDiameter: 6, taperAngle: 0, cornerRadius: 3, material: 'carbide', coating: 'AlCrN', maxRpm: 24000, feedPerTooth: 0.04 },
    { toolNumber: 4, name: '6mm Face Mill', type: 'facemill', diameter: 50, fluteLength: 10, overallLength: 40, flutes: 6, shankDiameter: 25, taperAngle: 0, cornerRadius: 0, material: 'carbide', coating: 'TiAlN', maxRpm: 18000, feedPerTooth: 0.1 },
    { toolNumber: 5, name: '5mm Drill', type: 'drill', diameter: 5, fluteLength: 30, overallLength: 60, flutes: 2, shankDiameter: 5, taperAngle: 118, cornerRadius: 0, material: 'hss', coating: 'TiN', maxRpm: 12000, feedPerTooth: 0.1 },
    { toolNumber: 6, name: '60° V-Bit', type: 'vbit', diameter: 10, fluteLength: 15, overallLength: 40, flutes: 2, shankDiameter: 6, taperAngle: 60, cornerRadius: 0, material: 'carbide', coating: 'TiAlN', maxRpm: 24000, feedPerTooth: 0.05 },
  ];
}

/**
 * Parse tool definitions from G-code comments.
 * Some CAM systems output tool definitions as comments.
 *
 * @param lines G-code lines
 */
export function parseToolDefinitions(lines: string[]): ToolDefinition[] {
  const tools: Map<number, ToolDefinition> = new Map();
  let currentTool = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Track tool changes
    const tMatch = line.match(/\bT(\d+)\b/i);
    if (tMatch) currentTool = parseInt(tMatch[1]);

    // Parse tool definition comments
    // Format: ; TOOL: T1 D6.0 L50 F4 CARBIDE TiAlN
    const toolMatch = line.match(/;\s*TOOL:\s*T(\d+)\s+D(\d*\.?\d+)\s+L(\d*\.?\d+)\s+F(\d+)\s+(\w+)\s+(\w+)?/i);
    if (toolMatch) {
      const toolNum = parseInt(toolMatch[1]);
      tools.set(toolNum, {
        toolNumber: toolNum,
        name: `Tool ${toolNum}`,
        type: 'endmill',
        diameter: parseFloat(toolMatch[2]),
        fluteLength: parseFloat(toolMatch[3]),
        overallLength: parseFloat(toolMatch[3]),
        flutes: parseInt(toolMatch[4]),
        shankDiameter: parseFloat(toolMatch[2]),
        taperAngle: 0,
        cornerRadius: 0,
        material: (toolMatch[5] || 'carbide').toLowerCase() as ToolDefinition['material'],
        coating: toolMatch[6] || 'none',
        maxRpm: 24000,
        feedPerTooth: 0.05,
      });
    }

    // Alternative: ; T1 D=6.0 TYPE=ENDMILL
    const altMatch = line.match(/;\s*T(\d+)\s+D=(\d*\.?\d+)\s+TYPE=(\w+)/i);
    if (altMatch) {
      const toolNum = parseInt(altMatch[1]);
      const type = altMatch[3].toLowerCase();
      if (tools.has(toolNum)) {
        const tool = tools.get(toolNum)!;
        tool.type = type as ToolDefinition['type'];
        tool.diameter = parseFloat(altMatch[2]);
      } else {
        tools.set(toolNum, {
          toolNumber: toolNum,
          name: `Tool ${toolNum}`,
          type: type as ToolDefinition['type'],
          diameter: parseFloat(altMatch[2]),
          fluteLength: 20,
          overallLength: 50,
          flutes: 4,
          shankDiameter: parseFloat(altMatch[2]),
          taperAngle: 0,
          cornerRadius: 0,
          material: 'carbide',
          coating: 'none',
          maxRpm: 24000,
          feedPerTooth: 0.05,
        });
      }
    }
  }

  return Array.from(tools.values()).sort((a, b) => a.toolNumber - b.toolNumber);
}

// ── 3. 5-Axis Movement Tracking ──

export interface RotaryAxisMove {
  /** G-code line number */
  lineNumber: number;
  /** Axis: A, B, or C */
  axis: 'A' | 'B' | 'C';
  /** Angle in degrees */
  angle: number;
  /** Previous angle */
  previousAngle: number;
  /** Delta angle */
  deltaAngle: number;
  /** Feed rate */
  feedRate: number;
}

export interface AxisState {
  /** Current A angle in degrees */
  a: number;
  /** Current B angle in degrees */
  b: number;
  /** Current C angle in degrees */
  c: number;
  /** Current X position */
  x: number;
  /** Current Y position */
  y: number;
  /** Current Z position */
  z: number;
}

/**
 * Parse 5-axis rotary movements (A, B, C axes) from G-code.
 * Tracks tool orientation changes throughout the program.
 *
 * @param lines G-code lines
 */
export function parseRotaryAxes(lines: string[]): {
  moves: RotaryAxisMove[];
  finalState: AxisState;
} {
  const moves: RotaryAxisMove[] = [];
  let state: AxisState = { a: 0, b: 0, c: 0, x: 0, y: 0, z: 0 };
  let currentFeedRate = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) currentFeedRate = parseFloat(fMatch[1]);

    const aMatch = code.match(/\bA(-?\d*\.?\d+)/i);
    const bMatch = code.match(/\bB(-?\d*\.?\d+)/i);
    const cMatch = code.match(/\bC(-?\d*\.?\d+)/i);
    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);

    if (aMatch) {
      const newA = parseFloat(aMatch[1]);
      moves.push({
        lineNumber: i, axis: 'A', angle: newA,
        previousAngle: state.a, deltaAngle: newA - state.a, feedRate: currentFeedRate,
      });
      state.a = newA;
    }
    if (bMatch) {
      const newB = parseFloat(bMatch[1]);
      moves.push({
        lineNumber: i, axis: 'B', angle: newB,
        previousAngle: state.b, deltaAngle: newB - state.b, feedRate: currentFeedRate,
      });
      state.b = newB;
    }
    if (cMatch) {
      const newC = parseFloat(cMatch[1]);
      moves.push({
        lineNumber: i, axis: 'C', angle: newC,
        previousAngle: state.c, deltaAngle: newC - state.c, feedRate: currentFeedRate,
      });
      state.c = newC;
    }
    if (xMatch) state.x = parseFloat(xMatch[1]);
    if (yMatch) state.y = parseFloat(yMatch[1]);
    if (zMatch) state.z = parseFloat(zMatch[1]);
  }

  return { moves, finalState: state };
}

/**
 * Compute tool orientation vector from rotary axis angles.
 * Assumes A rotates around X, B around Y, C around Z.
 */
export function computeToolOrientation(a: number, b: number, c: number): { x: number; y: number; z: number } {
  // Default tool direction: -Z (pointing down)
  let dx = 0, dy = 0, dz = -1;

  // Apply A rotation (around X axis)
  const aRad = a * Math.PI / 180;
  const cosA = Math.cos(aRad), sinA = Math.sin(aRad);
  const dy1 = dy * cosA - dz * sinA;
  const dz1 = dy * sinA + dz * cosA;
  dy = dy1; dz = dz1;

  // Apply B rotation (around Y axis)
  const bRad = b * Math.PI / 180;
  const cosB = Math.cos(bRad), sinB = Math.sin(bRad);
  const dx2 = dx * cosB + dz * sinB;
  const dz2 = -dx * sinB + dz * cosB;
  dx = dx2; dz = dz2;

  // Apply C rotation (around Z axis)
  const cRad = c * Math.PI / 180;
  const cosC = Math.cos(cRad), sinC = Math.sin(cRad);
  const dx3 = dx * cosC - dy * sinC;
  const dy3 = dx * sinC + dy * cosC;
  dx = dx3; dy = dy3;

  return { x: dx, y: dy, z: dz };
}

// ── 4. Simplified Thermal Simulation ──

export interface ThermalPoint {
  /** X position */
  x: number;
  /** Y position */
  y: number;
  /** Z height */
  z: number;
  /** Estimated temperature in °C */
  temperature: number;
  /** G-code line number */
  lineNumber: number;
}

export interface ThermalSimulationResult {
  /** Thermal points sampled along the path */
  points: ThermalPoint[];
  /** Maximum estimated temperature */
  maxTemp: number;
  /** Minimum estimated temperature */
  minTemp: number;
  /** Average temperature */
  avgTemp: number;
  /** Heat accumulation zones (areas with consistently high temp) */
  hotZones: { x: number; y: number; z: number; avgTemp: number; pointCount: number }[];
}

/**
 * Estimate temperature distribution during printing.
 * Uses a simplified model: each point's temperature depends on:
 * - Hotend temperature (set point)
 * - Time since extrusion (cooling)
 * - Layer time (shorter = hotter)
 * - Fan cooling effect
 *
 * @param lines G-code lines
 * @param hotendTemp Hotend temperature in °C (default 210)
 * @param bedTemp Bed temperature in °C (default 60)
 * @param fanSpeed Fan speed 0-255 (default 128)
 * @param ambientTemp Ambient temperature in °C (default 25)
 */
export function simulateThermal(
  lines: string[],
  hotendTemp: number = 210,
  bedTemp: number = 60,
  fanSpeed: number = 128,
  ambientTemp: number = 25,
): ThermalSimulationResult {
  const points: ThermalPoint[] = [];
  let prevX = 0, prevY = 0, prevZ = 0;
  let prevE = 0;
  let currentFeedRate = 0;
  let currentFanSpeed = fanSpeed;
  let currentHotend = hotendTemp;
  let lastExtrusionTime = 0;
  let currentTime = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Track temperature changes
    const sMatch = code.match(/\bS(\d*\.?\d+)/i);
    if (sMatch && /\bM104\b/i.test(code)) currentHotend = parseFloat(sMatch[1]);
    if (sMatch && /\bM106\b/i.test(code)) currentFanSpeed = parseFloat(sMatch[1]);

    if (!/\bG[01]\b/i.test(code)) continue;

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) currentFeedRate = parseFloat(fMatch[1]);

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const z = zMatch ? parseFloat(zMatch[1]) : prevZ;

    if (currentFeedRate > 0) {
      const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2 + (z - prevZ) ** 2);
      currentTime += dist / (currentFeedRate / 60);
    }

    if (eMatch) {
      const newE = parseFloat(eMatch[1]);
      const isExtruding = newE > prevE;

      if (isExtruding) {
        // Temperature model:
        // - Base: hotend temp
        // - Cooling: exponential decay based on time since last extrusion
        // - Fan: additional cooling proportional to fan speed
        // - Bed: warming from bed proximity (lower Z = more bed effect)
        const timeSinceExtrusion = currentTime - lastExtrusionTime;
        const fanCooling = (currentFanSpeed / 255) * 30; // up to 30°C cooling
        const bedWarming = Math.max(0, (bedTemp - ambientTemp) * Math.exp(-z * 0.1));
        const coolingFactor = Math.exp(-timeSinceExtrusion * 0.05);
        const temp = ambientTemp + (currentHotend - ambientTemp) * coolingFactor - fanCooling + bedWarming;

        points.push({ x, y, z, temperature: temp, lineNumber: i });
        lastExtrusionTime = currentTime;
      }
      prevE = newE;
    }

    prevX = x; prevY = y; prevZ = z;
  }

  if (points.length === 0) {
    return { points: [], maxTemp: 0, minTemp: 0, avgTemp: 0, hotZones: [] };
  }

  const temps = points.map(p => p.temperature);
  const maxTemp = Math.max(...temps);
  const minTemp = Math.min(...temps);
  const avgTemp = temps.reduce((a, b) => a + b, 0) / temps.length;

  // Find hot zones: cluster points by position and find high-temp clusters
  const hotZones: ThermalSimulationResult['hotZones'] = [];
  const gridSize = 10; // 10mm grid
  const zoneMap = new Map<string, { x: number; y: number; z: number; temps: number[] }>();

  for (const p of points) {
    const key = `${Math.floor(p.x / gridSize)}_${Math.floor(p.y / gridSize)}_${Math.floor(p.z / gridSize)}`;
    const zone = zoneMap.get(key) ?? { x: p.x, y: p.y, z: p.z, temps: [] };
    zone.temps.push(p.temperature);
    zoneMap.set(key, zone);
  }

  for (const [, zone] of zoneMap) {
    if (zone.temps.length >= 3) {
      const zoneAvg = zone.temps.reduce((a, b) => a + b, 0) / zone.temps.length;
      if (zoneAvg > avgTemp * 1.1) {
        hotZones.push({ x: zone.x, y: zone.y, z: zone.z, avgTemp: zoneAvg, pointCount: zone.temps.length });
      }
    }
  }

  hotZones.sort((a, b) => b.avgTemp - a.avgTemp);

  return { points, maxTemp, minTemp, avgTemp, hotZones: hotZones.slice(0, 10) };
}

// ── 5. Warp Prediction ──

export interface WarpPredictionResult {
  /** Overall warp risk score (0-1, higher = more risk) */
  riskScore: number;
  /** Risk level */
  level: 'low' | 'moderate' | 'high' | 'severe';
  /** Contributing factors */
  factors: {
    /** Large temperature gradient between layers */
    thermalGradient: number;
    /** Thin walls at risk */
    thinWalls: number;
    /** Large flat areas (more likely to warp) */
    largeFlatAreas: number;
    /** First layer adhesion risk */
    firstLayerAdhesion: number;
    /** Corner sharpness (sharp corners warp more) */
    cornerSharpness: number;
  };
  /** Recommendations */
  recommendations: string[];
  /** High-risk zones */
  riskZones: { x: number; y: number; z: number; risk: number }[];
}

/**
 * Predict warping risk based on thermal simulation and geometry.
 *
 * @param thermalResult Thermal simulation result
 * @param bounds Part bounds
 * @param layerHeight Layer height in mm
 * @param bedTemp Bed temperature in °C
 * @param ambientTemp Ambient temperature in °C
 */
export function predictWarping(
  thermalResult: ThermalSimulationResult,
  bounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number },
  layerHeight: number = 0.2,
  bedTemp: number = 60,
  ambientTemp: number = 25,
): WarpPredictionResult {
  const factors = {
    thermalGradient: 0,
    thinWalls: 0,
    largeFlatAreas: 0,
    firstLayerAdhesion: 0,
    cornerSharpness: 0,
  };

  const recommendations: string[] = [];

  // Thermal gradient: large difference between max and min temp
  if (thermalResult.points.length > 0) {
    const tempRange = thermalResult.maxTemp - thermalResult.minTemp;
    factors.thermalGradient = Math.min(1, tempRange / 100);
    if (factors.thermalGradient > 0.5) {
      recommendations.push('Large thermal gradient detected — consider increasing bed temperature or using an enclosure');
    }
  }

  // Large flat areas: parts with large XY footprint and low Z are more prone to warping
  const xySize = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY);
  const zSize = bounds.maxZ - bounds.minZ;
  if (xySize > 10000 && zSize < 20) {
    factors.largeFlatAreas = Math.min(1, xySize / 50000);
    recommendations.push('Large flat area detected — consider adding a brim or raft');
  }

  // First layer adhesion: if bed temp is too low relative to hotend
  const tempDiff = thermalResult.maxTemp - bedTemp;
  if (tempDiff > 150) {
    factors.firstLayerAdhesion = Math.min(1, (tempDiff - 150) / 50);
    recommendations.push('High temperature difference between hotend and bed — increase bed temperature for better adhesion');
  }

  // Corner sharpness: if part has sharp corners (bounds ratio)
  const aspectRatio = Math.max(
    (bounds.maxX - bounds.minX) / Math.max(1, bounds.maxY - bounds.minY),
    (bounds.maxY - bounds.minY) / Math.max(1, bounds.maxX - bounds.minX),
  );
  if (aspectRatio > 3) {
    factors.cornerSharpness = Math.min(1, (aspectRatio - 3) / 5);
  }

  // Thin walls: if layer height is large relative to part size
  if (layerHeight > 0.3) {
    factors.thinWalls = Math.min(1, (layerHeight - 0.3) / 0.2);
    recommendations.push('Thick layer height may increase warping — consider reducing layer height');
  }

  // Overall risk score (weighted average)
  const riskScore = (
    factors.thermalGradient * 0.35 +
    factors.largeFlatAreas * 0.25 +
    factors.firstLayerAdhesion * 0.2 +
    factors.cornerSharpness * 0.1 +
    factors.thinWalls * 0.1
  );

  let level: 'low' | 'moderate' | 'high' | 'severe';
  if (riskScore >= 0.7) level = 'severe';
  else if (riskScore >= 0.5) level = 'high';
  else if (riskScore >= 0.3) level = 'moderate';
  else level = 'low';

  // Risk zones from thermal hot zones
  const riskZones = thermalResult.hotZones.map(z => ({
    x: z.x, y: z.y, z: z.z,
    risk: Math.min(1, z.avgTemp / thermalResult.maxTemp),
  }));

  if (recommendations.length === 0) {
    recommendations.push('No significant warping risk detected');
  }

  return { riskScore, level, factors, recommendations, riskZones };
}

// ── 6. G-code Editing ──

/**
 * Apply an edit operation to G-code lines.
 * Supports: insert, delete, replace, insert block.
 *
 * @param lines G-code lines
 * @param operation Edit operation
 */
export function editGcode(
  lines: string[],
  operation:
    | { type: 'insert'; lineNumber: number; content: string }
    | { type: 'delete'; lineNumber: number }
    | { type: 'replace'; lineNumber: number; content: string }
    | { type: 'insertBlock'; lineNumber: number; contents: string[] }
    | { type: 'deleteRange'; startLine: number; endLine: number },
): string[] {
  const result = [...lines];

  switch (operation.type) {
    case 'insert':
      result.splice(operation.lineNumber, 0, operation.content);
      break;
    case 'delete':
      result.splice(operation.lineNumber, 1);
      break;
    case 'replace':
      if (operation.lineNumber >= 0 && operation.lineNumber < result.length) {
        result[operation.lineNumber] = operation.content;
      }
      break;
    case 'insertBlock':
      result.splice(operation.lineNumber, 0, ...operation.contents);
      break;
    case 'deleteRange':
      result.splice(operation.startLine, operation.endLine - operation.startLine + 1);
      break;
  }

  return result;
}

/**
 * Find and replace text in G-code lines.
 *
 * @param lines G-code lines
 * @param search Search string
 * @param replace Replacement string
 * @param useRegex Whether to use regex
 */
export function findReplaceGcode(
  lines: string[],
  search: string,
  replace: string,
  useRegex: boolean = false,
): { result: string[]; replacements: number } {
  let replacements = 0;
  const result = lines.map(line => {
    if (useRegex) {
      try {
        const regex = new RegExp(search, 'gi');
        const newLine = line.replace(regex, () => {
          replacements++;
          return replace;
        });
        return newLine;
      } catch {
        return line;
      }
    } else {
      if (line.includes(search)) {
        const count = line.split(search).length - 1;
        replacements += count;
        return line.split(search).join(replace);
      }
      return line;
    }
  });

  return { result, replacements };
}

// ── 7. Print Time Graph Data ──

export interface PrintTimeGraphData {
  /** Timeline points */
  points: {
    /** Time in seconds */
    time: number;
    /** Cumulative progress (0-1) */
    progress: number;
    /** Current Z height */
    zHeight: number;
    /** Current layer */
    layer: number;
    /** Current feature type (if available) */
    featureType: string | null;
    /** Current feed rate */
    feedRate: number;
  }[];
  /** Total estimated time in seconds */
  totalTime: number;
  /** Per-layer time data */
  layerTimes: { layer: number; zHeight: number; time: number; cumulativeTime: number }[];
  /** Per-feature time data */
  featureTimes: { feature: string; time: number; percentage: number }[];
}

/**
 * Build print time graph data from G-code.
 * Creates a timeline that can be visualized as a graph.
 *
 * @param lines G-code lines
 * @param zLayers Z-layer info
 */
export function buildPrintTimeGraph(
  lines: string[],
  zLayers: { layerIndex: number; zHeight: number; startLine: number; endLine: number }[],
): PrintTimeGraphData {
  const points: PrintTimeGraphData['points'] = [];
  const layerTimes: PrintTimeGraphData['layerTimes'] = [];
  let prevX = 0, prevY = 0, prevZ = 0;
  let prevE = 0;
  let currentFeedRate = 0;
  let currentTime = 0;
  let currentLayer = 0;
  let currentFeatureType: string | null = null;
  let layerStartTime = 0;
  const featureTimeMap = new Map<string, number>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Track layer changes
    const layerMatch = line.match(/;LAYER:(\d+)/i);
    if (layerMatch) {
      if (currentLayer > 0 || currentTime > 0) {
        layerTimes.push({
          layer: currentLayer,
          zHeight: prevZ,
          time: currentTime - layerStartTime,
          cumulativeTime: currentTime,
        });
      }
      currentLayer = parseInt(layerMatch[1]);
      layerStartTime = currentTime;
      continue;
    }

    // Track feature type
    const typeMatch = line.match(/;TYPE:(.+)/i);
    if (typeMatch) {
      currentFeatureType = typeMatch[1].trim();
      continue;
    }

    if (!line.startsWith('G1') && !line.startsWith('g1')) continue;

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

    if (currentFeedRate > 0) {
      const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2 + (z - prevZ) ** 2);
      const moveTime = dist / (currentFeedRate / 60);
      currentTime += moveTime;

      if (eMatch) {
        const newE = parseFloat(eMatch[1]);
        if (newE > prevE && currentFeatureType) {
          featureTimeMap.set(currentFeatureType, (featureTimeMap.get(currentFeatureType) ?? 0) + moveTime);
        }
        prevE = newE;
      }

      if (points.length === 0 || currentTime - points[points.length - 1].time > 1.0) {
        points.push({
          time: currentTime,
          progress: 0, // will be set after total is known
          zHeight: z,
          layer: currentLayer,
          featureType: currentFeatureType,
          feedRate: currentFeedRate,
        });
      }
    }

    prevX = x; prevY = y; prevZ = z;
  }

  // Close last layer
  if (currentLayer > 0 || currentTime > 0) {
    layerTimes.push({
      layer: currentLayer,
      zHeight: prevZ,
      time: currentTime - layerStartTime,
      cumulativeTime: currentTime,
    });
  }

  // Set progress values
  for (const p of points) {
    p.progress = currentTime > 0 ? p.time / currentTime : 0;
  }

  // Build feature times
  const totalTime = currentTime;
  const featureTimes: PrintTimeGraphData['featureTimes'] = [];
  for (const [feature, time] of featureTimeMap) {
    featureTimes.push({
      feature,
      time,
      percentage: totalTime > 0 ? (time / totalTime) * 100 : 0,
    });
  }
  featureTimes.sort((a, b) => b.time - a.time);

  return { points, totalTime, layerTimes, featureTimes };
}

// ── 8. Custom Color Palettes ──

export interface CustomPalette {
  /** Palette name */
  name: string;
  /** Color stops: [position (0-1), [R, G, B]] */
  stops: [number, [number, number, number]][];
  /** Author */
  author: string;
  /** Description */
  description: string;
}

/**
 * Create a custom color palette from color stops.
 *
 * @param name Palette name
 * @param stops Color stops
 * @param author Author name
 * @param description Description
 */
export function createCustomPalette(
  name: string,
  stops: [number, [number, number, number]][],
  author: string = 'user',
  description: string = '',
): CustomPalette {
  // Sort stops by position
  const sortedStops = [...stops].sort((a, b) => a[0] - b[0]);
  return { name, stops: sortedStops, author, description };
}

/**
 * Generate a color LUT (lookup table) from a custom palette.
 *
 * @param palette Custom palette
 * @param size Number of colors in the LUT (default 256)
 */
export function generatePaletteLUT(palette: CustomPalette, size: number = 256): Uint8Array {
  const lut = new Uint8Array(size * 3);

  for (let i = 0; i < size; i++) {
    const pos = i / (size - 1);
    const [r, g, b] = interpolateColor(palette.stops, pos);
    lut[i * 3] = r;
    lut[i * 3 + 1] = g;
    lut[i * 3 + 2] = b;
  }

  return lut;
}

function interpolateColor(stops: [number, [number, number, number]][], pos: number): [number, number, number] {
  if (stops.length === 0) return [128, 128, 128];
  if (stops.length === 1) return stops[0][1];
  if (pos <= stops[0][0]) return stops[0][1];
  if (pos >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];

  for (let i = 0; i < stops.length - 1; i++) {
    const [pos1, color1] = stops[i];
    const [pos2, color2] = stops[i + 1];
    if (pos >= pos1 && pos <= pos2) {
      const t = (pos - pos1) / (pos2 - pos1);
      return [
        Math.round(color1[0] + (color2[0] - color1[0]) * t),
        Math.round(color1[1] + (color2[1] - color1[1]) * t),
        Math.round(color1[2] + (color2[2] - color1[2]) * t),
      ];
    }
  }

  return stops[stops.length - 1][1];
}

/**
 * Export a custom palette as JSON.
 */
export function exportPalette(palette: CustomPalette): string {
  return JSON.stringify(palette, null, 2);
}

/**
 * Import a custom palette from JSON.
 */
export function importPalette(json: string): CustomPalette {
  const data = JSON.parse(json);
  return {
    name: data.name ?? 'imported',
    stops: data.stops ?? [],
    author: data.author ?? 'imported',
    description: data.description ?? '',
  };
}

// ── 9. Bookmark Export/Import ──

export interface BookmarkData {
  /** Line number */
  lineNumber: number;
  /** Bookmark label */
  label: string;
  /** Optional annotation */
  annotation: string;
  /** Timestamp */
  timestamp: string;
}

/**
 * Export bookmarks as JSON.
 *
 * @param bookmarks Array of bookmark data
 */
export function exportBookmarks(bookmarks: BookmarkData[]): string {
  return JSON.stringify({
    version: '1.0',
    exported: new Date().toISOString(),
    bookmarks,
  }, null, 2);
}

/**
 * Import bookmarks from JSON.
 *
 * @param json JSON string
 */
export function importBookmarks(json: string): BookmarkData[] {
  const data = JSON.parse(json);
  if (data.bookmarks && Array.isArray(data.bookmarks)) {
    return data.bookmarks.map((b: BookmarkData) => ({
      lineNumber: b.lineNumber,
      label: b.label ?? '',
      annotation: b.annotation ?? '',
      timestamp: b.timestamp ?? new Date().toISOString(),
    }));
  }
  return [];
}

// ── 10. Spindle Load Estimation ──

export interface SpindleLoadEstimate {
  /** G-code line number */
  lineNumber: number;
  /** Estimated spindle load in kW */
  load: number;
  /** Spindle RPM */
  rpm: number;
  /** Feed rate in mm/min */
  feedRate: number;
  /** Cut depth in mm */
  cutDepth: number;
  /** Cut width in mm */
  cutWidth: number;
  /** Material removal rate in cm³/min */
  mrr: number;
  /** Load percentage (0-100%) */
  loadPercentage: number;
}

/**
 * Estimate spindle load from cutting parameters.
 * Uses the formula: P = MRR * Kp, where Kp is the specific cutting energy.
 *
 * @param lines G-code lines
 * @param toolDiameter Tool diameter in mm
 * @param materialKp Specific cutting energy in kW·min/cm³ (default: aluminum ~0.7)
 * @param maxSpindlePower Max spindle power in kW (default 5kW)
 */
export function estimateSpindleLoad(
  lines: string[],
  toolDiameter: number = 6,
  materialKp: number = 0.7,
  maxSpindlePower: number = 5,
): SpindleLoadEstimate[] {
  const estimates: SpindleLoadEstimate[] = [];
  let prevZ = 0;
  let currentRpm = 0;
  let currentFeedRate = 0;
  let prevE = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Track spindle speed
    const sMatch = code.match(/\bS(\d*\.?\d+)/i);
    if (sMatch && /\bM[034]\b/i.test(code)) currentRpm = parseFloat(sMatch[1]);

    // Track feed rate
    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) currentFeedRate = parseFloat(fMatch[1]);

    if (!/\bG1\b/i.test(code)) continue;

    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

    if (zMatch) {
      const newZ = parseFloat(zMatch[1]);
      const cutDepth = Math.abs(prevZ - newZ);

      // Only estimate for cutting moves (has Z change or E increase)
      const isCutting = cutDepth > 0.01 || (eMatch && parseFloat(eMatch[1]) > prevE);

      if (isCutting && currentRpm > 0 && currentFeedRate > 0) {
        // MRR = cutWidth * cutDepth * feedRate (mm³/min → cm³/min)
        const cutWidth = toolDiameter;
        const effectiveDepth = cutDepth > 0 ? cutDepth : toolDiameter * 0.5; // assume 50% diameter if no Z change
        const mrr = (cutWidth * effectiveDepth * currentFeedRate) / 1000; // mm³/min → cm³/min

        // Power = MRR * Kp
        const load = mrr * materialKp;
        const loadPercentage = Math.min(100, (load / maxSpindlePower) * 100);

        estimates.push({
          lineNumber: i,
          load,
          rpm: currentRpm,
          feedRate: currentFeedRate,
          cutDepth: effectiveDepth,
          cutWidth,
          mrr,
          loadPercentage,
        });
      }

      prevZ = newZ;
    }

    if (eMatch) prevE = parseFloat(eMatch[1]);
  }

  return estimates;
}

// ── 11. Tool Wear Estimation ──

export interface ToolWearEstimate {
  /** Tool number */
  toolNumber: number;
  /** Total cutting time in seconds */
  cuttingTime: number;
  /** Total cutting distance in mm */
  cuttingDistance: number;
  /** Estimated wear (0-1, higher = more worn) */
  wear: number;
  /** Tool life remaining percentage */
  lifeRemaining: number;
  /** Estimated tool life in minutes (based on material) */
  estimatedLifeMinutes: number;
  /** Recommendation */
  recommendation: string;
}

/**
 * Estimate tool wear from cutting parameters.
 * Uses the Taylor tool life equation: T = C / V^n
 *
 * @param lines G-code lines
 * @param toolLibrary Tool definitions
 * @param materialHardness Material hardness (default: aluminum ~100 BHN)
 */
export function estimateToolWear(
  lines: string[],
  toolLibrary: ToolDefinition[] = getDefaultToolLibrary(),
  materialHardness: number = 100,
): ToolWearEstimate[] {
  const toolData = new Map<number, { cuttingTime: number; cuttingDistance: number; rpm: number; feedRate: number }>();
  let currentTool = 0;
  let currentRpm = 0;
  let currentFeedRate = 0;
  let prevX = 0, prevY = 0, prevZ = 0;
  let prevE = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    // Track tool changes
    const tMatch = code.match(/\bT(\d+)\b/i);
    if (tMatch && /\bM6\b/i.test(code)) {
      currentTool = parseInt(tMatch[1]);
      if (!toolData.has(currentTool)) {
        toolData.set(currentTool, { cuttingTime: 0, cuttingDistance: 0, rpm: 0, feedRate: 0 });
      }
    }

    // Track spindle and feed
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

    if (isCutting && currentFeedRate > 0) {
      const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2 + (z - prevZ) ** 2);
      const time = dist / (currentFeedRate / 60);

      const data = toolData.get(currentTool);
      if (data) {
        data.cuttingTime += time;
        data.cuttingDistance += dist;
        data.rpm = currentRpm;
        data.feedRate = currentFeedRate;
      }
    }

    if (eMatch) prevE = parseFloat(eMatch[1]);
    prevX = x; prevY = y; prevZ = z;
  }

  const results: ToolWearEstimate[] = [];
  for (const [toolNum, data] of toolData) {
    const tool = toolLibrary.find(t => t.toolNumber === toolNum);
    const diameter = tool?.diameter ?? 6;

    // Cutting speed (surface speed) in m/min
    const cuttingSpeed = (data.rpm * Math.PI * diameter) / 1000;

    // Taylor tool life: T = C / V^n
    // For carbide cutting aluminum: C ≈ 500, n ≈ 0.2
    // For HSS cutting aluminum: C ≈ 200, n ≈ 0.15
    const isCarbide = tool?.material === 'carbide';
    const C = isCarbide ? 500 : 200;
    const n = isCarbide ? 0.2 : 0.15;
    const adjustedC = C * (100 / materialHardness); // adjust for material hardness
    const estimatedLifeMinutes = cuttingSpeed > 0 ? adjustedC / Math.pow(cuttingSpeed, n) : 60;

    const usedMinutes = data.cuttingTime / 60;
    const wear = Math.min(1, usedMinutes / estimatedLifeMinutes);
    const lifeRemaining = Math.max(0, (1 - wear) * 100);

    let recommendation: string;
    if (wear > 0.8) recommendation = 'Tool needs replacement — wear critical';
    else if (wear > 0.6) recommendation = 'Tool approaching end of life — plan replacement';
    else if (wear > 0.3) recommendation = 'Tool showing wear — monitor quality';
    else recommendation = 'Tool in good condition';

    results.push({
      toolNumber: toolNum,
      cuttingTime: data.cuttingTime,
      cuttingDistance: data.cuttingDistance,
      wear,
      lifeRemaining,
      estimatedLifeMinutes,
      recommendation,
    });
  }

  return results.sort((a, b) => a.toolNumber - b.toolNumber);
}

// ── 12. Simplified Collision Detection ──

export interface CollisionViolation {
  /** G-code line number */
  lineNumber: number;
  /** Type of collision */
  type: 'toolpath-stock' | 'toolpath-fixture' | 'rapid-into-stock' | 'toolholder-collision';
  /** Position of the collision */
  position: { x: number; y: number; z: number };
  /** Description */
  description: string;
  /** Severity */
  severity: 'warning' | 'error';
}

/**
 * Check for collisions between toolpath and stock/fixture boundaries.
 * This is a simplified check that verifies the toolpath stays within
 * the stock boundaries and doesn't collide with fixtures.
 *
 * @param lines G-code lines
 * @param stock Stock model
 * @param fixtures Array of fixture models
 * @param toolRadius Tool radius for offset checking
 */
export function checkCollisions(
  lines: string[],
  stock: StockModel,
  fixtures: FixtureModel[] = [],
  toolRadius: number = 3,
): CollisionViolation[] {
  const violations: CollisionViolation[] = [];
  let prevX = 0, prevY = 0, prevZ = 0;
  let prevIsRapid = false;
  let currentZ = 0;

  // Stock bounds
  const stockMinX = stock.originAtCorner ? stock.originX : stock.originX - stock.length / 2;
  const stockMaxX = stockMinX + stock.length;
  const stockMinY = stock.originAtCorner ? stock.originY : stock.originY - stock.width / 2;
  const stockMaxY = stockMinY + stock.width;
  const stockMinZ = stock.originAtCorner ? stock.originZ : stock.originZ - stock.height / 2;
  const stockMaxZ = stockMinZ + stock.height;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const isRapid = /\bG0\b/i.test(code);
    const isG1 = /\bG1\b/i.test(code);

    if (!isRapid && !isG1) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const z = zMatch ? parseFloat(zMatch[1]) : prevZ;
    currentZ = z;

    // Check if toolpath is outside stock boundaries (with tool radius offset)
    if (x < stockMinX - toolRadius || x > stockMaxX + toolRadius ||
        y < stockMinY - toolRadius || y > stockMaxY + toolRadius) {
      violations.push({
        lineNumber: i,
        type: 'toolpath-stock',
        position: { x, y, z },
        description: `Toolpath at X${x.toFixed(1)} Y${y.toFixed(1)} is outside stock boundary`,
        severity: 'warning',
      });
    }

    // Check if Z is below stock bottom (plunging into machine table)
    if (z < stockMinZ - toolRadius) {
      violations.push({
        lineNumber: i,
        type: 'toolpath-stock',
        position: { x, y, z },
        description: `Z${z.toFixed(1)} is below stock bottom (${stockMinZ.toFixed(1)})`,
        severity: 'error',
      });
    }

    // Check for rapid moves into stock (G0 while inside stock material)
    if (isRapid && z > stockMinZ && z < stockMaxZ &&
        x >= stockMinX && x <= stockMaxX &&
        y >= stockMinY && y <= stockMaxY) {
      violations.push({
        lineNumber: i,
        type: 'rapid-into-stock',
        position: { x, y, z },
        description: `Rapid move (G0) inside stock material at Z${z.toFixed(1)}`,
        severity: 'error',
      });
    }

    // Check for collisions with fixtures
    for (const fixture of fixtures) {
      if (x >= fixture.x - toolRadius && x <= fixture.x + fixture.width + toolRadius &&
          y >= fixture.y - toolRadius && y <= fixture.y + fixture.depth + toolRadius &&
          z >= fixture.z - toolRadius && z <= fixture.z + fixture.height + toolRadius) {
        // Only flag if the toolpath is actually inside the fixture (not just near it)
        if (x >= fixture.x && x <= fixture.x + fixture.width &&
            y >= fixture.y && y <= fixture.y + fixture.depth &&
            z >= fixture.z && z <= fixture.z + fixture.height) {
          violations.push({
            lineNumber: i,
            type: 'toolpath-fixture',
            position: { x, y, z },
            description: `Toolpath collides with fixture "${fixture.name}" at X${x.toFixed(1)} Y${y.toFixed(1)} Z${z.toFixed(1)}`,
            severity: 'error',
          });
        }
      }
    }

    prevX = x; prevY = y; prevZ = z;
    prevIsRapid = isRapid;
  }

  return violations;
}
