#!/bin/bash

# Extract the version number associated with "aws-cdk" from package.json
aws_cdk_version=$(jq -r '.devDependencies."aws-cdk"' "package.json")

# Remove the "^" character (if present)
cleaned_version="${aws_cdk_version#^}"
echo "Version of CDK to install: $cleaned_version"

# Install CDK based on its version
npm install -g "aws-cdk@$cleaned_version"
