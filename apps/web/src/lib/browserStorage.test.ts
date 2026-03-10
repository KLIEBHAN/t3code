import { afterEach, describe, expect, it, vi } from "vitest";

import { getSafeLocalStorage } from "./browserStorage";

describe("getSafeLocalStorage", () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");

  afterEach(() => {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, "localStorage", originalDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "localStorage");
    }

    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, "window", originalWindowDescriptor);
      return;
    }

    Reflect.deleteProperty(globalThis, "window");
  });

  it("falls back to an in-memory storage when reading localStorage throws", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });

    const storage = getSafeLocalStorage();
    storage.setItem("key", "value");

    expect(storage.getItem("key")).toBe("value");
  });

  it("guards storage methods when the native storage object throws", () => {
    const storageLike: Storage = {
      get length(): number {
        throw new Error("blocked");
      },
      clear: vi.fn(() => {
        throw new Error("blocked");
      }),
      getItem: vi.fn(() => {
        throw new Error("blocked");
      }),
      key: vi.fn(() => {
        throw new Error("blocked");
      }),
      removeItem: vi.fn(() => {
        throw new Error("blocked");
      }),
      setItem: vi.fn(() => {
        throw new Error("blocked");
      }),
    };

    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: storageLike,
    });

    const storage = getSafeLocalStorage();

    expect(storage.length).toBe(0);
    expect(storage.getItem("key")).toBeNull();
    expect(storage.key(0)).toBeNull();
    expect(() => storage.setItem("key", "value")).not.toThrow();
    expect(() => storage.removeItem("key")).not.toThrow();
    expect(() => storage.clear()).not.toThrow();
  });

  it("reuses the fallback storage across browser calls when native storage is unavailable", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: globalThis,
    });
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });

    const first = getSafeLocalStorage();
    const second = getSafeLocalStorage();

    first.setItem("shared", "value");

    expect(second.getItem("shared")).toBe("value");
  });
});
