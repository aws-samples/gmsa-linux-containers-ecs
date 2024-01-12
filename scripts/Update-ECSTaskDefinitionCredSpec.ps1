<#
.Description
This script updates an Amazon ECS task definition that uses the legacy 'dockerSecurityOptions' attribute by removing it and setting the new 'credentialSpecs' attribute.

.PARAMETER TaskDefinitionName
The family for the latest ACTIVE revision, family and revision (family:revision) for a specific revision in the family, or full Amazon Resource Name (ARN) of the task definition to describe.
#> 
[CmdletBinding()]
param (
    [Parameter(Mandatory = $true)]
    [string]$TaskDefinitionName
)

$ErrorActionPreference = "Stop"

Write-Host "Obtaining task definition '$TaskDefinitionName'..."
$taskDefinition = $($(aws ecs describe-task-definition --task-definition $taskDefinitionName) | ConvertFrom-Json).taskDefinition

Write-Host "Checking for the credentialSpec in environemnt variables..."
$credentialsSpec = $($taskDefinition.containerDefinitions[0].environment | Where-Object { $_.name -eq "CREDENTIAL_SPEC" }).value

if ($null -ne $credentialsSpec) {
    # Add the credentialSpecs property and deletes the environment variable
    $taskDefinition.containerDefinitions[0] | Add-Member -Name "credentialSpecs" -Value @($credentialsSpec) -MemberType NoteProperty
    $taskDefinition.containerDefinitions[0].environment = $taskDefinition.containerDefinitions[0].environment | Where-Object { $_.name -ne "CREDENTIAL_SPEC" }
      
    # Remove properties that can't be updated
    $taskDefinition.PSObject.Properties.Remove("taskDefinitionArn")
    $taskDefinition.PSObject.Properties.Remove("registeredAt")
    $taskDefinition.PSObject.Properties.Remove("registeredBy")
    $taskDefinition.PSObject.Properties.Remove("revision")
    $taskDefinition.PSObject.Properties.Remove("status")
    $taskDefinition.PSObject.Properties.Remove("requiresAttributes")
    $taskDefinition.PSObject.Properties.Remove("compatibilities")    

    Write-Host "Creating new revision for the task definition '$TaskDefinitionName'..."
    $taskDefinition | ConvertTo-Json -Depth 10 | Set-Content -Path "task-def.json"
    $updatedTaskDefinition = $(aws ecs register-task-definition --cli-input-json file://task-def.json) | ConvertFrom-Json
    $updatedRevision = $updatedTaskDefinition.taskDefinition.revision
    Write-Host "Revision $updatedRevision created successfully."

    Write-Host "Cleaning up temporary files..."
    Remove-Item -Path "task-def.json" -Force
}
else {
    Write-Host "CredentialSpec not found in environemnt variables, skipping..."
}

Write-Host "Complete."
