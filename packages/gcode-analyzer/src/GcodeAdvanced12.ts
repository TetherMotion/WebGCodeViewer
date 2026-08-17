/**
 * @file GcodeAdvanced12.ts
 * @brief Twelfth batch of advanced G-code analysis features for CNC and 3D printing.
 *
 * This module provides 12 additional high-impact features:
 *  1. G-code reverse engineering (Universal) — convert toolpath to CAD-like features
 *  2. Material property database (Universal) — comprehensive material lookup
 *  3. Extended tool library (CNC) — tool database with speeds/feeds
 *  4. G-code version control (Universal) — track changes with branching
 *  5. CNC machining strategy analyzer (CNC) — identify roughing/finishing/contouring
 *  6. Print bed leveling quality analysis (3DP) — analyze bed mesh quality
 *  7. G-code unit conversion (Universal) — convert metric/imperial
 *  8. G-code error auto-correction (Universal) — automatically fix common errors
 *  9. Toolpath rendering optimization (Universal) — optimize for rendering
 * 10. Print job scheduler (Universal) — schedule and optimize multiple jobs
 * 11. G-code validation rules engine (Universal) — custom validation rules
 * 12. Machine warmup/cooldown scheduler (CNC) — schedule warmup/cooldown
 */

// ── 1. G-code Reverse Engineering ──

export interface ReverseEngineeredFeature {
  /** Feature type */
  type: 'hole' | 'pocket' | 'profile' | 'slot' | 'chamfer' | 'thread' | 'boss' | 'plane';
  /** Feature name */
  name: string;
  /** Bounding box */
  bounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
  /** Estimated dimensions */
  dimensions: { [key: string]: number };
  /** Confidence score (0-100) */
  confidence: number;
  /** Start line */
  startLine: number;
  /** End line */
  endLine: number;
  /** Tool used */
  tool: number;
}

export interface ReverseEngineeringResult {
  /** All identified features */
  features: ReverseEngineeredFeature[];
  /** Feature count by type */
  byType: { [type: string]: number };
  /** Total features */
  totalFeatures: number;
  /** Average confidence */
  avgConfidence: number;
  /** Whether features were identified */
  hasFeatures: boolean;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Reverse engineer G-code toolpath to identify CAD-like features.
 * Analyzes toolpath patterns to identify:
 * - Holes (circular patterns)
 * - Pockets (closed contours at constant Z)
 * - Profiles (open or closed contours)
 * - Slots (linear patterns with width)
 * - Chamfers (angled Z moves)
 * - Bosses (raised features)
 * - Planes (large area facing operations)
 *
 * @param lines G-code lines
 */
export function reverseEngineerGcode(lines: string[]): ReverseEngineeringResult {
  const features: ReverseEngineeredFeature[] = [];
  const segments: { x: number; y: number; z: number; line: number; isRapid: boolean }[] = [];
  let prevX = 0, prevY = 0, prevZ = 0;
  let currentTool = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const tMatch = code.match(/\bT(\d+)\b/i);
    if (tMatch && (/\bM6\b/i.test(code) || /\bM06\b/i.test(code))) {
      currentTool = parseInt(tMatch[1]);
    }

    if (!/\bG[01]\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const z = zMatch ? parseFloat(zMatch[1]) : prevZ;

    segments.push({ x, y, z, line: i, isRapid: /\bG0\b/i.test(code) });
    prevX = x; prevY = y; prevZ = z;
  }

  // Group segments into operations (separated by rapid moves or Z changes)
  const operations: { segments: typeof segments; startLine: number; endLine: number; tool: number }[] = [];
  let currentOp: typeof segments = [];
  let opStartLine = 0;
  let opTool = currentTool;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];

    if (seg.isRapid && currentOp.length > 0) {
      operations.push({ segments: currentOp, startLine: opStartLine, endLine: seg.line, tool: opTool });
      currentOp = [];
      opStartLine = seg.line;
    } else if (!seg.isRapid) {
      if (currentOp.length === 0) {
        opStartLine = seg.line;
        opTool = currentTool;
      }
      currentOp.push(seg);
    }
  }
  if (currentOp.length > 0) {
    operations.push({ segments: currentOp, startLine: opStartLine, endLine: segments.length - 1, tool: opTool });
  }

  // Analyze each operation
  for (const op of operations) {
    if (op.segments.length < 3) continue;

    const xs = op.segments.map(s => s.x);
    const ys = op.segments.map(s => s.y);
    const zs = op.segments.map(s => s.z);

    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const minZ = Math.min(...zs), maxZ = Math.max(...zs);

    const width = maxX - minX;
    const height = maxY - minY;
    const depth = maxZ - minZ;

    // Check if closed contour (first and last point close together)
    const first = op.segments[0];
    const last = op.segments[op.segments.length - 1];
    const isClosed = Math.sqrt((first.x - last.x) ** 2 + (first.y - last.y) ** 2) < 1;

    // Check for circular pattern (hole)
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const radii = op.segments.map(s => Math.sqrt((s.x - centerX) ** 2 + (s.y - centerY) ** 2));
    const avgRadius = radii.reduce((a, b) => a + b, 0) / radii.length;
    const radiusVariance = radii.reduce((s, r) => s + (r - avgRadius) ** 2, 0) / radii.length;
    const isCircular = Math.sqrt(radiusVariance) < 0.5 && avgRadius > 0.5;

    // Check for chamfer (Z changes while X/Y move)
    const zChanges = op.segments.filter((s, i) => i > 0 && Math.abs(s.z - op.segments[i - 1].z) > 0.01).length;
    const isChamfer = zChanges > 2 && depth > 0.1;

    // Determine feature type
    let type: ReverseEngineeredFeature['type'] = 'profile';
    let name = 'Profile';
    let confidence = 50;
    const dimensions: { [key: string]: number } = {};

    if (isCircular && isClosed) {
      type = 'hole';
      name = `Hole Ø${(avgRadius * 2).toFixed(1)}`;
      dimensions['diameter'] = avgRadius * 2;
      dimensions['depth'] = Math.abs(minZ);
      confidence = 85;
    } else if (isClosed && width < 50 && height < 50 && minZ < 0) {
      type = 'pocket';
      name = `Pocket ${width.toFixed(0)}x${height.toFixed(0)}`;
      dimensions['width'] = width;
      dimensions['height'] = height;
      dimensions['depth'] = Math.abs(minZ);
      confidence = 75;
    } else if (isClosed && width < 10 && height > 20) {
      type = 'slot';
      name = `Slot ${height.toFixed(1)}mm`;
      dimensions['length'] = height;
      dimensions['width'] = width;
      confidence = 70;
    } else if (isChamfer) {
      type = 'chamfer';
      name = `Chamfer ${depth.toFixed(1)}mm`;
      dimensions['depth'] = depth;
      dimensions['angle'] = 45;
      confidence = 65;
    } else if (isClosed && minZ > 0) {
      type = 'boss';
      name = `Boss ${width.toFixed(0)}x${height.toFixed(0)}`;
      dimensions['width'] = width;
      dimensions['height'] = height;
      dimensions['height_z'] = maxZ;
      confidence = 60;
    } else if (!isClosed && width > 100 && height > 100 && depth < 0.5) {
      type = 'plane';
      name = `Plane ${width.toFixed(0)}x${height.toFixed(0)}`;
      dimensions['width'] = width;
      dimensions['height'] = height;
      confidence = 55;
    } else if (isClosed) {
      type = 'profile';
      name = `Profile ${width.toFixed(0)}x${height.toFixed(0)}`;
      dimensions['width'] = width;
      dimensions['height'] = height;
      confidence = 50;
    }

    features.push({
      type, name,
      bounds: { minX, maxX, minY, maxY, minZ, maxZ },
      dimensions, confidence,
      startLine: op.startLine, endLine: op.endLine,
      tool: op.tool,
    });
  }

  const byType: { [type: string]: number } = {};
  for (const f of features) {
    byType[f.type] = (byType[f.type] ?? 0) + 1;
  }

  const avgConfidence = features.length > 0
    ? features.reduce((s, f) => s + f.confidence, 0) / features.length
    : 0;

  const recommendations: string[] = [];
  if (features.length > 0) {
    recommendations.push(`${features.length} features identified (avg confidence: ${avgConfidence.toFixed(0)}%)`);
  }
  for (const [type, count] of Object.entries(byType)) {
    recommendations.push(`${count} ${type}(s)`);
  }
  const lowConfidence = features.filter(f => f.confidence < 60).length;
  if (lowConfidence > 0) {
    recommendations.push(`${lowConfidence} features with low confidence — verify manually`);
  }
  if (features.length === 0) {
    recommendations.push('No features could be identified from the toolpath');
  }

  return {
    features, byType, totalFeatures: features.length,
    avgConfidence, hasFeatures: features.length > 0, recommendations,
  };
}

