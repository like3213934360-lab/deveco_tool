import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { Runtime } from "../src/services/runtime.js";
import { atomicWrite, fileDigest, readObject } from "../src/core/files.js";
import { discoverToolchain } from "../src/core/toolchain.js";
import { errorResult } from "../src/core/errors.js";
import { validateCsrPem } from "../src/services/signature.js";
import { inspectApplicationPackages } from "../src/services/package.js";
import { evidenceIdentity } from "./lib/evidence.js";

/** Prepare a dedicated unsigned canary and local signing material. No login,
 * cloud mutation, device registration, installation or deployment occurs here. */
const root = path.resolve(z.string().min(1).parse(process.argv[2]));
assert.equal(fs.existsSync(root), false, "Preparation directory must be new");
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
process.env.DEVECO_STATE_DIR = path.join(root, "state");
const tested = evidenceIdentity(),
  runtime = new Runtime();
const suffix = crypto.randomBytes(4).toString("hex");
const bundle = `com.deveco.mcpacceptance.a${suffix}`;
const project = path.join(root, "application");
const signingName = `MCPValidation${suffix}`;
const keystore = path.join(root, "validation.p12"),
  csr = path.join(root, "validation.csr");
const password = crypto.randomBytes(24).toString("base64url");
const observations: {
  name: string;
  elapsed_ms: number;
  result?: unknown;
  error?: unknown;
}[] = [];
async function observe<T>(name: string, action: () => Promise<T>) {
  const started = performance.now();
  try {
    const result = await action();
    observations.push({
      name,
      elapsed_ms: performance.now() - started,
      result,
    });
    process.stdout.write(`${name}: passed\n`);
    return result;
  } catch (error) {
    observations.push({
      name,
      elapsed_ms: performance.now() - started,
      error: errorResult(error),
    });
    throw error;
  } finally {
    atomicWrite(
      path.join(root, "evidence.json"),
      JSON.stringify({ tested, observations }, null, 2),
    );
  }
}
async function workflow(
  name: "project_create" | "project_build",
  input: Record<string, unknown>,
) {
  const { run_id } = z.object({ run_id: z.string() }).parse(
    await runtime.call("workflow_run", {
      action: "start",
      workflow: name,
      input,
    }),
  );
  for (;;) {
    const status = z.object({ status: z.string() }).parse(
      await runtime.call("workflow_run", {
        action: "status",
        run_id,
        wait_ms: 1000,
      }),
    );
    if (status.status === "succeeded") return { run_id, status: status.status };
    assert.ok(
      ["queued", "running"].includes(status.status),
      `Workflow ended in ${status.status}`,
    );
    await delay(20);
  }
}
try {
  const metadata = z
    .object({ data: z.object({ platformVersion: z.string() }) })
    .parse(
      readObject(path.join(discoverToolchain().sdk, "default/sdk-pkg.json")),
    );
  await observe("project_create", () =>
    workflow("project_create", {
      project_path: project,
      app_name: "MCPAcceptance",
      bundle_name: bundle,
      sdk_version: metadata.data.platformVersion,
    }),
  );
  atomicWrite(
    path.join(project, "entry/src/main/ets/pages/Index.ets"),
    `@Entry
@Component
struct Index {
  @State message: string = 'MCP 验收就绪';
  @State input: string = '';
  build() {
    Column({ space: 16 }) {
      Text(this.message).id('mcp-status').fontSize(24)
      TextInput({ placeholder: '请输入中文', text: this.input })
        .id('mcp-input').onChange((value: string) => { this.input = value; })
      Button('确认输入').id('mcp-confirm').onClick(() => { this.message = this.input; })
      Text(this.input).id('mcp-mirror').fontSize(20)
    }.width('100%').padding(24)
  }
}
`,
  );
  await observe("project_build", () =>
    workflow("project_build", { project_path: project }),
  );
  const packages = await observe("unsigned_package_identity", async () => {
    const artifacts = runtime.projects.buildArtifacts(
      runtime.projects.resolve(project),
    );
    assert.ok(artifacts.length > 0);
    await inspectApplicationPackages(
      artifacts.map((item) => item.path),
      { bundle_name: bundle, module: "entry", ability: "EntryAbility" },
    );
    return artifacts;
  });
  await observe("keypair", () =>
    runtime.signatures.call({
      action: "keypair",
      output: keystore,
      options: {
        keyAlias: signingName,
        keystorePwd: password,
        keyPwd: password,
      },
    }),
  );
  await observe("certificate_request", async () => {
    await runtime.signatures.call({
      action: "csr",
      output: csr,
      options: {
        keyAlias: signingName,
        keystoreFile: keystore,
        subject: "CN=Native MCP Acceptance",
        signAlg: "SHA256withECDSA",
        keystorePwd: password,
        keyPwd: password,
      },
    });
    validateCsrPem(fs.readFileSync(csr, "utf8"));
    return { sha256: fileDigest(csr), bytes: fs.statSync(csr).size };
  });
  // This local private file is deliberately separate from shareable evidence.
  atomicWrite(
    path.join(root, "signing.private.json"),
    JSON.stringify({ password, key_alias: signingName, keystore }, null, 2),
  );
  fs.chmodSync(path.join(root, "signing.private.json"), 0o600);
  atomicWrite(
    path.join(root, "prepared.json"),
    JSON.stringify(
      {
        bundle_name: bundle,
        project_path: project,
        module: "entry",
        ability: "EntryAbility",
        certificate_name: signingName,
        profile_name: signingName,
        csr,
        csr_sha256: fileDigest(csr),
        packages,
      },
      null,
      2,
    ),
  );
  process.stdout.write(
    "Local signing preparation complete; no cloud or device changes.\n",
  );
} finally {
  await observe("runtime_shutdown", async () => {
    const closed = await runtime.close();
    assert.equal(closed.closed, true);
    return closed;
  });
}
