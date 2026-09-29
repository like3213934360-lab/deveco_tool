// Fixtures that turn a template project into richer test apps.
import fs from "node:fs";
import path from "node:path";
import JSON5 from "json5";

/** Add a C++ N-API module (CMakeLists + napi_init.cpp) and externalNativeOptions to the entry module. */
export function makeNative(root) {
  const cpp = path.join(root, "entry/src/main/cpp");
  fs.mkdirSync(cpp, { recursive: true });
  fs.writeFileSync(path.join(cpp, "CMakeLists.txt"), `cmake_minimum_required(VERSION 3.5.0)
project(nativeentry)
add_library(entry SHARED napi_init.cpp)
target_link_libraries(entry PUBLIC libace_napi.z.so)
`);
  fs.writeFileSync(path.join(cpp, "napi_init.cpp"), `#include "napi/native_api.h"
static int Add(int a, int b) { return a + b; }
static napi_value NapiAdd(napi_env env, napi_callback_info info) {
  napi_value result;
  napi_create_int32(env, Add(1, 2), &result);
  return result;
}
EXTERN_C_START
static napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor desc[] = {{"add", nullptr, NapiAdd, nullptr, nullptr, nullptr, napi_default, nullptr}};
  napi_define_properties(env, exports, 1, desc);
  return exports;
}
EXTERN_C_END
static napi_module demoModule = {1, 0, nullptr, Init, "entry", nullptr, {0}};
extern "C" __attribute__((constructor)) void RegisterEntryModule(void) { napi_module_register(&demoModule); }
`);
  const profile = path.join(root, "entry/build-profile.json5");
  const data = JSON5.parse(fs.readFileSync(profile, "utf8"));
  data.buildOption = { ...(data.buildOption ?? {}), externalNativeOptions: { path: "./src/main/cpp/CMakeLists.txt", arguments: "", cppFlags: "", abiFilters: ["arm64-v8a"] } };
  fs.writeFileSync(profile, JSON.stringify(data, null, 2));
}

/** Add Util.ets (leaf <- middle <- Index.build) to exercise call hierarchy. */
export function makeCallChain(root) {
  fs.writeFileSync(path.join(root, "entry/src/main/ets/pages/Util.ets"),
    "export function leaf(n: number): number {\n  return n + 1;\n}\n\nexport function middle(n: number): number {\n  return leaf(n) * 2;\n}\n");
  // Import on line 1 + a top-level caller appended at the end: the page's own lines stay untouched
  // so other tests can keep editing them.
  const page = path.join(root, "entry/src/main/ets/pages/Index.ets");
  fs.writeFileSync(page, "import { middle } from './Util';\n" + fs.readFileSync(page, "utf8") + "\nexport function useMiddle(): number {\n  return middle(1);\n}\n");
}
