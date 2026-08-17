/**
 * @file DiffPanel.test.ts
 * @brief Tests for the DiffPanel UI component.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DiffPanel } from "@tether/compare";

describe('DiffPanel', () => {
  let container: HTMLElement;
  let panel: DiffPanel;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    panel = new DiffPanel(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('creates panel element', () => {
    expect(container.querySelector('.diff-panel')).toBeTruthy();
  });

  it('is hidden by default', () => {
    expect(panel.isVisible()).toBe(false);
    const el = container.querySelector('.diff-panel') as HTMLElement;
    expect(el.style.display).toBe('none');
  });

  it('show() makes panel visible', () => {
    panel.show();
    expect(panel.isVisible()).toBe(true);
    const el = container.querySelector('.diff-panel') as HTMLElement;
    expect(el.style.display).toBe('flex');
  });

  it('hide() makes panel hidden', () => {
    panel.show();
    panel.hide();
    expect(panel.isVisible()).toBe(false);
  });

  it('hide() dispatches closed event', () => {
    let closed = false;
    panel.on('closed', () => { closed = true; });
    panel.show();
    panel.hide();
    expect(closed).toBe(true);
  });

  it('has browse button', () => {
    const btn = container.querySelector('.diff-file-bar button');
    expect(btn).toBeTruthy();
    expect(btn!.textContent).toBe('Browse...');
  });

  it('has file input', () => {
    const input = container.querySelector('.diff-file-bar input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.accept).toContain('.gcode');
  });

  it('displayDiff shows summary for identical files', () => {
    panel.show();
    panel.displayDiff(['G1 X10', 'G1 X20'], ['G1 X10', 'G1 X20'], 'old.gcode', 'new.gcode');
    const content = container.querySelector('.diff-panel-content') as HTMLElement;
    expect(content.innerHTML).toContain('Files are identical');
    expect(content.innerHTML).toContain('100.0%');
  });

  it('displayDiff shows added lines', () => {
    panel.show();
    panel.displayDiff(['G1 X10'], ['G1 X10', 'G1 X20'], 'old.gcode', 'new.gcode');
    const content = container.querySelector('.diff-panel-content') as HTMLElement;
    expect(content.innerHTML).toContain('Added Lines');
    expect(content.innerHTML).toContain('G1 X20');
  });

  it('displayDiff shows removed lines', () => {
    panel.show();
    panel.displayDiff(['G1 X10', 'G1 X20'], ['G1 X10'], 'old.gcode', 'new.gcode');
    const content = container.querySelector('.diff-panel-content') as HTMLElement;
    expect(content.innerHTML).toContain('Removed Lines');
    expect(content.innerHTML).toContain('G1 X20');
  });

  it('displayDiff shows modified lines', () => {
    panel.show();
    panel.displayDiff(['G1 X10 F1000'], ['G1 X10 F2000'], 'old.gcode', 'new.gcode');
    const content = container.querySelector('.diff-panel-content') as HTMLElement;
    expect(content.innerHTML).toContain('Modified Lines');
    expect(content.innerHTML).toContain('F1000');
    expect(content.innerHTML).toContain('F2000');
  });

  it('displayDiff shows parameter changes', () => {
    panel.show();
    panel.displayDiff(['G1 X10 F1000'], ['G1 X10 F2000'], 'old.gcode', 'new.gcode');
    const content = container.querySelector('.diff-panel-content') as HTMLElement;
    expect(content.innerHTML).toContain('Parameter Changes');
    expect(content.innerHTML).toContain('F');
  });

  it('displayDiff shows similarity score', () => {
    panel.show();
    panel.displayDiff(['G1 X10', 'G1 X20', 'G1 X30'], ['G1 X10', 'G1 X20', 'G1 X30'], 'a', 'b');
    const content = container.querySelector('.diff-panel-content') as HTMLElement;
    expect(content.innerHTML).toContain('Similarity');
    expect(content.innerHTML).toContain('100.0%');
  });

  it('displayDiff shows low similarity for different files', () => {
    panel.show();
    panel.displayDiff(['G1 X10', 'G1 X20'], ['G2 X30', 'G3 X40'], 'a', 'b');
    const content = container.querySelector('.diff-panel-content') as HTMLElement;
    expect(content.innerHTML).toContain('0.0%');
  });

  it('displayDiff shows file names and line counts', () => {
    panel.show();
    panel.displayDiff(['G1 X10', 'G1 X20'], ['G1 X10'], 'original.gcode', 'modified.gcode');
    const content = container.querySelector('.diff-panel-content') as HTMLElement;
    expect(content.innerHTML).toContain('original.gcode');
    expect(content.innerHTML).toContain('modified.gcode');
    expect(content.innerHTML).toContain('2 lines');
    expect(content.innerHTML).toContain('1 lines');
  });

  it('displayDiff handles empty files', () => {
    panel.show();
    panel.displayDiff([], [], 'empty1', 'empty2');
    const content = container.querySelector('.diff-panel-content') as HTMLElement;
    expect(content.innerHTML).toContain('Files are identical');
  });

  it('displayDiff shows stats counts', () => {
    panel.show();
    panel.displayDiff(
      ['G1 X10', 'G1 X20', 'G1 X30'],
      ['G1 X10', 'G1 X25', 'G1 X30', 'G1 X40'],
      'old', 'new',
    );
    const content = container.querySelector('.diff-panel-content') as HTMLElement;
    expect(content.innerHTML).toContain('+1 added');
    expect(content.innerHTML).toContain('~1 modified');
  });

  it('destroy removes element', () => {
    expect(container.querySelector('.diff-panel')).toBeTruthy();
    panel.destroy();
    expect(container.querySelector('.diff-panel')).toBeFalsy();
  });
});
