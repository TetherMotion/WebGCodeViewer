/**
 * @file AttributePanel.ts
 * @brief Side panel showing per-axis statistics and attribute details.
 */

import type { GetStatisticsResponse } from "@tether/viewer-core/generated";

export class AttributePanel {
  private element: HTMLElement;

  constructor(container: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'attribute-panel';
    container.appendChild(this.element);
  }

  update(stats: GetStatisticsResponse): void {
    const html = `
      <h3>Statistics</h3>
      <table>
        <tr><td>Duration</td><td>${stats.duration.toFixed(3)} s</td></tr>
        <tr><td>Path Length</td><td>${stats.pathLength.toFixed(2)} mm</td></tr>
        <tr><td>Samples</td><td>${stats.sampleCount}</td></tr>
        <tr><td>Max Velocity</td><td>${stats.maxLinearVelocity.toFixed(2)} mm/s</td></tr>
        <tr><td>Max Acceleration</td><td>${stats.maxLinearAcceleration.toFixed(2)} mm/s²</td></tr>
        <tr><td>Max Jerk</td><td>${stats.maxLinearJerk.toFixed(2)} mm/s³</td></tr>
        <tr><td>Max Curvature</td><td>${stats.maxCurvature.toFixed(6)} /mm</td></tr>
        <tr><td>Max Centripetal Accel</td><td>${stats.maxCentripetalAccel.toFixed(2)} mm/s²</td></tr>
        <tr><td>Total Corner Error</td><td>${stats.totalCornerError.toFixed(4)} mm</td></tr>
        <tr><td>Max Corner Error</td><td>${stats.maxCornerError.toFixed(4)} mm</td></tr>
        <tr><td>Meets Limits</td><td>${stats.meetsLimits ? '✓' : '✗'}</td></tr>
      </table>
      <h4>Per-Axis</h4>
      <table>
        <tr><th>Axis</th><th>Min</th><th>Max</th><th>Max Vel</th><th>Max Accel</th><th>Max Jerk</th></tr>
        ${stats.axisStats.map((a, i) => `
          <tr>
            <td>${'XYZABCUVW'[i]}</td>
            <td>${a.minPosition.toFixed(2)}</td>
            <td>${a.maxPosition.toFixed(2)}</td>
            <td>${a.maxVelocity.toFixed(2)}</td>
            <td>${a.maxAcceleration.toFixed(2)}</td>
            <td>${a.maxJerk.toFixed(2)}</td>
          </tr>
        `).join('')}
      </table>
    `;
    this.element.innerHTML = html;
  }
}
