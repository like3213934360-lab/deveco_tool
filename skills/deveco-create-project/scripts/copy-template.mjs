/*
 * Copyright (c) 2026 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadSdkMetadata, resolveApiLevel, SkillError } from './detect-sdk.mjs';

const REQUIRED_FILES = [
  'build-profile.json5',
  'AppScope/resources/base/media/layered_image.json',
  'AppScope/resources/base/media/background.png',
  'AppScope/resources/base/media/foreground.png',
  'entry/src/main/resources/base/media/layered_image.json',
  'entry/src/main/resources/base/media/background.png',
  'entry/src/main/resources/base/media/foreground.png',
];

const APP_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,127}$/;

function emitError(payload, exitCode = 1) {
  console.error(JSON.stringify(payload, null, 2));
  process.exit(exitCode);
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      continue;
    }
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }
    values.set(key, value);
    index += 1;
  }

  const projectPath = values.get('project-path');
  const appName = values.get('app-name');
  const bundleName = values.get('bundle-name') ?? (appName
    ? `com.example.${appName.toLowerCase()}`
    : undefined);
  const apiLevelRaw = values.get('api-level');
  const apiLevel = apiLevelRaw ? Number(apiLevelRaw) : undefined;

  if (!projectPath) {
    throw new Error('Missing required argument --project-path');
  }
  if (!appName) {
    throw new Error('Missing required argument --app-name');
  }
  if (!bundleName) {
    throw new Error('Missing required argument --bundle-name');
  }
  if (apiLevelRaw && (apiLevel === undefined || !Number.isInteger(apiLevel))) {
    throw new Error(`Invalid apiLevel: ${apiLevelRaw}`);
  }

  return {
    projectPath: path.resolve(projectPath),
    appName,
    bundleName,
    apiLevel,
  };
}

async function resolve(args) {
  const metadata = await loadSdkMetadata();
  return resolveApiLevel(metadata, args.apiLevel);
}

/*
 * LOCAL PATCH: upstream 0.2.0 spawns a bare `devecocli`, which only works when the CLI is on PATH
 * (it ships a PATH shim this pack deliberately does not copy). Resolve the npm entry ourselves
 * instead, mirroring src/deveco-cli.mjs, and keep PATH as the last resort. This file must stay
 * self-contained -- SKILL.md forbids importing pack sources from a skill script -- so the
 * resolution is reimplemented here rather than shared.
 */
function resolveDevecoCli() {
  const override = process.env.DEVECO_CLI_ENTRY;
  if (override && fs.existsSync(override)) {
    return { command: process.execPath, prefix: [override], source: 'DEVECO_CLI_ENTRY' };
  }

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  // scripts/ -> deveco-create-project/ -> skills/ -> pack root, where node_modules lives.
  const packRoot = path.resolve(scriptDir, '../../..');
  const require = createRequire(import.meta.url);
  try {
    const entry = require.resolve('@deveco/deveco-cli/dist/cli.js', { paths: [packRoot, process.cwd()] });
    return { command: process.execPath, prefix: [entry], source: 'node_modules' };
  } catch {
    return { command: 'devecocli', prefix: [], source: 'PATH' };
  }
}

function validateAppName(appName) {
  if (!APP_NAME_PATTERN.test(appName)) {
    emitError({
      code: 'APP_NAME_INVALID',
      message: `appName "${appName}" is invalid. It must start with an English letter and contain only [A-Za-z0-9_], length 1-128.`,
      hint: '请通过 AskUserQuestion 给出 2-3 个符合规范的 UpperCamelCase 英文候选名（中文按语义翻译，如 "购物车" → ShoppingCart / ShopCart / Cart），让用户选择，然后用新的 --app-name 重新运行脚本。不要自己替用户决定。',
      details: { rawAppName: appName },
    }, 4);
  }
}

