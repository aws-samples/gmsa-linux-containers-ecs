// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';

import * as cdk from 'aws-cdk-lib';
import * as directory from 'aws-cdk-lib/aws-directoryservice';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as iam from 'aws-cdk-lib/aws-iam';

export interface InfrastructureStackProps extends StackProps {
  solutionId: string
  ecsInstanceKeyPairName: string,
  domianJoinedEcsInstances: string
}

export interface AdInformation {
  domainName: string,
  adminUsername: string,
  gmsaName: string,
  gmsaAuthorizedGroupName: string,
  gmsaCredentialsFetcherUsername: string
}

export class InfrastructureStack extends Stack {

  // Reference to the VPC created
  public vpc: ec2.Vpc;

  // Reference to the Managed AD created
  public activeDirectory: cdk.aws_directoryservice.CfnMicrosoftAD;

  // Reference to the AWS Secret containing the Managed AD admin password
  public activeDirectoryAdminPasswordSecret: secretsmanager.Secret;

  // Referece to the SSM document used to join into this AD domain
  public domiainJoinSsmDocument: ssm.CfnDocument;

  // Reference to the SSM parameter containing the gMSA CredSpec
  public credSpecParameter: ssm.StringParameter;

  // Reference to the AWS Secret containing the AD user password that can retreive gMSA passwords
  public credentialsFetcherIdentitySecret: secretsmanager.Secret;

  // Reference to the Security Group used by the Amazon ECS ASG
  public ecsAsgSecurityGroup: ec2.ISecurityGroup;

  // Provides information on the AD objects created or to be created
  public adInfo: AdInformation;

