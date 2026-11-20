// Fork: verifies Personal Team iOS builds omit restricted capabilities and honor fork overrides.
import { afterEach, expect, it, vi } from "vite-plus/test";
import { BRAND_ASSET_PATHS } from "../../scripts/lib/brand-assets.ts";

vi.mock("../../scripts/lib/public-config.ts", () => ({
  loadRepoEnv: () => ({ ...process.env }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

it("applies Personal Team bundle id, team id, name, scheme, and strips restricted entitlements", async () => {
  vi.resetModules();
  vi.stubEnv("APP_VARIANT", "production");
  vi.stubEnv("T3CODE_IOS_PERSONAL_TEAM", "1");
  vi.stubEnv("T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID", "com.kliebhan.t3code-fork");
  vi.stubEnv("T3CODE_IOS_TEAM_ID", "Q8MH2BGE2S");
  vi.stubEnv("T3CODE_MOBILE_APP_NAME", "T3 Code (Fork)");
  vi.stubEnv("T3CODE_MOBILE_SCHEME", "t3code-fork");
  vi.stubEnv("T3CODE_MOBILE_UPDATES_ENABLED", "0");

  const config = (await import("./app.config.ts")).default;
  expect(config.name).toBe("T3 Code (Fork)");
  expect(config.scheme).toBe("t3code-fork");
  expect(config.icon).toBe(`../../${BRAND_ASSET_PATHS.developmentIosIconPng}`);
  expect(config.updates?.enabled).toBe(false);
  expect(config.ios?.bundleIdentifier).toBe("com.kliebhan.t3code-fork");
  expect(config.ios?.appleTeamId).toBe("Q8MH2BGE2S");
  expect(config.ios?.associatedDomains).toBeUndefined();
  expect(config.ios?.entitlements?.["keychain-access-groups"]).toEqual([
    "$(AppIdentifierPrefix)com.kliebhan.t3code-fork",
  ]);
});
