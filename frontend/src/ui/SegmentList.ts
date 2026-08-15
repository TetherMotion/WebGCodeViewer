/**
 * @file SegmentList.ts
 * @brief Side panel listing G-code segments/blocks.
 */

import type { GetBlocksResponse, GetSegmentsResponse } from '../generated/tether_viewer_pb';

const motionTypeNames = ['Rapid', 'Linear', 'Arc CW', 'Arc CCW'];

export class SegmentList {
  private element: HTMLElement;
  private listElement: HTMLElement;

  constructor(container: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'segment-list';
    container.appendChild(this.element);
    this.element.innerHTML = '<h3>Segments</h3>';
    this.listElement = document.createElement('div');
    this.listElement.className = 'segment-list-items';
    this.element.appendChild(this.listElement);
  }

  updateBlocks(blocks: GetBlocksResponse): void {
    const html = blocks.blocks.map(b => {
      const motionName = motionTypeNames[b.motionType] || `Type ${b.motionType}`;
      return `<div class="segment-item">
        <span class="seg-idx">#${b.blockIndex}</span>
        <span class="seg-line">L${b.lineNumber}</span>
        <span class="seg-motion">${motionName}</span>
        <span class="seg-gcode">${escapeHtml(b.gcodeText)}</span>
      </div>`;
    }).join('');
    this.listElement.innerHTML = html || '<p>No blocks</p>';
  }

  updateSegments(segments: GetSegmentsResponse): void {
    const html = segments.segments.map(s => {
      const motionName = motionTypeNames[s.motionType] || `Type ${s.motionType}`;
      return `<div class="segment-item">
        <span class="seg-idx">#${s.segmentIndex}</span>
        <span class="seg-motion">${motionName}</span>
        <span class="seg-time">${s.startTime.toFixed(3)}s - ${s.endTime.toFixed(3)}s</span>
      </div>`;
    }).join('');
    this.listElement.innerHTML = html || '<p>No segments</p>';
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
