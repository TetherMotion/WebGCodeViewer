/**
 * @file GcodeViewer.ts
 * @brief Right-side panel showing G-code text with virtual scrolling,
 * syntax highlighting, search, and line highlighting.
 *
 * Uses virtual scrolling to efficiently render millions of lines — only
 * the visible viewport (plus a small overscan) is rendered as DOM.
 */

import { EventDispatcher } from "@tether/viewer-core";
import type { GetBlocksResponse } from "@tether/viewer-core/generated";

export interface GcodeViewerEvents {
  lineSelected: number;  // line number (0-based)
  blockSelected: number; // block index
  isolateZLayer: number; // line number — switch to ortho+top, isolate this line's Z-layer
  highlightMotion: number; // block index — highlight only this motion in 3D
  bookmarkToggled: number; // line number — toggle bookmark on this line
  annotationChanged: { line: number; text: string }; // annotation edited
  selectionChanged: { start: number; end: number }; // line range selected for analysis
}

interface BlockInfo {
  blockIndex: number;
  lineNumber: number;
  motionType: number;
  gcodeText: string;
}

// Maps block index → line range [startLine, endLine] (inclusive)
type BlockLineMap = Map<number, { start: number; end: number }>;

const LINE_HEIGHT = 20; // px per line (must match CSS)
const OVERSCAN = 10;    // extra lines above/below viewport

export class GcodeViewer extends EventDispatcher<GcodeViewerEvents> {
  private container: HTMLElement;
  private headerEl: HTMLElement;
  private searchEl: HTMLElement;
  private searchInput: HTMLInputElement;
  private searchResultsEl: HTMLElement;
  private gotoEl: HTMLElement;         // Go-to-line bar
  private gotoInput: HTMLInputElement;
  private annotationEl: HTMLElement;   // Annotation editing bar
  private annotationInput: HTMLInputElement;
  private annotationLine: number = -1; // line being annotated
  private listEl: HTMLElement;       // scroll container
  private spacerEl: HTMLElement;     // tall spacer to create scrollbar
  private viewportEl: HTMLElement;   // positioned div holding visible lines
  private filenameEl: HTMLElement;
  private lineCountEl: HTMLElement;

  private lines: string[] = [];
  private blocks: BlockInfo[] = [];
  private blockLineMap: BlockLineMap = new Map();
  private lineToBlock: Map<number, number> = new Map();
  private _filename: string = '';

  /** Public read access for analysis features */
  get allLines(): string[] { return this.lines; }
  get allBlocks(): BlockInfo[] { return this.blocks; }
  get blockLineRanges(): BlockLineMap { return this.blockLineMap; }
  get lineToBlockMap(): Map<number, number> { return this.lineToBlock; }
  get filename(): string { return this._filename; }
  private highlightedLine: number = -1;
  private highlightedBlock: number = -1;

  // Virtual scroll state
  private firstVisibleLine = 0;
  private visibleCount = 0;

  // Search state
  private searchMatches: number[] = []; // line numbers matching search
  private currentMatchIdx = -1;

  // Selection state for region analysis
  private selectionStart: number = -1;
  private selectionEnd: number = -1;

  // Annotation display: map of line → annotation text
  private annotations: Map<number, string> = new Map();

