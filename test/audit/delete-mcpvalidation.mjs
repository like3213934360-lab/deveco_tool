// User-approved (2026-09-30): delete the certificate MCPValidationd98b7ba2 left by an earlier MCP
// validation session. Only that one; lists before/after saved as evidence.
import { evidence, mcp, record } from "./lib.mjs";
const c = await mcp({ shared: true });
const team = process.env.AUDIT_TEAM; // personal team id (auth action=teams), where the certificate lives
if (!team) { console.error("set AUDIT_TEAM"); process.exit(2); }
const before = (await c.call("sign", { action: "certificates", team })).data.certificates;
const target = before.filter((x) => x.name === "MCPValidationd98b7ba2");
if (target.length !== 1) { console.error("expected exactly one MCPValidationd98b7ba2, found", target.length); process.exit(2); }
const del = await c.call("sign", { action: "delete_certificate", team, id: target[0].id });
const after = (await c.call("sign", { action: "certificates", team })).data.certificates;
await c.close();
const ev = evidence("real-sign", "delete-mcpvalidation.json", { before: before.map((x) => x.name), deleted: del.data, after: after.map((x) => x.name) });
const ok = !del.isError && after.length === before.length - 1 && !after.some((x) => x.name === "MCPValidationd98b7ba2");
record("B.real-sign.delete-mcpvalidation", ok ? "VERIFIED" : "DEFECT", `certificates ${before.length} -> ${after.length}; deleted ${JSON.stringify(del.data)}; remaining: ${after.map((x) => x.name).join(", ")}`, [ev]);
