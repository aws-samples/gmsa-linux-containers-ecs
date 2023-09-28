using Amazon.CDK;
using Amazon.CDK.AWS.AutoScaling;
using Amazon.CDK.AWS.DirectoryService;
using Amazon.CDK.AWS.EC2;
using Amazon.CDK.AWS.ECS;
using Amazon.CDK.AWS.IAM;
using Amazon.CDK.AWS.SecretsManager;
using Amazon.CDK.AWS.SSM;
using CdkDotnet.Models;
using CdkDotnet.StackProperties;
using Constructs;
using System.Collections.Generic;
using System.Text.Json;
using static Amazon.CDK.AWS.DirectoryService.CfnMicrosoftAD;
using static Amazon.CDK.AWS.SSM.CfnAssociation;

namespace CdkDotnet.NestedStacks
{
    internal class InfrastructureStack : NestedStack
    {
        //Reference to the VPC created
        public Vpc Vpc { get; set; }

        // Reference to the Managed AD created
        public CfnMicrosoftAD ActiveDirectory { get; set; }

        // Reference to the AWS Secret containing the Managed AD admin password
        public Amazon.CDK.AWS.SecretsManager.Secret ActiveDirectoryAdminPasswordSecret { get; set; }

        // Referece to the SSM document used to join into this AD domain
        public CfnDocument DomiainJoinSsmDocument { get; set; }

        // Reference to the SSM parameter containing the gMSA CredSpec
        public StringParameter CredSpecParameter { get; set; }

        // Reference to the AWS Secret containing the AD user password that can retreive gMSA passwords in domainless mode
        public Amazon.CDK.AWS.SecretsManager.Secret DomainlessIdentitySecret { get; set; }

        // Reference to the Security Group used by the Amazon ECS ASG
        public ISecurityGroup EcsAsgSecurityGroup { get; set; }

        // Tag used to automatically join EC2 instances to the AD domain.
        public string AdDomainJoinTagKey = "ad-domain-join";

        // Provides information on the AD objects created or to be created
        public AdInformation AdInfo { get; set; }

