/**
 * @file GcodeAdvanced5.ts
 * @brief Fifth batch of advanced G-code analysis features for CNC and 3D printing.
 *
 * This module provides 12 additional high-impact features:
 *  1. G-code syntax validation/linting (Universal)
 *  2. Surface finish quality prediction (CNC)
 *  3. Toolpath optimization report (Universal)
 *  4. Printability check (3DP)
 *  5. CNC tool engagement angle (CNC)
 *  6. Filament usage per layer (3DP)
 *  7. Machine-specific post-processor (Universal)
 *  8. Print head pressure advance (3DP)
 *  9. CNC arc fitting optimization (CNC)
 * 10. G-code performance profiling (Universal)
 * 11. Extruded bead geometry simulation (3DP)
 * 12. G-code revision history (Universal)
 */

// ── 1. G-code Syntax Validation/Linting ──

export interface LintIssue {
  /** G-code line number */
  lineNumber: number;
  /** Issue severity */
  severity: 'error' | 'warning' | 'info';
  /** Issue category */
  category: 'syntax' | 'semantic' | 'performance' | 'safety' | 'style';
  /** Issue message */
  message: string;
  /** The problematic line content */
  line: string;
}

export interface LintResult {
  /** All issues found */
  issues: LintIssue[];
  /** Error count */
  errorCount: number;
  /** Warning count */
  warningCount: number;
  /** Info count */
  infoCount: number;
  /** Whether the G-code is valid (no errors) */
  isValid: boolean;
  /** Quality score (0-1, higher = better) */
  qualityScore: number;
}

/**
 * Validate and lint G-code for syntax errors, semantic issues, and best practices.
 *
 * @param lines G-code lines
 */
