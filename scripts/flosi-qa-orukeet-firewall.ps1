# Restrictive rules only for the pinned QA executable; no engine/global changes.
[CmdletBinding()]
param([ValidateSet('Check','Install','Diagnose')][string]$Mode='Check', [Parameter(Mandatory=$true)][string]$Binary)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if ($env:OS -ne 'Windows_NT') { throw 'Windows firewall verification requires Windows.' }
. (Join-Path $PSScriptRoot 'lib/flosi-qa-firewall.ps1')
$repo=Split-Path -Parent $PSScriptRoot
$expected=[IO.Path]::GetFullPath((Join-Path $repo 'resources/bin/sherpa-onnx-ws-win32-x64.exe'))
if ([IO.Path]::GetFullPath($Binary) -ine $expected -or -not (Test-Path -LiteralPath $expected -PathType Leaf)) { throw 'Only this dedicated checkout executable may be protected.' }
$item=Get-Item -LiteralPath $expected -Force
while ($null -ne $item) {
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'QA firewall targets must not traverse links/junctions.' }
    if ($item -is [IO.FileInfo]) { $item=$item.Directory } else { $item=$item.Parent }
}
$pins=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'flosi-qa-orukeet-artifacts.json') -Raw | ConvertFrom-Json
$pin=@($pins.runtimeFiles | Where-Object file -eq 'sherpa-onnx-ws-win32-x64.exe')[0]
if ((Get-FileHash -LiteralPath $expected -Algorithm SHA256).Hash.ToLowerInvariant() -ne $pin.installedSha256) { throw 'QA executable does not match its pinned installed hash.' }
foreach ($serviceName in @('BFE','MpsSvc')) { if ((Get-Service -Name $serviceName).Status.ToString() -ne 'Running') { throw "Firewall service is not running: $serviceName" } }
$profiles=@(Get-NetFirewallProfile -PolicyStore ActiveStore)
if ($profiles.Count -ne 3) { throw 'Cannot inspect all firewall profiles.' }
foreach ($profile in $profiles) { if ($profile.Enabled.ToString() -ne 'True' -or $profile.AllowLocalFirewallRules.ToString() -eq 'False') { throw 'Firewall disabled or local rules prohibited by policy; QA blocked.' } }
$plan=@(Get-FlosiFirewallPlan $expected)
function Get-ExactRule([string]$Name,[string]$Store) {
    try { return @(Get-NetFirewallRule -PolicyStore $Store -Name $Name -ErrorAction Stop) }
    catch {
        if ($_.CategoryInfo.Category.ToString() -eq 'ObjectNotFound') {
            # Provider versions can name InstanceID/Name differently in the
            # error ID. Confirm absence with a SUCCESSFUL independent query.
            return @(Get-NetFirewallRule -PolicyStore $Store -ErrorAction Stop | Where-Object { $_.Name -ceq $Name })
        }
        throw # Never turn an ACL/provider failure into permission to create.
    }
}
function Assert-One($Rules,[string]$Name) { if (@($Rules).Count -ne 1) { throw "Missing or ambiguous QA rule: $Name" } }
function Assert-Elevated {
    $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
    if (-not ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Install/Diagnose require explicit elevation; run the app itself without elevation.' }
}
if ($Mode -ne 'Check') {
    Assert-Elevated
    $running=@(Get-CimInstance Win32_Process -Filter "Name='sherpa-onnx-ws-win32-x64.exe'" | Where-Object { $_.ExecutablePath -ieq $expected })
    if ($running.Count) { throw 'Close QA and its own Orukeet process normally first. No process was terminated.' }
}
if ($Mode -eq 'Diagnose') {
    $results=[Collections.Generic.List[object]]::new(); $nonce=[Guid]::NewGuid().ToString('N')
    $probeGroup="FlosiQA-Orukeet-Probe-$nonce"
    $candidates=@(
        @{ Label='control-ipv4'; Remote=@('192.0.2.1') }, @{ Label='control-ipv6'; Remote=@('2001:db8::1') },
        @{ Label='legacy-lower-range'; Remote=@('0.0.0.0-126.255.255.255') },
        @{ Label='legacy-upper-range'; Remote=@('128.0.0.0-255.255.255.255') },
        @{ Label='legacy-ipv6-zero-prefix'; Remote=@('::/0') },
        @{ Label='legacy-combined'; Remote=@('0.0.0.0-126.255.255.255','128.0.0.0-255.255.255.255','::/0') },
        @{ Label='factor-lower-nonzero-start'; Remote=@('0.0.0.1-126.255.255.255') },
        @{ Label='factor-lower-ordinary-start'; Remote=@('1.0.0.0-126.255.255.255') },
        @{ Label='factor-upper-excluding-limited-broadcast'; Remote=@('128.0.0.0-255.255.255.254') },
        @{ Label='factor-ipv4-only-ranges'; Remote=@('0.0.0.0-126.255.255.255','128.0.0.0-255.255.255.255') },
        @{ Label='factor-ipv6-two-halves'; Remote=@('::/1','8000::/1') },
        @{ Label='factor-ipv4-zero-network-cidr'; Remote=@('0.0.0.0/2') })
    foreach ($spec in $plan) { $candidates+=@{ Label="v2-$($spec.Direction)-$($spec.Family)"; Remote=$spec.Remote; Direction=$spec.Direction } }
    foreach ($candidate in $candidates) {
        $directions=if ($candidate.ContainsKey('Direction')) { @($candidate.Direction) } else { @('Inbound','Outbound') }
        foreach ($direction in $directions) {
            $name="$probeGroup-$($results.Count)"
            if (@(Get-ExactRule $name 'PersistentStore').Count) { throw 'Unexpected probe identity collision; preserved.' }
            $result=[ordered]@{ label=$candidate.Label; direction=$direction; remote=$candidate.Remote; accepted=$false; equivalent=$false; normalized=@(); error=$null; errorId=$null; category=$null; hresult=$null; cleaned=$false }
            try {
                New-NetFirewallRule -PolicyStore PersistentStore -Name $name -DisplayName $name -Group $probeGroup -Description 'Flosi QA disabled parser probe.' -Program $expected -Direction $direction -Action Block -Enabled False -Profile Any -Protocol Any -RemoteAddress $candidate.Remote -InterfaceType Any -EdgeTraversalPolicy Block | Out-Null
                $stored=@(Get-ExactRule $name 'PersistentStore'); Assert-One $stored $name
                $result.normalized=@($stored[0] | Get-NetFirewallAddressFilter | Select-Object -ExpandProperty RemoteAddress)
                $result.accepted=$true; $result.equivalent=Test-FlosiAddressSet $result.normalized $candidate.Remote
            } catch { $result.error=$_.Exception.Message; $result.errorId=$_.FullyQualifiedErrorId; $result.category=$_.CategoryInfo.Category.ToString(); $result.hresult='0x{0:X8}' -f ($_.Exception.HResult -band 0xffffffffL) }
            finally {
                $left=@(Get-ExactRule $name 'PersistentStore')
                if ($left.Count) {
                    Assert-One $left $name; $owned=$left[0]; $app=$owned | Get-NetFirewallApplicationFilter
                    if ($owned.Name -cne $name -or $owned.Group -cne $probeGroup -or $owned.Description -cne 'Flosi QA disabled parser probe.' -or $owned.DisplayName -cne $name -or $app.Program -ine $expected -or $owned.Enabled.ToString() -ne 'False' -or $owned.Action.ToString() -ne 'Block' -or $owned.Direction.ToString() -ne $direction) { throw "Probe identity differs; object preserved: $name" }
                    Remove-NetFirewallRule -InputObject $owned
                }
                if (@(Get-ExactRule $name 'PersistentStore').Count) { throw "Disabled probe cleanup failed: $name. Preserved; inspect manually." }
                $result.cleaned=$true
            }
            $results.Add([pscustomobject]$result)
        }
    }
    [pscustomobject]@{ schema=2; windows=([Environment]::OSVersion.VersionString); powershell=$PSVersionTable.PSVersion.ToString(); binary=$expected; sha256=$pin.installedSha256; probes=@($results.ToArray()); productionRulesChanged=$false; listenerStarted=$false; nativeIsolationValidated=$false } | ConvertTo-Json -Depth 8
    return
}
# Preserve even partial legacy installations; validate identity, never delete them.
foreach ($spec in @($plan | Where-Object Family -eq 'IPv4')) {
    foreach ($store in @('PersistentStore','ActiveStore')) {
        $legacy=@(Get-ExactRule $spec.LegacyName $store)
        if ($legacy.Count) { Assert-One $legacy $spec.LegacyName; Assert-FlosiFirewallRule $legacy[0] $spec $expected $false $true }
    }
}
if ($Mode -eq 'Install') {
    foreach ($spec in $plan) {
        foreach ($store in @('PersistentStore','ActiveStore')) {
            $rules=@(Get-ExactRule $spec.Name $store)
            if ($rules.Count) { Assert-One $rules $spec.Name; Assert-FlosiFirewallRule $rules[0] $spec $expected $false }
        }
    }
    try {
        foreach ($spec in $plan) {
            if (-not @(Get-ExactRule $spec.Name 'PersistentStore').Count) {
                New-NetFirewallRule -PolicyStore PersistentStore -Name $spec.Name -DisplayName $spec.Name -Group $spec.Group -Description $spec.Description -Program $expected -Direction $spec.Direction -Action Block -Enabled False -Profile Any -Protocol Any -RemoteAddress $spec.Remote -InterfaceType Any -EdgeTraversalPolicy Block | Out-Null
            }
        }
        foreach ($spec in $plan) { $rules=@(Get-ExactRule $spec.Name 'PersistentStore'); Assert-One $rules $spec.Name; Assert-FlosiFirewallRule $rules[0] $spec $expected $false }
        foreach ($spec in $plan) { $rule=@(Get-ExactRule $spec.Name 'PersistentStore')[0]; if ($rule.Enabled.ToString() -ne 'True') { Enable-NetFirewallRule -InputObject $rule | Out-Null } }
    } catch { throw "QA firewall installation incomplete; QA must remain closed. Restrictive rules retained for safe retry; no rules deleted. Cause: $($_.Exception.Message)" }
}
foreach ($spec in $plan) { $rules=@(Get-ExactRule $spec.Name 'ActiveStore'); Assert-One $rules $spec.Name; Assert-FlosiFirewallRule $rules[0] $spec $expected $true }
Write-Output 'Flosi QA firewall v2: four dedicated Block rules verified in ActiveStore. Native loopback/LAN tests remain required.'
