import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StateStore } from "../src/core/store.js";
import { ProcessService, type Command } from "../src/core/process.js";
import { AuthService } from "../src/services/auth.js";
import { SignatureService, certificateForCsr } from "../src/services/signature.js";
import { atomicWrite, fileDigest } from "../src/core/files.js";

test("CSR identity selects the matching certificate in any chain order and rejects absent or duplicated keys", () => {
  const root = fileURLToPath(new URL("../../test/fixtures/certificate-key/", import.meta.url)),
    csr = fs.readFileSync(path.join(root, "request.pem"), "utf8"),
    matching = fs.readFileSync(path.join(root, "matching.pem")), other = fs.readFileSync(path.join(root, "other.pem"));
  const expected = certificateForCsr(matching, csr);
  for (const chain of [Buffer.concat([other, matching]), Buffer.concat([matching, other]), expected.raw])
    assert.equal(certificateForCsr(chain, csr).fingerprint256, expected.fingerprint256);
  assert.throws(() => certificateForCsr(other, csr), { code: "CERT_KEY_MISMATCH" });
  assert.throws(() => certificateForCsr(Buffer.concat([matching, matching]), csr), { code: "CERT_KEY_MISMATCH" });
  assert.throws(() => certificateForCsr(Buffer.concat([matching, Buffer.from("unexpected suffix")]), csr), { code: "CERT_CHAIN_INVALID" });
});

test("signature verification supplies required SDK output paths, checks both extracts, and releases its bounded directory on failure", async (t) => {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "deveco-signature-")),
  );
  const store = new StateStore(path.join(root, "state")),
    processes = new ProcessService(),
    auth = new AuthService(store, processes);
  const signatures = new SignatureService(processes, store, auth),
    config = process.env.DEVECO_CONFIG;
  const clt = path.join(root, "clt"),
    java = path.join(root, "jdk"),
    input = path.join(root, "input.hap");
  atomicWrite(
    path.join(java, "bin", process.platform === "win32" ? "java.exe" : "java"),
    "fixture",
  );
  atomicWrite(
    path.join(clt, "sdk/default/openharmony/toolchains/lib/hap-sign-tool.jar"),
    "fixture",
  );
  atomicWrite(
    path.join(root, "config.json"),
    JSON.stringify({ clt, java_home: java }),
  );
  atomicWrite(input, "signed fixture");
  process.env.DEVECO_CONFIG = path.join(root, "config.json");
  let omitProfile = false,
    outputDirectory = "",
    expected: Record<string, string> = {};
  t.mock.method(processes, "run", async (command: Command) => {
    assert.equal(command.args[2], "verify-app");
    assert.equal(command.args[command.args.indexOf("-inFile") + 1], input);
    const cert = command.args[command.args.indexOf("-outCertChain") + 1]!,
      profile = command.args[command.args.indexOf("-outProfile") + 1]!;
    assert.ok(
      command.args.includes("-outCertChain") &&
        command.args.includes("-outProfile"),
    );
    outputDirectory = path.dirname(cert);
    assert.equal(path.dirname(profile), outputDirectory);
    assert.notEqual(outputDirectory, root);
    fs.writeFileSync(cert, "certificate fixture");
    expected = { certificate_chain_sha256: fileDigest(cert) };
    if (!omitProfile) {
      fs.writeFileSync(profile, "profile fixture");
      expected.profile_sha256 = fileDigest(profile);
    }
    return {
      exitCode: 0,
      signal: null,
      stdout: "Verification successful",
      stderr: "",
      truncated: false,
      elapsedMs: 1,
      pid: null,
    };
  });
  try {
    const result = await signatures.call({ action: "verify", file: input });
    assert.deepEqual(result, {
      action: "verify",
      completed: true,
      verified: true,
      ...expected,
    });
    assert.equal(fs.existsSync(outputDirectory), false);
    omitProfile = true;
    await assert.rejects(signatures.call({ action: "verify", file: input }), {
      code: "SIGN_VERIFY_OUTPUT_MISSING",
    });
    assert.equal(fs.existsSync(outputDirectory), false);
    assert.deepEqual(
      store.db
        .prepare("SELECT count(*) AS count FROM native_directories")
        .get(),
      { count: 0 },
    );
  } finally {
    if (config === undefined) delete process.env.DEVECO_CONFIG;
    else process.env.DEVECO_CONFIG = config;
    await auth.close();
    await processes.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
