import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveServerHttpOrigin, resolveServerWsUrl } from "./serverOrigins";

const originalWindow = globalThis.window;

beforeEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        protocol: "https:",
        hostname: "example.com",
        port: "8443",
      },
      desktopBridge: undefined,
    },
  });
});

afterEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: originalWindow,
  });
});

describe("resolveServerWsUrl", () => {
  it("prefers an explicit URL", () => {
    expect(resolveServerWsUrl("ws://custom-host:3020")).toBe("ws://custom-host:3020");
  });

  it("derives a secure default URL from the browser location", () => {
    expect(resolveServerWsUrl()).toBe("wss://example.com:8443");
  });
});

describe("resolveServerHttpOrigin", () => {
  it("maps the resolved websocket URL back to its matching HTTP origin", () => {
    expect(resolveServerHttpOrigin()).toBe("https://example.com:8443");
  });
});
