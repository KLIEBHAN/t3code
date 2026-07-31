// @effect-diagnostics nodeBuiltinImport:off -- exercises the injected platform-specific join implementations.
import { assert, describe, it } from "@effect/vitest";
import * as NodePath from "node:path";

import * as DesktopUserData from "./DesktopUserData.ts";

const darwinInput = {
  platform: "darwin",
  homeDirectory: "/Users/alice",
  join: NodePath.posix.join,
} as const;

describe("DesktopUserData", () => {
  describe("resolveAppDataDirectory", () => {
    it("uses the APPDATA override on win32 and falls back to Roaming", () => {
      const base = {
        platform: "win32",
        homeDirectory: "C:\\Users\\alice",
        join: NodePath.win32.join,
      } as const;

      assert.equal(
        DesktopUserData.resolveAppDataDirectory({
          ...base,
          appDataDirectoryOverride: "D:\\AppData",
        }),
        "D:\\AppData",
      );
      assert.equal(
        DesktopUserData.resolveAppDataDirectory({ ...base, appDataDirectoryOverride: " " }),
        "C:\\Users\\alice\\AppData\\Roaming",
      );
    });

    it("uses XDG_CONFIG_HOME on linux and falls back to ~/.config", () => {
      const base = {
        platform: "linux",
        homeDirectory: "/home/alice",
        join: NodePath.posix.join,
      } as const;

      assert.equal(
        DesktopUserData.resolveAppDataDirectory({ ...base, xdgConfigHome: "/home/alice/cfg" }),
        "/home/alice/cfg",
      );
      assert.equal(DesktopUserData.resolveAppDataDirectory(base), "/home/alice/.config");
    });
  });

  describe("resolveUserDataPath", () => {
    it("keeps using the legacy userData path when it already exists", () => {
      const userDataPath = DesktopUserData.resolveUserDataPath({
        ...darwinInput,
        stat: (path) => (path.endsWith("T3 Code (Alpha)") ? {} : undefined),
      });

      assert.equal(userDataPath, "/Users/alice/Library/Application Support/T3 Code (Alpha)");
    });

    it("uses the current directory name when no legacy path exists", () => {
      const userDataPath = DesktopUserData.resolveUserDataPath({
        ...darwinInput,
        stat: () => undefined,
      });

      assert.equal(userDataPath, "/Users/alice/Library/Application Support/t3code");
    });

    it("uses the development identity when a dev server url is configured", () => {
      const legacy = DesktopUserData.resolveUserDataPath({
        ...darwinInput,
        devServerUrl: "http://localhost:5173",
        stat: (path) => (path.endsWith("T3 Code (Dev)") ? {} : undefined),
      });
      const current = DesktopUserData.resolveUserDataPath({
        ...darwinInput,
        devServerUrl: "http://localhost:5173",
        stat: () => undefined,
      });

      assert.equal(legacy, "/Users/alice/Library/Application Support/T3 Code (Dev)");
      assert.equal(current, "/Users/alice/Library/Application Support/t3code-dev");
    });

    it("preserves failures while inspecting the legacy userData path", () => {
      const cause = Object.assign(new Error("permission denied"), { code: "EACCES" });

      try {
        DesktopUserData.resolveUserDataPath({
          ...darwinInput,
          stat: () => {
            throw cause;
          },
        });
        assert.fail("Expected the legacy userData path probe to fail");
      } catch (error) {
        assert.strictEqual(error, cause);
      }
    });
  });
});
