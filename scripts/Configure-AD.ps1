[CmdletBinding()]
param(
    [Parameter()]
    [string] $AdDomainName = "",

    [Parameter()]
    [string] $AdAdminUsername = "",

    [Parameter(Mandatory = $true)]
    [SecureString] $AdAdminPassword,

    [Parameter()]
    [string] $GmsaName = "",

    [Parameter()]
    [string] $GmsaGroupName = "",

    [Parameter(Mandatory = $true)]
    [string] $GmsaUserName,

    [Parameter(Mandatory = $true)]
    [SecureString] $GmsaUserPassword
)

# Create AD admin credentials because script is going to run under a non-domain joined state
$credential = New-Object -TypeName System.Management.Automation.PSCredential -ArgumentList "$AdAdminUsername@$AdDomainName", $AdAdminPassword


Write-Output "Creating AD security group for gMSA..."
try {
    Get-AdGroup -Identity $GmsaGroupName -Server $AdDomainName  -Credential $credential | Out-Null
    Write-Output "AD group already exists."
}
catch {
    New-ADGroup -Name $GmsaGroupName -SamAccountName $GmsaGroupName -GroupScope DomainLocal -Server $AdDomainName -Credential $credential
    Write-Output "AD group created."
}


Write-Output "Creating gMSA account..."
try{
    Get-ADServiceAccount -Identity $GmsaName -Server $AdDomainName -Credential $credential | Out-Null
    Write-Output "AD gMSA acount already exists."
}
catch{
    New-ADServiceAccount -Name $GmsaName -DnsHostName "$GmsaName.$AdDomainName" -ServicePrincipalNames "host/$GmsaName", "host/$GmsaName.$AdDomainName" -PrincipalsAllowedToRetrieveManagedPassword $GmsaGroupName -Server $AdDomainName -Credential $credential
    Write-Output "AD gMSA created."
}


Write-Output "Creating AD user..."
try{
    Get-ADUser -Identity $GmsaUserName -Server $AdDomainName -Credential $credential | Out-Null
    Write-Output "AD user already exists."
}
catch{
    New-ADUser -Name $GmsaUserName  -UserPrincipalName "$GmsaUserName@$AdDomainName" -Server $AdDomainName -Credential $credential
    Write-Output "AD user created."
}

Write-Output "Resetting AD user password..."
Set-ADAccountPassword -Identity $GmsaUserName -Reset -NewPassword $GmsaUserPassword -Server $AdDomainName -Credential $credential
Enable-ADAccount -Identity $GmsaUserName -Server $AdDomainName -Credential $credential

Write-Output "Adding AD user to gMSA security group..."
Add-ADGroupMember -Identity $GmsaGroupName -Members "$GmsaUserName" -Server $AdDomainName -Credential $credential