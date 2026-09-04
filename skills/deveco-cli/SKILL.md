---
name: deveco-cli
description: >-
  **REQUIRED** and **MANDATORY** if the process involves viewing connected devices and managing emulators (including starting/stopping emulators, creating/deleting emulator instances, downloading/deleting emulator images) and generate HarmonyOS signing materials, or if the user mentions managing (add/remove) harmonyOS skill or UI inpection and operation.
---

# DevEco CLI

`devecocli` wraps DevEco Studio's `hvigor`, `ohpm`, `hdc`, emulator toolchain, and bundled skills installer. **Prefer `devecocli` over invoking underlying tools directly.**

Available commands: `build`, `check`, `run`, `update`, `device`, `emulator`, `ui`, `skills`, `log`, `create`, `init`, `serve`, `docs`, `signature`, `auth`.

### `devecocli emulator`
Manage local emulator instances and system images.
- **Studio requirement**: DevEco Studio `>= 6.1.0`.
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
- `create <name>` (Req: `--device-type`, `--os-version`): Create instance. Optional: `--force`.
- `delete <name>`: Delete instance.
- `image list`: List downloaded images. Opts: `--device-type <type>`, `--all`, `--format <table|json>`.
- `image download` / `image remove` (Req: `--device-type`, `--os-version`): Download/remove image. (Takes 30+ min, set long timeout).
*Device types*: `phone`, `foldable`, `widefold`, `triplefold`, `tablet`, `2in1`, `2in1 foldable`, `wearable`, `tv`.

### `devecocli ui`
Inspect UI on a connected physical device or running emulator.
- `screenshot`: Capture a screenshot from a physical device or running emulator. `--device <name|serial>` is optional when exactly one device is connected, and required when multiple devices are connected.
- Optional: `--display <displayId>`. Required: `--path <path>` (existing directory or PNG file path, including paths relative to the current directory; writable destination; no overwrite).
- Implementation uses `hdc shell snapshot_display` and `hdc file recv`; set `DEVECO_CLI_DEBUG=1` to inspect the actual `hdc` commands.
*Ex*: `devecocli ui screenshot --device Phone --path ./screenshots/phone.png`

### `devecocli device`
- `list`: Show active real devices and running emulators. Opt: `--format <table|json>` (default: `table`).
- `view`: Detailed info. Req `-t <name|serial>` on multi-device hosts. Opt: `--format <table|json>` (default: `table`).

