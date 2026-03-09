export function resolveServerWsUrl(explicitUrl?: string): string {
  if (explicitUrl && explicitUrl.length > 0) {
    return explicitUrl;
  }

  const bridgeUrl = typeof window !== "undefined" ? window.desktopBridge?.getWsUrl() : undefined;
  if (bridgeUrl && bridgeUrl.length > 0) {
    return bridgeUrl;
  }

  const envUrl = import.meta.env.VITE_WS_URL as string | undefined;
  if (envUrl && envUrl.length > 0) {
    return envUrl;
  }

  if (typeof window === "undefined") {
    return "ws://localhost";
  }

  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const host = window.location.host.trim();
  const fallbackHost = window.location.hostname.trim();
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
