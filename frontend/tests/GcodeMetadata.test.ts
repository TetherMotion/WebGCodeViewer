import { describe, it, expect } from 'vitest';
import {
  parseGcodeMetadata,
  computeSpeedStats,
  computeLayerTimes,
  computeMaterialUsage,
  formatTime,
  getMachineStateAtLine,
} from '../src/core/GcodeMetadata';

describe('GcodeMetadata', () => {
  describe('parseGcodeMetadata', () => {
    it('parses tool changes (T + M6)', () => {
      const lines = [
        'G21',
        'T1 M6',
        'G1 X10 Y10 F100',
        'T2 M6',
        'G1 X20 Y20 F200',
      ];
      const meta = parseGcodeMetadata(lines);
      expect(meta.toolChanges).to.have.length(2);
      expect(meta.toolChanges[0].toolNumber).to.equal(1);
      expect(meta.toolChanges[0].lineNumber).to.equal(1);
      expect(meta.toolChanges[1].toolNumber).to.equal(2);
      expect(meta.tools).to.deep.equal([1, 2]);
    });

    it('parses spindle events (M3/M4/M5)', () => {
      const lines = [
        'M3 S12000',
        'G1 X10 F100',
        'M5',
        'M4 S8000',
      ];
      const meta = parseGcodeMetadata(lines);
      expect(meta.spindleEvents).to.have.length(3);
      expect(meta.spindleEvents[0].rpm).to.equal(12000);
      expect(meta.spindleEvents[0].direction).to.equal('cw');
      expect(meta.spindleEvents[1].direction).to.equal('off');
      expect(meta.spindleEvents[2].direction).to.equal('ccw');
      expect(meta.maxSpindleRpm).to.equal(12000);
    });

    it('parses temperature events (M104/M109/M140)', () => {
      const lines = [
        'M104 S210',
        'M140 S60',
        'M109 S210',
        'M190 S60',
      ];
      const meta = parseGcodeMetadata(lines);
      expect(meta.temperatureEvents).to.have.length(4);
      expect(meta.maxHotendTemp).to.equal(210);
      expect(meta.maxBedTemp).to.equal(60);
      expect(meta.temperatureEvents[0].hotend).to.equal(210);
      expect(meta.temperatureEvents[1].bed).to.equal(60);
    });

    it('parses fan events (M106/M107)', () => {
      const lines = [
        'M106 S128',
        'M107',
        'M106 S255',
      ];
      const meta = parseGcodeMetadata(lines);
      expect(meta.fanEvents).to.have.length(3);
      expect(meta.maxFanSpeed).to.equal(255);
      expect(meta.fanEvents[1].speed).to.equal(0);
    });

    it('parses coolant events (M7/M8/M9)', () => {
      const lines = [
        'M8',
        'G1 X10 F100',
        'M7',
        'M9',
      ];
      const meta = parseGcodeMetadata(lines);
      expect(meta.coolantEvents).to.have.length(3);
      expect(meta.coolantEvents[0].state).to.equal('flood');
      expect(meta.coolantEvents[1].state).to.equal('mist');
      expect(meta.coolantEvents[2].state).to.equal('off');
    });

    it('parses feed rate changes (F word)', () => {
      const lines = [
        'G1 X10 F100',
        'G1 X20 F500',
        'G1 X30 F1500',
      ];
      const meta = parseGcodeMetadata(lines);
      expect(meta.feedRateChanges).to.have.length(3);
      expect(meta.feedRateRange.min).to.equal(100);
      expect(meta.feedRateRange.max).to.equal(1500);
    });

    it('skips comments and empty lines', () => {
      const lines = [
        '; this is a comment',
        '',
        '( inline comment )',
        'G1 X10 F100 ; end comment',
      ];
      const meta = parseGcodeMetadata(lines);
      expect(meta.feedRateChanges).to.have.length(1);
      expect(meta.feedRateChanges[0].feedRate).to.equal(100);
    });

    it('maps feed rates to blocks', () => {
      const lines = [
        'G1 X10 F100',
        'G1 X20 F200',
      ];
      const blockLineMap = new Map<number, [number, number]>();
      blockLineMap.set(0, [0, 0]);
      blockLineMap.set(1, [1, 1]);
      const meta = parseGcodeMetadata(lines, blockLineMap);
      expect(meta.blockFeedRates.get(0)).to.equal(100);
      expect(meta.blockFeedRates.get(1)).to.equal(200);
    });

    it('parses M03/M04/M05 zero-prefixed variants', () => {
      const lines = ['M03 S5000', 'M04 S3000', 'M05'];
      const meta = parseGcodeMetadata(lines);
      expect(meta.spindleEvents).to.have.length(3);
      expect(meta.spindleEvents[0].direction).to.equal('cw');
      expect(meta.spindleEvents[1].direction).to.equal('ccw');
      expect(meta.spindleEvents[2].direction).to.equal('off');
    });

    it('parses M07/M08/M09 zero-prefixed coolant variants', () => {
      const lines = ['M07', 'M08', 'M09'];
      const meta = parseGcodeMetadata(lines);
      expect(meta.coolantEvents).to.have.length(3);
      expect(meta.coolantEvents[0].state).to.equal('mist');
      expect(meta.coolantEvents[1].state).to.equal('flood');
      expect(meta.coolantEvents[2].state).to.equal('off');
    });

    it('parses chamber temperature (M141/M191)', () => {
      const lines = ['M141 S60', 'M191 S60'];
      const meta = parseGcodeMetadata(lines);
      expect(meta.temperatureEvents).to.have.length(2);
      expect(meta.temperatureEvents[0].chamber).to.equal(60);
      expect(meta.temperatureEvents[1].chamber).to.equal(60);
    });

    it('M106 without S defaults to 255', () => {
      const lines = ['M106'];
      const meta = parseGcodeMetadata(lines);
      expect(meta.fanEvents).to.have.length(1);
      expect(meta.fanEvents[0].speed).to.equal(255);
      expect(meta.maxFanSpeed).to.equal(255);
    });

    it('tool change (M6) without T word uses current tool', () => {
      const lines = ['T3', 'M6', 'M6']; // second M6 has no pending T
      const meta = parseGcodeMetadata(lines);
      expect(meta.toolChanges).to.have.length(2);
      expect(meta.toolChanges[0].toolNumber).to.equal(3);
      // Second M6 should use currentTool (3) since pendingTool was reset
      expect(meta.toolChanges[1].toolNumber).to.equal(3);
    });

    it('spindle M3 without S uses previous RPM', () => {
      const lines = ['M3 S12000', 'G1 X10', 'M3']; // M3 without S reuses previous RPM
      const meta = parseGcodeMetadata(lines);
      expect(meta.spindleEvents[1].rpm).to.equal(12000);
    });

    it('spindle M3 after M5 uses RPM of 0', () => {
      const lines = ['M3 S12000', 'M5', 'M3']; // M3 without S after M5
      const meta = parseGcodeMetadata(lines);
      expect(meta.spindleEvents[2].rpm).to.equal(0);
    });

    it('maps tools and spindle to blocks', () => {
      const lines = ['T1 M6', 'M3 S12000', 'G1 X10 F100'];
      const blockLineMap = new Map<number, [number, number]>();
      blockLineMap.set(0, [0, 2]); // block 0 spans lines 0-2
      const meta = parseGcodeMetadata(lines, blockLineMap);
      expect(meta.blockTools.get(0)).to.equal(1);
      expect(meta.blockSpindleRpm.get(0)).to.equal(12000);
    });

    it('handles empty input', () => {
      const meta = parseGcodeMetadata([]);
      expect(meta.toolChanges).to.have.length(0);
      expect(meta.spindleEvents).to.have.length(0);
      expect(meta.feedRateRange.min).to.equal(0);
      expect(meta.feedRateRange.max).to.equal(0);
    });

    it('handles lines with only comments', () => {
      const lines = ['; comment', '(another)'];
      const meta = parseGcodeMetadata(lines);
      expect(meta.toolChanges).to.have.length(0);
    });

    it('parses M109 and M190 (wait-for-temp variants)', () => {
      const lines = ['M109 S200', 'M190 S70'];
      const meta = parseGcodeMetadata(lines);
      expect(meta.temperatureEvents).to.have.length(2);
      expect(meta.maxHotendTemp).to.equal(200);
      expect(meta.maxBedTemp).to.equal(70);
    });
  });

  describe('computeSpeedStats', () => {
    it('computes min/max/mean/median', () => {
      const segments = [
        { speedLinear: 10, duration: 1 },
        { speedLinear: 20, duration: 1 },
        { speedLinear: 30, duration: 1 },
        { speedLinear: 40, duration: 1 },
      ];
      const stats = computeSpeedStats(segments);
      expect(stats.minSpeed).to.equal(10);
      expect(stats.maxSpeed).to.equal(40);
      expect(stats.meanSpeed).to.equal(25);
      expect(stats.medianSpeed).to.equal(25);
    });

    it('handles empty segments', () => {
      const stats = computeSpeedStats([]);
      expect(stats.minSpeed).to.equal(0);
      expect(stats.maxSpeed).to.equal(0);
    });

    it('filters zero speeds', () => {
      const segments = [
        { speedLinear: 0, duration: 1 },
        { speedLinear: 50, duration: 1 },
      ];
      const stats = computeSpeedStats(segments);
      expect(stats.minSpeed).to.equal(50);
      expect(stats.maxSpeed).to.equal(50);
    });

    it('returns zeros when all speeds are zero', () => {
      const segments = [
        { speedLinear: 0, duration: 1 },
        { speedLinear: 0, duration: 1 },
      ];
      const stats = computeSpeedStats(segments);
      expect(stats.minSpeed).to.equal(0);
      expect(stats.maxSpeed).to.equal(0);
      expect(stats.meanSpeed).to.equal(0);
      expect(stats.medianSpeed).to.equal(0);
    });
  });

  describe('computeMaterialUsage', () => {
    it('computes extrusion length, volume, and weight', () => {
      const pieces = [
        { extruderSpeed: 5, controlPoints: [] },
        { extruderSpeed: 10, controlPoints: [] },
        { extruderSpeed: 0, controlPoints: [] }, // travel/retraction
      ];
      const segmentTimes = [2, 3, 1]; // seconds
      const result = computeMaterialUsage(pieces, segmentTimes);
      // extrusionLength = 5*2 + 10*3 = 10 + 30 = 40 mm
      expect(result.extrusionLength).to.equal(40);
      // volume = 40 * pi * (1.75/2)^2 = 40 * pi * 0.765625
      const expectedVol = 40 * Math.PI * 0.765625;
      expect(result.volume).toBeCloseTo(expectedVol, 2);
      // weight = volume_cm3 * density = (volume_mm3 / 1000) * 1.24
      expect(result.weight).toBeCloseTo((expectedVol / 1000) * 1.24, 4);
    });

    it('handles empty pieces', () => {
      const result = computeMaterialUsage([], []);
      expect(result.extrusionLength).to.equal(0);
      expect(result.volume).to.equal(0);
      expect(result.weight).to.equal(0);
    });

    it('skips pieces with zero or negative extruderSpeed', () => {
      const pieces = [
        { extruderSpeed: 0, controlPoints: [] },
        { extruderSpeed: -1, controlPoints: [] },
      ];
      const segmentTimes = [1, 1];
      const result = computeMaterialUsage(pieces, segmentTimes);
      expect(result.extrusionLength).to.equal(0);
    });

    it('uses custom filament diameter and density', () => {
      const pieces = [{ extruderSpeed: 10, controlPoints: [] }];
      const segmentTimes = [1];
      const result = computeMaterialUsage(pieces, segmentTimes, 2.85, 1.04);
      // extrusionLength = 10*1 = 10
      expect(result.extrusionLength).to.equal(10);
      // volume = 10 * pi * (2.85/2)^2 = 10 * pi * 2.030625
      const expectedVol = 10 * Math.PI * 2.030625;
      expect(result.volume).toBeCloseTo(expectedVol, 2);
    });
  });

  describe('computeLayerTimes', () => {
    it('computes time per layer', () => {
      const zLayers = [
        { layerIndex: 0, zHeight: 0.2, pieceStart: 0, pieceEnd: 2 },
        { layerIndex: 1, zHeight: 0.4, pieceStart: 3, pieceEnd: 5 },
      ];
      const segmentSpeeds = [
        { timeStart: 0, duration: 10 },
        { timeStart: 10, duration: 20 },
        { timeStart: 30, duration: 15 },
        { timeStart: 45, duration: 25 },
        { timeStart: 70, duration: 30 },
        { timeStart: 100, duration: 20 },
      ];
      const result = computeLayerTimes(zLayers, segmentSpeeds);
      expect(result).to.have.length(2);
      expect(result[0].timeSeconds).to.equal(45); // 10+20+15
      expect(result[1].timeSeconds).to.equal(75); // 25+30+20
    });

    it('handles empty data', () => {
      expect(computeLayerTimes([], [])).to.deep.equal([]);
    });
  });

  describe('formatTime', () => {
    it('formats seconds', () => {
      expect(formatTime(30)).to.equal('30.0s');
    });

    it('formats minutes', () => {
      expect(formatTime(90)).to.equal('1m 30s');
    });

    it('formats hours', () => {
      expect(formatTime(3661)).to.equal('1h 1m 1s');
    });

    it('handles zero and negative', () => {
      expect(formatTime(0)).to.equal('0.0s');
      expect(formatTime(-1)).to.equal('0s');
    });
  });

  describe('getMachineStateAtLine', () => {
    it('returns state at a given line number', () => {
      const lines = [
        'M3 S12000',
        'M104 S210',
        'M140 S60',
        'M106 S128',
        'M8',
        'G1 X10 F100',
        'M5',
        'M107',
        'M9',
      ];
      const meta = parseGcodeMetadata(lines);
      // At line 5 (after all events)
      const state = getMachineStateAtLine(meta, 5);
      expect(state.spindleRpm).to.equal(12000);
      expect(state.spindleDir).to.equal('cw');
      expect(state.hotendTemp).to.equal(210);
      expect(state.bedTemp).to.equal(60);
      expect(state.fanSpeed).to.equal(128);
      expect(state.coolantState).to.equal('flood');
    });

    it('returns updated state after spindle off', () => {
      const lines = [
        'M3 S12000',
        'G1 X10 F100',
        'M5',
        'G1 X20 F100',
      ];
      const meta = parseGcodeMetadata(lines);
      const state = getMachineStateAtLine(meta, 3);
      expect(state.spindleRpm).to.equal(0);
      expect(state.spindleDir).to.equal('off');
    });

    it('returns default state before any events', () => {
      const lines = [
        'G1 X10 F100',
        'M3 S12000',
      ];
      const meta = parseGcodeMetadata(lines);
      const state = getMachineStateAtLine(meta, 0);
      expect(state.spindleRpm).to.equal(0);
      expect(state.spindleDir).to.equal('off');
      expect(state.coolantState).to.equal('off');
    });
  });
});
