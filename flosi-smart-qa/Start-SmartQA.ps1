[CmdletBinding()]
param([switch]$PrepareOnly, [switch]$NoBrowser, [switch]$SkipPip)
$ErrorActionPreference = 'Stop'
if (-not [Environment]::Is64BitOperatingSystem) { throw 'Windows x64 is required.' }
$launcher = Get-Command py -ErrorAction SilentlyContinue
if ($launcher) {
    $pythonExe = $launcher.Source
    $pythonArgs = @('-3.12')
} else {
    $launcher = Get-Command python -ErrorAction SilentlyContinue
    if (-not $launcher) { throw 'Install Python 3.12 x64, then reopen PowerShell. See WINDOWS.md.' }
    $pythonExe = $launcher.Source
    $pythonArgs = @()
}
& $pythonExe @pythonArgs -c 'import sys; assert (3,11) <= sys.version_info < (3,14), "Python 3.11-3.13 required"'
if ($LASTEXITCODE -ne 0) { throw 'Python launcher failed; see WINDOWS.md for exact installation steps.' }
$launchArgs = @((Join-Path $PSScriptRoot 'launch.py'))
if ($PrepareOnly) { $launchArgs += '--prepare-only' }
if ($NoBrowser) { $launchArgs += '--no-browser' }
if ($SkipPip) { $launchArgs += '--skip-pip' }
& $pythonExe @pythonArgs @launchArgs
if ($LASTEXITCODE -ne 0) { throw "Smart QA exited with code $LASTEXITCODE. Existing Flosi QA was not changed." }
