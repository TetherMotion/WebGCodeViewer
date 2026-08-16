/**
 * @file PaControls.ts
 * @brief UI panel for pressure advance algorithm selection and plot controls.
 *
 * Features:
 * - Algorithm selector dropdown (Linear, PowerLaw, CrossWLF, LTI-Deconv, LPV-Deconv)
 * - Pre/Post PA toggle checkboxes
 * - Plot series toggles (velocity, acceleration, jerk, PA offset, PA velocity)
 * - PA parameter display (PA amount, smooth time, max compensation)
 * - Reset view button
 */

export type PaAlgorithmId = 0 | 1 | 2 | 3 | 4;

export interface PaControlState {
  selectedAlgorithm: PaAlgorithmId;
  showPrePa: boolean;       // Show raw extruder velocity (before PA)
  showPostPa: boolean;      // Show PA offset (after PA)
  showVelocity: boolean;    // Show path velocity
  showAcceleration: boolean;
  showJerk: boolean;
}

export const ALGORITHM_NAMES: Record<PaAlgorithmId, string> = {
  0: 'Linear (Classic Klipper)',
  1: 'PowerLaw (Non-Newtonian)',
  2: 'CrossWLF (Temperature-Dependent)',
  3: 'LTI Deconvolution (Frequency Domain)',
  4: 'LPV Deconvolution (Gain-Scheduled)',
};

export const ALGORITHM_DESCRIPTIONS: Record<PaAlgorithmId, string> = {
  0: 'δe = PA · v_e — Classic linear pressure advance',
  1: 'δe = K_base · (v_e · A_f)^n — Non-Newtonian shear-thinning',
  2: 'δe = (βV_m/A_f) · P_LUT(Q, T) — Cross-WLF rheological model',
  3: 'Wiener/Tikhonov regularized LTI deconvolution in frequency domain',
  4: 'Gain-scheduled overlap-add LPV deconvolution with lookahead',
};

export class PaControls {
  private container: HTMLElement;
  private state: PaControlState;
  private onStateChange: (state: PaControlState) => void;

  constructor(parent: HTMLElement, onStateChange: (state: PaControlState) => void) {
    this.onStateChange = onStateChange;
    this.state = {
      selectedAlgorithm: 0,
      showPrePa: true,
      showPostPa: true,
      showVelocity: true,
      showAcceleration: false,
      showJerk: false,
    };

    this.container = document.createElement('div');
    this.container.className = 'pa-controls';
    this.container.style.cssText = `
      position: absolute; top: 10px; right: 10px;
      background: rgba(20, 20, 30, 0.9); color: #ddd;
      padding: 12px; border-radius: 8px; font-size: 12px;
      font-family: monospace; z-index: 100; min-width: 280px;
      border: 1px solid rgba(100, 100, 120, 0.3);
    `;

    parent.appendChild(this.container);
    this.render();
  }

  private render(): void {
    this.container.innerHTML = '';

    // Title
    const title = document.createElement('div');
    title.textContent = 'Pressure Advance Visualization';
    title.style.cssText = 'font-weight: bold; margin-bottom: 8px; font-size: 13px;';
    this.container.appendChild(title);

    // Algorithm selector
    const algoLabel = document.createElement('div');
    algoLabel.textContent = 'PA Algorithm:';
    algoLabel.style.cssText = 'margin-top: 8px; margin-bottom: 4px;';
    this.container.appendChild(algoLabel);

    const select = document.createElement('select');
    select.style.cssText = 'width: 100%; background: #1a1a2a; color: #ddd; border: 1px solid #444; padding: 4px; border-radius: 4px;';
    for (const id of [0, 1, 2, 3, 4] as PaAlgorithmId[]) {
      const opt = document.createElement('option');
      opt.value = String(id);
      opt.textContent = ALGORITHM_NAMES[id];
      if (id === this.state.selectedAlgorithm) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => {
      this.state.selectedAlgorithm = parseInt(select.value) as PaAlgorithmId;
      this.onStateChange(this.state);
      this.render();
    });
    this.container.appendChild(select);

    // Algorithm description
    const desc = document.createElement('div');
    desc.textContent = ALGORITHM_DESCRIPTIONS[this.state.selectedAlgorithm];
    desc.style.cssText = 'margin-top: 4px; font-size: 10px; color: #888; font-style: italic;';
    this.container.appendChild(desc);

    // Divider
    const div1 = document.createElement('div');
    div1.style.cssText = 'border-top: 1px solid #333; margin: 10px 0;';
    this.container.appendChild(div1);

    // PA display toggles
    const paLabel = document.createElement('div');
    paLabel.textContent = 'Pressure Advance:';
    paLabel.style.cssText = 'margin-bottom: 4px;';
    this.container.appendChild(paLabel);

    this.addCheckbox('Pre-PA (Raw Extruder Velocity)', this.state.showPrePa, (v) => {
      this.state.showPrePa = v;
      this.onStateChange(this.state);
    });
    this.addCheckbox('Post-PA (Compensated Offset)', this.state.showPostPa, (v) => {
      this.state.showPostPa = v;
      this.onStateChange(this.state);
    });

    // Divider
    const div2 = document.createElement('div');
    div2.style.cssText = 'border-top: 1px solid #333; margin: 10px 0;';
    this.container.appendChild(div2);

    // Motion profile toggles
    const motionLabel = document.createElement('div');
    motionLabel.textContent = 'Motion Profile:';
    motionLabel.style.cssText = 'margin-bottom: 4px;';
    this.container.appendChild(motionLabel);

    this.addCheckbox('Velocity', this.state.showVelocity, (v) => {
      this.state.showVelocity = v;
      this.onStateChange(this.state);
    });
    this.addCheckbox('Acceleration', this.state.showAcceleration, (v) => {
      this.state.showAcceleration = v;
      this.onStateChange(this.state);
    });
    this.addCheckbox('Jerk', this.state.showJerk, (v) => {
      this.state.showJerk = v;
      this.onStateChange(this.state);
    });

    // Divider
    const div3 = document.createElement('div');
    div3.style.cssText = 'border-top: 1px solid #333; margin: 10px 0;';
    this.container.appendChild(div3);

    // Reset button
    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'Reset Plot View';
    resetBtn.style.cssText = 'width: 100%; padding: 6px; background: #2a2a4a; color: #ddd; border: 1px solid #555; border-radius: 4px; cursor: pointer;';
    resetBtn.addEventListener('click', () => {
      this.state = {
        selectedAlgorithm: 0,
        showPrePa: true,
        showPostPa: true,
        showVelocity: true,
        showAcceleration: false,
        showJerk: false,
      };
      this.onStateChange(this.state);
      this.render();
    });
    this.container.appendChild(resetBtn);
  }

  private addCheckbox(label: string, checked: boolean, onChange: (v: boolean) => void): void {
    const labelEl = document.createElement('label');
    labelEl.style.cssText = 'display: flex; align-items: center; gap: 6px; margin: 3px 0; cursor: pointer;';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = checked;
    cb.style.cssText = 'cursor: pointer;';
    cb.addEventListener('change', () => onChange(cb.checked));
    labelEl.appendChild(cb);
    const text = document.createElement('span');
    text.textContent = label;
    text.style.cssText = 'font-size: 11px;';
    labelEl.appendChild(text);
    this.container.appendChild(labelEl);
  }

  getState(): PaControlState {
    return { ...this.state };
  }

  setState(state: Partial<PaControlState>): void {
    this.state = { ...this.state, ...state };
    this.render();
  }

  destroy(): void {
    this.container.remove();
  }
}
