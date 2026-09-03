import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { terminateProcessTree } from "../process-tree.mjs";

const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const PREFIX = "v1.";
const SERVICE = "deveco-tool-auth";
const AAD = "deveco-tool:auth:v1";
// OS credential CLIs are local operations. A locked/broken keychain must not add ten seconds to
// every doctor/status/search call; three seconds still leaves ample time for process startup.
const COMMAND_TIMEOUT_MS = 3000;
const MAX_PROVIDER_OUTPUT_BYTES = 64 * 1024;

function command(command, args, input) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        stdio: [input === undefined ? "ignore" : "pipe", "pipe", "ignore"],
        windowsHide: true,
        detached: process.platform !== "win32",
      });
    } catch {
      resolve(undefined);
      return;
    }
    let stdout = "";
    let stdoutBytes = 0;
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      terminateProcessTree(child);
      finish(undefined);
    }, COMMAND_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      if (settled) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_PROVIDER_OUTPUT_BYTES) {
        terminateProcessTree(child);
        finish(undefined);
        return;
      }
      stdout += chunk.toString();
    });
    child.once("error", () => finish(undefined));
    child.once("close", (code) => finish(code === 0 ? stdout.trim() : undefined));
    if (input !== undefined) child.stdin.end(input);
  });
}

function decodeKey(value) {
  if (!value) return undefined;
  const key = Buffer.from(value.trim(), "base64");
  return key.length === KEY_LENGTH ? key : undefined;
}

function writePrivate(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(temporary, value, { encoding: "utf8", mode: 0o600 });
    fs.chmodSync(temporary, 0o600);
    fs.renameSync(temporary, file);
  } finally {
    try { fs.rmSync(temporary); } catch { /* rename succeeded or cleanup is best effort */ }
  }
}

function keyFileFor(file) {
  return `${file}.key`;
}

function accountFor(file) {
  const digest = crypto.createHash("sha256").update(path.resolve(file)).digest("hex").slice(0, 12);
  return `${path.basename(file)}-${digest}`;
}

function loadPlainKey(file, allowCreate) {
  if (fs.existsSync(file)) {
    const key = decodeKey(fs.readFileSync(file, "utf8"));
    if (!key) throw new Error(`Invalid credential key in ${file}`);
    return key;
  }
  if (!allowCreate) throw new Error(`Credential key is unavailable for ${file}`);
  const key = crypto.randomBytes(KEY_LENGTH);
  writePrivate(file, key.toString("base64"));
  return key;
}

const DPAPI_PROTECT =
  "Add-Type -AssemblyName System.Security; "
  + "$b=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); "
  + "[Console]::Out.Write([Convert]::ToBase64String("
  + "[System.Security.Cryptography.ProtectedData]::Protect($b,$null,"
  + "[System.Security.Cryptography.DataProtectionScope]::CurrentUser)))";

const DPAPI_UNPROTECT =
  "Add-Type -AssemblyName System.Security; "
  + "$b=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); "
  + "[Console]::Out.Write([Convert]::ToBase64String("
  + "[System.Security.Cryptography.ProtectedData]::Unprotect($b,$null,"
  + "[System.Security.Cryptography.DataProtectionScope]::CurrentUser)))";

