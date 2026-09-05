param(
  [int]$Port = 9231,
  [string]$InstallDir = (Split-Path -Parent $PSScriptRoot),
  [string]$StateDir = (Join-Path $env:LOCALAPPDATA "CodexSidebarEnhancer")
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
$launcherLog = Join-Path $StateDir "launcher.log"

function Write-LauncherLog([string]$Message) {
  Add-Content -LiteralPath $launcherLog -Value "$(Get-Date -Format o) $Message" -Encoding utf8
}

function Test-LocalPort([int]$Number) {
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $task = $client.ConnectAsync("127.0.0.1", $Number)
    return $task.Wait(500) -and $client.Connected
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Test-CodexDebugPort([int]$Number) {
  try {
    $targets = Invoke-RestMethod -Uri "http://127.0.0.1:$Number/json/list" -TimeoutSec 1
    $codexTarget = @($targets) | Where-Object { $_.url -eq "app://-/index.html" } | Select-Object -First 1
    return [bool]$codexTarget
  } catch {
    return $false
  }
}

try {
  & (Join-Path $PSScriptRoot "start-injector.ps1") -Port $Port -InstallDir $InstallDir -StateDir $StateDir

  $package = Get-AppxPackage -Name "OpenAI.Codex" -ErrorAction Stop | Sort-Object Version -Descending | Select-Object -First 1
  $codexExe = Join-Path $package.InstallLocation "app\ChatGPT.exe"
  if (-not (Test-Path -LiteralPath $codexExe -PathType Leaf)) { throw "Codex executable not found" }

  if (Test-LocalPort $Port) {
    if (-not (Test-CodexDebugPort $Port)) {
      throw "Port $Port is already in use by another application"
    }
    Start-Process -FilePath $codexExe
    Write-LauncherLog "Activated an existing enhanced Codex instance."
    exit 0
  }

  $mainProcesses = Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq "ChatGPT.exe" -and
    $_.ExecutablePath -like "*OpenAI.Codex*" -and
    $_.CommandLine -notmatch "--type="
  }
  if ($mainProcesses) {
    Write-LauncherLog "Codex is running without debugging. Close it normally, then launch this shortcut again."
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show("请先正常退出 Codex，再打开增强器快捷方式。当前任务不会被关闭。", "Codex 侧栏增强器", "OK", "Information") | Out-Null
    exit 0
  }

  Start-Process -FilePath $codexExe -ArgumentList @(
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=$Port",
    "--remote-allow-origins=http://127.0.0.1:$Port",
    "--enable-features=LocalNetworkAccessForSubframeNavigationsWarningOnly"
  )

  $deadline = (Get-Date).AddSeconds(15)
  while ((Get-Date) -lt $deadline -and -not (Test-CodexDebugPort $Port)) {
    Start-Sleep -Milliseconds 250
  }
  if (-not (Test-CodexDebugPort $Port)) { throw "Codex did not open a valid local debugging target" }
  Write-LauncherLog "Started Codex with the sidebar enhancer on 127.0.0.1:$Port."
} catch {
  Write-LauncherLog "ERROR: $($_.Exception.Message)"
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show(
    "启动失败。详情已记录到：`n$launcherLog",
    "Codex 侧栏增强器",
    "OK",
    "Error"
  ) | Out-Null
  exit 1
}
