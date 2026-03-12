import { spawn } from "node:child_process";

import { clearDesktopStateDir, resolveDesktopLaunchOptions } from "./desktop-state.mjs";
import { desktopDir, resolveElectronPath } from "./electron-launcher.mjs";

function buildDesktopChildEnv(stateDir) {
  const childEnv = {
    ...process.env,
    T3CODE_STATE_DIR: stateDir,
  };

  // Electron's binary is the real child target here, so Node bootstrap flags would be misleading noise.
  delete childEnv.ELECTRON_RUN_AS_NODE;

  return childEnv;
}

function exitCurrentProcessWithChildResult(code, signal) {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
}

function exitCurrentProcessOnLaunchError(error) {
  console.error(
    `[desktop] Failed to launch Electron: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}

const { forwardedElectronArgs, freshRequested, stateDir } = resolveDesktopLaunchOptions();
const desktopChildEnv = buildDesktopChildEnv(stateDir);

if (freshRequested) {
  console.info(`[desktop] Clearing desktop state before launch: ${stateDir}`);
  clearDesktopStateDir(stateDir);
}

const desktopProcess = spawn(
  resolveElectronPath(),
  ["dist-electron/main.js", ...forwardedElectronArgs],
  {
    stdio: "inherit",
    cwd: desktopDir,
    env: desktopChildEnv,
  },
);

desktopProcess.on("error", exitCurrentProcessOnLaunchError);
desktopProcess.on("exit", exitCurrentProcessWithChildResult);
