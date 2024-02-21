#!/usr/bin/env node
import 'source-map-support/register';
import * as config from './config'

import * as cdk from 'aws-cdk-lib';
import { InfrastructureStack as InfrastructureStack } from '../lib/infrastructure-stack';
import { DatabaseStack } from '../lib/database-stack';
import { ApplicationStack } from '../lib/application-stack';
import { BastionHostStack } from '../lib/bastion-stack';

const envConfig = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION
}

const app = new cdk.App();

// Add the cdk-nag AwsSolutions Pack with extra verbose logging enabled.
// Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }))

if (!config.props.EC2_INSTANCE_KEYPAIR_NAME) {
  throw 'An EC2 Key pair for the AD Management instance is required to create the shared infrastructure.'
}

if (!config.props.MY_SG_INGRESS_IP) {
  throw 'The IP to access the AD Management instance is required to create the shared infrastructure.'
}

if(config.props.FARGATE === '1' && config.props.DOMAIN_JOIN_ECS === '1'){
  throw `gMSA on Fargate doesn't support domain-joined mode. Please set DOMAIN_JOIN_ECS=0 to continue deploying with Fargate.`
}

if(config.props.FARGATE === '1' && config.props.CREDSPEC_FROM_S3 === '0'){
  throw `gMSA on Fargate doesn't support reading the CredSpec from from SSM Parameter Store. Please set CREDSPEC_FROM_S3=1 to continue deploying with Fargate. Otherwise, set FARGATE=0`
}

// Create shared infrastructure
const infraStack = new InfrastructureStack(app, `${config.props.SOLUTION_ID}-infrastructure`, {
  env: envConfig,
  solutionId: config.props.SOLUTION_ID,
  ecsInstanceKeyPairName: config.props.EC2_INSTANCE_KEYPAIR_NAME,
  useDomainJoin: config.props.DOMAIN_JOIN_ECS === '1',
  useFargate: config.props.FARGATE === '1',
});

// Create the SQL Server RDS instance 
const dbStack = new DatabaseStack(app, `${config.props.SOLUTION_ID}-database`, {
  env: envConfig,
  solutionId: config.props.SOLUTION_ID,
  vpc: infraStack.vpc,
  activeDirectoryId: infraStack.activeDirectory.attrAlias,
  ecsAsgSecurityGroup: infraStack.ecsAsgSecurityGroup
});

//Create Bastion Host / AD Admin Instance
const bastionStack = new BastionHostStack(app, `${config.props.SOLUTION_ID}-bastion`, {
  env: envConfig,
  solutionId: config.props.SOLUTION_ID,
  vpc: infraStack.vpc,
  adInfo: infraStack.adInfo,
  ecsInstanceKeyPairName: config.props.EC2_INSTANCE_KEYPAIR_NAME,
  adManagementInstanceAccessIp: config.props.MY_SG_INGRESS_IP,
  activeDirectory: infraStack.activeDirectory,
  activeDirectoryAdminPasswordSecret: infraStack.activeDirectoryAdminPasswordSecret,
  domainJoinSsmDocument: infraStack.domainJoinSsmDocument,
  domainJoinTag: infraStack.adDomainJoinTagKey,
  sqlServerRdsInstance: dbStack.sqlServerInstance,
  credSpecParameter: infraStack.credSpecParameter,
  credSpecBucket: infraStack.credSpecBucket,
  domainlessIdentitySecret: infraStack.domainlessIdentitySecret
});

const appStack = new ApplicationStack(app, `${config.props.SOLUTION_ID}-application`, {
  env: envConfig,
  solutionId: config.props.SOLUTION_ID,
  vpc: infraStack.vpc,
  useDomainJoin: config.props.DOMAIN_JOIN_ECS === '1',
  useFargate: config.props.FARGATE === '1',
  ecsAsgSecurityGroup: infraStack.ecsAsgSecurityGroup,
  domainName: infraStack.activeDirectory.name,
  dbInstanceName: dbStack.sqlServerInstance.instanceIdentifier,
  credSpecParameter: infraStack.credSpecParameter,
  credSpecBucket: infraStack.credSpecBucket,
  readCredSpecFromS3: config.props.CREDSPEC_FROM_S3 === '1',
  domainlessIdentitySecret: infraStack.domainlessIdentitySecret,
  deployService: config.props.DEPLOY_APP === '1',
});