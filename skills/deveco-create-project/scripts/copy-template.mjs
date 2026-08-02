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

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const templateDir = values.get('template-dir') ??
    path.resolve(scriptDir, '../../deveco-create-project/application');
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
    templateDir: path.resolve(templateDir),
  };
}

async function resolve(args) {
  const metadata = await loadSdkMetadata();
  return resolveApiLevel(metadata, args.apiLevel);
}

function copyDirectoryContents(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryContents(sourcePath, targetPath);
      continue;
    }
    if (fs.existsSync(targetPath)) {
      continue;
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
  }
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

function updateApiLevel(targetRoot, sdkVersion, modelVersion) {
  replaceInFile(path.join(targetRoot, 'build-profile.json5'), [
    ['6.0.2(22)', sdkVersion],
  ]);
  replaceInFile(path.join(targetRoot, 'hvigor/hvigor-config.json5'), [
    ['6.0.2', modelVersion],
  ]);
  replaceInFile(path.join(targetRoot, 'oh-package.json5'), [
    ['6.0.2', modelVersion],
  ]);
}

function verifyFiles(targetRoot) {
  return REQUIRED_FILES.filter((relativePath) => !fs.existsSync(path.join(targetRoot, relativePath)));
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
  if (!fs.existsSync(args.templateDir)) {
    emitError({
      code: 'TEMPLATE_DIR_MISSING',
      message: `Template directory not found: ${args.templateDir}`,
      hint: '请确认内置 skill 资源完整，或重新安装/打包 Deveco Code。',
      details: { templateDir: args.templateDir },
    });
  }
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
  copyDirectoryContents(args.templateDir, targetRoot);
  return targetRoot;
}

function applyReplacements(targetRoot, args, resolved) {
  replaceInFile(path.join(targetRoot, 'AppScope/resources/base/element/string.json'), [
    ['MyApplication', args.appName],
  ]);
  replaceInFile(path.join(targetRoot, 'entry/src/main/resources/base/element/string.json'), [
    ['"value": "label"', `"value": "${args.appName}"`],
  ]);
  replaceInFile(path.join(targetRoot, 'AppScope/app.json5'), [
    ['com.example.myapplication', args.bundleName],
  ]);
  updateApiLevel(targetRoot, resolved.sdkVersion, resolved.modelVersion);
}

function verifyTemplate(targetRoot) {
  const missingFiles = verifyFiles(targetRoot);
  if (missingFiles.length > 0) {
    emitError({
      code: 'TEMPLATE_COPY_INCOMPLETE',
      message: `Template copy incomplete. Missing files: ${missingFiles.join(', ')}`,
      hint: '请确认 skill 模板资源完整，清理目标目录后重新创建。',
      details: { missingFiles, targetRoot },
    });
  }
}

function outputResult(targetRoot, args, resolved) {
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
    verified: true,
  }, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  validateAppName(args.appName);
  const resolved = await resolve(args);
  const targetRoot = setupProject(args);
  applyReplacements(targetRoot, args, resolved);
  verifyTemplate(targetRoot);
  outputResult(targetRoot, args, resolved);
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
