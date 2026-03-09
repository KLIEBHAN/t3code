function readNonEmptyString(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

export function resolveServerWsUrl(explicitUrl?: string): string {
  const normalizedExplicitUrl = readNonEmptyString(explicitUrl);
  if (normalizedExplicitUrl) {
    return normalizedExplicitUrl;
  }

  const bridgeUrl =
    typeof window !== "undefined" ? readNonEmptyString(window.desktopBridge?.getWsUrl()) : undefined;
  if (bridgeUrl) {
    return bridgeUrl;
  }

  const envUrl = readNonEmptyString(import.meta.env.VITE_WS_URL as string | undefined);
  if (envUrl) {
    return envUrl;
  }

  if (typeof window === "undefined") {
    return "ws://localhost";
  }

  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const host = readNonEmptyString(window.location.host);
  const fallbackHost = readNonEmptyString(window.location.hostname);
  return `${protocol}://${host || fallbackHost || "localhost"}`;
}

export function resolveServerHttpOrigin(explicitUrl?: string): string {
  const wsUrl = resolveServerWsUrl(explicitUrl);
  const httpUrl = wsUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:");

  try {
    return new URL(httpUrl).origin;
  } catch {
    return httpUrl;
  }
}
