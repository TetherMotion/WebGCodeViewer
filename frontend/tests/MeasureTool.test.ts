/**
 * @file MeasureTool.test.ts
 * @brief Unit tests for MeasureTool.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MeasureTool } from '../src/ui/MeasureTool';

describe('MeasureTool', () => {
  let container: HTMLElement;
  let tool: MeasureTool;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    tool = new MeasureTool(container);
  });

  it('creates measure tool element', () => {
    expect(container.querySelector('.measure-tool')).toBeTruthy();
    expect(container.querySelector('h3')?.textContent).toBe('Measure');
  });

  it('isActive returns false initially', () => {
    expect(tool.isActive()).toBe(false);
  });

  it('getMeasureMode returns distance initially', () => {
    expect(tool.getMeasureMode()).toBe('distance');
  });

  it('Start Measurement button toggles active state', () => {
    const buttons = container.querySelectorAll('button');
    const startBtn = Array.from(buttons).find(b => b.textContent === 'Start Measurement') as HTMLButtonElement;
    startBtn.click();
    expect(tool.isActive()).toBe(true);
    expect(startBtn.textContent).toBe('Cancel');
    startBtn.click();
    expect(tool.isActive()).toBe(false);
    expect(startBtn.textContent).toBe('Start Measurement');
  });

  it('Mode button toggles between distance and angle', () => {
    const buttons = container.querySelectorAll('button');
    const modeBtn = Array.from(buttons).find(b => b.textContent === 'Mode: Distance') as HTMLButtonElement;
    modeBtn.click();
    expect(tool.getMeasureMode()).toBe('angle');
    expect(modeBtn.textContent).toBe('Mode: Angle');
    modeBtn.click();
    expect(tool.getMeasureMode()).toBe('distance');
    expect(modeBtn.textContent).toBe('Mode: Distance');
  });

  it('pickPoint does nothing when inactive', () => {
    let picked = false;
    tool.on('pointPicked', () => { picked = true; });
    tool.pickPoint({ x: 1, y: 2, z: 3 });
    expect(picked).toBe(false);
  });

  it('pickPoint emits pointPicked when active', () => {
    let pickedPoint: any = null;
    tool.on('pointPicked', (p) => { pickedPoint = p; });
    // Activate
    const buttons = container.querySelectorAll('button');
    const startBtn = Array.from(buttons).find(b => b.textContent === 'Start Measurement') as HTMLButtonElement;
    startBtn.click();
    tool.pickPoint({ x: 1, y: 2, z: 3 });
    expect(pickedPoint).toEqual({ x: 1, y: 2, z: 3 });
  });

  it('pickPoint in distance mode picks two points and computes distance', () => {
    let distResult: any = null;
    tool.on('distanceComputed', (r) => { distResult = r; });
    const buttons = container.querySelectorAll('button');
    const startBtn = Array.from(buttons).find(b => b.textContent === 'Start Measurement') as HTMLButtonElement;
    startBtn.click();
    tool.pickPoint({ x: 0, y: 0, z: 0 });
    tool.pickPoint({ x: 3, y: 4, z: 0 });
    expect(distResult).not.toBeNull();
    expect(distResult.distance).toBeCloseTo(5, 2);
  });

  it('pickPoint in angle mode picks three points and computes angle', () => {
    let angleResult: any = null;
    tool.on('angleComputed', (r) => { angleResult = r; });
    const buttons = container.querySelectorAll('button');
    const modeBtn = Array.from(buttons).find(b => b.textContent === 'Mode: Distance') as HTMLButtonElement;
    const startBtn = Array.from(buttons).find(b => b.textContent === 'Start Measurement') as HTMLButtonElement;
    modeBtn.click(); // switch to angle
    startBtn.click(); // activate
    tool.pickPoint({ x: 1, y: 0, z: 0 }); // P1
    tool.pickPoint({ x: 0, y: 0, z: 0 }); // P2 (vertex)
    tool.pickPoint({ x: 0, y: 1, z: 0 }); // P3
    expect(angleResult).not.toBeNull();
    expect(angleResult.angleDeg).toBeCloseTo(90, 1);
  });

  it('Clear button resets display', () => {
    const buttons = container.querySelectorAll('button');
    const startBtn = Array.from(buttons).find(b => b.textContent === 'Start Measurement') as HTMLButtonElement;
    const clearBtn = Array.from(buttons).find(b => b.textContent === 'Clear') as HTMLButtonElement;
    startBtn.click();
    tool.pickPoint({ x: 1, y: 2, z: 3 });
    const display = document.getElementById('measure-display') as HTMLElement;
    expect(display).toBeTruthy();
    expect(display.innerHTML).not.toBe('');
    clearBtn.click();
    expect(display.innerHTML).toBe('');
  });

  it('distance display shows first point after first pick', () => {
    const buttons = container.querySelectorAll('button');
    const startBtn = Array.from(buttons).find(b => b.textContent === 'Start Measurement') as HTMLButtonElement;
    startBtn.click();
    tool.pickPoint({ x: 1, y: 2, z: 3 });
    const display = document.getElementById('measure-display') as HTMLElement;
    expect(display.innerHTML).toContain('First point');
    expect(display.innerHTML).toContain('1.00');
  });

  it('distance display shows distance after second pick', () => {
    const buttons = container.querySelectorAll('button');
    const startBtn = Array.from(buttons).find(b => b.textContent === 'Start Measurement') as HTMLButtonElement;
    startBtn.click();
    tool.pickPoint({ x: 0, y: 0, z: 0 });
    tool.pickPoint({ x: 3, y: 4, z: 0 });
    const display = document.getElementById('measure-display') as HTMLElement;
    expect(display.innerHTML).toContain('Distance');
    expect(display.innerHTML).toContain('5.000');
  });

  it('angle display shows partial picks', () => {
    const buttons = container.querySelectorAll('button');
    const modeBtn = Array.from(buttons).find(b => b.textContent === 'Mode: Distance') as HTMLButtonElement;
    const startBtn = Array.from(buttons).find(b => b.textContent === 'Start Measurement') as HTMLButtonElement;
    modeBtn.click();
    startBtn.click();
    tool.pickPoint({ x: 1, y: 0, z: 0 });
    const display = document.getElementById('measure-display') as HTMLElement;
    expect(display.innerHTML).toContain('pick point 2 of 3');
  });

  it('angle with zero-length vectors returns 0 degrees', () => {
    let angleResult: any = null;
    tool.on('angleComputed', (r) => { angleResult = r; });
    const buttons = container.querySelectorAll('button');
    const modeBtn = Array.from(buttons).find(b => b.textContent === 'Mode: Distance') as HTMLButtonElement;
    const startBtn = Array.from(buttons).find(b => b.textContent === 'Start Measurement') as HTMLButtonElement;
    modeBtn.click();
    startBtn.click();
    tool.pickPoint({ x: 0, y: 0, z: 0 }); // P1
    tool.pickPoint({ x: 0, y: 0, z: 0 }); // P2 (vertex, same as P1)
    tool.pickPoint({ x: 0, y: 0, z: 0 }); // P3
    expect(angleResult.angleDeg).toBe(0);
  });
});