async function dpapi(script, input) {
  return command("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], input);
}

async function loadDpapiKey(file, allowCreate) {
  if (fs.existsSync(file)) {
    const content = fs.readFileSync(file, "utf8").trim();
    const protectedKey = decodeKey(await dpapi(DPAPI_UNPROTECT, content));
    if (protectedKey) return protectedKey;

    const legacy = decodeKey(content);
    if (!legacy) throw new Error(`Invalid credential key in ${file}`);
    const protectedValue = await dpapi(DPAPI_PROTECT, legacy.toString("base64"));
    if (protectedValue) writePrivate(file, protectedValue);
    return legacy;
  }
  if (!allowCreate) throw new Error(`Credential key is unavailable for ${file}`);
  const key = crypto.randomBytes(KEY_LENGTH);
  const protectedValue = await dpapi(DPAPI_PROTECT, key.toString("base64"));
  writePrivate(file, protectedValue ?? key.toString("base64"));
  return key;
}

function providerForPlatform() {
  if (process.platform === "darwin") {
    return {
      read: (account) => command("security", ["find-generic-password", "-s", SERVICE, "-a", account, "-w"]),
      write: async (account, value) => await command(
        "security",
        ["add-generic-password", "-U", "-s", SERVICE, "-a", account, "-w", value],
      ) !== undefined,
      remove: (account) => command("security", ["delete-generic-password", "-s", SERVICE, "-a", account]),
    };
  }
  if (process.platform === "linux") {
    return {
      read: (account) => command("secret-tool", ["lookup", "service", SERVICE, "account", account]),
      write: async (account, value) => await command(
        "secret-tool",
        ["store", "--label=DevEco Tool Auth", "service", SERVICE, "account", account],
        value,
      ) !== undefined,
      remove: (account) => command("secret-tool", ["clear", "service", SERVICE, "account", account]),
    };
  }
  return undefined;
}

async function loadProviderKey(file, allowCreate, provider) {
  const account = accountFor(file);
  const stored = decodeKey(await provider.read(account));
  if (stored) return stored;

  const keyFile = keyFileFor(file);
  if (fs.existsSync(keyFile)) {
    const legacy = decodeKey(fs.readFileSync(keyFile, "utf8"));
    if (!legacy) throw new Error(`Invalid credential key in ${keyFile}`);
    if (await provider.write(account, legacy.toString("base64"))) fs.rmSync(keyFile);
    return legacy;
  }

  if (!allowCreate) throw new Error(`Credential key is unavailable for ${file}`);
  const key = crypto.randomBytes(KEY_LENGTH);
  if (!await provider.write(account, key.toString("base64"))) {
    writePrivate(keyFile, key.toString("base64"));
  }
  return key;
}

function keychainDisabled() {
  return /^(1|true|yes)$/i.test(process.env.DEVECO_DISABLE_CREDENTIAL_KEYCHAIN ?? "");
}

async function loadKey(file, allowCreate) {
  const keyFile = keyFileFor(file);
  if (keychainDisabled()) return loadPlainKey(keyFile, allowCreate);
  if (process.platform === "win32") return loadDpapiKey(keyFile, allowCreate);
  const provider = providerForPlatform();
  return provider ? loadProviderKey(file, allowCreate, provider) : loadPlainKey(keyFile, allowCreate);
}

function seal(key, plaintext) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(AAD, "utf8"));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

function open(key, value) {
  if (!value.startsWith(PREFIX)) throw new Error("Unsupported credential envelope version");
  const blob = Buffer.from(value.slice(PREFIX.length), "base64");
  if (blob.length < IV_LENGTH + TAG_LENGTH) throw new Error("Invalid credential envelope");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, blob.subarray(0, IV_LENGTH));
  decipher.setAAD(Buffer.from(AAD, "utf8"));
  decipher.setAuthTag(blob.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH));
  return Buffer.concat([
    decipher.update(blob.subarray(IV_LENGTH + TAG_LENGTH)),
    decipher.final(),
  ]).toString("utf8");
}

function envelope(value) {
  return value && value.version === 1 && typeof value.sealed === "string";
}

export async function readCredential(file) {
  if (!fs.existsSync(file)) return null;
  const stored = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!envelope(stored)) {
    await writeCredential(file, stored);
    return stored;
  }
  const key = await loadKey(file, false);
  return JSON.parse(open(key, stored.sealed));
}

export async function writeCredential(file, value) {
  let allowCreate = true;
  if (fs.existsSync(file)) {
    try { allowCreate = !envelope(JSON.parse(fs.readFileSync(file, "utf8"))); } catch { allowCreate = false; }
  }
  const key = await loadKey(file, allowCreate);
  writePrivate(file, JSON.stringify({ version: 1, sealed: seal(key, JSON.stringify(value)) }, null, 2));
}

export async function deleteCredential(file) {
  try { fs.rmSync(file); } catch { /* already absent */ }
  try { fs.rmSync(keyFileFor(file)); } catch { /* key is normally in the OS keychain */ }
  if (keychainDisabled() || process.platform === "win32") return;
  await providerForPlatform()?.remove(accountFor(file));
}
