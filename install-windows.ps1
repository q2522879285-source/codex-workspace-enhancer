param(
  [int]$Port = 9231,
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA "Programs\Codex Sidebar Enhancer"),
  [string]$StateDir = (Join-Path $env:LOCALAPPDATA "CodexSidebarEnhancer"),
  [switch]$SkipShortcuts,
  [switch]$SkipStart
)

$ErrorActionPreference = "Stop"
$sourceDir = $PSScriptRoot
$installParent = Split-Path -Parent $InstallDir
$stagingDir = Join-Path $installParent ".CodexSidebarEnhancer-new-$PID"
$backupDir = Join-Path $installParent ".CodexSidebarEnhancer-previous-$PID"
$backupMade = $false
$hadExisting = $false
$hadExistingState = $false
$installPlaced = $false
$stagingCreated = $false
$stateCreatedByThisRun = $false
$shortcutsTouched = $false
$shortcutPaths = @()
$shortcutBackups = @()
$shortcutBackupDir = $null
$persistentShortcutBackupDir = $null
$persistentShortcutBackupCreated = $false
$stateMarkerName = ".codex-sidebar-enhancer-owned"
$stateMarkerValue = "Codex Sidebar Enhancer state v1"

function New-Shortcut {
  param(
    [string]$Path,
    [string]$ScriptPath,
    [string]$IconPath,
    [string]$ScriptArguments = "",
    [bool]$Hidden = $true
  )
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($Path)
  $shortcut.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
  $windowStyle = if ($Hidden) { " -WindowStyle Hidden" } else { "" }
  $arguments = "-NoProfile -ExecutionPolicy Bypass$windowStyle -File `"$ScriptPath`""
  if ($ScriptArguments) { $arguments += " $ScriptArguments" }
  $shortcut.Arguments = $arguments
  # Keep every shortcut's current directory outside the owned install tree so
  # the uninstaller can remove that tree while it is running.
  $shortcut.WorkingDirectory = $env:LOCALAPPDATA
  if ($IconPath) { $shortcut.IconLocation = "$IconPath,0" }
  $shortcut.Save()
}

function Stop-ExistingInjector {
  $backendServer = Join-Path $InstallDir "asset-browser\server.js"
  Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq 'node.exe' -and $_.CommandLine -and $_.CommandLine.Contains($backendServer)
  } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop }
  $pidPath = Join-Path $StateDir "injector.pid"
  if (-not (Test-Path -LiteralPath $pidPath)) { return }
  $savedPid = 0
  [void][int]::TryParse((Get-Content -LiteralPath $pidPath -Raw).Trim(), [ref]$savedPid)
  if ($savedPid -gt 0) {
    $existing = Get-CimInstance Win32_Process -Filter "ProcessId=$savedPid" -ErrorAction SilentlyContinue
    if ($existing -and $existing.CommandLine -like "*$InstallDir*injector.mjs*") {
      Stop-Process -Id $savedPid -Force -ErrorAction SilentlyContinue
      Start-Sleep -Milliseconds 300
    }
  }
  Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
}

try {
  if (-not $env:LOCALAPPDATA) { throw "LOCALAPPDATA is not available" }
  if ($Port -lt 1 -or $Port -gt 65535) { throw "Port must be between 1 and 65535" }
  $resolvedInstall = [IO.Path]::GetFullPath($InstallDir).TrimEnd('\')
  $resolvedState = [IO.Path]::GetFullPath($StateDir).TrimEnd('\')
  $expectedInstall = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "Programs\Codex Sidebar Enhancer")).TrimEnd('\')
  $expectedState = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "CodexSidebarEnhancer")).TrimEnd('\')
  if (-not $resolvedInstall.Equals($expectedInstall, [StringComparison]::OrdinalIgnoreCase) -or
      -not $resolvedState.Equals($expectedState, [StringComparison]::OrdinalIgnoreCase)) {
    throw "InstallDir and StateDir must use the dedicated Codex Sidebar Enhancer directories under LOCALAPPDATA"
  }
  if ($resolvedInstall.Equals([IO.Path]::GetFullPath($sourceDir).TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) {
    throw "Run the installer from outside the destination directory"
  }
  $InstallDir = $resolvedInstall
  $StateDir = $resolvedState
  $installParent = Split-Path -Parent $InstallDir
  $stagingDir = Join-Path $installParent ".CodexSidebarEnhancer-new-$PID"
  $backupDir = Join-Path $installParent ".CodexSidebarEnhancer-previous-$PID"
  $persistentShortcutBackupDir = Join-Path $StateDir "shortcut-backup"

  $hadExisting = Test-Path -LiteralPath $InstallDir
  $hadExistingState = Test-Path -LiteralPath $StateDir
  $existingManifest = $null
  if ($hadExisting) {
    $existingManifestPath = Join-Path $InstallDir "install-manifest.json"
    if (-not (Test-Path -LiteralPath $existingManifestPath -PathType Leaf)) {
      throw "Existing destination is not owned by Codex Sidebar Enhancer"
    }
    $existingManifest = Get-Content -LiteralPath $existingManifestPath -Raw | ConvertFrom-Json
    if ($existingManifest.name -ne "Codex Sidebar Enhancer" -or
        -not $existingManifest.stateDir -or
        -not ([IO.Path]::GetFullPath([string]$existingManifest.stateDir).TrimEnd('\')).Equals($resolvedState, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Existing destination has an invalid ownership manifest"
    }
  }
  if ($hadExistingState) {
    if (-not (Test-Path -LiteralPath $StateDir -PathType Container)) {
      throw "Existing state path is not a directory"
    }
    $markerPath = Join-Path $StateDir $stateMarkerName
    $markerValid = (Test-Path -LiteralPath $markerPath -PathType Leaf) -and
      ((Get-Content -LiteralPath $markerPath -Raw).Trim() -eq $stateMarkerValue)
    $stateItems = @(Get-ChildItem -LiteralPath $StateDir -Force)
    if (-not $markerValid -and -not $existingManifest -and $stateItems.Count -gt 0) {
      throw "Existing state directory is not owned by Codex Sidebar Enhancer"
    }
  }
  $node = Get-Command node -ErrorAction Stop
  $nodeVersion = [version]((& $node.Source -p "process.versions.node").Trim())
  if ($nodeVersion -lt [version]"22.13.0") { throw "Node.js 22.13 or newer is required" }

  $package = Get-AppxPackage -Name "OpenAI.Codex" -ErrorAction Stop | Sort-Object Version -Descending | Select-Object -First 1
  $codexExe = Join-Path $package.InstallLocation "app\ChatGPT.exe"
  if (-not (Test-Path -LiteralPath $codexExe -PathType Leaf)) { throw "Codex executable not found" }

  New-Item -ItemType Directory -Force -Path $installParent | Out-Null
  if (-not $hadExistingState) {
    New-Item -ItemType Directory -Path $StateDir | Out-Null
    $stateCreatedByThisRun = $true
  }
  Set-Content -LiteralPath (Join-Path $StateDir $stateMarkerName) -Value $stateMarkerValue -Encoding ascii
  Remove-Item -LiteralPath $stagingDir -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $stagingDir | Out-Null
  $stagingCreated = $true

  foreach ($directory in @("asset-browser", "asset-console", "inject", "lib", "scripts", "windows", "templates")) {
    Copy-Item -LiteralPath (Join-Path $sourceDir $directory) -Destination $stagingDir -Recurse -Force
  }
  foreach ($file in @("LICENSE", "README.md", "README-Windows.txt", "package.json")) {
    Copy-Item -LiteralPath (Join-Path $sourceDir $file) -Destination $stagingDir -Force
  }

  $savedConfig = if ($hadExisting) { Join-Path $InstallDir "enhancer.config.json" } else { Join-Path $StateDir "enhancer.config.json" }
  if (Test-Path -LiteralPath $savedConfig) {
    Copy-Item -LiteralPath $savedConfig -Destination (Join-Path $stagingDir "enhancer.config.json") -Force
  }
  & $node.Source (Join-Path $stagingDir "scripts\setup-asset-browser.mjs") --state-dir $StateDir
  if ($LASTEXITCODE -ne 0) { throw "Asset backend setup failed" }
  $sourceRef = "v" + (Get-Content -LiteralPath (Join-Path $sourceDir "package.json") -Raw | ConvertFrom-Json).version
  $manifest = [ordered]@{
    name = "Codex Sidebar Enhancer"
    source = "https://github.com/q2522879285-source/codex-workspace-enhancer"
    sourceRef = $sourceRef
    installedAt = (Get-Date).ToString("o")
    port = $Port
    stateDir = $StateDir
    installDir = $InstallDir
    nodePath = $node.Source
    codexVersion = $package.Version.ToString()
    codexExecutable = $codexExe
  }
  $manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stagingDir "install-manifest.json") -Encoding utf8

  if ($hadExisting) {
    Stop-ExistingInjector
    Remove-Item -LiteralPath $backupDir -Recurse -Force -ErrorAction SilentlyContinue
    Move-Item -LiteralPath $InstallDir -Destination $backupDir
    $backupMade = $true
  }
  Move-Item -LiteralPath $stagingDir -Destination $InstallDir
  $stagingCreated = $false
  $installPlaced = $true

  if (-not $SkipShortcuts) {
    $launcherScript = Join-Path $InstallDir "windows\launch.ps1"
    $uninstallScript = Join-Path $InstallDir "windows\uninstall.ps1"
    $startupScript = Join-Path $InstallDir "windows\start-injector.ps1"
    $desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "Codex 侧栏增强器.lnk"
    $programShortcut = Join-Path ([Environment]::GetFolderPath("Programs")) "Codex 侧栏增强器.lnk"
    $uninstallShortcut = Join-Path ([Environment]::GetFolderPath("Programs")) "卸载 Codex 侧栏增强器.lnk"
    $startupShortcut = Join-Path ([Environment]::GetFolderPath("Startup")) "Codex 侧栏增强器后台.lnk"
    $shortcutPaths = @($desktopShortcut, $programShortcut, $uninstallShortcut, $startupShortcut)
    if (-not (Test-Path -LiteralPath $persistentShortcutBackupDir)) {
      New-Item -ItemType Directory -Force -Path $persistentShortcutBackupDir | Out-Null
      $persistentShortcutBackupCreated = $true
      for ($index = 0; $index -lt $shortcutPaths.Count; $index += 1) {
        if (Test-Path -LiteralPath $shortcutPaths[$index] -PathType Leaf) {
          Copy-Item -LiteralPath $shortcutPaths[$index] -Destination (Join-Path $persistentShortcutBackupDir "$index.lnk") -Force
        }
      }
    }
    $shortcutBackupDir = Join-Path $StateDir ".shortcut-backup-$PID"
    New-Item -ItemType Directory -Force -Path $shortcutBackupDir | Out-Null
    for ($index = 0; $index -lt $shortcutPaths.Count; $index += 1) {
      if (Test-Path -LiteralPath $shortcutPaths[$index] -PathType Leaf) {
        $backupPath = Join-Path $shortcutBackupDir "$index.lnk"
        Copy-Item -LiteralPath $shortcutPaths[$index] -Destination $backupPath -Force
        $shortcutBackups += [pscustomobject]@{ Path = $shortcutPaths[$index]; Backup = $backupPath }
      }
    }
    $shortcutsTouched = $true
    $runtimeArguments = "-Port $Port -InstallDir `"$InstallDir`" -StateDir `"$StateDir`""
    New-Shortcut -Path $desktopShortcut -ScriptPath $launcherScript -IconPath $codexExe -ScriptArguments $runtimeArguments
    New-Shortcut -Path $programShortcut -ScriptPath $launcherScript -IconPath $codexExe -ScriptArguments $runtimeArguments
    New-Shortcut -Path $uninstallShortcut -ScriptPath $uninstallScript -IconPath $codexExe -ScriptArguments $runtimeArguments -Hidden $false
    New-Shortcut -Path $startupShortcut -ScriptPath $startupScript -IconPath $codexExe -ScriptArguments $runtimeArguments
  }

  if (-not $SkipStart) {
    & (Join-Path $InstallDir "windows\start-injector.ps1") -Port $Port -InstallDir $InstallDir -StateDir $StateDir
  }

  if ($backupMade -and (Test-Path -LiteralPath $backupDir)) {
    Remove-Item -LiteralPath $backupDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  if ($shortcutBackupDir) {
    Remove-Item -LiteralPath $shortcutBackupDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  [ordered]@{
    installed = $true
    installDir = $InstallDir
    stateDir = $StateDir
    port = $Port
    desktopShortcut = (-not $SkipShortcuts)
  } | ConvertTo-Json
} catch {
  if ($installPlaced) {
    Stop-ExistingInjector
  }
  if ($stagingCreated) {
    Remove-Item -LiteralPath $stagingDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  if ($backupMade -and (Test-Path -LiteralPath $backupDir)) {
    if ($installPlaced) {
      Remove-Item -LiteralPath $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    Move-Item -LiteralPath $backupDir -Destination $InstallDir
  } elseif ($installPlaced) {
    Remove-Item -LiteralPath $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  if ($hadExisting -and -not $SkipStart -and (Test-Path -LiteralPath (Join-Path $InstallDir "windows\start-injector.ps1"))) {
    & (Join-Path $InstallDir "windows\start-injector.ps1") -Port $Port -InstallDir $InstallDir -StateDir $StateDir
  }
  if ($shortcutsTouched) {
    foreach ($shortcutPath in $shortcutPaths) {
      Remove-Item -LiteralPath $shortcutPath -Force -ErrorAction SilentlyContinue
    }
    foreach ($savedShortcut in $shortcutBackups) {
      Copy-Item -LiteralPath $savedShortcut.Backup -Destination $savedShortcut.Path -Force -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath $shortcutBackupDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  if ($persistentShortcutBackupCreated -and (Test-Path -LiteralPath $persistentShortcutBackupDir)) {
    Remove-Item -LiteralPath $persistentShortcutBackupDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  if ($stateCreatedByThisRun -and (Test-Path -LiteralPath $StateDir)) {
    Stop-ExistingInjector
    Remove-Item -LiteralPath $StateDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  throw
}
