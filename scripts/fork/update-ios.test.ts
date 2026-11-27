// Fork: behavioral tests for iOS update scheduling, renewal, branch guards, locking, and warnings.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

const REPO_ROOT = NodePath.resolve(import.meta.dirname, "../..");
const CONFIG_SH = NodePath.join(REPO_ROOT, "scripts/fork/config.sh");
const BUILD_IOS_SH = NodePath.join(REPO_ROOT, "scripts/fork/build-ios.sh");
const UPDATE_IOS_SH = NodePath.join(REPO_ROOT, "scripts/fork/update-ios.sh");
const UPDATE_SH = NodePath.join(REPO_ROOT, "scripts/fork/update.sh");
const SYNC_UPSTREAM_SH = NodePath.join(REPO_ROOT, "scripts/fork/sync-upstream.sh");
const FIXED_NOW = 1_800_000_000;

interface Fixture {
  readonly root: string;
  readonly repo: string;
  readonly stateDir: string;
  readonly binDir: string;
  readonly buildLog: string;
  readonly installLog: string;
  readonly pushLog: string;
  readonly iosUpdateLog: string;
}

const tempRoots: string[] = [];

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    NodeFS.rmSync(dir, { recursive: true, force: true });
  }
});

function writeExecutable(path: string, content: string) {
  NodeFS.writeFileSync(path, content, "utf8");
  NodeFS.chmodSync(path, 0o755);
}

function createFixture(
  options: {
    readonly buildExitCode?: number;
    readonly installShouldFail?: boolean;
    readonly renewedExpires?: number;
    readonly devicesJson?: string;
    readonly realBuildScript?: boolean;
    readonly realUpdateScript?: boolean;
  } = {},
): Fixture {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "fork-update-ios-test-"));
  tempRoots.push(root);
  const repo = NodePath.join(root, "repo");
  const stateDir = NodePath.join(root, "state");
  const binDir = NodePath.join(root, "bin");
  const buildLog = NodePath.join(root, "build.log");
  const installLog = NodePath.join(root, "install.log");
  const pushLog = NodePath.join(root, "push.log");
  const iosUpdateLog = NodePath.join(root, "ios-update.log");

  NodeFS.mkdirSync(NodePath.join(repo, "scripts/fork"), { recursive: true });
  NodeFS.mkdirSync(NodePath.join(repo, "apps/mobile"), { recursive: true });
  NodeFS.mkdirSync(NodePath.join(repo, "apps/web"), { recursive: true });
  NodeFS.mkdirSync(NodePath.join(stateDir, "push/bark/scripts"), { recursive: true });
  NodeFS.mkdirSync(binDir, { recursive: true });

  // Copy the real config.sh and selected fork scripts under test into the scratch git repo.
  NodeFS.writeFileSync(
    NodePath.join(repo, "scripts/fork/config.sh"),
    NodeFS.readFileSync(CONFIG_SH, "utf8"),
  );
  if (options.realUpdateScript) {
    writeExecutable(
      NodePath.join(repo, "scripts/fork/update.sh"),
      NodeFS.readFileSync(UPDATE_SH, "utf8"),
    );
    writeExecutable(
      NodePath.join(repo, "scripts/fork/update-ios.sh"),
      `#!/usr/bin/env bash
set -euo pipefail
if lockf -s -k -t 0 "$FORK_STATE_DIR/update.lock" true 2>/dev/null; then
  lock_state="unlocked"
else
  lock_state="locked"
fi
echo "\${lock_state}:$*" >> "${iosUpdateLog}"
`,
    );
    writeExecutable(
      NodePath.join(repo, "scripts/fork/sync-upstream.sh"),
      "#!/usr/bin/env bash\nexit 0\n",
    );
    writeExecutable(
      NodePath.join(repo, "scripts/fork/build-app.sh"),
      `#!/usr/bin/env bash
echo "build-app" >> "${buildLog}"
exit 0
`,
    );
    writeExecutable(
      NodePath.join(repo, "scripts/fork/install-applet.sh"),
      "#!/usr/bin/env bash\nexit 0\n",
    );
  } else {
    writeExecutable(
      NodePath.join(repo, "scripts/fork/update-ios.sh"),
      NodeFS.readFileSync(UPDATE_IOS_SH, "utf8"),
    );
  }

  // Copy the real build-ios.sh when testing its lockf wrapper; otherwise stub staging.
  const renewedExpires = options.renewedExpires ?? FIXED_NOW + 7 * 86_400;
  const buildExitCode = options.buildExitCode ?? 0;
  if (options.realBuildScript) {
    writeExecutable(
      NodePath.join(repo, "scripts/fork/build-ios.sh"),
      NodeFS.readFileSync(BUILD_IOS_SH, "utf8"),
    );
  } else {
    writeExecutable(
      NodePath.join(repo, "scripts/fork/build-ios.sh"),
      `#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "${buildLog}"
${buildExitCode !== 0 ? `exit ${buildExitCode}` : ""}
commit="$(git rev-parse HEAD)"
mkdir -p "$FORK_STATE_DIR/staged-ios/T3CodeFork.app"
cat >"$FORK_STATE_DIR/staged-ios/meta.env" <<EOF
commit=$commit
version=2.3.0
built_at=${FIXED_NOW}
profile_expires=${renewedExpires}
team_id=TEAMTEST01
bundle_id=com.kliebhan.t3code-fork
EOF
`,
    );
  }

  // Stub deterministic date, pod, osascript, and xcrun (devicectl list/install) on PATH.
  writeExecutable(
    NodePath.join(binDir, "date"),
    `#!/usr/bin/env bash
case "\${1:-}" in
  +%s) echo "\${TEST_NOW_EPOCH:-${FIXED_NOW}}" ;;
  +%H) echo "\${TEST_NOW_HOUR:-12}" ;;
  +%Y-%m-%d) echo "\${TEST_NOW_DAY:-2027-01-15}" ;;
  *) /bin/date "$@" ;;
esac
`,
  );
  writeExecutable(NodePath.join(binDir, "pod"), "#!/usr/bin/env bash\nexit 0\n");
  writeExecutable(NodePath.join(binDir, "osascript"), "#!/usr/bin/env bash\nexit 0\n");
  const defaultDevicesJson = JSON.stringify({
    result: {
      devices: [
        {
          properties: {
            hardware: { reality: "physical", platform: "watchOS", udid: "UDID-WATCH-1" },
            connection: { pairingState: "paired", transportType: "localNetwork" },
            state: { name: "Test Watch" },
          },
        },
        {
          properties: {
            hardware: { reality: "physical", platform: "iOS", udid: "UDID-TEST-1" },
            connection: { pairingState: "paired", transportType: "localNetwork" },
            state: { name: "Test iPhone" },
          },
        },
      ],
    },
  });
  const devicesJson = options.devicesJson ?? defaultDevicesJson;
  writeExecutable(
    NodePath.join(binDir, "xcrun"),
    `#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = "devicectl" ] && [ "$2" = "list" ]; then
  cat <<'JSON'
${devicesJson}
JSON
  exit 0
fi
if [ "$1" = "devicectl" ] && [ "$2" = "device" ] && [ "$3" = "install" ]; then
  echo "$*" >> "${installLog}"
  ${options.installShouldFail ? "exit 1" : "exit 0"}
fi
exit 1
`,
  );

  // Stub vp env hook: prepends stub binDir after config.sh resets PATH.
  NodeFS.writeFileSync(NodePath.join(root, "vp-env.sh"), `PATH="${binDir}:$PATH"\n`, "utf8");

  // Stub Bark sender so we can verify phone notifications and deduplication.
  writeExecutable(
    NodePath.join(stateDir, "push/python3"),
    `#!/usr/bin/env bash
echo "$*" >> "${pushLog}"
`,
  );
  NodeFS.writeFileSync(NodePath.join(stateDir, "push/bark/scripts/send.py"), "# stub\n");

  const git = (args: string[]) =>
    NodeChildProcess.execFileSync("git", args, {
      cwd: repo,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Test",
        GIT_AUTHOR_EMAIL: "test@example.com",
        GIT_COMMITTER_NAME: "Test",
        GIT_COMMITTER_EMAIL: "test@example.com",
      },
      stdio: "pipe",
    })
      .toString()
      .trim();

  git(["init", "-b", "pi-prompt-suggestions"]);
  NodeFS.writeFileSync(NodePath.join(repo, "apps/mobile/index.ts"), "export const v = 1;\n");
  NodeFS.writeFileSync(NodePath.join(repo, "apps/web/index.ts"), "export const w = 1;\n");
  git(["add", "."]);
  git(["commit", "-m", "initial"]);

  return { root, repo, stateDir, binDir, buildLog, installLog, pushLog, iosUpdateLog };
}

