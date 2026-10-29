# Policy simulation on Linux PowerShell, never a Windows/WFP validation.
# Every Windows service/firewall query is replaced by a synthetic contract.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) { throw 'This policy simulation must run on a non-Windows test host.' }
$root = Join-Path ([IO.Path]::GetTempPath()) ('flosi-firewall-fixture-' + [Guid]::NewGuid().ToString('N'))
$source = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'scripts/flosi-qa-orukeet-firewall.ps1'
$scripts = Join-Path $root 'scripts'
$binDir = Join-Path $root 'resources/bin'
New-Item -ItemType Directory -Path $scripts,$binDir | Out-Null
$binary = Join-Path $binDir 'sherpa-onnx-ws-win32-x64.exe'
[IO.File]::WriteAllText($binary, 'Synthetic non-executable package fixture; no recognition is mocked.')
$pin = @{ runtimeFiles = @(@{ file = 'sherpa-onnx-ws-win32-x64.exe'; installedSha256 = (Get-FileHash $binary -Algorithm SHA256).Hash.ToLowerInvariant() }) }
$pin | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $scripts 'flosi-qa-orukeet-artifacts.json')
$scriptPath = Join-Path $scripts 'flosi-qa-orukeet-firewall.ps1'
Copy-Item -LiteralPath $source -Destination $scriptPath
$previousOS = $env:OS
$env:OS = 'Windows_NT' # process-local selector for the policy simulation only
$global:FlosiFirewallFixtureState = $null
function New-State {
    return @{
        service = 'Running'; profilesEnabled = $true; localRules = $true; count = 1
        rule = [pscustomobject]@{ Enabled = 'True'; Action = 'Block'; Direction = ''; Profile = 'Any'; EdgeTraversalPolicy = 'Block'; PrimaryStatus = 'OK'; EnforcementStatus = 'Full' }
        app = [pscustomobject]@{ Program = $binary; Package = 'Any' }
        address = [pscustomobject]@{ RemoteAddress = @('0.0.0.0-126.255.255.255','128.0.0.0-255.255.255.255','::/0'); LocalAddress = @('Any') }
        port = [pscustomobject]@{ Protocol = 'Any'; LocalPort = @('Any'); RemotePort = @('Any') }
        interface = [pscustomobject]@{ InterfaceType = 'Any' }
        alias = [pscustomobject]@{ InterfaceAlias = @('Any') }
        serviceFilter = [pscustomobject]@{ Service = 'Any' }
        security = [pscustomobject]@{ LocalUser = 'Any'; RemoteUser = 'Any'; RemoteMachine = 'Any' }
    }
}
function Get-Service { param($Name) [pscustomobject]@{ Status = $global:FlosiFirewallFixtureState.service } }
function Get-NetFirewallProfile { param($PolicyStore) 1..3 | ForEach-Object { [pscustomobject]@{ Enabled = $global:FlosiFirewallFixtureState.profilesEnabled; AllowLocalFirewallRules = $global:FlosiFirewallFixtureState.localRules } } }
function Get-NetFirewallRule {
    [CmdletBinding()]param($PolicyStore,$Name)
    if ($global:FlosiFirewallFixtureState.count -eq 0) { return }
    $global:FlosiFirewallFixtureState.rule.Direction = if ($Name.EndsWith('-Inbound')) { 'Inbound' } else { 'Outbound' }
    if ($global:FlosiFirewallFixtureState.ContainsKey('wrongDirection')) { $global:FlosiFirewallFixtureState.rule.Direction = 'Inbound' }
    for ($i = 0; $i -lt $global:FlosiFirewallFixtureState.count; $i++) { $global:FlosiFirewallFixtureState.rule }
}
function Get-NetFirewallApplicationFilter { param([Parameter(ValueFromPipeline=$true)]$InputObject) process { $global:FlosiFirewallFixtureState.app } }
function Get-NetFirewallAddressFilter { param([Parameter(ValueFromPipeline=$true)]$InputObject) process { $global:FlosiFirewallFixtureState.address } }
function Get-NetFirewallPortFilter { param([Parameter(ValueFromPipeline=$true)]$InputObject) process { $global:FlosiFirewallFixtureState.port } }
function Get-NetFirewallInterfaceTypeFilter { param([Parameter(ValueFromPipeline=$true)]$InputObject) process { $global:FlosiFirewallFixtureState.interface } }
function Get-NetFirewallInterfaceFilter { param([Parameter(ValueFromPipeline=$true)]$InputObject) process { $global:FlosiFirewallFixtureState.alias } }
function Get-NetFirewallServiceFilter { param([Parameter(ValueFromPipeline=$true)]$InputObject) process { $global:FlosiFirewallFixtureState.serviceFilter } }
function Get-NetFirewallSecurityFilter { param([Parameter(ValueFromPipeline=$true)]$InputObject) process { $global:FlosiFirewallFixtureState.security } }
function New-NetFirewallRule { throw 'Unexpected policy mutation in a read-only check' }
$cases = [ordered]@{
    'valid scalar and array filters' = @{}
    'valid case-insensitive Windows path' = @{ binary = $binary.ToUpperInvariant() }
    'disabled profile' = @{ mutate = { $global:FlosiFirewallFixtureState.profilesEnabled = $false } }
    'GPO denies local rules' = @{ mutate = { $global:FlosiFirewallFixtureState.localRules = $false } }
    'stopped firewall service' = @{ mutate = { $global:FlosiFirewallFixtureState.service = 'Stopped' } }
    'missing rule' = @{ mutate = { $global:FlosiFirewallFixtureState.count = 0 } }
    'ambiguous rule' = @{ mutate = { $global:FlosiFirewallFixtureState.count = 2 } }
    'wrong program' = @{ mutate = { $global:FlosiFirewallFixtureState.app.Program = '/official/application.exe' } }
    'package-scoped rule' = @{ mutate = { $global:FlosiFirewallFixtureState.app.Package = 'S-1-15-2-fixture' } }
    'incomplete remote addresses' = @{ mutate = { $global:FlosiFirewallFixtureState.address.RemoteAddress = @('::/0') } }
    'scoped local address' = @{ mutate = { $global:FlosiFirewallFixtureState.address.LocalAddress = @('192.0.2.1') } }
    'scoped local port' = @{ mutate = { $global:FlosiFirewallFixtureState.port.LocalPort = @('443') } }
    'scoped remote port' = @{ mutate = { $global:FlosiFirewallFixtureState.port.RemotePort = @('443') } }
    'scoped protocol' = @{ mutate = { $global:FlosiFirewallFixtureState.port.Protocol = 'TCP' } }
    'scoped interface type' = @{ mutate = { $global:FlosiFirewallFixtureState.interface.InterfaceType = 'Wireless' } }
    'scoped alias' = @{ mutate = { $global:FlosiFirewallFixtureState.alias.InterfaceAlias = @('Ethernet') } }
    'scoped service' = @{ mutate = { $global:FlosiFirewallFixtureState.serviceFilter.Service = 'fixture' } }
    'scoped remote user' = @{ mutate = { $global:FlosiFirewallFixtureState.security.RemoteUser = 'fixture' } }
    'allow rule' = @{ mutate = { $global:FlosiFirewallFixtureState.rule.Action = 'Allow' } }
    'wrong direction' = @{ mutate = { $global:FlosiFirewallFixtureState.wrongDirection = $true } }
    'single profile only' = @{ mutate = { $global:FlosiFirewallFixtureState.rule.Profile = 'Private' } }
    'disabled rule' = @{ mutate = { $global:FlosiFirewallFixtureState.rule.Enabled = 'False' } }
    'rule error' = @{ mutate = { $global:FlosiFirewallFixtureState.rule.PrimaryStatus = 'Error' } }
    'not enforced' = @{ mutate = { $global:FlosiFirewallFixtureState.rule.EnforcementStatus = 'DisabledObject' } }
}
try {
    foreach ($case in $cases.GetEnumerator()) {
        $global:FlosiFirewallFixtureState = New-State
        if ($case.Value.ContainsKey('mutate')) { & $case.Value.mutate }
        $failed = $false; $reason = ""
        $candidateBinary = if ($case.Value.ContainsKey('binary')) { $case.Value.binary } else { $binary }
        try { & $scriptPath -Mode Check -Binary $candidateBinary | Out-Null } catch { $failed = $true; $reason = $_.Exception.Message }
        if ($failed -ne $case.Value.ContainsKey('mutate')) { throw "Unexpected policy result for '$($case.Key)': $reason" }
    }
    [pscustomobject]@{ policySimulationPassed = $cases.Count; failed = 0; nativeWindowsFirewallTested = $false } | ConvertTo-Json -Compress
} finally {
    $env:OS = $previousOS
    Remove-Variable -Name FlosiFirewallFixtureState -Scope Global
    Remove-Item -LiteralPath $root -Recurse -Force # only this newly-created synthetic fixture
}
