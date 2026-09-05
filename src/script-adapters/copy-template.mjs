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
import { cp } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { resolveDevecoHome } from '../config.mjs';
import { SkillError } from '../../skills/deveco-create-project/scripts/detect-sdk.mjs';
import { detectSdk } from './sdk.mjs';
// Local adapter based on the official Skill (Apache-2.0) and the template
// expansion in @deveco/deveco-cli 1.3.1 (MIT, copyright Huawei Device Co., Ltd.).
// See provenance/SOURCES.md and node_modules/@deveco/deveco-cli/LICENSE. The CLI command rejects
// spaces/CJK in paths; expand its shipped template directly using filesystem APIs.
//
// MIT License (template expansion): Copyright (c) 2026 Huawei Device Co., Ltd.
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

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
  return detectSdk(args.apiLevel);
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

async function createProjectFromTemplate(targetRoot, args, resolved) {
  const require = createRequire(import.meta.url);
  const template = path.join(path.dirname(require.resolve('@deveco/deveco-cli/package.json')), 'templates', 'application');
  // Node 22's native cpSync directory fast path corrupts non-ASCII Windows paths.
  // Async cp uses the UTF-8-safe filesystem calls. Copy each entry so an existing
  // empty project root is allowed while destination collisions still fail.
  fs.mkdirSync(targetRoot, { recursive: true });
  for (const entry of fs.readdirSync(template)) {
    await cp(path.join(template, entry), path.join(targetRoot, entry), {
      recursive: true, force: false, errorOnExist: true,
    });
  }
  for (const relative of ['gitignore.txt', 'entry/gitignore.txt']) {
    const file = path.join(targetRoot, relative);
    fs.renameSync(file, path.join(path.dirname(file), '.gitignore'));
  }
  replaceInFile(path.join(targetRoot, 'AppScope/resources/base/element/string.json'), [['MyApplication', args.appName]]);
  replaceInFile(path.join(targetRoot, 'AppScope/app.json5'), [['com.example.myapplication', args.bundleName]]);
  replaceInFile(path.join(targetRoot, 'build-profile.json5'), [['6.0.2(22)', resolved.sdkVersion]]);
  for (const relative of ['hvigor/hvigor-config.json5', 'oh-package.json5']) {
    replaceInFile(path.join(targetRoot, relative), [['6.0.2', resolved.modelVersion]]);
  }
  // The CLI template omits binary icons. Use Studio's preview icons when present,
  // otherwise the same 1x1 PNG placeholder as the CLI uses on a CLT-only host.
  const preview = path.join(resolveDevecoHome().path, 'plugins/codegenie-plugin/previewProjectTemplate');
  const placeholder = Buffer.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,2,0,0,0,144,119,83,222,0,0,0,12,73,68,65,84,8,215,99,248,255,255,255,0,5,254,2,254,0,0,0,0,73,69,78,68,174,66,96,130]);
  const icons = [...['AppScope', 'entry/src/main'].flatMap(root =>
    ['background.png', 'foreground.png'].map(name => `${root}/resources/base/media/${name}`)),
    'entry/src/main/resources/base/media/startIcon.png'];
  for (const relative of icons) {
    const source = path.join(preview, relative);
    const target = path.join(targetRoot, relative);
    if (fs.existsSync(source)) fs.copyFileSync(source, target);
    else fs.writeFileSync(target, placeholder);
  }
}

function validateBundleName(name) {
  const segments = name.split('.');
  if (name.length < 7 || name.length > 128 || segments.length < 3 ||
      segments.some((part, index) => !/^[A-Za-z0-9_]+$/.test(part) ||
        !(index === 0 ? /^[A-Za-z]/ : /^[A-Za-z0-9]/).test(part) || !/[A-Za-z0-9]$/.test(part))) {
    throw new Error('Invalid bundle name: expected 3 or more dot-separated segments, 7-128 characters, using letters, digits, and underscores.');
  }
}

function applyCompatibilityReplacements(targetRoot, args) {
  replaceInFile(path.join(targetRoot, 'entry/src/main/resources/base/element/string.json'), [
    ['"value": "label"', `"value": "${args.appName}"`],
  ]);
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
  validateBundleName(args.bundleName);
  const resolved = await resolve(args);
  const targetRoot = setupProject(args);
  await createProjectFromTemplate(targetRoot, args, resolved);
  applyCompatibilityReplacements(targetRoot, args);
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
