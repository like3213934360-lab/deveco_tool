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
  }),
});
export async function inspectApplicationPackage(
  file: string,
  app: z.infer<typeof appSchema>,
  signal?: AbortSignal,
) {
  invariant(
    /\.(hap|hsp)$/.test(file) && fs.statSync(file).isFile(),
    "ARTIFACT_INVALID",
    "A HAP or HSP file is required",
  );
  const metadata = identity.parse(
    JSON.parse(
      (await archiveEntry(file, "module.json", 1048576, signal)).toString(
        "utf8",
      ),
    ) as unknown,
  );
  invariant(
    metadata.app.bundleName === app.bundle_name,
    "PACKAGE_BUNDLE_MISMATCH",
    "Package bundle does not match the requested application",
  );
  invariant(
    !app.module || metadata.module.name === app.module,
    "PACKAGE_MODULE_MISMATCH",
    "Package module does not match the requested launch module",
  );
  invariant(
    metadata.module.abilities.some((ability) => ability.name === app.ability),
    "PACKAGE_ABILITY_MISMATCH",
    "Package does not declare the requested application ability",
  );
  return {
    bundle_name: metadata.app.bundleName,
    module: metadata.module.name,
    version_code: metadata.app.versionCode,
    version_name: metadata.app.versionName,
    ability: app.ability,
  };
}