// ── 2. Material Property Database ──

export interface MaterialProperty {
  /** Material name */
  name: string;
  /** Material category */
  category: 'metal' | 'plastic' | 'composite' | 'wood' | 'ceramic';
  /** Density in g/cm³ */
  density: number;
  /** Tensile strength in MPa */
  tensileStrength: number;
  /** Yield strength in MPa */
  yieldStrength: number;
  /** Thermal conductivity in W/m·K */
  thermalConductivity: number;
  /** Specific heat in J/kg·K */
  specificHeat: number;
  /** Melting/processing temperature in °C */
  meltingPoint: number;
  /** Recommended cutting speed in m/min (CNC) */
  cuttingSpeed: number;
  /** Recommended feed per tooth in mm (CNC) */
  feedPerTooth: number;
  /** Recommended print temperature in °C (3DP) */
  printTemp: number;
  /** Recommended bed temperature in °C (3DP) */
  bedTemp: number;
  /** Cooling fan recommended (3DP) */
  fanRecommended: boolean;
  /** Thermal expansion coefficient in 10⁻⁶/K */
  thermalExpansion: number;
  /** Hardness (Brinell for metals, Shore for plastics) */
  hardness: number;
  /** Cost per kg in USD */
  costPerKg: number;
  /** Description */
  description: string;
}

export interface MaterialSearchResult {
  /** Matching materials */
  materials: MaterialProperty[];
  /** Count */
  count: number;
  /** Whether any matches found */
  found: boolean;
  /** Recommendations */
  recommendations: string[];
}

const materialDatabase: MaterialProperty[] = [
  {
    name: 'PLA', category: 'plastic', density: 1.24, tensileStrength: 50, yieldStrength: 60,
    thermalConductivity: 0.2, specificHeat: 1800, meltingPoint: 180,
    cuttingSpeed: 0, feedPerTooth: 0, printTemp: 200, bedTemp: 60,
    fanRecommended: true, thermalExpansion: 68, hardness: 85, costPerKg: 20,
    description: 'Polylactic acid - easy to print, biodegradable',
  },
  {
    name: 'ABS', category: 'plastic', density: 1.04, tensileStrength: 40, yieldStrength: 45,
    thermalConductivity: 0.18, specificHeat: 2000, meltingPoint: 230,
    cuttingSpeed: 0, feedPerTooth: 0, printTemp: 240, bedTemp: 100,
    fanRecommended: true, thermalExpansion: 100, hardness: 78, costPerKg: 25,
    description: 'Acrylonitrile Butadiene Styrene - durable, heat resistant',
  },
  {
    name: 'PETG', category: 'plastic', density: 1.27, tensileStrength: 55, yieldStrength: 50,
    thermalConductivity: 0.2, specificHeat: 1900, meltingPoint: 220,
    cuttingSpeed: 0, feedPerTooth: 0, printTemp: 230, bedTemp: 80,
    fanRecommended: true, thermalExpansion: 60, hardness: 80, costPerKg: 25,
    description: 'PETG - strong, flexible, chemical resistant',
  },
  {
    name: 'Aluminum 6061', category: 'metal', density: 2.7, tensileStrength: 310, yieldStrength: 276,
    thermalConductivity: 167, specificHeat: 896, meltingPoint: 585,
    cuttingSpeed: 250, feedPerTooth: 0.1, printTemp: 0, bedTemp: 0,
    fanRecommended: false, thermalExpansion: 23.6, hardness: 95, costPerKg: 5,
    description: 'Aluminum 6061-T6 - versatile, weldable, corrosion resistant',
  },
  {
    name: 'Steel 1018', category: 'metal', density: 7.87, tensileStrength: 440, yieldStrength: 370,
    thermalConductivity: 51.9, specificHeat: 486, meltingPoint: 1510,
    cuttingSpeed: 100, feedPerTooth: 0.08, printTemp: 0, bedTemp: 0,
    fanRecommended: false, thermalExpansion: 11.7, hardness: 126, costPerKg: 1,
    description: 'Low carbon steel - good machinability, weldable',
  },
  {
    name: 'Stainless 304', category: 'metal', density: 8.0, tensileStrength: 621, yieldStrength: 290,
    thermalConductivity: 16.2, specificHeat: 500, meltingPoint: 1400,
    cuttingSpeed: 70, feedPerTooth: 0.06, printTemp: 0, bedTemp: 0,
    fanRecommended: false, thermalExpansion: 17.3, hardness: 192, costPerKg: 4,
    description: 'Stainless steel 304 - corrosion resistant, food grade',
  },
  {
    name: 'Titanium Ti6Al4V', category: 'metal', density: 4.43, tensileStrength: 950, yieldStrength: 880,
    thermalConductivity: 6.7, specificHeat: 526, meltingPoint: 1660,
    cuttingSpeed: 40, feedPerTooth: 0.05, printTemp: 0, bedTemp: 0,
    fanRecommended: false, thermalExpansion: 8.6, hardness: 334, costPerKg: 30,
    description: 'Titanium alloy - high strength, low weight, biocompatible',
  },
  {
    name: 'Nylon', category: 'plastic', density: 1.14, tensileStrength: 70, yieldStrength: 45,
    thermalConductivity: 0.25, specificHeat: 1700, meltingPoint: 260,
    cuttingSpeed: 0, feedPerTooth: 0, printTemp: 250, bedTemp: 80,
    fanRecommended: false, thermalExpansion: 80, hardness: 75, costPerKg: 35,
    description: 'Nylon - tough, flexible, wear resistant',
  },
  {
    name: 'TPU', category: 'plastic', density: 1.21, tensileStrength: 25, yieldStrength: 15,
    thermalConductivity: 0.2, specificHeat: 1900, meltingPoint: 220,
    cuttingSpeed: 0, feedPerTooth: 0, printTemp: 220, bedTemp: 50,
    fanRecommended: false, thermalExpansion: 120, hardness: 95, costPerKg: 30,
    description: 'Thermoplastic Polyurethane - flexible, abrasion resistant',
  },
  {
    name: 'Carbon Fiber PLA', category: 'composite', density: 1.3, tensileStrength: 80, yieldStrength: 75,
    thermalConductivity: 0.3, specificHeat: 1700, meltingPoint: 200,
    cuttingSpeed: 0, feedPerTooth: 0, printTemp: 210, bedTemp: 60,
    fanRecommended: true, thermalExpansion: 30, hardness: 90, costPerKg: 50,
    description: 'PLA reinforced with carbon fiber - stiff, low shrinkage',
  },
  {
    name: 'Brass 360', category: 'metal', density: 8.5, tensileStrength: 470, yieldStrength: 310,
    thermalConductivity: 115, specificHeat: 380, meltingPoint: 920,
    cuttingSpeed: 150, feedPerTooth: 0.1, printTemp: 0, bedTemp: 0,
    fanRecommended: false, thermalExpansion: 20.5, hardness: 95, costPerKg: 6,
    description: 'Free-cutting brass - excellent machinability',
  },
  {
    name: 'Copper 110', category: 'metal', density: 8.96, tensileStrength: 220, yieldStrength: 69,
    thermalConductivity: 391, specificHeat: 385, meltingPoint: 1083,
    cuttingSpeed: 120, feedPerTooth: 0.08, printTemp: 0, bedTemp: 0,
    fanRecommended: false, thermalExpansion: 17, hardness: 40, costPerKg: 8,
    description: 'Electrolytic copper - high conductivity, soft',
  },
];

/**
 * Search the material property database.
 *
 * @param query Search query (name, category, or property)
 * @param category Optional category filter
 */