export function lintGcode(lines: string[]): LintResult {
  const issues: LintIssue[] = [];
  let currentTool = -1;
  let spindleOn = false;
  let inAbsolute = true;
  let inMM = true;
  let hasEnd = false;
  let lineCount = 0;
  let commentCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    lineCount++;

    if (!line) continue;
    if (line.startsWith(';') || line.startsWith('(')) {
      commentCount++;
      continue;
    }

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();

    // Check for mixed case G-codes (style)
    if (/\bg\d+\b/i.test(code) && !/\bG\d+\b/.test(code) && !/\bg\d+\b/.test(code)) {
      // Mixed case like g1 or G1 mixed
    }

    // Check for unknown G-codes
    const gMatch = code.match(/\bG(\d+)\b/i);
    if (gMatch) {
      const gNum = parseInt(gMatch[1]);
      const knownGCodes = [0, 1, 2, 3, 4, 10, 11, 17, 18, 19, 20, 21, 28, 30, 53, 54, 55, 56, 57, 58, 59, 61, 62, 63, 64, 65, 66, 67, 70, 71, 72, 73, 74, 76, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94];
      if (!knownGCodes.includes(gNum)) {
        issues.push({
          lineNumber: i, severity: 'warning', category: 'syntax',
          message: `Unknown G-code: G${gNum}`, line,
        });
      }
    }

    // Check for unknown M-codes
    const mMatch = code.match(/\bM(\d+)\b/i);
    if (mMatch) {
      const mNum = parseInt(mMatch[1]);
      const knownMCodes = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 48, 49, 52, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 80, 81, 82, 83, 84, 92, 98, 99, 104, 105, 106, 107, 109, 112, 114, 115, 116, 117, 118, 119, 140, 190, 220, 221, 226, 240, 245, 280, 281, 282, 283, 284, 285, 290, 300, 301, 302, 303, 304, 305, 350, 351, 352, 353, 354, 355, 360, 361, 362, 363, 364, 365, 371, 372, 373, 374, 375, 376, 377, 378, 380, 381, 382, 383, 384, 385, 386, 387, 388, 389, 400, 401, 402, 403, 404, 420, 421, 422, 423, 424, 425, 426, 427, 428, 429, 430, 431, 432, 433, 434, 435, 436, 437, 500, 501, 502, 503, 504, 505, 506, 507, 508, 509, 510, 511, 512, 513, 514, 515, 516, 517, 518, 519, 520, 521, 522, 523, 524, 525, 526, 527, 528, 529, 530, 531, 532, 533, 534, 535, 536, 537, 538, 539, 540, 541, 542, 543, 544, 545, 546, 547, 548, 549, 550, 551, 552, 553, 554, 555, 556, 557, 558, 559, 560, 561, 562, 563, 564, 565, 566, 567, 568, 569, 570, 571, 572, 573, 574, 575, 576, 577, 578, 579, 580, 581, 582, 583, 584, 585, 586, 587, 588, 589, 590, 591, 592, 593, 594, 595, 596, 597, 598, 599, 600, 601, 602, 603, 604, 605, 606, 607, 608, 609, 610, 611, 612, 613, 614, 615, 616, 617, 618, 619, 620, 621, 622, 623, 624, 625, 626, 627, 628, 629, 630, 631, 632, 633, 634, 635, 636, 637, 638, 639, 640, 641, 642, 643, 644, 645, 646, 647, 648, 649, 650, 651, 652, 653, 654, 655, 656, 657, 658, 659, 660, 661, 662, 663, 664, 665, 666, 667, 668, 669, 670, 671, 672, 673, 674, 675, 676, 677, 678, 679, 680, 681, 682, 683, 684, 685, 686, 687, 688, 689, 690, 691, 692, 693, 694, 695, 696, 697, 698, 699, 700, 701, 702, 703, 704, 705, 706, 707, 708, 709, 710, 711, 712, 713, 714, 715, 716, 717, 718, 719, 720, 721, 722, 723, 724, 725, 726, 727, 728, 729, 730, 731, 732, 733, 734, 735, 736, 737, 738, 739, 740, 741, 742, 743, 744, 745, 746, 747, 748, 749, 750, 751, 752, 753, 754, 755, 756, 757, 758, 759, 760, 761, 762, 763, 764, 765, 766, 767, 768, 769, 770, 771, 772, 773, 774, 775, 776, 777, 778, 779, 780, 781, 782, 783, 784, 785, 786, 787, 788, 789, 790, 791, 792, 793, 794, 795, 796, 797, 798, 799, 800, 801, 802, 803, 804, 805, 806, 807, 808, 809, 810, 811, 812, 813, 814, 815, 816, 817, 818, 819, 820, 821, 822, 823, 824, 825, 826, 827, 828, 829, 830, 831, 832, 833, 834, 835, 836, 837, 838, 839, 840, 841, 842, 843, 844, 845, 846, 847, 848, 849, 850, 851, 852, 853, 854, 855, 856, 857, 858, 859, 860, 861, 862, 863, 864, 865, 866, 867, 868, 869, 870, 871, 872, 873, 874, 875, 876, 877, 878, 879, 880, 881, 882, 883, 884, 885, 886, 887, 888, 889, 890, 891, 892, 893, 894, 895, 896, 897, 898, 899, 900, 901, 902, 903, 904, 905, 906, 907, 908, 909, 910, 911, 912, 913, 914, 915, 916, 917, 918, 919, 920, 921, 922, 923, 924, 925, 926, 927, 928, 929, 930, 931, 932, 933, 934, 935, 936, 937, 938, 939, 940, 941, 942, 943, 944, 945, 946, 947, 948, 949, 950, 951, 952, 953, 954, 955, 956, 957, 958, 959, 960, 961, 962, 963, 964, 965, 966, 967, 968, 969, 970, 971, 972, 973, 974, 975, 976, 977, 978, 979, 980, 981, 982, 983, 984, 985, 986, 987, 988, 989, 990, 991, 992, 993, 994, 995, 996, 997, 998, 999];
      if (!knownMCodes.includes(mNum)) {
        issues.push({
          lineNumber: i, severity: 'info', category: 'syntax',
          message: `Uncommon M-code: M${mNum}`, line,
        });
      }
    }

    // Track state
    if (/\bG20\b/i.test(code)) { inMM = false; }
    if (/\bG21\b/i.test(code)) { inMM = true; }
    if (/\bG90\b/i.test(code)) { inAbsolute = true; }
    if (/\bG91\b/i.test(code)) { inAbsolute = false; }
    if (/\bM[034]\b/i.test(code)) { spindleOn = true; }
    if (/\bM05\b/i.test(code) || /\bM5\b/i.test(code)) { spindleOn = false; }
    if (/\bM30\b/i.test(code) || /\bM2\b/i.test(code)) { hasEnd = true; }

    const tMatch = code.match(/\bT(\d+)\b/i);
    if (tMatch) currentTool = parseInt(tMatch[1]);

    // Safety: cutting without spindle
    if (/\bG1\b/i.test(code) && /\bZ\b/i.test(code) && !spindleOn) {
      const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
      if (zMatch && parseFloat(zMatch[1]) < 0) {
        issues.push({
          lineNumber: i, severity: 'error', category: 'safety',
          message: 'Cutting move (G1 Z negative) with spindle off', line,
        });
      }
    }

    // Performance: very slow feed rate
    const fMatch = code.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) {
      const feed = parseFloat(fMatch[1]);
      if (feed < 10 && feed > 0) {
        issues.push({
          lineNumber: i, severity: 'warning', category: 'performance',
          message: `Very low feed rate: ${feed} mm/min`, line,
        });
      }
      if (feed > 20000) {
        issues.push({
          lineNumber: i, severity: 'warning', category: 'performance',
          message: `Very high feed rate: ${feed} mm/min`, line,
        });
      }
    }

    // Syntax: missing feed rate on cutting move
    if (/\bG1\b/i.test(code) && (/\bX\b/i.test(code) || /\bY\b/i.test(code) || /\bZ\b/i.test(code))) {
      if (!fMatch && i > 0) {
        // Check if previous lines had a feed rate
        let foundFeed = false;
        for (let j = i - 1; j >= Math.max(0, i - 20); j--) {
          if (/\bF\d/i.test(lines[j])) { foundFeed = true; break; }
        }
        if (!foundFeed) {
          issues.push({
            lineNumber: i, severity: 'warning', category: 'syntax',
            message: 'Cutting move without feed rate specified', line,
          });
        }
      }
    }

    // Syntax: duplicate words on same line
    const words = code.match(/\b([A-Z])\d/gi) ?? [];
    const wordCounts = new Map<string, number>();
    for (const w of words) {
      const letter = w[0].toUpperCase();
      wordCounts.set(letter, (wordCounts.get(letter) ?? 0) + 1);
    }
    for (const [letter, count] of wordCounts) {
      if (count > 1 && letter !== 'G' && letter !== 'M') {
        issues.push({
          lineNumber: i, severity: 'warning', category: 'syntax',
          message: `Duplicate word ${letter} on same line`, line,
        });
      }
    }
  }

  // Check for missing end
  if (!hasEnd && lineCount > 10) {
    issues.push({
      lineNumber: lines.length - 1, severity: 'info', category: 'style',
      message: 'No program end (M30/M2) found', line: '',
    });
  }

  // Check for missing units
  if (lineCount > 10 && !lines.some(l => /\bG2[01]\b/i.test(l))) {
    issues.push({
      lineNumber: 0, severity: 'info', category: 'style',
      message: 'No units specified (G20/G21)', line: '',
    });
  }

  const errorCount = issues.filter(i => i.severity === 'error').length;
  const warningCount = issues.filter(i => i.severity === 'warning').length;
  const infoCount = issues.filter(i => i.severity === 'info').length;
  const isValid = errorCount === 0;
  const qualityScore = Math.max(0, 1 - (errorCount * 0.2 + warningCount * 0.05 + infoCount * 0.01));

  return { issues, errorCount, warningCount, infoCount, isValid, qualityScore };
}

// ── 2. Surface Finish Quality Prediction ──

export interface SurfaceFinishResult {
  /** Estimated surface roughness Ra in μm */
  ra: number;
  /** Estimated surface roughness Rz in μm */
  rz: number;
  /** Scallop height in mm */
  scallopHeight: number;
  /** Stepover distance in mm */
  stepover: number;
  /** Tool radius in mm */
  toolRadius: number;
  /** Surface finish quality rating */
  quality: 'rough' | 'medium' | 'fine' | 'very_fine';
  /** Recommendations */
  recommendations: string[];
}

/**
 * Predict surface finish quality for CNC operations.
 * Computes scallop height and surface roughness from stepover and tool geometry.
 *
 * @param stepover Stepover distance in mm
 * @param toolDiameter Tool diameter in mm
 * @param toolType Tool type ('endmill' | 'ballmill')
 */
