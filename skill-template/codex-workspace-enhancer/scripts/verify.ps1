param(
  [string]$EnhancerDir = (Join-Path $env:LOCALAPPDATA "Programs\Codex Sidebar Enhancer"),
  [string]$BackendDir = (Join-Path $env:LOCALAPPDATA "Programs\Codex Sidebar Enhancer\asset-browser"),
  [int]$BackendPort = 5177,
  [switch]$SkipHealth,
  [switch]$BundleOnly
)

$ErrorActionPreference = "Stop"
$skillRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $skillRoot "assets\runtime\manifest.sha256.json"
if (-not (Test-Path -LiteralPath $manifestPath)) { throw "Missing bundled runtime manifest: $manifestPath" }
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$checks = New-Object System.Collections.Generic.List[object]

function Add-Check([string]$Name, [bool]$Passed, [string]$Detail) {
  $checks.Add([pscustomobject]@{ name = $Name; passed = $Passed; detail = $Detail }) | Out-Null
}

$runtimeRoot = Join-Path $skillRoot 'assets\runtime'
$frontendZip = Join-Path $runtimeRoot 'codex-sidebar-enhancer-windows.zip'
$zipHash = if (Test-Path -LiteralPath $frontendZip) { (Get-FileHash -Algorithm SHA256 -LiteralPath $frontendZip).Hash.ToLowerInvariant() } else { '' }
Add-Check 'bundle:enhancer-zip' ($zipHash -eq $manifest.enhancerZipSha256) $zipHash
foreach ($entry in @($manifest.files | Where-Object { $_.path.StartsWith('asset-browser/') })) {
  $relative = $entry.path.Substring('asset-browser/'.Length) -replace '/', '\'
  $payload = Join-Path (Join-Path $runtimeRoot 'asset-browser') $relative
  $actual = if (Test-Path -LiteralPath $payload) { (Get-FileHash -Algorithm SHA256 -LiteralPath $payload).Hash.ToLowerInvariant() } else { '' }
  Add-Check "bundle:asset-browser/$relative" ($actual -eq $entry.sha256) $actual
}

if ($BundleOnly) {
  $failed = @($checks | Where-Object { -not $_.passed })
  [pscustomobject]@{ passed = ($failed.Count -eq 0); checkedAt = [DateTimeOffset]::Now.ToString('o'); checks = $checks } | ConvertTo-Json -Depth 8
  if ($failed.Count -gt 0) { exit 1 }
  exit 0
}

function Compare-BundledFile([string]$Relative, [string]$InstalledPath) {
  $entry = @($manifest.files | Where-Object { $_.path -eq $Relative })
  if ($entry.Count -ne 1) { Add-Check "manifest:$Relative" $false "Entry missing or duplicated"; return }
  if (-not (Test-Path -LiteralPath $InstalledPath)) { Add-Check "installed:$Relative" $false "Missing: $InstalledPath"; return }
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $InstalledPath).Hash.ToLowerInvariant()
  Add-Check "hash:$Relative" ($actual -eq $entry[0].sha256) $actual
}

$frontendFiles = @(
  'asset-console/public/app.js',
  'asset-console/public/index.html',
  'asset-console/public/ui-v3.css',
  'inject/conversation-preview.user.js',
  'scripts/injector.mjs'
)
foreach ($relative in $frontendFiles) {
  Compare-BundledFile "enhancer/$relative" (Join-Path $EnhancerDir ($relative -replace '/', '\'))
}

$backendFiles = @(
  'server.js', 'folder-operations.js', 'generation-pipeline.js', 'download-automation.js',
  'duplicate-cleaner.js', 'prompt-library.js', 'three-d-workbench.js', 'package.json',
  'public/app.js', 'public/index.html', 'public/ui-v3.css'
)
foreach ($relative in $backendFiles) {
  Compare-BundledFile "asset-browser/$relative" (Join-Path $BackendDir ($relative -replace '/', '\'))
}

$configPath = Join-Path $env:LOCALAPPDATA 'CodexSidebarEnhancer\asset-browser\asset-browser.config.json'
Add-Check 'config:present' (Test-Path -LiteralPath $configPath) $configPath
if (Test-Path -LiteralPath $configPath) {
  try { $null = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json; Add-Check 'config:valid-json' $true 'valid' }
  catch { Add-Check 'config:valid-json' $false $_.Exception.Message }
}

if (-not $SkipHealth) {
  try {
    $tokenPath = Join-Path $env:LOCALAPPDATA 'CodexSidebarEnhancer\asset-browser\.api-token'
    if (-not (Test-Path -LiteralPath $tokenPath)) { throw "Missing API token: $tokenPath" }
    $token = (Get-Content -LiteralPath $tokenPath -Raw -Encoding UTF8).Trim()
    if ($token.Length -lt 32) { throw "Invalid API token: $tokenPath" }
    $response = Invoke-RestMethod -Uri "http://127.0.0.1:$BackendPort/api/projects" -Headers @{ 'x-asset-console-token' = $token } -TimeoutSec 4
    Add-Check 'asset-browser:health' $true ("projects=" + @($response.projects).Count)
  } catch {
    Add-Check 'asset-browser:health' $false $_.Exception.Message
  }
}

$failed = @($checks | Where-Object { -not $_.passed })
[pscustomobject]@{
  passed = ($failed.Count -eq 0)
  checkedAt = [DateTimeOffset]::Now.ToString('o')
  checks = $checks
} | ConvertTo-Json -Depth 8
if ($failed.Count -gt 0) { exit 1 }
