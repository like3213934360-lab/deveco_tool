import test from "node:test";
import assert from "node:assert/strict";
import { apiReport, parseCsv } from "../src/core/csv.js";
import { tools } from "../src/core/contracts.js";
import { withinDeadline } from "../src/core/deadline.js";
import { setTimeout as delay } from "node:timers/promises";
import { validateCsrPem } from "../src/services/signature.js";

test("CSR envelopes accept both SDK and standard PEM labels and reject malformed requests", () => {
  const body = Buffer.from([0x30, 3, 2, 1, 0]).toString("base64");
  for (const label of ["CERTIFICATE REQUEST", "NEW CERTIFICATE REQUEST"]) {
    const pem = `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
    assert.equal(validateCsrPem(pem), pem);
    assert.throws(() => validateCsrPem(pem.replace(body, body + "garbage")), {
      code: "CSR_INVALID",
    });
    assert.throws(() => validateCsrPem(pem + pem), { code: "CSR_INVALID" });
  }
  assert.throws(
    () =>
      validateCsrPem(
        `-----BEGIN NEW CERTIFICATE REQUEST-----\n${body}\n-----END CERTIFICATE REQUEST-----`,
      ),
    { code: "CSR_INVALID" },
  );
  for (const data of [
    [0x30, 9, 2, 1, 0],
    [0x30, 0x80, 2, 1, 0],
    [0x30, 0x81, 3, 2, 1, 0],
  ]) {
    assert.throws(
      () =>
        validateCsrPem(
          `-----BEGIN CERTIFICATE REQUEST-----\n${Buffer.from(data).toString("base64")}\n-----END CERTIFICATE REQUEST-----`,
        ),
      { code: "CSR_INVALID" },
    );
  }
});

test("CSV parsing preserves UTF-8, commas, escaped quotes and embedded newlines", () => {
  assert.deepEqual(
    parseCsv('\uFEFFa,b,c\r\n"中文,🙂","line1\nline2","a""b"\r\n'),
    [
      ["a", "b", "c"],
      ["中文,🙂", "line1\nline2", 'a"b'],
    ],
  );
  for (const text of ['a,"unfinished', 'a,"closed"oops', 'unquoted"quote,b'])
    assert.throws(() => parseCsv(text), { code: "CSV_INVALID" });
});
test("native API reports distinguish empty valid findings from missing or malformed reports", () => {
  const header =
    "Api Definition,Language,ChangeId,Changed in SDK,Affected Versions,Title,Code Location,Change Type\r\n";
  assert.deepEqual(apiReport(header), []);
  for (const input of ["", "invalid\n", header + "one,two\n"])
    assert.throws(() => apiReport(input), { code: "API_REPORT_INVALID" });
  const csv =
    header +
    'declare const Text,ArkTS,CH1,26,ALL,"=HYPERLINK(""https://developer.huawei.com/example"",""中文标题"")",entry/Index.ets:23,UX\r\n';
  const findings = apiReport(csv);
  assert.equal(findings[0]?.title, "中文标题");
  assert.equal(findings[0]?.source_url, "https://developer.huawei.com/example");
  assert.equal(findings[0]?.location, "entry/Index.ets:23");
});
test("knowledge read uses independent content pagination limits", () => {
  assert.equal(
    tools.harmony_knowledge.schema.parse({
      action: "read",
      id: "example",
      limit: 16384,
    }).limit,
    16384,
  );
  assert.throws(() =>
    tools.harmony_knowledge.schema.parse({
      action: "search",
      query: "ArkTS",
      limit: 16384,
    }),
  );
});
test("a deadline waits for cancellation cleanup before reporting timeout", async () => {
  let stopped = false;
  await assert.rejects(
    withinDeadline(20, undefined, "TEST_TIMEOUT", async (signal) => {
      try {
        await delay(1000, undefined, { signal });
      } finally {
        await delay(30);
        stopped = true;
      }
    }),
    { code: "TEST_TIMEOUT" },
  );
  assert.equal(stopped, true);
});
