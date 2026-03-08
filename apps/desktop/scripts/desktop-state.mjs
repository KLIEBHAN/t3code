import { homedir } from "node:os";
import { join } from "node:path";

const DESKTOP_STATE_ENV_VAR = "T3CODE_STATE_DIR";
const DESKTOP_FRESH_START_ENV_VAR = "T3CODE_DESKTOP_FRESH";
const FRESH_DESKTOP_START_FLAGS = new Set(["--fresh", "--clear-cache"]);
const DEFAULT_DESKTOP_STATE_DIR = join(homedir(), ".t3", "userdata");

function readTrimmedEnvValue(env, key) {
  const value = env[key];
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function isTruthyEnvFlag(value) {
  if (typeof value !== "string") {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function splitDesktopLaunchArgs(argv) {
  const forwardedElectronArgs = [];
  let freshRequestedFromArgs = false;

  for (const arg of argv) {
    if (FRESH_DESKTOP_START_FLAGS.has(arg)) {
      freshRequestedFromArgs = true;
      continue;
    }

    forwardedElectronArgs.push(arg);
  }

  return {
    forwardedElectronArgs,
    freshRequestedFromArgs,
  };
}

export function resolveDesktopStateDir(env = process.env) {
  return readTrimmedEnvValue(env, DESKTOP_STATE_ENV_VAR) ?? DEFAULT_DESKTOP_STATE_DIR;
}

export function resolveDesktopLaunchOptions(input = {}) {
  const argv = input.argv ?? process.argv.slice(2);
  const env = input.env ?? process.env;
  const { forwardedElectronArgs, freshRequestedFromArgs } = splitDesktopLaunchArgs(argv);

  return {
    stateDir: resolveDesktopStateDir(env),
    // Fresh starts must stay explicit so normal launches keep their persisted desktop profile.
    freshRequested:
      isTruthyEnvFlag(readTrimmedEnvValue(env, DESKTOP_FRESH_START_ENV_VAR)) ||
      freshRequestedFromArgs,
    forwardedElectronArgs,
  };
}

export function clearDesktopStateDir(stateDir, fileSystem = { rmSync: () => undefined }) {
  // Fresh starts are explicit opt-in, so wipe the full desktop state to keep the reset predictable.
  fileSystem.rmSync(stateDir, {
    recursive: true,
    force: true,
    maxRetries: 3,
  });
}
