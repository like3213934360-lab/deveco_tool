import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { z } from "zod";
import { tools, signingConfigurationOptionsSchema } from "../core/contracts.js";
import { ProcessService } from "../core/process.js";
import { StateStore } from "../core/store.js";
import { NativeDirectory } from "../core/native-directory.js";
import {
  component,
  discoverToolchain,
  toolCommand,
} from "../core/toolchain.js";
import {
  atomicWrite,
  digest,
  readObject,
  publishFile,
  fileDigest,
} from "../core/files.js";
import { invariant, object, ToolError, SettledEffectError } from "../core/errors.js";
import { AuthService, httpRequest, httpBytes } from "./auth.js";
import type { Project } from "./project.js";
import { decryptMaterial } from "./signing-material.js";
import { configureSigning } from "./signing-config.js";
import { preparePublication, completePublication, publicationSchema } from "../core/publication.js";

/** Validate the PKCS#10 PEM envelope; the signing provider verifies the request signature. */
export function validateCsrPem(value: string): string {
  invariant(
    Buffer.byteLength(value) <= 256 * 1024,
    "CSR_INVALID",
    "CSR exceeds 256 KiB",
  );
  const match =
    /^-----BEGIN (CERTIFICATE REQUEST|NEW CERTIFICATE REQUEST)-----\r?\n([A-Za-z0-9+/=\r\n]+)\r?\n-----END \1-----\s*$/.exec(
      value.trim(),
    );
  invariant(
    match?.[2],
    "CSR_INVALID",
    "Expected one PEM certificate request with matching labels",
  );
  const encoded = match[2].replace(/[\r\n]/g, "");
  const der = Buffer.from(encoded, "base64");
  invariant(
    der.length > 4 && der[0] === 0x30 && der.toString("base64") === encoded,
    "CSR_INVALID",
    "Expected a canonical base64 DER certificate request",
  );
  const lengthByte = der[1]!;
  let length = lengthByte,
    offset = 2;
  if (lengthByte >= 0x80) {
    const bytes = lengthByte & 0x7f;
    invariant(
      bytes > 0 && bytes <= 3 && der.length > 2 + bytes,
      "CSR_INVALID",
      "Invalid DER length",
    );
    length = der.readUIntBE(2, bytes);
    offset += bytes;
    invariant(
      length >= 128 && der[2] !== 0,
      "CSR_INVALID",
      "Non-canonical DER length",
    );
  }
  invariant(
    offset + length === der.length,
    "CSR_INVALID",
    "Truncated or trailing DER request data",
  );
  return value.trim() + "\n";
}

/** Extract SubjectPublicKeyInfo from the bounded PKCS#10 DER structure. */
export function csrPublicKey(pem: string) {
  const encoded = validateCsrPem(pem).split("\n").slice(1, -2).join("");
  const bytes = Buffer.from(encoded, "base64");
  const field = (offset: number, end: number) => {
    const start = offset, tag = bytes[offset++], first = bytes[offset++];
    invariant(tag !== undefined && first !== undefined && offset <= end, "CSR_INVALID", "Truncated CSR field");
    let length = first;
    if (first >= 128) {
      const count = first & 127;
      invariant(count > 0 && count <= 3 && offset + count <= end && bytes[offset] !== 0, "CSR_INVALID", "Invalid CSR field length");
      length = bytes.readUIntBE(offset, count); offset += count;
      invariant(length >= 128, "CSR_INVALID", "Noncanonical CSR field length");
    }
    invariant(offset + length <= end, "CSR_INVALID", "CSR field exceeds its parent");
    return { start, tag, content: offset, end: offset + length };
  };
  const outer = field(0, bytes.length), info = field(outer.content, outer.end);
  invariant(outer.tag === 48 && info.tag === 48, "CSR_INVALID", "Expected CSR sequences");
  const version = field(info.content, info.end), subject = field(version.end, info.end), key = field(subject.end, info.end);
  invariant(version.tag === 2 && subject.tag === 48 && key.tag === 48, "CSR_INVALID", "Invalid CSR request info");
  return crypto.createPublicKey({ key: bytes.subarray(key.start, key.end), format: "der", type: "spki" });
}
/** Providers may return a root-first PEM chain. Match the CSR's key against
 * exactly one certificate, without assuming the first certificate is the leaf. */