export function searchMaterialDatabase(
  query: string = '',
  category?: MaterialProperty['category'],
): MaterialSearchResult {
  let results = materialDatabase;

  if (category) {
    results = results.filter(m => m.category === category);
  }

  if (query) {
    const lower = query.toLowerCase();
    results = results.filter(m =>
      m.name.toLowerCase().includes(lower) ||
      m.description.toLowerCase().includes(lower) ||
      m.category.includes(lower)
    );
  }

  const recommendations: string[] = [];
  if (results.length === 0) {
    recommendations.push(`No materials found matching "${query}"`);
  } else {
    recommendations.push(`${results.length} material(s) found`);
    for (const m of results.slice(0, 3)) {
      recommendations.push(`${m.name}: ${m.description}`);
    }
  }

  return {
    materials: results, count: results.length,
    found: results.length > 0, recommendations,
  };
}

/**
 * Get a material by name.
 * @param name Material name
 */
export function getMaterialByName(name: string): MaterialProperty | null {
  return materialDatabase.find(m =>
    m.name.toLowerCase() === name.toLowerCase() ||
    m.name.toLowerCase().includes(name.toLowerCase())
  ) ?? null;
}

/**
 * Get all materials in the database.
 */
export function getAllMaterials(): MaterialProperty[] {
  return materialDatabase;
}

// ── 3. Extended Tool Library ──

export interface ExtendedTool {
  /** Tool ID */
  id: number;
  /** Tool name */
  name: string;
  /** Tool type */
  type: 'end_mill' | 'ball_mill' | 'drill' | 'reamer' | 'tap' | 'face_mill' | 'chamfer_mill' | 'thread_mill' | 'boring_bar';
  /** Diameter in mm */
  diameter: number;
  /** Length in mm */
  length: number;
  /** Flute count */
  flutes: number;
  /** Material */
  material: 'HSS' | 'carbide' | 'cobalt' | 'diamond' | 'ceramic';
  /** Coating */
  coating: string;
  /** Recommended RPM range */
  rpmRange: { min: number; max: number };
  /** Recommended feed rate range in mm/min */
  feedRange: { min: number; max: number };
  /** Recommended cut depth in mm */
  maxCutDepth: number;
  /** Recommended cut width in mm */
  maxCutWidth: number;
  /** Tool life estimate in meters */
  toolLifeMeters: number;
  /** Cost in USD */
  cost: number;
  /** Suitable materials */
  suitableMaterials: string[];
}

export interface ToolLibraryResult {
  /** All tools */
  tools: ExtendedTool[];
  /** Tool count */
  count: number;
  /** Tools by type */
  byType: { [type: string]: number };
  /** Recommendations */
  recommendations: string[];
}

const defaultToolLibrary: ExtendedTool[] = [
  {
    id: 1, name: '1/4" End Mill', type: 'end_mill', diameter: 6.35, length: 25, flutes: 4,
    material: 'carbide', coating: 'TiAlN',
    rpmRange: { min: 5000, max: 20000 }, feedRange: { min: 500, max: 3000 },
    maxCutDepth: 6, maxCutWidth: 3, toolLifeMeters: 500, cost: 25,
    suitableMaterials: ['Aluminum 6061', 'Steel 1018', 'Brass 360'],
  },
  {
    id: 2, name: '1/2" End Mill', type: 'end_mill', diameter: 12.7, length: 40, flutes: 4,
    material: 'carbide', coating: 'TiAlN',
    rpmRange: { min: 3000, max: 12000 }, feedRange: { min: 800, max: 4000 },
    maxCutDepth: 12, maxCutWidth: 6, toolLifeMeters: 800, cost: 40,
    suitableMaterials: ['Aluminum 6061', 'Steel 1018', 'Stainless 304'],
  },
  {
    id: 3, name: '1/8" Ball Mill', type: 'ball_mill', diameter: 3.175, length: 15, flutes: 2,
    material: 'carbide', coating: 'AlTiN',
    rpmRange: { min: 10000, max: 30000 }, feedRange: { min: 200, max: 1500 },
    maxCutDepth: 1.5, maxCutWidth: 1.5, toolLifeMeters: 300, cost: 20,
    suitableMaterials: ['Aluminum 6061', 'Steel 1018', 'Titanium Ti6Al4V'],
  },
  {
    id: 4, name: '1/4" Drill', type: 'drill', diameter: 6.35, length: 50, flutes: 2,
    material: 'cobalt', coating: 'TiN',
    rpmRange: { min: 1000, max: 5000 }, feedRange: { min: 50, max: 300 },
    maxCutDepth: 25, maxCutWidth: 6.35, toolLifeMeters: 200, cost: 15,
    suitableMaterials: ['Aluminum 6061', 'Steel 1018', 'Stainless 304'],
  },
  {
    id: 5, name: '3/8" Face Mill', type: 'face_mill', diameter: 9.525, length: 20, flutes: 3,
    material: 'carbide', coating: 'TiAlN',
    rpmRange: { min: 3000, max: 15000 }, feedRange: { min: 500, max: 2500 },
    maxCutDepth: 2, maxCutWidth: 9.525, toolLifeMeters: 1000, cost: 60,
    suitableMaterials: ['Aluminum 6061', 'Steel 1018'],
  },
  {
    id: 6, name: '90° Chamfer Mill', type: 'chamfer_mill', diameter: 10, length: 20, flutes: 2,
    material: 'carbide', coating: 'TiAlN',
    rpmRange: { min: 5000, max: 20000 }, feedRange: { min: 300, max: 1500 },
    maxCutDepth: 5, maxCutWidth: 5, toolLifeMeters: 400, cost: 30,
    suitableMaterials: ['Aluminum 6061', 'Steel 1018', 'Brass 360'],
  },
  {
    id: 7, name: '1/4" Tap M6', type: 'tap', diameter: 6, length: 30, flutes: 3,
    material: 'HSS', coating: 'TiN',
    rpmRange: { min: 100, max: 500 }, feedRange: { min: 50, max: 200 },
    maxCutDepth: 15, maxCutWidth: 6, toolLifeMeters: 50, cost: 10,
    suitableMaterials: ['Aluminum 6061', 'Steel 1018', 'Brass 360'],
  },
  {
    id: 8, name: '1/2" Reamer', type: 'reamer', diameter: 12.7, length: 60, flutes: 6,
    material: 'carbide', coating: 'TiN',
    rpmRange: { min: 500, max: 2000 }, feedRange: { min: 100, max: 400 },
    maxCutDepth: 30, maxCutWidth: 12.7, toolLifeMeters: 150, cost: 35,
    suitableMaterials: ['Aluminum 6061', 'Steel 1018'],
  },
];

/**
 * Get the extended tool library.
 * @param materialFilter Optional material name to filter by
 */
export function getExtendedToolLibrary(materialFilter?: string): ToolLibraryResult {
  let tools = defaultToolLibrary;

  if (materialFilter) {
    tools = tools.filter(t => t.suitableMaterials.some(m =>
      m.toLowerCase().includes(materialFilter.toLowerCase())
    ));
  }

  const byType: { [type: string]: number } = {};
  for (const t of tools) {
    byType[t.type] = (byType[t.type] ?? 0) + 1;
  }

  const recommendations: string[] = [];
  recommendations.push(`${tools.length} tools available`);
  if (materialFilter) {
    recommendations.push(`Filtered for ${materialFilter}: ${tools.length} suitable tools`);
  }
  const carbideCount = tools.filter(t => t.material === 'carbide').length;
  if (carbideCount > 0) {
    recommendations.push(`${carbideCount} carbide tools (high performance)`);
  }

  return { tools, count: tools.length, byType, recommendations };
}

/**
 * Recommend a tool for a specific operation.
 * @param operationType Operation type
 * @param material Material name
 * @param diameter Required diameter (optional)
 */
export function recommendTool(
  operationType: ExtendedTool['type'],
  material: string,
  diameter?: number,
): ExtendedTool | null {
  let candidates = defaultToolLibrary.filter(t => t.type === operationType);

  if (material) {
    candidates = candidates.filter(t => t.suitableMaterials.some(m =>
      m.toLowerCase().includes(material.toLowerCase())
    ));
  }

  if (diameter) {
    candidates = candidates.filter(t => Math.abs(t.diameter - diameter) < 1);
  }

  return candidates.length > 0 ? candidates[0] : null;
}

// ── 4. G-code Version Control ──

