import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import test from 'node:test';
import vm from 'node:vm';

const root = process.env.LAUNCHER_TEST_SOURCE_ROOT || fileURLToPath(new URL('../', import.meta.url));
const launcher = await readFile(path.join(root, 'windows/launch.ps1'), 'utf8');
const starter = await readFile(path.join(root, 'windows/start-injector.ps1'), 'utf8');
const injector = (await readFile(path.join(root, 'scripts/injector.mjs'), 'utf8')).replaceAll('\r\n', '\n');
const installer = await readFile(path.join(root, 'install-windows.ps1'), 'utf8');
const windowsOnly = { skip: process.platform !== 'win32' };
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
function powershell(script) {
  return new Promise(resolve => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('close', code => resolve({ code, output }));
  });
}
async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'enhancer-launch-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, 'windows'));
  await mkdir(path.join(dir, 'scripts'));
  await mkdir(path.join(dir, 'state'));
  await writeFile(path.join(dir, 'windows/launch.ps1'), '\uFEFF' + launcher.replace(/^\uFEFF/, ''));
  await writeFile(path.join(dir, 'windows/start-injector.ps1'), '\uFEFF' + starter.replace(/^\uFEFF/, ''));
  await writeFile(path.join(dir, 'windows/stop-injector.ps1'), 'param($InstallDir,$StateDir)\nAdd-Content (Join-Path $StateDir "events.txt") stop\n');
  await writeFile(path.join(dir, 'scripts/injector.mjs'), '');
  await writeFile(path.join(dir, 'install-manifest.json'), JSON.stringify({ port: 9432, nodePath: process.execPath }));
  return dir;
}
function startHarness(dir, { explicit = '', active = false, noPath = false } = {}) {
  return `$ErrorActionPreference='Stop'
${noPath ? "$env:PATH=''" : ''}
function Invoke-RestMethod { ${active ? "[pscustomobject]@{url='app://-/index.html'}" : "throw 'not Codex'"} }
function Start-Process {
  param($FilePath,$ArgumentList,$WorkingDirectory,$WindowStyle,$RedirectStandardOutput,$RedirectStandardError,[switch]$PassThru)
  @{node=$FilePath;arguments=$ArgumentList} | ConvertTo-Json -Compress | Set-Content (Join-Path $WorkingDirectory 'result.json')
  [pscustomobject]@{Id=12345;HasExited=$false}
}
& ${quote(path.join(dir, 'windows/start-injector.ps1'))} -InstallDir ${quote(dir)} -StateDir ${quote(path.join(dir, 'state'))} ${explicit}`;
}

test('desktop shortcuts leave Port implicit so verified active ports can be reused', () => {
  const line = installer.split('\n').find(line => line.includes('$runtimeArguments ='));
  assert.ok(line);
  assert.doesNotMatch(line, /-Port/);
  assert.match(installer, /-ScriptPath \$uninstallScript[^\n]+\$runtimeArguments -Port \$Port/);
});

test('manifest Node path starts the injector with no desktop PATH', windowsOnly, async t => {
  const dir = await fixture(t);
  const result = await powershell(startHarness(dir, { noPath: true }));
  assert.equal(result.code, 0, result.output);
  const started = JSON.parse(await readFile(path.join(dir, 'result.json'), 'utf8'));
  assert.equal(started.node, process.execPath);
  assert.ok(started.arguments.includes('9432'));
});

test('missing manifest Node path falls back to PATH', windowsOnly, async t => {
  const dir = await fixture(t);
  await writeFile(path.join(dir, 'install-manifest.json'), JSON.stringify({ port: 9432, nodePath: path.join(dir, 'missing.exe') }));
  const result = await powershell(startHarness(dir));
  assert.equal(result.code, 0, result.output);
  const started = JSON.parse(await readFile(path.join(dir, 'result.json'), 'utf8'));
  assert.equal(started.node.toLowerCase(), process.execPath.toLowerCase());
});

test('startup reuses only a verified active port and explicit Port overrides it', windowsOnly, async t => {
  const dir = await fixture(t);
  await writeFile(path.join(dir, 'state/active-port.txt'), '9543');
  for (const [options, expected] of [[{ active: true }, '9543'], [{ active: false }, '9432'], [{ active: true, explicit: '-Port 9654' }, '9654']]) {
    const result = await powershell(startHarness(dir, options));
    assert.equal(result.code, 0, result.output);
    const started = JSON.parse(await readFile(path.join(dir, 'result.json'), 'utf8'));
    assert.ok(started.arguments.includes(expected), JSON.stringify(started));
  }
});

test('launcher port resolution preserves manifest defaults, checks active target and explicit override', windowsOnly, async t => {
  const dir = await fixture(t);
  await writeFile(path.join(dir, 'state/active-port.txt'), '9543');
  const script = `$ErrorActionPreference='Stop'
$InstallDir=${quote(dir)}; $StateDir=${quote(path.join(dir, 'state'))}
$tokens=$null; $errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile(${quote(path.join(dir, 'windows/launch.ps1'))},[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw $errors[0] }
$function=$ast.Find({param($a) $a -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $a.Name -eq 'Resolve-StartupPort'},$true)
if (-not $function) { throw 'Port resolution function missing' }
Invoke-Expression $function.Extent.Text
function Test-CodexDebugPort { return $script:valid }
$script:valid=$true
if ((Resolve-StartupPort 9231 $false) -ne 9543) { throw 'Active port not reused' }
if ((Resolve-StartupPort 9654 $true) -ne 9654) { throw 'Explicit port ignored' }
$script:valid=$false
if ((Resolve-StartupPort 9231 $false) -ne 9432) { throw 'Stale active port reused' }
Set-Content (Join-Path $StateDir 'active-port.txt') 'invalid'
if ((Resolve-StartupPort 9231 $false) -ne 9432) { throw 'Invalid active port reused' }`;
  const result = await powershell(script);
  assert.equal(result.code, 0, result.output);
});

