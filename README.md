# deveco-mcp

A lean MCP server for HarmonyOS development. It lets any MCP host (Cursor, Claude Code, Codex, …) build, run, debug and verify HarmonyOS apps with the DevEco toolchain, and query HarmonyOS knowledge offline.

- **Covers upstream fully.** Every HarmonyOS tool in [deveco-code](https://gitcode.com/openharmony-sig/deveco-code) and every command in [deveco-cli](https://gitcode.com/openharmony-sig/deveco-cli) is mapped: 81/81 in `tools/upstream-sync.mjs`. It also adds asynchronous jobs with recovery, flow recording and replay, crash pattern matching, symbol-based LSP lookups, and knowledge packs that update independently of the server.
- **Light.** 4 runtime dependencies. No LangGraph, no native modules (uses the built-in `node:sqlite`). A single process with zero idle CPU. Language servers and the checker start on demand and shut down after 10 idle minutes.
- **Built for AI hosts.** 12 core tools named by intent. Responses are structured and bounded. Every error carries a `code`, a `category` and a fix `hint`. Long operations become jobs.

| Metric (M-series Mac, Node 24/26) | v1.0 | v0.4 |
| --- | --- | --- |
| MCP handshake | ~85 ms | 140–315 ms |
| Idle CPU | ≈0 (no timers or polling) | 8–12% observed in a long-running host |
| Idle RSS (fresh start) | ~65 MB | ~120 MB (≈260 MB after hours of use) |
| Build of this repo | ~30 ms (esbuild) | ~5 s (tsc, 350 files) |
| Runtime dependencies | 4 | 16 |
| Source lines (`src`) | ~5.7k | ~35k |
| Knowledge search | 3–20 ms | — |

## Install

```sh
git clone https://github.com/like3213934360-lab/deveco_tool.git && cd deveco_tool
npm ci && npm run build
```

Requires Node ≥ 22.18, plus DevEco Studio or the Command Line Tools. Devices are optional; they are needed for run/ui/device.

Add the server to your MCP host:

```json
{
  "mcpServers": {
    "deveco": {
      "command": "node",
      "args": ["/absolute/path/to/deveco_tool/dist/cli.js", "mcp"],
      "env": {
        "DEVECO_CONFIG": "/absolute/path/to/deveco-mcp.json",
        "DEVECO_TOOL_GROUPS": "core"
      }
    }
  }
}
```

`deveco-mcp.json` is optional. If you omit it, the server uses the default DevEco Studio location.

```json
{ "studio": "/Applications/DevEco-Studio.app" }
```

Other config keys:

| Key | Purpose |
| --- | --- |
| `clt` | Command Line Tools path; use instead of `studio` |
| `java_home` | JDK to use |
| `state_dir` | State location; default `~/.deveco-mcp` |
| `retention_days` | Default 7 |
| `max_jobs` | Default 200 |
| `max_artifact_mb` | Default 512 |
| `session_idle_minutes` | Default 10 |
| `kb_package` | npm package name of the knowledge pack |
| `npm_registry` | Registry used for knowledge pack updates |

`DEVECO_TOOL_GROUPS` accepts `core` (default), `sign`, `emulator`, `hot_reload`, or `all`.

Check the setup with `node dist/cli.js doctor [project]`, or call the `doctor` tool.

## Tools

| Tool | What it does |
| --- | --- |
| `doctor` | Checks toolchain, SDK, devices, project, knowledge pack and logins; every failed check comes with a fix |
| `project` | `info` / `create` (template, never overwrites) / `sync` / `build` (ArkTS preflight, then Hvigor; returns packages and structured errors with hints) / `clean` |
| `run` | `build_run` (build, install, launch, crash check, optional UI assert) / `deploy` / `launch` / `stop` / `uninstall` |
| `job` | `wait` / `status` / `list` / `cancel` / `resume` / `read` (line-paged logs with `grep`) |
| `code` | `check` (warm ArkTS static checker; `fix` applies safe auto-fixes) / `lint` / `api_scan` / `lsp`: hover, definition, implementation, references, symbols, workspace_symbols, diagnostics, completion, signature. Locate code by `symbol` plus a line hint instead of exact columns |
| `device` | `list` / `info` / `log` (filter by bundle, level or regex; `clear`) / read-only `shell` / `send` / `recv` |
| `ui` | `observe` (screenshot plus compact element list) / `screenshot` / `tree` / `find` / `act` (click, input with Chinese text support and replace-by-default, type, swipe, scroll, key) / `assert` / `record_start` / `record_stop` |
| `ui_flow` | Record reusable flows through `ui act`, save them with a final assert, and replay with variables and self-repair. Stored in `.arkpilot/flows`, compatible with v0.x |
| `diagnose` | `crash` (reads jscrash/cppcrash/appfreeze reports, extracts the signature and app frames, matches the fault-pattern library) / `build` |
| `knowledge` | Offline docs, ArkTS rules, error cases and runtime patterns: `search` / `read` (by `section`) / `catalog` / `status` / `update` / `rollback`; `source=cloud` queries CodeGenie online |
| `skills` | Built-in HarmonyOS skills: `list` / `read`, `export` as native `SKILL.md` for your host, `search` / `install` / `uninstall` from the OpenHarmony skill market |
| `auth` | Huawei browser login for `codegenie` (cloud knowledge) or `developer` (signing); `teams`; `import` v0.x credentials |
| `sign` *(group)* | `auto` (one-step debug signing for real devices: keystore, certificate, device registration, profile, and `signingConfigs` in the project) / `sign` / `verify` / AppGallery Connect certificates and devices |
| `emulator` *(group)* | `list` / `start` (waits for boot) / `stop` / `create` / `delete` / images / license / `scenario` (battery, GPS, sensors, rotation, fold, …) |
| `hot_reload` *(group)* | `apply` pushes ArkTS changes to the running app as an HQF quick fix in about 3 s with no restart; `reset` removes them |

The server also exposes MCP **Resources** (`deveco://skills/<name>`) and **Prompts**: `fix-build`, `debug-crash`, `implement-feature` (spec-driven: specify → plan → tasks → implement → verify), and `upgrade-sdk`.

## Knowledge packs

A knowledge pack is a `.tgz` containing three files:

- `manifest.json`
- `index.db` — an FTS5 index with a vocabulary table for Chinese query segmentation
- `docs.zip`

It combines Huawei's HarmonyOS docs (guides, API reference, best practices, FAQ, release notes; about 14.7k documents) with this repository's `knowledge/` directory (ArkTS rules, 31 compile-error cases, runtime crash patterns, skills).

- **Built-in:** the npm package `@deveco-mcp/kb` is an optional dependency, and `kb-dist/current` works for local development.
- **Update:** `knowledge action=update` runs as a job. It downloads from npm, verifies the sha512 integrity, extracts to a temporary directory, checks the schema, switches versions atomically, and keeps the previous version for `rollback`. `file=<path.tgz>` installs a local pack. `file=upstream` builds a fresh pack from Huawei's latest `@deveco-test/deveco-cli-knowledgebase`.
- **Build and publish:** `node dist/cli.js kb-build <upstream-package-dir> kb-dist --version x.y.z` writes an npm-publishable tarball. `doctor remote=true` shows whether a newer pack exists; packs are never downloaded automatically.

## Architecture

```text
src/
  cli.ts        entry: mcp | doctor | kb-build | kb-update
  mcp.ts        minimal MCP stdio JSON-RPC (tools, resources, prompts, cancellation)
  server.ts     tool registry wiring; JSON Schemas built lazily on first tools/list
  jobs.ts       job definitions (build, build_run, deploy, flow replay, kb update, auto sign)
  tools/        12 core + 3 optional tools (zod schemas; domains are imported lazily)
  domains/      project, device, ui, flows, code, diagnose, knowledge, kb-build, skills, auth, sign, emulator, hotreload, doctor, resources
  core/         config, toolchain, proc (process-tree kill), db (node:sqlite WAL), jobs, artifacts, sessions, lsp-client, errors, files
knowledge/      rules, error cases, runtime patterns, skills (sources for knowledge packs and resources)
templates/      project template
resources/      vendored arkts-check.cjs, hypium uitest agents, licenses
tools/          build.mjs, bench.mjs, upstream-sync.mjs, mcp-client.mjs
test/unit       offline tests (npm test); test/e2e: real SDK and device (npm run test:e2e)
```

Jobs replace LangGraph with a small durable step runner:

- Each step's output is persisted before the next step starts.
- Steps with side effects (install, signing) record an intent before running and a receipt after.
- If a crash happens between the two, the job goes to `needs_input` and is never replayed blindly.
- `job resume force=true` re-runs such a step after you have inspected it.
- Jobs owned by a process that died are marked `interrupted` on startup.

Retention is capped by age, job count and bytes, and cleanup runs after each job rather than on a timer.

## Development

```sh
npm run typecheck            # tsc on src/ only, incremental
npm run build                # esbuild bundle (~30 ms)
npm test                     # unit tests, no SDK needed
DEVECO_CONFIG=... E2E_TARGET=127.0.0.1:5555 npm run test:e2e   # real SDK + device/emulator
npm run bench                # handshake, idle CPU/RSS, tools/list size
node tools/upstream-sync.mjs # upstream alignment report (exit 1 on unmapped capabilities)
```

### Migrating from v0.x

v0.x is frozen at tag `v0.4-final`, and v1 does not read its state directory.

- **Flows:** `.arkpilot/flows` files keep working unchanged.
- **Logins:** run `auth action=import` (defaults to `~/.deveco-tool`).
- **Tool names:** these changed; the tool table above is the reference.

## License

MIT. Third-party notices: `NOTICE.deveco-cli`, `NOTICE.deveco-code`, `NOTICE.hypium`, `resources/licenses/`.