export interface VersionCommit {
  /** Commit ID */
  id: string;
  /** Parent commit ID */
  parentId: string | null;
  /** Commit message */
  message: string;
  /** Timestamp */
  timestamp: number;
  /** Author */
  author: string;
  /** G-code content */
  lines: string[];
  /** Branch name */
  branch: string;
  /** Checksum */
  checksum: string;
}

export interface Branch {
  /** Branch name */
  name: string;
  /** Head commit ID */
  headCommitId: string;
  /** Created timestamp */
  created: number;
}

export interface VersionControlResult {
  /** Current branch */
  currentBranch: string;
  /** All branches */
  branches: Branch[];
  /** All commits */
  commits: VersionCommit[];
  /** Commit count */
  commitCount: number;
  /** Current head */
  head: VersionCommit | null;
  /** Whether this is the initial commit */
  isInitialCommit: boolean;
  /** Recommendations */
  recommendations: string[];
}

/**
 * G-code version control system.
 * Tracks changes to G-code with branching and commit history.
 */
export class GcodeVersionControl {
  private commits: Map<string, VersionCommit> = new Map();
  private branches: Map<string, Branch> = new Map();
  private currentBranch: string = 'main';
  private headCommitId: string | null = null;

  /**
   * Initialize with the main branch.
   */
  constructor() {
    this.branches.set('main', { name: 'main', headCommitId: '', created: Date.now() });
  }

  /**
   * Commit the current G-code state.
   * @param lines G-code lines
   * @param message Commit message
   * @param author Author name
   */
  commit(lines: string[], message: string, author: string = 'user'): VersionControlResult {
    const id = `commit_${this.commits.size + 1}_${Date.now()}`;
    const checksum = this.computeChecksum(lines);
    const parentId = this.headCommitId;

    const commit: VersionCommit = {
      id, parentId, message, timestamp: Date.now(),
      author, lines, branch: this.currentBranch, checksum,
    };

    this.commits.set(id, commit);
    this.headCommitId = id;

    const branch = this.branches.get(this.currentBranch);
    if (branch) branch.headCommitId = id;

    return this.getStatus();
  }

  /**
   * Create a new branch.
   * @param name Branch name
   */
  createBranch(name: string): VersionControlResult {
    if (this.branches.has(name)) {
      throw new Error(`Branch ${name} already exists`);
    }
    this.branches.set(name, { name, headCommitId: this.headCommitId ?? '', created: Date.now() });
    return this.getStatus();
  }

  /**
   * Switch to a branch.
   * @param name Branch name
   */
  checkout(name: string): VersionControlResult {
    if (!this.branches.has(name)) {
      throw new Error(`Branch ${name} does not exist`);
    }
    this.currentBranch = name;
    const branch = this.branches.get(name)!;
    this.headCommitId = branch.headCommitId || null;
    return this.getStatus();
  }

  /**
   * Get the current status.
   */
  getStatus(): VersionControlResult {
    const head = this.headCommitId ? this.commits.get(this.headCommitId) ?? null : null;
    const commits = Array.from(this.commits.values()).sort((a, b) => a.timestamp - b.timestamp);

    const recommendations: string[] = [];
    if (this.commits.size === 0) {
      recommendations.push('No commits yet — make your first commit');
    } else {
      recommendations.push(`${this.commits.size} commits on ${this.branches.size} branch(es)`);
    }
    if (this.branches.size > 1) {
      recommendations.push(`${this.branches.size} branches: ${Array.from(this.branches.keys()).join(', ')}`);
    }

    return {
      currentBranch: this.currentBranch,
      branches: Array.from(this.branches.values()),
      commits,
      commitCount: this.commits.size,
      head,
      isInitialCommit: this.commits.size === 1,
      recommendations,
    };
  }

  /**
   * Get commit history for the current branch.
   */
  getHistory(): VersionCommit[] {
    const history: VersionCommit[] = [];
    let currentId = this.headCommitId;

    while (currentId) {
      const commit = this.commits.get(currentId);
      if (!commit) break;
      history.push(commit);
      currentId = commit.parentId;
    }

    return history;
  }

  private computeChecksum(lines: string[]): string {
    let hash = 0;
    for (const line of lines) {
      for (let i = 0; i < line.length; i++) {
        hash = ((hash << 5) - hash) + line.charCodeAt(i);
        hash |= 0;
      }
    }
    return `cs_${Math.abs(hash).toString(16)}`;
  }
}

/**
 * Create a new G-code version control instance.
 */
export function createVersionControl(): GcodeVersionControl {
  return new GcodeVersionControl();
}

// ── 5. CNC Machining Strategy Analyzer ──

export interface MachiningStrategy {
  /** Strategy type */
  type: 'roughing' | 'finishing' | 'contouring' | 'facing' | 'drilling' | 'profiling' | 'plunging' | 'threading';
  /** Start line */
  startLine: number;
  /** End line */
  endLine: number;
  /** Estimated material removal in mm³ */
  materialRemoval: number;
  /** Tool used */
  tool: number;
  /** Spindle RPM */
  rpm: number;
  /** Feed rate */
  feedRate: number;
  /** Step-down depth in mm */
  stepDown: number;
  /** Step-over width in mm */
  stepOver: number;
  /** Estimated time in seconds */
  estimatedTime: number;
}

