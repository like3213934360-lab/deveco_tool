import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { packageRoot } from "../src/core/config.js";
import { ProcessService } from "../src/core/process.js";

test("TypeScript builds remove deleted modules and keep the prior complete build on compilation errors", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-build-")),
    processes = new ProcessService();
  try {
    for (const directory of ["src", "scripts", "dist"])
      fs.mkdirSync(path.join(root, directory));
    fs.symlinkSync(
      path.join(packageRoot, "node_modules"),
      path.join(root, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    fs.copyFileSync(
      path.join(packageRoot, "scripts/build.ts"),
      path.join(root, "scripts/build.ts"),
    );
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ type: "module" }),
    );
    fs.writeFileSync(
      path.join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2024",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          rootDir: ".",
          strict: true,
          types: [],
        },
        include: ["src/**/*.ts"],
      }),
    );
    const source = path.join(root, "src/main.ts"),
      compiled = path.join(root, "dist/src/main.js");
    fs.writeFileSync(source, "export const value: number = 42;\n");
    fs.writeFileSync(path.join(root, "dist/removed.js"), "stale");
    const build = () =>
      processes.run(
        {
          executable: process.execPath,
          args: [
            "--experimental-strip-types",
            path.join(root, "scripts/build.ts"),
          ],
          cwd: root,
        },
        { allowFailure: true, timeoutMs: 30000 },
      );
    assert.equal((await build()).exitCode, 0);
    assert.equal(fs.existsSync(path.join(root, "dist/removed.js")), false);
    const previous = fs.readFileSync(compiled, "utf8");
    assert.match(previous, /42/);
    fs.writeFileSync(source, "export const value: number = 'invalid';\n");
    const failed = await build();
    assert.equal(failed.exitCode, 1);
    assert.match(failed.stderr, /TS2322/);
    assert.equal(fs.readFileSync(compiled, "utf8"), previous);
    assert.equal(
      fs.readdirSync(root).some((name) => name.startsWith(".native-build-")),
      false,
    );
    fs.rmSync(source);
    fs.writeFileSync(
      path.join(root, "src/replacement.ts"),
      "export const value = true;\n",
    );
    assert.equal((await build()).exitCode, 0);
    assert.equal(fs.existsSync(compiled), false);
    assert.ok(fs.existsSync(path.join(root, "dist/src/replacement.js")));
  } finally {
    await processes.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
