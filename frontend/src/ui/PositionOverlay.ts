/**
 * @file PositionOverlay.ts
 * @brief DOM overlay showing live toolhead position (X/Y/Z) and simulation
 * time during playback. Also shows feed rate, tool number, spindle state,
 * temperature, fan speed, and coolant state when available.
 */

import { formatTime } from '../core/GcodeMetadata';

export class PositionOverlay {
  private element: HTMLElement;
  private posEl: HTMLElement;
  private timeEl: HTMLElement;
  private feedEl: HTMLElement;
  private toolEl: HTMLElement;
  private spindleEl: HTMLElement;
  private tempEl: HTMLElement;
  private fanEl: HTMLElement;
  private coolantEl: HTMLElement;
  private visibleFlag = true;

  get visible(): boolean { return this.visibleFlag; }
  set visible(v: boolean) {
    this.visibleFlag = v;
    this.element.style.display = v ? '' : 'none';
  }

  constructor(container: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'position-overlay';
    container.appendChild(this.element);

    this.posEl = document.createElement('div');
    this.posEl.className = 'pos-overlay-row';
    this.element.appendChild(this.posEl);

    this.timeEl = document.createElement('div');
    this.timeEl.className = 'pos-overlay-row';
    this.element.appendChild(this.timeEl);

    this.feedEl = document.createElement('div');
    this.feedEl.className = 'pos-overlay-row';
    this.element.appendChild(this.feedEl);

    this.toolEl = document.createElement('div');
    this.toolEl.className = 'pos-overlay-row';
    this.element.appendChild(this.toolEl);

    this.spindleEl = document.createElement('div');
    this.spindleEl.className = 'pos-overlay-row';
    this.element.appendChild(this.spindleEl);

    this.tempEl = document.createElement('div');
    this.tempEl.className = 'pos-overlay-row';
    this.element.appendChild(this.tempEl);

    this.fanEl = document.createElement('div');
    this.fanEl.className = 'pos-overlay-row';
    this.element.appendChild(this.fanEl);

    this.coolantEl = document.createElement('div');
    this.coolantEl.className = 'pos-overlay-row';
    this.element.appendChild(this.coolantEl);
  }

  /**
   * Update the overlay with current position and simulation state.
   */
  update(data: {
    x: number; y: number; z: number;
    progress: number;       // 0..1
    totalTime: number;      // total seconds
    feedRate?: number;      // mm/min
    toolNumber?: number;
    spindleRpm?: number;
    spindleDir?: 'cw' | 'ccw' | 'off';
    hotendTemp?: number;
    bedTemp?: number;
    chamberTemp?: number;
    fanSpeed?: number;
    fanSpeedMax?: number;
    coolantState?: 'mist' | 'flood' | 'off';
    featureType?: string;
  }): void {
    const { x, y, z, progress, totalTime, feedRate, toolNumber,
            spindleRpm, spindleDir, hotendTemp, bedTemp, chamberTemp, fanSpeed, fanSpeedMax, coolantState, featureType } = data;
    const elapsed = totalTime * progress;
    const remaining = totalTime * (1 - progress);

    this.posEl.innerHTML = `<span class="pos-label">X</span><span class="pos-val">${x.toFixed(2)}</span>`
      + `<span class="pos-label">Y</span><span class="pos-val">${y.toFixed(2)}</span>`
      + `<span class="pos-label">Z</span><span class="pos-val">${z.toFixed(2)}</span>`;

    this.timeEl.innerHTML = `<span class="pos-label">Time</span><span class="pos-val">${formatTime(elapsed)}</span>`
      + `<span class="pos-label">ETA</span><span class="pos-val">${formatTime(remaining)}</span>`
      + `<span class="pos-label">Progress</span><span class="pos-val">${(progress * 100).toFixed(1)}%</span>`;

    if (feedRate !== undefined && feedRate > 0) {
      this.feedEl.innerHTML = `<span class="pos-label">Feed</span><span class="pos-val">${feedRate.toFixed(0)} mm/min</span>`;
      this.feedEl.style.display = '';
    } else {
      this.feedEl.style.display = 'none';
    }

    if (toolNumber !== undefined && toolNumber > 0) {
      this.toolEl.innerHTML = `<span class="pos-label">Tool</span><span class="pos-val">T${toolNumber}</span>`;
      this.toolEl.style.display = '';
    } else {
      this.toolEl.style.display = 'none';
    }

    // Spindle (CNC)
    if (spindleRpm !== undefined && spindleRpm > 0) {
      const dirStr = spindleDir === 'cw' ? 'CW' : spindleDir === 'ccw' ? 'CCW' : '';
      this.spindleEl.innerHTML = `<span class="pos-label">Spindle</span><span class="pos-val">${spindleRpm} RPM ${dirStr}</span>`;
      this.spindleEl.style.display = '';
    } else {
      this.spindleEl.style.display = 'none';
    }

    // Temperature (3DP)
    if ((hotendTemp !== undefined && hotendTemp > 0) ||
        (bedTemp !== undefined && bedTemp > 0) ||
        (chamberTemp !== undefined && chamberTemp > 0)) {
      let html = '';
      if (hotendTemp !== undefined && hotendTemp > 0) {
        html += `<span class="pos-label">Hotend</span><span class="pos-val">${hotendTemp}°C</span>`;
      }
      if (bedTemp !== undefined && bedTemp > 0) {
        html += `<span class="pos-label">Bed</span><span class="pos-val">${bedTemp}°C</span>`;
      }
      if (chamberTemp !== undefined && chamberTemp > 0) {
        html += `<span class="pos-label">Chamber</span><span class="pos-val">${chamberTemp}°C</span>`;
      }
      this.tempEl.innerHTML = html;
      this.tempEl.style.display = '';
    } else {
      this.tempEl.style.display = 'none';
    }

    // Feature type (slicer)
    if (featureType) {
      this.fanEl.innerHTML = `<span class="pos-label">Type</span><span class="pos-val">${featureType}</span>`;
      this.fanEl.style.display = '';
    } else if (fanSpeed !== undefined && fanSpeed > 0) {
      const pct = fanSpeedMax && fanSpeedMax > 0 ? Math.round(fanSpeed / fanSpeedMax * 100) : '';
      this.fanEl.innerHTML = `<span class="pos-label">Fan</span><span class="pos-val">${fanSpeed}${pct ? ` (${pct}%)` : ''}</span>`;
      this.fanEl.style.display = '';
    } else {
      this.fanEl.style.display = 'none';
    }

    // Coolant (CNC)
    if (coolantState && coolantState !== 'off') {
      this.coolantEl.innerHTML = `<span class="pos-label">Coolant</span><span class="pos-val">${coolantState.toUpperCase()}</span>`;
      this.coolantEl.style.display = '';
    } else {
      this.coolantEl.style.display = 'none';
    }
  }

  destroy(): void {
    this.element.remove();
  }
}