export interface StrategyAnalysisResult {
  /** All identified strategies */
  strategies: MachiningStrategy[];
  /** Strategy count by type */
  byType: { [type: string]: number };
  /** Total estimated time in seconds */
  totalTime: number;
  /** Total material removal in mm³ */
  totalMaterialRemoval: number;
  /** Whether roughing is present */
  hasRoughing: boolean;
  /** Whether finishing is present */
  hasFinishing: boolean;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze CNC machining strategies used in G-code.
 * Identifies roughing, finishing, facing, drilling, and other operations.
 *
 * @param lines G-code lines
 */
export function analyzeMachiningStrategy(lines: string[]): StrategyAnalysisResult {
  const strategies: MachiningStrategy[] = [];
  let currentTool = 0;
  let currentRpm = 0;
  let currentFeed = 0;
  let prevX = 0, prevY = 0, prevZ = 0;
  let prevE = 0;

  // Group into operations
  let opSegments: { x: number; y: number; z: number; line: number; isRapid: boolean; isCutting: boolean }[] = [];
  let opStartLine = 0;
  let opTool = 0;
  let opRpm = 0;
  let opFeed = 0;
  let opMinZ = 0;
  let opMaxZ = 0;
  let opZLevels = new Set<number>();

  const finalizeOp = (endLine: number) => {
    if (opSegments.length < 2) {
      opSegments = [];
      return;
    }

    const cuttingSegs = opSegments.filter(s => s.isCutting);
    if (cuttingSegs.length === 0) {
      opSegments = [];
      return;
    }

    const xs = cuttingSegs.map(s => s.x);
    const ys = cuttingSegs.map(s => s.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);

    const width = maxX - minX;
    const height = maxY - minY;
    const depth = opMaxZ - opMinZ;

    // Determine strategy type
    let type: MachiningStrategy['type'] = 'profiling';
    const zLevelsCount = opZLevels.size;

    // Check for drilling (G81-89)
    const hasDrillCycle = lines.slice(opStartLine, endLine).some(l => /\bG8[1-9]\b/i.test(l));
    if (hasDrillCycle) {
      type = 'drilling';
    } else if (depth < 0.5 && width > 50 && height > 50) {
      type = 'facing';
    } else if (zLevelsCount > 3 && opFeed < 1000) {
      type = 'finishing';
    } else if (zLevelsCount > 3 && opFeed > 1000) {
      type = 'roughing';
    } else if (width < 5 && height > 20) {
      type = 'plunging';
    } else if (/\bG33\b/i.test(lines.slice(opStartLine, endLine).join(' '))) {
      type = 'threading';
    } else if (opMinZ < 0 && depth > 1) {
      type = 'contouring';
    }

    // Estimate material removal
    const totalDist = cuttingSegs.reduce((s, seg, i) => {
      if (i === 0) return 0;
      const prev = cuttingSegs[i - 1];
      return s + Math.sqrt((seg.x - prev.x) ** 2 + (seg.y - prev.y) ** 2);
    }, 0);

    const stepOver = width / Math.max(1, zLevelsCount);
    const materialRemoval = totalDist * Math.abs(opMinZ) * stepOver * 0.5;
    const estimatedTime = opFeed > 0 ? totalDist / (opFeed / 60) : 0;

    strategies.push({
      type, startLine: opStartLine, endLine,
      materialRemoval, tool: opTool, rpm: opRpm, feedRate: opFeed,
      stepDown: zLevelsCount > 0 ? depth / zLevelsCount : depth,
      stepOver, estimatedTime,
    });

    opSegments = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    const tMatch = code.match(/\bT(\d+)\b/i);
    if (tMatch && (/\bM6\b/i.test(code) || /\bM06\b/i.test(code))) {
      finalizeOp(i);
      currentTool = parseInt(tMatch[1]);
      continue;
    }

    const sMatch = code.match(/\bS(\d*\.?\d+)/i);
    if (sMatch && /\bM[34]\b/i.test(code)) currentRpm = parseFloat(sMatch[1]);

    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) currentFeed = parseFloat(fMatch[1]);

    if (!/\bG[01]\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
    const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const z = zMatch ? parseFloat(zMatch[1]) : prevZ;
    const isRapid = /\bG0\b/i.test(code);
    const isCutting = !isRapid && (z < 0 || (eMatch !== null && parseFloat(eMatch[1]) > prevE));

    if (isRapid && opSegments.length > 0) {
      finalizeOp(i);
      opStartLine = i;
      opTool = currentTool;
      opRpm = currentRpm;
      opFeed = currentFeed;
      opMinZ = z;
      opMaxZ = z;
      opZLevels = new Set([Math.round(z * 100) / 100]);
    } else {
      if (opSegments.length === 0) {
        opStartLine = i;
        opTool = currentTool;
        opRpm = currentRpm;
        opFeed = currentFeed;
        opMinZ = z;
        opMaxZ = z;
        opZLevels = new Set([Math.round(z * 100) / 100]);
      } else {
        opMinZ = Math.min(opMinZ, z);
        opMaxZ = Math.max(opMaxZ, z);
        opZLevels.add(Math.round(z * 100) / 100);
      }
      opSegments.push({ x, y, z, line: i, isRapid, isCutting });
    }

    if (eMatch) prevE = parseFloat(eMatch[1]);
    prevX = x; prevY = y; prevZ = z;
  }

  finalizeOp(lines.length - 1);

  const byType: { [type: string]: number } = {};
  for (const s of strategies) {
    byType[s.type] = (byType[s.type] ?? 0) + 1;
  }

  const totalTime = strategies.reduce((s, strat) => s + strat.estimatedTime, 0);
  const totalMaterialRemoval = strategies.reduce((s, strat) => s + strat.materialRemoval, 0);
  const hasRoughing = strategies.some(s => s.type === 'roughing');
  const hasFinishing = strategies.some(s => s.type === 'finishing');

  const recommendations: string[] = [];
  if (!hasRoughing && strategies.length > 0) {
    recommendations.push('No roughing operation detected — consider adding roughing pass');
  }
  if (!hasFinishing && hasRoughing) {
    recommendations.push('Roughing without finishing — add finishing pass for better surface');
  }
  for (const [type, count] of Object.entries(byType)) {
    recommendations.push(`${count} ${type} operation(s)`);
  }
  if (strategies.length === 0) {
    recommendations.push('No machining strategies identified');
  }

  return {
    strategies, byType, totalTime, totalMaterialRemoval,
    hasRoughing, hasFinishing, recommendations,
  };
}

// ── 6. Print Bed Leveling Quality Analysis ──

export interface BedLevelingPoint {
  /** X position */
  x: number;
  /** Y position */
  y: number;
  /** Z compensation in mm */
  zCompensation: number;
}

export interface BedLevelingResult {
  /** Mesh points */
  meshPoints: BedLevelingPoint[];
  /** Grid dimensions */
  gridSize: { x: number; y: number };
  /** Z compensation range */
  compensationRange: { min: number; max: number };
  /** Average compensation */
  avgCompensation: number;
  /** Standard deviation */
  stdDeviation: number;
  /** Flatness score (0-100, higher is flatter) */
  flatnessScore: number;
  /** Whether bed leveling is present */
  hasLeveling: boolean;
  /** Leveling type */
  levelingType: 'none' | 'manual' | 'auto' | 'mesh';
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze print bed leveling quality.
 * Examines bed leveling compensation mesh and assesses bed flatness.
 *
 * @param lines G-code lines
 */
export function analyzeBedLevelingQuality(lines: string[]): BedLevelingResult {
  const meshPoints: BedLevelingPoint[] = [];
  let levelingType: BedLevelingResult['levelingType'] = 'none';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Detect bed leveling commands
    if (/\bG29\b/i.test(line)) {
      levelingType = 'auto';
    }
    if (/\bM420\b/i.test(line)) {
      levelingType = levelingType === 'none' ? 'mesh' : levelingType;
    }
    if (/\bG28\b/i.test(line) && i < 20) {
      // Homing — check if followed by leveling
    }

    // Parse mesh points from G29 or M420 output
    // Format: ; X:10 Y:10 Z:0.123
    const meshMatch = line.match(/[;]\s*X:?(-?\d*\.?\d+)\s*Y:?(-?\d*\.?\d+)\s*Z:?(-?\d*\.?\d+)/i);
    if (meshMatch) {
      meshPoints.push({
        x: parseFloat(meshMatch[1]),
        y: parseFloat(meshMatch[2]),
        zCompensation: parseFloat(meshMatch[3]),
      });
    }

    // Parse G30 (single Z probe)
    if (/\bG30\b/i.test(line)) {
      levelingType = 'manual';
      const xMatch = line.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = line.match(/\bY(-?\d*\.?\d+)/i);
      const zMatch = line.match(/\bZ(-?\d*\.?\d+)/i);
      if (xMatch && yMatch && zMatch) {
        meshPoints.push({
          x: parseFloat(xMatch[1]),
          y: parseFloat(yMatch[1]),
          zCompensation: parseFloat(zMatch[1]),
        });
      }
    }
  }

  if (meshPoints.length === 0 && levelingType === 'none') {
    return {
      meshPoints: [], gridSize: { x: 0, y: 0 },
      compensationRange: { min: 0, max: 0 },
      avgCompensation: 0, stdDeviation: 0,
      flatnessScore: 0, hasLeveling: false, levelingType: 'none',
      recommendations: ['No bed leveling detected — add G29 for auto bed leveling'],
    };
  }

  const compensations = meshPoints.map(p => p.zCompensation);
  const minComp = compensations.length > 0 ? Math.min(...compensations) : 0;
  const maxComp = compensations.length > 0 ? Math.max(...compensations) : 0;
  const avgCompensation = compensations.length > 0 ? compensations.reduce((a, b) => a + b, 0) / compensations.length : 0;

  const variance = compensations.length > 0
    ? compensations.reduce((s, c) => s + (c - avgCompensation) ** 2, 0) / compensations.length
    : 0;
  const stdDeviation = Math.sqrt(variance);

  // Grid size estimation
  const uniqueX = new Set(meshPoints.map(p => Math.round(p.x)));
  const uniqueY = new Set(meshPoints.map(p => Math.round(p.y)));
  const gridSize = { x: uniqueX.size, y: uniqueY.size };

  // Flatness score: lower compensation range = flatter
  const range = maxComp - minComp;
  const flatnessScore = Math.max(0, 100 - range * 100);

  const recommendations: string[] = [];
  if (range > 0.5) {
    recommendations.push(`Large compensation range (${range.toFixed(2)}mm) — bed may be warped`);
  }
  if (stdDeviation > 0.1) {
    recommendations.push(`High compensation variation (σ=${stdDeviation.toFixed(3)}) — check bed mounting`);
  }
  if (meshPoints.length < 4) {
    recommendations.push(`Only ${meshPoints.length} mesh points — increase grid density`);
  }
  if (flatnessScore > 90) {
    recommendations.push('Bed is very flat — excellent leveling');
  }
  if (recommendations.length === 0) {
    recommendations.push('Bed leveling appears adequate');
  }

