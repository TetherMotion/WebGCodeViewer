cmake_minimum_required(VERSION 3.22)

project(WebGCodeViewer
    VERSION 1.0.0
    DESCRIPTION "WebGPU-based G-code viewer with Drogon backend for Tether"
    LANGUAGES CXX
)

# ── Build configuration ──────────────────────────────────────────────────────
option(WGV_BUILD_TESTS "Build tests" ON)
option(WGV_BUILD_EXAMPLES "Build example applications" ON)
option(WGV_BUILD_FRONTEND "Build TypeScript frontend (requires npm)" ON)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type" FORCE)
endif()

# Output directories
set(WGV_BIN_DIR "${CMAKE_BINARY_DIR}/bin")
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${WGV_BIN_DIR})

# ── Tether submodule ─────────────────────────────────────────────────────────
# Build Tether as a subdirectory to get all library targets.
# We only need: gcode, export, motion_planner (and their deps, resolved
# automatically). Using TETHER_COMPONENTS disables everything else including
# tools (extract_esi), tests, examples, benchmarks, and python bindings.
set(TETHER_COMPONENTS "gcode;export;motion_planner;controls" CACHE STRING "" FORCE)
set(TETHER_BUILD_WEB OFF CACHE BOOL "" FORCE)
set(TETHER_BUILD_KLIPPER OFF CACHE BOOL "" FORCE)
set(TETHER_ENABLE_KLIPPER_HTTP OFF CACHE BOOL "" FORCE)
set(TETHER_ENABLE_PRESSURE_ADVANCE OFF CACHE BOOL "" FORCE)

# Add drogon_compat find modules to CMAKE_MODULE_PATH so that
# Drogon's optional dependencies (pg, SQLite3, etc.) are stubbed out.
# This must be done BEFORE add_subdirectory(Tether) since Tether finds Drogon.
list(APPEND CMAKE_MODULE_PATH
    "${CMAKE_CURRENT_SOURCE_DIR}/cmake/drogon_compat"
    "${CMAKE_CURRENT_SOURCE_DIR}/Tether/cmake/drogon_compat"
)

# ── jsoncpp (required by Drogon headers) ─────────────────────────────────────
# Drogon's public headers #include <json/json.h>, so jsoncpp dev headers are
# required at compile time. glaze (in Tether/dependencies/glaze) cannot
# replace jsoncpp here because Drogon hardcodes the jsoncpp include path.
#
# If jsoncpp is not found, we fail with a clear message instead of silently
# FetchContent'ing it (which caused in-source build errors).
find_package(Jsoncpp QUIET)
if(NOT Jsoncpp_FOUND)
    find_path(JSONCPP_INCLUDE_DIRS NAMES json/json.h PATH_SUFFIXES jsoncpp)
    find_library(JSONCPP_LIBRARIES NAMES jsoncpp)
    if(JSONCPP_INCLUDE_DIRS AND JSONCPP_LIBRARIES)
        set(Jsoncpp_FOUND TRUE)
    endif()
endif()
if(NOT Jsoncpp_FOUND)
    message(FATAL_ERROR
        "jsoncpp development headers not found.\n"
        "Drogon (already installed on this system) requires jsoncpp headers to compile.\n"
        "\n"
        "Install jsoncpp dev package:\n"
        "  Ubuntu/Debian:  sudo apt install libjsoncpp-dev\n"
        "  Fedora:         sudo dnf install jsoncpp-devel\n"
        "  Arch:           sudo pacman -S jsoncpp\n"
        "  macOS (brew):   brew install jsoncpp\n")
endif()

add_subdirectory(Tether)

# ── Dependencies: Drogon + Protobuf ──────────────────────────────────────────
find_package(Drogon REQUIRED)
find_package(Protobuf REQUIRED)
find_package(Threads REQUIRED)

# ── Protobuf C++ generation ──────────────────────────────────────────────────
# Regenerate protobuf C++ sources from the proto file
set(WGV_PROTO_FILE "${CMAKE_CURRENT_SOURCE_DIR}/proto/tether_viewer.proto")
set(WGV_PROTO_CC "${CMAKE_CURRENT_SOURCE_DIR}/server/src/proto/tether_viewer.pb.cc")
set(WGV_PROTO_H "${CMAKE_CURRENT_SOURCE_DIR}/server/src/proto/tether_viewer.pb.h")

