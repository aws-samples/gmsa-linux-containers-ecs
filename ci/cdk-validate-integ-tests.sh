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
export AWS_DEFAULT_REGION=us-west-2
export EC2_INSTANCE_KEYPAIR_NAME="gmsa"
export MY_SG_INGRESS_IP="127.0.0.0"

# Initialize global test execution variables
total_tests=0
passed_tests=0

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

    # Skip cdk.out file.
    if [ "$filename" == "cdk.out" ]; then
      continue 
    fi

    # Check if the file exists in the target directory
    if [ -f "$target_folder/$filename" ]; then
        # Compare the content of the files
        if cmp -s "$file" "$target_folder/$filename"; then 
          echo > /dev/null
        else
            error="File $filename's content is different."
            echo -e $"$TEST_NAME: ${RED}$error${NC}"  
            echo -e $(diff -u "$file" "$target_folder/$filename")
        fi
    else
        error="File $filename is missing in the integraton tests folder."
        echo -e $"$TEST_NAME: ${RED}$error${NC}."  
    fi

  done

  total_tests=$((total_tests + 1))

  if [ -z "$error" ]; then
    echo -e $"$TEST_NAME: ${GREEN}Test passed${NC}."  
    passed_tests=$((passed_tests + 1))
  else
    echo -e $"$TEST_NAME: ${RED}Test failed${NC}."  
    return 0
  fi 
}

# Run the test cases
passed=0
echo "Runing test cases..."

run_cdk_test_case "domain-joined-ec2-ssm" 1 0 0
run_cdk_test_case "domain-joined-ec2-s3" 1 0 1

run_cdk_test_case "domainless-ec2-ssm" 0 0 0
run_cdk_test_case "domainless-ec2-s3" 0 0 1

run_cdk_test_case "domainless-fargate-s3" 0 1 1

echo
echo "Test cases run complete."
# Outputs test results

echo
if [ $passed_tests -eq $total_tests ]; then
  echo -e "${GREEN}$passed_tests/$total_tests${NC} tests passed."
else
  echo -e "${RED}$passed_tests/$total_tests${NC} tests passed."
fi