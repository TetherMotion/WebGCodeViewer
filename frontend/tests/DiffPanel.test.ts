/**
 * @file DiffPanel.test.ts
 * @brief Rendering tests for the DiffPanel UI component.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DiffPanel } from "@tether/compare";
import type { DiffGcodeResponse } from "@tether/viewer-core/generated";

function createDiffResult(partial: Partial<DiffGcodeResponse>): DiffGcodeResponse {
  const base = {
    added: [],
    removed: [],
    modified: [],
    unchanged: 0,
    summary: {
      totalAdded: 0,
      totalRemoved: 0,
      totalModified: 0,
      totalUnchanged: 0,
      similarityScore: 1,
    },
    wordChanges: [],
  } as DiffGcodeResponse;
  return {
    ...base,
    ...partial,
    summary: {
      ...base.summary,
      ...(partial.summary ?? {}),
    },
  } as DiffGcodeResponse;
}

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
    const diff = createDiffResult({
      unchanged: 2,
      summary: { totalUnchanged: 2, similarityScore: 1 },
    });
    panel.displayDiff(diff, 'old.gcode', 'new.gcode');
    const content = container.querySelector('.diff-panel-content') as HTMLElement;
    expect(content.innerHTML).toContain('Files are identical');
    expect(content.innerHTML).toContain('100.0%');
  });

  it('displayDiff shows added lines', () => {
    panel.show();
    const diff = createDiffResult({
      unchanged: 1,
      added: [{ lineNumber: 1, content: 'G1 X20' }],
      summary: { totalAdded: 1, totalUnchanged: 1, similarityScore: 0.5 },
    });
    panel.displayDiff(diff, 'old.gcode', 'new.gcode');
    const content = container.querySelector('.diff-panel-content') as HTMLElement;
    expect(content.innerHTML).toContain('Added Lines');
    expect(content.innerHTML).toContain('G1 X20');
  });

  it('displayDiff shows removed lines', () => {
    panel.show();
    const diff = createDiffResult({
      unchanged: 1,
      removed: [{ lineNumber: 1, content: 'G1 X20' }],
      summary: { totalRemoved: 1, totalUnchanged: 1, similarityScore: 0.5 },
    });
    panel.displayDiff(diff, 'old.gcode', 'new.gcode');
    const content = container.querySelector('.diff-panel-content') as HTMLElement;
    expect(content.innerHTML).toContain('Removed Lines');
    expect(content.innerHTML).toContain('G1 X20');
  });

  it('displayDiff shows modified lines', () => {
    panel.show();
    const diff = createDiffResult({
      modified: [{ oldLineNumber: 0, newLineNumber: 0, oldContent: 'G1 X10 F1000', newContent: 'G1 X10 F2000' }],
      summary: { totalModified: 1, similarityScore: 0 },
    });
    panel.displayDiff(diff, 'old.gcode', 'new.gcode');
    const content = container.querySelector('.diff-panel-content') as HTMLElement;
    expect(content.innerHTML).toContain('Modified Lines');
    expect(content.innerHTML).toContain('F1000');
    expect(content.innerHTML).toContain('F2000');
  });

  it('displayDiff shows parameter changes', () => {
    panel.show();
    const diff = createDiffResult({
      modified: [{ oldLineNumber: 0, newLineNumber: 0, oldContent: 'G1 X10 F1000', newContent: 'G1 X10 F2000' }],
      wordChanges: [{ lineNumber: 0, word: 'F', oldValue: 'F1000', newValue: 'F2000' }],
      summary: { totalModified: 1, similarityScore: 0 },
    });
    panel.displayDiff(diff, 'old.gcode', 'new.gcode');
    const content = container.querySelector('.diff-panel-content') as HTMLElement;
    expect(content.innerHTML).toContain('Parameter Changes');
    expect(content.innerHTML).toContain('F');
  });

  it('displayDiff shows similarity score', () => {
    panel.show();
    const diff = createDiffResult({
      unchanged: 3,
      summary: { totalUnchanged: 3, similarityScore: 1 },
    });
    panel.displayDiff(diff, 'a', 'b');
    const content = container.querySelector('.diff-panel-content') as HTMLElement;
    expect(content.innerHTML).toContain('Similarity');
    expect(content.innerHTML).toContain('100.0%');
  });

  it('displayDiff shows low similarity for different files', () => {
    panel.show();
    const diff = createDiffResult({
      modified: [
        { oldLineNumber: 0, newLineNumber: 0, oldContent: 'G1 X10', newContent: 'G2 X30' },
        { oldLineNumber: 1, newLineNumber: 1, oldContent: 'G1 X20', newContent: 'G3 X40' },
      ],
      summary: { totalModified: 2, similarityScore: 0 },
    });
    panel.displayDiff(diff, 'a', 'b');
    const content = container.querySelector('.diff-panel-content') as HTMLElement;
    expect(content.innerHTML).toContain('0.0%');
  });

  it('displayDiff shows file names and line counts', () => {
    panel.show();
    const diff = createDiffResult({
      unchanged: 1,
      removed: [{ lineNumber: 1, content: 'G1 X20' }],
      summary: { totalRemoved: 1, totalUnchanged: 1, similarityScore: 0.5 },
    });
    panel.displayDiff(diff, 'original.gcode', 'modified.gcode');
    const content = container.querySelector('.diff-panel-content') as HTMLElement;
    expect(content.innerHTML).toContain('original.gcode');
    expect(content.innerHTML).toContain('modified.gcode');
    expect(content.innerHTML).toContain('2 lines');
    expect(content.innerHTML).toContain('1 lines');
  });

  it('displayDiff handles empty files', () => {
    panel.show();
    const diff = createDiffResult({});
    panel.displayDiff(diff, 'empty1', 'empty2');
    const content = container.querySelector('.diff-panel-content') as HTMLElement;
    expect(content.innerHTML).toContain('Files are identical');
  });

  it('displayDiff shows stats counts', () => {
    panel.show();
    const diff = createDiffResult({
      unchanged: 2,
      modified: [{ oldLineNumber: 1, newLineNumber: 1, oldContent: 'G1 X20', newContent: 'G1 X25' }],
      added: [{ lineNumber: 3, content: 'G1 X40' }],
      summary: {
        totalAdded: 1,
        totalModified: 1,
        totalUnchanged: 2,
        similarityScore: 2 / 4,
      },
    });
    panel.displayDiff(diff, 'old', 'new');
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
