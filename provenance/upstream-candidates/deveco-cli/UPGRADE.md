# Upstream update candidate: deveco-cli

Base: a71f93d73941aaa0dbf581918cbd5828014e6e88
Candidate: 28c79452f8c5666f6300a0a988e06b487cc7513c
Report SHA-256: 3c64d05a22559225dd48216160e925312264b14f567aa76b3cd3658058a6fe06
Gate: requires_adapter_review

This draft requires adapter and workflow review before the source lock can change.

- added: `.agents/skills/deveco-check-changes/SKILL.md` — exclude (cli-maintainer--agents-skills-deveco-check-changes-SKILL-md)
- added: `.agents/skills/deveco-code-review/SKILL.md` — exclude (cli-maintainer--agents-skills-deveco-code-review-SKILL-md)
- added: `.agents/skills/deveco-docs-and-prose/SKILL.md` — exclude (cli-maintainer--agents-skills-deveco-docs-and-prose-SKILL-md)
- added: `.agents/skills/deveco-find-simplifications/SKILL.md` — exclude (cli-maintainer--agents-skills-deveco-find-simplifications-SKILL-md)
- added: `.agents/skills/deveco-test-reliability/SKILL.md` — exclude (cli-maintainer--agents-skills-deveco-test-reliability-SKILL-md)
- modified: `AGENTS.md` — exclude (cli-maintainer-AGENTS-md)
- modified: `README.md` — adapt (cli-readme)
- modified: `SKILL.md` — adapt (cli-skill-entry)
- modified: `mcp/src-server/router.ts` — exclude (cli-retired-mcp-)
- modified: `mcp/src-server/server.ts` — exclude (cli-retired-mcp-)
- modified: `mcp/src-server/tools/arkts-check.ts` — exclude (cli-retired-mcp-)
- modified: `package-lock.json` — adapt (cli-release-package-lock.json)
- modified: `package.json` — adapt (cli-release-package.json)
- modified: `src/apply/apply-manager.ts` — adapt (cli-src-apply-)
- added: `src/auth/utils/jwt.test.ts` — adapt (cli-src-auth-)
- added: `src/codelinter/report-parser.test.ts` — adapt (cli-src-codelinter-)
- modified: `src/commands/emulator.ts` — adapt (cli-command-emulator.ts)
- modified: `src/commands/init.ts` — adapt (cli-command-init.ts)
- modified: `src/commands/run.ts` — adapt (cli-command-run.ts)
- modified: `src/commands/ui-screenshot.ts` — adapt (cli-command-ui-screenshot.ts)
- modified: `src/config/skills.ts` — adapt (cli-client-skill-config)
- added: `src/docs/doc-index/zip-integration.test.ts` — adapt (cli-src-docs-)
- added: `src/service/emulator-list-parse.test.ts` — adapt (cli-src-service-)
- modified: `src/service/emulator-manager.ts` — adapt (cli-src-service-)
- modified: `src/service/emulator-start-strategies.ts` — adapt (cli-src-service-)
- modified: `src/service/emulator-types.ts` — adapt (cli-src-service-)
- added: `src/skills/installer.test.ts` — adapt (cli-retired-src-skills-)
- added: `src/smoke/index.ts` — adapt (cli-startup-smoke)
- added: `src/smoke/screen-phash.test.ts` — adapt (cli-startup-smoke)
- added: `src/smoke/screen-phash.ts` — adapt (cli-startup-smoke)
- added: `src/smoke/smoke-artifacts.test.ts` — adapt (cli-startup-smoke)
- added: `src/smoke/smoke-artifacts.ts` — adapt (cli-startup-smoke)
- added: `src/smoke/smoke-formatter.ts` — adapt (cli-startup-smoke)
- added: `src/smoke/smoke-inspector.test.ts` — adapt (cli-startup-smoke)
- added: `src/smoke/smoke-inspector.ts` — adapt (cli-startup-smoke)
- added: `src/smoke/smoke-judge.test.ts` — adapt (cli-startup-smoke)
- added: `src/smoke/smoke-judge.ts` — adapt (cli-startup-smoke)
- added: `src/smoke/smoke-run-store.test.ts` — adapt (cli-startup-smoke)
- added: `src/smoke/smoke-run-store.ts` — adapt (cli-startup-smoke)
- added: `src/smoke/smoke-verifier.ts` — adapt (cli-startup-smoke)
- added: `src/smoke/types.ts` — adapt (cli-startup-smoke)
- modified: `src/ui/index.ts` — adapt (cli-shared-screenshot-exports)
- added: `src/ui/screenshot/hdc-snapshot.test.ts` — adapt (cli-shared-screenshot-directory)
- added: `src/ui/screenshot/hdc-snapshot.ts` — adapt (cli-shared-screenshot-directory)
- added: `src/ui/screenshot/screenshot-capturer.ts` — adapt (cli-shared-screenshot-directory)
- added: `src/ui/screenshot/types.ts` — adapt (cli-shared-screenshot-directory)
- modified: `src/utils/cmd.ts` — adapt (cli-startup-transport-cmd.ts)
- added: `src/utils/emulator-image-list-parse.test.ts` — adapt (cli-core-utils)
- modified: `src/utils/emulator-spawn.ts` — adapt (cli-core-utils)
- added: `src/utils/hdc-adapter.test.ts` — adapt (cli-startup-transport-hdc-adapter.test.ts)
- modified: `src/utils/hdc-adapter.ts` — adapt (cli-startup-transport-hdc-adapter.ts)
- added: `src/utils/hdc-param.test.ts` — adapt (cli-startup-transport-hdc-param.test.ts)
- modified: `src/utils/hdc-param.ts` — adapt (cli-startup-transport-hdc-param.ts)
- modified: `src/utils/hilog-adapter.ts` — adapt (cli-startup-transport-hilog-adapter.ts)

Required validation:
- `scripts/native-auth-mcp-acceptance.ts`
- `scripts/native-emulator-acceptance.ts`
- `scripts/native-emulator-readonly.ts`
- `scripts/native-hot-device-acceptance.ts`
- `scripts/native-hot-outcome-mcp-acceptance.ts`
- `scripts/native-lint-acceptance.ts`
- `scripts/native-multimodule-acceptance.ts`
- `scripts/native-skill-mcp-acceptance.ts`
- `scripts/native-startup-fault-mcp-acceptance.ts`
- `test/native-auth.test.ts`
- `test/native-compatible-upgrade.test.ts`
- `test/native-context.test.ts`
- `test/native-device-recovery.test.ts`
- `test/native-emulator-protocol.test.ts`
- `test/native-emulator.test.ts`
- `test/native-flow.test.ts`
- `test/native-hot-preparation.test.ts`
- `test/native-hotreload.test.ts`
- `test/native-infrastructure.test.ts`
- `test/native-lint.test.ts`
- `test/native-logs.test.ts`
- `test/native-project-recovery.test.ts`
- `test/native-reports.test.ts`
- `test/native-resources.test.ts`
- `test/native-runtime.test.ts`
- `test/native-screenshot.test.ts`
- `test/native-skills.test.ts`
- `test/native-startup-check.test.ts`
- `test/native-storage.test.ts`
- `test/native-toolchain.test.ts`
- `test/native-upstream-capabilities.test.ts`
- `test/native-upstream.test.ts`

Review steps:
1. Resolve every unmapped path with explicit targets or an exclusion reason.
2. Adapt affected rules, templates, workflows and SDK protocols; preserve source attribution.
3. Run the mapped regressions and the platform/performance release gates.
4. Review the candidate commit and content digests, then update the source lock in the reviewed change.
5. Publish a candidate release only after the complete release gate passes.