  constructor(scope: Construct, id: string, props: InfrastructureStackProps) {
    super(scope, id, props);

    // Constants
    const VPC_SUBNET_CIDR = '10.0.0.0/26';

    // Builds AD variables
    const adInfo = {
      domainName: `directory.${props.solutionId}.com`,
      adminUsername: 'admin',
      gmsaName: 'SampleWebApp',
      gmsaAuthorizedGroupName: 'SampleWebAppGmsaPrincipals',
      gmsaCredentialsFetcherUsername: 'SampleWebAppUser'
    }

    // ------------------------------------------------------------------------------------------------------------------
    // Create the VPC to host all components of the sample
    const vpc = new ec2.Vpc(this, 'vpc', {
      cidr: VPC_SUBNET_CIDR,
      subnetConfiguration: [
        {
          subnetType: ec2.SubnetType.PUBLIC,
          name: 'Public'
        },
        {
          subnetType: ec2.SubnetType.PRIVATE_WITH_NAT,
          name: 'Private'
        }
      ],
      maxAzs: 2
    });
    vpc.addFlowLog('FlowLogCloudWatch', {
      trafficType: ec2.FlowLogTrafficType.REJECT
    });


    // ------------------------------------------------------------------------------------------------------------------
    // Create the AWS Managed Active Directory
    // NOTE: Typically, the Active Directory will be deployed into another VPC or account. In that case, remove this code 
    // and replace it with code to establish a network route between the VPC created above and the Active Directory.

    // Create a secure password for the Active Directory admin user
    const activeDirectoryAdminPasswordSecret = new secretsmanager.Secret(this, 'active-directory-admin-password-secret',
      {
        secretName: `${props.solutionId}/active-directory-administrator-password`,
        generateSecretString: {
          excludeCharacters: '"\'' // Passwords with quotes are hard to work with on the command line.
        }
      }
    );

    // Output the ARN of the directory admin password secret
    new cdk.CfnOutput(this, 'ActiveDirectoryAdminPasswordSecretARN', { value: activeDirectoryAdminPasswordSecret.secretArn });

    const activeDirectory = new directory.CfnMicrosoftAD(this, 'active-directory', {
      name: adInfo.domainName,
      password: activeDirectoryAdminPasswordSecret.secretValue.unsafeUnwrap(),
      edition: 'Standard',
      vpcSettings: {
        vpcId: vpc.vpcId,
        subnetIds: [vpc.privateSubnets[0].subnetId, vpc.privateSubnets[1].subnetId]
      }
    });

    // Store the Active Directory ID in the Systems Manager Parameter Store, so it can be referenced by other stacks
    const activeDirectoryIdentifierParameter = new ssm.StringParameter(this, 'active-directory-id-ssm-parameter', {
      allowedPattern: '.*',
      description: 'Active Directory ID',
      parameterName: `/${props.solutionId}/active-directory-id`,
      stringValue: activeDirectory.attrAlias,
      tier: ssm.ParameterTier.STANDARD
    });

    // Create a DHCP Options Set so the VPC uses the Active Directory DNS servers
    const activeDirectoryDhcpOptionsSet = new ec2.CfnDHCPOptions(this, 'active-directory-dhcp-ops', {
      domainNameServers: activeDirectory.attrDnsIpAddresses
    });
    new ec2.CfnVPCDHCPOptionsAssociation(this, 'directory-dhcp-ops-association', {
      vpcId: vpc.vpcId,
      dhcpOptionsId: activeDirectoryDhcpOptionsSet.ref
    });

    // ------------------------------------------------------------------------------------------------------------------
    // Create and configure the ECS Cluster
    const ecsCluster = new ecs.Cluster(this, 'ecs-cluster', {
      clusterName: props.solutionId,
      vpc: vpc,
      containerInsights: true
    });

    // Create a secret to hold the AD username and password used by credentials fetcher to authenticate to the AD in scalability mode
    let credentialsFetcherIdentitySecret: cdk.aws_secretsmanager.Secret | null = null;
    credentialsFetcherIdentitySecret = new secretsmanager.Secret(this, 'cred-fetcher-identity-secret',
      {
        secretName: `${props.solutionId}/credentials-fetcher-identity`,
        generateSecretString: {
          excludeCharacters: '"\'', // Passwords with quotes are hard to work with on the command line
          generateStringKey: 'password',
          secretStringTemplate: JSON.stringify({
            username: adInfo.gmsaCredentialsFetcherUsername,
          }),
        }
      }
    );

    // Define the User Data for the ASG
    const ecsUserData = ec2.UserData.forLinux();
    ecsUserData.addCommands(
       props.domianJoinedEcsInstances === '0' ? `echo "CREDENTIALS_FETCHER_SECRET_NAME_FOR_DOMAINLESS_GMSA=${credentialsFetcherIdentitySecret?.secretName}" >> /etc/ecs/ecs.config` : '',
      'echo "ECS_GMSA_SUPPORTED=true" >> /etc/ecs/ecs.config',

      'ps auxwwww',
      'echo "sleeping for 60 secs..."',
      'sleep 60s', // Needed to avoid RPM lock error      
      'ps auxwwww',
      'sudo dnf update -y',
      'sudo dnf install dotnet realmd oddjob oddjob-mkhomedir sssd adcli krb5-workstation samba-common-tools credentials-fetcher -y',

      'sudo systemctl start credentials-fetcher'
    );

    // Define the ASG
    const ecsAutoScalingGroup = new autoscaling.AutoScalingGroup(this, 'ecs-cluster-asg', {
      vpc,
      instanceType: new ec2.InstanceType('t3.small'),
      machineImage: ec2.MachineImage.fromSsmParameter('/aws/service/ecs/optimized-ami/amazon-linux-2023/recommended/image_id'),
      userData: ecsUserData,
      minCapacity: 1,
      maxCapacity: 2,
      keyName: props.ecsInstanceKeyPairName,
      cooldown: cdk.Duration.minutes(1),
      healthCheck: autoscaling.HealthCheck.ec2({
        grace: cdk.Duration.minutes(10)
      })
    });

    // Add policy for instances to be managed via SSM
    ecsAutoScalingGroup.role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'));

    // Grat access for the credentials fecther secret to the ECS ASG
    credentialsFetcherIdentitySecret?.grantRead(ecsAutoScalingGroup.role);

    // Associate the ASG to the ECS cluster
    const ecsCapacityProvider = new ecs.AsgCapacityProvider(this, 'ecs-cluster-asg-capacity-provider', {
      autoScalingGroup: ecsAutoScalingGroup,
      enableManagedTerminationProtection: false // This allows CloudFormation to clean all resources succesfully on deletion
    });
    ecsCluster.addAsgCapacityProvider(ecsCapacityProvider);

    // Output the Name of the Amazon ECS ASG
    new cdk.CfnOutput(this, 'ECSAutoScalingGroupName', { value: ecsAutoScalingGroup.autoScalingGroupName });

    // ------------------------------------------------------------------------------------------------------------------
    // Create objects to join EC2 instances to the Managed AD domain

    // SSM document for seamless joining EC2 instances to the Managed AD domain
    //   More info on: https://docs.aws.amazon.com/directoryservice/latest/admin-guide/seamlessly_join_linux_instance.html#seamless-linux-prereqs
    const domainJoinSsmDocument = new ssm.CfnDocument(this, 'domain-join-ssm-document', {
      documentType: "Command",
      content: {
        "schemaVersion": "2.2",
        "description": `Joins an EC2 instance to the ${activeDirectory.name} domain using seamless joining`,
        "mainSteps": [
          {
            "action": "aws:domainJoin",
            "name": "domainJoin",
            "inputs": {
              "directoryId": activeDirectory.attrAlias,
              "directoryName": activeDirectory.name
            }
          }
        ]
      }
    });

    // AWS Secret used in seamless domain join
    const activeDirectorySeamlessJoinSecret = new secretsmanager.Secret(this, 'active-directory-seamless-join-secret',
      {
        secretName: `aws/directory-services/${activeDirectory.attrAlias}/seamless-domain-join`,
        secretObjectValue: {
          awsSeamlessDomainUsername: cdk.SecretValue.unsafePlainText(adInfo.adminUsername),
          awsSeamlessDomainPassword: activeDirectoryAdminPasswordSecret.secretValue
        }
      }
    );

    // Alternative method used to join Linux instances while AL2023 releases seamless domain join
    //   TODO: Remove when seamless domain join is avaliable for AL2023
    const domainJoinSsmDocumentAtl = new ssm.CfnDocument(this, 'domain-join-ssm-document-alt', {
      documentType: "Command",
      content: {
        "schemaVersion": "2.2",
        "description": `Joins an ECS container instance to the ${activeDirectory.name} domain using the realm CLI`,
        "mainSteps": [
          {
            "action": "aws:runShellScript",
            "name": "domainJoinEcs",
            "inputs": {
              "timeoutSeconds": "160",
              "runCommand": [
                'echo "Waiting 80 seconds..."',
                'sleep 80s',
                'sudo dnf install jq -y',
                'echo "Retrieving AD admin password..."',
                `adAdminPassword=$(aws secretsmanager get-secret-value --secret-id ${activeDirectoryAdminPasswordSecret.secretName})`,
                'echo "Joining the AD domain..."',
                `echo "$\{adAdminPassword}" | jq -r '.SecretString' | sudo realm join -U ${adInfo.adminUsername}@${activeDirectory.name.toUpperCase()} ${activeDirectory.name} --verbose`,
                'echo "Restaring the ECS container instance..."',
                'sudo systemctl stop ecs',
                'sudo systemctl start ecs'
              ]
            }
          }
        ]
      }
    });
    activeDirectoryAdminPasswordSecret.grantRead(ecsAutoScalingGroup.role);

    // ------------------------------------------------------------------------------------------------------------------
    // Configure the ECS cluster instances to join the Managed AD domain
    //    This will happen only if the appropiate environment variable is set
    if (props.domianJoinedEcsInstances !== '0') {

      // Create SSM association to run SSM document for all tagged instances
      const ecsInstanceTagKey = 'ad-domain-join';
      const ecsAssociation = new ssm.CfnAssociation(this, 'ecs-cluster-asg-domain-join-ssm-association', {
        associationName: `${props.solutionId}-AD-Domian-Join`,
        name: domainJoinSsmDocument.ref,
        targets: [{
          key: `tag:${ecsInstanceTagKey}`,
          values: [props.solutionId],
        }]
      });
      // TODO: Remove when seamless domain join is avaliable for AL2023
      const ecsAssociationAlt = new ssm.CfnAssociation(this, 'ecs-cluster-asg-domain-join-ssm-association-alt', {
        associationName: `${props.solutionId}-AD-Domian-Join-Alt`,
        name: domainJoinSsmDocumentAtl.ref,
        targets: [{
          key: `tag:${ecsInstanceTagKey}`,
          values: [props.solutionId],
        }]
      });

      // Applies the tag to the ECS instances
      cdk.Tags.of(ecsAutoScalingGroup).add(ecsInstanceTagKey, props.solutionId);

      // Grants read access for the seamless domain join secret to the ECS ASG
      activeDirectorySeamlessJoinSecret.grantRead(ecsAutoScalingGroup.role);

      // Add policies to the ASG to be able to join the Managed AD domian
      ecsAutoScalingGroup.role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMDirectoryServiceAccess'));
      ecsAutoScalingGroup.role.attachInlinePolicy(
        new iam.Policy(this, 'domain-join-ssm-document-association', {
          statements: [
            new iam.PolicyStatement({
              actions: [
                'ssm:CreateAssociation',
                'ssm:UpdateAssociation'
              ],
              resources: ['*'], // This is required in order to join any EC2 instance to the Managed AD domain
            }),
          ],
        })
      );
    }

    // ------------------------------------------------------------------------------------------------------------------
    // Create the container repository for the application
    const webSiteRepository = new ecr.Repository(this, 'web-site-repository', {
      repositoryName: `${props.solutionId}/web-site`,
    });

    // ------------------------------------------------------------------------------------------------------------------
    // Create an SSM parameter to hold the CredSpec file
    //    This secret will be used by the credentials fetcher inside ECS to retreive gMSA passwords
    const credSpecParameter = new ssm.StringParameter(this, 'credspec-ssm-parameter', {
      allowedPattern: '.*',
      description: 'gMSA CredSpec',
      parameterName: `/${props.solutionId}/credspec`,
      stringValue: 'RUN Generate-CredSpec.ps1 to populate this parameter',
      tier: ssm.ParameterTier.STANDARD
    });

    // ------------------------------------------------------------------------------------------------------------------
    // Variables used by other Stacks
    this.adInfo = adInfo;
    this.vpc = vpc;
    this.activeDirectory = activeDirectory;
    this.activeDirectoryAdminPasswordSecret = activeDirectoryAdminPasswordSecret;
    this.domiainJoinSsmDocument = domainJoinSsmDocument;
    this.ecsAsgSecurityGroup = ecsAutoScalingGroup.connections.securityGroups[0];
    this.credSpecParameter = credSpecParameter;
    this.credentialsFetcherIdentitySecret = credentialsFetcherIdentitySecret;
  }
}