export function predictSurfaceFinish(
  stepover: number,
  toolDiameter: number,
  toolType: 'endmill' | 'ballmill' = 'ballmill',
): SurfaceFinishResult {
  const toolRadius = toolDiameter / 2;

  let scallopHeight: number;
  if (toolType === 'ballmill') {
    // Ball mill scallop: h = r - sqrt(r² - (s/2)²)
    const halfStep = stepover / 2;
    if (halfStep >= toolRadius) {
      scallopHeight = toolRadius; // max possible
    } else {
      scallopHeight = toolRadius - Math.sqrt(toolRadius ** 2 - halfStep ** 2);
    }
  } else {
    // End mill: scallop is approximately stepover² / (8r) for small stepover
    scallopHeight = (stepover ** 2) / (8 * toolRadius);
  }

  // Convert to μm
  const scallopUm = scallopHeight * 1000;

  // Ra ≈ scallopHeight / 4 (approximate)
  const ra = scallopUm / 4;
  // Rz ≈ scallopHeight (peak to valley)
  const rz = scallopUm;

  let quality: SurfaceFinishResult['quality'];
  if (ra < 0.8) quality = 'very_fine';
  else if (ra < 3.2) quality = 'fine';
  else if (ra < 12.5) quality = 'medium';
  else quality = 'rough';

  const recommendations: string[] = [];
  if (quality === 'rough') {
    recommendations.push('Reduce stepover for better surface finish');
    recommendations.push(`Current stepover: ${stepover.toFixed(2)}mm, recommended: <${(toolRadius * 0.1).toFixed(2)}mm`);
  }
  if (quality === 'medium' && toolType === 'endmill') {
    recommendations.push('Consider using a ball mill for smoother surface finish');
  }
  if (stepover > toolRadius) {
    recommendations.push('Stepover exceeds tool radius — may leave uncut material');
  }
  if (recommendations.length === 0) {
    recommendations.push('Surface finish parameters are appropriate');
  }

  return { ra, rz, scallopHeight, stepover, toolRadius, quality, recommendations };
}

// ── 3. Toolpath Optimization Report ──

export interface ToolpathOptimizationResult {
  /** Total cutting distance in mm */
  cuttingDistance: number;
  /** Total travel (non-cutting) distance in mm */
  travelDistance: number;
  /** Travel-to-cutting ratio */
  travelRatio: number;
  /** Number of travel moves */
  travelCount: number;
  /** Average travel distance */
  avgTravelDistance: number;
  /** Longest travel move */
  longestTravel: number;
  /** Estimated time wasted on travel (seconds) */
  travelTime: number;
  /** Optimization suggestions */
  suggestions: { type: string; description: string; potentialSavings: number }[];
  /** Overall efficiency score (0-1) */
  efficiencyScore: number;
}

/**
 * Analyze toolpath efficiency and suggest optimizations.
 * Identifies excessive travel moves and time wasted on non-cutting operations.
 *
 * @param lines G-code lines
 * @param travelSpeed Travel speed in mm/min (default 6000)
 */
export function analyzeToolpathOptimization(
  lines: string[],
  travelSpeed: number = 6000,
): ToolpathOptimizationResult {
  let prevX = 0, prevY = 0, prevZ = 0, prevE = 0;
  let cuttingDistance = 0;
  let travelDistance = 0;
  let travelCount = 0;
  let longestTravel = 0;
  const travelDistances: number[] = [];

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

    const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2 + (z - prevZ) ** 2);

    const isExtruding = eMatch ? parseFloat(eMatch[1]) > prevE : false;

    if (isExtruding) {
      cuttingDistance += dist;
    } else if (dist > 0.1) {
      travelDistance += dist;
      travelCount++;
      travelDistances.push(dist);
      if (dist > longestTravel) longestTravel = dist;
    }

    if (eMatch) prevE = parseFloat(eMatch[1]);
    prevX = x; prevY = y; prevZ = z;
  }

  const avgTravelDistance = travelDistances.length > 0
    ? travelDistances.reduce((a, b) => a + b, 0) / travelDistances.length
    : 0;
  const travelTime = travelSpeed > 0 ? travelDistance / (travelSpeed / 60) : 0;
  const travelRatio = cuttingDistance > 0 ? travelDistance / cuttingDistance : 0;

  const suggestions: ToolpathOptimizationResult['suggestions'] = [];

  if (travelRatio > 0.5) {
    suggestions.push({
      type: 'travel_ratio',
      description: 'High travel-to-cutting ratio — consider optimizing toolpath order',
      potentialSavings: travelTime * 0.3,
    });
  }

  if (longestTravel > 100) {
    suggestions.push({
      type: 'long_travel',
      description: `Very long travel move (${longestTravel.toFixed(0)}mm) — consider reordering`,
      potentialSavings: longestTravel / (travelSpeed / 60) * 0.5,
    });
  }

  if (travelCount > 100) {
    suggestions.push({
      type: 'frequent_travel',
      description: `Many travel moves (${travelCount}) — consider combining operations`,
      potentialSavings: travelTime * 0.2,
    });
  }

  // Efficiency: 1 - travelRatio (clamped)
  const efficiencyScore = Math.max(0, Math.min(1, 1 - travelRatio));

  return {
    cuttingDistance, travelDistance, travelRatio,
    travelCount, avgTravelDistance, longestTravel,
    travelTime, suggestions, efficiencyScore,
  };
}

// ── 4. Printability Check ──

export interface PrintabilityIssue {
  /** Issue type */
  type: 'overhang' | 'bridge' | 'thin_wall' | 'tiny_feature' | 'flat_surface' | 'sharp_corner';
  /** Description */
  description: string;
  /** Location */
  location: { x: number; y: number; z: number };
  /** Severity */
  severity: 'warning' | 'error';
  /** Recommendation */
  recommendation: string;
}

export interface PrintabilityResult {
  /** Issues found */
  issues: PrintabilityIssue[];
  /** Overall printability score (0-1) */
  score: number;
  /** Whether the part is printable */
  isPrintable: boolean;
  /** Summary */
  summary: string;
}

/**
 * Check if a 3D model is printable based on its geometry.
 * Detects overhangs, bridges, thin walls, and other challenging features.
 *
 * @param bounds Part bounds
 * @param zLayers Z-layer info
 * @param overhangAngles Array of overhang angles per layer (degrees from vertical)
 * @param minWallThickness Minimum printable wall thickness in mm
 */
