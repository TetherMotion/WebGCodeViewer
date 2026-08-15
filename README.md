# WebGCodeViewer

A WebGPU-based G-code viewer with a Drogon C++ backend and TypeScript frontend.

## Architecture

- **Server** (`server/`): C++ Drogon-based HTTP + WebSocket server that parses G-code,
  computes trajectory samples via [Tether](https://github.com/TetherMotion/Tether), and
  serves them as binary TTHR data over a Protobuf-over-WebSocket RPC protocol.
- **Frontend** (`frontend/`): TypeScript WebGPU application that renders trajectory data
  with color-coded toolpaths, cross-sections, Z-layer dissection, and measurement tools.
- **Proto** (`proto/`): Protobuf definitions for the viewer RPC protocol.
- **Examples** (`examples/`): Standalone server example.
- **Tests** (`tests/`): C++ server unit tests + TypeScript frontend unit tests.

## Requirements

- C++23 compiler (GCC 13+, Clang 17+)
- CMake 3.22+
- [Drogon](https://github.com/drogonframework/drogon)
- jsoncpp dev headers (`libjsoncpp-dev` on Ubuntu/Debian — required by Drogon headers)
- Protobuf
- Node.js 18+ (for frontend build)

## Building

```bash
# Clone with submodules
git clone --recursive https://github.com/TetherMotion/WebGCodeViewer.git
cd WebGCodeViewer

# Configure
cmake -B build

# Build
cmake --build build -j$(nproc)

# Run the viewer
./build/bin/web_viewer --port 8080
# Open http://localhost:8080 in a WebGPU-compatible browser
```

## Frontend Development

```bash
cd frontend
npm install
npm run proto:generate   # Generate TypeScript protobuf types
npm run build            # Production build
npm run build:dev        # Development build (no minification)
npm run test             # Run unit tests
npm run test:watch       # Watch mode tests
```

## Protocol

The viewer uses a custom Protobuf-over-WebSocket protocol defined in
[`proto/tether_viewer.proto`](proto/tether_viewer.proto). The envelope supports:

- Authentication
- Unary RPC calls (upload, process, get data, stats, segments, Z-layers)
- Server streaming (progress updates)
- Cancellation

## License

See [LICENSE](LICENSE).
