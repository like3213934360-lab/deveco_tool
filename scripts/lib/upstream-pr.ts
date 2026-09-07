import { z } from "zod";
import { candidateBody, candidateSchema } from "./upstream.js";
import { ProcessService } from "../../src/core/process.js";
import { digest } from "../../src/core/files.js";
import { invariant, ToolError } from "../../src/core/errors.js";

export interface GitHubApi {
  request(
    method: "GET" | "POST",
    endpoint: string,
    body?: unknown,
  ): Promise<unknown>;
}
export class GhApi implements GitHubApi {
  async request(method: "GET" | "POST", endpoint: string, body?: unknown) {
    const processes = new ProcessService();
    try {
      const result = await processes.run(
        {
          executable: "gh",
          args: [
            "api",
            "--method",
            method,
            endpoint,
            "-H",
            "Accept: application/vnd.github+json",
            "-H",
            "X-GitHub-Api-Version: 2022-11-28",
            ...(body === undefined ? [] : ["--input", "-"]),
          ],
        },
        {
          timeoutMs: 30000,
          limitBytes: 2 * 1024 * 1024,
          input: body === undefined ? undefined : JSON.stringify(body),
        },
      );
      invariant(
        !result.truncated,
        "UPSTREAM_API_TOO_LARGE",
        "GitHub response exceeded its bound",
      );
      return result.stdout.trim()
        ? (JSON.parse(result.stdout) as unknown)
        : null;
    } finally {
      await processes.close();
    }
  }
}
const oid = z.string().regex(/^[a-f0-9]{40}$/),
  refSchema = z.object({ ref: z.string(), object: z.object({ sha: oid }) }),
  pullSchema = z.object({
    number: z.number().int(),
    html_url: z.url(),
    state: z.enum(["open", "closed"]),
    draft: z.boolean().optional(),
  });
/** Create only an immutable candidate report on a dedicated draft branch. Never
 * change the source lock, execute upstream code, overwrite refs, or merge. */
export async function publishCandidate(
  api: GitHubApi,
  repository: string,
  raw: unknown,
) {
  z.string()
    .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
    .parse(repository);
  const report = candidateSchema.parse(raw),
    base = `repos/${repository}`,
    owner = repository.split("/")[0]!,
    branch = `codex/upstream-${report.source}-${report.candidate.commit.slice(0, 12)}-${report.sha256.slice(0, 12)}`;
  invariant(
    report.base.commit !== report.candidate.commit,
    "UPSTREAM_UNCHANGED",
    "No candidate commit to propose",
  );
  const { sha256, ...payload } = report;
  invariant(
    digest(payload) === sha256,
    "UPSTREAM_REPORT_CHANGED",
    "Candidate report failed its digest check",
  );
  const body = candidateBody(report);
  invariant(
    body.length < 60000,
    "UPSTREAM_BODY_TOO_LARGE",
    "Candidate body exceeds GitHub's PR bound; split the upstream review",
  );
  const relative = `provenance/upstream-candidates/${report.source}/candidate.json`,
    serialized = JSON.stringify(report, null, 2) + "\n";
  invariant(
    Buffer.byteLength(serialized) <= 1024 * 1024,
    "UPSTREAM_REPORT_TOO_LARGE",
    "Draft report limit is 1 MiB",
  );
  const existing = z
    .array(pullSchema)
    .parse(
      await api.request(
        "GET",
        `${base}/pulls?state=all&head=${encodeURIComponent(`${owner}:${branch}`)}&per_page=100`,
      ),
    );
  invariant(
    existing.length < 100,
    "UPSTREAM_PR_AMBIGUOUS",
    "Too many candidate pull requests",
  );
  if (existing.length) return { ...existing[0]!, branch, deduplicated: true };
  const repo = z
    .object({ default_branch: z.string() })
    .parse(await api.request("GET", base));
  const refs = z
      .array(refSchema)
      .parse(
        await api.request("GET", `${base}/git/matching-refs/heads/${branch}`),
      ),
    previous = refs.find((item) => item.ref === `refs/heads/${branch}`);
  if (previous) {
    // An interrupted attempt may have created its branch before losing the reply.
    // Preserve any later manual changes while checking that this is our report.
    const file = z
      .object({
        type: z.literal("file"),
        encoding: z.literal("base64"),
        content: z.string(),
      })
      .parse(
        await api.request(
          "GET",
          `${base}/contents/${relative}?ref=${encodeURIComponent(branch)}`,
        ),
      );
    invariant(
      Buffer.from(file.content, "base64").toString("utf8") === serialized,
      "UPSTREAM_BRANCH_CONFLICT",
      "Existing candidate branch contains another report",
    );
  } else {
    const head = refSchema.parse(
        await api.request(
          "GET",
          `${base}/git/ref/heads/${repo.default_branch}`,
        ),
      ),
      commit = z
        .object({ tree: z.object({ sha: oid }) })
        .parse(
          await api.request("GET", `${base}/git/commits/${head.object.sha}`),
        );
    const tree = z.object({ sha: oid }).parse(
      await api.request("POST", `${base}/git/trees`, {
        base_tree: commit.tree.sha,
        tree: [
          { path: relative, mode: "100644", type: "blob", content: serialized },
          {
            path: `provenance/upstream-candidates/${report.source}/UPGRADE.md`,
            mode: "100644",
            type: "blob",
            content: candidateBody(report),
          },
        ],
      }),
    );
    const next = z.object({ sha: oid }).parse(
      await api.request("POST", `${base}/git/commits`, {
        message: `chore: review ${report.source} ${report.candidate.commit.slice(0, 12)}`,
        tree: tree.sha,
        parents: [head.object.sha],
      }),
    );
    // Mutation failures are left for the next invocation to reconcile by ref/PR.
    // Do not retry a timed-out mutation or force-update an existing branch.
    await api.request("POST", `${base}/git/refs`, {
      ref: `refs/heads/${branch}`,
      sha: next.sha,
    });
  }
  const pull = pullSchema.parse(
    await api.request("POST", `${base}/pulls`, {
      title: `chore: review ${report.source} ${report.candidate.commit.slice(0, 12)}`,
      head: branch,
      base: repo.default_branch,
      body,
      draft: true,
      maintainer_can_modify: true,
    }),
  );
  if (!pull.draft)
    throw new ToolError(
      "UPSTREAM_DRAFT_UNCONFIRMED",
      "GitHub did not confirm a draft pull request",
    );
  return { ...pull, branch, deduplicated: false };
}
