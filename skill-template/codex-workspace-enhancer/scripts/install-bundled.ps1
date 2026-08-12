param(
  [string]$BackendDir = (Join-Path $env:LOCALAPPDATA "AssetBrowser"),
  [string]$EnhancerDir = (Join-Path $env:LOCALAPPDATA "Programs\Codex Sidebar Enhancer"),
  [string]$StateDir = (Join-Path $env:LOCALAPPDATA "CodexSidebarEnhancer"),
  [int]$DebugPort = 9231,
  [switch]$SkipStart,
  [switch]$SkipShortcuts,
  [switch]$BackendOnly,
  [switch]$FrontendOnly,
  [switch]$WhatIf
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2
if ($BackendOnly -and $FrontendOnly) { throw "BackendOnly and FrontendOnly cannot be used together." }
if (-not $env:LOCALAPPDATA) { throw "LOCALAPPDATA is unavailable." }

$skillRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $skillRoot "assets\runtime"
$backendPayload = Join-Path $runtimeRoot "asset-browser"
$frontendZip = Join-Path $runtimeRoot "codex-sidebar-enhancer-windows.zip"
$manifestPath = Join-Path $runtimeRoot "manifest.sha256.json"
$ownedBackendRoot = Join-Path $env:LOCALAPPDATA "AssetBrowser"
$backupRoot = Join-Path $env:LOCALAPPDATA "CodexWorkspaceEnhancer\backups"
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("CodexWorkspaceEnhancer-{0}-{1}" -f $PID, [Guid]::NewGuid().ToString('N'))
$backendChanged = $false
$configCreated = $false
$createdFiles = New-Object System.Collections.Generic.List[string]
$backupDir = $null
$backendWasHealthy = $false
$startedBackendProcess = $null

function Get-NormalizedPath([string]$Path) {
  return [IO.Path]::GetFullPath($Path).TrimEnd('\')
}

function Assert-ExactBackendRoot {
  $actual = Get-NormalizedPath $BackendDir
  $expected = Get-NormalizedPath $ownedBackendRoot
  if (-not $actual.Equals($expected, [StringComparison]::OrdinalIgnoreCase)) {
    throw "The bundled Windows adapter only owns $expected. Refusing BackendDir: $actual"
  }
}

function Assert-Node22 {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { throw "Node.js 22 or newer is required." }
  $version = (& $node.Source --version)
  if ($version -notmatch '^v(\d+)' -or [int]$Matches[1] -lt 22) { throw "Node.js 22 or newer is required; found $version" }
  return $node.Source
}

function Assert-BundleIntegrity {
  if (-not (Test-Path -LiteralPath $manifestPath)) { throw "Missing runtime manifest." }
  if (-not (Test-Path -LiteralPath $frontendZip)) { throw "Missing enhancer package." }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $zipHash = (Get-FileHash -LiteralPath $frontendZip -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($zipHash -ne $manifest.enhancerZipSha256) { throw "Enhancer package hash mismatch." }
  foreach ($entry in @($manifest.files | Where-Object { $_.path.StartsWith('asset-browser/') })) {
    $relative = $entry.path.Substring('asset-browser/'.Length) -replace '/', '\'
    $source = Join-Path $backendPayload $relative
    if (-not (Test-Path -LiteralPath $source)) { throw "Missing backend payload file: $relative" }
    $actual = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $entry.sha256) { throw "Backend payload hash mismatch: $relative" }
  }
  return $manifest
}

function Test-BackendHealthy {
  $tokenPath = Join-Path $BackendDir '.api-token'
  $headers = @{}
  if (Test-Path -LiteralPath $tokenPath) {
    $token = (Get-Content -LiteralPath $tokenPath -Raw -Encoding UTF8).Trim()
    if ($token) { $headers['x-asset-console-token'] = $token }
  }
  try { $null = Invoke-RestMethod -Uri 'http://127.0.0.1:5177/api/projects' -Headers $headers -TimeoutSec 2; return $true }
  catch { return $false }
}

function Ensure-ApiToken {
  $tokenPath = Join-Path $BackendDir '.api-token'
  if (Test-Path -LiteralPath $tokenPath) {
    $token = (Get-Content -LiteralPath $tokenPath -Raw -Encoding UTF8).Trim()
    if ($token.Length -lt 32) { throw "Existing AssetBrowser API token is invalid: $tokenPath" }
    return
  }
  $bytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  $token = -join ($bytes | ForEach-Object { $_.ToString('x2') })
  $temporary = Join-Path $BackendDir ('.api-token.new-' + [Guid]::NewGuid().ToString('N'))
  [IO.File]::WriteAllText($temporary, $token, (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temporary -Destination $tokenPath -Force
  $script:createdFiles.Add($tokenPath) | Out-Null
}

function Stop-ExactBackendProcess {
  $serverPath = Join-Path $BackendDir "server.js"
  $processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -and $_.CommandLine.IndexOf($serverPath, [StringComparison]::OrdinalIgnoreCase) -ge 0
  })
  $script:backendWasHealthy = Test-BackendHealthy
  if ($script:backendWasHealthy -and $processes.Count -eq 0) {
    throw "AssetBrowser is active on port 5177, but its process identity cannot be verified. Stop that service and retry."
  }
  foreach ($process in $processes) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
  }
}

function Start-BundledBackend {
  $serverPath = Join-Path $BackendDir 'server.js'
  if (-not (Test-Path -LiteralPath $serverPath)) { throw "AssetBrowser server is missing: $serverPath" }
  $tokenPath = Join-Path $BackendDir '.api-token'
  if (-not (Test-Path -LiteralPath $tokenPath)) { throw "AssetBrowser API token is missing: $tokenPath" }
  if (Test-BackendHealthy) { return }
  $serverArgument = '"{0}"' -f $serverPath
  $script:startedBackendProcess = Start-Process -FilePath $nodePath -ArgumentList $serverArgument -WorkingDirectory $BackendDir -WindowStyle Hidden -PassThru
}

function Stop-BackendStartedByThisRun {
  if (-not $script:startedBackendProcess) { return }
  $pidToStop = $script:startedBackendProcess.Id
  $serverPath = Join-Path $BackendDir 'server.js'
  $record = Get-CimInstance Win32_Process -Filter "ProcessId=$pidToStop" -ErrorAction SilentlyContinue
  if ($record -and $record.CommandLine -and $record.CommandLine.IndexOf($serverPath, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
    Stop-Process -Id $pidToStop -Force -ErrorAction SilentlyContinue
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
      if (-not (Get-Process -Id $pidToStop -ErrorAction SilentlyContinue)) { break }
      Start-Sleep -Milliseconds 100
    }
    if (Get-Process -Id $pidToStop -ErrorAction SilentlyContinue) {
      throw "Could not stop the AssetBrowser process started by this install; rollback was not attempted while it is active."
    }
  } elseif ($record) {
    throw "Backend PID identity changed before rollback; refusing to stop or overwrite a different process."
  }
  $script:startedBackendProcess = $null
}

function Copy-Atomic([string]$Source, [string]$Destination) {
  $parent = Split-Path -Parent $Destination
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  $temporary = Join-Path $parent (".{0}.new-{1}" -f ([IO.Path]::GetFileName($Destination)), [Guid]::NewGuid().ToString('N'))
  Copy-Item -LiteralPath $Source -Destination $temporary -Force
  Move-Item -LiteralPath $temporary -Destination $Destination -Force
}

function Install-Backend($Manifest) {
  New-Item -ItemType Directory -Force -Path $BackendDir, $backupRoot | Out-Null
  $script:backupDir = Join-Path $backupRoot ("AssetBrowser-{0}-{1}" -f (Get-Date -Format 'yyyyMMdd-HHmmss'), $PID)
  New-Item -ItemType Directory -Force -Path $script:backupDir | Out-Null
  $script:backendChanged = $true

  $entries = @($Manifest.files | Where-Object { $_.path.StartsWith('asset-browser/') -and -not $_.path.EndsWith('asset-browser.config.example.json') })
  foreach ($entry in $entries) {
    $relative = $entry.path.Substring('asset-browser/'.Length) -replace '/', '\'
    $source = Join-Path $backendPayload $relative
    $destination = Join-Path $BackendDir $relative
    $backup = Join-Path $script:backupDir $relative
    if (Test-Path -LiteralPath $destination) {
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $backup) | Out-Null
      Copy-Item -LiteralPath $destination -Destination $backup -Force
    } else {
      $script:createdFiles.Add($destination) | Out-Null
    }
    Copy-Atomic $source $destination
  }

  $configPath = Join-Path $BackendDir 'asset-browser.config.json'
  if (-not (Test-Path -LiteralPath $configPath)) {
    Copy-Atomic (Join-Path $backendPayload 'asset-browser.config.example.json') $configPath
    $script:configCreated = $true
  }
}

