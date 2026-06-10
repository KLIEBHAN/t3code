// Pure userData path resolution, shared between the synchronous early bootstrap
// in main.ts and the Effect-based DesktopEnvironment.
//
// Chromium child processes (notably the sandboxed network service helper on
// macOS) capture the userData path once at launch and bake it into their
// sandbox profile. If `app.setPath("userData", ...)` runs after such a helper
// has started, every disk cache file access is denied with EPERM and Chromium
// logs "Simple Cache Backend: wrong file structure on disk" / "Unable to
// create cache" on every start. The path therefore has to be resolved without
// the Effect runtime, synchronously during main module evaluation.

const trimNonEmpty = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
};

export interface ResolveAppDataDirectoryInput {
  readonly platform: NodeJS.Platform;
  readonly homeDirectory: string;
  /** $APPDATA, only relevant on win32. */
  readonly appDataDirectoryOverride?: string | undefined;
  /** $XDG_CONFIG_HOME, only relevant on linux. */
  readonly xdgConfigHome?: string | undefined;
  readonly join: (...segments: ReadonlyArray<string>) => string;
}

export const resolveAppDataDirectory = (input: ResolveAppDataDirectoryInput): string => {
  if (input.platform === "win32") {
    return (
      trimNonEmpty(input.appDataDirectoryOverride) ??
      input.join(input.homeDirectory, "AppData", "Roaming")
    );
  }
  if (input.platform === "darwin") {
    return input.join(input.homeDirectory, "Library", "Application Support");
  }
  return trimNonEmpty(input.xdgConfigHome) ?? input.join(input.homeDirectory, ".config");
};

export interface ResolveUserDataPathInput extends ResolveAppDataDirectoryInput {
  /** $VITE_DEV_SERVER_URL; a non-empty value selects the development identity. */
  readonly devServerUrl?: string | undefined;
  readonly exists: (path: string) => boolean;
}

// The legacy directory names are frozen: they predate the lowercase dir naming
// and must keep matching existing installations even if branding changes.
export const resolveUserDataPath = (input: ResolveUserDataPathInput): string => {
  const isDevelopment = trimNonEmpty(input.devServerUrl) !== undefined;
  const appDataDirectory = resolveAppDataDirectory(input);
  const legacyPath = input.join(
    appDataDirectory,
    isDevelopment ? "T3 Code (Dev)" : "T3 Code (Alpha)",
  );
  return input.exists(legacyPath)
    ? legacyPath
    : input.join(appDataDirectory, isDevelopment ? "t3code-dev" : "t3code");
};
