---
name: deveco-cli
description: >-
  **REQUIRED** and **MANDATORY** if the process involves viewing connected devices and managing emulators (including starting/stopping emulators, creating/deleting emulator instances, and downloading/deleting emulator images), or if the user mentions viewing offline HarmonyOS documentation or managing (add/remove) harmonyOS skill.
---

# DevEco CLI

`devecocli` wraps DevEco Studio's `hvigor`, `ohpm`, `hdc`, emulator toolchain, and HarmonyOS-skills installer. **Prefer `devecocli` over invoking underlying tools directly.**

Available commands: `build`, `run`, `update`, `device`, `emulator`, `skills`, `log`, `create`, `init`, `serve`, `docs`.

### `devecocli emulator`
Manage local emulator instances and system images.
- `list`: Show instances (status, serial, device type).
- `start <names...>`: Start instances. Quote names with spaces. (See Troubleshooting if blocked).
- `stop <names...>`: Stop by name or serial (`127.0.0.1:<port>`).
- `create <name>` (Req: `--device-type`, `--os-version`): Create instance. Optional: `--force`.
- `delete <name>`: Delete instance.
- `image list`: List downloaded images. Opts: `--device-type <type>`, `--all`, `--format <table|json>`.
- `image download` / `image remove` (Req: `--device-type`, `--os-version`): Download/remove image. (Takes 30+ min, set long timeout).
*Device types*: `phone`, `foldable`, `widefold`, `triplefold`, `tablet`, `2in1`, `2in1 foldable`, `wearable`, `tv`.

### `devecocli device`
- `list`: Show active real devices and running emulators.
- `view`: Detailed info. Req `-t <name|serial>` on multi-device hosts.

### `devecocli docs`
Search/read local HarmonyOS docs.
- `search <keywords...>`: Match any keyword. Opts: `--catalog <name>`, `--format <default|json>`, `--limit <n>`.
- `read <documentId>`: Read full content by ID (e.g. `devecocli docs read 开发指南/冷启动_Launch分析/Launch模板基本操作/ide-insight-session-launch`).
- `catalog`: List available catalogs.

### `devecocli skills`
Manage HarmonyOS skills in AI agents/projects.
- `list [-l|--long]` / `find <keyword>`: List or search skills.
- `add (--all | --skill <name>) [--agent <a,b…>] [--project <path>] [--path <path>] [-f]`: Install.
- `remove --skill <name> [...]`: Uninstall.

## Troubleshooting

- **`image download` asks to clear a non-empty directory**: Ask the user whether to force a fresh download. If confirmed, rerun the original command with `--force` to skip the interactive prompt. Do NOT use `--force` without user confirmation.
- **`image download` failure / timeout**: Do NOT auto-retry. Ask the user to install `devecocli` first, then give them the command to run manually in their terminal.
- **`emulator create` timeout**: Treat as user-action step. Ask user to open DevEco Studio -> Device Manager. Check `emulator list` after user confirms. Do NOT auto-retry or edit SDK files.
- **`image list` duplicate OS rows**: `phone`/`foldable`/`widefold`/`triplefold` share the same image. Download/remove ONCE per OS version.