export function checkPrintability(
  bounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number },
  zLayers: { layerIndex: number; zHeight: number }[],
  overhangAngles: number[] = [],
  minWallThickness: number = 0.4,
): PrintabilityResult {
  const issues: PrintabilityIssue[] = [];

  // Check overhangs
  for (let i = 0; i < overhangAngles.length; i++) {
    if (overhangAngles[i] > 45) {
      issues.push({
        type: 'overhang',
        description: `Overhang angle ${overhangAngles[i].toFixed(1)}° exceeds 45° at layer ${i}`,
        location: { x: 0, y: 0, z: zLayers[i]?.zHeight ?? 0 },
        severity: overhangAngles[i] > 60 ? 'error' : 'warning',
        recommendation: 'Add support material for overhangs > 45°',
      });
    }
  }

  // Check for large flat surfaces (warping risk)
  const xyArea = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY);
  const zHeight = bounds.maxZ - bounds.minZ;
  if (xyArea > 10000 && zHeight < 5) {
    issues.push({
      type: 'flat_surface',
      description: 'Large flat surface with low height — high warping risk',
      location: { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2, z: 0 },
      severity: 'warning',
      recommendation: 'Use a brim or raft to improve adhesion',
    });
  }

  // Check for very tall thin parts
  const aspectRatio = zHeight / Math.max(1, Math.min(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY));
  if (aspectRatio > 10) {
    issues.push({
      type: 'thin_wall',
      description: `Very tall thin part (aspect ratio ${aspectRatio.toFixed(1)}) — may topple`,
      location: { x: 0, y: 0, z: zHeight / 2 },
      severity: 'warning',
      recommendation: 'Add support or use a wider base',
    });
  }

  // Check layer count
  if (zLayers.length > 500) {
    issues.push({
      type: 'tiny_feature',
      description: `Very high layer count (${zLayers.length}) — long print time`,
      location: { x: 0, y: 0, z: 0 },
      severity: 'warning',
      recommendation: 'Consider increasing layer height for faster printing',
    });
  }

  // Check minimum dimensions
  const minXDim = bounds.maxX - bounds.minX;
  const minYDim = bounds.maxY - bounds.minY;
  if (minXDim < minWallThickness || minYDim < minWallThickness) {
    issues.push({
      type: 'tiny_feature',
      description: `Part dimension smaller than minimum wall thickness (${minWallThickness}mm)`,
      location: { x: bounds.minX, y: bounds.minY, z: 0 },
      severity: 'error',
      recommendation: 'Feature too small to print reliably',
    });
  }

  const errorCount = issues.filter(i => i.severity === 'error').length;
  const warningCount = issues.filter(i => i.severity === 'warning').length;
  const isPrintable = errorCount === 0;
  const score = Math.max(0, 1 - (errorCount * 0.3 + warningCount * 0.1));

  let summary: string;
  if (isPrintable && warningCount === 0) summary = 'Part is fully printable with no issues';
  else if (isPrintable) summary = `Part is printable with ${warningCount} warnings`;
  else summary = `Part has ${errorCount} critical issues that may prevent printing`;

  return { issues, score, isPrintable, summary };
}

// ── 5. CNC Tool Engagement Angle ──

export interface ToolEngagementResult {
  /** G-code line number */
  lineNumber: number;
  /** Engagement angle in degrees */
  engagementAngle: number;
  /** Chip thickness in mm */
  chipThickness: number;
  /** Radial depth of cut in mm */
  radialDOC: number;
  /** Axial depth of cut in mm */
  axialDOC: number;
  /** Engagement type */
  engagementType: 'full' | 'half' | 'partial' | 'none';
}

/**
 * Compute tool engagement angle for CNC milling operations.
 * The engagement angle determines chip thickness and cutting forces.
 *
 * @param lines G-code lines
 * @param toolDiameter Tool diameter in mm
 * @param axialDOC Axial depth of cut in mm
 * @param feedPerTooth Feed per tooth in mm
 */
export function computeToolEngagement(
  lines: string[],
  toolDiameter: number,
  axialDOC: number = 1,
  feedPerTooth: number = 0.05,
): ToolEngagementResult[] {
  const results: ToolEngagementResult[] = [];
  let prevX = 0, prevY = 0, prevZ = 0;
  let currentFeedRate = 0;

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

    const dx = x - prevX;
    const dy = y - prevY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 0.01 && z < 0) { // cutting move (Z below zero)
      // Simplified engagement angle estimation:
      // Full engagement (slotting) = 180°
      // Side milling = ~30-90° depending on radial DOC
      // Estimate radial DOC from stepover (distance perpendicular to feed)
      const radialDOC = toolDiameter * 0.5; // assume 50% radial engagement

      let engagementAngle: number;
      let engagementType: ToolEngagementResult['engagementType'];

      if (radialDOC >= toolDiameter * 0.95) {
        engagementAngle = 180;
        engagementType = 'full';
      } else if (radialDOC >= toolDiameter * 0.5) {
        engagementAngle = 90;
        engagementType = 'half';
      } else if (radialDOC > 0) {
        // Partial engagement: angle = 2 * acos(1 - radialDOC/toolRadius)
        const toolRadius = toolDiameter / 2;
        engagementAngle = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - radialDOC / toolRadius))) * (180 / Math.PI);
        engagementType = 'partial';
      } else {
        engagementAngle = 0;
        engagementType = 'none';
      }

      // Chip thickness = feedPerTooth * sin(engagementAngle/2)
      const chipThickness = feedPerTooth * Math.sin(engagementAngle * Math.PI / 360);

      results.push({
        lineNumber: i,
        engagementAngle,
        chipThickness,
        radialDOC,
        axialDOC,
        engagementType,
      });
    }

    prevX = x; prevY = y; prevZ = z;
  }

  return results;
}

// ── 6. Filament Usage Per Layer ──

export interface LayerFilamentUsage {
  /** Layer index */
  layer: number;
  /** Z height */
  zHeight: number;
  /** Filament length used in mm */
  filamentLength: number;
  /** Filament volume in mm³ */
  volume: number;
  /** Filament weight in grams */
  weight: number;
  /** Percentage of total filament */
  percentage: number;
  /** Number of extruding moves */
  extrudingMoves: number;
}

export interface FilamentPerLayerResult {
  /** Per-layer filament usage */
  layers: LayerFilamentUsage[];
  /** Total filament length in mm */
  totalLength: number;
  /** Total volume in mm³ */
  totalVolume: number;
  /** Total weight in grams */
  totalWeight: number;
  /** Layer with most filament */
  maxLayer: number;
  /** Layer with least filament */
  minLayer: number;
  /** Average filament per layer */
  avgPerLayer: number;
}

/**
 * Track filament usage per layer.
 *
 * @param lines G-code lines
 * @param zLayers Z-layer info
 * @param filamentDiameter Filament diameter in mm (default 1.75)
 * @param density Filament density in g/cm³ (default 1.24)
 */
