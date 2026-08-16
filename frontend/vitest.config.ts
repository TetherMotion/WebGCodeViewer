import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@chartgpu/chartgpu': path.resolve(__dirname, 'tests/__mocks__/chartgpu.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/webgpu-mock.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/generated/**'],
    },
  },
});
