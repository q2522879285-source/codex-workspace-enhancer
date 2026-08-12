# Adapter contract

A platform adapter is compatible only when all required capabilities pass.

| Capability | Required behavior |
|---|---|
| `discoverCodex` | Locate the running desktop app without modifying its package. |
| `attachRenderer` | Attach to the intended renderer and detach cleanly. |
| `observeUsage` | Read the latest valid primary rate-limit window; expose unknown rather than invented data. |
| `hostAssetFrame` | Create one dedicated, cancellable asset frame/session. |
| `proxyLocalService` | Proxy only allowlisted requests from that frame; fail all other local routes closed. |
| `validateAbsolutePath` | Accept native absolute local paths and reject relative paths and URLs. |
| `installRoots` | Restrict writes/deletes to product-owned roots with ownership markers or manifests. |
| `serviceLifecycle` | Start/stop only the exact configured local-service process. |
| `shortcuts` | Preserve all non-default install parameters in generated shortcuts. |
| `rollback` | Restore prior runtime files and never remove pre-existing user directories. |

## Compatibility check

Before porting, report every capability as `pass`, `missing`, or `not-applicable`. Do not silently degrade task binding, path validation, local-proxy isolation, rollback, or usage truthfulness.