test('concurrent launch and injector entry points leave owned flags, logs and PID untouched', windowsOnly, async t => {
  const dir = await fixture(t);
  const state = path.join(dir, 'state');
  const preserved = ['startup-ready.flag', 'startup-abort.flag', 'injector.pid', 'injector.log', 'launcher.log'];
  for (const file of preserved) await writeFile(path.join(state, file), 'owner');
  // Hold the real exclusive file locks in a separate process. Contenders must
  // return before mocked package activation, stop-injector or any shared write.
  const owner = powershell(`$a=[IO.File]::Open(${quote(path.join(state, 'launcher.lock'))},'OpenOrCreate','ReadWrite','None')
$b=[IO.File]::Open(${quote(path.join(state, 'injector-start.lock'))},'OpenOrCreate','ReadWrite','None')
try { Set-Content ${quote(path.join(state, 'locks-ready'))} ready
$deadline=(Get-Date).AddSeconds(10)
while ((Get-Date) -lt $deadline -and -not (Test-Path ${quote(path.join(state, 'release-locks'))})) { Start-Sleep -Milliseconds 50 }
} finally { $a.Dispose(); $b.Dispose() }`);

  const deadline = Date.now() + 10000;
  while (true) {
    try { await readFile(path.join(state, 'locks-ready')); break; } catch {}
    assert.ok(Date.now() < deadline, 'lock owner did not start');
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  try {
  const contenders = Array.from({ length: 12 }, (_, index) => {
    if (index % 2) return powershell(startHarness(dir));
    return powershell(`function Get-AppxPackage { throw 'Package activation crossed fixture boundary' }
function Add-Type {}
& ${quote(path.join(dir, 'windows/launch.ps1'))} -InstallDir ${quote(dir)} -StateDir ${quote(state)}`);
  });
  for (const result of await Promise.all(contenders)) assert.equal(result.code, 0, result.output);
  for (const file of preserved) assert.equal(await readFile(path.join(state, file), 'utf8'), 'owner', file);
  } finally {
    await writeFile(path.join(state, 'release-locks'), 'release');
    assert.equal((await owner).code, 0);
  }
  const reopened = await powershell(`$lock=[IO.File]::Open(${quote(path.join(state, 'launcher.lock'))},'OpenOrCreate','ReadWrite','None'); $lock.Dispose()`);
  assert.equal(reopened.code, 0, reopened.output);
});

test('watch retry logs the endpoint and concrete error before retrying', async () => {
  const loop = injector.slice(injector.lastIndexOf('\ntry {\n  while (!stopped)'), injector.lastIndexOf('\n} finally {')) + '\n} finally {}';
  const messages = [];
  let closed = 0;
  const context = vm.createContext({
    stopped: false, options: { port: 9543, watch: true },
    lastInjectorErrorDetail: null,
    attach: async () => { throw new Error('fixture CDP disconnected'); },
    attachedTargetId: 'old', registeredScriptIdentifier: 'old', assetConsoleRequestGeneration: 0,
    teardownAssetConsoleProxy: async () => {}, client: { close() { closed++; } },
    process: { stderr: { write: text => messages.push(text) } },
    setTimeout: callback => { context.stopped = true; callback(); },
  });
  await vm.runInContext(`(async () => { ${loop} })()`, context);
  assert.equal(closed, 1);
  assert.equal(context.client, null);
  assert.match(messages.join(''), /127\.0\.0\.1:9543/);
  assert.match(messages.join(''), /fixture CDP disconnected/);
  assert.match(messages.join(''), /Retrying in 5 seconds/);
});

test('watch logs changed failures once and reports the same failure again after recovery', async () => {
  const loop = injector.slice(injector.lastIndexOf('\ntry {\n  while (!stopped)'), injector.lastIndexOf('\n} finally {')) + '\n} finally {}';
  const disconnected = new Error('fixture CDP disconnected');
  const unavailable = new Error('fixture target unavailable');
  const outcomes = [disconnected, disconnected, unavailable, null, disconnected, disconnected];
  const messages = [];
  let iteration = 0;
  let successfulPushes = 0;
  const context = vm.createContext({
    stopped: false, lastInjectorErrorDetail: null, options: { port: 9543, watch: true },
    attach: async () => { if (outcomes[iteration]) throw outcomes[iteration]; return false; },
    bindAssetConsole: async () => {}, syncExternalAddAccount: async () => {},
    pushPreviews: async () => { successfulPushes++; },
    attachedTargetId: 'old', registeredScriptIdentifier: 'old', assetConsoleRequestGeneration: 0,
    teardownAssetConsoleProxy: async () => {}, client: null,
    process: { stderr: { write: text => messages.push(text) } },
    setTimeout: callback => { iteration++; context.stopped = iteration === outcomes.length; callback(); },
  });
  await vm.runInContext(`(async () => { ${loop} })()`, context);
  assert.equal(successfulPushes, 1);
  assert.equal(messages.length, 3, 'identical consecutive errors must not flood the log');
  assert.match(messages[0], /fixture CDP disconnected/);
  assert.match(messages[1], /fixture target unavailable/);
  assert.match(messages[2], /fixture CDP disconnected/);
  assert.equal(context.assetConsoleRequestGeneration, 5, 'suppression must not skip error recovery');
});
