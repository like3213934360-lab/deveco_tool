# Upstream update candidate: deveco-code

Base: aeb4536e56d1bfe8b5a0ff3bb02acb99f3523f2a
Candidate: 7b9b68c2f65e25d6a91f13d47d5b75622aacfe20
Report SHA-256: a18dbd6062f64d357e3b9e0b6d1bd05e8eb75b0171dde5e9b9ed5908fac851db
Gate: requires_release_validation

This draft requires adapter and workflow review before the source lock can change.

- added: `.gitcode/workflows/publish-daily.yml` — exclude (code-host-gitcode)

Required validation:


Review steps:
1. Resolve every unmapped path with explicit targets or an exclusion reason.
2. Adapt affected rules, templates, workflows and SDK protocols; preserve source attribution.
3. Run the mapped regressions and the platform/performance release gates.
4. Review the candidate commit and content digests, then update the source lock in the reviewed change.
5. Publish a candidate release only after the complete release gate passes.
