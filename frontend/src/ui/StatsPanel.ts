/**
 * @file StatsPanel.ts
 * @brief Bottom panel showing real-time job status and statistics summary.
 */

import type { GetJobStatusResponse } from "@tether/viewer-core/generated";

export class StatsPanel {
  private element: HTMLElement;

  constructor(container: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'stats-panel';
    container.appendChild(this.element);
  }

  updateJobStatus(status: GetJobStatusResponse): void {
    const progress = (status.progress * 100).toFixed(1);
    this.element.innerHTML = `
      <div class="stat-item"><span>Job:</span> ${status.jobId}</div>
      <div class="stat-item"><span>State:</span> ${status.state}</div>
      <div class="stat-item"><span>Progress:</span> ${progress}%</div>
      <div class="stat-item"><span>Samples:</span> ${status.sampleCount}</div>
      <div class="stat-item"><span>Duration:</span> ${status.duration.toFixed(3)}s</div>
      ${status.errorMessage ? `<div class="stat-error">${status.errorMessage}</div>` : ''}
    `;
  }
}
