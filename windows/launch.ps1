param(
  [int]$Port = 9231,
  [string]$InstallDir = (Split-Path -Parent $PSScriptRoot),
  [string]$StateDir = (Join-Path $env:LOCALAPPDATA "CodexSidebarEnhancer")
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
$launcherLog = Join-Path $StateDir "launcher.log"
$activePortPath = Join-Path $StateDir "active-port.txt"
$startupReadyPath = Join-Path $StateDir "startup-ready.flag"
$startupAbortPath = Join-Path $StateDir "startup-abort.flag"
$startupSettingsPath = Join-Path $StateDir "startup-settings.json"
$startupVideoDirectory = Join-Path $StateDir "startup-videos"
$startupVideoExtensions = @('.mp4', '.m4v', '.wmv', '.avi', '.mov', '.mkv', '.webm')
$startupVideoPath = $null
$startupOverlayPath = Join-Path $PSScriptRoot "startup-overlay.ps1"
$injectorLogPath = Join-Path $StateDir "injector.log"

function Write-LauncherLog([string]$Message) {
  Add-Content -LiteralPath $launcherLog -Value "$(Get-Date -Format o) $Message" -Encoding utf8
}

function Read-StartupSettings {
  $defaults = [ordered]@{
    enabled = $true
    mode = 'random'
    selectedVideo = ''
    customVideos = @()
  }
  if (-not (Test-Path -LiteralPath $startupSettingsPath -PathType Leaf)) {
    return [pscustomobject]$defaults
  }
  try {
    $saved = Get-Content -LiteralPath $startupSettingsPath -Raw -Encoding utf8 | ConvertFrom-Json
    if ($null -ne $saved.enabled) { $defaults.enabled = [bool]$saved.enabled }
    if ([string]$saved.mode -in @('random', 'specific')) { $defaults.mode = [string]$saved.mode }
    if ($null -ne $saved.selectedVideo) { $defaults.selectedVideo = [string]$saved.selectedVideo }
    if ($saved.customVideos -is [System.Collections.IEnumerable]) { $defaults.customVideos = @($saved.customVideos) }
  } catch {
    Write-LauncherLog "Startup settings could not be read; using defaults: $($_.Exception.Message)"
  }
  return [pscustomobject]$defaults
}

function Get-StartupVideoCatalog([object]$Settings) {
  $catalog = @()
  $assetRoot = Join-Path $InstallDir 'assets'
  if (Test-Path -LiteralPath $assetRoot -PathType Container) {
    foreach ($file in @(Get-ChildItem -LiteralPath $assetRoot -File -ErrorAction SilentlyContinue | Where-Object {
      $_.Name -like 'startup-*.mp4' -and $_.Extension.ToLowerInvariant() -in $startupVideoExtensions
    })) {
      $catalog += [pscustomobject]@{ id = $file.Name; name = $file.BaseName; path = $file.FullName; source = 'builtin' }
    }
  }
  foreach ($entry in @($Settings.customVideos)) {
    $fileName = if ($entry -is [string]) { [string]$entry } else { [string]$entry.file }
    if ([string]::IsNullOrWhiteSpace($fileName)) { continue }
    $candidate = if ([IO.Path]::IsPathRooted($fileName)) { $fileName } else { Join-Path $startupVideoDirectory $fileName }
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
    $file = Get-Item -LiteralPath $candidate
    if ($file.Extension.ToLowerInvariant() -notin $startupVideoExtensions) { continue }
    $id = if ($entry -is [string]) { $file.Name } else { [string]$entry.id }
    if ([string]::IsNullOrWhiteSpace($id)) { $id = $file.Name }
    $name = if ($entry -is [string]) { $file.BaseName } else { [string]$entry.name }
    if ([string]::IsNullOrWhiteSpace($name)) { $name = $file.BaseName }
    $catalog += [pscustomobject]@{ id = $id; name = $name; path = $file.FullName; source = 'custom' }
  }
  return @($catalog | Sort-Object source, name)
}

function Select-StartupVideo([object]$Settings, [object[]]$Catalog) {
  if ($Settings.enabled -eq $false -or $Catalog.Count -eq 0) { return $null }
  if ($Settings.mode -eq 'specific' -and -not [string]::IsNullOrWhiteSpace([string]$Settings.selectedVideo)) {
    $selected = $Catalog | Where-Object {
      $_.id -eq [string]$Settings.selectedVideo -or $_.name -eq [string]$Settings.selectedVideo -or (Split-Path -Leaf $_.path) -eq [string]$Settings.selectedVideo
    } | Select-Object -First 1
    if ($selected) { return $selected }
  }
  if ($Settings.mode -eq 'random') { return $Catalog | Get-Random }
  return $Catalog | Select-Object -First 1
}

function Start-StartupOverlay {
  param([string]$VideoPath)
  if ([string]::IsNullOrWhiteSpace($VideoPath)) {
    Write-LauncherLog "Startup animation is disabled or no usable video is configured."
    return $null
  }
  if (-not (Test-Path -LiteralPath $VideoPath -PathType Leaf)) {
    Write-LauncherLog "Startup animation video not found; continuing without overlay."
    return $null
  }
  if (-not (Test-Path -LiteralPath $startupOverlayPath -PathType Leaf)) {
    Write-LauncherLog "Startup overlay script not found; continuing without overlay."
    return $null
  }

  Remove-Item -LiteralPath $startupReadyPath,$startupAbortPath -Force -ErrorAction SilentlyContinue
  $powershellExe = Join-Path $PSHOME "powershell.exe"
  $arguments = @(
    "-NoProfile",
    "-ExecutionPolicy Bypass",
    "-WindowStyle Hidden",
    "-File `"$startupOverlayPath`"",
    "-VideoPath `"$VideoPath`"",
    "-ReadyPath `"$startupReadyPath`"",
    "-AbortPath `"$startupAbortPath`""
  ) -join ' '
  try {
    $overlay = Start-Process -FilePath $powershellExe -ArgumentList $arguments -WindowStyle Hidden -PassThru
    Write-LauncherLog "Started startup animation overlay PID $($overlay.Id)."
    return $overlay
  } catch {
    Write-LauncherLog "Startup animation overlay could not start: $($_.Exception.Message)"
    return $null
  }
}

function Signal-StartupReady {
  Set-Content -LiteralPath $startupReadyPath -Value (Get-Date -Format o) -Encoding ascii
  Write-LauncherLog "Codex home became stable; releasing startup overlay."
}

function Signal-StartupAbort {
  Set-Content -LiteralPath $startupAbortPath -Value (Get-Date -Format o) -Encoding ascii
}

function Wait-InjectorReady([int]$TimeoutSeconds = 45) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  # Release once the injector has attached and rendered the home.  A dynamic
  # thread can legitimately use the injector's stability timeout fallback;
  # keeping the overlay past that marker leaves the user on a black screen.
  $pattern = '^Codex conversation preview ready(?: \(stability timeout fallback\))?\s*$'
  do {
    if (Test-Path -LiteralPath $injectorLogPath -PathType Leaf) {
      try {
        if (Select-String -LiteralPath $injectorLogPath -Pattern $pattern -Quiet) {
          Write-LauncherLog "Codex home is ready; releasing startup overlay."
          return $true
        }
      } catch {
        # The injector may still have the log open while it is writing its first line.
      }
    }
    Start-Sleep -Milliseconds 200
  } while ((Get-Date) -lt $deadline)
  return $false
}

