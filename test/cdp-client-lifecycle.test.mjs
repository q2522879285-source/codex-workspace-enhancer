import assert from "node:assert/strict";
import { createServer as createTcpServer } from "node:net";
import test from "node:test";

import { WebSocketServer } from "ws";

import { CdpClient } from "../scripts/cdp-client.mjs";

test("client uses the Node runtime WebSocket so installed users need no private module path", async () => {
  const NativeWebSocket = globalThis.WebSocket;
  let openedUrl = null;
  class TestWebSocket extends EventTarget {
    static OPEN = 1;
    readyState = 0;

    constructor(url) {
      super();
      openedUrl = url;
      queueMicrotask(() => {
        this.readyState = TestWebSocket.OPEN;
        this.dispatchEvent(new Event("open"));
      });
    }

    send() {}

    close() {
      this.readyState = 3;
      this.dispatchEvent(new Event("close"));
    }
  }

  globalThis.WebSocket = TestWebSocket;
  const client = new CdpClient("ws://127.0.0.1:65534");
  try {
    await client.connect();
    assert.equal(openedUrl, "ws://127.0.0.1:65534");
  } finally {
    client.close();
    globalThis.WebSocket = NativeWebSocket;
  }
});

test("flat CDP sessions are forwarded in commands and event metadata", async () => {
  const NativeWebSocket = globalThis.WebSocket;
  let sent = null;
  let eventSession = null;
  class TestWebSocket extends EventTarget {
    readyState = 0;
    constructor() {
      super();
      queueMicrotask(() => {
        this.readyState = 1;
        this.dispatchEvent(new Event("open"));
      });
    }
    send(serialized) {
      sent = JSON.parse(serialized);
      queueMicrotask(() => {
        this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ id: sent.id, result: { ok: true }, sessionId: sent.sessionId }) }));
        this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ method: "Fetch.requestPaused", params: { requestId: "1" }, sessionId: "child-1" }) }));
      });
    }
    close() { this.readyState = 3; this.dispatchEvent(new Event("close")); }
  }
  globalThis.WebSocket = TestWebSocket;
  const client = new CdpClient("ws://test");
  try {
    await client.connect();
    client.on("Fetch.requestPaused", (_event, meta) => { eventSession = meta.sessionId; });
    assert.deepEqual(await client.send("Fetch.enable", {}, "child-1"), { ok: true });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(sent.sessionId, "child-1");
    assert.equal(eventSession, "child-1");
  } finally {
    client.close();
    globalThis.WebSocket = NativeWebSocket;
  }
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

function rejectAfter(milliseconds, label) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`${label} remained pending`)), milliseconds).unref();
  });
}

test("connect rejects when the WebSocket handshake stalls", async () => {
  const sockets = new Set();
  const server = createTcpServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  const port = await listen(server);
  const client = new CdpClient(`ws://127.0.0.1:${port}`, { connectTimeoutMs: 40 });

  try {
    await assert.rejects(
      Promise.race([client.connect(), rejectAfter(250, "CDP connection")]),
      /CDP connection timed out after 40ms/,
    );
  } finally {
    client.close();
    for (const socket of sockets) socket.destroy();
    await closeServer(server);
  }
});

test("an unanswered CDP request rejects instead of keeping the injector suspended", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  server.on("connection", (socket) => socket.on("message", () => {}));
  const port = server.address().port;
  const client = new CdpClient(`ws://127.0.0.1:${port}`, { requestTimeoutMs: 40 });

  try {
    await client.connect();
    await assert.rejects(
      Promise.race([client.evaluate("1 + 1"), rejectAfter(250, "CDP request")]),
      /CDP Runtime\.evaluate timed out after 40ms/,
    );
  } finally {
    client.close();
    for (const socket of server.clients) socket.terminate();
    await closeServer(server);
  }
});

test("a renderer disconnect rejects every in-flight request", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  server.on("connection", (socket) => {
    socket.once("message", () => socket.terminate());
  });
  const port = server.address().port;
  const client = new CdpClient(`ws://127.0.0.1:${port}`, { requestTimeoutMs: 500 });

  try {
    await client.connect();
    await assert.rejects(client.evaluate("1 + 1"), /CDP connection closed/);
  } finally {
    client.close();
    for (const socket of server.clients) socket.terminate();
    await closeServer(server);
  }
});