function Restore-Backend {
  if (-not $script:backupDir) { return }
  foreach ($path in $script:createdFiles) {
    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
  }
  if ($script:configCreated) {
    $configPath = Join-Path $BackendDir 'asset-browser.config.json'
    if (Test-Path -LiteralPath $configPath) { Remove-Item -LiteralPath $configPath -Force }
  }
  if (Test-Path -LiteralPath $script:backupDir) {
    Get-ChildItem -LiteralPath $script:backupDir -Recurse -File | ForEach-Object {
      $relative = $_.FullName.Substring($script:backupDir.Length).TrimStart('\')
      Copy-Atomic $_.FullName (Join-Path $BackendDir $relative)
    }
  }
}

Assert-ExactBackendRoot
$nodePath = Assert-Node22
$manifest = Assert-BundleIntegrity

$plan = [ordered]@{
  action = if ($WhatIf) { 'preview' } else { 'install' }
  backend = if ($FrontendOnly) { 'skip' } else { $BackendDir }
  enhancer = if ($BackendOnly) { 'skip' } else { $EnhancerDir }
  state = if ($BackendOnly) { 'skip' } else { $StateDir }
  preserves = @('asset-browser.config.json', 'ledgers', 'project folders', 'media')
  bundleHash = $manifest.enhancerZipSha256
}
if ($WhatIf) { $plan | ConvertTo-Json -Depth 5; exit 0 }

try {
  New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
  if (-not $FrontendOnly) {
    Stop-ExactBackendProcess
    Install-Backend $manifest
    Ensure-ApiToken
  } elseif (-not (Test-Path -LiteralPath (Join-Path $BackendDir '.api-token'))) {
    throw "Frontend-only install requires an existing authenticated AssetBrowser service."
  }

  # Establish backend health before committing the independently managed frontend.
  if (-not $SkipStart) {
    Start-BundledBackend
    $healthy = $false
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
      if (Test-BackendHealthy) { $healthy = $true; break }
      Start-Sleep -Milliseconds 350
    }
    if (-not $healthy) { throw "AssetBrowser did not become healthy on 127.0.0.1:5177." }
  }

  if (-not $BackendOnly) {
    $frontendTemp = Join-Path $tempRoot 'enhancer'
    Expand-Archive -LiteralPath $frontendZip -DestinationPath $frontendTemp -Force
    $installer = Join-Path $frontendTemp 'install-windows.ps1'
    if (-not (Test-Path -LiteralPath $installer)) { throw "Enhancer installer is missing from the package." }
    $installerParams = @{
      Port = $DebugPort
      InstallDir = $EnhancerDir
      StateDir = $StateDir
    }
    if ($SkipStart) { $installerParams.SkipStart = $true }
    if ($SkipShortcuts) { $installerParams.SkipShortcuts = $true }
    & $installer @installerParams
    if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw "Enhancer installer exited with code $LASTEXITCODE" }
  }

  [pscustomobject]@{ installed = $true; enhancerDir = $EnhancerDir; backendDir = $BackendDir; backupDir = $backupDir } | ConvertTo-Json -Depth 4
} catch {
  Stop-BackendStartedByThisRun
  if ($backendChanged) { Restore-Backend }
  if ($backendWasHealthy -and -not (Test-BackendHealthy) -and (Test-Path -LiteralPath (Join-Path $BackendDir 'server.js'))) {
    $serverArgument = '"{0}"' -f (Join-Path $BackendDir 'server.js')
    Start-Process -FilePath $nodePath -ArgumentList $serverArgument -WorkingDirectory $BackendDir -WindowStyle Hidden | Out-Null
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
      if (Test-BackendHealthy) { break }
      Start-Sleep -Milliseconds 350
    }
    if (-not (Test-BackendHealthy)) { Write-Warning 'Previous AssetBrowser files were restored, but its service did not restart.' }
  }
  throw
} finally {
  if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force }
}
