import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Bootstrap with Node's type stripping; everything we ship runs compiled JS.
// Keep this entry independent of dist and of runtime files that use emitted paths.
const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    import.meta.url.endsWith(".ts") ? ".." : "../..",
  ),
  configFile = path.join(root, "tsconfig.json"),
  destination = path.join(root, "dist"),
  staging = path.join(root, `.native-build-${randomUUID()}`),
  backup = `${staging}-previous`;
const host: ts.FormatDiagnosticsHost = {
  getCanonicalFileName: (file) => file,
  getCurrentDirectory: () => root,
  getNewLine: () => "\n",
};
let moved = false;
try {
  const read = ts.readConfigFile(configFile, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(
    read.config,
    ts.sys,
    root,
    { outDir: staging, noEmitOnError: true },
    configFile,
  );
  const program = ts.createProgram(parsed.fileNames, parsed.options),
    diagnostics = [
      ...(read.error ? [read.error] : []),
      ...parsed.errors,
      ...ts.getPreEmitDiagnostics(program),
    ];
  if (
    diagnostics.some((item) => item.category === ts.DiagnosticCategory.Error)
  ) {
    process.stderr.write(
      ts.formatDiagnosticsWithColorAndContext(diagnostics, host),
    );
    process.exitCode = 1;
  } else {
    const emitted = program.emit();
    if (
      emitted.emitSkipped ||
      emitted.diagnostics.some(
        (item) => item.category === ts.DiagnosticCategory.Error,
      )
    ) {
      process.stderr.write(
        ts.formatDiagnosticsWithColorAndContext(emitted.diagnostics, host),
      );
      process.exitCode = 1;
    } else {
      // Replacing a complete output tree drops modules/tests removed from source.
      if (fs.existsSync(destination)) {
        fs.renameSync(destination, backup);
        moved = true;
      }
      try {
        fs.renameSync(staging, destination);
      } catch (error) {
        if (moved) {
          fs.renameSync(backup, destination);
          moved = false;
        }
        throw error;
      }
      fs.rmSync(backup, { recursive: true, force: true });
      moved = false;
      process.stdout.write(
        `Built ${parsed.fileNames.length} TypeScript files without stale outputs.\n`,
      );
    }
  }
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
  // A failed rename restores the previous complete tree above. Never discard it
  // if restoring it also failed; retain that directory for explicit recovery.
  if (moved) process.stderr.write(`Previous build retained at ${backup}\n`);
}
