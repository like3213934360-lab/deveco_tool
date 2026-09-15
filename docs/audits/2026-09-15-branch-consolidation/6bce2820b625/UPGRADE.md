# Upstream update candidate: deveco-code

Base: 325aff05706b9b04a9816a987e9672dda991c630
Candidate: aeb4536e56d1bfe8b5a0ff3bb02acb99f3523f2a
Report SHA-256: a3736c50185c652b5f481cb31af9164d4a260be79b496279ad63966600de6694
Gate: blocked_unmapped

This draft requires adapter and workflow review before the source lock can change.

- modified: `.gitcode/workflows/build.yml` — exclude (code-host-gitcode)
- modified: `.gitcode/workflows/publish-tag.yml` — exclude (code-host-gitcode)
- modified: `.gitcode/workflows/publish.yml` — exclude (code-host-gitcode)
- modified: `.gitcode/workflows/test.yml` — exclude (code-host-gitcode)
- modified: `.gitcode/workflows/typecheck.yml` — exclude (code-host-gitcode)
- modified: `bun.lock` — adapt (code-legal-bun.lock)
- modified: `bunfig.toml` — unmapped (unmapped)
- modified: `package.json` — adapt (code-legal-package.json)
- modified: `packages/core/src/aisdk.ts` — exclude (code-host-packages)
- modified: `packages/opencode/src/plugin/analytics/uploader.ts` — exclude (code-host-packages)
- modified: `packages/opencode/src/provider/provider.ts` — exclude (code-host-packages)
- modified: `packages/opencode/test/plugin/analytics/uploader.test.ts` — exclude (code-host-packages)
- modified: `packages/opencode/test/server/httpapi-v2-pty.test.ts` — exclude (code-host-packages)
- deleted: `patches/@ff-labs%2Ffff-bun@0.9.3.patch` — exclude (code-host-patches)
- added: `patches/@ff-labs%2Ffff-bun@0.9.4.patch` — exclude (code-host-patches)
- added: `patches/bun-pty@0.4.8.patch` — exclude (code-host-patches)

Required validation:
- `test/native-upstream.test.ts`

Review steps:
1. Resolve every unmapped path with explicit targets or an exclusion reason.
2. Adapt affected rules, templates, workflows and SDK protocols; preserve source attribution.
3. Run the mapped regressions and the platform/performance release gates.
4. Review the candidate commit and content digests, then update the source lock in the reviewed change.
5. Publish a candidate release only after the complete release gate passes.