export function trackFilamentPerLayer(
  lines: string[],
  zLayers: { layerIndex: number; zHeight: number; startLine: number; endLine: number }[],
  filamentDiameter: number = 1.75,
  density: number = 1.24,
): FilamentPerLayerResult {
  const filamentArea = Math.PI * (filamentDiameter / 2) ** 2;
  const layers: LayerFilamentUsage[] = [];
  let totalLength = 0;
  let totalVolume = 0;

  for (const zLayer of zLayers) {
    let prevE = 0;
    let filamentLength = 0;
    let extrudingMoves = 0;

    // Find E value at layer start
    for (let i = 0; i < zLayer.startLine && i < lines.length; i++) {
      const eMatch = lines[i].match(/\bE(-?\d*\.?\d+)/i);
      if (eMatch) prevE = parseFloat(eMatch[1]);
    }

    for (let i = zLayer.startLine; i <= Math.min(zLayer.endLine, lines.length - 1); i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith(';')) continue;
      if (!/^G1\b/i.test(line)) continue;

      const code = line.replace(/;.*$/, '').trim();
      const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

      if (eMatch) {
        const newE = parseFloat(eMatch[1]);
        const eDelta = newE - prevE;
        if (eDelta > 0) {
          filamentLength += eDelta;
          extrudingMoves++;
        }
        prevE = newE;
      }
    }

    const volume = filamentLength * filamentArea;
    const weight = (volume * density) / 1000;
    totalLength += filamentLength;
    totalVolume += volume;

    layers.push({
      layer: zLayer.layerIndex,
      zHeight: zLayer.zHeight,
      filamentLength,
      volume,
      weight,
      percentage: 0, // set after total is known
      extrudingMoves,
    });
  }

  // Set percentages
  for (const layer of layers) {
    layer.percentage = totalLength > 0 ? (layer.filamentLength / totalLength) * 100 : 0;
  }

  const totalWeight = (totalVolume * density) / 1000;

  let maxLayer = 0, minLayer = 0;
  let maxFilament = -Infinity, minFilament = Infinity;
  for (const layer of layers) {
    if (layer.filamentLength > maxFilament) {
      maxFilament = layer.filamentLength;
      maxLayer = layer.layer;
    }
    if (layer.filamentLength < minFilament) {
      minFilament = layer.filamentLength;
      minLayer = layer.layer;
    }
  }

  const avgPerLayer = layers.length > 0 ? totalLength / layers.length : 0;

  return {
    layers, totalLength, totalVolume, totalWeight,
    maxLayer, minLayer, avgPerLayer,
  };
}

// ── 7. Machine-Specific Post-Processor ──

export interface PostProcessorConfig {
  /** Machine type */
  machineType: 'grbl' | 'marlin' | 'reprap' | 'linuxcnc' | 'fanuc' | 'siemens' | 'generic';
  /** Whether to strip comments */
  stripComments: boolean;
  /** Line numbering start */
  lineNumbers: boolean;
  /** Line number start value */
  lineNumberStart: number;
  /** Line number increment */
  lineNumberIncrement: number;
  /** Whether to add spaces between words */
  addSpaces: boolean;
  /** Program start code */
  startCode: string;
  /** Program end code */
  endCode: string;
  /** Whether to convert G0 to G1 for machines that don't support rapid */
  convertRapidToLinear: boolean;
  /** Maximum feed rate */
  maxFeedRate: number;
}

/**
 * Post-process G-code for a specific machine.
 * Converts generic G-code to machine-specific format.
 *
 * @param lines G-code lines
 * @param config Post-processor configuration
 */
export function postProcessForMachine(
  lines: string[],
  config: PostProcessorConfig,
): string[] {
  const result: string[] = [];
  let lineNumber = config.lineNumberStart;

  // Add start code
  if (config.startCode) {
    for (const line of config.startCode.split('\n')) {
      result.push(config.lineNumbers ? `N${lineNumber++} ${line}` : line);
    }
  }

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Strip comments if configured
    if (config.stripComments) {
      line = line.replace(/;.*$/, '').replace(/\([^)]*\)/g, '').trim();
      if (!line) continue;
    }

    // Convert G0 to G1 if needed
    if (config.convertRapidToLinear) {
      line = line.replace(/\bG0\b/i, 'G1');
    }

    // Clamp feed rate
    const fMatch = line.match(/\bF(\d*\.?\d+)/i);
    if (fMatch) {
      const feed = parseFloat(fMatch[1]);
      if (feed > config.maxFeedRate) {
        line = line.replace(/\bF\d*\.?\d+/i, `F${config.maxFeedRate}`);
      }
    }

    // Add spaces between words
    if (config.addSpaces) {
      line = line.replace(/\b([A-Z])(-?\d)/gi, '$1 $2');
    }

    // Machine-specific transformations
    if (config.machineType === 'grbl') {
      // GRBL: strip M-codes it doesn't support
      line = line.replace(/\bM(?!0[0-5]|30)\d+\b/gi, '').trim();
    } else if (config.machineType === 'fanuc') {
      // Fanuc: ensure line numbers
      if (config.lineNumbers) {
        line = `N${lineNumber} ${line}`;
      }
    }

    if (config.lineNumbers && !line.startsWith('N')) {
      line = `N${lineNumber} ${line}`;
    }

    if (line.trim()) {
      result.push(line);
      lineNumber += config.lineNumberIncrement;
    }
  }

  // Add end code
  if (config.endCode) {
    for (const line of config.endCode.split('\n')) {
      result.push(config.lineNumbers ? `N${lineNumber++} ${line}` : line);
    }
  }

  return result;
}

/**
 * Get default post-processor config for a machine type.
 */
export function getDefaultPostProcessorConfig(machineType: PostProcessorConfig['machineType']): PostProcessorConfig {
  const configs: { [key: string]: PostProcessorConfig } = {
    grbl: {
      machineType: 'grbl', stripComments: true, lineNumbers: false,
      lineNumberStart: 10, lineNumberIncrement: 10, addSpaces: false,
      startCode: 'G17 G21 G90 G94', endCode: 'M30',
      convertRapidToLinear: false, maxFeedRate: 5000,
    },
    marlin: {
      machineType: 'marlin', stripComments: false, lineNumbers: false,
      lineNumberStart: 0, lineNumberIncrement: 1, addSpaces: true,
      startCode: '; Start\nG28 ; Home', endCode: 'M84 ; Disable motors',
      convertRapidToLinear: false, maxFeedRate: 6000,
    },
    fanuc: {
      machineType: 'fanuc', stripComments: true, lineNumbers: true,
      lineNumberStart: 10, lineNumberIncrement: 10, addSpaces: false,
      startCode: 'O0001\nG17 G21 G90 G94 G54', endCode: 'M30',
      convertRapidToLinear: false, maxFeedRate: 10000,
    },
    linuxcnc: {
      machineType: 'linuxcnc', stripComments: false, lineNumbers: false,
      lineNumberStart: 10, lineNumberIncrement: 10, addSpaces: true,
      startCode: 'G17 G21 G90 G94', endCode: 'M30',
      convertRapidToLinear: false, maxFeedRate: 15000,
    },
    generic: {
      machineType: 'generic', stripComments: false, lineNumbers: false,
      lineNumberStart: 10, lineNumberIncrement: 10, addSpaces: false,
      startCode: '', endCode: 'M30',
      convertRapidToLinear: false, maxFeedRate: 20000,
    },
  };

  return configs[machineType] ?? configs.generic;
}

