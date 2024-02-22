[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $SqlServerInstanceAddress,

    [Parameter(Mandatory = $true)]
    [string] $SqlServerAdminUsername,

    [Parameter(Mandatory = $true)]
    [SecureString] $SqlServerAdminPassword
)

<# 
    .SYNOPSIS
    Converts a SecureString into a plain text String.

    .PARAMETER SecureString
    Secure string to convert.
#>
Function ConvertFrom-SecureString-AsPlainText {
    [CmdletBinding()]
    param (
        [Parameter(
            Mandatory = $true,
            ValueFromPipeline = $true
        )]
        [System.Security.SecureString]
        $SecureString
    )
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureString);
    $PlainTextString = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr);
    $PlainTextString;
}

Write-Output "Downloading database SQL script..."
Invoke-WebRequest -Uri https://raw.githubusercontent.com/lerocha/chinook-database/master/ChinookDatabase/DataSources/Chinook_SqlServer.sql -OutFile "$PSScriptRoot\Chinook.sql" 

Write-Output "Creating sample database..."
Invoke-Sqlcmd -ServerInstance $SqlServerInstanceAddress -Username $SqlServerAdminUsername -Password $(ConvertFrom-SecureString-AsPlainText $SqlServerAdminPassword) -InputFile "$PSScriptRoot\Chinook.sql" -Encrypt Optional

Write-Output "Creating SQL login and users for AD principals..."
Invoke-Sqlcmd -ServerInstance $SqlServerInstanceAddress -Username $SqlServerAdminUsername -Password $(ConvertFrom-SecureString-AsPlainText $SqlServerAdminPassword) -InputFile "$PSScriptRoot/login.sql" -Encrypt Optional

Write-Output "Making sure the database is onlne..."
Invoke-Sqlcmd -ServerInstance $SqlServerInstanceAddress -Username $SqlServerAdminUsername -Password $(ConvertFrom-SecureString-AsPlainText $SqlServerAdminPassword) -Query "EXEC rdsadmin.dbo.rds_set_database_online N'Chinook'" -Encrypt Optional