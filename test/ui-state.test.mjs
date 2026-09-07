import assert from "node:assert/strict";
import test from "node:test";
import { analyseDump, readSelector } from "../src/device-dump.mjs";
import { normalizeSelector } from "../src/arkpilot/domain.mjs";
import { measureUiOperation, measureUiStage } from "../src/ui-performance.mjs";

const query = (attributes, selector) => analyseDump({
  root: { attributes: { type: "Toggle", bounds: "[0,0][100,100]", ...attributes } },
  selector: readSelector(selector),
});

test("missing state is unknown; false, zero and empty values remain addressable", () => {
  assert.equal(query({}, { checked: false }).matchCount, 0);
  assert.equal(query({ checked: "false" }, { checked: false }).matches[0].checked, false);
  assert.equal(query({ selected: "false" }, { selected: false }).matches[0].selected, false);
  assert.equal(query({ value: 0 }, { value: 0 }).matches[0].value, 0);
  assert.equal(query({ value: "" }, { value: "" }).matches[0].value, "");
  assert.notEqual(query({ checked: "false" }, {}).signature, query({ checked: "true" }, {}).signature);
  assert.equal(query({ checked: "false" }, {}).structureSignature, query({ checked: "true" }, {}).structureSignature);
  assert.deepEqual(normalizeSelector({ key: "toggle", checked: false }), { key: "toggle", checked: false });
  assert.throws(() => normalizeSelector({ key: "toggle", checked: "false" }), { code: "FLOW_SELECTOR_INVALID" });
});

test("inspector state aliases and accessibility shape share query semantics", () => {
  const result = analyseDump({ root: { $type: "Toggle", $rect: "[0,0],[100,100]",
    $attrs: { isOn: false, isSelected: true, value: 0 } }, selector: readSelector({ type: "Toggle", checked: false }) });
  assert.equal(result.matches[0].checked, false);
  assert.equal(result.matches[0].selected, true);
  assert.equal(result.matches[0].value, 0);
});

test("performance attribution isolates concurrent operations and retains failure evidence", async () => {
  const [one, two] = await Promise.all(["one", "two"].map(name => measureUiOperation(name, async () => {
    await measureUiStage(name, async () => { await new Promise(resolve => setTimeout(resolve, 5)); return { stdout: "abc" }; });
    return {};
  })));
  assert.notEqual(one.performance.operationId, two.performance.operationId);
  assert.deepEqual(Object.keys(one.performance.stages), ["one"]);
  assert.deepEqual(Object.keys(two.performance.stages), ["two"]);
  assert.equal(one.performance.stages.one.outputBytes, 3);
  await assert.rejects(() => measureUiOperation("failure", () => measureUiStage("dump", () => {
    throw Object.assign(new Error("timeout"), { code: "HDC_TIMEOUT" });
  })), error => {
    assert.equal(error.code, "HDC_TIMEOUT");
    assert.equal(error.performance.stages.dump.failures, 1);
    return true;
  });
});