# Ensure proto source directory exists
file(MAKE_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/server/src/proto")

# Generate protobuf C++ sources (only if proto is newer than generated files)
add_custom_command(
    OUTPUT ${WGV_PROTO_CC} ${WGV_PROTO_H}
    COMMAND ${Protobuf_PROTOC_EXECUTABLE}
        --proto_path=${CMAKE_CURRENT_SOURCE_DIR}/proto
        --cpp_out=${CMAKE_CURRENT_SOURCE_DIR}/server/src/proto
        ${WGV_PROTO_FILE}
    DEPENDS ${WGV_PROTO_FILE}
    COMMENT "Generating protobuf C++ sources from tether_viewer.proto"
    VERBATIM
)

# ── Server library ───────────────────────────────────────────────────────────
file(GLOB WGV_SERVER_SOURCES CONFIGURE_DEPENDS
    "${CMAKE_CURRENT_SOURCE_DIR}/server/src/*.cpp"
)
list(APPEND WGV_SERVER_SOURCES ${WGV_PROTO_CC})

set(WGV_SERVER_TARGETS "")
add_library(wgv_server_shared SHARED ${WGV_SERVER_SOURCES})
list(APPEND WGV_SERVER_TARGETS wgv_server_shared)

foreach(_tgt ${WGV_SERVER_TARGETS})
    target_include_directories(${_tgt}
        PUBLIC
            $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/server/include>
            $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/Tether/include>
            $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/Tether/dependencies/eigen>
        PRIVATE
            $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/server/src/proto>
            $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/Tether/dependencies/magic_enum/include>
    )

    target_compile_features(${_tgt} PRIVATE cxx_std_23)

    # Link against Tether libraries
    if(TARGET tether_export_shared)
        target_link_libraries(${_tgt} PUBLIC tether_export_shared)
    elseif(TARGET tether_export_static)
        target_link_libraries(${_tgt} PUBLIC tether_export_static)
    endif()

    if(TARGET tether_gcode_shared)
        target_link_libraries(${_tgt} PUBLIC tether_gcode_shared)
    elseif(TARGET tether_gcode_static)
        target_link_libraries(${_tgt} PUBLIC tether_gcode_static)
    endif()

    if(TARGET tether_motion_planner_shared)
        target_link_libraries(${_tgt} PUBLIC tether_motion_planner_shared)
    elseif(TARGET tether_motion_planner_static)
        target_link_libraries(${_tgt} PUBLIC tether_motion_planner_static)
    endif()
    if(TARGET tether_controls_shared)
        target_link_libraries(${_tgt} PUBLIC tether_controls_shared)
    elseif(TARGET tether_controls_static)
        target_link_libraries(${_tgt} PUBLIC tether_controls_static)
    endif()

    # Link against Drogon + Protobuf
    target_link_libraries(${_tgt} PUBLIC Drogon::Drogon)
    target_link_libraries(${_tgt} PUBLIC ${Protobuf_LIBRARIES})
    target_include_directories(${_tgt} PRIVATE ${Protobuf_INCLUDE_DIRS})

    # Threads
    target_link_libraries(${_tgt} PRIVATE Threads::Threads)

    set_target_properties(${_tgt} PROPERTIES POSITION_INDEPENDENT_CODE ON)
endforeach()

# Alias
add_library(wgv_server ALIAS wgv_server_shared)
add_library(WebGCodeViewer::Server ALIAS wgv_server_shared)

# ── Frontend build (npm) ─────────────────────────────────────────────────────
if(WGV_BUILD_FRONTEND)
    set(WGV_FRONTEND_DIR "${CMAKE_CURRENT_SOURCE_DIR}/frontend")
    set(WGV_FRONTEND_OUTPUT "${WGV_FRONTEND_DIR}/dist/tether-viewer.js")
    set(WGV_FRONTEND_SERVED "${CMAKE_BINARY_DIR}/web/frontend/dist/tether-viewer.js")

    find_program(NPM_EXECUTABLE npm QUIET)

    if(NPM_EXECUTABLE)
        # Update proto:generate path in package.json to point to our proto/
        # The frontend package.json references ../proto which is correct since
        # frontend/ is at the same level as proto/

        # Collect all frontend source files so CMake rebuilds when any change
        file(GLOB_RECURSE WGV_FRONTEND_SOURCES
            "${WGV_FRONTEND_DIR}/src/*.ts"
            "${WGV_FRONTEND_DIR}/src/*.js"
            "${WGV_FRONTEND_DIR}/css/*.css"
            "${WGV_FRONTEND_DIR}/index.html"
        )

        add_custom_command(
            OUTPUT ${WGV_FRONTEND_OUTPUT}
            COMMAND ${NPM_EXECUTABLE} install --silent
            COMMAND ${NPM_EXECUTABLE} run proto:generate --silent
            COMMAND ${NPM_EXECUTABLE} run build --silent
            WORKING_DIRECTORY ${WGV_FRONTEND_DIR}
            DEPENDS
                "${WGV_FRONTEND_DIR}/package.json"
                "${WGV_FRONTEND_DIR}/tsconfig.json"
                ${WGV_FRONTEND_SOURCES}
                "${CMAKE_CURRENT_SOURCE_DIR}/proto/tether_viewer.proto"
            COMMENT "Building WebGCodeViewer frontend (TypeScript)"
            VERBATIM
        )

        add_custom_target(wgv_frontend ALL
            DEPENDS ${WGV_FRONTEND_OUTPUT}
        )

        # Copy frontend assets to build directory
        add_custom_command(
            OUTPUT ${WGV_FRONTEND_SERVED}
            COMMAND ${CMAKE_COMMAND} -E make_directory "${CMAKE_BINARY_DIR}/web/frontend/dist"
            COMMAND ${CMAKE_COMMAND} -E copy_if_different
                ${WGV_FRONTEND_OUTPUT}
                ${WGV_FRONTEND_SERVED}
            COMMAND ${CMAKE_COMMAND} -E copy_if_different
                "${WGV_FRONTEND_OUTPUT}.map"
                "${CMAKE_BINARY_DIR}/web/frontend/dist/tether-viewer.js.map"
            COMMAND ${CMAKE_COMMAND} -E copy_if_different
                # index.html is generated by build.mjs with build-timestamp
                # cache-busting tags injected (replaces __BUILD_VERSION__).
                "${WGV_FRONTEND_DIR}/dist/index.html"
                "${CMAKE_BINARY_DIR}/web/frontend/index.html"
            COMMAND ${CMAKE_COMMAND} -E copy_if_different
                "${WGV_FRONTEND_DIR}/dist/build-version.txt"
                "${CMAKE_BINARY_DIR}/web/frontend/dist/build-version.txt"
            COMMAND ${CMAKE_COMMAND} -E copy_if_different
                "${WGV_FRONTEND_DIR}/manifest.json"
                "${CMAKE_BINARY_DIR}/web/frontend/manifest.json"
            COMMAND ${CMAKE_COMMAND} -E copy_directory
                "${WGV_FRONTEND_DIR}/css"
                "${CMAKE_BINARY_DIR}/web/frontend/css"
            DEPENDS ${WGV_FRONTEND_OUTPUT} wgv_frontend
            COMMENT "Copying frontend assets to build directory"
            VERBATIM
        )

        add_custom_target(wgv_frontend_deploy ALL
            DEPENDS ${WGV_FRONTEND_SERVED}
        )

        # Server depends on frontend being deployed
        foreach(_tgt ${WGV_SERVER_TARGETS})
            add_dependencies(${_tgt} wgv_frontend_deploy)
        endforeach()

        message(STATUS "WebGCodeViewer frontend: npm build enabled (${NPM_EXECUTABLE})")
    else()
        message(WARNING "npm not found - frontend will not be built. Install Node.js to enable.")
    endif()
endif()

# ── Examples ─────────────────────────────────────────────────────────────────
if(WGV_BUILD_EXAMPLES)
    add_subdirectory(examples)
endif()

# ── Tests ────────────────────────────────────────────────────────────────────
if(WGV_BUILD_TESTS)
    enable_testing()
    add_subdirectory(tests)
endif()

# ── Summary ──────────────────────────────────────────────────────────────────
message(STATUS "")
message(STATUS "WebGCodeViewer configuration:")
message(STATUS "  Tests:      ${WGV_BUILD_TESTS}")
message(STATUS "  Examples:   ${WGV_BUILD_EXAMPLES}")
message(STATUS "  Frontend:   ${WGV_BUILD_FRONTEND}")
message(STATUS "  Binaries:   ${WGV_BIN_DIR}")
message(STATUS "")
