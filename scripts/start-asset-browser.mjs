#!/usr/bin/env node
import {assetBrowserRuntime, ensureAssetBrowserState} from '../lib/install-config.mjs';
const runtime = await ensureAssetBrowserState(assetBrowserRuntime());
Object.assign(process.env, runtime.env);
await import('../asset-browser/server.js');
