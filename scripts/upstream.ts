import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { packageRoot } from "../src/core/config.js";
import { atomicWrite } from "../src/core/files.js";
import { invariant } from "../src/core/errors.js";
import {
  lockSchema,
  mappingSchema,
  candidate,
  candidateBody,
  git,
  verifyCandidate,
} from "./lib/upstream.js";

import { GhApi, publishCandidate } from "./lib/upstream-pr.js";

const command = z
  .enum(["detect", "check", "fetch", "pr", "gate"])
  .parse(process.argv[2]);
const id = z.string().min(1).parse(process.argv[3]);
const lock = lockSchema.parse(
  JSON.parse(
    fs.readFileSync(
      path.join(packageRoot, "provenance/upstream-lock.json"),
      "utf8",
    ),
  ) as unknown,
);
const source = lock.sources.find((item) => item.id === id);
invariant(
  source,
  "UPSTREAM_UNKNOWN",
  "Source is absent from the reviewed source lock",
);
if (command === "detect") {
  const output = path.resolve(z.string().min(1).parse(process.argv[4]));
  const line = (
    await git(packageRoot, ["ls-remote", "--exit-code", source.url, source.ref])
  ).trim();
  const match = /^([a-f0-9]{40})\t(.+)$/.exec(line);
  invariant(
    match?.[1] && match[2] === source.ref,
    "UPSTREAM_REF_INVALID",
    "Upstream did not return exactly the watched ref",
  );
  atomicWrite(
    output,
    JSON.stringify(
      {
        source: id,
        url: source.url,
        ref: source.ref,
        locked: source.commit,
        candidate: match[1],
        changed: match[1] !== source.commit,
      },
      null,
      2,
    ),
    false,
  );
  process.stdout.write(
    `${id}: ${match[1] === source.commit ? "unchanged" : "candidate detected"}\n`,
  );
} else if (command === "fetch") {
  const directory = path.resolve(z.string().min(1).parse(process.argv[4]));
  invariant(
    !fs.existsSync(directory),
    "UPSTREAM_CACHE_EXISTS",
    "Candidate source cache must be a new directory",
  );
  // A bare clone downloads source objects without checking out or running upstream code.
  await git(packageRoot, [
    "clone",
    "--bare",
    "--filter=blob:none",
    "--",
    source.url,
    directory,
  ]);
  process.stdout.write(`Candidate source objects saved to ${directory}\n`);
} else if (command === "pr" || command === "gate") {
  const file = path.resolve(z.string().min(1).parse(process.argv[4]));
  invariant(
    fs.statSync(file).size <= 1024 * 1024,
    "UPSTREAM_REPORT_TOO_LARGE",
    "Candidate report limit is 1 MiB",
  );
  const mapping = mappingSchema.parse(
    JSON.parse(
      fs.readFileSync(
        path.join(packageRoot, "provenance/upstream-mapping.json"),
        "utf8",
      ),
    ) as unknown,
  );
  const report = verifyCandidate(
    JSON.parse(fs.readFileSync(file, "utf8")) as unknown,
    source,
    mapping,
  );
  if (command === "gate") {
    console.log(
      JSON.stringify({ source: id, gate: report.gate, release_ready: false }),
    );
    // A report is always a proposal. Review and a new source lock are required.
    process.exitCode = report.gate === "blocked_unmapped" ? 2 : 1;
  } else {
    const argument = process.argv[5];
    const repository = z
      .string()
      .min(1)
      .parse(
        argument && !argument.startsWith("--") ? argument : process.env.GH_REPO,
      );
    const api = new GhApi(),
      pull = await publishCandidate(api, repository, report);
    console.log(JSON.stringify(pull));
    if (
      process.argv.includes("--dispatch-validation") &&
      pull.state === "open"
    ) {
      const runs = z
        .object({ total_count: z.number().int().nonnegative() })
        .parse(
          await api.request(
            "GET",
            `repos/${repository}/actions/workflows/native-ci.yml/runs?branch=${encodeURIComponent(pull.branch)}&event=workflow_dispatch&per_page=1`,
          ),
        );
      if (runs.total_count === 0)
        await api.request(
          "POST",
          `repos/${repository}/actions/workflows/native-ci.yml/dispatches`,
          { ref: pull.branch },
        );
    }
  }
} else {
  const repository = path.resolve(z.string().min(1).parse(process.argv[4]));
  const ref = z.string().min(1).parse(process.argv[5]);
  const directory = path.resolve(z.string().min(1).parse(process.argv[6]));
  invariant(
    !fs.existsSync(directory),
    "UPSTREAM_REPORT_EXISTS",
    "Use a new candidate report directory",
  );
  const mapping = mappingSchema.parse(
    JSON.parse(
      fs.readFileSync(
        path.join(packageRoot, "provenance/upstream-mapping.json"),
        "utf8",
      ),
    ) as unknown,
  );
  const report = await candidate(source, repository, ref, mapping, packageRoot);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  atomicWrite(
    path.join(directory, "candidate.json"),
    JSON.stringify(report, null, 2),
    false,
  );
  atomicWrite(path.join(directory, "UPGRADE.md"), candidateBody(report), false);
  process.stdout.write(
    `${id}: ${report.changes.length} changed files, ${report.gate}\n`,
  );
  if (report.gate === "blocked_unmapped") process.exitCode = 2;
}
