import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { z } from "zod";
import { Runtime } from "../src/services/runtime.js";
import { discoverToolchain } from "../src/core/toolchain.js";
import { atomicWrite, readObject, fileDigest } from "../src/core/files.js";
import { object } from "../src/core/errors.js";
import { nativeOperation } from "./lib/native-operation.js";
import { evidenceIdentity } from "./lib/evidence.js";

// Build a fresh target-selection canary using the already personally selected
// signing assets. Never rewrite the original preparation or cloud receipts.
const [root, preparedRoot, signingRoot] = z.tuple([z.string(), z.string(), z.string()]).parse(process.argv.slice(2)).map((value) => path.resolve(value)) as [string, string, string];
assert.equal(fs.existsSync(root), false, "Preparation directory must be new");
const original = z.object({ bundle_name: z.string().startsWith("com.deveco.mcpacceptance."), project_path: z.string(), module: z.literal("entry"), ability: z.string() }).parse(readObject(path.join(preparedRoot, "prepared.json"))),
  previous = z.object({ operations: z.object({ preflight: z.object({ result: z.object({ target: z.string() }) }), configure: z.object({ status: z.literal("succeeded") }) }) }).parse(readObject(path.join(signingRoot, "operations.private.json"))),
  descriptor = path.join(signingRoot, "project-signing.private.json"), descriptorHash = fileDigest(descriptor),
  source = fs.readFileSync(path.join(original.project_path, "entry/src/main/ets/pages/Index.ets"), "utf8");
assert.equal(source.split("确认输入").length, 2);
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
process.env.DEVECO_STATE_DIR = path.join(root, "state");
const runtime = new Runtime(), tested = evidenceIdentity(), project_path = path.join(root, "application"), module_targets = { entry: "preview" };
try {
  const sdk_version = z.object({ data: z.object({ platformVersion: z.string() }) }).parse(readObject(path.join(discoverToolchain().sdk, "default/sdk-pkg.json"))).data.platformVersion;
  await runtime.projects.create({ project_path, app_name: "MCPTargetAcceptance", bundle_name: original.bundle_name, sdk_version });
  const profile = readObject(path.join(project_path, "build-profile.json5"));
  profile.modules = [{ name: "entry", srcPath: "./entry", targets: ["default", "preview"].map((name) => ({ name, applyToProducts: ["default"] })) }];
  atomicWrite(path.join(project_path, "build-profile.json5"), JSON.stringify(profile));
  const moduleProfile = readObject(path.join(project_path, "entry/build-profile.json5"));
  moduleProfile.targets = [...z.array(z.record(z.string(), z.unknown())).parse(moduleProfile.targets), { name: "preview" }];
  atomicWrite(path.join(project_path, "entry/build-profile.json5"), JSON.stringify(moduleProfile));
  atomicWrite(path.join(project_path, "entry/src/main/ets/pages/Index.ets"), source);
  assert.equal(fileDigest(descriptor), descriptorHash);
  const configured = await nativeOperation(runtime, "app_signature", { action: "configure", project_path, module_targets, file: descriptor,
    output: path.join(root, "project-signing"), options: { name: "PersonalCanary" } }, path.join(root, "configure.operation.private.json"));
  const configuredHash = z.string().parse(object(configured).build_profile_sha256);
  assert.equal(fileDigest(path.join(project_path, "build-profile.json5")), configuredHash);
  atomicWrite(path.join(root, "prepared.json"), JSON.stringify({ bundle_name: original.bundle_name, project_path, product: "default", module_targets, module: "entry", ability: original.ability }));
  atomicWrite(path.join(root, "operations.private.json"), JSON.stringify({ operations: {
    preflight: { result: previous.operations.preflight.result, reused_from: path.join(signingRoot, "operations.private.json") },
    configure: { status: "succeeded", result: configured, operation_receipt: path.join(root, "configure.operation.private.json") },
  } }));
  fs.chmodSync(path.join(root, "operations.private.json"), 0o600);
  atomicWrite(path.join(root, "evidence.json"), JSON.stringify({ tested, module_targets, descriptor_sha256: descriptorHash, configured }));
  process.stdout.write("Fresh preview-target canary configured with existing personal signing assets; no cloud mutations or device changes.\n");
} finally { assert.equal((await runtime.close()).closed, true); }
