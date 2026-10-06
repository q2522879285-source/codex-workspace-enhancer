# Verify that inspection follows custom install/state paths without installing.
$ErrorActionPreference = 'Stop'
$root = Join-Path ([IO.Path]::GetTempPath()) ('cwe-inspect-check-' + [Guid]::NewGuid().ToString('N'))
try {
  $install = Join-Path $root 'install'
  $state = Join-Path $root 'state'
  New-Item -ItemType Directory -Path (Join-Path $install 'scripts'), (Join-Path $install 'asset-browser'), (Join-Path $state 'asset-browser') -Force | Out-Null
  Set-Content (Join-Path $install 'scripts\injector.mjs') '// test fixture'
  Set-Content (Join-Path $install 'asset-browser\server.js') '// test fixture'
  Set-Content (Join-Path $state 'asset-browser\asset-browser.config.json') '{"projects":[]}'
  $result = & (Join-Path $PSScriptRoot 'inspect.ps1') -EnhancerDir $install -StateDir $state -BackendPort 1 | ConvertFrom-Json
  if (-not $result.enhancer.installed -or -not $result.assetBrowser.installed -or -not $result.assetBrowser.configPresent) { throw 'Custom install/state paths were not respected.' }
  if ($result.assetBrowser.installDir -ne (Join-Path $install 'asset-browser')) { throw 'Backend path was not derived from EnhancerDir.' }
  'custom-path inspection passed'
} finally {
  $target = [IO.Path]::GetFullPath($root)
  $parent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
  if (-not $target.StartsWith($parent, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected test directory.' }
  if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
}
