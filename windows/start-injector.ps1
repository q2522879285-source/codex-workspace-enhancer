param(
  [int]$Port = 9231,
  [string]$InstallDir = (Split-Path -Parent $PSScriptRoot),
  [string]$StateDir = (Join-Path $env:LOCALAPPDATA "CodexSidebarEnhancer")
)

$ErrorActionPreference = "Stop"
$injectorPath = Join-Path $InstallDir "scripts\injector.mjs"
$pidPath = Join-Path $StateDir "injector.pid"
$stdoutPath = Join-Path $StateDir "injector.log"
$stderrPath = Join-Path $StateDir "injector.error.log"

New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
if (-not (Test-Path -LiteralPath $injectorPath -PathType Leaf)) {
  throw "Injector not found: $injectorPath"
}

if (Test-Path -LiteralPath $pidPath) {
  $savedPid = 0
  [void][int]::TryParse((Get-Content -LiteralPath $pidPath -Raw).Trim(), [ref]$savedPid)
  if ($savedPid -gt 0) {
    $existing = Get-CimInstance Win32_Process -Filter "ProcessId=$savedPid" -ErrorAction SilentlyContinue
    if ($existing -and $existing.CommandLine -like "*$injectorPath*") {
      exit 0
    }
  }
  Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
}

$node = Get-Command node -ErrorAction Stop
$nodeMajor = [int]((& $node.Source -p "Number(process.versions.node.split('.')[0])").Trim())
if ($nodeMajor -lt 22) { throw "Node.js 22 or newer is required" }

$process = Start-Process -FilePath $node.Source `
  -ArgumentList @("`"$injectorPath`"", "--port", "$Port", "--watch") `
  -WorkingDirectory $InstallDir `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutPath `
  -RedirectStandardError $stderrPath `
  -PassThru

Set-Content -LiteralPath $pidPath -Value $process.Id -Encoding ascii
Start-Sleep -Milliseconds 400
if ($process.HasExited) {
  Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
  $detail = if (Test-Path -LiteralPath $stderrPath) {
    (Get-Content -LiteralPath $stderrPath -Tail 5) -join " "
  } else {
    "The injector exited during startup"
  }
  throw $detail
}
