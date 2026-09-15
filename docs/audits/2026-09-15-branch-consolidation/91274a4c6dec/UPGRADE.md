# Upstream update candidate: deveco-cli

Base: 08c2f57ffbe83c817d64a728a17971872dd9ddcf
Candidate: bd4c15f75ace80d4d5a476c8581beb89ba7cc1b3
Report SHA-256: 906da7f1eb97e83f8bc4f2590a7272df179b4ec42250c6953f52e872df7d49d4
Gate: blocked_unmapped

This draft requires adapter and workflow review before the source lock can change.

- modified: `README.md` — unmapped (unmapped)
- modified: `SKILL.md` — unmapped (unmapped)
- modified: `eslint.config.js` — unmapped (unmapped)
- added: `src/arktscheck/arkts-check-adapter.ts` — unmapped (unmapped)
- added: `src/arktscheck/arkts-check-command.ts` — unmapped (unmapped)
- added: `src/arktscheck/index.ts` — unmapped (unmapped)
- added: `src/arktscheck/types.ts` — unmapped (unmapped)
- modified: `src/commands/check.ts` — adapt (cli-command-check.ts)
- added: `src/resources/arkts-check.cjs` — adapt (cli-src-resources-)
- modified: `templates/application/gitignore.txt` — adapt (cli-templates-)

Required validation:
- `scripts/native-sdk-acceptance.ts`
- `test/native-checker.test.ts`
- `test/native-project.test.ts`

Review steps:
1. Resolve every unmapped path with explicit targets or an exclusion reason.
2. Adapt affected rules, templates, workflows and SDK protocols; preserve source attribution.
3. Run the mapped regressions and the platform/performance release gates.
4. Review the candidate commit and content digests, then update the source lock in the reviewed change.
5. Publish a candidate release only after the complete release gate passes.
