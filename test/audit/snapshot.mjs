// Usage: node test/audit/snapshot.mjs before|after
// "before" stores source hashes of every authorised project; "after" compares and records findings.
import fs from "node:fs";
import { PROJECTS, diffSnapshots, evidence, evidenceDir, record, snapshot } from "./lib.mjs";

const mode = process.argv[2];
const file = `${evidenceDir}/cross-risk/snapshot-before.json`;
if (mode === "before") {
  const snap = Object.fromEntries(Object.entries(PROJECTS).map(([k, p]) => [k, snapshot(p)]));
  evidence("cross-risk", "snapshot-before.json", snap);
  for (const [k, s] of Object.entries(snap)) console.log(k, Object.keys(s).length, "files");
} else if (mode === "after") {
  const before = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const [k, p] of Object.entries(PROJECTS)) {
    const d = diffSnapshots(before[k], snapshot(p));
    const ev = evidence("cross-risk", `snapshot-diff-${k}.json`, d);
    const n = d.changed.length + d.added.length + d.removed.length;
    record(`E.no-modify.${k}`, n ? "UNVERIFIED" : "VERIFIED", n ? `${n} source files differ (${d.changed.length} changed, ${d.added.length} added, ${d.removed.length} removed) — attribute each before concluding` : "no source file changed during the audit", [ev], { diff: n ? d : undefined });
  }
}
