/**
 * @file main.ts
 * @brief Entry point for the Tether WebGPU G-code viewer.
 */

import { WsTransport } from './core/WsTransport';
import { RpcClient } from './core/RpcClient';
import { WebGPUApp } from './core/WebGPUApp';

async function main(): Promise<void> {
  const canvas = document.getElementById('webgpu-canvas') as HTMLCanvasElement | null;
  if (!canvas) {
    console.error('Canvas element not found');
    return;
  }

  const bottomPanel = document.getElementById('bottom-panel') as HTMLElement | null;
  const gcodePanel = document.getElementById('gcode-panel') as HTMLElement | null;
  const navCubeContainer = document.getElementById('nav-cube-container') as HTMLElement | null;
  if (!bottomPanel || !gcodePanel || !navCubeContainer) {
    console.error('UI containers not found');
    return;
  }

  // Create WebSocket transport and RPC client
  const transport = new WsTransport('/api/ws');
  const rpcClient = new RpcClient(transport);

  // Create and init the WebGPU app
  const app = new WebGPUApp(canvas, rpcClient, bottomPanel, gcodePanel, navCubeContainer);
  try {
    await app.init();
    console.log('Tether viewer initialized');
  } catch (e) {
    console.error('Failed to initialize WebGPU:', e);
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = 'WebGPU initialization failed. Please use a WebGPU-compatible browser.';
    document.body.appendChild(errorDiv);
    // Feature #120: Start stats loop even without WebGPU
    app.startStatsOnlyLoop();
  }

  // Feature #93: Auto-load job from URL parameter (?job=xxx)
  const urlParams = new URLSearchParams(window.location.search);
  const jobId = urlParams.get('job');
  if (jobId) {
    app.loadJobFromUrl(jobId);
  }
}

main().catch(console.error);
