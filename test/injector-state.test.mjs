import assert from "node:assert/strict";
import test from "node:test";

import { needsPreviewAttachment } from "../lib/injector-state.mjs";

test("a same-id renderer is reattached when a reload removed the preview runtime", async () => {
  const expressions = [];
  const client = {
    async evaluate(expression) {
      expressions.push(expression);
      return false;
    },
  };

  assert.equal(await needsPreviewAttachment({
    client,
    attachedTargetId: "renderer-1",
    nextTargetId: "renderer-1",
  }), true);
  assert.deepEqual(expressions, ["Boolean(window.__codexConversationPreviewInjection__)"]);
});

test("a healthy same-id renderer is not registered twice", async () => {
  const client = { evaluate: async () => true };

  assert.equal(await needsPreviewAttachment({
    client,
    attachedTargetId: "renderer-1",
    nextTargetId: "renderer-1",
  }), false);
});

test("a new renderer target always needs attachment", async () => {
  const client = { evaluate: async () => { throw new Error("should not evaluate the old target"); } };

  assert.equal(await needsPreviewAttachment({
    client,
    attachedTargetId: "renderer-1",
    nextTargetId: "renderer-2",
  }), true);
});