export function certificateForCsr(bytes: Buffer, csr: string): crypto.X509Certificate {
  invariant(bytes.length <= 1024 * 1024, "CERT_CHAIN_INVALID", "Certificate chain exceeds 1 MiB");
  const pem = bytes.toString("utf8"), blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
  invariant(!blocks || (blocks.length <= 16 && pem.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g, "").trim() === ""), "CERT_CHAIN_INVALID", "Expected a bounded PEM certificate chain");
  const certificates = (blocks ?? [bytes]).map((value) => new crypto.X509Certificate(value)),
    key = csrPublicKey(csr).export({ format: "der", type: "spki" }),
    matches = certificates.filter((cert) => cert.publicKey.export({ format: "der", type: "spki" }).equals(key));
  invariant(matches.length === 1, "CERT_KEY_MISMATCH", "Expected exactly one certificate matching the submitted CSR public key");
  return matches[0]!;
}
const configurationCommit = z.object({ result: z.record(z.string(), z.unknown()), before: z.string(), content: z.string(), files: z.array(publicationSchema).max(64) });
function signatureIdentity(input: z.infer<typeof tools.app_signature.schema>, project?: Project) {
  return { input, project: project?.root, product: project?.product.name };
}
const certificateSchema = z.object({
  id: z.string(),
  certName: z.string(),
  certObjectId: z.string(),
});
const cloudBase = "https://connect-api.cloud.huawei.com";
export class SignatureService {
  constructor(
    readonly processes: ProcessService,
    readonly store: StateStore,
    readonly auth: AuthService,
  ) {}
  async call(
    raw: unknown,
    project?: Project,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const input = tools.app_signature.schema.parse(raw);
    if (["inspect", "verify", "certificates", "devices", "certificate_create", "certificate_delete", "profile_create", "profile_delete", "device_register"].includes(input.action)) return this.callNative(input, project, signal);
    const identity = signatureIdentity(input, project);
    const execute = async () => object(await this.callNative(input, project, signal));
    return this.store.privateEffect("native-signature", identity, execute, object, async () => {
      if (input.action === "configure") {
        const prepared = await this.store.readPrivateMemo("sign-config-commit", identity, (raw) => configurationCommit.parse(raw));
        if (!prepared || !project || !input.output) {
          if (input.output && !fs.existsSync(input.output)) return execute();
          return undefined;
        }
        const profile = path.join(project.root, "build-profile.json5");
        const hash = fileDigest(profile);
        invariant(hash === prepared.before || hash === prepared.result.build_profile_sha256, "SIGN_PROJECT_CHANGED", "Build profile changed outside the prepared signing commit");
        for (const file of prepared.files) await completePublication(this.store, file, signal);
        signal?.throwIfAborted();
        if (hash === prepared.before) {
          invariant(fileDigest(profile) === prepared.before, "SIGN_PROJECT_CHANGED", "Build profile changed during signing recovery");
          atomicWrite(profile, prepared.content);
        }
        return { ...prepared.result, recovered: true };
      }
      const publication = await this.store.readPrivateMemo("sign-publication", identity, (value) => publicationSchema.parse(value));
      if (!publication) return input.output && !fs.existsSync(input.output) ? execute() : undefined;
      return { ...(await completePublication(this.store, publication, signal)), action: input.action, completed: true, recovered: true };
    });
  }
  private async callNative(raw: unknown, project?: Project, signal?: AbortSignal): Promise<unknown> {
    const input = tools.app_signature.schema.parse(raw);
    const identity = signatureIdentity(structuredClone(input), project);
    if (input.action === "configure") {
      invariant(
        project && input.file && input.output,
        "SIGN_CONFIG_INPUT_REQUIRED",
        "Configure requires a project, private descriptor file and new output directory",
      );
      const options = signingConfigurationOptionsSchema.parse(input.options);
      return this.store.lease(
        `project:${project.root}`,
        () =>
          configureSigning(
            project,
            input.file!,
            input.output!,
            options.name,
            signal,
            (result, plan) => this.store.privateMemo("sign-config-commit", identity, async () => {
              const files: z.infer<typeof publicationSchema>[] = [];
              for (const file of plan.files) files.push(await preparePublication(this.store, file.source, file.path, true, signal));
              return { result, before: plan.before, content: plan.content, files };
            }, (raw) => configurationCommit.parse(raw)),
          ),
        signal,
      );
    }
    if (
      [
        "certificates",
        "certificate_create",
        "certificate_delete",
        "profile_create",
        "profile_delete",
        "devices",
        "device_register",
      ].includes(input.action)
    )
      return this.cloud(input, signal);
    if (input.action === "inspect") {
      invariant(
        project,
        "PROJECT_REQUIRED",
        "Signing inspection requires a project",
      );
      const profile = readObject(
        path.join(project.root, "build-profile.json5"),
      );
      const app = object(profile.app);
      const configs = z
        .array(
          z.object({
            name: z.string(),
            material: z.record(z.string(), z.unknown()),
          }),
        )
        .parse(app.signingConfigs ?? []);
      return {
        product: project.product.name,
        selected: project.product.signingConfig ?? null,
        configurations: configs.map((config) => ({
          name: config.name,
          files: Object.fromEntries(
            ["storeFile", "certpath", "profile"].map((key) => [
              key,
              typeof config.material[key] === "string"
                ? {
                    path: config.material[key],
                    exists: fs.existsSync(
                      path.resolve(project.root, String(config.material[key])),
                    ),
                  }
                : null,
            ]),
          ),
        })),
      };
    }
    const opts = input.options,
      args: string[] = [];
    const allowed: Record<string, readonly string[]> = {
      keypair: ["keyAlias", "keyAlg", "keySize", "keystorePwd", "keyPwd"],
      csr: [
        "keyAlias",
        "subject",
        "signAlg",
        "keystoreFile",
        "keystorePwd",
        "keyPwd",
      ],
      sign: [
        "keyAlias",
        "keyPwd",
        "keystoreFile",
        "keystorePwd",
        "appCertFile",
        "profileFile",
        "signAlg",
      ],
      verify: [],
    };
    for (const key of Object.keys(opts))
      invariant(
        allowed[input.action]?.includes(key),
        "SIGN_OPTION_INVALID",
        `Unsupported option: ${key}`,
      );
    let output: string | undefined;
    if (input.action !== "verify") {
      invariant(
        input.output,
        "SIGN_OUTPUT_REQUIRED",
        "Specify a new output path",
      );
      output = this.outputPath(input.output);
    }
    const scope = new NativeDirectory(
      this.store,
      input.action === "sign" && input.file
        ? fs.statSync(input.file).size * 2 + 16 * 1024 * 1024
        : 1024 * 1024,
    );
    const stage = scope?.file;
    const staged =
      stage && output ? path.join(stage, path.basename(output)) : undefined;
    try {
      if (input.action === "keypair")
        args.push(
          "generate-keypair",
          "-keyAlias",
          opts.keyAlias ?? "debugKey",
          "-keyAlg",
          opts.keyAlg ?? "ECC",
          "-keySize",
          opts.keySize ?? "NIST-P-256",
          "-keystoreFile",
          staged!,
        );
      else if (input.action === "csr")
        args.push("generate-csr", "-outFile", staged!);
      else if (input.action === "sign") {
        invariant(
          input.file && fs.existsSync(input.file),
          "SIGN_INPUT_REQUIRED",
          "Input package is missing",
        );
        args.push(
          "sign-app",
          "-mode",
          "localSign",
          "-inFile",
          path.resolve(input.file),
          "-outFile",
          staged!,
        );
        if (Object.keys(opts).length === 0) {
          invariant(
            project,
            "SIGN_MATERIAL_REQUIRED",
            "Supply signing options or a configured project",
          );
          Object.assign(opts, this.projectOptions(project));
        }
      } else {
        invariant(
          input.file && fs.existsSync(input.file),
          "SIGN_INPUT_REQUIRED",
          "Input package is missing",
        );
        args.push(
          "verify-app",
          "-inFile",
          path.resolve(input.file),
          "-outCertChain",
          path.join(scope.file, "certificate-chain.cer"),
          "-outProfile",
          path.join(scope.file, "profile.p7b"),
        );
      }
      for (const [key, value] of Object.entries(opts)) {
        if (
          input.action === "keypair" &&
          ["keyAlias", "keyAlg", "keySize"].includes(key)
        )
          continue;
        args.push(`-${key}`, value);
      }
      const execute = () =>
        this.processes.run(
          toolCommand(discoverToolchain(), "signer", args, project?.root),
          { signal: scope?.signal(signal) ?? signal, timeoutMs: 120000 },
        );
      const result = await (scope ? scope.own(execute) : execute());
      await scope?.check();
      invariant(
        !/ERROR|FAILED|Exception/.test(result.stdout + result.stderr),
        "SIGN_FAILED",
        "Native signing tool rejected the request",
      );
      let published: Awaited<ReturnType<typeof publishFile>> | undefined;
      const verifiedFiles: Record<string, string> = {};
      if (input.action === "verify") {
        for (const [name, file] of Object.entries({
          certificate_chain_sha256: "certificate-chain.cer",
          profile_sha256: "profile.p7b",
        })) {
          const extracted = path.join(scope.file, file);
          invariant(
            fs.existsSync(extracted) && fs.statSync(extracted).size > 0,
            "SIGN_VERIFY_OUTPUT_MISSING",
            "Verification did not extract certificate chain and profile",
          );
          verifiedFiles[name] = fileDigest(extracted);
        }
      }
      if (output && staged) {
        invariant(
          fs.existsSync(staged) && fs.statSync(staged).size > 0,
          "SIGN_OUTPUT_MISSING",
          "Signing tool produced no output",
        );
        const prepared = await this.store.privateMemo("sign-publication", identity, () => preparePublication(this.store, staged, output!, input.action !== "sign", signal), (value) => publicationSchema.parse(value));
        published = await completePublication(this.store, prepared, signal);
      }
      return {
        action: input.action,
        completed: true,
        ...(output
          ? {
              path: output,
              ...published,
            }
          : { verified: true, ...verifiedFiles }),
      };
    } catch (error) {
      if (error instanceof ToolError && error.code === "CANCEL_UNCONFIRMED")
        throw error;
      if (scope?.controller.signal.aborted)
        throw scope.controller.signal.reason;
      throw error;
    } finally {
      await scope?.close();
    }
  }
  private outputPath(candidate: string): string {
    const output = path.resolve(candidate);
    invariant(
      !fs.lstatSync(output, { throwIfNoEntry: false }),
      "SIGN_OUTPUT_EXISTS",
      "Signing output already exists",
    );
    fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
    return path.join(
      fs.realpathSync.native(path.dirname(output)),
      path.basename(output),
    );
  }
  projectOptions(project: Project): Record<string, string> {
    const app = object(
        readObject(path.join(project.root, "build-profile.json5")).app,
      ),
      config = z
        .array(
          z.object({
            name: z.string(),
            material: z.object({
              storeFile: z.string(),
              storePassword: z.string(),
              keyAlias: z.string(),
              keyPassword: z.string(),
              certpath: z.string(),
              profile: z.string(),
              signAlg: z.string().default("SHA256withECDSA"),
            }),
          }),
        )
        .parse(app.signingConfigs)
        .find((item) => item.name === project.product.signingConfig);
    invariant(
      config,
      "SIGN_CONFIG_MISSING",
      "Selected product has no matching signing configuration",
    );
    const material = path.join(
      path.dirname(path.resolve(project.root, config.material.storeFile)),
      "material",
    );
    invariant(
      fs.existsSync(material),
      "SIGN_MATERIAL_MISSING",
      "Studio signing material is missing beside the selected keystore",
    );
    return {
      keyAlias: config.material.keyAlias,
      keyPwd: decryptMaterial(material, config.material.keyPassword),
      keystoreFile: path.resolve(project.root, config.material.storeFile),
      keystorePwd: decryptMaterial(material, config.material.storePassword),
      appCertFile: path.resolve(project.root, config.material.certpath),
      profileFile: path.resolve(project.root, config.material.profile),
      signAlg: config.material.signAlg,
    };
  }
  private async request(
    team: string,
    route: string,
    method: string,
    body: unknown,
    signal?: AbortSignal,
    reconcile?: () => Promise<Record<string, unknown> | undefined>,
  ): Promise<Record<string, unknown>> {
    const execute = () => this.requestOnce(team, route, method, body, signal);
    const read = method === "GET" || route.endsWith("/list") || route.endsWith("/reapply");
    return read ? execute() : this.store.privateEffect(`cloud:${digest({ team, route, method, body })}`, { team, route, method, body }, execute, object, reconcile);
  }
  private async requestOnce(team: string, route: string, method: string, body: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
    let auth = await this.auth.credentials("developer", signal);
    let response: string;
    try {
      const send = () => httpRequest(
        cloudBase + route,
        {
          method,
          headers: {
            uid: auth.userId,
            teamId: team,
            oauth2Token: auth.access,
            "Content-Type": "application/json",
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
        signal,
      );
      try { response = await send(); } catch (error) {
        // HTTP 401 confirms rejection before authentication. No timeout/5xx mutation is retried.
        if (!(error instanceof ToolError && error.code === "HTTP_ERROR" && object(error.details).status === 401)) throw error;
        auth = await this.auth.credentials("developer", signal, true);
        response = await send();
      }
    } catch (error) {
      if (error instanceof ToolError && error.code === "HTTP_ERROR")
        throw new ToolError(error.code, error.message, {
          ...object(error.details),
          stage: route.endsWith("/reapply") ? "download_url" : "cloud_request",
        });
      throw error;
    }
    const data = object(JSON.parse(response) as unknown);
    if (data.ret !== undefined) {
      const ret = z
        .object({ code: z.number(), msg: z.string().optional() })
        .parse(data.ret);
      if (ret.code !== 0) throw new SettledEffectError("SIGN_CLOUD_REJECTED", `Cloud signing rejected request (${ret.code}): ${ret.msg ?? ""}`);
    } else
      invariant(
        method === "GET" ||
          route.endsWith("/list") ||
          route.endsWith("/reapply"),
        "SIGN_CLOUD_UNCONFIRMED",
        "Cloud response did not confirm mutation",
      );
    return data;
  }
  private async download(
    team: string,
    source: string,
    output: string,
    signal?: AbortSignal,
  ) {
    const reply = await this.request(
      team,
      "/api/amis/app-manage/v1/objects/url/reapply",
      "POST",
      { sourceUrls: source },
      signal,
    );
    const urls = z
      .array(
        z.object({
          newUrl: z.url(),
          sha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
        }),
      )
      .min(1)
      .parse(reply.urlsInfo);
    const first = urls[0]!;
    const expected = await this.store.privateMemo("download", { team, source, output }, async () => {
      invariant(!fs.existsSync(output), "SIGN_OUTPUT_EXISTS", "Download output already exists");
      return { sha256: first.sha256.toLowerCase() };
    }, (value) => z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/) }).parse(value));
    invariant(expected.sha256 === first.sha256.toLowerCase(), "SIGN_DOWNLOAD_CHANGED", "Cloud signing object changed since submission");
    if (fs.existsSync(output)) {
      const stat = fs.lstatSync(output);
      invariant(stat.isFile() && !stat.isSymbolicLink() && fileDigest(output) === expected.sha256, "SIGN_OUTPUT_CHANGED", "Published signing material changed");
      return { path: output, sha256: expected.sha256, bytes: stat.size };
    }
    invariant(
      new URL(first.newUrl).protocol === "https:",
      "SIGN_DOWNLOAD_URL_INVALID",
      "Expected HTTPS download",
    );
    let bytes: Buffer;
    try {
      bytes = await httpBytes(first.newUrl, {}, signal);
    } catch (error) {
      if (error instanceof ToolError && error.code === "HTTP_ERROR")
        throw new ToolError(error.code, error.message, {
          ...object(error.details),
          stage: "download_file",
        });
      throw error;
    }
    invariant(
      crypto.createHash("sha256").update(bytes).digest("hex") ===
        first.sha256.toLowerCase(),
      "SIGN_DOWNLOAD_HASH",
      "Downloaded signing file failed digest verification",
    );
    atomicWrite(output, bytes, false);
    return { path: output, sha256: first.sha256, bytes: bytes.length };
  }
  private async cloud(
    input: z.infer<typeof tools.app_signature.schema>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    invariant(input.team_id, "TEAM_REQUIRED", "Specify a developer team_id");
    const team = input.team_id,
      opts = input.options;
    const allowed: Record<string, string[]> = {
      certificates: [],
      certificate_create: ["cert_name"],
      certificate_delete: ["cert_id"],
      profile_create: [
        "cert_ids",
        "bundle_name",
        "device_ids",
        "profile_name",
        "acl_permissions",
        "kind",
      ],
      profile_delete: ["profile_id"],
      devices: [],
      device_register: ["udid", "device_name", "device_type"],
    };
    for (const key of Object.keys(opts))
      invariant(
        allowed[input.action]?.includes(key),
        "SIGN_OPTION_INVALID",
        `Unsupported cloud signing option: ${key}`,
      );
    if (["certificate_create", "profile_create"].includes(input.action)) {
      invariant(
        input.output,
        "SIGN_OUTPUT_REQUIRED",
        "Output file is required",
      );
      input.output = await this.store.privateMemo("cloud-output", { output: input.output }, async () => this.outputPath(input.output!), (value) => z.string().parse(value));
    }
    return this.store.lease(
      `signing:${team}`,
      async () => {
        const certificates = async () => {
          const result = z
            .array(certificateSchema)
            .safeParse(
              (
                await this.request(
                  team,
                  "/api/cps/harmony-cert-manage/v1/cert/list",
                  "POST",
                  undefined,
                  signal,
                )
              ).certList,
            );
          invariant(
            result.success,
            "SIGN_CLOUD_RESPONSE_INVALID",
            "Cloud service returned an invalid certificate inventory",
          );
          return result.data;
        };
        const devices = async () => {
          const devices: { id: string; udid: string; deviceName: string }[] =
            [];
          const seen = new Set<string>();
          let total: number | undefined;
          for (let page = 1; page <= 100; page++) {
            const response = await this.request(
              team,
              `/api/cps/device-manage/v1/device/list?encodeFlag=0&start=${page}&pageSize=100`,
              "GET",
              undefined,
              signal,
            );
            const result = z
              .object({
                list: z
                  .array(
                    z.object({
                      id: z.string().min(1),
                      udid: z.string(),
                      deviceName: z.string(),
                    }),
                  )
                  .max(100),
                totalCount: z.number().int().nonnegative(),
              })
              .safeParse(response);
            invariant(
              result.success,
              "SIGN_CLOUD_RESPONSE_INVALID",
              "Cloud service returned an invalid device inventory",
            );
            const data = result.data;
            total ??= data.totalCount;
            invariant(
              total === data.totalCount,
              "SIGN_INVENTORY_CHANGED",
              "Device inventory changed during pagination; repeat the read",
            );
            for (const device of data.list) {
              invariant(
                !seen.has(device.id),
                "SIGN_PAGINATION_INVALID",
                "Device inventory repeated an item during pagination",
              );
              seen.add(device.id);
              devices.push(device);
            }
            invariant(
              devices.length <= total,
              "SIGN_PAGINATION_INVALID",
              "Device inventory exceeds its declared total",
            );
            if (devices.length === total) return devices;
            invariant(
              data.list.length > 0,
              "SIGN_PAGINATION_INVALID",
              "Incomplete device inventory",
            );
          }
          invariant(
            false,
            "SIGN_PAGINATION_LIMIT",
            "Device inventory exceeds 100 pages",
          );
        };
        const required = (name: string) => {
          const value = opts[name];
          invariant(value, "SIGN_OPTION_REQUIRED", `Missing option: ${name}`);
          return value;
        };
        if (input.action === "certificates")
          return { certificates: await certificates() };
        if (input.action === "certificate_delete") {
          const id = required("cert_id");
          await this.request(
            team,
            "/api/cps/harmony-cert-manage/v1/cert/delete",
            "DELETE",
            { certIds: [id] },
            signal,
            async () => !(await certificates()).some((cert) => cert.id === id) ? { ret: { code: 0 }, reconciled: true } : undefined,
          );
          invariant(
            !(await certificates()).some((cert) => cert.id === id),
            "SIGN_DELETE_UNCONFIRMED",
            "Certificate remains in inventory",
          );
          return { deleted: true, id };
        }
        if (input.action === "certificate_create") {
          invariant(
            input.file && input.output,
            "CERT_FILES_REQUIRED",
            "CSR input and certificate output paths required",
          );
          invariant(
            fs.statSync(input.file).size <= 256 * 1024,
            "CSR_INVALID",
            "CSR exceeds 256 KiB",
          );
          const csr = validateCsrPem(fs.readFileSync(input.file, "utf8"));
          const name = required("cert_name");
          await this.store.privateMemo("certificate-name", { team, name, csr }, async () => {
            invariant(!(await certificates()).some((cert) => cert.certName === name), "CERT_EXISTS", "A certificate with this name already exists");
            return { available: true };
          }, (value) => z.object({ available: z.literal(true) }).parse(value));
          await this.request(
            team,
            "/api/cps/harmony-cert-manage/v1/cert/add",
            "POST",
            { csr, certName: name, certType: "1" },
            signal,
            async () => (await certificates()).filter((cert) => cert.certName === name).length === 1 ? { ret: { code: 0 }, reconciled: true } : undefined,
          );
          const cert = (await certificates()).find(
            (cert) => cert.certName === name,
          );
          invariant(
            cert,
            "CERT_CREATE_UNCONFIRMED",
            "Created certificate not found",
          );
          const file = await this.download(
            team,
            cert.certObjectId,
            path.resolve(input.output),
            signal,
          );
          const x509 = certificateForCsr(fs.readFileSync(file.path), csr);
          return {
            certificate_id: cert.id,
            ...file,
            valid_from: x509.validFrom,
            valid_to: x509.validTo,
          };
        }
        if (input.action === "profile_create") {
          invariant(
            input.output,
            "PROFILE_OUTPUT_REQUIRED",
            "Profile output required",
          );
          const list = (key: string) =>
            z
              .array(z.string().min(1))
              .min(1)
              .parse(JSON.parse(required(key)) as unknown);
          const body = {
            certList: list("cert_ids"),
            packageName: required("bundle_name"),
            deviceList: list("device_ids"),
            provisionName: required("profile_name"),
            ...(opts.acl_permissions
              ? { aclPermissionList: list("acl_permissions") }
              : {}),
          };
          // The modern IDE automatic debug signing protocol uses test profiles.
          const kind = opts.kind ?? "test";
          invariant(
            ["real", "test"].includes(kind),
            "PROFILE_KIND_INVALID",
            "Profile kind must be real or test",
          );
          const response = await this.request(
            team,
            `/api/cps/provision-manage/v1/ide/${kind}/provision/add`,
            "POST",
            body,
            signal,
          );
          const parsed = z
            .object({
              id: z.string().min(1).optional(),
              provisionFileUrl: z.string().min(1),
            })
            .parse(response);
          invariant(
            kind === "test" || parsed.id,
            "PROFILE_ID_UNCONFIRMED",
            "A retained profile must return its remote ID",
          );
          return {
            ...(parsed.id ? { profile_id: parsed.id } : {}),
            remote_deletion_available: !!parsed.id,
            ...(await this.download(
              team,
              parsed.provisionFileUrl,
              path.resolve(input.output),
              signal,
            )),
          };
        }
        if (input.action === "profile_delete") {
          const id = required("profile_id");
          await this.request(
            team,
            `/api/cps/provision-manage/v1/provision/delete?${new URLSearchParams({ id })}`,
            "DELETE",
            undefined,
            signal,
          );
          return { deleted: true, id };
        }
        if (input.action === "device_register") {
          const udid = required("udid");
          await this.request(
            team,
            "/api/cps/device-manage/v1/device/add",
            "POST",
            {
              udid,
              deviceName: required("device_name"),
              deviceType: required("device_type"),
            },
            signal,
            async () => (await devices()).some((device) => device.udid === udid && device.deviceName === required("device_name")) ? { ret: { code: 0 }, reconciled: true } : undefined,
          );
          invariant(
            (await devices()).some((device) => device.udid === udid),
            "SIGN_DEVICE_UNCONFIRMED",
            "Device registration was not confirmed by inventory",
          );
          return { registered: true, udid };
        }
        return { devices: await devices() };
      },
      signal,
    );
  }
}
