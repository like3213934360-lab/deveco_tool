# Upstream update candidate: deveco-code

Base: 325aff05706b9b04a9816a987e9672dda991c630
Candidate: e5bc1fa4b55d498119671ac1e1d1aaf59204dea5
Report SHA-256: 716064070bb2d654efbaf8f8e09d519dcdf489b26cebeda5ef5699126cdfc01f
Gate: requires_release_validation

This draft requires adapter and workflow review before the source lock can change.

- modified: `packages/opencode/src/plugin/analytics/uploader.ts` — exclude (code-host-packages)
- modified: `packages/opencode/test/plugin/analytics/uploader.test.ts` — exclude (code-host-packages)

Required validation:


Review steps:
1. Resolve every unmapped path with explicit targets or an exclusion reason.
2. Adapt affected rules, templates, workflows and SDK protocols; preserve source attribution.
3. Run the mapped regressions and the platform/performance release gates.
4. Review the candidate commit and content digests, then update the source lock in the reviewed change.
5. Publish a candidate release only after the complete release gate passes.
