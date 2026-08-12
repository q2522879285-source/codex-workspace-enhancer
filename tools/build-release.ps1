param(
  [string]$OutputDir = (Join-Path (Split-Path -Parent $PSScriptRoot) '.release'),
  [string]$OnepagerPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'docs\codex-workspace-enhancer-onepage.png')
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$outputRoot = [IO.Path]::GetFullPath($OutputDir)
$expectedParent = [IO.Path]::GetFullPath($repoRoot)
if (-not $outputRoot.StartsWith($expectedParent, [StringComparison]::OrdinalIgnoreCase)) {
  throw "OutputDir must stay inside the repository: $outputRoot"
}

$workRoot = Join-Path $outputRoot '.build'
if (Test-Path -LiteralPath $outputRoot) { Remove-Item -LiteralPath $outputRoot -Recurse -Force }
New-Item -ItemType Directory -Path $workRoot -Force | Out-Null

function Copy-Tree([string]$Source, [string]$Destination) {
  if (-not (Test-Path -LiteralPath $Source)) { throw "Missing build input: $Source" }
  New-Item -ItemType Directory -Path (Split-Path -Parent $Destination) -Force | Out-Null
  Copy-Item -LiteralPath $Source -Destination $Destination -Recurse -Force
}

function Write-ShaSidecar([string]$FilePath) {
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $FilePath).Hash.ToLowerInvariant()
  $line = "$hash  $([IO.Path]::GetFileName($FilePath))`n"
  [IO.File]::WriteAllText("$FilePath.sha256.txt", $line, (New-Object Text.UTF8Encoding($false)))
}

try {
  $frontendRoot = Join-Path $workRoot 'frontend'
  New-Item -ItemType Directory -Path $frontendRoot -Force | Out-Null
  $frontendFiles = @(
    'LICENSE', 'README.md', 'README-Windows.txt', 'VERIFICATION.txt', 'package.json',
    'install-windows.ps1', 'install.sh', 'uninstall.sh'
  )
  foreach ($relative in $frontendFiles) {
    $source = Join-Path $repoRoot $relative
    if (Test-Path -LiteralPath $source) { Copy-Tree $source (Join-Path $frontendRoot $relative) }
  }
  foreach ($relative in @('asset-console', 'inject', 'lib', 'scripts', 'windows')) {
    Copy-Tree (Join-Path $repoRoot $relative) (Join-Path $frontendRoot $relative)
  }

  $windowsZip = Join-Path $outputRoot 'codex-sidebar-enhancer-windows.zip'
  Compress-Archive -Path (Join-Path $frontendRoot '*') -DestinationPath $windowsZip -CompressionLevel Optimal
  Write-ShaSidecar $windowsZip

  $skillStage = Join-Path $workRoot 'skill'
  $skillRoot = Join-Path $skillStage 'codex-workspace-enhancer'
  Copy-Tree (Join-Path $repoRoot 'skill-template\codex-workspace-enhancer') $skillRoot
  $runtimeRoot = Join-Path $skillRoot 'assets\runtime'
  New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
  Copy-Tree $windowsZip (Join-Path $runtimeRoot 'codex-sidebar-enhancer-windows.zip')

  $backendPayload = Join-Path $runtimeRoot 'asset-browser'
  Copy-Tree (Join-Path $repoRoot 'asset-browser') $backendPayload
  if (Test-Path -LiteralPath (Join-Path $backendPayload 'public')) { Remove-Item -LiteralPath (Join-Path $backendPayload 'public') -Recurse -Force }
  Copy-Tree (Join-Path $repoRoot 'asset-console\public') (Join-Path $backendPayload 'public')

  if (Test-Path -LiteralPath $OnepagerPath) {
    Copy-Tree $OnepagerPath (Join-Path $skillRoot 'assets\onepager.png')
  }

  $manifestEntries = New-Object System.Collections.Generic.List[object]
  Get-ChildItem -LiteralPath $frontendRoot -Recurse -File | Sort-Object FullName | ForEach-Object {
    $relative = $_.FullName.Substring($frontendRoot.Length).TrimStart('\').Replace('\', '/')
    $manifestEntries.Add([ordered]@{
      path = "enhancer/$relative"
      sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant()
      size = $_.Length
    }) | Out-Null
  }
  Get-ChildItem -LiteralPath $backendPayload -Recurse -File | Sort-Object FullName | ForEach-Object {
    $relative = $_.FullName.Substring($backendPayload.Length).TrimStart('\').Replace('\', '/')
    $manifestEntries.Add([ordered]@{
      path = "asset-browser/$relative"
      sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant()
      size = $_.Length
    }) | Out-Null
  }
  $manifest = [ordered]@{
    schemaVersion = 1
    enhancerZipSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $windowsZip).Hash.ToLowerInvariant()
    files = $manifestEntries
  }
  $manifestJson = $manifest | ConvertTo-Json -Depth 8
  [IO.File]::WriteAllText((Join-Path $runtimeRoot 'manifest.sha256.json'), $manifestJson + "`n", (New-Object Text.UTF8Encoding($false)))

  $skillZip = Join-Path $outputRoot 'codex-workspace-enhancer-skill.zip'
  Compress-Archive -Path $skillRoot -DestinationPath $skillZip -CompressionLevel Optimal
  Write-ShaSidecar $skillZip

  Remove-Item -LiteralPath $workRoot -Recurse -Force
  [pscustomobject]@{
    outputDir = $outputRoot
    windowsZip = $windowsZip
    windowsSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $windowsZip).Hash.ToLowerInvariant()
    skillZip = $skillZip
    skillSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $skillZip).Hash.ToLowerInvariant()
  } | ConvertTo-Json -Depth 4
} catch {
  if (Test-Path -LiteralPath $workRoot) { Remove-Item -LiteralPath $workRoot -Recurse -Force }
  throw
}
