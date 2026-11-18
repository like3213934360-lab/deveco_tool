#include <napi/native_api.h>

namespace {
napi_value Add(napi_env env, napi_callback_info info)
{
    napi_value args[2]{};
    size_t count = 2;
    double left = 0;
    double right = 0;
    if (napi_get_cb_info(env, info, &count, args, nullptr, nullptr) != napi_ok || count != 2 ||
        napi_get_value_double(env, args[0], &left) != napi_ok || napi_get_value_double(env, args[1], &right) != napi_ok) {
        napi_throw_type_error(env, nullptr, "add expects two numbers");
        return nullptr;
    }
    napi_value result = nullptr;
    if (napi_create_double(env, left + right, &result) != napi_ok) {
        napi_throw_error(env, nullptr, "Could not return the sum");
    }
    return result;
}

napi_value Init(napi_env env, napi_value exports)
{
    napi_property_descriptor functions[] = {{"add", nullptr, Add, nullptr, nullptr, nullptr, napi_default, nullptr}};
    if (napi_define_properties(env, exports, 1, functions) != napi_ok) {
        napi_throw_error(env, nullptr, "Could not register add");
        return nullptr;
    }
    return exports;
}

napi_module module = {1, 0, nullptr, Init, "entry", nullptr, {0}};
}

extern "C" __attribute__((constructor)) void RegisterEntryModule()
{
    napi_module_register(&module);
}
