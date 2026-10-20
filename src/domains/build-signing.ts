import fs from "node:fs";
import path from "node:path";
import JSON5 from "json5";
import { kvDelete, kvGet, kvSet } from "../core/db.js";
import { invariant, ToolError } from "../core/errors.js";
import { atomicWrite, sha256 } from "../core/files.js";
import { json5Locations } from "../core/json5-source.js";

interface Edit { start: number; original: string; replacement: string; before: string; after: string }
const changed = (text: string, edit: Edit) => text.slice(0, edit.start) + edit.original + text.slice(edit.start + edit.replacement.length);

/** The recovery receipt stores only the edited signingConfig token, never credentials or a file copy.
 * Project ownership is held by the job coordinator throughout apply/build/restore. */
export async function withBuildSigning<T extends object>(root: string, product: string, name: string | undefined, signal: AbortSignal, build: () => Promise<T>) {
  const file = fs.realpathSync(path.join(root, "build-profile.json5"));
  const key = "build-signing:" + sha256(file);
  const restore = async () => {
    const saved = await kvGet(key);
    if (!saved) return;
    const edit: Edit = JSON.parse(saved), current = fs.readFileSync(file, "utf8"), hash = sha256(current);
    invariant(Number.isSafeInteger(edit.start) && edit.start >= 0 && typeof edit.original === "string" && typeof edit.replacement === "string",
      "SIGN_CONFIG_RESTORE_FAILED", "Invalid signing selection recovery receipt");
    if (hash !== edit.before) {
      invariant(hash === edit.after, "SIGN_CONFIG_RESTORE_CONFLICT", "Build profile changed while a signing override was active; preserve the file for reconciliation", { file, product },
        "Restore the interrupted override after inspecting this project; do not overwrite concurrent edits");
      const original = changed(current, edit);
      invariant(sha256(original) === edit.before, "SIGN_CONFIG_RESTORE_FAILED", "Signing selection receipt does not restore the original profile");
      atomicWrite(file, original, fs.statSync(file).mode & 0o777);
    }
    await kvDelete(key);
  };
  await restore(); // Also recovers an interrupted build before an ordinary build.
  if (name === undefined) return build();
  invariant(name.length > 0 && name.length <= 128, "INVALID_INPUT", "signing_config must name an existing signing configuration");
  const original = fs.readFileSync(file, "utf8");
  const profile = JSON5.parse(original);
  invariant(profile.app?.signingConfigs?.filter((c: { name: string }) => c.name === name).length === 1,
    "SIGN_CONFIG_MISSING", "Selected signing configuration does not exist or is ambiguous", { product, signing_config: name });
  const products = profile.app?.products;
  invariant(Array.isArray(products) && products.filter((p: { name: string }) => p.name === product).length === 1,
    "PROJECT_INVALID", "Selected product does not exist or is ambiguous", { product });
  const index = products.findIndex((p: { name: string }) => p.name === product);
  invariant(products[index].signingConfig === undefined || typeof products[index].signingConfig === "string",
    "PROJECT_INVALID", "Product signingConfig must be a string; no configuration was changed", { product });
  const locations = json5Locations(original);
  const value = locations.get(JSON.stringify(["app", "products", index, "signingConfig"]));
  const object = locations.get(JSON.stringify(["app", "products", index]))!;
  const start = value?.start ?? object.start + 1, end = value?.end ?? start;
  const replacement = value ? JSON.stringify(name) : '"signingConfig":' + JSON.stringify(name) + ",";
  const selected = original.slice(0, start) + replacement + original.slice(end);
  const edit: Edit = { start, original: original.slice(start, end), replacement, before: sha256(original), after: sha256(selected) };
  signal.throwIfAborted();
  await kvSet(key, JSON.stringify(edit)); // Durable before the only project mutation.
  let failure: unknown;
  let result: T;
  try {
    signal.throwIfAborted();
    atomicWrite(file, selected, fs.statSync(file).mode & 0o777);
    result = await build();
  } catch (error) { failure = error; throw error;
  } finally {
    try { await restore(); }
    catch (error) {
      if (failure) throw new ToolError("SIGN_CONFIG_RESTORE_FAILED", "Build failed and the signing override could not be restored",
        { file, build_error: String(failure), restore_error: String(error) });
      throw error;
    }
  }
  return { ...result, signing_config: name, signing_config_restored: true };
}
