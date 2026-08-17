/**
 * @file InfoPanel.ts
 * @brief Side panel displaying G-code metadata, analysis statistics,
 * material usage, speed stats, and layer time info.
 *
 * G-code metadata and summary now come from the server via protobuf
 * messages; this panel only renders the data. Server-side analysis
 * results are still shown in `remoteSections`.
 */

import { formatTime } from "./GcodeMetadata";
import {
  type GetGcodeMetadataResponse,
  type GetJobSummaryResponse,
  type FeatureTypeSegment,
  type AnalysisSection,
} from "@tether/viewer-core/generated";

export class InfoPanel {
  private element: HTMLElement;
  private contentEl: HTMLElement;
  private visibleFlag = true;

  get visible(): boolean { return this.visibleFlag; }
  set visible(v: boolean) {
    this.visibleFlag = v;
    this.element.style.display = v ? '' : 'none';
  }

  constructor(container: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'info-panel';
    container.appendChild(this.element);

    const header = document.createElement('div');
    header.className = 'info-panel-header';
    header.textContent = 'Analysis';
    this.element.appendChild(header);

    this.contentEl = document.createElement('div');
    this.contentEl.className = 'info-panel-content';
    this.element.appendChild(this.contentEl);
  }

  /**
   * Update the panel with all available data.
   */
  update(data: {
    gcodeMetadata?: GetGcodeMetadataResponse;
    jobSummary?: GetJobSummaryResponse;
    featureTypeSegments?: FeatureTypeSegment[];
    zLayers: { layerIndex: number; zHeight: number; pieceStart: number; pieceEnd: number }[];
    totalDuration: number;
    pathLength: number;
    bounds: { min: [number, number, number]; max: [number, number, number] };
    sampleCount: number;
    pieceCount: number;
    materialUsage?: { extrusionLength: number; volume: number; weight: number };
    remoteSections?: AnalysisSection[];
  }): void {
    const { gcodeMetadata, jobSummary, zLayers, totalDuration, pathLength, bounds, sampleCount, pieceCount, materialUsage, remoteSections } = data;

    const dims = {
      x: bounds.max[0] - bounds.min[0],
      y: bounds.max[1] - bounds.min[1],
      z: bounds.max[2] - bounds.min[2],
    };

    const speedStats = jobSummary?.speedStats;
    const layerTimes = jobSummary?.layerTimes ?? [];
    const totalLayerTime = layerTimes.reduce((sum, l) => sum + l.timeSeconds, 0);
    const maxLayerTime = layerTimes.reduce((max, l) => Math.max(max, l.timeSeconds), 0);
    const avgLayerTime = layerTimes.length > 0 ? totalLayerTime / layerTimes.length : 0;

    let html = '';

    // ── Print/CNC Info ──
    html += '<div class="info-section"><h4>Job Info</h4>';
    html += `<div class="info-row"><span>Duration</span><span>${formatTime(totalDuration)}</span></div>`;
    html += `<div class="info-row"><span>Path Length</span><span>${pathLength.toFixed(1)} mm</span></div>`;
    html += `<div class="info-row"><span>Pieces</span><span>${pieceCount}</span></div>`;
    html += `<div class="info-row"><span>Samples</span><span>${sampleCount}</span></div>`;
    html += '</div>';

    // ── Dimensions ──
    html += '<div class="info-section"><h4>Dimensions</h4>';
    html += `<div class="info-row"><span>X</span><span>${dims.x.toFixed(2)} mm</span></div>`;
    html += `<div class="info-row"><span>Y</span><span>${dims.y.toFixed(2)} mm</span></div>`;
    html += `<div class="info-row"><span>Z</span><span>${dims.z.toFixed(2)} mm</span></div>`;
    html += '</div>';

    // ── Speed Statistics ──
    html += '<div class="info-section"><h4>Speed Stats</h4>';
    if (speedStats) {
      html += `<div class="info-row"><span>Min Feed</span><span>${speedStats.minSpeed.toFixed(1)} mm/s</span></div>`;
      html += `<div class="info-row"><span>Max Feed</span><span>${speedStats.maxSpeed.toFixed(1)} mm/s</span></div>`;
      html += `<div class="info-row"><span>Mean Feed</span><span>${speedStats.meanSpeed.toFixed(1)} mm/s</span></div>`;
      html += `<div class="info-row"><span>Median Feed</span><span>${speedStats.medianSpeed.toFixed(1)} mm/s</span></div>`;
    } else {
      html += `<div class="info-row"><span>Min Feed</span><span>—</span></div>`;
      html += `<div class="info-row"><span>Max Feed</span><span>—</span></div>`;
      html += `<div class="info-row"><span>Mean Feed</span><span>—</span></div>`;
      html += `<div class="info-row"><span>Median Feed</span><span>—</span></div>`;
    }
    if (gcodeMetadata && gcodeMetadata.maxFeedRate > 0) {
      html += `<div class="info-row"><span>F Range</span><span>${gcodeMetadata.minFeedRate.toFixed(0)}–${gcodeMetadata.maxFeedRate.toFixed(0)} mm/min</span></div>`;
    }
    html += '</div>';

    // ── Layer Analysis ──
    if (layerTimes.length > 0) {
      html += '<div class="info-section"><h4>Layers</h4>';
      html += `<div class="info-row"><span>Count</span><span>${layerTimes.length}</span></div>`;
      html += `<div class="info-row"><span>Avg Time</span><span>${formatTime(avgLayerTime)}</span></div>`;
      html += `<div class="info-row"><span>Max Time</span><span>${formatTime(maxLayerTime)}</span></div>`;
      const sorted = [...layerTimes].sort((a, b) => b.timeSeconds - a.timeSeconds).slice(0, 3);
      html += '<div class="info-sublabel">Slowest layers:</div>';
      for (const l of sorted) {
        html += `<div class="info-row"><span>Layer ${l.layerIndex} (Z=${l.zHeight.toFixed(2)})</span><span>${formatTime(l.timeSeconds)}</span></div>`;
      }
      html += '</div>';
    }

    if (gcodeMetadata) {
      // ── Tools (CNC) ──
      if (gcodeMetadata.tools.length > 0) {
        html += '<div class="info-section"><h4>Tools</h4>';
        html += `<div class="info-row"><span>Tool Count</span><span>${gcodeMetadata.tools.length}</span></div>`;
        html += `<div class="info-row"><span>Tools</span><span>${gcodeMetadata.tools.join(', ')}</span></div>`;
        html += `<div class="info-row"><span>Changes</span><span>${gcodeMetadata.toolChanges.length}</span></div>`;
        html += '</div>';
      }

      // ── Spindle (CNC) ──
      if (gcodeMetadata.maxSpindleRpm > 0 || gcodeMetadata.spindleEvents.length > 0) {
        html += '<div class="info-section"><h4>Spindle</h4>';
        html += `<div class="info-row"><span>Max RPM</span><span>${gcodeMetadata.maxSpindleRpm.toFixed(0)}</span></div>`;
        html += `<div class="info-row"><span>Events</span><span>${gcodeMetadata.spindleEvents.length}</span></div>`;
        html += '</div>';
      }

      // ── Temperature (3DP) ──
      if (gcodeMetadata.maxHotendTemp > 0 || gcodeMetadata.maxBedTemp > 0) {
        html += '<div class="info-section"><h4>Temperature</h4>';
        if (gcodeMetadata.maxHotendTemp > 0) {
          html += `<div class="info-row"><span>Max Hotend</span><span>${gcodeMetadata.maxHotendTemp.toFixed(0)}°C</span></div>`;
        }
        if (gcodeMetadata.maxBedTemp > 0) {
          html += `<div class="info-row"><span>Max Bed</span><span>${gcodeMetadata.maxBedTemp.toFixed(0)}°C</span></div>`;
        }
        html += '</div>';
      }

      // ── Fan (3DP) ──
      if (gcodeMetadata.fanEvents.length > 0) {
        html += '<div class="info-section"><h4>Fan</h4>';
        html += `<div class="info-row"><span>Max Speed</span><span>${gcodeMetadata.maxFanSpeed.toFixed(0)}</span></div>`;
        html += `<div class="info-row"><span>Events</span><span>${gcodeMetadata.fanEvents.length}</span></div>`;
        html += '</div>';
      }

      // ── Coolant (CNC) ──
      if (gcodeMetadata.coolantEvents.length > 0) {
        html += '<div class="info-section"><h4>Coolant</h4>';
        html += `<div class="info-row"><span>Events</span><span>${gcodeMetadata.coolantEvents.length}</span></div>`;
        html += '</div>';
      }

      // ── Work Coordinates ──
      if (gcodeMetadata.workCoordinateSystems.length > 0) {
        html += '<div class="info-section"><h4>Work Coordinates</h4>';
        const codes = gcodeMetadata.workCoordinateSystems.map(w => w.code).join(', ');
        html += `<div class="info-row"><span>Systems</span><span>${codes}</span></div>`;
        html += '</div>';
      }

      // ── Stock / Bed ──
      if (gcodeMetadata.stockDimensions) {
        const s = gcodeMetadata.stockDimensions;
        const sx = s.maxX - s.minX;
        const sy = s.maxY - s.minY;
        const sz = s.maxZ - s.minZ;
        html += '<div class="info-section"><h4>Stock / Bed</h4>';
        html += `<div class="info-row"><span>X</span><span>${sx.toFixed(2)} mm</span></div>`;
        html += `<div class="info-row"><span>Y</span><span>${sy.toFixed(2)} mm</span></div>`;
        html += `<div class="info-row"><span>Z</span><span>${sz.toFixed(2)} mm</span></div>`;
        html += '</div>';
      }
    }

    // ── Material Usage (3DP) ──
    const mu = materialUsage ?? jobSummary?.materialUsage;
    if (mu && mu.extrusionLength > 0) {
      html += '<div class="info-section"><h4>Material Usage</h4>';
      html += `<div class="info-row"><span>Extrusion</span><span>${mu.extrusionLength.toFixed(1)} mm</span></div>`;
      html += `<div class="info-row"><span>Volume</span><span>${(mu.volume / 1000).toFixed(2)} cm³</span></div>`;
      html += `<div class="info-row"><span>Weight</span><span>${mu.weight.toFixed(1)} g</span></div>`;
      html += '</div>';
    }

    // ── Server-side analysis (C++ Tether analyzers) ──
    if (remoteSections && remoteSections.length > 0) {
      html += '<div class="info-section"><h4>Server Analysis</h4>';
      for (const section of remoteSections) {
        const score = Number.isFinite(section.score) ? section.score.toFixed(0) : '–';
        html += `<details class="info-subsection">`;
        html += `<summary><strong>${section.displayName || section.sectionName}</strong> <span style="margin-left:auto">${score}/100</span></summary>`;
        if (section.metrics && section.metrics.length > 0) {
          for (const metric of section.metrics) {
            let valueText: string;
            const v = metric.value;
            switch (v.case) {
              case 'doubleValue':
                valueText = v.value.toFixed(2).replace(/\.?0+$/, '') || '0';
                break;
              case 'int64Value':
                valueText = String(v.value);
                break;
              case 'boolValue':
                valueText = v.value ? 'Yes' : 'No';
                break;
              case 'stringValue':
                valueText = String(v.value);
                break;
              default:
                valueText = '–';
            }
            html += `<div class="info-row"><span>${metric.key}</span><span>${valueText}</span></div>`;
          }
        }
        if (section.topEvents && section.topEvents.length > 0) {
          html += '<div class="info-sublabel">Events:</div>';
          for (const e of section.topEvents) {
            let details: Record<string, number> = {};
            try {
              details = JSON.parse(e.detailsJson || '{}') as Record<string, number>;
            } catch {
              details = {};
            }
            const timeS = details.time_s;
            const extrusionMm = details.extrusion_mm;
            const lineInfo = e.lineNumber > 0 ? ` (line ${e.lineNumber})` : '';
            let valueText = '–';
            if (typeof timeS === 'number' && typeof extrusionMm === 'number') {
              valueText = `${formatTime(timeS)}, ${extrusionMm.toFixed(1)} mm`;
            } else if (e.metricValue) {
              valueText = Number(e.metricValue).toFixed(2).replace(/\.?0+$/, '') || '0';
            }
            html += `<div class="info-row"><span>${e.message}${lineInfo}</span><span>${valueText}</span></div>`;
          }
        }
        if (section.hasMoreEvents) {
          html += `<div class="info-sublabel">More events available on the server.</div>`;
        }
        html += '</details>';
      }
      html += '</div>';
    }

    this.contentEl.innerHTML = html;
  }

  destroy(): void {
    this.element.remove();
  }
}
