import fs from "node:fs/promises";
import path from "node:path";
import {
  detectApiLevel,
  resolveApiLevel,
  SkillError,
} from "../../skills/deveco-create-project/scripts/detect-sdk.mjs";

async function detectFromCltSdk() {
  const sdkRoot = String(process.env.DEVECO_SDK_HOME ?? "").trim();
  if (!sdkRoot) return null;

  const sdkPkgPath = path.join(sdkRoot, "default", "sdk-pkg.json");
  const pkg = JSON.parse(await fs.readFile(sdkPkgPath, "utf8"));
  const apiVersion = Number(pkg?.data?.apiVersion);
  const platformVersion = String(pkg?.data?.platformVersion ?? "").trim();
  if (!Number.isInteger(apiVersion) || !platformVersion) {
    const error = new Error(`SDK metadata is incomplete: ${sdkPkgPath}`);
    error.code = "SDK_PKG_INVALID";
    throw error;
  }

  return resolveApiLevel({
    devecoHome: String(process.env.DEVECO_HOME ?? "").trim(),
    sdkPkgPath,
    apiVersion,
    platformVersion,
  });
}

async function main() {
  try {
    let result;
    try {
      result = await detectApiLevel();
    } catch (error) {
      // Official v0.1.11 validates Studio's tools/node layout. CLT uses tool/node,
      // so reuse the official mapping/validation with the SDK path resolved by the MCP host.
      result = await detectFromCltSdk();
      if (!result) throw error;
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const payload = error instanceof SkillError
      ? error.payload
      : {
          code: error?.code ?? "SDK_DETECTION_FAILED",
          message: error instanceof Error ? error.message : String(error),
        };
    process.stderr.write(`${JSON.stringify(payload)}\n`);
    process.exitCode = 1;
  }
}

await main();
