// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as iam from 'aws-cdk-lib/aws-iam';

export interface ApplicationStackProps extends StackProps {
  solutionId: string,
  vpc: ec2.Vpc,
  ecsAsgSecurityGroup: ec2.ISecurityGroup,
  domainName: string,
  dbInstanceName: string,
  dbInstanceSecurityGroup: ec2.ISecurityGroup,
  credSpecParameter: ssm.StringParameter
}

export class ApplicationStack extends Stack {
  constructor(scope: Construct, id: string, props: ApplicationStackProps) {
    super(scope, id, props);

    const webSiteRepositoryArn: string = cdk.Arn.format({ service: 'ecr', resource: 'repository', resourceName: `${props.solutionId}/web-site` }, this);

    const cluster = ecs.Cluster.fromClusterAttributes(this, 'ecs-cluster', {
      clusterName: props.solutionId,
      vpc: props.vpc,
      securityGroups: []
    });

    // Create an IAM role for the task execution and  allows read access to the CredSpec SSM Parameter.
    const taskExecutionRole = new iam.Role(this, 'web-site-task-execution-role', {
      roleName: `${props.solutionId}-web-site-task-execution-role`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com')
    });
    taskExecutionRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'));
    props.credSpecParameter.grantRead(taskExecutionRole);

    // Get a reference to the repository.
    const webSiteRepository = ecr.Repository.fromRepositoryAttributes(this, 'web-site-repository', {
      repositoryArn: webSiteRepositoryArn,
      repositoryName: `${props.solutionId}/web-site`
    });

    // Create a ECS task. Include an application scratch volume.
    const ec2Task = new ecs.Ec2TaskDefinition(this, 'web-site-task', {
      executionRole: taskExecutionRole,
      volumes: [
        {
          name: 'application_scratch',
          host: {}
        }
      ],
    });

    // Add the web application container to the task definition.
    const webSiteContainer = ec2Task.addContainer('web-site-container', {
      image: ecs.ContainerImage.fromEcrRepository(webSiteRepository, 'latest'),
      memoryLimitMiB: 512,
      healthCheck: {
        command: ["CMD-SHELL", "curl -f http://localhost/Privacy || exit 1"]
      },
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'web'
      }),
      dockerSecurityOptions: [
        `credentialspec:${props.credSpecParameter.parameterArn}`
      ],
      environment: {
        "ASPNETCORE_ENVIRONMENT": "Development",
        // To use Kerberos authenication, you should use a domain FQDM to refere to the SQL Server,
        //   if you use the endpoint provided for by RDS the NTLM auth will be used instead, and will fail.
        "ConnectionStrings__Chinook": `Server=${props.dbInstanceName}.${props.domainName};Database=Chinook;Integrated Security=true;TrustServerCertificate=true;`,
      }
    });
    webSiteContainer.addPortMappings({ containerPort: 80 });
    webSiteContainer.addMountPoints({ sourceVolume: 'application_scratch', containerPath: '/var/scratch', readOnly: true });


    // Create a load-balanced service.    
    const loadBalancedEcsService = new ecs_patterns.ApplicationLoadBalancedEc2Service(this, 'web-site-ec2-service', {
      cluster: cluster,
      taskDefinition: ec2Task,
      desiredCount: 1,
      publicLoadBalancer: true,
      openListener: true,
      enableExecuteCommand: true
    });
    loadBalancedEcsService.targetGroup.configureHealthCheck({
      path: '/Privacy'
    });

    // Allow communication from the ECS service's ELB to the ECS ASG
    loadBalancedEcsService.loadBalancer.connections.allowTo(props.ecsAsgSecurityGroup, ec2.Port.allTcp());

    // Allow communication from then ECS ASG to the RDS SQL Server database
    props.dbInstanceSecurityGroup.connections.allowFrom(props.ecsAsgSecurityGroup, ec2.Port.tcp(1433));
  }
}
