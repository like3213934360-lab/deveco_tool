# Upstream update candidate: deveco-cli

Base: a71f93d73941aaa0dbf581918cbd5828014e6e88
Candidate: 87c360b05848132c06c6ea120e078619b9ef4634
Report SHA-256: bd12c22ba9e5c352d385354c97552f86f60251eebbc0a4a6463b18b4bf93b15c
Gate: blocked_unmapped

This draft requires adapter and workflow review before the source lock can change.

- added: `.agents/skills/deveco-check-changes/SKILL.md` — unmapped (unmapped)
- added: `.agents/skills/deveco-code-review/SKILL.md` — unmapped (unmapped)
- added: `.agents/skills/deveco-docs-and-prose/SKILL.md` — unmapped (unmapped)
- added: `.agents/skills/deveco-find-simplifications/SKILL.md` — unmapped (unmapped)
- added: `.agents/skills/deveco-test-reliability/SKILL.md` — unmapped (unmapped)
- modified: `AGENTS.md` — unmapped (unmapped)
- modified: `README.md` — adapt (cli-readme)
- modified: `SKILL.md` — adapt (cli-skill-entry)
- modified: `src/apply/apply-manager.ts` — adapt (cli-src-apply-)
- modified: `src/commands/init.ts` — adapt (cli-command-init.ts)
- modified: `src/commands/run.ts` — adapt (cli-command-run.ts)
- modified: `src/commands/ui-screenshot.ts` — adapt (cli-command-ui-screenshot.ts)
- modified: `src/config/skills.ts` — adapt (cli-core-config)
- added: `src/smoke/index.ts` — unmapped (unmapped)
- added: `src/smoke/screen-phash.test.ts` — unmapped (unmapped)
- added: `src/smoke/screen-phash.ts` — unmapped (unmapped)
- added: `src/smoke/smoke-artifacts.test.ts` — unmapped (unmapped)
- added: `src/smoke/smoke-artifacts.ts` — unmapped (unmapped)
- added: `src/smoke/smoke-formatter.ts` — unmapped (unmapped)
- added: `src/smoke/smoke-inspector.test.ts` — unmapped (unmapped)
- added: `src/smoke/smoke-inspector.ts` — unmapped (unmapped)
- added: `src/smoke/smoke-judge.test.ts` — unmapped (unmapped)
- added: `src/smoke/smoke-judge.ts` — unmapped (unmapped)
- added: `src/smoke/smoke-run-store.test.ts` — unmapped (unmapped)
- added: `src/smoke/smoke-run-store.ts` — unmapped (unmapped)
- added: `src/smoke/smoke-verifier.ts` — unmapped (unmapped)
- added: `src/smoke/types.ts` — unmapped (unmapped)
- modified: `src/ui/index.ts` — adapt (cli-src-ui-)
- added: `src/ui/screenshot/hdc-snapshot.test.ts` — adapt (cli-src-ui-)
- added: `src/ui/screenshot/hdc-snapshot.ts` — adapt (cli-src-ui-)
- added: `src/ui/screenshot/screenshot-capturer.ts` — adapt (cli-src-ui-)
- added: `src/ui/screenshot/types.ts` — adapt (cli-src-ui-)
- modified: `src/utils/cmd.ts` — adapt (cli-core-utils)
- added: `src/utils/hdc-adapter.test.ts` — adapt (cli-core-utils)
- modified: `src/utils/hdc-adapter.ts` — adapt (cli-core-utils)
- added: `src/utils/hdc-param.test.ts` — adapt (cli-core-utils)
- modified: `src/utils/hdc-param.ts` — adapt (cli-core-utils)
- modified: `src/utils/hilog-adapter.ts` — adapt (cli-core-utils)

Required validation:
- `scripts/native-device-readonly.ts`
- `scripts/native-hot-device-acceptance.ts`
- `scripts/native-multimodule-acceptance.ts`
- `scripts/native-skill-mcp-acceptance.ts`
- `scripts/native-ui-mcp-benchmark.ts`
- `test/native-context.test.ts`
- `test/native-flow.test.ts`
- `test/native-hotreload.test.ts`
- `test/native-infrastructure.test.ts`
- `test/native-project-recovery.test.ts`
- `test/native-project.test.ts`
- `test/native-runtime.test.ts`
- `test/native-skills.test.ts`
- `test/native-text.test.ts`
- `test/native-toolchain.test.ts`
- `test/native-ui-import.test.ts`

Review steps:
1. Resolve every unmapped path with explicit targets or an exclusion reason.
2. Adapt affected rules, templates, workflows and SDK protocols; preserve source attribution.
3. Run the mapped regressions and the platform/performance release gates.
4. Review the candidate commit and content digests, then update the source lock in the reviewed change.
5. Publish a candidate release only after the complete release gate passes.
