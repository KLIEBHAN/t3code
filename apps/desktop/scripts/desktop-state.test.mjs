import { describe, expect, it, vi } from "vitest";

import {
  clearDesktopStateDir,
  resolveDesktopLaunchOptions,
  resolveDesktopStateDir,
} from "./desktop-state.mjs";

describe("resolveDesktopStateDir", () => {
  it("uses T3CODE_STATE_DIR when configured", () => {
    expect(resolveDesktopStateDir({ T3CODE_STATE_DIR: " /tmp/t3code-fresh " })).toBe(
      "/tmp/t3code-fresh",
    );
  });

  it("falls back to the default desktop state directory", () => {
    expect(resolveDesktopStateDir({})).toContain(".t3");
    expect(resolveDesktopStateDir({})).toContain("userdata");
  });
});

describe("resolveDesktopLaunchOptions", () => {
  it("treats --fresh as a desktop-only flag and forwards the remaining Electron args", () => {
    expect(resolveDesktopLaunchOptions({ argv: ["--fresh", "--inspect"] })).toMatchObject({
      freshRequested: true,
      forwardedElectronArgs: ["--inspect"],
    });
  });

  it("accepts the clear-cache alias for the same behavior", () => {
    expect(resolveDesktopLaunchOptions({ argv: ["--clear-cache"] }).freshRequested).toBe(true);
  });

  it("supports opting into a fresh start via environment variable", () => {
    expect(resolveDesktopLaunchOptions({ env: { T3CODE_DESKTOP_FRESH: "true" } })).toMatchObject({
      freshRequested: true,
      forwardedElectronArgs: [],
    });
  });
});

describe("clearDesktopStateDir", () => {
  it("removes the entire desktop state directory recursively", () => {
    const rmSync = vi.fn();

    clearDesktopStateDir("/tmp/t3code-desktop-state", { rmSync });

    expect(rmSync).toHaveBeenCalledWith("/tmp/t3code-desktop-state", {
      recursive: true,
      force: true,
      maxRetries: 3,
    });
  });
});
