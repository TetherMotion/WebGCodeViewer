/**
 * @file global.d.ts
 * @brief Global type declarations for build-time constants.
 *
 * __BUILD_TIMESTAMP__ is injected by build.mjs via esbuild's --define flag.
 * It contains the build timestamp in YYYYMMDDTHHMMSS format.
 */

declare const __BUILD_TIMESTAMP__: string;
