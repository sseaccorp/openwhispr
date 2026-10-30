# Linux-only simulation. NetSecurity, processes and administrator identity are
# facades. This never claims Windows/WFP compatibility or starts a server.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) { throw 'Run this simulation only on a non-Windows test host.' }
$repo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$root=Join-Path ([IO.Path]::GetTempPath()) ('flosi-fw-tests-'+[Guid]::NewGuid().ToString('N'))
$scripts=Join-Path $root 'scripts'; $binDir=Join-Path $root 'resources/bin'
New-Item -ItemType Directory -Path $scripts,$binDir,(Join-Path $scripts 'lib') | Out-Null
$binary=Join-Path $binDir 'sherpa-onnx-ws-win32-x64.exe'
[IO.File]::WriteAllText($binary,'Synthetic non-executable fixture; no ASR is simulated.')
@{runtimeFiles=@(@{file='sherpa-onnx-ws-win32-x64.exe';installedSha256=(Get-FileHash $binary -Algorithm SHA256).Hash.ToLowerInvariant()})} | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $scripts 'flosi-qa-orukeet-artifacts.json')
Copy-Item (Join-Path $repo 'scripts/lib/flosi-qa-firewall.ps1') (Join-Path $scripts 'lib/flosi-qa-firewall.ps1')
$source=Get-Content (Join-Path $repo 'scripts/flosi-qa-orukeet-firewall.ps1') -Raw
# Replace ONLY the .NET administrator boundary, unsupported on Linux. Policy,
# identity, address checks, creation/activation/cleanup code remain the real source.
$admin="    `$identity=[Security.Principal.WindowsIdentity]::GetCurrent()`n    if (-not ([Security.Principal.WindowsPrincipal]::new(`$identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Install/Diagnose require explicit elevation; run the app itself without elevation.' }"
if (-not $source.Contains($admin)) { throw 'Privilege boundary changed; review the simulation.' }
$scriptPath=Join-Path $scripts 'flosi-qa-orukeet-firewall.ps1'
[IO.File]::WriteAllText($scriptPath,$source.Replace($admin,"    # Administrator identity simulated only in this temporary test fixture."))
. (Join-Path $repo 'scripts/lib/flosi-qa-firewall.ps1')
$plan=@(Get-FlosiFirewallPlan $binary)
$previousOS=$env:OS; $env:OS='Windows_NT'
$global:FlosiFirewallTestState=$null
function New-State {
    @{ Rules=@{}; Events=[Collections.Generic.List[string]]::new(); CreateCount=0; EnableCount=0
       FailCreate=0; FailEnable=0; FailAfterCreate=$false; Denied=$false; ActiveMissing=$false
       Profiles=$true; LocalRules=$true; Service='Running'; Running=$false; Duplicate=$false
       RejectLegacy=$false; RejectV2=$false; CleanupFail=$false; ChangedProbe=$false }
}
function New-FakeRule($Name,$DisplayName,$Group,$Description,$Program,$Direction,$Action,$Enabled,$Profile,$Protocol,$RemoteAddress,$InterfaceType,$EdgeTraversalPolicy) {
    [pscustomobject]@{ Name=$Name; DisplayName=$DisplayName; Group=$Group; Description=$Description
        Direction=$Direction; Action=$Action; Enabled=$Enabled.ToString(); Profile=$Profile; EdgeTraversalPolicy=$EdgeTraversalPolicy; PrimaryStatus='OK'; EnforcementStatus='Full'
        App=[pscustomobject]@{Program=$Program;Package='Any'}
        Address=[pscustomobject]@{RemoteAddress=@($RemoteAddress);LocalAddress=@('Any')}
        Port=[pscustomobject]@{Protocol=$Protocol;LocalPort=@('Any');RemotePort=@('Any')}
        Interface=[pscustomobject]@{InterfaceType=$InterfaceType}; Alias=[pscustomobject]@{InterfaceAlias=@('Any')}
        ServiceFilter=[pscustomobject]@{Service='Any'}; Security=[pscustomobject]@{LocalUser='Any';RemoteUser='Any';RemoteMachine='Any'} }
}
function Fill-Rules {
    foreach ($spec in $plan) {
        $rule=New-FakeRule $spec.Name $spec.Name $spec.Group $spec.Description $binary $spec.Direction 'Block' 'True' 'Any' 'Any' $spec.Remote 'Any' 'Block'
        $global:FlosiFirewallTestState.Rules[$spec.Name]=$rule
    }
}
function Get-Service { param($Name) [pscustomobject]@{Status=$global:FlosiFirewallTestState.Service} }
function Get-NetFirewallProfile { param($PolicyStore) 1..3 | ForEach-Object { [pscustomobject]@{Enabled=$global:FlosiFirewallTestState.Profiles;AllowLocalFirewallRules=$global:FlosiFirewallTestState.LocalRules} } }
function Get-CimInstance { param($ClassName,$Filter) if ($global:FlosiFirewallTestState.Running) { [pscustomobject]@{ExecutablePath=$binary} } }
function Get-NetFirewallRule {
    [CmdletBinding()]param($PolicyStore,$Name)
    $state=$global:FlosiFirewallTestState
    if ($state.Denied) { throw [UnauthorizedAccessException]::new('Synthetic denied query') }
    if (-not $PSBoundParameters.ContainsKey('Name')) {
        if (-not ($PolicyStore -eq 'ActiveStore' -and $state.ActiveMissing)) { $state.Rules.Values }
        return
    }
    if ($state.Rules.ContainsKey($Name) -and -not ($PolicyStore -eq 'ActiveStore' -and $state.ActiveMissing)) {
        $state.Rules[$Name]
        if ($state.Duplicate) { $state.Rules[$Name] }
    } else {
        $record=[Management.Automation.ErrorRecord]::new([Exception]::new('Synthetic not found'),'CmdletizationQuery_NotFound_Name',[Management.Automation.ErrorCategory]::ObjectNotFound,$Name)
        $PSCmdlet.ThrowTerminatingError($record)
    }
}
function Get-NetFirewallApplicationFilter { param([Parameter(ValueFromPipeline=$true)]$InputObject) process { $InputObject.App } }
function Get-NetFirewallAddressFilter { param([Parameter(ValueFromPipeline=$true)]$InputObject) process { $InputObject.Address } }
function Get-NetFirewallPortFilter { param([Parameter(ValueFromPipeline=$true)]$InputObject) process { $InputObject.Port } }
function Get-NetFirewallInterfaceTypeFilter { param([Parameter(ValueFromPipeline=$true)]$InputObject) process { $InputObject.Interface } }
function Get-NetFirewallInterfaceFilter { param([Parameter(ValueFromPipeline=$true)]$InputObject) process { $InputObject.Alias } }
function Get-NetFirewallServiceFilter { param([Parameter(ValueFromPipeline=$true)]$InputObject) process { $InputObject.ServiceFilter } }
function Get-NetFirewallSecurityFilter { param([Parameter(ValueFromPipeline=$true)]$InputObject) process { $InputObject.Security } }
function New-NetFirewallRule {
    param($PolicyStore,$Name,$DisplayName,$Group,$Description,$Program,$Direction,$Action,$Enabled,$Profile,$Protocol,$RemoteAddress,$InterfaceType,$EdgeTraversalPolicy)
    $s=$global:FlosiFirewallTestState; $s.CreateCount++; $s.Events.Add('create:'+ $Name)
    if ($Action -ne 'Block' -or $Enabled.ToString() -ne 'False' -or $Program -ine $binary) { throw 'Unsafe creation in policy under test' }
    if (($s.RejectLegacy -and @($RemoteAddress) -contains '::/0') -or ($s.RejectV2 -and $Name -notlike '*Probe*')) { throw [ArgumentException]::new('Synthetic invalid prefix HRESULT 0x80070057') }
    if ($s.FailCreate -eq $s.CreateCount -and -not $s.FailAfterCreate) { throw 'Synthetic create failure' }
    $rule=New-FakeRule $Name $DisplayName $Group $Description $Program $Direction $Action $Enabled $Profile $Protocol $RemoteAddress $InterfaceType $EdgeTraversalPolicy
    if ($s.ChangedProbe -and $Name -like '*Probe*') { $rule.App.Program='/foreign.exe' }
    $s.Rules[$Name]=$rule
    if ($s.FailCreate -eq $s.CreateCount -and $s.FailAfterCreate) { throw 'Synthetic failure after create' }
    $rule
}
function Enable-NetFirewallRule {
    param($InputObject)
    $s=$global:FlosiFirewallTestState
    if (@($s.Rules.Values | Where-Object Name -like 'FlosiQA-Orukeet-v2-*').Count -ne 4) { throw 'Activation before full staging' }
    $s.EnableCount++; $s.Events.Add('enable:'+ $InputObject.Name)
    if ($s.FailEnable -eq $s.EnableCount) { throw 'Synthetic activation failure' }
    $InputObject.Enabled='True'; $InputObject
}
function Remove-NetFirewallRule {
    param($InputObject)
    $s=$global:FlosiFirewallTestState
    if ($InputObject.Name -notlike 'FlosiQA-Orukeet-Probe-*' -or $InputObject.Enabled -ne 'False') { throw 'Attempted removal of a production/foreign rule' }
    if ($s.CleanupFail) { throw 'Synthetic cleanup denied' }
    $s.Events.Add('remove:'+ $InputObject.Name); $s.Rules.Remove($InputObject.Name)
}
$passed=0
function Assert-Case([string]$Name,[scriptblock]$Body) {
    try { & $Body; $script:passed++ } catch { throw "Scenario '$Name': $($_.Exception.Message)" }
}
function Must-Reject([string]$Mode='Check') {
    $failed=$false
    try { & $scriptPath -Mode $Mode -Binary $binary | Out-Null } catch { $failed=$true }
    if (-not $failed) { throw "Expected $Mode to fail closed" }
}
try {
    Assert-Case 'IPv4 exact complement of 127/8' { if (-not (Test-FlosiAddressSet $plan[0].Remote @('0.0.0.0-126.255.255.255','128.0.0.0-255.255.255.255'))) { throw 'IPv4 gap/loopback block' } }
    Assert-Case 'IPv6 non-loopback peers' { if (-not (Test-FlosiAddressSet $plan[1].Remote @('::2-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff'))) { throw 'IPv6 gap/loopback block' } }
    Assert-Case 'no /0 input and distinct families' { foreach ($p in $plan) { if (@($p.Remote | Where-Object { $_ -match '/0$' }).Count) { throw '/0 input' }; if ($p.Family -eq 'IPv4' -and @($p.Remote | Where-Object { $_.Contains(':') }).Count) { throw 'Mixed family' } } }
    Assert-Case 'equivalent range and mask' { if (-not (Test-FlosiAddressSet @('192.0.2.0/24') @('192.0.2.0-192.0.2.255')) -or -not (Test-FlosiAddressSet @('192.0.2.0/24') @('192.0.2.0/255.255.255.0'))) { throw 'Normalization failure' } }
    foreach ($bad in @('LocalSubnet','::/129','1.2.3.4/33','192.0.2.5-192.0.2.1','::1%3')) {
        Assert-Case "invalid/dynamic address $bad" { $failed=$false; try { ConvertTo-FlosiAddressSet @($bad) | Out-Null } catch { $failed=$true }; if (-not $failed) { throw 'Accepted unsafe selector' } }
    }
    $mutations=@(
        { $global:FlosiFirewallTestState.Profiles=$false }, { $global:FlosiFirewallTestState.LocalRules=$false }, { $global:FlosiFirewallTestState.Service='Stopped' },
        { $global:FlosiFirewallTestState.Denied=$true }, { $global:FlosiFirewallTestState.Duplicate=$true }, { $global:FlosiFirewallTestState.ActiveMissing=$true },
        { $global:FlosiFirewallTestState.Rules[$plan[0].Name].App.Program='/foreign.exe' },
        { $global:FlosiFirewallTestState.Rules[$plan[0].Name].Description='foreign' },
        { $global:FlosiFirewallTestState.Rules[$plan[0].Name].Group='foreign' },
        { $global:FlosiFirewallTestState.Rules[$plan[0].Name].Action='Allow' },
        { $global:FlosiFirewallTestState.Rules[$plan[0].Name].Enabled='False' },
        { $global:FlosiFirewallTestState.Rules[$plan[0].Name].Port.RemotePort=@('443') },
        { $global:FlosiFirewallTestState.Rules[$plan[0].Name].Address.RemoteAddress=@('Any') },
        { $global:FlosiFirewallTestState.Rules[$plan[1].Name].Address.RemoteAddress=@('2000::/3') },
        { $global:FlosiFirewallTestState.Rules[$plan[0].Name].EnforcementStatus='DisabledObject' },
        { $global:FlosiFirewallTestState.Rules[$plan[0].Name].App.Package='fixture-package' },
        { $global:FlosiFirewallTestState.Rules[$plan[0].Name].Address.LocalAddress=@('192.0.2.1') },
        { $global:FlosiFirewallTestState.Rules[$plan[0].Name].Port.LocalPort=@('443') },
        { $global:FlosiFirewallTestState.Rules[$plan[0].Name].Port.Protocol='TCP' },
        { $global:FlosiFirewallTestState.Rules[$plan[0].Name].Interface.InterfaceType='Wireless' },
        { $global:FlosiFirewallTestState.Rules[$plan[0].Name].Alias.InterfaceAlias=@('Ethernet') },
        { $global:FlosiFirewallTestState.Rules[$plan[0].Name].ServiceFilter.Service='fixture-service' },
        { $global:FlosiFirewallTestState.Rules[$plan[0].Name].Security.LocalUser='fixture-user' },
        { $global:FlosiFirewallTestState.Rules[$plan[0].Name].Security.RemoteUser='fixture-user' },
        { $global:FlosiFirewallTestState.Rules[$plan[0].Name].Security.RemoteMachine='fixture-machine' },
        { $global:FlosiFirewallTestState.Rules[$plan[0].Name].Profile='Private' },
        { $global:FlosiFirewallTestState.Rules[$plan[0].Name].Direction='Outbound' },
        { $global:FlosiFirewallTestState.Rules[$plan[0].Name].PrimaryStatus='Error' },
        { $global:FlosiFirewallTestState.Rules[$plan[0].Name].EdgeTraversalPolicy='Allow' },
        { $global:FlosiFirewallTestState.Rules[$plan[0].Name].DisplayName='foreign display' },
        { $global:FlosiFirewallTestState.Rules[$plan[0].Name].Name='foreign name' },
        { $global:FlosiFirewallTestState.Rules[$plan[0].Name].Port.RemotePort=@('Any','443') },
        { $global:FlosiFirewallTestState.Rules[$plan[0].Name].Address.RemoteAddress=@('0.0.0.0/0') },
        { $global:FlosiFirewallTestState.Rules[$plan[1].Name].Address.RemoteAddress=@('Any6') },
        { $global:FlosiFirewallTestState.Rules[$plan[1].Name].Enabled='False' })
    $index=0
    foreach ($mutate in $mutations) {
        Assert-Case "read-only Check rejects mismatch $index" { $global:FlosiFirewallTestState=New-State; Fill-Rules; & $mutate; Must-Reject; if ($global:FlosiFirewallTestState.Events.Count) { throw 'Check mutated policy' } }; $index++
    }
    Assert-Case 'Check valid normalized rules' { $global:FlosiFirewallTestState=New-State; Fill-Rules; $global:FlosiFirewallTestState.Rules[$plan[0].Name].Address.RemoteAddress=@('0.0.0.0-126.255.255.255','128.0.0.0-255.255.255.255'); & $scriptPath -Mode Check -Binary $binary.ToUpperInvariant() | Out-Null }
    Assert-Case 'Install new and idempotent' { $global:FlosiFirewallTestState=New-State; & $scriptPath -Mode Install -Binary $binary | Out-Null; & $scriptPath -Mode Install -Binary $binary | Out-Null; if ($global:FlosiFirewallTestState.CreateCount -ne 4 -or $global:FlosiFirewallTestState.EnableCount -ne 4) { throw 'Duplicate/unsafe install' } }
    foreach ($after in @($false,$true)) {
        Assert-Case "retry after partial create ($after)" { $global:FlosiFirewallTestState=New-State; $global:FlosiFirewallTestState.FailCreate=3; $global:FlosiFirewallTestState.FailAfterCreate=$after; Must-Reject 'Install'; if ($global:FlosiFirewallTestState.EnableCount) { throw 'Premature activation' }; $global:FlosiFirewallTestState.FailCreate=0; & $scriptPath -Mode Install -Binary $binary | Out-Null; if ($global:FlosiFirewallTestState.Rules.Count -ne 4) { throw 'Lost/duplicated partial rule' } }
    }
    Assert-Case 'retry after partial activation' { $global:FlosiFirewallTestState=New-State; $global:FlosiFirewallTestState.FailEnable=2; Must-Reject 'Install'; Must-Reject 'Check'; $global:FlosiFirewallTestState.FailEnable=0; & $scriptPath -Mode Install -Binary $binary | Out-Null; if ($global:FlosiFirewallTestState.CreateCount -ne 4) { throw 'Replaced existing staged rules' } }
    Assert-Case 'mismatched existing rule prevents all mutations' { $global:FlosiFirewallTestState=New-State; Fill-Rules; $global:FlosiFirewallTestState.Rules[$plan[3].Name].App.Program='/foreign.exe'; Must-Reject 'Install'; if ($global:FlosiFirewallTestState.Events.Count) { throw 'Mutation before validating all identities' } }
    Assert-Case 'running QA process prevents install' { $global:FlosiFirewallTestState=New-State; $global:FlosiFirewallTestState.Running=$true; Must-Reject 'Install'; if ($global:FlosiFirewallTestState.Events.Count) { throw 'Mutation while server running' } }
    Assert-Case 'partial valid legacy rule preserved' { $global:FlosiFirewallTestState=New-State; $p=$plan[0]; $legacy=New-FakeRule $p.LegacyName $p.LegacyName '' 'Flosi QA only: block non-loopback traffic for the unmodified sherpa offline server.' $binary 'Inbound' 'Block' 'True' 'Any' 'Any' @('0.0.0.0-126.255.255.255','128.0.0.0-255.255.255.255','::/0') 'Any' 'Block'; $global:FlosiFirewallTestState.Rules[$p.LegacyName]=$legacy; & $scriptPath -Mode Install -Binary $binary | Out-Null; if ($global:FlosiFirewallTestState.Rules[$p.LegacyName] -ne $legacy) { throw 'Legacy replaced' } }
    Assert-Case 'unrelated rules preserved' { $global:FlosiFirewallTestState=New-State; $foreign=New-FakeRule 'Official-App' 'Official-App' 'foreign' 'foreign' '/official.exe' 'Inbound' 'Allow' 'True' 'Any' 'Any' @('Any') 'Any' 'Block'; $global:FlosiFirewallTestState.Rules[$foreign.Name]=$foreign; & $scriptPath -Mode Install -Binary $binary | Out-Null; if ($global:FlosiFirewallTestState.Rules[$foreign.Name] -ne $foreign -or $global:FlosiFirewallTestState.Rules.Count -ne 5) { throw 'Foreign rule modified' } }
    Assert-Case 'foreign legacy name prevents mutations' { $global:FlosiFirewallTestState=New-State; $p=$plan[0]; $foreign=New-FakeRule $p.LegacyName $p.LegacyName '' 'not our legacy description' $binary 'Inbound' 'Block' 'True' 'Any' 'Any' @('Any') 'Any' 'Block'; $global:FlosiFirewallTestState.Rules[$p.LegacyName]=$foreign; Must-Reject 'Install'; if ($global:FlosiFirewallTestState.Events.Count) { throw 'Mutation despite foreign legacy identity' } }
    Assert-Case 'ActiveStore omission blocks successful installation' { $global:FlosiFirewallTestState=New-State; $global:FlosiFirewallTestState.ActiveMissing=$true; Must-Reject 'Install'; Must-Reject 'Check'; if ($global:FlosiFirewallTestState.Rules.Count -ne 4) { throw 'Unexpected rollback of restrictive rules' } }
    Assert-Case 'probe created before an error is cleaned by exact identity' { $global:FlosiFirewallTestState=New-State; $global:FlosiFirewallTestState.FailCreate=1; $global:FlosiFirewallTestState.FailAfterCreate=$true; $report=(& $scriptPath -Mode Diagnose -Binary $binary) | ConvertFrom-Json; if ($report.probes[0].accepted -or -not $report.probes[0].cleaned -or $global:FlosiFirewallTestState.Rules.Count) { throw 'Partial probe leaked or was accepted' } }
    Assert-Case 'native rejection retains stages and never activates' { $global:FlosiFirewallTestState=New-State; $global:FlosiFirewallTestState.RejectV2=$true; Must-Reject 'Install'; if ($global:FlosiFirewallTestState.EnableCount) { throw 'Activated invalid policy' } }
    Assert-Case 'Diagnose isolates rejected value and cleans only disabled probes' { $global:FlosiFirewallTestState=New-State; $global:FlosiFirewallTestState.RejectLegacy=$true; $report=(& $scriptPath -Mode Diagnose -Binary $binary) | ConvertFrom-Json; if (@($report.probes | Where-Object { $_.label -eq 'legacy-ipv6-zero-prefix' -and -not $_.accepted }).Count -ne 2 -or $global:FlosiFirewallTestState.Rules.Count -ne 0 -or $global:FlosiFirewallTestState.EnableCount) { throw 'Diagnostic did not isolate/clean' } }
    Assert-Case 'foreign probe is never removed' { $global:FlosiFirewallTestState=New-State; $global:FlosiFirewallTestState.ChangedProbe=$true; Must-Reject 'Diagnose'; if (@($global:FlosiFirewallTestState.Events | Where-Object { $_ -like 'remove:*' }).Count) { throw 'Removed foreign probe' } }
    Assert-Case 'cleanup error fails closed and preserves evidence' { $global:FlosiFirewallTestState=New-State; $global:FlosiFirewallTestState.CleanupFail=$true; Must-Reject 'Diagnose'; if ($global:FlosiFirewallTestState.Rules.Count -ne 1) { throw 'Unexpected cleanup' } }
    [pscustomobject]@{policySimulationPassed=$passed;failed=0;nativeWindowsFirewallTested=$false;adminIdentitySimulated=$true} | ConvertTo-Json -Compress
} finally { $env:OS=$previousOS; Remove-Variable FlosiFirewallTestState -Scope Global; Remove-Item -LiteralPath $root -Recurse -Force }
