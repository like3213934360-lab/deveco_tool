import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const PACK_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const MANIFEST = JSON.parse(await fs.readFile(path.join(PACK_ROOT, "manifest.json"), "utf8"));

/**
 * Every counted claim the prose makes about the pack's size. These numbers used to be scattered
 * across four documents with nothing checking them, so they drifted every time the pack grew.
 * The manifest is the single source of truth; these patterns assert the prose agrees with it.
 */
const DOCS = ["README.md", "PACK.md", "provenance/INVENTORY.md", "skills/INDEX.md"];

// provenance/INVENTORY.md is a per-source breakdown, so a count like "10 个 Skill from 0.2.0" is
// correct there and must not be compared against the pack total. It is still checked for tool and
// script counts, which have no legitimate subset phrasing.
const TOTAL_COUNT_DOCS = DOCS.filter((doc) => doc !== "provenance/INVENTORY.md");

test("prose skill counts agree with the manifest", async () => {
  const expected = MANIFEST.skills.length;
  const core = MANIFEST.skills.filter((skill) => skill.tier === "core").length;
  const extended = expected - core;

  for (const doc of TOTAL_COUNT_DOCS) {
    const text = await fs.readFile(path.join(PACK_ROOT, doc), "utf8");
    // "第 5 个 Skill" is an ordinal, not a count.
    for (const match of text.matchAll(/(?<!第\s?)(\d+)\s*个\s*Skill/gi)) {
      const claimed = Number(match[1]);
      assert.ok(
        [expected, core, extended].includes(claimed),
        `${doc} claims "${match[0]}" but the manifest has ${expected} skills (${core} core / ${extended} extended)`,
      );
    }
  }
});

test("prose tool counts agree with the manifest", async () => {
  const expected = MANIFEST.mcp.toolCount;
  const advertised = MANIFEST.mcp.toolGroups.flatMap((group) => group.tools).length;
  assert.equal(advertised, expected, "toolGroups and toolCount disagree inside the manifest itself");

  for (const doc of DOCS) {
    const text = await fs.readFile(path.join(PACK_ROOT, doc), "utf8");
    for (const match of text.matchAll(/(\d+)\s*个工具/g)) {
      assert.equal(
        Number(match[1]),
        expected,
        `${doc} claims "${match[0]}" but the manifest advertises ${expected} tools`,
      );
    }
  }
});

test("prose script counts agree with the registry", async () => {
  const { listScripts } = await import("../src/script-registry.mjs");
  const expected = listScripts().length;

  for (const doc of DOCS) {
    const text = await fs.readFile(path.join(PACK_ROOT, doc), "utf8");
    for (const match of text.matchAll(/(\d+)\s*个(?:可调用)?脚本/g)) {
      assert.equal(
        Number(match[1]),
        expected,
        `${doc} claims "${match[0]}" but the registry has ${expected} scripts`,
      );
    }
  }
});

/**
 * Walk a directory tree and yield every file path below it.
 * @param {string} dir Absolute directory to walk.
 * @returns {Promise<string[]>} Absolute paths of every file below `dir`.
 */
async function allFiles(dir) {
  const found = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await allFiles(full)));
    else found.push(full);
  }
  return found;
}

test("no OS metadata file ships with the installable assets", async () => {
  // .gitignore keeps these out of git but not out of the installer: it links or copies whatever
  // is on disk, so a stray .DS_Store lands in the host's skill directory and may be indexed there.
  // __pycache__ appears the moment any of the 11 registered Python scripts runs, so this is the
  // one that actually recurs.
  const junk = new Set([".DS_Store", "Thumbs.db", "desktop.ini", "__pycache__"]);
  const offenders = [];
  for (const file of await allFiles(path.join(PACK_ROOT, "skills"))) {
    if (junk.has(path.basename(file)) || file.includes(`${path.sep}__pycache__${path.sep}`)) {
      offenders.push(path.relative(PACK_ROOT, file));
    }
  }
  assert.deepEqual(offenders, [], `OS metadata must not ship: ${offenders.join(", ")}`);
});

test("the LICENSE scope section agrees with the official skills and file headers", async () => {
  const license = await fs.readFile(path.join(PACK_ROOT, "LICENSE"), "utf8");

  assert.match(license, /Copyright \(c\) \d{4} dreamlike/, "the licence must not claim upstream's copyright");
  assert.match(
    license,
    new RegExp(`The ${MANIFEST.skills.length} official skills under`),
    `LICENSE must state ${MANIFEST.skills.length} official skills`,
  );

  // Files carrying a third-party header are governed by that header, not by the root licence,
  // so the count has to match reality rather than a number someone typed once.
  const perSkill = new Map();
  for (const file of await allFiles(path.join(PACK_ROOT, "skills"))) {
    if (!(await fs.readFile(file, "utf8")).includes("Apache License")) continue;
    const skill = path.relative(path.join(PACK_ROOT, "skills"), file).split(path.sep)[0];
    perSkill.set(skill, (perSkill.get(skill) ?? 0) + 1);
  }
  const total = [...perSkill.values()].reduce((sum, count) => sum + count, 0);
  assert.match(
    license,
    new RegExp(`${total} files in this repository carry an Apache-2\\.0`),
    `LICENSE must state ${total} Apache-2.0 headed files`,
  );
  for (const [skill, count] of perSkill) {
    assert.match(
      license,
      new RegExp(`\`${skill}\`\\s+${count}\\b`),
      `LICENSE must record ${skill} as ${count} Apache-2.0 headed files`,
    );
  }
});

test("every provenance source file referenced by the docs exists", async () => {
  for (const file of ["provenance/SOURCES.md", "provenance/INVENTORY.md", "NOTICE.deveco-code",
    "provenance/deveco-code-v0.1.5.commit", "provenance/deveco-code-v0.1.6.commit",
    "provenance/deveco-code-v0.1.11.commit", "provenance/deveco-code-v0.1.11.skills.sha256",
    "skills/INDEX.md"]) {
    await fs.access(path.join(PACK_ROOT, file));
  }
});

test("every pinned commit is a real sha and is cited by SOURCES.md", async () => {
  // Skill bytes and historical adapted assets use different pins. Require every lock file to be
  // cited so those roles cannot silently drift apart.
  const provenance = path.join(PACK_ROOT, "provenance");
  const sources = await fs.readFile(path.join(provenance, "SOURCES.md"), "utf8");
  const pins = (await fs.readdir(provenance)).filter((name) => name.endsWith(".commit"));
  assert.ok(pins.length > 0, "at least one pinned commit must be recorded");

  for (const pin of pins) {
    const sha = (await fs.readFile(path.join(provenance, pin), "utf8")).trim();
    assert.match(sha, /^[0-9a-f]{40}$/, `${pin} must hold a full 40-character commit sha`);
    assert.ok(sources.includes(sha), `SOURCES.md must cite the sha pinned in ${pin}`);
  }
});
