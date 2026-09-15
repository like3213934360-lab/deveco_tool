# Upstream update candidate: deveco-code

Base: aeb4536e56d1bfe8b5a0ff3bb02acb99f3523f2a
Candidate: fc6488e277105f37ca9357028fba74521d6e514f
Report SHA-256: adecd1df951bd7059c88fd27b6c54d55ece1acc3d669ce865a3f7989d07a3028
Gate: requires_release_validation

This draft requires adapter and workflow review before the source lock can change.

- added: `.gitcode/workflows/publish-daily.yml` — exclude (code-host-gitcode)
- added: `packages/opencode/src/agent/rules.ts` — exclude (code-host-packages)
- added: `packages/opencode/src/agent/rules/common.txt` — exclude (code-host-packages)
- modified: `packages/opencode/src/session/llm/request.ts` — exclude (code-host-packages)
- added: `packages/opencode/test/agent/rules.test.ts` — exclude (code-host-packages)

Required validation:


Review steps:
1. Resolve every unmapped path with explicit targets or an exclusion reason.
2. Adapt affected rules, templates, workflows and SDK protocols; preserve source attribution.
3. Run the mapped regressions and the platform/performance release gates.
4. Review the candidate commit and content digests, then update the source lock in the reviewed change.
5. Publish a candidate release only after the complete release gate passes.
