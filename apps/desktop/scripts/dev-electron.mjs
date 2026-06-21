import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  desktopDir,
  resolveDevProtocolClient,
  resolveElectronLaunchCommand,
} from "./electron-launcher.mjs";
import { waitForResources } from "./wait-for-resources.mjs";

const devServerUrl = process.env.VITE_DEV_SERVER_URL?.trim();
if (!devServerUrl) {
  throw new Error("VITE_DEV_SERVER_URL is required for desktop development.");
}

const devServer = new URL(devServerUrl);
const port = Number.parseInt(devServer.port, 10);
if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`VITE_DEV_SERVER_URL must include an explicit port: ${devServerUrl}`);
}

const backendEntryPath = NodePath.resolve(desktopDir, "../server/dist/bin.mjs");
const requiredFiles = [
  "dist-electron/main.cjs",
  "dist-electron/preload.cjs",
  "../server/dist/bin.mjs",
];
const watchedDirectories = [
  { directory: "dist-electron", files: new Set(["main.cjs", "preload.cjs"]) },
  { directory: "../server/dist", files: new Set(["bin.mjs"]) },
];
const forcedShutdownTimeoutMs = 1_500;
const restartDebounceMs = 120;
const childTreeGracePeriodMs = 1_200;
const previousOwnerGraceMs = 5_000;
const ownerLockPath = NodePath.join(desktopDir, ".electron-runtime", "dev-electron-owner.json");
const remoteDebuggingPort = process.env.T3CODE_DESKTOP_REMOTE_DEBUGGING_PORT?.trim();
// oxlint-disable-next-line t3code/no-global-process-runtime -- Standalone dev script has no Effect runtime.
const hostPlatform = NodeOS.platform();

await claimDevElectronOwnership();
process.once("exit", releaseDevElectronOwnership);

await waitForResources({
  baseDir: desktopDir,
  files: requiredFiles,
  tcpHost: devServer.hostname,
  tcpPort: port,
});

const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;
const devProtocolClient = resolveDevProtocolClient();
if (devProtocolClient) {
  childEnv.T3CODE_DESKTOP_APP_USER_MODEL_ID = devProtocolClient.appBundleId;
  childEnv.T3CODE_DESKTOP_PROTOCOL_REGISTRATION_MANAGED = "1";
}

let shuttingDown = false;
let restartTimer = null;
let currentApp = null;
let restartQueue = Promise.resolve();
const expectedExits = new WeakSet();
const watchers = [];

function logDevElectron(message, details = {}) {
  const suffix = Object.keys(details).length > 0 ? ` ${JSON.stringify(details)}` : "";
  console.log(`[dev-electron] ${message}${suffix}`);
}

function readJson(path) {
  try {
    return JSON.parse(NodeFS.readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function isProcessRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function signalProcess(pid, signal) {
  try {
    process.kill(pid, signal);
  } catch {
    // Process already exited.
  }
}

function readProcessTable() {
  const result = NodeChildProcess.spawnSync("ps", ["-axo", "pid=,command="], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0 || typeof result.stdout !== "string") {
    return [];
  }

  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      const [pidText, ...commandParts] = line.split(/\s+/);
      const pid = Number.parseInt(pidText ?? "", 10);
      if (!Number.isInteger(pid) || pid <= 0) {
        return [];
      }
      return [{ pid, command: commandParts.join(" ") }];
    });
}

function readProcessWorkingDirectory(pid) {
  if (hostPlatform === "win32") {
    return null;
  }

  const result = NodeChildProcess.spawnSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0 || typeof result.stdout !== "string") {
    return null;
  }

  return (
    result.stdout
      .split("\n")
      .find((line) => line.startsWith("n"))
      ?.slice(1) ?? null
  );
}

function findSiblingDevElectronPids() {
  return readProcessTable()
    .filter(({ pid, command }) => {
      if (pid === process.pid || !command.includes("node scripts/dev-electron.mjs")) {
        return false;
      }
      return readProcessWorkingDirectory(pid) === desktopDir;
    })
    .map(({ pid }) => pid);
}

async function waitForProcessExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !isProcessRunning(pid);
}

async function stopProcess(pid) {
  if (!isProcessRunning(pid)) {
    return;
  }
  logDevElectron("stopping previous owner", { pid });
  signalProcess(pid, "SIGTERM");
  if (await waitForProcessExit(pid, previousOwnerGraceMs)) {
    return;
  }
  signalProcess(pid, "SIGKILL");
  await waitForProcessExit(pid, 1_000);
}

async function claimDevElectronOwnership() {
  NodeFS.mkdirSync(NodePath.dirname(ownerLockPath), { recursive: true });

  const previousOwner = readJson(ownerLockPath);
  const previousOwnerPid = Number.parseInt(String(previousOwner?.pid ?? ""), 10);
  const previousPids = new Set(findSiblingDevElectronPids());
  if (
    Number.isInteger(previousOwnerPid) &&
    previousOwnerPid > 0 &&
    previousOwnerPid !== process.pid
  ) {
    previousPids.add(previousOwnerPid);
  }

  for (const pid of previousPids) {
    await stopProcess(pid);
  }

  NodeFS.writeFileSync(
    ownerLockPath,
    `${JSON.stringify({ pid: process.pid, desktopDir, startedAt: new Date().toISOString() }, null, 2)}\n`,
  );
}

