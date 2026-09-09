export const requiredAcceptance = [
  "workflow.project_create", "workflow.project_sync", "workflow.project_build", "workflow.app_deploy",
  "workflow.build_deploy_verify", "workflow.code_diagnose", "workflow.crash_diagnose", "workflow.api_compatibility",
  "recovery.sdk_kill", "recovery.install_preparation", "recovery.signed_package_set", "recovery.ui_steps", "recovery.hot_patch", "recovery.cloud_signature", "recovery.emulator",
  "infrastructure.deduplicate", "infrastructure.cancel", "infrastructure.resource_contention", "infrastructure.disk_full", "infrastructure.output_limit", "infrastructure.missing_sdk", "infrastructure.auth_failure",
  "project.multi_product", "project.multi_module", "diagnostics.cpp_abi", "diagnostics.lsp_modules", "diagnostics.linter", "diagnostics.api_versions",
  "ui.saved_flows", "ui.unknown_goal_recording", "ui.gestures_displays", "ui.chinese_input", "ui.final_assertions",
  "special.hot_patch_twice_no_restart", "special.personal_cloud_signing", "special.expired_auth_refresh", "special.emulator_effect",
  "upgrade.configuration", "upgrade.reauthentication", "upgrade.saved_flows", "upgrade.owned_skill_cleanup", "upgrade.full_release_rollback", "upstream.candidate_adaptation",
] as const;
export const requiredPerformance = ["deveco_doctor", "lsp", "arkts_check", "code_lint", "check_cpp_files", "device_info", "hdc_log", "hot_reload.status", "app_signature.inspect", "ui_snapshot", "ui_observe", "ui_find", "ui_tap", "ui_flow.catalog", "verify_ui", "ui_inspect", "ui_control", "emulator_manage.list", "emulator_scenario"] as const;
