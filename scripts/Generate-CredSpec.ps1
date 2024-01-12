[CmdletBinding()]
param(
    [Parameter()]
    [string] $SolutionId = "",

    [Parameter()]
    [string] $AdDomainName = "",

    [Parameter()]
    [string] $GmsaName = "",

    [Parameter()]
    [string] $GmsaGroupName = "",

    [Parameter()]
    [string] $DomainlessSecretArn = "",

    [Parameter()]
    [string] $CredSpecS3BucketName = ""
)

$ErrorActionPreference = "Stop" 

Write-Output "Generating gMSA credential spec..."
$credSpecFile = New-CredentialSpec -AccountName $GmsaName -Domain $AdDomainName -Path "$PSScriptRoot\$GmsaName.json"

# Parses CredSpec content
$credSpec = Get-Content $credSpecFile.Path -Raw | ConvertFrom-Json 

# Adds "HostAccountConfig" if domainless AWS Secret/AWS Parameter was provided
if ($DomainlessSecretArn) {
    Write-Output "Adding domainless configuration to credential spec..."
    $credSpec.ActiveDirectoryConfig | Add-Member  -NotePropertyName HostAccountConfig -NotePropertyValue @{
        PortableCcgVersion = "1";
        PluginGUID         = "{859E1386-BDB4-49E8-85C7-3070B13920E1}";
        PluginInput        = @{
            CredentialArn = $DomainlessSecretArn
        };
    }
}

# Convert the CredSpec to minimized JSON and saves it to the original file
$credSpecContent = $credSpec | ConvertTo-Json -Depth 5 -Compress
$credSpecContent | Set-Content -Path $credSpecFile.Path

Write-Output "Updating SSM Parameter with CredSpec content..."
Write-SSMParameter -Name "/$SolutionId/credspec" -Value $credSpecContent -Overwrite $true

Write-Output "Updating S3 bucket with CredSpec content..."
Write-S3Object -BucketName $CredSpecS3BucketName -Key "$SolutionId-CredSpec" -File $credSpecFile.Path