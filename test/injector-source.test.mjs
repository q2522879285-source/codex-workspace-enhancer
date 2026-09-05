import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../scripts/injector.mjs', import.meta.url), 'utf8');
const attach = source.slice(source.indexOf('async function attach()'), source.indexOf('\nasync function pushPreviews()'));
const userSource = 'window.injected = (window.injected || 0) + 1; window.__codexConversationPreviewInjection__ = {};';
const hash = createHash('sha256').update('window.__CODEX_ENHANCER_CONFIG__ = {"skills":{}};\n' + userSource).digest('hex');

test('reattachment preserves matching live UI but registers marked source and rebinds listeners', async () => {
  for (const [storedHash, alive, styled, expected] of [[hash, true, true, 0], ['old', true, true, 1], [hash, false, true, 1], [hash, true, false, 1]]) {
    const window = { __CODEX_CONVERSATION_PREVIEW_SOURCE_HASH__: storedHash, injected: 0 };
    if (alive) window.__codexConversationPreviewInjection__ = {};
    const renderer = vm.createContext({ window, document: { getElementById: () => styled ? {} : null } });
    const registrations = [];
    let bindings = 0;
    const client = {
      evaluate: async expression => vm.runInContext(expression, renderer),
      send: async (method, params) => {
        if (method === 'Page.addScriptToEvaluateOnNewDocument') registrations.push(params.source);
        return { identifier: 'registered' };
      },
    };
    const context = vm.createContext({
      enhancerConfig: {}, createHash, client, attachedTargetId: 'renderer', registeredScriptIdentifier: null,
      SCRIPT_ID_GLOBAL: '__SCRIPT_ID__', sourcePath: 'fixture', options: { port: 9231 },
      targetId: async () => 'renderer', needsPreviewAttachment: async () => true,
      readFile: async () => userSource, bindAssetConsole: async () => bindings++,
      process: { stdout: { write() {} } },
    });
    vm.runInContext(attach, context);
    assert.equal(await context.attach(), true);
    assert.equal(window.injected, expected);
    assert.equal(window.__CODEX_CONVERSATION_PREVIEW_SOURCE_HASH__, hash);
    assert.equal(bindings, 1);
    assert.equal(registrations.length, 1);
    const fresh = vm.createContext({ window: {} });
    vm.runInContext(registrations[0], fresh);
    assert.equal(fresh.window.injected, 1);
    assert.equal(fresh.window.__CODEX_CONVERSATION_PREVIEW_SOURCE_HASH__, hash);
  }
});
