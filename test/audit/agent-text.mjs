// Records the sentence-level audit (agent-text.json) as findings; each item cites the finding it is judged against.
import fs from "node:fs";
import { record } from "./lib.mjs";
const { items } = JSON.parse(fs.readFileSync(new URL("./agent-text.json", import.meta.url), "utf8"));
items.forEach((it, i) => record(`D.text.${String(i + 1).padStart(2, "0")}`, it.verdict, `${it.where}: "${it.text.slice(0, 140)}" — ${it.evidence}`, ["test/audit/agent-text.json", "docs/audit/evidence/agent-text/tools.md"]));
