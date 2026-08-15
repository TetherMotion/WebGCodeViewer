/**
 * @file GcodeViewer.ts
 * @brief Right-side panel showing G-code text with virtual scrolling,
 * syntax highlighting, search, and line highlighting.
 *
 * Uses virtual scrolling to efficiently render millions of lines — only
 * the visible viewport (plus a small overscan) is rendered as DOM.
 */

import { EventDispatcher } from '../core/EventDispatcher';
import type { GetBlocksResponse } from '../generated/tether_viewer_pb';

export interface GcodeViewerEvents {
  lineSelected: number;  // line number (0-based)
  blockSelected: number; // block index
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
  private listEl: HTMLElement;       // scroll container
  private spacerEl: HTMLElement;     // tall spacer to create scrollbar
  private viewportEl: HTMLElement;   // positioned div holding visible lines
  private filenameEl: HTMLElement;
  private lineCountEl: HTMLElement;

  private lines: string[] = [];
  private blocks: BlockInfo[] = [];
  private blockLineMap: BlockLineMap = new Map();
  private lineToBlock: Map<number, number> = new Map();
  private highlightedLine: number = -1;
  private highlightedBlock: number = -1;

  // Virtual scroll state
  private firstVisibleLine = 0;
  private visibleCount = 0;

  // Search state
  private searchMatches: number[] = []; // line numbers matching search
  private currentMatchIdx = -1;

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

      const numEl = document.createElement('span');
      numEl.className = 'gcode-line-number';
      numEl.textContent = String(lineNum + 1);

      const contentEl = document.createElement('span');
      contentEl.className = 'gcode-line-content';
      contentEl.innerHTML = highlightGcode(this.lines[lineNum]);

      lineEl.appendChild(numEl);
      lineEl.appendChild(contentEl);

      lineEl.onclick = () => {
        const ln = parseInt(lineEl.dataset.line!, 10);
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
 * Simple G-code syntax highlighter.
 */
function highlightGcode(line: string): string {
  if (!line) return '';

  const trimmed = line.trimStart();
  if (trimmed.startsWith(';') || trimmed.startsWith('#')) {
    return `<span class="gcode-comment">${escapeHtml(line)}</span>`;
  }

  const commentIdx = line.indexOf(';');
  let codePart = line;
  let commentPart = '';
  if (commentIdx >= 0) {
    codePart = line.substring(0, commentIdx);
    commentPart = line.substring(commentIdx);
  }

  let result = '';
  const tokens = codePart.split(/(\s+|[A-Za-z][-+]?\d*\.?\d*)/);
  for (const token of tokens) {
    if (!token) continue;
    if (/^\s+$/.test(token)) {
      result += escapeHtml(token);
    } else if (/^[GM]/i.test(token) && /\d/.test(token)) {
      result += `<span class="gcode-word">${escapeHtml(token)}</span>`;
    } else if (/^[XYZABCUVWEFS]/i.test(token)) {
      const letter = token[0];
      const num = token.substring(1);
      result += `<span class="gcode-axis">${escapeHtml(letter)}</span><span class="gcode-number">${escapeHtml(num)}</span>`;
    } else if (/^-?\d*\.?\d+$/.test(token)) {
      result += `<span class="gcode-number">${escapeHtml(token)}</span>`;
    } else {
      result += escapeHtml(token);
    }
  }

  if (commentPart) {
    result += `<span class="gcode-comment">${escapeHtml(commentPart)}</span>`;
  }

  return result;
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
