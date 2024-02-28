#!/bin/bash

# Extract the version number associated with "aws-cdk" from package.json
aws_cdk_version=$(jq -r '.devDependencies."aws-cdk"' "package.json")
echo "Version of CDK to install: $aws_cdk_version"

# Install CDK based on its version
npm install -g "aws-cdk@$aws_cdk_version"
