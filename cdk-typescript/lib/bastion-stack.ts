// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { AdInformation } from './infrastructure-stack';

import * as fs from 'fs';
import * as path from 'path';

import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';

import * as cdk from 'aws-cdk-lib';
import * as directory from 'aws-cdk-lib/aws-directoryservice';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as iam from 'aws-cdk-lib/aws-iam';

export interface BastionHostStackProps extends StackProps {
  solutionId: string,
  vpc: ec2.Vpc,
  ecsInstanceKeyPairName: string,
  adManagementInstanceAccessIp: string,
  adInfo: AdInformation,
  activeDirectory: directory.CfnMicrosoftAD,
  activeDirectoryAdminPasswordSecret: secretsmanager.Secret
  domainJoinSsmDocument: ssm.CfnDocument,
  domainJoinTag: string,
  sqlServerRdsInstance: rds.DatabaseInstance,
  credSpecParameter: ssm.StringParameter,
  credSpecBucket: s3.Bucket,
  domainlessIdentitySecret: secretsmanager.Secret
}

// Deploy a Windows EC2 instance to manage the Active Directory.
// In a typical deployment, this instance is likely unnecessary.    
export class BastionHostStack extends Stack {

  constructor(scope: Construct, id: string, props: BastionHostStackProps) {
    super(scope, id, props);

    // Load the content of the script files
    let configureAdContent = fs.readFileSync(path.resolve(__dirname, '../../scripts/Configure-AD.ps1')).toString();
    let generateCredspecContent = fs.readFileSync(path.resolve(__dirname, '../../scripts/Generate-CredSpec.ps1')).toString();
    let addEcsInstancesToAdContent = fs.readFileSync(path.resolve(__dirname, '../../scripts/Add-ECSContainerInstancesToADGroup.ps1')).toString();
    let configureDbContent = fs.readFileSync(path.resolve(__dirname, '../../scripts/Configure-Database.ps1')).toString();
    let loginSqlContent = fs.readFileSync(path.resolve(__dirname, '../../scripts/login.sql')).toString();

    // Replace variable values in the script files
    const replaceAdVariables = (content: string) => {
      return content
        .replace('$AdDomainName = ""', `$AdDomainName = "${props.adInfo.domainName}"`)
        .replace('$AdAdminUsername = ""', `$AdAdminUsername = "${props.adInfo.adminUsername}"`)
        .replace('$GmsaName = ""', `$GmsaName = "${props.adInfo.gmsaName}"`)
        .replace('$GmsaGroupName = ""', `$GmsaGroupName = "${props.adInfo.gmsaAuthorizedGroupName}"`);
    }
    configureAdContent = replaceAdVariables(configureAdContent);
    generateCredspecContent = replaceAdVariables(generateCredspecContent);
    generateCredspecContent = generateCredspecContent
      .replace('$SolutionId = ""', `$SolutionId = "${props.solutionId}"`)
      .replace('$DomainlessArn = ""', `$DomainlessArn = "${props.domainlessIdentitySecret.secretArn}"`)
      .replace('$CredSpecS3BucketName = ""', `$CredSpecS3BucketName = "${props.credSpecBucket.bucketName}"`);
    addEcsInstancesToAdContent = replaceAdVariables(addEcsInstancesToAdContent);
    loginSqlContent = loginSqlContent
      .replace(/ad\\admin/gi, `${props.adInfo.domainName.split('.')[0]}\\${props.adInfo.adminUsername}`)
      .replace(/ad\\gmsa/gi, `${props.adInfo.domainName.split('.')[0]}\\${props.adInfo.gmsaName}`)

    // Builds the UserData for the instance.
    const userData = ec2.UserData.forWindows();
    userData.addCommands(
      'Write-Output "Installing the Active Directory management tools..."',
      'Install-WindowsFeature -Name "RSAT-AD-Tools" -IncludeAllSubFeature',

      'Write-Output "Installing Nuget..."',
      'Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force',

      'Write-Output "Installing CredentialSpec PS module..."',
      'Install-Module CredentialSpec -Force',

      'Write-Output "Installing SqlServer module for Powershell..."',
      'Install-Module -Name SqlServer -Force',

      'Write-Output "Writing support scripts..."',
      'Remove-Item "C:\\SampleConfig" -Force -Recurse -ErrorAction SilentlyContinue',
      'New-Item "C:\\SampleConfig" -itemType Directory',
      `Set-Content -Path "C:\\SampleConfig\\Configure-AD.ps1" -Value @"\n${this.escapePowershellScript(configureAdContent)}\n"@`,
      `Set-Content -Path "C:\\SampleConfig\\Configure-Database.ps1" -Value @"\n${this.escapePowershellScript(configureDbContent)}\n"@`,
      `Set-Content -Path "C:\\SampleConfig\\login.sql" -Value @"\n${loginSqlContent}\n"@`,
      `Set-Content -Path "C:\\SampleConfig\\Generate-CredSpec.ps1" -Value @"\n${this.escapePowershellScript(generateCredspecContent)}\n"@`,
      `Set-Content -Path "C:\\SampleConfig\\Add-ECSContainerInstancesToADGroup.ps1" -Value @"\n${this.escapePowershellScript(addEcsInstancesToAdContent)}\n"@`,

      'Write-Output "Getting Active Directory credentials..."',
      `$adAdminPasswordSecret = Get-SECSecretValue -SecretId "${props.activeDirectoryAdminPasswordSecret.secretName}"`,
      `$adAdminPassword = ConvertTo-SecureString $adAdminPasswordSecret.SecretString  -AsPlainText -Force`,
      `$gmsaUserSecret = Get-SECSecretValue -SecretId "${props.domainlessIdentitySecret.secretName}"`,
      `$gmsaUserName =  $(ConvertFrom-Json $gmsaUserSecret.SecretString).username`,
      `$gmsaUserPassword = ConvertTo-SecureString  $(ConvertFrom-Json $gmsaUserSecret.SecretString).password -AsPlainText -Force`,
      `$sqlServerAdminPasswordSecret = Get-SECSecretValue -SecretId "${props.sqlServerRdsInstance.secret?.secretName}"`,
      `$sqlServerAdminUsername = $(ConvertFrom-Json $sqlServerAdminPasswordSecret.SecretString).username`,
      `$sqlServerAdminPassword = ConvertTo-SecureString  $(ConvertFrom-Json $sqlServerAdminPasswordSecret.SecretString).password -AsPlainText -Force`,

      'Write-Output "Configuring the Active Directory..."',
      `C:\\SampleConfig\\Configure-AD.ps1 -AdAdminPassword $adAdminPassword -GmsaUserName $gmsaUserName -GmsaUserPassword $gmsaUserPassword`,

      'Write-Output "Configuring the database..."',
      `C:\\SampleConfig\\Configure-Database.ps1 -SqlServerInstanceAddress "${props.sqlServerRdsInstance.dbInstanceEndpointAddress}" -SqlServerAdminUsername $sqlServerAdminUsername -SqlServerAdminPassword $sqlServerAdminPassword`,

      'Write-Output "Installing Chocolatey..."',
      "iex ((New-Object System.Net.WebClient).DownloadString('https://chocolatey.org/install.ps1'))",
      'Import-Module "$env:ChocolateyInstall\\helpers\\chocolateyInstaller.psm1"',
      'choco feature enable -n allowGlobalConfirmation',

      'Write-Output "Installing Microsoft SQL Server Management Studio..."',
      'choco install sql-server-management-studio',

      'Write-Output "Configuration complete."',
    );
    const windowsServerImage = ec2.MachineImage.latestWindows(ec2.WindowsVersion.WINDOWS_SERVER_2022_ENGLISH_FULL_BASE, {
      userData: userData
    });
    const keyPair = ec2.KeyPair.fromKeyPairName(this, 'ec2-key-pair', props.ecsInstanceKeyPairName);
    const directoryManagementInstance = new ec2.Instance(this, 'active-directory-management-instance', {
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.LARGE),
      machineImage: windowsServerImage,
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      keyPair: keyPair
    });

