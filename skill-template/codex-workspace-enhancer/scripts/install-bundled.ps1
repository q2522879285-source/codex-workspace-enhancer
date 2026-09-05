param(
  [string]$EnhancerDir = (Join-Path $env:LOCALAPPDATA "Programs\Codex Sidebar Enhancer"),
  [string]$StateDir = (Join-Path $env:LOCALAPPDATA "CodexSidebarEnhancer"),
  [int]$DebugPort = 9231,
  [switch]$SkipStart,
  [switch]$SkipShortcuts,
  [switch]$WhatIf
)
$ErrorActionPreference = 'Stop'
$skillRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $skillRoot 'assets\runtime'
$archive = Join-Path $runtimeRoot 'codex-sidebar-enhancer-windows.zip'
$manifest = Get-Content -LiteralPath (Join-Path $runtimeRoot 'manifest.sha256.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.enhancerZipSha256) { throw 'Package integrity check failed.' }
if ($WhatIf) {
  [ordered]@{ installDir=$EnhancerDir; stateDir=$StateDir; port=$DebugPort; hooks='explicit opt-in setup'; restartsCodex=$false } | ConvertTo-Json
  exit 0
}
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('CodexWorkspaceEnhancer-' + [Guid]::NewGuid().ToString('N'))
try {
  Expand-Archive -LiteralPath $archive -DestinationPath $tempRoot
  & (Join-Path $tempRoot 'install-windows.ps1') -InstallDir $EnhancerDir -StateDir $StateDir -Port $DebugPort -SkipStart:$SkipStart -SkipShortcuts:$SkipShortcuts
} finally {
  $resolvedTemp = [IO.Path]::GetFullPath($tempRoot)
  $expectedParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
  if (-not $resolvedTemp.StartsWith($expectedParent, [StringComparison]::OrdinalIgnoreCase)) { throw 'Temporary path is outside the expected directory.' }
  if (Test-Path -LiteralPath $resolvedTemp) { Remove-Item -LiteralPath $resolvedTemp -Recurse -Force }
}
