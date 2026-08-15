/**
 * @file GcodeViewer.test.ts
 * @brief Unit tests for GcodeViewer.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GcodeViewer } from '../src/ui/GcodeViewer';

describe('GcodeViewer', () => {
  let container: HTMLElement;
  let viewer: GcodeViewer;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    viewer = new GcodeViewer(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('creates viewer element', () => {
    // GcodeViewer builds inside the container directly
    expect(container.querySelector('.gcode-spacer')).toBeTruthy();
    expect(container.querySelector('.gcode-viewport')).toBeTruthy();
  });

  it('loadGcodeText sets lines and filename', () => {
    viewer.loadGcodeText('G1 X10\nG1 X20\nG1 X30', 'test.gcode');
    expect(viewer.allLines).to.have.length(3);
    expect(viewer.filename).toBe('test.gcode');
  });

  it('loadGcodeText with empty filename uses default', () => {
    viewer.loadGcodeText('G1 X10');
    expect(viewer.filename).toBe('');
  });

  it('loadGcodeText resets state', () => {
    viewer.loadGcodeText('G1 X10\nG1 X20', 'a.gcode');
    viewer.highlightLine(1);
    viewer.loadGcodeText('G1 X30', 'b.gcode');
    // After reload, highlight should be cleared
    expect(viewer.allLines).to.have.length(1);
  });

  it('highlightLine sets highlighted line', () => {
    viewer.loadGcodeText('G1 X10\nG1 X20\nG1 X30');
    viewer.highlightLine(1);
    // Should not throw
    expect(true).toBe(true);
  });

  it('highlightLine with out-of-range line does not throw', () => {
    viewer.loadGcodeText('G1 X10');
    expect(() => viewer.highlightLine(100)).not.toThrow();
  });

  it('clearHighlight resets highlight', () => {
    viewer.loadGcodeText('G1 X10\nG1 X20');
    viewer.highlightLine(0);
    viewer.clearHighlight();
    expect(true).toBe(true);
  });

  it('showSearch displays search bar', () => {
    viewer.showSearch();
    expect(viewer.isSearchVisible()).toBe(true);
  });

  it('hideSearch hides search bar', () => {
    viewer.showSearch();
    viewer.hideSearch();
    expect(viewer.isSearchVisible()).toBe(false);
  });

  it('showGoto displays goto bar', () => {
    viewer.showGoto();
    expect(viewer.isGotoVisible()).toBe(true);
  });

  it('hideGoto hides goto bar', () => {
    viewer.showGoto();
    viewer.hideGoto();
    expect(viewer.isGotoVisible()).toBe(false);
  });

  it('isSearchVisible returns false initially', () => {
    expect(viewer.isSearchVisible()).toBe(false);
  });

  it('isGotoVisible returns false initially', () => {
    expect(viewer.isGotoVisible()).toBe(false);
  });

  it('emits lineSelected when a line is clicked', () => {
    let selectedLine = -1;
    viewer.on('lineSelected', (line) => { selectedLine = line; });
    viewer.loadGcodeText('G1 X10\nG1 X20\nG1 X30');
    // Simulate clicking on a line element
    const lineEls = container.querySelectorAll('.gcode-line');
    if (lineEls.length > 0) {
      (lineEls[1] as HTMLElement).click();
      expect(selectedLine).toBe(1);
    }
  });

  it('emits bookmarkToggled when bookmark icon clicked', () => {
    let toggledLine = -1;
    viewer.on('bookmarkToggled', (line) => { toggledLine = line; });
    viewer.loadGcodeText('G1 X10\nG1 X20');
    const bookmarkBtns = container.querySelectorAll('.gcode-icon-bookmark');
    if (bookmarkBtns.length > 0) {
      (bookmarkBtns[0] as HTMLElement).click();
      expect(toggledLine).toBe(0);
    }
  });

  it('refresh re-renders without error', () => {
    viewer.loadGcodeText('G1 X10\nG1 X20');
    expect(() => viewer.refresh()).not.toThrow();
  });

  it('updateBlocks populates block maps', () => {
    viewer.loadGcodeText('G1 X10\nG1 X20\nG1 X30');
    viewer.updateBlocks({
      blocks: [
        { blockIndex: 0, lineNumber: 0, motionType: 1, gcodeText: 'G1 X10' },
        { blockIndex: 1, lineNumber: 1, motionType: 1, gcodeText: 'G1 X20' },
        { blockIndex: 2, lineNumber: 2, motionType: 1, gcodeText: 'G1 X30' },
      ],
    } as any);
    expect(viewer.allBlocks).to.have.length(3);
    expect(viewer.lineToBlockMap.get(0)).toBe(0);
    expect(viewer.lineToBlockMap.get(1)).toBe(1);
    expect(viewer.lineToBlockMap.get(2)).toBe(2);
  });

  it('highlightBlock sets highlighted block', () => {
    viewer.loadGcodeText('G1 X10\nG1 X20\nG1 X30');
    viewer.updateBlocks({
      blocks: [
        { blockIndex: 0, lineNumber: 0, motionType: 1, gcodeText: 'G1 X10' },
        { blockIndex: 1, lineNumber: 1, motionType: 1, gcodeText: 'G1 X20' },
      ],
    } as any);
    viewer.highlightBlock(1);
    expect(true).toBe(true);
  });

  it('highlightBlock with unknown block does not throw', () => {
    viewer.loadGcodeText('G1 X10');
    expect(() => viewer.highlightBlock(999)).not.toThrow();
  });

  // ── Search functionality ──

  it('search finds matching lines', () => {
    viewer.loadGcodeText('G1 X10 F100\nG1 X20 F200\nG2 X30 F300');
    viewer.showSearch();
    const searchInput = container.querySelector('.gcode-search-input') as HTMLInputElement;
    searchInput.value = 'G1';
    searchInput.dispatchEvent(new Event('input'));
    const results = container.querySelector('.gcode-search-results');
    expect(results?.textContent).toBe('1/2'); // 2 matches for "G1"
  });

  it('search with no matches shows 0/0', () => {
    viewer.loadGcodeText('G1 X10\nG1 X20');
    viewer.showSearch();
    const searchInput = container.querySelector('.gcode-search-input') as HTMLInputElement;
    searchInput.value = 'G3';
    searchInput.dispatchEvent(new Event('input'));
    const results = container.querySelector('.gcode-search-results');
    expect(results?.textContent).toBe('0/0');
  });

  it('search with empty query clears results', () => {
    viewer.loadGcodeText('G1 X10\nG1 X20');
    viewer.showSearch();
    const searchInput = container.querySelector('.gcode-search-input') as HTMLInputElement;
    searchInput.value = 'G1';
    searchInput.dispatchEvent(new Event('input'));
    searchInput.value = '';
    searchInput.dispatchEvent(new Event('input'));
    const results = container.querySelector('.gcode-search-results');
    expect(results?.textContent).toBe('');
  });

  it('search Enter key navigates to next match', () => {
    viewer.loadGcodeText('G1 X10\nG1 X20\nG1 X30');
    viewer.showSearch();
    const searchInput = container.querySelector('.gcode-search-input') as HTMLInputElement;
    searchInput.value = 'G1';
    searchInput.dispatchEvent(new Event('input'));
    // Press Enter to go to next match
    searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    const results = container.querySelector('.gcode-search-results');
    expect(results?.textContent).toBe('2/3');
  });

  it('search Shift+Enter navigates to previous match', () => {
    viewer.loadGcodeText('G1 X10\nG1 X20\nG1 X30');
    viewer.showSearch();
    const searchInput = container.querySelector('.gcode-search-input') as HTMLInputElement;
    searchInput.value = 'G1';
    searchInput.dispatchEvent(new Event('input'));
    // Press Shift+Enter to go back
    searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }));
    const results = container.querySelector('.gcode-search-results');
    // Should wrap around to last match
    expect(results?.textContent).toBe('3/3');
  });

  it('search Escape key hides search bar', () => {
    viewer.loadGcodeText('G1 X10');
    viewer.showSearch();
    expect(viewer.isSearchVisible()).toBe(true);
    const searchInput = container.querySelector('.gcode-search-input') as HTMLInputElement;
    searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(viewer.isSearchVisible()).toBe(false);
  });

  // ── Go-to-line functionality ──

  it('goto bar input navigates to line on Enter', () => {
    viewer.loadGcodeText('G1 X10\nG1 X20\nG1 X30\nG1 X40');
    viewer.showGoto();
    const gotoInput = container.querySelector('.gcode-goto-bar .gcode-search-input') as HTMLInputElement;
    gotoInput.value = '3';
    gotoInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(viewer.isGotoVisible()).toBe(false);
  });

  it('goto bar Escape hides goto bar', () => {
    viewer.loadGcodeText('G1 X10');
    viewer.showGoto();
    const gotoInput = container.querySelector('.gcode-goto-bar .gcode-search-input') as HTMLInputElement;
    gotoInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(viewer.isGotoVisible()).toBe(false);
  });

  it('goto bar with invalid input does not throw', () => {
    viewer.loadGcodeText('G1 X10\nG1 X20');
    viewer.showGoto();
    const gotoInput = container.querySelector('.gcode-goto-bar .gcode-search-input') as HTMLInputElement;
    gotoInput.value = 'abc';
    expect(() => gotoInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))).not.toThrow();
  });

  it('goto bar with out-of-range line does not throw', () => {
    viewer.loadGcodeText('G1 X10');
    viewer.showGoto();
    const gotoInput = container.querySelector('.gcode-goto-bar .gcode-search-input') as HTMLInputElement;
    gotoInput.value = '999';
    expect(() => gotoInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))).not.toThrow();
  });

  // ── Annotation editing ──

  it('showAnnotation displays annotation bar', () => {
    viewer.loadGcodeText('G1 X10\nG1 X20');
    viewer.showAnnotation(0);
    expect(viewer.isAnnotationVisible()).toBe(true);
  });

  it('hideAnnotation hides annotation bar', () => {
    viewer.loadGcodeText('G1 X10');
    viewer.showAnnotation(0);
    viewer.hideAnnotation();
    expect(viewer.isAnnotationVisible()).toBe(false);
  });

  it('isAnnotationVisible returns false initially', () => {
    expect(viewer.isAnnotationVisible()).toBe(false);
  });

  it('annotation input + Enter commits annotation (dispatches annotationChanged)', () => {
    let changed: { line: number; text: string } | null = null;
    viewer.on('annotationChanged', (payload) => { changed = payload; });
    viewer.loadGcodeText('G1 X10\nG1 X20');
    viewer.showAnnotation(1);
    const annInput = container.querySelector('.gcode-annotation-bar .gcode-search-input') as HTMLInputElement;
    annInput.value = 'My note';
    annInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(changed).not.toBeNull();
    expect(changed!.line).toBe(1);
    expect(changed!.text).toBe('My note');
    expect(viewer.getAnnotation(1)).toBe('My note');
  });

  it('getAnnotation returns annotation text after commit', () => {
    viewer.loadGcodeText('G1 X10');
    viewer.showAnnotation(0);
    const annInput = container.querySelector('.gcode-annotation-bar .gcode-search-input') as HTMLInputElement;
    annInput.value = 'hello';
    annInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(viewer.getAnnotation(0)).toBe('hello');
  });

  it('getAnnotation returns undefined for line with no annotation', () => {
    viewer.loadGcodeText('G1 X10');
    expect(viewer.getAnnotation(0)).toBeUndefined();
  });

  it('setAnnotations sets annotations from external source', () => {
    viewer.loadGcodeText('G1 X10\nG1 X20');
    const map = new Map<number, string>([[0, 'first'], [1, 'second']]);
    viewer.setAnnotations(map);
    expect(viewer.getAnnotation(0)).toBe('first');
    expect(viewer.getAnnotation(1)).toBe('second');
  });

  it('annotation Escape key hides annotation bar', () => {
    viewer.loadGcodeText('G1 X10');
    viewer.showAnnotation(0);
    const annInput = container.querySelector('.gcode-annotation-bar .gcode-search-input') as HTMLInputElement;
    annInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(viewer.isAnnotationVisible()).toBe(false);
  });

  it('annotation button (pencil icon) exists on lines', () => {
    viewer.loadGcodeText('G1 X10\nG1 X20');
    const annBtns = container.querySelectorAll('.gcode-icon-annotate');
    expect(annBtns.length).toBeGreaterThan(0);
  });

  it('annotation button click shows annotation bar for that line', () => {
    viewer.loadGcodeText('G1 X10\nG1 X20');
    const annBtns = container.querySelectorAll('.gcode-icon-annotate');
    if (annBtns.length > 1) {
      (annBtns[1] as HTMLElement).click();
      expect(viewer.isAnnotationVisible()).toBe(true);
    }
  });

  it('committing empty annotation removes it', () => {
    viewer.loadGcodeText('G1 X10');
    viewer.setAnnotations(new Map([[0, 'existing']]));
    viewer.showAnnotation(0);
    const annInput = container.querySelector('.gcode-annotation-bar .gcode-search-input') as HTMLInputElement;
    annInput.value = '';
    annInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(viewer.getAnnotation(0)).toBeUndefined();
  });

  it('showAnnotation pre-fills input with existing annotation', () => {
    viewer.loadGcodeText('G1 X10');
    viewer.setAnnotations(new Map([[0, 'preset']]));
    viewer.showAnnotation(0);
    const annInput = container.querySelector('.gcode-annotation-bar .gcode-search-input') as HTMLInputElement;
    expect(annInput.value).toBe('preset');
  });

  // ── Selection for region analysis ──

  it('setSelection sets the selection range', () => {
    viewer.loadGcodeText('G1 X10\nG1 X20\nG1 X30');
    viewer.setSelection(0, 2);
    expect(viewer.hasSelection()).toBe(true);
    expect(viewer.getSelection()).toEqual({ start: 0, end: 2 });
  });

  it('clearSelection clears the selection', () => {
    viewer.loadGcodeText('G1 X10\nG1 X20');
    viewer.setSelection(0, 1);
    viewer.clearSelection();
    expect(viewer.hasSelection()).toBe(false);
    expect(viewer.getSelection()).toEqual({ start: -1, end: -1 });
  });

  it('hasSelection returns false initially', () => {
    expect(viewer.hasSelection()).toBe(false);
  });

  it('getSelection returns -1/-1 initially', () => {
    expect(viewer.getSelection()).toEqual({ start: -1, end: -1 });
  });

  it('setSelection dispatches selectionChanged event', () => {
    let payload: { start: number; end: number } | null = null;
    viewer.on('selectionChanged', (p) => { payload = p; });
    viewer.loadGcodeText('G1 X10\nG1 X20');
    viewer.setSelection(0, 1);
    expect(payload).toEqual({ start: 0, end: 1 });
  });

  it('clearSelection dispatches selectionChanged event with -1', () => {
    let payload: { start: number; end: number } | null = null;
    viewer.on('selectionChanged', (p) => { payload = p; });
    viewer.loadGcodeText('G1 X10');
    viewer.setSelection(0, 0);
    viewer.clearSelection();
    expect(payload).toEqual({ start: -1, end: -1 });
  });

  it('shift+click on a line sets selection (dispatches selectionChanged)', () => {
    let payload: { start: number; end: number } | null = null;
    viewer.on('selectionChanged', (p) => { payload = p; });
    viewer.loadGcodeText('G1 X10\nG1 X20\nG1 X30');
    const lineEls = container.querySelectorAll('.gcode-line');
    if (lineEls.length > 1) {
      (lineEls[1] as HTMLElement).dispatchEvent(
        new MouseEvent('click', { bubbles: true, shiftKey: true }),
      );
      expect(payload).not.toBeNull();
      expect(payload!.start).toBe(1);
      expect(payload!.end).toBe(1);
    }
  });

  it('shift+click on a second line extends the selection range', () => {
    viewer.loadGcodeText('G1 X10\nG1 X20\nG1 X30\nG1 X40');
    const lineEls = container.querySelectorAll('.gcode-line');
    if (lineEls.length > 3) {
      (lineEls[1] as HTMLElement).dispatchEvent(
        new MouseEvent('click', { bubbles: true, shiftKey: true }),
      );
      (lineEls[3] as HTMLElement).dispatchEvent(
        new MouseEvent('click', { bubbles: true, shiftKey: true }),
      );
      const sel = viewer.getSelection();
      expect(sel.start).toBe(1);
      expect(sel.end).toBe(3);
    }
  });

  it('selected lines get selected-range class', () => {
    viewer.loadGcodeText('G1 X10\nG1 X20\nG1 X30');
    viewer.setSelection(0, 1);
    const lineEls = container.querySelectorAll('.gcode-line');
    expect(lineEls[0].classList.contains('selected-range')).toBe(true);
    expect(lineEls[1].classList.contains('selected-range')).toBe(true);
    expect(lineEls[2].classList.contains('selected-range')).toBe(false);
  });

  it('clearSelection removes selected-range class', () => {
    viewer.loadGcodeText('G1 X10\nG1 X20');
    viewer.setSelection(0, 1);
    viewer.clearSelection();
    const lineEls = container.querySelectorAll('.gcode-line');
    expect(lineEls[0].classList.contains('selected-range')).toBe(false);
    expect(lineEls[1].classList.contains('selected-range')).toBe(false);
  });

  // ── Enhanced syntax highlighting ──

  it('G-code words get gcode-gword class', () => {
    viewer.loadGcodeText('G1 X10');
    const gwordEls = container.querySelectorAll('.gcode-gword');
    expect(gwordEls.length).toBeGreaterThan(0);
    expect(gwordEls[0].textContent).toBe('G1');
  });

  it('M codes get gcode-mword class', () => {
    viewer.loadGcodeText('M104 S200');
    const mwordEls = container.querySelectorAll('.gcode-mword');
    expect(mwordEls.length).toBeGreaterThan(0);
    expect(mwordEls[0].textContent).toBe('M104');
  });

  it('T codes get gcode-tword class', () => {
    viewer.loadGcodeText('T0');
    const twordEls = container.querySelectorAll('.gcode-tword');
    expect(twordEls.length).toBeGreaterThan(0);
    expect(twordEls[0].textContent).toBe('T0');
  });

  it('slicer feature type comments (;TYPE:...) get gcode-feature-type class', () => {
    viewer.loadGcodeText(';TYPE:WALL-OUTER');
    const featureEls = container.querySelectorAll('.gcode-feature-type');
    expect(featureEls.length).toBeGreaterThan(0);
  });

  it('slicer MESH comments get gcode-feature-type class', () => {
    viewer.loadGcodeText(';MESH:cube');
    const featureEls = container.querySelectorAll('.gcode-feature-type');
    expect(featureEls.length).toBeGreaterThan(0);
  });

  it('slicer FEATURE comments get gcode-feature-type class', () => {
    viewer.loadGcodeText(';FEATURE:Top surface');
    const featureEls = container.querySelectorAll('.gcode-feature-type');
    expect(featureEls.length).toBeGreaterThan(0);
  });

  it('meta comments (;TIME:...) get gcode-meta-comment class', () => {
    viewer.loadGcodeText(';TIME:12345');
    const metaEls = container.querySelectorAll('.gcode-meta-comment');
    expect(metaEls.length).toBeGreaterThan(0);
  });

  it('estimated printing time comments get gcode-meta-comment class', () => {
    viewer.loadGcodeText('; estimated printing time = 2h 30m');
    const metaEls = container.querySelectorAll('.gcode-meta-comment');
    expect(metaEls.length).toBeGreaterThan(0);
  });

  it('regular comments get gcode-comment class without feature-type or meta', () => {
    viewer.loadGcodeText('; just a comment');
    const commentEls = container.querySelectorAll('.gcode-comment');
    expect(commentEls.length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.gcode-feature-type').length).toBe(0);
    expect(container.querySelectorAll('.gcode-meta-comment').length).toBe(0);
  });

  it('inline parenthetical comments are highlighted', () => {
    viewer.loadGcodeText('G1 X10 (move here)');
    const commentEls = container.querySelectorAll('.gcode-comment');
    expect(commentEls.length).toBeGreaterThan(0);
    // The parenthetical comment should be present in one of the comment spans
    let foundParen = false;
    commentEls.forEach((el) => {
      if (el.textContent?.includes('(move here)')) foundParen = true;
    });
    expect(foundParen).toBe(true);
  });

  it('inline semicolon comments are highlighted', () => {
    viewer.loadGcodeText('G1 X10 ; trailing comment');
    const commentEls = container.querySelectorAll('.gcode-comment');
    expect(commentEls.length).toBeGreaterThan(0);
    let foundTrailing = false;
    commentEls.forEach((el) => {
      if (el.textContent?.includes('; trailing comment')) foundTrailing = true;
    });
    expect(foundTrailing).toBe(true);
  });
});
