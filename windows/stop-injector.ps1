param(
  [string]$InstallDir = (Split-Path -Parent $PSScriptRoot),
  [string]$StateDir = (Join-Path $env:LOCALAPPDATA "CodexSidebarEnhancer")
)

$pidPath = Join-Path $StateDir "injector.pid"
$injectorPath = Join-Path $InstallDir "scripts\injector.mjs"

if (Test-Path -LiteralPath $pidPath) {
  $savedPid = 0
  [void][int]::TryParse((Get-Content -LiteralPath $pidPath -Raw).Trim(), [ref]$savedPid)
  if ($savedPid -gt 0) {
    $existing = Get-CimInstance Win32_Process -Filter "ProcessId=$savedPid" -ErrorAction SilentlyContinue
    if ($existing -and $existing.CommandLine -like "*$injectorPath*") {
      Stop-Process -Id $savedPid -Force -ErrorAction SilentlyContinue
    }
  }
  Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
}
