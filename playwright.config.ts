import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration with WebGPU support.
 *
 * Two test projects:
 * 1. "headless" — Standard headless Chromium (no WebGPU). Used for most
 *    E2E tests that verify UI, data loading, and server interactions.
 * 2. "webgpu" — Google Chrome with GPU acceleration enabled. Used for
 *    visual regression tests that require WebGPU rendering.
 *
 * The WebGPU project uses the 'chrome' channel and passes GPU-related
 * flags to enable WebGPU even in CI/headless environments.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  retries: 0,
  fullyParallel: false,
  use: {
    headless: true,
    viewport: { width: 1280, height: 720 },
  },
  webServer: {
    command: './build/bin/web_viewer --port 8099 --web-root ./build/web/frontend',
    port: 8099,
    timeout: 10000,
    reuseExistingServer: true,
  },
  projects: [
    {
      name: 'headless',
      use: {
        headless: true,
        channel: undefined,
      },
      testMatch: /.*\.spec\.ts/,
      // Exclude WebGPU-specific tests from headless project
      testIgnore: /.*webgpu.*\.spec\.ts/,
    },
    {
      name: 'webgpu',
      use: {
        // Use Chromium with WebGPU flags. Chrome channel is preferred but
        // requires separate installation. Chromium with SwiftShader/CPU
        // rendering provides WebGPU support without a discrete GPU.
        channel: undefined,  // Use bundled Chromium
        headless: true,
        launchOptions: {
          args: [
            '--enable-unsafe-webgpu',
            '--enable-features=Vulkan,UseSkiaRenderer',
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--ignore-gpu-blocklist',
            '--enable-dawn-features=allow_unsafe_apis',
          ],
        },
      },
      // Only run WebGPU-specific tests in this project
      testMatch: /.*webgpu.*\.spec\.ts/,
    },
  ],
});
