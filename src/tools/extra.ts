import { z } from "zod";
import { invariant } from "../core/errors.js";
import { fields, tool } from "../registry.js";
import { ensureJobs } from "./core.js";

export const signTool = tool({
  name: "sign",
  title: "App signing",
  description: [
    "auto: debug signing for all connected devices (auth provider=developer; no target): keystore, CSR, debug certificate, device registration, debug profile, signingConfigs. Existing signing needs force=true; prepares new chain before switching; needs a free certificate slot; keeps old material. Interrupted cloud mutations require reconciliation.",
    "sign / verify a package. certificates, devices, register_device, delete_certificate: AGC management.",
    "Steps: keypair (out+keystore_password, optional key_alias) -> csr -> certificate_create -> profile_create (id=certificate ID); profile_delete.",
    "AGC create/delete with multiple teams: TEAM_AMBIGUOUS until team is given; ask the user.",
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
    team: z.string().optional().describe("Developer team id (auth action=teams); required to create/delete with several teams - ask the user"),
    target: fields.target.describe("register_device only: device serial/name; ask the user when several are connected"),
    file: z.string().optional(),
    out: z.string().optional(),
    keystore: z.string().optional(), keystore_password: z.string().optional(), key_alias: z.string().optional(), key_password: z.string().optional(),
    cert: z.string().optional(), profile: z.string().optional(),
    id: z.string().optional(),
    acl: z.array(z.string()).optional().describe("auto: extra ACL permissions (the ones requested in module.json5 are derived automatically)"),
    force: z.boolean().optional().describe("auto: replace signing the project already has (default: refuse and change nothing)"),
    wait: fields.wait,
  }),
  params: {
    auto: ["project", "product", "team", "acl", "force", "wait"],
    sign: ["file", "out", "project", "product", "keystore", "keystore_password", "key_alias", "key_password", "cert", "profile"],
    verify: ["file"],
    certificates: ["team"], devices: ["team"], register_device: ["team", "target"], delete_certificate: ["team", "id"],
    keypair: ["out", "keystore_password", "key_alias"],
    csr: ["keystore", "keystore_password", "key_password", "key_alias", "out", "subject"],
    certificate_create: ["team", "csr", "name", "type", "out"],
    profile_create: ["team", "id", "bundle", "project", "product", "type", "name", "acl", "out"],
    profile_delete: ["team", "id"],
  },
  async handler(input, ctx) {
    const sign = await import("../domains/sign.js");
    switch (input.action) {
      case "auto": {
        invariant(input.project, "INVALID_INPUT", "project is required");
        await ensureJobs();
        const { startJob, waitJob } = await import("../core/jobs.js");
        const { job_id } = await startJob("auto_sign", { project: input.project, product: input.product, team: input.team, acl: input.acl, force: input.force });
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
        return sign.registerDevice(await sign.teamId(input.team, true), await resolveTarget(input.target, ctx.signal), ctx.signal);
      }
      case "delete_certificate": invariant(input.id, "INVALID_INPUT", "id is required"); return sign.deleteCertificate(await sign.teamId(input.team, true), input.id, ctx.signal);
      case "keypair":
        invariant(input.out && input.keystore_password, "INVALID_INPUT", "out and keystore_password are required");
        return sign.generateKeypair({ out: input.out, password: input.keystore_password, alias: input.key_alias }, ctx.signal);
      case "csr":
        invariant(input.keystore && input.keystore_password && input.out, "INVALID_INPUT", "keystore, keystore_password and out are required");
        return sign.generateCsr({ keystore: input.keystore, password: input.keystore_password, key_password: input.key_password, alias: input.key_alias, out: input.out, subject: input.subject }, ctx.signal);
      case "certificate_create":
        invariant(input.csr && input.name && input.out, "INVALID_INPUT", "csr, name and out are required");
        return sign.createCertificate(await sign.teamId(input.team, true), { csr: input.csr, name: input.name, type: input.type ?? "debug", out: input.out }, ctx.signal);
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
        return sign.createProfile(await sign.teamId(input.team, true), { bundle, certificate: input.id, type: input.type ?? "debug", name: input.name, acl, out: input.out }, ctx.signal);
      }
      case "profile_delete": invariant(input.id, "INVALID_INPUT", "id is required"); return sign.deleteProfile(await sign.teamId(input.team, true), input.id, ctx.signal);
    }
  },
});

