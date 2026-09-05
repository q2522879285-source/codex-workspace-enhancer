param(
  [string]$EnhancerDir = (Join-Path $env:LOCALAPPDATA "Programs\Codex Sidebar Enhancer"),
  [string]$BackendDir = (Join-Path $env:LOCALAPPDATA "Programs\Codex Sidebar Enhancer\asset-browser"),
  [int]$BackendPort = 5177
)

$ErrorActionPreference = "Stop"

function Get-NodeInfo {
  $command = Get-Command node -ErrorAction SilentlyContinue
  if (-not $command) { return [ordered]@{ found = $false; path = $null; version = $null; compatible = $false } }
  $versionText = (& $command.Source --version 2>$null)
  $major = 0
  if ($versionText -match '^v(\d+)') { $major = [int]$Matches[1] }
  return [ordered]@{ found = $true; path = $command.Source; version = $versionText; compatible = ([version]($versionText.TrimStart('v')) -ge [version]'22.13.0') }
}

function Test-BackendHealth {
  param([int]$Port)
  try {
    $tokenPath = Join-Path $env:LOCALAPPDATA 'CodexSidebarEnhancer\asset-browser\.api-token'
    $token = (Get-Content -LiteralPath $tokenPath -Raw -Encoding UTF8).Trim()
    $response = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/projects" -Headers @{ 'x-asset-console-token' = $token } -TimeoutSec 2
    return [ordered]@{ reachable = $true; projects = @($response.projects).Count; error = $null }
  } catch {
    return [ordered]@{ reachable = $false; projects = $null; error = $_.Exception.Message }
  }
}

$codexProcesses = @(Get-CimInstance Win32_Process -Filter "Name='ChatGPT.exe' OR Name='Codex.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath -like '*OpenAI.Codex*' })
$backendServer = Join-Path $BackendDir "server.js"
$backendProcesses = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  $_.CommandLine -and $_.CommandLine.IndexOf($backendServer, [StringComparison]::OrdinalIgnoreCase) -ge 0
})

$result = [ordered]@{
  inspectedAt = [DateTimeOffset]::Now.ToString('o')
  platform = [Environment]::OSVersion.VersionString
  node = Get-NodeInfo
  codex = [ordered]@{
    running = ($codexProcesses.Count -gt 0)
    processCount = $codexProcesses.Count
  }
  enhancer = [ordered]@{
    installed = (Test-Path -LiteralPath (Join-Path $EnhancerDir "scripts\injector.mjs"))
    installDir = $EnhancerDir
    manifest = (Test-Path -LiteralPath (Join-Path $EnhancerDir "install-manifest.json"))
  }
  assetBrowser = [ordered]@{
    installed = (Test-Path -LiteralPath $backendServer)
    installDir = $BackendDir
    configPresent = (Test-Path -LiteralPath (Join-Path $BackendDir "asset-browser.config.json"))
    processCount = $backendProcesses.Count
    health = Test-BackendHealth -Port $BackendPort
  }
}

$result | ConvertTo-Json -Depth 8