  return {
    meshPoints, gridSize,
    compensationRange: { min: minComp, max: maxComp },
    avgCompensation, stdDeviation, flatnessScore,
    hasLeveling: true, levelingType, recommendations,
  };
}

// ── 7. G-code Unit Conversion ──

export interface UnitConversionResult {
  /** Converted G-code lines */
  convertedLines: string[];
  /** Number of values converted */
  conversionCount: number;
  /** Source unit */
  fromUnit: 'metric' | 'imperial';
  /** Target unit */
  toUnit: 'metric' | 'imperial';
  /** Whether conversion was performed */
  wasConverted: boolean;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Convert G-code between metric (mm) and imperial (inches).
 * Converts all coordinate values, feed rates, and distances.
 *
 * @param lines G-code lines
 * @param toUnit Target unit system
 */
export function convertGcodeUnits(
  lines: string[],
  toUnit: 'metric' | 'imperial',
): UnitConversionResult {
  // Detect source unit
  let fromUnit: 'metric' | 'imperial' = 'metric';
  for (const line of lines) {
    if (/\bG20\b/i.test(line)) { fromUnit = 'imperial'; break; }
    if (/\bG21\b/i.test(line)) { fromUnit = 'metric'; break; }
  }

  if (fromUnit === toUnit) {
    return {
      convertedLines: lines, conversionCount: 0,
      fromUnit, toUnit, wasConverted: false,
      recommendations: ['G-code is already in target unit system'],
    };
  }

  const factor = toUnit === 'metric' ? 25.4 : 1 / 25.4;
  const convertedLines: string[] = [];
  let conversionCount = 0;

  for (const line of lines) {
    let converted = line;

    // Replace G20/G21
    if (/\bG20\b/i.test(converted)) {
      converted = converted.replace(/\bG20\b/i, 'G21');
      conversionCount++;
    } else if (/\bG21\b/i.test(converted)) {
      converted = converted.replace(/\bG21\b/i, 'G20');
      conversionCount++;
    } else {
      // Convert coordinate values
      converted = converted.replace(/\b([XYZIJKRD])(-?\d*\.?\d+)/gi, (match, axis, value) => {
        const num = parseFloat(value);
        const converted = num * factor;
        conversionCount++;
        return `${axis}${converted.toFixed(4)}`;
      });

      // Convert feed rate (F)
      converted = converted.replace(/\bF(\d*\.?\d+)/gi, (match, value) => {
        const num = parseFloat(value);
        const converted = num * factor;
        conversionCount++;
        return `F${converted.toFixed(1)}`;
      });
    }

    convertedLines.push(converted);
  }

  const recommendations: string[] = [];
  recommendations.push(`Converted ${conversionCount} values from ${fromUnit} to ${toUnit}`);
  if (toUnit === 'metric') {
    recommendations.push('All values are now in millimeters (mm)');
  } else {
    recommendations.push('All values are now in inches (in)');
  }

  return {
    convertedLines, conversionCount, fromUnit, toUnit,
    wasConverted: true, recommendations,
  };
}

// ── 8. G-code Error Auto-Correction ──

export interface AutoCorrection {
  /** Line number */
  lineNumber: number;
  /** Original line */
  original: string;
  /** Corrected line */
  corrected: string;
  /** Error type */
  errorType: string;
  /** Description */
  description: string;
}

export interface AutoCorrectionResult {
  /** Corrected G-code lines */
  correctedLines: string[];
  /** All corrections made */
  corrections: AutoCorrection[];
  /** Correction count */
  correctionCount: number;
  /** Whether any corrections were made */
  wasCorrected: boolean;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Automatically correct common G-code errors.
 * Fixes:
 * - Lowercase G/M codes → uppercase
 * - Leading zeros in G/M codes (G01 → G1)
 * - Missing spaces between commands
 * - Incorrect parameter order
 * - Missing feed rate on G1
 * - Trailing whitespace
 *
 * @param lines G-code lines
 */
export function autoCorrectGcode(lines: string[]): AutoCorrectionResult {
  const correctedLines: string[] = [];
  const corrections: AutoCorrection[] = [];
  let lastFeedRate = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    let corrected = line;

    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) {
      correctedLines.push(trimmed);
      if (line !== trimmed) {
        corrections.push({
          lineNumber: i, original: line, corrected: trimmed,
          errorType: 'whitespace', description: 'Trimmed whitespace',
        });
      }
      continue;
    }

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) {
      correctedLines.push(trimmed);
      continue;
    }

    let correctedCode = code;
    const originalCode = code;

    // Fix 1: Uppercase G/M codes and axis letters
    correctedCode = correctedCode.replace(/\b([gm])(\d+)/gi, (m, p1, p2) => {
      return `${p1.toUpperCase()}${p2}`;
    });
    correctedCode = correctedCode.replace(/\b([xyzefijkrdstp])(-?\d)/gi, (m, p1, p2) => {
      return `${p1.toUpperCase()}${p2}`;
    });

    // Fix 2: Remove leading zeros (G01 → G1, M06 → M6)
    correctedCode = correctedCode.replace(/\b([GM])0*(\d+)\b/gi, (m, p1, p2) => {
      return `${p1}${parseInt(p2)}`;
    });

    // Fix 3: Ensure space between commands
    correctedCode = correctedCode.replace(/([GM]\d+)([XYZEF])/gi, '$1 $2');

    // Fix 4: Normalize whitespace
    correctedCode = correctedCode.replace(/\s+/g, ' ').trim();

    // Fix 5: Missing feed rate on G1
    if (/\bG1\b/i.test(correctedCode) && !/\bF\b/i.test(correctedCode) && lastFeedRate > 0) {
      correctedCode += ` F${lastFeedRate}`;
    }

    // Track feed rate
    const fMatch = correctedCode.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) lastFeedRate = parseFloat(fMatch[1]);

    if (correctedCode !== originalCode) {
      corrections.push({
        lineNumber: i, original: line, corrected: correctedCode,
        errorType: 'formatting', description: 'Corrected formatting',
      });
    }

    correctedLines.push(correctedCode);
  }

  const correctionCount = corrections.length;
  const wasCorrected = correctionCount > 0;

  const recommendations: string[] = [];
  if (correctionCount > 0) {
    recommendations.push(`${correctionCount} corrections applied`);
  }
  const formattingCount = corrections.filter(c => c.errorType === 'formatting').length;
  if (formattingCount > 0) {
    recommendations.push(`${formattingCount} formatting issues fixed`);
  }
  if (!wasCorrected) {
    recommendations.push('No corrections needed — G-code is well-formatted');
  }

  return {
    correctedLines, corrections, correctionCount, wasCorrected, recommendations,
  };
}

// ── 9. Toolpath Rendering Optimization ──

export interface RenderingOptimizationResult {
  /** Original segment count */
  originalSegments: number;
  /** Optimized segment count */
  optimizedSegments: number;
  /** Reduction percentage */
  reductionPercentage: number;
  /** Optimization strategies applied */
  strategiesApplied: string[];
  /** Simplified toolpath points */
  simplifiedPoints: { x: number; y: number; z: number }[];
  /** Estimated rendering speedup */
  estimatedSpeedup: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Optimize toolpath for rendering performance.
 * Reduces the number of points while preserving the toolpath shape.
 *
 * Strategies:
 * - Remove collinear points
 * - Merge nearby points
 * - Simplify straight segments
 *
 * @param lines G-code lines
 * @param tolerance Simplification tolerance in mm (default 0.01)
 */
export function optimizeToolpathForRendering(
  lines: string[],
  tolerance: number = 0.01,
): RenderingOptimizationResult {
  const points: { x: number; y: number; z: number }[] = [];
  let prevX = 0, prevY = 0, prevZ = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const code = trimmed.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code || !/\bG[01]\b/i.test(code)) continue;

