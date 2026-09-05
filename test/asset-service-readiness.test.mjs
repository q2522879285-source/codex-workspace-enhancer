import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
const source = readFileSync(new URL('../scripts/injector.mjs', import.meta.url), 'utf8');
const check = source.slice(source.indexOf('async function assetConsoleIsReady()'), source.indexOf('\nasync function ensureAssetConsoleServer'));
test('asset service readiness authenticates this state and refuses occupied ports', async () => {
  let response = {status:200, body:Buffer.from('{"projects":[]}')};
  const context = vm.createContext({assetConsoleApiTokenPath:'fixture-token', readFile:async()=> 'test-token\n', requestAssetConsole:async options=> {
    assert.equal(options.apiToken, 'test-token'); assert.equal(options.route, '/api/config');
    if (response instanceof Error) throw response;
    return response;
  }});
  vm.runInContext(check, context);
  assert.equal(await context.assetConsoleIsReady(), true);
  response = Object.assign(new Error('not listening'), {code:'ECONNREFUSED'});
  assert.equal(await context.assetConsoleIsReady(), false);
  for (const occupied of [{status:403, body:Buffer.from('{}')}, {status:200, body:Buffer.from('<html>other service</html>')}]) {
    response = occupied;
    await assert.rejects(context.assetConsoleIsReady(), /5177/);
  }
});
