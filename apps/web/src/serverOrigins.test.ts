import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveServerHttpOrigin, resolveServerWsUrl } from "./serverOrigins";

const originalWindow = globalThis.window;

beforeEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        protocol: "https:",
        host: "example.com:8443",
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

  it("trims surrounding whitespace from an explicit URL", () => {
    expect(resolveServerWsUrl("  ws://custom-host:3020  ")).toBe("ws://custom-host:3020");
  });

  it("derives a secure default URL from the browser location", () => {
    expect(resolveServerWsUrl()).toBe("wss://example.com:8443");
  });

  it("omits the trailing colon when the browser location uses the default port", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: {
          protocol: "https:",
          host: "example.com",
          hostname: "example.com",
          port: "",
        },
        desktopBridge: undefined,
      },
    });

    expect(resolveServerWsUrl()).toBe("wss://example.com");
  });

  it("preserves bracketed IPv6 hosts from the browser location", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: {
          protocol: "http:",
          host: "[::1]:3020",
          hostname: "::1",
          port: "3020",
        },
        desktopBridge: undefined,
      },
    });

    expect(resolveServerWsUrl()).toBe("ws://[::1]:3020");
  });
});

describe("resolveServerHttpOrigin", () => {
  it("maps the resolved websocket URL back to its matching HTTP origin", () => {
    expect(resolveServerHttpOrigin()).toBe("https://example.com:8443");
  });
});
