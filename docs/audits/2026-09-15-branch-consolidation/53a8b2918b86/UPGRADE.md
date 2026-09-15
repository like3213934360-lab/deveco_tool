# Upstream update candidate: deveco-cli

Base: 08c2f57ffbe83c817d64a728a17971872dd9ddcf
Candidate: a71f93d73941aaa0dbf581918cbd5828014e6e88
Report SHA-256: 7f2befb4c52e5334c3b284c339d218ec2a109b02875c24b45a36994f61ba62a3
Gate: blocked_unmapped

This draft requires adapter and workflow review before the source lock can change.

- modified: `README.md` — unmapped (unmapped)
- modified: `SKILL.md` — unmapped (unmapped)
- modified: `eslint.config.js` — unmapped (unmapped)
- modified: `mcp/src-server/lsp/core/ClientMessageHandle.ts` — exclude (cli-retired-mcp-)
- added: `src/arktscheck/arkts-check-adapter.ts` — unmapped (unmapped)
- added: `src/arktscheck/arkts-check-command.ts` — unmapped (unmapped)
- added: `src/arktscheck/index.ts` — unmapped (unmapped)
- added: `src/arktscheck/types.ts` — unmapped (unmapped)
- modified: `src/cli.ts` — adapt (cli-release-src/cli.ts)
- modified: `src/commands/check.ts` — adapt (cli-command-check.ts)
- added: `src/resources/arkts-check.cjs` — adapt (cli-src-resources-)
- modified: `templates/application/gitignore.txt` — adapt (cli-templates-)

Required validation:
- `scripts/native-sdk-acceptance.ts`
- `test/native-checker.test.ts`
- `test/native-project.test.ts`
- `test/native-upstream.test.ts`

Review steps:
1. Resolve every unmapped path with explicit targets or an exclusion reason.
2. Adapt affected rules, templates, workflows and SDK protocols; preserve source attribution.
3. Run the mapped regressions and the platform/performance release gates.
4. Review the candidate commit and content digests, then update the source lock in the reviewed change.
5. Publish a candidate release only after the complete release gate passes.
