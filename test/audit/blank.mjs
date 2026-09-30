// Blank-screen verdict: ours (dominant-shade share >= 99.8%) vs upstream deveco-cli ScreenPhash
// (8x8 pHash hamming distance to solid white/black <= 10). Same synthetic images through both.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { evidence, record, repo } from "./lib.mjs";

const out = fs.mkdtempSync(path.join(os.tmpdir(), "audit-blank-"));
const entry = path.join(out, "e.ts");
fs.writeFileSync(entry, `export { blankScore } from ${JSON.stringify(path.join(repo, "src/domains/ui.ts"))};\nexport { ScreenPhash } from ${JSON.stringify("/tmp/up2/deveco-cli/packages/cli/src/smoke/screen-phash.ts")};\n`);
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
const differ = rows.filter((r) => r.ours_blank !== r.upstream_blank);
const ev = evidence("upstream", "blank-verdict.json", rows);
record("A.upstream.run.smoke-blank", differ.length ? "DEFECT" : "VERIFIED",
  differ.length ? `blank-screen verdict differs from upstream on ${differ.length}/${rows.length} images: ${differ.map((r) => `${r.case} (ours ${r.ours_blank}, upstream ${r.upstream_blank}/h${r.upstream_hamming})`).join("; ")}` : "same verdict as upstream on all test images", [ev]);
fs.rmSync(out, { recursive: true, force: true });
