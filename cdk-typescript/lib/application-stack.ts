// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

export interface ApplicationStackProps extends StackProps {
  solutionId: string,
  vpc: ec2.Vpc,
  useDomainJoin: boolean,
  useFargate: boolean,
  ecsAsgSecurityGroup: ec2.ISecurityGroup | undefined,
  domainName: string,
  dbInstanceName: string,
  credSpecParameter: ssm.StringParameter,
  credSpecBucket: s3.Bucket,
  readCredSpecFromS3: boolean,
  domainlessIdentitySecret: secretsmanager.Secret,
  deployService: boolean,
}

export class ApplicationStack extends Stack {
  constructor(scope: Construct, id: string, props: ApplicationStackProps) {
    super(scope, id, props);

    // Get reference to the ECS cluster.
    const cluster = ecs.Cluster.fromClusterAttributes(this, 'ecs-cluster', {
      clusterName: props.solutionId,
      vpc: props.vpc,
      securityGroups: []
    });

    // Create an IAM role for the task execution and  allows read access to the CredSpec SSM Parameter and S3 bucket.
    const taskExecutionRole = new iam.Role(this, 'web-site-task-execution-role', {
      roleName: `${props.solutionId}-web-site-task-execution-role`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com')
    });
    taskExecutionRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'));
    props.credSpecParameter.grantRead(taskExecutionRole);
    props.credSpecBucket.grantRead(taskExecutionRole);
    props.credSpecBucket.grantRead(taskExecutionRole);
    props.domainlessIdentitySecret.grantRead(taskExecutionRole);

    // Create the container repository for the application
    const webSiteRepository = new ecr.Repository(this, 'web-site-repository', {
      repositoryName: `${props.solutionId}/web-site`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create a ECS task. Include an application scratch volume.
    const taskDefinitionProperties = {
      family: 'amazon-ecs-gmsa-linux-web-site-task',
      executionRole: taskExecutionRole,
    };
    const taskDefinition = props.useFargate ?
      new ecs.FargateTaskDefinition(this, 'web-site-task-def', taskDefinitionProperties) :
      new ecs.Ec2TaskDefinition(this, 'web-site-task-def', taskDefinitionProperties);

    // Define the CredSpec type to use
    let credentialSpec: ecs.CredentialSpec;
    if (props.useDomainJoin) {
      if (props.readCredSpecFromS3)
        credentialSpec = ecs.DomainJoinedCredentialSpec.fromS3Bucket(props.credSpecBucket, `${props.solutionId}-CredSpec`);
      else
        credentialSpec = ecs.DomainJoinedCredentialSpec.fromSsmParameter(props.credSpecParameter);
    }
    else {
      if (props.readCredSpecFromS3)
        credentialSpec = ecs.DomainlessCredentialSpec.fromS3Bucket(props.credSpecBucket, `${props.solutionId}-CredSpec`);
      else
        credentialSpec = ecs.DomainlessCredentialSpec.fromSsmParameter(props.credSpecParameter);
    }

    // Add the web application container to the task definition.    
    const webSiteContainer = taskDefinition.addContainer('web-site-container', {
      image: ecs.ContainerImage.fromEcrRepository(webSiteRepository, 'latest'),
      memoryLimitMiB: 512,
      healthCheck: {
        command: ["CMD-SHELL", "curl -f http://localhost:8080/Privacy || exit 1"]
      },
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'web'
      }),
      credentialSpecs: [credentialSpec],
      environment: {
        "ASPNETCORE_ENVIRONMENT": "Development",
        // To use Kerberos authentication, you should use a domain FQDM to refer to the SQL Server,
        //   if you use the endpoint provided for by RDS the NTLM auth will be used instead, and will fail.
        "ConnectionStrings__Chinook": `Server=${props.dbInstanceName}.${props.domainName};Database=Chinook;Integrated Security=true;TrustServerCertificate=true;`,
      }
    });
    webSiteContainer.addPortMappings({ containerPort: 8080 });

    // Gives permission for ECS-Exec to run
    taskDefinition.addToTaskRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ssmmessages:CreateControlChannel', 'ssmmessages:CreateDataChannel', 'ssmmessages:OpenControlChannel', 'ssmmessages:OpenDataChannel'],
        resources: ['*'],
        sid: 'EcsExec'
      }),
    )

    if (props.deployService) {
      // Create a load-balanced ECS service.    
      const serviceProperties = {
        cluster: cluster,
        taskDefinition: taskDefinition,
        desiredCount: 1,
        publicLoadBalancer: true,
        openListener: true,
        enableExecuteCommand: true
      };
      const loadBalancedEcsService = props.useFargate ?
        new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'web-site-ec2-service', serviceProperties) :
        new ecs_patterns.ApplicationLoadBalancedEc2Service(this, 'web-site-ec2-service', serviceProperties);
      loadBalancedEcsService.targetGroup.configureHealthCheck({ path: '/Privacy' });

      // Allow communication from the ECS service's ELB to the ECS ASG, if it exists.
      if (props.ecsAsgSecurityGroup)
        loadBalancedEcsService.loadBalancer.connections.allowTo(props.ecsAsgSecurityGroup, ec2.Port.allTcp());
    }
    else {
      console.log('DEPLOY_APP not set, skipping Amazon ECS service deployment.');
    }
  }
}
