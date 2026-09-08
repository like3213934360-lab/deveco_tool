import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { z } from "zod";
import { Runtime } from "../src/services/runtime.js";
import { atomicWrite, digest, fileDigest } from "../src/core/files.js";
import { invariant, ToolError, errorResult } from "../src/core/errors.js";
import { inspectApplicationPackages } from "../src/services/package.js";
import { evidenceIdentity } from "./lib/evidence.js";

/** Explicit live signing stages. The caller selects a team and a prepared canary.
 * An attempted mutation cannot be repeated by rerunning this script. Its private
 * journal is an acceptance receipt, not a production workflow recovery engine. */
const args = z
  .tuple([
    z.string().min(1),
    z.string().min(1),
    z.string().min(1),
    z.string().min(1),
    z.enum([
      "preflight",
      "certificate",
      "profile",
      "debug_profile",
      "sign",
      "configure",
      "verify",
      "deploy",
      "profile_delete",
      "certificate_delete",
    ]),
  ])
  .parse(process.argv.slice(2));
const root = path.resolve(args[0]),
  preparedRoot = path.resolve(args[1]),
  authState = path.resolve(args[2]),
  teamName = args[3],
  stage = args[4];
const prepared = z
  .object({
    bundle_name: z.string(),
    project_path: z.string(),
    module: z.string(),
    ability: z.string(),
    certificate_name: z.string(),
    profile_name: z.string(),
    csr: z.string(),
    csr_sha256: z.string(),
    packages: z
      .array(
        z.object({ path: z.string(), sha256: z.string(), bytes: z.number() }),
      )
      .length(1),
  })
  .parse(
    JSON.parse(
      fs.readFileSync(path.join(preparedRoot, "prepared.json"), "utf8"),
    ) as unknown,
  );
const operationSchema = z.object({
  status: z.enum(["started", "succeeded", "failed"]),
  input_sha256: z.string(),
  started_at: z.string(),
  result: z.unknown().optional(),
  error_code: z.string().optional(),
  http_error: z
    .object({ status: z.number(), stage: z.string().optional() })
    .optional(),
  diagnostic: z.unknown().optional(),
});
const journalSchema = z.object({
  binding: z.string(),
  operations: z.record(z.string(), operationSchema),
});
const journalFile = path.join(root, "operations.private.json");
const binding = digest({ prepared, authState, teamName });
if (stage === "preflight") {
  assert.equal(fs.existsSync(root), false, "Preflight output must be new");
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  atomicWrite(journalFile, JSON.stringify({ binding, operations: {} }));
  atomicWrite(path.join(root, "config.json"), "{}\n");
}
const journal = journalSchema.parse(
  JSON.parse(fs.readFileSync(journalFile, "utf8")) as unknown,
);
assert.equal(
  journal.binding,
  binding,
  "Do not change the selected team or preparation",
);
if (stage === "preflight" || stage === "certificate")
  assert.equal(fileDigest(prepared.csr), prepared.csr_sha256);
// Rebuilds legitimately replace the project's unsigned output. Later stages
// validate their own immutable receipt, and cleanup uses recorded cloud IDs.
if (stage === "preflight" || stage === "sign")
  for (const item of prepared.packages)
    assert.equal(fileDigest(item.path), item.sha256);
process.env.DEVECO_STATE_DIR = authState;
process.env.DEVECO_CONFIG = path.join(root, "config.json");
const runtime = new Runtime(),
  tested = evidenceIdentity();
