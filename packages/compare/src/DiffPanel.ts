/**
 * @file DiffPanel.ts
 * @brief Side panel for comparing two G-code files with structural diff.
 */

import { EventDispatcher } from "@tether/viewer-core";

export interface GcodeDiffResult {
  /** Lines added in the new file (not in old) */
  added: { lineNumber: number; content: string }[];
  /** Lines removed from the old file (not in new) */
  removed: { lineNumber: number; content: string }[];
  /** Lines modified (same position, different content) */
  modified: { oldLineNumber: number; newLineNumber: number; oldContent: string; newContent: string }[];
  /** Lines that are identical */
  unchanged: number;
  /** Summary statistics */
  summary?: {
    totalAdded: number;
    totalRemoved: number;
    totalModified: number;
    totalUnchanged: number;
    similarityScore: number; // 0..1
  };
  /** Changed G-code words (semantic diff) */
  wordChanges: { lineNumber: number; word: string; oldValue: string; newValue: string }[];
}

export interface DiffPanelEvents {
  closed: void;
  fileUploaded: File;
}

export class DiffPanel extends EventDispatcher<DiffPanelEvents> {
  private element: HTMLElement;
  private contentEl: HTMLElement;
  private fileInput: HTMLInputElement;
  private visible = false;

  constructor(container: HTMLElement) {
    super();
    this.element = document.createElement('div');
    this.element.className = 'diff-panel';
    this.element.style.display = 'none';

    const header = document.createElement('div');
    header.className = 'diff-panel-header';

    const title = document.createElement('span');
    title.className = 'diff-panel-title';
    title.textContent = 'G-code Diff';
    header.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'diff-panel-close';
    closeBtn.textContent = '✕';
    closeBtn.onclick = () => this.hide();
    header.appendChild(closeBtn);

    this.element.appendChild(header);

    // File input for the second G-code file
    const fileBar = document.createElement('div');
    fileBar.className = 'diff-file-bar';

    const fileLabel = document.createElement('span');
    fileLabel.textContent = 'Compare with:';
    fileBar.appendChild(fileLabel);

    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = '.gcode,.nc,.ngc,.tap,.txt';
    this.fileInput.style.display = 'none';
    this.fileInput.onchange = () => {
      if (this.fileInput.files && this.fileInput.files[0]) {
        this.emit('fileUploaded', this.fileInput.files[0]);
      }
    };
    fileBar.appendChild(this.fileInput);

    const browseBtn = document.createElement('button');
    browseBtn.textContent = 'Browse...';
    browseBtn.onclick = () => this.fileInput.click();
    fileBar.appendChild(browseBtn);

    this.element.appendChild(fileBar);

    this.contentEl = document.createElement('div');
    this.contentEl.className = 'diff-panel-content';
    this.element.appendChild(this.contentEl);

    container.appendChild(this.element);
  }

  show(): void {
    this.visible = true;
    this.element.style.display = 'flex';
  }

  hide(): void {
    this.visible = false;
    this.element.style.display = 'none';
    this.emit('closed', undefined);
  }

  isVisible(): boolean {
    return this.visible;
  }

  /**
   * Display the diff results between two G-code files.
   */
  displayDiff(diff: GcodeDiffResult, oldName: string, newName: string): void {
    const summary = diff.summary ?? {
      totalAdded: 0,
      totalRemoved: 0,
      totalModified: 0,
      totalUnchanged: 0,
      similarityScore: 1,
    };
    const unchanged = diff.unchanged;
    const modifiedCount = diff.modified.length;
    const oldLineCount = unchanged + modifiedCount + diff.removed.length;
    const newLineCount = unchanged + modifiedCount + diff.added.length;

    let html = '';

    // Summary
    html += '<div class="diff-summary">';
    html += `<div class="diff-row"><span>Original:</span><span>${oldName} (${oldLineCount} lines)</span></div>`;
    html += `<div class="diff-row"><span>Modified:</span><span>${newName} (${newLineCount} lines)</span></div>`;
    html += `<div class="diff-row"><span>Similarity:</span><span>${(summary.similarityScore * 100).toFixed(1)}%</span></div>`;
    html += '</div>';

    // Statistics
    html += '<div class="diff-stats">';
    html += `<div class="diff-stat diff-added">+${summary.totalAdded} added</div>`;
    html += `<div class="diff-stat diff-removed">-${summary.totalRemoved} removed</div>`;
    html += `<div class="diff-stat diff-modified">~${summary.totalModified} modified</div>`;
    html += `<div class="diff-stat diff-unchanged">=${summary.totalUnchanged} unchanged</div>`;
    html += '</div>';

    // Word-level changes
    if (diff.wordChanges.length > 0) {
      html += '<div class="diff-section"><h4>Parameter Changes</h4>';
      const wordMap = new Map<string, { old: string; new: string }>();
      for (const wc of diff.wordChanges) {
        const key = `${wc.word}:${wc.oldValue}:${wc.newValue}`;
        wordMap.set(key, { old: wc.oldValue, new: wc.newValue });
      }
      for (const [key, val] of wordMap) {
        const word = key.split(':')[0];
        html += `<div class="diff-row"><span>${word}</span><span>${val.old} → ${val.new}</span></div>`;
      }
      html += '</div>';
    }

    // Modified lines
    if (diff.modified.length > 0) {
      html += '<div class="diff-section"><h4>Modified Lines</h4>';
      for (const m of diff.modified.slice(0, 50)) {
        html += `<div class="diff-line diff-modified-line">`;
        html += `<span class="diff-line-num">${m.newLineNumber + 1}</span>`;
        html += `<span class="diff-old-line">${this.escapeHtml(m.oldContent)}</span>`;
        html += `<span class="diff-arrow">→</span>`;
        html += `<span class="diff-new-line">${this.escapeHtml(m.newContent)}</span>`;
        html += `</div>`;
      }
      if (diff.modified.length > 50) {
        html += `<div class="diff-more">... and ${diff.modified.length - 50} more</div>`;
      }
      html += '</div>';
    }

    // Added lines
    if (diff.added.length > 0) {
      html += '<div class="diff-section"><h4>Added Lines</h4>';
      for (const a of diff.added.slice(0, 30)) {
        html += `<div class="diff-line diff-added-line">`;
        html += `<span class="diff-line-num">${a.lineNumber + 1}</span>`;
        html += `<span>${this.escapeHtml(a.content)}</span>`;
        html += `</div>`;
      }
      if (diff.added.length > 30) {
        html += `<div class="diff-more">... and ${diff.added.length - 30} more</div>`;
      }
      html += '</div>';
    }

    // Removed lines
    if (diff.removed.length > 0) {
      html += '<div class="diff-section"><h4>Removed Lines</h4>';
      for (const r of diff.removed.slice(0, 30)) {
        html += `<div class="diff-line diff-removed-line">`;
        html += `<span class="diff-line-num">${r.lineNumber + 1}</span>`;
        html += `<span>${this.escapeHtml(r.content)}</span>`;
        html += `</div>`;
      }
      if (diff.removed.length > 30) {
        html += `<div class="diff-more">... and ${diff.removed.length - 30} more</div>`;
      }
      html += '</div>';
    }

    if (summary.totalAdded === 0 && summary.totalRemoved === 0 && summary.totalModified === 0) {
      html += '<div class="diff-identical">Files are identical</div>';
    }

    this.contentEl.innerHTML = html;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  destroy(): void {
    this.element.remove();
  }
}
