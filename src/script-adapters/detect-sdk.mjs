import { detectSdk } from "./sdk.mjs";

try {
  process.stdout.write(`${JSON.stringify(await detectSdk())}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify(error.payload ?? { code: error.code ?? "SDK_DETECTION_FAILED", message: error.message })}\n`);
  process.exitCode = 1;
}
