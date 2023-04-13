[CmdletBinding()]
param(
    [Parameter()]
    [string] $SolutionId = "",

    [Parameter()]
    [string] $AdDomainName = "",

    [Parameter()]
    [string] $GmsaName = "",

    [Parameter()]
    [string] $GmsaGroupName = ""
)

$ErrorActionPreference = "Stop" 

Write-Output "Creating gMSA credential spec..."
$credSpecFile = New-CredentialSpec -AccountName $GmsaName -Domain $AdDomainName -Path "$PSScriptRoot\$GmsaName.json"
$credSpecContent = (Get-Content $credSpecFile.Path -Raw) -Replace '\s','' 

Write-Output "Updating SSM Parameter with CredSpec content..."
Write-SSMParameter -Name "/$SolutionId/credspec" -Value $credSpecContent -Overwrite $true 
