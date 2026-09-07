/** Child-only: the official CLI exits immediately after printing buffered build errors. */
import fs from "node:fs";

const exit = process.exit.bind(process);
let exiting = false;
process.exit = function (code = process.exitCode ?? 0) {
  if (exiting) return;
  // Keep Node's validation and the first requested exit status.
  process.exitCode = code;
  exiting = true;
  const finish = (status) => {
    if (process.env.DEVECO_CLI_DRAIN_STATUS) {
      try {
        fs.writeFileSync(process.env.DEVECO_CLI_DRAIN_STATUS, JSON.stringify({ status }), { mode: 0o600 });
      } catch { /* The parent reports missing receipt as unknown, never complete. */ }
    }
    exit(code);
  };
  // A broken consumer must not keep a failed CLI alive indefinitely.
  const deadline = setTimeout(() => finish("timeout"), 2000);
  const drain = (stream) => new Promise((resolve) => {
    if (stream.destroyed || stream.writableEnded) return resolve(!stream.errored);
    try { stream.write("", (error) => resolve(!error)); } catch { resolve(false); }
  });
  Promise.all([drain(process.stdout), drain(process.stderr)]).then((ok) => {
    clearTimeout(deadline);
    finish(ok.every(Boolean) ? "drained" : "error");
  });
};

// A natural exit also supplies an explicit receipt. No process-global changes in the MCP host.
process.once("exit", () => {
  if (!exiting && process.env.DEVECO_CLI_DRAIN_STATUS) {
    try {
      fs.writeFileSync(process.env.DEVECO_CLI_DRAIN_STATUS, JSON.stringify({ status: "natural" }), { mode: 0o600 });
    } catch { /* Missing receipt is visible to the parent. */ }
  }
});