function Ensure-CodexMaximized([int]$ProcessId = 0) {
  if (-not ('CodexSidebar.WindowApi' -as [type])) {
    Add-Type @'
using System;
using System.Runtime.InteropServices;
namespace CodexSidebar {
  public static class WindowApi {
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  }
}
'@
  }

  $deadline = (Get-Date).AddSeconds(10)
  do {
    $candidates = @()
    if ($ProcessId -gt 0) {
      $specific = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
      if ($specific) { $candidates += $specific }
    }
    $candidates += @(Get-Process -Name "ChatGPT" -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne $ProcessId })
    foreach ($process in $candidates) {
      try {
        $process.Refresh()
        $handle = [IntPtr]$process.MainWindowHandle
        if ($handle -eq [IntPtr]::Zero) { continue }
        [void][CodexSidebar.WindowApi]::ShowWindowAsync($handle, 3)
        [void][CodexSidebar.WindowApi]::SetForegroundWindow($handle)
        Write-LauncherLog "Maximized Codex main window (PID $($process.Id))."
        return $true
      } catch {
        # A renderer process can disappear while the main window is being created.
      }
    }
    Start-Sleep -Milliseconds 200
  } while ((Get-Date) -lt $deadline)
  Write-LauncherLog "Codex main window was not available for maximization."
  return $false
}

