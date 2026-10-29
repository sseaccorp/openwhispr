# The unmodified sherpa 1.13.8 offline WS server binds IPv4 ANY. These narrow
# BLOCK rules restrict only the private QA executable; no global policy changes.
[CmdletBinding()]
param(
    [ValidateSet('Check', 'Install')][string]$Mode = 'Check',
    [Parameter(Mandatory = $true)][string]$Binary
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -ne 'Windows_NT') { throw 'Windows firewall verification requires Windows.' }
$repo = Split-Path -Parent $PSScriptRoot
$expected = [IO.Path]::GetFullPath((Join-Path $repo 'resources\bin\sherpa-onnx-ws-win32-x64.exe'))
if ([IO.Path]::GetFullPath($Binary) -ine $expected -or -not (Test-Path -LiteralPath $expected -PathType Leaf)) {
    throw 'Only this dedicated checkout executable may be protected.'
}
$item = Get-Item -LiteralPath $expected -Force
while ($null -ne $item) {
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'QA firewall targets must not traverse links/junctions.' }
    if ($item -is [IO.FileInfo]) { $item = $item.Directory } else { $item = $item.Parent }
}
function Test-Any($Value) {
    $values = @($Value)
    return $values.Count -eq 1 -and $values[0].ToString() -eq 'Any'
}
# Authenticate the executable from the reviewed pin file, not an arbitrary path.
$pins = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'flosi-qa-orukeet-artifacts.json') -Raw | ConvertFrom-Json
$pin = @($pins.runtimeFiles | Where-Object file -eq 'sherpa-onnx-ws-win32-x64.exe')[0]
if ((Get-FileHash -LiteralPath $expected -Algorithm SHA256).Hash.ToLowerInvariant() -ne $pin.installedSha256) {
    throw 'QA executable does not match its pinned installed hash.'
}
foreach ($service in @('BFE', 'MpsSvc')) {
    if ((Get-Service -Name $service).Status -ne 'Running') { throw "Required firewall service is not running: $service" }
}
$profiles = @(Get-NetFirewallProfile -PolicyStore ActiveStore)
if ($profiles.Count -ne 3) { throw 'Cannot inspect all firewall profiles.' }
foreach ($profile in $profiles) {
    if ($profile.Enabled.ToString() -ne 'True' -or $profile.AllowLocalFirewallRules.ToString() -eq 'False') {
        throw 'Firewall disabled or local rules prohibited by policy; Orukeet QA must not start.'
    }
}
$hasher = [Security.Cryptography.SHA256]::Create()
try { $pathHash = ([BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($expected.ToLowerInvariant())))).Replace('-', '').Substring(0, 16) }
finally { $hasher.Dispose() }
# Exclude the entire IPv4 loopback range. Block all IPv6 in case a future
# binary changes binding; this candidate uses only IPv4 localhost.
$remote = @('0.0.0.0-126.255.255.255', '128.0.0.0-255.255.255.255', '::/0')
foreach ($direction in @('Inbound', 'Outbound')) {
    $name = "FlosiQA-Orukeet-$pathHash-$direction"
    $existing = @(Get-NetFirewallRule -PolicyStore ActiveStore -Name $name -ErrorAction SilentlyContinue)
    if (-not $existing.Count -and $Mode -eq 'Install') {
        $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
        if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Install requires an explicitly elevated PowerShell; run QA itself without elevation.' }
        New-NetFirewallRule -PolicyStore PersistentStore -Name $name -DisplayName $name -Description 'Flosi QA only: block non-loopback traffic for the unmodified sherpa offline server.' -Program $expected -Direction $direction -Action Block -Enabled True -Profile Any -Protocol Any -RemoteAddress $remote -InterfaceType Any -EdgeTraversalPolicy Block | Out-Null
        $existing = @(Get-NetFirewallRule -PolicyStore ActiveStore -Name $name)
    }
    if ($existing.Count -ne 1) { throw "Missing or ambiguous QA rule: $name. Use Install explicitly; do not allow the firewall prompt." }
    $rule = $existing[0]
    $application = $rule | Get-NetFirewallApplicationFilter
    $addresses = $rule | Get-NetFirewallAddressFilter
    $ports = $rule | Get-NetFirewallPortFilter
    $interfaces = $rule | Get-NetFirewallInterfaceTypeFilter
    $aliases = $rule | Get-NetFirewallInterfaceFilter
    $services = $rule | Get-NetFirewallServiceFilter
    $security = $rule | Get-NetFirewallSecurityFilter
    $difference = @(Compare-Object ($remote | Sort-Object) (@($addresses.RemoteAddress) | Sort-Object))
    if ($rule.Enabled.ToString() -ne 'True' -or $rule.Action.ToString() -ne 'Block' -or $rule.Direction.ToString() -ne $direction -or $rule.Profile.ToString() -ne 'Any' -or $application.Program -ine $expected -or $difference.Count -or -not (Test-Any $application.Package) -or -not (Test-Any $addresses.LocalAddress) -or -not (Test-Any $ports.Protocol) -or -not (Test-Any $ports.LocalPort) -or -not (Test-Any $ports.RemotePort) -or -not (Test-Any $interfaces.InterfaceType) -or -not (Test-Any $aliases.InterfaceAlias) -or -not (Test-Any $services.Service) -or -not (Test-Any $security.LocalUser) -or -not (Test-Any $security.RemoteUser) -or -not (Test-Any $security.RemoteMachine) -or $rule.EdgeTraversalPolicy.ToString() -ne 'Block') {
        throw "QA rule differs from the required protection: $name. Existing rules were preserved; investigate manually."
    }
    if ($rule.PrimaryStatus.ToString() -ne 'OK' -or $rule.EnforcementStatus.ToString() -notin @('Full', 'NotApplicable')) {
        throw "Windows cannot confirm effective QA rule: $name. Native verification is required."
    }
}
Write-Output 'Flosi QA Orukeet: dedicated non-loopback inbound/outbound block rules verified. Native remote-connect testing remains required.'