function releaseDevElectronOwnership() {
  const owner = readJson(ownerLockPath);
  if (Number.parseInt(String(owner?.pid ?? ""), 10) !== process.pid) {
    return;
  }

  try {
    NodeFS.rmSync(ownerLockPath, { force: true });
  } catch {
    // Best-effort cleanup.
  }
}

function killChildTreeByPid(pid, signal) {
  if (hostPlatform === "win32" || typeof pid !== "number") {
    return;
  }

  NodeChildProcess.spawnSync("pkill", [`-${signal}`, "-P", String(pid)], { stdio: "ignore" });
}

function cleanupStaleDevBackends() {
  if (hostPlatform === "win32") {
    return;
  }

  NodeChildProcess.spawnSync("pkill", ["-f", "--", `${backendEntryPath} --bootstrap-fd 3`], {
    stdio: "ignore",
  });
}

function cleanupStaleDevApps() {
  if (hostPlatform === "win32") {
    return;
  }

  NodeChildProcess.spawnSync("pkill", ["-f", "--", `--t3code-dev-root=${desktopDir}`], {
    stdio: "ignore",
  });
  cleanupStaleDevBackends();
}

function startApp() {
  if (shuttingDown || currentApp !== null) {
    return;
  }

  const electronArgs = remoteDebuggingPort
    ? [`--remote-debugging-port=${remoteDebuggingPort}`]
    : [];
  const launchArgs = devProtocolClient
    ? electronArgs
    : [...electronArgs, `--t3code-dev-root=${desktopDir}`, "dist-electron/main.cjs"];
  const electronCommand = resolveElectronLaunchCommand(launchArgs);
  const app = NodeChildProcess.spawn(electronCommand.electronPath, electronCommand.args, {
    cwd: desktopDir,
    env: childEnv,
    stdio: "inherit",
  });

  logDevElectron("started app", { pid: app.pid, args: electronCommand.args });
  currentApp = app;

  app.once("error", (error) => {
    logDevElectron("app process error", { pid: app.pid, message: error.message });
    if (currentApp === app) {
      currentApp = null;
    }

    if (!shuttingDown) {
      scheduleRestart("app-error");
    }
  });

  app.once("exit", (code, signal) => {
    const expected = expectedExits.has(app);
    logDevElectron("app exited", { pid: app.pid, code, signal, expected, shuttingDown });
    if (currentApp === app) {
      currentApp = null;
    }

    if (!shuttingDown && !expected) {
      scheduleRestart("app-exited");
    }
  });
}

async function stopApp() {
  const app = currentApp;
  if (!app) {
    return;
  }

  logDevElectron("stopping app", { pid: app.pid });
  currentApp = null;
  expectedExits.add(app);

  await new Promise((resolve) => {
    let settled = false;

    const finish = () => {
      if (settled) {
        return;
      }

      settled = true;
      resolve();
    };

    app.once("exit", finish);
    app.kill("SIGTERM");
    killChildTreeByPid(app.pid, "TERM");
    cleanupStaleDevApps();

    setTimeout(() => {
      if (settled) {
        return;
      }

      app.kill("SIGKILL");
      killChildTreeByPid(app.pid, "KILL");
      cleanupStaleDevApps();
      finish();
    }, forcedShutdownTimeoutMs).unref();
  });
}

function scheduleRestart(reason) {
  if (shuttingDown) {
    return;
  }

  logDevElectron("restart scheduled", { reason });
  if (restartTimer) {
    clearTimeout(restartTimer);
  }

  restartTimer = setTimeout(() => {
    restartTimer = null;
    restartQueue = restartQueue
      .catch(() => undefined)
      .then(async () => {
        logDevElectron("restart begin", { reason });
        await stopApp();
        if (!shuttingDown) {
          startApp();
        }
      });
  }, restartDebounceMs);
}

function startWatchers() {
  for (const { directory, files } of watchedDirectories) {
    const watcher = NodeFS.watch(
      NodePath.join(desktopDir, directory),
      { persistent: true },
      (eventType, filename) => {
        if (typeof filename !== "string" || !files.has(filename)) {
          return;
        }

        logDevElectron("watched file changed", { directory, filename, eventType });
        scheduleRestart(`watch:${directory}/${filename}`);
      },
    );

    watchers.push(watcher);
  }
}

function killChildTree(signal) {
  if (hostPlatform === "win32") {
    return;
  }

  // Kill direct children as a final fallback in case normal shutdown leaves stragglers.
  NodeChildProcess.spawnSync("pkill", [`-${signal}`, "-P", String(process.pid)], {
    stdio: "ignore",
  });
}

async function shutdown(exitCode) {
  if (shuttingDown) return;
  logDevElectron("shutdown requested", { exitCode });
  shuttingDown = true;

  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  for (const watcher of watchers) {
    watcher.close();
  }

  await stopApp();
  killChildTree("TERM");
  await new Promise((resolve) => {
    setTimeout(resolve, childTreeGracePeriodMs);
  });
  killChildTree("KILL");
  releaseDevElectronOwnership();

  process.exit(exitCode);
}

startWatchers();
cleanupStaleDevApps();
startApp();

process.once("SIGINT", () => {
  void shutdown(130);
});
process.once("SIGTERM", () => {
  void shutdown(143);
});
process.once("SIGHUP", () => {
  void shutdown(129);
});
