import { z } from "zod";
import { invariant } from "../core/errors.js";
import { fields, tool } from "../registry.js";
import { ensureJobs } from "./core.js";

export const signTool = tool({
  name: "sign",
  group: "sign",
  title: "App signing",
  description: [
    "auto: one-shot debug signing for real devices (needs auth provider=developer): creates keystore+CSR, debug certificate, registers connected devices, creates a debug profile and writes signingConfigs into build-profile.json5. Then run action=build_run works on real devices.",
    "sign/verify: sign a package locally (from project signingConfigs or explicit material) / verify a signed package.",
    "certificates, devices, register_device, delete_certificate: AppGallery Connect management.",
    "Itemized (team/release signing): keypair (out .p12, keystore_password) -> csr (keystore, out .csr) -> certificate_create (csr, name, type, out .cer) -> profile_create (bundle, id=certificate id, type, out .p7b) ; profile_delete (id).",
  ].join(" "),
  schema: z.object({
    action: z.enum(["auto", "sign", "verify", "certificates", "devices", "register_device", "delete_certificate",
      "keypair", "csr", "certificate_create", "profile_create", "profile_delete"]),
    type: z.enum(["debug", "release"]).optional().describe("certificate_create/profile_create (default debug)"),
    name: z.string().max(100).optional().describe("certificate_create/profile_create name"),
    csr: z.string().optional().describe("certificate_create: CSR file"),
    bundle: z.string().optional().describe("profile_create: bundle name (or pass project)"),
    subject: z.string().optional().describe("csr: subject, default CN=DebugKey"),
    project: z.string().optional(),
    product: fields.product,
    team: z.string().optional().describe("Developer team id (default: personal team)"),
    target: fields.target,
    file: z.string().optional(),
    out: z.string().optional(),
    keystore: z.string().optional(), keystore_password: z.string().optional(), key_alias: z.string().optional(), key_password: z.string().optional(),
    cert: z.string().optional(), profile: z.string().optional(),
    id: z.string().optional(),
    acl: z.array(z.string()).optional().describe("auto: extra ACL permissions (the ones requested in module.json5 are derived automatically)"),
    wait: fields.wait,
  }),
  async handler(input, ctx) {
    const sign = await import("../domains/sign.js");
    switch (input.action) {
      case "auto": {
        invariant(input.project, "INVALID_INPUT", "project is required");
        await ensureJobs();
        const { startJob, waitJob } = await import("../core/jobs.js");
        const { job_id } = await startJob("auto_sign", { project: input.project, product: input.product, team: input.team, acl: input.acl });
        return waitJob(job_id, input.wait ?? 20000);
      }
      case "sign":
        invariant(input.file && input.out, "INVALID_INPUT", "file and out are required");
        return sign.signPackage({ ...input, file: input.file, out: input.out }, ctx.signal);
      case "verify": invariant(input.file, "INVALID_INPUT", "file is required"); return sign.verifyPackage(input.file, ctx.signal);
      case "certificates": return { certificates: await sign.listCertificates(await sign.teamId(input.team), ctx.signal) };
      case "devices": return { devices: await sign.listDevices(await sign.teamId(input.team), ctx.signal) };
      case "register_device": {
        const { resolveTarget } = await import("../domains/device.js");
        return sign.registerDevice(await sign.teamId(input.team), await resolveTarget(input.target, ctx.signal), ctx.signal);
      }
      case "delete_certificate": invariant(input.id, "INVALID_INPUT", "id is required"); return sign.deleteCertificate(await sign.teamId(input.team), input.id, ctx.signal);
      case "keypair":
        invariant(input.out && input.keystore_password, "INVALID_INPUT", "out and keystore_password are required");
        return sign.generateKeypair({ out: input.out, password: input.keystore_password, alias: input.key_alias }, ctx.signal);
      case "csr":
        invariant(input.keystore && input.keystore_password && input.out, "INVALID_INPUT", "keystore, keystore_password and out are required");
        return sign.generateCsr({ keystore: input.keystore, password: input.keystore_password, key_password: input.key_password, alias: input.key_alias, out: input.out, subject: input.subject }, ctx.signal);
      case "certificate_create":
        invariant(input.csr && input.name && input.out, "INVALID_INPUT", "csr, name and out are required");
        return sign.createCertificate(await sign.teamId(input.team), { csr: input.csr, name: input.name, type: input.type ?? "debug", out: input.out }, ctx.signal);
      case "profile_create": {
        invariant(input.id && input.out, "INVALID_INPUT", "id (certificate id) and out are required");
        let bundle = input.bundle, acl = input.acl;
        if (input.project) {
          const { inspectProject } = await import("../domains/project.js");
          const project = inspectProject(input.project, input.product);
          bundle ??= project.bundleName;
          acl = [...new Set([...sign.projectAclPermissions(project.modules).acl, ...(acl ?? [])])];
        }
        invariant(bundle, "INVALID_INPUT", "bundle (or project) is required");
        return sign.createProfile(await sign.teamId(input.team), { bundle, certificate: input.id, type: input.type ?? "debug", name: input.name, acl, out: input.out }, ctx.signal);
      }
      case "profile_delete": invariant(input.id, "INVALID_INPUT", "id is required"); return sign.deleteProfile(await sign.teamId(input.team), input.id, ctx.signal);
    }
  },
});

