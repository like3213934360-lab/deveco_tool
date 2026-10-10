// One release gate for Actions and local recovery. Never move an existing tag or infer success.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const requiredJobs = ["upstream", ...["ubuntu", "macos", "windows"].flatMap((os) => [22, 24].map((node) => `test (${os}-latest, ${node})`))];
const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const runtimeFile = /^(?:src\/|bin\/|templates\/|knowledge\/|resources\/|package(?:-lock)?\.json$|tools\/(?:build|prepack)\.mjs$)/;

export function validateCI(run, jobs, repository, sha) {
  assert.equal(run.repository?.full_name, repository, "CI belongs to a different repository");
  assert.equal(run.path, ".github/workflows/ci.yml", "Expected the ci workflow");
  assert.equal(run.event, "push", "Only pushed commits can be released");
  assert.equal(run.head_branch, "main", "Only main can be released");
  assert.equal(run.head_sha, sha, "CI does not match the release commit");
  assert.equal(run.status, "completed", "CI is still running");
  assert.equal(run.conclusion, "success", "CI did not succeed");
  assert.equal(jobs.total_count, jobs.jobs.length, "Incomplete CI job response");
  for (const name of requiredJobs) {
    const matches = jobs.jobs.filter((job) => job.name === name);
    assert.equal(matches.length, 1, `Missing or duplicated CI job: ${name}`);
  }
  assert.ok(jobs.jobs.every((job) => job.status === "completed" && job.conclusion === "success"), "Every CI job must pass; skipped jobs do not count");
}

