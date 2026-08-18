# examples/CMakeLists.txt
# Example applications for WebGCodeViewer

# ── Web Viewer Standalone ────────────────────────────────────────────────────
# A standalone web server that serves the WebGPU G-code viewer frontend
# and provides REST + WebSocket API endpoints for trajectory data.
# No Klipper or printer connection required.

add_executable(web_viewer
    web_viewer.cpp
)

target_link_libraries(web_viewer PRIVATE wgv_server_shared)
target_include_directories(web_viewer PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/../server/include
    ${CMAKE_CURRENT_SOURCE_DIR}/../Tether/include
    ${CMAKE_CURRENT_SOURCE_DIR}/../Tether/dependencies/argparse/include
)
target_compile_features(web_viewer PRIVATE cxx_std_23)

set_target_properties(web_viewer PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY ${WGV_BIN_DIR}
)