const evidence: {
  stage: string;
  tested: unknown;
  elapsed_ms?: number;
  result?: unknown;
  error_code?: string;
  http_error?: unknown;
  diagnostic?: unknown;
  closed?: boolean;
} = { stage, tested };
function saveJournal() {
  atomicWrite(journalFile, JSON.stringify(journal, null, 2));
}
async function once(input: unknown, task: () => Promise<unknown>) {
  const prior = journal.operations[stage];
  if (prior?.status === "failed" && stage === "verify") {
    journal.operations[`${stage}@${prior.started_at}`] = prior;
    delete journal.operations[stage];
    saveJournal();
  }
  if (
    prior?.status === "failed" &&
    ["profile", "debug_profile"].includes(stage)
  ) {
    const file = path.join(root, `${stage}-retry-reconciliation.json`);
    if (fs.existsSync(file)) {
      const receipt = z
        .object({
          binding: z.string(),
          previous_started_at: z.string(),
          source: z.literal("personal_team_browser_inventory"),
          candidate_absent: z.literal(true),
          observed_at: z.iso.datetime(),
        })
        .parse(JSON.parse(fs.readFileSync(file, "utf8")) as unknown);
      assert.equal(receipt.binding, binding);
      assert.equal(receipt.previous_started_at, prior.started_at);
      assert.ok(Date.parse(receipt.observed_at) > Date.parse(prior.started_at));
      journal.operations[`${stage}@${prior.started_at}`] = prior;
      delete journal.operations[stage];
      saveJournal();
    }
  }
  invariant(
    !journal.operations[stage],
    "ACCEPTANCE_ALREADY_ATTEMPTED",
    "This stage has a receipt; reconcile it before any further mutation",
  );
  journal.operations[stage] = {
    status: "started",
    started_at: new Date().toISOString(),
    input_sha256: digest(input),
  };
  saveJournal();
  try {
    const result = await task();
    journal.operations[stage]!.status = "succeeded";
    journal.operations[stage]!.result = result;
    saveJournal();
    return result;
  } catch (error) {
    journal.operations[stage]!.status = "failed";
    journal.operations[stage]!.error_code =
      error instanceof ToolError ? error.code : "ACCEPTANCE_FAILED";
    journal.operations[stage]!.diagnostic = diagnostic(error);
    if (error instanceof ToolError && error.code === "HTTP_ERROR")
      journal.operations[stage]!.http_error = z
        .object({ status: z.number(), stage: z.string().optional() })
        .parse(error.details);
    saveJournal();
    throw error;
  }
}
function diagnostic(error: unknown): unknown {
  if (error instanceof z.ZodError) return errorResult(error);
  if (error instanceof ToolError)
    return {
      code: error.code,
      ...(error.code === "HTTP_ERROR" ? { details: error.details } : {}),
    };
  return { name: error instanceof Error ? error.name : typeof error };
}
function completed(name: string): unknown {
  const operation = journal.operations[name];
  invariant(
    operation?.status === "succeeded",
    "ACCEPTANCE_PREREQUISITE",
    `Complete ${name} first`,
  );
  return operation.result;
}
const selectedSchema = z.object({
  team_id: z.string(),
  target: z.string(),
  device_id: z.string(),
  udid_sha256: z.string(),
});
const fileSchema = z.object({
  path: z.string(),
  sha256: z.string(),
  bytes: z.number(),
});
const started = performance.now();
try {
  const teams = await runtime.auth.teams();
  const matches = teams.teams.filter((team) => team.name === teamName);
  invariant(
    matches.length === 1,
    "ACCEPTANCE_TEAM_AMBIGUOUS",
    "Select exactly one developer team by name",
  );
  const team = matches[0]!;
  if (stage === "preflight") {
    const result = selectedSchema.parse(
      await once({ team: team.id, prepared }, async () => {
        const target = await runtime.devices.target();
        const reply = await runtime.devices.shell(
          target,
          ["bm", "get", "-u"],
          undefined,
          30000,
          false,
          true,
        );
        const ids = reply.stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => /^[a-fA-F0-9]{64}$/.test(line));
        invariant(
          ids.length === 1,
          "DEVICE_UDID_UNCONFIRMED",
          "Device did not return a unique UDID",
        );
        const inventory = z
          .object({
            devices: z.array(z.object({ id: z.string(), udid: z.string() })),
          })
          .parse(
            await runtime.call("app_signature", {
              action: "devices",
              team_id: team.id,
            }),
          );
        const devices = inventory.devices.filter(
          (device) => device.udid.toUpperCase() === ids[0]!.toUpperCase(),
        );
        invariant(
          devices.length === 1,
          "ACCEPTANCE_DEVICE_UNREGISTERED",
          "Device must already be registered in the selected team",
        );
        const certificates = z
          .object({ certificates: z.array(z.object({ certName: z.string() })) })
          .parse(
            await runtime.call("app_signature", {
              action: "certificates",
              team_id: team.id,
            }),
          );
        assert.equal(
          certificates.certificates.some(
            (cert) => cert.certName === prepared.certificate_name,
          ),
          false,
        );
        return {
          team_id: team.id,
          target,
          device_id: devices[0]!.id,
          udid_sha256: digest(ids[0]!.toUpperCase()),
        };
      }),
    );
    evidence.result = {
      team_selected: true,
      device_registered: true,
      certificate_name_available: true,
      udid_sha256: result.udid_sha256,
    };
  } else {
    const selected = selectedSchema.parse(completed("preflight"));
    assert.equal(team.id, selected.team_id);
    if (stage === "certificate") {
      const input = {
        action: "certificate_create",
        team_id: team.id,
        file: prepared.csr,
        output: path.join(root, "validation.cer"),
        options: { cert_name: prepared.certificate_name },
      };
      const result = fileSchema.parse(
        await once(input, () => runtime.call("app_signature", input)),
      );
      evidence.result = { bytes: result.bytes, sha256: result.sha256 };
    } else if (stage === "profile" || stage === "debug_profile") {
      if (stage === "debug_profile") {
        const receipt = z
          .object({
            binding: z.string(),
            stage: z.literal("profile"),
            source: z.literal("personal_team_browser_inventory"),
            candidate_absent: z.literal(true),
          })
          .parse(
            JSON.parse(
              fs.readFileSync(
                path.join(root, "profile-reconciliation.json"),
                "utf8",
              ),
            ) as unknown,
          );
        assert.equal(receipt.binding, binding);
        assert.equal(journal.operations.profile?.status, "failed");
      }
      const certificate = z
        .object({ certificate_id: z.string() })
        .parse(completed("certificate"));
      const input = {
        action: "profile_create",
        team_id: team.id,
        output: path.join(root, "validation.p7b"),
        options: {
          cert_ids: JSON.stringify([certificate.certificate_id]),
          device_ids: JSON.stringify([selected.device_id]),
          bundle_name: prepared.bundle_name,
          profile_name: prepared.profile_name,
        },
      };
      const result = fileSchema.parse(
        await once(input, () => runtime.call("app_signature", input)),
      );
      evidence.result = { bytes: result.bytes, sha256: result.sha256 };
    } else if (stage === "sign" || stage === "configure") {
      const certificate = fileSchema.parse(completed("certificate")),
        profile = fileSchema.parse(
          completed(
            journal.operations.debug_profile ? "debug_profile" : "profile",
          ),
        );
      assert.equal(fileDigest(certificate.path), certificate.sha256);
      assert.equal(fileDigest(profile.path), profile.sha256);
      const material = z
        .object({
          password: z.string(),
          key_alias: z.string(),
          keystore: z.string(),
        })
        .parse(
          JSON.parse(
            fs.readFileSync(
              path.join(preparedRoot, "signing.private.json"),
              "utf8",
            ),
          ) as unknown,
        );
      const input = {
        action: "sign",
        file: prepared.packages[0]!.path,
        output: path.join(root, "validation-signed.hap"),
        options: {
          keyAlias: material.key_alias,
          keyPwd: material.password,
          keystoreFile: material.keystore,
          keystorePwd: material.password,
          appCertFile: certificate.path,
          profileFile: profile.path,
          signAlg: "SHA256withECDSA",
        },
      };
      if (stage === "configure") {
        const descriptor = path.join(root, "project-signing.private.json");
        evidence.result = await once(
          { project_path: prepared.project_path, options: input.options },
          async () => {
            atomicWrite(descriptor, JSON.stringify(input.options), false);
            return runtime.call("app_signature", {
              action: "configure",
              project_path: prepared.project_path,
              file: descriptor,
              output: path.join(root, "project-signing"),
              options: { name: "PersonalCanary" },
            });
          },
        );
      } else {
        const result = fileSchema.parse(
          await once(input, () => runtime.call("app_signature", input)),
        );
        evidence.result = { bytes: result.bytes, sha256: result.sha256 };
      }
    } else if (stage === "verify") {
      const signed = fileSchema.parse(completed("sign"));
      assert.equal(fileDigest(signed.path), signed.sha256);
      evidence.result = await once(signed, async () => {
        await runtime.call("app_signature", {
          action: "verify",
          file: signed.path,
        });
        await inspectApplicationPackages([signed.path], {
          bundle_name: prepared.bundle_name,
          module: prepared.module,
          ability: prepared.ability,
        });
        return { signature_verified: true, package_identity_verified: true };
      });
    } else if (stage === "deploy") {
      completed("verify");
      const signed = fileSchema.parse(completed("sign"));
      await runtime.devices.target(selected.target);
      const input = {
        packages: [{ path: signed.path, sha256: signed.sha256 }],
        target: selected.target,
        app: {
          bundle_name: prepared.bundle_name,
          module: prepared.module,
          ability: prepared.ability,
        },
      };
      evidence.result = await once(input, async () => {
        const run = z.object({ run_id: z.string() }).parse(
          await runtime.call("workflow_run", {
            action: "start",
            workflow: "app_deploy",
            request_key: `signing-acceptance:${binding}`,
            input,
          }),
        );
        // Preserve the durable run immediately; an uncertain install is inspected by run_id.
        journal.operations[stage]!.result = run;
        saveJournal();
        const deadline = performance.now() + 180000;
        while (performance.now() < deadline) {
          const status = z.object({ status: z.string() }).parse(
            await runtime.call("workflow_run", {
              action: "status",
              run_id: run.run_id,
              wait_ms: 1000,
            }),
          );
          if (status.status === "succeeded")
            return { run_id: run.run_id, deployed: true };
          invariant(
            ["queued", "running"].includes(status.status),
            "ACCEPTANCE_DEPLOY_FAILED",
            `Deployment ended in ${status.status}`,
          );
        }
        throw new ToolError(
          "ACCEPTANCE_DEPLOY_TIMEOUT",
          "Inspect the saved run_id before continuing",
        );
      });
    } else {
      const isProfile = stage === "profile_delete";
      if (!isProfile) completed("profile_delete");
      const profile = isProfile
        ? z
            .object({
              profile_id: z.string().optional(),
              remote_deletion_available: z.boolean().optional(),
            })
            .parse(
              completed(
                journal.operations.debug_profile ? "debug_profile" : "profile",
              ),
            )
        : undefined;
      if (profile && !profile.profile_id) {
        assert.equal(profile.remote_deletion_available, false);
        evidence.result = await once(
          { stage, remote_id_returned: false },
          async () => ({
            not_applicable: true,
            reason:
              "Provider returned no remote profile ID; no deletion endpoint can be called",
          }),
        );
      } else {
        const id = isProfile
          ? z
              .object({ profile_id: z.string() })
              .parse(
                completed(
                  journal.operations.debug_profile
                    ? "debug_profile"
                    : "profile",
                ),
              ).profile_id
          : z
              .object({ certificate_id: z.string() })
              .parse(completed("certificate")).certificate_id;
        await once({ stage, id }, () =>
          runtime.call("app_signature", {
            action: stage,
            team_id: team.id,
            options: isProfile ? { profile_id: id } : { cert_id: id },
          }),
        );
        evidence.result = { deleted: true };
      }
    }
  }
  process.stdout.write(`${stage}: passed\n`);
} catch (error) {
  evidence.diagnostic = diagnostic(error);
  evidence.error_code =
    error instanceof ToolError ? error.code : "ACCEPTANCE_FAILED";
  if (error instanceof ToolError && error.code === "HTTP_ERROR")
    evidence.http_error = error.details;
  process.stdout.write(`${stage}: failed (${evidence.error_code})\n`);
  process.exitCode = 1;
} finally {
  evidence.elapsed_ms = performance.now() - started;
  try {
    evidence.closed = (await runtime.close()).closed;
  } finally {
    atomicWrite(
      path.join(root, `${stage}-${Date.now()}.evidence.json`),
      JSON.stringify(evidence, null, 2),
    );
  }
}
