/**
 * @file ZLayerPanel.ts
 * @brief Side panel for Z-layer navigation and filtering (3D printing dissection).
 * Allows users to view individual print layers, navigate between them, and
 * filter the toolpath to show only specific Z-layers.
 */

import { EventDispatcher } from '../core/EventDispatcher';
import type { GetZLayersResponse, ZLayerInfo } from '../generated/tether_viewer_pb';

export interface ZLayerEvents {
  layerSelected: number;       // layer index
  layerRangeSelected: { startLayer: number; endLayer: number };
  visibilityChanged: { layerIndex: number; visible: boolean };
  zToleranceChanged: number;
  showAllLayers: void;
}

export class ZLayerPanel extends EventDispatcher<ZLayerEvents> {
  private element: HTMLElement;
  private listElement: HTMLElement;
  private toleranceInput: HTMLInputElement;
  private layerInfo: ZLayerInfo[] = [];
  private selectedLayer: number = -1;
  private hiddenLayers: Set<number> = new Set();

  constructor(container: HTMLElement) {
    super();
    this.element = document.createElement('div');
    this.element.className = 'z-layer-panel';
    container.appendChild(this.element);
    this.build();
  }

  private build(): void {
    this.element.innerHTML = '<h3>Z-Layers</h3>';

    // Tolerance control
    const tolDiv = document.createElement('div');
    tolDiv.className = 'z-tolerance';
    tolDiv.innerHTML = '<label>Z Tolerance: </label>';
    this.toleranceInput = document.createElement('input');
    this.toleranceInput.type = 'number';
    this.toleranceInput.value = '0.01';
    this.toleranceInput.step = '0.001';
    this.toleranceInput.min = '0.001';
    const tolBtn = document.createElement('button');
    tolBtn.textContent = 'Recompute';
    tolBtn.onclick = () => {
      this.emit('zToleranceChanged', parseFloat(this.toleranceInput.value) || 0.01);
    };
    tolDiv.appendChild(this.toleranceInput);
    tolDiv.appendChild(tolBtn);
    this.element.appendChild(tolDiv);

    // Summary
    const summary = document.createElement('div');
    summary.className = 'z-layer-summary';
    summary.id = 'z-layer-summary';
    this.element.appendChild(summary);

    // Layer list
    this.listElement = document.createElement('div');
    this.listElement.className = 'z-layer-list-items';
    this.element.appendChild(this.listElement);

    // Show all button
    const showAllBtn = document.createElement('button');
    showAllBtn.textContent = 'Show All Layers';
    showAllBtn.onclick = () => {
      this.selectedLayer = -1;
      this.hiddenLayers.clear();
      this.emit('showAllLayers', undefined as any);
      this.updateList();
    };
    this.element.appendChild(showAllBtn);
  }

  update(layers: GetZLayersResponse): void {
    this.layerInfo = [...layers.layers];
    this.selectedLayer = -1;
    this.hiddenLayers.clear();

    const summary = document.getElementById('z-layer-summary');
    if (summary) {
      summary.innerHTML = `
        <div>Total Layers: ${layers.totalLayers}</div>
        <div>Z Range: ${layers.minZ.toFixed(2)} - ${layers.maxZ.toFixed(2)} mm</div>
        <div>Layer Height: ${layers.layerHeight.toFixed(3)} mm</div>
      `;
    }
    this.updateList();
  }

  private updateList(): void {
    const html = this.layerInfo.map((layer) => {
      const isSelected = this.selectedLayer === layer.layerIndex;
      const isHidden = this.hiddenLayers.has(layer.layerIndex);
      return `<div class="z-layer-item ${isSelected ? 'selected' : ''}" data-layer="${layer.layerIndex}">
        <input type="checkbox" ${isHidden ? '' : 'checked'} data-layer="${layer.layerIndex}" class="layer-visibility"/>
        <span class="layer-idx">L${layer.layerIndex}</span>
        <span class="layer-z">Z=${layer.zHeight.toFixed(3)}</span>
        <span class="layer-count">${layer.sampleCount} samples</span>
        <span class="layer-path">${layer.pathLength.toFixed(1)} mm</span>
      </div>`;
    }).join('');
    this.listElement.innerHTML = html;

    // Attach click handlers
    this.listElement.querySelectorAll('.z-layer-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).tagName === 'INPUT') return;
        const layerIdx = parseInt(item.getAttribute('data-layer') || '0');
        this.selectedLayer = layerIdx;
        this.emit('layerSelected', layerIdx);
        this.updateList();
      });
    });

    // Attach checkbox handlers
    this.listElement.querySelectorAll('.layer-visibility').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const layerIdx = parseInt((e.target as HTMLInputElement).getAttribute('data-layer') || '0');
        const visible = (e.target as HTMLInputElement).checked;
        if (visible) {
          this.hiddenLayers.delete(layerIdx);
        } else {
          this.hiddenLayers.add(layerIdx);
        }
        this.emit('visibilityChanged', { layerIndex: layerIdx, visible });
      });
    });
  }

  getSelectedLayer(): number {
    return this.selectedLayer;
  }

  getHiddenLayers(): Set<number> {
    return new Set(this.hiddenLayers);
  }
}
