[CmdletBinding()]
param(
    [ValidateSet('Prepare', 'AddOrukeet', 'Check', 'Run', 'Report')]
    [string]$Action = 'Check',
    [string]$DataRoot = '',
    [switch]$Cuda,
    [switch]$LocalAI
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -ne 'Windows_NT') { throw 'Flosi QA requires Windows 11 x64.' }
if (-not [Environment]::Is64BitProcess) { throw 'Use 64-bit PowerShell.' }
$repo = Split-Path -Parent $PSScriptRoot
if ($repo -like '*\Windows\System32*') { throw 'Use a dedicated checkout under your user profile.' }
$arguments = @((Join-Path $PSScriptRoot 'flosi-qa.js'), $Action.ToLowerInvariant())
if ($DataRoot) { $arguments += @('--root', $DataRoot) }
if ($Cuda) {
    if ($Action -ne 'Prepare') { throw '-Cuda is only valid with Prepare.' }
    $arguments += '--cuda'
}
if ($LocalAI) {
    if ($Action -ne 'Prepare') { throw '-LocalAI is only valid with Prepare.' }
    $arguments += '--local-ai'
}
Push-Location $repo
try {
    & node @arguments
    if ($LASTEXITCODE -ne 0) { throw "Flosi QA $Action failed (exit $LASTEXITCODE). Review the error and QA logs." }
} finally { Pop-Location }
