// packages/cli/src/config/storage-paths-lite.ts
import * as os from "node:os";
import * as path from "node:path";
var SETTINGS_DIRECTORY_NAME = ".qwen";
function expandsAgainstHome(dir) {
  return dir === "~" || dir.startsWith("~/") || dir.startsWith("~\\");
}
function resolveConfigPathLite(dir, cwd) {
  let resolved = dir;
  if (expandsAgainstHome(resolved)) {
    const relativeSegments = resolved === "~" ? [] : resolved.slice(2).split(/[/\\]+/).filter(Boolean);
    resolved = path.join(os.homedir(), ...relativeSegments);
  }
  if (!path.isAbsolute(resolved)) {
    resolved = path.resolve(cwd || process.cwd(), resolved);
  }
  return resolved;
}
function passedEnvironment(env) {
  if (!env) throw new TypeError("There is no environment to pass on.");
  const keys = [];
  for (const key in env) keys.push(key);
  const windows = os.platform() === "win32";
  const spellings = /* @__PURE__ */ new Set();
  const passed = /* @__PURE__ */ Object.create(null);
  for (const key of windows ? keys.sort() : keys) {
    if (windows) {
      const upperKey = key.toUpperCase();
      if (spellings.has(upperKey)) continue;
      spellings.add(upperKey);
    }
    let text;
    try {
      const value = env[key];
      if (value === void 0) continue;
      text = `${value}`;
    } catch (error) {
      throw new TypeError(
        `The environment variable ${JSON.stringify(key)} cannot be read: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
    if (key.indexOf("=", windows ? 1 : 0) !== -1 || key.includes("\0") || text.includes("\0")) {
      throw new TypeError(
        `The environment variable ${JSON.stringify(key)} cannot be passed on as it is.`
      );
    }
    passed[key] = text;
  }
  return passed;
}
function readEnvironmentVariable(env, name) {
  if (env === process.env) return env[name];
  return spawnedEnvironmentView(env)[name];
}
function spawnedEnvironmentView(env) {
  const passed = passedEnvironment(env);
  for (const name in passed) {
    if (/^(?:0|[1-9]\d*)$/.test(name) && Number(name) < 2 ** 32 - 1) {
      delete passed[name];
    }
  }
  if (os.platform() !== "win32") return passed;
  const byUpperName = new Map(
    Object.entries(passed).map(([name, value]) => [name.toUpperCase(), value])
  );
  return new Proxy(passed, {
    has: (_target, name) => typeof name === "string" && byUpperName.has(name.toUpperCase()),
    get: (_target, name) => typeof name === "string" ? byUpperName.get(name.toUpperCase()) : void 0
  });
}
function isFullyQualifiedPath(location) {
  return os.platform() === "win32" ? /^(?:[a-zA-Z]:[\\/]|[\\/]{2}[^\\/]+[\\/]+[^\\/]+)/.test(location) : path.isAbsolute(location);
}
function getGlobalQwenDirLite(env = process.env) {
  const envDir = readEnvironmentVariable(env, "QWEN_HOME");
  if (envDir) {
    return resolveConfigPathLite(envDir);
  }
  const homeDir = os.homedir();
  if (!homeDir) {
    return path.join(os.tmpdir(), SETTINGS_DIRECTORY_NAME);
  }
  return path.join(homeDir, SETTINGS_DIRECTORY_NAME);
}
function getSystemSettingsPath(env = process.env) {
  const configured = readEnvironmentVariable(
    env,
    "QWEN_CODE_SYSTEM_SETTINGS_PATH"
  );
  if (configured) {
    return configured;
  }
  if (os.platform() === "darwin") {
    return "/Library/Application Support/QwenCode/settings.json";
  }
  if (os.platform() === "win32") {
    return "C:\\ProgramData\\qwen-code\\settings.json";
  }
  return "/etc/qwen-code/settings.json";
}
function getSystemDefaultsPath(env = process.env) {
  const configured = readEnvironmentVariable(
    env,
    "QWEN_CODE_SYSTEM_DEFAULTS_PATH"
  );
  if (configured) {
    return configured;
  }
  return path.join(
    path.dirname(getSystemSettingsPath(env)),
    "system-defaults.json"
  );
}
export {
  SETTINGS_DIRECTORY_NAME,
  expandsAgainstHome,
  getGlobalQwenDirLite,
  getSystemDefaultsPath,
  getSystemSettingsPath,
  isFullyQualifiedPath,
  passedEnvironment,
  readEnvironmentVariable,
  resolveConfigPathLite,
  spawnedEnvironmentView
};
/**
 * @license
 * Copyright 2025 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */
