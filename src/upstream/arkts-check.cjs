#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');

// --- Argument parsing ---

function parseArgs(argv) {
  const args = { project: '', files: [] };
  let i = 2;
  while (i < argv.length) {
    if (argv[i] === '--project' && argv[i + 1]) {
      args.project = path.resolve(argv[++i]);
    } else if (argv[i] === '--files') {
      i++;
      while (i < argv.length && !argv[i].startsWith('--')) {
        args.files.push(argv[i++]);
      }
      continue;
    } else if (!argv[i].startsWith('--')) {
      args.files.push(argv[i]);
    }
    i++;
  }
  return args;
}

// --- DevEco SDK detection ---

function findDevecoHome() {
  // LOCAL PATCH: Command Line Tools uses the same sdk/ layout and is the only supported Linux toolchain.
  const envHome = (process.env.DEVECO_HOME || process.env.DEVECO_CLI_CLT_PATH || '').trim();
  if (envHome && fs.existsSync(envHome)) return envHome;

  const candidates = [];
  if (process.platform === 'win32') {
    const userHome = (process.env.USERPROFILE || '').trim();
    candidates.push(
      'C:\\Program Files\\Huawei\\DevEco Studio',
      'C:\\Program Files\\DevEco Studio',
      'C:\\Program Files (x86)\\DevEco Studio',
      userHome ? path.join(userHome, 'DevEco Studio') : '',
    );
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/DevEco-Studio.app/Contents');
  } else {
    const home = (process.env.HOME || '').trim();
    if (home) {
      candidates.push(path.join(home, 'devecostudio/Contents'));
      candidates.push(path.join(home, 'DevEco-Studio/Contents'));
    }
  }
  for (const c of candidates.filter(Boolean)) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}
function findEtsLoader(devecoHome) {
  const candidates = [
    path.join(devecoHome, 'sdk', 'default', 'openharmony', 'ets', 'build-tools', 'ets-loader'),
    path.join(devecoHome, 'sdk', 'openharmony', 'ets', 'build-tools', 'ets-loader'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'lib', 'ets_checker.js'))) return c;
  }
  return null;
}

// --- Collect .ets files from project ---

function collectEtsFiles(projectPath) {
  const results = [];
  const srcDir = path.join(projectPath, 'entry', 'src', 'main', 'ets');
  if (!fs.existsSync(srcDir)) return results;

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'oh_modules' || entry.name === 'build') continue;
        walk(full);
      } else if (entry.name.endsWith('.ets') && !entry.name.endsWith('.d.ets')) {
        results.push(full);
      }
    }
  }
  walk(srcDir);
  return results;
}

// --- Diagnostic output capture ---

function parseDiagnosticLine(line) {
  const errorMatch = line.match(/ArkTS:(ERROR|WARN)\s+File:\s+(.+?):(\d+):(\d+)/);
  if (errorMatch) {
    return { severity: errorMatch[1].toLowerCase(), file: errorMatch[2], line: parseInt(errorMatch[3]), column: parseInt(errorMatch[4]) };
  }
  return null;
}

function parseMessageLine(line) {
  const trimmed = line.trim();
  const ruleMatch = trimmed.match(/^(.+?)\s*\(([a-z][\w-]+)\)\s*$/);
  if (ruleMatch) {
    return { message: ruleMatch[1].trim(), rule: ruleMatch[2] };
  }
  return { message: trimmed, rule: '' };
}

// --- Project-level validation (A-class checks) ---

