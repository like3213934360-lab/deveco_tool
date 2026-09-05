import fs from "node:fs/promises";
import path from "node:path";
import { resolveDevecoToolchain } from "../config.mjs";
import { loadSdkMetadata, resolveApiLevel, SkillError } from "../../skills/deveco-create-project/scripts/detect-sdk.mjs";

// Preserve the official API mapping, but accept the SDK selected by the gateway
// for either Studio or CLT. CLT does not have Studio's tools/node directory.
export async function detectSdk(apiLevel) {
  const sdkRoot = process.env.DEVECO_SDK_HOME || resolveDevecoToolchain().paths?.sdk;
  if (!sdkRoot) return resolveApiLevel(await loadSdkMetadata(), apiLevel);
  const sdkPkgPath = path.join(sdkRoot, "default", "sdk-pkg.json");
  let pkg;
  try {
    pkg = JSON.parse(await fs.readFile(sdkPkgPath, "utf8"));
  } catch (error) {
    throw new SkillError({ code: error.code === "ENOENT" ? "SDK_PKG_MISSING" : "SDK_PKG_INVALID",
      message: `Cannot read SDK metadata ${sdkPkgPath}: ${error.message}` });
  }
  const apiVersion = Number(pkg?.data?.apiVersion);
  const platformVersion = String(pkg?.data?.platformVersion ?? "").trim();
  if (!Number.isInteger(apiVersion) || apiVersion < 17 || !platformVersion) {
    throw new SkillError({ code: "SDK_PKG_INVALID", message: `SDK metadata is incomplete: ${sdkPkgPath}` });
  }
  return resolveApiLevel({ devecoHome: process.env.DEVECO_HOME || resolveDevecoToolchain().root,
    sdkPkgPath, apiVersion, platformVersion }, apiLevel);
}
