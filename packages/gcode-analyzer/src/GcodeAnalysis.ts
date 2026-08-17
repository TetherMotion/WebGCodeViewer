/**
 * @file GcodeAnalysis.ts
 * @brief G-code feature type parsing helpers used by the viewer UI.
 *
 * These are pure functions that operate on the G-code text already loaded
 * in the viewer. No backend changes required.
 */

// ── Types ──

export type SlicerType = 'cura' | 'prusa' | 'orca' | 'bambu' | 'unknown';

export interface FeatureTypeSegment {
  /** G-code line number where this feature type starts */
  lineNumber: number;
  /** Feature type label (e.g., "PERIMETER", "FILL", "SUPPORT") */
  featureType: string;
  /** Slicer that produced this comment */
  slicer: SlicerType;
}

// ── Feature Type Parsing ──

/**
 * Detect the slicer type from G-code comments.
 */
export function detectSlicer(lines: string[]): SlicerType {
  // Check first 200 lines for slicer identification
  const checkLines = lines.slice(0, Math.min(200, lines.length));
  for (const line of checkLines) {
    const lower = line.toLowerCase();
    if (lower.includes(';generated with cura') || lower.includes(';cura')) {
      return 'cura';
    }
    if (lower.includes('prusaslicer') || lower.includes('prusa slicer')) {
      return 'prusa';
    }
    if (lower.includes(';orca')) {
      return 'orca';
    }
    if (lower.includes(';bambu') || lower.includes('bambu studio')) {
      return 'bambu';
    }
  }
  return 'unknown';
}

/**
 * Parse slicer feature type comments (e.g., ";TYPE:PERIMETER").
 * Supports Cura, PrusaSlicer, Orca, and Bambu Studio formats.
 */
export function parseFeatureTypes(lines: string[]): FeatureTypeSegment[] {
  const slicer = detectSlicer(lines);
  const segments: FeatureTypeSegment[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // PrusaSlicer/Orca/Bambu format: ;TYPE:PERIMETER
    const typeMatch = line.match(/^;\s*TYPE:\s*(.+)/i);
    if (typeMatch) {
      segments.push({
        lineNumber: i,
        featureType: typeMatch[1].trim().toUpperCase(),
        slicer,
      });
      continue;
    }
    // Cura format: ;TYPE:WALL-OUTER or ;MESH:NONMESH
    const meshMatch = line.match(/^;\s*MESH:\s*(.+)/i);
    if (meshMatch) {
      segments.push({
        lineNumber: i,
        featureType: `MESH:${meshMatch[1].trim().toUpperCase()}`,
        slicer,
      });
      continue;
    }
    // Cura feature type: ;FEATURE:Infill
    const featureMatch = line.match(/^;\s*FEATURE:\s*(.+)/i);
    if (featureMatch) {
      segments.push({
        lineNumber: i,
        featureType: featureMatch[1].trim().toUpperCase(),
        slicer,
      });
    }
  }

  return segments;
}

/**
 * Get the feature type active at a given line number.
 */
export function getFeatureTypeAtLine(segments: FeatureTypeSegment[], lineNumber: number): string | null {
  let active: string | null = null;
  for (const seg of segments) {
    if (seg.lineNumber > lineNumber) break;
    active = seg.featureType;
  }
  return active;
}
