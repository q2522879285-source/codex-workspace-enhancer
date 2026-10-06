import assert from "node:assert/strict";
import { selectMainCodexTarget } from "../scripts/cdp-client.mjs";

const current = {
  id: "current",
  type: "page",
  title: "ChatGPT",
  url: "app://-/index.html",
  webSocketDebuggerUrl: "ws://127.0.0.1/current",
};

assert.equal(selectMainCodexTarget([current])?.id, "current");
assert.equal(selectMainCodexTarget([{ ...current, url: "https://chatgpt.com" }]), undefined);
console.log("cdp target selection: ok");
