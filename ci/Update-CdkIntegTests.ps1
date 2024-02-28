### Script ported to PowerShell using Amazon Q Builder and fixed manually
### Original file: ci/update-cdk-integ-tests.sh

# Set error handling
$ErrorActionPreference = 'Stop'

# Check for CDK project name
if (-not $args) {
  Write-Host "Please provide name of CDK project you want to update."
  Exit 1
}

# Get script directory and CDK folder
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$cdkFolder = Join-Path $scriptDir "../$args" 

# Path variables
$cdkOutPath = Join-Path $cdkFolder "cdk.out"
$integPath = Join-Path $cdkFolder "integ-tests"
New-Item -ItemType Directory -Force -Path $integPath

# Set environment variables
$Env:AWS_DEFAULT_REGION = "us-west-2"
$Env:EC2_INSTANCE_KEYPAIR_NAME = "gmsa" 
$Env:MY_SG_INGRESS_IP = "127.0.0.0"

# Define test function
function Update-CdkTestCase {
  Param(
    [string]$TestName,
    [int]$DomainJoinEcs = 0,
    [int]$Fargate  = 0,
    [int]$CredspecFromS3  = 0
  )

  $Env:DOMAIN_JOIN_ECS = $DomainJoinEcs
  $Env:FARGATE = $Fargate
  $Env:CREDSPEC_FROM_S3 = $CredspecFromS3
  $Env:DEPLOY_APP = 1

  Write-Host "=================================================="
  Write-Host $TestName ": Synthesizing CDK..."  
  cdk synth --path-metadata false --asset-metadata false --version-reporting false

  # Copy output
  Copy-Item "$cdkOutPath\*" -Destination "$integPath\$TestName" -Recurse

  Write-Host $TestName ": Test results updated."
}

# Run tests
try {
  Push-Location $cdkFolder

  Write-Host "Updating test cases results..."

  Update-CdkTestCase "domain-joined-ec2-ssm" 1 0 0
  Update-CdkTestCase "domain-joined-ec2-s3" 1 0 1 

  Update-CdkTestCase "domainless-ec2-ssm" 0 0 0
  Update-CdkTestCase "domainless-ec2-s3" 0 0 1

  Update-CdkTestCase "domainless-fargate-s3" 0 1 1


  Write-Host "Test cases updated successfully."
}
finally {
  Pop-Location
}

