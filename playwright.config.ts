import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  retries: 0,
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
});
