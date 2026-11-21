// Fork: behavioral tests for scripts/fork/update-ios.sh scheduling, renewal, install, and warnings.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

const REPO_ROOT = NodePath.resolve(import.meta.dirname, "../..");
const CONFIG_SH = NodePath.join(REPO_ROOT, "scripts/fork/config.sh");
const UPDATE_IOS_SH = NodePath.join(REPO_ROOT, "scripts/fork/update-ios.sh");
const FIXED_NOW = 1_800_000_000;

interface Fixture {
  readonly root: string;
  readonly repo: string;
  readonly stateDir: string;
  readonly binDir: string;
  readonly buildLog: string;
  readonly installLog: string;
  readonly pushLog: string;
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
    readonly buildShouldFail?: boolean;
    readonly installShouldFail?: boolean;
    readonly renewedExpires?: number;
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

  NodeFS.mkdirSync(NodePath.join(repo, "scripts/fork"), { recursive: true });
  NodeFS.mkdirSync(NodePath.join(repo, "apps/mobile"), { recursive: true });
  NodeFS.mkdirSync(NodePath.join(repo, "apps/web"), { recursive: true });
  NodeFS.mkdirSync(NodePath.join(stateDir, "push/bark/scripts"), { recursive: true });
  NodeFS.mkdirSync(binDir, { recursive: true });

  // Copy the real config.sh and update-ios.sh under test into the scratch git repo.
  NodeFS.writeFileSync(
    NodePath.join(repo, "scripts/fork/config.sh"),
    NodeFS.readFileSync(CONFIG_SH, "utf8"),
  );
  writeExecutable(
    NodePath.join(repo, "scripts/fork/update-ios.sh"),
    NodeFS.readFileSync(UPDATE_IOS_SH, "utf8"),
  );

  // Stub build-ios.sh: records invocations and stages a synthetic bundle + meta.env.
  const renewedExpires = options.renewedExpires ?? FIXED_NOW + 7 * 86_400;
  writeExecutable(
    NodePath.join(repo, "scripts/fork/build-ios.sh"),
    `#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "${buildLog}"
${options.buildShouldFail ? "exit 1" : ""}
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

  // Stub deterministic date, pod, and xcrun (devicectl list/install) on PATH.
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
  writeExecutable(
    NodePath.join(binDir, "xcrun"),
    `#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = "devicectl" ] && [ "$2" = "list" ]; then
  cat <<'JSON'
{"result":{"devices":[{"hardwareProperties":{"reality":"physical","udid":"UDID-TEST-1"},"deviceProperties":{"name":"Test iPhone"},"connectionProperties":{"pairingState":"paired","transportType":"localNetwork"}}]}}
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

  return { root, repo, stateDir, binDir, buildLog, installLog, pushLog };
}

function runUpdateIos(
  fixture: Fixture,
  args: string[],
  extraEnv: Record<string, string> = {},
): { readonly exitCode: number; readonly output: string } {
  try {
    const output = NodeChildProcess.execFileSync("bash", ["scripts/fork/update-ios.sh", ...args], {
      cwd: fixture.repo,
      env: {
        ...process.env,
        PATH: `${fixture.binDir}:/usr/bin:/bin:/usr/sbin:/sbin`,
        VP_ENV: NodePath.join(fixture.root, "vp-env.sh"),
        FORK_STATE_DIR: fixture.stateDir,
        FORK_BUILD_HOST: "",
        FORK_IOS_DEVICE: "",
        FORK_IOS_AUTO_UPDATE: "1",
        ...extraEnv,
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
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
  NodeFS.writeFileSync(NodePath.join(repo, relPath), content, "utf8");
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

describe("scripts/fork/update-ios.sh", () => {
  it("skips rebuilds for non-iOS changes, stages mobile changes, and waits for night window", () => {
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

    // A mobile commit triggers --stage, but scheduled daytime defers install to night window.
    const mobileHead = commitChange(fixture.repo, "apps/mobile/index.ts", "export const v = 2;\n");
    const daytimeResult = runUpdateIos(fixture, ["--scheduled"], { TEST_NOW_HOUR: "14" });
    expect(daytimeResult.exitCode).toBe(0);
    expect(readLines(fixture.buildLog)).toEqual(["--stage"]);
    expect(readLines(fixture.installLog)).toEqual([]);

    // Inside the 02:00-06:00 night window, the staged bundle installs wirelessly and notifies once.
    const nightResult = runUpdateIos(fixture, ["--scheduled"], { TEST_NOW_HOUR: "03" });
    expect(nightResult.exitCode).toBe(0);
    expect(readLines(fixture.buildLog)).toEqual(["--stage"]);
    expect(readLines(fixture.installLog)).toHaveLength(1);
    expect(
      NodeFS.readFileSync(NodePath.join(fixture.stateDir, "ios-installed.env"), "utf8"),
    ).toContain(`commit=${mobileHead}`);
    expect(readLines(fixture.pushLog).some((line) => line.includes("--event info"))).toBe(true);
  });

  it("renews expiring profiles with --renew-profile and warns once when unreachable", () => {
    const fixture = createFixture({
      installShouldFail: true,
      renewedExpires: FIXED_NOW + 7 * 86_400,
    });
    const head = gitHead(fixture.repo);

    // 20 hours left: triggers renewal (<= 48h), emergency install (<= 24h), and warning (<= 36h).
    NodeFS.writeFileSync(
      NodePath.join(fixture.stateDir, "ios-installed.env"),
      `device=UDID-TEST-1\ncommit=${head}\nprofile_expires=${FIXED_NOW + 20 * 3600}\n`,
    );

    const first = runUpdateIos(fixture, ["--scheduled"], { TEST_NOW_HOUR: "14" });
    expect(first.exitCode).toBe(0);
    expect(readLines(fixture.buildLog)).toEqual(["--stage --renew-profile"]);
    // Emergency install attempted even outside night window; unreachable device does not fail run.
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
    const fixture = createFixture({ buildShouldFail: true });

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
});
