import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("sidebar expansion survives React row replacement without rebuilding", async () => {
  const source = await readFile(new URL("../inject/conversation-preview.user.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /folderSources\.get\(item\.id\)\?\.row !== item\.row/);
  assert.match(source, /if \(folderTogglePending\.has\(item\.id\)\) return;/);
});
