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

<!-- LOCAL PATCH: selectively synced from 0.2.0-release @ 31ae19dd. That branch is unreleased and
     moving, so this pack stays pinned at 9535f0f5 and takes changes one at a time. This section is
     taken because the bundled @deveco/deveco-cli@1.2.1 does have `signature`, and without it a
     debug build ends in "Will skip sign 'hos_hap'. No signingConfigs profile is configured" with
     nothing telling you what to do. The same upstream commit also drops the `devecocli docs`
     section — NOT taken, because 1.2.1 still ships `docs`. -->
### `devecocli signature generate` `[Outside sandbox]`
Auto-generate HarmonyOS signing materials (local p12/csr + cloud cert + test profile) and write signing config to `build-profile.json5`.
- **Prereq**: `devecocli login` first; run from a project directory (with `build-profile.json5`); a connected device or emulator is required for device registration.
- `--product <name>`: Product name for local p12/csr file naming (default: `default`).
- `--team-id <id>`: Specify the team-id (default: current user's id).
- `--force`: Force regenerate even if existing materials are valid.
- Generates under `~/.ohos/config/`: `.p12` keystore, `.csr`, downloaded `.cer` certificate, `.p7b` profile.
- Writes `signingConfigs` + `products` entries to `build-profile.json5` with encrypted key/store passwords (AES-128-GCM).
- Cloud cert name: `auto_debug_<teamId>.cer`. Local files: `<product>_<project>_<hash>=.{p12,csr,cer,p7b}`.
- Error handling (aligned with DevEco Studio JAR): 401→re-login, 403→no AGC permission, `205389872`→cert limit, `205389904`→not Harmony user, `205389938`→provision limit, invalid `.cer`→retry.
*Ex*: `devecocli signature generate --product default`

## Troubleshooting

- **`image download` asks to clear a non-empty directory**: Ask the user whether to force a fresh download. If confirmed, rerun the original command with `--force` to skip the interactive prompt. Do NOT use `--force` without user confirmation.
- **`image download` failure / timeout**: Do NOT auto-retry. Ask the user to install `devecocli` first, then give them the command to run manually in their terminal.
- **`emulator create` timeout**: Treat as user-action step. Ask user to open DevEco Studio -> Device Manager. Check `emulator list` after user confirms. Do NOT auto-retry or edit SDK files.
- **`image list` duplicate OS rows**: `phone`/`foldable`/`widefold`/`triplefold` share the same image. Download/remove ONCE per OS version.
