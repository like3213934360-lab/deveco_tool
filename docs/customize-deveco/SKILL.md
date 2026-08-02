---
name: customize-deveco
description: "Use ONLY when the user is editing or creating DevEco Code's own configuration: deveco.json, deveco.jsonc, files under .deveco/, or files under ~/.config/deveco/. Also use when creating or fixing DevEco Code agents, subagents, commands, skills, plugins, MCP servers, or permission rules. Do not use for the user's own application code, or for any project that is not configuring DevEco Code itself."
---

# Customizing DevEco Code

DevEco Code validates its own config strictly and refuses to start when a field
is wrong. The shapes below cover the common surface area, but they are a
**summary, not the source of truth**.

## Full schema reference

The authoritative list of every config option — with field types, enums,
defaults, and descriptions — lives in the published JSON Schema:

**<https://opencode.ai/config.json>**

If a field is not documented in this skill, or you need to confirm an exact
shape before writing config, **fetch that URL and read the schema directly**
rather than guessing. DevEco Code hard-fails on invalid config, so the cost of a
wrong shape is a broken startup.

Independently, every `deveco.json` should declare
`"$schema": "https://opencode.ai/config.json"` so the user's editor catches
mistakes as they type.

## Applying changes

Config is loaded once when DevEco Code starts and is not hot-reloaded. After
saving changes to `deveco.json`, an agent file, a skill, a plugin, or any
other config-time file, **tell the user to quit and restart DevEco Code** for
the changes to take effect. The running session will keep using the
already-loaded config until then.

## Where files live

| Scope                         | Path                                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Project config                | `./deveco.json`, `./deveco.jsonc`, or `.deveco/deveco.json` (DevEco Code walks up from the cwd to the worktree root) |
| Global config                 | `~/.config/deveco/deveco.json` (NOT `~/.deveco/`)                                                                   |
| Project agents                | `.deveco/agent/<name>.md` or `.deveco/agents/<name>.md`                                                               |
| Global agents                 | `~/.config/deveco/agent(s)/<name>.md`                                                                                   |
| Project commands              | `.deveco/command/<name>.md` or `.deveco/commands/<name>.md`                                                           |
| Global commands               | `~/.config/deveco/command(s)/<name>.md`                                                                                 |
| Project skills                | `.deveco/skill(s)/<name>/SKILL.md`                                                                                      |
| Global skills                 | `~/.config/deveco/skill(s)/<name>/SKILL.md`                                                                             |
| Project tools                 | `.deveco/tool/<name>.ts`                                                                                                |
| Project plugins               | `.deveco/plugin(s)/*.{ts,js}` (auto-discovered)                                                                        |
| Project themes                | `.deveco/themes/<name>.json`                                                                                            |
| External skills (auto-loaded) | `~/.claude/skills/<name>/SKILL.md`, `~/.agents/skills/<name>/SKILL.md`                                                    |

Configs from each scope are deep-merged. Project overrides global. Unknown
top-level keys in `deveco.json` are rejected with `ConfigInvalidError`.

## deveco.json

