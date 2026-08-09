---
name: deveco-cli
description: >-
  **REQUIRED** and **MANDATORY** if the process involves viewing connected devices and managing emulators (including starting/stopping emulators, creating/deleting emulator instances, downloading/deleting emulator images), generating HarmonyOS signing materials, or inspecting and operating device UI; or if the user mentions viewing offline HarmonyOS documentation or managing (add/remove) harmonyOS skill.
---

# DevEco CLI

`devecocli` wraps DevEco Studio's `hvigor`, `ohpm`, `hdc`, emulator toolchain, and HarmonyOS-skills installer. **Prefer `devecocli` over invoking underlying tools directly.**

Available commands: `build`, `check`, `run`, `update`, `device`, `emulator`, `ui`, `skills`, `log`, `create`, `init`, `serve`, `docs`, `signature`, `auth`.

### `devecocli emulator`
Manage local emulator instances and system images.
- `list`: Show instances (status, serial, device type). Opt: `--format <table|json>` (default: `table`).
- `start <names...>`: Start instances. Quote names with spaces. (See Troubleshooting if blocked).
- `stop <names...>`: Stop by name or serial (`127.0.0.1:<port>`).
- Scene control commands require Emulator 7.0 or later. Use `DEVECO_CLI_DEBUG=1` to inspect the underlying `Emulator` command mapping.
- `shake` / `power` / `rotate <left|right>` / `volume <up|down>` (Req: `--target <nameOrSerial>`): Basic emulator controls.
- `fold <state>` (Req: `--target <nameOrSerial>`): Set foldable display state, matched against the target emulator's reported `deviceType`. `foldable` uses `open|half-open|close`; `2in1_foldable` uses `open|vertical-open|half-open|close`; `triplefold` uses `single|double|triple` or one of its six left/right folded-state combinations. Other device types and cross-device states are rejected before execution.
- `battery` (Req: `--target`; one of `--level <0-100>` or `--status <charging|discharging>`): Set battery state. `--level` checks the current emulator charging state automatically (`0-100` while charging, `1-100` otherwise).
- `geolocation` (Req: `--target`; one of `--longitude`, `--latitude`, `--altitude`, `--direction`): Inject GPS data.
- `scene <outdoorRunning|outdoorCycling|drivingNavigation>` (Req: `--target`): Start motion simulation.
- `sensor` (Req: `--target`; one of `--light-intensity`, `--humidity`, `--temperature`, `--steps`, `--heartrate`): Inject sensor data.
- `license`: Review and accept emulator license agreements interactively.
- `create <name>` (Req: `--device-type`, `--os-version`): Create instance. Optional: `--force`.
- `delete <name>`: Delete instance.
- `image list`: List downloaded images. Opts: `--device-type <type>`, `--all`, `--format <table|json>`.
- `image download` / `image remove` (Req: `--device-type`, `--os-version`): Download/remove image. (Takes 30+ min, set long timeout).
*Device types*: `phone`, `foldable`, `widefold`, `triplefold`, `tablet`, `2in1`, `2in1 foldable`, `wearable`, `tv`.

### `devecocli ui`
Inspect and interact with UI on a connected physical device or running emulator.
- `screenshot`: Capture a screenshot. `--device <name|serial>` is optional when exactly one device is connected, required when multiple are connected.
  - Optional: `--display <displayId>`. Required: `--path <path>` (existing directory or PNG file path, including paths relative to the current directory; writable destination; no overwrite).
  - Implementation uses `hdc shell snapshot_display` and `hdc file recv`; set `DEVECO_CLI_DEBUG=1` to inspect the actual `hdc` commands.
- `layout`: Inspect on-screen node(s) for UI testing.
- `window`: Manage device windows.
- `click [x] [y]` / `doubleclick` / `longclick`: Tap, double-tap, long-press at coordinates.
- `swipe <x1> <y1> <x2> <y2>` / `fling` / `drag`: Point-to-point gestures.
- `dircfling <direction>`: Fling in a direction.
- `text <text> [x] [y]`: Input text at a target location or the focused field.
*Ex*: `devecocli ui screenshot --device Phone --path ./screenshots/phone.png`

<!-- LOCAL PATCH: `ui` section synced from 0.2.0-release HEAD. Upstream documents only `screenshot`;
     the other ten subcommands (layout / window / click / doubleclick / longclick / swipe / fling /
     drag / dircfling / text) were added here after verifying them against the bundled
     @deveco/deveco-cli@1.2.1 via `devecocli ui --help`. The emulator scene-control commands above
     were likewise verified present in 1.2.1 before syncing. -->

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

<!-- LOCAL PATCH: selectively synced from 0.2.0-release. This section was taken because the bundled
     @deveco/deveco-cli@1.2.1 does have `signature`, and without it a debug build ends in
     "Will skip sign 'hos_hap'. No signingConfigs profile is configured" with nothing telling you
     what to do.

     Upstream also DELETES the `devecocli docs` and `devecocli skills` sections — NEITHER is taken.
     Verified against 1.2.1 with `devecocli --help`: both commands still ship, alongside `ui`,
     `check`, `signature` and `auth`. Upstream's own command list still names `docs` and `skills`;
     it dropped only their detail sections, which would make this file narrower than the actual
     tool. The command list above matches 1.2.1's 15 commands exactly. -->
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
