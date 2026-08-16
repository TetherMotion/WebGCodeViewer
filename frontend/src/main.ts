/**
 * @file main.ts
 * @brief Entry point for the Tether WebGPU G-code viewer.
 */

import { WsTransport } from './core/WsTransport';
import { RpcClient } from './core/RpcClient';
import { WebGPUApp } from './core/WebGPUApp';

/**
 * Dynamically append the build timestamp to the CSS <link> href.
 *
 * build.mjs patches index.html at build time, but if index.html itself
 * is cached by the browser or a CDN, the CSS link may still reference
 * an old ?v= value. This function re-busts the CSS link at runtime
 * using the __BUILD_TIMESTAMP__ constant injected into the JS bundle,
 * guaranteeing the CSS version always matches the JS version.
 */
function rebustCssLink(): void {
  const link = document.querySelector<HTMLLinkElement>('link[href*="viewer.css"]');
  if (!link) return;
  const href = link.getAttribute('href');
  if (!href) return;
  // Replace any existing ?v=... with the current build timestamp
  const newHref = href.replace(/\?v=[^&]*/, `?v=${__BUILD_TIMESTAMP__}`);
  if (newHref !== href) {
    link.setAttribute('href', newHref);
  }
}

async function main(): Promise<void> {
  // Re-bust CSS link to ensure it matches the JS build version
  rebustCssLink();

  const canvas = document.getElementById('webgpu-canvas') as HTMLCanvasElement | null;
  if (!canvas) {
    console.error('Canvas element not found');
    return;
  }

  const topPanel = document.getElementById('top-panel') as HTMLElement | null;
  const gcodePanel = document.getElementById('gcode-panel') as HTMLElement | null;
  const navCubeContainer = document.getElementById('nav-cube-container') as HTMLElement | null;
  if (!topPanel || !gcodePanel || !navCubeContainer) {
    console.error('UI containers not found');
    return;
  }

  // Create WebSocket transport and RPC client
  const transport = new WsTransport('/api/ws');
  const rpcClient = new RpcClient(transport);

  // Create and init the WebGPU app
  const app = new WebGPUApp(canvas, rpcClient, topPanel, gcodePanel, navCubeContainer);
  // Expose for E2E testing (BUG 6 regression tests use this to call destroy())
  (window as any).__wgvApp = app;
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

  // Feature #145: Apply camera position from URL (?cam=angle,elevation,distance)
  const camParam = urlParams.get('cam');
  if (camParam) {
    app.applyCameraFromUrl(camParam);
  }
}

main().catch(console.error);
