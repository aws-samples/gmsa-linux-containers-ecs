<#
.Description
This script updates an Amazon ECS task definition that uses the legacy 'dockerSecurityOptions' attribute by removing it and setting the new 'credentialSpecs' attribute.

.PARAMETER TaskDefinitionName
The family for the latest ACTIVE revision, family and revision (family:revision) for a specific revision in the family, or full Amazon Resource Name (ARN) of the task definition to describe.

.PARAMETER DomainJoinedMode
Sets the Amazon ECS task definition gMSA support in domain-joined mode. By default sets gMSA support in domainless mode.
#> 
[CmdletBinding()]
param (
    [Parameter(Mandatory = $true)]
    [string]$TaskDefinitionName,

    [Parameter()]
    [switch]$DomainJoinedMode
)

$ErrorActionPreference = "Stop"

Write-Host "Obtaining task definition '$TaskDefinitionName'..."
$taskDefinition = $($(aws ecs describe-task-definition --task-definition $taskDefinitionName) | ConvertFrom-Json).taskDefinition

Write-Host "Checking if task definition has required 'dockerSecurityOptions' attribute..."
$dockerSecurityOptions = $taskDefinition.containerDefinitions[0].dockerSecurityOptions

if ($null -ne $dockerSecurityOptions) {
    If ($DomainJoinedMode) {
        Write-Host "Updating task definition JSON for domain-joined mode..."        
    }
    else {
        Write-Host "Updating task definition JSON for domainless mode..."
        for ($i = 0; $i -lt $taskDefinition.containerDefinitions[0].dockerSecurityOptions.Count; $i++) {
            $item = $taskDefinition.containerDefinitions[0].dockerSecurityOptions[$i]
            $taskDefinition.containerDefinitions[0].dockerSecurityOptions[$i] = $item -replace "credentialspec:", "credentialspecdomainless:"
        }
    }

    $taskDefinition.containerDefinitions[0] | Add-Member -Name "credentialSpecs" -Value $taskDefinition.containerDefinitions[0].dockerSecurityOptions -MemberType NoteProperty
    $taskDefinition.containerDefinitions[0].PSObject.Properties.Remove("dockerSecurityOptions")
    $taskDefinition.PSObject.Properties.Remove("taskDefinitionArn")
    $taskDefinition.PSObject.Properties.Remove("registeredAt")
    $taskDefinition.PSObject.Properties.Remove("registeredBy")
    $taskDefinition.PSObject.Properties.Remove("revision")
    $taskDefinition.PSObject.Properties.Remove("status")
    $taskDefinition.PSObject.Properties.Remove("requiresAttributes")
    $taskDefinition.PSObject.Properties.Remove("compatibilities")

    $taskDefinition | ConvertTo-Json -Depth 10 | Set-Content -Path "task-def.json"

    Write-Host "Creating new revision for the task definition '$TaskDefinitionName'..."
    $updatedTaskDefinition = $(aws ecs register-task-definition --cli-input-json file://task-def.json) | ConvertFrom-Json
    $updatedRevision = $updatedTaskDefinition.taskDefinition.revision
    Write-Host "Revision $updatedRevision created successfully."

    Write-Host "Cleaning up temporary files..."
    Remove-Item -Path "task-def.json" -Force

}
else {
    Write-Host "The task definition '$TaskDefinitionName' doesn't have the 'dockerSecurityOptions' attribute. Skipping..."
}

Write-Host "Complete."
