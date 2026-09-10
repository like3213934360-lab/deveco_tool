import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import {
  checkerSyntax,
  type ArkSyntax,
} from "../src/services/checker-syntax.js";

// Portable unit fixtures use class-shaped structs. The real SDK acceptance
// separately parses actual ArkTS struct nodes and free @Builder functions.
const syntax = {
    ...ts,
    ScriptKind: { ...ts.ScriptKind, ETS: ts.ScriptKind.TS },
    isStructDeclaration: ts.isClassDeclaration,
    isEtsComponentExpression: (_node: ts.Node): _node is never => false,
  } as ArkSyntax,
  components = {
    builtins: new Set(["Column", "Text", "Image"]),
    containers: new Set(["Column", "Text"]),
  };
const check = (text: string) =>
  checkerSyntax(
    syntax,
    ts.createSourceFile(
      "/project/Page.ets",
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    ),
    "/project",
    components,
  );

test("AST decorator checks ignore comments and literals, retain shared decorators and inspect each actual property", () => {
  const valid = check(`
    // @Entry @State fake
    @Entry @ComponentV2 class Page {
      @Require @Param label: string;
      @BuilderParam content: () => void;
      @Watch('watch') @Local value = '@State false-positive';
      build() { Column() }
    }`);
  assert.deepEqual(valid.diagnostics, []);
  assert.deepEqual(valid.pageEntry(), []);
  const invalid =
    check(`@ComponentV2 class Page { @State count: number = 1; @Param title: string; }
    @Component class Other { @Param title: string = ''; @State callback: () => void; }`);
  assert.deepEqual(
    invalid.diagnostics.map((row) => row.rule),
    [
      "component-decorator-version-mismatch",
      "param-requires-require",
      "component-decorator-version-mismatch",
      "v1-decorator-function-type",
    ],
  );
});

test("only top-level Entry structs count and built-in collisions and multiple roots are diagnosed", () => {
  assert.equal(
    check("/* @Entry */ class Page {}").pageEntry()[0]?.rule,
    "page-entry-count",
  );
  assert.equal(
    check("@Entry class First {} @Entry class Second {}").pageEntry()[0]?.rule,
    "page-entry-count",
  );
  const invalid = check(
    "@Entry @Component class Image { build() { Column(); Text('second'); } }",
  );
  assert.deepEqual(
    invalid.diagnostics.map((row) => row.rule),
    ["struct-name-builtin-collision", "entry-build-root-node"],
  );
});

test("UI-only checks inspect list item builders but allow imperative event callbacks on the same line", () => {
  const result = check(`@Component class Page {
    build() { Column(); { ForEach(items, (item) => { const wrong = item; Text(item).onClick(() => { const valid = 1; for (let i=0; i<valid; i++) {} }); }); } }
    @Builder render() { for (const value of items) { Text(value); } }
  }`);
  assert.deepEqual(
    result.diagnostics.map((row) => row.rule),
    ["builder-body-ui-only", "builder-body-ui-only"],
  );
  assert.match(result.diagnostics[0]!.message, /UI component syntax/);
});

test("multiple destination registrations are confined to the same call chain", () => {
  assert.deepEqual(
    check(
      "Navigation().navDestination(first); Navigation().navDestination(second);",
    ).diagnostics,
    [],
  );
  assert.equal(
    check(
      "Navigation().navDestination(first).width('100%').navDestination(second);",
    ).diagnostics[0]?.rule,
    "navigation-multiple-navdestination",
  );
});
