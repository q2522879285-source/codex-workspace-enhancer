#!/usr/bin/env node
import { assetBrowserRuntime, ensureAssetBrowserState } from '../lib/install-config.mjs';
const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--state-dir') options.stateDir = args[++i];
  else if (args[i] === '--install-dir') options.installDir = args[++i];
  else throw new Error(`Unknown argument: ${args[i]}`);
}
const runtime = await ensureAssetBrowserState(assetBrowserRuntime(options));
console.log(JSON.stringify({stateRoot: runtime.stateRoot, configPath: runtime.env.ASSET_BROWSER_CONFIG}));