  constructor(container: HTMLElement) {
    super();
    this.container = container;
    this.container.innerHTML = '';

    // Header
    this.headerEl = document.createElement('div');
    this.headerEl.id = 'gcode-panel-header';
    this.filenameEl = document.createElement('span');
    this.filenameEl.className = 'gcode-filename';
    this.filenameEl.textContent = 'No file loaded';
    this.lineCountEl = document.createElement('span');
    this.lineCountEl.className = 'gcode-line-count';
    this.headerEl.appendChild(this.filenameEl);
    this.headerEl.appendChild(this.lineCountEl);
    this.container.appendChild(this.headerEl);

    // Search bar (hidden by default, toggled with Ctrl+F)
    this.searchEl = document.createElement('div');
    this.searchEl.className = 'gcode-search-bar';
    this.searchEl.style.display = 'none';

    this.searchInput = document.createElement('input');
    this.searchInput.type = 'text';
    this.searchInput.className = 'gcode-search-input';
    this.searchInput.placeholder = 'Search...';

    this.searchResultsEl = document.createElement('span');
    this.searchResultsEl.className = 'gcode-search-results';

    const prevBtn = document.createElement('button');
    prevBtn.className = 'gcode-search-nav';
    prevBtn.textContent = '↑';
    prevBtn.title = 'Previous match';
    prevBtn.onclick = () => this.navigateMatch(-1);

    const nextBtn = document.createElement('button');
    nextBtn.className = 'gcode-search-nav';
    nextBtn.textContent = '↓';
    nextBtn.title = 'Next match';
    nextBtn.onclick = () => this.navigateMatch(1);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'gcode-search-nav';
    closeBtn.textContent = '✕';
    closeBtn.title = 'Close search';
    closeBtn.onclick = () => this.hideSearch();

    this.searchEl.appendChild(this.searchInput);
    this.searchEl.appendChild(this.searchResultsEl);
    this.searchEl.appendChild(prevBtn);
    this.searchEl.appendChild(nextBtn);
    this.searchEl.appendChild(closeBtn);
    this.container.appendChild(this.searchEl);

    // Go-to-line bar (hidden by default, toggled with Ctrl+G)
    this.gotoEl = document.createElement('div');
    this.gotoEl.className = 'gcode-search-bar gcode-goto-bar';
    this.gotoEl.style.display = 'none';

    this.gotoInput = document.createElement('input');
    this.gotoInput.type = 'number';
    this.gotoInput.className = 'gcode-search-input';
    this.gotoInput.placeholder = 'Line number...';
    this.gotoInput.min = '1';
    this.gotoInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const line = parseInt(this.gotoInput.value) - 1; // convert to 0-based
        if (line >= 0 && line < this.lines.length) {
          this.scrollToLine(line);
          this.highlightLine(line);
          this.hideGoto();
        }
      } else if (e.key === 'Escape') {
        this.hideGoto();
      }
    });

    const gotoBtn = document.createElement('button');
    gotoBtn.className = 'gcode-search-nav';
    gotoBtn.textContent = '→';
    gotoBtn.title = 'Go to line';
    gotoBtn.onclick = () => {
      const line = parseInt(this.gotoInput.value) - 1;
      if (line >= 0 && line < this.lines.length) {
        this.scrollToLine(line);
        this.highlightLine(line);
        this.hideGoto();
      }
    };

    const gotoCloseBtn = document.createElement('button');
    gotoCloseBtn.className = 'gcode-search-nav';
    gotoCloseBtn.textContent = '✕';
    gotoCloseBtn.title = 'Close';
    gotoCloseBtn.onclick = () => this.hideGoto();

    this.gotoEl.appendChild(this.gotoInput);
    this.gotoEl.appendChild(gotoBtn);
    this.gotoEl.appendChild(gotoCloseBtn);
    this.container.appendChild(this.gotoEl);

    // Annotation editing bar (hidden by default)
    this.annotationEl = document.createElement('div');
    this.annotationEl.className = 'gcode-search-bar gcode-annotation-bar';
    this.annotationEl.style.display = 'none';

    this.annotationInput = document.createElement('input');
    this.annotationInput.type = 'text';
    this.annotationInput.className = 'gcode-search-input';
    this.annotationInput.placeholder = 'Annotation...';
    this.annotationInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.commitAnnotation();
      } else if (e.key === 'Escape') {
        this.hideAnnotation();
      }
    });

    const annSaveBtn = document.createElement('button');
    annSaveBtn.className = 'gcode-search-nav';
    annSaveBtn.textContent = '✓';
    annSaveBtn.title = 'Save annotation';
    annSaveBtn.onclick = () => this.commitAnnotation();

    const annClearBtn = document.createElement('button');
    annClearBtn.className = 'gcode-search-nav';
    annClearBtn.textContent = '✕';
    annClearBtn.title = 'Close';
    annClearBtn.onclick = () => this.hideAnnotation();

    this.annotationEl.appendChild(this.annotationInput);
    this.annotationEl.appendChild(annSaveBtn);
    this.annotationEl.appendChild(annClearBtn);
    this.container.appendChild(this.annotationEl);

    // Virtual scroll container
    this.listEl = document.createElement('div');
    this.listEl.id = 'gcode-list';

    this.spacerEl = document.createElement('div');
    this.spacerEl.className = 'gcode-spacer';

    this.viewportEl = document.createElement('div');
    this.viewportEl.className = 'gcode-viewport';

    this.listEl.appendChild(this.spacerEl);
    this.listEl.appendChild(this.viewportEl);
    this.container.appendChild(this.listEl);

    // Scroll handler for virtual rendering
    this.listEl.addEventListener('scroll', () => this.renderVisibleLines());

    // Search input handler
    this.searchInput.addEventListener('input', () => this.performSearch());
    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.navigateMatch(e.shiftKey ? -1 : 1);
      } else if (e.key === 'Escape') {
        this.hideSearch();
      }
    });
  }

  /**
   * Load G-code text from the raw file content.
   */
  loadGcodeText(text: string, filename: string = ''): void {
    this.lines = text.split('\n');
    this._filename = filename;
    this.filenameEl.textContent = filename || 'G-code';
    this.lineCountEl.textContent = `${this.lines.length.toLocaleString()} lines`;
    this.blocks = [];
    this.blockLineMap.clear();
    this.lineToBlock.clear();
    this.highlightedLine = -1;
    this.highlightedBlock = -1;
    this.searchMatches = [];
    this.currentMatchIdx = -1;
    this.updateSpacer();
    this.renderVisibleLines();
    this.listEl.scrollTop = 0;
  }

  /**
   * Update block metadata from the server's GetBlocks response.
   */
  updateBlocks(blocks: GetBlocksResponse): void {
    this.blocks = blocks.blocks.map(b => ({
      blockIndex: b.blockIndex,
      lineNumber: b.lineNumber,
      motionType: b.motionType,
      gcodeText: b.gcodeText,
    }));

    this.blockLineMap.clear();
    this.lineToBlock.clear();

    const sorted = [...this.blocks].sort((a, b) => a.lineNumber - b.lineNumber);

    for (let i = 0; i < sorted.length; i++) {
      const block = sorted[i];
      const startLine = block.lineNumber;
      const endLine = i + 1 < sorted.length ? sorted[i + 1].lineNumber - 1 : startLine;
      this.blockLineMap.set(block.blockIndex, { start: startLine, end: endLine });
      for (let ln = startLine; ln <= endLine && ln < this.lines.length; ln++) {
        this.lineToBlock.set(ln, block.blockIndex);
      }
    }
  }

  highlightLine(line: number): void {
    this.highlightedLine = line;
    this.highlightedBlock = this.lineToBlock.get(line) ?? -1;
    this.updateHighlight();
    this.scrollToLine(line);
  }

  highlightBlock(blockIndex: number): void {
    this.highlightedBlock = blockIndex;
    const range = this.blockLineMap.get(blockIndex);
    if (range) {
      this.highlightedLine = range.start;
      this.updateHighlight();
      this.scrollToLine(range.start);
    }
  }

  clearHighlight(): void {
    this.highlightedLine = -1;
    this.highlightedBlock = -1;
    this.updateHighlight();
  }

  // --- Search ---

  showSearch(): void {
    this.searchEl.style.display = 'flex';
    this.searchInput.focus();
    this.searchInput.select();
  }

  hideSearch(): void {
    this.searchEl.style.display = 'none';
    this.searchMatches = [];
    this.currentMatchIdx = -1;
    this.searchInput.value = '';
    this.searchResultsEl.textContent = '';
    this.renderVisibleLines();
  }

  showGoto(): void {
    this.gotoEl.style.display = 'flex';
    this.gotoInput.focus();
    this.gotoInput.select();
  }

  hideGoto(): void {
    this.gotoEl.style.display = 'none';
    this.gotoInput.value = '';
  }

  isGotoVisible(): boolean {
    return this.gotoEl.style.display !== 'none';
  }

  // ── Annotation editing ──

  /**
   * Show the annotation editing bar for a specific line.
   * Pre-fills with any existing annotation.
   */
  showAnnotation(line: number): void {
    this.annotationLine = line;
    this.annotationInput.value = this.annotations.get(line) ?? '';
    this.annotationEl.style.display = 'flex';
    this.annotationInput.focus();
    this.annotationInput.select();
  }

  hideAnnotation(): void {
    this.annotationEl.style.display = 'none';
    this.annotationInput.value = '';
    this.annotationLine = -1;
  }

  isAnnotationVisible(): boolean {
    return this.annotationEl.style.display !== 'none';
  }

  private commitAnnotation(): void {
    if (this.annotationLine < 0) return;
    const text = this.annotationInput.value.trim();
    if (text) {
      this.annotations.set(this.annotationLine, text);
    } else {
      this.annotations.delete(this.annotationLine);
    }
    this.emit('annotationChanged', { line: this.annotationLine, text });
    this.hideAnnotation();
    this.renderVisibleLines();
  }

  /**
   * Set annotations from external source (e.g., BookmarkManager).
   */
  setAnnotations(annotations: Map<number, string>): void {
    this.annotations = new Map(annotations);
    this.renderVisibleLines();
  }

  /**
   * Get the annotation for a line, if any.
   */
  getAnnotation(line: number): string | undefined {
    return this.annotations.get(line);
  }

  // ── Selection for region analysis ──

  /**
   * Set a line selection range for region analysis.
   * Pass -1 for both to clear.
   */
  setSelection(start: number, end: number): void {
    this.selectionStart = start;
    this.selectionEnd = end;
    this.emit('selectionChanged', { start, end });
    this.renderVisibleLines();
  }

  clearSelection(): void {
    this.selectionStart = -1;
    this.selectionEnd = -1;
    this.emit('selectionChanged', { start: -1, end: -1 });
    this.renderVisibleLines();
  }

  getSelection(): { start: number; end: number } {
    return { start: this.selectionStart, end: this.selectionEnd };
  }

  hasSelection(): boolean {
    return this.selectionStart >= 0 && this.selectionEnd >= 0;
  }

  private performSearch(): void {
    const query = this.searchInput.value.toLowerCase();
    if (!query) {
      this.searchMatches = [];
      this.currentMatchIdx = -1;
      this.searchResultsEl.textContent = '';
      this.renderVisibleLines();
      return;
    }

    // Search all lines (binary search would be faster for sorted, but text is unsorted)
    this.searchMatches = [];
    for (let i = 0; i < this.lines.length; i++) {
      if (this.lines[i].toLowerCase().includes(query)) {
        this.searchMatches.push(i);
      }
    }

    if (this.searchMatches.length > 0) {
      this.currentMatchIdx = 0;
      const matchLine = this.searchMatches[0];
      this.scrollToLine(matchLine);
      this.searchResultsEl.textContent = `1/${this.searchMatches.length}`;
    } else {
      this.currentMatchIdx = -1;
      this.searchResultsEl.textContent = '0/0';
    }
    this.renderVisibleLines();
  }

  private navigateMatch(direction: number): void {
    if (this.searchMatches.length === 0) return;
    this.currentMatchIdx = (this.currentMatchIdx + direction + this.searchMatches.length) % this.searchMatches.length;
    const matchLine = this.searchMatches[this.currentMatchIdx];
    this.scrollToLine(matchLine);
    this.searchResultsEl.textContent = `${this.currentMatchIdx + 1}/${this.searchMatches.length}`;
    this.renderVisibleLines();
  }

  isSearchVisible(): boolean {
    return this.searchEl.style.display !== 'none';
  }

  // --- Virtual scrolling ---

  private updateSpacer(): void {
    const totalHeight = this.lines.length * LINE_HEIGHT;
    this.spacerEl.style.height = `${totalHeight}px`;
  }

  /**
   * Public method to re-render visible lines (e.g., after bookmark changes).
   */
  refresh(): void {
    this.renderVisibleLines();
  }

  private renderVisibleLines(): void {
    const scrollTop = this.listEl.scrollTop;
    const viewportHeight = this.listEl.clientHeight;
    const firstLine = Math.max(0, Math.floor(scrollTop / LINE_HEIGHT) - OVERSCAN);
    const lastLine = Math.min(
      this.lines.length - 1,
      Math.ceil((scrollTop + viewportHeight) / LINE_HEIGHT) + OVERSCAN,
    );
    const count = lastLine - firstLine + 1;

    this.firstVisibleLine = firstLine;
    this.visibleCount = count;

    // Position the viewport div
    this.viewportEl.style.transform = `translateY(${firstLine * LINE_HEIGHT}px)`;

    // Build visible line elements
    const fragment = document.createDocumentFragment();
    const query = this.searchInput.value.toLowerCase();

    for (let i = 0; i < count; i++) {
      const lineNum = firstLine + i;
      const lineEl = document.createElement('div');
      lineEl.className = 'gcode-line';
      lineEl.dataset.line = String(lineNum);
      lineEl.style.height = `${LINE_HEIGHT}px`;

      // Apply highlight classes
      if (this.highlightedBlock >= 0) {
        const range = this.blockLineMap.get(this.highlightedBlock);
        if (range && lineNum >= range.start && lineNum <= range.end) {
          if (lineNum === this.highlightedLine) {
            lineEl.classList.add('highlighted');
          } else {
            lineEl.classList.add('highlighted-related');
          }
        }
      }

      // Apply search match highlight
      if (query && this.lines[lineNum].toLowerCase().includes(query)) {
        lineEl.classList.add('search-match');
        if (this.searchMatches[this.currentMatchIdx] === lineNum) {
          lineEl.classList.add('search-current');
        }
      }

      // Apply selection range highlight
      if (this.selectionStart >= 0 && this.selectionEnd >= 0 &&
          lineNum >= this.selectionStart && lineNum <= this.selectionEnd) {
        lineEl.classList.add('selected-range');
      }

      // Show annotation indicator
      const annotation = this.annotations.get(lineNum);
      if (annotation) {
        lineEl.classList.add('has-annotation');
        lineEl.title = annotation;
      }

      const numEl = document.createElement('span');
      numEl.className = 'gcode-line-number';
      numEl.textContent = String(lineNum + 1);

      const contentEl = document.createElement('span');
      contentEl.className = 'gcode-line-content';
      contentEl.innerHTML = highlightGcode(this.lines[lineNum]);

      lineEl.appendChild(numEl);
      lineEl.appendChild(contentEl);

      // Bookmark toggle button (available for every line)
      const bookmarkBtn = document.createElement('button');
      bookmarkBtn.className = 'gcode-line-icon gcode-icon-bookmark';
      bookmarkBtn.title = 'Toggle bookmark';
      bookmarkBtn.innerHTML = '&#9734;'; // ☆ (empty star)
      bookmarkBtn.onclick = (e) => {
        e.stopPropagation();
        this.emit('bookmarkToggled', lineNum);
      };
      lineEl.appendChild(bookmarkBtn);

      // Annotation button (available for every line)
      const annBtn = document.createElement('button');
      annBtn.className = 'gcode-line-icon gcode-icon-annotate';
      annBtn.title = 'Add/edit annotation';
      annBtn.innerHTML = '&#9998;'; // ✎ (pencil)
      annBtn.onclick = (e) => {
        e.stopPropagation();
        this.showAnnotation(lineNum);
      };
      lineEl.appendChild(annBtn);

      // Per-line icon buttons (only for lines that have a block association)
      const blockIdx = this.lineToBlock.get(lineNum) ?? -1;
      if (blockIdx >= 0) {
        const actionsEl = document.createElement('span');
        actionsEl.className = 'gcode-line-actions';

        // Icon 1: Isolate Z-layer (ortho + top view)
        const isoBtn = document.createElement('button');
        isoBtn.className = 'gcode-line-icon gcode-icon-iso';
        isoBtn.title = 'Ortho + Top + Isolate Z-layer';
        isoBtn.innerHTML = '&#9650;'; // ▲ (up arrow / top view)
        isoBtn.onclick = (e) => {
          e.stopPropagation();
          this.emit('isolateZLayer', lineNum);
        };
        actionsEl.appendChild(isoBtn);

        // Icon 2: Highlight only this motion
        const motBtn = document.createElement('button');
        motBtn.className = 'gcode-line-icon gcode-icon-motion';
        motBtn.title = 'Highlight this motion only';
        motBtn.innerHTML = '&#9679;'; // ● (circle / highlight)
        motBtn.onclick = (e) => {
          e.stopPropagation();
          this.highlightBlock(blockIdx);
          this.emit('highlightMotion', blockIdx);
        };
        actionsEl.appendChild(motBtn);

        lineEl.appendChild(actionsEl);
      }

      lineEl.onclick = (e) => {
        const ln = parseInt(lineEl.dataset.line!, 10);
        // Shift+click: set selection range for region analysis
        if (e.shiftKey) {
          if (this.selectionStart < 0) {
            this.setSelection(ln, ln);
          } else {
            const start = Math.min(this.selectionStart, ln);
            const end = Math.max(this.selectionEnd, ln);
            this.setSelection(start, end);
          }
          return;
        }
        const blockIdx = this.lineToBlock.get(ln) ?? -1;
        if (blockIdx >= 0) {
          this.highlightBlock(blockIdx);
          this.emit('blockSelected', blockIdx);
        }
        this.emit('lineSelected', ln);
      };

      fragment.appendChild(lineEl);
    }

    this.viewportEl.innerHTML = '';
    this.viewportEl.appendChild(fragment);
  }

  private updateHighlight(): void {
    // Just re-render visible lines — highlight classes are applied there
    this.renderVisibleLines();
  }

  private scrollToLine(line: number): void {
    const targetTop = line * LINE_HEIGHT;
    const viewportHeight = this.listEl.clientHeight;
    // Center the line in the viewport
    const scrollTo = targetTop - viewportHeight / 2 + LINE_HEIGHT / 2;
    this.listEl.scrollTop = Math.max(0, scrollTo);
  }
}