export const emulatorTool = tool({
  name: "emulator",
  title: "Emulator",
  description: [
    "HarmonyOS emulators. list, start/stop (start awaits boot, returns target), create (device_type, os_version, screen_profile or screen, memory, storage...), delete.",
    "start: boot_mode=coldboot/snapshot/reset; hdc_port 10000-16555, one instance. Invalid port: ask, never call or substitute.",
    "images (downloaded; all=true: all), install_image / remove_image. license accepts; license_view reads. start/create/install_image auto-accept unless auto_accept_license=false.",
    "scenario: shake, power, rotate, volume, fold (state), battery, gps, sensor, outdoor_running, outdoor_cycling, driving_navigation.",
  ].join(" "),
  schema: z.object({
    action: z.enum(["list", "start", "stop", "create", "delete", "images", "install_image", "remove_image", "license", "license_view", "scenario"]),
    name: z.string().optional(),
    names: z.array(z.string()).min(1).max(8).optional().describe("start/stop several emulators"),
    details: z.boolean().optional().describe("list: raw emulator fields"),
    cold: z.boolean().optional().describe("start: legacy coldboot flag; must agree with boot_mode"),
    boot_mode: z.enum(["coldboot", "snapshot", "reset"]).optional().describe("start: preserve data, restore saved Quick Boot snapshot, or ERASE data; default instance setting"),
    hdc_port: z.number().int().min(10000).max(16555).optional().describe("start: fixed port, single instance only; occupied ports fail"),
    window: z.boolean().optional().describe("start: false for no window"),
    device_type: z.string().optional().describe("phone, foldable, widefold, triplefold, tablet, 2in1, wearable, tv, car ..."),
    os_version: z.string().optional().describe('e.g. "HarmonyOS 6.0.0(20)"'),
    memory: z.number().int().min(2).max(32).optional(), storage: z.number().int().min(2).max(1023).optional(),
    screen_profile: z.string().optional().describe('create: predefined screen model, e.g. "Mate 70 Pro"'),
    screen: z.array(z.string()).min(1).max(2).optional().describe('create: custom screen "width height dpi inches" (second entry = folded screen)'),
    hot_boot: z.boolean().optional().describe("create: enable quick boot"),
    instance_path: z.string().optional().describe("list/create/delete/start/stop: emulator instance directory (default: the Emulator's own)"),
    image_root: z.string().optional().describe("create/start: image root directory"),
    force: z.boolean().optional().describe("create: existing overwrite unavailable (preserved); install_image: re-download"),
    auto_accept_license: z.boolean().optional().describe("start/create/install_image: accept the license when needed (default true)"),
    all: z.boolean().optional().describe("images: include images not downloaded yet"),
    scenario: z.enum(["shake", "power", "rotate", "volume", "fold", "battery", "gps", "sensor", "outdoor_running", "outdoor_cycling", "driving_navigation"]).optional(),
    direction: z.enum(["left", "right", "up", "down"]).optional(),
    state: z.string().optional().describe("fold state: open, half-open, close, ..."),
    level: z.number().int().min(0).max(100).optional(),
    battery_status: z.enum(["charging", "discharging"]).optional(),
    charging: z.boolean().optional().describe("deprecated alias of battery_status"),
    latitude: z.number().optional(), longitude: z.number().optional(), altitude: z.number().optional(), bearing: z.number().optional(), city: z.string().optional(),
    light: z.number().optional(), humidity: z.number().min(0).max(100).optional(), temperature: z.number().min(-273.1).max(100).optional(),
    steps: z.number().int().optional(), heartrate: z.number().int().optional(),
  }),
  params: {
    list: ["details", "instance_path"],
    start: ["name", "names", "cold", "boot_mode", "hdc_port", "window", "instance_path", "image_root", "auto_accept_license"],
    stop: ["name", "names", "instance_path"],
    create: ["name", "device_type", "os_version", "memory", "storage", "instance_path", "image_root", "screen_profile", "screen", "hot_boot", "force", "auto_accept_license"],
    delete: ["name", "instance_path"],
    images: ["device_type", "all"],
    install_image: ["device_type", "os_version", "force", "auto_accept_license"],
    remove_image: ["device_type", "os_version"],
    license: [], license_view: [],
    scenario: ["name", "scenario", "direction", "state", "level", "battery_status", "charging", "latitude", "longitude", "altitude", "bearing", "city", "light", "humidity", "temperature", "steps", "heartrate"],
  },
  async handler(input, ctx) {
    const emu = await import("../domains/emulator.js");
    const name = () => { invariant(input.name, "INVALID_INPUT", "name is required"); return input.name; };
    const many = () => { const list = input.names?.length ? input.names : [name()]; return list; };
    const need = (cond: unknown, what: string) => invariant(cond, "INVALID_INPUT", `${input.action} needs ${what}`);
    switch (input.action) {
      case "list": return { emulators: await emu.listEmulators(ctx.signal, input.details, input.instance_path) };
      case "start": {
        invariant(input.name === undefined || input.names === undefined, "INVALID_INPUT", "Pass name or names, not both");
        const names = many();
        invariant(names.length === new Set(names).size, "INVALID_INPUT", "names must not contain duplicates");
        invariant(input.hdc_port === undefined || names.length === 1, "INVALID_INPUT", "hdc_port requires exactly one emulator");
        // Validate the entire batch before starting its first instance.
        for (const n of names) emu.startArgs(n, input);
        const results = [];
        for (const n of names) results.push(await emu.startEmulator(n, input, ctx.signal));
        return results.length === 1 ? results[0] : { started: results };
      }
      case "stop": {
        const results = [];
        for (const n of many()) results.push(await emu.stopEmulator(n, ctx.signal, input.instance_path));
        return results.length === 1 ? results[0] : { stopped: results };
      }
      case "create":
        need(input.device_type && input.os_version, "device_type and os_version");
        return emu.createEmulator({ name: name(), device_type: input.device_type!, os_version: input.os_version!, memory: input.memory, storage: input.storage,
          instance_path: input.instance_path, image_root: input.image_root, screen_profile: input.screen_profile, screen: input.screen, hot_boot: input.hot_boot, force: input.force, auto_accept_license: input.auto_accept_license }, ctx.signal);
      case "delete": return emu.deleteEmulator(name(), ctx.signal, input.instance_path);
      case "images": return emu.images(input.device_type, ctx.signal, input.all);
      case "install_image": need(input.device_type && input.os_version, "device_type and os_version"); return emu.installImage(input.device_type!, input.os_version!, ctx.signal, input.force, input.auto_accept_license ?? true);
      case "remove_image": need(input.device_type && input.os_version, "device_type and os_version"); return emu.removeImage(input.device_type!, input.os_version!, ctx.signal);
      case "license": return emu.acceptLicense(ctx.signal);
      case "license_view": return emu.viewLicense(ctx.signal);
      case "scenario": {
        invariant(input.scenario, "INVALID_INPUT", "scenario is required");
        const s = input.scenario;
        const charging = input.battery_status ? input.battery_status === "charging" : input.charging;
        const spec = s === "rotate" ? { action: s, direction: input.direction as "left" | "right" }
          : s === "volume" ? { action: s, direction: input.direction as "up" | "down" }
          : s === "fold" ? { action: s, state: input.state ?? "open" }
          : s === "battery" ? { action: s, level: input.level, charging }
          : s === "gps" ? { action: s, latitude: input.latitude, longitude: input.longitude, altitude: input.altitude, bearing: input.bearing, city: input.city }
          : s === "sensor" ? { action: s, light: input.light, steps: input.steps, heartrate: input.heartrate, humidity: input.humidity, temperature: input.temperature }
          : { action: s };
        return emu.scenario(name(), spec as import("../domains/emulator.js").Scenario, ctx.signal);
      }
    }
  },
});