function runForkScript(
  fixture: Fixture,
  scriptPath: string,
  args: string[],
  extraEnv: Record<string, string> = {},
  timeoutMs?: number,
): { readonly exitCode: number; readonly output: string } {
  try {
    const output = NodeChildProcess.execFileSync("bash", [scriptPath, ...args], {
      cwd: fixture.repo,
      env: {
        ...process.env,
        // A test run inside a scheduled update.sh or iOS script inherits its lock markers; each fixture takes its own lock.
        FORK_UPDATE_LOCKED: "",
        FORK_IOS_UPDATE_LOCKED: "",
        FORK_IOS_BUILD_LOCKED: "",
        FORK_SYNC_LOCKED: "",
        PATH: `${fixture.binDir}:/usr/bin:/bin:/usr/sbin:/sbin`,
        VP_ENV: NodePath.join(fixture.root, "vp-env.sh"),
        FORK_STATE_DIR: fixture.stateDir,
        FORK_APP_PATH: NodePath.join(fixture.root, "installed/T3 Code (Fork).app"),
        FORK_BUILD_HOST: "",
        FORK_IOS_DEVICE: "",
        FORK_IOS_AUTO_UPDATE: "1",
        ...extraEnv,
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      ...(timeoutMs !== undefined ? { timeout: timeoutMs } : {}),
    });
    return { exitCode: 0, output };
  } catch (error) {
    const failed = error as { status?: number; stdout?: string; stderr?: string };
    return {
      exitCode: failed.status ?? 1,
      output: `${failed.stdout ?? ""}${failed.stderr ?? ""}`,
    };
  }
}

function runUpdateIos(
  fixture: Fixture,
  args: string[],
  extraEnv: Record<string, string> = {},
): { readonly exitCode: number; readonly output: string } {
  return runForkScript(fixture, "scripts/fork/update-ios.sh", args, extraEnv);
}

// Holds a real macOS lockf lock until fn finishes, using stdout readiness instead of polling.
async function withFileLock<T>(lockPath: string, fn: () => T | Promise<T>): Promise<T> {
  NodeFS.mkdirSync(NodePath.dirname(lockPath), { recursive: true });
  const holder = NodeChildProcess.spawn(
    "lockf",
    ["-s", "-k", "-t", "0", lockPath, "sh", "-c", "printf locked; exec cat"],
    { stdio: ["pipe", "pipe", "pipe"] },
  );

  await new Promise<void>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    holder.stdout.setEncoding("utf8");
    holder.stderr.setEncoding("utf8");
    holder.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.includes("locked")) {
        resolve();
      }
    });
    holder.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    holder.once("error", reject);
    holder.once("exit", (code) => {
      if (!stdout.includes("locked")) {
        reject(new Error(`lockf holder exited early (code ${String(code)}): ${stderr}`));
      }
    });
  });

  try {
    return await fn();
  } finally {
    const exited = new Promise<void>((resolve) => {
      if (holder.exitCode !== null || holder.signalCode !== null) {
        resolve();
        return;
      }
      holder.once("close", () => resolve());
    });
    holder.stdin.end();
    await exited;
  }
}

