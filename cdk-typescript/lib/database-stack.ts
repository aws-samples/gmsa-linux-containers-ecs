// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as rds from 'aws-cdk-lib/aws-rds';
import { SqlServerEngineVersion } from 'aws-cdk-lib/aws-rds';

export interface DatabaseStackProps extends StackProps {
  solutionId: string,
  vpc: ec2.Vpc,
  activeDirectoryId: string,
  ecsAsgSecurityGroup: ec2.ISecurityGroup | undefined,
}
export class DatabaseStack extends Stack {

  // Reference to the SQL Server RDS instance created
  public sqlServerInstance: rds.DatabaseInstance;

  // Name of the admin user configured in the RDS SQL Server instance
  public sqlServerInstanceAdminUser = 'web_dbo';


  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    // Set up an RDS SQL Server instance with Windows auth to the Active Directory.

    // Create a SQL Server instance inside the VPC and joined to the existing directory.
    const sqlServerInstance = new rds.DatabaseInstance(this, 'web-sql-rds', {
      engine: rds.DatabaseInstanceEngine.sqlServerWeb({ version: SqlServerEngineVersion.VER_15 }),
      licenseModel: rds.LicenseModel.LICENSE_INCLUDED,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE3, ec2.InstanceSize.XLARGE),
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      credentials: rds.Credentials.fromGeneratedSecret(this.sqlServerInstanceAdminUser),
      autoMinorVersionUpgrade: true,
      storageEncrypted: true,

      // You may wish to change these settings in a production environment.
      deletionProtection: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    // Set up credential rotation for the DB administrator user.
    sqlServerInstance.addRotationSingleUser({
      securityGroup: sqlServerInstance.connections.securityGroups[0], // Workaround for: https://repost.aws/questions/QUr5JL9E9fQKO6nq70njW65w/endpoint-port-does-not-exist-for-security-group-of-rds-proxy
    });

    // Store the database credentials secret ARN in the Systems Manager Parameter Store, so it can be referenced by the Web application stack.
    const sqlServerInstanceSecretArnParameter = new ssm.StringParameter(this, 'sql-server-credentials-secret-arn', {
      allowedPattern: '.*',
      description: 'ARN of the secret containing the database credentials',
      parameterName: `/${props.solutionId}/web-site/sql-server-credentials-secret-arn`,
      stringValue: sqlServerInstance.secret?.secretArn ?? '',
      tier: ssm.ParameterTier.STANDARD
    });

    // Create an IAM Role with the `AmazonRDSDirectoryServiceAccess` policy. This is required to join the SQL Server to the domain.
    const dbRole = new iam.Role(this, 'rds-role', {
      assumedBy: new iam.ServicePrincipal('rds.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonRDSDirectoryServiceAccess')],
    });

    // Join the SQL server to the domain. This isn't available in CDK yet, so use the CloudFormation primitives.
    // In order to join the server to the domain, we need to know the ID of the Active Directory.
    const cfnSqlServerInstance = sqlServerInstance.node.defaultChild as rds.CfnDBInstance;
    cfnSqlServerInstance.domain = props.activeDirectoryId;
    cfnSqlServerInstance.domainIamRoleName = dbRole.roleName;

    // Allow communication from then ECS ASG to the RDS SQL Server database, if it exists
    if(props.ecsAsgSecurityGroup){
      sqlServerInstance.connections.securityGroups[0].connections.allowFrom(props.ecsAsgSecurityGroup, ec2.Port.tcp(1433));
    }


    // Output information about the database instance.
    new cdk.CfnOutput(this, 'DBInstanceIdentifier', { value: sqlServerInstance.instanceIdentifier });
    new cdk.CfnOutput(this, 'DBInstanceEndpointAddress', { value: sqlServerInstance.dbInstanceEndpointAddress });
    new cdk.CfnOutput(this, 'DBInstanceCredentialsSecretARN', { value: sqlServerInstance.secret?.secretArn ?? '' });
    

    // Exposes the SQL Server instance for higher level constructs
    this.sqlServerInstance = sqlServerInstance;
  }
}
