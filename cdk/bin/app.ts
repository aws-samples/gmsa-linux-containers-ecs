#!/usr/bin/env node
import 'source-map-support/register';
import * as config from './config'

import * as cdk from 'aws-cdk-lib';
import { InfrastructureStack as InfrastructureStack } from '../lib/infrastructure-stack';
import { DatabaseStack } from '../lib/database-stack';
import { ApplicationStack } from '../lib/application-stack';
import { BastionHostStack } from '../lib/bastion-stack';

import { AwsSolutionsChecks } from 'cdk-nag'
import { Aspects } from 'aws-cdk-lib';

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

// Create shared infrastructure
const infraStack = new InfrastructureStack(app, `${config.props.SOLUTION_ID}-infrastructure`, {
  env: envConfig,
  solutionId: config.props.SOLUTION_ID,
  ecsInstanceKeyPairName: config.props.EC2_INSTANCE_KEYPAIR_NAME,
  domianJoinedEcsInstances: config.props.DOMAIN_JOIN_ECS
});

// Create the SQL Server RDS instance 
const dbStack = new DatabaseStack(app, `${config.props.SOLUTION_ID}-database`, {
  env: envConfig,
  solutionId: config.props.SOLUTION_ID,
  vpc: infraStack.vpc,
  activeDirectoryId: infraStack.activeDirectory.attrAlias
});

//Create Bastio  Host / AD Admin Instance
const bastionStack = new BastionHostStack(app, `${config.props.SOLUTION_ID}-bastion`, {  
  env: envConfig,
  solutionId: config.props.SOLUTION_ID,
  vpc: infraStack.vpc,
  adInfo: infraStack.adInfo,
  adManagementInstanceKeyPairName: config.props.EC2_INSTANCE_KEYPAIR_NAME,
  adManagementInstanceAccessIp: config.props.MY_SG_INGRESS_IP,
  activeDirectory: infraStack.activeDirectory,
  activeDirectoryAdminPasswordSecret: infraStack.activeDirectoryAdminPasswordSecret,
  sqlServerRdsInstance: dbStack.sqlServerInstance,
  domiainJoinSsmDocument: infraStack.domiainJoinSsmDocument,
  credSpecParameter: infraStack.credSpecParameter,
  credentialsFetcherIdentitySecret: infraStack.credentialsFetcherIdentitySecret
});

if (config.props.DEPLOY_APP === '1') {
  new ApplicationStack(app, `${config.props.SOLUTION_ID}-application`, {
    env: envConfig,
    solutionId: config.props.SOLUTION_ID,
    vpc: infraStack.vpc,
    ecsAsgSecurityGroup: infraStack.ecsAsgSecurityGroup,
    domainName: infraStack.activeDirectory.name,
    dbInstanceName: dbStack.sqlServerInstance.instanceIdentifier,
    dbInstanceSecurityGroup: dbStack.sqlServerSecurityGroup,
    credSpecParameter: infraStack.credSpecParameter
  });
}
else {
  console.log('DEPLOY_APP not set, skipping application deployment.');
}