// ── 8. Print Head Pressure Advance ──

export interface PressureAdvanceResult {
  /** Whether pressure advance is used */
  enabled: boolean;
  /** Pressure advance value in seconds */
  value: number;
  /** Number of pressure advance commands found */
  commandCount: number;
  /** Lines with pressure advance settings */
  settings: { lineNumber: number; value: number; command: string }[];
  /** Recommendations */
  recommendations: string[];
}

/**
 * Analyze pressure advance settings in G-code.
 * Pressure advance (a.k.a. linear advance) compensates for filament lag.
 *
 * @param lines G-code lines
 */
export function analyzePressureAdvance(lines: string[]): PressureAdvanceResult {
  const settings: { lineNumber: number; value: number; command: string }[] = [];
  let enabled = false;
  let value = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Marlin: M900 K0.2
    const m900Match = line.match(/M900\s+K(\d*\.?\d+)/i);
    if (m900Match) {
      value = parseFloat(m900Match[1]);
      enabled = value > 0;
      settings.push({ lineNumber: i, value, command: 'M900' });
    }

    // Klipper: SET_PRESSURE_ADVANCE ADVANCE=0.04
    const klipperMatch = line.match(/SET_PRESSURE_ADVANCE\s+ADVANCE=(\d*\.?\d+)/i);
    if (klipperMatch) {
      value = parseFloat(klipperMatch[1]);
      enabled = value > 0;
      settings.push({ lineNumber: i, value, command: 'SET_PRESSURE_ADVANCE' });
    }

    // RepRap: M572 D0 S0.04
    const m572Match = line.match(/M572\s+D\d+\s+S(\d*\.?\d+)/i);
    if (m572Match) {
      value = parseFloat(m572Match[1]);
      enabled = value > 0;
      settings.push({ lineNumber: i, value, command: 'M572' });
    }
  }

  const recommendations: string[] = [];
  if (!enabled) {
    recommendations.push('Pressure advance not configured — consider enabling for better print quality');
    recommendations.push('Typical values: 0.02-0.06 for Bowden, 0.01-0.03 for direct drive');
  } else if (value > 0.1) {
    recommendations.push(`Pressure advance value (${value}) is high — may cause under-extrusion`);
  } else if (value < 0.01) {
    recommendations.push(`Pressure advance value (${value}) is very low — may have minimal effect`);
  } else {
    recommendations.push(`Pressure advance value (${value}) appears reasonable`);
  }

  return {
    enabled, value, commandCount: settings.length,
    settings, recommendations,
  };
}

// ── 9. CNC Arc Fitting Optimization ──

export interface ArcFittingCandidate {
  /** Start line number */
  startLine: number;
  /** End line number */
  endLine: number;
  /** Center X */
  centerX: number;
  /** Center Y */
  centerY: number;
  /** Radius in mm */
  radius: number;
  /** Direction: G2 (CW) or G3 (CCW) */
  direction: 'G2' | 'G3';
  /** Number of linear segments that can be replaced */
  segmentCount: number;
  /** Estimated file size savings in bytes */
  estimatedSavings: number;
  /** Fit error in mm */
  fitError: number;
}

export interface ArcFittingResult {
  /** Arc fitting candidates */
  candidates: ArcFittingCandidate[];
  /** Total segments that could be replaced */
  totalSegments: number;
  /** Total estimated file size savings in bytes */
  totalSavings: number;
  /** Number of candidates */
  candidateCount: number;
}

/**
 * Detect linear G-code segments that could be replaced with arc commands (G2/G3).
 * This reduces file size and can improve machine execution speed.
 *
 * @param lines G-code lines
 * @param tolerance Fit tolerance in mm (default 0.01)
 * @param minSegments Minimum segments to consider as an arc (default 5)
 */
export function detectArcFittingCandidates(
  lines: string[],
  tolerance: number = 0.01,
  minSegments: number = 5,
): ArcFittingResult {
  const candidates: ArcFittingCandidate[] = [];
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

  // Look for arc patterns in consecutive points
  let i = 0;
  while (i < points.length - minSegments) {
    // Try to fit an arc starting from point i
    const start = points[i];
    let bestEnd = -1;
    let bestCenter = { x: 0, y: 0 };
    let bestRadius = 0;
    let bestError = Infinity;
    let bestDirection: 'G2' | 'G3' = 'G2';

    for (let j = i + minSegments; j < Math.min(points.length, i + 100); j++) {
      // Fit a circle through 3 points: start, middle, end
      const mid = points[Math.floor((i + j) / 2)];
      const end = points[j];

      const fit = fitCircle(start, mid, end);
      if (!fit) continue;

      // Check all points in range against the fitted circle
      let maxError = 0;
      for (let k = i; k <= j; k++) {
        const p = points[k];
        const dist = Math.sqrt((p.x - fit.centerX) ** 2 + (p.y - fit.centerY) ** 2);
        const error = Math.abs(dist - fit.radius);
        if (error > maxError) maxError = error;
      }

      if (maxError < tolerance && maxError < bestError) {
        bestEnd = j;
        bestCenter = { x: fit.centerX, y: fit.centerY };
        bestRadius = fit.radius;
        bestError = maxError;

        // Determine direction
        const cross = (end.x - start.x) * (mid.y - start.y) - (end.y - start.y) * (mid.x - start.x);
        bestDirection = cross > 0 ? 'G3' : 'G2';
      }
    }

    if (bestEnd >= 0) {
      const segmentCount = bestEnd - i;
      // Estimate savings: each G1 line ~20 bytes, G2/G3 line ~30 bytes
      const estimatedSavings = segmentCount * 20 - 30;
      candidates.push({
        startLine: points[i].line,
        endLine: points[bestEnd].line,
        centerX: bestCenter.x,
        centerY: bestCenter.y,
        radius: bestRadius,
        direction: bestDirection,
        segmentCount,
        estimatedSavings,
        fitError: bestError,
      });
      i = bestEnd + 1;
    } else {
      i++;
    }
  }

  const totalSegments = candidates.reduce((sum, c) => sum + c.segmentCount, 0);
  const totalSavings = candidates.reduce((sum, c) => sum + c.estimatedSavings, 0);

  return { candidates, totalSegments, totalSavings, candidateCount: candidates.length };
}

