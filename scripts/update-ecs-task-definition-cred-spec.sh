#!/bin/bash

# Function to display help message
function display_help {
    echo "Usage: $0 [-t|--task-definition] <value>"
    echo "  -t, --task-definition      The family for the latest ACTIVE revision, family and revision (family:revision ) for a specific revision in the family, or full Amazon Resource Name (ARN) of the task definition to describe."
    echo "  -d, --domain-joined-mode   Sets the Amazon ECS task definition gMSA support in domain-joined mode. By default sets gMSA support in domainless mode."
    echo "  -h, --help                 Specify the task definition value"
    echo "  <value>                    The family for the latest ACTIVE revision, family and revision (family:revision ) for a specific revision in the family, or full Amazon Resource Name (ARN) of the task definition to describe."
    echo ""
    echo "  This script updates an Amazon ECS task definition that uses the legacy 'dockerSecurityOptions' attribute by removing it and setting the new 'credentialSpecs' attribute."
    exit 1
}

# Check if -h or --help argument is provided
if [[ "$1" == "-h" || "$1" == "--help" ]]; then
    display_help
fi

# Check if the number of arguments is correct
if [[ $# -lt 2 ]]; then
    display_help
fi

# Check if the argument names are correct
if [[ "$1" != "-t" && "$1" != "--task-definition" ]]; then
    display_help
fi

taskDefinitionName=$2
useDomainJoined=0

# Check if -d or --domain-joined-mode flag is provided
if [[ "$3" == "-d" || "$3" == "--domain-joined-mode" ]]; then
    useDomainJoined=1
fi

echo "Obtaining task definition \"$taskDefinitionName\"..."
taskDefinition=$(aws ecs describe-task-definition --task-definition $taskDefinitionName)

echo "Checking if task definition has required 'dockerSecurityOptions' attribute..."
dockerSecurityOptions=$(echo $taskDefinition | jq '.taskDefinition.containerDefinitions[0].dockerSecurityOptions')

if [[ "$dockerSecurityOptions" != "null" ]]; then
        
    if [[ $useDomainJoined -eq 1 ]]; then
        echo "Updating task definition JSON for domain-joined mode..."
        credentialSpecsCommand='.containerDefinitions[0].credentialSpecs = (.containerDefinitions[0].dockerSecurityOptions)'        
    else
        echo "Updating task definition JSON for domainless mode..."
        credentialSpecsCommand='.containerDefinitions[0].credentialSpecs = (.containerDefinitions[0].dockerSecurityOptions | map(gsub("credentialspec:"; "credentialspecdomainless:")))'
    fi
    
    echo $taskDefinition | \
    jq ".taskDefinition | 
      $credentialSpecsCommand |
      del(.containerDefinitions[0].dockerSecurityOptions, .taskDefinitionArn, .registeredAt, .registeredBy, .revision, .status, .requiresAttributes, .compatibilities)" \
    > task-def.json
    
    
    echo "Creating new revision for the task definition \"$taskDefinitionName\"..."
    updatedTaskDefinition=$(aws ecs register-task-definition --cli-input-json file://task-def.json)
    udpatedRevision=$(echo $updatedTaskDefinition | jq '.taskDefinition.revision')
    echo "Revision $udpatedRevision created successfully."
    
    echo "Cleaning up temporary files..."
    rm task-def.json
    
else
    echo "The task definition \"$taskDefinitionName\" doesn't have the 'dockerSecurityOptions' attribute. Skipping..."
fi

echo "Complete."