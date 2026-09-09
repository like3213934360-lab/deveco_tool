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
} from "./lib/upstream.js";

const id = z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .parse(process.argv[2]),
  output = path.resolve(z.string().min(1).parse(process.argv[3]));
invariant(
  !fs.existsSync(output),
  "UPSTREAM_REPORT_EXISTS",
  "Use a new candidate directory",
);
const lock = lockSchema.parse(
    JSON.parse(
      fs.readFileSync(
        path.join(packageRoot, "provenance/upstream-lock.json"),
        "utf8",
      ),
    ) as unknown,
  ),
  source = lock.sources.find((item) => item.id === id);
invariant(source, "UPSTREAM_UNKNOWN", "Source is absent from the lock");
const line = (
    await git(packageRoot, ["ls-remote", "--exit-code", source.url, source.ref])
  ).trim(),
  match = /^([a-f0-9]{40})\t(.+)$/.exec(line);
invariant(
  match?.[1] && match[2] === source.ref,
  "UPSTREAM_REF_INVALID",
  "Upstream returned an unexpected ref",
);
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
const changed = match[1] !== source.commit;
atomicWrite(
  path.join(output, "detection.json"),
  JSON.stringify(
    {
      source: id,
      url: source.url,
      locked: source.commit,
      candidate: match[1],
      changed,
    },
    null,
    2,
  ),
  false,
);
if (changed) {
  const cache = path.join(output, "source.git");
  try {
    await git(packageRoot, [
      "clone",
      "--bare",
      "--filter=blob:none",
      "--single-branch",
      "--branch",
      source.ref.replace(/^refs\/(heads|tags)\//, ""),
      "--",
      source.url,
      cache,
    ]);
    const mapping = mappingSchema.parse(
        JSON.parse(
          fs.readFileSync(
            path.join(packageRoot, "provenance/upstream-mapping.json"),
            "utf8",
          ),
        ) as unknown,
      ),
      report = await candidate(source, cache, match[1], mapping, packageRoot);
    atomicWrite(
      path.join(output, "candidate.json"),
      JSON.stringify(report, null, 2) + "\n",
      false,
    );
    atomicWrite(path.join(output, "UPGRADE.md"), candidateBody(report), false);
    console.log(
      JSON.stringify({
        source: id,
        changed: true,
        gate: report.gate,
        files: report.changes.length,
        report_sha256: report.sha256,
      }),
    );
  } finally {
    fs.rmSync(cache, { recursive: true, force: true });
  }
} else console.log(JSON.stringify({ source: id, changed: false }));
if (process.env.GITHUB_OUTPUT)
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
