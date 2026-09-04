import path from 'node:path';
import fs from 'node:fs/promises';

const MIN_API_LEVEL = 17;

export const API_CONFIGS = {
  17: { sdkVersion: '5.0.5(17)', modelVersion: '5.0.5' },
  18: { sdkVersion: '5.0.6(18)', modelVersion: '5.0.6' },
  19: { sdkVersion: '5.0.7(19)', modelVersion: '5.0.7' },
  20: { sdkVersion: '6.0.0(20)', modelVersion: '6.0.0' },
  21: { sdkVersion: '6.0.1(21)', modelVersion: '6.0.1' },
  22: { sdkVersion: '6.0.2(22)', modelVersion: '6.0.2' },
  23: { sdkVersion: '6.1.0(23)', modelVersion: '6.1.0' },
  24: { sdkVersion: '6.1.1(24)', modelVersion: '6.1.1' },
};

export class SkillError extends Error {
  constructor(payload) {
    super(payload.message);
    this.name = 'SkillError';
    this.payload = payload;
  }
}

function envPath() {
  return String(process.env.DEVECO_HOME || '').trim();
}

async function isDir(file) {
  if (!file) {
    return false;
  }
  return fs.stat(file)
    .then((info) => info.isDirectory())
    .catch(() => false);
}

function nodePath(home) {
  return process.platform === 'win32'
    ? path.join(home, 'tools', 'node', 'node.exe')
    : path.join(home, 'tools', 'node', 'bin', 'node');
}

async function exists(file) {
  return fs.access(file).then(() => true).catch(() => false);
}

function parseApiVersion(raw) {
  if (typeof raw === 'number') {
    return Number.isInteger(raw) && raw >= MIN_API_LEVEL ? raw : undefined;
  }
  if (typeof raw === 'string' && raw.trim()) {
    const apiLevel = Number(raw);
    return Number.isInteger(apiLevel) && apiLevel >= MIN_API_LEVEL ? apiLevel : undefined;
  }
  return undefined;
}

function parsePlatformVersion(raw) {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const value = raw.trim();
  return value || undefined;
}

function apiConfigForLevel(apiLevel, metadata) {
  const mapped = API_CONFIGS[apiLevel];
  if (mapped) {
    return mapped;
  }
  if (apiLevel === metadata.apiVersion) {
    const platformVersion = metadata.platformVersion;
    if (apiLevel >= 26) {
      return { sdkVersion: platformVersion, modelVersion: platformVersion };
    }
    return { sdkVersion: `${platformVersion}(${apiLevel})`, modelVersion: platformVersion };
  }
  throw new SkillError({
    code: 'API_CONFIG_MISSING',
    message: `No template version mapping for API level ${apiLevel}.`,
    hint: '请改用 default API，或补充该 API 对应的 sdkVersion / modelVersion 映射后重试。',
    details: {
      apiLevel,
      defaultApiVersion: metadata.apiVersion,
    },
  });
}

async function validateDevEcoHome() {
  const env = envPath();
  if (!env) {
    throw new SkillError({
      code: 'DEVECO_HOME_MISSING',
      message: 'DEVECO_HOME is not configured.',
      hint: '请将 DEVECO_HOME 配置为 DevEco Studio 安装目录，然后重新运行；例如包含 tools/node 和 sdk/default 的目录。',
    });
  }
  if (!(await isDir(env))) {
    throw new SkillError({
      code: 'DEVECO_HOME_INVALID',
      message: `DEVECO_HOME points to a missing directory: ${env}`,
      hint: '请检查 DEVECO_HOME 是否指向 DevEco Studio 根目录，而不是 SDK 子目录或项目目录。',
      details: { devecoHome: env },
    });
  }
  const builtInNode = nodePath(env);
  if (!(await exists(builtInNode))) {
    throw new SkillError({
      code: 'DEVECO_HOME_INVALID',
      message: `DevEco built-in Node not found at ${builtInNode}.`,
      hint: '请检查 DEVECO_HOME 是否指向 DevEco Studio 根目录，而不是 SDK 子目录或项目目录。',
      details: { devecoHome: env, nodePath: builtInNode },
    });
  }
  return env;
}