Every field is optional. Below is a real-world example from this codebase:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",

  // Default agent when starting a session
  "default_agent": "harmony-build",

  // Custom agents (keyed by agent name)
  "agent": {
    "harmony-build": {
      "description": "Primary HarmonyOS build and delivery agent",
      "mode": "primary",
      "color": "#4DA3FF"
    },
    "harmony-auto-debug": {
      "description": "Runtime evidence debugging agent for HarmonyOS",
      "mode": "primary",
      "color": "#FF8A4D"
    },
    "harmonyos-expert": {
      "description": "Read-only HarmonyOS documentation specialist",
      "mode": "subagent",
      "color": "#5AC88C"
    }
  },

  // Additional instruction files loaded into system context
  "instructions": [
    "kb/arkts-guidelines.md",
    "kb/harmony-api-cheatsheet.md"
  ],

  // Named references for @ autocomplete
  "references": {
    "effect": {
      "repository": "github.com/Effect-TS/effect-smol",
      "description": "Use for Effect v4 and effect-smol implementation details"
    },
    "deveco-local": {
      "path": "~/.local/share/deveco",
      "description": "Contains DevEco Code logs and data"
    }
  },

  // MCP servers
  "mcp": {
    "deveco-mcp-server": {
      "type": "local",
      "command": ["deveco-mcp-server"]
    }
  },

  // Permissions
  "permission": {
    "edit": {
      "packages/deveco/migration/*": "deny"
    }
  },

  // Enable/disable specific tools
  "tools": {
    "github-triage": false,
    "github-pr-search": false
  },

  // Plugin specs (npm packages or file paths)
  "plugin": ["../dist/index.js"],

  // Provider and model overrides
  "provider": {
    "deveco": { "options": {} }
  },
  "model": "anthropic/claude-sonnet-4-6",
  "small_model": "anthropic/claude-haiku-4-5",

  // Other optional fields
  "username": "string",
  "shell": "/bin/zsh",
  "logLevel": "DEBUG" | "INFO" | "WARN" | "ERROR",
  "share": "manual" | "auto" | "disabled",
  "autoupdate": true | false | "notify",
  "snapshot": true,
  "formatter": false,
  "lsp": false,

  "skills": {
    "paths": [".deveco/skills", "/abs/path/to/skills"],
    "urls": ["https://example.com/.well-known/skills/"]
  },

  "disabled_providers": ["openai"],
  "enabled_providers": ["anthropic"],

  "tool_output": { "max_lines": 200, "max_bytes": 8192 },
  "compaction": { "auto": true, "tail_turns": 15 },

  "experimental": {
    "primary_tools": ["edit"],
    "mcp_timeout": 30000,
    "batch_tool": true
  }
}
```

Shape notes worth being explicit about:

- `model` always carries a provider prefix: `"anthropic/claude-sonnet-4-6"`.
- `skills` is an object with `paths` and/or `urls`, not an array.
- `references` is an object keyed by alias. Each value is a local path, Git repository, or string shorthand.
- `agent` is an object keyed by agent name, not an array.
- `command` is an object keyed by command name, not an array.
- `plugin` is an array of strings or `[name, options]` tuples, not an object.
- `mcp[name].command` is an array of strings, never a single string. `type` is required.
- `permission` is either a string action or an object keyed by tool name.
- `tools` is an object mapping tool names to booleans (converted to permissions internally).

## Skills

DevEco Code's skill loader scans for `**/SKILL.md` inside skill directories. The
file is named `SKILL.md` exactly, and lives in its own folder named after the
skill:

```
.deveco/skills/my-skill/SKILL.md
```

Frontmatter:

```markdown
---
name: my-skill
description: One sentence covering what this skill does AND when to trigger it. Front-load the literal keywords or filenames the user is likely to say.
---

# My Skill

(skill body in markdown: instructions, examples, references)
```

- `name` is required, lowercase hyphen-separated, up to 64 chars, and matches the folder name.
- `description` is effectively required: skills without one are filtered out and never surfaced to the model. Cover both _what_ the skill does and _when_ to use it. Write in third person ("Use when...", not "I help with..."). Front-load concrete trigger keywords and filenames; gate with "Use ONLY when..." if the skill should stay quiet on adjacent topics.
- Optional: `license`, `compatibility`, `metadata` (string-string map).

Register skills from non-default locations via `skills.paths` (scanned
recursively for `**/SKILL.md`) and `skills.urls` (each URL serves a list of
skills).

### Real example: Effect skill

```
.deveco/skills/effect/SKILL.md
```

```markdown
---
name: effect
description: Work with Effect v4 / effect-smol TypeScript code in this repo
---