### `devecocli signature generate` `[Outside sandbox]`
Auto-generate HarmonyOS signing materials (local p12/csr + cloud cert + test profile) and write signing config to `build-profile.json5`.
- **Prereq**: `devecocli auth login` first; run from a project directory (with `build-profile.json5`); a connected device or emulator is required for device registration.
- `--product <name>`: Product name for local p12/csr file naming (default: `default`).
- `--team-id <id>`: Specify the team-id (default: current user's id).
- `--force`: Force regenerate even if existing materials are valid.
- Generates under `~/.ohos/config/`: `.p12` keystore, `.csr`, downloaded `.cer` certificate, `.p7b` profile.
- Writes `signingConfigs` + `products` entries to `build-profile.json5` with encrypted key/store passwords (AES-128-GCM).
- Cloud cert name: `auto_debug_<teamId>.cer`. Local files: `<product>_<project>_<hash>=.{p12,csr,cer,p7b}`.
- Error handling (aligned with DevEco Studio JAR): 401→re-login, 403→no AGC permission, `205389872`→cert limit, `205389904`→not Harmony user, `205389938`→provision limit, invalid `.cer`→retry.
*Ex*: `devecocli signature generate --product default`


### `devecocli ui`
Inspect UI on a connected device. All subcommands accept `--device <name|serial>` (Req on multi-device hosts).

| Subcommand | Description | Key Options |
|---|---|---|
| `layout` | Dump ArkUI accessibility layout tree — **visible area only** (on-screen nodes) | `--id <id>`, `--window <windowId>`, `--all-windows`, `--depth <n>` (0=unlimited, 1=root only, 2=root+children), `--format default\|json`, `--mode full\|simplified` |
| `window list` | List active windows | `--format default\|json`, `--all` (include system windows) |
| `screenshot` | Capture a screenshot of the device screen | `--display <displayId>`, required `--path <path>` (existing directory or PNG file path; relative paths supported; writable destination; no overwrite) |
| `click [x] [y]` | Tap at the specified coordinates or node | `--id <id>` (auto-resolves to center), `--window <windowId>` (used with `--id`) |
| `doubleclick [x] [y]` | Double-tap at the specified coordinates or node | `--id <id>`, `--window <windowId>` |
| `longclick [x] [y]` | Long-press at the specified coordinates or node | `--id <id>`, `--window <windowId>` |
| `swipe <x1> <y1> <x2> <y2>` | Swipe from one point to another (precise coordinates, custom speed) | `--speed <n>` (200–40000, px/s) |
| `fling <x1> <y1> <x2> <y2>` | Fling from one point to another | `--speed <n>` (200–40000, px/s) |
| `drag <x1> <y1> <x2> <y2>` | Drag from one point to another | `--speed <n>` (200–40000, px/s) |
| `dircfling <direction>` | Quick directional fling (system default speed, ideal for scrolling) | `direction`: `up`, `down`, `left`, `right` |
| `text <text> [x] [y]` | Input text at a target location or the currently focused field | `--id <id>` (auto-resolves to center), `--window <windowId>` (used with `--id`) |

- **Coordinates vs `--id`**: Mutually exclusive. Provide either `x y` or `--id <id>`. For `text`, if neither is given, text goes to the currently focused field.
- **`--window`**: May only be used together with `--id`. Default is focused window. Secondary display operations via `--id` + `--window` are not supported.
- **`swipe` vs `dircfling`**: `swipe` requires exact start/end coordinates and supports `--speed`; `dircfling` only needs a direction (`up/down/left/right`) and uses system default speed (ideal for page/list scrolling).
- **Text encoding**: Special characters in `text` are Base64-encoded internally to safely pass through device shell.
- `--format json` pairs well with `jq`.
- `--mode full`: full layout tree, no filtering.
- `--mode simplified` (default): folds meaningless wrapper containers (non-root, no `id`, no text, not interactive) by lifting their surviving children up. `--depth` truncates after folding.

### `devecocli skills`
Manage HarmonyOS skills in AI agents/projects.
- `list [-l|--long]` / `find <keyword>`: List or search skills.
- `add (--all | --skill <name>) [--agent <a,b…>] [--project <path>] [--path <path>] [-f]`: Install.
- `remove --skill <name> [...]`: Uninstall.

### `devecocli check compat` `[Outside sandbox]`
Scan source code for breaking API changes between two SDK versions. Built on top of DevEco Studio's `arkanalyzer-apiscan` plugin.
- `versions`: List available target SDK versions. Opts: `--format <default|json>` (default: `default`).
- Default (no args): project-level scan.
- `--modules <m1> [m2...]`: Module-level scan.
- `<file1> [file2...]`: File-level scan (`.ets`/`.c`/`.cpp` only).
- `--source-version <v>` (Req) / `--target-version <v>` (Req): SDK version pair. Run `devecocli check compat versions` first; on zsh, **quote the value** (e.g. `"<source_version>"`, `"<target_version>"`).
- `--format <default|csv|json>` (default: `default`): Console output accepts `default` (text) or `json`; file output (via `--output-path`) accepts `default` (csv), `csv`, or `json`. `csv` requires `--output-path`.
- `--output-path <path>`: Directory (writes `apiChange-*.csv`/`apiChange-*.json`) or explicit file (extension must match `--format`).
- `--limit <n>` (default `100`): Max records shown on console when no `--output-path`.

Validation order: `files` + `--modules` mutually exclusive → `--source-version`/`--target-version` required → `csv` requires `--output-path` → project dir valid → modules exist → files exist + extension valid → versions in catalog + `target > source` → format/extension match → output target writable.

*Ex*: `devecocli check compat --source-version "<source_version>" --target-version "<target_version>" --output-path ./report`

## Troubleshooting

- **"Product / Build mode `<x>` not found"**: Check `build-profile.json5`.
- **"Multiple entry modules" / "No entry module"**: Pass `--modules` (build) or `--module` (run).
- **"No active devices" / "Multiple devices connected"**: Connect/start emulator. Pass `-t <serial>` (device view) or `--device <name|serial>` (run/log).
- **`error:install sign info inconsistent`**: Signing key changed. Run `devecocli run --uninstall` or `devecocli signature generate --force`.
- **`Not logged in. Run devecocli auth login first`**: Run `devecocli auth login` to authenticate.
- **`Provision number exceeds limit`**: Test provision quota is full. Delete old test provisions in DevEco Studio (Signing Configs) or AGC console, then retry `devecocli signature generate`.
- **`Invalid AccessToken. Sign in and try again`**: Token expired. Run `devecocli auth login` again.
- **`emulator start` / `image download` blocked on agreement**: User MUST accept agreements. Interactive: `devecocli emulator license` (requires TTY). Non-interactive (CI/scripts): `devecocli emulator license accept`. Agents cannot run the interactive form; suggest the user run it, or use `license accept` if a non-TTY flow is acceptable. Do not retry until accepted.
- **`image download` failure / timeout**: Do NOT auto-retry. Give the command to the user to run manually in their terminal.
- **`emulator create` timeout**: Treat as user-action step. Ask user to open DevEco Studio -> Device Manager. Check `emulator list` after user confirms. Do NOT auto-retry or edit SDK files.
- **`image list` duplicate OS rows**: `phone`/`foldable`/`widefold`/`triplefold` share the same image. Download/remove ONCE per OS version.
**`ui layout` missing expected node**: `layout` only returns on-screen nodes. The user must scroll the target into view on the device before retrying (no CLI input subcommands in this build).
