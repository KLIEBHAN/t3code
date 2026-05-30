function createMemoryStorage(): Storage {
  const entries = new Map<string, string>();

  return {
    get length() {
      return entries.size;
    },
    clear() {
      entries.clear();
    },
    getItem(key) {
      return entries.get(key) ?? null;
    },
    key(index) {
      return Array.from(entries.keys())[index] ?? null;
    },
    removeItem(key) {
      entries.delete(key);
    },
    setItem(key, value) {
      entries.set(key, String(value));
    },
  };
}

let browserMemoryStorage: Storage | null = null;

function getFallbackStorage(): Storage {
  if (typeof window === "undefined") {
    return createMemoryStorage();
  }

  browserMemoryStorage ??= createMemoryStorage();
  return browserMemoryStorage;
}

function isStorageLike(value: unknown): value is Storage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<Storage>;

  return (
    typeof candidate.getItem === "function" &&
    typeof candidate.setItem === "function" &&
    typeof candidate.removeItem === "function" &&
    typeof candidate.clear === "function" &&
    typeof candidate.key === "function"
  );
}

export function getSafeLocalStorage(): Storage {
  const candidate = (() => {
    try {
      return globalThis.localStorage;
    } catch {
      return undefined;
    }
  })();

  if (isStorageLike(candidate)) {
    return {
      get length() {
        try {
          return candidate.length;
        } catch {
          return 0;
        }
      },
      clear() {
        try {
          candidate.clear();
        } catch {
          // Ignore storage clear failures.
        }
      },
      getItem(key) {
        try {
          return candidate.getItem(key);
        } catch {
          return null;
        }
      },
      key(index) {
        try {
          return candidate.key(index);
        } catch {
          return null;
        }
      },
      removeItem(key) {
        try {
          candidate.removeItem(key);
        } catch {
          // Ignore storage remove failures.
        }
      },
      setItem(key, value) {
        try {
          candidate.setItem(key, value);
        } catch {
          // Ignore storage write failures.
        }
      },
    };
  }

  return getFallbackStorage();
}
