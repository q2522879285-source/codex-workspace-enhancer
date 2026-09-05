#!/usr/bin/env node
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';

const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const root = path.resolve(option('--root') || process.cwd());
const denyFile = option('--deny-file');
const deny = denyFile ? JSON.parse(readFileSync(denyFile, 'utf8').replace(/^\uFEFF/, '')) : [];
const skipped = name => name === '.git' || name === 'node_modules' || name.startsWith('.release');
function walk(dir) {
  return readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
    if (skipped(entry.name)) return [];
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(file) : [path.relative(root, file)];
  });
}
const files = args.includes('--all') ? walk(root)
  : execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {cwd: root}).toString().split('\0').filter(Boolean);
const forbidden = /^(?:\.api-token|\.generation-tickets\.json|\.thread-project-bindings\.json|\.asset-download-ledger\.json|\.midjourney-workspace\.json|enhancer\.config\.json|asset-browser\.config\.json|task-context\.json|original\.jsonl|cold-index\.sqlite|cookies(?:\.json)?|auth\.json)$/i;
const credential = /(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-(?:proj-)?[A-Za-z0-9_-]{35,}|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----)/;
const textExtensions = new Set(['.js','.mjs','.cjs','.json','.md','.txt','.html','.css','.ps1','.sh','.cmd','.bat','.py','.toml','.yaml','.yml']);
const findings = [];
for (const file of new Set(files)) {
  const full = path.join(root, file);
  if (forbidden.test(path.basename(file)) || /\.(?:log|prompt\.md|meta\.json)$/i.test(file)) findings.push({file, reason:'runtime or private data file'});
  if (!statSync(full).isFile()) continue;
  const content = readFileSync(full, 'utf8');
  if (deny.some(value => value && content.toLowerCase().includes(String(value).toLowerCase()))) findings.push({file, reason:'private marker'});
  if (!textExtensions.has(path.extname(file)) && !['.gitignore','.npmrc'].includes(path.basename(file))) continue;
  if (credential.test(content)) findings.push({file, reason:'credential pattern'});
}
console.log(JSON.stringify({files: new Set(files).size, passed: findings.length === 0, findings}, null, 2));
if (findings.length) process.exitCode = 1;
