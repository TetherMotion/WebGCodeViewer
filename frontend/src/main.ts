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

  const uiContainer = document.getElementById('ui-container') || document.body;

  // Create WebSocket transport and RPC client
  const transport = new WsTransport('/api/ws');
  const rpcClient = new RpcClient(transport);

  // Create and init the WebGPU app
  const app = new WebGPUApp(canvas, rpcClient, uiContainer as HTMLElement);
  try {
    await app.init();
    console.log('Tether viewer initialized');
  } catch (e) {
    console.error('Failed to initialize WebGPU:', e);
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = 'WebGPU initialization failed. Please use a WebGPU-compatible browser.';
    document.body.appendChild(errorDiv);
  }
}

main().catch(console.error);
