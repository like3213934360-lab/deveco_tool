import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { digest } from "../src/core/files.js";
import {
  publishCandidate,
  type GitHubApi,
} from "../scripts/lib/upstream-pr.js";
import {
  verifyCandidate,
  candidateSchema,
  type Mapping,
  type Source,
} from "../scripts/lib/upstream.js";

const source: Source = {
    id: "fixture",
    url: "https://example.invalid/source.git",
    ref: "refs/heads/main",
    commit: "a".repeat(40),
    tree: "b".repeat(40),
    version: "1",
    role: "resource_source",
    acceptance: "pending",
  },
  mapping: Mapping = { format: 1, rules: [] };
function report() {
  const value = {
    format: 1,
    source: source.id,
    url: source.url,
    base: { commit: source.commit, tree: source.tree },
    candidate: { commit: "c".repeat(40), tree: "d".repeat(40) },
    mapping_sha256: digest(mapping),
    changes: [
      {
        path: "rules/new.md",
        status: "added",
        before: null,
        after: {
          path: "rules/new.md",
          oid: "e".repeat(40),
          mode: "100644",
          type: "blob",
        },
        mapping: null,
        disposition: "unmapped",
        reason: "Requires review",
        targets: [],
        tests: [],
      },
    ],
    gate: "blocked_unmapped",
    required_tests: [],
    note: "Review required",
  };
  return candidateSchema.parse({ ...value, sha256: digest(value) });
}
class FakeApi implements GitHubApi {
  calls: { method: string; endpoint: string; body?: unknown }[] = [];
  branch?: string;
  report?: string;
  lostRef = false;
  lostPull = false;
  pulls: {
    number: number;
    html_url: string;
    state: "open" | "closed";
    draft: boolean;
    base: { ref: string };
  }[] = [];
  async request(method: "GET" | "POST", endpoint: string, body?: unknown) {
    this.calls.push({ method, endpoint, body });
    if (method === "GET") {
      if (endpoint.includes("/pulls?")) return this.pulls;
      if (endpoint.endsWith("/test/repo")) return { default_branch: "main" };
      if (endpoint.includes("/matching-refs/"))
        return this.branch
          ? [{ ref: this.branch, object: { sha: "4".repeat(40) } }]
          : [];
      if (endpoint.includes("/contents/"))
        return {
          type: "file",
          encoding: "base64",
          content: Buffer.from(this.report!).toString("base64"),
        };
      if (endpoint.includes("/git/ref/"))
        return {
          ref: `refs/heads/${decodeURIComponent(endpoint.split("/git/ref/heads/")[1]!)}`,
          object: { sha: "1".repeat(40) },
        };
      if (endpoint.includes("/git/commits/"))
        return { tree: { sha: "2".repeat(40) } };
    } else {
      if (endpoint.endsWith("/git/trees")) {
        const tree = z
          .object({
            base_tree: z.string(),
            tree: z.array(
              z.object({
                path: z.string(),
                content: z.string(),
                type: z.literal("blob"),
                mode: z.literal("100644"),
              }),
            ),
          })
          .parse(body);
        assert.equal(tree.base_tree, "2".repeat(40));
        assert.equal(tree.tree.length, 2);
        assert.ok(
          tree.tree.every((item) =>
            item.path.startsWith("provenance/upstream-candidates/fixture/"),
          ),
        );
        this.report = tree.tree.find((item) =>
          item.path.endsWith("candidate.json"),
        )?.content;
        return { sha: "3".repeat(40) };
      }
      if (endpoint.endsWith("/git/commits")) {
        assert.deepEqual(
          z.object({ parents: z.array(z.string()) }).parse(body).parents,
          ["1".repeat(40)],
        );
        return { sha: "4".repeat(40) };
      }
      if (endpoint.endsWith("/git/refs")) {
        this.branch = z.object({ ref: z.string() }).parse(body).ref;
        if (this.lostRef) {
          this.lostRef = false;
          throw new Error("Lost ref creation response");
        }
        return {};
      }
      if (endpoint.endsWith("/pulls")) {
        assert.equal(z.object({ draft: z.boolean() }).parse(body).draft, true);
        const pull = {
          number: 7,
          html_url: "https://github.com/test/repo/pull/7",
          state: "open" as const,
          draft: true,
          base: { ref: z.object({ base: z.string() }).parse(body).base },
        };
        this.pulls.push(pull);
        if (this.lostPull) {
          this.lostPull = false;
          throw new Error("Lost pull creation response");
        }
        return pull;
      }
    }
    throw new Error(`Unexpected request: ${method} ${endpoint}`);
  }
}

