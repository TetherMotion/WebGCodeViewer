/**
 * @file build.mjs
 * @brief Build wrapper that generates a build timestamp and injects it
 *        into the JS bundle (via esbuild --define) and index.html.
 *
 * The timestamp is based on the current build time (ISO 8601 format,
 * with colons replaced by hyphens for URL safety).
 *
 * This eliminates the need to manually update cache-busting version
 * strings in index.html — every build gets a unique version tag.
 */

import esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Generate build timestamp: YYYYMMDDTHHMMSS (URL-safe, no colons)
const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const buildTimestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
  `T${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

console.log(`Build timestamp: ${buildTimestamp}`);

// ── 1. Run esbuild with __BUILD_TIMESTAMP__ injected ──────────────────
const isDev = process.argv.includes('--dev');
const result = await esbuild.build({
  entryPoints: [join(__dirname, 'src/main.ts')],
  bundle: true,
  minify: !isDev,
  sourcemap: true,
  outfile: join(__dirname, 'dist/tether-viewer.js'),
  define: {
    '__BUILD_TIMESTAMP__': `"${buildTimestamp}"`,
  },
});

console.log(`esbuild: ${result.errors.length} errors, ${result.warnings.length} warnings`);

// ── 2. Write build-version.txt (for debugging/introspection) ──────────
writeFileSync(join(__dirname, 'dist/build-version.txt'), buildTimestamp, 'utf8');

// ── 3. Generate patched index.html in dist/ ───────────────────────────
// The source index.html contains __BUILD_VERSION__ placeholders.
// We write the patched version to dist/index.html so the source file
// remains unchanged (no git noise from builds).
const htmlPath = join(__dirname, 'index.html');
let html = readFileSync(htmlPath, 'utf8');

// Replace the __BUILD_VERSION__ placeholder with the actual build timestamp.
// This replaces all occurrences (CSS link, JS script tag, etc.)
html = html.replaceAll('__BUILD_VERSION__', buildTimestamp);

writeFileSync(join(__dirname, 'dist/index.html'), html, 'utf8');
console.log(`dist/index.html generated with ?v=${buildTimestamp}`);