function readLines(path: string): string[] {
  try {
    return NodeFS.readFileSync(path, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function gitHead(repo: string): string {
  return NodeChildProcess.execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repo,
    encoding: "utf8",
  }).trim();
}

function commitChange(repo: string, relPath: string, content: string): string {
  const fullPath = NodePath.join(repo, relPath);
  NodeFS.mkdirSync(NodePath.dirname(fullPath), { recursive: true });
  NodeFS.writeFileSync(fullPath, content, "utf8");
  NodeChildProcess.execFileSync("git", ["add", relPath], { cwd: repo });
  NodeChildProcess.execFileSync("git", ["commit", "-m", `update ${relPath}`], {
    cwd: repo,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
    stdio: "pipe",
  });
  return gitHead(repo);
}

// oxlint-disable-next-line t3code/no-global-process-runtime -- Shell harness executes macOS lockf; skip on non-macOS hosts.
describe.skipIf(NodeOS.platform() !== "darwin")("scripts/fork/update-ios.sh", () => {
  it("skips rebuilds for non-iOS changes and stages + installs mobile changes immediately", () => {
    const fixture = createFixture({ renewedExpires: FIXED_NOW + 7 * 86_400 });
    const initialHead = gitHead(fixture.repo);

    // Seed an already-installed build with 5 days left (no renewal needed).
    NodeFS.writeFileSync(
      NodePath.join(fixture.stateDir, "ios-installed.env"),
      `device=UDID-TEST-1\ncommit=${initialHead}\nprofile_expires=${FIXED_NOW + 5 * 86_400}\n`,
    );

    // A web-only commit must not trigger an iOS build or install.
    commitChange(fixture.repo, "apps/web/index.ts", "export const w = 2;\n");
    const webResult = runUpdateIos(fixture, ["--scheduled"], { TEST_NOW_HOUR: "14" });
    expect(webResult.exitCode).toBe(0);
    expect(readLines(fixture.buildLog)).toEqual([]);
    expect(readLines(fixture.installLog)).toEqual([]);

    // --build-only stages a mobile commit without installing wirelessly.
    const stagedOnlyHead = commitChange(
      fixture.repo,
      "apps/mobile/index.ts",
      "export const v = 2;\n",
    );
    const buildOnlyResult = runUpdateIos(fixture, ["--scheduled", "--build-only"], {
      TEST_NOW_HOUR: "14",
    });
    expect(buildOnlyResult.exitCode).toBe(0);
    expect(readLines(fixture.buildLog)).toEqual(["--stage"]);
    expect(readLines(fixture.installLog)).toEqual([]);

    // A regular scheduled daytime run installs the staged bundle wirelessly immediately and notifies once.
    const daytimeResult = runUpdateIos(fixture, ["--scheduled"], { TEST_NOW_HOUR: "14" });
    expect(daytimeResult.exitCode).toBe(0);
    expect(readLines(fixture.buildLog)).toEqual(["--stage"]);
    expect(readLines(fixture.installLog)).toHaveLength(1);
    expect(
      NodeFS.readFileSync(NodePath.join(fixture.stateDir, "ios-installed.env"), "utf8"),
    ).toContain(`commit=${stagedOnlyHead}`);
    expect(readLines(fixture.pushLog).filter((line) => line.includes("--event info"))).toHaveLength(
      1,
    );

    // A second scheduled run without new changes neither rebuilds nor reinstalls.
    const idleResult = runUpdateIos(fixture, ["--scheduled"], { TEST_NOW_HOUR: "15" });
    expect(idleResult.exitCode).toBe(0);
    expect(readLines(fixture.buildLog)).toEqual(["--stage"]);
    expect(readLines(fixture.installLog)).toHaveLength(1);
  });

  it("renews expiring profiles with --renew-profile and warns once when unreachable", () => {
    const fixture = createFixture({
      installShouldFail: true,
      renewedExpires: FIXED_NOW + 7 * 86_400,
    });
    const head = gitHead(fixture.repo);

    // 20 hours left: triggers renewal (<= 48h) and warning (<= 36h); unreachable device does not fail run.
    NodeFS.writeFileSync(
      NodePath.join(fixture.stateDir, "ios-installed.env"),
      `device=UDID-TEST-1\ncommit=${head}\nprofile_expires=${FIXED_NOW + 20 * 3600}\n`,
    );

    const first = runUpdateIos(fixture, ["--scheduled"], { TEST_NOW_HOUR: "14" });
    expect(first.exitCode).toBe(0);
    expect(readLines(fixture.buildLog)).toEqual(["--stage --renew-profile"]);
    // Install attempted immediately; unreachable device leaves staged build waiting without failing run.
    expect(readLines(fixture.installLog)).toHaveLength(1);
    const warningsAfterFirst = readLines(fixture.pushLog).filter((line) =>
      line.includes("--event rueckfrage"),
    );
    expect(warningsAfterFirst).toHaveLength(1);

    // Second scheduled run does not rebuild (staged profile is already fresh) and does not re-warn.
    const second = runUpdateIos(fixture, ["--scheduled"], { TEST_NOW_HOUR: "15" });
    expect(second.exitCode).toBe(0);
    expect(readLines(fixture.buildLog)).toEqual(["--stage --renew-profile"]);
    const warningsAfterSecond = readLines(fixture.pushLog).filter((line) =>
      line.includes("--event rueckfrage"),
    );
    expect(warningsAfterSecond).toHaveLength(1);
  });

  it("alerts once on build failure and skips retrying the same commit that day", () => {
    const fixture = createFixture({ buildExitCode: 1 });

    const first = runUpdateIos(fixture, ["--scheduled"], { TEST_NOW_HOUR: "14" });
    expect(first.exitCode).toBe(1);
    expect(readLines(fixture.buildLog)).toHaveLength(1);
    expect(
      readLines(fixture.pushLog).filter((line) => line.includes("--event fehler")),
    ).toHaveLength(1);

    const second = runUpdateIos(fixture, ["--scheduled"], { TEST_NOW_HOUR: "15" });
    expect(second.exitCode).toBe(0);
    expect(readLines(fixture.buildLog)).toHaveLength(1);
    expect(
      readLines(fixture.pushLog).filter((line) => line.includes("--event fehler")),
    ).toHaveLength(1);
  });

  it("handles build lock contention, stalled renewal backoff, and expiry warnings without a resolved device", () => {
    // Exit 75 from build-ios.sh (concurrent build lock) is non-fatal and must not alert or mark failed.
    const lockedFixture = createFixture({ buildExitCode: 75 });
    const lockedRun = runUpdateIos(lockedFixture, ["--scheduled"], { TEST_NOW_HOUR: "14" });
    expect(lockedRun.exitCode).toBe(0);
    expect(readLines(lockedFixture.buildLog)).toHaveLength(1);
    expect(readLines(lockedFixture.pushLog)).toEqual([]);
    expect(NodeFS.existsSync(NodePath.join(lockedFixture.stateDir, "ios-build-failed"))).toBe(
      false,
    );

    // If --renew-profile returns an unchanged expiry, scheduled runs back off for the rest of the day.
    const stalledExpiry = FIXED_NOW + 30 * 3600;
    const stalledFixture = createFixture({
      renewedExpires: stalledExpiry,
      installShouldFail: true,
    });
    const stalledHead = gitHead(stalledFixture.repo);
    NodeFS.writeFileSync(
      NodePath.join(stalledFixture.stateDir, "ios-installed.env"),
      `device=UDID-TEST-1\ncommit=${stalledHead}\nprofile_expires=${stalledExpiry}\n`,
    );
    expect(runUpdateIos(stalledFixture, ["--scheduled"], { TEST_NOW_HOUR: "14" }).exitCode).toBe(0);
    expect(readLines(stalledFixture.buildLog)).toEqual(["--stage --renew-profile"]);
    expect(runUpdateIos(stalledFixture, ["--scheduled"], { TEST_NOW_HOUR: "15" }).exitCode).toBe(0);
    expect(readLines(stalledFixture.buildLog)).toEqual(["--stage --renew-profile"]);

    // Even when no paired iOS device resolves, Step 3 still sends the Day-6 expiry warning once.
    const noDeviceFixture = createFixture({
      devicesJson: JSON.stringify({ result: { devices: [] } }),
    });
    const noDeviceHead = gitHead(noDeviceFixture.repo);
    NodeFS.writeFileSync(
      NodePath.join(noDeviceFixture.stateDir, "ios-installed.env"),
      `device=UDID-TEST-1\ncommit=${noDeviceHead}\nprofile_expires=${FIXED_NOW + 20 * 3600}\n`,
    );
    const noDeviceRun = runUpdateIos(noDeviceFixture, ["--scheduled"], { TEST_NOW_HOUR: "14" });
    expect(noDeviceRun.exitCode).toBe(0);
    expect(readLines(noDeviceFixture.buildLog)).toEqual([]);
    expect(readLines(noDeviceFixture.installLog)).toEqual([]);
    expect(
      readLines(noDeviceFixture.pushLog).filter((line) => line.includes("--event rueckfrage")),
    ).toHaveLength(1);
  });

  it("enforces branch guards for scheduled runs while allowing manual --now builds", () => {
    // update-ios.sh refuses --scheduled (alone or with --now) on a non-fork branch,
    // while allowing manual --now builds so feature branches can still be tested on device.
    const iosFixture = createFixture();
    NodeChildProcess.execFileSync("git", ["checkout", "-b", "some-feature-branch"], {
      cwd: iosFixture.repo,
      stdio: "pipe",
    });
    const featureHead = commitChange(
      iosFixture.repo,
      "apps/mobile/index.ts",
      "export const v = 3;\n",
    );

    const scheduledRun = runUpdateIos(iosFixture, ["--scheduled"], { TEST_NOW_HOUR: "03" });
    expect(scheduledRun.exitCode).toBe(2);
    expect(scheduledRun.output).toContain("check out pi-prompt-suggestions first");
    expect(readLines(iosFixture.buildLog)).toEqual([]);
    expect(readLines(iosFixture.installLog)).toEqual([]);

    const scheduledNowRun = runUpdateIos(iosFixture, ["--scheduled", "--now"], {
      TEST_NOW_HOUR: "03",
    });
    expect(scheduledNowRun.exitCode).toBe(2);
    expect(readLines(iosFixture.buildLog)).toEqual([]);
    expect(readLines(iosFixture.installLog)).toEqual([]);

    const manualNowRun = runUpdateIos(iosFixture, ["--now"], { TEST_NOW_HOUR: "14" });
    expect(manualNowRun.exitCode).toBe(0);
    expect(readLines(iosFixture.buildLog)).toEqual(["--stage"]);
    expect(readLines(iosFixture.installLog)).toHaveLength(1);
    expect(
      NodeFS.readFileSync(NodePath.join(iosFixture.stateDir, "ios-installed.env"), "utf8"),
    ).toContain(`commit=${featureHead}`);

    // update.sh --scheduled must not invoke update-ios.sh when its own branch guard exits 2.
    const updateFixture = createFixture({ realUpdateScript: true });
    NodeChildProcess.execFileSync("git", ["checkout", "-b", "some-feature-branch"], {
      cwd: updateFixture.repo,
      stdio: "pipe",
    });
    const updateWrongBranch = runForkScript(
      updateFixture,
      "scripts/fork/update.sh",
      ["--scheduled"],
      { TEST_NOW_HOUR: "14" },
    );
    expect(updateWrongBranch.exitCode).toBe(2);
    expect(updateWrongBranch.output).toContain("check out pi-prompt-suggestions first");
    expect(readLines(updateFixture.iosUpdateLog)).toEqual([]);
  });

  it("serializes update-ios.sh, build-ios.sh, and update.sh with lockf and runs iOS outside update.lock", async () => {
    // 1. Holding update-ios.lock causes update-ios.sh to exit 0 cleanly without building or pushing.
    const iosLockFixture = createFixture();
    await withFileLock(NodePath.join(iosLockFixture.stateDir, "update-ios.lock"), () => {
      const result = runUpdateIos(iosLockFixture, ["--scheduled"], { TEST_NOW_HOUR: "14" });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("update-ios: another run is active");
      expect(readLines(iosLockFixture.buildLog)).toEqual([]);
      expect(readLines(iosLockFixture.installLog)).toEqual([]);
      expect(readLines(iosLockFixture.pushLog)).toEqual([]);
    });

    // 2. Holding build-ios.lock makes build-ios.sh exit 75, and update-ios.sh treats it as non-fatal.
    const buildLockFixture = createFixture({ realBuildScript: true });
    await withFileLock(NodePath.join(buildLockFixture.stateDir, "build-ios.lock"), () => {
      const directBuild = runForkScript(buildLockFixture, "scripts/fork/build-ios.sh", ["--stage"]);
      expect(directBuild.exitCode).toBe(75);
      expect(directBuild.output).toContain("build-ios: another iOS build is already running");

      const scheduledIos = runUpdateIos(buildLockFixture, ["--scheduled"], { TEST_NOW_HOUR: "14" });
      expect(scheduledIos.exitCode).toBe(0);
      expect(scheduledIos.output).toContain("another iOS build is already running; skipping");
      expect(readLines(buildLockFixture.pushLog)).toEqual([]);
      expect(NodeFS.existsSync(NodePath.join(buildLockFixture.stateDir, "ios-build-failed"))).toBe(
        false,
      );
    });

    // 3. Holding update.lock skips update-ios.sh; once free, scheduled update.sh runs iOS unlocked.
    const updateLockFixture = createFixture({ realUpdateScript: true });
    const head = gitHead(updateLockFixture.repo);
    NodeFS.writeFileSync(NodePath.join(updateLockFixture.stateDir, "last-sync"), `${FIXED_NOW}\n`);
    NodeFS.writeFileSync(NodePath.join(updateLockFixture.stateDir, "build-failed"), `${head}\n`);

    await withFileLock(NodePath.join(updateLockFixture.stateDir, "update.lock"), () => {
      const busyRun = runForkScript(updateLockFixture, "scripts/fork/update.sh", ["--scheduled"], {
        TEST_NOW_HOUR: "14",
      });
      expect(busyRun.exitCode).toBe(0);
      expect(busyRun.output).toContain("update: another run is active");
      expect(readLines(updateLockFixture.iosUpdateLog)).toEqual([]);
    });

    // Non-scheduled update.sh must not trigger the scheduled iOS step.
    const manualRun = runForkScript(updateLockFixture, "scripts/fork/update.sh", [], {
      TEST_NOW_HOUR: "14",
    });
    expect(manualRun.exitCode).toBe(0);
    expect(readLines(updateLockFixture.iosUpdateLog)).toEqual([]);

    // Scheduled update.sh on the fork branch runs update-ios.sh after releasing update.lock.
    const scheduledRun = runForkScript(
      updateLockFixture,
      "scripts/fork/update.sh",
      ["--scheduled"],
      { TEST_NOW_HOUR: "14" },
    );
    expect(scheduledRun.exitCode).toBe(0);
    expect(readLines(updateLockFixture.iosUpdateLog)).toEqual(["unlocked:--scheduled"]);
  });

  it("skips macOS desktop rebuilds on apps/mobile-only commits while still running update-ios.sh", () => {
    const fixture = createFixture({ realUpdateScript: true });
    const baseHead = gitHead(fixture.repo);
    NodeFS.writeFileSync(NodePath.join(fixture.stateDir, "last-sync"), `${FIXED_NOW}\n`);

    const installedPlistDir = NodePath.join(fixture.root, "installed/T3 Code (Fork).app/Contents");
    NodeFS.mkdirSync(installedPlistDir, { recursive: true });
    NodeFS.writeFileSync(
      NodePath.join(installedPlistDir, "Info.plist"),
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>T3ForkCommit</key><string>${baseHead}</string></dict></plist>
`,
      "utf8",
    );

    // Mobile-only commit: macOS build is skipped, iOS scheduled update still runs.
    commitChange(fixture.repo, "apps/mobile/index.ts", "export const v = 2;\n");
    const mobileOnlyRun = runForkScript(fixture, "scripts/fork/update.sh", ["--scheduled"], {
      TEST_NOW_HOUR: "14",
    });
    expect(mobileOnlyRun.exitCode).toBe(0);
    expect(readLines(fixture.buildLog)).toEqual([]);
    expect(readLines(fixture.iosUpdateLog)).toEqual(["unlocked:--scheduled"]);

    // Moving a file out of apps/web into apps/mobile removes a desktop input and must trigger a macOS rebuild.
    NodeChildProcess.execFileSync("git", ["mv", "apps/web/index.ts", "apps/mobile/moved-web.ts"], {
      cwd: fixture.repo,
      stdio: "pipe",
    });
    NodeChildProcess.execFileSync("git", ["commit", "-m", "move web file to mobile"], {
      cwd: fixture.repo,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Test",
        GIT_AUTHOR_EMAIL: "test@example.com",
        GIT_COMMITTER_NAME: "Test",
        GIT_COMMITTER_EMAIL: "test@example.com",
      },
      stdio: "pipe",
    });
    const renameOutOfWebRun = runForkScript(fixture, "scripts/fork/update.sh", ["--scheduled"], {
      TEST_NOW_HOUR: "14",
    });
    expect(renameOutOfWebRun.exitCode).toBe(0);
    expect(readLines(fixture.buildLog)).toEqual(["build-app"]);

    // Ordinary web/desktop edit also triggers a macOS rebuild as usual.
    commitChange(fixture.repo, "apps/web/other.ts", "export const w = 2;\n");
    const webChangeRun = runForkScript(fixture, "scripts/fork/update.sh", ["--scheduled"], {
      TEST_NOW_HOUR: "14",
    });
    expect(webChangeRun.exitCode).toBe(0);
    expect(readLines(fixture.buildLog)).toEqual(["build-app", "build-app"]);
  });

  it("triggers iOS builds on native/apple-speech, patches, and renames out of apps/mobile while skipping desktop-only native changes", () => {
    const fixture = createFixture();
    const initialHead = gitHead(fixture.repo);

    NodeFS.writeFileSync(
      NodePath.join(fixture.stateDir, "ios-installed.env"),
      [
        "device=UDID-TEST-1",
        `commit=${initialHead}`,
        "version=2.3.0",
        `built_at=${FIXED_NOW - 3600}`,
        `profile_expires=${FIXED_NOW + 6 * 86_400}`,
        `installed_at=${FIXED_NOW - 3600}`,
      ].join("\n") + "\n",
    );

    // Desktop-only native code must not trigger an iOS rebuild.
    commitChange(fixture.repo, "native/libghostty-vt/foo.c", "int x = 1;\n");
    const desktopNativeRun = runUpdateIos(fixture, ["--scheduled"], { TEST_NOW_HOUR: "14" });
    expect(desktopNativeRun.exitCode).toBe(0);
    expect(readLines(fixture.buildLog)).toEqual([]);

    // Shared iOS Apple Speech Swift file must trigger an iOS rebuild.
    commitChange(
      fixture.repo,
      "native/apple-speech/AppleSpeechEngine.swift",
      "struct AppleSpeechEngine {}\n",
    );
    const appleSpeechRun = runUpdateIos(fixture, ["--scheduled"], { TEST_NOW_HOUR: "14" });
    expect(appleSpeechRun.exitCode).toBe(0);
    expect(readLines(fixture.buildLog)).toEqual(["--stage"]);

    // Native module patch edits under patches/ must trigger an iOS rebuild.
    commitChange(fixture.repo, "patches/expo-audio@58.0.11.patch", "--- a/foo\n+++ b/foo\n");
    const patchRun = runUpdateIos(fixture, ["--scheduled"], { TEST_NOW_HOUR: "14" });
    expect(patchRun.exitCode).toBe(0);
    expect(readLines(fixture.buildLog)).toEqual(["--stage", "--stage"]);

    // Moving a file out of apps/mobile into apps/web removes an iOS input and must trigger a rebuild.
    NodeChildProcess.execFileSync(
      "git",
      ["mv", "apps/mobile/index.ts", "apps/web/moved-from-mobile.ts"],
      {
        cwd: fixture.repo,
        stdio: "pipe",
      },
    );
    NodeChildProcess.execFileSync("git", ["commit", "-m", "move mobile file to web"], {
      cwd: fixture.repo,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Test",
        GIT_AUTHOR_EMAIL: "test@example.com",
        GIT_COMMITTER_NAME: "Test",
        GIT_COMMITTER_EMAIL: "test@example.com",
      },
      stdio: "pipe",
    });
    const renameOutOfMobileRun = runUpdateIos(fixture, ["--scheduled"], { TEST_NOW_HOUR: "14" });
    expect(renameOutOfMobileRun.exitCode).toBe(0);
    expect(readLines(fixture.buildLog)).toEqual(["--stage", "--stage", "--stage"]);
  });

  it("invalidates build-ios.sh prebuild cache when symlinked native module inputs or patches change", () => {
    const fixture = createFixture({ realBuildScript: true });
    const prebuildLog = NodePath.join(fixture.root, "prebuild.log");

    // Seed minimal repo files and the AppleSpeechEngine.swift symlink matching the real repo layout.
    NodeFS.writeFileSync(NodePath.join(fixture.repo, "apps/mobile/app.config.ts"), "export {};\n");
    NodeFS.writeFileSync(NodePath.join(fixture.repo, "apps/mobile/package.json"), "{}\n");
    NodeFS.writeFileSync(NodePath.join(fixture.repo, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    NodeFS.mkdirSync(NodePath.join(fixture.repo, "node_modules"), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(fixture.repo, "node_modules/.modules.yaml"), "ok: true\n");
    NodeFS.mkdirSync(NodePath.join(fixture.repo, "native/apple-speech"), { recursive: true });
    const speechTarget = NodePath.join(fixture.repo, "native/apple-speech/AppleSpeechEngine.swift");
    NodeFS.writeFileSync(speechTarget, "struct Engine { let v = 1 }\n");
    const moduleIosDir = NodePath.join(
      fixture.repo,
      "apps/mobile/modules/t3-voice-transcription/ios",
    );
    NodeFS.mkdirSync(moduleIosDir, { recursive: true });
    NodeFS.symlinkSync(
      "../../../../../native/apple-speech/AppleSpeechEngine.swift",
      NodePath.join(moduleIosDir, "AppleSpeechEngine.swift"),
    );
    NodeFS.mkdirSync(NodePath.join(fixture.repo, "patches"), { recursive: true });
    const patchFile = NodePath.join(fixture.repo, "patches/expo-audio@58.0.11.patch");
    NodeFS.writeFileSync(patchFile, "--- a/a\n+++ b/a\n");

    writeExecutable(
      NodePath.join(fixture.binDir, "vp"),
      `#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "${prebuildLog}"
mkdir -p ios/T3CodeFork.xcworkspace ios/Pods
touch ios/Pods/Manifest.lock
`,
    );
    writeExecutable(
      NodePath.join(fixture.binDir, "xcodebuild"),
      `#!/usr/bin/env bash
set -euo pipefail
app_dir="$FORK_STATE_DIR/ios-derived-data/Build/Products/Release-iphoneos/T3CodeFork.app"
mkdir -p "$app_dir"
cat >"$app_dir/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>2.3.0</string></dict></plist>
PLIST
`,
    );
    writeExecutable(NodePath.join(fixture.binDir, "node"), "#!/usr/bin/env bash\nexit 0\n");

    const buildEnv = { FORK_IOS_TEAM_ID: "TEAMTEST01" };

    // 1. First build runs prebuild and records the fingerprint.
    const first = runForkScript(fixture, "scripts/fork/build-ios.sh", ["--stage"], buildEnv);
    expect(first.exitCode).toBe(0);
    expect(readLines(prebuildLog)).toHaveLength(1);

    // 2. Unchanged inputs reuse the cached prebuild.
    const cached = runForkScript(fixture, "scripts/fork/build-ios.sh", ["--stage"], buildEnv);
    expect(cached.exitCode).toBe(0);
    expect(cached.output).toContain("reusing cached prebuild");
    expect(readLines(prebuildLog)).toHaveLength(1);

    // 3. Editing the symlink target invalidates the prebuild cache.
    NodeFS.writeFileSync(speechTarget, "struct Engine { let v = 2 }\n");
    const afterSymlinkEdit = runForkScript(
      fixture,
      "scripts/fork/build-ios.sh",
      ["--stage"],
      buildEnv,
    );
    expect(afterSymlinkEdit.exitCode).toBe(0);
    expect(readLines(prebuildLog)).toHaveLength(2);

    // 4. Editing a native patch file invalidates the prebuild cache.
    NodeFS.writeFileSync(patchFile, "--- a/a\n+++ b/a\n+changed\n");
    const afterPatchEdit = runForkScript(
      fixture,
      "scripts/fork/build-ios.sh",
      ["--stage"],
      buildEnv,
    );
    expect(afterPatchEdit.exitCode).toBe(0);
    expect(readLines(prebuildLog)).toHaveLength(3);

    // 5. A directory symlink loop under a fingerprinted root must not fail the build.
    NodeFS.symlinkSync("..", NodePath.join(moduleIosDir, "zzz-loop"));
    const withLoopLink = runForkScript(fixture, "scripts/fork/build-ios.sh", ["--stage"], buildEnv);
    expect(withLoopLink.exitCode).toBe(0);
    expect(withLoopLink.output).toContain("reusing cached prebuild");
    expect(readLines(prebuildLog)).toHaveLength(3);
  });

  it("scopes build-ios.sh prebuild_fingerprint to apps/mobile native/plugin/asset deps and logs xcodebuild to file", () => {
    const fixture = createFixture({ realBuildScript: true });
    const prebuildLog = NodePath.join(fixture.root, "prebuild.log");
    const xcodeFailFlag = NodePath.join(fixture.root, "xcode-fail");

    const seedPnpmPkg = (storeEntry: string, pkgName: string, files: Record<string, string>) => {
      const dir = NodePath.join(
        fixture.repo,
        "node_modules/.pnpm",
        storeEntry,
        "node_modules",
        pkgName,
      );
      NodeFS.mkdirSync(dir, { recursive: true });
      for (const [rel, content] of Object.entries(files)) {
        NodeFS.writeFileSync(NodePath.join(dir, rel), content);
      }
      return NodePath.join(fixture.repo, "node_modules/.pnpm", storeEntry);
    };

    // Seed native marker, package.json expo.plugin, app.config.ts asset, local archive, and pure-JS store entries.
    const audioStore58_11 = seedPnpmPkg("expo-audio@58.0.11", "expo-audio", {
      "expo-module.config.json": "{}\n",
    });
    const pluginStore1 = seedPnpmPkg("custom-expo-plugin@1.0.0", "custom-expo-plugin", {
      "package.json": JSON.stringify({ name: "custom-expo-plugin", expo: { plugin: "./plug.js" } }),
    });
    const helperStore1 = seedPnpmPkg("plist-helper@1.0.0", "plist-helper", {
      "package.json": '{"name":"plist-helper"}\n',
    });
    const fontStore1 = seedPnpmPkg(
      "@expo-google-fonts+dm-sans@0.4.1",
      "@expo-google-fonts/dm-sans",
      { "package.json": '{"name":"@expo-google-fonts/dm-sans"}\n' },
    );
    seedPnpmPkg("local-native@file+vendor+local-native.tgz", "local-native", {
      "expo-module.config.json": "{}\n",
    });
    const effectStore4_1_4 = seedPnpmPkg("effect@4.1.4", "effect", {
      "package.json": '{"name":"effect"}\n',
    });
    seedPnpmPkg("@cursor+sdk@1.4.0", "@cursor/sdk", {
      "package.json": '{"name":"@cursor/sdk"}\n',
    });
    NodeFS.writeFileSync(NodePath.join(fixture.repo, "node_modules/.modules.yaml"), "ok: true\n");

    const localArchive = NodePath.join(fixture.repo, "vendor/local-native.tgz");
    NodeFS.mkdirSync(NodePath.dirname(localArchive), { recursive: true });
    NodeFS.writeFileSync(localArchive, "archive-v1\n");

    NodeFS.writeFileSync(
      NodePath.join(fixture.repo, "apps/mobile/app.config.ts"),
      'export const font = "@expo-google-fonts/dm-sans/400Regular/DMSans_400Regular.ttf";\n',
    );
    const writeMobilePkg = (effectVer: string) =>
      NodeFS.writeFileSync(
        NodePath.join(fixture.repo, "apps/mobile/package.json"),
        JSON.stringify(
          {
            name: "@t3tools/mobile",
            version: "2.3.0",
            dependencies: {
              "expo-audio": "58.0.11",
              "custom-expo-plugin": "1.0.0",
              "@expo-google-fonts/dm-sans": "0.4.1",
              "local-native": "file:../../vendor/local-native.tgz",
              effect: effectVer,
            },
          },
          null,
          2,
        ) + "\n",
      );
    writeMobilePkg("4.1.4");

    const writeLockfile = (opts: {
      readonly audioVer: string;
      readonly audioIntegrity?: string;
      readonly pluginVer?: string;
      readonly helperVer?: string;
      readonly fontVer?: string;
      readonly effectVer: string;
      readonly serverVer: string;
    }) => {
      const audioIntegrity = opts.audioIntegrity ?? "sha512-aaa";
      const pluginVer = opts.pluginVer ?? "1.0.0";
      const helperVer = opts.helperVer ?? "1.0.0";
      const fontVer = opts.fontVer ?? "0.4.1";
      NodeFS.writeFileSync(
        NodePath.join(fixture.repo, "pnpm-lock.yaml"),
        [
          "lockfileVersion: '9.0'",
          "importers:",
          "  .:",
          "    dependencies: {}",
          "importers:",
          "  apps/mobile:",
          "    dependencies:",
          "      expo-audio:",
          `        specifier: ${opts.audioVer}`,
          `        version: ${opts.audioVer}`,
          "      custom-expo-plugin:",
          `        specifier: ${pluginVer}`,
          `        version: ${pluginVer}`,
          "      '@expo-google-fonts/dm-sans':",
          `        specifier: ${fontVer}`,
          `        version: ${fontVer}`,
          "      local-native:",
          "        specifier: file:../../vendor/local-native.tgz",
          "        version: file:vendor/local-native.tgz",
          "      effect:",
          `        specifier: ${opts.effectVer}`,
          `        version: ${opts.effectVer}`,
          "  apps/server:",
          "    dependencies:",
          "      '@cursor/sdk':",
          `        specifier: ${opts.serverVer}`,
          `        version: ${opts.serverVer}`,
          "packages:",
          `  expo-audio@${opts.audioVer}:`,
          `    resolution: {integrity: ${audioIntegrity}}`,
          `  custom-expo-plugin@${pluginVer}:`,
          "    resolution: {integrity: sha512-plugin}",
          `  plist-helper@${helperVer}:`,
          "    resolution: {integrity: sha512-helper}",
          `  '@expo-google-fonts/dm-sans@${fontVer}':`,
          "    resolution: {integrity: sha512-font}",
          "  'local-native@file:vendor/local-native.tgz':",
          "    resolution: {tarball: file:vendor/local-native.tgz}",
          `  effect@${opts.effectVer}:`,
          "    resolution: {integrity: sha512-effect}",
          `  '@cursor/sdk@${opts.serverVer}':`,
          "    resolution: {integrity: sha512-server}",
          "snapshots:",
          `  expo-audio@${opts.audioVer}: {}`,
          `  ? custom-expo-plugin@${pluginVer}`,
          "  : dependencies:",
          `      plist-helper: ${helperVer}`,
          `  plist-helper@${helperVer}: {}`,
          `  '@expo-google-fonts/dm-sans@${fontVer}': {}`,
          "  'local-native@file:vendor/local-native.tgz': {}",
          `  effect@${opts.effectVer}: {}`,
          `  '@cursor/sdk@${opts.serverVer}': {}`,
          "",
        ].join("\n"),
      );
    };
    writeLockfile({ audioVer: "58.0.11", effectVer: "4.1.4", serverVer: "1.4.0" });

    NodeFS.mkdirSync(NodePath.join(fixture.repo, "patches"), { recursive: true });
    const nativePatch = NodePath.join(fixture.repo, "patches/expo-audio@58.0.11.patch");
    const serverPatch = NodePath.join(fixture.repo, "patches/@cursor__sdk@1.4.0.patch");
    NodeFS.writeFileSync(nativePatch, "--- a/ios/Audio.swift\n+++ b/ios/Audio.swift\n");
    NodeFS.writeFileSync(serverPatch, "--- a/server.js\n+++ b/server.js\n");

    writeExecutable(
      NodePath.join(fixture.binDir, "vp"),
      `#!/usr/bin/env bash
set -euo pipefail
if [ "\${1:-}" = "install" ]; then
  touch node_modules/.modules.yaml
  exit 0
fi
echo "$*" >> "${prebuildLog}"
mkdir -p ios/T3CodeFork.xcworkspace ios/Pods
touch ios/Pods/Manifest.lock
`,
    );
    writeExecutable(
      NodePath.join(fixture.binDir, "xcodebuild"),
      `#!/usr/bin/env bash
set -euo pipefail
echo "XCODE_NOISE_LINE: compiling pods"
if [ -f "${xcodeFailFlag}" ]; then
  echo "XCODE_FATAL_ERROR: code sign failed" >&2
  exit 65
fi
app_dir="$FORK_STATE_DIR/ios-derived-data/Build/Products/Release-iphoneos/T3CodeFork.app"
mkdir -p "$app_dir"
cat >"$app_dir/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>2.3.0</string></dict></plist>
PLIST
`,
    );
    writeExecutable(NodePath.join(fixture.binDir, "node"), "#!/usr/bin/env bash\nexit 0\n");

    const buildEnv = { FORK_IOS_TEAM_ID: "TEAMTEST01" };
    const xcodeLogPath = NodePath.join(fixture.stateDir, "logs/ios-xcodebuild.log");

    // 1. Initial build runs prebuild and routes xcodebuild output to ios-xcodebuild.log.
    const first = runForkScript(fixture, "scripts/fork/build-ios.sh", ["--stage"], buildEnv);
    expect(first.exitCode).toBe(0);
    expect(readLines(prebuildLog)).toHaveLength(1);
    expect(first.output).not.toContain("XCODE_NOISE_LINE");
    expect(NodeFS.readFileSync(xcodeLogPath, "utf8")).toContain("XCODE_NOISE_LINE");

    // 2. Bumping desktop/server lockfile deps and patches reuses cached prebuild.
    writeLockfile({ audioVer: "58.0.11", effectVer: "4.1.4", serverVer: "1.5.0" });
    NodeFS.writeFileSync(serverPatch, "--- a/server.js\n+++ b/server.js\n+updated\n");
    const afterServerBump = runForkScript(
      fixture,
      "scripts/fork/build-ios.sh",
      ["--stage"],
      buildEnv,
    );
    expect(afterServerBump.exitCode).toBe(0);
    expect(afterServerBump.output).toContain("reusing cached prebuild");
    expect(readLines(prebuildLog)).toHaveLength(1);

    // 3. Bumping a pure-JS mobile dependency (effect) with installed store dir reuses cached prebuild.
    NodeFS.rmSync(effectStore4_1_4, { recursive: true, force: true });
    seedPnpmPkg("effect@4.1.5", "effect", { "package.json": '{"name":"effect"}\n' });
    writeMobilePkg("4.1.5");
    writeLockfile({ audioVer: "58.0.11", effectVer: "4.1.5", serverVer: "1.5.0" });
    const afterPureJsBump = runForkScript(
      fixture,
      "scripts/fork/build-ios.sh",
      ["--stage"],
      buildEnv,
    );
    expect(afterPureJsBump.exitCode).toBe(0);
    expect(afterPureJsBump.output).toContain("reusing cached prebuild");
    expect(readLines(prebuildLog)).toHaveLength(1);

    // 4. Bumping a native mobile dependency (with installed store marker) invalidates the cache.
    NodeFS.rmSync(audioStore58_11, { recursive: true, force: true });
    seedPnpmPkg("expo-audio@58.0.12", "expo-audio", { "expo-module.config.json": "{}\n" });
    writeLockfile({ audioVer: "58.0.12", effectVer: "4.1.5", serverVer: "1.5.0" });
    const afterNativeBump = runForkScript(
      fixture,
      "scripts/fork/build-ios.sh",
      ["--stage"],
      buildEnv,
    );
    expect(afterNativeBump.exitCode).toBe(0);
    expect(readLines(prebuildLog)).toHaveLength(2);

    // 5. Changing lockfile resolution/integrity without changing version invalidates the cache.
    writeLockfile({
      audioVer: "58.0.12",
      audioIntegrity: "sha512-bbb",
      effectVer: "4.1.5",
      serverVer: "1.5.0",
    });
    expect(
      runForkScript(fixture, "scripts/fork/build-ios.sh", ["--stage"], buildEnv).exitCode,
    ).toBe(0);
    expect(readLines(prebuildLog)).toHaveLength(3);

    // 6. Bumping a package with package.json expo.plugin invalidates the cache.
    NodeFS.rmSync(pluginStore1, { recursive: true, force: true });
    seedPnpmPkg("custom-expo-plugin@1.0.1", "custom-expo-plugin", {
      "package.json": JSON.stringify({ name: "custom-expo-plugin", expo: { plugin: "./plug.js" } }),
    });
    writeLockfile({
      audioVer: "58.0.12",
      audioIntegrity: "sha512-bbb",
      pluginVer: "1.0.1",
      effectVer: "4.1.5",
      serverVer: "1.5.0",
    });
    expect(
      runForkScript(fixture, "scripts/fork/build-ios.sh", ["--stage"], buildEnv).exitCode,
    ).toBe(0);
    expect(readLines(prebuildLog)).toHaveLength(4);

    // 6b. Bumping a marker-free transitive dependency of a config plugin also invalidates the cache.
    NodeFS.rmSync(helperStore1, { recursive: true, force: true });
    seedPnpmPkg("plist-helper@1.0.1", "plist-helper", {
      "package.json": '{"name":"plist-helper"}\n',
    });
    writeLockfile({
      audioVer: "58.0.12",
      audioIntegrity: "sha512-bbb",
      pluginVer: "1.0.1",
      helperVer: "1.0.1",
      effectVer: "4.1.5",
      serverVer: "1.5.0",
    });
    expect(
      runForkScript(fixture, "scripts/fork/build-ios.sh", ["--stage"], buildEnv).exitCode,
    ).toBe(0);
    expect(readLines(prebuildLog)).toHaveLength(5);

    // 7. Bumping a prebuild asset package referenced by app.config.ts (@expo-google-fonts/dm-sans) invalidates the cache.
    NodeFS.rmSync(fontStore1, { recursive: true, force: true });
    seedPnpmPkg("@expo-google-fonts+dm-sans@0.4.2", "@expo-google-fonts/dm-sans", {
      "package.json": '{"name":"@expo-google-fonts/dm-sans"}\n',
    });
    writeLockfile({
      audioVer: "58.0.12",
      audioIntegrity: "sha512-bbb",
      pluginVer: "1.0.1",
      helperVer: "1.0.1",
      fontVer: "0.4.2",
      effectVer: "4.1.5",
      serverVer: "1.5.0",
    });
    expect(
      runForkScript(fixture, "scripts/fork/build-ios.sh", ["--stage"], buildEnv).exitCode,
    ).toBe(0);
    expect(readLines(prebuildLog)).toHaveLength(6);

    // 8. Replacing a local file: native archive in place invalidates the cache.
    NodeFS.writeFileSync(localArchive, "archive-v2\n");
    expect(
      runForkScript(fixture, "scripts/fork/build-ios.sh", ["--stage"], buildEnv).exitCode,
    ).toBe(0);
    expect(readLines(prebuildLog)).toHaveLength(7);

    // 9. Editing a native mobile patch file invalidates the cache.
    NodeFS.writeFileSync(nativePatch, "--- a/ios/Audio.swift\n+++ b/ios/Audio.swift\n+fix\n");
    expect(
      runForkScript(fixture, "scripts/fork/build-ios.sh", ["--stage"], buildEnv).exitCode,
    ).toBe(0);
    expect(readLines(prebuildLog)).toHaveLength(8);

    // 10. Changing an app-config process env variable invalidates the cache.
    expect(
      runForkScript(fixture, "scripts/fork/build-ios.sh", ["--stage"], {
        ...buildEnv,
        T3CODE_MOBILE_VERSION: "2.4.0",
      }).exitCode,
    ).toBe(0);
    expect(readLines(prebuildLog)).toHaveLength(9);

    // 11. On xcodebuild failure, build-ios.sh exits non-zero and prints the tail from ios-xcodebuild.log.
    NodeFS.writeFileSync(xcodeFailFlag, "1\n");
    const failed = runForkScript(fixture, "scripts/fork/build-ios.sh", ["--stage"], buildEnv);
    expect(failed.exitCode).toBe(1);
    expect(failed.output).toContain("XCODE_FATAL_ERROR: code sign failed");
    expect(failed.output).toContain("ios-xcodebuild.log");
  });

  it("exits promptly from scheduled update.sh when update-ios.sh spawns a detached daemon holding stdout/stderr", () => {
    const fixture = createFixture({ realUpdateScript: true });
    const head = gitHead(fixture.repo);
    const daemonPidFile = NodePath.join(fixture.root, "daemon.pid");

    NodeFS.writeFileSync(NodePath.join(fixture.stateDir, "last-sync"), `${FIXED_NOW}\n`);
    NodeFS.writeFileSync(NodePath.join(fixture.stateDir, "build-failed"), `${head}\n`);

    // Simulate SWBBuildService: a detached session leader that inherits stdout/stderr and stays alive.
    writeExecutable(
      NodePath.join(fixture.repo, "scripts/fork/update-ios.sh"),
      `#!/usr/bin/env bash
set -euo pipefail
echo "update-ios: stub start"
perl -MPOSIX=setsid -e '
  my $pid = fork();
  die "fork: $!" unless defined $pid;
  if ($pid) {
    open my $fh, ">", $ARGV[0] or die $!;
    print $fh "$pid\\n";
    close $fh;
    exit 0;
  }
  setsid();
  sleep 60;
' "${daemonPidFile}"
echo "update-ios: stub done"
`,
    );

    try {
      const result = runForkScript(
        fixture,
        "scripts/fork/update.sh",
        ["--scheduled"],
        { TEST_NOW_HOUR: "14" },
        10_000,
      );
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("update-ios: stub start");
      expect(result.output).toContain("update-ios: stub done");
      // Proves update.sh returned while the detached daemon was still alive holding its FDs.
      const daemonPid = NodeFS.readFileSync(daemonPidFile, "utf8").trim();
      expect(daemonPid).toMatch(/^\d+$/);
      expect(NodeChildProcess.spawnSync("kill", ["-0", daemonPid]).status).toBe(0);
      expect(
        NodeFS.readdirSync(NodePath.join(fixture.stateDir, "logs")).filter((name) =>
          name.startsWith("update-ios-run."),
        ),
      ).toEqual([]);
    } finally {
      if (NodeFS.existsSync(daemonPidFile)) {
        const daemonPid = NodeFS.readFileSync(daemonPidFile, "utf8").trim();
        if (/^\d+$/.test(daemonPid)) {
          NodeChildProcess.spawnSync("kill", ["-TERM", daemonPid]);
        }
      }
    }
  });

  it("serializes sync-upstream.sh with lockf, keeps sync-worktree warm, and runs verify commands in parallel", async () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "fork-sync-upstream-test-"));
    tempRoots.push(root);
    const upstreamBare = NodePath.join(root, "upstream.git");
    const upstreamWork = NodePath.join(root, "upstream-work");
    const repo = NodePath.join(root, "repo");
    const stateDir = NodePath.join(root, "state");
    const binDir = NodePath.join(root, "bin");
    const barrierFifo = NodePath.join(root, "barrier.fifo");
    const parallelFlag = NodePath.join(root, "saw-parallel");
    const failVerifyFlag = NodePath.join(root, "fail-verify");
    const gitEnv = {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    };
    const git = (cwd: string, args: string[]) =>
      NodeChildProcess.execFileSync("git", args, { cwd, env: gitEnv, stdio: "pipe" })
        .toString()
        .trim();

    NodeFS.mkdirSync(upstreamBare, { recursive: true });
    NodeFS.mkdirSync(upstreamWork, { recursive: true });
    NodeFS.mkdirSync(stateDir, { recursive: true });
    NodeFS.mkdirSync(binDir, { recursive: true });
    NodeChildProcess.execFileSync("mkfifo", [barrierFifo], { stdio: "pipe" });

    git(upstreamBare, ["init", "--bare", "-b", "main"]);
    git(upstreamWork, ["init", "-b", "main"]);
    git(upstreamWork, ["remote", "add", "origin", upstreamBare]);
    NodeFS.mkdirSync(NodePath.join(upstreamWork, "apps/mobile"), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(upstreamWork, ".gitignore"), "node_modules/\n");
    NodeFS.writeFileSync(
      NodePath.join(upstreamWork, "apps/mobile/index.ts"),
      "export const v = 0;\n",
    );
    git(upstreamWork, ["add", "."]);
    git(upstreamWork, ["commit", "-m", "base"]);
    git(upstreamWork, ["push", "-u", "origin", "main"]);

    git(root, ["clone", upstreamBare, repo]);
    git(repo, ["remote", "rename", "origin", "upstream"]);
    git(repo, ["checkout", "-b", "pi-prompt-suggestions"]);
    NodeFS.mkdirSync(NodePath.join(repo, "scripts/fork"), { recursive: true });
    NodeFS.writeFileSync(
      NodePath.join(repo, "scripts/fork/config.sh"),
      NodeFS.readFileSync(CONFIG_SH, "utf8"),
    );
    writeExecutable(
      NodePath.join(repo, "scripts/fork/sync-upstream.sh"),
      NodeFS.readFileSync(SYNC_UPSTREAM_SH, "utf8"),
    );
    NodeFS.writeFileSync(NodePath.join(repo, "scripts/fork/owned-paths.txt"), "scripts/fork/\n");
    git(repo, ["add", "scripts/fork"]);
    git(repo, ["commit", "-m", "add fork scripts"]);

    // Stub vp: `vp i` seeds a gitignored marker; two verify commands rendezvous via a blocking FIFO (zero polling).
    writeExecutable(
      NodePath.join(binDir, "vp"),
      `#!/usr/bin/env bash
set -euo pipefail
if [ "\${1:-}" = "i" ]; then
  mkdir -p node_modules
  if [ ! -f node_modules/.warm-marker ]; then
    echo "seeded-on-first-run" > node_modules/.warm-marker
  fi
  exit 0
fi
if [ -f "${failVerifyFlag}" ]; then
  if [ "\${1:-}" = "run" ] && [ "\${2:-}" = "i18n:check" ]; then
    echo "I18N_CHECK_FAILED" >&2
    exit 1
  fi
  if [ "\${1:-}" = "test" ] && [ "\${2:-}" = "run" ] && [ "\${3:-}" = "--project" ] && [ "\${4:-}" = "react" ]; then
    echo "MOBILE_REACT_FAILED" >&2
    exit 1
  fi
  exit 0
fi
if [ "\${1:-}" = "run" ] && [ "\${2:-}" = "i18n:check" ]; then
  perl -e '
    $SIG{ALRM} = sub { die "FIFO_WRITE_TIMEOUT\\n" };
    alarm(5);
    open my $fh, ">", $ARGV[0] or die $!;
    print $fh "ready\\n";
    close $fh;
  ' "${barrierFifo}"
elif [ "\${1:-}" = "run" ] && [ "\${2:-}" = "--filter" ]; then
  perl -e '
    $SIG{ALRM} = sub { die "FIFO_READ_TIMEOUT\\n" };
    alarm(5);
    open my $fh, "<", $ARGV[0] or die $!;
    my $line = <$fh>;
    close $fh;
    die "EMPTY_FIFO\\n" unless defined $line && $line =~ /ready/;
  ' "${barrierFifo}"
  echo "rendezvous" > "${parallelFlag}"
fi
`,
    );
    NodeFS.writeFileSync(NodePath.join(root, "vp-env.sh"), `PATH="${binDir}:$PATH"\n`, "utf8");

    let tagTimestamp = FIXED_NOW;
    const pushTag = (version: string, content: string) => {
      tagTimestamp += 60;
      const tagEnv = { ...gitEnv, GIT_COMMITTER_DATE: `${tagTimestamp} +0000` };
      NodeFS.writeFileSync(NodePath.join(upstreamWork, "apps/mobile/index.ts"), content);
      NodeChildProcess.execFileSync("git", ["add", "apps/mobile/index.ts"], {
        cwd: upstreamWork,
        env: tagEnv,
        stdio: "pipe",
      });
      NodeChildProcess.execFileSync("git", ["commit", "-m", `release ${version}`], {
        cwd: upstreamWork,
        env: tagEnv,
        stdio: "pipe",
      });
      NodeChildProcess.execFileSync("git", ["tag", "-a", version, "-m", version], {
        cwd: upstreamWork,
        env: tagEnv,
        stdio: "pipe",
      });
      git(upstreamWork, ["push", "origin", "main", version]);
    };

    const runSync = () =>
      runForkScript(
        {
          root,
          repo,
          stateDir,
          binDir,
          buildLog: "",
          installLog: "",
          pushLog: "",
          iosUpdateLog: "",
        },
        "scripts/fork/sync-upstream.sh",
        ["--no-push", "--no-assist"],
      );

    // 0. Holding sync-upstream.lock prevents overlapping syncs from touching the shared worktree.
    await withFileLock(NodePath.join(stateDir, "sync-upstream.lock"), () => {
      const busy = runSync();
      expect(busy.exitCode).toBe(75);
      expect(busy.output).toContain("sync: another sync is already running");
    });

    // 1. First sync merges tag 1, leaves sync-worktree warm, and requires parallel verify execution.
    pushTag("v0.1.0-nightly.20261125.1001", "export const v = 1;\n");
    const first = runSync();
    expect(first.exitCode).toBe(0);
    expect(first.output).toContain("v0.1.0-nightly.20261125.1001");
    expect(NodeFS.existsSync(parallelFlag)).toBe(true);
    const warmMarker = NodePath.join(stateDir, "sync-worktree/node_modules/.warm-marker");
    expect(NodeFS.readFileSync(warmMarker, "utf8").trim()).toBe("seeded-on-first-run");

    // 2. Second sync reuses the warm worktree (keeping gitignored node_modules) while cleaning untracked junk.
    NodeFS.writeFileSync(warmMarker, "preserved-across-syncs\n");
    const junkFile = NodePath.join(stateDir, "sync-worktree/stale-untracked.txt");
    NodeFS.writeFileSync(junkFile, "junk\n");
    NodeFS.rmSync(parallelFlag, { force: true });
    pushTag("v0.1.0-nightly.20261125.1002", "export const v = 2;\n");
    const second = runSync();
    expect(second.exitCode).toBe(0);
    expect(second.output).toContain("v0.1.0-nightly.20261125.1002");
    expect(NodeFS.readFileSync(warmMarker, "utf8").trim()).toBe("preserved-across-syncs");
    expect(NodeFS.existsSync(junkFile)).toBe(false);
    expect(NodeFS.existsSync(parallelFlag)).toBe(true);

    // 3. When multiple parallel verify commands fail, sync exits 1, keeps branch untouched, and reports all failures.
    const headBeforeFailure = gitHead(repo);
    NodeFS.writeFileSync(failVerifyFlag, "1\n");
    pushTag("v0.1.0-nightly.20261125.1003", "export const v = 3;\n");
    const third = runSync();
    expect(third.exitCode).toBe(1);
    expect(gitHead(repo)).toBe(headBeforeFailure);
    const reportText = NodeFS.readFileSync(NodePath.join(stateDir, "sync-report.txt"), "utf8");
    expect(reportText).toContain("I18N_CHECK_FAILED");
    expect(reportText).toContain("MOBILE_REACT_FAILED");
  });

  it("keeps last-sync scoped to scheduled daily syncs and enforces the 04:00 and 20h gates", () => {
    const fixture = createFixture({ realUpdateScript: true });
    const syncLog = NodePath.join(fixture.root, "sync.log");
    const syncFailFlag = NodePath.join(fixture.root, "sync-fail");
    const lastSyncPath = NodePath.join(fixture.stateDir, "last-sync");

    writeExecutable(
      NodePath.join(fixture.repo, "scripts/fork/sync-upstream.sh"),
      `#!/usr/bin/env bash
set -euo pipefail
echo "\${TEST_NOW_EPOCH:-0}" >> "${syncLog}"
if [ -f "${syncFailFlag}" ]; then
  exit 1
fi
`,
    );

    const day1At0430 = FIXED_NOW;
    NodeFS.writeFileSync(lastSyncPath, `${day1At0430}\n`);

    // 1. Manual runs (plain and --restart) sync now without shifting last-sync.
    const manualCheck = runForkScript(fixture, "scripts/fork/update.sh", [], {
      TEST_NOW_EPOCH: String(day1At0430 + 10 * 3600),
      TEST_NOW_HOUR: "14",
    });
    expect(manualCheck.exitCode).toBe(0);
    expect(readLines(syncLog)).toEqual([String(day1At0430 + 10 * 3600)]);
    expect(NodeFS.readFileSync(lastSyncPath, "utf8").trim()).toBe(String(day1At0430));

    const manualRestart = runForkScript(fixture, "scripts/fork/update.sh", ["--restart"], {
      TEST_NOW_EPOCH: String(day1At0430 + 10 * 3600 + 60),
      TEST_NOW_HOUR: "14",
    });
    expect(manualRestart.exitCode).toBe(0);
    expect(readLines(syncLog)).toHaveLength(2);
    expect(NodeFS.readFileSync(lastSyncPath, "utf8").trim()).toBe(String(day1At0430));

    // 2. Scheduled run before 04:00 skips daily sync even when age >= 20h.
    const pre0400 = runForkScript(fixture, "scripts/fork/update.sh", ["--scheduled"], {
      TEST_NOW_EPOCH: String(day1At0430 + 23 * 3600),
      TEST_NOW_HOUR: "03",
    });
    expect(pre0400.exitCode).toBe(0);
    expect(readLines(syncLog)).toHaveLength(2);
    expect(NodeFS.readFileSync(lastSyncPath, "utf8").trim()).toBe(String(day1At0430));

    // 3. Scheduled run at 04:30 runs daily sync on time (unshifted by prior manual runs) and advances last-sync.
    const day2At0430 = day1At0430 + 24 * 3600;
    const day2Scheduled = runForkScript(fixture, "scripts/fork/update.sh", ["--scheduled"], {
      TEST_NOW_EPOCH: String(day2At0430),
      TEST_NOW_HOUR: "04",
    });
    expect(day2Scheduled.exitCode).toBe(0);
    expect(readLines(syncLog)).toHaveLength(3);
    expect(NodeFS.readFileSync(lastSyncPath, "utf8").trim()).toBe(String(day2At0430));

    // 4. Cooldown boundary: 19h59m59s skips; 20h00m00s (with leading-zero hour 08) runs and updates last-sync.
    const justUnder20h = runForkScript(fixture, "scripts/fork/update.sh", ["--scheduled"], {
      TEST_NOW_EPOCH: String(day2At0430 + 20 * 3600 - 1),
      TEST_NOW_HOUR: "08",
    });
    expect(justUnder20h.exitCode).toBe(0);
    expect(readLines(syncLog)).toHaveLength(3);
    expect(NodeFS.readFileSync(lastSyncPath, "utf8").trim()).toBe(String(day2At0430));

    const exact20h = day2At0430 + 20 * 3600;
    const at20h = runForkScript(fixture, "scripts/fork/update.sh", ["--scheduled"], {
      TEST_NOW_EPOCH: String(exact20h),
      TEST_NOW_HOUR: "08",
    });
    expect(at20h.exitCode).toBe(0);
    expect(readLines(syncLog)).toHaveLength(4);
    expect(NodeFS.readFileSync(lastSyncPath, "utf8").trim()).toBe(String(exact20h));

    // 5. Failed manual --restart sync exits 1 without Bark push or advancing last-sync;
    //    failed scheduled daily sync alerts once and stamps last-sync so the next hour does not re-alert.
    NodeFS.writeFileSync(syncFailFlag, "1\n");
    const manualFail = runForkScript(fixture, "scripts/fork/update.sh", ["--restart"], {
      TEST_NOW_EPOCH: String(exact20h + 3600),
      TEST_NOW_HOUR: "09",
    });
    expect(manualFail.exitCode).toBe(1);
    expect(readLines(syncLog)).toHaveLength(5);
    expect(NodeFS.readFileSync(lastSyncPath, "utf8").trim()).toBe(String(exact20h));
    expect(readLines(fixture.pushLog).filter((line) => line.includes("--event fehler"))).toEqual(
      [],
    );

    const day3FailedEpoch = exact20h + 20 * 3600;
    const scheduledFail = runForkScript(fixture, "scripts/fork/update.sh", ["--scheduled"], {
      TEST_NOW_EPOCH: String(day3FailedEpoch),
      TEST_NOW_HOUR: "04",
    });
    expect(scheduledFail.exitCode).toBe(1);
    expect(readLines(syncLog)).toHaveLength(6);
    expect(NodeFS.readFileSync(lastSyncPath, "utf8").trim()).toBe(String(day3FailedEpoch));
    expect(
      readLines(fixture.pushLog).filter((line) => line.includes("--event fehler")),
    ).toHaveLength(1);

    const scheduledAfterFail = runForkScript(fixture, "scripts/fork/update.sh", ["--scheduled"], {
      TEST_NOW_EPOCH: String(day3FailedEpoch + 3600),
      TEST_NOW_HOUR: "05",
    });
    expect(scheduledAfterFail.exitCode).toBe(0);
    expect(readLines(syncLog)).toHaveLength(6);
    expect(
      readLines(fixture.pushLog).filter((line) => line.includes("--event fehler")),
    ).toHaveLength(1);
  });
});
