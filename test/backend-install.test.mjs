import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, rm, mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {assetBrowserRuntime, ensureAssetBrowserState} from '../lib/install-config.mjs';
import {setupTaskContextHooks} from '../scripts/setup-task-context-hooks.mjs';
import {MidjourneyWorkspace, parseMidjourneyFilename} from '../asset-browser/midjourney-workspace.js';

test('fresh backend state, upgrades and hook removal preserve user data and unrelated hooks', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'enhancer-install-'));
  try {
    const runtime = assetBrowserRuntime({installDir: root, stateDir: root});
    await ensureAssetBrowserState(runtime);
    const token = await readFile(runtime.tokenPath, 'utf8');
    assert.match(token, /^[a-f0-9]{64}$/);
    await writeFile(runtime.env.ASSET_BROWSER_CONFIG, '{"projects":[{"id":"mine"}]}');
    await ensureAssetBrowserState(runtime);
    assert.equal(await readFile(runtime.tokenPath, 'utf8'), token);
    assert.equal(JSON.parse(await readFile(runtime.env.ASSET_BROWSER_CONFIG, 'utf8')).projects[0].id, 'mine');
    const hooksPath = path.join(root, 'hooks.json');
    const foreign = {type: 'command', command: 'echo existing'};
    await writeFile(hooksPath, JSON.stringify({extra: true, hooks: {Stop: [{hooks: [foreign]}]}}));
    const options = {codexHome: root, installDir: root};
    await setupTaskContextHooks(options);
    await setupTaskContextHooks(options);
    let hooks = JSON.parse(await readFile(hooksPath, 'utf8'));
    assert.equal(hooks.hooks.Stop.length, 2);
    assert.equal(hooks.extra, true);
    await setupTaskContextHooks({...options, remove: true});
    hooks = JSON.parse(await readFile(hooksPath, 'utf8'));
    assert.deepEqual(hooks, {extra: true, hooks: {Stop: [{hooks: [foreign]}]}});
    await setupTaskContextHooks({...options, remove: true});
    assert.deepEqual(JSON.parse(await readFile(hooksPath, 'utf8')), hooks);
  } finally {await rm(root, {recursive: true, force: true});}
});

test('MJ import groups complete P values in original order using isolated fixtures', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'enhancer-mj-'));
  try {
    const downloadsPath = path.join(root, 'downloads');
    await mkdir(downloadsPath);
    const workspace = new MidjourneyWorkspace({downloadsPath, registryPath: path.join(root, 'registry.json')});
    for (const values of ['abc_def', 'def_abc', 'abc_abc']) {
      const name = `u123__test_--p_${values}_11111111-1111-4111-8111-111111111111_0.png`;
      assert.deepEqual(parseMidjourneyFilename(name).profiles, values.split('_'));
      await writeFile(path.join(downloadsPath, name), Buffer.from('fixture'));
      const [output] = await workspace.importFiles({names: [name], projectId: 'mj-library', projectName: 'MJ', generatedRoot: path.join(root, 'generated')});
      assert.equal(output.caseId, `P-${values.replaceAll('_', '+')}`);
      assert.equal(path.basename(path.dirname(output.storePath)), output.caseId);
      assert.equal(await readFile(output.storePath, 'utf8'), 'fixture');
    }
    assert.equal(parseMidjourneyFilename('ordinary.png'), null);
  } finally {await rm(root, {recursive: true, force: true});}
});

test('Windows clean install and upgrade preserve configuration without launching Codex', {skip: process.platform !== 'win32'}, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'enhancer-windows-install-'));
  try {
    const fakeApp = path.join(root, 'fake-codex', 'app');
    await mkdir(fakeApp, {recursive: true});
    await writeFile(path.join(fakeApp, 'ChatGPT.exe'), 'fixture');
    const script = path.join(root, 'install-test.ps1');
    await writeFile(script, `
$ErrorActionPreference='Stop'
function Get-AppxPackage { [pscustomobject]@{InstallLocation=(Join-Path $env:LOCALAPPDATA 'fake-codex'); Version=[version]'1.0.0'} }
& (Join-Path $env:TEST_SOURCE 'install-windows.ps1') -SkipStart -SkipShortcuts
`);
    const install = () => {
      const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], {encoding: 'utf8', windowsHide: true, env: {...process.env, LOCALAPPDATA: root, TEST_SOURCE: path.resolve('.')}});
      assert.equal(result.status, 0, result.stdout + result.stderr);
    };
    install();
    const installed = path.join(root, 'Programs', 'Codex Sidebar Enhancer');
    const state = path.join(root, 'CodexSidebarEnhancer', 'asset-browser');
    const token = await readFile(path.join(state, '.api-token'), 'utf8');
    await writeFile(path.join(state, 'asset-browser.config.json'), '{"projects":[{"id":"custom"}]}');
    await writeFile(path.join(installed, 'enhancer.config.json'), '{"skills":{"defaultFavorites":["Custom"]}}');
    install();
    assert.equal(await readFile(path.join(state, '.api-token'), 'utf8'), token);
    assert.equal(JSON.parse(await readFile(path.join(state, 'asset-browser.config.json'), 'utf8')).projects[0].id, 'custom');
    assert.deepEqual(JSON.parse(await readFile(path.join(installed, 'enhancer.config.json'), 'utf8')).skills.defaultFavorites, ['Custom']);
    await readFile(path.join(installed, 'asset-browser', 'codex-workspace.js'));
    await readFile(path.join(installed, 'scripts', 'task-context-guard.mjs'));
  } finally {await rm(root, {recursive: true, force: true});}
});
