// AST adaptations of the upstream ArkUI checks; no client Skill installation.
import path from "node:path";
import type ts from "typescript";
import type { CheckDiagnostic } from "./checker.js";

export interface EtsComponent extends ts.Expression {
  expression: ts.Expression;
  arguments: ts.NodeArray<ts.Expression>;
  body?: ts.Block;
}
export type ArkSyntax = typeof ts & {
  isStructDeclaration(node: ts.Node): node is ts.ClassDeclaration;
  isEtsComponentExpression(node: ts.Node): node is EtsComponent;
  ScriptKind: typeof ts.ScriptKind & { ETS: number };
  createSourceFile(
    file: string,
    text: string,
    target: ts.ScriptTarget,
    parents: boolean,
    kind: ts.ScriptKind,
    options: ts.CompilerOptions,
  ): ts.SourceFile;
};
export function arkDecorators(syntax: ArkSyntax, node: ts.Node) {
  const found = new Map<string, ts.Decorator>();
  // ArkTS also decorates free @Builder functions.
  syntax.forEachChild(node, (child) => {
    if (!syntax.isDecorator(child)) return;
    const expression = syntax.isCallExpression(child.expression)
      ? child.expression.expression
      : child.expression;
    if (syntax.isIdentifier(expression)) found.set(expression.text, child);
  });
  return found;
}
export function arkCall(
  syntax: ArkSyntax,
  node: ts.Node,
): node is ts.CallExpression | EtsComponent {
  return syntax.isCallExpression(node) || syntax.isEtsComponentExpression(node);
}
export function arkRootCall(
  syntax: ArkSyntax,
  node: ts.Expression,
): ts.CallExpression | EtsComponent | undefined {
  if (!arkCall(syntax, node)) return;
  if (syntax.isPropertyAccessExpression(node.expression))
    return arkRootCall(syntax, node.expression.expression) ?? node;
  return node;
}
const v1 = new Set([
  "State",
  "Prop",
  "Link",
  "Provide",
  "Consume",
  "ObjectLink",
  "StorageLink",
  "StorageProp",
  "LocalStorageLink",
  "LocalStorageProp",
]);
const v2 = new Set(["Local", "Param", "Once", "Event", "Provider", "Consumer"]);