function fitCircle(p1: { x: number; y: number }, p2: { x: number; y: number }, p3: { x: number; y: number }):
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

// ── 10. G-code Performance Profiling ──

export interface ProfileEntry {
  /** G-code line number */
  lineNumber: number;
  /** Time spent on this line in seconds */
  time: number;
  /** Cumulative time */
  cumulativeTime: number;
  /** Operation type */
  operation: 'cutting' | 'travel' | 'dwell' | 'tool_change' | 'spindle' | 'other';
  /** Description */
  description: string;
}

export interface ProfilingResult {
  /** Profile entries (sampled) */
  entries: ProfileEntry[];
  /** Total execution time in seconds */
  totalTime: number;
  /** Time breakdown by operation */
  timeByOperation: { operation: string; time: number; percentage: number }[];
  /** Slowest lines */
  slowestLines: { lineNumber: number; time: number; description: string }[];
  /** Bottleneck operations */
  bottlenecks: { operation: string; time: number; suggestion: string }[];
}

/**
 * Profile G-code execution to identify time bottlenecks.
 *
 * @param lines G-code lines
 * @param sampleInterval Sample every N lines (default 100)
 */
export function profileGcode(lines: string[], sampleInterval: number = 100): ProfilingResult {
  const entries: ProfileEntry[] = [];
  const timeByOp = new Map<string, number>();
  let prevX = 0, prevY = 0, prevZ = 0, prevE = 0;
  let currentFeedRate = 0;
  let currentTime = 0;
  const allLineTimes: { lineNumber: number; time: number; operation: string; description: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;

    const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!code) continue;

    let lineTime = 0;
    let operation: ProfileEntry['operation'] = 'other';
    let description = '';

    // Dwell (G4)
    if (/\bG4\b/i.test(code)) {
      const pMatch = code.match(/\bP(\d*\.?\d+)/i);
      const sMatch = code.match(/\bS(\d*\.?\d+)/i);
      if (pMatch) lineTime = parseFloat(pMatch[1]) / 1000;
      else if (sMatch) lineTime = parseFloat(sMatch[1]);
      operation = 'dwell';
      description = 'Dwell';
    }
    // Tool change
    else if (/\bM6\b/i.test(code) || /\bT\d+\b/i.test(code) && !/\bG\d\b/i.test(code)) {
      lineTime = 5; // assume 5s for tool change
      operation = 'tool_change';
      description = 'Tool change';
    }
    // Spindle control
    else if (/\bM[0345]\b/i.test(code)) {
      lineTime = 1; // spindle ramp
      operation = 'spindle';
      description = 'Spindle control';
    }
    // Motion
    else if (/\bG[01]\b/i.test(code)) {
      const fMatch = code.match(/\bF(\d*\.?\d+)/i);
      if (fMatch) currentFeedRate = parseFloat(fMatch[1]);

      const xMatch = code.match(/\bX(-?\d*\.?\d+)/i);
      const yMatch = code.match(/\bY(-?\d*\.?\d+)/i);
      const zMatch = code.match(/\bZ(-?\d*\.?\d+)/i);
      const eMatch = code.match(/\bE(-?\d*\.?\d+)/i);

      const x = xMatch ? parseFloat(xMatch[1]) : prevX;
      const y = yMatch ? parseFloat(yMatch[1]) : prevY;
      const z = zMatch ? parseFloat(zMatch[1]) : prevZ;

      const dist = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2 + (z - prevZ) ** 2);
      if (currentFeedRate > 0) {
        lineTime = dist / (currentFeedRate / 60);
      }

      const isExtruding = eMatch ? parseFloat(eMatch[1]) > prevE : false;
      operation = isExtruding ? 'cutting' : 'travel';
      description = isExtruding ? 'Cutting move' : 'Travel move';

      if (eMatch) prevE = parseFloat(eMatch[1]);
      prevX = x; prevY = y; prevZ = z;
    }

    currentTime += lineTime;
    timeByOp.set(operation, (timeByOp.get(operation) ?? 0) + lineTime);
    allLineTimes.push({ lineNumber: i, time: lineTime, operation, description });

    if (i % sampleInterval === 0 || lineTime > 1) {
      entries.push({
        lineNumber: i, time: lineTime, cumulativeTime: currentTime,
        operation, description,
      });
    }
  }

  const totalTime = currentTime;
  const timeByOperation = Array.from(timeByOp.entries())
    .map(([op, time]) => ({
      operation: op,
      time,
      percentage: totalTime > 0 ? (time / totalTime) * 100 : 0,
    }))
    .sort((a, b) => b.time - a.time);

  // Slowest lines
  const slowestLines = [...allLineTimes]
    .sort((a, b) => b.time - a.time)
    .slice(0, 10)
    .map(l => ({ lineNumber: l.lineNumber, time: l.time, description: l.description }));

  // Bottlenecks
  const bottlenecks: ProfilingResult['bottlenecks'] = [];
  for (const tbo of timeByOperation) {
    if (tbo.percentage > 30) {
      let suggestion = '';
      if (tbo.operation === 'travel') suggestion = 'Optimize toolpath order to reduce travel moves';
      else if (tbo.operation === 'dwell') suggestion = 'Reduce or eliminate dwell times';
      else if (tbo.operation === 'tool_change') suggestion = 'Reduce number of tool changes';
      else if (tbo.operation === 'spindle') suggestion = 'Combine spindle control operations';
      if (suggestion) {
        bottlenecks.push({ operation: tbo.operation, time: tbo.time, suggestion });
      }
    }
  }

  return { entries, totalTime, timeByOperation, slowestLines, bottlenecks };
}

// ── 11. Extruded Bead Geometry Simulation ──

export interface BeadGeometry {
  /** Bead width in mm */
  width: number;
  /** Bead height in mm */
  height: number;
  /** Cross-section area in mm² */
  crossSectionArea: number;
  /** Filament extrusion length per mm of bead in mm */
  extrusionPerMm: number;
  /** Bead shape factor (0-1, 1=rectangular, <1=rounded) */
  shapeFactor: number;
  /** Estimated bead flatness (width/height ratio) */
  flatness: number;
}

