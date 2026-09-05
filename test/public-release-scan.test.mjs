import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

test('release scan accepts source and rejects runtime data, credentials and private markers', () => {
  const root = mkdtempSync(join(tmpdir(), 'public-release-scan-'));
  const scanner = fileURLToPath(new URL('../scripts/check-public-release.mjs', import.meta.url));
  const scan = (...args) => spawnSync(process.execPath, [scanner, '--root', root, '--all', ...args], {encoding: 'utf8'});
  try {
    writeFileSync(join(root, 'README.md'), '# Public source\n');
    assert.equal(scan().status, 0);
    writeFileSync(join(root, '.api-token'), 'local-token');
    writeFileSync(join(root, 'config.js'), 'ghp_' + 'a'.repeat(40));
    writeFileSync(join(root, 'image.png'), 'fixture-private-marker');
    const deny = join(root, 'deny.json');
    writeFileSync(deny, JSON.stringify(['fixture-private-marker']));
    const result = scan('--deny-file', deny);
    assert.equal(result.status, 1);
    const findings = JSON.parse(result.stdout).findings;
    for (const [file, reason] of [['.api-token', 'runtime or private data file'], ['config.js', 'credential pattern'], ['image.png', 'private marker']]) {
      assert.ok(findings.some(item => item.file === file && item.reason === reason));
    }
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});
