# Numeric comparison accepts equivalent CIDR/range output, never a weaker set.
Add-Type -AssemblyName System.Numerics
function ConvertTo-FlosiAddressSet([string[]]$Addresses) {
    $intervals = @()
    foreach ($text in $Addresses) {
        if ($text -eq 'Any') { $parts = @('0.0.0.0/0','::/0') }
        elseif ($text -eq 'Any4') { $parts = @('0.0.0.0/0') }
        elseif ($text -eq 'Any6') { $parts = @('::/0') }
        else { $parts = @($text) }
        foreach ($part in $parts) {
            if ($part.Contains('%')) { throw 'Scoped addresses are not fixed QA selectors.' }
            $tokens = $part.Split('/'); $ends = $tokens[0].Split('-')
            if ($tokens.Count -gt 2 -or $ends.Count -gt 2 -or ($tokens.Count -eq 2 -and $ends.Count -ne 1)) { throw 'Invalid QA address syntax.' }
            $ip = [Net.IPAddress]::Parse($ends[0])
            $width = if ($ip.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork) { 32 } else { 128 }
            $hex = ([BitConverter]::ToString($ip.GetAddressBytes())).Replace('-','')
            $start = [Numerics.BigInteger]::Parse('0'+$hex,[Globalization.NumberStyles]::AllowHexSpecifier)
            $end = $start
            if ($tokens.Count -eq 2) {
                if ($tokens[1].Contains('.') -and $width -eq 32) {
                    $bits = (([Net.IPAddress]::Parse($tokens[1])).GetAddressBytes() | ForEach-Object { [Convert]::ToString($_,2).PadLeft(8,'0') }) -join ''
                    if ($bits -notmatch '^1*0*$') { throw 'Noncontiguous QA address mask.' }
                    $prefix = $bits.Replace('0','').Length
                } else { $prefix = [int]::Parse($tokens[1],[Globalization.CultureInfo]::InvariantCulture) }
                if ($prefix -lt 0 -or $prefix -gt $width) { throw 'Invalid QA CIDR length.' }
                $size = [Numerics.BigInteger]::Pow(2,$width-$prefix)
                $start = [Numerics.BigInteger]::Divide($start,$size)*$size; $end=$start+$size-1
            } elseif ($ends.Count -eq 2) {
                $last = [Net.IPAddress]::Parse($ends[1])
                if ($last.AddressFamily -ne $ip.AddressFamily) { throw 'Mixed-family QA address range.' }
                $end = [Numerics.BigInteger]::Parse('0'+([BitConverter]::ToString($last.GetAddressBytes())).Replace('-',''),[Globalization.NumberStyles]::AllowHexSpecifier)
                if ($end -lt $start) { throw 'Reversed QA address range.' }
            }
            $intervals += [pscustomobject]@{ Family=$width; Start=$start; End=$end }
        }
    }
    $merged=[Collections.Generic.List[object]]::new()
    foreach ($interval in @($intervals | Sort-Object Family,Start)) {
        if ($merged.Count -and $merged[$merged.Count-1].Family -eq $interval.Family -and $interval.Start -le $merged[$merged.Count-1].End+1) {
            if ($interval.End -gt $merged[$merged.Count-1].End) { $merged[$merged.Count-1].End=$interval.End }
        } else { $merged.Add($interval) }
    }
    return @($merged | ForEach-Object { '{0}:{1}-{2}' -f $_.Family,$_.Start.ToString([Globalization.CultureInfo]::InvariantCulture),$_.End.ToString([Globalization.CultureInfo]::InvariantCulture) })
}
function Test-FlosiAddressSet($Actual,$Expected) {
    return @(Compare-Object @(ConvertTo-FlosiAddressSet @($Actual)) @(ConvertTo-FlosiAddressSet @($Expected))).Count -eq 0
}
function Get-FlosiFirewallPlan([string]$Binary) {
    $hash=[Security.Cryptography.SHA256]::Create()
    try { $key=([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($Binary.ToLowerInvariant())))).Replace('-','').Substring(0,16) }
    finally { $hash.Dispose() }
    $ipv4=@('0.0.0.0/2','64.0.0.0/3','96.0.0.0/4','112.0.0.0/5','120.0.0.0/6','124.0.0.0/7','126.0.0.0/8','128.0.0.0/1')
    # ::2 through the maximum IPv6 address; no /0, unspecified :: or loopback ::1.
    $ipv6=@(for ($bit=1; $bit -lt 128; $bit++) {
        $bytes=[byte[]]::new(16)
        $bytes[15-[int][Math]::Floor($bit/8)]=[byte](1 -shl ($bit % 8))
        ([Net.IPAddress]::new($bytes)).ToString()+'/'+(128-$bit)
    })
    foreach ($direction in @('Inbound','Outbound')) {
        foreach ($family in @('IPv4','IPv6')) {
            $name="FlosiQA-Orukeet-v2-$key-$direction-$family"
            [pscustomobject]@{ Name=$name; Group="FlosiQA-Orukeet-v2-$key"; Direction=$direction
                Description='Flosi QA v2: fixed non-loopback remote address set; private executable only.'
                Family=$family; Remote=$(if ($family -eq 'IPv4') { $ipv4 } else { $ipv6 })
                LegacyName="FlosiQA-Orukeet-$key-$direction" }
        }
    }
}
function Test-FlosiAny($Value) {
    $values=@($Value)
    return $values.Count -eq 1 -and $values[0].ToString() -eq 'Any'
}
function Assert-FlosiFirewallRule($Rule,$Spec,[string]$Binary,[bool]$RequireEnabled,[bool]$Legacy=$false) {
    $app=$Rule | Get-NetFirewallApplicationFilter; $address=$Rule | Get-NetFirewallAddressFilter
    $port=$Rule | Get-NetFirewallPortFilter; $interface=$Rule | Get-NetFirewallInterfaceTypeFilter
    $alias=$Rule | Get-NetFirewallInterfaceFilter; $service=$Rule | Get-NetFirewallServiceFilter
    $security=$Rule | Get-NetFirewallSecurityFilter
    $expectedName=if ($Legacy) { $Spec.LegacyName } else { $Spec.Name }
    $description=if ($Legacy) { 'Flosi QA only: block non-loopback traffic for the unmodified sherpa offline server.' } else { $Spec.Description }
    $remote=if ($Legacy) { @('0.0.0.0-126.255.255.255','128.0.0.0-255.255.255.255','::/0') } else { $Spec.Remote }
    if ($Rule.Name -cne $expectedName -or $Rule.DisplayName -cne $expectedName -or $Rule.Description -cne $description -or (-not $Legacy -and $Rule.Group -cne $Spec.Group) -or $app.Program -ine $Binary -or $Rule.Action.ToString() -ne 'Block' -or $Rule.Direction.ToString() -ne $Spec.Direction -or $Rule.Profile.ToString() -ne 'Any' -or $Rule.EdgeTraversalPolicy.ToString() -ne 'Block' -or -not (Test-FlosiAddressSet $address.RemoteAddress $remote)) { throw "QA rule identity/address set differs: $expectedName. Existing object preserved." }
    foreach ($value in @($app.Package,$address.LocalAddress,$port.Protocol,$port.LocalPort,$port.RemotePort,$interface.InterfaceType,$alias.InterfaceAlias,$service.Service,$security.LocalUser,$security.RemoteUser,$security.RemoteMachine)) {
        if (-not (Test-FlosiAny $value)) { throw "QA rule has a narrowed filter: $expectedName. Existing object preserved." }
    }
    if ($RequireEnabled -and ($Rule.Enabled.ToString() -ne 'True' -or $Rule.PrimaryStatus.ToString() -ne 'OK' -or $Rule.EnforcementStatus.ToString() -notin @('Full','NotApplicable'))) { throw "QA rule is not active/healthy: $expectedName" }
}