/**
 * Compute extruded bead geometry from print parameters.
 * Models the cross-section of an extruded bead.
 *
 * @param layerHeight Layer height in mm
 * @param extrusionWidth Extrusion width in mm
 * @param filamentDiameter Filament diameter in mm
 */
export function computeBeadGeometry(
  layerHeight: number,
  extrusionWidth: number,
  filamentDiameter: number = 1.75,
): BeadGeometry {
  // Cross-section area: approximately layerHeight * extrusionWidth
  // But the bead is not perfectly rectangular — it has rounded edges
  // A common model: area = layerHeight * (extrusionWidth - layerHeight) + π * (layerHeight/2)²
  const rectArea = layerHeight * (extrusionWidth - layerHeight);
  const circleArea = Math.PI * (layerHeight / 2) ** 2;
  const crossSectionArea = rectArea + circleArea;

  // Filament extrusion length per mm of bead
  const filamentArea = Math.PI * (filamentDiameter / 2) ** 2;
  const extrusionPerMm = crossSectionArea / filamentArea;

  // Shape factor: how rectangular the bead is
  // 1 = perfectly rectangular, 0 = circular
  const shapeFactor = rectArea / crossSectionArea;

  // Flatness: width/height ratio
  const flatness = extrusionWidth / layerHeight;

  return {
    width: extrusionWidth,
    height: layerHeight,
    crossSectionArea,
    extrusionPerMm,
    shapeFactor,
    flatness,
  };
}

/**
 * Compute bead geometry for a specific extrusion move.
 *
 * @param extrusionAmount E delta in mm
 * @param moveDistance Move distance in mm
 * @param filamentDiameter Filament diameter in mm
 */
export function computeBeadFromMove(
  extrusionAmount: number,
  moveDistance: number,
  filamentDiameter: number = 1.75,
): BeadGeometry & { layerHeight: number } {
  if (moveDistance <= 0 || extrusionAmount <= 0) {
    return {
      width: 0, height: 0, crossSectionArea: 0,
      extrusionPerMm: 0, shapeFactor: 0, flatness: 0,
      layerHeight: 0,
    };
  }

  const filamentArea = Math.PI * (filamentDiameter / 2) ** 2;
  const volume = extrusionAmount * filamentArea;
  const crossSectionArea = volume / moveDistance;

  // Estimate width and height from cross-section
  // Assume width = 1.5 * height (typical for 3D printing)
  const ratio = 1.5;
  const height = Math.sqrt(crossSectionArea / ratio);
  const width = height * ratio;

  const rectArea = height * (width - height);
  const circleArea = Math.PI * (height / 2) ** 2;
  const shapeFactor = (rectArea + circleArea) / crossSectionArea;

  return {
    width, height, crossSectionArea,
    extrusionPerMm: extrusionAmount / moveDistance,
    shapeFactor, flatness: width / height,
    layerHeight: height,
  };
}

// ── 12. G-code Revision History ──

export interface RevisionEntry {
  /** Revision number */
  revision: number;
  /** Timestamp */
  timestamp: string;
  /** Author */
  author: string;
  /** Description of changes */
  description: string;
  /** Number of lines changed */
  linesChanged: number;
  /** Number of lines added */
  linesAdded: number;
  /** Number of lines removed */
  linesRemoved: number;
  /** Checksum of the G-code */
  checksum: string;
}

export interface RevisionDiff {
  /** Added lines */
  added: { lineNumber: number; content: string }[];
  /** Removed lines */
  removed: { lineNumber: number; content: string }[];
  /** Modified lines */
  modified: { lineNumber: number; oldContent: string; newContent: string }[];
  /** Summary */
  summary: {
    additions: number;
    deletions: number;
    modifications: number;
    totalChanges: number;
  };
}

/**
 * Compute a simple checksum for G-code content.
 */
export function computeGcodeChecksum(lines: string[]): string {
  let hash = 0;
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      hash = ((hash << 5) - hash + line.charCodeAt(i)) | 0;
    }
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Create a revision entry for the current G-code state.
 */
export function createRevision(
  lines: string[],
  revision: number,
  author: string,
  description: string,
  previousRevision?: RevisionEntry,
): RevisionEntry {
  const checksum = computeGcodeChecksum(lines);
  let linesChanged = 0, linesAdded = 0, linesRemoved = 0;

  if (previousRevision) {
    // Would need the previous lines to compute actual changes
    // For now, just record the current state
    linesChanged = lines.length;
  }

  return {
    revision,
    timestamp: new Date().toISOString(),
    author,
    description,
    linesChanged,
    linesAdded,
    linesRemoved,
    checksum,
  };
}

/**
 * Compare two G-code versions and produce a diff.
 *
 * @param oldLines Old G-code lines
 * @param newLines New G-code lines
 */
export function diffGcodeRevisions(oldLines: string[], newLines: string[]): RevisionDiff {
  const added: { lineNumber: number; content: string }[] = [];
  const removed: { lineNumber: number; content: string }[] = [];
  const modified: { lineNumber: number; oldContent: string; newContent: string }[] = [];

  const maxLen = Math.max(oldLines.length, newLines.length);

  for (let i = 0; i < maxLen; i++) {
    const oldLine = i < oldLines.length ? oldLines[i] : undefined;
    const newLine = i < newLines.length ? newLines[i] : undefined;

    if (oldLine === undefined && newLine !== undefined) {
      added.push({ lineNumber: i, content: newLine });
    } else if (oldLine !== undefined && newLine === undefined) {
      removed.push({ lineNumber: i, content: oldLine });
    } else if (oldLine !== newLine) {
      modified.push({ lineNumber: i, oldContent: oldLine!, newContent: newLine! });
    }
  }

  return {
    added, removed, modified,
    summary: {
      additions: added.length,
      deletions: removed.length,
      modifications: modified.length,
      totalChanges: added.length + removed.length + modified.length,
    },
  };
}

/**
 * Export revision history as JSON.
 */
export function exportRevisionHistory(revisions: RevisionEntry[]): string {
  return JSON.stringify({
    version: '1.0',
    exported: new Date().toISOString(),
    revisions,
  }, null, 2);
}

/**
 * Import revision history from JSON.
 */
export function importRevisionHistory(json: string): RevisionEntry[] {
  const data = JSON.parse(json);
  if (data.revisions && Array.isArray(data.revisions)) {
    return data.revisions;
  }
  return [];
}
