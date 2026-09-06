/**
 * Child-only observers for errors hidden by the official CLI's cold apply.
 * CLI 1.3.1 discards `aa start` stdout and reports success on exit 0, even when
 * the device says the Ability does not exist. Surface that receipt to the MCP
 * runner without changing child exit codes, CLI control flow, or app state.
 * Also preserve the original build-lock compromise error, which the CLI drops
 * before release() raises the less specific ERELEASED error.
 */
import childProcess from "node:child_process";
import { createRequire, syncBuiltinESMExports } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const cliRequire = createRequire(require.resolve("@deveco/deveco-cli/dist/cli.js"));
const lockfile = cliRequire("proper-lockfile");
const lock = lockfile.lock;
lockfile.lock = function (file, options) {
  if (typeof file !== "string" || typeof options?.lockfilePath !== "string"
    || typeof options.onCompromised !== "function"
    || path.resolve(options.lockfilePath) !== path.resolve(file, ".hvigor", ".build-lock")) {
    return lock.call(this, file, options);
  }
  return lock.call(this, file, {
    ...options,
    onCompromised(error) {
      // The CLI discards this cause, then release() reports only ERELEASED.
      // Preserve the cause without changing lock ownership or the callback.
      const reason = `${error.code}: ${error.message}`.replace(/[\r\n]+/g, " ").slice(0, 1800);
      process.stderr.write(`\n[DevEco MCP] Build lock lost: ${reason}\n`);
      return options.onCompromised.call(this, error);
    },
  });
};

const spawn = childProcess.spawn;
childProcess.spawn = function (file, args, options) {
  const child = spawn.call(this, file, args, options);
  const shell = Array.isArray(args) ? args.indexOf("shell") : -1;
  const executable = String(file).split(/[\\/]/).at(-1);
  if (!/^hdc(?:\.exe)?$/i.test(executable) || shell < 0
    || args[shell + 1] !== "aa" || args[shell + 2] !== "start") return child;

  let receipt = Buffer.alloc(0);
  const capture = (chunk) => {
    receipt = Buffer.concat([receipt, Buffer.from(chunk)]).subarray(-65536);
  };
  child.stdout?.on("data", capture);
  child.stderr?.on("data", capture);
  child.once("close", (code, signal) => {
    const output = receipt.toString("utf8").trim();
    if (code === 0 && !signal && /\bstart ability successfully\b/i.test(output)
      && !/\berror\s*:|failed to start ability/i.test(output)) return;
    const reason = output.slice(0, 2000).replace(/[\r\n]+/g, " ")
      || `No successful aa start receipt (exit=${code}, signal=${signal ?? "none"})`;
    process.stderr.write(`\n[DevEco MCP] HDC launch failed: ${reason}\n`);
  });
  return child;
};
syncBuiltinESMExports();