export function releaseNotes(version, changelog) {
  assert.match(version, stable, "Release version must be stable x.y.z");
  const sections = changelog.split(/^## /m).slice(1).filter((s) => new RegExp(`^v${version.replaceAll(".", "\\.")}(?:\\s|$)`).test(s));
  assert.equal(sections.length, 1, `Expected one CHANGELOG entry for v${version}`);
  const body = sections[0].slice(sections[0].indexOf("\n") + 1).trim();
  assert.ok(body, "Release notes must not be empty");
  return body;
}

export function newer(version, previous) {
  assert.match(previous, stable, "Latest release must use a stable version");
  const a = version.split(".").map(BigInt), b = previous.split(".").map(BigInt);
  const i = a.findIndex((v, n) => v !== b[n]);
  return i >= 0 && a[i] > b[i];
}

export async function release({ api, git, repository }, runId, check = false) {
  assert.match(String(runId), /^\d+$/, "Pass a numeric CI run ID with --run");
  const remote = (route, options) => api(`repos/${repository}/${route}`, options);
  const head = (await remote("git/ref/heads/main")).object.sha;
  assert.equal(git("rev-parse", "HEAD"), head, "Checkout must match current remote main; stale CI cannot publish");
  assert.equal(git("status", "--porcelain"), "", "Release requires a clean checkout");
  const run = await remote(`actions/runs/${runId}`);
  const verifyCI = async (r, sha) => validateCI(r, await remote(`actions/runs/${r.id}/jobs?filter=latest&per_page=100`), repository, sha);
  await verifyCI(run, head);
  const { version } = JSON.parse(git("show", `${head}:package.json`));
  const lock = JSON.parse(git("show", `${head}:package-lock.json`));
  assert.equal(lock.version, version, "Lockfile version mismatch");
  assert.equal(lock.packages[""].version, version, "Lockfile root version mismatch");
  const notes = releaseNotes(version, git("show", `${head}:CHANGELOG.md`)), tag = `v${version}`;
  assert.ok(git("show", `${head}:docs/UPGRADE-${version}.md`).trim(), "Version acceptance record is required");
  let published = await remote(`releases/tags/${tag}`, { optional: true });
  const latest = await remote("releases/latest", { optional: true });
  const ref = await remote(`git/ref/tags/${tag}`, { optional: true });
  let sha = ref ? (await remote(`commits/${tag}`)).sha : head;
  let releaseCI = run;
  if (published) {
    assert.ok(ref, "Release tag is missing");
    assert.ok(!published.draft && !published.prerelease, "Existing release is not a stable publication");
    if (sha !== head) {
      const diff = await remote(`compare/${sha}...${head}`);
      assert.equal(diff.status, "ahead", "Release tag is not an ancestor of main");
      assert.ok(diff.files && diff.files.length < 300, "Cannot verify a truncated release comparison");
      assert.ok(!diff.files.some((f) => runtimeFile.test(f.filename) || runtimeFile.test(f.previous_filename ?? "")), "Runtime changed after release; bump the version instead of moving its tag");
      const runs = await remote(`actions/workflows/ci.yml/runs?head_sha=${sha}&event=push&status=success&per_page=1`);
      assert.ok(runs.workflow_runs.length, "Released commit has no successful CI run");
      releaseCI = runs.workflow_runs[0];
      await verifyCI(releaseCI, sha);
    }
  } else {
    assert.ok(!check, `${tag} has not been published`);
    assert.equal(sha, head, "Existing tag points at another commit; it will not be moved");
    assert.ok(!latest || newer(version, latest.tag_name.replace(/^v/, "")), "Release version must be newer than Latest");
    // Recheck just before the only mutation: a newer main must finish its own CI first.
    assert.equal((await remote("git/ref/heads/main")).object.sha, head, "main advanced during release checks");
    published = await remote("releases", { method: "POST", body: {
      tag_name: tag, target_commitish: head, name: tag, make_latest: "true", draft: false, prerelease: false,
      body: `${notes}\n\n## 发布核验 / Publication verification\n\n- Commit: \`${head}\`\n- [CI: all ${requiredJobs.length} required jobs passed](${run.html_url})\n- [逐项验收 / Acceptance](https://github.com/${repository}/blob/${head}/docs/UPGRADE-${version}.md)\n\nGitHub publication does not restart existing MCP hosts or publish to npm.\n`,
    } });
  }
  const verified = await remote(`releases/tags/${tag}`), verifiedLatest = await remote("releases/latest");
  assert.equal(verified.id, published.id, "Published release identity changed");
  assert.ok(!verified.draft && !verified.prerelease, "Release is not publicly stable");
  assert.equal(verifiedLatest.id, verified.id, "Release is not GitHub Latest");
  assert.equal((await remote(`commits/${tag}`)).sha, sha, "Release tag does not match its verified commit");
  assert.equal((await remote("git/ref/heads/main")).object.sha, head, "main advanced; verify the new head before claiming delivery");
  return { version, tag, head, released_commit: sha, ci: releaseCI.html_url, head_ci: run.html_url, latest: true, url: verified.html_url };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), index = args.indexOf("--run"), runId = args[index + 1];
    assert.ok(index >= 0 && args.every((a, i) => a === "--run" || a === "--check" || i === index + 1), "Usage: node tools/release.mjs --run <CI run ID> [--check]");
    const root = path.resolve(import.meta.dirname, ".."), command = (file, argv) => execFileSync(file, argv, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    const repository = process.env.GITHUB_REPOSITORY ?? command("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
    const token = process.env.GH_TOKEN ?? command("gh", ["auth", "token"]);
    const api = async (route, { optional = false, method = "GET", body } = {}) => {
      const response = await fetch(`https://api.github.com/${route}`, { method, signal: AbortSignal.timeout(30000),
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28" },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      if (optional && response.status === 404) return null;
      assert.ok(response.ok, `GitHub ${method} ${route}: HTTP ${response.status}`);
      return response.json();
    };
    const result = await release({ api, git: (...argv) => command("git", argv), repository }, runId, args.includes("--check"));
    console.log(JSON.stringify(result, null, 2));
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Published and verified [${result.tag}](${result.url}) as Latest.\n\nCommit: \`${result.released_commit}\` · [CI](${result.ci})\n`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
