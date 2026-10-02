// Blank-screen verdict: ours (dominant-shade share >= 99.8%) vs upstream deveco-cli ScreenPhash
// (8x8 pHash hamming distance to solid white/black <= 10). Same synthetic images through both.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { evidence, record, repo } from "./lib.mjs";

const out = fs.mkdtempSync(path.join(os.tmpdir(), "audit-blank-"));
// Removed on every exit path (a failed clone/build used to leave the directory behind).
const cleanup = () => fs.rmSync(out, { recursive: true, force: true });
process.on("exit", cleanup);
for (const sig of ["SIGINT", "SIGTERM"]) process.once(sig, () => { cleanup(); process.exit(130); });
// Upstream deveco-cli: --cli <dir> reuses a checkout, otherwise a shallow clone into the temp dir.
const given = process.argv.includes("--cli") ? process.argv[process.argv.indexOf("--cli") + 1] : undefined;
const cli = given ? path.resolve(given) : path.join(out, "deveco-cli");
if (!given) execFileSync("git", ["clone", "-q", "--depth", "1", "--branch", "develop", "https://gitcode.com/openharmony-sig/deveco-cli.git", cli], { stdio: "ignore" });
const entry = path.join(out, "e.ts");
fs.writeFileSync(entry, `export { blankScore } from ${JSON.stringify(path.join(repo, "src/domains/ui.ts"))};\nexport { ScreenPhash } from ${JSON.stringify(path.join(cli, "packages/cli/src/smoke/screen-phash.ts"))};\n`);
await build({ entryPoints: [entry], outfile: path.join(out, "e.mjs"), bundle: true, format: "esm", platform: "node", packages: "external", logLevel: "error", nodePaths: [path.join(repo, "node_modules")] });
fs.symlinkSync(path.join(repo, "node_modules"), path.join(out, "node_modules"));
const { blankScore, ScreenPhash } = await import(pathToFileURL(path.join(out, "e.mjs")).href);
const W = 128, H = 277;
const img = (fn) => { const rgb = new Uint8Array(W * H * 3); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = fn(x, y); const i = (y * W + x) * 3; rgb[i] = rgb[i + 1] = rgb[i + 2] = v; } return rgb; };
const toGray = (rgb) => { const g = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) g[i] = rgb[i * 3]; return g; };
const cases = {
  solid_white: img(() => 255),
  solid_black: img(() => 0),
  solid_grey_240: img(() => 240),
  solid_mid_grey_128: img(() => 128),
  white_with_small_text: img((x, y) => (y > 120 && y < 126 && x > 40 && x < 88 ? 0 : 255)),
  white_with_status_bar_only: img((x, y) => (y < 14 ? 0 : 255)),
  gradient: img((x, y) => Math.floor((y / H) * 255)),
  normal_ui: img((x, y) => ((Math.floor(y / 30) + Math.floor(x / 40)) % 2 ? 250 : 60)),
};
const ph = new ScreenPhash();
const rows = Object.entries(cases).map(([k, rgb]) => {
  const ours = blankScore({ width: W, height: H, gray: toGray(rgb) });
  const up = ph.analyzeRgb(W, H, rgb);
  return { case: k, ours_blank: ours.blank, ours_uniform: ours.uniform, upstream_blank: up?.isBlank ?? null, upstream_hamming: up?.hamming ?? null };
});
console.table(rows);
// Ground truth per image (what a person calls a blank screen); upstream's verdict is reported for information.
const truth = { solid_white: true, solid_black: true, solid_grey_240: true, solid_mid_grey_128: true, white_with_small_text: false, white_with_status_bar_only: true, gradient: false, normal_ui: false };
const wrong = rows.filter((r) => r.ours_blank !== truth[r.case]);
const differ = rows.filter((r) => r.ours_blank !== r.upstream_blank);
const ev = evidence("upstream", "blank-verdict.json", rows.map((r) => ({ ...r, truth: truth[r.case] })));
record("A.upstream.run.smoke-blank", wrong.length ? "DEFECT" : "VERIFIED",
  (wrong.length ? `our blank verdict is wrong on ${wrong.map((r) => r.case).join(", ")}` : `our blank verdict matches the ground truth on all ${rows.length} images`)
  + (differ.length ? `; upstream pHash differs on ${differ.map((r) => `${r.case} (upstream ${r.upstream_blank}, h${r.upstream_hamming}, truth ${truth[r.case]})`).join("; ")}` : "; upstream agrees on all"), [ev]);
