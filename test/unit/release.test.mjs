import assert from "node:assert/strict";
import { test } from "node:test";
import { release, releaseNotes, newer, requiredJobs, validateCI } from "../../tools/release.mjs";

const head = "a".repeat(40), old = "b".repeat(40), repository = "owner/repo";
const run = { id: 1, repository: { full_name: repository }, path: ".github/workflows/ci.yml", event: "push", head_branch: "main", head_sha: head, status: "completed", conclusion: "success", html_url: "https://github.com/owner/repo/actions/runs/1" };
const jobs = () => ({ total_count: 7, jobs: requiredJobs.map((name) => ({ name, status: "completed", conclusion: "success" })) });
function fixture() {
  const f = { run: structuredClone(run), jobs: jobs(), dirty: "", tag: null, published: null, latest: { id: 10, tag_name: "v1.3.4" }, writes: [], files: [{ filename: "README.md" }], main: head };
  f.git = (...args) => {
    if (args[0] === "rev-parse") return head;
    if (args[0] === "status") return f.dirty;
    if (args[1] === `${head}:package.json`) return JSON.stringify({ version: "1.4.0" });
    if (args[1] === `${head}:package-lock.json`) return JSON.stringify({ version: "1.4.0", packages: { "": { version: "1.4.0" } } });
    if (args[1] === `${head}:CHANGELOG.md`) return "# Changelog\n\n## v1.4.0 (2026-10-10)\n\n- Real changes\n\n## v1.3.4\n\n- Previous release\n";
    if (args[1] === `${head}:docs/UPGRADE-1.4.0.md`) return "Acceptance evidence";
    throw Error(`Unexpected git ${args.join(" ")}`);
  };
  f.api = async (route, options = {}) => {
    assert.ok(route.startsWith(`repos/${repository}/`));
    route = route.slice(`repos/${repository}/`.length);
    if (options.method === "POST") {
      assert.equal(route, "releases"); f.writes.push(options.body);
      f.published = { id: 11, tag_name: "v1.4.0", draft: false, prerelease: false, html_url: "https://github.com/owner/repo/releases/tag/v1.4.0" };
      f.tag = head;
      if (!f.wrongLatest) f.latest = f.published;
      return f.published;
    }
    if (route === "git/ref/heads/main") return { object: { sha: f.main } };
    if (route === "actions/runs/1") return f.run;
    if (/^actions\/runs\/\d\/jobs\?/.test(route)) return f.jobs;
    if (route === "releases/tags/v1.4.0") return f.published;
    if (route === "releases/latest") return f.latest;
    if (route === "git/ref/tags/v1.4.0") return f.tag ? { object: { sha: f.tag } } : null;
    if (route === "commits/v1.4.0") return { sha: f.tag };
    if (route === `compare/${old}...${head}`) return { status: "ahead", files: f.files };
    if (route.startsWith("actions/workflows/ci.yml/runs?")) return { workflow_runs: [{ ...run, id: 2, head_sha: old }] };
    throw Error(`Unexpected API ${route}`);
  };
  f.execute = (check = false) => release({ api: f.api, git: f.git, repository }, 1, check);
  return f;
}

test("release CI requires the exact trusted push and every successful job", () => {
  validateCI(run, jobs(), repository, head);
  for (const change of [{ head_sha: old }, { event: "pull_request" }, { event: "schedule" }, { head_branch: "v1" }, { path: ".github/workflows/other.yml" }, { conclusion: "failure" }, { status: "in_progress" }, { repository: { full_name: "fork/repo" } }])
    assert.throws(() => validateCI({ ...run, ...change }, jobs(), repository, head));
  for (const conclusion of ["skipped", "cancelled", "failure"]) {
    const j = jobs(); j.jobs[0].conclusion = conclusion;
    assert.throws(() => validateCI(run, j, repository, head));
  }
  const missing = jobs(); missing.jobs.pop(); missing.total_count--;
  assert.throws(() => validateCI(run, missing, repository, head));
});

test("release notes must identify one stable version; comparisons are numeric", () => {
  assert.equal(releaseNotes("1.4.0", "## v1.4.0 (date)\n\nchanges\n## v1.3.0\nold"), "changes");
  for (const text of ["## v1.4.01\nwrong", "## v1.4.0\n", "## v1.4.0\na\n## v1.4.0\nb"]) assert.throws(() => releaseNotes("1.4.0", text));
  assert.throws(() => releaseNotes("1.4.0-beta", "## v1.4.0-beta\nx"));
  assert.equal(newer("1.10.0", "1.9.9"), true);
  assert.equal(newer("1.4.0", "1.4.0"), false);
  assert.equal(newer("1.4.0", "2.0.0"), false);
});

test("release publishes exactly the tested SHA and verifies Latest", async () => {
  const f = fixture(), result = await f.execute();
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].target_commitish, head);
  assert.equal(f.writes[0].make_latest, "true");
  assert.match(f.writes[0].body, /Real changes/);
  assert.doesNotMatch(f.writes[0].body, /Previous release/);
  assert.equal(result.released_commit, head);
  assert.equal(result.latest, true);
});

test("failed preconditions cannot mutate releases or move existing tags", async () => {
  for (const change of [{ dirty: " M src/server.ts" }, { main: old }, { tag: old }, { latest: { tag_name: "v2.0.0" } }, { run: { ...run, conclusion: "failure" } }]) {
    const f = Object.assign(fixture(), change);
    await assert.rejects(f.execute()); assert.deepEqual(f.writes, []);
  }
});

test("read-only verification rejects a missing release without publishing", async () => {
  const f = fixture(); await assert.rejects(f.execute(true), /has not been published/);
  assert.deepEqual(f.writes, []);
});

test("repeated publication is read-only; same-version documentation retains the immutable tag", async () => {
  const f = fixture(); await f.execute(); f.writes.length = 0;
  await f.execute(); await f.execute(true);
  f.tag = old;
  const result = await f.execute();
  assert.equal(result.released_commit, old); assert.equal(result.head, head);
  assert.deepEqual(f.writes, []);
});

test("runtime changes, renames and incomplete comparisons require a version bump", async () => {
  for (const files of [[{ filename: "src/server.ts" }], [{ filename: "docs/moved.md", previous_filename: "bin/runtime.mjs" }], [{ filename: "package-lock.json" }], Array.from({ length: 300 }, () => ({ filename: "README.md" }))]) {
    const f = fixture(); await f.execute(); f.writes.length = 0; f.tag = old; f.files = files;
    await assert.rejects(f.execute()); assert.deepEqual(f.writes, []);
  }
});

test("an API create response alone never proves Latest publication", async () => {
  const f = fixture(); f.wrongLatest = true;
  await assert.rejects(f.execute(), /not GitHub Latest/);
  assert.equal(f.writes.length, 1);
});