async function readSdkPackage(sdkPkgPath) {
  if (!(await exists(sdkPkgPath))) {
    throw new SkillError({
      code: 'SDK_PKG_MISSING',
      message: `SDK metadata file not found: ${sdkPkgPath}`,
      hint: '请在 DevEco Studio 中安装或切换 default SDK，确认该文件存在后重试。',
      details: { sdkPkgPath },
    });
  }
  let pkg;
  try {
    pkg = JSON.parse(await fs.readFile(sdkPkgPath, 'utf8'));
  } catch {
    throw new SkillError({
      code: 'SDK_PKG_INVALID',
      message: `SDK metadata is not valid JSON: ${sdkPkgPath}`,
      hint: '请检查 DevEco SDK 安装是否完整；必要时在 DevEco Studio 中重新安装 default SDK。',
      details: { sdkPkgPath },
    });
  }
  if (!pkg?.data) {
    throw new SkillError({
      code: 'SDK_PKG_INVALID',
      message: `SDK metadata is missing data section: ${sdkPkgPath}`,
      hint: '请检查 DevEco SDK 安装是否完整；必要时在 DevEco Studio 中重新安装 default SDK。',
      details: { sdkPkgPath },
    });
  }
  return pkg;
}

function parseSdkFields(pkg, sdkPkgPath) {
  const apiVersion = parseApiVersion(pkg.data.apiVersion);
  if (apiVersion === undefined) {
    throw new SkillError({
      code: 'SDK_API_INVALID',
      message: `SDK metadata has an invalid data.apiVersion: ${String(pkg.data.apiVersion)}`,
      hint: '请确认 default SDK 元数据中的 data.apiVersion 是有效 API level；修复 SDK 安装后重试。',
      details: { sdkPkgPath, apiVersion: pkg.data.apiVersion },
    });
  }
  const platformVersion = parsePlatformVersion(pkg.data.platformVersion);
  if (!platformVersion) {
    throw new SkillError({
      code: 'SDK_PLATFORM_VERSION_MISSING',
      message: `SDK metadata is missing data.platformVersion: ${sdkPkgPath}`,
      hint: '请确认 default SDK 元数据包含 data.platformVersion；否则无法生成 targetSdkVersion。',
      details: { sdkPkgPath, platformVersion: pkg.data.platformVersion },
    });
  }
  return { apiVersion, platformVersion };
}

export async function loadSdkMetadata() {
  const env = await validateDevEcoHome();
  const sdkPkgPath = path.join(env, 'sdk', 'default', 'sdk-pkg.json');
  const pkg = await readSdkPackage(sdkPkgPath);
  const { apiVersion, platformVersion } = parseSdkFields(pkg, sdkPkgPath);
  return { devecoHome: env, sdkPkgPath, apiVersion, platformVersion };
}

export function resolveApiLevel(metadata, userApiLevel) {
  const defaultApiVersion = metadata.apiVersion;
  const apiLevel = userApiLevel ?? defaultApiVersion;
  const source = userApiLevel === undefined ? 'sdk_pkg' : 'user_input';

  if (apiLevel < MIN_API_LEVEL || apiLevel > defaultApiVersion) {
    throw new SkillError({
      code: 'API_LEVEL_OUT_OF_RANGE',
      message: `API level ${apiLevel} is outside the supported range 17~${defaultApiVersion}.`,
      hint: `请使用当前支持范围内的 API level，例如 17~${defaultApiVersion}，或移除 --api-level 使用自动探测。`,
      details: {
        apiLevel,
        minApiLevel: MIN_API_LEVEL,
        maxApiLevel: defaultApiVersion,
      },
    });
  }

  const { sdkVersion, modelVersion } = apiConfigForLevel(apiLevel, metadata);

  return {
    apiLevel,
    source,
    sdkVersion,
    modelVersion,
    detectedFrom: source === 'sdk_pkg' ? metadata.sdkPkgPath : undefined,
    devecoHome: metadata.devecoHome,
  };
}

export async function detectApiLevel() {
  const metadata = await loadSdkMetadata();
  return resolveApiLevel(metadata);
}
