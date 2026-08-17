/**
 * @file TimeSlider.ts
 * @brief Time slider UI for scrubbing through trajectory animation.
 */

import { EventDispatcher } from "@tether/viewer-core";

export interface TimeSliderEvents {
  timeChanged: number;
  playChanged: boolean;
  speedChanged: number;
}

export class TimeSlider extends EventDispatcher<TimeSliderEvents> {
  private element: HTMLElement;
  private slider: HTMLInputElement;
  private playBtn: HTMLButtonElement;
  private speedSelect: HTMLSelectElement;
  private isPlaying = false;
  private animationId: number | null = null;
  private lastTime = 0;
  private _duration = 1.0;
  private _currentTime = 0;
  private _playbackSpeed = 1.0;

  constructor(container: HTMLElement) {
    super();
    this.element = document.createElement('div');
    this.element.className = 'time-slider';
    container.appendChild(this.element);
    this.build();
  }

  private build(): void {
    this.playBtn = document.createElement('button');
    this.playBtn.textContent = 'Play';
    this.playBtn.onclick = () => this.togglePlay();
    this.element.appendChild(this.playBtn);

    this.slider = document.createElement('input');
    this.slider.type = 'range';
    this.slider.min = '0';
    this.slider.max = '1000';
    this.slider.value = '0';
    this.slider.oninput = () => {
      this._currentTime = (parseFloat(this.slider.value) / 1000) * this._duration;
      this.emit('timeChanged', this._currentTime);
    };
    this.element.appendChild(this.slider);

    const speedLabel = document.createElement('label');
    speedLabel.textContent = ' Speed: ';
    this.speedSelect = document.createElement('select');
    for (const speed of ['0.25', '0.5', '1', '2', '5', '10']) {
      const opt = document.createElement('option');
      opt.value = speed;
      opt.textContent = speed + 'x';
      if (speed === '1') opt.selected = true;
      this.speedSelect.appendChild(opt);
    }
    this.speedSelect.onchange = () => {
      this._playbackSpeed = parseFloat(this.speedSelect.value);
      this.emit('speedChanged', this._playbackSpeed);
    };
    speedLabel.appendChild(this.speedSelect);
    this.element.appendChild(speedLabel);
  }

  set duration(d: number) {
    this._duration = Math.max(0.001, d);
  }

  get currentTime(): number {
    return this._currentTime;
  }

  private togglePlay(): void {
    this.isPlaying = !this.isPlaying;
    this.playBtn.textContent = this.isPlaying ? 'Pause' : 'Play';
    this.emit('playChanged', this.isPlaying);
    if (this.isPlaying) {
      this.lastTime = performance.now();
      this.animate();
    } else if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  private animate = (): void => {
    if (!this.isPlaying) return;
    const now = performance.now();
    const dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    this._currentTime += dt * this._playbackSpeed;
    if (this._currentTime >= this._duration) {
      this._currentTime = 0;
    }
    this.slider.value = String((this._currentTime / this._duration) * 1000);
    this.emit('timeChanged', this._currentTime);
    this.animationId = requestAnimationFrame(this.animate);
  };
}