/**
 * G-code syntax highlighter with support for G/M/T codes, axis words,
 * inline comments, and slicer feature type comments.
 */
function highlightGcode(line: string): string {
  if (!line) return '';

  const trimmed = line.trimStart();
  if (trimmed.startsWith(';') || trimmed.startsWith('#')) {
    // Highlight slicer feature type comments specially
    const typeMatch = trimmed.match(/^;\s*TYPE:\s*(.+)/i);
    if (typeMatch) {
      return `<span class="gcode-comment gcode-feature-type">;TYPE:${escapeHtml(typeMatch[1])}</span>`;
    }
    const meshMatch = trimmed.match(/^;\s*MESH:\s*(.+)/i);
    if (meshMatch) {
      return `<span class="gcode-comment gcode-feature-type">;MESH:${escapeHtml(meshMatch[1])}</span>`;
    }
    const featureMatch = trimmed.match(/^;\s*FEATURE:\s*(.+)/i);
    if (featureMatch) {
      return `<span class="gcode-comment gcode-feature-type">;FEATURE:${escapeHtml(featureMatch[1])}</span>`;
    }
    // Highlight time/estimated comments
    const timeMatch = trimmed.match(/^;\s*(TIME|estimated printing time)/i);
    if (timeMatch) {
      return `<span class="gcode-comment gcode-meta-comment">${escapeHtml(line)}</span>`;
    }
    return `<span class="gcode-comment">${escapeHtml(line)}</span>`;
  }

  // Handle inline parenthetical comments (CNC style)
  const parenIdx = line.indexOf('(');
  let codePart = line;
  let parenPart = '';
  if (parenIdx >= 0) {
    codePart = line.substring(0, parenIdx);
    parenPart = line.substring(parenIdx);
  }

  const commentIdx = codePart.indexOf(';');
  let codeSegment = codePart;
  let commentPart = '';
  if (commentIdx >= 0) {
    codeSegment = codePart.substring(0, commentIdx);
    commentPart = codePart.substring(commentIdx);
  }

  let result = '';
  const tokens = codeSegment.split(/(\s+|[A-Za-z][-+]?\d*\.?\d*)/);
  for (const token of tokens) {
    if (!token) continue;
    if (/^\s+$/.test(token)) {
      result += escapeHtml(token);
    } else if (/^G/i.test(token) && /\d/.test(token)) {
      result += `<span class="gcode-word gcode-gword">${escapeHtml(token)}</span>`;
    } else if (/^M/i.test(token) && /\d/.test(token)) {
      result += `<span class="gcode-word gcode-mword">${escapeHtml(token)}</span>`;
    } else if (/^T/i.test(token) && /\d/.test(token)) {
      result += `<span class="gcode-word gcode-tword">${escapeHtml(token)}</span>`;
    } else if (/^[XYZABCUVWEFS]/i.test(token)) {
      const letter = token[0];
      const num = token.substring(1);
      const cls = /^[XYZUVW]/i.test(letter) ? 'gcode-axis' : 'gcode-param';
      result += `<span class="${cls}">${escapeHtml(letter)}</span><span class="gcode-number">${escapeHtml(num)}</span>`;
    } else if (/^-?\d*\.?\d+$/.test(token)) {
      result += `<span class="gcode-number">${escapeHtml(token)}</span>`;
    } else {
      result += escapeHtml(token);
    }
  }

  if (commentPart) {
    result += `<span class="gcode-comment">${escapeHtml(commentPart)}</span>`;
  }
  if (parenPart) {
    result += `<span class="gcode-comment">${escapeHtml(parenPart)}</span>`;
  }

  return result;
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
