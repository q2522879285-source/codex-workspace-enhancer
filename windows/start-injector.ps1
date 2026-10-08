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

function Resolve-NodePath {
  $manifestPath = Join-Path $InstallDir "install-manifest.json"
  if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
    $savedNodePath = [string](Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json).nodePath
    if ($savedNodePath -and (Test-Path -LiteralPath $savedNodePath -PathType Leaf)) { return $savedNodePath }
  }
  return (Get-Command node -ErrorAction Stop).Source
}

# Startup and desktop activation can arrive together; serialize PID/log replacement.
try {
  $injectorLock = [IO.File]::Open((Join-Path $StateDir "injector-start.lock"), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
} catch [IO.IOException] {
  exit 0
}

try {
  if (-not $PSBoundParameters.ContainsKey('Port')) {
    $manifestPath = Join-Path $InstallDir "install-manifest.json"
    if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
      $manifestPort = (Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json).port
      if ($manifestPort -ge 1 -and $manifestPort -le 65535) { $Port = [int]$manifestPort }
    }
    $activePortPath = Join-Path $StateDir "active-port.txt"
    if (Test-Path -LiteralPath $activePortPath -PathType Leaf) {
      $savedPort = 0
      if ([int]::TryParse((Get-Content -LiteralPath $activePortPath -Raw).Trim(), [ref]$savedPort) -and $savedPort -gt 0 -and $savedPort -le 65535) {
        try {
          $targets = Invoke-RestMethod -Uri "http://127.0.0.1:$savedPort/json/list" -TimeoutSec 1
          if (@($targets) | Where-Object { $_.url -eq "app://-/index.html" }) { $Port = $savedPort }
        } catch {
          # A previous debug port may no longer be serving Codex.
        }
      }
    }
  }
  if ($Port -lt 1 -or $Port -gt 65535) { throw "Port must be between 1 and 65535" }
  $nodePath = Resolve-NodePath
  $nodeMajor = [int]((& $nodePath -p "Number(process.versions.node.split('.')[0])").Trim())
  if ($nodeMajor -lt 22) { throw "Node.js 22 or newer is required" }

  & (Join-Path $PSScriptRoot "stop-injector.ps1") -InstallDir $InstallDir -StateDir $StateDir

  # A fresh launch must not inherit the previous attach marker from injector.log.
  Remove-Item -LiteralPath $stdoutPath,$stderrPath -Force -ErrorAction SilentlyContinue

  $process = Start-Process -FilePath $nodePath `
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
} finally {
  $injectorLock.Dispose()
}
