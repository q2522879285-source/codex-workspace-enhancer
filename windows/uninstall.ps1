param(
  [int]$Port = 9231,
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA "Programs\Codex Sidebar Enhancer"),
  [string]$StateDir = (Join-Path $env:LOCALAPPDATA "CodexSidebarEnhancer"),
  [switch]$SkipShortcuts
)

$ErrorActionPreference = "SilentlyContinue"
$stateMarkerName = ".codex-sidebar-enhancer-owned"
$stateMarkerValue = "Codex Sidebar Enhancer state v1"
if ($Port -lt 1 -or $Port -gt 65535) { throw "Uninstall refused: invalid port" }
$resolvedInstall = [IO.Path]::GetFullPath($InstallDir).TrimEnd('\')
$resolvedState = [IO.Path]::GetFullPath($StateDir).TrimEnd('\')
$expectedInstall = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "Programs\Codex Sidebar Enhancer")).TrimEnd('\')
$expectedState = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "CodexSidebarEnhancer")).TrimEnd('\')
if (-not $resolvedInstall.Equals($expectedInstall, [StringComparison]::OrdinalIgnoreCase) -or
    -not $resolvedState.Equals($expectedState, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Uninstall refused: directories are not the dedicated Codex Sidebar Enhancer paths"
}
$manifestPath = Join-Path $InstallDir "install-manifest.json"
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
  throw "Uninstall refused: installation manifest not found"
}
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.name -ne "Codex Sidebar Enhancer") {
  throw "Uninstall refused: invalid installation manifest"
}
if ($manifest.stateDir -and [IO.Path]::GetFullPath([string]$manifest.stateDir).TrimEnd('\') -ne $resolvedState) {
  throw "Uninstall refused: state directory does not match the installation manifest"
}
if (-not $manifest.installDir -or
    -not ([IO.Path]::GetFullPath([string]$manifest.installDir).TrimEnd('\')).Equals($resolvedInstall, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Uninstall refused: install directory does not match the installation manifest"
}
$stateMarkerPath = Join-Path $StateDir $stateMarkerName
if (-not (Test-Path -LiteralPath $stateMarkerPath -PathType Leaf) -or
    (Get-Content -LiteralPath $stateMarkerPath -Raw).Trim() -ne $stateMarkerValue) {
  throw "Uninstall refused: state directory ownership marker is missing or invalid"
}
$windowsDir = Join-Path $InstallDir "windows"
& (Join-Path $windowsDir "stop-injector.ps1") -InstallDir $InstallDir -StateDir $StateDir

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node -and $manifest.nodePath -and (Test-Path -LiteralPath $manifest.nodePath)) {
  $node = [pscustomobject]@{ Source = [string]$manifest.nodePath }
}
if (-not $node) { throw "Node.js is needed to remove installed hooks safely. Restore Node.js and retry." }
$removeScript = Join-Path $InstallDir "scripts\remove-injection.mjs"
if ($node -and (Test-Path -LiteralPath $removeScript)) {
  & $node.Source $removeScript $Port 2>$null
}

if (-not $SkipShortcuts) {
  $shortcutPaths = @(
    (Join-Path ([Environment]::GetFolderPath("Desktop")) "Codex 侧栏增强器.lnk"),
    (Join-Path ([Environment]::GetFolderPath("Programs")) "Codex 侧栏增强器.lnk"),
    (Join-Path ([Environment]::GetFolderPath("Programs")) "卸载 Codex 侧栏增强器.lnk"),
    (Join-Path ([Environment]::GetFolderPath("Startup")) "Codex 侧栏增强器后台.lnk")
  )
  foreach ($shortcut in $shortcutPaths) {
    Remove-Item -LiteralPath $shortcut -Force -ErrorAction SilentlyContinue
  }
  $shortcutBackupDir = Join-Path $StateDir "shortcut-backup"
  for ($index = 0; $index -lt $shortcutPaths.Count; $index += 1) {
    $backupPath = Join-Path $shortcutBackupDir "$index.lnk"
    if (Test-Path -LiteralPath $backupPath -PathType Leaf) {
      Copy-Item -LiteralPath $backupPath -Destination $shortcutPaths[$index] -Force
    }
  }
}

$hookSetup = Join-Path $InstallDir "scripts\setup-task-context-hooks.mjs"
if ($node -and (Test-Path -LiteralPath $hookSetup)) {
  & $node.Source $hookSetup --remove
  if ($LASTEXITCODE -ne 0) { throw "Could not remove owned summary hooks; installation preserved." }
}
$backendServer = Join-Path $InstallDir "asset-browser\server.js"
Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -and $_.CommandLine.Contains($backendServer) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
# Retain state, asset metadata and user configuration for reinstall or export.
if (Test-Path -LiteralPath (Join-Path $InstallDir "enhancer.config.json")) {
  Copy-Item -LiteralPath (Join-Path $InstallDir "enhancer.config.json") -Destination (Join-Path $StateDir "enhancer.config.json") -Force
}
if (Test-Path -LiteralPath $InstallDir) {
  Remove-Item -LiteralPath $InstallDir -Recurse -Force
}
Write-Output "Uninstalled. User state retained at $StateDir"
