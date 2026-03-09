import { WS_CHANNELS } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WsTransport } from "./wsTransport";

type WsEventType = "open" | "message" | "close" | "error";
type WsListener = (event?: { data?: unknown }) => void;

const sockets: MockWebSocket[] = [];

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  readonly sent: string[] = [];
  private readonly listeners = new Map<WsEventType, Set<WsListener>>();

  constructor(_url: string) {
    sockets.push(this);
  }

  addEventListener(type: WsEventType, listener: WsListener) {
    const listeners = this.listeners.get(type) ?? new Set<WsListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.emit("close");
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.emit("open");
  }

  serverMessage(data: unknown) {
    this.emit("message", { data });
  }

  fail() {
    this.emit("error");
  }

  private emit(type: WsEventType, event?: { data?: unknown }) {
    const listeners = this.listeners.get(type);
    if (!listeners) return;
    for (const listener of listeners) {
      listener(event);
    }
  }
}

const originalWebSocket = globalThis.WebSocket;

function getSocket(): MockWebSocket {
  const socket = sockets.at(-1);
  if (!socket) {
    throw new Error("Expected a websocket instance");
  }
  return socket;
}

beforeEach(() => {
  sockets.length = 0;

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: { hostname: "localhost", port: "3020" },
      desktopBridge: undefined,
    },
  });

  globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
});

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("WsTransport", () => {
  it("queues requests until the socket opens without starting per-request polling timers", async () => {
    const intervalSpy = vi.spyOn(globalThis, "setInterval");
    const transport = new WsTransport("ws://localhost:3020");
    const socket = getSocket();

    const firstRequest = transport.request("projects.list");
    const secondRequest = transport.request("server.config");

    expect(socket.sent).toEqual([]);
    expect(intervalSpy).not.toHaveBeenCalled();

    socket.open();

    expect(socket.sent).toHaveLength(2);

    const firstEnvelope = JSON.parse(socket.sent[0] ?? "") as { id: string };
    const secondEnvelope = JSON.parse(socket.sent[1] ?? "") as { id: string };

    socket.serverMessage(
      JSON.stringify({
        id: firstEnvelope.id,
        result: { projects: [] },
      }),
    );
    socket.serverMessage(
      JSON.stringify({
        id: secondEnvelope.id,
        result: { ok: true },
      }),
    );

    await expect(firstRequest).resolves.toEqual({ projects: [] });
    await expect(secondRequest).resolves.toEqual({ ok: true });

    transport.dispose();
  });

  it("routes valid push envelopes to channel listeners", () => {
    const transport = new WsTransport("ws://localhost:3020");
    const socket = getSocket();
    socket.open();

    const listener = vi.fn();
    transport.subscribe(WS_CHANNELS.serverConfigUpdated, listener);

    socket.serverMessage(
      JSON.stringify({
        type: "push",
        sequence: 1,
        channel: WS_CHANNELS.serverConfigUpdated,
        data: { issues: [], providers: [] },
      }),
    );

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      type: "push",
      sequence: 1,
      channel: WS_CHANNELS.serverConfigUpdated,
      data: { issues: [], providers: [] },
    });

    transport.dispose();
  });

  it("resolves pending requests for valid response envelopes", async () => {
    const transport = new WsTransport("ws://localhost:3020");
    const socket = getSocket();
    socket.open();

    const requestPromise = transport.request("projects.list");
    const sent = socket.sent.at(-1);
    if (!sent) {
      throw new Error("Expected request envelope to be sent");
    }

    const requestEnvelope = JSON.parse(sent) as { id: string };
    socket.serverMessage(
      JSON.stringify({
        id: requestEnvelope.id,
        result: { projects: [] },
      }),
    );

    await expect(requestPromise).resolves.toEqual({ projects: [] });

    transport.dispose();
  });

  it("drops malformed envelopes without crashing transport", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const transport = new WsTransport("ws://localhost:3020");
    const socket = getSocket();
    socket.open();

    const listener = vi.fn();
    transport.subscribe(WS_CHANNELS.serverConfigUpdated, listener);

    socket.serverMessage("{ invalid-json");
    socket.serverMessage(
      JSON.stringify({
        type: "push",
        sequence: 2,
        channel: 42,
        data: { bad: true },
      }),
    );
    socket.serverMessage(
      JSON.stringify({
        type: "push",
        sequence: 3,
        channel: WS_CHANNELS.serverConfigUpdated,
        data: { issues: [], providers: [] },
      }),
    );

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      type: "push",
      sequence: 3,
      channel: WS_CHANNELS.serverConfigUpdated,
      data: { issues: [], providers: [] },
    });
    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenNthCalledWith(
      1,
      "Dropped inbound WebSocket envelope",
      "SyntaxError: Expected property name or '}' in JSON at position 2 (line 1 column 3)",
    );
    expect(warnSpy).toHaveBeenNthCalledWith(
      2,
      "Dropped inbound WebSocket envelope",
      expect.stringContaining('Expected "server.configUpdated"'),
    );

    transport.dispose();
  });

  it("queues requests until the websocket opens", async () => {
    const transport = new WsTransport("ws://localhost:3020");
    const socket = getSocket();

    const requestPromise = transport.request("projects.list");
    expect(socket.sent).toHaveLength(0);

    socket.open();
    expect(socket.sent).toHaveLength(1);
    const requestEnvelope = JSON.parse(socket.sent[0] ?? "{}") as { id: string };
    socket.serverMessage(
      JSON.stringify({
        id: requestEnvelope.id,
        result: { projects: [] },
      }),
    );

    await expect(requestPromise).resolves.toEqual({ projects: [] });
    transport.dispose();
  });

  it("rejects queued requests when the transport is disposed before connect", async () => {
    const transport = new WsTransport("ws://localhost:3020");

    const requestPromise = transport.request("projects.list");

    transport.dispose();

    await expect(requestPromise).rejects.toThrow("Transport disposed");
  });

  it("reconnects after a tracked socket closes and flushes queued requests once the replacement opens", async () => {
    vi.useFakeTimers();
    const transport = new WsTransport("ws://localhost:3020");
    const firstSocket = getSocket();
    firstSocket.open();
    firstSocket.close();

    await vi.advanceTimersByTimeAsync(500);

    const replacementSocket = getSocket();
    expect(replacementSocket).not.toBe(firstSocket);

    const requestPromise = transport.request("projects.list");
    expect(replacementSocket.sent).toEqual([]);

    replacementSocket.open();
    expect(replacementSocket.sent).toHaveLength(1);

    const requestEnvelope = JSON.parse(replacementSocket.sent[0] ?? "") as { id: string };
    replacementSocket.serverMessage(
      JSON.stringify({
        id: requestEnvelope.id,
        result: { projects: [] },
      }),
    );

    await expect(requestPromise).resolves.toEqual({ projects: [] });
    transport.dispose();
  });

  it("ignores late close events from stale sockets after a newer socket is already open", async () => {
    vi.useFakeTimers();
    const transport = new WsTransport("ws://localhost:3020");
    const firstSocket = getSocket();

    firstSocket.close();
    await vi.advanceTimersByTimeAsync(500);

    const secondSocket = getSocket();
    secondSocket.open();
    firstSocket.fail();
    firstSocket.close();

    await vi.advanceTimersByTimeAsync(8_000);

    expect(sockets).toHaveLength(2);
    transport.dispose();
  });

  it("does not flush queued requests if a socket opens after dispose", async () => {
    const transport = new WsTransport("ws://localhost:3020");
    const socket = getSocket();

    void transport.request("projects.list").catch(() => undefined);
    transport.dispose();
    socket.open();

    expect(socket.sent).toEqual([]);
  });
});
