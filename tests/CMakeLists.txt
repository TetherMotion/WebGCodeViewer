# tests/CMakeLists.txt
# Tests for WebGCodeViewer server components

# We need Google Test from Tether's build
if(TARGET gtest_main OR TARGET GTest::gtest_main)
    set(GTEST_AVAILABLE TRUE)
else()
    find_package(GTest QUIET)
    if(GTest_FOUND)
        set(GTEST_AVAILABLE TRUE)
    endif()
endif()

if(GTEST_AVAILABLE)
    file(GLOB WGV_TEST_SOURCES CONFIGURE_DEPENDS
        "${CMAKE_CURRENT_SOURCE_DIR}/*.cpp"
    )

    add_executable(wgv_tests ${WGV_TEST_SOURCES})

    target_link_libraries(wgv_tests PRIVATE
        wgv_server_shared
    )

    # Link GTest
    if(TARGET GTest::gtest_main)
        target_link_libraries(wgv_tests PRIVATE GTest::gtest_main)
    elseif(TARGET gtest_main)
        target_link_libraries(wgv_tests PRIVATE gtest_main)
    endif()

    target_include_directories(wgv_tests PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/../server/include
        ${CMAKE_CURRENT_SOURCE_DIR}/../Tether/include
        ${CMAKE_CURRENT_SOURCE_DIR}/../Tether/dependencies/magic_enum/include
        ${CMAKE_CURRENT_SOURCE_DIR}/../Tether/dependencies/eigen
    )

    target_compile_features(wgv_tests PRIVATE cxx_std_23)

    set_target_properties(wgv_tests PROPERTIES
        RUNTIME_OUTPUT_DIRECTORY ${WGV_BIN_DIR}
    )

    include(GoogleTest)
    gtest_discover_tests(wgv_tests)
else()
    message(WARNING "Google Test not found - skipping WebGCodeViewer tests")
endif()