        public InfrastructureStack(Construct scope, string id, InfrastructureStackProps props = null) 
            : base(scope, id, props)
        {
            // Constants
            const string VPC_SUBNET_CIDR = "10.0.0.0/26";

            // Builds AD variables
            var adInfo = new AdInformation
            {
                DomainName = $"directory.{props.SolutionId}.com",
                AdminUsername = "admin",
                GmsaName = "SampleWebApp",
                GmsaAuthorizedGroupName = "SampleWebAppGmsaPrincipals",
                GmsaCredentialsFetcherUsername = "SampleWebAppUser"
            };

            // Create the VPC to host all components of the sample
            var vpc = new Vpc(this, "vpc", 
                new VpcProps 
                {
                    IpAddresses = IpAddresses.Cidr(VPC_SUBNET_CIDR),
                    SubnetConfiguration =
                    new SubnetConfiguration[]
                    {
                        new SubnetConfiguration
                        {
                            SubnetType = SubnetType.PUBLIC,
                            Name= "Public"
                        },
                        new SubnetConfiguration
                        {
                            SubnetType = SubnetType.PRIVATE_WITH_EGRESS,
                            Name = "Private"
                        }
                    },
                    MaxAzs = 2
                }
            );

            vpc.AddFlowLog("FlowLogCloudWatch", new FlowLogOptions {
                TrafficType = FlowLogTrafficType.REJECT
            });

            // ------------------------------------------------------------------------------------------------------------------
            // Create the AWS Managed Active Directory
            // NOTE: Typically, the Active Directory will be deployed into another VPC or account. In that case, remove this code 
            // and replace it with code to establish a network route between the VPC created above and the Active Directory.

            // Create a secure password for the Active Directory admin user
            var activeDirectoryAdminPasswordSecret = new Amazon.CDK.AWS.SecretsManager.Secret(this, "active-directory-admin-password-secret",
                new SecretProps
                {
                    SecretName = $"{props.SolutionId}/active-directory-administrator-password",
                    GenerateSecretString = new SecretStringGenerator
                    {
                        ExcludeCharacters = "\"'" // Passwords with quotes are hard to work with on the command line.
                    }
                }
            );

            // Output the ARN of the directory admin password secret
            new CfnOutput(this, "ActiveDirectoryAdminPasswordSecretARN", new CfnOutputProps { Value = activeDirectoryAdminPasswordSecret.SecretArn });

            var activeDirectory = new CfnMicrosoftAD(this, "active-directory",
                new CfnMicrosoftADProps
                {
                    Name = adInfo.DomainName,
                    Password = activeDirectoryAdminPasswordSecret.SecretValue.UnsafeUnwrap(),
                    Edition = "Standard",
                    VpcSettings = new VpcSettingsProperty
                    {
                        VpcId = vpc.VpcId,
                        SubnetIds = new string[] { vpc.PrivateSubnets[0].SubnetId, vpc.PrivateSubnets[1].SubnetId }
                    }
                }
            );

            // Store the Active Directory ID in the Systems Manager Parameter Store, so it can be referenced by other stacks
            var activeDirectoryIdentifierParameter = new StringParameter(this, "active-directory-id-ssm-parameter",
                new StringParameterProps
                {
                    AllowedPattern = ".*",
                    Description = "Active Directory ID",
                    ParameterName = $"/{props.SolutionId}/active-directory-id",
                    StringValue = activeDirectory.AttrAlias,
                    Tier = ParameterTier.STANDARD
                }
            );

            // Create a DHCP Options Set so the VPC uses the Active Directory DNS servers
            var activeDirectoryDhcpOptionsSet = new CfnDHCPOptions(this, "active-directory-dhcp-ops",
                new CfnDHCPOptionsProps
                {
                    DomainNameServers = activeDirectory.AttrDnsIpAddresses
                }
            );

            new CfnVPCDHCPOptionsAssociation(this, "directory-dhcp-ops-association",
                new CfnVPCDHCPOptionsAssociationProps
                {
                    VpcId = vpc.VpcId,
                    DhcpOptionsId = activeDirectoryDhcpOptionsSet.Ref
                }
            );

            // ------------------------------------------------------------------------------------------------------------------
            // Create and configure the ECS Cluster
            var ecsCluster = new Cluster(this, "ecs-cluster",
                new ClusterProps
                {
                    ClusterName = props.SolutionId,
                    Vpc = vpc,
                    ContainerInsights = true
                }
            );

            // Create a secret to hold the AD username and password used by credentials fetcher to authenticate to the AD in scalability mode
            var domainlessUserIdentitySecret = new Amazon.CDK.AWS.SecretsManager.Secret(this, "cred-fetcher-identity-secret",
                new SecretProps
                {
                    SecretName = $"{props.SolutionId}/credentials-fetcher-identity",
                    GenerateSecretString = new SecretStringGenerator
                    {
                        ExcludeCharacters = "\"#$%&'()*,:;<>?[\\]^`{|}~", // Passwords with only these characters are permitted for domainless gMSA user: -/_+=.@!. So excluding the other types of characters that secrets manager can generate
                        GenerateStringKey = "password",
                        SecretStringTemplate = JsonSerializer.Serialize(
                            new
                            {
                                username = adInfo.GmsaCredentialsFetcherUsername,
                                domainName = adInfo.DomainName
                            }
                        ),
                    }
                }
            );

            // Define the User Data for the ASG
            var ecsUserData = UserData.ForLinux();
            ecsUserData.AddCommands(
              "echo \"ECS_GMSA_SUPPORTED=true\" >> /etc/ecs/ecs.config",
              "ps auxwwww",
              "echo \"sleeping for 60 secs...\"",
              "sleep 60s", // Needed to avoid RPM lock error      
              "ps auxwwww",
              "dnf install dotnet realmd oddjob oddjob-mkhomedir sssd adcli krb5-workstation samba-common-tools credentials-fetcher -y",
              "systemctl start credentials-fetcher"
            );

            // Define the ASG
            var ecsAutoScalingGroup = new AutoScalingGroup(this, "ecs-cluster-asg",
                new AutoScalingGroupProps
                {
                    Vpc = vpc,
                    InstanceType = new InstanceType("t3.small"),
                    MachineImage = MachineImage.FromSsmParameter("/aws/service/ecs/optimized-ami/amazon-linux-2023/recommended/image_id"),
                    UserData = ecsUserData,
                    MinCapacity = 1,
                    MaxCapacity = 2,
                    KeyName = props.EcsInstanceKeyPairName,
                    Cooldown = Duration.Minutes(1),
                    HealthCheck = Amazon.CDK.AWS.AutoScaling.HealthCheck.Ec2(
                        new Ec2HealthCheckOptions
                        {
                            Grace = Duration.Minutes(10)
                        }
                    )
                }
            );

            // Add policy for instances to be managed via SSM
            ecsAutoScalingGroup.Role.AddManagedPolicy(ManagedPolicy.FromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"));

            // Associate the ASG to the ECS cluster
            var ecsCapacityProvider = new AsgCapacityProvider(this, "ecs-cluster-asg-capacity-provider", new AsgCapacityProviderProps
            {
                AutoScalingGroup = ecsAutoScalingGroup,
                EnableManagedTerminationProtection = false // This allows CloudFormation to clean all resources succesfully on deletion
            }
            );

            ecsCluster.AddAsgCapacityProvider(ecsCapacityProvider);

            // Output the Name of the Amazon ECS ASG
            new CfnOutput(this, "ECSAutoScalingGroupName", new CfnOutputProps { Value = ecsAutoScalingGroup.AutoScalingGroupName });

            // ------------------------------------------------------------------------------------------------------------------
            // Create objects to join EC2 instances to the Managed AD domain

            // SSM document for seamless joining EC2 instances to the Managed AD domain
            //   More info on: https://docs.aws.amazon.com/directoryservice/latest/admin-guide/seamlessly_join_linux_instance.html#seamless-linux-prereqs
            var domainJoinSsmDocument = new CfnDocument(this, "domain-join-ssm-document",
                new CfnDocumentProps
                {
                    DocumentType = "Command",
                    Content = JsonSerializer.Serialize(
                        new
                        {
                            schemaVersion = "2.2",
                            description = $"Joins an EC2 instance to the {activeDirectory.Name} domain using seamless joining",
                            mainSteps = new[]
                                {
                                new
                                {
                                    action = "aws:domainJoin",
                                    name = "domainJoin",
                                    inputs = new
                                    {
                                        directoryId = activeDirectory.AttrAlias,
                                        directoryName = activeDirectory.Name
                                    }
                                }
                            }
                        }
                    )
                }
            );

            // AWS Secret used in seamless domain join
            var activeDirectorySeamlessJoinSecret = new Amazon.CDK.AWS.SecretsManager.Secret(this, "active-directory-seamless-join-secret",
                new SecretProps
                {
                    SecretName = $"aws/directory-services/{activeDirectory.AttrAlias}/seamless-domain-join",
                    SecretObjectValue = new Dictionary<string, SecretValue>
                    {
                        { "awsSeamlessDomainUsername", SecretValue.UnsafePlainText(adInfo.AdminUsername) },
                        { "awsSeamlessDomainPassword", activeDirectoryAdminPasswordSecret.SecretValue }
                    }
                }
            );

            // Alternative method used to join Linux instances while AL2023 releases seamless domain join
            // TODO: Remove when seamless domain join is avaliable for AL2023
            var domainJoinSsmDocumentAtl = new CfnDocument(this, "domain-join-ssm-document-alt",
                new CfnDocumentProps
                {
                    DocumentType = "Command",
                    Content = JsonSerializer.Serialize(
                        new
                        {
                            schemaVersion = "2.2",
                            description = $"Joins an ECS container instance to the {activeDirectory.Name} domain using the realm CLI",
                            mainSteps = new[]
                            {
                                new
                                {
                                    action = "aws:runShellScript",
                                    name = "domainJoinEcs",
                                    inputs = new
                                    {
                                        timeoutSeconds = "160",
                                        runCommand = new []
                                        {
                                            "echo \"Waiting 80 seconds...\"",
                                            "sleep 80s",
                                            "sudo dnf install jq -y",
                                            "echo \"Retrieving AD admin password...\"",
                                            $"adAdminPassword=$(aws secretsmanager get-secret-value --secret-id {activeDirectoryAdminPasswordSecret.SecretName})",
                                            "echo \"Joining the AD domain...\"",
                                            $"echo \"${{adAdminPassword}}\" | jq -r '.SecretString' | sudo realm join -U {adInfo.AdminUsername}@{activeDirectory.Name.ToUpper()} {activeDirectory.Name} --verbose",
                                            "echo \"Restaring the ECS container instance...\"",
                                            "sudo systemctl stop ecs",
                                            "sudo systemctl start ecs"
                                        }
                                    }
                                }
                            }
                        }
                    )
                }
            );

            activeDirectoryAdminPasswordSecret.GrantRead(ecsAutoScalingGroup.Role);

            // ------------------------------------------------------------------------------------------------------------------
            // Configure the ECS cluster instances to join the Managed AD domain

            // Create SSM association to run SSM document for all tagged instances
            var ecsAssociation = new CfnAssociation(this, "ecs-cluster-asg-domain-join-ssm-association",
                new CfnAssociationProps
                {
                    AssociationName = $"{props.SolutionId}-AD-Domian-Join",
                    Name = domainJoinSsmDocument.Ref,
                    Targets = new TargetProperty[]
                    {
                        new TargetProperty
                        {
                            Key = $"tag:{this.AdDomainJoinTagKey}",
                            Values = new [] { props.SolutionId }
                        }
                    }
                }
            );


            //    This will happen only if the appropiate environment variable is set
            if (props.DomainJoinEcsInstances)
            {

                // TODO: Remove when seamless domain join is avaliable for AL2023
                var ecsAssociationAlt = new CfnAssociation(this, "ecs-cluster-asg-domain-join-ssm-association-alt",
                    new CfnAssociationProps
                    {
                        AssociationName = $"{props.SolutionId}-AD-Domian-Join-Alt",
                        Name = domainJoinSsmDocumentAtl.Ref,
                        Targets = new TargetProperty[]
                        {
                            new TargetProperty
                            {
                                Key = $"tag:{this.AdDomainJoinTagKey}",
                                Values = new [] { props.SolutionId }
                            }
                        }
                    }
                );

                // Applies the tag to the ECS instances
                Amazon.CDK.Tags.Of(ecsAutoScalingGroup).Add(this.AdDomainJoinTagKey, props.SolutionId);

                // Grants read access for the seamless domain join secret to the ECS ASG
                activeDirectorySeamlessJoinSecret.GrantRead(ecsAutoScalingGroup.Role);

                // Add policies to the ASG to be able to join the Managed AD domian
                ecsAutoScalingGroup.Role.AddManagedPolicy(ManagedPolicy.FromAwsManagedPolicyName("AmazonSSMDirectoryServiceAccess"));
                ecsAutoScalingGroup.Role.AttachInlinePolicy(
                    new Policy(this, "domain-join-ssm-document-association",
                        new PolicyProps
                        {
                            Statements = new PolicyStatement[]
                            {
                            new PolicyStatement(
                                new PolicyStatementProps
                                {
                                    Actions = new string[]
                                    {
                                        "ssm:CreateAssociation",
                                        "ssm:UpdateAssociation"
                                    },

                                    Resources = new string[] {"*"}, // This is required in order to join any EC2 instance to the Managed AD domain
                                }
                            )
                            }
                        }
                    )
                );
            }

            // ------------------------------------------------------------------------------------------------------------------
            // Create an SSM parameter to hold the CredSpec file
            // This secret will be used by the credentials fetcher inside ECS to retreive gMSA passwords
            var credSpecParameter = new StringParameter(this, "credspec-ssm-parameter", 
                new StringParameterProps 
                {
                    AllowedPattern = ".*",
                    Description = "gMSA CredSpec",
                    ParameterName = $"/{props.SolutionId}/credspec",
                    StringValue = "RUN Generate-CredSpec.ps1 to populate this parameter",
                    Tier = ParameterTier.STANDARD
                }
            );

            // ------------------------------------------------------------------------------------------------------------------
            // Variables used by other Stacks
            this.AdInfo = adInfo;
            this.Vpc = vpc;
            this.ActiveDirectory = activeDirectory;
            this.ActiveDirectoryAdminPasswordSecret = activeDirectoryAdminPasswordSecret;
            this.DomiainJoinSsmDocument = domainJoinSsmDocument;
            this.EcsAsgSecurityGroup = ecsAutoScalingGroup.Connections.SecurityGroups[0];
            this.CredSpecParameter = credSpecParameter;
            this.DomainlessIdentitySecret = domainlessUserIdentitySecret;
        }
    }
}