function loadSystemResourceNames(devecoHome) {
  const candidates = [
    path.join(devecoHome, 'sdk', 'default', 'openharmony', 'previewer', 'common', 'resources', 'entry', 'resources.txt'),
    path.join(devecoHome, 'sdk', 'openharmony', 'previewer', 'common', 'resources', 'entry', 'resources.txt'),
  ];
  let resFile = '';
  for (const c of candidates) {
    if (fs.existsSync(c)) { resFile = c; break; }
  }
  if (!resFile) return null;

  const names = new Set();
  const content = fs.readFileSync(resFile, 'utf-8');
  const linePattern = /^id:\d+,\s*'[^']*'\s+'([^']+)'/;
  for (const line of content.split('\n')) {
    const m = line.match(linePattern);
    if (m) names.add(m[1]);
  }
  return names;
}

function validateSystemResources(files, devecoHome, projectPath, ts) {
  // LOCAL PATCH: parse actual calls with the SDK's ArkTS grammar. Source text
  // examples in comments, strings, or template text are not resource references.
  const validNames = loadSystemResourceNames(devecoHome);
  if (!validNames) return [];
  const diagnostics = [];
  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const source = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true,
      filePath.endsWith('.ets') ? ts.ScriptKind.ETS : ts.ScriptKind.TS);
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
          && node.expression.text === '$r' && node.arguments.length >= 1
          && ts.isStringLiteral(node.arguments[0])) {
        const match = /^sys\.(media|symbol)\.(.+)$/.exec(node.arguments[0].text);
        if (match && !validNames.has(match[2])) {
          const at = source.getLineAndCharacterOfPosition(node.getStart(source));
          diagnostics.push({
            file: path.relative(projectPath, filePath), line: at.line + 1, column: at.character + 1,
            severity: 'error', rule: 'resource-name-check',
            message: `Unknown resource name '${match[2]}'. No matching sys.${match[1]} resource found in SDK.`,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return diagnostics;
}

function validateModelVersion(projectPath) {
  const hvigorPath = path.join(projectPath, 'hvigor', 'hvigor-config.json5');
  const ohPkgPath = path.join(projectPath, 'oh-package.json5');
  if (!fs.existsSync(hvigorPath) || !fs.existsSync(ohPkgPath)) return [];

  const extractVersion = (file) => {
    const content = fs.readFileSync(file, 'utf-8');
    const m = content.match(/["']?modelVersion["']?\s*:\s*["']([^"']+)["']/);
    return m ? m[1] : null;
  };

  const hvigorVer = extractVersion(hvigorPath);
  const ohPkgVer = extractVersion(ohPkgPath);

  if (hvigorVer && ohPkgVer && hvigorVer !== ohPkgVer) {
    return [{
      file: 'hvigor/hvigor-config.json5',
      line: 1,
      column: 1,
      severity: 'error',
      message: `modelVersion mismatch: hvigor-config.json5 has '${hvigorVer}' but oh-package.json5 has '${ohPkgVer}'. They must be consistent.`,
      rule: 'model-version-consistency',
    }];
  }
  return [];
}

// --- ArkUI binding-syntax false-positive whitelist ---
//
// The standalone type checker (etsStandaloneChecker) does not expand ArkUI
// syntax sugar, so it treats binding-syntax tokens as ordinary identifiers and
// wrongly reports `Cannot find name '$...'`. Two legal forms trigger this:
//   A) `$$this.x` two-way binding (e.g. bindSheet($$this.foo), Refresh({ refreshing: $$this.bar }))
//   B) `$varName` @Link / @Builder argument passing (e.g. Child({ items: $items }))
// build_project (the real compiler) accepts both. We silently drop these
// false positives here. Rule B only fires when `varName` is actually declared
// as a state-decorated field in the same source file, so genuinely-undefined
// `$foo` references are still reported.

const STATE_DECORATORS = [
  'State', 'Link', 'Prop', 'ObjectLink', 'Local', 'Param', 'Provide', 'Consume',
  'StorageLink', 'StorageProp', 'LocalStorageLink', 'LocalStorageProp',
];

// Cache: absolute source path -> Set of state-decorated field names declared in it.
const stateFieldCache = new Map();

function getStateFields(absPath) {
  if (stateFieldCache.has(absPath)) return stateFieldCache.get(absPath);
  const fields = new Set();
  try {
    const content = fs.readFileSync(absPath, 'utf-8');
    const decoRe = new RegExp(
      '@(?:' + STATE_DECORATORS.join('|') + ')(?:\\([^)]*\\))?\\s+([A-Za-z_$][\\w$]*)',
      'g',
    );
    let m;
    while ((m = decoRe.exec(content)) !== null) {
      fields.add(m[1]);
    }
  } catch {
    // unreadable file -> empty set (conservative: rule B won't match)
  }
  stateFieldCache.set(absPath, fields);
  return fields;
}

// Returns true if the diagnostic is a binding-syntax false positive that should
// be dropped. Any parse/IO issue returns false (keep the diagnostic).
function isBindingSyntaxFalsePositive(diag, projectPath) {
  try {
    const m = /^Cannot find name '(\$[^']+)'/.exec(diag.message || '');
    if (!m) return false;
    const name = m[1];

    // Rule A: `$$...` is always ArkUI two-way binding sugar, never a plain identifier.
    if (name.startsWith('$$')) return true;

    // Rule B: `$word` -> confirm `word` is a state-decorated field in the same file.
    const bare = /^\$([A-Za-z_][\w$]*)$/.exec(name);
    if (!bare) return false;
    const fieldName = bare[1];

    const absPath = path.isAbsolute(diag.file)
      ? diag.file
      : path.resolve(projectPath, diag.file);
    return getStateFields(absPath).has(fieldName);
  } catch {
    return false;
  }
}

// --- Main ---

async function main() {
  const args = parseArgs(process.argv);

  if (!args.project) {
    process.stdout.write(JSON.stringify({ success: false, error: 'Missing --project argument', errors: [], summary: { errorCount: 0, warnCount: 0 } }));
    process.exit(1);
  }

  if (!fs.existsSync(args.project)) {
    process.stdout.write(JSON.stringify({ success: false, error: `Project path not found: ${args.project}`, errors: [], summary: { errorCount: 0, warnCount: 0 } }));
    process.exit(1);
  }

  const devecoHome = findDevecoHome();
  if (!devecoHome) {
    process.stdout.write(JSON.stringify({ success: false, error: 'Cannot find a DevEco Studio or Command Line Tools SDK. Set DEVECO_CLI_STUDIO_PATH or DEVECO_CLI_CLT_PATH.', errors: [], summary: { errorCount: 0, warnCount: 0 } }));
    process.exit(1);
  }

  const etsLoaderPath = findEtsLoader(devecoHome);
  if (!etsLoaderPath) {
    process.stdout.write(JSON.stringify({ success: false, error: `Cannot find ets-loader in DevEco SDK at: ${devecoHome}`, errors: [], summary: { errorCount: 0, warnCount: 0 } }));
    process.exit(1);
  }
  let files = args.files.map(f => path.isAbsolute(f) ? f : path.resolve(args.project, f));
  if (files.length === 0) {
    files = collectEtsFiles(args.project);
  }

  // LOCAL PATCH: upstream reported `success: true` here, so "found nothing to
  // check" was indistinguishable from "checked everything and it is clean".
  // collectEtsFiles only knows the single-module `entry/` layout, so every
  // multi-module project took this branch and got a false clean bill of health.
  // src/arkts-check.mjs now resolves the file list and always passes --files;
  // this branch stays as a loud second-line guard.
  if (files.length === 0) {
    process.stdout.write(JSON.stringify({
      success: false,
      error: `No .ets files to check under ${args.project}. Pass --files explicitly for non-standard project layouts.`,
      errors: [],
      summary: { errorCount: 0, warnCount: 0 },
    }));
    process.exit(1);
  }

  const fileMap = {};
  files.forEach((f, i) => { fileMap[`file_${i}`] = f; });

  const { discoverProjectEtsFiles, validateRouterPages } = await import('../arkts-project.mjs');
  const { moduleDirectories } = discoverProjectEtsFiles(args.project);
  const moduleJsonCandidates = moduleDirectories.map(directory => path.join(directory, 'src', 'main', 'module.json5'));
  let aceModuleJsonPath = '';
  for (const candidate of moduleJsonCandidates) {
    if (fs.existsSync(candidate)) {
      aceModuleJsonPath = candidate;
      break;
    }
  }

  const captured = [];
  let internalError = null;
  const origLog = console.log;
  const origError = console.error;
  const origWarn = console.warn;
  const capture = (...args) => { captured.push(args.map(String).join(' ')); };
  console.log = capture;
  console.error = capture;
  console.warn = capture;

  // Set externalApiPaths so main.js discovers HMS SDK modules (@hms.*, @kit.*)
  const hmsSdkEts = path.join(devecoHome, 'sdk', 'default', 'hms', 'ets');
  if (fs.existsSync(hmsSdkEts)) {
    const existing = process.env.externalApiPaths || '';
    process.env.externalApiPaths = existing
      ? existing + path.delimiter + hmsSdkEts
      : hmsSdkEts;
  }

  try {
    const etsChecker = require(path.join(etsLoaderPath, 'lib', 'ets_checker.js'));
    const mainModule = require(path.join(etsLoaderPath, 'main.js'));

    Object.assign(mainModule.partialUpdateConfig, {
      executeArkTSLinter: true,
      standardArkTSLinter: true,
    });

    process.env.compileMode = 'moduleJson';

    // LOCAL PATCH: the SDK's WhiteListValidator reads
    // `projectConfig.globalModulePaths` (api_validate_node.js), but main.js only
    // ever maintains its own module-level `globalModulePaths` and never copies it
    // onto projectConfig. Left undefined it throws
    // "Cannot read properties of undefined (reading 'some')" the moment a file
    // trips the @since suppressor, which used to surface as a clean result.
    // Mirror main.js: <sdk>/ets/{api,arkts,kits} plus the HMS equivalents.
    const etsRoots = [path.resolve(etsLoaderPath, '..', '..')];
    const hmsEtsRoot = path.resolve(devecoHome, 'sdk', 'default', 'hms', 'ets');
    if (fs.existsSync(hmsEtsRoot)) etsRoots.push(hmsEtsRoot);
    const globalModulePaths = etsRoots
      .flatMap(root => ['api', 'arkts', 'kits'].map(name => path.join(root, name)))
      .filter(candidate => fs.existsSync(candidate));

    const projectConfig = {
      globalModulePaths,
      projectPath: args.project,
      projectRootPath: args.project,
      modulePath: args.project,
      cachePath: path.join(args.project, '.cache', 'arkts-check'),
      aceModuleJsonPath: aceModuleJsonPath,
      compileMode: 'esmodule',
      etsLoaderPath: etsLoaderPath,
      packageManagerType: 'ohpm',
      packageDir: 'oh_modules',
      runtimeOS: 'OpenHarmony',
      sdkInfo: '5.0.0',
      compatibleSdkVersion: 12,
      bundleType: '',
      compilerTypes: [],
      resolveModulePaths: [],
    };

    const cacheDir = projectConfig.cachePath;
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    const logger = {
      debug: capture,
      info: capture,
      warn: capture,
      error: capture,
    };

    etsChecker.etsStandaloneChecker(fileMap, logger, projectConfig);
  } catch (e) {
    // LOCAL PATCH: upstream only pushed the message into `captured`, where the
    // diagnostic parser drops it because it does not look like a location line.
    // A crashing checker therefore reported `success: true, errorCount: 0`.
    // Keep the captured line, but also record it so the result can say so.
    internalError = e && e.stack ? e.stack : String((e && e.message) || e);
    captured.push(`Internal error: ${e.message}`);
  } finally {
    console.log = origLog;
    console.error = origError;
    console.warn = origWarn;
  }

  const diagnostics = [];
  let current = null;

  const lines = captured.flatMap(entry => entry.split('\n'));

  for (const line of lines) {
    const clean = line.replace(/\x1b\[\d+m/g, '').replace(/\[(\d+)m/g, '');
    const loc = parseDiagnosticLine(clean);
    if (loc) {
      current = loc;
      continue;
    }
    if (current && clean.trim() && !clean.includes('ArkTS:') && !clean.includes('For details about')) {
      const { message, rule } = parseMessageLine(clean);
      diagnostics.push({
        file: path.relative(args.project, current.file),
        line: current.line,
        column: current.column,
        severity: current.severity === 'error' ? 'error' : 'warning',
        message,
        rule,
      });
      current = null;
    }
  }

  // LOCAL PATCH: keep only diagnostics about the files we were asked to check.
  // The checker also reports on declaration files it pulls in transitively, so a
  // whole-project scan surfaced parse errors inside the SDK's own
  // ets/arkts/@arkts.lang.d.ets and failed a project whose sources are clean.
  // Filtering by the requested set is safe for explicitly listed files too,
  // including files outside the project root.
  const requestedFiles = new Set(files.map(f => path.resolve(f)));
  const inScope = diagnostics.filter(d => requestedFiles.has(path.resolve(args.project, d.file)));
  diagnostics.length = 0;
  diagnostics.push(...inScope);

  // A-class project-level checks
  const extraDiags = [
    ...validateSystemResources(files, devecoHome, args.project, require(require.resolve('typescript', { paths: [etsLoaderPath] }))),
    ...validateRouterPages(args.project, moduleDirectories),
    ...validateModelVersion(args.project),
  ];
  diagnostics.push(...extraDiags);

  const isStageProject = aceModuleJsonPath !== '';
  const filtered = diagnostics.filter(d => {
    if (isStageProject && d.message.includes('the current Mode is FA')) return false;
    if (isBindingSyntaxFalsePositive(d, args.project)) return false;
    return true;
  });

  const errorCount = filtered.filter(d => d.severity === 'error').length;
  const warnCount = filtered.filter(d => d.severity === 'warning').length;

  // LOCAL PATCH: a checker crash must never read as a clean result.
  const result = {
    success: errorCount === 0 && !internalError,
    errors: filtered,
    summary: { errorCount, warnCount },
    ...(internalError ? { internalError } : {}),
  };

  // LOCAL PATCH: stdout is a pipe when this runs under the MCP adapter, so
  // writes are asynchronous. Upstream called process.exit() on the next line,
  // which truncated any result larger than the 64 KiB pipe buffer and made the
  // caller see malformed JSON. Exit only once the payload has been flushed.
  process.stdout.write(JSON.stringify(result, null, 2), () => {
    process.exit(errorCount > 0 || internalError ? 1 : 0);
  });
}

// Exported for unit testing the whitelist logic without a DevEco SDK.
module.exports = { validateSystemResources, isBindingSyntaxFalsePositive, getStateFields, stateFieldCache };

// Run as a CLI only when invoked directly (node arkts-check.cjs ...), not when required by tests.
if (require.main === module) {
  main().catch((error) => {
    process.stdout.write(JSON.stringify({ success: false, error: error.message, errors: [] }), () => process.exit(1));
  });
}