export const emulatorTool = tool({
  name: "emulator",
  group: "emulator",
  title: "Emulator",
  description: "HarmonyOS emulators. list, start (waits until booted; returns target), stop, create, delete, images, install_image, license (accept). scenario: shake, power, rotate, volume, fold, battery (level/charging), gps (latitude/longitude/...), sensor (light/steps/heartrate), outdoor_running/outdoor_cycling/driving_navigation — then verify app reaction with ui assert.",
  schema: z.object({
    action: z.enum(["list", "start", "stop", "create", "delete", "images", "install_image", "license", "scenario"]),
    name: z.string().optional(),
    cold: z.boolean().optional(),
    window: z.boolean().optional(),
    device_type: z.string().optional().describe("phone, tablet, 2in1, foldable, wearable, tv ..."),
    os_version: z.string().optional(),
    memory: z.number().int().optional(), storage: z.number().int().optional(),
    scenario: z.enum(["shake", "power", "rotate", "volume", "fold", "battery", "gps", "sensor", "outdoor_running", "outdoor_cycling", "driving_navigation"]).optional(),
    direction: z.enum(["left", "right", "up", "down"]).optional(),
    state: z.string().optional().describe("fold state: open, half-open, close, ..."),
    level: z.number().int().min(0).max(100).optional(),
    charging: z.boolean().optional(),
    latitude: z.number().optional(), longitude: z.number().optional(), altitude: z.number().optional(), bearing: z.number().optional(), city: z.string().optional(),
    light: z.number().optional(), steps: z.number().int().optional(), heartrate: z.number().int().optional(),
  }),
  async handler(input, ctx) {
    const emu = await import("../domains/emulator.js");
    const name = () => { invariant(input.name, "INVALID_INPUT", "name is required"); return input.name; };
    switch (input.action) {
      case "list": return { emulators: await emu.listEmulators(ctx.signal) };
      case "start": return emu.startEmulator(name(), { cold: input.cold, window: input.window }, ctx.signal);
      case "stop": return emu.stopEmulator(name(), ctx.signal);
      case "create": invariant(input.device_type && input.os_version, "INVALID_INPUT", "device_type and os_version are required"); return emu.createEmulator({ name: name(), device_type: input.device_type, os_version: input.os_version, memory: input.memory, storage: input.storage }, ctx.signal);
      case "delete": return emu.deleteEmulator(name(), ctx.signal);
      case "images": return emu.images(input.device_type, ctx.signal);
      case "install_image": invariant(input.device_type && input.os_version, "INVALID_INPUT", "device_type and os_version are required"); return emu.installImage(input.device_type, input.os_version, ctx.signal);
      case "license": return emu.acceptLicense(ctx.signal);
      case "scenario": {
        invariant(input.scenario, "INVALID_INPUT", "scenario is required");
        const s = input.scenario;
        const spec = s === "rotate" ? { action: s, direction: input.direction as "left" | "right" }
          : s === "volume" ? { action: s, direction: input.direction as "up" | "down" }
          : s === "fold" ? { action: s, state: input.state ?? "open" }
          : s === "battery" ? { action: s, level: input.level ?? 50, charging: input.charging }
          : s === "gps" ? { action: s, latitude: input.latitude, longitude: input.longitude, altitude: input.altitude, bearing: input.bearing, city: input.city }
          : s === "sensor" ? { action: s, light: input.light, steps: input.steps, heartrate: input.heartrate }
          : { action: s };
        return emu.scenario(name(), spec as import("../domains/emulator.js").Scenario, ctx.signal);
      }
    }
  },
});

export const hotReloadTool = tool({
  name: "hot_reload",
  group: "hot_reload",
  title: "Hot reload",
  description: "Apply ArkTS code changes to the running app without reinstalling (HQF quick fix, ~3s). First deploy with run action=build_run hot_reload=true; after editing .ets files call apply (the app keeps running; changed code takes effect on its next execution, e.g. the next click or page build). reset removes applied patches. Structural changes (new files, resources, decorators) need a normal redeploy.",
  schema: z.object({
    action: z.enum(["apply", "reset"]),
    project: fields.project,
    product: fields.product,
    target: fields.target,
    module: z.string().optional().describe("Default: entry module"),
  }),
  async handler(input, ctx) {
    const { inspectProject } = await import("../domains/project.js");
    const { applyHotReload, resetHotReload } = await import("../domains/hotreload.js");
    const project = inspectProject(input.project, input.product);
    const module = input.module ?? project.modules.find((m) => m.type === "entry")?.name ?? "entry";
    if (input.action === "reset") return resetHotReload(project, module, input.target, ctx.signal);
    return applyHotReload(project, module, ctx.signal, () => {});
  },
});