function setupProject(args) {
  fs.mkdirSync(args.projectPath, { recursive: true });
  const targetRoot = path.join(args.projectPath, args.appName);
  if (fs.existsSync(targetRoot) && fs.readdirSync(targetRoot).length > 0) {
    emitError({
      code: 'PROJECT_EXISTS',
      message: `Target "${targetRoot}" already exists and is not empty.`,
      hint: '请通过 AskUserQuestion 向用户提供"覆盖 / 重命名 / 取消"三个选项后再决定如何继续。Never overwrite without explicit user confirmation.',
      details: { targetRoot },
    }, 2);
  }
  return targetRoot;
}

function createProjectWithDevecoCli(targetRoot, args, resolved) {
  const cli = resolveDevecoCli();
  const cliArgs = [
    'create',
    '--project-path',
    targetRoot,
    '--app-name',
    args.appName,
    '--bundle-name',
    args.bundleName,
    '--api-level',
    String(resolved.apiLevel),
  ];
  const result = spawnSync(cli.command, [...cli.prefix, ...cliArgs], {
    cwd: args.projectPath,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error) {
    if (result.error.code === 'ENOENT') {
      emitError({
        code: 'DEVECO_CLI_NOT_FOUND',
        message: 'DevEco CLI is required to create a project but could not be located.',
        hint: '请在能力包根目录执行 npm install 安装 @deveco/deveco-cli，或设置 DEVECO_CLI_ENTRY 指向 cli.js，或把 devecocli 放进 PATH。',
        details: { attempted: cli.source },
      }, 5);
    }
    throw new Error(`Failed to execute devecocli create: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
    throw new Error(
      `devecocli create failed (code=${result.status ?? 'unknown'}): ${detail || 'No output'}`
    );
  }
  return cli.source;
}

function replaceInFile(filePath, pairs) {
  const original = fs.readFileSync(filePath, 'utf-8');
  let next = original;
  for (const [from, to] of pairs) {
    next = next.replaceAll(from, to);
  }
  if (next !== original) {
    fs.writeFileSync(filePath, next, 'utf-8');
  }
}

function applyCompatibilityReplacements(targetRoot, args) {
  replaceInFile(path.join(targetRoot, 'entry/src/main/resources/base/element/string.json'), [
    ['"value": "label"', `"value": "${args.appName}"`],
  ]);
}

function verifyFiles(targetRoot) {
  return REQUIRED_FILES.filter((relativePath) => !fs.existsSync(path.join(targetRoot, relativePath)));
}

function verifyTemplate(targetRoot) {
  const missingFiles = verifyFiles(targetRoot);
  if (missingFiles.length > 0) {
    emitError({
      code: 'TEMPLATE_COPY_INCOMPLETE',
      message: `Generated project is incomplete. Missing files: ${missingFiles.join(', ')}`,
      hint: '请确认 DevEco CLI 与 SDK 安装完整，清理目标目录后重新创建。',
      details: { missingFiles, targetRoot },
    });
  }
}

function outputResult(targetRoot, args, resolved, cliSource) {
  console.log(JSON.stringify({
    projectRoot: targetRoot,
    appName: args.appName,
    bundleName: args.bundleName,
    apiLevel: resolved.apiLevel,
    sdkVersion: resolved.sdkVersion,
    modelVersion: resolved.modelVersion,
    source: resolved.source,
    detectedFrom: resolved.detectedFrom,
    devecoHome: resolved.devecoHome,
    cliSource,
    verified: true,
  }, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  validateAppName(args.appName);
  const resolved = await resolve(args);
  const targetRoot = setupProject(args);
  const cliSource = createProjectWithDevecoCli(targetRoot, args, resolved);
  applyCompatibilityReplacements(targetRoot, args);
  verifyTemplate(targetRoot);
  outputResult(targetRoot, args, resolved, cliSource);
}

try {
  await main();
} catch (error) {
  if (error instanceof SkillError) {
    emitError(error.payload);
  }
  const message = error instanceof Error ? error.message : String(error);
  emitError({
    code: 'SCRIPT_ERROR',
    message,
    hint: '请检查脚本参数与环境配置后重试。',
  });
}
