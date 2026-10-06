import assert from "node:assert/strict";
import test from "node:test";

import { needsPreviewAttachment } from "../lib/injector-state.mjs";

function clientWithRuntimeState({ sentinel, style }) {
  return {
    async evaluate(source) {
      assert.match(source, /__codexConversationPreviewInjection__/);
      assert.match(source, /codex-conversation-preview-style/);
      return Boolean(sentinel && style);
    },
  };
}

test("reattaches when a destroyed runtime leaves only its sentinel", async () => {
  const client = clientWithRuntimeState({ sentinel: true, style: false });
  assert.equal(await needsPreviewAttachment({
    client,
    attachedTargetId: "renderer-1",
    nextTargetId: "renderer-1",
  }), true);
});

test("keeps a healthy runtime attached", async () => {
  const client = clientWithRuntimeState({ sentinel: true, style: true });
  assert.equal(await needsPreviewAttachment({
    client,
    attachedTargetId: "renderer-1",
    nextTargetId: "renderer-1",
  }), false);
});
