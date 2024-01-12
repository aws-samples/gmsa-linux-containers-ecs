// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';

import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

export interface ApplicationStackProps extends StackProps {
  solutionId: string,
  vpc: ec2.Vpc,
  useFargate: boolean,
  ecsAsgSecurityGroup: ec2.ISecurityGroup | undefined,
  areEcsInstancesDomainJoined: boolean,
  domainName: string,
  dbInstanceName: string,
  credSpecParameter: ssm.StringParameter,
  domainlessIdentitySecret: secretsmanager.Secret,
  deployService: boolean,
  taskDefinitionRevision: string
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

    // Create an IAM role for the task execution and  allows read access to the CredSpec SSM Parameter.
    const taskExecutionRole = new iam.Role(this, 'web-site-task-execution-role', {
      roleName: `${props.solutionId}-web-site-task-execution-role`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com')
    });
    taskExecutionRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'));
    props.credSpecParameter.grantRead(taskExecutionRole);
    props.domainlessIdentitySecret.grantRead(taskExecutionRole);

    // Create the container repository for the application
    const webSiteRepository = new ecr.Repository(this, 'web-site-repository', {
      repositoryName: `${props.solutionId}/web-site`,
    });

    // Create a ECS task. Include an application scratch volume.
    const taskDefinitionProperties = {
      family: 'amazon-ecs-gmsa-linux-web-site-task',
      executionRole: taskExecutionRole,
    };
    const taskDefinition = props.useFargate ?
      new ecs.FargateTaskDefinition(this, 'web-site-task-def', taskDefinitionProperties) :
      new ecs.Ec2TaskDefinition(this, 'web-site-task-def', taskDefinitionProperties);

    // Add the web application container to the task definition.
    const webSiteContainer = taskDefinition.addContainer('web-site-container', {
      image: ecs.ContainerImage.fromEcrRepository(webSiteRepository, 'latest'),
      memoryLimitMiB: 512,
      healthCheck: {
        command: ["CMD-SHELL", "curl -f http://localhost/Privacy || exit 1"]
      },
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'web'
      }),
      // credentialSpecs: [
      //   `${props.areEcsInstancesDomianJoined ? 'credentialspec' : 'credentialspecdomainless'}:${props.credSpecParameter.parameterArn}`
      // ],
      environment: {
        "ASPNETCORE_ENVIRONMENT": "Development",
        // To use Kerberos authentication, you should use a domain FQDM to refere to the SQL Server,
        //   if you use the endpoint provided for by RDS the NTLM auth will be used instead, and will fail.
        "ConnectionStrings__Chinook": `Server=${props.dbInstanceName}.${props.domainName};Database=Chinook;Integrated Security=true;TrustServerCertificate=true;`,
        "CREDENTIAL_SPEC": `${props.areEcsInstancesDomainJoined ? 'credentialspec' : 'credentialspecdomainless'}:${props.credSpecParameter.parameterArn}`
      }
    });
    webSiteContainer.addPortMappings({ containerPort: 80 });

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

      // Updates the task definition revison based on the global environment variable.
      (loadBalancedEcsService.service.node.tryFindChild('Service') as ecs.CfnService)?.addPropertyOverride('TaskDefinition', `arn:aws:ecs:${this.region}:${this.account}:task-definition/${taskDefinition.family}:${props.taskDefinitionRevision}`);

      // Allow communication from the ECS service's ELB to the ECS ASG, if it exists.
      if (props.ecsAsgSecurityGroup)
        loadBalancedEcsService.loadBalancer.connections.allowTo(props.ecsAsgSecurityGroup, ec2.Port.allTcp());
    }
    else {
      console.log('DEPLOY_APP not set, skipping Amazon ECS service deployment.');
    }
  }

  /**
   * WORKAROUND for lack of AWS CDK L2 construct support
   * Replaces the 'DockerSecurityOptions' property of the first container in "web-site-task" with the new, and still unsupported, 'CredentialSpecOptions' property. 
   * This enables support for domainless gMSA while the L2 construct are released.
   */
  // protected _toCloudFormation() {
  //   const cf = super._toCloudFormation();

  //   for (const key in cf.Resources) {
  //     const cfResource = cf.Resources[key];

  //     if (cfResource.Type === "AWS::ECS::TaskDefinition") {
  //       console.log("Patching ECS task definition...");
  //       cfResource.Properties.ContainerDefinitions[0].CredentialSpecs = cfResource.Properties.ContainerDefinitions[0].DockerSecurityOptions;
  //       cfResource.Properties.ContainerDefinitions[0].DockerSecurityOptions = undefined;
  //       console.log("Patching complete.");
  //     }
  //   }
  //   return cf;
  // }
}