function Start-CodexPackage([string]$AppUserModelId, [string]$Arguments = '') {
  if (-not ('CodexSidebar.PackageLauncher' -as [type])) {
    Add-Type @'
using System;
using System.Runtime.InteropServices;
namespace CodexSidebar {
  [ComImport, Guid("2E941141-7F97-4756-BA1D-9DECDE894A3D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IApplicationActivationManager {
    [PreserveSig] int ActivateApplication(
      [MarshalAs(UnmanagedType.LPWStr)] string appId,
      [MarshalAs(UnmanagedType.LPWStr)] string arguments, uint options, out uint processId);
    [PreserveSig] int ActivateForFile(
      [MarshalAs(UnmanagedType.LPWStr)] string appId, IntPtr items,
      [MarshalAs(UnmanagedType.LPWStr)] string verb, out uint processId);
    [PreserveSig] int ActivateForProtocol(
      [MarshalAs(UnmanagedType.LPWStr)] string appId, IntPtr items, out uint processId);
  }
  public static class PackageLauncher {
    public static uint Start(string appId, string arguments) {
      object instance = Activator.CreateInstance(Type.GetTypeFromCLSID(
        new Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C")));
      try {
        uint processId;
        int result = ((IApplicationActivationManager)instance).ActivateApplication(
          appId, arguments, 2, out processId);
        Marshal.ThrowExceptionForHR(result);
        return processId;
      } finally { Marshal.ReleaseComObject(instance); }
    }
  }
}
'@
  }
  # Registered activation preserves the MSIX identity required by Codex.
  return [CodexSidebar.PackageLauncher]::Start($AppUserModelId, $Arguments)
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

function Get-AvailableDebugPort([int]$PreferredPort) {
  foreach ($candidate in @($PreferredPort, 0)) {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $candidate)
    try {
      $listener.Server.ExclusiveAddressUse = $true
      $listener.Start()
      return $listener.LocalEndpoint.Port
    } catch [System.Net.Sockets.SocketException] {
      if ($candidate -eq 0) { throw }
    } finally {
      $listener.Stop()
    }
  }
}

try {
  Write-LauncherLog "Launcher started (PID $PID)."
  $startupSettings = Read-StartupSettings
  $startupVideoCatalog = Get-StartupVideoCatalog $startupSettings
  $startupVideoSelection = Select-StartupVideo $startupSettings $startupVideoCatalog
  $startupVideoPath = if ($startupVideoSelection) { [string]$startupVideoSelection.path } else { $null }
  if ($startupVideoSelection) {
    Write-LauncherLog "Selected startup animation '$($startupVideoSelection.name)' ($($startupSettings.mode))."
  }
  $startupOverlay = Start-StartupOverlay $startupVideoPath
  if (-not $PSBoundParameters.ContainsKey('Port') -and (Test-Path -LiteralPath $activePortPath)) {
    $savedPort = 0
    if ([int]::TryParse((Get-Content -LiteralPath $activePortPath -Raw).Trim(), [ref]$savedPort) -and $savedPort -gt 0 -and $savedPort -le 65535) {
      $Port = $savedPort
    }
  }
  $package = Get-AppxPackage -Name "OpenAI.Codex" -ErrorAction Stop | Sort-Object Version -Descending | Select-Object -First 1
  $codexExe = Join-Path $package.InstallLocation "app\ChatGPT.exe"
  if (-not (Test-Path -LiteralPath $codexExe -PathType Leaf)) { throw "Codex executable not found" }
  $manifest = Get-AppxPackageManifest -Package $package.PackageFullName
  $application = @($manifest.Package.Applications.Application) | Where-Object {
    ($_.Executable -replace '/', '\') -eq 'app\ChatGPT.exe'
  } | Select-Object -First 1
  if (-not $application) { throw "Codex application registration not found" }
  $appUserModelId = "$($package.PackageFamilyName)!$($application.Id)"

  if (Test-LocalPort $Port) {
    if (Test-CodexDebugPort $Port) {
      & (Join-Path $PSScriptRoot "start-injector.ps1") -Port $Port -InstallDir $InstallDir -StateDir $StateDir
      Set-Content -LiteralPath $activePortPath -Value $Port -Encoding ascii
      $existingCodexProcessId = Start-CodexPackage $appUserModelId '--start-maximized'
      if (-not (Wait-InjectorReady)) { throw "Codex sidebar injector did not attach to the renderer" }
      Ensure-CodexMaximized $existingCodexProcessId | Out-Null
      Signal-StartupReady
      Write-LauncherLog "Activated an existing enhanced Codex instance."
      exit 0
    }
    Write-LauncherLog "Releasing the stale sidebar connection before starting Codex."
    & (Join-Path $PSScriptRoot "stop-injector.ps1") -InstallDir $InstallDir -StateDir $StateDir
    Start-Sleep -Milliseconds 500
  }

  $availablePort = Get-AvailableDebugPort $Port
  if ($availablePort -ne $Port) {
    Write-LauncherLog "Port $Port cannot be bound; using available loopback port $availablePort."
    $Port = $availablePort
  }

  $mainProcesses = Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq "ChatGPT.exe" -and
    $_.ExecutablePath -like "*OpenAI.Codex*" -and
    $_.CommandLine -notmatch "--type="
  }
  foreach ($item in $mainProcesses) {
    Write-LauncherLog "Closing Codex PID $($item.ProcessId) before enabling the sidebar connection."
    $process = Get-Process -Id $item.ProcessId -ErrorAction SilentlyContinue
    if ($process) { [void]$process.CloseMainWindow() }
  }

  if ($mainProcesses) {
    $deadline = (Get-Date).AddSeconds(8)
    do {
      Start-Sleep -Milliseconds 250
      $remaining = @($mainProcesses | Where-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue })
    } while ($remaining.Count -gt 0 -and (Get-Date) -lt $deadline)
    foreach ($item in $remaining) {
      Stop-Process -Id $item.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 500
  }

  if (Test-LocalPort $Port) {
    throw "Port $Port is already in use by another application"
  }

  $arguments = @(
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=$Port",
    "--remote-allow-origins=http://127.0.0.1:$Port",
    "--enable-features=LocalNetworkAccessForSubframeNavigationsWarningOnly",
    "--start-maximized"
  ) -join ' '
  Write-LauncherLog "Activating $appUserModelId with loopback debugging on $Port."
  $codexProcessId = Start-CodexPackage $appUserModelId $arguments
  Write-LauncherLog "Activated Codex PID $codexProcessId; waiting for its debugging target."

  $deadline = (Get-Date).AddSeconds(15)
  while ((Get-Date) -lt $deadline -and -not (Test-CodexDebugPort $Port)) {
    Start-Sleep -Milliseconds 250
  }
  if (-not (Test-CodexDebugPort $Port)) { throw "Codex did not open a valid local debugging target" }
  & (Join-Path $PSScriptRoot "start-injector.ps1") -Port $Port -InstallDir $InstallDir -StateDir $StateDir
  Set-Content -LiteralPath $activePortPath -Value $Port -Encoding ascii
  if (-not (Wait-InjectorReady)) { throw "Codex sidebar injector did not attach to the renderer" }
  Ensure-CodexMaximized $codexProcessId | Out-Null
  Signal-StartupReady
  Write-LauncherLog "Started Codex with the sidebar enhancer on 127.0.0.1:$Port."
} catch {
  Signal-StartupAbort
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