export const hotReloadTool = tool({
  name: "hot_reload",
  title: "Hot reload",
  description: "Manual quick fix (HQF, ~5 s) of the running app; run build_run already does this automatically for code-only changes. apply after run build_run hot_reload=true (restart=true relaunches; files limits the patch); reset removes patches; stop_daemon stops hvigor. New files, resources and decorators need a redeploy.",
  schema: z.object({
    action: z.enum(["apply", "reset", "stop_daemon"]),
    files: z.array(z.string()).max(500).optional().describe("apply: changed .ets/.ts files (default: detected automatically from the baseline)"),
    restart: z.boolean().optional().describe("apply: relaunch the app after patching so startup code runs the new version"),
    project: fields.project,
    product: fields.product,
    target: fields.target,
    module: z.string().optional().describe("Default: entry module"),
  }),
  params: {
    apply: ["files", "restart", "project", "product", "target", "module"],
    reset: ["project", "product", "target", "module"],
    stop_daemon: ["project", "product"],
  },
  async handler(input, ctx) {
    const { inspectProject } = await import("../domains/project.js");
    const { applyHotReload, resetHotReload } = await import("../domains/hotreload.js");
    const project = inspectProject(input.project, input.product);
    const { resolveTarget, shell } = await import("../domains/device.js");
    const { runnableDeviceTypes } = await import("../domains/project.js");
    // apply/reset act on the device the hot-reload baseline was installed on (recorded then); an
    // explicit target is only resolved (name or serial) and used to pick the module.
    const target = input.action === "stop_daemon" || !input.target ? undefined : await resolveTarget(input.target, ctx.signal, runnableDeviceTypes(project));
    // Default module = the entry that belongs on the target device (phone vs watch), like run.
    let module = input.module;
    if (!module) {
      const { selectRunModules } = await import("../domains/project.js");
      const { baselineModules } = await import("../domains/hotreload.js");
      const withBaseline = target ? [] : baselineModules(project);
      const deviceType = target ? (await shell(target, ["param", "get", "const.product.devicetype"], ctx.signal, 10000).catch(() => undefined))?.stdout.trim() : undefined;
      module = (withBaseline.length === 1 ? withBaseline[0] : undefined)
        ?? (() => { try { return selectRunModules(project, { deviceType }).modules.find((m) => m.type === "entry")?.name; } catch { return undefined; } })()
        ?? project.modules.find((m) => m.type === "entry")?.name ?? "entry";
    }
    if (input.action === "reset") return resetHotReload(project, module, target, ctx.signal);
    if (input.action === "stop_daemon") return (await import("../domains/hotreload.js")).stopDaemon(project, ctx.signal);
    const { mainAbility } = await import("../domains/project.js");
    return applyHotReload(project, module, ctx.signal, () => {}, { files: input.files, restart: input.restart, ability: input.restart ? mainAbility(project, module).ability : undefined });
  },
});
