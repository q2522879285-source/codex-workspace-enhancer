import assert from "node:assert/strict";
import test from "node:test";

import { needsPreviewAttachment } from "../lib/injector-state.mjs";

test("a same-id renderer is reattached when either runtime or style is missing", async () => {
  for (const [runtime, style, expected] of [[false, false, true], [false, true, true], [true, false, true], [true, true, false]]) {
    let evaluations = 0;
    const client = { async evaluate(expression) {
      evaluations += 1;
      return new Function("window", "document", `return ${expression}`)(
        { __codexConversationPreviewInjection__: runtime },
        { getElementById(id) {
          assert.equal(id, "codex-conversation-preview-style");
          return style ? {} : null;
        } },
      );
    } };
    assert.equal(await needsPreviewAttachment({ client, attachedTargetId: "renderer-1", nextTargetId: "renderer-1" }), expected);
    assert.equal(evaluations, 1);
  }
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
