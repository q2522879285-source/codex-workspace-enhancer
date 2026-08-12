#!/usr/bin/env node

import { connectMainCodex } from "./cdp-client.mjs";

const port = Number(process.argv[2] || 9231);
const SCRIPT_ID_GLOBAL = "__CODEX_CONVERSATION_PREVIEW_SCRIPT_IDENTIFIER__";
const ASSET_CONSOLE_BINDING = "codexSidebarOpenAssetConsole";

try {
  const client = await connectMainCodex(port);
  try {
    const identifier = await client.evaluate(
      `window[${JSON.stringify(SCRIPT_ID_GLOBAL)}] || null`,
    );
    if (identifier) {
      try {
        await client.send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
      } catch {
        // The renderer may already have discarded the registered script.
      }
    }
    await client.evaluate(`(() => {
      window.__codexConversationPreviewInjection__?.destroy?.();
      delete window.__codexConversationPreviewInjection__;
      delete window[${JSON.stringify(SCRIPT_ID_GLOBAL)}];
    })()`);
    try { await client.send("Fetch.disable"); } catch {}
    try {
      await client.send("Target.setAutoAttach", { autoAttach: false, waitForDebuggerOnStart: false, flatten: true });
    } catch {}
    try { await client.send("Runtime.removeBinding", { name: ASSET_CONSOLE_BINDING }); } catch {}
  } finally {
    client.close();
  }
} catch {
  // The app may already be closed or may not have been started with CDP enabled.
}
