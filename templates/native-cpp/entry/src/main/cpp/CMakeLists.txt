cmake_minimum_required(VERSION 3.5)
project(native_entry LANGUAGES CXX)

add_library(entry SHARED napi_init.cpp)
target_link_libraries(entry PRIVATE libace_napi.z.so)