    const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
    const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
    const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);

    const x = xMatch ? parseFloat(xMatch[1]) : prevX;
    const y = yMatch ? parseFloat(yMatch[1]) : prevY;
    const z = zMatch ? parseFloat(zMatch[1]) : prevZ;

    points.push({ x, y, z });
    prevX = x; prevY = y; prevZ = z;
  }

  const originalSegments = points.length;
  const strategiesApplied: string[] = [];

  // Strategy 1: Remove duplicate points
  const deduped: typeof points = [];
  for (const p of points) {
    const last = deduped[deduped.length - 1];
    if (!last || Math.abs(p.x - last.x) > tolerance || Math.abs(p.y - last.y) > tolerance || Math.abs(p.z - last.z) > tolerance) {
      deduped.push(p);
    }
  }
  if (deduped.length < points.length) {
    strategiesApplied.push(`Removed ${points.length - deduped.length} duplicate points`);
  }

  // Strategy 2: Remove collinear points (Douglas-Peucker-like simplification)
  const simplified = simplifyPoints(deduped, tolerance);
  if (simplified.length < deduped.length) {
    strategiesApplied.push(`Removed ${deduped.length - simplified.length} collinear points`);
  }

  const optimizedSegments = simplified.length;
  const reductionPercentage = originalSegments > 0
    ? ((originalSegments - optimizedSegments) / originalSegments) * 100
    : 0;
  const estimatedSpeedup = originalSegments > 0 ? originalSegments / Math.max(1, optimizedSegments) : 1;

  const recommendations: string[] = [];
  if (reductionPercentage > 50) {
    recommendations.push(`${reductionPercentage.toFixed(0)}% reduction — significant rendering speedup expected`);
  }
  if (estimatedSpeedup > 2) {
    recommendations.push(`Estimated ${estimatedSpeedup.toFixed(1)}x rendering speedup`);
  }
  if (reductionPercentage < 10) {
    recommendations.push('Toolpath is already well-optimized for rendering');
  }
  for (const s of strategiesApplied) {
    recommendations.push(s);
  }

  return {
    originalSegments, optimizedSegments, reductionPercentage,
    strategiesApplied, simplifiedPoints: simplified,
    estimatedSpeedup, recommendations,
  };
}

function simplifyPoints(
  points: { x: number; y: number; z: number }[],
  tolerance: number,
): { x: number; y: number; z: number }[] {
  if (points.length < 3) return points;

  const result: { x: number; y: number; z: number }[] = [points[0]];

  for (let i = 1; i < points.length - 1; i++) {
    const prev = result[result.length - 1];
    const curr = points[i];
    const next = points[i + 1];

    // Check if curr is collinear with prev and next
    const dx1 = curr.x - prev.x;
    const dy1 = curr.y - prev.y;
    const dx2 = next.x - curr.x;
    const dy2 = next.y - curr.y;

    // Cross product to check collinearity
    const cross = dx1 * dy2 - dy1 * dx2;
    const dist = Math.sqrt(cross * cross) / Math.max(0.001, Math.sqrt(dx2 * dx2 + dy2 * dy2));

    if (dist > tolerance || Math.abs(curr.z - prev.z) > tolerance) {
      result.push(curr);
    }
  }

  result.push(points[points.length - 1]);
  return result;
}

// ── 10. Print Job Scheduler ──

export interface PrintJob {
  /** Job name */
  name: string;
  /** Estimated time in seconds */
  estimatedTime: number;
  /** Material needed in grams */
  materialNeeded: number;
  /** Priority (1 = highest) */
  priority: number;
  /** Dependencies (job names that must complete first) */
  dependencies: string[];
}

export interface ScheduledJob {
  /** Job name */
  name: string;
  /** Start time in seconds from schedule start */
  startTime: number;
  /** End time in seconds */
  endTime: number;
  /** Priority */
  priority: number;
}

export interface ScheduleResult {
  /** Scheduled jobs in execution order */
  schedule: ScheduledJob[];
  /** Total schedule time in seconds */
  totalTime: number;
  /** Whether all jobs could be scheduled */
  fullyScheduled: boolean;
  /** Unscheduled jobs (due to circular dependencies) */
  unscheduledJobs: string[];
  /** Recommendations */
  recommendations: string[];
}

/**
 * Schedule multiple print jobs optimally.
 * Considers priorities, dependencies, and material availability.
 *
 * @param jobs Array of print jobs to schedule
 * @param materialAvailable Available material in grams
 */
export function schedulePrintJobs(
  jobs: PrintJob[],
  materialAvailable: number = Infinity,
): ScheduleResult {
  const schedule: ScheduledJob[] = [];
  const scheduled = new Set<string>();
  const unscheduledJobs: string[] = [];
  let currentTime = 0;
  let materialUsed = 0;

  // Sort by priority
  const sorted = [...jobs].sort((a, b) => a.priority - b.priority);

  // Schedule iteratively (respecting dependencies)
  let progress = true;
  while (progress && scheduled.size < sorted.length) {
    progress = false;

    for (const job of sorted) {
      if (scheduled.has(job.name)) continue;

      // Check dependencies
      const depsMet = job.dependencies.every(dep => scheduled.has(dep));
      if (!depsMet) continue;

      // Check material
      if (materialUsed + job.materialNeeded > materialAvailable) {
        unscheduledJobs.push(job.name);
        scheduled.add(job.name); // Mark as processed
        progress = true;
        continue;
      }

      schedule.push({
        name: job.name,
        startTime: currentTime,
        endTime: currentTime + job.estimatedTime,
        priority: job.priority,
      });

      currentTime += job.estimatedTime;
      materialUsed += job.materialNeeded;
      scheduled.add(job.name);
      progress = true;
    }
  }

  // Check for unscheduled jobs (circular dependencies)
  for (const job of jobs) {
    if (!scheduled.has(job.name)) {
      unscheduledJobs.push(job.name);
    }
  }

  const totalTime = currentTime;
  const fullyScheduled = unscheduledJobs.length === 0;

  const recommendations: string[] = [];
  if (fullyScheduled) {
    recommendations.push(`All ${schedule.length} jobs scheduled in ${(totalTime / 3600).toFixed(1)} hours`);
  } else {
    recommendations.push(`${unscheduledJobs.length} jobs could not be scheduled — check dependencies`);
  }
  if (materialUsed > 0) {
    recommendations.push(`Material used: ${materialUsed.toFixed(0)}g of ${materialAvailable === Infinity ? 'unlimited' : materialAvailable + 'g'}`);
  }
  // Suggest order
  for (const s of schedule.slice(0, 3)) {
    recommendations.push(`${s.name}: start at ${(s.startTime / 60).toFixed(0)}min`);
  }

  return {
    schedule, totalTime, fullyScheduled, unscheduledJobs, recommendations,
  };
}

// ── 11. G-code Validation Rules Engine ──

export interface ValidationRule {
  /** Rule name */
  name: string;
  /** Rule description */
  description: string;
  /** Rule category */
  category: 'safety' | 'quality' | 'efficiency' | 'compatibility' | 'best_practice';
  /** Severity */
  severity: 'error' | 'warning' | 'info';
  /** Validation function */
  check: (lines: string[]) => { passed: boolean; message: string; lineNumbers: number[] };
}

export interface ValidationViolation {
  /** Rule name */
  ruleName: string;
  /** Severity */
  severity: 'error' | 'warning' | 'info';
  /** Message */
  message: string;
  /** Affected line numbers */
  lineNumbers: number[];
  /** Category */
  category: string;
}

