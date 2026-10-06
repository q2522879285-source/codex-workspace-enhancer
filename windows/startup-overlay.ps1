param(
  [Parameter(Mandatory = $true)] [string]$VideoPath,
  [Parameter(Mandatory = $true)] [string]$ReadyPath,
  [Parameter(Mandatory = $true)] [string]$AbortPath,
  [int]$FadeInMilliseconds = 3000,
  [int]$FadeOutMilliseconds = 1000,
  [int]$PostVideoHoldMilliseconds = 250,
  [int]$MaxWaitSeconds = 75
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName WindowsBase
if (-not (Test-Path -LiteralPath $VideoPath -PathType Leaf)) { exit 0 }
$ffplay = (Get-Command ffplay.exe -ErrorAction SilentlyContinue).Source
if (-not $ffplay) {
  $localToolsRoot = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
  if (Test-Path -LiteralPath $localToolsRoot -PathType Container) {
    $ffplay = Get-ChildItem -LiteralPath $localToolsRoot -Filter 'ffplay.exe' -File -Recurse -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName -First 1
  }
}
if (-not $ffplay) { exit 0 }
$state = @{ closed = $false; fadingOut = $false; started = [Diagnostics.Stopwatch]::StartNew(); endedAt = $null; fadeInStart = [Diagnostics.Stopwatch]::StartNew(); fadeOutStart = $null; fadeOutTimer = $null }
$maskWindow = New-Object System.Windows.Window
$maskWindow.WindowStyle = [System.Windows.WindowStyle]::None
$maskWindow.ResizeMode = [System.Windows.ResizeMode]::NoResize
$maskWindow.WindowState = [System.Windows.WindowState]::Normal
$maskWindow.Topmost = $true
$maskWindow.ShowInTaskbar = $false
$maskWindow.ShowActivated = $true
$maskWindow.Background = [System.Windows.Media.Brushes]::Black
$maskWindow.Left = [System.Windows.SystemParameters]::VirtualScreenLeft
$maskWindow.Top = [System.Windows.SystemParameters]::VirtualScreenTop
$maskWindow.Width = [System.Windows.SystemParameters]::VirtualScreenWidth
$maskWindow.Height = [System.Windows.SystemParameters]::VirtualScreenHeight
$maskWindow.Opacity = 1
$ffplayProcess = $null
function Stop-Overlay {
  if ($state.closed) { return }
  $state.closed = $true
  try { if ($ffplayProcess -and -not $ffplayProcess.HasExited) { $ffplayProcess.Kill() } } catch {}
  try { $maskWindow.Close() } catch {}
}
function Start-FadeOut {
  if ($state.fadingOut -or $state.closed) { return }
  $state.fadingOut = $true
  $state.fadeOutStart = [Diagnostics.Stopwatch]::StartNew()
  $state.fadeOutTimer = New-Object System.Windows.Threading.DispatcherTimer
  $state.fadeOutTimer.Interval = [TimeSpan]::FromMilliseconds(20)
  $state.fadeOutTimer.Add_Tick({
    $progress = [Math]::Min(1, $state.fadeOutStart.Elapsed.TotalMilliseconds / [Math]::Max(1, $FadeOutMilliseconds))
    $maskWindow.Opacity = 1 - $progress
    if ($progress -ge 1) { $state.fadeOutTimer.Stop(); Stop-Overlay }
  })
  $state.fadeOutTimer.Start()
}
$maskWindow.Add_Closed({
  $state.closed = $true
  try { Remove-Item -LiteralPath $ReadyPath,$AbortPath -Force -ErrorAction SilentlyContinue } catch {}
  [System.Windows.Threading.Dispatcher]::CurrentDispatcher.InvokeShutdown()
})
$maskWindow.Show()
$maskWindow.Activate()
$ffplayArgs = @('-hide_banner','-loglevel','error','-nostats','-autoexit','-noborder','-fs','-alwaysontop',('"' + $VideoPath + '"'))
$ffplayProcess = Start-Process -FilePath $ffplay -ArgumentList $ffplayArgs -WindowStyle Normal -PassThru
$maskWindow.Activate()
$fadeTimer = New-Object System.Windows.Threading.DispatcherTimer
$fadeTimer.Interval = [TimeSpan]::FromMilliseconds(20)
$fadeTimer.Add_Tick({
  $progress = [Math]::Min(1, $state.fadeInStart.Elapsed.TotalMilliseconds / [Math]::Max(1, $FadeInMilliseconds))
  $maskWindow.Opacity = 1 - ($progress * $progress * (3 - (2 * $progress)))
  if ($progress -ge 1) { $fadeTimer.Stop() }
})
$fadeTimer.Start()
$watchTimer = New-Object System.Windows.Threading.DispatcherTimer
$watchTimer.Interval = [TimeSpan]::FromMilliseconds(100)
$watchTimer.Add_Tick({
  if ($state.closed -or $state.fadingOut) { return }
  $ready = Test-Path -LiteralPath $ReadyPath
  $abort = Test-Path -LiteralPath $AbortPath
  $timedOut = $state.started.Elapsed.TotalSeconds -ge $MaxWaitSeconds
  $ended = $ffplayProcess.HasExited
  if ($ended -and -not $state.endedAt) { $state.endedAt = $state.started.Elapsed.TotalMilliseconds }
  if ($abort -or $timedOut) { Start-FadeOut; return }
  $holdComplete = $state.endedAt -and (($state.started.Elapsed.TotalMilliseconds - $state.endedAt) -ge [Math]::Max(0, $PostVideoHoldMilliseconds))
  if ($ready -and $holdComplete) { Start-FadeOut }
})
$watchTimer.Start()
[System.Windows.Threading.Dispatcher]::Run()