export function checkerSyntax(
  syntax: ArkSyntax,
  source: ts.SourceFile,
  root: string,
  components: {
    containers: ReadonlySet<string>;
    builtins: ReadonlySet<string>;
  },
) {
  const diagnostics: CheckDiagnostic[] = [];
  const decorators = (node: ts.Node) => arkDecorators(syntax, node);
  const add = (node: ts.Node, rule: string, message: string) => {
    const at = source.getLineAndCharacterOfPosition(node.getStart(source));
    diagnostics.push({
      file: path.relative(root, source.fileName),
      line: at.line + 1,
      column: at.character + 1,
      severity: "error",
      rule,
      message,
    });
  };
  const entry = source.statements.filter(
    (node) => syntax.isStructDeclaration(node) && decorators(node).has("Entry"),
  );
  const uiBody = (body: ts.Node): void => {
    if (
      syntax.isVariableStatement(body) ||
      syntax.isForStatement(body) ||
      syntax.isForInStatement(body) ||
      syntax.isForOfStatement(body) ||
      syntax.isWhileStatement(body) ||
      syntax.isDoStatement(body)
    ) {
      add(
        body,
        "builder-body-ui-only",
        "Use UI component syntax inside build or @Builder; move local variables and imperative loops into a regular method.",
      );
      return;
    }
    if (
      syntax.isArrowFunction(body) ||
      syntax.isFunctionExpression(body) ||
      syntax.isFunctionDeclaration(body)
    )
      return;
    if (arkCall(syntax, body)) {
      for (const [index, argument] of body.arguments.entries()) {
        if (
          index === 1 &&
          syntax.isIdentifier(body.expression) &&
          ["ForEach", "LazyForEach"].includes(body.expression.text) &&
          syntax.isArrowFunction(argument)
        )
          uiBody(argument.body);
        else uiBody(argument);
      }
      uiBody(body.expression);
      if (syntax.isEtsComponentExpression(body) && body.body) uiBody(body.body);
      return;
    }
    syntax.forEachChild(body, uiBody);
  };
  const callRoot = (node: ts.Expression): string | undefined => {
    const call = arkRootCall(syntax, node);
    return call && syntax.isIdentifier(call.expression)
      ? call.expression.text
      : undefined;
  };
  const visit = (node: ts.Node): void => {
    if (syntax.isStructDeclaration(node)) {
      const tags = decorators(node),
        name = node.name?.text ?? "<anonymous>";
      if (components.builtins.has(name))
        add(
          node.name ?? node,
          "struct-name-builtin-collision",
          `Struct '${name}' collides with an SDK built-in component; rename it and its references.`,
        );
      const version = tags.has("ComponentV2")
        ? 2
        : tags.has("Component")
          ? 1
          : undefined;
      for (const member of node.members) {
        if (syntax.isPropertyDeclaration(member) && version) {
          const memberTags = decorators(member),
            forbidden = version === 2 ? v1 : v2;
          for (const [tag, decorator] of memberTags)
            if (forbidden.has(tag))
              add(
                decorator,
                "component-decorator-version-mismatch",
                `@${tag} is incompatible with @Component${version === 2 ? "V2" : ""} on '${name}'.`,
              );
          if (
            memberTags.has("Param") &&
            !member.initializer &&
            !member.questionToken &&
            !memberTags.has("Require")
          )
            add(
              member,
              "param-requires-require",
              "A @Param without a default must also have @Require.",
            );
          if (
            member.type &&
            (syntax.isFunctionTypeNode(member.type) ||
              (syntax.isTypeReferenceNode(member.type) &&
                syntax.isIdentifier(member.type.typeName) &&
                member.type.typeName.text === "Function"))
          )
            for (const tag of ["State", "Prop", "Link"])
              if (memberTags.has(tag))
                add(
                  member,
                  "v1-decorator-function-type",
                  `@${tag} cannot hold a function-typed value; use an appropriate callback property.`,
                );
        }
        if (!syntax.isMethodDeclaration(member) || !member.body) continue;
        const isBuild =
          syntax.isIdentifier(member.name) && member.name.text === "build";
        if (isBuild || decorators(member).has("Builder")) uiBody(member.body);
        if (isBuild && tags.has("Entry")) {
          const roots = member.body.statements.flatMap((statement) => {
            if (!syntax.isExpressionStatement(statement)) return [];
            const name = callRoot(statement.expression);
            return name && /^[A-Z]/.test(name)
              ? [{ name, node: statement }]
              : [];
          });
          if (roots.length > 1)
            add(
              roots[1]!.node,
              "entry-build-root-node",
              "An @Entry build method must have one root container; wrap its multiple roots.",
            );
          else if (
            roots.length === 1 &&
            components.builtins.has(roots[0]!.name) &&
            !components.containers.has(roots[0]!.name)
          )
            add(
              roots[0]!.node,
              "entry-build-root-node",
              `@Entry root '${roots[0]!.name}' is not an SDK container.`,
            );
        }
      }
    }
    if (
      syntax.isFunctionDeclaration(node) &&
      node.body &&
      decorators(node).has("Builder")
    )
      uiBody(node.body);
    if (
      syntax.isCallExpression(node) &&
      syntax.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "navDestination"
    ) {
      let prior: ts.Expression = node.expression.expression;
      while (
        syntax.isCallExpression(prior) &&
        syntax.isPropertyAccessExpression(prior.expression)
      ) {
        if (prior.expression.name.text === "navDestination") {
          add(
            node.expression.name,
            "navigation-multiple-navdestination",
            "Repeated navDestination calls on one chain replace the preceding builder; register one builder that selects the route.",
          );
          break;
        }
        prior = prior.expression.expression;
      }
    }
    syntax.forEachChild(node, visit);
  };
  visit(source);
  return {
    diagnostics,
    pageEntry: () =>
      entry.length === 1
        ? []
        : [
            {
              file: path.relative(root, source.fileName),
              line: 1,
              column: 1,
              severity: "error" as const,
              rule: "page-entry-count",
              message: `A registered page must contain exactly one top-level @Entry struct; found ${entry.length}.`,
            },
          ],
    hasExportedBuilder: (name: string) =>
      source.statements.some(
        (node) =>
          syntax.isFunctionDeclaration(node) &&
          node.name?.text === name &&
          !!node.body &&
          decorators(node).has("Builder") &&
          node.modifiers?.some(
            (modifier) => modifier.kind === syntax.SyntaxKind.ExportKeyword,
          ),
      ),
  };
}
