/**
 * @file GcodeViewer.ts
 * @brief Right-side panel showing G-code text with line highlighting.
 *
 * Displays the raw G-code text with syntax highlighting and line numbers.
 * Clicking a line highlights the corresponding toolpath segment.
 * When a toolpath segment is hovered/clicked, the corresponding line is
 * highlighted and scrolled into view.
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

const motionTypeNames = ['Rapid', 'Linear', 'Arc CW', 'Arc CCW'];

export class GcodeViewer extends EventDispatcher<GcodeViewerEvents> {
  private container: HTMLElement;
  private headerEl: HTMLElement;
  private listEl: HTMLElement;
  private filenameEl: HTMLElement;
  private lineCountEl: HTMLElement;
  private lines: string[] = [];
  private blocks: BlockInfo[] = [];
  private blockLineMap: BlockLineMap = new Map();
  private lineToBlock: Map<number, number> = new Map(); // line → blockIndex
  private highlightedLine: number = -1;
  private highlightedBlock: number = -1;

  constructor(container: HTMLElement) {
    super();
    this.container = container;
    this.container.innerHTML = '';

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

    this.listEl = document.createElement('div');
    this.listEl.id = 'gcode-list';
    this.container.appendChild(this.listEl);
  }

  /**
   * Load G-code text from the raw file content.
   * Called when a file is uploaded — shows the raw text immediately.
   */
  loadGcodeText(text: string, filename: string = ''): void {
    this.lines = text.split('\n');
    this.filenameEl.textContent = filename || 'G-code';
    this.lineCountEl.textContent = `${this.lines.length} lines`;
    this.blocks = [];
    this.blockLineMap.clear();
    this.lineToBlock.clear();
    this.highlightedLine = -1;
    this.highlightedBlock = -1;
    this.renderLines();
  }

  /**
   * Update block metadata from the server's GetBlocks response.
   * This maps block indices to line numbers so we can highlight
   * the correct lines when a toolpath segment is selected.
   */
  updateBlocks(blocks: GetBlocksResponse): void {
    this.blocks = blocks.blocks.map(b => ({
      blockIndex: b.blockIndex,
      lineNumber: b.lineNumber,
      motionType: b.motionType,
      gcodeText: b.gcodeText,
    }));

    // Build line → block mapping
    this.blockLineMap.clear();
    this.lineToBlock.clear();

    // Sort blocks by line number
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

  /**
   * Highlight a specific G-code line and scroll it into view.
   * Called when a toolpath segment is clicked/hovered.
   */
  highlightLine(line: number): void {
    this.highlightedLine = line;
    this.highlightedBlock = this.lineToBlock.get(line) ?? -1;
    this.updateHighlight();
    this.scrollToLine(line);
  }

  /**
   * Highlight all lines belonging to a block.
   * Called when a toolpath segment is clicked/hovered.
   */
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

  private renderLines(): void {
    // Use document fragment for performance with large files
    const fragment = document.createDocumentFragment();
    const maxLines = Math.min(this.lines.length, 50000); // cap for performance
    for (let i = 0; i < maxLines; i++) {
      const lineEl = document.createElement('div');
      lineEl.className = 'gcode-line';
      lineEl.dataset.line = String(i);

      const numEl = document.createElement('span');
      numEl.className = 'gcode-line-number';
      numEl.textContent = String(i + 1);

      const contentEl = document.createElement('span');
      contentEl.className = 'gcode-line-content';
      contentEl.innerHTML = highlightGcode(this.lines[i]);

      lineEl.appendChild(numEl);
      lineEl.appendChild(contentEl);

      lineEl.onclick = () => {
        const lineNum = parseInt(lineEl.dataset.line!, 10);
        const blockIdx = this.lineToBlock.get(lineNum) ?? -1;
        if (blockIdx >= 0) {
          this.highlightBlock(blockIdx);
          this.emit('blockSelected', blockIdx);
        }
        this.emit('lineSelected', lineNum);
      };

      fragment.appendChild(lineEl);
    }
    this.listEl.innerHTML = '';
    this.listEl.appendChild(fragment);
  }

  private updateHighlight(): void {
    // Remove old highlights
    const oldHighlighted = this.listEl.querySelectorAll('.gcode-line.highlighted, .gcode-line.highlighted-related');
    oldHighlighted.forEach(el => {
      el.classList.remove('highlighted', 'highlighted-related');
    });

    if (this.highlightedBlock < 0) return;

    const range = this.blockLineMap.get(this.highlightedBlock);
    if (!range) return;

    // Highlight all lines in the block range
    for (let ln = range.start; ln <= range.end; ln++) {
      const lineEl = this.listEl.querySelector(`.gcode-line[data-line="${ln}"]`) as HTMLElement | null;
      if (lineEl) {
        if (ln === this.highlightedLine) {
          lineEl.classList.add('highlighted');
        } else {
          lineEl.classList.add('highlighted-related');
        }
      }
    }
  }

  private scrollToLine(line: number): void {
    const lineEl = this.listEl.querySelector(`.gcode-line[data-line="${line}"]`) as HTMLElement | null;
    if (lineEl) {
      lineEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }
}

/**
 * Simple G-code syntax highlighter.
 * Highlights G/M words, comments, axis letters, and numbers.
 */
function highlightGcode(line: string): string {
  if (!line) return '';

  // Handle full-line comments (starting with ; or #)
  const trimmed = line.trimStart();
  if (trimmed.startsWith(';') || trimmed.startsWith('#')) {
    return `<span class="gcode-comment">${escapeHtml(line)}</span>`;
  }

  // Handle inline comment
  const commentIdx = line.indexOf(';');
  let codePart = line;
  let commentPart = '';
  if (commentIdx >= 0) {
    codePart = line.substring(0, commentIdx);
    commentPart = line.substring(commentIdx);
  }

  // Tokenize: words (G0, G1, M104, etc.), axis letters (X, Y, Z, E, F, S), numbers
  let result = '';
  const tokens = codePart.split(/(\s+|[A-Za-z][-+]?\d*\.?\d*)/);
  for (const token of tokens) {
    if (!token) continue;
    if (/^\s+$/.test(token)) {
      result += escapeHtml(token);
    } else if (/^[GM]/i.test(token) && /\d/.test(token)) {
      result += `<span class="gcode-word">${escapeHtml(token)}</span>`;
    } else if (/^[XYZABCUVWEFS]/i.test(token)) {
      // Split letter and number
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
