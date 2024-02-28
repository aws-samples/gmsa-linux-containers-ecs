#!/bin/bash
set -o errexit

if [ -z "$1" ]; then
  echo "Please provide name of CDK project you want to validate."
  exit 1
fi

# Preparing CDK directories
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
CDK_FOLDER=$SCRIPT_DIR/../$1

CDK_OUT_PATH="$CDK_FOLDER/cdk.out"
INTEG_PATH="$CDK_FOLDER/integ-tests"

# Set variables needed for CDK across all tests 
export EC2_INSTANCE_KEYPAIR_NAME="gmsa"
export MY_SG_INGRESS_IP="127.0.0.0"

# Defines testing function
function run_cdk_test_case() {
  export TEST_NAME=$1
  export DOMAIN_JOIN_ECS=${2:-0}
  export FARGATE=${3:-0}
  export CREDSPEC_FROM_S3=${4:-0}
  export DEPLOY_APP=1

  echo "=================================================="
  echo "$TEST_NAME: Synthesizing CDK..."
  cd $CDK_FOLDER
  cdk synth

  source_folder=$CDK_OUT_PATH
  target_folder="$INTEG_PATH/$TEST_NAME"
  error=""

  # Iteraring over each CDK.OUT file to make sure it existis in integartion tests folder, and their content match.
  for file in $(find $source_folder -type f); do
    filename=$(basename $file)

    # Check if the file exists in the target directory
    if [ -f "$target_folder/$filename" ]; then
        # Compare the content of the files
        if cmp -s "$file" "$target_folder/$filename"; then 
          echo > /dev/null
        else
            error="File '$filename''s content is different."
            echo -e $"$TEST_NAME: ${RED}$error${NC}"  
        fi
    else
        error="File $filename is missing in the integraton tests folder."
        echo -e $"$TEST_NAME: ${RED}$error${NC}."  
    fi

  done

  if [ -z "$error" ]; then
    echo -e $"$TEST_NAME: ${GREEN}Test passed${NC}."  
  else
    echo -e $"$TEST_NAME: ${RED}Test failed${NC}."  
  fi 
}

# Run the test cases
echo "Runing test cases..."

run_cdk_test_case "domain-joined-ec2-ssm" 1 0 0
run_cdk_test_case "domain-joined-ec2-s3" 1 0 1

run_cdk_test_case "domainless-ec2-ssm" 0 0 0
run_cdk_test_case "domainless-ec2-s3" 0 0 1

run_cdk_test_case "domainless-fargate-s3" 0 1 1

echo "Test cases run complete."