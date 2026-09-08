import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  atomicWrite,
  destinationPath,
  fileDigest,
  readObject,
  publishFile,
} from "../core/files.js";
import { invariant, object, ToolError } from "../core/errors.js";
import { inspectProject, type Project } from "./project.js";
import { assertNoHotWatch } from "./hvigor/hot-config.js";
import { createSigningMaterial } from "./signing-material.js";

const descriptorSchema = z.strictObject({
  keystoreFile: z.string().min(1),
  keystorePwd: z.string().min(1).max(4096),
  keyPwd: z.string().min(1).max(4096),
  keyAlias: z.string().min(1),
  appCertFile: z.string().min(1),
  profileFile: z.string().min(1),
  signAlg: z
    .enum([
      "SHA256withECDSA",
      "SHA384withECDSA",
      "SHA256withRSA",
      "SHA384withRSA",
      "SHA512withRSA",
    ])
    .default("SHA256withECDSA"),
});

/** Called under the canonical project lease. Publish private material before the
 * atomic configuration commit, retaining it if the commit's outcome is unclear. */
export async function configureSigning(
  project: Project,
  descriptor: string,
  destination: string,
  name: string,
  signal?: AbortSignal,
) {
  z.string()
    .regex(/^[A-Za-z0-9]{1,64}$/)
    .parse(name);
  const unchanged = () =>
    invariant(
      inspectProject(project.root, project.product.name).fingerprint ===
        project.fingerprint,
      "SIGN_PROJECT_CHANGED",
      "Project configuration changed; submit again with current inputs",
    );
  signal?.throwIfAborted();
  assertNoHotWatch(project);
  unchanged();
  const file = path.join(project.root, "build-profile.json5"),
    before = fileDigest(file),
    profile = readObject(file),
    app = object(profile.app),
    configs = z
      .array(z.object({ name: z.string() }).passthrough())
      .parse(app.signingConfigs ?? []),
    products = z
      .array(z.object({ name: z.string() }).passthrough())
      .parse(app.products),
    selected = products.find(
      (product) => product.name === project.product.name,
    );
  invariant(selected, "PRODUCT_AMBIGUOUS", "Selected product is missing");
  invariant(
    !configs.some((config) => config.name === name),
    "SIGN_CONFIG_EXISTS",
    "Use a new signing configuration name; existing configurations are not overwritten",
  );
  const descriptorPath = fs.realpathSync.native(path.resolve(descriptor));
  invariant(
    fs.statSync(descriptorPath).isFile() &&
      fs.statSync(descriptorPath).size <= 65536,
    "SIGN_DESCRIPTOR_INVALID",
    "Signing descriptor must be a regular JSON file of at most 64 KiB",
  );
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(descriptorPath, "utf8")) as unknown;
  } catch {
    throw new ToolError(
      "SIGN_DESCRIPTOR_INVALID",
      "Could not read a valid private signing JSON descriptor",
    );
  }
  const input = descriptorSchema.parse(raw),
    output = destinationPath(destination);
  const sources = [
    ["storeFile", "signing.p12", input.keystoreFile],
    ["certpath", "certificate.cer", input.appCertFile],
    ["profile", "profile.p7b", input.profileFile],
  ] as const;
  for (const [, , source] of sources) {
    const stat = fs.statSync(
      path.resolve(path.dirname(descriptorPath), source),
    );
    invariant(
      stat.isFile() && stat.size > 0 && stat.size <= 16 * 1024 * 1024,
      "SIGN_FILE_INVALID",
      "Each signing input must be a nonempty regular file of at most 16 MiB",
    );
  }
  fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
  fs.mkdirSync(output, { mode: 0o700 }); // Exclusive ownership, never reuse an existing directory.
  let committing = false;
  try {
    const material: Record<string, string> = {
      keyAlias: input.keyAlias,
      signAlg: input.signAlg,
    };
    const copied: Record<string, { bytes: number; sha256: string }> = {};
    for (const [field, filename, source] of sources) {
      material[field] = path.join(output, filename);
      copied[field] = await publishFile(
        path.resolve(path.dirname(descriptorPath), source),
        material[field],
        signal,
      );
    }
    Object.assign(
      material,
      createSigningMaterial(path.join(output, "material"), input),
    );
    configs.push({ name, type: project.product.runtimeOS, material });
    selected.signingConfig = name;
    app.signingConfigs = configs;
    app.products = products;
    signal?.throwIfAborted();
    unchanged();
    invariant(
      fileDigest(file) === before,
      "SIGN_PROJECT_CHANGED",
      "Build profile changed during preparation",
    );
    committing = true;
    atomicWrite(file, JSON.stringify(profile, null, 2) + "\n");
    return {
      configured: true,
      product: project.product.name,
      name,
      directory: output,
      build_profile_sha256: fileDigest(file),
      files: copied,
    };
  } finally {
    // A failed fsync may follow a successful rename: keep material once commit starts.
    if (!committing) fs.rmSync(output, { recursive: true, force: true });
  }
}
