#!/bin/bash
set -o errexit

if [ -z "$1" ]; then
  echo "Please provide name of CDK project you want to update."
  exit 1
fi

# Preparing CDK directories
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
CDK_FOLDER=$SCRIPT_DIR/../$1

CDK_OUT_PATH="$CDK_FOLDER/cdk.out"
INTEG_PATH="$CDK_FOLDER/integ-tests"
mkdir -p $INTEG_PATH

# Set variables needed for CDK across all tests 
export EC2_INSTANCE_KEYPAIR_NAME="gmsa"
export MY_SG_INGRESS_IP="127.0.0.0"

# Defines testing function
function update_cdk_test_case() {
  export TEST_NAME=$1
  export DOMAIN_JOIN_ECS=${2:-0}
  export FARGATE=${3:-0}
  export CREDSPEC_FROM_S3=${4:-0}
  export DEPLOY_APP=1

  echo "=================================================="
  echo "$TEST_NAME: Synthesizing CDK..."
  cd $CDK_FOLDER
  cdk synth

  # Copy CDK out to integ-tests folder  
  cp -fr "$CDK_OUT_PATH/" "$INTEG_PATH/$TEST_NAME"

  echo $"$TEST_NAME: Test results updated."  
}

# Run the test cases
echo "Updating test cases results..."

update_cdk_test_case "domain-joined-ec2-ssm" 1 0 0
update_cdk_test_case "domain-joined-ec2-s3" 1 0 1

update_cdk_test_case "domainless-ec2-ssm" 0 0 0
update_cdk_test_case "domainless-ec2-s3" 0 0 1

update_cdk_test_case "domainless-fargate-s3" 0 1 1

echo "Test cases updated successfully."