# Effect Guidelines
- Use Effect.gen for sequential workflows
- Use Effect.fn for named, traceable functions
- Use Schema.Class for validated data types
...
```

## References

References make local directories and Git repositories outside the active
project available as supporting context. Configure them under `references`,
keyed by the alias used in `@` autocomplete:

```jsonc
{
  "references": {
    "docs": {
      "path": "../product-docs",
      "description": "Use for product behavior and terminology"
    },
    "effect": {
      "repository": "github.com/Effect-TS/effect-smol",
      "description": "Use for Effect v4 and effect-smol implementation details"
    }
  }
}
```

Local `path` values may be relative to the declaring config, absolute, or use
`~/`. Git `repository` values accept Git URLs, host/path references, and GitHub
`owner/repo` shorthand; `branch` is optional. Both forms support optional
`description` and `hidden` fields.

- Only references with a `description` are advertised to agents in system context.
- `hidden: true` removes a reference from TUI `@` autocomplete only. It remains available to agents and by direct path.
- Reference directories are automatically allowed through the external-directory boundary; normal read/edit/tool permissions still apply.
- String shorthand is supported: use `"docs": "../docs"` for local paths or `"effect": "Effect-TS/effect"` for Git repositories.

## Agents

Two ways to define an agent. Use the file form for anything non-trivial.

### Inline (in `deveco.json`)

```jsonc
{
  "agent": {
    "harmony-build": {
      "description": "Primary HarmonyOS build and delivery agent",
      "mode": "primary",
      "color": "#4DA3FF"
    },
    "harmonyos-expert": {
      "description": "Read-only HarmonyOS documentation specialist",
      "mode": "subagent",
      "color": "#5AC88C"
    }
  }
}
```

### File

```
.deveco/agent/triage.md
```

```markdown
---
mode: primary
hidden: true
model: deveco/gpt-5.4-mini
color: "#44BA81"
tools:
  "*": false
  "github-triage": true
---