export interface ValidationResult {
  /** All violations */
  violations: ValidationViolation[];
  /** Violation count */
  violationCount: number;
  /** Violations by severity */
  bySeverity: { error: number; warning: number; info: number };
  /** Validation score (0-100, higher is better) */
  validationScore: number;
  /** Whether G-code passes all rules */
  passesAll: boolean;
  /** Rules checked */
  rulesChecked: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Validate G-code against a set of rules.
 * Uses a rules engine that can be customized.
 *
 * @param lines G-code lines
 * @param customRules Additional custom rules to check
 */
export function validateGcodeRules(
  lines: string[],
  customRules: ValidationRule[] = [],
): ValidationResult {
  const defaultRules: ValidationRule[] = [
    {
      name: 'has_homing',
      description: 'G-code should start with homing (G28)',
      category: 'safety', severity: 'error',
      check: (lines) => {
        const hasHoming = lines.some(l => /\bG28\b/i.test(l));
        return {
          passed: hasHoming,
          message: hasHoming ? 'Homing present' : 'No homing (G28) found',
          lineNumbers: [],
        };
      },
    },
    {
      name: 'has_program_end',
      description: 'G-code should end with M30 or M2',
      category: 'best_practice', severity: 'warning',
      check: (lines) => {
        const hasEnd = lines.some(l => /\bM30\b/i.test(l) || /\bM2\b/i.test(l));
        return {
          passed: hasEnd,
          message: hasEnd ? 'Program end present' : 'No program end (M30/M2)',
          lineNumbers: [],
        };
      },
    },
    {
      name: 'no_rapid_at_cutting_height',
      description: 'No rapid moves (G0) at cutting height',
      category: 'safety', severity: 'error',
      check: (lines) => {
        let currentZ = 0;
        const violations: number[] = [];
        for (let i = 0; i < lines.length; i++) {
          const zMatch = lines[i].match(/\bZ(-?\d*\.?\d+)/i);
          if (zMatch) currentZ = parseFloat(zMatch[1]);
          if (/\bG0\b/i.test(lines[i]) && currentZ < 0) {
            violations.push(i);
          }
        }
        return {
          passed: violations.length === 0,
          message: violations.length === 0 ? 'No rapid at cutting height' : `${violations.length} rapid moves at cutting height`,
          lineNumbers: violations,
        };
      },
    },
    {
      name: 'has_feed_rate',
      description: 'All G1 commands should have feed rate',
      category: 'quality', severity: 'warning',
      check: (lines) => {
        let hasFeedRate = false;
        const violations: number[] = [];
        for (let i = 0; i < lines.length; i++) {
          const fMatch = lines[i].match(/\bF\d/i);
          if (fMatch) hasFeedRate = true;
          if (/\bG1\b/i.test(lines[i]) && !fMatch && !hasFeedRate) {
            violations.push(i);
          }
        }
        return {
          passed: violations.length === 0,
          message: violations.length === 0 ? 'All G1 have feed rate' : `${violations.length} G1 without feed rate`,
          lineNumbers: violations,
        };
      },
    },
    {
      name: 'has_comments',
      description: 'G-code should have comments for documentation',
      category: 'best_practice', severity: 'info',
      check: (lines) => {
        const commentCount = lines.filter(l => l.trim().startsWith(';') || l.includes('(')).length;
        const ratio = lines.length > 0 ? commentCount / lines.length : 0;
        return {
          passed: ratio > 0.05,
          message: `Comment ratio: ${(ratio * 100).toFixed(1)}%`,
          lineNumbers: [],
        };
      },
    },
    {
      name: 'unit_mode_specified',
      description: 'G-code should specify unit mode (G20/G21)',
      category: 'compatibility', severity: 'warning',
      check: (lines) => {
        const hasUnit = lines.some(l => /\bG2[01]\b/i.test(l));
        return {
          passed: hasUnit,
          message: hasUnit ? 'Unit mode specified' : 'No unit mode (G20/G21)',
          lineNumbers: [],
        };
      },
    },
  ];

  const allRules = [...defaultRules, ...customRules];
  const violations: ValidationViolation[] = [];

  for (const rule of allRules) {
    const result = rule.check(lines);
    if (!result.passed) {
      violations.push({
        ruleName: rule.name,
        severity: rule.severity,
        message: result.message,
        lineNumbers: result.lineNumbers,
        category: rule.category,
      });
    }
  }

  const bySeverity = {
    error: violations.filter(v => v.severity === 'error').length,
    warning: violations.filter(v => v.severity === 'warning').length,
    info: violations.filter(v => v.severity === 'info').length,
  };

  const validationScore = Math.max(0, 100 -
    bySeverity.error * 25 - bySeverity.warning * 10 - bySeverity.info * 5
  );
  const passesAll = bySeverity.error === 0;

  const recommendations: string[] = [];
  for (const v of violations.sort((a, b) => {
    const order = { error: 0, warning: 1, info: 2 };
    return order[a.severity] - order[b.severity];
  }).slice(0, 3)) {
    recommendations.push(`[${v.severity.toUpperCase()}] ${v.ruleName}: ${v.message}`);
  }
  if (violations.length === 0) {
    recommendations.push('All validation rules passed');
  }

  return {
    violations, violationCount: violations.length,
    bySeverity, validationScore, passesAll,
    rulesChecked: allRules.length, recommendations,
  };
}

// ── 12. Machine Warmup/Cooldown Scheduler ──

export interface WarmupCooldownSchedule {
  /** Warmup routine lines */
  warmupLines: string[];
  /** Cooldown routine lines */
  cooldownLines: string[];
  /** Warmup duration in seconds */
  warmupDuration: number;
  /** Cooldown duration in seconds */
  cooldownDuration: number;
  /** Warmup RPM steps */
  warmupSteps: { rpm: number; duration: number }[];
  /** Cooldown steps */
  cooldownSteps: { rpm: number; duration: number }[];
  /** Total time in seconds */
  totalTime: number;
  /** Recommendations */
  recommendations: string[];
}

/**
 * Generate a spindle warmup and cooldown schedule.
 * Creates optimized warmup/cooldown routines based on:
 * - Maximum operating RPM
 * - Spindle type
 * - Ambient temperature
 *
 * @param maxRpm Maximum operating RPM
 * @param spindleType Spindle type ('bearing' | 'air' | 'ceramic')
 * @param ambientTemp Ambient temperature in °C
 */
export function scheduleWarmupCooldown(
  maxRpm: number,
  spindleType: 'bearing' | 'air' | 'ceramic' = 'bearing',
  ambientTemp: number = 20,
): WarmupCooldownSchedule {
  // Generate warmup steps (progressive RPM increase)
  const warmupSteps: { rpm: number; duration: number }[] = [];
  const stepCount = 4;
  const baseRpm = Math.max(500, maxRpm * 0.1);

  for (let i = 0; i < stepCount; i++) {
    const rpm = Math.round(baseRpm + (maxRpm - baseRpm) * (i / (stepCount - 1)));
    const duration = spindleType === 'ceramic' ? 30 : spindleType === 'air' ? 45 : 60;
    warmupSteps.push({ rpm, duration });
  }

  // Generate cooldown steps (progressive RPM decrease)
  const cooldownSteps: { rpm: number; duration: number }[] = [];
  for (let i = stepCount - 1; i >= 0; i--) {
    const rpm = Math.round(baseRpm + (maxRpm - baseRpm) * (i / (stepCount - 1)));
    const duration = spindleType === 'ceramic' ? 15 : spindleType === 'air' ? 20 : 30;
    cooldownSteps.push({ rpm, duration });
  }

  // Generate G-code lines
  const warmupLines: string[] = [
    '; === Spindle Warmup Routine ===',
    `; Type: ${spindleType}, Max RPM: ${maxRpm}, Ambient: ${ambientTemp}°C`,
  ];

  for (const step of warmupSteps) {
    warmupLines.push(`M3 S${step.rpm}`);
    warmupLines.push(`G4 P${step.duration} ; Warmup at ${step.rpm} RPM for ${step.duration}s`);
  }

  warmupLines.push('; === Warmup Complete ===');

  const cooldownLines: string[] = [
    '; === Spindle Cooldown Routine ===',
  ];

  for (const step of cooldownSteps) {
    cooldownLines.push(`M3 S${step.rpm}`);
    cooldownLines.push(`G4 P${step.duration} ; Cooldown at ${step.rpm} RPM for ${step.duration}s`);
  }

  cooldownLines.push('M5 ; Spindle off');
  cooldownLines.push('G4 P10 ; Final settle');
  cooldownLines.push('; === Cooldown Complete ===');

  const warmupDuration = warmupSteps.reduce((s, step) => s + step.duration, 0);
  const cooldownDuration = cooldownSteps.reduce((s, step) => s + step.duration, 0);
  const totalTime = warmupDuration + cooldownDuration;

  const recommendations: string[] = [];
  recommendations.push(`Warmup: ${warmupDuration}s (${warmupSteps.length} steps up to ${maxRpm} RPM)`);
  recommendations.push(`Cooldown: ${cooldownDuration}s (${cooldownSteps.length} steps)`);
  recommendations.push(`Total warmup/cooldown time: ${(totalTime / 60).toFixed(1)} min`);
  if (spindleType === 'bearing' && maxRpm > 10000) {
    recommendations.push('High RPM with bearing spindle — extend warmup duration');
  }
  if (ambientTemp < 10) {
    recommendations.push('Cold environment — double warmup duration for proper lubrication');
  }

  return {
    warmupLines, cooldownLines, warmupDuration, cooldownDuration,
    warmupSteps, cooldownSteps, totalTime, recommendations,
  };
}
