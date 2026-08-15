# AGENTS.md - WebGCodeViewer Project Guide

## Project Overview

WebGCodeViewer is a WebGPU-based 3D G-code trajectory viewer with a C++
backend (Drogon HTTP server + WebSocket) and TypeScript frontend.

## Build Commands

```bash
# Configure
cmake -B build

# Build everything (C++ server + frontend)
cmake --build build -j$(nproc)

# Build only frontend (TypeScript bundle)
cmake --build build --target wgv_frontend -j$(nproc)

# Build only the web viewer binary
cmake --build build --target web_viewer -j$(nproc)
```

## Test Commands

```bash
# Unit tests (Vitest, in frontend/)
cd frontend && npm test

# E2E tests (Playwright, from repo root)
# Requires: build/bin/web_viewer to exist and build/web/frontend/ to be deployed
npx playwright test

# E2E tests with visible browser
npx playwright test --headed

# Type checking
cd frontend && npm run typecheck
```

## Running the Viewer

```bash
./build/bin/web_viewer --port 8021 --web-root ./build/web/frontend
```

Then open http://localhost:8021/ in a WebGPU-capable browser (Chrome 113+).

## Architecture

### Backend (C++)
- `web/` — Drogon HTTP server serving static files + WebSocket API
- `proto/` — Protobuf definitions for tether_viewer protocol
- Uses TTHR (Tether Trajectory Header) binary format for efficient data transfer

### Frontend (TypeScript, WebGPU)
- `frontend/src/core/` — Core: WebGPUApp, Camera, RpcClient, TthrParser, MathUtils
- `frontend/src/renderers/` — WebGPU renderers:
  - `ToolpathRenderer` — Main toolpath with color mapping, progress cutoff
  - `GridRenderer` — Ground grid
  - `CrossSectionRenderer` — Cross-section plane
  - `PointCloudRenderer` — Point cloud overlay
  - `OverlayRenderer` — Screen-space overlay
  - `NavigationGizmo` — XYZ axis gizmo (rotates with camera)
  - `DirectionCubeRenderer` — 3D cube buttons for view presets (WebGPU viewports)
  - `PrintHeadMarker` — Animated print head position marker
- `frontend/src/ui/` — UI components:
  - `ControlPanel` — Bottom panel: file ops, color, view, layer slider, time slider
  - `GcodeViewer` — Virtual-scrolling G-code list with search (Ctrl+F)
  - `NavigationCube` — Nav overlay: gizmo canvas + direction cubes + projection toggle
- `frontend/css/viewer.css` — All styling

### E2E Tests (Playwright)
- `e2e/viewer.spec.ts` — Tests page load, console errors, WebGPU validation,
  UI component rendering, interactions (Ctrl+F, projection toggle, cube clicks),
  and rendering stability
- `playwright.config.ts` — Auto-starts web_viewer on port 8099

## Code Conventions

- TypeScript strict mode
- WebGPU for all 3D rendering (no WebGL fallback)
- CSS variables for theming (defined in viewer.css `:root`)
- Event-driven UI via EventDispatcher pattern
- Uniform buffer sizes MUST match WGSL struct sizes (common bug source)

## Known Issues

- Headless Chromium does not support WebGPU — E2E tests filter
  "WebGPU not supported" errors as expected in headless mode
- Cache-busting query params on script/link tags need manual update
  when deploying new versions (see `?v=YYYYMMDD` in index.html)
