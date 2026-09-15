import fs from "node:fs";
import { z } from "zod";
import { invariant, object } from "../core/errors.js";
import { fileDigest } from "../core/files.js";
import type { StateStore } from "../core/store.js";
import { evidenceIdentitySchema } from "./evidence-identity.js";
import { requirementBindingsSchema } from "../core/acceptance-contracts.js";

export const evidenceArtifactSchema = z.object({path:z.string(),sha256:z.string().regex(/^[a-f0-9]{64}$/),bytes:z.number().int().nonnegative().optional(),artifact_id:z.string().optional(),
  released_package:z.object({run_id:z.string().uuid(),artifact_id:z.string().uuid()}).optional()});
export const evidenceSealSchema = z.object({
  identity:evidenceIdentitySchema, scope:z.record(z.string(),z.unknown()), requirements:requirementBindingsSchema.optional(),
  artifacts:z.array(evidenceArtifactSchema).max(256).default([]), definition_sha256:z.string().nullable().optional(),
  deployment:z.object({run_id:z.string().uuid(),result_sha256:z.string()}).optional(),
  build:z.object({run_id:z.string().uuid(),result_sha256:z.string(),requirements:requirementBindingsSchema.optional()}).optional(),
});
export function resolveEvidenceResult(store:StateStore,raw:unknown):Record<string,unknown> {
  const value=object(raw);
  if(!value.result_artifact) return value;
  const reference=z.object({artifact_id:z.string(),bytes:z.number().int().nonnegative().max(8*1024*1024)}).parse(value.result_artifact);
  const pages:Buffer[]=[];
  let offset=0;
  do {
    const page=store.readArtifact(reference.artifact_id,offset,65536);
    invariant(page.bytes===reference.bytes && page.next_offset>offset,"EVIDENCE_ARTIFACT_INVALID","Stored result artifact has inconsistent length");
    pages.push(Buffer.from(page.data,"base64")); offset=page.next_offset;
  } while(offset<reference.bytes);
  return object(JSON.parse(Buffer.concat(pages).toString("utf8")));
}
export function verifyEvidenceArtifacts(artifacts:z.infer<typeof evidenceArtifactSchema>[], store?:StateStore) {
  for(const artifact of artifacts) {
    if(artifact.released_package) {
      const receipt=store?.db.prepare("SELECT sha256,bytes FROM released_packages WHERE artifact_id=? AND run_id=?").get(artifact.released_package.artifact_id,artifact.released_package.run_id) as {sha256:string;bytes:number}|undefined;
      invariant(receipt && artifact.artifact_id===artifact.released_package.artifact_id && receipt.sha256===artifact.sha256 && receipt.bytes===artifact.bytes,"EVIDENCE_ARTIFACT_CHANGED","The durable installation release receipt is missing or changed", {
        changed_inputs: [{ input: "package_release_receipt", artifact_id: artifact.artifact_id, recorded: { sha256: artifact.sha256, bytes: artifact.bytes }, current: receipt ?? null }],
      });
      continue;
    }
    const expected = { sha256: artifact.sha256, bytes: artifact.bytes };
    invariant(fs.existsSync(artifact.path),"EVIDENCE_ARTIFACT_CHANGED","A captured build, deployment or patch artifact is missing or changed", {
      changed_inputs: [{ input: "artifact", path: artifact.path, recorded: expected, current: null }],
    });
    const stat=fs.statSync(artifact.path);
    const current = { bytes: stat.size, sha256: stat.isFile() && (artifact.bytes===undefined || stat.size===artifact.bytes) ? fileDigest(artifact.path) : null };
    invariant(stat.isFile() && (artifact.bytes===undefined || stat.size===artifact.bytes) && current.sha256===artifact.sha256,"EVIDENCE_ARTIFACT_CHANGED","A captured build, deployment or patch artifact is missing or changed", {
      changed_inputs: [{ input: "artifact", path: artifact.path, recorded: expected, current }],
    });
  }
}
