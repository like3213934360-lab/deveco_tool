# Upstream update candidate: deveco-code

Base: b5911d2ad6daa66d4ca1bd673a9be260da19e1db
Candidate: 325aff05706b9b04a9816a987e9672dda991c630
Report SHA-256: a0c2a97d2e1cb1e6a11e0ef734d656ec461d69b75f0a0415815c16c4918eb6a0
Gate: requires_adapter_review

This draft requires adapter and workflow review before the source lock can change.

- modified: `.gitcode/scripts/gitcode-api.sh` — exclude (code-host-gitcode)
- modified: `.gitcode/workflows/auto-merge.yml` — exclude (code-host-gitcode)
- modified: `.gitcode/workflows/test.yml` — exclude (code-host-gitcode)
- modified: `CHANGELOG.md` — adapt (code-legal-CHANGELOG.md)
- modified: `install` — exclude (code-host-install)
- modified: `install.ps1` — exclude (code-host-install-ps1)
- modified: `packages/core/script/migration.ts` — exclude (code-host-packages)
- modified: `packages/core/src/database/schema.gen.ts` — exclude (code-host-packages)
- modified: `packages/core/test/database-migration.test.ts` — exclude (code-host-packages)
- modified: `packages/core/test/effect/cross-spawn-spawner.test.ts` — exclude (code-host-packages)
- modified: `packages/core/test/filesystem/search.test.ts` — exclude (code-host-packages)
- modified: `packages/core/test/npm.test.ts` — exclude (code-host-packages)
- modified: `packages/core/test/plugin/provider-azure.test.ts` — exclude (code-host-packages)
- modified: `packages/core/test/plugin/provider-cloudflare-workers-ai.test.ts` — exclude (code-host-packages)
- modified: `packages/core/test/plugin/provider-gitlab.test.ts` — exclude (code-host-packages)
- modified: `packages/core/test/plugin/provider-helper.ts` — exclude (code-host-packages)
- modified: `packages/core/test/public-opencode.test.ts` — exclude (code-host-packages)
- modified: `packages/core/test/session-runner.test.ts` — exclude (code-host-packages)
- modified: `packages/core/test/tool-edit.test.ts` — exclude (code-host-packages)
- modified: `packages/core/test/tool-read.test.ts` — exclude (code-host-packages)
- modified: `packages/core/test/tool-write.test.ts` — exclude (code-host-packages)
- modified: `packages/opencode/package.json` — exclude (code-host-packages)
- modified: `packages/opencode/resources/models.dev.json` — exclude (code-host-packages)
- modified: `packages/opencode/src/installation/index.ts` — exclude (code-host-packages)
- modified: `packages/opencode/src/plugin/deveco-models.ts` — exclude (code-host-packages)
- modified: `packages/opencode/src/plugin/index.ts` — exclude (code-host-packages)
- modified: `packages/opencode/src/provider/provider.ts` — exclude (code-host-packages)
- modified: `packages/opencode/src/session/prompt.ts` — exclude (code-host-packages)
- modified: `packages/opencode/src/tool/lib/deveco-cli.ts` — exclude (code-host-packages)
- modified: `packages/opencode/test/cli/cmd/tui.test.ts` — exclude (code-host-packages)
- modified: `packages/opencode/test/cli/help/help-snapshots.test.ts` — exclude (code-host-packages)
- modified: `packages/opencode/test/config/tui.test.ts` — exclude (code-host-packages)
- modified: `packages/opencode/test/installation/install-script.test.ts` — exclude (code-host-packages)
- added: `packages/opencode/test/installation/install-telemetry.test.ts` — exclude (code-host-packages)
- modified: `packages/opencode/test/installation/installation.test.ts` — exclude (code-host-packages)
- modified: `packages/opencode/test/lib/llm-server.ts` — exclude (code-host-packages)
- modified: `packages/opencode/test/plugin/deveco-models.test.ts` — exclude (code-host-packages)
- modified: `packages/opencode/test/preload.ts` — exclude (code-host-packages)
- modified: `packages/opencode/test/project/worktree-remove.test.ts` — exclude (code-host-packages)
- modified: `packages/opencode/test/project/worktree.test.ts` — exclude (code-host-packages)
- modified: `packages/opencode/test/server/httpapi-layer.ts` — exclude (code-host-packages)
- modified: `packages/opencode/test/server/httpapi-listen.test.ts` — exclude (code-host-packages)
- modified: `packages/opencode/test/server/httpapi-pty.test.ts` — exclude (code-host-packages)
- modified: `packages/opencode/test/server/httpapi-query-schema-drift.test.ts` — exclude (code-host-packages)
- modified: `packages/opencode/test/server/httpapi-schema-error-body.test.ts` — exclude (code-host-packages)
- modified: `packages/opencode/test/server/httpapi-sync.test.ts` — exclude (code-host-packages)
- modified: `packages/opencode/test/server/session-list.test.ts` — exclude (code-host-packages)
- modified: `packages/opencode/test/server/worktree-endpoint-repro.test.ts` — exclude (code-host-packages)
- modified: `packages/opencode/test/session/prompt.test.ts` — exclude (code-host-packages)
- modified: `packages/opencode/test/skill/discovery.test.ts` — exclude (code-host-packages)
- modified: `packages/opencode/test/skill/hdc.test.ts` — exclude (code-host-packages)
- modified: `packages/opencode/test/skill/index.test.ts` — exclude (code-host-packages)
- modified: `packages/opencode/test/tool/grep.test.ts` — exclude (code-host-packages)
- modified: `packages/opencode/test/tool/hdc_log.test.ts` — exclude (code-host-packages)
- modified: `packages/opencode/test/tool/lib/deveco-cli.test.ts` — exclude (code-host-packages)
- modified: `packages/opencode/test/tool/webfetch.test.ts` — exclude (code-host-packages)
- modified: `packages/tui/src/component/prompt/index.tsx` — exclude (code-host-packages)
- modified: `packages/tui/src/context/local.tsx` — exclude (code-host-packages)
- modified: `packages/tui/test/audio.test.ts` — exclude (code-host-packages)
- modified: `packages/tui/test/cli/cmd/tui/provider-options.test.ts` — exclude (code-host-packages)
- modified: `packages/tui/test/cli/cmd/tui/sync-fixture.tsx` — exclude (code-host-packages)
- modified: `packages/tui/test/cli/tui/__snapshots__/inline-tool-wrap-snapshot.test.tsx.snap` — exclude (code-host-packages)
- modified: `packages/tui/test/context/local.test.ts` — exclude (code-host-packages)
- modified: `packages/tui/test/fixture/tui-environment.tsx` — exclude (code-host-packages)
- modified: `packages/tui/test/runtime.test.tsx` — exclude (code-host-packages)
- modified: `turbo.json` — exclude (code-host-turbo-json)

Required validation:
- `test/native-upstream.test.ts`

Review steps:
1. Resolve every unmapped path with explicit targets or an exclusion reason.
2. Adapt affected rules, templates, workflows and SDK protocols; preserve source attribution.
3. Run the mapped regressions and the platform/performance release gates.
4. Review the candidate commit and content digests, then update the source lock in the reviewed change.
5. Publish a candidate release only after the complete release gate passes.