test("upstream drafts contain only pinned reports, preserve the base tree and deduplicate even closed proposals", async () => {
  const api = new FakeApi(),
    input = verifyCandidate(report(), source, mapping),
    first = await publishCandidate(api, "test/repo", input);
  assert.equal(first.draft, true);
  assert.equal(first.deduplicated, false);
  assert.match(first.branch, /^codex\/upstream-fixture-/);
  const writes = api.calls.filter((call) => call.method === "POST").length;
  assert.equal(
    (await publishCandidate(api, "test/repo", input)).deduplicated,
    true,
  );
  api.pulls[0]!.state = "closed";
  assert.equal(
    (await publishCandidate(api, "test/repo", input)).state,
    "closed",
  );
  assert.equal(
    api.calls.filter((call) => call.method === "POST").length,
    writes,
  );
  assert.equal(
    source.commit,
    "a".repeat(40),
    "Source lock must never be advanced by proposal creation",
  );
});

test("unknown ref and PR creation outcomes reconcile without replacing branches or publishing duplicate PRs", async () => {
  const api = new FakeApi(),
    input = report();
  api.lostRef = true;
  await assert.rejects(publishCandidate(api, "test/repo", input), /Lost ref/);
  assert.equal(api.pulls.length, 0);
  api.lostPull = true;
  await assert.rejects(publishCandidate(api, "test/repo", input), /Lost pull/);
  const result = await publishCandidate(api, "test/repo", input);
  assert.equal(result.deduplicated, true);
  assert.equal(api.pulls.length, 1);
  for (const endpoint of ["/git/trees", "/git/commits", "/git/refs", "/pulls"])
    assert.equal(
      api.calls.filter(
        (call) => call.method === "POST" && call.endpoint.endsWith(endpoint),
      ).length,
      1,
      endpoint,
    );
});

test("stale/tampered candidate inputs and conflicting branch content block writes", async () => {
  const input = report(),
    api = new FakeApi();
  assert.throws(
    () =>
      verifyCandidate(
        { ...input, gate: "requires_release_validation" },
        source,
        mapping,
      ),
    { code: "UPSTREAM_REPORT_CHANGED" },
  );
  assert.throws(
    () =>
      verifyCandidate(input, { ...source, commit: "1".repeat(40) }, mapping),
    { code: "UPSTREAM_REPORT_STALE" },
  );
  await assert.rejects(
    publishCandidate(api, "test/repo", { ...input, note: "edited" }),
    { code: "UPSTREAM_REPORT_CHANGED" },
  );
  assert.equal(api.calls.length, 0);
  api.lostRef = true;
  await assert.rejects(publishCandidate(api, "test/repo", input));
  api.report = "someone else's report";
  const writes = api.calls.filter((call) => call.method === "POST").length;
  await assert.rejects(publishCandidate(api, "test/repo", input), {
    code: "UPSTREAM_BRANCH_CONFLICT",
  });
  assert.equal(
    api.calls.filter((call) => call.method === "POST").length,
    writes,
  );
});

test("an explicit candidate base is used for its commit and PR and cannot deduplicate against a retargeted proposal", async () => {
  const api = new FakeApi(),
    input = report();
  const result = await publishCandidate(
    api,
    "test/repo",
    input,
    "codex/native-typescript-runtime",
  );
  assert.equal(result.base.ref, "codex/native-typescript-runtime");
  assert.ok(
    api.calls.some((call) =>
      call.endpoint.endsWith(
        "/git/ref/heads/codex%2Fnative-typescript-runtime",
      ),
    ),
  );
  const writes = api.calls.filter((call) => call.method === "POST").length;
  api.pulls[0]!.base.ref = "main";
  await assert.rejects(
    publishCandidate(
      api,
      "test/repo",
      input,
      "codex/native-typescript-runtime",
    ),
    { code: "UPSTREAM_BASE_CONFLICT" },
  );
  assert.equal(
    api.calls.filter((call) => call.method === "POST").length,
    writes,
  );
});

test("framework version upgrades are separated from official resource/protocol changes", async () => {
  const { upgradeScope } = await import("../scripts/lib/upgrade-scope.js");
  const old = { packages: { "node_modules/zod": { version: "4.4.3" } } },
    next = { packages: { "node_modules/zod": { version: "4.5.0" } } };
  assert.throws(
    () =>
      upgradeScope(
        old,
        next,
        ["package-lock.json", "resources/knowledge.json"],
        true,
      ),
    { code: "UPGRADE_SCOPE_MIXED" },
  );
  assert.equal(
    upgradeScope(old, next, ["package-lock.json"], true).framework_updates
      .length,
    1,
  );
  assert.equal(
    upgradeScope(old, old, ["provenance/upstream-lock.json"], true)
      .official_files.length,
    1,
  );
  assert.equal(
    upgradeScope({ packages: {} }, next, ["resources/knowledge.json"], false)
      .initial_migration,
    true,
  );
});