    // Add the IP passed.
    directoryManagementInstance.connections.securityGroups[0].addIngressRule(ec2.Peer.ipv4(`${props.adManagementInstanceAccessIp}/32`), ec2.Port.tcp(3389));

    // Allow the AD management instance to connect to the database, so the management instance can be used to set up the database access.
    directoryManagementInstance.connections.allowTo(props.sqlServerRdsInstance, ec2.Port.tcp(1433), 'from AD management instance');

    // Allow the AD management instance access to the Secrets used by the User Data.
    props.activeDirectoryAdminPasswordSecret.grantRead(directoryManagementInstance);
    props.domainlessIdentitySecret.grantRead(directoryManagementInstance);
    props.sqlServerRdsInstance.secret?.grantRead(directoryManagementInstance);

    // Allow the AD management instance to invoke AWS-JoinDirectoryServiceDomain SSM Documment.
    directoryManagementInstance.role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'));
    directoryManagementInstance.role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMDirectoryServiceAccess'))
    directoryManagementInstance.role.attachInlinePolicy(
      new iam.Policy(this, 'domain-join-ss-document', {
        statements: [
          new iam.PolicyStatement({
            actions: ['ssm:SendCommand'],
            resources: [
              `${this.resourceArn(this, 'ec2')}:instance/${directoryManagementInstance.instance.ref}`,
              `${this.resourceArn(this, 'ssm')}:document/${props.domainJoinSsmDocument.ref}`
            ],
          }),
        ],
      })
    );

    // Allow the AD management instance to update the CredSpec SSM Parameter and S3 bucket.
    props.credSpecParameter.grantRead(directoryManagementInstance.role);   
    props.credSpecParameter.grantWrite(directoryManagementInstance.role);   
    props.credSpecBucket.grantReadWrite(directoryManagementInstance.role);    

    // Allow the AD management instance to inspect the EC2 instances part of the ECS ASG.
    //    These permissions are a sample to help automate the addition of Amazon EC2 Linux instances to an AD Group.
    directoryManagementInstance.role.attachInlinePolicy(
      new iam.Policy(this, 'ecs-asg-inspect', {
        statements: [
          new iam.PolicyStatement({
            actions: [
              'autoscaling:DescribeAutoScalingGroups',
              "ec2:DescribeInstances",
            ],
            resources: ['*'],
          }),
        ],
      })
    );

    // Add appropriate tags to automatically join the EC2 instance to the AD domain.
    cdk.Tags.of(directoryManagementInstance).add(props.domainJoinTag, props.solutionId);
  }

  private resourceArn(stack: cdk.Stack, service: string, options: { regionless?: boolean, accountless?: boolean } = {}) {
    return `arn:${stack.partition}:${service}:${options.regionless ? '' : stack.region}:${options.accountless ? '' : stack.account}`;
  }

  /**
   * Replaces all variable name '$' with '`$' in a PowerShell script.
   * It skips any CDK Token such as '${Token[TOKEN.823]}'
   */
  private escapePowershellScript(script: string) {
    return script.replace(/\$(?!{Token)/gi, '\`$');
  }
}
