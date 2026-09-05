#!/usr/bin/env node
import { readFile, mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export async function setupTaskContextHooks({codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), installDir = path.resolve(import.meta.dirname, '..'), nodePath = process.execPath, remove = false} = {}) {
  const hooksPath = path.join(codexHome, 'hooks.json');
  const receiptPath = path.join(codexHome, 'task-context', 'enhancer-hooks-install.json');
  const read = async (file, fallback) => JSON.parse((await readFile(file, 'utf8').catch(error => {if(error.code === 'ENOENT') return JSON.stringify(fallback); throw error;})).replace(/^\uFEFF/, ''));
  const config = await read(hooksPath, {});
  const receipt = await read(receiptPath, {commands: []});
  const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
  const psQuote = value => `'${value.replaceAll("'", "''")}'`;
  const guard = path.join(installDir, 'scripts', 'task-context-guard.mjs');
  const command = process.platform === 'win32' ? `& ${psQuote(nodePath)} ${psQuote(guard)}` : `${quote(nodePath)} ${quote(guard)}`;
  const owned = new Set(receipt.commands);
  if (!remove) owned.add(command);
  const original = JSON.stringify(config);
  config.hooks ||= {};
  for (const event of ['SessionStart', 'UserPromptSubmit', 'Stop']) {
    const existing = config.hooks[event] || [];
    config.hooks[event] = existing.flatMap(group => {
      const hooks = group.hooks.filter(hook => !owned.has(hook.command));
      return hooks.length ? [{...group, hooks}] : [];
    });
    if (!remove) config.hooks[event].push({...(event === 'SessionStart' ? {matcher: 'startup|resume|clear|compact'} : {}), hooks: [{type: 'command', command, timeout: 3}]});
    if (!config.hooks[event].length) delete config.hooks[event];
  }
  if (remove && !receipt.commands.length) return {changed: false, hooksPath};
  await mkdir(path.dirname(receiptPath), {recursive: true});
  const atomic = async (file, value) => {const temporary = `${file}.${process.pid}.tmp`; await writeFile(temporary, JSON.stringify(value, null, 2) + '\n'); await rename(temporary, file);};
  if (JSON.stringify(config) !== original) await atomic(hooksPath, config);
  await atomic(receiptPath, {commands: remove ? [] : [command]});
  return {changed: JSON.stringify(config) !== original, hooksPath, requiresTrustReview: !remove};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === '--remove') options.remove = true;
    else if (arg === '--codex-home') options.codexHome = process.argv[++i];
    else if (arg === '--install-dir') options.installDir = process.argv[++i];
    else if (arg === '--node-path') options.nodePath = process.argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  console.log(JSON.stringify(await setupTaskContextHooks(options)));
}