You are a GitHub issue triage specialist. Assign issues to the
correct team based on the affected component...
```

The file body becomes the agent's `prompt`. Do not also put `prompt:` in the
frontmatter.

`mode` is one of `"primary"`, `"subagent"`, `"all"`.

Allowed top-level frontmatter fields: `name, model, variant, description, mode,
hidden, color, steps, options, permission, disable, temperature, top_p, tools`. Any
unknown field is silently routed into `options`.

To disable a built-in agent: `agent: { build: { disable: true } }`, or in a
file, `disable: true` in frontmatter.

`default_agent` must point to a non-hidden, primary-mode agent.

### Built-in agents

DevEco Code ships with 5 user-facing agents and 6 hidden internal agents. To override a built-in's fields, define the same key in `agent: { <name>: { ... } }`.

| Agent ID             | Mode       | Hidden | Description                                                      |
| -------------------- | ---------- | ------ | ---------------------------------------------------------------- |
| `build`              | `primary`  | No     | Default agent. Executes tools based on configured permissions.   |
| `goal`               | `primary`  | No     | Multi-turn goal-driven agent with verifiable termination.        |
| `plan`               | `primary`  | No     | Plan mode. Disallows all edit tools.                             |
| `general`            | `subagent` | No     | General-purpose research and parallel task execution.            |
| `explore`            | `subagent` | No     | Fast read-only codebase search specialist.                       |
| `debug`              | `primary`  | Yes    | Sticky ArkTS debugging mode triggered by `/debug`.               |
| `spec-implementation`| `subagent` | Yes    | Execute implementation tasks from an approved spec.              |
| `spec-verify`        | `subagent` | Yes    | Build, deploy, and UI-verify Harmony features against spec.      |
| `compaction`         | `primary`  | Yes    | Context summarization assistant.                                 |
| `title`              | `primary`  | Yes    | Thread title generator (≤50 chars).                              |
| `summary`            | `primary`  | Yes    | PR-description-style conversation summarizer.                    |

Key permission differences:

- **`build`**: Full tool access. `question: allow`, `plan_enter: ask`, `verify_ui/save_ui_screenshot/get_ui_verification_log: ask`.
- **`goal`**: `question/plan_enter/webfetch/websearch/todowrite/spec_write/task: allow`.
- **`plan`**: `edit: deny *`, `bash: deny`, `plan_exit/plan_write: allow`. Only plan files under `.deveco/plans/` are editable.
- **`general`**: Same as build but `todowrite: deny`.
- **`explore`**: Read-only — `glob/grep/read/webfetch/websearch: allow`, all others denied.
- **`debug`**: `question/todowrite/arkts_knowledge_search/check_ets_files/build_project/start_app/hdc_log/debug_exit: allow`.

All agents share base permissions: `external_directory: ask *`, `read: allow *` (except `*.env*` which requires `ask`).

## Commands

DevEco Code's command loader scans for `**/*.md` inside command directories. The
file is named after the command, and lives directly inside the `command` folder:

```
.deveco/command/deploy.md
```

Frontmatter:

```markdown
---
description: One sentence describing what the command does.
agent: build
model: anthropic/claude-sonnet-4-6
---

(command body in markdown: the prompt DevEco Code runs, with $ARGUMENTS for the user's input)
```

- `template` is the command body — everything below the frontmatter — and is required: it is the prompt DevEco Code runs when the command is invoked. Do not also put a `template:` key in the frontmatter.
- `$ARGUMENTS` is replaced with everything the user typed after the command; `$1`, `$2`, … pull individual positional arguments.
- Optional: `description`, `agent`, `model`, `variant`, `subtask`.

### Real examples from this codebase

**`changelog.md`** — uses shell interpolation to generate changelogs:
```markdown
---
model: deveco/gpt-5.4
---

Generate a changelog from the following raw output:

!`bun script/raw-changelog.ts $ARGUMENTS`
```

**`commit.md`** — uses shell interpolation with git commands:
```markdown
---
description: Generate a commit message for staged changes
model: deveco/kimi-k2.5
subtask: true
---

Generate a commit message for the following changes:

!`git diff`
!`git diff --cached`
!`git status --short`
```

**`translate.md`** — uses file references and a specific model:
```markdown
---
description: Translate git diff changes
model: deveco/claude-opus-4-8
---

Translate the following diff using the glossary at
@.deveco/glossary/$ARGUMENTS.md
```

## Plugins

`plugin:` is an array. Each entry is one of:

```jsonc
"plugin": [
  "deveco-gemini-auth",            // npm spec, latest
  "deveco-foo@1.2.3",              // npm spec, pinned
  "./local-plugin.ts",               // file path, relative to the declaring config
  "file:///abs/path/plugin.js",      // file URL
  ["deveco-bar", { "key": "val" }] // tuple form with options
]
```

Auto-discovered plugins (no config entry needed): any `*.ts` or `*.js` file in
`.deveco/plugin/` or `.deveco/plugins/`.

A plugin module exports `default` (or any named export) of type
`Plugin = (input: PluginInput, options?) => Promise<Hooks>`. The export is a
function, not a plain object literal, and the function returns an object
(return `{}` if there is nothing to register).

```ts
import type { Plugin } from "@deveco-ai/plugin"

export default (async ({ client, project, directory, $ }) => {
  return {
    config: (cfg) => {
      // cfg is the live merged config; mutate fields here.
    },
    "tool.execute.before": async (input, output) => {
      // mutate output.args before the tool runs
    },
  }
}) satisfies Plugin
```

Hook surface (mutate `output` in place; return `void`):

- `event(input)`: every bus event
- `config(cfg)`: once on init with the merged config
- `chat.message`, `chat.params`, `chat.headers`
- `tool.execute.before`, `tool.execute.after`
- `tool.definition`
- `command.execute.before`
- `shell.env`
- `permission.ask`
- `experimental.chat.messages.transform`, `experimental.chat.system.transform`,
  `experimental.session.compacting`, `experimental.compaction.autocontinue`,
  `experimental.text.complete`

Special object-shaped (not callbacks): `tool: { my_tool: { ... } }`,
`auth: { ... }`, `provider: { ... }`.

## MCP servers

`mcp:` is an object keyed by server name. Each server is discriminated by
`type`:

```jsonc
{
  "mcp": {
    "deveco-mcp-server": {
      "type": "local",
      "command": ["deveco-mcp-server"]
    },
    "playwright": {
      "type": "local",
      "command": ["npx", "-y", "@playwright/mcp"],
      "enabled": true,
      "environment": { "BROWSER": "chromium" }
    },
    "github": {
      "type": "remote",
      "url": "https://...",
      "enabled": true,
      "headers": { "Authorization": "Bearer {env:GITHUB_TOKEN}" }
    },
    "old-server": { "enabled": false }
  }
}
```

Local MCP fields: `type` (required, `"local"`), `command` (required, array of
strings), `cwd`, `environment` (env vars), `enabled`, `timeout` (ms, default 5000).

Remote MCP fields: `type` (required, `"remote"`), `url` (required), `headers`,
`oauth` (`{ clientId, clientSecret, scope, callbackPort, redirectUri }`),
`enabled`, `timeout`.

Use `enabled: false` to disable a server inherited from a parent config. String
values such as header tokens support `{env:VAR}` interpolation (and `{file:path}`);
the shell-style `${VAR}` is not substituted.

## Permissions

```jsonc
"permission": {
  "edit": {
    "packages/deveco/migration/*": "deny",
    "*.env": "ask",
    "*": "allow"
  },
  "bash": { "git *": "allow", "rm *": "deny", "*": "ask" },
  "external_directory": { "~/secrets/**": "deny", "*": "allow" }
}
```

Actions: `"allow"`, `"ask"`, `"deny"`.

Per-tool value forms: `"allow"` shorthand (treated as `{"*": "allow"}`), or an
object `{ pattern: action }`. Within an object, **insertion order matters**.
DevEco Code evaluates the LAST matching rule, so put broad rules first and narrow
rules last.

`permission: "allow"` (a string at the top level) is shorthand for "allow
everything" and is rarely what the user wants.

Known permission keys: `read, edit, glob, grep, list, bash, task,
external_directory, todowrite, question, webfetch, websearch, lsp, doom_loop,
skill`. Some of these (`todowrite, question, webfetch, websearch, doom_loop`)
only accept a flat action, not a per-pattern object.

`external_directory` patterns are filesystem paths (use `~/`, absolute paths,
or globs like `~/projects/**`).

Per-agent `permission:` overrides top-level `permission:`. Plan Mode lives on
the `plan` agent's permission ruleset (`edit: deny *`).

## Tools

Custom tools can be defined as TypeScript files in `.deveco/tool/`:

```
.deveco/tool/github-triage.ts
```

Tools can be enabled/disabled in `deveco.json`:

```jsonc
{
  "tools": {
    "github-triage": false,
    "github-pr-search": false
  }
}
```

This is converted to permission rules internally. Setting a tool to `false`
denies the corresponding permission.

## Escape hatches

When a user's config is broken and DevEco Code won't start, these env vars help:

- `DEVECO_DISABLE_PROJECT_CONFIG=1`: skip the project's local `deveco.json`
  and start from globals only. Run from the project directory, DevEco Code loads,
  the user edits the broken file, then they restart without the flag.
- `DEVECO_CONFIG=/path/to/file.json`: load an additional explicit config.
- `DEVECO_CONFIG_CONTENT='{"$schema":"https://opencode.ai/config.json"}'`:
  inject inline JSON as a final local-scope merge.
- `DEVECO_CONFIG=/path/to/file.json`: load a custom config file.
- `DEVECO_CONFIG_DIR=/path/to/dir`: load configs from a custom directory.
- `DEVECO_DISABLE_DEFAULT_PLUGINS=1`: skip default plugins.
- `DEVECO_PURE=1`: skip external plugins entirely.
- `DEVECO_DISABLE_EXTERNAL_SKILLS=1`,
  `DEVECO_DISABLE_CLAUDE_CODE_SKILLS=1`: skip the external skill scans under
  `~/.claude/` and `~/.agents/`.

## When proposing edits

- Validate against the schema before writing. If you are unsure of a field's
  exact shape, or the field is not covered in this skill, fetch
  `https://opencode.ai/config.json` and read the schema rather than guessing.
- Preserve `$schema` and any existing fields the user did not ask to change.
- For agent, command, skill, and plugin definitions, prefer creating new files
  in the correct location over inlining everything in `deveco.json`.
- If the user's existing config is malformed, point them at the env-var escape
  hatches above so they can edit from inside DevEco Code without breaking their
  session.
- After saving any config change, remind the user to quit and restart DevEco Code
  — running sessions keep using the already-loaded config.
