using Amazon.CDK;
using Amazon.CDK.AWS.EC2;
using Amazon.CDK.AWS.IAM;
using Amazon.JSII.Runtime.Deputy;
using CdkDotnet.Models;
using CdkDotnet.StackProperties;
using Constructs;
using System.IO;
using System.Reflection;

namespace CdkDotnet.NestedStacks
{
    // Deploy a Windows EC2 instance to manage the Active Directory.
    // In a typical deployment, this instance is likely unnecessary.
    internal class BastionHostStack : NestedStack
    {
        public BastionHostStack(Construct scope, string id, BastionHostStackProps props = null)
            : base(scope, id, props)
        {
            // Load the content of the script files
            var excutingAssemblyLocation = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            var configureAdContent = File.ReadAllText($"{excutingAssemblyLocation}/Scripts/Configure-AD.ps1");
            var generateCredspecContent = File.ReadAllText($"{excutingAssemblyLocation}/Scripts/Generate-CredSpec.ps1");
            var addEcsInstancesToAdContent = File.ReadAllText($"{excutingAssemblyLocation}/Scripts/Add-ECSContainerInstancesToADGroup.ps1");
            var configureDbContent = File.ReadAllText($"{excutingAssemblyLocation}/Scripts/Configure-Database.ps1");
            var loginSqlContent = File.ReadAllText($"{excutingAssemblyLocation}/Scripts/login.sql");

            // Replace variable values in the script files
            var replaceAdVariables = (string content) =>
            {
                return content
                  .Replace("$AdDomainName = \"\"", $"$AdDomainName = \"{props.AdInfo.DomainName}\"")
                  .Replace("$AdAdminUsername = \"\"", $"$AdAdminUsername = \"{props.AdInfo.AdminUsername}\"")
                  .Replace("$GmsaName = \"\"", $"$GmsaName = \"{props.AdInfo.GmsaName}\"")
                  .Replace("$GmsaGroupName = \"\"", $"$GmsaGroupName = \"{props.AdInfo.GmsaAuthorizedGroupName}\"");
            };

            var replaceForNewLineInPowershell = (string fileContent) =>
            {
                return fileContent.Replace("$", "`$");
            };

            var fixQuotes = (string fileContent) =>
            {
                fileContent = replaceForNewLineInPowershell(fileContent);
                return fileContent.Replace("$DomainlessArn = \"`", "$DomainlessArn = \"");
            };

            configureAdContent = replaceAdVariables(configureAdContent);
            generateCredspecContent = replaceAdVariables(generateCredspecContent);
            generateCredspecContent = generateCredspecContent
              .Replace("$SolutionId = \"\"", $"$SolutionId = \"{props.SolutionId}\"")
              .Replace("$DomainlessArn = \"\"", $"$DomainlessArn = \"{props.DomainlessIdentitySecret.SecretArn}\"");
            addEcsInstancesToAdContent = replaceAdVariables(addEcsInstancesToAdContent);
            loginSqlContent = loginSqlContent
                .Replace("ad\\admin", $"{props.AdInfo.DomainName.Split('.')[0]}\\{props.AdInfo.AdminUsername}")
                .Replace("ad\\gmsa", $"{props.AdInfo.DomainName.Split('.')[0]}\\{props.AdInfo.GmsaName}");

            // Builds the UserData for the instance.
            var userData = UserData.ForWindows();
            userData.AddCommands(
                "Write-Output \"Installing the Active Directory management tools...\"",
                "Install-WindowsFeature -Name \"RSAT-AD-Tools\" -IncludeAllSubFeature",

                "Write-Output \"Installing Nuget...\"",
                "Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force",

                "Write-Output \"Installing CredentialSpec PS module...\"",
                "Install-Module CredentialSpec -Force",

                "Write-Output \"Installing SqlServer module for Powershell...\"",
                "Install-Module -Name SqlServer -Force",

                "Write-Output \"Writing support scripts...\"",
                "Remove-Item \"C:\\SampleConfig\" -Force -Recurse -ErrorAction SilentlyContinue",
                "New-Item \"C:\\SampleConfig\" -itemType Directory",
                $"Set-Content -Path \"C:\\SampleConfig\\Configure-AD.ps1\" -Value @\"\n{replaceForNewLineInPowershell(configureAdContent)}\n\"@",
                $"Set-Content -Path \"C:\\SampleConfig\\Configure-Database.ps1\" -Value @\"\n{replaceForNewLineInPowershell(configureDbContent)}\n\"@",
                $"Set-Content -Path \"C:\\SampleConfig\\login.sql\" -Value @\"\n{loginSqlContent}\n\"@",
                $"Set-Content -Path \"C:\\SampleConfig\\Generate-CredSpec.ps1\" -Value @\"\n{fixQuotes(generateCredspecContent)}\n\"@",
                $"Set-Content -Path \"C:\\SampleConfig\\Add-ECSContainerInstancesToADGroup.ps1\" -Value @\"\n{replaceForNewLineInPowershell(addEcsInstancesToAdContent)}\n\"@",
                
                "Write-Output \"Getting Active Directory credentials...\"",
                $"$adAdminPasswordSecret = Get-SECSecretValue -SecretId \"{props.ActiveDirectoryAdminPasswordSecret.SecretName}\"",
                $"$adAdminPassword = ConvertTo-SecureString $adAdminPasswordSecret.SecretString -AsPlainText -Force",
                $"$gmsaUserSecret = Get-SECSecretValue -SecretId \"{props.DomainlessIdentitySecret.SecretName}\"",
                $"$gmsaUserName =  $(ConvertFrom-Json $gmsaUserSecret.SecretString).username",
                $"$gmsaUserPassword = ConvertTo-SecureString $(ConvertFrom-Json $gmsaUserSecret.SecretString).password -AsPlainText -Force",
                $"$sqlServerAdminPasswordSecret = Get-SECSecretValue -SecretId \"{props.SqlServerRdsInstance.Secret?.SecretName}\"",
                $"$sqlServerAdminUsername = $(ConvertFrom-Json $sqlServerAdminPasswordSecret.SecretString).username",
                $"$sqlServerAdminPassword = ConvertTo-SecureString $(ConvertFrom-Json $sqlServerAdminPasswordSecret.SecretString).password -AsPlainText -Force",
                
                "Write-Output \"Configuring the Active Directory...\"",
                "C:\\SampleConfig\\Configure-AD.ps1 -AdAdminPassword $adAdminPassword -GmsaUserName $gmsaUserName -GmsaUserPassword $gmsaUserPassword",
                
                "Write-Output \"Configuring the database...\"",
                $"C:\\SampleConfig\\Configure-Database.ps1 -SqlServerInstanceAddress \"{props.SqlServerRdsInstance.DbInstanceEndpointAddress}\" -SqlServerAdminUsername $sqlServerAdminUsername -SqlServerAdminPassword $sqlServerAdminPassword",
                
                "Write-Output \"Installing Chocolatey...\"",
                "iex((New-Object System.Net.WebClient).DownloadString('https://chocolatey.org/install.ps1'))",
                "Import-Module \"$env:ChocolateyInstall\\helpers\\chocolateyInstaller.psm1\"",
                "choco feature enable -n allowGlobalConfirmation",
                
                "Write-Output \"Installing Microsoft SQL Server Management Studio...\"",
                "choco install sql-server-management-studio",

                "Write-Output \"Configuration complete.\""
            );

            var windowsServerImage = MachineImage.LatestWindows(WindowsVersion.WINDOWS_SERVER_2022_ENGLISH_FULL_BASE,
                new WindowsImageProps
                {
                    UserData = userData
                }
            );

            var directoryManagementInstance = new Instance_(this, "active-directory-management-instance",
                new InstanceProps
                {
                    InstanceType = InstanceType.Of(InstanceClass.T3, InstanceSize.LARGE),
                    MachineImage = windowsServerImage,
                    Vpc = props.Vpc,
                    VpcSubnets = new SubnetSelection { SubnetType = SubnetType.PUBLIC },
                    KeyName = props.AdManagementInstanceKeyPairName
                }
            );

            // Add the IP passed.
            directoryManagementInstance.Connections.SecurityGroups[0].AddIngressRule(Peer.Ipv4($"{props.AdManagementInstanceAccessIp}/32"), Port.Tcp(3389));

            // Allow the AD management instance to connect to the database, so the management instance can be used to set up the database access.
            directoryManagementInstance.Connections.AllowToDefaultPort(props.SqlServerRdsInstance, "Consider removing this rule after the database deployment is complete.");

            // Allow the AD management instance access to the Secrets used by the User Data.
            props.ActiveDirectoryAdminPasswordSecret.GrantRead(directoryManagementInstance);
            props.DomainlessIdentitySecret.GrantRead(directoryManagementInstance);
            props.SqlServerRdsInstance.Secret?.GrantRead(directoryManagementInstance);

            // Allow the AD management instance to invoke AWS-JoinDirectoryServiceDomain SSM Documment.
            directoryManagementInstance.Role.AddManagedPolicy(ManagedPolicy.FromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"));
            directoryManagementInstance.Role.AddManagedPolicy(ManagedPolicy.FromAwsManagedPolicyName("AmazonSSMDirectoryServiceAccess"));
            directoryManagementInstance.Role.AttachInlinePolicy(
                new Policy(this, "domain-join-ss-document",
                    new PolicyProps
                    {
                        Statements = new PolicyStatement[]
                        {
                            new PolicyStatement(
                                new PolicyStatementProps
                                {
                                    Actions = new string[] {"ssm:SendCommand" },
                                    Resources = new string[]
                                    {
                                        $"{this.ResourceArn(this, "ec2")}:instance/{directoryManagementInstance.Instance.Ref}",
                                        $"{this.ResourceArn(this, "ssm")}:document/{props.DomiainJoinSsmDocument.Ref}"
                                    }
                                }
                            ),
                        }
                    }
                )
            );

            // Allow the AD management instance to update the CredSpec SSM Parameter.
            directoryManagementInstance.Role.AttachInlinePolicy(
                new Policy(this, "credspec-parameter-update",
                    new PolicyProps
                    {
                        Statements = new PolicyStatement[]
                        {
                            new PolicyStatement(
                                new PolicyStatementProps
                                {
                                    Actions = new string[] {
                                        "ssm:PutParameter",
                                        "ssm:GetParametersByPath",
                                        "ssm:GetParameters",
                                        "ssm:GetParameter",
                                        "ssm:PutParameter"
                                    },
                                    Resources = new string[] {  props.CredSpecParameter.ParameterArn },
                                }
                            ),
                        },
                    }
                )
            );

            // Allow the AD management instance to inspect the EC2 instances part of the ECS ASG.
            // These permisions are a sample to help automate the addition of Amazon EC2 Linux instances to an AD Group.
            directoryManagementInstance.Role.AttachInlinePolicy(
                new Policy(this, "ecs-asg-inspect",
                    new PolicyProps
                    {
                        Statements = new PolicyStatement[]
                        {
                            new PolicyStatement(
                                new PolicyStatementProps
                                {
                                    Actions = new string[]
                                    {
                                        "autoscaling:DescribeAutoScalingGroups",
                                        "ec2:DescribeInstances"
                                    },
                                    Resources =  new string[] {"*"},
                                }
                            ),
                        },
                    }
                )
            );

            // Add appropiate tags to automatically join the EC2 instance to the AD domain.
            Amazon.CDK.Tags.Of(directoryManagementInstance).Add(props.DomainJoinTag, props.SolutionId);
        }

        private string ResourceArn(Stack stack, string service, ResourceRegionlessAndAccountless options = null)
        {
            options = options ?? new ResourceRegionlessAndAccountless();
            var region = options.Regionless == null ? "" : stack.Region;
            var account = options.Accountless == null ? "" : stack.Account;
            return $"arn:{stack.Partition}:{service}:{region}:{account}";
        }
    }
}