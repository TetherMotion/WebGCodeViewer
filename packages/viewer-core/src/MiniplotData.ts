/**
 * @file MiniplotData.ts
 * @brief Shared miniplot data types used across packages.
 */

export type MiniplotAxis = 'speedE' | 'speedX' | 'speedY' | 'speedZ' | 'speedLinear';

export interface MiniplotSegment {
  timeStart: number;
  duration: number;
  blockIndex: number;
  lineNumber: number;
  speedX: number;
  speedY: number;
  speedZ: number;
  speedE: number;
  speedLinear: number;
}

export interface MiniplotData {
  totalTime: number;
  segments: MiniplotSegment[];
  toolChangeLines?: number[];
  tempChangeLines?: number[];
  fanChangeLines?: number[];
  coolantChangeLines?: number[];
}
