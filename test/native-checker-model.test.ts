import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import ts from "typescript";
import { checkerModel } from "../src/services/checker-model.js";
import type { ArkSyntax } from "../src/services/checker-syntax.js";

// Real ArkTS structs and component bodies are covered by SDK acceptance.
const syntax = {
  ...ts,
  ScriptKind: { ...ts.ScriptKind, ETS: ts.ScriptKind.TS },
  isStructDeclaration: ts.isClassDeclaration,
  isEtsComponentExpression: (_node: ts.Node): _node is never => false,
} as ArkSyntax;
const check = (files: Record<string, string>, selected = ["Page.ts"]) => {
  const sources = new Map(
    Object.entries(files).map(([file, text]) => {
      const name = path.resolve("/project", file);
      return [
        name,
        ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true),
      ] as const;
    }),
  );
  return checkerModel(
    syntax,
    sources,
    selected.map((file) => path.resolve("/project", file)),
    path.resolve("/project"),
    new Set(["Column", "Text", "Navigation", "NavDestination"]),
  );
};
const child = `@ComponentV2 export class Child {
  callback: () => void = () => {}; @Local count = 0; @Param label = '';
  build() { Column(); }
}`;
test("component arguments resolve named aliases and re-exports, stay shallow and preserve V1 callbacks", () => {
  const result = check({
    "Child.ts": child,
    "barrel.ts": `export { Child as Card } from './Child';`,
    "Page.ts": `import { Card as Alias } from './barrel';
      Alias({ callback: () => {}, count: 1, label: 'valid' });
      Alias({ label: { callback: 'nested' } });
      @Component class Old { callback: () => void = () => {}; }
      Old({ callback: () => {} });`,
  });
  assert.deepEqual(
    result.map((row) => row.rule),
    ["regular-property-init", "local-property-init"],
  );
  assert.ok(result.every((row) => row.file === "Page.ts"));
});
test("same names in unrelated modules and shadowed component calls do not collide", () => {
  const result = check({
    "Other.ts": child,
    "Child.ts": `@ComponentV2 export class Child { @Param callback: () => void = () => {}; }`,
    "Page.ts": `import { Child } from './Child'; Child({ callback: () => {} });
      function scoped(Child: (value: object) => void) { Child({ callback: () => {} }); }`,
  });
  assert.deepEqual(result, []);
});
test("ObservedV2 follows type aliases and inferred instance values without confusing ordinary classes or shadowed storage", () => {
  const result = check({
    "Model.ts": `@ObservedV2 export class Model { value = ''; }`,
    "Page.ts": `import { Model as Alias } from './Model'; type ViewModel = Alias;
      @Component class Page {
        @State model: ViewModel = new Alias();
        save() { AppStorage.setOrCreate('model', this.model); }
      }
      const instance = new Alias(); AppStorage.setOrCreate('instance', instance);
      AppStorage.setOrCreate<Alias>('generic', undefined);
      class Ordinary { value = ''; } AppStorage.setOrCreate('plain', new Ordinary());
      function scoped(AppStorage: { setOrCreate(key: string, value: Alias): void }) {
        AppStorage.setOrCreate('shadow', instance);
      }`,
  });
  assert.deepEqual(
    result.map((row) => row.rule),
    [
      "observed-v2-state-property-type",
      ...Array(3).fill("appstorage-observedv2-mixing"),
    ],
  );
});
test("destination checks validate every registered branch and accept imported wrapped roots and unknown external pages", () => {
  const result = check({
    "Child.ts": child,
    "Wrapped.ts": `@Component export class Wrapped { build() { NavDestination(); } }`,
    "Page.ts": `import { Child as Bare } from './Child'; import { Wrapped as Good } from './Wrapped';
      import { LibraryPage } from 'external';
      @Component class Page {
        @Builder route(name: string) {
          if (name === 'good') { Good(); }
          else if (name === 'bad') { Bare(); }
          else if (name === 'library') { LibraryPage(); }
          else { Column(); }
        }
        @Builder unregistered() { Text('not a route'); }
        build() { Navigation().navDestination(this.route); }
      }`,
  });
  assert.deepEqual(
    result.map((row) => row.rule),
    ["nav-destination-root-node", "nav-destination-root-node"],
  );
  assert.match(result[0]!.message, /Bare/);
  assert.match(result[1]!.message, /Column/);
});
test("an imported route builder reports its failure at the selected registration", () => {
  const result = check({
    "route.ts": `@Builder export function route() { Column(); }`,
    "Page.ts": `import { route } from './route'; Navigation().navDestination(route);`,
  });
  assert.equal(result.length, 1);
  assert.equal(result[0]!.file, "Page.ts");
});
test("compiler-normalized source names keep diagnostics inside the selected scope", () => {
  const root = path.resolve("/project"),
    name = path.join(root, "Page.ts"),
    source = ts.createSourceFile(
      name,
      "@ComponentV2 class Child { @Local count = 0; } Child({ count: 1 });",
      ts.ScriptTarget.Latest,
      true,
    );
  const result = checkerModel(
    syntax,
    new Map([[name, source]]),
    // A different spelling of the same selected file must remain in scope.
    [root + path.sep + "." + path.sep + "Page.ts"],
    root,
    new Set(),
  );
  assert.deepEqual(result.map((row) => row.rule), ["local-property-init"]);
  assert.equal(result[0]!.file, "Page.ts");
});
