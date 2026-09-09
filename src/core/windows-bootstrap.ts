import { spawn } from "node:child_process";
import { z } from "zod";

// The parent assigns this process to its strict Windows job before delivering
// a command. No SDK code runs during the unassigned interval. Stdio is inherited
// directly; the bootstrap never copies, buffers or interprets tool output.
const commandSchema = z.strictObject({
  executable: z.string().min(1),
  args: z.array(z.string()),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
});
if (!process.connected || process.platform !== "win32") process.exit(1);
process.on("disconnect", () => process.exit(1));
const deadline = setTimeout(() => process.exit(1), 10000);
process.once("message", (raw: unknown) => {
  clearTimeout(deadline);
  const parsed = commandSchema.safeParse(raw);
  if (!parsed.success) process.exit(1);
  const command = parsed.data;
  const child = spawn(command.executable, command.args, {
    cwd: command.cwd,
    env: command.env,
    stdio: "inherit",
    windowsHide: true,
  });
  child.once("error", () => process.exit(1));
  child.once("exit", (code) => process.exit(code ?? 1));
});
