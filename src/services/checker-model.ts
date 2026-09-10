// Source adaptation of upstream component-model checks. Resolve declarations
// with the SDK binder, so import aliases and lexical shadows retain identity.
import path from "node:path";
import type ts from "typescript";
import type { CheckDiagnostic } from "./checker.js";
import {
  arkCall,
  arkDecorators,
  arkRootCall,
  type ArkSyntax,
} from "./checker-syntax.js";

export function checkerModel(
  syntax: ArkSyntax,
  sources: ReadonlyMap<string, ts.SourceFile>,
  selected: readonly string[],
  root: string,
  components: ReadonlySet<string>,
  moduleEntries: ReadonlyMap<string, string> = new Map(),
) {
  const canonical = (file: string) => path.normalize(file);
  // The compiler normalizes SourceFile.fileName to forward slashes, including
  // on Windows. Compare source identities in the same form as selected paths.
  const selectedFiles = new Set(selected.map(canonical));
  const lookup = (file: string) => sources.get(canonical(file));
  const resolve = (specifier: string, from: string) => {
    const base = specifier.startsWith(".")
      ? path.resolve(path.dirname(from), specifier)
      : moduleEntries.get(specifier);
    if (!base) return;
    const file = [
      base,
      base + ".ets",
      base + ".ts",
      path.join(base, "Index.ets"),
      path.join(base, "index.ets"),
      path.join(base, "index.ts"),
    ].find((candidate) => lookup(candidate));
    return file
      ? {
          resolvedFileName: canonical(file),
          extension: path.extname(file) as ts.Extension,
        }
      : undefined;
  };
  // No default library, filesystem host, or dependency reads. This program only
  // binds the already bounded application ASTs; the SDK checker owns type errors.
  const host: ts.CompilerHost = {
    getSourceFile: lookup,
    getDefaultLibFileName: () => "",
    writeFile: () => {},
    getCurrentDirectory: () => root,
    getDirectories: () => [],
    fileExists: (file) => !!lookup(file),
    readFile: (file) => lookup(file)?.text,
    getCanonicalFileName: canonical,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    resolveModuleNames: (names, from) =>
      names.map((name) => resolve(name, from)),
  };
  const program = syntax.createProgram(
    [...sources.keys()],
    {
      noLib: true,
      noEmit: true,
      allowNonTsExtensions: true,
    },
    host,
  );
  const checker = program.getTypeChecker();
  const diagnostics: CheckDiagnostic[] = [];
  const emitted = new Set<string>();
  const add = (
    node: ts.Node,
    rule: string,
    message: string,
    reportAt = node,
  ) => {
    // A referenced declaration may be outside selected files. Attribute route
    // failures to the selected registration in that case, never widen scope.
    const source = reportAt.getSourceFile();
    if (!selectedFiles.has(canonical(source.fileName))) return;
    const at = source.getLineAndCharacterOfPosition(reportAt.getStart(source));
    const key = `${source.fileName}:${at.line}:${at.character}:${rule}`;
    if (emitted.has(key)) return;
    emitted.add(key);
    diagnostics.push({
      file: path.relative(root, source.fileName),
      line: at.line + 1,
      column: at.character + 1,
      severity: "error",
      rule,
      message,
    });
  };
  const declarations = (node: ts.Node) => {
    let symbol = checker.getSymbolAtLocation(node);
    if (symbol && symbol.flags & syntax.SymbolFlags.Alias)
      symbol = checker.getAliasedSymbol(symbol);
    return symbol?.declarations ?? [];
  };
  const observed = (node: ts.Node) => {
    const type = syntax.isTypeNode(node)
      ? checker.getTypeFromTypeNode(node)
      : checker.getTypeAtLocation(node);
    return type
      .getSymbol()
      ?.declarations?.find(
        (declaration) =>
          syntax.isClassDeclaration(declaration) &&
          arkDecorators(syntax, declaration).has("ObservedV2"),
      );
  };
  type RootCall = NonNullable<ReturnType<typeof arkRootCall>>;
  const roots = (node: ts.Node): RootCall[] => {
    if (
      syntax.isBlock(node) ||
      syntax.isCaseClause(node) ||
      syntax.isDefaultClause(node)
    )
      return node.statements.flatMap(roots);
    if (syntax.isIfStatement(node))
      return [
        ...roots(node.thenStatement),
        ...(node.elseStatement ? roots(node.elseStatement) : []),
      ];
    if (syntax.isSwitchStatement(node))
      return node.caseBlock.clauses.flatMap(roots);
    if (!syntax.isExpressionStatement(node)) return [];
    const call = arkRootCall(syntax, node.expression);
    if (!call) return [];
    // Lowercase helper methods are not UI roots. Calls to unresolved external
    // components stay unknown, and are never inferred from another file's name.
    const name = syntax.isIdentifier(call.expression)
      ? call.expression.text
      : syntax.isPropertyAccessExpression(call.expression)
        ? call.expression.name.text
        : "";
    return /^[A-Z]/.test(name) ? [call] : [];
  };
  const isDestination = (
    call: RootCall,
    seen = new Set<ts.Node>(),
  ): boolean | undefined => {
    if (
      syntax.isIdentifier(call.expression) &&
      components.has(call.expression.text)
    )
      return call.expression.text === "NavDestination";
    const declaration = declarations(call.expression).find(
      syntax.isStructDeclaration,
    );
    if (!declaration || seen.has(declaration)) return;
    const build = declaration.members.find(
      (member): member is ts.MethodDeclaration =>
        syntax.isMethodDeclaration(member) &&
        syntax.isIdentifier(member.name) &&
        member.name.text === "build",
    );
    if (!build?.body) return;
    const nested = roots(build.body);
    if (!nested.length) return;
    const next = new Set(seen).add(declaration),
      states = nested.map((item) => isDestination(item, next));
    return states.some((value) => value === false)
      ? false
      : states.every((value) => value === true)
        ? true
        : undefined;
  };
  const stateTags = new Set(["State", "Prop", "Provide", "Consume"]);
  for (const file of selected) {
    const source = lookup(file)!;
    const visit = (node: ts.Node): void => {
      if (syntax.isPropertyDeclaration(node) && node.type) {
        const tags = arkDecorators(syntax, node),
          incompatible = [...tags.keys()].find((tag) => stateTags.has(tag));
        if (incompatible && observed(node.type))
          add(
            node,
            "observed-v2-state-property-type",
            `@${incompatible} cannot hold an @ObservedV2 class; use the V2 component state model or a compatible V1 value.`,
          );
      }
      if (
        arkCall(syntax, node) &&
        node.arguments[0] &&
        syntax.isObjectLiteralExpression(node.arguments[0])
      ) {
        const declaration = declarations(node.expression).find(
          syntax.isStructDeclaration,
        );
        if (
          declaration &&
          arkDecorators(syntax, declaration).has("ComponentV2")
        ) {
          const forbidden = new Map<string, "regular" | "local">();
          for (const member of declaration.members) {
            if (
              !syntax.isPropertyDeclaration(member) ||
              !syntax.isIdentifier(member.name)
            )
              continue;
            const tags = arkDecorators(syntax, member);
            if (!tags.size || tags.has("Local"))
              forbidden.set(
                member.name.text,
                tags.has("Local") ? "local" : "regular",
              );
          }
          for (const property of node.arguments[0].properties) {
            if (
              !property.name ||
              !(
                syntax.isIdentifier(property.name) ||
                syntax.isStringLiteral(property.name)
              )
            )
              continue;
            const kind = forbidden.get(property.name.text);
            if (kind)
              add(
                property.name,
                kind + "-property-init",
                `The ${kind === "local" ? "@Local" : "undecorated"} property '${property.name.text}' in '${declaration.name?.text}' cannot be supplied by its parent. Use @Param for parent input, or remove this argument.`,
              );
          }
        }
      }
      if (
        syntax.isCallExpression(node) &&
        syntax.isPropertyAccessExpression(node.expression)
      ) {
        const access = node.expression,
          base = access.expression;
        if (
          access.name.text === "setOrCreate" &&
          syntax.isIdentifier(base) &&
          base.text === "AppStorage" &&
          !declarations(base).length
        ) {
          const value = node.arguments[1];
          if (
            (node.typeArguments?.[0] && observed(node.typeArguments[0])) ||
            (value && observed(value))
          )
            add(
              node,
              "appstorage-observedv2-mixing",
              "V1 AppStorage.setOrCreate cannot store an @ObservedV2 instance. Use AppStorageV2.connect or PersistenceV2.connect.",
            );
        }
        const navigation = arkRootCall(syntax, node);
        if (
          navigation &&
          syntax.isIdentifier(navigation.expression) &&
          navigation.expression.text === "Navigation"
        ) {
          if (
            access.name.text === "hideNavBar" &&
            node.arguments[0]?.kind === syntax.SyntaxKind.TrueKeyword &&
            syntax.isEtsComponentExpression(navigation) &&
            navigation.body &&
            roots(navigation.body).length
          )
            add(
              access.name,
              "hide-nav-bar-hides-content",
              "hideNavBar(true) hides the Navigation content as well as its bars. Use hideTitleBar(true) when the intent is to hide only the title.",
            );
          if (access.name.text === "navDestination" && node.arguments[0]) {
            const argument = node.arguments[0];
            const builder = syntax.isArrowFunction(argument)
              ? argument
              : declarations(argument).find(
                  (declaration) =>
                    (syntax.isMethodDeclaration(declaration) ||
                      syntax.isFunctionDeclaration(declaration)) &&
                    arkDecorators(syntax, declaration).has("Builder"),
                );
            if (
              builder &&
              (syntax.isArrowFunction(builder) ||
                syntax.isMethodDeclaration(builder) ||
                syntax.isFunctionDeclaration(builder)) &&
              builder.body
            ) {
              for (const call of roots(builder.body))
                if (isDestination(call) === false)
                  add(
                    call,
                    "nav-destination-root-node",
                    `The registered route builds '${call.expression.getText()}' without a NavDestination root. Wrap that branch, or make NavDestination the root of the destination component.`,
                    selectedFiles.has(canonical(call.getSourceFile().fileName))
                      ? call
                      : node,
                  );
            }
          }
        }
      }
      syntax.forEachChild(node, visit);
    };
    visit(source);
  }
  return diagnostics;
}
