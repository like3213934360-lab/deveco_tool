import fs from "node:fs";
import { z } from "zod";
import { appSchema } from "../core/contracts.js";
import { archiveEntry } from "../core/archive.js";
import { invariant } from "../core/errors.js";

const identity = z.object({
  app: z.object({
    bundleName: z.string(),
    versionCode: z.number().int().nonnegative(),
    versionName: z.string(),
  }),
  module: z.object({
    name: z.string(),
    type: z.string(),
    abilities: z.array(z.object({ name: z.string() })).default([]),
    dependencies: z
      .array(
        z.object({ moduleName: z.string(), bundleName: z.string().optional() }),
      )
      .default([]),
  }),
});
export async function readPackageMetadata(file: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  invariant(
    /\.(hap|hsp)$/.test(file) && fs.statSync(file).isFile(),
    "ARTIFACT_INVALID",
    "A HAP or HSP file is required",
  );
  return identity.parse(
    JSON.parse(
      (await archiveEntry(file, "module.json", 1048576, signal)).toString(
        "utf8",
      ),
    ) as unknown,
  );
}
export async function inspectApplicationPackages(
  files: readonly string[],
  app: z.infer<typeof appSchema>,
  signal?: AbortSignal,
) {
  invariant(
    files.length > 0 && files.length <= 64,
    "PACKAGE_COUNT_INVALID",
    "Provide between 1 and 64 application packages",
  );
  const packages: z.infer<typeof identity>[] = [];
  for (const file of files) {
    const metadata = await readPackageMetadata(file, signal);
    invariant(
      metadata.app.bundleName === app.bundle_name,
      "PACKAGE_BUNDLE_MISMATCH",
      "Package bundle does not match the requested application",
    );
    invariant(
      !packages.some((other) => other.module.name === metadata.module.name),
      "PACKAGE_MODULE_DUPLICATE",
      "Installation contains duplicate modules",
    );
    invariant(
      !packages[0] ||
        (packages[0].app.versionCode === metadata.app.versionCode &&
          packages[0].app.versionName === metadata.app.versionName),
      "PACKAGE_VERSION_MISMATCH",
      "All installation packages must have the same application version",
    );
    invariant(
      ["entry", "feature", "shared"].includes(metadata.module.type) &&
        file.endsWith(".hsp") === (metadata.module.type === "shared"),
      "PACKAGE_TYPE_MISMATCH",
      "Package extension and module type disagree",
    );
    packages.push(metadata);
  }
  const candidates = packages.filter(
    (metadata) => !app.module || metadata.module.name === app.module,
  );
  invariant(
    candidates.length > 0,
    "PACKAGE_MODULE_MISMATCH",
    "Package module does not match the requested launch module",
  );
  const launch = candidates.filter(
    (metadata) =>
      metadata.module.type !== "shared" &&
      metadata.module.abilities.some((ability) => ability.name === app.ability),
  );
  invariant(
    launch.length > 0,
    "PACKAGE_ABILITY_MISMATCH",
    "Package does not declare the requested application ability",
  );
  invariant(
    launch.length === 1,
    "PACKAGE_ABILITY_AMBIGUOUS",
    "Select the module containing the requested launch ability",
  );
  const metadata = launch[0]!;
  return {
    bundle_name: metadata.app.bundleName,
    module: metadata.module.name,
    version_code: metadata.app.versionCode,
    version_name: metadata.app.versionName,
    ability: app.ability,
    modules: packages.map((item) => ({
      name: item.module.name,
      type: item.module.type,
    })),
  };
}
